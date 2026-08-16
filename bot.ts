import "dotenv/config";
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  fallback,
  formatUnits,
  getAddress,
  http,
  keccak256,
  toHex,
} from "viem";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sanitizeSentryPayload } from "./app/lib/sentrySanitize";
import {
  assertKeeperFeeBudget,
  getKeeperDailyBudgetPolicy,
  getKeeperFeeOverrides,
} from "./app/lib/lineaFees";
import {
  getConfiguredContractAddress,
  getConfiguredLineaNetwork,
  getDefaultLineaRpcs,
  getLineaChain,
  getPreferredLineaRpcs,
} from "./config/publicConfig";
import { RESOLVE_ABI } from "./config/abi";
import {
  assertProductionRuntimeConfig,
  parseRequiredRuntimeFinalityBlocks,
} from "./config/productionRuntime";
import {
  getMetaJsonStrict,
  reserveKeeperDailyBudget,
  setMetaJson,
} from "./server/storage";
import {
  assertKeeperReceiptFinality,
  assertKeeperSignedTransactionIntegrity,
  fingerprintKeeperEligibility,
  fingerprintKeeperNonce,
  fingerprintKeeperReceipt,
  KeeperRpcAgreementError,
  readWithExactKeeperRpcAgreement,
  selectKeeperAgreementRpcUrls,
  type KeeperCanonicalBlockObservation,
  type KeeperEligibilityObservation,
  type KeeperNonceObservation,
  type KeeperReceiptObservation,
} from "./server/keeperSigningSafety";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const APP_NETWORK = getConfiguredLineaNetwork();
const APP_CHAIN = getLineaChain(APP_NETWORK);
const DEFAULT_RPC_URL = getDefaultLineaRpcs(APP_NETWORK)[0];
const DEFAULT_CONTRACT = getConfiguredContractAddress(
  process.env.KEEPER_CONTRACT_ADDRESS ??
    process.env.NEXT_PUBLIC_CONTRACT_ADDRESS,
  APP_NETWORK,
);
const ALERT_BOT_TOKEN = process.env.ALERT_TELEGRAM_BOT_TOKEN ?? "";
const ALERT_CHAT_ID = process.env.ALERT_TELEGRAM_CHAT_ID ?? "";
const ALERT_THREAD_ID = process.env.ALERT_TELEGRAM_THREAD_ID ?? "";
const ALERT_PREFIX = process.env.ALERT_PREFIX ?? "LORE Keeper";
const ALERT_REQUEST_TIMEOUT_MS = 10_000;
const MAX_ALERT_RESPONSE_BYTES = 64 * 1024;
const ALERT_CONTENT_LENGTH_RE = /^(?:0|[1-9]\d{0,15})$/;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const PENDING_RESOLVE_REVERT_RETRY_MS = (() => {
  const raw = Number(process.env.PENDING_RESOLVE_REVERT_RETRY_MS ?? "300000");
  if (Number.isFinite(raw) && raw > 0) return raw;
  if (process.env.PENDING_RESOLVE_REVERT_RETRY_MS !== undefined)
    console.warn(`[keeper] Invalid PENDING_RESOLVE_REVERT_RETRY_MS="${process.env.PENDING_RESOLVE_REVERT_RETRY_MS}", defaulting to 300000`);
  return 300_000;
})();
const NORMAL_MAX_FEE_BUMP_PERCENT = 130n;
const NORMAL_PRIORITY_BUMP_PERCENT = 125n;
const GAS_LIMIT_MARGIN_PERCENT = 150n;
const KEEPER_DAILY_BUDGET_POLICY = getKeeperDailyBudgetPolicy(APP_CHAIN.id);
const PENDING_RESOLVE_REBROADCAST_INTERVAL_MS = 15_000;
const HASH_RE = /^0x[a-fA-F0-9]{64}$/;
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const SERIALIZED_TRANSACTION_RE = /^0x(?:[a-fA-F0-9]{2})+$/;
const MAX_SERIALIZED_TRANSACTION_LENGTH = 256 * 1024;

