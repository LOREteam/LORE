import { parseAbi, getAddress } from "viem";
import {
  getConfiguredContractAddress,
  getConfiguredDeployBlock,
  getConfiguredLineaNetwork,
  getConfiguredLineaTokenAddress,
  getContractHasRebateApi,
  getContractHasTokenGetter,
  getLineaChain,
  getLineaChainName,
  getLineaExplorerTxBaseUrl,
} from "../../config/publicConfig";

// --- Contract Addresses ---
export const APP_NETWORK = getConfiguredLineaNetwork();
export const APP_CHAIN = getLineaChain(APP_NETWORK);
export const APP_CHAIN_ID = APP_CHAIN.id;
export const APP_CHAIN_NAME = getLineaChainName(APP_NETWORK);
export const EXPLORER_TX_BASE_URL = getLineaExplorerTxBaseUrl(APP_NETWORK);
export const CONTRACT_ADDRESS = getAddress(
  getConfiguredContractAddress(process.env.NEXT_PUBLIC_CONTRACT_ADDRESS, APP_NETWORK),
);
export const LINEA_TOKEN_ADDRESS = getAddress(
  getConfiguredLineaTokenAddress(process.env.NEXT_PUBLIC_LINEA_TOKEN_ADDRESS, APP_NETWORK),
);
export const CONTRACT_HAS_TOKEN_GETTER = getContractHasTokenGetter(
  CONTRACT_ADDRESS,
  process.env.NEXT_PUBLIC_CONTRACT_HAS_TOKEN_GETTER,
);
export const CONTRACT_HAS_REBATE_API = getContractHasRebateApi(
  CONTRACT_ADDRESS,
  process.env.NEXT_PUBLIC_CONTRACT_HAS_REBATE_API,
);

// --- Contract Deploy Block ---
export const CONTRACT_DEPLOY_BLOCK = getConfiguredDeployBlock(
  process.env.NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK ??
    process.env.INDEXER_START_BLOCK,
  APP_NETWORK,
);

// --- Game Config ---
export const GRID_SIZE = 25;
export const CHART_HISTORY_LENGTH = 40;
export const CHART_UPDATE_INTERVAL_MS = 400;
export const REFETCH_DELAY_MS = 500;
export const REWARD_SCAN_CHUNK_SIZE = BigInt(200);
export const HISTORY_DEPTH = 120;

// --- Reveal Timing ---
export const MIN_WINNER_DISPLAY_MS = 600;
// Classic short reveal window: grid stays on the old epoch for this long so
// the winning-tile animation can flash. Non-blocking — betting is never gated
// on reveal state, and the header already shows the new epoch immediately.
// If the winner arrives sooner, we exit after MIN_WINNER_DISPLAY_MS.
export const MAX_REVEAL_DURATION_MS = 2500;

// --- Reliability ---
export const TX_RECEIPT_TIMEOUT_MS = 120_000;
export const MAX_BET_ATTEMPTS = 2;

// --- Leaderboards ---
export const LEADERBOARD_TOP_N = 50;

// --- ABIs ---
export const TOKEN_ABI = parseAbi([
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function balanceOf(address account) external view returns (uint256)",
  "function transfer(address to, uint256 amount) external returns (bool)",
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
]);

