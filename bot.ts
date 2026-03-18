import "dotenv/config";
import { createPublicClient, createWalletClient, getAddress, http, fallback, parseAbi, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getKeeperFeeOverrides } from "./app/lib/lineaFees";
import {
  getConfiguredContractAddress,
  getConfiguredLineaNetwork,
  getDefaultLineaRpcs,
  getLineaChain,
  getPreferredLineaRpcs,
} from "./config/publicConfig";

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
const PENDING_RESOLVE_STALE_MS = Number(process.env.PENDING_RESOLVE_STALE_MS ?? "45000");
const FORCE_REPLACE_PENDING_NONCE_GAP = Number(process.env.FORCE_REPLACE_PENDING_NONCE_GAP ?? "6");

// Fallback grace period: wait this many seconds after epoch ends before resolving.
// Gives AutoResolve in users' browsers time to handle it first.
const GRACE_SECONDS = Number(process.env.KEEPER_GRACE_SECONDS ?? "45");
const ALERT_COOLDOWN_MS = Number(process.env.ALERT_COOLDOWN_MS ?? "300000");

const ABI = parseAbi([
  "function resolveEpoch(uint256 epoch) external",
  "function currentEpoch() public view returns (uint256)",
  "function getEpochEndTime(uint256 epoch) public view returns (uint256)",
  "function epochs(uint256) public view returns (uint256 totalPool, uint256 rewardPool, uint256 winningTile, bool isResolved)",
  "error TimerNotEnded()",
  "error CanOnlyResolveCurrent()",
]);

const alertCooldowns = new Map<string, number>();

function isAlertingEnabled() {
  return Boolean(ALERT_BOT_TOKEN && ALERT_CHAT_ID);
}

function shouldSendAlert(key: string, cooldownMs = ALERT_COOLDOWN_MS) {
  const now = Date.now();
  const last = alertCooldowns.get(key) ?? 0;
  if (now - last < cooldownMs) return false;
  alertCooldowns.set(key, now);
  return true;
}

