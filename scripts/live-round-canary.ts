import { existsSync, statSync } from "node:fs";
import { config as loadDotenv } from "dotenv";
import {
  createPublicClient,
  createWalletClient,
  custom,
  fallback,
  formatEther,
  formatUnits,
  getAddress,
  http,
  parseUnits,
  toFunctionSelector,
  type Address,
  type Hash,
  type PublicClient,
  type Transport,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

import {
  CONTRACT_REQUIRES_EPOCH_BOUND_BETS,
  CONTRACT_DEPLOY_BLOCK,
  GAME_ABI,
  LINEA_TOKEN_ADDRESS,
  TOKEN_ABI,
  CONTRACT_ADDRESS,
  TX_RECEIPT_TIMEOUT_MS,
} from "../app/lib/constants";
import { parseCanaryHealthBaseUrl, parseCanaryHealthPayloads } from "../app/lib/canaryHealthTelemetry";
import {
  assertKeeperFeeBudget,
  getFallbackFeeOverrides,
  getKeeperFeeOverrides,
  getLineaFeeOverrides,
  isLineaFeePolicyError,
  type FeeOverrides,
  type KeeperFeeBudgetKind,
} from "../app/lib/lineaFees";
import { tileIdsToMask } from "../app/lib/tileMask";
import { getConfiguredLineaNetwork, getLineaChain, getPreferredLineaRpcs, getStableLineaReadRpcs } from "../config/publicConfig";
import { estimateGasWithMethodRetry, isEstimateGasMethodUnsupported } from "./lib/estimate-gas-retry";
import { classifyCanaryContractError } from "./lib/canary-contract-error";
import { assertTrustedHealthCredentialOrigin } from "./health-credential-origin.mjs";
import { fetchCanaryHealthPayloadPair } from "./live-canary-health-policy.mjs";
import { sanitizeSupportLogPayload } from "../app/lib/sentrySanitize";
import { recordLineaEstimateGasShadow } from "../app/lib/lineaEstimateGasShadow";
import {
  assertCanaryApprovalPostcondition,
  resolveCanaryAllowancePlan,
} from "./live-canary-approval-policy.mjs";
import {
  appendBoundedLiveCanaryLine,
  createLiveCanaryLogPath,
  initializeLiveCanaryLogFile,
} from "./live-canary-log-path.mjs";
import { assertV10RuntimeIdentity, type V10RuntimeIdentity } from "./v10-runtime-identity";

const APP_NETWORK = getConfiguredLineaNetwork();
const APP_CHAIN = getLineaChain(APP_NETWORK);
if (APP_NETWORK !== "sepolia" || APP_CHAIN.id !== 59141) {
  throw new Error("live-round-canary is testnet-only and requires Linea Sepolia (chain ID 59141).");
}
const EPOCH_BOUND_BITMAP_SELECTOR = toFunctionSelector(
  "placeBatchBetsBitmapForEpoch(uint256,uint32,uint256)",
);
const V10_MATRIX_ONLY = process.argv.includes("--v10-matrix-only");
const V10_MATRIX_EXECUTE = process.argv.includes("--execute");
if (V10_MATRIX_ONLY && !CONTRACT_REQUIRES_EPOCH_BOUND_BETS) {
  throw new Error("V10 matrix mode requires NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS=1");
}
const LIVE_EXECUTION_CONFIRMED =
  process.env.LIVE_TEST_EXECUTE === "1" && process.argv.includes("--execute-live");
const DRY_RUN = !LIVE_EXECUTION_CONFIRMED || (V10_MATRIX_ONLY && !V10_MATRIX_EXECUTE);
const PUBLIC_ADDRESS_ENV_PATH = ".env.live-test-addresses";
const LIVE_WALLET_ENV_PATH = ".env.live-test-wallets";
const CANONICAL_INTEGER_ENV_RE = /^(?:0|[1-9]\d{0,15})$/;
const PUBLIC_ADDRESS_ENV_NAME_RE =
  /^LORE_LIVE_TEST_(?:MANUAL|AUTOMINER_A|AUTOMINER_B|AUTOMINER_C|RESOLVER)_ADDRESS$/;
const SIGNING_ENV_NAME_RE = /(?:^|_)(?:PRIVATE_KEY|MNEMONIC|SEED(?:_PHRASE)?|SIGNING_KEY)(?:_|$)/i;

function assertOptionalEnvFile(path: string, description: string) {
  if (existsSync(path) && !statSync(path).isFile()) {
    throw new Error(`${path} must be ${description}, not a directory`);
  }
}

function loadPublicAddressEnvFileIfPresent() {
  assertOptionalEnvFile(PUBLIC_ADDRESS_ENV_PATH, "an address env file");
  if (!existsSync(PUBLIC_ADDRESS_ENV_PATH)) return;
  const isolatedEnv: Record<string, string> = {};
  const result = loadDotenv({
    path: PUBLIC_ADDRESS_ENV_PATH,
    override: false,
    quiet: true,
    processEnv: isolatedEnv,
  });
  if (result.error) throw new Error(`${PUBLIC_ADDRESS_ENV_PATH} could not be parsed safely`);
  if (Object.keys(result.parsed ?? {}).some((name) => !PUBLIC_ADDRESS_ENV_NAME_RE.test(name))) {
    throw new Error(`${PUBLIC_ADDRESS_ENV_PATH} may contain only public live-test role addresses`);
  }
  for (const [name, value] of Object.entries(result.parsed ?? {})) {
    if (process.env[name] === undefined) process.env[name] = value;
  }
}

function loadSigningEnvFileIfPresent() {
  assertOptionalEnvFile(LIVE_WALLET_ENV_PATH, "a wallet env file");
  if (!existsSync(LIVE_WALLET_ENV_PATH)) return;
  loadDotenv({ path: LIVE_WALLET_ENV_PATH, override: false, quiet: true });
}

function hasSigningMaterialInEnvironment() {
  return Object.entries(process.env).some(
    ([name, value]) => Boolean(value?.trim()) && SIGNING_ENV_NAME_RE.test(name),
  );
}

loadPublicAddressEnvFileIfPresent();
if (DRY_RUN && hasSigningMaterialInEnvironment()) {
  throw new Error("Dry-run canary refuses inherited signing material");
}
const TARGET_ROUNDS = V10_MATRIX_ONLY ? 6 : parseIntegerEnv("LIVE_TEST_TARGET_ROUNDS", 300, 1, 10_000);
const MAX_RESOLVE_TRANSACTIONS = V10_MATRIX_ONLY ? TARGET_ROUNDS - 1 : null;
const TILES_PER_ROUND = parseIntegerEnv("LIVE_TEST_TILES_PER_ROUND", 3, 1, 25);
const SAFE_SECONDS_LEFT = parseIntegerEnv("LIVE_TEST_SAFE_SECONDS_LEFT", 35, 5, 600);
const SAFE_WINDOW_TIMEOUT_MS = parseIntegerEnv("LIVE_TEST_SAFE_WINDOW_TIMEOUT_MS", 180_000, 30_000, 3_600_000);
const SAFE_WINDOW_HEARTBEAT_MS = parseIntegerEnv("LIVE_TEST_SAFE_WINDOW_HEARTBEAT_MS", 30_000, 5_000, 600_000);
const RESOLVE_RETRY_COOLDOWN_MS = parseIntegerEnv("LIVE_TEST_RESOLVE_RETRY_COOLDOWN_MS", 15_000, 5_000, 600_000);
// Randomness can make the mined resolve take a costlier winner branch than eth_estimateGas simulated.
const RESOLVE_GAS_FLOOR = BigInt(parseIntegerEnv("LIVE_TEST_RESOLVE_GAS_FLOOR", 500_000, 100_000, 1_000_000));
const LIVE_GAS_BUFFER_PERCENT = 150n;
const LOOP_PAUSE_MS = parseIntegerEnv("LIVE_TEST_LOOP_PAUSE_MS", 1_500, 0, 120_000);
const MAX_FAILURES = parseIntegerEnv("LIVE_TEST_MAX_FAILURES", 20, 1, 10_000);
const LIVE_LOG_MAX_BYTES = parseIntegerEnv(
  "LIVE_TEST_LOG_MAX_BYTES",
  48 * 1024 * 1024,
  1024 * 1024,
  64 * 1024 * 1024,
);
const FORCE_ALLOWANCE_APPROVE = process.env.LIVE_TEST_FORCE_ALLOWANCE_APPROVE === "1";
const REPEAT_SAME_BET = V10_MATRIX_ONLY || process.env.LIVE_TEST_REPEAT_SAME_BET === "1";
const ALLOW_EMPTY_RESOLVE = process.env.LIVE_TEST_ALLOW_EMPTY_RESOLVE === "1";
const VERBOSE_TARGETS = process.env.LIVE_TEST_VERBOSE_TARGETS === "1";
const VERBOSE_WALLET_PREFLIGHT = process.env.LIVE_TEST_VERBOSE_WALLETS === "1";
const BET_AMOUNT = parseTokenAmountEnv("LIVE_TEST_BET_AMOUNT", "0.01");
const MIN_TOKEN_PER_WALLET = parseTokenAmountEnv("LIVE_TEST_MIN_TOKEN_PER_WALLET", "5");
const MIN_ETH_PER_WALLET = parseTokenAmountEnv("LIVE_TEST_MIN_ETH_PER_WALLET", "0.005");
const RANDOMIZE_ROUNDS = process.env.LIVE_TEST_RANDOMIZE_ROUNDS === "1";
const INJECT_RPC_FAILOVER = process.env.LIVE_TEST_INJECT_RPC_FAILOVER === "1";
const parsedHealthBaseUrl = parseCanaryHealthBaseUrl(process.env.LIVE_TEST_HEALTH_BASE_URL);
const HEALTH_BASE_URL = parsedHealthBaseUrl
  ? assertTrustedHealthCredentialOrigin({
      target: parsedHealthBaseUrl,
      canonicalOrigin: process.env.NEXT_PUBLIC_SITE_URL,
      targetName: "LIVE_TEST_HEALTH_BASE_URL",
    })
  : null;
const HEALTH_SAMPLE_EVERY_ROUNDS = parseIntegerEnv("LIVE_TEST_HEALTH_SAMPLE_EVERY_ROUNDS", 10, 1, 10_000);
const HEALTH_TIMEOUT_MS = parseIntegerEnv("LIVE_TEST_HEALTH_TIMEOUT_MS", 10_000, 1_000, 60_000);
const MIN_TOTAL_BET_AMOUNT = parseTokenAmountEnv(
  "LIVE_TEST_MIN_TOTAL_BET_AMOUNT",
  process.env.LIVE_TEST_MIN_BET_AMOUNT ?? formatUnits(BET_AMOUNT, 18),
);
const MAX_TOTAL_BET_AMOUNT = parseTokenAmountEnv(
  "LIVE_TEST_MAX_TOTAL_BET_AMOUNT",
  process.env.LIVE_TEST_MAX_BET_AMOUNT ?? formatUnits(BET_AMOUNT * BigInt(TILES_PER_ROUND), 18),
);
const MATRIX_TILE_RANGE = V10_MATRIX_ONLY || CONTRACT_REQUIRES_EPOCH_BOUND_BETS;
const MIN_TILES_PER_ROUND = parseIntegerEnv("LIVE_TEST_MIN_TILES_PER_ROUND", RANDOMIZE_ROUNDS || MATRIX_TILE_RANGE ? 1 : TILES_PER_ROUND, 1, 25);
const MAX_TILES_PER_ROUND = parseIntegerEnv("LIVE_TEST_MAX_TILES_PER_ROUND", RANDOMIZE_ROUNDS || MATRIX_TILE_RANGE ? 25 : TILES_PER_ROUND, 1, 25);
const STRESS_SEED = parseIntegerEnv("LIVE_TEST_STRESS_SEED", 13_337, 1, Number.MAX_SAFE_INTEGER);
if (MIN_TOTAL_BET_AMOUNT > MAX_TOTAL_BET_AMOUNT) {
  throw new Error("LIVE_TEST_MIN_TOTAL_BET_AMOUNT must be <= LIVE_TEST_MAX_TOTAL_BET_AMOUNT");
}
if (MIN_TILES_PER_ROUND > MAX_TILES_PER_ROUND) {
  throw new Error("LIVE_TEST_MIN_TILES_PER_ROUND must be <= LIVE_TEST_MAX_TILES_PER_ROUND");
}
const ROLES = (process.env.LIVE_TEST_ROLES ?? "MANUAL,AUTOMINER_A,AUTOMINER_B")
  .split(",")
  .map((item) => item.trim().toUpperCase())
  .filter(Boolean);
const SAFE_ROLE_NAMES = new Set(["MANUAL", "AUTOMINER_A", "AUTOMINER_B", "AUTOMINER_C"]);
if (ROLES.length === 0) {
  throw new Error("LIVE_TEST_ROLES must include at least one supported role");
}
if (new Set(ROLES).size !== ROLES.length) {
  throw new Error("LIVE_TEST_ROLES contains duplicate roles");
}
for (const role of ROLES) {
  if (!SAFE_ROLE_NAMES.has(role)) {
    throw new Error(`LIVE_TEST_ROLES contains unsupported role ${role}`);
  }
}
if (process.env.LIVE_TEST_APPROVE_AMOUNT?.trim()) {
  throw new Error(
    "LIVE_TEST_APPROVE_AMOUNT is no longer supported; each canary role approves its exact declared run cap",
  );
}

type BetMode = "single" | "bitmap" | "sameAmount" | "arrays";

type CanaryWallet = {
  role: string;
  address: Address;
};

type LiveWallet = CanaryWallet & {
  account: PrivateKeyAccount;
};

type RoundPlan = {
  amount: bigint;
  amounts: bigint[];
  targetTotalAmount: bigint;
  tileCount: number;
  totalAmount: bigint;
};

const V10_CANARY_MATRIX = [
  { tileCount: 1, sparse: false },
  { tileCount: 3, sparse: false },
  { tileCount: 3, sparse: true },
  { tileCount: 5, sparse: false },
  { tileCount: 5, sparse: true },
  { tileCount: 25, sparse: false },
] as const;

type RoundEvent = {
  amount: string;
  allowance?: string;
  allowanceWithinRunCap?: boolean;
  amounts?: string[];
  approvalTarget?: string;
  approvalRequired?: boolean;
  atomicAdvance?: boolean;
  chainId?: number;
  contractAddress?: string;
  dbBytes?: number;
  diskFreeBytes?: number;
  durationMs?: number;
  error?: string;
  errorKind?: string;
  enoughEth?: boolean;
  enoughToken?: boolean;
  epoch?: string;
  effectiveGasPrice?: string;
  epochBound?: boolean;
  gasEstimate?: string;
  estimateGasMs?: number;
  gasEstimateFallback?: boolean;
  gasEstimateRetryCount?: number;
  gasLimit?: string;
  gasUsed?: string;
  heapUsedBytes?: number;
  healthRetryCount?: number;
  hash?: Hash;
  mode?: BetMode | "approve" | "diagnostic" | "epoch-wait" | "resolve" | "resolver-candidate" | "preflight" | "summary";
  network?: string;
  networkFeeWei?: string;
  nonceReadMs?: number;
  nonceLatest?: number;
  noncePending?: number;
  participant?: boolean;
  ok: boolean;
  repeat?: boolean;
  prepareMs?: number;
  receiptMs?: number;
  resolverFallbackUsed?: boolean;
  rssBytes?: number;
  rpcLabel?: string;
  rpcFailoverInjected?: boolean;
  role: string;
  round: number;
  runtimeUptimeSeconds?: number;
  runtimeIdentity?: V10RuntimeIdentity;
  sampleKind?: "health";
  secondsLeft?: number;
  sendMs?: number;
  targetTotalAmount?: string;
  targetRounds?: number;
  tileCount?: number;
  tiles?: number[];
  timestamp: string;
  totalAmount?: string;
  txStatus?: string;
  walBytes?: number;
  successes?: number;
  failures?: number;
};

const attemptedResolveEpochs = new Map<string, number>();
const pendingResolveEpochs = new Set<string>();
let emptyResolveBootstrapUsed = false;
let submittedResolveTransactions = 0;
const BATCH_GAS_FALLBACK = 700_000n;
const GENERIC_RPC_LABEL_RE = /^(?:configured|default|fallback|mainnet|rpc|redacted|target|unlabeled)(?:[-_ ]?rpc(?:[-_ ]?label)?(?:[-_ ]?required)?)?$/i;

function getRpcLabel() {
  const label = process.env.LIVE_CANARY_RPC_LABEL?.trim() || process.env.LINEA_RPC_LABEL?.trim();
  if (!label || /^https?:\/\//i.test(label) || GENERIC_RPC_LABEL_RE.test(label)) {
    throw new Error(
      "LIVE_CANARY_RPC_LABEL must be a concrete redacted RPC label, not a raw URL or generic placeholder",
    );
  }
  return label;
}

const RPC_LABEL = getRpcLabel();

function isEstimateGasOutOfGasError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  return lower.includes("eth_estimategas") && lower.includes("out of gas");
}

