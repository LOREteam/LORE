import "dotenv/config";
import { createPublicClient, createWalletClient, getAddress, http, fallback, parseAbi, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { lineaSepolia } from "viem/chains";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const DEFAULT_RPC_URL = "https://rpc.sepolia.linea.build";
const DEFAULT_CONTRACT = "0xaa6a6a2c8eb6bd183c4153fdec99d53ddd8416d8";
const ALERT_BOT_TOKEN = process.env.ALERT_TELEGRAM_BOT_TOKEN ?? "";
const ALERT_CHAT_ID = process.env.ALERT_TELEGRAM_CHAT_ID ?? "";
const ALERT_THREAD_ID = process.env.ALERT_TELEGRAM_THREAD_ID ?? "";
const ALERT_PREFIX = process.env.ALERT_PREFIX ?? "LORE Keeper";

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

  const transport = fallback([
    http(rpcUrl),
    http('https://linea-sepolia-rpc.publicnode.com'),
    http('https://linea-sepolia.public.blastapi.io'),
  ]);
  const publicClient = createPublicClient({
    chain: lineaSepolia,
    transport,
  });
  const walletClient = createWalletClient({
    account,
    chain: lineaSepolia,
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

      if (secondsLeft <= -GRACE_SECONDS && !isResolved) {
        // No bets in this epoch — nobody is playing, skip resolve entirely.
        // The epoch will stay "stale" until a user opens the DApp,
        // at which point AutoResolve will wake the game up.
        if (totalPool === BigInt(0)) {
          process.stdout.write(
            `\rEpoch #${epoch.toString()} | empty (no bets) | idle ${overdue}s — skipping   `,
          );
          await delay(3000);
          continue;
        }

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
            const feeOverrides = fees?.maxFeePerGas
              ? { maxFeePerGas: (fees.maxFeePerGas * BigInt(130)) / BigInt(100), maxPriorityFeePerGas: ((fees.maxPriorityFeePerGas ?? BigInt(0)) * BigInt(130)) / BigInt(100) }
              : fees?.gasPrice ? { gasPrice: (fees.gasPrice * BigInt(130)) / BigInt(100) } : {};
            const hash = await walletClient.writeContract({
              address: contractAddress,
              abi: ABI,
              functionName: "resolveEpoch",
              args: [epoch],
              gas,
              ...feeOverrides,
            });
            await publicClient.waitForTransactionReceipt({ hash });
            console.log(`Resolved (gas: ${gas}). Tx: ${hash}`);
            consecutiveErrors = 0;
            consecutiveNetworkErrors = 0;
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