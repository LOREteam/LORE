import "dotenv/config";
import { mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { config as loadDotenv } from "dotenv";
import {
  createPublicClient,
  createWalletClient,
  fallback,
  formatEther,
  formatUnits,
  http,
  parseUnits,
  type Hash,
  type PublicClient,
} from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

import { GAME_ABI, LINEA_TOKEN_ADDRESS, TOKEN_ABI, CONTRACT_ADDRESS, TX_RECEIPT_TIMEOUT_MS } from "../app/lib/constants";
import {
  clampKeeperFeeOverridesToBalance,
  getAffordableKeeperGasLimit,
  getFallbackFeeOverrides,
  getKeeperFeeOverrides,
} from "../app/lib/lineaFees";
import { tileIdsToMask } from "../app/lib/tileMask";
import { getConfiguredLineaNetwork, getLineaChain, getStableLineaReadRpcs } from "../config/publicConfig";

loadDotenv({ path: ".env.live-test-wallets", override: false });

const APP_NETWORK = getConfiguredLineaNetwork();
const APP_CHAIN = getLineaChain(APP_NETWORK);
const TARGET_ROUNDS = parseIntegerEnv("LIVE_TEST_TARGET_ROUNDS", 300, 1, 10_000);
const TILES_PER_ROUND = parseIntegerEnv("LIVE_TEST_TILES_PER_ROUND", 3, 1, 24);
const SAFE_SECONDS_LEFT = parseIntegerEnv("LIVE_TEST_SAFE_SECONDS_LEFT", 35, 5, 600);
const SAFE_WINDOW_TIMEOUT_MS = parseIntegerEnv("LIVE_TEST_SAFE_WINDOW_TIMEOUT_MS", 180_000, 30_000, 3_600_000);
const SAFE_WINDOW_HEARTBEAT_MS = parseIntegerEnv("LIVE_TEST_SAFE_WINDOW_HEARTBEAT_MS", 30_000, 5_000, 600_000);
const RESOLVE_RETRY_COOLDOWN_MS = parseIntegerEnv("LIVE_TEST_RESOLVE_RETRY_COOLDOWN_MS", 15_000, 5_000, 600_000);
const LOOP_PAUSE_MS = parseIntegerEnv("LIVE_TEST_LOOP_PAUSE_MS", 1_500, 0, 120_000);
const MAX_FAILURES = parseIntegerEnv("LIVE_TEST_MAX_FAILURES", 20, 1, 10_000);
const DRY_RUN = process.env.LIVE_TEST_DRY_RUN === "1";
const VERBOSE_WALLET_PREFLIGHT = process.env.LIVE_TEST_VERBOSE_WALLETS === "1";
const BET_AMOUNT = parseTokenAmountEnv("LIVE_TEST_BET_AMOUNT", "0.01");
const APPROVE_AMOUNT = parseTokenAmountEnv("LIVE_TEST_APPROVE_AMOUNT", "1000000000");
const MIN_TOKEN_PER_WALLET = parseTokenAmountEnv("LIVE_TEST_MIN_TOKEN_PER_WALLET", "5");
const MIN_ETH_PER_WALLET = parseTokenAmountEnv("LIVE_TEST_MIN_ETH_PER_WALLET", "0.005");
const RANDOMIZE_ROUNDS = process.env.LIVE_TEST_RANDOMIZE_ROUNDS === "1";
const MIN_TOTAL_BET_AMOUNT = parseTokenAmountEnv(
  "LIVE_TEST_MIN_TOTAL_BET_AMOUNT",
  process.env.LIVE_TEST_MIN_BET_AMOUNT ?? formatUnits(BET_AMOUNT, 18),
);
const MAX_TOTAL_BET_AMOUNT = parseTokenAmountEnv(
  "LIVE_TEST_MAX_TOTAL_BET_AMOUNT",
  process.env.LIVE_TEST_MAX_BET_AMOUNT ?? formatUnits(BET_AMOUNT * BigInt(TILES_PER_ROUND), 18),
);
const MIN_TILES_PER_ROUND = parseIntegerEnv("LIVE_TEST_MIN_TILES_PER_ROUND", RANDOMIZE_ROUNDS ? 1 : TILES_PER_ROUND, 1, 24);
const MAX_TILES_PER_ROUND = parseIntegerEnv("LIVE_TEST_MAX_TILES_PER_ROUND", RANDOMIZE_ROUNDS ? 24 : TILES_PER_ROUND, 1, 24);
const STRESS_SEED = parseIntegerEnv("LIVE_TEST_STRESS_SEED", 13_337, 1, Number.MAX_SAFE_INTEGER);
if (MIN_TOTAL_BET_AMOUNT > MAX_TOTAL_BET_AMOUNT) {
  throw new Error("LIVE_TEST_MIN_TOTAL_BET_AMOUNT must be <= LIVE_TEST_MAX_TOTAL_BET_AMOUNT");
}
if (MIN_TILES_PER_ROUND > MAX_TILES_PER_ROUND) {
  throw new Error("LIVE_TEST_MIN_TILES_PER_ROUND must be <= LIVE_TEST_MAX_TILES_PER_ROUND");
}
const ROLES = (process.env.LIVE_TEST_ROLES ?? "MANUAL,AUTOMINER_A,AUTOMINER_B,AUTOMINER_C")
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
  chainId?: number;
  contractAddress?: string;
  durationMs?: number;
  error?: string;
  errorKind?: string;
  epoch?: string;
  gasUsed?: string;
  hash?: Hash;
  mode?: BetMode | "approve" | "epoch-wait" | "resolve" | "preflight";
  network?: string;
  nonceLatest?: number;
  noncePending?: number;
  ok: boolean;
  rpcLabel?: string;
  role: string;
  round: number;
  secondsLeft?: number;
  targetTotalAmount?: string;
  tileCount?: number;
  tiles?: number[];
  timestamp: string;
  totalAmount?: string;
  txStatus?: string;
};

