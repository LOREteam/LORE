import "dotenv/config";
import { createPublicClient, createWalletClient, getAddress, http, fallback, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sanitizeSentryPayload } from "./app/lib/sentrySanitize";
import {
  clampKeeperFeeOverridesToBalance,
  getAffordableKeeperGasLimit,
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
import { assertProductionRuntimeConfig } from "./config/productionRuntime";
import { getMetaJson, setMetaJson } from "./server/storage";

assertProductionRuntimeConfig("bot");

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
const PENDING_RESOLVE_STALE_MS = (() => {
  const raw = Number(process.env.PENDING_RESOLVE_STALE_MS ?? "45000");
  if (Number.isFinite(raw) && raw > 0) return raw;
  if (process.env.PENDING_RESOLVE_STALE_MS !== undefined)
    console.warn(`[keeper] Invalid PENDING_RESOLVE_STALE_MS="${process.env.PENDING_RESOLVE_STALE_MS}", defaulting to 45000`);
  return 45_000;
})();
const FORCE_REPLACE_PENDING_NONCE_GAP = (() => {
  const raw = Number(process.env.FORCE_REPLACE_PENDING_NONCE_GAP ?? "6");
  if (Number.isFinite(raw) && raw > 0) return raw;
  if (process.env.FORCE_REPLACE_PENDING_NONCE_GAP !== undefined)
    console.warn(`[keeper] Invalid FORCE_REPLACE_PENDING_NONCE_GAP="${process.env.FORCE_REPLACE_PENDING_NONCE_GAP}", defaulting to 6`);
  return 6;
})();
const PENDING_RESOLVE_REVERT_RETRY_MS = (() => {
  const raw = Number(process.env.PENDING_RESOLVE_REVERT_RETRY_MS ?? "300000");
  if (Number.isFinite(raw) && raw > 0) return raw;
  if (process.env.PENDING_RESOLVE_REVERT_RETRY_MS !== undefined)
    console.warn(`[keeper] Invalid PENDING_RESOLVE_REVERT_RETRY_MS="${process.env.PENDING_RESOLVE_REVERT_RETRY_MS}", defaulting to 300000`);
  return 300_000;
})();
const REPLACE_PENDING_MAX_FEE_BUMP_PERCENT = 220n;
const REPLACE_PENDING_PRIORITY_BUMP_PERCENT = 200n;
const NORMAL_MAX_FEE_BUMP_PERCENT = 130n;
const NORMAL_PRIORITY_BUMP_PERCENT = 125n;
const GAS_LIMIT_MARGIN_PERCENT = 150n;

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
  hash: `0x${string}`;
  nonce: number;
  submittedAt: number;
  retryAt?: number;
};

const alertCooldowns = new Map<string, number>();
const PENDING_RESOLVE_META_KEY = "bot:pendingResolve";

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
  try {
    setMetaJson(PENDING_RESOLVE_META_KEY, value ? { ...value, epoch: value.epoch.toString() } : null);
  } catch (err) {
    console.warn("[keeper] Failed to persist pendingResolve:", describeKeeperError(err));
  }
  return value;
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

