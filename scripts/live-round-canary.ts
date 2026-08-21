import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  createPublicClient,
  createWalletClient,
  custom,
  fallback,
  formatEther,
  formatUnits,
  http,
  parseUnits,
  toFunctionSelector,
  type Address,
  type Hash,
  type PublicClient,
  type Transport,
} from "viem";
import { type PrivateKeyAccount } from "viem/accounts";

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
import {
  loadLiveTestExecutionWalletConfig,
  loadLiveTestPublicWalletConfig,
} from "./live-test-wallet-config.mjs";
import { assertV10RuntimeIdentity, type V10RuntimeIdentity } from "./v10-runtime-identity";
import { verifyV10SepoliaDeploymentManifest } from "./verify-v10-sepolia-deployment-manifest.mjs";

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
const CANONICAL_INTEGER_ENV_RE = /^(?:0|[1-9]\d{0,15})$/;
const SIGNING_ENV_NAME_RE = /(?:^|_)(?:PRIVATE_KEY|MNEMONIC|SEED(?:_PHRASE)?|SIGNING_KEY)(?:_|$)/i;
const PREVIEW_CHECK_SCRIPT = fileURLToPath(new URL("./check-v10-dry-run-preview.mjs", import.meta.url));
const SHA256_RE = /^[a-f0-9]{64}$/;

function hasSigningMaterialInEnvironment() {
  return Object.entries(process.env).some(
    ([name, value]) => Boolean(value?.trim()) && SIGNING_ENV_NAME_RE.test(name),
  );
}

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

type PublicWalletAdmission = {
  roles: string[];
  addressesByRole: Map<string, Address>;
  walletSetSha256: string;
};

type ExecutionWalletAdmission = PublicWalletAdmission & {
  accountsByRole: Map<string, PrivateKeyAccount>;
};

const loadExecutionWalletAdmission = loadLiveTestExecutionWalletConfig as unknown as (options: {
  cwd?: string;
  environment?: NodeJS.ProcessEnv;
  expectedWalletSetSha256?: string;
  publicConfig?: PublicWalletAdmission;
}) => ExecutionWalletAdmission;

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
  admission?: CanaryAdmission;
  admissionSha256?: string;
  runId?: string;
  allowance?: string;
  allowanceCapWei?: string;
  allowanceWei?: string;
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
  mode?: BetMode | "admission" | "approve" | "diagnostic" | "epoch-wait" | "resolve" | "resolver-candidate" | "runtime-identity" | "preflight" | "summary";
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
  signatureRequested?: boolean;
  signingMaterialLoaded?: boolean;
  targetTotalAmount?: string;
  targetRounds?: number;
  tileCount?: number;
  tiles?: number[];
  timestamp: string;
  totalAmount?: string;
  totalAmountWei?: string;
  transactionSent?: boolean;
  deploymentManifestSha256?: string;
  sourceArtifactGitSha?: string;
  txStatus?: string;
  walBytes?: number;
  walletSetSha256?: string;
  walletClientCreated?: boolean;
  successes?: number;
  failures?: number;
};

type V10DeploymentManifestBinding = {
  contractAddress: string;
  deployBlock: string;
  deploymentManifestSha256: string;
  normalizedExecutableRuntimeSha256: string;
  sourceArtifactGitSha: string;
};

type CanaryAdmission = {
  schema: 2;
  runId: string;
  execution: "dry-run" | "live";
  profile: "v10-matrix" | "managed-soak";
  network: string;
  chainId: number;
  contractAddress: string;
  contractDeployBlock: string;
  runtimeSha256: string;
  manifestSha256: string;
  deploymentManifestSha256: string;
  sourceArtifactGitSha: string;
  canonicalProvenanceVerified: true;
  previewSha256: string | null;
  walletSetSha256: string;
  canaryPlanSha256: string;
  selectedRoles: string[];
  roleCaps: Array<{ role: string; spendCapWei: string; allowanceCapWei: string }>;
};

let activeAdmission: {
  admissionSha256: string;
  runId: string;
  walletSetSha256: string;
} | null = null;

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