function redactCanaryErrorMessage(message: string) {
  const sanitized = sanitizeSupportLogPayload({ message }).message;
  const firstLine = (typeof sanitized === "string" ? sanitized : "Unknown error")
    .split(/\r?\n/)
    .find((line) => line.trim())?.trim() || "Unknown error";
  return firstLine
    .replace(/https?:\/\/[^\s"']+/gi, "<redacted-url>")
    .replace(/\b0x[a-fA-F0-9]{80,}\b/g, "<redacted-calldata>")
    .replace(/\b0x[a-fA-F0-9]{40}\b/g, "<redacted-address>")
    .slice(0, 280);
}
function parseIntegerEnv(name: string, fallbackValue: number, min: number, max: number) {
  const raw = process.env[name]?.trim();
  if (raw == null || raw === "") return fallbackValue;
  if (!CANONICAL_INTEGER_ENV_RE.test(raw)) {
    throw new Error(`${name} must be a canonical integer in [${min}, ${max}]`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be a canonical integer in [${min}, ${max}]`);
  }
  return parsed;
}

function parseTokenAmountEnv(name: string, fallbackValue: string) {
  const raw = process.env[name]?.trim() || fallbackValue;
  try {
    const parsed = parseUnits(raw, 18);
    if (parsed <= 0n) throw new Error("must be greater than 0");
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${name} must be a positive LINEA amount, got ${raw}: ${message}`);
  }
}

async function sampleHealth(logPath: string, round: number) {
  if (!HEALTH_BASE_URL) return;
  const secret = process.env.HEALTH_DIAGNOSTICS_SECRET?.trim();
  if (!secret) throw new Error("HEALTH_DIAGNOSTICS_SECRET is required when LIVE_TEST_HEALTH_BASE_URL is configured");
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { runtimePayload, dataSyncPayload } = await fetchCanaryHealthPayloadPair({
        baseUrl: HEALTH_BASE_URL,
        secret,
        timeoutMs: HEALTH_TIMEOUT_MS,
      });
      const sample = parseCanaryHealthPayloads(
        runtimePayload,
        dataSyncPayload,
      );
      writeEvent(logPath, {
        amount: "0",
        ...sample,
        chainId: APP_CHAIN.id,
        contractAddress: CONTRACT_ADDRESS,
        healthRetryCount: attempt,
        mode: "diagnostic",
        network: APP_NETWORK,
        ok: true,
        role: "SYSTEM",
        round,
        rpcLabel: RPC_LABEL,
        sampleKind: "health",
        timestamp: new Date().toISOString(),
      });
      return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }
  writeEvent(logPath, {
    amount: "0",
    error: redactCanaryErrorMessage(lastError instanceof Error ? lastError.message : String(lastError)),
    errorKind: "health-telemetry",
    healthRetryCount: 1,
    mode: "diagnostic",
    ok: false,
    role: "SYSTEM",
    round,
    sampleKind: "health",
    timestamp: new Date().toISOString(),
  });
}

function normalizePrivateKey(raw: string): `0x${string}` {
  const trimmed = raw.trim();
  return trimmed.startsWith("0x") ? (trimmed as `0x${string}`) : (`0x${trimmed}` as `0x${string}`);
}

function loadWallets(): LiveWallet[] {
  loadSigningEnvFileIfPresent();
  const wallets = ROLES.map((role) => {
    const key = process.env[`LORE_LIVE_TEST_${role}_PRIVATE_KEY`]?.trim();
    if (!key) throw new Error(`Missing LORE_LIVE_TEST_${role}_PRIVATE_KEY in .env.live-test-wallets`);
    const account = privateKeyToAccount(normalizePrivateKey(key));
    return { role, address: account.address, account };
  });
  const unique = new Set(wallets.map((wallet) => wallet.address.toLowerCase()));
  if (unique.size !== wallets.length) throw new Error("Live test wallet list contains duplicate addresses");
  return wallets;
}

function loadDryRunWallets(): CanaryWallet[] {
  const wallets = ROLES.map((role) => {
    const rawAddress = process.env[`LORE_LIVE_TEST_${role}_ADDRESS`]?.trim();
    if (!rawAddress) throw new Error(`Missing LORE_LIVE_TEST_${role}_ADDRESS in .env.live-test-addresses`);
    return { role, address: getAddress(rawAddress) };
  });
  const unique = new Set(wallets.map((wallet) => wallet.address.toLowerCase()));
  if (unique.size !== wallets.length) throw new Error("Live test address list contains duplicate addresses");
  return wallets;
}

function createRunLogPath() {
  return createLiveCanaryLogPath();
}

function writeEvent(logPath: string, event: RoundEvent) {
  appendBoundedLiveCanaryLine({
    logPath,
    maxBytes: LIVE_LOG_MAX_BYTES,
    line: `${JSON.stringify({
      network: APP_NETWORK,
      chainId: APP_CHAIN.id,
      contractAddress: CONTRACT_ADDRESS,
      rpcLabel: RPC_LABEL,
      rpcFailoverInjected: INJECT_RPC_FAILOVER,
      ...event,
    })}\n`,
  });
}

function createCanaryTransport(urls: string[]) {
  const transports: Transport[] = urls.map((url) => http(url, { timeout: 20_000, retryCount: 1 }));
  if (INJECT_RPC_FAILOVER) {
    transports.unshift(custom({
      request: async () => {
        throw new Error("Injected RPC transport failure before dispatch");
      },
    }, { key: "injectedFailover", name: "Injected failover transport" }));
  }
  return fallback(transports);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  const safeMessage = redactCanaryErrorMessage(message);
  const contractError = classifyCanaryContractError(error);
  if (contractError) return contractError;
  if (isEstimateGasOutOfGasError(error)) return { kind: "estimate-out-of-gas", message: "eth_estimateGas out of gas" };
  if (isEstimateGasMethodUnsupported(error)) return { kind: "estimate-method-unsupported", message: "eth_estimateGas temporarily unsupported" };
  if (lower.includes("user rejected")) return { kind: "user-rejected", message: safeMessage };
  if (lower.includes("insufficient")) return { kind: "insufficient-funds", message: safeMessage };
  if (lower.includes("nonce too low")) return { kind: "nonce-too-low", message: safeMessage };
  if (lower.includes("already known") || lower.includes("known transaction")) return { kind: "already-known", message: safeMessage };
  if (lower.includes("replacement transaction underpriced")) return { kind: "replacement-underpriced", message: safeMessage };
  if (lower.includes("pending transaction blocked by nonce")) return { kind: "pending-nonce-blocked", message: safeMessage };
  if (lower.includes("timed out while waiting for transaction")) return { kind: "receipt-timeout", message: safeMessage };
  if (lower.includes("epochclosing") || lower.includes("epochended")) return { kind: "late-bet", message: safeMessage };
  if (lower.includes("safe window") || lower.includes("epoch wait")) return { kind: "epoch-window", message: safeMessage };
  if (lower.includes("alreadyresolved")) return { kind: "already-resolved", message: safeMessage };
  if (lower.includes("timernotended")) return { kind: "timer-not-ended", message: safeMessage };
  if (
    lower.includes("network") ||
    lower.includes("timeout") ||
    lower.includes("fetch failed") ||
    lower.includes("http request") ||
    lower.includes("rpc") ||
    lower.includes("connection") ||
    lower.includes("socket") ||
    lower.includes("429")
  ) {
    return { kind: "network", message: safeMessage };
  }
  if (lower.includes("revert") || lower.includes("execution reverted")) return { kind: "revert", message: safeMessage };
  return { kind: "unknown", message: safeMessage };
}
function pickMode(round: number): BetMode {
  if (CONTRACT_REQUIRES_EPOCH_BOUND_BETS) return "bitmap";
  const modes: BetMode[] = ["single", "bitmap", "sameAmount", "arrays"];
  return modes[round % modes.length];
}

async function assertEpochBoundBetCapability(publicClient: PublicClient) {
  if (!CONTRACT_REQUIRES_EPOCH_BOUND_BETS) return;
  const bytecode = await publicClient.getBytecode({ address: CONTRACT_ADDRESS });
  if (!bytecode?.toLowerCase().includes(EPOCH_BOUND_BITMAP_SELECTOR.slice(2).toLowerCase())) {
    throw new Error("Configured contract is missing the required epoch-bound bet selector");
  }
}

function pickTiles(epoch: bigint, round: number, walletIndex: number, count: number) {
  const matrixCase = CONTRACT_REQUIRES_EPOCH_BOUND_BETS ? V10_CANARY_MATRIX[round] : undefined;
  if (matrixCase) {
    const seed = epoch + BigInt(round * 7 + walletIndex * 11);
    if (!matrixCase.sparse) {
      const maxStart = 26 - count;
      const start = Number(seed % BigInt(maxStart)) + 1;
      return Array.from({ length: count }, (_, index) => start + index);
    }
    const start = Number(seed % 25n) + 1;
    return Array.from({ length: count }, (_, index) => ((start - 1 + index * 7) % 25) + 1);
  }
  const tiles: number[] = [];
  let candidate = Number((epoch + BigInt(round * 7 + walletIndex * 11)) % 25n) + 1;
  while (tiles.length < count) {
    if (!tiles.includes(candidate)) tiles.push(candidate);
    candidate = (candidate % 25) + 1;
  }
  return tiles;
}

function seededBasisPoints(round: number, walletIndex: number, salt: number) {
  let value = BigInt(STRESS_SEED);
  value += BigInt(round + 1) * 1_103_515_245n;
  value += BigInt(walletIndex + 1) * 2_654_435_761n;
  value += BigInt(salt + 1) * 97_531n;
  value ^= value >> 13n;
  value *= 1_274_126_177n;
  value ^= value >> 16n;
  return Number(value % 10_001n);
}

function pickRoundPlan(round: number, walletIndex: number, mode: BetMode): RoundPlan {
  const tileRange = MAX_TILES_PER_ROUND - MIN_TILES_PER_ROUND + 1;
  const matrixTileCount = CONTRACT_REQUIRES_EPOCH_BOUND_BETS ? V10_CANARY_MATRIX[round]?.tileCount : undefined;
  if (matrixTileCount != null && (matrixTileCount < MIN_TILES_PER_ROUND || matrixTileCount > MAX_TILES_PER_ROUND)) {
    throw new Error(
      `V10 canary matrix requires ${matrixTileCount} tiles, outside configured ${MIN_TILES_PER_ROUND}-${MAX_TILES_PER_ROUND}`,
    );
  }
  const tileCount =
    matrixTileCount ?? (mode === "single"
      ? 1
      : RANDOMIZE_ROUNDS
        ? MIN_TILES_PER_ROUND + (seededBasisPoints(round, walletIndex, 1) % tileRange)
        : TILES_PER_ROUND);
  const amountRange = MAX_TOTAL_BET_AMOUNT - MIN_TOTAL_BET_AMOUNT;
  const targetTotalAmount = RANDOMIZE_ROUNDS
    ? MIN_TOTAL_BET_AMOUNT + (amountRange * BigInt(seededBasisPoints(round, walletIndex, 2))) / 10_000n
    : BET_AMOUNT * BigInt(tileCount);
  const amount = targetTotalAmount / BigInt(tileCount);
  if (amount <= 0n) {
    throw new Error(`Round ${round} amount is too small for ${tileCount} tiles`);
  }
  const baseTotalAmount = amount * BigInt(tileCount);
  const remainder = targetTotalAmount - baseTotalAmount;
  const amounts =
    mode === "arrays"
      ? Array.from({ length: tileCount }, (_, index) => amount + (BigInt(index) < remainder ? 1n : 0n))
      : Array.from({ length: tileCount }, () => amount);
  const totalAmount = amounts.reduce((sum, value) => sum + value, 0n);
  return { amount, amounts, targetTotalAmount, tileCount, totalAmount };
}

function getPlannedSpendByRole(wallets: CanaryWallet[]) {
  const plannedSpendByRole = new Map<string, bigint>();
  for (let round = 0; round < TARGET_ROUNDS; round += 1) {
    const walletIndex = round % wallets.length;
    const wallet = wallets[walletIndex];
    const mode = pickMode(round);
    const plan = pickRoundPlan(round, walletIndex, mode);
    const plannedSpend = REPEAT_SAME_BET ? plan.totalAmount * 2n : plan.totalAmount;
    plannedSpendByRole.set(wallet.role, (plannedSpendByRole.get(wallet.role) ?? 0n) + plannedSpend);
  }
  return plannedSpendByRole;
}

async function getFeeOverrides(publicClient: PublicClient) {
  try {
    const fees = await publicClient.estimateFeesPerGas();
    return getKeeperFeeOverrides(fees, APP_CHAIN.id) ?? getFallbackFeeOverrides(APP_CHAIN.id, "keeper");
  } catch (error) {
    if (isLineaFeePolicyError(error)) throw error;
    return getFallbackFeeOverrides(APP_CHAIN.id, "keeper");
  }
}

async function getBetFeeOverrides(publicClient: PublicClient) {
  try {
    const fees = await publicClient.estimateFeesPerGas();
    return getLineaFeeOverrides(fees, APP_CHAIN.id) ?? getFallbackFeeOverrides(APP_CHAIN.id, "normal");
  } catch {
    return getFallbackFeeOverrides(APP_CHAIN.id, "normal");
  }
}

function bigintDeltaToBoundedSeconds(upper: bigint, lower: bigint): number {
  const delta = upper - lower;
  const maxSafeSeconds = BigInt(Number.MAX_SAFE_INTEGER);
  const minSafeSeconds = BigInt(Number.MIN_SAFE_INTEGER);
  if (delta > maxSafeSeconds) return Number.MAX_SAFE_INTEGER;
  if (delta < minSafeSeconds) return Number.MIN_SAFE_INTEGER;
  return Number(delta);
}

async function readEpochWindow(publicClient: PublicClient) {
  const epoch = await publicClient.readContract({ address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "currentEpoch" });
  const [endTime, block] = await Promise.all([
    publicClient.readContract({ address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "getEpochEndTime", args: [epoch] }),
    publicClient.getBlock(),
  ]);
  const secondsLeft = bigintDeltaToBoundedSeconds(endTime, block.timestamp);
  return { epoch, secondsLeft };
}

async function resolveIfNeeded(params: {
  logPath: string;
  publicClient: PublicClient;
  resolvers: LiveWallet[];
  transport: ReturnType<typeof fallback>;
}) {
  const { logPath, publicClient, resolvers, transport } = params;
  if (resolvers.length === 0) return;
  const { epoch, secondsLeft } = await readEpochWindow(publicClient);
  if (secondsLeft > 0) return;
  const epochData = await publicClient.readContract({
    address: CONTRACT_ADDRESS,
    abi: GAME_ABI,
    functionName: "epochs",
    args: [epoch],
  });
  const isResolved = Boolean(epochData[3]);
  if (isResolved) return;
  const emptyEpoch = epochData[0] === 0n;
  if (emptyEpoch && (!ALLOW_EMPTY_RESOLVE || emptyResolveBootstrapUsed)) return;
  const epochKey = epoch.toString();
  const now = Date.now();
  if (pendingResolveEpochs.has(epochKey)) return;
  const lastAttemptAt = attemptedResolveEpochs.get(epochKey);
  if (lastAttemptAt != null && now - lastAttemptAt < RESOLVE_RETRY_COOLDOWN_MS) return;
  attemptedResolveEpochs.set(epochKey, now);

  for (const [resolverIndex, resolver] of resolvers.entries()) {
    const startedAt = Date.now();
    let pendingHash: Hash | undefined;
    const walletClient = createWalletClient({ account: resolver.account, chain: APP_CHAIN, transport });
    const [nonceLatest, noncePending] = await Promise.all([
      publicClient.getTransactionCount({ address: resolver.account.address, blockTag: "latest" }),
      publicClient.getTransactionCount({ address: resolver.account.address, blockTag: "pending" }),
    ]);
    if (noncePending > nonceLatest) {
      writeEvent(logPath, { amount: "0", epoch: epoch.toString(), error: "resolver candidate has pending transactions", errorKind: "pending-nonce", mode: "resolver-candidate", ok: false, role: resolver.role, round: -1, secondsLeft, timestamp: new Date().toISOString() });
      continue;
    }
    try {
      const gasEstimate = await publicClient.estimateContractGas({
        account: resolver.account.address,
        address: CONTRACT_ADDRESS,
        abi: GAME_ABI,
        functionName: "resolveEpoch",
        args: [epoch],
      });
      await recordLineaEstimateGasShadow({
        publicClient,
        account: resolver.account.address,
        to: CONTRACT_ADDRESS,
        abi: GAME_ABI,
        functionName: "resolveEpoch",
        args: [epoch],
        baselineGas: gasEstimate,
        tag: "live-canary-resolve",
      });
      let gas = gasEstimate > RESOLVE_GAS_FLOOR ? gasEstimate : RESOLVE_GAS_FLOOR;
      const fees = await getFeeOverrides(publicClient);
      const nativeBalance = await publicClient.getBalance({ address: resolver.account.address });
      const budgetedGasLimit = getBudgetedLiveGasLimit(gas, nativeBalance, fees, "keeper");
      if (budgetedGasLimit == null) {
        writeEvent(logPath, {
          amount: "0",
          epoch: epoch.toString(),
          error: "resolver has insufficient native gas",
          errorKind: "insufficient-native-gas",
          mode: "resolver-candidate",
          ok: false,
          role: resolver.role,
          round: -1,
          secondsLeft,
          timestamp: new Date().toISOString(),
        });
        continue;
      }
      gas = budgetedGasLimit;
      if (
        MAX_RESOLVE_TRANSACTIONS !== null &&
        submittedResolveTransactions >= MAX_RESOLVE_TRANSACTIONS
      ) {
        throw new Error("V10 matrix resolve transaction limit reached");
      }
      const hash = await walletClient.writeContract({
        account: resolver.account,
        chain: APP_CHAIN,
        address: CONTRACT_ADDRESS,
        abi: GAME_ABI,
        functionName: "resolveEpoch",
        args: [epoch],
        gas,
        ...fees,
      } as never);
      pendingHash = hash;
      submittedResolveTransactions += 1;
      const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: TX_RECEIPT_TIMEOUT_MS });
      if (emptyEpoch && receipt.status === "success") emptyResolveBootstrapUsed = true;
      writeEvent(logPath, {
        amount: "0",
        durationMs: Date.now() - startedAt,
        epoch: epoch.toString(),
        effectiveGasPrice: receipt.effectiveGasPrice.toString(),
        gasEstimate: gasEstimate.toString(),
        gasLimit: gas.toString(),
        gasUsed: receipt.gasUsed.toString(),
        hash,
        mode: "resolve",
        networkFeeWei: (receipt.gasUsed * receipt.effectiveGasPrice).toString(),
        ok: receipt.status === "success",
        role: resolver.role,
        round: -1,
        resolverFallbackUsed: resolverIndex > 0,
        secondsLeft,
        timestamp: new Date().toISOString(),
        txStatus: receipt.status,
      });
      return;
    } catch (error) {
      const classified = classifyError(error);
      if (pendingHash && /timed out while waiting for transaction/i.test(classified.message)) pendingResolveEpochs.add(epochKey);
      writeEvent(logPath, {
        amount: "0",
        durationMs: Date.now() - startedAt,
        epoch: epoch.toString(),
        error: classified.message,
        errorKind: classified.kind,
        mode: "resolve",
        ok: false,
        role: resolver.role,
        round: -1,
        secondsLeft,
        timestamp: new Date().toISOString(),
      });
      return;
    }
  }
}