// V9 atomic resolve: a single tx finalizes the epoch. Players normally
// trigger _autoResolveIfNeeded() via their next bet - the keeper is just a
// fallback for empty/quiet rounds. Keep grace short so the UI doesn't freeze.
const GRACE_SECONDS = (() => {
  const raw = Number(process.env.LAST_BET_GRACE_SECONDS ?? process.env.KEEPER_GRACE_SECONDS ?? "2");
  if (!Number.isFinite(raw) || raw < 0 || raw > 60) {
    console.warn(`[keeper] GRACE_SECONDS=${raw} out of range [0..60], defaulting to 2`);
    return 2;
  }
  return raw;
})();
const ALERT_COOLDOWN_MS = (() => {
  const raw = Number(process.env.ALERT_COOLDOWN_MS ?? "300000");
  return Number.isFinite(raw) && raw > 0 ? raw : 300_000;
})();

function extractFeeOverrideFields(fees: Record<string, unknown> | null | undefined) {
  if (!fees) return {};
  const f = fees as { gasPrice?: bigint; maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint };
  if (f.gasPrice !== undefined) return { gasPrice: f.gasPrice };
  if (f.maxFeePerGas !== undefined) {
    // EIP-1559 requires both fields; default priority to 10% of maxFee if absent
    const priority = f.maxPriorityFeePerGas ?? f.maxFeePerGas / 10n;
    return { maxFeePerGas: f.maxFeePerGas, maxPriorityFeePerGas: priority };
  }
  return {};
}

const ABI = RESOLVE_ABI;

type PendingResolve = {
  epoch: bigint;
  signer: `0x${string}`;
  hash: `0x${string}`;
  nonce: number;
  serializedTransaction: Hex;
  submittedAt: number;
  lastBroadcastAt?: number;
  retryAt?: number;
};

type StoredPendingResolve = Omit<PendingResolve, "epoch"> & { epoch: string };

type KeeperPublicClient = ReturnType<typeof createPublicClient>;
type KeeperAgreementClients = readonly [KeeperPublicClient, KeeperPublicClient];

const alertCooldowns = new Map<string, number>();
const PENDING_RESOLVE_META_KEY = "bot:pendingResolve";

function isStoredPendingResolve(value: unknown): value is StoredPendingResolve {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<StoredPendingResolve>;
  const optionalTimes = [record.lastBroadcastAt, record.retryAt];
  return (
    typeof record.epoch === "string" &&
    /^(?:0|[1-9]\d*)$/.test(record.epoch) &&
    typeof record.signer === "string" &&
    ADDRESS_RE.test(record.signer) &&
    typeof record.hash === "string" &&
    HASH_RE.test(record.hash) &&
    typeof record.serializedTransaction === "string" &&
    record.serializedTransaction.length <= MAX_SERIALIZED_TRANSACTION_LENGTH &&
    SERIALIZED_TRANSACTION_RE.test(record.serializedTransaction) &&
    typeof record.nonce === "number" &&
    Number.isSafeInteger(record.nonce) &&
    record.nonce >= 0 &&
    typeof record.submittedAt === "number" &&
    Number.isSafeInteger(record.submittedAt) &&
    record.submittedAt > 0 &&
    optionalTimes.every((time) =>
      time === undefined ||
      (typeof time === "number" && Number.isSafeInteger(time) && time > 0)
    )
  );
}

function describeKeeperError(error: unknown, maxLength = 220) {
  const message = error instanceof Error ? error.message : String(error ?? "unknown error");
  return String(sanitizeSentryPayload(message)).slice(0, maxLength);
}