function createCanaryPlanSha256() {
  const plan = {
    schema: 1,
    profile: V10_MATRIX_ONLY ? "v10-matrix" : "managed-soak",
    network: APP_NETWORK,
    chainId: APP_CHAIN.id,
    contractAddress: CONTRACT_ADDRESS.toLowerCase(),
    tokenAddress: LINEA_TOKEN_ADDRESS.toLowerCase(),
    contractDeployBlock: String(CONTRACT_DEPLOY_BLOCK),
    contractRequiresEpochBoundBets: CONTRACT_REQUIRES_EPOCH_BOUND_BETS,
    targetRounds: TARGET_ROUNDS,
    maxResolveTransactions: MAX_RESOLVE_TRANSACTIONS,
    roles: [...ROLES],
    matrix: V10_MATRIX_ONLY ? V10_CANARY_MATRIX : null,
    tilesPerRound: TILES_PER_ROUND,
    minTilesPerRound: MIN_TILES_PER_ROUND,
    maxTilesPerRound: MAX_TILES_PER_ROUND,
    betAmount: BET_AMOUNT.toString(),
    minTotalBetAmount: MIN_TOTAL_BET_AMOUNT.toString(),
    maxTotalBetAmount: MAX_TOTAL_BET_AMOUNT.toString(),
    minTokenPerWallet: MIN_TOKEN_PER_WALLET.toString(),
    minEthPerWallet: MIN_ETH_PER_WALLET.toString(),
    safeSecondsLeft: SAFE_SECONDS_LEFT,
    safeWindowTimeoutMs: SAFE_WINDOW_TIMEOUT_MS,
    safeWindowHeartbeatMs: SAFE_WINDOW_HEARTBEAT_MS,
    resolveRetryCooldownMs: RESOLVE_RETRY_COOLDOWN_MS,
    resolveGasFloor: RESOLVE_GAS_FLOOR.toString(),
    liveGasBufferPercent: LIVE_GAS_BUFFER_PERCENT.toString(),
    transactionReceiptTimeoutMs: TX_RECEIPT_TIMEOUT_MS,
    loopPauseMs: LOOP_PAUSE_MS,
    maxFailures: MAX_FAILURES,
    liveLogMaxBytes: LIVE_LOG_MAX_BYTES,
    forceAllowanceApprove: FORCE_ALLOWANCE_APPROVE,
    repeatSameBet: REPEAT_SAME_BET,
    allowEmptyResolve: ALLOW_EMPTY_RESOLVE,
    randomizeRounds: RANDOMIZE_ROUNDS,
    stressSeed: STRESS_SEED,
    injectRpcFailover: INJECT_RPC_FAILOVER,
    rpcLabel: RPC_LABEL,
    healthBaseUrl: HEALTH_BASE_URL ? String(HEALTH_BASE_URL) : null,
    healthSampleEveryRounds: HEALTH_SAMPLE_EVERY_ROUNDS,
    healthTimeoutMs: HEALTH_TIMEOUT_MS,
  };
  return createHash("sha256").update(JSON.stringify(plan), "utf8").digest("hex");
}

const CANARY_PLAN_SHA256 = createCanaryPlanSha256();

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

function loadWallets(config: ExecutionWalletAdmission): LiveWallet[] {
  const wallets = ROLES.map((role) => {
    const account = config.accountsByRole.get(role);
    if (!account) throw new Error(`Validated execution wallet for ${role} is unavailable`);
    return { role, address: account.address, account };
  });
  return wallets;
}

function inspectExecutionWalletBinding() {
  const publicConfig = loadLiveTestPublicWalletConfig({
    cwd: process.cwd(),
    environment: process.env,
  }) as PublicWalletAdmission;
  const executionConfig = loadExecutionWalletAdmission({
    cwd: process.cwd(),
    environment: process.env,
    expectedWalletSetSha256: publicConfig.walletSetSha256,
    publicConfig,
  }) as ExecutionWalletAdmission;
  const wallets = loadWallets(executionConfig);
  console.log(JSON.stringify({
    status: "pass",
    mode: "execution-wallet-binding-inspection",
    roles: wallets.map((wallet) => wallet.role),
    publicAddressFileBinding: true,
    previewArtifactVerified: false,
    walletSetSha256: publicConfig.walletSetSha256,
    signingMaterialLoaded: true,
    signatureRequested: false,
    walletClientCreated: false,
    networkRequests: 0,
    contractWrites: 0,
  }));
}

function inspectCanaryPlan() {
  console.log(JSON.stringify({
    status: "pass",
    mode: "canary-plan-inspection",
    profile: V10_MATRIX_ONLY ? "v10-matrix" : "managed-soak",
    canaryPlanSha256: CANARY_PLAN_SHA256,
    signingMaterialLoaded: hasSigningMaterialInEnvironment(),
    signatureRequested: false,
    walletClientCreated: false,
    networkRequests: 0,
    contractWrites: 0,
  }));
}