function getBudgetedLiveGasLimit(
  estimatedGas: bigint,
  nativeBalance: bigint,
  feeOverrides: FeeOverrides,
  kind: KeeperFeeBudgetKind,
): bigint | null {
  const gas = (estimatedGas * LIVE_GAS_BUFFER_PERCENT + 99n) / 100n;
  const requiredMaxCost = assertKeeperFeeBudget(feeOverrides, gas, APP_CHAIN.id, kind);
  return nativeBalance >= requiredMaxCost ? gas : null;
}

async function waitForSafeWindow(params: {
  afterEpoch?: bigint | null;
  logPath: string;
  publicClient: PublicClient;
  resolvers: LiveWallet[];
  transport: ReturnType<typeof fallback>;
}) {
  const startedAt = Date.now();
  let nextHeartbeatAt = startedAt + SAFE_WINDOW_HEARTBEAT_MS;
  let lastWindow: Awaited<ReturnType<typeof readEpochWindow>> | null = null;
  for (;;) {
    await resolveIfNeeded(params);
    const window = await readEpochWindow(params.publicClient);
    lastWindow = window;
    if (
      window.secondsLeft <= 0 &&
      // A reverted bet can leave the current epoch empty. The next bet may
      // advance that same expired epoch atomically, without a paid resolver call.
      (params.afterEpoch == null || window.epoch >= params.afterEpoch)
    ) {
      const epochData = await params.publicClient.readContract({
        address: CONTRACT_ADDRESS,
        abi: GAME_ABI,
        functionName: "epochs",
        args: [window.epoch],
      });
      if (epochData[0] === 0n) return { ...window, atomicAdvance: true };
    }
    if (
      window.secondsLeft > SAFE_SECONDS_LEFT &&
      (params.afterEpoch == null || window.epoch > params.afterEpoch)
    ) return { ...window, atomicAdvance: false };
    const now = Date.now();
    if (now >= nextHeartbeatAt) {
      writeEvent(params.logPath, {
        amount: "0",
        durationMs: now - startedAt,
        epoch: window.epoch.toString(),
        mode: "epoch-wait",
        ok: true,
        role: params.resolvers[0]?.role ?? "SYSTEM",
        round: -1,
        secondsLeft: window.secondsLeft,
        timestamp: new Date().toISOString(),
      });
      console.log(
        `[live-canary] waiting for safe epoch window epoch=${window.epoch} secondsLeft=${window.secondsLeft}`,
      );
      nextHeartbeatAt = now + SAFE_WINDOW_HEARTBEAT_MS;
    }
    if (now - startedAt > SAFE_WINDOW_TIMEOUT_MS) {
      throw new Error(
        `safe window wait timeout after ${now - startedAt}ms; lastEpoch=${lastWindow.epoch} lastSecondsLeft=${lastWindow.secondsLeft}`,
      );
    }
    const waitMs = Math.max(5_000, (Math.max(0, window.secondsLeft) + 3) * 1000);
    await delay(Math.min(waitMs, SAFE_WINDOW_HEARTBEAT_MS));
  }
}

