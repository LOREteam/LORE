import { parseAbi, getAddress } from "viem";
import { lineaSepolia } from "viem/chains";

// --- Contract Addresses ---
export const CONTRACT_ADDRESS = getAddress("0x2a98cfb661710d11c47e958856859f7b474e0107");
export const LINEA_TOKEN_ADDRESS = getAddress("0xa25bec3ed257a31ee62f1418ec3c3571aa051107");
export const APP_CHAIN_ID = lineaSepolia.id;

// --- Contract Deploy Block (Linea Sepolia) ---
export const CONTRACT_DEPLOY_BLOCK = BigInt(25663555);

// --- Game Config ---
export const GRID_SIZE = 25;
export const CHART_HISTORY_LENGTH = 40;
export const CHART_UPDATE_INTERVAL_MS = 400;
export const REFETCH_DELAY_MS = 500;
export const REWARD_SCAN_CHUNK_SIZE = BigInt(200);
export const HISTORY_DEPTH = 120;

// --- Reveal Timing ---
export const MIN_WINNER_DISPLAY_MS = 600;
export const MAX_REVEAL_DURATION_MS = 10000;

// --- Reliability ---
export const TX_RECEIPT_TIMEOUT_MS = 60_000;
export const MAX_BET_ATTEMPTS = 5;

// --- Leaderboards ---
export const LEADERBOARD_TOP_N = 50;

// --- ABIs ---
export const TOKEN_ABI = parseAbi([
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function transfer(address to, uint256 amount) external returns (bool)",
]);

export const GAME_ABI = parseAbi([
  "function placeBet(uint256 _tileId, uint256 _amount) external",
  "function placeBatchBets(uint256[] calldata _tileIds, uint256[] calldata _amounts) external",
  "function claimReward(uint256 _epoch) external",
  "function resolveEpoch(uint256 _epoch) external",
  "function registerReferralCode() external",
  "function setReferrer(bytes6 code) external",
  "function claimReferralEarnings() external",
  "function claimResolverRewards() external",
  "function flushProtocolFees() external",
  "function scheduleEpochDuration(uint256 newDuration) external",
  "function cancelEpochDurationChange() external",
  "function currentEpoch() public view returns (uint256)",
  "function owner() public view returns (address)",
  "function epochDuration() public view returns (uint256)",
  "function getEpochEndTime(uint256 _epoch) public view returns (uint256)",
  "function epochs(uint256) public view returns (uint256 totalPool, uint256 rewardPool, uint256 winningTile, bool isResolved, bool isDailyJackpot, bool isWeeklyJackpot)",
  "function rolloverPool() public view returns (uint256)",
  "function dailyJackpotPool() public view returns (uint256)",
  "function weeklyJackpotPool() public view returns (uint256)",
  "function getJackpotInfo() external view returns (uint256 dailyPool, uint256 weeklyPool, uint256 lastDailyDay, uint256 lastWeeklyWeek, uint256 lastDailyEpoch, uint256 lastWeeklyEpoch, uint256 lastDailyAmount, uint256 lastWeeklyAmount)",
  "function accruedOwnerFees() public view returns (uint256)",
  "function accruedBurnFees() public view returns (uint256)",
  "function pendingResolverRewards(address user) public view returns (uint256)",
  "function pendingEpochDuration() public view returns (uint256)",
  "function pendingEpochDurationEta() public view returns (uint256)",
  "function pendingEpochDurationEffectiveFromEpoch() public view returns (uint256)",
  "function getTileData(uint256 _epoch) external view returns (uint256[] memory pools, uint256[] memory users)",
  "function userBets(uint256 epoch, uint256 tile, address user) public view returns (uint256)",
  "function getUserBetsAll(uint256 epoch, address user) external view returns (uint256[] memory bets)",
  "function tilePools(uint256 epoch, uint256 tile) public view returns (uint256)",
  "function hasClaimed(address user, uint256 epoch) public view returns (bool)",
  "function codeToAddress(bytes6 code) public view returns (address)",
  "function addressToCode(address user) public view returns (bytes6)",
  "function referrerOf(address user) public view returns (address)",
  "function pendingReferralEarnings(address user) public view returns (uint256)",
  "function totalReferralEarnings(address user) public view returns (uint256)",
  "function referralCount(address user) public view returns (uint256)",
  "function getReferralInfo(address user) external view returns (address referrer, bytes6 code, uint256 pending, uint256 totalEarned, uint256 referredUsers)",
  "error TimerNotEnded()",
  "error CanOnlyResolveCurrent()",
]);

export const GAME_EVENTS_ABI = parseAbi([
  "event RewardClaimed(uint256 indexed epoch, address indexed user, uint256 reward)",
  "event BetPlaced(uint256 indexed epoch, address indexed user, uint256 indexed tileId, uint256 amount)",
  "event BatchBetsPlaced(uint256 indexed epoch, address indexed user, uint256[] tileIds, uint256[] amounts, uint256 totalAmount)",
  "event EpochResolved(uint256 indexed epoch, uint256 winningTile, uint256 totalPool, uint256 fee, uint256 rewardPool, uint256 jackpotBonus)",
  "event DailyJackpotAwarded(uint256 indexed epoch, uint256 amount)",
  "event WeeklyJackpotAwarded(uint256 indexed epoch, uint256 amount)",
]);