async function readBoundedAlertResponseText(response: Response) {
  const contentLength = parseAlertContentLengthHeader(response.headers.get("content-length"));
  if (contentLength !== null && contentLength > MAX_ALERT_RESPONSE_BYTES) {
    throw new Error("alert response body too large");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let totalBytes = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_ALERT_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error("alert response body too large");
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return text;
}

function parseAlertContentLengthHeader(value: string | null) {
  if (value == null || value === "") return null;
  if (!ALERT_CONTENT_LENGTH_RE.test(value)) throw new Error("alert response has invalid content-length");
  const parsed = BigInt(value);
  if (parsed > MAX_SAFE_INTEGER_BIGINT) throw new Error("alert response has invalid content-length");
  return Number(parsed);
}

function savePendingResolve(value: PendingResolve | null): PendingResolve | null {
  setMetaJson(PENDING_RESOLVE_META_KEY, value ? { ...value, epoch: value.epoch.toString() } : null);
  return value;
}

function expectedResolveData(epoch: bigint) {
  return encodeFunctionData({
    abi: ABI,
    functionName: "resolveEpoch",
    args: [epoch],
  });
}

function assertPendingResolveIntegrity(
  pending: PendingResolve,
  expectedSigner: `0x${string}`,
  contractAddress: `0x${string}`,
) {
  return assertKeeperSignedTransactionIntegrity(pending, {
    chainId: APP_CHAIN.id,
    signer: expectedSigner,
    to: contractAddress,
    data: expectedResolveData(pending.epoch),
  });
}

async function readKeeperEligibility(
  publicClient: KeeperPublicClient,
  contractAddress: `0x${string}`,
): Promise<KeeperEligibilityObservation> {
  const epoch = await publicClient.readContract({
    address: contractAddress,
    abi: ABI,
    functionName: "currentEpoch",
  });
  const endTime = await publicClient.readContract({
    address: contractAddress,
    abi: ABI,
    functionName: "getEpochEndTime",
    args: [epoch],
  });
  const epochData = await publicClient.readContract({
    address: contractAddress,
    abi: ABI,
    functionName: "epochs",
    args: [epoch],
  });
  return {
    epoch,
    endTime,
    totalPool: epochData[0] as bigint,
    isResolved: Boolean(epochData[3]),
  };
}

async function readAgreedKeeperEligibility(
  publicClients: KeeperAgreementClients,
  contractAddress: `0x${string}`,
) {
  return readWithExactKeeperRpcAgreement(
    "eligibility",
    [
      () => readKeeperEligibility(publicClients[0], contractAddress),
      () => readKeeperEligibility(publicClients[1], contractAddress),
    ],
    fingerprintKeeperEligibility,
  );
}

async function readKeeperNonce(
  publicClient: KeeperPublicClient,
  accountAddress: `0x${string}`,
): Promise<KeeperNonceObservation> {
  const latestNonce = await publicClient.getTransactionCount({
    address: accountAddress,
    blockTag: "latest",
  });
  const pendingNonce = await publicClient.getTransactionCount({
    address: accountAddress,
    blockTag: "pending",
  });
  return { latestNonce, pendingNonce };
}

async function readAgreedKeeperNonce(
  publicClients: KeeperAgreementClients,
  accountAddress: `0x${string}`,
) {
  return readWithExactKeeperRpcAgreement(
    "nonce",
    [
      () => readKeeperNonce(publicClients[0], accountAddress),
      () => readKeeperNonce(publicClients[1], accountAddress),
    ],
    fingerprintKeeperNonce,
  );
}

async function readKeeperReceipt(
  publicClient: KeeperPublicClient,
  hash: `0x${string}`,
): Promise<KeeperReceiptObservation | null> {
  try {
    const receipt = await publicClient.getTransactionReceipt({ hash });
    return {
      status: receipt.status,
      transactionHash: receipt.transactionHash,
      blockHash: receipt.blockHash,
      blockNumber: receipt.blockNumber,
      transactionIndex: receipt.transactionIndex,
    };
  } catch (error) {
    if (isReceiptNotFoundLikeError(error)) return null;
    throw error;
  }
}

async function readAgreedKeeperReceipt(
  publicClients: KeeperAgreementClients,
  hash: `0x${string}`,
) {
  const receipt = await readWithExactKeeperRpcAgreement(
    "receipt",
    [
      () => readKeeperReceipt(publicClients[0], hash),
      () => readKeeperReceipt(publicClients[1], hash),
    ],
    fingerprintKeeperReceipt,
  );
  if (
    receipt &&
    receipt.transactionHash.toLowerCase() !== hash.toLowerCase()
  ) {
    throw new KeeperRpcAgreementError("receipt_transaction_hash");
  }
  return receipt;
}

async function readKeeperCanonicalBlock(
  publicClient: KeeperPublicClient,
  receipt: KeeperReceiptObservation,
  finalityBlocks: bigint,
): Promise<KeeperCanonicalBlockObservation> {
  const headBlock = await publicClient.getBlockNumber();
  if (headBlock < receipt.blockNumber + finalityBlocks) {
    return { headBlock, blockHash: null };
  }
  const block = await publicClient.getBlock({ blockNumber: receipt.blockNumber });
  return { headBlock, blockHash: block.hash };
}

async function hasAgreedKeeperReceiptFinality(
  publicClients: KeeperAgreementClients,
  receipt: KeeperReceiptObservation,
  finalityBlocks: bigint,
) {
  const observations = await Promise.all([
    readKeeperCanonicalBlock(publicClients[0], receipt, finalityBlocks),
    readKeeperCanonicalBlock(publicClients[1], receipt, finalityBlocks),
  ]) as [KeeperCanonicalBlockObservation, KeeperCanonicalBlockObservation];
  return assertKeeperReceiptFinality(
    receipt,
    finalityBlocks,
    observations,
  );
}

function isAlertingEnabled() {
  return Boolean(ALERT_BOT_TOKEN && ALERT_CHAT_ID);
}

function shouldSendAlert(key: string, cooldownMs = ALERT_COOLDOWN_MS) {
  const now = Date.now();
  const last = alertCooldowns.get(key) ?? 0;
  if (now - last < cooldownMs) return false;
  alertCooldowns.set(key, now);
  if (alertCooldowns.size > 500) {
    const cutoff = now - ALERT_COOLDOWN_MS;
    for (const [k, t] of alertCooldowns) {
      if (t < cutoff) alertCooldowns.delete(k);
    }
  }
  return true;
}

async function sendTelegramAlert(text: string, key: string, cooldownMs = ALERT_COOLDOWN_MS) {
  if (!isAlertingEnabled()) return;
  if (!shouldSendAlert(key, cooldownMs)) return;

  const body = new URLSearchParams({
    chat_id: ALERT_CHAT_ID,
    text: `*${ALERT_PREFIX}*\n${text}`,
    parse_mode: "Markdown",
    disable_web_page_preview: "true",
  });
  if (ALERT_THREAD_ID) body.set("message_thread_id", ALERT_THREAD_ID);

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${ALERT_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(ALERT_REQUEST_TIMEOUT_MS),
      });
      if (res.ok) return;
      const msg = await readBoundedAlertResponseText(res).catch((err) => describeKeeperError(err));
      console.error(`[alert] Telegram send failed (attempt ${attempt + 1}): HTTP ${res.status} ${describeKeeperError(msg)}`);
      // Don't retry permanent client errors (4xx except 429)
      if (res.status !== 429 && res.status < 500) return;
    } catch (err) {
      console.error(`[alert] Telegram send error (attempt ${attempt + 1}):`, describeKeeperError(err));
    }
    if (attempt === 0) await delay(2000);
  }
}

