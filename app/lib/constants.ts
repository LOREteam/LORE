import { getAddress, type Abi } from "viem";
import {
  GAME_ABI as GENERATED_GAME_ABI,
  GAME_EVENTS_ABI as GENERATED_GAME_EVENTS_ABI,
} from "../../config/generated/lineaOreV10Abi";
import {
  getConfiguredContractAddress,
  getConfiguredDeployBlock,
  getConfiguredLineaNetwork,
  getConfiguredLineaTokenAddress,
  getContractHasRebateApi,
  getContractHasTokenGetter,
  getContractRequiresEpochBoundBets,
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
export const CONTRACT_REQUIRES_EPOCH_BOUND_BETS = getContractRequiresEpochBoundBets(
  process.env.NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS,
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
// the winning-tile animation can flash. Non-blocking - betting is never gated
// on reveal state, and the header already shows the new epoch immediately.
// If the winner arrives sooner, we exit after MIN_WINNER_DISPLAY_MS.
export const MAX_REVEAL_DURATION_MS = 2500;

// --- Reliability ---
export const TX_RECEIPT_TIMEOUT_MS = 120_000;
export const MAX_BET_ATTEMPTS = 2;

// --- Leaderboards ---
export const LEADERBOARD_TOP_N = 50;

// --- ABIs ---
export const TOKEN_ABI = [
  {
    name: "approve",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { type: "address", name: "spender" },
      { type: "uint256", name: "amount" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { type: "address", name: "owner" },
      { type: "address", name: "spender" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ type: "address", name: "account" }],
    outputs: [{ type: "uint256" }],
  },
  {
    name: "decimals",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "uint8" }],
  },
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { type: "address", name: "to" },
      { type: "uint256", name: "amount" },
    ],
    outputs: [{ type: "bool" }],
  },
  {
    name: "Transfer",
    type: "event",
    inputs: [
      { type: "address", name: "from", indexed: true },
      { type: "address", name: "to", indexed: true },
      { type: "uint256", name: "value" },
    ],
  },
  {
    name: "ERC20InsufficientAllowance",
    type: "error",
    inputs: [
      { type: "address", name: "spender" },
      { type: "uint256", name: "allowance" },
      { type: "uint256", name: "needed" },
    ],
  },
  {
    name: "ERC20InsufficientBalance",
    type: "error",
    inputs: [
      { type: "address", name: "sender" },
      { type: "uint256", name: "balance" },
      { type: "uint256", name: "needed" },
    ],
  },
] as const satisfies Abi;

export const GAME_ABI = GENERATED_GAME_ABI;
export const GAME_EVENTS_ABI = GENERATED_GAME_EVENTS_ABI;