export const GAME_ABI = parseAbi([
  "function placeBet(uint256 _tileId, uint256 _amount) external",
  "function placeBatchBets(uint256[] calldata _tileIds, uint256[] calldata _amounts) external",
  "function placeBatchBetsSameAmount(uint256[] calldata _tileIds, uint256 _amount) external",
  "function claimReward(uint256 _epoch) external",
  "function claimRewards(uint256[] calldata _epochs) external",
  "function claimEpochRebate(uint256 epoch) external",
  "function claimEpochsRebate(uint256[] calldata claimEpochs) external",
  "function settleEpochDust(uint256 epoch) external",
  "function resolveEpoch(uint256 _epoch) external",
  "function claimResolverRewards() external",
  "function flushProtocolFees() external",
  "function scheduleEpochDuration(uint256 newDuration) external",
  "function cancelEpochDurationChange() external",
  "function scheduleFeeRecipientChange(address newRecipient) external",
  "function cancelFeeRecipientChange() external",
  "function acceptOwnership() external",
  "function token() public view returns (address)",
  "function currentEpoch() public view returns (uint256)",
  "function owner() public view returns (address)",
  "function pendingOwner() public view returns (address)",
  "function feeRecipient() public view returns (address)",
  "function epochDuration() public view returns (uint256)",
  "function getEpochEndTime(uint256 _epoch) external view returns (uint256)",
  "function epochs(uint256) public view returns (uint256 totalPool, uint256 rewardPool, uint256 winningTile, bool isResolved, bool isDailyJackpot, bool isWeeklyJackpot)",
  "function rolloverPool() public view returns (uint256)",
  "function dailyJackpotPool() public view returns (uint256)",
  "function weeklyJackpotPool() public view returns (uint256)",
  "function getJackpotInfo() external view returns (uint256 dailyPool, uint256 weeklyPool, uint256 lastDailyDay, uint256 lastWeeklyWeek, uint256 lastDailyEpoch, uint256 lastWeeklyEpoch, uint256 lastDailyAmount, uint256 lastWeeklyAmount)",
  "function accruedOwnerFees() public view returns (uint256)",
  "function accruedBurnFees() public view returns (uint256)",
  "function pendingResolverRewards(address user) public view returns (uint256)",
  "function epochRebatePool(uint256 epoch) public view returns (uint256)",
  "function rebateClaimed(uint256 epoch, address user) public view returns (bool)",
  "function epochDustSettled(uint256 epoch) public view returns (bool)",
  "function previewRebate(uint256 epoch, address user) external view returns (uint256)",
  "function getRebateInfo(uint256 epoch, address user) external view returns (uint256 rebatePool, uint256 userVolume, uint256 pending, bool claimed, bool resolved)",
  "function getRebateSummary(address user, uint256[] calldata rebateEpochList) external view returns (uint256 totalPending, uint256 claimableEpochs)",
  "function pendingEpochDuration() public view returns (uint256)",
  "function pendingEpochDurationEta() public view returns (uint256)",
  "function pendingEpochDurationEffectiveFromEpoch() public view returns (uint256)",
  "function pendingFeeRecipient() public view returns (address)",
  "function pendingFeeRecipientEta() public view returns (uint256)",
  "function getTileData(uint256 _epoch) external view returns (uint256[] memory pools, uint256[] memory users)",
  "function userBets(uint256 epoch, uint256 tile, address user) public view returns (uint256)",
  "function getUserBetsAll(uint256 epoch, address user) external view returns (uint256[] memory bets)",
  "function tilePools(uint256 epoch, uint256 tile) public view returns (uint256)",
  "function hasClaimed(address user, uint256 epoch) public view returns (bool)",
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
  "error TimerNotEnded()",
  "error AlreadyResolved()",
  "error CanOnlyResolveCurrent()",
  // V6+ custom errors (improves UI error decoding)
  "error NotResolved()",
  "error RebateAlreadyClaimed()",
  "error NoRebateAvailable()",
  "error EmptyArray()",
  "error NothingToClaim()",
  // V8 atomic contract: reject bets in the last LAST_BET_GRACE_SECONDS window.
  "error EpochEnded()",
  "error EpochClosing()",
]);

export const GAME_EVENTS_ABI = parseAbi([
  "event RewardClaimed(uint256 indexed epoch, address indexed user, uint256 reward)",
  "event RewardBatchClaimed(address indexed user, uint256 totalAmount, uint256 epochsClaimed)",
  "event BetPlaced(uint256 indexed epoch, address indexed user, uint256 indexed tileId, uint256 amount)",
  "event BatchBetsPlaced(uint256 indexed epoch, address indexed user, uint256[] tileIds, uint256[] amounts, uint256 totalAmount)",
  "event BatchBetsSameAmountPlaced(uint256 indexed epoch, address indexed user, uint256[] tileIds, uint256 amount, uint256 totalAmount)",
  "event EpochResolved(uint256 indexed epoch, uint256 winningTile, uint256 totalPool, uint256 fee, uint256 rewardPool, uint256 jackpotBonus)",
  "event DailyJackpotAwarded(uint256 indexed epoch, uint256 amount)",
  "event WeeklyJackpotAwarded(uint256 indexed epoch, uint256 amount)",
  "event ProtocolFeesFlushed(uint256 ownerAmount, uint256 burnAmount)",
]);