function isNetworkLikeError(msg: string) {
  const low = msg.toLowerCase();
  return (
    low.includes("failed to fetch") ||
    low.includes("fetch failed") ||
    low.includes("network") ||
    low.includes("timeout") ||
    low.includes("etimedout") ||
    low.includes("econnreset") ||
    low.includes("econnrefused") ||
    low.includes("429") ||
    low.includes("rate limit")
  );
}

function isReceiptNotFoundLikeError(error: unknown) {
  const name = error instanceof Error ? error.name.toLowerCase() : "";
  const message = (error instanceof Error ? error.message : String(error ?? "")).toLowerCase();
  return (
    name.includes("transactionreceiptnotfound") ||
    message.includes("transaction receipt not found") ||
    message.includes("receipt not found") ||
    message.includes("transaction not found") ||
    message.includes("not found")
  );
}

function getRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function isSkippableResolveError(message: string) {
  return (
    message.includes("known transaction") ||
    message.includes("already known") ||
    message.includes("nonce too low") ||
    message.includes("replacement transaction underpriced") ||
    message.includes("execution reverted") ||
    message.includes("reverted with the following signature") ||
    message.includes("epochalreadyclosed") ||
    message.includes("alreadyresolved") ||
    message.includes("timernotended") ||
    message.includes("canonlyresolvecurrent")
  );
}