async function ensureAllowance(params: {
  logPath: string;
  publicClient: PublicClient;
  requiredAllowance: bigint;
  transport: ReturnType<typeof fallback>;
  wallet: LiveWallet;
}) {
  const { logPath, publicClient, requiredAllowance, transport, wallet } = params;
  const allowance = await publicClient.readContract({
    address: LINEA_TOKEN_ADDRESS,
    abi: TOKEN_ABI,
    functionName: "allowance",
    args: [wallet.account.address, CONTRACT_ADDRESS],
  });
  const allowancePlan = resolveCanaryAllowancePlan({
    currentAllowance: allowance,
    plannedSpend: requiredAllowance,
    forceApprove: FORCE_ALLOWANCE_APPROVE,
  });
  if (allowancePlan.rejectReason) throw new Error(allowancePlan.rejectReason);
  if (!allowancePlan.needsApproval) return;

  const startedAt = Date.now();
  const approveAmount = allowancePlan.approvalTarget;
  const nativeBalance = await publicClient.getBalance({ address: wallet.account.address });
  const fees = await getFeeOverrides(publicClient);
  const gasEstimate = await estimateGasWithMethodRetry(() => publicClient.estimateContractGas({
    account: wallet.account.address,
    address: LINEA_TOKEN_ADDRESS,
    abi: TOKEN_ABI,
    functionName: "approve",
    args: [CONTRACT_ADDRESS, approveAmount],
    ...fees,
  } as never));
  const gas = getBudgetedLiveGasLimit(gasEstimate.value, nativeBalance, fees, "approval");
  if (gas == null) {
    throw new Error("approval has insufficient native balance for the fixed fee budget");
  }
  const walletClient = createWalletClient({ account: wallet.account, chain: APP_CHAIN, transport });
  const hash = await walletClient.writeContract({
    account: wallet.account,
    chain: APP_CHAIN,
    address: LINEA_TOKEN_ADDRESS,
    abi: TOKEN_ABI,
    functionName: "approve",
    args: [CONTRACT_ADDRESS, approveAmount],
    gas,
    ...fees,
  } as never);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: TX_RECEIPT_TIMEOUT_MS });
  const actualAllowance = receipt.status === "success"
    ? await publicClient.readContract({
        address: LINEA_TOKEN_ADDRESS,
        abi: TOKEN_ABI,
        functionName: "allowance",
        args: [wallet.account.address, CONTRACT_ADDRESS],
      })
    : allowance;
  writeEvent(logPath, {
    amount: formatUnits(approveAmount, 18),
    allowance: formatUnits(actualAllowance, 18),
    allowanceWithinRunCap: actualAllowance <= approveAmount,
    approvalTarget: formatUnits(approveAmount, 18),
    durationMs: Date.now() - startedAt,
    effectiveGasPrice: receipt.effectiveGasPrice.toString(),
    gasUsed: receipt.gasUsed.toString(),
    networkFeeWei: (receipt.gasUsed * receipt.effectiveGasPrice).toString(),
    hash,
    mode: "approve",
    ok: receipt.status === "success",
    role: wallet.role,
    round: -1,
    timestamp: new Date().toISOString(),
  });
  if (receipt.status !== "success") throw new Error("approval transaction reverted");
  assertCanaryApprovalPostcondition({ actualAllowance, approvalTarget: approveAmount });
}