async function tryResolveEpochAction(options: {
  accountAddress: `0x${string}`;
  contractAddress: `0x${string}`;
  epoch: bigint;
  gasLimitMarginPercent: bigint;
  replacePendingResolve?: PendingResolve;
  publicClient: ReturnType<typeof createPublicClient>;
  walletClient: ReturnType<typeof createWalletClient>;
}) {
  const {
    accountAddress,
    contractAddress,
    epoch,
    gasLimitMarginPercent,
    replacePendingResolve,
    publicClient,
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
  const latestNonce = await publicClient.getTransactionCount({
    address: accountAddress,
    blockTag: "latest",
  });
  const pendingNonce = await publicClient.getTransactionCount({
    address: accountAddress,
    blockTag: "pending",
  });
  const hasPendingTransaction = pendingNonce > latestNonce;
  const replacingPendingTx =
    hasPendingTransaction && replacePendingResolve?.nonce === latestNonce;
  if (hasPendingTransaction && !replacingPendingTx) {
    throw new Error(
      `keeper_pending_nonce_unbound latest=${latestNonce.toString()} pending=${pendingNonce.toString()}`,
    );
  }
  const estimatedFeeOverrides = getKeeperFeeOverrides(
    fees,
    APP_CHAIN.id,
    replacingPendingTx ? REPLACE_PENDING_MAX_FEE_BUMP_PERCENT : NORMAL_MAX_FEE_BUMP_PERCENT,
    replacingPendingTx ? REPLACE_PENDING_PRIORITY_BUMP_PERCENT : NORMAL_PRIORITY_BUMP_PERCENT,
  );
  const rawFeeOverrides = extractFeeOverrideFields(estimatedFeeOverrides);
  const keeperBalance = await publicClient.getBalance({ address: accountAddress });
  const feeOverrides = clampKeeperFeeOverridesToBalance(
    rawFeeOverrides,
    est,
    keeperBalance,
  ) ?? {};
  const txFeeOverrides = extractFeeOverrideFields(feeOverrides);
  const gas = getAffordableKeeperGasLimit(est, keeperBalance, feeOverrides, gasLimitMarginPercent);
  if (gas === null) {
    throw new Error(
      `keeper_insufficient_funds balance=${keeperBalance.toString()} estimatedGas=${est.toString()}`,
    );
  }
  if (replacingPendingTx) {
    console.log(
      `Replacing pending keeper tx with nonce ${latestNonce.toString()} (pending=${pendingNonce.toString()}, latest=${latestNonce.toString()})`,
    );
  }
  const hash = await walletClient.writeContract({
    account: walletClient.account ?? accountAddress,
    chain: APP_CHAIN,
    address: contractAddress,
    abi: ABI,
    functionName: "resolveEpoch",
    args: [epoch],
    gas,
    nonce: latestNonce,
    ...txFeeOverrides,
  });
  try {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
      console.warn(`Resolve tx reverted. Deferring retry. Tx: ${hash}`);
      return {
        epoch,
        hash,
        nonce: latestNonce,
        submittedAt: Date.now(),
        retryAt: Date.now() + PENDING_RESOLVE_REVERT_RETRY_MS,
      } satisfies PendingResolve;
    }
    console.log(`Resolved epoch ${epoch.toString()} (gas: ${gas}). Tx: ${hash}`);
    return null;
  } catch (receiptErr) {
    const receiptMsg = receiptErr instanceof Error ? (receiptErr.message?.toLowerCase() ?? "") : String(receiptErr).toLowerCase();
    if (receiptMsg.includes("timed out") || receiptMsg.includes("timeout")) {
      console.log(`Resolve tx sent but receipt timed out. Will verify next cycles. Tx: ${hash}`);
      return { epoch, hash, nonce: latestNonce, submittedAt: Date.now() } satisfies PendingResolve;
    }
    throw receiptErr;
  }
}