async function broadcastPendingResolve(options: {
  pending: PendingResolve;
  expectedSigner: `0x${string}`;
  contractAddress: `0x${string}`;
  walletClient: ReturnType<typeof createWalletClient>;
}) {
  const { pending, expectedSigner, contractAddress, walletClient } = options;
  await assertPendingResolveIntegrity(
    pending,
    expectedSigner,
    contractAddress,
  );
  const persisted = savePendingResolve({
    ...pending,
    lastBroadcastAt: Date.now(),
  });
  if (!persisted) throw new Error("keeper_pending_resolve_persistence_failed");
  try {
    const broadcastHash = await walletClient.sendRawTransaction({
      serializedTransaction: persisted.serializedTransaction,
    });
    if (broadcastHash.toLowerCase() !== persisted.hash.toLowerCase()) {
      throw new Error("keeper_broadcast_hash_mismatch");
    }
  } catch (broadcastError) {
    console.warn(
      `[keeper] Broadcast outcome is unknown; the exact signed resolve remains locked for idempotent recovery: ${describeKeeperError(broadcastError, 100)}`,
    );
  }
  return persisted;
}

async function tryResolveEpochAction(options: {
  accountAddress: `0x${string}`;
  account: ReturnType<typeof privateKeyToAccount>;
  contractAddress: `0x${string}`;
  epoch: bigint;
  gasLimitMarginPercent: bigint;
  publicClient: ReturnType<typeof createPublicClient>;
  agreementClients: KeeperAgreementClients;
  walletClient: ReturnType<typeof createWalletClient>;
}) {
  const {
    accountAddress,
    account,
    contractAddress,
    epoch,
    gasLimitMarginPercent,
    publicClient,
    agreementClients,
    walletClient,
  } = options;

  const est = await publicClient.estimateContractGas({
    account: accountAddress,
    address: contractAddress,
    abi: ABI,
    functionName: "resolveEpoch",
    args: [epoch],
  });
  const fees = await publicClient.estimateFeesPerGas();
  const { latestNonce, pendingNonce } = await readAgreedKeeperNonce(
    agreementClients,
    accountAddress,
  );
  const hasPendingTransaction = pendingNonce > latestNonce;
  if (hasPendingTransaction) {
    throw new Error(
      `keeper_pending_nonce_unbound latest=${latestNonce.toString()} pending=${pendingNonce.toString()}`,
    );
  }
  const estimatedFeeOverrides = getKeeperFeeOverrides(
    fees,
    APP_CHAIN.id,
    NORMAL_MAX_FEE_BUMP_PERCENT,
    NORMAL_PRIORITY_BUMP_PERCENT,
  );
  const rawFeeOverrides = extractFeeOverrideFields(estimatedFeeOverrides);
  const txFeeOverrides = extractFeeOverrideFields(rawFeeOverrides);
  const gas = (est * gasLimitMarginPercent + 99n) / 100n;
  const requiredMaxCost = assertKeeperFeeBudget(
    txFeeOverrides,
    gas,
    APP_CHAIN.id,
    "keeper",
  );
  const keeperBalance = await publicClient.getBalance({ address: accountAddress });
  if (keeperBalance < requiredMaxCost) {
    throw new Error(
      `keeper_insufficient_funds balance=${keeperBalance.toString()} requiredMaxCost=${requiredMaxCost.toString()} estimatedGas=${est.toString()}`,
    );
  }
  const data = encodeFunctionData({
    abi: ABI,
    functionName: "resolveEpoch",
    args: [epoch],
  });
  const transactionBase = {
    chainId: APP_CHAIN.id,
    data,
    gas,
    nonce: latestNonce,
    to: contractAddress,
    value: 0n,
  } as const;
  const signingIntentHash = keccak256(toHex([
    "resolveEpoch:v1",
    APP_CHAIN.id.toString(),
    accountAddress.toLowerCase(),
    contractAddress.toLowerCase(),
    epoch.toString(),
    data.toLowerCase(),
    gas.toString(),
    latestNonce.toString(),
    txFeeOverrides.gasPrice?.toString() ?? "",
    txFeeOverrides.maxFeePerGas?.toString() ?? "",
    txFeeOverrides.maxPriorityFeePerGas?.toString() ?? "",
  ].join("|")));
  const dailyBudgetReservation = reserveKeeperDailyBudget({
    chainId: APP_CHAIN.id,
    contractAddress,
    signerAddress: accountAddress,
    nonce: latestNonce,
    epoch,
    signingIntentHash,
    reservedMaxCostWei: requiredMaxCost,
    policy: KEEPER_DAILY_BUDGET_POLICY,
  });
  if (dailyBudgetReservation.status === "reserved") {
    console.log(
      `[keeper] Daily circuit breaker reserved signature ${dailyBudgetReservation.reservedSignatureCount}/${KEEPER_DAILY_BUDGET_POLICY.maxSignatures}; ` +
      `maximum cost ${dailyBudgetReservation.reservedMaxCostWei.toString()}/${KEEPER_DAILY_BUDGET_POLICY.maxReservedCostWei.toString()} wei.`,
    );
  }
  const serializedTransaction = txFeeOverrides.gasPrice !== undefined
    ? await account.signTransaction({
        ...transactionBase,
        gasPrice: txFeeOverrides.gasPrice,
        type: "legacy",
      })
    : await account.signTransaction({
        ...transactionBase,
        maxFeePerGas: txFeeOverrides.maxFeePerGas,
        maxPriorityFeePerGas: txFeeOverrides.maxPriorityFeePerGas,
        type: "eip1559",
      });
  const hash = keccak256(serializedTransaction);
  const pendingCandidate: PendingResolve = {
    epoch,
    signer: accountAddress,
    hash,
    nonce: latestNonce,
    serializedTransaction,
    submittedAt: Date.now(),
  };
  await assertPendingResolveIntegrity(
    pendingCandidate,
    accountAddress,
    contractAddress,
  );
  const pending = savePendingResolve({
    ...pendingCandidate,
  });
  if (!pending) {
    throw new Error("keeper_pending_resolve_persistence_failed");
  }
  const submitted = await broadcastPendingResolve({
    pending,
    expectedSigner: accountAddress,
    contractAddress,
    walletClient,
  });
  console.log(`Resolve epoch ${epoch.toString()} submitted (gas: ${gas}). Tx: ${hash}`);
  return submitted;
}