const attemptedResolveEpochs = new Map<string, number>();
const pendingResolveEpochs = new Set<string>();

function getRpcLabel() {
  const label = process.env.LIVE_CANARY_RPC_LABEL?.trim() || process.env.LINEA_RPC_LABEL?.trim();
  if (!label || /^https?:\/\//i.test(label)) return "unlabeled-rpc";
  return label;
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
    rpcLabel: getRpcLabel(),
    ...event,
  })}\n`);
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (lower.includes("user rejected")) return { kind: "user-rejected", message };
  if (lower.includes("insufficient")) return { kind: "insufficient-funds", message };
  if (lower.includes("nonce too low")) return { kind: "nonce-too-low", message };
  if (lower.includes("already known") || lower.includes("known transaction")) return { kind: "already-known", message };
  if (lower.includes("replacement transaction underpriced")) return { kind: "replacement-underpriced", message };
  if (lower.includes("epochclosing") || lower.includes("epochended")) return { kind: "late-bet", message };
  if (lower.includes("safe window") || lower.includes("epoch wait")) return { kind: "epoch-window", message };
  if (lower.includes("alreadyresolved")) return { kind: "already-resolved", message };
  if (lower.includes("timernotended")) return { kind: "timer-not-ended", message };
  if (lower.includes("network") || lower.includes("timeout") || lower.includes("fetch failed") || lower.includes("429")) {
    return { kind: "network", message };
  }
  if (lower.includes("revert") || lower.includes("execution reverted")) return { kind: "revert", message };
  return { kind: "unknown", message };
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
    plannedSpendByRole.set(wallet.role, (plannedSpendByRole.get(wallet.role) ?? 0n) + plan.totalAmount);
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
  resolver: LiveWallet | null;
  transport: ReturnType<typeof fallback>;
}) {
  const { logPath, publicClient, resolver, transport } = params;
  if (!resolver) return;
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
  const epochKey = epoch.toString();
  const now = Date.now();
  if (pendingResolveEpochs.has(epochKey)) return;
  const lastAttemptAt = attemptedResolveEpochs.get(epochKey);
  if (lastAttemptAt != null && now - lastAttemptAt < RESOLVE_RETRY_COOLDOWN_MS) return;
  attemptedResolveEpochs.set(epochKey, now);

  const startedAt = Date.now();
  let pendingHash: Hash | undefined;
  const walletClient = createWalletClient({ account: resolver.account, chain: APP_CHAIN, transport });
  const [nonceLatest, noncePending] = await Promise.all([
    publicClient.getTransactionCount({ address: resolver.account.address, blockTag: "latest" }),
    publicClient.getTransactionCount({ address: resolver.account.address, blockTag: "pending" }),
  ]);
  if (noncePending > nonceLatest) {
    writeEvent(logPath, { amount: "0", epoch: epoch.toString(), error: "resolver has pending transactions", errorKind: "pending-nonce", mode: "resolve", ok: false, role: resolver.role, round: -1, secondsLeft, timestamp: new Date().toISOString() });
    return;
  }
  try {
    const gas = await publicClient.estimateContractGas({
      account: resolver.account.address,
      address: CONTRACT_ADDRESS,
      abi: GAME_ABI,
      functionName: "resolveEpoch",
      args: [epoch],
    });
    const fees = await getFeeOverrides(publicClient);
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
    writeEvent(logPath, {
      amount: "0",
      durationMs: Date.now() - startedAt,
      epoch: epoch.toString(),
      gasUsed: receipt.gasUsed.toString(),
      hash,
      mode: "resolve",
      ok: receipt.status === "success",
      role: resolver.role,
      round: -1,
      secondsLeft,
      timestamp: new Date().toISOString(),
      txStatus: receipt.status,
    });
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
  }
}

async function waitForSafeWindow(params: {
  afterEpoch?: bigint | null;
  logPath: string;
  publicClient: PublicClient;
  resolver: LiveWallet | null;
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
      window.secondsLeft > SAFE_SECONDS_LEFT &&
      (params.afterEpoch == null || window.epoch > params.afterEpoch)
    ) return window;
    const now = Date.now();
    if (now >= nextHeartbeatAt) {
      writeEvent(params.logPath, {
        amount: "0",
        durationMs: now - startedAt,
        epoch: window.epoch.toString(),
        mode: "epoch-wait",
        ok: true,
        role: params.resolver?.role ?? "SYSTEM",
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
  if (allowance >= requiredAllowance) return;

  const startedAt = Date.now();
  const approveAmount = APPROVE_AMOUNT > requiredAllowance ? APPROVE_AMOUNT : requiredAllowance;
  const nativeBalance = await publicClient.getBalance({ address: wallet.account.address });
  let fees = await getFeeOverrides(publicClient);
  let gas = await publicClient.estimateContractGas({
    account: wallet.account.address,
    address: LINEA_TOKEN_ADDRESS,
    abi: TOKEN_ABI,
    functionName: "approve",
    args: [CONTRACT_ADDRESS, approveAmount],
    ...fees,
  } as never);
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
    gasUsed: receipt.gasUsed.toString(),
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
  logPath: string;
  mode: BetMode;
  plan: RoundPlan;
  publicClient: PublicClient;
  round: number;
  secondsLeft: number;
  tiles: number[];
  transport: ReturnType<typeof fallback>;
  wallet: LiveWallet;
}) {
  const { epoch, logPath, mode, plan, publicClient, round, secondsLeft, tiles, transport, wallet } = params;
  const startedAt = Date.now();
  const walletClient = createWalletClient({ account: wallet.account, chain: APP_CHAIN, transport });
  const nativeBalance = await publicClient.getBalance({ address: wallet.account.address });
  let fees = await getFeeOverrides(publicClient);
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
  let gas = await publicClient.estimateContractGas({
    account: wallet.account.address,
    address: CONTRACT_ADDRESS,
    abi: GAME_ABI,
    functionName,
    args,
    ...fees,
  } as never);
  fees = clampKeeperFeeOverridesToBalance(fees, gas, nativeBalance) ?? fees;
  gas = getAffordableKeeperGasLimit(gas, nativeBalance, fees) ?? gas;
  const [nonceLatest, noncePending] = await Promise.all([
    publicClient.getTransactionCount({ address: wallet.account.address, blockTag: "latest" }),
    publicClient.getTransactionCount({ address: wallet.account.address, blockTag: "pending" }),
  ]);
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
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: TX_RECEIPT_TIMEOUT_MS });
  const event: RoundEvent = {
    amount: formatUnits(plan.amount, 18),
    amounts: mode === "arrays" ? plan.amounts.map((value) => formatUnits(value, 18)) : undefined,
    durationMs: Date.now() - startedAt,
    epoch: epoch.toString(),
    gasUsed: receipt.gasUsed.toString(),
    hash,
    mode,
    nonceLatest,
    noncePending,
    ok: receipt.status === "success",
    role: wallet.role,
    round,
    secondsLeft,
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
  const rpcUrls = getStableLineaReadRpcs(process.env.LIVE_TEST_RPC_URL ?? process.env.NEXT_PUBLIC_LINEA_RPCS, APP_NETWORK);
  const transport = fallback(rpcUrls.map((url) => http(url, { timeout: 20_000, retryCount: 1 })));
  const publicClient = createPublicClient({ chain: APP_CHAIN, transport });
  const logPath = createRunLogPath();

  writeFileSync(logPath, "");
  console.log(`[live-canary] network=${APP_NETWORK} chainId=${APP_CHAIN.id}`);
  console.log(`[live-canary] contract=${CONTRACT_ADDRESS}`);
  console.log(`[live-canary] token=${LINEA_TOKEN_ADDRESS}`);
  console.log(`[live-canary] rpcLabel=${getRpcLabel()} rpcCount=${rpcUrls.length}`);
  console.log(
    `[live-canary] rounds=${TARGET_ROUNDS} randomize=${RANDOMIZE_ROUNDS ? "yes" : "no"} ` +
      `total=${formatUnits(MIN_TOTAL_BET_AMOUNT, 18)}..${formatUnits(MAX_TOTAL_BET_AMOUNT, 18)} ` +
      `tiles=${MIN_TILES_PER_ROUND}..${MAX_TILES_PER_ROUND}`,
  );
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

  for (const wallet of wallets) {
    await ensureAllowance({
      logPath,
      publicClient,
      requiredAllowance: plannedSpendByRole.get(wallet.role) ?? 0n,
      transport,
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
      const { epoch, secondsLeft } = await waitForSafeWindow({
        afterEpoch: lastAttemptedEpoch,
        logPath,
        publicClient,
        resolver,
        transport,
      });
      lastAttemptedEpoch = epoch;
      const tiles = pickTiles(epoch, round, walletIndex, plan.tileCount);
      const event = await placeRound({
        epoch,
        logPath,
        mode,
        plan,
        publicClient,
        round,
        secondsLeft,
        tiles,
        transport,
        wallet,
      });
      if (event.ok) {
        successes += 1;
        console.log(
          `[live-canary] ok round=${round + 1}/${TARGET_ROUNDS} role=${wallet.role} mode=${mode} ` +
            `total=${event.totalAmount} tiles=${plan.tileCount} epoch=${epoch} tx=${event.hash}`,
        );
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
      failures += 1;
      const classified = classifyError(error);
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
      if (failures >= MAX_FAILURES) {
        throw new Error(`Stopping after ${failures} failures; see ${logPath}`);
      }
    }
    if (LOOP_PAUSE_MS > 0) await delay(LOOP_PAUSE_MS);
  }

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