async function placeRound(params: {
  epoch: bigint;
  atomicAdvance?: boolean;
  logPath: string;
  mode: BetMode;
  plan: RoundPlan;
  publicClient: PublicClient;
  repeat?: boolean;
  round: number;
  secondsLeft: number;
  tiles: number[];
  transport: ReturnType<typeof fallback>;
  wallet: LiveWallet;
}) {
  const { atomicAdvance = false, epoch, logPath, mode, plan, publicClient, repeat = false, round, secondsLeft, tiles, transport, wallet } = params;
  const startedAt = Date.now();
  const walletClient = createWalletClient({ account: wallet.account, chain: APP_CHAIN, transport });
  const nativeBalance = await publicClient.getBalance({ address: wallet.account.address });
  const fees = await getBetFeeOverrides(publicClient);
  const preparedAt = Date.now();
  const functionName = CONTRACT_REQUIRES_EPOCH_BOUND_BETS
    ? "placeBatchBetsBitmapForEpoch"
    : mode === "single"
      ? "placeBet"
      : mode === "bitmap"
        ? "placeBatchBetsBitmap"
        : mode === "sameAmount"
          ? "placeBatchBetsSameAmount"
          : "placeBatchBets";
  const args = CONTRACT_REQUIRES_EPOCH_BOUND_BETS
    ? [epoch, tileIdsToMask(tiles), plan.amount]
    : mode === "single"
      ? [BigInt(tiles[0]), plan.amounts[0]]
      : mode === "bitmap"
        ? [tileIdsToMask(tiles), plan.amount]
        : mode === "sameAmount"
          ? [tiles.map(BigInt), plan.amount]
          : [tiles.map(BigInt), plan.amounts];
  let gasEstimateFallback = false;
  let gasEstimateRetryCount = 0;
  let gas: bigint;
  try {
    const estimate = await estimateGasWithMethodRetry(() => publicClient.estimateContractGas({
      account: wallet.account.address,
      address: CONTRACT_ADDRESS,
      abi: GAME_ABI,
      functionName,
      args,
      ...fees,
    } as never));
    gas = estimate.value;
    gasEstimateRetryCount = estimate.retryCount;
    await recordLineaEstimateGasShadow({
      publicClient,
      account: wallet.account.address,
      to: CONTRACT_ADDRESS,
      abi: GAME_ABI,
      functionName,
      args,
      baselineGas: gas,
      tag: `live-canary-bet-${mode}`,
    });
  } catch (error) {
    if (mode === "single" || !isEstimateGasOutOfGasError(error)) throw error;
    gas = BATCH_GAS_FALLBACK;
    gasEstimateFallback = true;
  }
  const gasEstimatedAt = Date.now();
  const budgetedGasLimit = getBudgetedLiveGasLimit(gas, nativeBalance, fees, "keeper");
  if (budgetedGasLimit == null) {
    throw new Error("bet has insufficient native balance for the fixed fee budget");
  }
  gas = budgetedGasLimit;
  const [nonceLatest, noncePending] = await Promise.all([
    publicClient.getTransactionCount({ address: wallet.account.address, blockTag: "latest" }),
    publicClient.getTransactionCount({ address: wallet.account.address, blockTag: "pending" }),
  ]);
  const nonceReadAt = Date.now();
  if (noncePending > nonceLatest) {
    throw new Error(`Pending transaction blocked by nonce: latest=${nonceLatest} pending=${noncePending}`);
  }
  const hash = await walletClient.writeContract({
    account: wallet.account,
    chain: APP_CHAIN,
    address: CONTRACT_ADDRESS,
    abi: GAME_ABI,
    functionName,
    args,
    gas,
    ...fees,
  } as never);
  const sentAt = Date.now();
  const sentEvent = {
    amount: formatUnits(plan.amount, 18),
    amounts: mode === "arrays" ? plan.amounts.map((value) => formatUnits(value, 18)) : undefined,
    atomicAdvance,
    epoch: epoch.toString(),
    epochBound: CONTRACT_REQUIRES_EPOCH_BOUND_BETS,
    estimateGasMs: gasEstimatedAt - preparedAt,
    gasEstimateFallback,
    gasEstimateRetryCount,
    hash,
    mode,
    nonceLatest,
    noncePending,
    nonceReadMs: nonceReadAt - gasEstimatedAt,
    prepareMs: preparedAt - startedAt,
    repeat,
    role: wallet.role,
    round,
    secondsLeft,
    sendMs: sentAt - nonceReadAt,
    targetTotalAmount: formatUnits(plan.targetTotalAmount, 18),
    tileCount: plan.tileCount,
    tiles,
    totalAmount: formatUnits(plan.totalAmount, 18),
  };
  let receipt;
  try {
    receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: TX_RECEIPT_TIMEOUT_MS });
  } catch (error) {
    const classified = classifyError(error);
    const receiptAt = Date.now();
    const event: RoundEvent = {
      ...sentEvent,
      durationMs: receiptAt - startedAt,
      error: classified.message,
      errorKind: classified.kind,
      ok: false,
      receiptMs: receiptAt - sentAt,
      timestamp: new Date().toISOString(),
      txStatus: "pending",
    };
    writeEvent(logPath, event);
    return event;
  }
  const receiptAt = Date.now();
  // V9 legacy and V10 protected empty-epoch paths advance exactly one epoch.
  const recordedEpoch = atomicAdvance && receipt.status === "success" ? epoch + 1n : epoch;
  const event: RoundEvent = {
    ...sentEvent,
    durationMs: receiptAt - startedAt,
    effectiveGasPrice: receipt.effectiveGasPrice.toString(),
    errorKind: receipt.status === "reverted" ? "contract-revert" : undefined,
    epoch: recordedEpoch.toString(),
    gasUsed: receipt.gasUsed.toString(),
    networkFeeWei: (receipt.gasUsed * receipt.effectiveGasPrice).toString(),
    ok: receipt.status === "success",
    receiptMs: receiptAt - sentAt,
    timestamp: new Date().toISOString(),
    txStatus: receipt.status,
  };
  writeEvent(logPath, event);
  return event;
}