async function startKeeperBot() {
  assertProductionRuntimeConfig("bot");
  const keeperFinalityBlocks = parseRequiredRuntimeFinalityBlocks(
    process.env.INDEXER_FINALITY_BLOCKS,
  );
  const privateKeyRaw = getRequiredEnv("KEEPER_PRIVATE_KEY").replace(/^0x/, "");
  const contractAddress = getAddress(process.env.KEEPER_CONTRACT_ADDRESS ?? DEFAULT_CONTRACT);
  const rpcUrl = process.env.KEEPER_RPC_URL ?? DEFAULT_RPC_URL;
  const account = privateKeyToAccount(`0x${privateKeyRaw}`);
  const rpcUrls = getPreferredLineaRpcs(rpcUrl, APP_NETWORK);
  const agreementRpcUrls = selectKeeperAgreementRpcUrls(rpcUrls);

  const transport = fallback(rpcUrls.map((url) => http(url)));
  const publicClient = createPublicClient({
    chain: APP_CHAIN,
    transport,
  });
  const walletClient = createWalletClient({
    account,
    chain: APP_CHAIN,
    transport,
  });
  const agreementClients: KeeperAgreementClients = [
    createPublicClient({ chain: APP_CHAIN, transport: http(agreementRpcUrls[0]) }),
    createPublicClient({ chain: APP_CHAIN, transport: http(agreementRpcUrls[1]) }),
  ];

  console.log("===============================================");
  console.log("LineaOre Keeper Bot (fallback mode)");
  console.log(`Keeper:       ${account.address}`);
  console.log(`Contract:     ${contractAddress}`);
  console.log(`Grace period: ${GRACE_SECONDS}s`);
  console.log(
    `Daily budget: ${KEEPER_DAILY_BUDGET_POLICY.maxSignatures} signatures / ` +
    `${KEEPER_DAILY_BUDGET_POLICY.maxReservedCostWei.toString()} wei maximum reserved cost`,
  );
  console.log("===============================================");
  if (isAlertingEnabled()) {
    await sendTelegramAlert(
      `started\nKeeper: \`${account.address}\`\nContract: \`${contractAddress}\`\nGrace: \`${GRACE_SECONDS}s\``,
      "bot-start",
      60_000,
    );
  }

  let consecutiveErrors = 0;
  let consecutiveNetworkErrors = 0;
  let pendingResolve: PendingResolve | null = null;
  let stored: unknown;
  try {
    stored = getMetaJsonStrict<unknown>(PENDING_RESOLVE_META_KEY);
  } catch {
    throw new Error("keeper_pending_resolve_state_invalid_manual_reconciliation_required");
  }
  if (isStoredPendingResolve(stored)) {
    const restoredPendingResolve: PendingResolve = {
      epoch: BigInt(stored.epoch),
      signer: stored.signer,
      hash: stored.hash,
      nonce: stored.nonce,
      serializedTransaction: stored.serializedTransaction,
      submittedAt: stored.submittedAt,
      ...(stored.lastBroadcastAt === undefined ? {} : { lastBroadcastAt: stored.lastBroadcastAt }),
      ...(stored.retryAt === undefined ? {} : { retryAt: stored.retryAt }),
    };
    await assertPendingResolveIntegrity(
      restoredPendingResolve,
      account.address,
      contractAddress,
    );
    pendingResolve = restoredPendingResolve;
    console.log(`[keeper] Restored pending resolve for epoch ${restoredPendingResolve.epoch.toString()} from storage. Tx: ${restoredPendingResolve.hash}`);
  } else if (stored !== null) {
    throw new Error("keeper_pending_resolve_state_invalid_manual_reconciliation_required");
  }

  while (true) {
    try {
      const eligibility = await readAgreedKeeperEligibility(
        agreementClients,
        contractAddress,
      );
      const { epoch, endTime, isResolved, totalPool } = eligibility;

      const now = Math.floor(Date.now() / 1000);
      const secondsLeft = Number(endTime) - now;
      const overdue = -secondsLeft;

      if (pendingResolve) {
        const pending = pendingResolve;
        try {
          const receipt = await readAgreedKeeperReceipt(agreementClients, pending.hash);
          if (receipt) {
            console.log(`\nPending resolve receipt found for epoch ${pending.epoch.toString()} (${receipt.status}). Tx: ${pending.hash}`);
            const finalized = await hasAgreedKeeperReceiptFinality(
              agreementClients,
              receipt,
              keeperFinalityBlocks,
            );
            if (!finalized) {
              process.stdout.write(
                `\rEpoch #${epoch.toString()} | resolve receipt awaiting ${keeperFinalityBlocks.toString()}-block finality   `,
              );
              await delay(1500);
              continue;
            }
            if (receipt.status === "success") {
              pendingResolve = savePendingResolve(null);
              await delay(1500);
              continue;
            } else if (pending.retryAt && Date.now() < pending.retryAt) {
              process.stdout.write(`\rEpoch #${epoch.toString()} | resolve reverted | retry deferred   `);
              await delay(1500);
              continue;
            } else if (pending.retryAt) {
              console.warn(`\nResolve retry window reached for epoch ${pending.epoch.toString()}.`);
              pendingResolve = savePendingResolve(null);
            } else {
              const retryAt = Date.now() + PENDING_RESOLVE_REVERT_RETRY_MS;
              console.warn(`\nResolve tx reverted for epoch ${pending.epoch.toString()}; retry deferred until ${new Date(retryAt).toISOString()}.`);
              pendingResolve = savePendingResolve({ ...pending, retryAt });
              await delay(1500);
              continue;
            }
          } else {
            const { latestNonce, pendingNonce } = await readAgreedKeeperNonce(
              agreementClients,
              account.address,
            );
            if (latestNonce > pending.nonce || pendingNonce > pending.nonce) {
              process.stdout.write(
                `\rEpoch #${epoch.toString()} | resolve nonce observed without canonical receipt | ${pending.hash.slice(0, 10)}...   `,
              );
              await delay(1500);
              continue;
            }
            const lastBroadcastAt = pending.lastBroadcastAt ?? 0;
            if (Date.now() - lastBroadcastAt >= PENDING_RESOLVE_REBROADCAST_INTERVAL_MS) {
              pendingResolve = await broadcastPendingResolve({
                pending,
                expectedSigner: account.address,
                contractAddress,
                walletClient,
              });
            }
            process.stdout.write(`\rEpoch #${epoch.toString()} | resolve tx unresolved | ${pending.hash.slice(0, 10)}...   `);
            await delay(1500);
            continue;
          }
        } catch (receiptCheckErr) {
          const receiptCheckMsg = receiptCheckErr instanceof Error ? (receiptCheckErr.message ?? "") : String(receiptCheckErr);
          if (isNetworkLikeError(receiptCheckMsg)) {
            console.warn(`\nPending resolve confirmation failed (network): ${describeKeeperError(receiptCheckMsg, 100)}`);
          } else {
            console.log(
              `\nPending resolve confirmation failed closed: ${describeKeeperError(receiptCheckMsg, 100)}`,
            );
          }
          await delay(3000);
          continue;
        }
      }

      const shouldResolve = secondsLeft <= -GRACE_SECONDS && !isResolved && totalPool > 0n;

      if (shouldResolve) {
        const poolStr = formatUnits(totalPool, 18);
        console.log(`\nResolving epoch ${epoch.toString()} (pool: ${poolStr} LINEA, overdue ${overdue}s)...`);
        try {
          pendingResolve = await tryResolveEpochAction({
            accountAddress: account.address,
            account,
            contractAddress,
            epoch,
            gasLimitMarginPercent: GAS_LIMIT_MARGIN_PERCENT,
            publicClient,
            agreementClients,
            walletClient,
          });
          consecutiveErrors = 0;
          consecutiveNetworkErrors = 0;
        } catch (txErr) {
          const errMessage = txErr instanceof Error ? txErr.message : String(txErr);
          const errStr = errMessage.toLowerCase();
          const safeErr = describeKeeperError(errMessage);
          if (isSkippableResolveError(errStr)) {
            console.log(`Epoch ${epoch.toString()} skipped (${safeErr})`);
            await delay(1500);
          } else {
            await sendTelegramAlert(
              `resolve tx error on epoch \`${epoch.toString()}\`\n\`${safeErr}\``,
              "resolve-tx-error",
            );
            throw txErr;
          }
        }
      } else {
        const display = isResolved
          ? "resolved"
          : secondsLeft <= 0
            ? totalPool === BigInt(0)
              ? "idle | no bets"
              : `pending | grace ${Math.max(0, GRACE_SECONDS - overdue)}s`
            : "open";
        process.stdout.write(
          `\rEpoch #${epoch.toString()} | ${Math.max(0, secondsLeft)}s left | ${display}   `,
        );
      }
    } catch (error) {
      consecutiveErrors += 1;
      const msg = error instanceof Error ? error.message : String(error);
      const low = msg.toLowerCase();
      const safeMessage = describeKeeperError(msg);
      if (isNetworkLikeError(low)) {
        consecutiveNetworkErrors += 1;
      } else {
        consecutiveNetworkErrors = 0;
      }
      if (isSkippableResolveError(low) || low.includes("0x22daea9a")) {
        console.log(`\n[skip] ${safeMessage}`);
      } else {
        console.log(`\nKeeper error: ${safeMessage}`);
      }

      if (consecutiveNetworkErrors >= 3) {
        await sendTelegramAlert(
          `network/rpc instability x${consecutiveNetworkErrors}\n\`${safeMessage}\``,
          "rpc-instability",
          10 * 60_000,
        );
      }
      if (consecutiveErrors >= 5) {
        await sendTelegramAlert(
          `consecutive errors x${consecutiveErrors}\n\`${safeMessage}\``,
          "consecutive-errors",
          10 * 60_000,
        );
      }
    }

    const loopDelay = pendingResolve != null ? 1500 : 3000;
    await delay(loopDelay);
  }
}

startKeeperBot().catch((err) => {
  console.error("[keeper] Fatal startup error:", describeKeeperError(err));
  process.exit(1);
});
