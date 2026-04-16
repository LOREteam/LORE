// SPDX-License-Identifier: UNLICENSED
// Reference copy of old atomic-resolve V7 from LOREteam/LORE GitHub.
// Kept here for comparison while building V8. NOT for deployment.
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
 *         making rebate accounting cheaper via per-user epoch volume tracking.
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
    // ... (remainder identical to source user pasted)
}