async function startKeeperBot() {
  const privateKeyRaw = getRequiredEnv("KEEPER_PRIVATE_KEY").replace(/^0x/, "");
  const contractAddress = getAddress(process.env.KEEPER_CONTRACT_ADDRESS ?? DEFAULT_CONTRACT);
  const rpcUrl = process.env.KEEPER_RPC_URL ?? DEFAULT_RPC_URL;
  const account = privateKeyToAccount(`0x${privateKeyRaw}`);
  const rpcUrls = getPreferredLineaRpcs(rpcUrl, APP_NETWORK);

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

  console.log("===============================================");
  console.log("LineaOre Keeper Bot (fallback mode)");
  console.log(`Keeper:       ${account.address}`);
  console.log(`Contract:     ${contractAddress}`);
  console.log(`Grace period: ${GRACE_SECONDS}s`);
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
  try {
    const stored = getMetaJson<{ epoch: string; hash: `0x${string}`; nonce?: number; submittedAt: number; retryAt?: number }>(PENDING_RESOLVE_META_KEY);
    const storedNonce = stored?.nonce;
    const storedRetryAt = stored?.retryAt;
    if (
      stored?.epoch &&
      stored?.hash &&
      typeof storedNonce === "number" &&
      Number.isSafeInteger(storedNonce) &&
      storedNonce >= 0 &&
      stored.submittedAt
    ) {
      const restoredPendingResolve: PendingResolve = {
        epoch: BigInt(stored.epoch),
        hash: stored.hash,
        nonce: storedNonce,
        submittedAt: stored.submittedAt,
        ...(typeof storedRetryAt === "number" && Number.isSafeInteger(storedRetryAt) ? { retryAt: storedRetryAt } : {}),
      };
      pendingResolve = restoredPendingResolve;
      console.log(`[keeper] Restored pending resolve for epoch ${restoredPendingResolve.epoch.toString()} from storage. Tx: ${restoredPendingResolve.hash}`);
    } else if (stored) {
      console.warn("[keeper] Ignoring legacy or invalid pendingResolve without a bound nonce.");
      savePendingResolve(null);
    }
  } catch (err) {
    console.warn("[keeper] Failed to restore pendingResolve from storage:", describeKeeperError(err));
  }

  while (true) {
    try {
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

      const now = Math.floor(Date.now() / 1000);
      const secondsLeft = Number(endTime) - now;
      const isResolved = Boolean(epochData[3]);
      const totalPool = epochData[0] as bigint;
      const overdue = -secondsLeft;

      let replacePendingResolve: PendingResolve | undefined;
      if (pendingResolve) {
        const pending = pendingResolve;
        const pendingResolved = epoch > pending.epoch;
        if (pendingResolved) {
          console.log(`\nPending resolve confirmed for epoch ${pending.epoch.toString()} via chain state. Tx: ${pending.hash}`);
          pendingResolve = savePendingResolve(null);
        } else {
          try {
            const receipt = await publicClient.getTransactionReceipt({ hash: pending.hash });
            console.log(`\nPending resolve receipt found for epoch ${pending.epoch.toString()} (${receipt.status}). Tx: ${pending.hash}`);
            if (receipt.status === "success") {
              pendingResolve = savePendingResolve(null);
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
          } catch (receiptCheckErr) {
            const receiptCheckMsg = receiptCheckErr instanceof Error ? (receiptCheckErr.message ?? "") : String(receiptCheckErr);
            if (isNetworkLikeError(receiptCheckMsg)) {
              // Network error - don't assume tx is stale, just wait and retry
              console.warn(`\nPending resolve receipt check failed (network): ${describeKeeperError(receiptCheckMsg, 100)}`);
              await delay(3000);
              continue;
            }
            if (!isReceiptNotFoundLikeError(receiptCheckErr)) {
              console.warn(`\nPending resolve receipt check failed (unknown): ${describeKeeperError(receiptCheckErr, 100)}`);
              await delay(3000);
              continue;
            }
            const latestNonce = await publicClient.getTransactionCount({
              address: account.address,
              blockTag: "latest",
            });
            const pendingNonce = await publicClient.getTransactionCount({
              address: account.address,
              blockTag: "pending",
            });
            const nonceGap = Number(pendingNonce - latestNonce);
            const pendingAgeMs = Date.now() - pending.submittedAt;
            if (
              pendingAgeMs < PENDING_RESOLVE_STALE_MS &&
              nonceGap < FORCE_REPLACE_PENDING_NONCE_GAP
            ) {
              process.stdout.write(`\rEpoch #${epoch.toString()} | resolve tx pending | ${pending.hash.slice(0, 10)}...   `);
              await delay(1500);
              continue;
            }
            console.log(
              `\nPending resolve tx marked stale for epoch ${pending.epoch.toString()} (age=${Math.floor(pendingAgeMs / 1000)}s, nonceGap=${nonceGap}), replacing only its bound nonce.`,
            );
            replacePendingResolve = pending;
            pendingResolve = savePendingResolve(null);
          }
        }
      }

      const shouldResolve = secondsLeft <= -GRACE_SECONDS && !isResolved && totalPool > 0n;

      if (shouldResolve) {
        const poolStr = formatUnits(totalPool, 18);
        console.log(`\nResolving epoch ${epoch.toString()} (pool: ${poolStr} LINEA, overdue ${overdue}s)...`);
        try {
          pendingResolve = savePendingResolve(await tryResolveEpochAction({
            accountAddress: account.address,
            contractAddress,
            epoch,
            gasLimitMarginPercent: GAS_LIMIT_MARGIN_PERCENT,
            replacePendingResolve,
            publicClient,
            walletClient,
          }));
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
