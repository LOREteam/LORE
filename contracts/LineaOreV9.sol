// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title LineaOreV9
 * @notice V9 uses atomic resolve and adds a compact
 *         bitmap batch-betting entrypoint for equal-amount multi-bets.
 *         It also hardens empty-epoch resolves so rollover-only rounds
 *         do not leak fees into jackpot / protocol / burn buckets.
 */
contract LineaOreV9 is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;

    uint256 public constant GRID_SIZE = 25;
    uint256 public constant DAILY_JACKPOT_PERCENT = 2;
    uint256 public constant WEEKLY_JACKPOT_PERCENT = 3;
    uint256 public constant PROTOCOL_FEE_PERCENT = 2;
    uint256 public constant BURN_FEE_PERCENT = 1;
    uint256 public constant RESOLVER_REWARD_BPS = 5; // 0.05%
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant FEE_FLUSH_INTERVAL_EPOCHS = 120;
    uint256 public constant EPOCH_DURATION_TIMELOCK = 30 minutes;
    uint256 public constant FEE_RECIPIENT_TIMELOCK = 24 hours;
    uint256 public constant DUST_SETTLE_DELAY = 365 days;
    uint256 public constant LAST_BET_GRACE_SECONDS = 2;
    uint32 internal constant MAX_TILE_MASK = type(uint32).max >> (32 - GRID_SIZE);
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;
    uint256 internal constant MONDAY_OFFSET = 3 days;

    uint256 public epochDuration = 60;
    uint256 public currentEpoch = 1;
    uint256 public epochStartTime;
    address public feeRecipient;

    uint256 public pendingEpochDuration;
    uint256 public pendingEpochDurationEta;
    uint256 public pendingEpochDurationEffectiveFromEpoch;
    address public pendingFeeRecipient;
    uint256 public pendingFeeRecipientEta;

    uint256 public rolloverPool;
    uint256 public dailyJackpotPool;
    uint256 public weeklyJackpotPool;
    uint256 public lastDailyJackpotDay;
    uint256 public lastWeeklyJackpotWeek;
    uint256 public lastDailyJackpotEpoch;
    uint256 public lastWeeklyJackpotEpoch;
    uint256 public lastDailyJackpotAmount;
    uint256 public lastWeeklyJackpotAmount;
    uint256 public lastDailyJackpotCheckTs;
    uint256 public lastWeeklyJackpotCheckTs;

    struct Epoch {
        uint256 totalPool;
        uint256 rewardPool;
        uint256 winningTile;
        bool isResolved;
        bool isDailyJackpot;
        bool isWeeklyJackpot;
    }
    mapping(uint256 => Epoch) public epochs;
    mapping(uint256 => mapping(uint256 => uint256)) public tilePools;
    mapping(uint256 => mapping(uint256 => uint256)) public tileUserCounts;
    mapping(uint256 => mapping(uint256 => mapping(address => uint256))) public userBets;
    mapping(uint256 => mapping(address => uint256)) public userEpochVolumes;
    mapping(address => mapping(uint256 => bool)) public hasClaimed;
    mapping(uint256 => uint256) public epochRewardClaimed;
    mapping(uint256 => bool) public epochDustSettled;
    mapping(uint256 => uint256) public epochResolvedAt;

    uint256 public accruedOwnerFees;
    uint256 public accruedBurnFees;
    mapping(address => uint256) public pendingResolverRewards;
    mapping(uint256 => uint256) public epochRebatePool;
    mapping(uint256 => uint256) public epochRebateClaimed;
    mapping(uint256 => mapping(address => bool)) public rebateClaimed;

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

    constructor(address tokenAddress, address initialOwner, address initialFeeRecipient) Ownable(initialOwner) {
        if (tokenAddress == address(0)) revert InvalidTokenAddress();
        if (initialOwner == address(0)) revert InvalidInitialOwner();
        if (initialFeeRecipient == address(0)) revert InvalidFeeRecipient();
        token = IERC20(tokenAddress);
        feeRecipient = initialFeeRecipient;
        epochStartTime = block.timestamp;
    }

    function claimResolverRewards() external nonReentrant {
        uint256 amount = pendingResolverRewards[msg.sender];
        if (amount == 0) revert NothingToClaim();
        pendingResolverRewards[msg.sender] = 0;
        token.safeTransfer(msg.sender, amount);
        emit ResolverRewardClaimed(msg.sender, amount);
    }

    function flushProtocolFees() external nonReentrant {
        if (accruedOwnerFees == 0 && accruedBurnFees == 0) revert NothingToFlush();
        _applyPendingFeeRecipientIfReady();
        _flushProtocolFees();
    }

    function claimEpochRebate(uint256 epoch) external nonReentrant {
        if (!epochs[epoch].isResolved) revert NotResolved();
        if (rebateClaimed[epoch][msg.sender]) revert RebateAlreadyClaimed();
        uint256 amount = _consumeRebate(epoch, msg.sender);
        if (amount == 0) revert NoRebateAvailable();
        token.safeTransfer(msg.sender, amount);
        emit RebateClaimed(msg.sender, epoch, amount);
    }

    function claimEpochsRebate(uint256[] calldata claimEpochs) external nonReentrant {
        uint256 len = claimEpochs.length;
        if (len == 0) revert EmptyArray();
        uint256 totalAmount;
        uint256 epochsClaimedCount;
        for (uint256 i = 0; i < len; ) {
            uint256 epoch = claimEpochs[i];
            if (epochs[epoch].isResolved && !rebateClaimed[epoch][msg.sender]) {
                uint256 amount = _consumeRebate(epoch, msg.sender);
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

    function _consumeRebate(uint256 epoch, address user) internal returns (uint256 amount) {
        amount = _previewRebate(epoch, user);
        if (amount == 0) return 0;
        rebateClaimed[epoch][user] = true;
        epochRebateClaimed[epoch] += amount;
    }

    function settleEpochDust(uint256 epoch) external nonReentrant {
        if (!epochs[epoch].isResolved) revert NotResolved();
        if (epochDustSettled[epoch]) revert DustAlreadySettled();
        if (!(epochResolvedAt[epoch] > 0 && block.timestamp >= epochResolvedAt[epoch] + DUST_SETTLE_DELAY)) {
            revert DustSettlementDelayNotReached();
        }
        (uint256 dust, ) = _settleRewardDustIfAvailable(epoch);
        if (dust > 0) {
            _applyPendingFeeRecipientIfReady();
            token.safeTransfer(feeRecipient, dust);
        }
    }

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
        if (!epochs[epoch].isResolved || epochDustSettled[epoch]) return (0, false);
        uint256 resolvedAt = epochResolvedAt[epoch];
        if (resolvedAt == 0 || block.timestamp < resolvedAt + DUST_SETTLE_DELAY) return (0, false);
        epochDustSettled[epoch] = true;
        uint256 rewardPool = epochs[epoch].rewardPool;
        uint256 claimed = epochRewardClaimed[epoch];
        dust = rewardPool > claimed ? rewardPool - claimed : 0;
        emit RewardDustSettled(epoch, dust);
        return (dust, true);
    }

    function settleEpochRebateDust(uint256 epoch) external nonReentrant {
        if (!epochs[epoch].isResolved) revert NotResolved();
        if (!(epochResolvedAt[epoch] > 0 && block.timestamp >= epochResolvedAt[epoch] + DUST_SETTLE_DELAY)) {
            revert DustSettlementDelayNotReached();
        }
        uint256 dust = _settleRebateDustIfAvailable(epoch);
        if (dust == 0) revert NothingToClaim();
        _applyPendingFeeRecipientIfReady();
        token.safeTransfer(feeRecipient, dust);
    }

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
        if (!epochs[epoch].isResolved) return 0;
        uint256 resolvedAt = epochResolvedAt[epoch];
        if (resolvedAt == 0 || block.timestamp < resolvedAt + DUST_SETTLE_DELAY) return 0;
        uint256 rebatePool = epochRebatePool[epoch];
        uint256 claimed = epochRebateClaimed[epoch];
        if (claimed >= rebatePool) return 0;
        dust = rebatePool - claimed;
        epochRebateClaimed[epoch] = rebatePool;
        emit RebateDustSettled(epoch, dust);
    }

    function _autoResolveIfNeeded() internal {
        if (!epochs[currentEpoch].isResolved && block.timestamp >= epochStartTime + epochDuration) {
            _resolveCurrentEpoch();
        }
    }

    function _checkBetWindow() internal view {
        uint256 endTime = epochStartTime + epochDuration;
        if (block.timestamp >= endTime) revert EpochEnded();
        if (block.timestamp + LAST_BET_GRACE_SECONDS >= endTime) revert EpochClosing();
    }

    function placeBet(uint256 tileId, uint256 amount) external nonReentrant {
        _autoResolveIfNeeded();
        _checkBetWindow();
        if (tileId == 0 || tileId > GRID_SIZE) revert InvalidTile();
        if (amount == 0) revert ZeroAmount();
        token.safeTransferFrom(msg.sender, address(this), amount);
        uint256 epoch = currentEpoch;
        _recordEpochVolume(epoch, msg.sender, amount);
        _recordBet(epoch, msg.sender, tileId, amount);
        emit BetPlaced(epoch, msg.sender, tileId, amount);
    }

    function placeBatchBets(uint256[] calldata tileIds, uint256[] calldata amounts) external nonReentrant {
        _autoResolveIfNeeded();
        _checkBetWindow();
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
        token.safeTransferFrom(msg.sender, address(this), totalAmount);
        uint256 epoch = currentEpoch;
        _recordEpochVolume(epoch, msg.sender, totalAmount);
        for (uint256 i = 0; i < len; ) {
            _recordBet(epoch, msg.sender, tileIds[i], amounts[i]);
            unchecked { ++i; }
        }
        emit BatchBetsPlaced(epoch, msg.sender, tileIds, amounts, totalAmount);
    }

    function placeBatchBetsSameAmount(uint256[] calldata tileIds, uint256 amount) external nonReentrant {
        _autoResolveIfNeeded();
        _checkBetWindow();
        uint256 len = tileIds.length;
        if (len == 0) revert EmptyArray();
        if (amount == 0) revert ZeroAmount();
        uint256 totalAmount = amount * len;
        token.safeTransferFrom(msg.sender, address(this), totalAmount);
        uint256 epoch = currentEpoch;
        _recordEpochVolume(epoch, msg.sender, totalAmount);
        for (uint256 i = 0; i < len; ) {
            uint256 tileId = tileIds[i];
            if (tileId == 0 || tileId > GRID_SIZE) revert InvalidTile();
            _recordBet(epoch, msg.sender, tileId, amount);
            unchecked { ++i; }
        }
        emit BatchBetsSameAmountPlaced(epoch, msg.sender, tileIds, amount, totalAmount);
    }

    function placeBatchBetsBitmap(uint32 tileMask, uint256 amount) external nonReentrant {
        _autoResolveIfNeeded();
        _checkBetWindow();
        if (tileMask == 0) revert EmptyArray();
        if ((tileMask & ~MAX_TILE_MASK) != 0) revert InvalidTileMask();
        if (amount == 0) revert ZeroAmount();

        uint256 tileCount = _countSelectedTiles(tileMask);
        uint256 totalAmount = amount * tileCount;
        token.safeTransferFrom(msg.sender, address(this), totalAmount);
        uint256 epoch = currentEpoch;
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
        uint32 remainingMask = tileMask;
        while (remainingMask != 0) {
            count += uint256(remainingMask & 1);
            remainingMask >>= 1;
        }
    }

    function _recordBet(uint256 epoch, address user, uint256 tileId, uint256 amount) internal {
        uint256 previousBet = userBets[epoch][tileId][user];
        if (previousBet == 0) {
            tileUserCounts[epoch][tileId] += 1;
        }
        userBets[epoch][tileId][user] = previousBet + amount;
        tilePools[epoch][tileId] += amount;
    }

    function _recordEpochVolume(uint256 epoch, address user, uint256 totalAmount) internal {
        userEpochVolumes[epoch][user] += totalAmount;
        epochs[epoch].totalPool += totalAmount;
    }

    function resolveEpoch(uint256 epoch) external nonReentrant {
        if (epoch != currentEpoch) revert CanOnlyResolveCurrent();
        if (block.timestamp < epochStartTime + epochDuration) revert TimerNotEnded();
        if (epochs[epoch].isResolved) revert AlreadyResolved();
        _resolveCurrentEpoch();
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

    function _resolveCurrentEpoch() internal {
        ResolveLocals memory L;
        L.epoch = currentEpoch;
        Epoch storage ep = epochs[L.epoch];
        if (ep.isResolved) revert AlreadyResolved();
        L.totalPoolWithRollover = ep.totalPool + rolloverPool;
        rolloverPool = 0;
        L.winningTile = (
            uint256(
                keccak256(
                    abi.encodePacked(
                        block.prevrandao,
                        blockhash(block.number - 1),
                        L.epoch,
                        L.totalPoolWithRollover,
                        dailyJackpotPool,
                        weeklyJackpotPool
                    )
                )
            ) % GRID_SIZE
        ) + 1;
        ep.winningTile = L.winningTile;
        ep.isResolved = true;
        epochResolvedAt[L.epoch] = block.timestamp;
        _splitFees(L, ep);
        bool hasWinner = tilePools[L.epoch][L.winningTile] > 0;
        if (hasWinner) {
            L.jackpotBonus = _tryAwardJackpots(L.epoch, ep);
            ep.rewardPool = L.baseReward + L.jackpotBonus;
        } else {
            rolloverPool = L.baseReward;
            ep.rewardPool = 0;
        }
        emit EpochResolved(L.epoch, L.winningTile, L.totalPoolWithRollover, L.protocolFee + L.burnAmount, ep.rewardPool, L.jackpotBonus);
        currentEpoch = L.epoch + 1;
        epochStartTime = block.timestamp;
        _applyPendingEpochDurationIfReady();
        _applyPendingFeeRecipientIfReady();
        if (L.epoch % FEE_FLUSH_INTERVAL_EPOCHS == 0) {
            _flushProtocolFees();
        }
    }

    function _splitFees(ResolveLocals memory L, Epoch storage ep) internal {
        uint256 freshPool = ep.totalPool;
        uint256 pool = L.totalPoolWithRollover;
        if (ep.totalPool == 0) {
            L.baseReward = pool;
            return;
        }
        uint256 dailyAccrual = (freshPool * DAILY_JACKPOT_PERCENT) / 100;
        uint256 weeklyAccrual = (freshPool * WEEKLY_JACKPOT_PERCENT) / 100;
        L.protocolFee = (freshPool * PROTOCOL_FEE_PERCENT) / 100;
        L.burnAmount = (freshPool * BURN_FEE_PERCENT) / 100;
        uint256 resolverReward = (freshPool * RESOLVER_REWARD_BPS) / BPS_DENOMINATOR;
        if (resolverReward > L.protocolFee) resolverReward = L.protocolFee;
        L.baseReward = pool - dailyAccrual - weeklyAccrual - L.protocolFee - L.burnAmount;
        dailyJackpotPool += dailyAccrual;
        weeklyJackpotPool += weeklyAccrual;
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

    function _tryAwardJackpots(uint256 epoch, Epoch storage ep) internal returns (uint256 bonus) {
        uint256 today = block.timestamp / 1 days;
        if (lastDailyJackpotDay != today && dailyJackpotPool > 0) {
            uint256 start = _dayStart(block.timestamp);
            uint256 end = start + 1 days;
            uint256 lastCheck = lastDailyJackpotCheckTs;
            if (lastCheck < start) lastCheck = start;
            if (lastCheck > block.timestamp) lastCheck = block.timestamp;
            uint256 elapsed = block.timestamp - lastCheck;
            uint256 remaining = end > lastCheck ? (end - lastCheck) : 1;
            uint256 dRand = uint256(keccak256(abi.encodePacked(block.prevrandao, "daily", epoch, lastCheck, block.timestamp))) % remaining;
            if (dRand < elapsed) {
                uint256 amt = dailyJackpotPool;
                dailyJackpotPool = 0;
                bonus += amt;
                lastDailyJackpotDay = today;
                lastDailyJackpotEpoch = epoch;
                lastDailyJackpotAmount = amt;
                lastDailyJackpotCheckTs = block.timestamp;
                ep.isDailyJackpot = true;
                emit DailyJackpotAwarded(epoch, amt);
            } else {
                lastDailyJackpotCheckTs = block.timestamp;
            }
        }
        uint256 thisWeek = _mondayWeek(block.timestamp);
        if (lastWeeklyJackpotWeek != thisWeek && weeklyJackpotPool > 0) {
            uint256 start = _weekStartMonday(block.timestamp);
            uint256 end = start + 1 weeks;
            uint256 lastCheck = lastWeeklyJackpotCheckTs;
            if (lastCheck < start) lastCheck = start;
            if (lastCheck > block.timestamp) lastCheck = block.timestamp;
            uint256 elapsed = block.timestamp - lastCheck;
            uint256 remaining = end > lastCheck ? (end - lastCheck) : 1;
            uint256 wRand = uint256(keccak256(abi.encodePacked(block.prevrandao, "weekly", epoch, lastCheck, block.timestamp))) % remaining;
            if (wRand < elapsed) {
                uint256 amt = weeklyJackpotPool;
                weeklyJackpotPool = 0;
                bonus += amt;
                lastWeeklyJackpotWeek = thisWeek;
                lastWeeklyJackpotEpoch = epoch;
                lastWeeklyJackpotAmount = amt;
                lastWeeklyJackpotCheckTs = block.timestamp;
                ep.isWeeklyJackpot = true;
                emit WeeklyJackpotAwarded(epoch, amt);
            } else {
                lastWeeklyJackpotCheckTs = block.timestamp;
            }
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

    function claimReward(uint256 epoch) external nonReentrant {
        if (!epochs[epoch].isResolved) revert NotResolved();
        if (
            epochResolvedAt[epoch] > 0 &&
            block.timestamp >= epochResolvedAt[epoch] + DUST_SETTLE_DELAY
        ) revert RewardClaimWindowExpired();
        if (epochDustSettled[epoch]) revert RewardClaimWindowExpired();
        if (hasClaimed[msg.sender][epoch]) revert AlreadyClaimed();
        uint256 winTile = epochs[epoch].winningTile;
        uint256 userBet = userBets[epoch][winTile][msg.sender];
        if (userBet == 0) revert NoWinningBet();
        uint256 tileTotal = tilePools[epoch][winTile];
        uint256 reward = (epochs[epoch].rewardPool * userBet) / tileTotal;
        if (reward == 0) revert NothingToClaim();
        hasClaimed[msg.sender][epoch] = true;
        epochRewardClaimed[epoch] += reward;
        token.safeTransfer(msg.sender, reward);
        emit RewardClaimed(epoch, msg.sender, reward);
    }

    function claimRewards(uint256[] calldata claimEpochs) external nonReentrant {
        uint256 len = claimEpochs.length;
        if (len == 0) revert EmptyArray();
        uint256 totalReward;
        uint256 epochsClaimedCount;
        for (uint256 i = 0; i < len; ) {
            uint256 epoch = claimEpochs[i];
            if (
                epochs[epoch].isResolved &&
                !epochDustSettled[epoch] &&
                !hasClaimed[msg.sender][epoch] &&
                !(
                    epochResolvedAt[epoch] > 0 &&
                    block.timestamp >= epochResolvedAt[epoch] + DUST_SETTLE_DELAY
                )
            ) {
                uint256 winTile = epochs[epoch].winningTile;
                uint256 userBet = userBets[epoch][winTile][msg.sender];
                if (userBet > 0) {
                    uint256 tileTotal = tilePools[epoch][winTile];
                    uint256 reward = (epochs[epoch].rewardPool * userBet) / tileTotal;
                    if (reward > 0) {
                        hasClaimed[msg.sender][epoch] = true;
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

    function _previewRebate(uint256 epoch, address user) internal view returns (uint256) {
        Epoch storage ep = epochs[epoch];
        if (!ep.isResolved) return 0;
        if (epochResolvedAt[epoch] > 0 && block.timestamp >= epochResolvedAt[epoch] + DUST_SETTLE_DELAY) return 0;
        uint256 totalPool = ep.totalPool;
        uint256 rebatePool = epochRebatePool[epoch];
        uint256 claimedTotal = epochRebateClaimed[epoch];
        uint256 userVolume = _getUserEpochVolume(epoch, user);
        if (totalPool == 0 || rebatePool == 0 || claimedTotal >= rebatePool || userVolume == 0) return 0;
        uint256 winningTile = ep.winningTile;
        if (userBets[epoch][winningTile][user] > 0) return 0;
        if (tilePools[epoch][winningTile] >= totalPool) return 0;
        uint256 losingVolume = totalPool - tilePools[epoch][winningTile];
        uint256 amount = (rebatePool * userVolume) / losingVolume;
        uint256 remaining = rebatePool - claimedTotal;
        return amount > remaining ? remaining : amount;
    }

    function getTileData(uint256 epoch) external view returns (uint256[] memory pools, uint256[] memory users) {
        pools = new uint256[](GRID_SIZE);
        users = new uint256[](GRID_SIZE);
        for (uint256 i = 0; i < GRID_SIZE; ) {
            uint256 tileId = i + 1;
            pools[i] = tilePools[epoch][tileId];
            users[i] = tileUserCounts[epoch][tileId];
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
        if (epoch == currentEpoch) return epochStartTime + epochDuration;
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
        return (
            dailyJackpotPool,
            weeklyJackpotPool,
            lastDailyJackpotDay,
            lastWeeklyJackpotWeek,
            lastDailyJackpotEpoch,
            lastWeeklyJackpotEpoch,
            lastDailyJackpotAmount,
            lastWeeklyJackpotAmount
        );
    }

    function previewRebate(uint256 epoch, address user) external view returns (uint256) {
        return _previewRebate(epoch, user);
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
        rebatePool = epochRebatePool[epoch];
        userVolume = _getUserEpochVolume(epoch, user);
        pending = rebateClaimed[epoch][user] ? 0 : _previewRebate(epoch, user);
        claimed = rebateClaimed[epoch][user];
        resolved = epochs[epoch].isResolved;
    }

    function getRebateSummary(address user, uint256[] calldata rebateEpochList)
        external
        view
        returns (uint256 totalPending, uint256 claimableEpochs)
    {
        uint256 len = rebateEpochList.length;
        for (uint256 i = 0; i < len; ) {
            uint256 epoch = rebateEpochList[i];
            if (epochs[epoch].isResolved && !rebateClaimed[epoch][user]) {
                uint256 pending = _previewRebate(epoch, user);
                if (pending > 0) {
                    totalPending += pending;
                    claimableEpochs += 1;
                }
            }
            unchecked { ++i; }
        }
    }

    function _getUserEpochVolume(uint256 epoch, address user) internal view returns (uint256 volume) {
        return userEpochVolumes[epoch][user];
    }

    function _scheduleEpochDuration(uint256 newDuration) internal {
        if (newDuration < 15 || newDuration > 3600) revert InvalidEpochDuration();
        pendingEpochDuration = newDuration;
        pendingEpochDurationEta = block.timestamp + EPOCH_DURATION_TIMELOCK;
        pendingEpochDurationEffectiveFromEpoch = currentEpoch + 1;
        emit EpochDurationChangeScheduled(
            epochDuration,
            newDuration,
            pendingEpochDurationEta,
            pendingEpochDurationEffectiveFromEpoch
        );
    }

    function _applyPendingEpochDurationIfReady() internal {
        if (pendingEpochDuration == 0) return;
        if (block.timestamp < pendingEpochDurationEta) return;
        if (currentEpoch < pendingEpochDurationEffectiveFromEpoch) return;
        uint256 old = epochDuration;
        uint256 next = pendingEpochDuration;
        epochDuration = next;
        pendingEpochDuration = 0;
        pendingEpochDurationEta = 0;
        pendingEpochDurationEffectiveFromEpoch = 0;
        emit EpochDurationUpdated(old, next);
    }

    function _scheduleFeeRecipientChange(address newRecipient) internal {
        if (newRecipient == address(0)) revert InvalidFeeRecipient();
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

    function scheduleEpochDuration(uint256 newDuration) external onlyOwner {
        _scheduleEpochDuration(newDuration);
    }

    function cancelEpochDurationChange() external onlyOwner {
        uint256 pending = pendingEpochDuration;
        if (pending == 0) revert NoPendingEpochDurationChange();
        pendingEpochDuration = 0;
        pendingEpochDurationEta = 0;
        pendingEpochDurationEffectiveFromEpoch = 0;
        emit EpochDurationChangeCancelled(pending);
    }

    function scheduleFeeRecipientChange(address newRecipient) external onlyOwner {
        _scheduleFeeRecipientChange(newRecipient);
    }

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
