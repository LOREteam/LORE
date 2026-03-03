// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";

/**
 * @title LineaOreV5
 * @notice On-chain prediction mining game with daily & weekly jackpots.
 *         Fee split: 2% daily jackpot, 3% weekly jackpot, 2% dev (half to referrers), 1% burn.
 *         Each day/week, one random resolved epoch awards the accumulated jackpot pool
 *         to the winning-tile holders. Jackpot only triggers when someone bets on the
 *         winning tile; otherwise the base reward feeds the jackpot pools, growing them.
 */
contract LineaOreV5 is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;

    uint256 public constant GRID_SIZE = 25;
    uint256 public constant DAILY_JACKPOT_PERCENT = 2;
    uint256 public constant WEEKLY_JACKPOT_PERCENT = 3;
    uint256 public constant DEV_FEE_PERCENT = 2;
    uint256 public constant BURN_FEE_PERCENT = 1;
    uint256 public constant RESOLVER_REWARD_BPS = 5; // 0.05%
    uint256 public constant BPS_DENOMINATOR = 10_000;
    uint256 public constant FEE_FLUSH_INTERVAL_EPOCHS = 120;
    uint256 public constant MAX_REFERRERS_PER_EPOCH = 200;
    uint256 public constant EPOCH_DURATION_TIMELOCK = 30 minutes;
    uint256 public constant REFERRAL_SETTLE_DELAY = 30 days;
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;
    uint256 internal constant MONDAY_OFFSET = 3 days; // Unix epoch = Thu 00:00 UTC; +3d shifts week boundary to Monday 00:00 UTC

    uint256 public epochDuration = 60;
    uint256 public currentEpoch = 1;
    uint256 public epochStartTime;
    uint256 public pendingEpochDuration;
    uint256 public pendingEpochDurationEta;
    uint256 public pendingEpochDurationEffectiveFromEpoch;

    // ── Rollover (no-winner carry-over) ──
    uint256 public rolloverPool;

    // ── Jackpot state ──
    uint256 public dailyJackpotPool;
    uint256 public weeklyJackpotPool;
    uint256 public lastDailyJackpotDay;     // block.timestamp / 1 days
    uint256 public lastWeeklyJackpotWeek;   // _mondayWeek(block.timestamp)
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

    // ── Referral codes ──
    mapping(bytes6 => address) public codeToAddress;
    mapping(address => bytes6) public addressToCode;

    // ── Referral state ──
    mapping(address => address) public referrerOf;
    mapping(address => uint256) public referralCount;
    mapping(address => uint256) public pendingReferralEarnings;
    mapping(address => uint256) public totalReferralEarnings;
    mapping(address => uint256) public referralClaimCursor;
    mapping(address => uint256[]) internal referrerEpochs;

    // ── Referral volume tracking per epoch ──
    mapping(uint256 => uint256) public epochReferralVolume;
    mapping(uint256 => mapping(address => uint256)) public epochReferrerVolume;
    mapping(uint256 => uint256) public epochReferrerShare;
    mapping(uint256 => uint256) public epochReferrerClaimedAmount;
    mapping(uint256 => uint256) public epochReferrerClaimedCount;
    mapping(uint256 => bool) public epochReferrerSettled;
    mapping(uint256 => address[]) internal epochReferrers;
    mapping(uint256 => mapping(address => bool)) internal epochReferrerAdded;

    // ── Core state ──
    mapping(uint256 => Epoch) public epochs;
    mapping(uint256 => mapping(uint256 => uint256)) public tilePools;
    mapping(uint256 => mapping(uint256 => uint256)) public tileUsersCount;
    mapping(uint256 => mapping(uint256 => mapping(address => uint256))) public userBets;
    mapping(address => mapping(uint256 => bool)) public hasClaimed;
    mapping(uint256 => uint256) public epochRewardClaimed;
    mapping(uint256 => uint256) public epochWinnerClaims;
    mapping(uint256 => bool) public epochDustRolled;
    mapping(uint256 => uint256) public epochResolvedAt;
    uint256 public accruedOwnerFees;
    uint256 public accruedBurnFees;
    mapping(address => uint256) public pendingResolverRewards;

    // ── Events ──
    event BetPlaced(uint256 indexed epoch, address indexed user, uint256 indexed tileId, uint256 amount);
    event BatchBetsPlaced(uint256 indexed epoch, address indexed user, uint256[] tileIds, uint256[] amounts, uint256 totalAmount);
    event EpochResolved(uint256 indexed epoch, uint256 winningTile, uint256 totalPool, uint256 fee, uint256 rewardPool, uint256 jackpotBonus);
    event DailyJackpotAwarded(uint256 indexed epoch, uint256 amount);
    event WeeklyJackpotAwarded(uint256 indexed epoch, uint256 amount);
    event RewardClaimed(uint256 indexed epoch, address indexed user, uint256 reward);
    event RewardDustRolled(uint256 indexed epoch, uint256 dustAddedToJackpots);
    event ResolverRewardAccrued(address indexed resolver, uint256 indexed epoch, uint256 amount);
    event ResolverRewardClaimed(address indexed resolver, uint256 amount);
    event ProtocolFeesFlushed(uint256 ownerAmount, uint256 burnAmount);
    event ReferralCodeRegistered(address indexed user, bytes6 code);
    event ReferrerSet(address indexed user, address indexed referrer);
    event ReferralEarningsAccrued(address indexed referrer, uint256 epoch, uint256 amount);
    event ReferralEarningsClaimed(address indexed referrer, uint256 amount);
    event EpochDurationChangeScheduled(uint256 oldValue, uint256 newValue, uint256 eta, uint256 effectiveFromEpoch);
    event EpochDurationChangeCancelled(uint256 pendingValue);
    event EpochDurationUpdated(uint256 oldValue, uint256 newValue);

    // ── Errors ──
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
    error NoPendingEpochDurationChange();
    error NothingToFlush();
    error InvalidReferrer();
    error ReferrerAlreadySet();
    error CodeAlreadyRegistered();
    error CodeCollision();
    error InvalidCode();
    error NothingToClaim();

    constructor(address tokenAddress) Ownable(msg.sender) {
        require(tokenAddress != address(0), "token=0");
        token = IERC20(tokenAddress);
        epochStartTime = block.timestamp;
    }

    // ==================== Referral ====================

    function registerReferralCode() external {
        if (addressToCode[msg.sender] != bytes6(0)) revert CodeAlreadyRegistered();
        bytes6 code = bytes6(keccak256(abi.encodePacked(msg.sender)));
        if (codeToAddress[code] != address(0)) revert CodeCollision();
        codeToAddress[code] = msg.sender;
        addressToCode[msg.sender] = code;
        emit ReferralCodeRegistered(msg.sender, code);
    }

    function setReferrer(bytes6 code) external {
        if (code == bytes6(0)) revert InvalidCode();
        if (referrerOf[msg.sender] != address(0)) revert ReferrerAlreadySet();
        address ref = codeToAddress[code];
        if (ref == address(0) || ref == msg.sender) revert InvalidReferrer();
        referrerOf[msg.sender] = ref;
        referralCount[ref] += 1;
        emit ReferrerSet(msg.sender, ref);
    }

    function claimReferralEarnings() external nonReentrant {
        _accrueReferralFor(msg.sender, type(uint256).max);
        uint256 amount = pendingReferralEarnings[msg.sender];
        if (amount == 0) revert NothingToClaim();
        pendingReferralEarnings[msg.sender] = 0;
        token.safeTransfer(msg.sender, amount);
        emit ReferralEarningsClaimed(msg.sender, amount);
    }

    function accrueReferralBatch(uint256 maxEpochs) external {
        require(maxEpochs > 0 && maxEpochs <= 100, "maxEpochs must be 1..100");
        _accrueReferralFor(msg.sender, maxEpochs);
    }

    function claimAccruedReferralEarnings() external nonReentrant {
        uint256 amount = pendingReferralEarnings[msg.sender];
        if (amount == 0) revert NothingToClaim();
        pendingReferralEarnings[msg.sender] = 0;
        token.safeTransfer(msg.sender, amount);
        emit ReferralEarningsClaimed(msg.sender, amount);
    }

    function referralEpochsRemaining(address user) external view returns (uint256) {
        uint256 len = referrerEpochs[user].length;
        uint256 cursor = referralClaimCursor[user];
        return cursor >= len ? 0 : len - cursor;
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
        _flushProtocolFees();
    }

    // ==================== Betting ====================

    function _autoResolveIfNeeded() internal {
        if (
            !epochs[currentEpoch].isResolved &&
            block.timestamp >= epochStartTime + epochDuration
        ) {
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

    function placeBatchBets(
        uint256[] calldata tileIds,
        uint256[] calldata amounts
    ) external nonReentrant {
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
        if (userBets[currentEpoch][tileId][user] == 0) {
            tileUsersCount[currentEpoch][tileId] += 1;
        }
        userBets[currentEpoch][tileId][user] += amount;
        tilePools[currentEpoch][tileId] += amount;
        epochs[currentEpoch].totalPool += amount;
        _trackReferralVolume(user, amount);
    }

    function _trackReferralVolume(address user, uint256 amount) internal {
        address ref = referrerOf[user];
        if (ref == address(0)) return;
        if (!epochReferrerAdded[currentEpoch][ref]) {
            if (epochReferrers[currentEpoch].length >= MAX_REFERRERS_PER_EPOCH) return;
            epochReferrers[currentEpoch].push(ref);
            epochReferrerAdded[currentEpoch][ref] = true;
            referrerEpochs[ref].push(currentEpoch);
        }
        epochReferrerVolume[currentEpoch][ref] += amount;
        epochReferralVolume[currentEpoch] += amount;
    }

    // ==================== Resolution ====================

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
        uint256 devFee;
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

        L.winningTile = (uint256(
            keccak256(abi.encodePacked(
                block.prevrandao,
                blockhash(block.number - 1),
                L.epoch,
                L.totalPoolWithRollover,
                dailyJackpotPool,
                weeklyJackpotPool
            ))
        ) % GRID_SIZE) + 1;

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

        emit EpochResolved(L.epoch, L.winningTile, L.totalPoolWithRollover, L.devFee + L.burnAmount, ep.rewardPool, L.jackpotBonus);
        currentEpoch = L.epoch + 1;
        epochStartTime = block.timestamp;
        _applyPendingEpochDurationIfReady();
        if (L.epoch % FEE_FLUSH_INTERVAL_EPOCHS == 0) {
            _flushProtocolFees();
        }
    }

    function _splitFees(ResolveLocals memory L) internal {
        uint256 pool = L.totalPoolWithRollover;
        uint256 dailyAccrual = (pool * DAILY_JACKPOT_PERCENT) / 100;
        uint256 weeklyAccrual = (pool * WEEKLY_JACKPOT_PERCENT) / 100;
        L.devFee = (pool * DEV_FEE_PERCENT) / 100;
        L.burnAmount = (pool * BURN_FEE_PERCENT) / 100;
        uint256 resolverReward = (pool * RESOLVER_REWARD_BPS) / BPS_DENOMINATOR;
        if (resolverReward > L.devFee) resolverReward = L.devFee;
        L.baseReward = pool - dailyAccrual - weeklyAccrual - L.devFee - L.burnAmount;

        dailyJackpotPool += dailyAccrual;
        weeklyJackpotPool += weeklyAccrual;

        _accrueDevFee(L.devFee - resolverReward, L.epoch);
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
        // ── Daily jackpot (time-based hazard; resilient to irregular resolve cadence) ──
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

        // ── Weekly jackpot (Monday-based, time-based hazard) ──
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
     * @dev Accrue 2% dev fee: half to referrers (pending balance), half to owner.
     */
    function _accrueDevFee(uint256 devFee, uint256 epoch) internal {
        if (devFee == 0) return;

        uint256 referrerShare = devFee / 2;
        uint256 ownerShare = devFee - referrerShare;
        uint256 totalRefVolume = epochReferralVolume[epoch];

        if (totalRefVolume == 0 || referrerShare == 0) {
            accruedOwnerFees += devFee;
            return;
        }

        epochReferrerShare[epoch] = referrerShare;
        accruedOwnerFees += ownerShare;
    }

    // ==================== Claims ====================

    function claimReward(uint256 epoch) external nonReentrant {
        if (!epochs[epoch].isResolved) revert NotResolved();
        if (hasClaimed[msg.sender][epoch]) revert AlreadyClaimed();

        uint256 winTile = epochs[epoch].winningTile;
        uint256 userBet = userBets[epoch][winTile][msg.sender];
        if (userBet == 0) revert NoWinningBet();

        hasClaimed[msg.sender][epoch] = true;
        uint256 tileTotal = tilePools[epoch][winTile];
        uint256 reward = (epochs[epoch].rewardPool * userBet) / tileTotal;
        epochRewardClaimed[epoch] += reward;
        epochWinnerClaims[epoch] += 1;

        // Dust → jackpot pools (not rollover)
        if (!epochDustRolled[epoch] && epochWinnerClaims[epoch] >= tileUsersCount[epoch][winTile]) {
            uint256 rewardPool = epochs[epoch].rewardPool;
            uint256 claimed = epochRewardClaimed[epoch];
            if (rewardPool > claimed) {
                uint256 dust = rewardPool - claimed;
                uint256 totalJP = DAILY_JACKPOT_PERCENT + WEEKLY_JACKPOT_PERCENT;
                uint256 dailyDust = (dust * DAILY_JACKPOT_PERCENT) / totalJP;
                dailyJackpotPool += dailyDust;
                weeklyJackpotPool += (dust - dailyDust);
                emit RewardDustRolled(epoch, dust);
            }
            epochDustRolled[epoch] = true;
        }

        token.safeTransfer(msg.sender, reward);
        emit RewardClaimed(epoch, msg.sender, reward);
    }

    function _accrueReferralFor(address ref, uint256 maxEpochs) internal {
        uint256[] storage refsEpochs = referrerEpochs[ref];
        uint256 cursor = referralClaimCursor[ref];
        uint256 len = refsEpochs.length;
        if (cursor >= len || maxEpochs == 0) return;

        uint256 endExclusive = cursor + maxEpochs;
        if (endExclusive > len) endExclusive = len;
        uint256 addPending;

        for (uint256 i = cursor; i < endExclusive; ) {
            uint256 epoch = refsEpochs[i];
            uint256 share = epochReferrerShare[epoch];
            if (share > 0) {
                uint256 totalRefVolume = epochReferralVolume[epoch];
                uint256 vol = epochReferrerVolume[epoch][ref];
                if (totalRefVolume > 0 && vol > 0) {
                    uint256 payout = (share * vol) / totalRefVolume;
                    if (payout > 0) {
                        addPending += payout;
                        epochReferrerClaimedAmount[epoch] += payout;
                        emit ReferralEarningsAccrued(ref, epoch, payout);
                    }
                    epochReferrerClaimedCount[epoch] += 1;
                    if (!epochReferrerSettled[epoch]) {
                        uint256 refCount = epochReferrers[epoch].length;
                        if (epochReferrerClaimedCount[epoch] >= refCount) {
                            uint256 claimedAmt = epochReferrerClaimedAmount[epoch];
                            if (share > claimedAmt) {
                                accruedOwnerFees += (share - claimedAmt);
                            }
                            epochReferrerSettled[epoch] = true;
                        }
                    }
                }
            }
            unchecked { ++i; }
        }

        if (addPending > 0) {
            pendingReferralEarnings[ref] += addPending;
            totalReferralEarnings[ref] += addPending;
        }
        referralClaimCursor[ref] = endExclusive;
    }

    function _previewReferralPending(address ref) internal view returns (uint256) {
        uint256[] storage refsEpochs = referrerEpochs[ref];
        uint256 cursor = referralClaimCursor[ref];
        uint256 len = refsEpochs.length;
        if (cursor >= len) return 0;

        uint256 pending;
        for (uint256 i = cursor; i < len; ) {
            uint256 epoch = refsEpochs[i];
            uint256 share = epochReferrerShare[epoch];
            if (share > 0) {
                uint256 totalRefVolume = epochReferralVolume[epoch];
                uint256 vol = epochReferrerVolume[epoch][ref];
                if (totalRefVolume > 0 && vol > 0) {
                    pending += (share * vol) / totalRefVolume;
                }
            }
            unchecked { ++i; }
        }
        return pending;
    }

    function _flushProtocolFees() internal {
        uint256 ownerAmount = accruedOwnerFees;
        uint256 burnAmount = accruedBurnFees;
        if (ownerAmount == 0 && burnAmount == 0) return;

        if (ownerAmount > 0) {
            accruedOwnerFees = 0;
            token.safeTransfer(owner(), ownerAmount);
        }
        if (burnAmount > 0) {
            accruedBurnFees = 0;
            token.safeTransfer(BURN_ADDRESS, burnAmount);
        }
        emit ProtocolFeesFlushed(ownerAmount, burnAmount);
    }

    // ==================== Views ====================

    function getTileData(uint256 epoch) external view returns (uint256[] memory pools, uint256[] memory users) {
        pools = new uint256[](GRID_SIZE);
        users = new uint256[](GRID_SIZE);
        for (uint256 i = 0; i < GRID_SIZE; ) {
            pools[i] = tilePools[epoch][i + 1];
            users[i] = tileUsersCount[epoch][i + 1];
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

    function getEpochEndTime(uint256 epoch) public view returns (uint256) {
        if (epoch == currentEpoch) return epochStartTime + epochDuration;
        return 0;
    }

    function getJackpotInfo() external view returns (
        uint256 dailyPool,
        uint256 weeklyPool,
        uint256 lastDailyDay,
        uint256 lastWeeklyWeek,
        uint256 lastDailyEpoch_,
        uint256 lastWeeklyEpoch_,
        uint256 lastDailyAmount_,
        uint256 lastWeeklyAmount_
    ) {
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

    function getReferralInfo(address user) external view returns (
        address referrer,
        bytes6 code,
        uint256 pending,
        uint256 totalEarned,
        uint256 referredUsers
    ) {
        uint256 pendingLive = pendingReferralEarnings[user] + _previewReferralPending(user);
        return (
            referrerOf[user],
            addressToCode[user],
            pendingLive,
            totalReferralEarnings[user],
            referralCount[user]
        );
    }

    // ==================== Admin ====================

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

    function settleStaleReferralEpoch(uint256 epoch) external onlyOwner {
        require(!epochReferrerSettled[epoch], "Already settled");
        require(epochs[epoch].isResolved, "Epoch not resolved");
        require(
            epochResolvedAt[epoch] > 0 && block.timestamp >= epochResolvedAt[epoch] + REFERRAL_SETTLE_DELAY,
            "Settlement delay not reached"
        );
        uint256 share = epochReferrerShare[epoch];
        uint256 claimedAmt = epochReferrerClaimedAmount[epoch];
        if (share > claimedAmt) {
            accruedOwnerFees += (share - claimedAmt);
        }
        epochReferrerSettled[epoch] = true;
    }

}
