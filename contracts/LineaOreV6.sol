// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/**
 * @title LineaOreV6
 * @notice On-chain prediction mining game with daily & weekly jackpots.
 *         Fee split: 2% daily jackpot, 3% weekly jackpot, 2% protocol
 *         (half treasury, half participation rebate), 1% burn.
 *         Each day/week, one random resolved epoch awards the accumulated jackpot pool
 *         to the winning-tile holders. Jackpot only triggers when someone bets on the
 *         winning tile; otherwise the base reward feeds the jackpot pools, growing them.
 *
 *         Governance model:
 *         - Ownable2Step for safe ownership handoff to a multisig or timelock.
 *         - Separate feeRecipient (treasury), so owner can be a timelock without trapping fees.
 *         - Sensitive treasury changes are timelocked on-chain for user visibility.
 *
 *         Participation rebate model:
 *         - Half of the 2% protocol fee (1% of the total pool) is saved as an epoch rebate pool.
 *         - Every bettor in that epoch can claim a proportional LINEA rebate later.
 *         - Rebate claiming is separated from reward claiming to keep the betting path simple.
 */
contract LineaOreV6 is Ownable2Step, ReentrancyGuard {
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
    mapping(uint256 => mapping(uint256 => mapping(address => uint256))) public userBets;
    mapping(address => mapping(uint256 => bool)) public hasClaimed;
    mapping(uint256 => uint256) public epochRewardClaimed;
    mapping(uint256 => bool) public epochDustSettled;
    mapping(uint256 => uint256) public epochResolvedAt;
    uint256 public accruedOwnerFees;
    uint256 public accruedBurnFees;
    mapping(address => uint256) public pendingResolverRewards;

    // Participation rebate tracking.
    mapping(uint256 => uint256) public epochRebatePool;
    mapping(uint256 => mapping(address => bool)) public rebateClaimed;

    event BetPlaced(uint256 indexed epoch, address indexed user, uint256 indexed tileId, uint256 amount);
    event BatchBetsPlaced(uint256 indexed epoch, address indexed user, uint256[] tileIds, uint256[] amounts, uint256 totalAmount);
    event EpochResolved(uint256 indexed epoch, uint256 winningTile, uint256 totalPool, uint256 fee, uint256 rewardPool, uint256 jackpotBonus);
    event DailyJackpotAwarded(uint256 indexed epoch, uint256 amount);
    event WeeklyJackpotAwarded(uint256 indexed epoch, uint256 amount);
    event RewardClaimed(uint256 indexed epoch, address indexed user, uint256 reward);
    event RewardDustSettled(uint256 indexed epoch, uint256 amount);
    event ResolverRewardAccrued(address indexed resolver, uint256 indexed epoch, uint256 amount);
    event ResolverRewardClaimed(address indexed resolver, uint256 amount);
    event ProtocolFeesFlushed(uint256 ownerAmount, uint256 burnAmount);
    event RebateClaimed(address indexed user, uint256 indexed epoch, uint256 amount);
    event RebateBatchClaimed(address indexed user, uint256 amount, uint256 epochsClaimed);
    event EpochDurationChangeScheduled(uint256 oldValue, uint256 newValue, uint256 eta, uint256 effectiveFromEpoch);
    event EpochDurationChangeCancelled(uint256 pendingValue);
    event EpochDurationUpdated(uint256 oldValue, uint256 newValue);
    event FeeRecipientChangeScheduled(address indexed oldRecipient, address indexed newRecipient, uint256 eta);
    event FeeRecipientChangeCancelled(address indexed pendingRecipient);
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);

    error EpochEnded();
    error TimerNotEnded();
    error AlreadyResolved();
    error CanOnlyResolveCurrent();
    error InvalidTile();
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

        uint256 amount = _previewRebate(epoch, msg.sender);
        if (amount == 0) revert NoRebateAvailable();

        rebateClaimed[epoch][msg.sender] = true;
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
            if (
                epochs[epoch].isResolved &&
                !rebateClaimed[epoch][msg.sender]
            ) {
                uint256 amount = _previewRebate(epoch, msg.sender);
                if (amount > 0) {
                    rebateClaimed[epoch][msg.sender] = true;
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

    function settleEpochDust(uint256 epoch) external nonReentrant {
        if (!epochs[epoch].isResolved) revert NotResolved();
        if (epochDustSettled[epoch]) revert DustAlreadySettled();
        if (!(epochResolvedAt[epoch] > 0 && block.timestamp >= epochResolvedAt[epoch] + DUST_SETTLE_DELAY)) {
            revert DustSettlementDelayNotReached();
        }

        epochDustSettled[epoch] = true;

        uint256 rewardPool = epochs[epoch].rewardPool;
        uint256 claimed = epochRewardClaimed[epoch];
        uint256 dust = rewardPool > claimed ? rewardPool - claimed : 0;

        if (dust > 0) {
            _applyPendingFeeRecipientIfReady();
            token.safeTransfer(feeRecipient, dust);
        }

        emit RewardDustSettled(epoch, dust);
    }

    function _autoResolveIfNeeded() internal {
        if (!epochs[currentEpoch].isResolved && block.timestamp >= epochStartTime + epochDuration) {
            _resolveCurrentEpoch();
        }
    }

    function placeBet(uint256 tileId, uint256 amount) external nonReentrant {
        _autoResolveIfNeeded();
        if (block.timestamp >= epochStartTime + epochDuration) revert EpochEnded();
        if (tileId == 0 || tileId > GRID_SIZE) revert InvalidTile();
        if (amount == 0) revert ZeroAmount();

        token.safeTransferFrom(msg.sender, address(this), amount);
        _recordBet(msg.sender, tileId, amount);
        emit BetPlaced(currentEpoch, msg.sender, tileId, amount);
    }

    function placeBatchBets(uint256[] calldata tileIds, uint256[] calldata amounts) external nonReentrant {
        _autoResolveIfNeeded();
        if (block.timestamp >= epochStartTime + epochDuration) revert EpochEnded();
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
        for (uint256 i = 0; i < len; ) {
            _recordBet(msg.sender, tileIds[i], amounts[i]);
            unchecked { ++i; }
        }
        emit BatchBetsPlaced(currentEpoch, msg.sender, tileIds, amounts, totalAmount);
    }

    function _recordBet(address user, uint256 tileId, uint256 amount) internal {
        userBets[currentEpoch][tileId][user] += amount;
        tilePools[currentEpoch][tileId] += amount;
        epochs[currentEpoch].totalPool += amount;
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

        _splitFees(L);

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

    function _splitFees(ResolveLocals memory L) internal {
        uint256 pool = L.totalPoolWithRollover;
        uint256 dailyAccrual = (pool * DAILY_JACKPOT_PERCENT) / 100;
        uint256 weeklyAccrual = (pool * WEEKLY_JACKPOT_PERCENT) / 100;
        L.protocolFee = (pool * PROTOCOL_FEE_PERCENT) / 100;
        L.burnAmount = (pool * BURN_FEE_PERCENT) / 100;
        uint256 resolverReward = (pool * RESOLVER_REWARD_BPS) / BPS_DENOMINATOR;
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

    /**
     * @dev Accrue 2% protocol fee: half to treasury, half to participation rebate pool.
     */
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

        hasClaimed[msg.sender][epoch] = true;
        uint256 tileTotal = tilePools[epoch][winTile];
        uint256 reward = (epochs[epoch].rewardPool * userBet) / tileTotal;
        epochRewardClaimed[epoch] += reward;

        token.safeTransfer(msg.sender, reward);
        emit RewardClaimed(epoch, msg.sender, reward);
    }

    function _previewRebate(uint256 epoch, address user) internal view returns (uint256) {
        uint256 totalPool = epochs[epoch].totalPool;
        uint256 rebatePool = epochRebatePool[epoch];
        uint256 userVolume = _getUserEpochVolume(epoch, user);
        if (totalPool == 0 || rebatePool == 0 || userVolume == 0) return 0;
        return (rebatePool * userVolume) / totalPool;
    }

    function getTileData(uint256 epoch) external view returns (uint256[] memory pools, uint256[] memory users) {
        pools = new uint256[](GRID_SIZE);
        users = new uint256[](GRID_SIZE);
        for (uint256 i = 0; i < GRID_SIZE; ) {
            pools[i] = tilePools[epoch][i + 1];
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
        for (uint256 tileId = 1; tileId <= GRID_SIZE; ) {
            volume += userBets[epoch][tileId][user];
            unchecked { ++tileId; }
        }
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
