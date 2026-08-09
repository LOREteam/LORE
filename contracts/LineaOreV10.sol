// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.36;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

/**
 * @title LineaOreV10
 * @notice Preserves V9 tokenomics, randomness and public interfaces while
 *         reducing hot-path storage writes through transient reentrancy
 *         protection, packed accounting and event-derived player counts.
 * @dev Accounting invariants:
 *      - fees are charged only on fresh stake; rollover and jackpot balances
 *        are never charged a second time;
 *      - reward, rebate, resolver, fee and dust paths close accounting state
 *        before transferring tokens;
 *      - resolution and claims use no global player loop; caller-supplied batch
 *        work is bounded by transaction gas;
 *      - the owner cannot withdraw game funds, pause betting or renounce
 *        ownership, and sensitive configuration changes are timelocked.
 * @dev The token must be a standard non-rebasing, non-fee-on-transfer ERC-20.
 *      Randomness deliberately matches V9 and is not a VRF.
 * @custom:security-contact mailto:playlore88@gmail.com
 */
contract LineaOreV10 is Ownable2Step, ReentrancyGuardTransient {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;

    uint256 public constant GRID_SIZE = 25;
    uint256 public constant DAILY_JACKPOT_PERCENT = 2;
    uint256 public constant WEEKLY_JACKPOT_PERCENT = 3;
    uint256 public constant PROTOCOL_FEE_PERCENT = 2;
    uint256 public constant BURN_FEE_PERCENT = 1;
    uint256 public constant RESOLVER_REWARD_BPS = 5; // 0.05%
    uint256 public constant BPS_DENOMINATOR = 10_000;
    // Retained for V9 ABI compatibility; V10 fee flushing is permissionless and explicit.
    uint256 public constant FEE_FLUSH_INTERVAL_EPOCHS = 120;
    uint256 public constant EPOCH_DURATION_TIMELOCK = 30 minutes;
    uint256 public constant FEE_RECIPIENT_TIMELOCK = 24 hours;
    uint256 public constant DUST_SETTLE_DELAY = 365 days;
    uint256 public constant LAST_BET_GRACE_SECONDS = 2;
    uint32 internal constant MAX_TILE_MASK = type(uint32).max >> (32 - GRID_SIZE);
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;
    uint256 internal constant MONDAY_OFFSET = 3 days;
    // Epoch clock word: [start timestamp:128 | epoch:96 | duration:32].
    uint256 internal constant CURRENT_EPOCH_SHIFT = 32;
    uint256 internal constant EPOCH_START_TIME_SHIFT = 128;
    uint256 internal constant JACKPOT_AWARD_EPOCH_SHIFT = 128;
    uint256 internal constant WEEKLY_JACKPOT_CHECK_SHIFT = 128;
    // Resolution word: [unused | flags:3 | winning tile:8 | timestamp:128].
    uint256 internal constant RESOLUTION_WINNING_TILE_SHIFT = 128;
    uint256 internal constant DAILY_JACKPOT_FLAG = 1 << 136;
    uint256 internal constant WEEKLY_JACKPOT_FLAG = 1 << 137;
    uint256 internal constant REWARD_DUST_SETTLED_FLAG = 1 << 138;
    // User epoch word: [rebate claimed:1 | reward claimed:1 | volume:254].
    uint256 internal constant REWARD_CLAIMED_FLAG = 1 << 254;
    uint256 internal constant REBATE_CLAIMED_FLAG = 1 << 255;
    uint256 internal constant USER_EPOCH_VOLUME_MASK = type(uint256).max >> 2;

    uint256 private _epochClockData;
    address public feeRecipient;

    uint256 public pendingEpochDuration;
    uint256 public pendingEpochDurationEta;
    uint256 public pendingEpochDurationEffectiveFromEpoch;
    address public pendingFeeRecipient;
    uint256 public pendingFeeRecipientEta;

    uint256 public rolloverPool;
    uint256 public dailyJackpotPool;
    uint256 public weeklyJackpotPool;
    // Each award word stores its period index in the low 128 bits and epoch in
    // the next 96 bits. Both values already share the epoch-clock bounds.
    uint256 private _lastDailyJackpotData;
    uint256 private _lastWeeklyJackpotData;
    uint256 public lastDailyJackpotAmount;
    uint256 public lastWeeklyJackpotAmount;
    // Daily check timestamp in the low 128 bits, weekly in the high 128 bits.
    uint256 private _jackpotCheckTimestamps;

    struct Epoch {
        uint256 totalPool;
        uint256 rewardPool;
        uint256 resolutionData;
    }
    mapping(uint256 => Epoch) private _epochs;
    mapping(uint256 => mapping(uint256 => uint256)) public tilePools;
    mapping(uint256 => mapping(uint256 => mapping(address => uint256))) public userBets;
    mapping(uint256 => uint256) public epochRewardClaimed;

    uint256 public accruedOwnerFees;
    uint256 public accruedBurnFees;
    mapping(address => uint256) public pendingResolverRewards;
    mapping(uint256 => uint256) public epochRebatePool;
    mapping(uint256 => uint256) public epochRebateClaimed;
    // Low 254 bits hold volume; the top two bits close reward and rebate claims.
    mapping(uint256 => mapping(address => uint256)) private _userEpochRebateData;

    event BetPlaced(uint256 indexed epoch, address indexed user, uint256 indexed tileId, uint256 amount);
    event BatchBetsPlaced(uint256 indexed epoch, address indexed user, uint256[] tileIds, uint256[] amounts, uint256 totalAmount);
    event BatchBetsSameAmountPlaced(uint256 indexed epoch, address indexed user, uint256[] tileIds, uint256 amount, uint256 totalAmount);
    event BatchBetsBitmapPlaced(uint256 indexed epoch, address indexed user, uint32 tileMask, uint256 amount, uint256 totalAmount);
    event EpochResolved(uint256 indexed epoch, uint256 winningTile, uint256 totalPool, uint256 fee, uint256 rewardPool, uint256 jackpotBonus);
    event DailyJackpotAwarded(uint256 indexed epoch, uint256 amount);
    event WeeklyJackpotAwarded(uint256 indexed epoch, uint256 amount);
    event RewardClaimed(uint256 indexed epoch, address indexed user, uint256 reward);
    event RewardBatchClaimed(address indexed user, uint256 totalAmount, uint256 epochsClaimed);
    event RewardDustSettled(uint256 indexed epoch, uint256 amount);
    event RewardDustBatchSettled(uint256 amount, uint256 epochsSettled);
    event ResolverRewardAccrued(address indexed resolver, uint256 indexed epoch, uint256 amount);
    event ResolverRewardClaimed(address indexed resolver, uint256 amount);
    event ProtocolFeesFlushed(uint256 ownerAmount, uint256 burnAmount);
    event RebateClaimed(address indexed user, uint256 indexed epoch, uint256 amount);
    event RebateBatchClaimed(address indexed user, uint256 amount, uint256 epochsClaimed);
    event RebateDustSettled(uint256 indexed epoch, uint256 amount);
    event RebateDustBatchSettled(uint256 amount, uint256 epochsSettled);
    event EpochDurationChangeScheduled(uint256 oldValue, uint256 newValue, uint256 eta, uint256 effectiveFromEpoch);
    event EpochDurationChangeCancelled(uint256 pendingValue);
    event EpochDurationUpdated(uint256 oldValue, uint256 newValue);
    event FeeRecipientChangeScheduled(address indexed oldRecipient, address indexed newRecipient, uint256 eta);
    event FeeRecipientChangeCancelled(address indexed pendingRecipient);
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);

    error EpochEnded();
    error EpochClosing();
    error TimerNotEnded();
    error AlreadyResolved();
    error CanOnlyResolveCurrent();
    error InvalidTile();
    error InvalidTileMask();
    error ZeroAmount();
    error ArraysMismatch();
    error EmptyArray();
    error NoWinningBet();
    error AlreadyClaimed();
    error NotResolved();
    error InvalidEpochDuration();
    error InvalidFeeRecipient();
    error NoPendingEpochDurationChange();
    error NoPendingFeeRecipientChange();
    error NothingToFlush();
    error NothingToClaim();
    error InvalidTokenAddress();
    error InvalidInitialOwner();
    error OwnershipRenounceDisabled();
    error RebateAlreadyClaimed();
    error NoRebateAvailable();
    error DustAlreadySettled();
    error DustSettlementDelayNotReached();
    error RewardClaimWindowExpired();
    error EpochClockOverflow();
    error ResolutionDataOverflow();
    error UserEpochVolumeOverflow();
    error UnexpectedEpoch();

    constructor(address tokenAddress, address initialOwner, address initialFeeRecipient)
        Ownable(_validatedInitialOwner(initialOwner))
    {
        if (tokenAddress == address(0) || tokenAddress.code.length == 0) revert InvalidTokenAddress();
        if (initialOwner == address(this)) revert InvalidInitialOwner();
        if (initialFeeRecipient == address(0) || initialFeeRecipient == address(this)) {
            revert InvalidFeeRecipient();
        }
        token = IERC20(tokenAddress);
        feeRecipient = initialFeeRecipient;
        _storeEpochClock(60, 1, block.timestamp);
    }

    function _validatedInitialOwner(address initialOwner) private pure returns (address) {
        if (initialOwner == address(0)) revert InvalidInitialOwner();
        return initialOwner;
    }

    struct EpochClock {
        uint256 duration;
        uint256 epoch;
        uint256 startTime;
    }

    function _loadEpochClock() internal view returns (EpochClock memory clock) {
        uint256 data = _epochClockData;
        clock.duration = uint32(data);
        clock.epoch = uint96(data >> CURRENT_EPOCH_SHIFT);
        clock.startTime = data >> EPOCH_START_TIME_SHIFT;
    }

    function _storeEpochClock(uint256 duration, uint256 epoch, uint256 startTime) internal {
        if (duration > type(uint32).max || epoch > type(uint96).max || startTime > type(uint128).max) {
            revert EpochClockOverflow();
        }
        _epochClockData = duration | (epoch << CURRENT_EPOCH_SHIFT) | (startTime << EPOCH_START_TIME_SHIFT);
    }

    function epochDuration() public view returns (uint256) {
        return uint32(_epochClockData);
    }

    function currentEpoch() public view returns (uint256) {
        return uint96(_epochClockData >> CURRENT_EPOCH_SHIFT);
    }

    function epochStartTime() public view returns (uint256) {
        return _epochClockData >> EPOCH_START_TIME_SHIFT;
    }

    function _isResolved(Epoch storage ep) internal view returns (bool) {
        return ep.resolutionData != 0;
    }

    function _resolvedAt(Epoch storage ep) internal view returns (uint256) {
        return uint128(ep.resolutionData);
    }

    function _winningTile(Epoch storage ep) internal view returns (uint256) {
        return uint8(ep.resolutionData >> RESOLUTION_WINNING_TILE_SHIFT);
    }

    function _hasResolutionFlag(Epoch storage ep, uint256 flag) internal view returns (bool) {
        return (ep.resolutionData & flag) != 0;
    }

    function _packResolutionData(uint256 resolvedAt_, uint256 winningTile_, uint256 flags) internal pure returns (uint256) {
        if (resolvedAt_ > type(uint128).max || winningTile_ > type(uint8).max) revert ResolutionDataOverflow();
        return resolvedAt_ | (winningTile_ << RESOLUTION_WINNING_TILE_SHIFT) | flags;
    }

    function epochs(uint256 epoch)
        public
        view
        returns (
            uint256 totalPool,
            uint256 rewardPool,
            uint256 winningTile,
            bool isResolved,
            bool isDailyJackpot,
            bool isWeeklyJackpot
        )
    {
        Epoch storage ep = _epochs[epoch];
        uint256 resolutionData = ep.resolutionData;
        return (
            ep.totalPool,
            ep.rewardPool,
            uint8(resolutionData >> RESOLUTION_WINNING_TILE_SHIFT),
            resolutionData != 0,
            (resolutionData & DAILY_JACKPOT_FLAG) != 0,
            (resolutionData & WEEKLY_JACKPOT_FLAG) != 0
        );
    }

    function epochResolvedAt(uint256 epoch) public view returns (uint256) {
        return _resolvedAt(_epochs[epoch]);
    }

    function epochDustSettled(uint256 epoch) public view returns (bool) {
        return _hasResolutionFlag(_epochs[epoch], REWARD_DUST_SETTLED_FLAG);
    }

    function lastDailyJackpotCheckTs() public view returns (uint256) {
        return uint128(_jackpotCheckTimestamps);
    }

    function lastWeeklyJackpotCheckTs() public view returns (uint256) {
        return _jackpotCheckTimestamps >> WEEKLY_JACKPOT_CHECK_SHIFT;
    }

    function lastDailyJackpotDay() public view returns (uint256) {
        return uint128(_lastDailyJackpotData);
    }

    function lastWeeklyJackpotWeek() public view returns (uint256) {
        return uint128(_lastWeeklyJackpotData);
    }

    function lastDailyJackpotEpoch() public view returns (uint256) {
        return uint96(_lastDailyJackpotData >> JACKPOT_AWARD_EPOCH_SHIFT);
    }

    function lastWeeklyJackpotEpoch() public view returns (uint256) {
        return uint96(_lastWeeklyJackpotData >> JACKPOT_AWARD_EPOCH_SHIFT);
    }

    /// @dev Compatibility getter. Exact counts are reconstructed from canonical bet events.
    function tileUserCounts(uint256, uint256) public pure returns (uint256) {
        return 0;
    }

    /// @dev Compatibility getter backed by packed per-user epoch accounting.
    function hasClaimed(address user, uint256 epoch) public view returns (bool) {
        return (_userEpochRebateData[epoch][user] & REWARD_CLAIMED_FLAG) != 0;
    }

    /// @dev Compatibility getter backed by packed per-user rebate accounting.
    function userEpochVolumes(uint256 epoch, address user) public view returns (uint256) {
        return _userEpochRebateData[epoch][user] & USER_EPOCH_VOLUME_MASK;
    }

    function rebateClaimed(uint256 epoch, address user) public view returns (bool) {
        return (_userEpochRebateData[epoch][user] & REBATE_CLAIMED_FLAG) != 0;
    }

    /// @notice Withdraws all resolver rewards accrued by the caller.
    /// @dev Clears the pending liability before transferring tokens and reverts when nothing is pending.
    function claimResolverRewards() external nonReentrant {
        uint256 amount = pendingResolverRewards[msg.sender];
        if (amount == 0) revert NothingToClaim();
        pendingResolverRewards[msg.sender] = 0;
        token.safeTransfer(msg.sender, amount);
        emit ResolverRewardClaimed(msg.sender, amount);
    }

    /// @notice Permissionlessly delivers accrued owner and burn fees.
    /// @dev Applies a matured fee-recipient change first. The two transfers and accounting updates are atomic.
    function flushProtocolFees() external nonReentrant {
        if (accruedOwnerFees == 0 && accruedBurnFees == 0) revert NothingToFlush();
        _applyPendingFeeRecipientIfReady();
        _flushProtocolFees();
    }

    /// @notice Claims the caller's Safety Pool rebate for one resolved losing epoch.
    /// @dev Claims close at the dust-settlement deadline and each account may claim once per epoch.
    /// @param epoch Resolved epoch whose rebate should be claimed.
    function claimEpochRebate(uint256 epoch) external nonReentrant {
        uint256 resolutionData = _epochs[epoch].resolutionData;
        if (resolutionData == 0) revert NotResolved();
        uint256 userData = _userEpochRebateData[epoch][msg.sender];
        if ((userData & REBATE_CLAIMED_FLAG) != 0) revert RebateAlreadyClaimed();
        uint256 amount = _consumeRebate(epoch, msg.sender, userData, resolutionData);
        if (amount == 0) revert NoRebateAvailable();
        token.safeTransfer(msg.sender, amount);
        emit RebateClaimed(msg.sender, epoch, amount);
    }

    /// @notice Claims every currently eligible Safety Pool rebate in a supplied epoch list.
    /// @dev Skips unresolved, winning, expired, duplicate, and already claimed entries; reverts if none are payable.
    /// @param claimEpochs Epochs to inspect and aggregate into one token transfer.
    function claimEpochsRebate(uint256[] calldata claimEpochs) external nonReentrant {
        uint256 len = claimEpochs.length;
        if (len == 0) revert EmptyArray();
        uint256 totalAmount;
        uint256 epochsClaimedCount;
        for (uint256 i = 0; i < len; ) {
            uint256 epoch = claimEpochs[i];
            uint256 resolutionData = _epochs[epoch].resolutionData;
            uint256 userData = _userEpochRebateData[epoch][msg.sender];
            if (resolutionData != 0 && (userData & REBATE_CLAIMED_FLAG) == 0) {
                uint256 amount = _consumeRebate(epoch, msg.sender, userData, resolutionData);
                if (amount > 0) {
                    totalAmount += amount;
                    epochsClaimedCount += 1;
                    emit RebateClaimed(msg.sender, epoch, amount);
                }
            }
            unchecked { ++i; }
        }
        if (totalAmount == 0) revert NoRebateAvailable();
        token.safeTransfer(msg.sender, totalAmount);
        emit RebateBatchClaimed(msg.sender, totalAmount, epochsClaimedCount);
    }

    function _consumeRebate(uint256 epoch, address user, uint256 userData, uint256 resolutionData)
        internal
        returns (uint256 amount)
    {
        amount = _previewRebateFromData(epoch, user, userData, resolutionData);
        if (amount == 0) return 0;
        _userEpochRebateData[epoch][user] = userData | REBATE_CLAIMED_FLAG;
        epochRebateClaimed[epoch] += amount;
    }

    /// @notice Closes one expired reward-claim window and sends unclaimed reward dust to the fee recipient.
    /// @dev Permissionless after DUST_SETTLE_DELAY. A zero remainder still closes the epoch exactly once.
    /// @param epoch Resolved epoch whose reward liability should be finalized.
    function settleEpochDust(uint256 epoch) external nonReentrant {
        Epoch storage ep = _epochs[epoch];
        if (!_isResolved(ep)) revert NotResolved();
        if (_hasResolutionFlag(ep, REWARD_DUST_SETTLED_FLAG)) revert DustAlreadySettled();
        uint256 resolvedAt = _resolvedAt(ep);
        if (!(resolvedAt > 0 && block.timestamp >= resolvedAt + DUST_SETTLE_DELAY)) {
            revert DustSettlementDelayNotReached();
        }
        (uint256 dust, ) = _settleRewardDustIfAvailable(epoch);
        if (dust > 0) {
            _applyPendingFeeRecipientIfReady();
            token.safeTransfer(feeRecipient, dust);
        }
    }

    /// @notice Finalizes every eligible expired reward liability in a supplied epoch list.
    /// @dev Skips ineligible and duplicate entries, aggregates positive dust, and requires one newly closed epoch.
    /// @param rewardEpochs Epochs to inspect and settle atomically.
    function settleEpochsDust(uint256[] calldata rewardEpochs) external nonReentrant {
        uint256 len = rewardEpochs.length;
        if (len == 0) revert EmptyArray();
        uint256 totalDust;
        uint256 epochsSettled;
        for (uint256 i = 0; i < len; ) {
            (uint256 dust, bool settled) = _settleRewardDustIfAvailable(rewardEpochs[i]);
            if (settled) {
                totalDust += dust;
                epochsSettled += 1;
            }
            unchecked { ++i; }
        }
        if (epochsSettled == 0) revert NothingToClaim();
        if (totalDust > 0) {
            _applyPendingFeeRecipientIfReady();
            token.safeTransfer(feeRecipient, totalDust);
        }
        emit RewardDustBatchSettled(totalDust, epochsSettled);
    }

    function _settleRewardDustIfAvailable(uint256 epoch) internal returns (uint256 dust, bool settled) {
        Epoch storage ep = _epochs[epoch];
        uint256 resolutionData = ep.resolutionData;
        if (resolutionData == 0 || (resolutionData & REWARD_DUST_SETTLED_FLAG) != 0) return (0, false);
        uint256 resolvedAt = uint128(resolutionData);
        if (resolvedAt == 0 || block.timestamp < resolvedAt + DUST_SETTLE_DELAY) return (0, false);
        ep.resolutionData = resolutionData | REWARD_DUST_SETTLED_FLAG;
        uint256 rewardPool = ep.rewardPool;
        uint256 claimed = epochRewardClaimed[epoch];
        dust = rewardPool > claimed ? rewardPool - claimed : 0;
        emit RewardDustSettled(epoch, dust);
        return (dust, true);
    }

    /// @notice Sends one epoch's unclaimed expired Safety Pool rebate balance to the fee recipient.
    /// @dev Permissionless after DUST_SETTLE_DELAY and reverts when no positive rebate remainder exists.
    /// @param epoch Resolved epoch whose rebate liability should be finalized.
    function settleEpochRebateDust(uint256 epoch) external nonReentrant {
        Epoch storage ep = _epochs[epoch];
        if (!_isResolved(ep)) revert NotResolved();
        uint256 resolvedAt = _resolvedAt(ep);
        if (!(resolvedAt > 0 && block.timestamp >= resolvedAt + DUST_SETTLE_DELAY)) {
            revert DustSettlementDelayNotReached();
        }
        uint256 dust = _settleRebateDustIfAvailable(epoch);
        if (dust == 0) revert NothingToClaim();
        _applyPendingFeeRecipientIfReady();
        token.safeTransfer(feeRecipient, dust);
    }

    /// @notice Finalizes and aggregates positive expired Safety Pool remainders from multiple epochs.
    /// @dev Skips ineligible, duplicate, and already exhausted entries; reverts when total dust is zero.
    /// @param rebateEpochs Epochs to inspect and settle atomically.
    function settleEpochsRebateDust(uint256[] calldata rebateEpochs) external nonReentrant {
        uint256 len = rebateEpochs.length;
        if (len == 0) revert EmptyArray();
        uint256 totalDust;
        uint256 epochsSettled;
        for (uint256 i = 0; i < len; ) {
            uint256 dust = _settleRebateDustIfAvailable(rebateEpochs[i]);
            if (dust > 0) {
                totalDust += dust;
                epochsSettled += 1;
            }
            unchecked { ++i; }
        }
        if (totalDust == 0) revert NothingToClaim();
        _applyPendingFeeRecipientIfReady();
        token.safeTransfer(feeRecipient, totalDust);
        emit RebateDustBatchSettled(totalDust, epochsSettled);
    }

    function _settleRebateDustIfAvailable(uint256 epoch) internal returns (uint256 dust) {
        Epoch storage ep = _epochs[epoch];
        uint256 resolutionData = ep.resolutionData;
        if (resolutionData == 0) return 0;
        uint256 resolvedAt = uint128(resolutionData);
        if (resolvedAt == 0 || block.timestamp < resolvedAt + DUST_SETTLE_DELAY) return 0;
        uint256 rebatePool = epochRebatePool[epoch];
        uint256 claimed = epochRebateClaimed[epoch];
        if (claimed >= rebatePool) return 0;
        dust = rebatePool - claimed;
        epochRebateClaimed[epoch] = rebatePool;
        emit RebateDustSettled(epoch, dust);
    }

    function _prepareBetEpoch() internal returns (uint256 epoch) {
        EpochClock memory clock = _loadEpochClock();
        uint256 endTime = clock.startTime + clock.duration;
        if (block.timestamp >= endTime) {
            _resolveCurrentEpoch(clock);
            clock = _loadEpochClock();
            endTime = clock.startTime + clock.duration;
        }
        if (block.timestamp + LAST_BET_GRACE_SECONDS >= endTime) revert EpochClosing();
        return clock.epoch;
    }

    function _prepareObservedBetEpoch(uint256 expectedEpoch) internal returns (uint256 epoch) {
        EpochClock memory clock = _loadEpochClock();
        if (expectedEpoch != clock.epoch) revert UnexpectedEpoch();
        uint256 endTime = clock.startTime + clock.duration;
        if (block.timestamp >= endTime) {
            // Empty epochs carry no player outcome. Advance exactly one on demand so
            // the first returning player pays no separate keeper transaction.
            if (_epochs[clock.epoch].totalPool != 0) revert EpochClosing();
            _resolveCurrentEpoch(clock);
            return clock.epoch + 1;
        }
        if (block.timestamp + LAST_BET_GRACE_SECONDS >= endTime) revert EpochClosing();
        return clock.epoch;
    }

    // Legacy V9-compatible entrypoints preserve automatic expiry resolution.
    // New integrations should bind intent with placeBatchBetsBitmapForEpoch.
    /// @notice Places one legacy bet on the current epoch.
    /// @dev May atomically resolve an expired epoch and is not protected against stale epoch intent.
    /// @param tileId Grid tile in the inclusive range 1..GRID_SIZE.
    /// @param amount Token amount staked on the tile.
    function placeBet(uint256 tileId, uint256 amount) external nonReentrant {
        if (tileId == 0 || tileId > GRID_SIZE) revert InvalidTile();
        if (amount == 0) revert ZeroAmount();
        uint256 epoch = _prepareBetEpoch();
        token.safeTransferFrom(msg.sender, address(this), amount);
        _recordEpochVolume(epoch, msg.sender, amount);
        _recordBet(epoch, msg.sender, tileId, amount);
        emit BetPlaced(epoch, msg.sender, tileId, amount);
    }

    /// @notice Places legacy bets with independently specified amounts in one transfer.
    /// @dev May atomically resolve an expired epoch and is not protected against stale epoch intent.
    /// @param tileIds Grid tiles in the inclusive range 1..GRID_SIZE.
    /// @param amounts Token amounts paired one-to-one with tileIds.
    function placeBatchBets(uint256[] calldata tileIds, uint256[] calldata amounts) external nonReentrant {
        if (tileIds.length != amounts.length) revert ArraysMismatch();
        if (tileIds.length == 0) revert EmptyArray();
        uint256 totalAmount;
        uint256 len = amounts.length;
        for (uint256 i = 0; i < len; ) {
            if (amounts[i] == 0) revert ZeroAmount();
            if (tileIds[i] == 0 || tileIds[i] > GRID_SIZE) revert InvalidTile();
            totalAmount += amounts[i];
            unchecked { ++i; }
        }
        uint256 epoch = _prepareBetEpoch();
        token.safeTransferFrom(msg.sender, address(this), totalAmount);
        _recordEpochVolume(epoch, msg.sender, totalAmount);
        for (uint256 i = 0; i < len; ) {
            _recordBet(epoch, msg.sender, tileIds[i], amounts[i]);
            unchecked { ++i; }
        }
        emit BatchBetsPlaced(epoch, msg.sender, tileIds, amounts, totalAmount);
    }

    /// @notice Places the same legacy stake amount on each supplied tile in one transfer.
    /// @dev May atomically resolve an expired epoch and is not protected against stale epoch intent.
    /// @param tileIds Grid tiles in the inclusive range 1..GRID_SIZE.
    /// @param amount Token amount staked on every supplied tile.
    function placeBatchBetsSameAmount(uint256[] calldata tileIds, uint256 amount) external nonReentrant {
        uint256 len = tileIds.length;
        if (len == 0) revert EmptyArray();
        if (amount == 0) revert ZeroAmount();
        for (uint256 i = 0; i < len; ) {
            uint256 tileId = tileIds[i];
            if (tileId == 0 || tileId > GRID_SIZE) revert InvalidTile();
            unchecked { ++i; }
        }
        uint256 totalAmount = amount * len;
        uint256 epoch = _prepareBetEpoch();
        token.safeTransferFrom(msg.sender, address(this), totalAmount);
        _recordEpochVolume(epoch, msg.sender, totalAmount);
        for (uint256 i = 0; i < len; ) {
            _recordBet(epoch, msg.sender, tileIds[i], amount);
            unchecked { ++i; }
        }
        emit BatchBetsSameAmountPlaced(epoch, msg.sender, tileIds, amount, totalAmount);
    }

    /// @notice Places the same legacy stake amount on every tile selected by a bitmap.
    /// @dev Uses bits 0..24 for tiles 1..25, may resolve expiry, and is not protected against stale epoch intent.
    /// @param tileMask Non-zero bitmap containing no bits outside the 25-tile grid.
    /// @param amount Token amount staked on each selected tile.
    function placeBatchBetsBitmap(uint32 tileMask, uint256 amount) external nonReentrant {
        if (tileMask == 0) revert EmptyArray();
        if ((tileMask & ~MAX_TILE_MASK) != 0) revert InvalidTileMask();
        if (amount == 0) revert ZeroAmount();

        uint256 tileCount = _countSelectedTiles(tileMask);
        uint256 totalAmount = amount * tileCount;
        uint256 epoch = _prepareBetEpoch();
        token.safeTransferFrom(msg.sender, address(this), totalAmount);
        _recordEpochVolume(epoch, msg.sender, totalAmount);

        uint32 remainingMask = tileMask;
        uint256 tileId = 1;
        while (remainingMask != 0) {
            if ((remainingMask & 1) == 1) {
                _recordBet(epoch, msg.sender, tileId, amount);
            }
            remainingMask >>= 1;
            unchecked { ++tileId; }
        }

        emit BatchBetsBitmapPlaced(epoch, msg.sender, tileMask, amount, totalAmount);
    }

    /// @notice Places a bitmap bet against the epoch state the caller explicitly observed.
    /// @dev An active observed epoch receives the bet directly. An expired observed epoch
    ///      advances exactly once only when it has no bets, then receives the bet in the
    ///      next epoch. Funded, closing and stale epochs fail before the stake transfer.
    ///      The recording loop stays inline in both bitmap entrypoints because sharing it
    ///      adds 44-45 runtime gas per bet with the pinned optimizer configuration.
    /// @param expectedEpoch Epoch observed by the caller before signing.
    /// @param tileMask Non-zero bitmap containing no bits outside the 25-tile grid.
    /// @param amount Token amount staked on each selected tile.
    function placeBatchBetsBitmapForEpoch(uint256 expectedEpoch, uint32 tileMask, uint256 amount)
        external
        nonReentrant
    {
        if (tileMask == 0) revert EmptyArray();
        if ((tileMask & ~MAX_TILE_MASK) != 0) revert InvalidTileMask();
        if (amount == 0) revert ZeroAmount();

        uint256 epoch = _prepareObservedBetEpoch(expectedEpoch);
        uint256 tileCount = _countSelectedTiles(tileMask);
        uint256 totalAmount = amount * tileCount;
        token.safeTransferFrom(msg.sender, address(this), totalAmount);
        _recordEpochVolume(epoch, msg.sender, totalAmount);

        uint32 remainingMask = tileMask;
        uint256 tileId = 1;
        while (remainingMask != 0) {
            if ((remainingMask & 1) == 1) {
                _recordBet(epoch, msg.sender, tileId, amount);
            }
            remainingMask >>= 1;
            unchecked { ++tileId; }
        }

        emit BatchBetsBitmapPlaced(epoch, msg.sender, tileMask, amount, totalAmount);
    }

    function _countSelectedTiles(uint32 tileMask) internal pure returns (uint256 count) {
        uint32 value = tileMask;
        value = value - ((value >> 1) & 0x55555555);
        value = (value & 0x33333333) + ((value >> 2) & 0x33333333);
        value = (value + (value >> 4)) & 0x0F0F0F0F;
        value += value >> 8;
        value += value >> 16;
        return uint256(value & 0x3F);
    }

    function _recordBet(uint256 epoch, address user, uint256 tileId, uint256 amount) internal {
        uint256 previousBet = userBets[epoch][tileId][user];
        userBets[epoch][tileId][user] = previousBet + amount;
        tilePools[epoch][tileId] += amount;
    }

    function _recordEpochVolume(uint256 epoch, address user, uint256 totalAmount) internal {
        uint256 data = _userEpochRebateData[epoch][user];
        uint256 volume = data & USER_EPOCH_VOLUME_MASK;
        if (totalAmount > USER_EPOCH_VOLUME_MASK - volume) revert UserEpochVolumeOverflow();
        _userEpochRebateData[epoch][user] =
            (data & (REBATE_CLAIMED_FLAG | REWARD_CLAIMED_FLAG)) | (volume + totalAmount);
        _epochs[epoch].totalPool += totalAmount;
    }

    /// @notice Resolves the current funded epoch after its timer expires.
    /// @dev Accrues resolver/fee liabilities but performs no fee transfer; only the current epoch is resolvable.
    /// @param epoch Current epoch expected by the caller.
    function resolveEpoch(uint256 epoch) external nonReentrant {
        EpochClock memory clock = _loadEpochClock();
        if (epoch != clock.epoch) revert CanOnlyResolveCurrent();
        if (block.timestamp < clock.startTime + clock.duration) revert TimerNotEnded();
        _resolveCurrentEpoch(clock);
    }

    struct ResolveLocals {
        uint256 epoch;
        uint256 totalPoolWithRollover;
        uint256 winningTile;
        uint256 baseReward;
        uint256 protocolFee;
        uint256 burnAmount;
        uint256 jackpotBonus;
    }

    function _resolveCurrentEpoch(EpochClock memory clock) internal {
        ResolveLocals memory L;
        L.epoch = clock.epoch;
        Epoch storage ep = _epochs[L.epoch];
        if (_isResolved(ep)) revert AlreadyResolved();
        uint256 freshPool = ep.totalPool;
        L.totalPoolWithRollover = freshPool + rolloverPool;
        uint256 dailyPool = dailyJackpotPool;
        uint256 weeklyPool = weeklyJackpotPool;
        rolloverPool = 0;
        L.winningTile = (
            uint256(
                keccak256(
                    abi.encodePacked(
                        block.prevrandao,
                        blockhash(block.number - 1),
                        L.epoch,
                        L.totalPoolWithRollover,
                        dailyPool,
                        weeklyPool
                    )
                )
            ) % GRID_SIZE
        ) + 1;
        _splitFees(L, freshPool, dailyPool, weeklyPool);
        bool hasWinner = tilePools[L.epoch][L.winningTile] > 0;
        uint256 jackpotFlags;
        if (hasWinner) {
            (L.jackpotBonus, jackpotFlags) = _tryAwardJackpots(L.epoch);
            ep.rewardPool = L.baseReward + L.jackpotBonus;
        } else {
            rolloverPool = L.baseReward;
            ep.rewardPool = 0;
        }
        ep.resolutionData = _packResolutionData(block.timestamp, L.winningTile, jackpotFlags);
        emit EpochResolved(L.epoch, L.winningTile, L.totalPoolWithRollover, L.protocolFee + L.burnAmount, ep.rewardPool, L.jackpotBonus);
        _storeEpochClock(clock.duration, L.epoch + 1, block.timestamp);
        _applyPendingEpochDurationIfReady();
        _applyPendingFeeRecipientIfReady();
    }

    function _splitFees(ResolveLocals memory L, uint256 freshPool, uint256 dailyPool, uint256 weeklyPool) internal {
        uint256 pool = L.totalPoolWithRollover;
        if (freshPool == 0) {
            L.baseReward = pool;
            return;
        }
        uint256 dailyAccrual = Math.mulDiv(freshPool, DAILY_JACKPOT_PERCENT, 100);
        uint256 weeklyAccrual = Math.mulDiv(freshPool, WEEKLY_JACKPOT_PERCENT, 100);
        L.protocolFee = Math.mulDiv(freshPool, PROTOCOL_FEE_PERCENT, 100);
        L.burnAmount = Math.mulDiv(freshPool, BURN_FEE_PERCENT, 100);
        uint256 resolverReward = Math.mulDiv(freshPool, RESOLVER_REWARD_BPS, BPS_DENOMINATOR);
        if (resolverReward > L.protocolFee) resolverReward = L.protocolFee;
        L.baseReward = pool - dailyAccrual - weeklyAccrual - L.protocolFee - L.burnAmount;
        dailyJackpotPool = dailyPool + dailyAccrual;
        weeklyJackpotPool = weeklyPool + weeklyAccrual;
        _accrueProtocolFee(L.protocolFee - resolverReward, L.epoch);
        if (L.burnAmount > 0) accruedBurnFees += L.burnAmount;
        if (resolverReward > 0) {
            pendingResolverRewards[msg.sender] += resolverReward;
            emit ResolverRewardAccrued(msg.sender, L.epoch, resolverReward);
        }
    }

    function _mondayWeek(uint256 ts) internal pure returns (uint256) {
        return (ts + MONDAY_OFFSET) / 1 weeks;
    }

    function _dayStart(uint256 ts) internal pure returns (uint256) {
        return (ts / 1 days) * 1 days;
    }

    function _weekStartMonday(uint256 ts) internal pure returns (uint256) {
        uint256 weekIdx = _mondayWeek(ts);
        if (weekIdx == 0) return 0;
        return weekIdx * 1 weeks - MONDAY_OFFSET;
    }

    function _tryAwardJackpots(uint256 epoch) internal returns (uint256 bonus, uint256 flags) {
        uint256 today = block.timestamp / 1 days;
        uint256 thisWeek = _mondayWeek(block.timestamp);
        if (
            (uint128(_lastDailyJackpotData) == today || dailyJackpotPool == 0) &&
            (uint128(_lastWeeklyJackpotData) == thisWeek || weeklyJackpotPool == 0)
        ) return (0, 0);

        uint256 previousCheckTimestamps = _jackpotCheckTimestamps;
        uint256 dailyCheckTs = uint128(previousCheckTimestamps);
        uint256 weeklyCheckTs = previousCheckTimestamps >> WEEKLY_JACKPOT_CHECK_SHIFT;
        if (uint128(_lastDailyJackpotData) != today && dailyJackpotPool > 0) {
            uint256 start = _dayStart(block.timestamp);
            uint256 end = start + 1 days;
            uint256 lastCheck = dailyCheckTs;
            if (lastCheck < start) lastCheck = start;
            if (lastCheck > block.timestamp) lastCheck = block.timestamp;
            uint256 elapsed = block.timestamp - lastCheck;
            uint256 remaining = end > lastCheck ? (end - lastCheck) : 1;
            uint256 dRand = uint256(keccak256(abi.encodePacked(block.prevrandao, "daily", epoch, lastCheck, block.timestamp))) % remaining;
            if (dRand < elapsed) {
                uint256 amt = dailyJackpotPool;
                dailyJackpotPool = 0;
                bonus += amt;
                _lastDailyJackpotData = today | (epoch << JACKPOT_AWARD_EPOCH_SHIFT);
                lastDailyJackpotAmount = amt;
                dailyCheckTs = block.timestamp;
                flags |= DAILY_JACKPOT_FLAG;
                emit DailyJackpotAwarded(epoch, amt);
            } else {
                dailyCheckTs = block.timestamp;
            }
        }
        if (uint128(_lastWeeklyJackpotData) != thisWeek && weeklyJackpotPool > 0) {
            uint256 start = _weekStartMonday(block.timestamp);
            uint256 end = start + 1 weeks;
            uint256 lastCheck = weeklyCheckTs;
            if (lastCheck < start) lastCheck = start;
            if (lastCheck > block.timestamp) lastCheck = block.timestamp;
            uint256 elapsed = block.timestamp - lastCheck;
            uint256 remaining = end > lastCheck ? (end - lastCheck) : 1;
            uint256 wRand = uint256(keccak256(abi.encodePacked(block.prevrandao, "weekly", epoch, lastCheck, block.timestamp))) % remaining;
            if (wRand < elapsed) {
                uint256 amt = weeklyJackpotPool;
                weeklyJackpotPool = 0;
                bonus += amt;
                _lastWeeklyJackpotData = thisWeek | (epoch << JACKPOT_AWARD_EPOCH_SHIFT);
                lastWeeklyJackpotAmount = amt;
                weeklyCheckTs = block.timestamp;
                flags |= WEEKLY_JACKPOT_FLAG;
                emit WeeklyJackpotAwarded(epoch, amt);
            } else {
                weeklyCheckTs = block.timestamp;
            }
        }
        uint256 nextCheckTimestamps = dailyCheckTs | (weeklyCheckTs << WEEKLY_JACKPOT_CHECK_SHIFT);
        if (nextCheckTimestamps != previousCheckTimestamps) {
            _jackpotCheckTimestamps = nextCheckTimestamps;
        }
    }

    function _accrueProtocolFee(uint256 protocolFee, uint256 epoch) internal {
        if (protocolFee == 0) return;
        uint256 rebateShare = protocolFee / 2;
        uint256 ownerShare = protocolFee - rebateShare;
        if (rebateShare > 0) {
            epochRebatePool[epoch] = rebateShare;
        }
        if (ownerShare > 0) {
            accruedOwnerFees += ownerShare;
        }
    }

    /// @notice Claims the caller's proportional winning reward for one epoch.
    /// @dev The winning account may claim once before the dust-settlement deadline.
    /// @param epoch Resolved winning epoch whose reward should be claimed.
    function claimReward(uint256 epoch) external nonReentrant {
        Epoch storage ep = _epochs[epoch];
        uint256 resolutionData = ep.resolutionData;
        if (resolutionData == 0) revert NotResolved();
        uint256 resolvedAt = uint128(resolutionData);
        if (resolvedAt > 0 && block.timestamp >= resolvedAt + DUST_SETTLE_DELAY) revert RewardClaimWindowExpired();
        if ((resolutionData & REWARD_DUST_SETTLED_FLAG) != 0) revert RewardClaimWindowExpired();
        uint256 userData = _userEpochRebateData[epoch][msg.sender];
        if ((userData & REWARD_CLAIMED_FLAG) != 0) revert AlreadyClaimed();
        uint256 winTile = uint8(resolutionData >> RESOLUTION_WINNING_TILE_SHIFT);
        uint256 userBet = userBets[epoch][winTile][msg.sender];
        if (userBet == 0) revert NoWinningBet();
        uint256 tileTotal = tilePools[epoch][winTile];
        uint256 reward = Math.mulDiv(ep.rewardPool, userBet, tileTotal);
        if (reward == 0) revert NothingToClaim();
        _userEpochRebateData[epoch][msg.sender] = userData | REWARD_CLAIMED_FLAG;
        epochRewardClaimed[epoch] += reward;
        token.safeTransfer(msg.sender, reward);
        emit RewardClaimed(epoch, msg.sender, reward);
    }

    /// @notice Claims every currently eligible winning reward in a supplied epoch list.
    /// @dev Skips unresolved, losing, expired, duplicate, and already claimed entries; reverts if none are payable.
    /// @param claimEpochs Epochs to inspect and aggregate into one token transfer.
    function claimRewards(uint256[] calldata claimEpochs) external nonReentrant {
        uint256 len = claimEpochs.length;
        if (len == 0) revert EmptyArray();
        uint256 totalReward;
        uint256 epochsClaimedCount;
        for (uint256 i = 0; i < len; ) {
            uint256 epoch = claimEpochs[i];
            Epoch storage ep = _epochs[epoch];
            uint256 resolutionData = ep.resolutionData;
            uint256 resolvedAt = uint128(resolutionData);
            if (
                resolutionData != 0 &&
                (resolutionData & REWARD_DUST_SETTLED_FLAG) == 0 &&
                !(
                    resolvedAt > 0 &&
                    block.timestamp >= resolvedAt + DUST_SETTLE_DELAY
                )
            ) {
                uint256 userData = _userEpochRebateData[epoch][msg.sender];
                uint256 winTile = uint8(resolutionData >> RESOLUTION_WINNING_TILE_SHIFT);
                uint256 userBet = userBets[epoch][winTile][msg.sender];
                if ((userData & REWARD_CLAIMED_FLAG) == 0 && userBet > 0) {
                    uint256 tileTotal = tilePools[epoch][winTile];
                    uint256 reward = Math.mulDiv(ep.rewardPool, userBet, tileTotal);
                    if (reward > 0) {
                        _userEpochRebateData[epoch][msg.sender] = userData | REWARD_CLAIMED_FLAG;
                        epochRewardClaimed[epoch] += reward;
                        totalReward += reward;
                        epochsClaimedCount += 1;
                        emit RewardClaimed(epoch, msg.sender, reward);
                    }
                }
            }
            unchecked { ++i; }
        }
        if (totalReward == 0) revert NothingToClaim();
        token.safeTransfer(msg.sender, totalReward);
        emit RewardBatchClaimed(msg.sender, totalReward, epochsClaimedCount);
    }

    function _previewRebateFromData(uint256 epoch, address user, uint256 userData, uint256 resolutionData)
        internal
        view
        returns (uint256)
    {
        if ((userData & REBATE_CLAIMED_FLAG) != 0) return 0;
        uint256 userVolume = userData & USER_EPOCH_VOLUME_MASK;
        if (userVolume == 0) return 0;
        Epoch storage ep = _epochs[epoch];
        if (resolutionData == 0) return 0;
        uint256 resolvedAt = uint128(resolutionData);
        if (resolvedAt > 0 && block.timestamp >= resolvedAt + DUST_SETTLE_DELAY) return 0;
        uint256 totalPool = ep.totalPool;
        uint256 rebatePool = epochRebatePool[epoch];
        uint256 claimedTotal = epochRebateClaimed[epoch];
        if (totalPool == 0 || rebatePool == 0 || claimedTotal >= rebatePool) return 0;
        uint256 winningTile = uint8(resolutionData >> RESOLUTION_WINNING_TILE_SHIFT);
        if (userBets[epoch][winningTile][user] > 0) return 0;
        uint256 winningPool = tilePools[epoch][winningTile];
        if (winningPool >= totalPool) return 0;
        uint256 losingVolume = totalPool - winningPool;
        uint256 amount = Math.mulDiv(rebatePool, userVolume, losingVolume);
        uint256 remaining = rebatePool - claimedTotal;
        return amount > remaining ? remaining : amount;
    }

    function getTileData(uint256 epoch) external view returns (uint256[] memory pools, uint256[] memory users) {
        pools = new uint256[](GRID_SIZE);
        // V10 reconstructs exact unique-player counts from canonical bet events.
        // Keep the zero-filled second array so existing clients retain the V9 ABI.
        users = new uint256[](GRID_SIZE);
        for (uint256 i = 0; i < GRID_SIZE; ) {
            uint256 tileId = i + 1;
            pools[i] = tilePools[epoch][tileId];
            unchecked { ++i; }
        }
    }

    function getUserBetsAll(uint256 epoch, address user) external view returns (uint256[] memory bets) {
        bets = new uint256[](GRID_SIZE);
        for (uint256 i = 0; i < GRID_SIZE; ) {
            bets[i] = userBets[epoch][i + 1][user];
            unchecked { ++i; }
        }
    }

    function getEpochEndTime(uint256 epoch) external view returns (uint256) {
        EpochClock memory clock = _loadEpochClock();
        if (epoch == clock.epoch) return clock.startTime + clock.duration;
        return 0;
    }

    function getJackpotInfo()
        external
        view
        returns (
            uint256 dailyPool,
            uint256 weeklyPool,
            uint256 lastDailyDay,
            uint256 lastWeeklyWeek,
            uint256 lastDailyEpoch_,
            uint256 lastWeeklyEpoch_,
            uint256 lastDailyAmount_,
            uint256 lastWeeklyAmount_
        )
    {
        uint256 dailyAwardData = _lastDailyJackpotData;
        uint256 weeklyAwardData = _lastWeeklyJackpotData;
        return (
            dailyJackpotPool,
            weeklyJackpotPool,
            uint128(dailyAwardData),
            uint128(weeklyAwardData),
            uint96(dailyAwardData >> JACKPOT_AWARD_EPOCH_SHIFT),
            uint96(weeklyAwardData >> JACKPOT_AWARD_EPOCH_SHIFT),
            lastDailyJackpotAmount,
            lastWeeklyJackpotAmount
        );
    }

    function previewRebate(uint256 epoch, address user) external view returns (uint256) {
        return _previewRebateFromData(
            epoch,
            user,
            _userEpochRebateData[epoch][user],
            _epochs[epoch].resolutionData
        );
    }

    function getRebateInfo(uint256 epoch, address user)
        external
        view
        returns (
            uint256 rebatePool,
            uint256 userVolume,
            uint256 pending,
            bool claimed,
            bool resolved
        )
    {
        uint256 resolutionData = _epochs[epoch].resolutionData;
        uint256 userData = _userEpochRebateData[epoch][user];
        rebatePool = epochRebatePool[epoch];
        userVolume = userData & USER_EPOCH_VOLUME_MASK;
        claimed = (userData & REBATE_CLAIMED_FLAG) != 0;
        pending = _previewRebateFromData(epoch, user, userData, resolutionData);
        resolved = resolutionData != 0;
    }

    function getRebateSummary(address user, uint256[] calldata rebateEpochList)
        external
        view
        returns (uint256 totalPending, uint256 claimableEpochs)
    {
        uint256 len = rebateEpochList.length;
        for (uint256 i = 0; i < len; ) {
            uint256 epoch = rebateEpochList[i];
            uint256 resolutionData = _epochs[epoch].resolutionData;
            uint256 userData = _userEpochRebateData[epoch][user];
            if (resolutionData != 0 && (userData & REBATE_CLAIMED_FLAG) == 0) {
                uint256 pending = _previewRebateFromData(epoch, user, userData, resolutionData);
                if (pending > 0) {
                    totalPending += pending;
                    claimableEpochs += 1;
                }
            }
            unchecked { ++i; }
        }
    }

    function _scheduleEpochDuration(uint256 newDuration) internal {
        if (newDuration < 15 || newDuration > 3600) revert InvalidEpochDuration();
        EpochClock memory clock = _loadEpochClock();
        pendingEpochDuration = newDuration;
        pendingEpochDurationEta = block.timestamp + EPOCH_DURATION_TIMELOCK;
        pendingEpochDurationEffectiveFromEpoch = clock.epoch + 1;
        emit EpochDurationChangeScheduled(
            clock.duration,
            newDuration,
            pendingEpochDurationEta,
            pendingEpochDurationEffectiveFromEpoch
        );
    }

    function _applyPendingEpochDurationIfReady() internal {
        if (pendingEpochDuration == 0) return;
        if (block.timestamp < pendingEpochDurationEta) return;
        EpochClock memory clock = _loadEpochClock();
        if (clock.epoch < pendingEpochDurationEffectiveFromEpoch) return;
        uint256 old = clock.duration;
        uint256 next = pendingEpochDuration;
        _storeEpochClock(next, clock.epoch, clock.startTime);
        pendingEpochDuration = 0;
        pendingEpochDurationEta = 0;
        pendingEpochDurationEffectiveFromEpoch = 0;
        emit EpochDurationUpdated(old, next);
    }

    function _scheduleFeeRecipientChange(address newRecipient) internal {
        if (newRecipient == address(0) || newRecipient == address(this)) revert InvalidFeeRecipient();
        pendingFeeRecipient = newRecipient;
        pendingFeeRecipientEta = block.timestamp + FEE_RECIPIENT_TIMELOCK;
        emit FeeRecipientChangeScheduled(feeRecipient, newRecipient, pendingFeeRecipientEta);
    }

    function _applyPendingFeeRecipientIfReady() internal {
        address next = pendingFeeRecipient;
        if (next == address(0)) return;
        if (block.timestamp < pendingFeeRecipientEta) return;
        address oldRecipient = feeRecipient;
        feeRecipient = next;
        pendingFeeRecipient = address(0);
        pendingFeeRecipientEta = 0;
        emit FeeRecipientUpdated(oldRecipient, next);
    }

    /// @notice Schedules a bounded epoch-duration change behind the governance timelock.
    /// @param newDuration New duration in seconds, constrained to 15..3600.
    function scheduleEpochDuration(uint256 newDuration) external onlyOwner {
        _scheduleEpochDuration(newDuration);
    }

    /// @notice Cancels the currently pending epoch-duration change.
    function cancelEpochDurationChange() external onlyOwner {
        uint256 pending = pendingEpochDuration;
        if (pending == 0) revert NoPendingEpochDurationChange();
        pendingEpochDuration = 0;
        pendingEpochDurationEta = 0;
        pendingEpochDurationEffectiveFromEpoch = 0;
        emit EpochDurationChangeCancelled(pending);
    }

    /// @notice Schedules a fee-recipient change behind the governance timelock.
    /// @param newRecipient Non-zero recipient that is not this contract.
    function scheduleFeeRecipientChange(address newRecipient) external onlyOwner {
        _scheduleFeeRecipientChange(newRecipient);
    }

    /// @notice Cancels the currently pending fee-recipient change.
    function cancelFeeRecipientChange() external onlyOwner {
        address pending = pendingFeeRecipient;
        if (pending == address(0)) revert NoPendingFeeRecipientChange();
        pendingFeeRecipient = address(0);
        pendingFeeRecipientEta = 0;
        emit FeeRecipientChangeCancelled(pending);
    }

    function renounceOwnership() public view override onlyOwner {
        revert OwnershipRenounceDisabled();
    }

    function _flushProtocolFees() internal {
        uint256 ownerAmount = accruedOwnerFees;
        uint256 burnAmount = accruedBurnFees;
        if (ownerAmount == 0 && burnAmount == 0) return;
        if (ownerAmount > 0) {
            accruedOwnerFees = 0;
            token.safeTransfer(feeRecipient, ownerAmount);
        }
        if (burnAmount > 0) {
            accruedBurnFees = 0;
            token.safeTransfer(BURN_ADDRESS, burnAmount);
        }
        emit ProtocolFeesFlushed(ownerAmount, burnAmount);
    }
}
