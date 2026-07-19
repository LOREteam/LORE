import "dotenv/config";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { config as loadDotenv } from "dotenv";
import {
  createPublicClient,
  createWalletClient,
  custom,
  fallback,
  formatEther,
  formatUnits,
  http,
  parseUnits,
  type Hash,
  type PublicClient,
  type Transport,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

import { GAME_ABI, LINEA_TOKEN_ADDRESS, TOKEN_ABI, CONTRACT_ADDRESS, TX_RECEIPT_TIMEOUT_MS } from "../app/lib/constants";
import { parseCanaryHealthBaseUrl, parseCanaryHealthPayloads } from "../app/lib/canaryHealthTelemetry";
import {
  clampKeeperFeeOverridesToBalance,
  getAffordableKeeperGasLimit,
  getFallbackFeeOverrides,
  getKeeperFeeOverrides,
  getLineaFeeOverrides,
} from "../app/lib/lineaFees";
import { tileIdsToMask } from "../app/lib/tileMask";
import { getConfiguredLineaNetwork, getLineaChain, getPreferredLineaRpcs, getStableLineaReadRpcs } from "../config/publicConfig";
import { estimateGasWithMethodRetry, isEstimateGasMethodUnsupported } from "./lib/estimate-gas-retry";

loadDotenv({ path: ".env.live-test-wallets", override: false });

const APP_NETWORK = getConfiguredLineaNetwork();
const APP_CHAIN = getLineaChain(APP_NETWORK);
const TARGET_ROUNDS = parseIntegerEnv("LIVE_TEST_TARGET_ROUNDS", 300, 1, 10_000);
const TILES_PER_ROUND = parseIntegerEnv("LIVE_TEST_TILES_PER_ROUND", 3, 1, 25);
const SAFE_SECONDS_LEFT = parseIntegerEnv("LIVE_TEST_SAFE_SECONDS_LEFT", 35, 5, 600);
const SAFE_WINDOW_TIMEOUT_MS = parseIntegerEnv("LIVE_TEST_SAFE_WINDOW_TIMEOUT_MS", 180_000, 30_000, 3_600_000);
const SAFE_WINDOW_HEARTBEAT_MS = parseIntegerEnv("LIVE_TEST_SAFE_WINDOW_HEARTBEAT_MS", 30_000, 5_000, 600_000);
const RESOLVE_RETRY_COOLDOWN_MS = parseIntegerEnv("LIVE_TEST_RESOLVE_RETRY_COOLDOWN_MS", 15_000, 5_000, 600_000);
// Randomness can make the mined resolve take a costlier winner branch than eth_estimateGas simulated.
const RESOLVE_GAS_FLOOR = BigInt(parseIntegerEnv("LIVE_TEST_RESOLVE_GAS_FLOOR", 500_000, 100_000, 1_000_000));
const LOOP_PAUSE_MS = parseIntegerEnv("LIVE_TEST_LOOP_PAUSE_MS", 1_500, 0, 120_000);
const MAX_FAILURES = parseIntegerEnv("LIVE_TEST_MAX_FAILURES", 20, 1, 10_000);
const DRY_RUN = process.env.LIVE_TEST_DRY_RUN === "1";
const FORCE_ALLOWANCE_APPROVE = process.env.LIVE_TEST_FORCE_ALLOWANCE_APPROVE === "1";
const REPEAT_SAME_BET = process.env.LIVE_TEST_REPEAT_SAME_BET === "1";
const ALLOW_EMPTY_RESOLVE = process.env.LIVE_TEST_ALLOW_EMPTY_RESOLVE === "1";
const VERBOSE_WALLET_PREFLIGHT = process.env.LIVE_TEST_VERBOSE_WALLETS === "1";
const BET_AMOUNT = parseTokenAmountEnv("LIVE_TEST_BET_AMOUNT", "0.01");
const APPROVE_AMOUNT = parseTokenAmountEnv("LIVE_TEST_APPROVE_AMOUNT", "1000000000");
const MIN_TOKEN_PER_WALLET = parseTokenAmountEnv("LIVE_TEST_MIN_TOKEN_PER_WALLET", "5");
const MIN_ETH_PER_WALLET = parseTokenAmountEnv("LIVE_TEST_MIN_ETH_PER_WALLET", "0.005");
const RANDOMIZE_ROUNDS = process.env.LIVE_TEST_RANDOMIZE_ROUNDS === "1";
const INJECT_RPC_FAILOVER = process.env.LIVE_TEST_INJECT_RPC_FAILOVER === "1";
const HEALTH_BASE_URL = parseCanaryHealthBaseUrl(process.env.LIVE_TEST_HEALTH_BASE_URL);
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
const MIN_TILES_PER_ROUND = parseIntegerEnv("LIVE_TEST_MIN_TILES_PER_ROUND", RANDOMIZE_ROUNDS ? 1 : TILES_PER_ROUND, 1, 25);
const MAX_TILES_PER_ROUND = parseIntegerEnv("LIVE_TEST_MAX_TILES_PER_ROUND", RANDOMIZE_ROUNDS ? 25 : TILES_PER_ROUND, 1, 25);
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

type BetMode = "single" | "bitmap" | "sameAmount" | "arrays";

type LiveWallet = {
  role: string;
  account: PrivateKeyAccount;
};

type RoundPlan = {
  amount: bigint;
  amounts: bigint[];
  targetTotalAmount: bigint;
  tileCount: number;
  totalAmount: bigint;
};

type RoundEvent = {
  amount: string;
  amounts?: string[];
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
  const firstLine = message.split(/\r?\n/).find((line) => line.trim())?.trim() || "Unknown error";
  return firstLine
    .replace(/https?:\/\/[^\s"']+/gi, "<redacted-url>")
    .replace(/\b0x[a-fA-F0-9]{80,}\b/g, "<redacted-calldata>")
    .replace(/\b0x[a-fA-F0-9]{40}\b/g, "<redacted-address>")
    .slice(0, 280);
}
function parseIntegerEnv(name: string, fallbackValue: number, min: number, max: number) {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallbackValue;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer in [${min}, ${max}], got ${raw}`);
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
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
    try {
      const headers = { "cache-control": "no-cache", "x-health-diagnostics-secret": secret };
      const [runtimeResponse, dataSyncResponse] = await Promise.all([
        fetch(new URL("/api/health/runtime", HEALTH_BASE_URL), { headers, signal: controller.signal }),
        fetch(new URL("/api/health/data-sync", HEALTH_BASE_URL), { headers, signal: controller.signal }),
      ]);
      if (!runtimeResponse.ok || !dataSyncResponse.ok) {
        throw new Error(`Health endpoints returned runtime=${runtimeResponse.status} dataSync=${dataSyncResponse.status}`);
      }
      const sample = parseCanaryHealthPayloads(await runtimeResponse.json(), await dataSyncResponse.json());
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
    } finally {
      clearTimeout(timeout);
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
  const wallets = ROLES.map((role) => {
    const key = process.env[`LORE_LIVE_TEST_${role}_PRIVATE_KEY`]?.trim();
    if (!key) throw new Error(`Missing LORE_LIVE_TEST_${role}_PRIVATE_KEY in .env.live-test-wallets`);
    return { role, account: privateKeyToAccount(normalizePrivateKey(key)) };
  });
  const unique = new Set(wallets.map((wallet) => wallet.account.address.toLowerCase()));
  if (unique.size !== wallets.length) throw new Error("Live test wallet list contains duplicate addresses");
  return wallets;
}

function createRunLogPath() {
  const dir = join("data", "live-test-runs");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return join(dir, `live-canary-${stamp}.jsonl`);
}

function writeEvent(logPath: string, event: RoundEvent) {
  appendFileSync(logPath, `${JSON.stringify({
    network: APP_NETWORK,
    chainId: APP_CHAIN.id,
    contractAddress: CONTRACT_ADDRESS,
    rpcLabel: RPC_LABEL,
    rpcFailoverInjected: INJECT_RPC_FAILOVER,
    ...event,
  })}\n`);
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
  if (isEstimateGasOutOfGasError(error)) return { kind: "estimate-out-of-gas", message: "eth_estimateGas out of gas" };
  if (isEstimateGasMethodUnsupported(error)) return { kind: "estimate-method-unsupported", message: "eth_estimateGas temporarily unsupported" };
  if (lower.includes("user rejected")) return { kind: "user-rejected", message: safeMessage };
  if (lower.includes("insufficient")) return { kind: "insufficient-funds", message: safeMessage };
  if (lower.includes("nonce too low")) return { kind: "nonce-too-low", message: safeMessage };
  if (lower.includes("already known") || lower.includes("known transaction")) return { kind: "already-known", message: safeMessage };
  if (lower.includes("replacement transaction underpriced")) return { kind: "replacement-underpriced", message: safeMessage };
  if (lower.includes("epochclosing") || lower.includes("epochended")) return { kind: "late-bet", message: safeMessage };
  if (lower.includes("safe window") || lower.includes("epoch wait")) return { kind: "epoch-window", message: safeMessage };
  if (lower.includes("alreadyresolved")) return { kind: "already-resolved", message: safeMessage };
  if (lower.includes("timernotended")) return { kind: "timer-not-ended", message: safeMessage };
  if (lower.includes("network") || lower.includes("timeout") || lower.includes("fetch failed") || lower.includes("429")) {
    return { kind: "network", message: safeMessage };
  }
  if (lower.includes("revert") || lower.includes("execution reverted")) return { kind: "revert", message: safeMessage };
  return { kind: "unknown", message: safeMessage };
}
function pickMode(round: number): BetMode {
  const modes: BetMode[] = ["single", "bitmap", "sameAmount", "arrays"];
  return modes[round % modes.length];
}

function pickTiles(epoch: bigint, round: number, walletIndex: number, count: number) {
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
  const tileCount =
    mode === "single"
      ? 1
      : RANDOMIZE_ROUNDS
        ? MIN_TILES_PER_ROUND + (seededBasisPoints(round, walletIndex, 1) % tileRange)
        : TILES_PER_ROUND;
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

function getPlannedSpendByRole(wallets: LiveWallet[]) {
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
  } catch {
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
async function readEpochWindow(publicClient: PublicClient) {
  const epoch = await publicClient.readContract({ address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "currentEpoch" });
  const [endTime, block] = await Promise.all([
    publicClient.readContract({ address: CONTRACT_ADDRESS, abi: GAME_ABI, functionName: "getEpochEndTime", args: [epoch] }),
    publicClient.getBlock(),
  ]);
  const secondsLeft = Number(endTime - block.timestamp);
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
      let gas = gasEstimate > RESOLVE_GAS_FLOOR ? gasEstimate : RESOLVE_GAS_FLOOR;
      const fees = await getFeeOverrides(publicClient);
      const nativeBalance = await publicClient.getBalance({ address: resolver.account.address });
      const affordableGasLimit = getAffordableKeeperGasLimit(gas, nativeBalance, fees);
      if (affordableGasLimit == null) {
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
      gas = affordableGasLimit;
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
      (params.afterEpoch == null || window.epoch > params.afterEpoch)
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
  if (!FORCE_ALLOWANCE_APPROVE && allowance >= requiredAllowance) return;

  const startedAt = Date.now();
  const approveAmount = APPROVE_AMOUNT > requiredAllowance ? APPROVE_AMOUNT : requiredAllowance;
  const nativeBalance = await publicClient.getBalance({ address: wallet.account.address });
  let fees = await getFeeOverrides(publicClient);
  const gasEstimate = await estimateGasWithMethodRetry(() => publicClient.estimateContractGas({
    account: wallet.account.address,
    address: LINEA_TOKEN_ADDRESS,
    abi: TOKEN_ABI,
    functionName: "approve",
    args: [CONTRACT_ADDRESS, approveAmount],
    ...fees,
  } as never));
  let gas = gasEstimate.value;
  fees = clampKeeperFeeOverridesToBalance(fees, gas, nativeBalance) ?? fees;
  gas = getAffordableKeeperGasLimit(gas, nativeBalance, fees) ?? gas;
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
  writeEvent(logPath, {
    amount: formatUnits(approveAmount, 18),
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
  let fees = await getBetFeeOverrides(publicClient);
  const preparedAt = Date.now();
  const functionName =
    mode === "single"
      ? "placeBet"
      : mode === "bitmap"
        ? "placeBatchBetsBitmap"
        : mode === "sameAmount"
          ? "placeBatchBetsSameAmount"
          : "placeBatchBets";
  const args =
    mode === "single"
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
  } catch (error) {
    if (mode === "single" || !isEstimateGasOutOfGasError(error)) throw error;
    gas = BATCH_GAS_FALLBACK;
    gasEstimateFallback = true;
  }
  const gasEstimatedAt = Date.now();
  fees = clampKeeperFeeOverridesToBalance(fees, gas, nativeBalance) ?? fees;
  gas = getAffordableKeeperGasLimit(gas, nativeBalance, fees) ?? gas;
  const [nonceLatest, noncePending] = await Promise.all([
    publicClient.getTransactionCount({ address: wallet.account.address, blockTag: "latest" }),
    publicClient.getTransactionCount({ address: wallet.account.address, blockTag: "pending" }),
  ]);
  const nonceReadAt = Date.now();
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
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: TX_RECEIPT_TIMEOUT_MS });
  const receiptAt = Date.now();
  // V9 advances exactly one expired epoch before recording this bet.
  const recordedEpoch = atomicAdvance && receipt.status === "success" ? epoch + 1n : epoch;
  const event: RoundEvent = {
    amount: formatUnits(plan.amount, 18),
    amounts: mode === "arrays" ? plan.amounts.map((value) => formatUnits(value, 18)) : undefined,
    atomicAdvance,
    durationMs: receiptAt - startedAt,
    effectiveGasPrice: receipt.effectiveGasPrice.toString(),
    epoch: recordedEpoch.toString(),
    estimateGasMs: gasEstimatedAt - preparedAt,
    gasEstimateFallback,
    gasEstimateRetryCount,
    gasUsed: receipt.gasUsed.toString(),
    networkFeeWei: (receipt.gasUsed * receipt.effectiveGasPrice).toString(),
    hash,
    mode,
    nonceLatest,
    noncePending,
    nonceReadMs: nonceReadAt - gasEstimatedAt,
    ok: receipt.status === "success",
    prepareMs: preparedAt - startedAt,
    receiptMs: receiptAt - sentAt,
    repeat,
    role: wallet.role,
    round,
    secondsLeft,
    sendMs: sentAt - nonceReadAt,
    targetTotalAmount: formatUnits(plan.targetTotalAmount, 18),
    tileCount: plan.tileCount,
    tiles,
    timestamp: new Date().toISOString(),
    totalAmount: formatUnits(plan.totalAmount, 18),
    txStatus: receipt.status,
  };
  writeEvent(logPath, event);
  return event;
}

async function runPreflight(
  logPath: string,
  publicClient: PublicClient,
  wallets: LiveWallet[],
  plannedSpendByRole: Map<string, bigint>,
) {
  const rows = [];
  for (const wallet of wallets) {
    const plannedSpend = plannedSpendByRole.get(wallet.role) ?? 0n;
    const requiredToken = plannedSpend > MIN_TOKEN_PER_WALLET ? plannedSpend : MIN_TOKEN_PER_WALLET;
    const [eth, token, allowance] = await Promise.all([
      publicClient.getBalance({ address: wallet.account.address }),
      publicClient.readContract({
        address: LINEA_TOKEN_ADDRESS,
        abi: TOKEN_ABI,
        functionName: "balanceOf",
        args: [wallet.account.address],
      }),
      publicClient.readContract({
        address: LINEA_TOKEN_ADDRESS,
        abi: TOKEN_ABI,
        functionName: "allowance",
        args: [wallet.account.address, CONTRACT_ADDRESS],
      }),
    ]);
    rows.push({
      role: wallet.role,
      address: wallet.account.address,
      eth: formatEther(eth),
      linea: formatUnits(token, 18),
      allowance: formatUnits(allowance, 18),
      plannedSpend: formatUnits(plannedSpend, 18),
      enoughEth: eth >= MIN_ETH_PER_WALLET,
      enoughToken: token >= requiredToken,
    });
    writeEvent(logPath, {
      amount: "0",
      enoughEth: eth >= MIN_ETH_PER_WALLET,
      enoughToken: token >= requiredToken,
      errorKind: eth < MIN_ETH_PER_WALLET && token < requiredToken
        ? "insufficient-native-and-token"
        : eth < MIN_ETH_PER_WALLET
          ? "insufficient-native-gas"
          : token < requiredToken
            ? "insufficient-token"
            : undefined,
      mode: "preflight",
      ok: eth >= MIN_ETH_PER_WALLET && token >= requiredToken,
      role: wallet.role,
      round: -1,
      timestamp: new Date().toISOString(),
      totalAmount: formatUnits(plannedSpend, 18),
    });
  }
  const readyWallets = rows.filter((row) => row.enoughEth && row.enoughToken).length;
  console.log(`[live-canary] walletPreflight ready=${readyWallets}/${rows.length} roles=${rows.map((row) => row.role).join(",")}`);
  if (VERBOSE_WALLET_PREFLIGHT) console.table(rows);
  if (rows.some((row) => !row.enoughEth || !row.enoughToken)) {
    throw new Error("Preflight balances are below configured minimums");
  }
}

async function main() {
  const wallets = loadWallets();
  const resolver = process.env.LORE_LIVE_TEST_RESOLVER_PRIVATE_KEY
    ? {
        role: "RESOLVER",
        account: privateKeyToAccount(normalizePrivateKey(process.env.LORE_LIVE_TEST_RESOLVER_PRIVATE_KEY)),
      }
    : null;
  const resolverCandidates = [
    ...(resolver ? [resolver] : []),
    ...wallets.filter((wallet) => wallet.account.address.toLowerCase() !== resolver?.account.address.toLowerCase()),
  ];
  const readRpcUrls = getStableLineaReadRpcs(process.env.LIVE_TEST_RPC_URL ?? process.env.NEXT_PUBLIC_LINEA_RPCS, APP_NETWORK);
  const broadcastRpcUrls = getPreferredLineaRpcs(process.env.LIVE_TEST_RPC_URL ?? process.env.NEXT_PUBLIC_LINEA_RPCS, APP_NETWORK);
  const readTransport = createCanaryTransport(readRpcUrls);
  const broadcastTransport = createCanaryTransport(broadcastRpcUrls);
  const publicClient = createPublicClient({ chain: APP_CHAIN, transport: readTransport });
  const logPath = createRunLogPath();

  writeFileSync(logPath, "");
  console.log(`[live-canary] network=${APP_NETWORK} chainId=${APP_CHAIN.id}`);
  console.log(`[live-canary] contract=${CONTRACT_ADDRESS}`);
  console.log(`[live-canary] token=${LINEA_TOKEN_ADDRESS}`);
  console.log(`[live-canary] rpcLabel=${RPC_LABEL} readRpcCount=${readRpcUrls.length} broadcastRpcCount=${broadcastRpcUrls.length}`);
  console.log(`[live-canary] rpcFailoverInjection=${INJECT_RPC_FAILOVER ? "enabled" : "disabled"}`);
  console.log(
    `[live-canary] rounds=${TARGET_ROUNDS} randomize=${RANDOMIZE_ROUNDS ? "yes" : "no"} ` +
      `total=${formatUnits(MIN_TOTAL_BET_AMOUNT, 18)}..${formatUnits(MAX_TOTAL_BET_AMOUNT, 18)} ` +
      `tiles=${MIN_TILES_PER_ROUND}..${MAX_TILES_PER_ROUND}`,
  );
  console.log(`[live-canary] emptyResolveBootstrap=${ALLOW_EMPTY_RESOLVE ? "enabled" : "disabled"}`);
  console.log(`[live-canary] feeMeasurement repeatSameBet=${REPEAT_SAME_BET ? "enabled" : "disabled"} forceAllowanceApprove=${FORCE_ALLOWANCE_APPROVE ? "enabled" : "disabled"}`);
  console.log(`[live-canary] log=${logPath}`);

  const contractToken = await publicClient.readContract({
    address: CONTRACT_ADDRESS,
    abi: GAME_ABI,
    functionName: "token",
  });
  if (String(contractToken).toLowerCase() !== LINEA_TOKEN_ADDRESS.toLowerCase()) {
    throw new Error(`Contract token mismatch: expected ${LINEA_TOKEN_ADDRESS}, got ${contractToken}`);
  }

  const plannedSpendByRole = getPlannedSpendByRole(wallets);
  await runPreflight(logPath, publicClient, wallets, plannedSpendByRole);
  if (DRY_RUN) return;
  if (HEALTH_BASE_URL && !process.env.HEALTH_DIAGNOSTICS_SECRET?.trim()) {
    throw new Error("HEALTH_DIAGNOSTICS_SECRET is required when LIVE_TEST_HEALTH_BASE_URL is configured");
  }
  await sampleHealth(logPath, 0);

  for (const wallet of wallets) {
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
    const walletIndex = round % wallets.length;
    const wallet = wallets[walletIndex];
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
        errorKinds.set("tx-reverted", (errorKinds.get("tx-reverted") ?? 0) + 1);
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
  console.error("[live-canary] failed", error);
  process.exitCode = 1;
});