async function runPreflight(
  logPath: string,
  publicClient: PublicClient,
  wallets: CanaryWallet[],
  plannedSpendByRole: Map<string, bigint>,
) {
  const rows = [];
  for (const wallet of wallets) {
    const plannedSpend = plannedSpendByRole.get(wallet.role) ?? 0n;
    const participates = plannedSpend > 0n;
    const requiredToken = participates
      ? (plannedSpend > MIN_TOKEN_PER_WALLET ? plannedSpend : MIN_TOKEN_PER_WALLET)
      : 0n;
    const [eth, token, allowance, nonceLatest, noncePending] = await Promise.all([
      publicClient.getBalance({ address: wallet.address }),
      publicClient.readContract({
        address: LINEA_TOKEN_ADDRESS,
        abi: TOKEN_ABI,
        functionName: "balanceOf",
        args: [wallet.address],
      }),
      publicClient.readContract({
        address: LINEA_TOKEN_ADDRESS,
        abi: TOKEN_ABI,
        functionName: "allowance",
        args: [wallet.address, CONTRACT_ADDRESS],
      }),
      publicClient.getTransactionCount({ address: wallet.address, blockTag: "latest" }),
      publicClient.getTransactionCount({ address: wallet.address, blockTag: "pending" }),
    ]);
    const nonceQueueClear = !participates || noncePending <= nonceLatest;
    const allowancePlan = resolveCanaryAllowancePlan({
      currentAllowance: allowance,
      plannedSpend,
      forceApprove: FORCE_ALLOWANCE_APPROVE,
    });
    const approvalRequired = allowancePlan.needsApproval;
    const enoughEth = !participates || eth >= MIN_ETH_PER_WALLET;
    const enoughToken = !participates || token >= requiredToken;
    rows.push({
      role: wallet.role,
      address: wallet.address,
      eth: formatEther(eth),
      linea: formatUnits(token, 18),
      allowance: formatUnits(allowance, 18),
      allowanceWithinRunCap: allowancePlan.allowanceWithinRunCap,
      approvalRequired,
      approvalTarget: formatUnits(allowancePlan.approvalTarget, 18),
      participant: allowancePlan.participant,
      plannedSpend: formatUnits(plannedSpend, 18),
      enoughEth,
      enoughToken,
      nonceLatest,
      noncePending,
      nonceQueueClear,
    });
    writeEvent(logPath, {
      amount: "0",
      allowance: formatUnits(allowance, 18),
      allowanceWithinRunCap: allowancePlan.allowanceWithinRunCap,
      approvalTarget: formatUnits(allowancePlan.approvalTarget, 18),
      approvalRequired,
      enoughEth,
      enoughToken,
      errorKind: allowancePlan.rejectReason
        ? "allowance-exceeds-run-cap"
        : !nonceQueueClear
        ? "pending-nonce-blocked"
        : !enoughEth && !enoughToken
          ? "insufficient-native-and-token"
          : !enoughEth
            ? "insufficient-native-gas"
            : !enoughToken
              ? "insufficient-token"
              : undefined,
      mode: "preflight",
      nonceLatest,
      noncePending,
      ok: enoughEth && enoughToken && nonceQueueClear && !allowancePlan.rejectReason,
      participant: allowancePlan.participant,
      role: wallet.role,
      round: -1,
      timestamp: new Date().toISOString(),
      totalAmount: formatUnits(plannedSpend, 18),
    });
  }
  const readyWallets = rows.filter((row) => (
    row.enoughEth && row.enoughToken && row.nonceQueueClear && row.allowanceWithinRunCap
  )).length;
  const approvalsRequired = rows.filter((row) => row.approvalRequired).length;
  console.log(
    `[live-canary] walletPreflight ready=${readyWallets}/${rows.length} approvalsRequired=${approvalsRequired} ` +
      `roles=${rows.map((row) => row.role).join(",")}`,
  );
  if (VERBOSE_WALLET_PREFLIGHT) console.table(rows);
  if (rows.some((row) => !row.allowanceWithinRunCap)) {
    throw new Error("Preflight wallet allowance exceeds declared run cap");
  }
  if (rows.some((row) => !row.enoughEth || !row.enoughToken || !row.nonceQueueClear)) {
    throw new Error("Preflight wallet safety checks failed");
  }
}

