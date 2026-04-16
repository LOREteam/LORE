// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title LineaOreV7
 * @notice On-chain prediction mining game with daily & weekly jackpots.
 *         Fee split: 2% daily jackpot, 3% weekly jackpot, 2% protocol
 *         (half treasury, half participation rebate), 1% burn.
 *
 *         V7 keeps the V6 external game/rebate API compatible while
 *         fixing resolve-time randomness/timing issues and returning
 *         truthful per-tile user counts.
 */
contract LineaOreV7 is Ownable2Step, ReentrancyGuard {
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
    uint256 public constant REVEAL_DELAY_BLOCKS = 2;
    uint256 public constant MAX_BET_BATCH_LENGTH = GRID_SIZE;
    uint256 public constant MAX_CLAIM_BATCH_LENGTH = 128;
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;
    uint256 internal constant MONDAY_OFFSET = 3 days;

    uint256 public epochDuration = 60;
    uint256 public currentEpoch = 1;
    uint256 public epochStartTime;
    uint256 public nextEpochToFinalize = 1;
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
        uint256 endTime;
        uint256 entropyBlock;
        uint256 totalPoolWithRollover;
        uint256 baseRewardPool;
    }

    mapping(uint256 => Epoch) internal _epochs;
    mapping(uint256 => mapping(uint256 => uint256)) public tilePools;
    mapping(uint256 => mapping(uint256 => uint256)) public tileUserCounts;
    mapping(uint256 => mapping(uint256 => mapping(address => uint256))) public userBets;
    mapping(uint256 => mapping(uint256 => mapping(address => bool))) private _hasUserBetOnTile;
    mapping(uint256 => mapping(address => uint256)) public userEpochVolumes;
    mapping(address => mapping(uint256 => bool)) public hasClaimed;
    mapping(uint256 => uint256) public epochRewardClaimed;
    mapping(uint256 => bool) public epochDustSettled;
    mapping(uint256 => uint256) public epochResolvedAt;
    uint256 public accruedOwnerFees;
    uint256 public accruedBurnFees;
    mapping(address => uint256) public pendingResolverRewards;

    mapping(uint256 => uint256) public epochRebatePool;
    mapping(uint256 => mapping(address => bool)) public rebateClaimed;

    event BetPlaced(uint256 indexed epoch, address indexed user, uint256 indexed tileId, uint256 amount);
    event BatchBetsPlaced(uint256 indexed epoch, address indexed user, uint256[] tileIds, uint256[] amounts, uint256 totalAmount);
    event BatchBetsSameAmountPlaced(uint256 indexed epoch, address indexed user, uint256[] tileIds, uint256 amount, uint256 totalAmount);
    event EpochSealed(
        uint256 indexed epoch,
        uint256 entropyBlock,
        uint256 endTime,
        uint256 totalPoolWithRollover,
        uint256 baseRewardPool
    );
    event EpochEntropyRefreshed(uint256 indexed epoch, uint256 previousEntropyBlock, uint256 newEntropyBlock);
    event EpochResolved(uint256 indexed epoch, uint256 winningTile, uint256 totalPool, uint256 fee, uint256 rewardPool, uint256 jackpotBonus);
    event DailyJackpotAwarded(uint256 indexed epoch, uint256 amount);
    event WeeklyJackpotAwarded(uint256 indexed epoch, uint256 amount);
    event RewardClaimed(uint256 indexed epoch, address indexed user, uint256 reward);
    event RewardBatchClaimed(address indexed user, uint256 totalAmount, uint256 epochsClaimed);
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
    error EpochAlreadyClosed();
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
    error BatchTooLarge();
    error EpochNotSealed();
    error EntropyNotReady();
    error FinalizeOrderViolation();

    constructor(address tokenAddress, address initialOwner, address initialFeeRecipient) Ownable(initialOwner) {
        if (tokenAddress == address(0)) revert InvalidTokenAddress();
        if (initialOwner == address(0)) revert InvalidInitialOwner();
        if (initialFeeRecipient == address(0)) revert InvalidFeeRecipient();
        token = IERC20(tokenAddress);
        feeRecipient = initialFeeRecipient;
        epochStartTime = block.timestamp;
    }

    function epochs(uint256 epoch)
        external
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
        return (
            ep.totalPool,
            ep.rewardPool,
            ep.winningTile,
            ep.isResolved,
            ep.isDailyJackpot,
            ep.isWeeklyJackpot
        );
    }

    function getEpochLifecycle(uint256 epoch)
        external
        view
        returns (
            uint256 endTime,
            uint256 entropyBlock,
            bool isSealed,
            bool isResolved_,
            bool isEntropyReady
        )
    {
        Epoch storage ep = _epochs[epoch];
        endTime = epoch == currentEpoch ? epochStartTime + epochDuration : ep.endTime;
        entropyBlock = ep.entropyBlock;
        isSealed = entropyBlock > 0;
        isResolved_ = ep.isResolved;
        isEntropyReady = isSealed && block.number > entropyBlock && blockhash(entropyBlock) != bytes32(0);
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
        if (!_epochs[epoch].isResolved) revert NotResolved();
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
        if (len > MAX_CLAIM_BATCH_LENGTH) revert BatchTooLarge();

        uint256 totalAmount;
        uint256 epochsClaimedCount;

        for (uint256 i = 0; i < len; ) {
            uint256 epoch = claimEpochs[i];
            if (_epochs[epoch].isResolved && !rebateClaimed[epoch][msg.sender]) {
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
        if (!_epochs[epoch].isResolved) revert NotResolved();
        if (epochDustSettled[epoch]) revert DustAlreadySettled();
        if (!(epochResolvedAt[epoch] > 0 && block.timestamp >= epochResolvedAt[epoch] + DUST_SETTLE_DELAY)) {
            revert DustSettlementDelayNotReached();
        }

        epochDustSettled[epoch] = true;

        uint256 rewardPool = _epochs[epoch].rewardPool;
        uint256 claimed = epochRewardClaimed[epoch];
        uint256 dust = rewardPool > claimed ? rewardPool - claimed : 0;

        if (dust > 0) {
            _applyPendingFeeRecipientIfReady();
            token.safeTransfer(feeRecipient, dust);
        }

        emit RewardDustSettled(epoch, dust);
    }

    function _advanceEpochIfNeeded(address resolver) internal {
        if (block.timestamp >= epochStartTime + epochDuration) {
            _sealCurrentEpoch(resolver);
        }
        _finalizeReadyEpochs(1);
    }

    function placeBet(uint256 tileId, uint256 amount) external nonReentrant {
        _advanceEpochIfNeeded(msg.sender);
        if (block.timestamp >= epochStartTime + epochDuration) revert EpochEnded();
        if (tileId == 0 || tileId > GRID_SIZE) revert InvalidTile();
        if (amount == 0) revert ZeroAmount();

        token.safeTransferFrom(msg.sender, address(this), amount);
        _recordBet(msg.sender, tileId, amount);
        emit BetPlaced(currentEpoch, msg.sender, tileId, amount);
    }

    function placeBatchBets(uint256[] calldata tileIds, uint256[] calldata amounts) external nonReentrant {
        _advanceEpochIfNeeded(msg.sender);
        if (block.timestamp >= epochStartTime + epochDuration) revert EpochEnded();
        if (tileIds.length != amounts.length) revert ArraysMismatch();
        if (tileIds.length == 0) revert EmptyArray();
        if (tileIds.length > MAX_BET_BATCH_LENGTH) revert BatchTooLarge();

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

    function placeBatchBetsSameAmount(uint256[] calldata tileIds, uint256 amount) external nonReentrant {
        _advanceEpochIfNeeded(msg.sender);
        if (block.timestamp >= epochStartTime + epochDuration) revert EpochEnded();
        uint256 len = tileIds.length;
        if (len == 0) revert EmptyArray();
        if (len > MAX_BET_BATCH_LENGTH) revert BatchTooLarge();
        if (amount == 0) revert ZeroAmount();

        // Solidity 0.8+ uses checked arithmetic here. Any theoretical
        // overflow reverts the whole transaction instead of wrapping.
        uint256 totalAmount = amount * len;
        token.safeTransferFrom(msg.sender, address(this), totalAmount);

        for (uint256 i = 0; i < len; ) {
            uint256 tileId = tileIds[i];
            if (tileId == 0 || tileId > GRID_SIZE) revert InvalidTile();
            _recordBet(msg.sender, tileId, amount);
            unchecked { ++i; }
        }

        emit BatchBetsSameAmountPlaced(currentEpoch, msg.sender, tileIds, amount, totalAmount);
    }

    function _recordBet(address user, uint256 tileId, uint256 amount) internal {
        uint256 epoch = currentEpoch;
        if (!_hasUserBetOnTile[epoch][tileId][user]) {
            _hasUserBetOnTile[epoch][tileId][user] = true;
            tileUserCounts[epoch][tileId] += 1;
        }
        userBets[epoch][tileId][user] += amount;
        userEpochVolumes[epoch][user] += amount;
        tilePools[epoch][tileId] += amount;
        _epochs[epoch].totalPool += amount;
    }

    function resolveEpoch(uint256 epoch) external nonReentrant {
        if (epoch > currentEpoch) revert CanOnlyResolveCurrent();

        if (epoch == currentEpoch) {
            if (block.timestamp < epochStartTime + epochDuration) revert TimerNotEnded();
            _sealCurrentEpoch(msg.sender);
            _finalizeReadyEpochs(1);
            return;
        }

        if (epoch != nextEpochToFinalize) revert FinalizeOrderViolation();
        if (_refreshExpiredEpochEntropy(epoch, _epochs[epoch])) return;
        _finalizeEpoch(epoch);
        _finalizeReadyEpochs(1);
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

    function _sealCurrentEpoch(address resolver) internal {
        ResolveLocals memory L;
        L.epoch = currentEpoch;
        Epoch storage ep = _epochs[L.epoch];
        if (ep.isResolved || ep.entropyBlock > 0) revert EpochAlreadyClosed();

        L.totalPoolWithRollover = ep.totalPool + rolloverPool;
        rolloverPool = 0;
        ep.endTime = epochStartTime + epochDuration;
        ep.entropyBlock = block.number + REVEAL_DELAY_BLOCKS;
        ep.totalPoolWithRollover = L.totalPoolWithRollover;

        _splitFees(L, resolver);
        ep.baseRewardPool = L.baseReward;

        emit EpochSealed(
            L.epoch,
            ep.entropyBlock,
            ep.endTime,
            ep.totalPoolWithRollover,
            ep.baseRewardPool
        );

        currentEpoch = L.epoch + 1;
        epochStartTime = block.timestamp;
        _applyPendingEpochDurationIfReady();
        _applyPendingFeeRecipientIfReady();
        if (L.epoch % FEE_FLUSH_INTERVAL_EPOCHS == 0) {
            _flushProtocolFees();
        }
    }

    function _finalizeReadyEpochs(uint256 maxEpochs) internal {
        uint256 finalized;
        // Keep catch-up work bounded so user-triggered flows do not inherit
        // unbounded gas from a long pending finalize backlog.
        while (finalized < maxEpochs && nextEpochToFinalize < currentEpoch) {
            Epoch storage ep = _epochs[nextEpochToFinalize];
            if (ep.isResolved) {
                nextEpochToFinalize += 1;
                unchecked { ++finalized; }
                continue;
            }
            if (ep.entropyBlock == 0) break;
            if (block.number <= ep.entropyBlock) break;
            if (_refreshExpiredEpochEntropy(nextEpochToFinalize, ep)) break;
            _finalizeEpoch(nextEpochToFinalize);
            unchecked { ++finalized; }
        }
    }

    function _finalizeEpoch(uint256 epoch) internal {
        if (epoch >= currentEpoch) revert CanOnlyResolveCurrent();
        if (epoch != nextEpochToFinalize) revert FinalizeOrderViolation();

        Epoch storage ep = _epochs[epoch];
        if (ep.isResolved) revert EpochAlreadyClosed();
        if (ep.entropyBlock == 0) revert EpochNotSealed();
        if (block.number <= ep.entropyBlock) revert EntropyNotReady();
        if (_refreshExpiredEpochEntropy(epoch, ep)) return;

        bytes32 entropySource = blockhash(ep.entropyBlock);
        if (entropySource == bytes32(0)) revert EntropyNotReady();

        uint256 epochEntropy = uint256(
            keccak256(
                abi.encodePacked(
                    entropySource,
                    ep.entropyBlock,
                    epoch,
                    ep.totalPoolWithRollover,
                    ep.endTime
                )
            )
        );

        uint256 winningTile = (epochEntropy % GRID_SIZE) + 1;
        ep.winningTile = winningTile;
        ep.isResolved = true;
        epochResolvedAt[epoch] = block.timestamp;

        bool hasWinner = tilePools[epoch][winningTile] > 0;
        uint256 jackpotBonus;
        if (hasWinner) {
            jackpotBonus = _tryAwardJackpots(epoch, ep, epochEntropy);
            ep.rewardPool = ep.baseRewardPool + jackpotBonus;
        } else {
            rolloverPool += ep.baseRewardPool;
            ep.rewardPool = 0;
        }

        emit EpochResolved(epoch, winningTile, ep.totalPoolWithRollover, _calcFeeAmount(ep.totalPoolWithRollover), ep.rewardPool, jackpotBonus);
        nextEpochToFinalize = epoch + 1;
    }

    function _refreshExpiredEpochEntropy(uint256 epoch, Epoch storage ep) internal returns (bool refreshed) {
        uint256 currentEntropyBlock = ep.entropyBlock;
        if (currentEntropyBlock == 0 || block.number <= currentEntropyBlock) return false;
        if (blockhash(currentEntropyBlock) != bytes32(0)) return false;

        uint256 newEntropyBlock = block.number + REVEAL_DELAY_BLOCKS;
        ep.entropyBlock = newEntropyBlock;
        emit EpochEntropyRefreshed(epoch, currentEntropyBlock, newEntropyBlock);
        return true;
    }

    function _calcFeeAmount(uint256 pool) internal pure returns (uint256) {
        return
            (pool * PROTOCOL_FEE_PERCENT) / 100 +
            (pool * BURN_FEE_PERCENT) / 100;
    }

    function _splitFees(ResolveLocals memory L, address resolver) internal {
        uint256 pool = L.totalPoolWithRollover;
        uint256 dailyAccrual = (pool * DAILY_JACKPOT_PERCENT) / 100;
        uint256 weeklyAccrual = (pool * WEEKLY_JACKPOT_PERCENT) / 100;
        L.protocolFee = (pool * PROTOCOL_FEE_PERCENT) / 100;
        L.burnAmount = (pool * BURN_FEE_PERCENT) / 100;
        uint256 resolverReward = (pool * RESOLVER_REWARD_BPS) / BPS_DENOMINATOR;
        // Defensive cap: keep resolver incentives unable to exceed the
        // protocol-fee bucket even if parameters change in a later version.
        if (resolverReward > L.protocolFee) resolverReward = L.protocolFee;
        L.baseReward = pool - dailyAccrual - weeklyAccrual - L.protocolFee - L.burnAmount;

        dailyJackpotPool += dailyAccrual;
        weeklyJackpotPool += weeklyAccrual;

        _accrueProtocolFee(L.protocolFee - resolverReward, L.epoch);
        if (L.burnAmount > 0) accruedBurnFees += L.burnAmount;
        if (resolverReward > 0) {
            pendingResolverRewards[resolver] += resolverReward;
            emit ResolverRewardAccrued(resolver, L.epoch, resolverReward);
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

    function _tryAwardJackpots(uint256 epoch, Epoch storage ep, uint256 epochEntropy) internal returns (uint256 bonus) {
        uint256 epochEndTime = ep.endTime;
        uint256 today = epochEndTime / 1 days;
        if (lastDailyJackpotDay != today && dailyJackpotPool > 0) {
            uint256 start = _dayStart(epochEndTime);
            uint256 end = start + 1 days;
            uint256 lastCheck = lastDailyJackpotCheckTs;
            if (lastCheck < start) lastCheck = start;
            if (lastCheck > epochEndTime) lastCheck = epochEndTime;

            uint256 elapsed = epochEndTime - lastCheck;
            uint256 remaining = end > lastCheck ? (end - lastCheck) : 1;
            uint256 dRand = uint256(keccak256(abi.encodePacked(epochEntropy, "daily", epoch, lastCheck, epochEndTime))) % remaining;
            lastDailyJackpotCheckTs = epochEndTime;
            if (dRand < elapsed) {
                uint256 amt = dailyJackpotPool;
                dailyJackpotPool = 0;
                bonus += amt;
                lastDailyJackpotDay = today;
                lastDailyJackpotEpoch = epoch;
                lastDailyJackpotAmount = amt;
                ep.isDailyJackpot = true;
                emit DailyJackpotAwarded(epoch, amt);
            }
        }

        uint256 thisWeek = _mondayWeek(epochEndTime);
        if (lastWeeklyJackpotWeek != thisWeek && weeklyJackpotPool > 0) {
            uint256 start = _weekStartMonday(epochEndTime);
            uint256 end = start + 1 weeks;
            uint256 lastCheck = lastWeeklyJackpotCheckTs;
            if (lastCheck < start) lastCheck = start;
            if (lastCheck > epochEndTime) lastCheck = epochEndTime;

            uint256 elapsed = epochEndTime - lastCheck;
            uint256 remaining = end > lastCheck ? (end - lastCheck) : 1;
            uint256 wRand = uint256(keccak256(abi.encodePacked(epochEntropy, "weekly", epoch, lastCheck, epochEndTime))) % remaining;
            lastWeeklyJackpotCheckTs = epochEndTime;
            if (wRand < elapsed) {
                uint256 amt = weeklyJackpotPool;
                weeklyJackpotPool = 0;
                bonus += amt;
                lastWeeklyJackpotWeek = thisWeek;
                lastWeeklyJackpotEpoch = epoch;
                lastWeeklyJackpotAmount = amt;
                ep.isWeeklyJackpot = true;
                emit WeeklyJackpotAwarded(epoch, amt);
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
        if (!_epochs[epoch].isResolved) revert NotResolved();
        if (
            epochResolvedAt[epoch] > 0 &&
            block.timestamp >= epochResolvedAt[epoch] + DUST_SETTLE_DELAY
        ) revert RewardClaimWindowExpired();
        if (epochDustSettled[epoch]) revert RewardClaimWindowExpired();
        if (hasClaimed[msg.sender][epoch]) revert AlreadyClaimed();

        uint256 winTile = _epochs[epoch].winningTile;
        uint256 userBet = userBets[epoch][winTile][msg.sender];
        if (userBet == 0) revert NoWinningBet();

        hasClaimed[msg.sender][epoch] = true;
        uint256 tileTotal = tilePools[epoch][winTile];
        uint256 reward = (_epochs[epoch].rewardPool * userBet) / tileTotal;
        epochRewardClaimed[epoch] += reward;

        token.safeTransfer(msg.sender, reward);
        emit RewardClaimed(epoch, msg.sender, reward);
    }

    function claimRewards(uint256[] calldata claimEpochs) external nonReentrant {
        uint256 len = claimEpochs.length;
        if (len == 0) revert EmptyArray();
        if (len > MAX_CLAIM_BATCH_LENGTH) revert BatchTooLarge();

        uint256 totalReward;
        uint256 epochsClaimedCount;

        for (uint256 i = 0; i < len; ) {
            uint256 epoch = claimEpochs[i];
            if (
                _epochs[epoch].isResolved &&
                !epochDustSettled[epoch] &&
                !hasClaimed[msg.sender][epoch] &&
                !(
                    epochResolvedAt[epoch] > 0 &&
                    block.timestamp >= epochResolvedAt[epoch] + DUST_SETTLE_DELAY
                )
            ) {
                uint256 winTile = _epochs[epoch].winningTile;
                uint256 userBet = userBets[epoch][winTile][msg.sender];
                if (userBet > 0) {
                    hasClaimed[msg.sender][epoch] = true;
                    uint256 tileTotal = tilePools[epoch][winTile];
                    uint256 reward = (_epochs[epoch].rewardPool * userBet) / tileTotal;
                    epochRewardClaimed[epoch] += reward;
                    totalReward += reward;
                    epochsClaimedCount += 1;
                    emit RewardClaimed(epoch, msg.sender, reward);
                }
            }
            unchecked { ++i; }
        }

        if (totalReward == 0) revert NothingToClaim();
        token.safeTransfer(msg.sender, totalReward);
        emit RewardBatchClaimed(msg.sender, totalReward, epochsClaimedCount);
    }

    function _previewRebate(uint256 epoch, address user) internal view returns (uint256) {
        uint256 totalPool = _epochs[epoch].totalPool;
        uint256 rebatePool = epochRebatePool[epoch];
        uint256 userVolume = _getUserEpochVolume(epoch, user);
        if (totalPool == 0 || rebatePool == 0 || userVolume == 0) return 0;
        // Integer division truncates toward zero. Any tiny rebate dust stays in
        // the contract by design rather than complicating the claim path.
        return (rebatePool * userVolume) / totalPool;
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
        return _epochs[epoch].endTime;
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
        resolved = _epochs[epoch].isResolved;
    }

    function getRebateSummary(address user, uint256[] calldata rebateEpochList)
        external
        view
        returns (uint256 totalPending, uint256 claimableEpochs)
    {
        uint256 len = rebateEpochList.length;
        if (len > MAX_CLAIM_BATCH_LENGTH) revert BatchTooLarge();
        for (uint256 i = 0; i < len; ) {
            uint256 epoch = rebateEpochList[i];
            if (_epochs[epoch].isResolved && !rebateClaimed[epoch][user]) {
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