function inspectFreshPreviewBinding() {
  if (hasSigningMaterialInEnvironment()) {
    throw new Error("Fresh Preview binding inspection refuses inherited signing material");
  }
  const publicConfig = loadLiveTestPublicWalletConfig({
    cwd: process.cwd(),
    environment: process.env,
  }) as PublicWalletAdmission;
  const previewBinding = assertFreshPreviewBinding(publicConfig);
  console.log(JSON.stringify({
    status: "pass",
    mode: "fresh-preview-binding-inspection",
    ...previewBinding,
    signingMaterialLoaded: false,
    signatureRequested: false,
    walletClientCreated: false,
    networkRequests: 0,
    contractWrites: 0,
  }));
}

function loadDryRunWallets(config: PublicWalletAdmission): CanaryWallet[] {
  return ROLES.map((role) => {
    const address = config.addressesByRole.get(role);
    if (!address) throw new Error(`Validated public wallet for ${role} is unavailable`);
    return { role, address };
  });
}

function createPreviewCheckerEnvironment() {
  const environment: NodeJS.ProcessEnv = { NODE_ENV: "production", NO_COLOR: "1", FORCE_COLOR: "0" };
  for (const name of ["SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR"]) {
    const value = process.env[name];
    if (typeof value === "string") environment[name] = value;
  }
  return environment;
}