async function sendTelegramAlert(text: string, key: string, cooldownMs = ALERT_COOLDOWN_MS) {
  if (!isAlertingEnabled()) return;
  if (!shouldSendAlert(key, cooldownMs)) return;
  try {
    const body = new URLSearchParams({
      chat_id: ALERT_CHAT_ID,
      text: `*${ALERT_PREFIX}*\n${text}`,
      parse_mode: "Markdown",
      disable_web_page_preview: "true",
    });
    if (ALERT_THREAD_ID) body.set("message_thread_id", ALERT_THREAD_ID);

    const res = await fetch(`https://api.telegram.org/bot${ALERT_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) {
      const msg = await res.text();
      console.error(`[alert] Telegram send failed: HTTP ${res.status} ${msg}`);
    }
  } catch (err) {
    console.error("[alert] Telegram send error:", err);
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

function getRequiredEnv(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
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
  let pendingResolve: { epoch: bigint; hash: `0x${string}`; submittedAt: number } | null = null;

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

      if (pendingResolve) {
        const pending = pendingResolve;
        if (epoch > pending.epoch || isResolved) {
          console.log(`\nPending resolve confirmed for epoch ${pending.epoch.toString()} via chain state. Tx: ${pending.hash}`);
          pendingResolve = null;
        } else {
          try {
            const receipt = await publicClient.getTransactionReceipt({ hash: pending.hash });
            console.log(`\nPending resolve receipt found for epoch ${pending.epoch.toString()} (${receipt.status}). Tx: ${pending.hash}`);
            pendingResolve = null;
          } catch {
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
              await delay(3000);
              continue;
            }
            console.log(
              `\nPending resolve tx marked stale for epoch ${pending.epoch.toString()} (age=${Math.floor(pendingAgeMs / 1000)}s, nonceGap=${nonceGap}), retrying with latest nonce.`,
            );
            pendingResolve = null;
          }
        }
      }

      if (secondsLeft <= -GRACE_SECONDS && !isResolved) {
        const freshEpoch = await publicClient.readContract({
          address: contractAddress, abi: ABI, functionName: "currentEpoch",
        });
        if (freshEpoch !== epoch) {
          console.log(`\nEpoch ${epoch.toString()} already resolved, now at ${freshEpoch.toString()}`);
        } else {
          const poolStr = formatUnits(totalPool, 18);
          console.log(`\nResolving epoch ${epoch.toString()} (pool: ${poolStr} LINEA, overdue ${overdue}s)...`);
          try {
            const est = await publicClient.estimateContractGas({
              account: account.address,
              address: contractAddress,
              abi: ABI,
              functionName: "resolveEpoch",
              args: [epoch],
            });
            const gas = (est * BigInt(150)) / BigInt(100);
            const fees = await publicClient.estimateFeesPerGas();
            const latestNonce = await publicClient.getTransactionCount({
              address: account.address,
              blockTag: "latest",
            });
            const pendingNonce = await publicClient.getTransactionCount({
              address: account.address,
              blockTag: "pending",
            });
            const replacingPendingTx = pendingNonce > latestNonce;
            const estimatedFeeOverrides = getKeeperFeeOverrides(
              fees,
              APP_CHAIN.id,
              replacingPendingTx ? BigInt(160) : BigInt(130),
              replacingPendingTx ? BigInt(150) : BigInt(125),
            );
            const feeOverrides = estimatedFeeOverrides?.gasPrice !== undefined
              ? { gasPrice: estimatedFeeOverrides.gasPrice }
              : estimatedFeeOverrides?.maxFeePerGas !== undefined
                ? {
                    maxFeePerGas: estimatedFeeOverrides.maxFeePerGas,
                    maxPriorityFeePerGas: estimatedFeeOverrides.maxPriorityFeePerGas,
                  }
                : {};
            if (replacingPendingTx) {
              console.log(
                `Replacing pending keeper tx with nonce ${latestNonce.toString()} (pending=${pendingNonce.toString()}, latest=${latestNonce.toString()})`,
              );
            }
            const hash = await walletClient.writeContract({
              address: contractAddress,
              abi: ABI,
              functionName: "resolveEpoch",
              args: [epoch],
              gas,
              ...(replacingPendingTx ? { nonce: latestNonce } : {}),
              ...feeOverrides,
            });
            try {
              await publicClient.waitForTransactionReceipt({ hash });
              console.log(`Resolved (gas: ${gas}). Tx: ${hash}`);
              pendingResolve = null;
              consecutiveErrors = 0;
              consecutiveNetworkErrors = 0;
            } catch (receiptErr) {
              const receiptMsg = receiptErr instanceof Error ? receiptErr.message.toLowerCase() : String(receiptErr).toLowerCase();
              if (receiptMsg.includes("timed out") || receiptMsg.includes("timeout")) {
                pendingResolve = { epoch, hash, submittedAt: Date.now() };
                console.log(`Resolve tx sent but receipt timed out. Will verify next cycles. Tx: ${hash}`);
                consecutiveErrors = 0;
                consecutiveNetworkErrors = 0;
              } else {
                throw receiptErr;
              }
            }
          } catch (txErr) {
            const errStr = txErr instanceof Error ? txErr.message.toLowerCase() : String(txErr).toLowerCase();
            if (
              errStr.includes("known transaction") ||
              errStr.includes("already known") ||
              errStr.includes("nonce too low") ||
              errStr.includes("replacement transaction underpriced") ||
              errStr.includes("execution reverted") ||
              errStr.includes("reverted with the following signature") ||
              errStr.includes("0x22daea9a") ||
              errStr.includes("timernotended") ||
              errStr.includes("canonlyresolvecurrent")
            ) {
              console.log(`Epoch ${epoch.toString()} – skipped (${errStr.slice(0, 80)})`);
              await delay(3000);
            } else {
              await sendTelegramAlert(
                `resolve tx error on epoch \`${epoch.toString()}\`\n\`${errStr.slice(0, 220)}\``,
                "resolve-tx-error",
              );
              throw txErr;
            }
          }
        }
      } else {
        const display = isResolved
          ? "resolved"
          : secondsLeft <= 0
            ? totalPool === BigInt(0)
              ? `empty | waiting ${overdue}s`
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
      if (isNetworkLikeError(low)) {
        consecutiveNetworkErrors += 1;
      } else {
        consecutiveNetworkErrors = 0;
      }
      if (
        low.includes("reverted") ||
        low.includes("known transaction") ||
        low.includes("nonce") ||
        low.includes("0x22daea9a") ||
        low.includes("timernotended") ||
        low.includes("canonlyresolvecurrent")
      ) {
        console.log(`\n[skip] ${low.slice(0, 80)}`);
      } else {
        console.log(`\nKeeper error: ${msg}`);
      }

      if (consecutiveNetworkErrors >= 3) {
        await sendTelegramAlert(
          `network/rpc instability x${consecutiveNetworkErrors}\n\`${low.slice(0, 220)}\``,
          "rpc-instability",
          10 * 60_000,
        );
      }
      if (consecutiveErrors >= 5) {
        await sendTelegramAlert(
          `consecutive errors x${consecutiveErrors}\n\`${low.slice(0, 220)}\``,
          "consecutive-errors",
          10 * 60_000,
        );
      }
    }

    await delay(3000);
  }
}

void startKeeperBot();