async function main() {
  const signingMaterialLoaded = hasSigningMaterialInEnvironment();
  if (DRY_RUN && signingMaterialLoaded) {
    throw new Error("Dry-run canary refuses signing material");
  }
  const readRpcUrls = getStableLineaReadRpcs(process.env.LIVE_TEST_RPC_URL ?? process.env.NEXT_PUBLIC_LINEA_RPCS, APP_NETWORK);
  const broadcastRpcUrls = getPreferredLineaRpcs(process.env.LIVE_TEST_RPC_URL ?? process.env.NEXT_PUBLIC_LINEA_RPCS, APP_NETWORK);
  const readTransport = createCanaryTransport(readRpcUrls);
  const broadcastTransport = createCanaryTransport(broadcastRpcUrls);
  const publicClient = createPublicClient({ chain: APP_CHAIN, transport: readTransport });
  const logPath = createRunLogPath();
  const plannedBetTransactions = TARGET_ROUNDS * (REPEAT_SAME_BET ? 2 : 1);

  initializeLiveCanaryLogFile({ logPath });
  console.log(`[live-canary] network=${APP_NETWORK} chainId=${APP_CHAIN.id}`);
  console.log(`[live-canary] contract=${VERBOSE_TARGETS ? CONTRACT_ADDRESS : "configured"}`);
  console.log(`[live-canary] token=${VERBOSE_TARGETS ? LINEA_TOKEN_ADDRESS : "configured"}`);
  console.log(`[live-canary] rpcLabel=${RPC_LABEL} readRpcCount=${readRpcUrls.length} broadcastRpcCount=${broadcastRpcUrls.length}`);
  console.log(`[live-canary] rpcFailoverInjection=${INJECT_RPC_FAILOVER ? "enabled" : "disabled"}`);
  console.log(`[live-canary] v10Matrix=${V10_MATRIX_ONLY ? "bounded" : "disabled"} execution=${DRY_RUN ? "dry-run" : "enabled"}`);
  console.log(
    `[live-canary] operationalBoundary signingMaterialLoaded=${signingMaterialLoaded} ` +
      `transactionSent=false walletClientCreated=false contractWriteSubmitted=false`,
  );
  console.log(`[live-canary] emptyResolveBootstrap=${ALLOW_EMPTY_RESOLVE ? "enabled" : "disabled"}`);
  if (MAX_RESOLVE_TRANSACTIONS !== null) {
    console.log(`[live-canary] resolveTxLimit=${MAX_RESOLVE_TRANSACTIONS}`);
  }
  console.log(`[live-canary] feeMeasurement repeatSameBet=${REPEAT_SAME_BET ? "enabled" : "disabled"} forceAllowanceApprove=${FORCE_ALLOWANCE_APPROVE ? "enabled" : "disabled"}`);
  console.log(`[live-canary] log=${logPath}`);

  const identitySnapshot = await publicClient.getBlock();
  if (identitySnapshot.number == null) throw new Error("V10 runtime identity snapshot block is unavailable");
  if (!identitySnapshot.hash) throw new Error("V10 runtime identity snapshot block hash is unavailable");
  const runtimeIdentity = await assertV10RuntimeIdentity({
    contractAddress: CONTRACT_ADDRESS,
    deployBlock: CONTRACT_DEPLOY_BLOCK,
    expectedChainId: APP_CHAIN.id,
    reader: publicClient,
    snapshotBlock: identitySnapshot.number,
    snapshotBlockHash: identitySnapshot.hash,
  });
  writeEvent(logPath, {
    amount: "0",
    mode: "preflight",
    ok: true,
    role: "SYSTEM",
    round: -1,
    runtimeIdentity,
    timestamp: new Date().toISOString(),
  });
  console.log(
    `[live-canary] runtimeIdentity deployBlock=${runtimeIdentity.deployBlock} ` +
      `runtimeDigest=${runtimeIdentity.normalizedRuntimeSha256.slice(0, 12)}…`,
  );

  const wallets = DRY_RUN ? loadDryRunWallets() : loadWallets();
  const plannedSpendByRole = getPlannedSpendByRole(wallets);
  const plannedStake = [...plannedSpendByRole.values()].reduce((sum, value) => sum + value, 0n);
  console.log(
    `[live-canary] rounds=${TARGET_ROUNDS} plannedBetTx=${plannedBetTransactions} ` +
      `plannedStake=${formatUnits(plannedStake, 18)} LINEA randomize=${RANDOMIZE_ROUNDS ? "yes" : "no"} ` +
      `configuredTotal=${formatUnits(MIN_TOTAL_BET_AMOUNT, 18)}..${formatUnits(MAX_TOTAL_BET_AMOUNT, 18)} ` +
      `tiles=${MIN_TILES_PER_ROUND}..${MAX_TILES_PER_ROUND}`,
  );

  const contractToken = await publicClient.readContract({
    address: CONTRACT_ADDRESS,
    abi: GAME_ABI,
    functionName: "token",
  });
  if (String(contractToken).toLowerCase() !== LINEA_TOKEN_ADDRESS.toLowerCase()) {
    throw new Error(`Contract token mismatch: expected ${LINEA_TOKEN_ADDRESS}, got ${contractToken}`);
  }
  await assertEpochBoundBetCapability(publicClient);

  await runPreflight(logPath, publicClient, wallets, plannedSpendByRole);
  if (DRY_RUN) return;
  const liveWallets = wallets as LiveWallet[];
  const resolver = process.env.LORE_LIVE_TEST_RESOLVER_PRIVATE_KEY
    ? (() => {
        const account = privateKeyToAccount(normalizePrivateKey(process.env.LORE_LIVE_TEST_RESOLVER_PRIVATE_KEY));
        return { role: "RESOLVER", address: account.address, account };
      })()
    : null;
  const resolverCandidates = [
    ...(resolver ? [resolver] : []),
    ...liveWallets.filter((wallet) => wallet.account.address.toLowerCase() !== resolver?.account.address.toLowerCase()),
  ];
  if (HEALTH_BASE_URL && !process.env.HEALTH_DIAGNOSTICS_SECRET?.trim()) {
    throw new Error("HEALTH_DIAGNOSTICS_SECRET is required when LIVE_TEST_HEALTH_BASE_URL is configured");
  }
  await sampleHealth(logPath, 0);

  for (const wallet of liveWallets) {
    await ensureAllowance({
      logPath,
      publicClient,
      requiredAllowance: plannedSpendByRole.get(wallet.role) ?? 0n,
      transport: broadcastTransport,
      wallet,
    });
  }

  let successes = 0;
  let failures = 0;
  let lastAttemptedEpoch: bigint | null = null;
  const errorKinds = new Map<string, number>();
  for (let round = 0; round < TARGET_ROUNDS; round += 1) {
    const walletIndex = round % liveWallets.length;
    const wallet = liveWallets[walletIndex];
    const mode = pickMode(round);
    const plan = pickRoundPlan(round, walletIndex, mode);
    try {
      const { atomicAdvance, epoch, secondsLeft } = await waitForSafeWindow({
        afterEpoch: lastAttemptedEpoch,
        logPath,
        publicClient,
        resolvers: resolverCandidates,
        transport: broadcastTransport,
      });
      const tiles = pickTiles(epoch, round, walletIndex, plan.tileCount);
      const event = await placeRound({
        atomicAdvance,
        epoch,
        logPath,
        mode,
        plan,
        publicClient,
        round,
        secondsLeft,
        tiles,
        transport: broadcastTransport,
        wallet,
      });
      if (event.ok) {
        successes += 1;
        console.log(
          `[live-canary] ok round=${round + 1}/${TARGET_ROUNDS} role=${wallet.role} mode=${mode} ` +
            `total=${event.totalAmount} tiles=${plan.tileCount} epoch=${event.epoch} tx=${event.hash}`,
        );
        if (REPEAT_SAME_BET) {
          const repeatEvent = await placeRound({
            atomicAdvance: false,
            epoch: BigInt(event.epoch ?? epoch),
            logPath,
            mode,
            plan,
            publicClient,
            repeat: true,
            round,
            secondsLeft,
            tiles,
            transport: broadcastTransport,
            wallet,
          });
          if (!repeatEvent.ok) {
            failures += 1;
            errorKinds.set("repeat-tx-reverted", (errorKinds.get("repeat-tx-reverted") ?? 0) + 1);
            throw new Error(`Repeat fee measurement reverted; see ${logPath}`);
          }
          successes += 1;
          console.log(
            `[live-canary] ok repeat round=${round + 1}/${TARGET_ROUNDS} role=${wallet.role} mode=${mode} ` +
              `total=${repeatEvent.totalAmount} tiles=${plan.tileCount} epoch=${repeatEvent.epoch} tx=${repeatEvent.hash}`,
          );
          lastAttemptedEpoch = BigInt(repeatEvent.epoch ?? epoch);
        } else {
          lastAttemptedEpoch = BigInt(event.epoch ?? epoch);
        }
      } else {
        failures += 1;
        const errorKind = event.errorKind ?? (event.txStatus === "reverted" ? "tx-reverted" : "unknown");
        errorKinds.set(errorKind, (errorKinds.get(errorKind) ?? 0) + 1);
        lastAttemptedEpoch = epoch;
        console.warn(
          `[live-canary] fail round=${round + 1}/${TARGET_ROUNDS} role=${wallet.role} mode=${mode} status=${event.txStatus} epoch=${epoch} tx=${event.hash}`,
        );
        if (failures >= MAX_FAILURES) {
          throw new Error(`Stopping after ${failures} failures; see ${logPath}`);
        }
      }
    } catch (error) {
      const classified = classifyError(error);
      failures += 1;
      errorKinds.set(classified.kind, (errorKinds.get(classified.kind) ?? 0) + 1);
      writeEvent(logPath, {
        amount: formatUnits(plan.amount, 18),
        amounts: mode === "arrays" ? plan.amounts.map((value) => formatUnits(value, 18)) : undefined,
        error: classified.message,
        errorKind: classified.kind,
        mode,
        ok: false,
        role: wallet.role,
        round,
        targetTotalAmount: formatUnits(plan.targetTotalAmount, 18),
        timestamp: new Date().toISOString(),
        tileCount: plan.tileCount,
        totalAmount: formatUnits(plan.totalAmount, 18),
      });
      console.warn(`[live-canary] fail round=${round + 1}/${TARGET_ROUNDS} role=${wallet.role} mode=${mode} kind=${classified.kind}: ${classified.message}`);
      if (REPEAT_SAME_BET) throw error;
      if (failures >= MAX_FAILURES) {
        throw new Error(`Stopping after ${failures} failures; see ${logPath}`);
      }
    }
    if ((round + 1) % HEALTH_SAMPLE_EVERY_ROUNDS === 0) await sampleHealth(logPath, round + 1);
    if (LOOP_PAUSE_MS > 0) await delay(LOOP_PAUSE_MS);
  }

  if (TARGET_ROUNDS % HEALTH_SAMPLE_EVERY_ROUNDS !== 0) await sampleHealth(logPath, TARGET_ROUNDS);

  writeEvent(logPath, {
    amount: "0",
    failures,
    mode: "summary",
    ok: failures === 0,
    role: "SYSTEM",
    round: TARGET_ROUNDS,
    successes,
    targetRounds: TARGET_ROUNDS,
    timestamp: new Date().toISOString(),
  });
  console.log("[live-canary] summary");
  console.log(JSON.stringify({
    successes,
    failures,
    errorKinds: Object.fromEntries(errorKinds.entries()),
    logPath,
  }, null, 2));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown error";
  console.error(`[live-canary] failed: ${redactCanaryErrorMessage(message)}`);
  process.exitCode = 1;
});