function assertFreshPreviewBinding(publicConfig: PublicWalletAdmission) {
  const expectedPreviewSha256 = process.env.LIVE_TEST_PREVIEW_SHA256?.trim().toLowerCase() ?? "";
  if (!SHA256_RE.test(expectedPreviewSha256)) {
    throw new Error("LIVE_TEST_PREVIEW_SHA256 must bind execution to a fresh validated Preview");
  }
  const result = spawnSync(process.execPath, [PREVIEW_CHECK_SCRIPT, "--require-fresh-authorization"], {
    cwd: process.cwd(),
    env: createPreviewCheckerEnvironment(),
    encoding: "utf8",
    timeout: 60_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  if (result.error || result.signal || result.status !== 0) {
    throw new Error("Fresh V10 Preview validation failed before live execution");
  }
  const outputLine = String(result.stdout ?? "").trim().split(/\r?\n/).filter(Boolean).at(-1) ?? "";
  let summary: Record<string, unknown>;
  try {
    summary = JSON.parse(outputLine) as Record<string, unknown>;
  } catch {
    throw new Error("Fresh V10 Preview validator returned invalid evidence");
  }
  if (
    summary.status !== "pass" ||
    summary.authorizationFreshnessRequired !== true ||
    summary.previewSha256 !== expectedPreviewSha256 ||
    summary.walletSetSha256 !== publicConfig.walletSetSha256 ||
    summary.canaryPlanSha256 !== CANARY_PLAN_SHA256
  ) {
    throw new Error("Fresh V10 Preview identity does not match this execution wallet set and canary plan");
  }
  return {
    previewSha256: expectedPreviewSha256,
    walletSetSha256: publicConfig.walletSetSha256,
    canaryPlanSha256: CANARY_PLAN_SHA256,
  };
}

function createRunLogPath() {
  return createLiveCanaryLogPath();
}

function canonicalAdmissionPayload(admission: CanaryAdmission) {
  return JSON.stringify({
    schema: admission.schema,
    runId: admission.runId,
    execution: admission.execution,
    profile: admission.profile,
    network: admission.network,
    chainId: admission.chainId,
    contractAddress: admission.contractAddress.toLowerCase(),
    contractDeployBlock: admission.contractDeployBlock,
    runtimeSha256: admission.runtimeSha256,
    manifestSha256: admission.manifestSha256,
    deploymentManifestSha256: admission.deploymentManifestSha256,
    sourceArtifactGitSha: admission.sourceArtifactGitSha,
    canonicalProvenanceVerified: admission.canonicalProvenanceVerified,
    previewSha256: admission.previewSha256,
    walletSetSha256: admission.walletSetSha256,
    canaryPlanSha256: admission.canaryPlanSha256,
    selectedRoles: [...admission.selectedRoles].sort(),
    roleCaps: [...admission.roleCaps]
      .map((cap) => ({ ...cap }))
      .sort((left, right) => left.role.localeCompare(right.role)),
  });
}

function getCanaryRunId() {
  const configured = process.env.LIVE_TEST_RUN_ID?.trim();
  if (!configured) return randomUUID();
  if (!/^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/.test(configured)) {
    throw new Error("LIVE_TEST_RUN_ID must be a canonical lowercase UUID or 32-character hex identifier");
  }
  return configured;
}

function writeCanaryAdmission(params: {
  logPath: string;
  previewBinding: { previewSha256: string; walletSetSha256: string; canaryPlanSha256: string } | null;
  runtimeIdentity: V10RuntimeIdentity;
  deploymentManifest: V10DeploymentManifestBinding;
  plannedSpendByRole: Map<string, bigint>;
  walletSetSha256: string;
  wallets: CanaryWallet[];
}) {
  const selectedRoles = params.wallets.map((wallet) => wallet.role).sort();
  const execution = DRY_RUN ? "dry-run" : "live";
  if (execution === "live" && !params.previewBinding) {
    throw new Error("Live admission requires a fresh Preview binding");
  }
  const admission: CanaryAdmission = {
    schema: 2,
    runId: getCanaryRunId(),
    execution,
    profile: V10_MATRIX_ONLY ? "v10-matrix" : "managed-soak",
    network: APP_NETWORK,
    chainId: APP_CHAIN.id,
    contractAddress: CONTRACT_ADDRESS.toLowerCase(),
    contractDeployBlock: CONTRACT_DEPLOY_BLOCK.toString(),
    runtimeSha256: params.runtimeIdentity.normalizedRuntimeSha256,
    manifestSha256: params.runtimeIdentity.manifestDigest,
    deploymentManifestSha256: params.deploymentManifest.deploymentManifestSha256,
    sourceArtifactGitSha: params.deploymentManifest.sourceArtifactGitSha,
    canonicalProvenanceVerified: params.runtimeIdentity.canonicalProvenanceVerified,
    previewSha256: params.previewBinding?.previewSha256 ?? null,
    walletSetSha256: params.walletSetSha256,
    canaryPlanSha256: params.previewBinding?.canaryPlanSha256 ?? CANARY_PLAN_SHA256,
    selectedRoles,
    roleCaps: selectedRoles.map((role) => {
      const cap = params.plannedSpendByRole.get(role) ?? 0n;
      if (cap < 0n) throw new Error(`Canary admission spend cap is invalid for ${role}`);
      return { role, spendCapWei: cap.toString(), allowanceCapWei: cap.toString() };
    }),
  };
  const admissionSha256 = createHash("sha256").update(canonicalAdmissionPayload(admission), "utf8").digest("hex");
  writeEvent(params.logPath, {
    admission,
    admissionSha256,
    amount: "0",
    mode: "admission",
    ok: true,
    role: "SYSTEM",
    round: -1,
    signatureRequested: false,
    signingMaterialLoaded: false,
    timestamp: new Date().toISOString(),
    transactionSent: false,
    walletClientCreated: false,
  });
  activeAdmission = {
    admissionSha256,
    runId: admission.runId,
    walletSetSha256: admission.walletSetSha256,
  };
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
      ...(activeAdmission && event.mode !== "admission"
        ? {
          admissionSha256: activeAdmission.admissionSha256,
          runId: activeAdmission.runId,
          walletSetSha256: activeAdmission.walletSetSha256,
        }
        : {}),
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
    allowanceCapWei: approveAmount.toString(),
    allowanceWei: actualAllowance.toString(),
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
    txStatus: receipt.status,
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
    totalAmountWei: plan.totalAmount.toString(),
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
      allowanceCapWei: plannedSpend.toString(),
      allowanceWei: allowance.toString(),
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
      allowanceCapWei: plannedSpend.toString(),
      allowanceWei: allowance.toString(),
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
      totalAmountWei: plannedSpend.toString(),
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
  const publicWalletConfig = loadLiveTestPublicWalletConfig({
    cwd: process.cwd(),
    environment: process.env,
  }) as PublicWalletAdmission;
  const previewBinding = DRY_RUN ? null : assertFreshPreviewBinding(publicWalletConfig);
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
  console.log(`[live-canary] walletSetSha256=${publicWalletConfig.walletSetSha256}`);
  console.log(`[live-canary] canaryPlanSha256=${CANARY_PLAN_SHA256}`);
  if (previewBinding) console.log(`[live-canary] previewSha256=${previewBinding.previewSha256}`);
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
  console.log(
    `[live-canary] runtimeIdentity deployBlock=${runtimeIdentity.deployBlock} ` +
      `runtimeDigest=${runtimeIdentity.normalizedRuntimeSha256.slice(0, 12)}…`,
  );
  const deploymentManifest = verifyV10SepoliaDeploymentManifest({ verifyGitArtifact: false }) as V10DeploymentManifestBinding;
  if (
    runtimeIdentity.contractAddress.toLowerCase() !== deploymentManifest.contractAddress
    || runtimeIdentity.deployBlock !== deploymentManifest.deployBlock
    || runtimeIdentity.normalizedRuntimeSha256 !== deploymentManifest.normalizedExecutableRuntimeSha256
  ) {
    throw new Error("V10 runtime identity does not match the canonical Sepolia deployment manifest");
  }

  // The public, pinned wallet set is sufficient to make the plan and persist the
  // admission record. Keep the execution keys out of this phase entirely.
  const admissionWallets = loadDryRunWallets(publicWalletConfig);
  const plannedSpendByRole = getPlannedSpendByRole(admissionWallets);
  const plannedStake = [...plannedSpendByRole.values()].reduce((sum, value) => sum + value, 0n);
  if (!DRY_RUN && !previewBinding) {
    throw new Error("Live admission requires a fresh Preview binding");
  }
  // This is the sole run admission record. It is appended after the read-only
  // runtime proof and before any signing material, wallet client, signature, or
  // transaction request.
  writeCanaryAdmission({
    logPath,
    previewBinding,
    runtimeIdentity,
    deploymentManifest,
    plannedSpendByRole,
    walletSetSha256: publicWalletConfig.walletSetSha256,
    wallets: admissionWallets,
  });
  let executionWalletConfig: ExecutionWalletAdmission | null = null;
  let wallets: CanaryWallet[] = admissionWallets;
  if (!DRY_RUN) {
    // The public file is re-read while loading the signing keys so a
    // post-Preview address-set change fails closed after the recorded admission.
    executionWalletConfig = loadExecutionWalletAdmission({
      cwd: process.cwd(),
      environment: process.env,
      expectedWalletSetSha256: publicWalletConfig.walletSetSha256,
      publicConfig: publicWalletConfig,
    }) as ExecutionWalletAdmission;
    wallets = loadWallets(executionWalletConfig);
    console.log(
      `[live-canary] executionWalletBinding walletSetSha256=${executionWalletConfig.walletSetSha256} ` +
        "signingMaterialLoaded=true signatureRequested=false",
    );
  }
  writeEvent(logPath, {
    amount: "0",
    mode: "preflight",
    ok: true,
    role: "SYSTEM",
    round: -1,
    runtimeIdentity,
    deploymentManifestSha256: deploymentManifest.deploymentManifestSha256,
    sourceArtifactGitSha: deploymentManifest.sourceArtifactGitSha,
    timestamp: new Date().toISOString(),
  });
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
  if (!executionWalletConfig) throw new Error("Validated execution wallet configuration is unavailable");
  const liveWallets = wallets as LiveWallet[];
  const resolverAccount = executionWalletConfig.accountsByRole.get("RESOLVER");
  if (!resolverAccount) throw new Error("Validated RESOLVER wallet is unavailable");
  const resolver = { role: "RESOLVER", address: resolverAccount.address, account: resolverAccount };
  const resolverCandidates = [
    resolver,
    ...liveWallets.filter((wallet) => wallet.account.address.toLowerCase() !== resolver.account.address.toLowerCase()),
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

if (process.argv.includes("--inspect-canary-plan")) {
  try {
    inspectCanaryPlan();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[live-canary] failed: ${redactCanaryErrorMessage(message)}`);
    process.exitCode = 1;
  }
} else if (process.argv.includes("--inspect-fresh-preview-binding")) {
  try {
    inspectFreshPreviewBinding();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[live-canary] failed: ${redactCanaryErrorMessage(message)}`);
    process.exitCode = 1;
  }
} else if (process.argv.includes("--inspect-execution-wallet-binding")) {
  try {
    inspectExecutionWalletBinding();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[live-canary] failed: ${redactCanaryErrorMessage(message)}`);
    process.exitCode = 1;
  }
} else {
  main().catch((error) => {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error(`[live-canary] failed: ${redactCanaryErrorMessage(message)}`);
    process.exitCode = 1;
  });
}
