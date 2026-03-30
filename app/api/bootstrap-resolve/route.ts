import { NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import type { PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  clampKeeperFeeOverridesToBalance,
  getAffordableKeeperGasLimit,
  getKeeperFeeOverrides,
} from "../../lib/lineaFees";
import { acquireExpiringLock } from "../../../server/storage";
import {
  APP_CHAIN,
  CONTRACT_ADDRESS,
  SERVER_RPC_URLS,
} from "../_lib/dataBridge";
import { enforceSharedRateLimit } from "../_lib/sharedRateLimit";

const ABI = parseAbi([
  "function resolveEpoch(uint256 epoch) external",
  "function currentEpoch() view returns (uint256)",
  "function getEpochEndTime(uint256 epoch) view returns (uint256)",
  "function epochs(uint256) view returns (uint256 totalPool, uint256 rewardPool, uint256 winningTile, bool isResolved, bool isDailyJackpot, bool isWeeklyJackpot)",
  "error TimerNotEnded()",
  "error AlreadyResolved()",
  "error CanOnlyResolveCurrent()",
]);

const RESOLVE_THROTTLE_MS = 5_000;
const BOOTSTRAP_RPC_UNAVAILABLE_RETRY_MS = 12_000;
const RESOLVE_LOCK_PATH = "_internal/bootstrapResolveLock";
const REPLACE_PENDING_MAX_FEE_BUMP_PERCENT = 220n;
const REPLACE_PENDING_PRIORITY_BUMP_PERCENT = 200n;
let lastResolveAttemptAt = 0;

function isLocalDevBootstrapRequest(request: Request) {
  const requestUrl = new URL(request.url);
  return (
    process.env.NODE_ENV !== "production" &&
    (requestUrl.hostname === "localhost" || requestUrl.hostname === "127.0.0.1")
  );
}

function getResolveNoopReason(message: string): string | null {
  const lower = message.toLowerCase();
  if (lower.includes("known transaction")) return "resolve_tx_known";
  if (lower.includes("nonce too low") || lower.includes("lower than the current nonce")) return "resolve_nonce_already_used";
  if (
    lower.includes("replacement transaction underpriced") ||
    lower.includes("transaction underpriced") ||
    lower.includes("replacement fee too low") ||
    lower.includes("fee too low to replace") ||
    lower.includes("could not replace existing tx")
  ) {
    return "resolve_fee_bump_needed";
  }
  if (lower.includes("alreadyresolved") || lower.includes("0x6d5703c2")) return "epoch_already_resolved";
  if (lower.includes("canonlyresolvecurrent") || lower.includes("0x22daea9a")) return "epoch_no_longer_current";
  if (lower.includes("timernotended") || lower.includes("0xe7884c39")) return "epoch_not_expired";
  return null;
}

function isRpcReadRetryableError(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes("returned no data (\"0x\")") ||
    lower.includes("failed to fetch") ||
    lower.includes("fetch failed") ||
    lower.includes("network") ||
    lower.includes("timeout") ||
    lower.includes("etimedout") ||
    lower.includes("econnreset") ||
    lower.includes("econnrefused")
  );
}

function createRpcClient(url: string) {
  return createPublicClient({
    chain: APP_CHAIN,
    transport: http(url, { timeout: 15_000, retryCount: 1 }),
  });
}

async function acquireResolveLock(epoch: bigint) {
  try {
    return acquireExpiringLock(RESOLVE_LOCK_PATH, epoch.toString(), RESOLVE_THROTTLE_MS);
  } catch {
    const now = Date.now();
    if (now - lastResolveAttemptAt < RESOLVE_THROTTLE_MS) return false;
    lastResolveAttemptAt = now;
    return true;
  }
}

async function readContractResilient<T>(
  rpcUrls: string[],
  request: Parameters<PublicClient["readContract"]>[0],
): Promise<{ result: T; rpcUrl: string; client: PublicClient }> {
  let lastError: unknown = null;

  for (const rpcUrl of rpcUrls) {
    const client = createRpcClient(rpcUrl);
    try {
      const result = await client.readContract(request);
      return { result: result as T, rpcUrl, client };
    } catch (err) {
      lastError = err;
      const message = err instanceof Error ? err.message : String(err);
      if (isRpcReadRetryableError(message)) continue;
      throw err;
    }
  }

  throw lastError ?? new Error("All RPC contract reads failed");
}

function getBootstrapKeeperAccount() {
  const privateKey =
    process.env.BOOTSTRAP_KEEPER_PRIVATE_KEY?.trim() ||
    process.env.KEEPER_PRIVATE_KEY?.trim();
  if (!privateKey) return null;
  return privateKeyToAccount(privateKey.startsWith("0x") ? (privateKey as `0x${string}`) : (`0x${privateKey}` as `0x${string}`));
}

function isAuthorizedBootstrapRequest(request: Request) {
  const secret = process.env.BOOTSTRAP_RESOLVE_SECRET?.trim();
  if (isLocalDevBootstrapRequest(request)) return true;
  if (!secret) return false;
  const provided = request.headers.get("x-bootstrap-resolve-secret")?.trim();
  return provided === secret;
}

export async function POST(request: Request) {
  if (!isAuthorizedBootstrapRequest(request)) {
    return NextResponse.json({ ok: true, action: "noop", reason: "bootstrap_keeper_disabled" });
  }

  const account = getBootstrapKeeperAccount();
  if (!account) {
    return NextResponse.json({ ok: true, action: "noop", reason: "bootstrap_keeper_disabled" });
  }

  const rateLimited = await enforceSharedRateLimit(request, {
    bucket: "api-bootstrap-resolve",
    limit: isLocalDevBootstrapRequest(request) ? 60 : 12,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  try {
    const { result: currentEpoch, rpcUrl, client: publicClient } = await readContractResilient<bigint>(SERVER_RPC_URLS, {
      address: CONTRACT_ADDRESS,
      abi: ABI,
      functionName: "currentEpoch",
    });

    if (!(await acquireResolveLock(currentEpoch))) {
      return NextResponse.json({
        ok: true,
        action: "noop",
        reason: "bootstrap_resolve_throttled",
        currentEpoch: currentEpoch.toString(),
        retryAfter: Math.max(1, Math.ceil(RESOLVE_THROTTLE_MS / 1000)),
      });
    }

    const [{ result: epochEndTime }, { result: epochData }] = await Promise.all([
      readContractResilient<bigint>(SERVER_RPC_URLS, {
        address: CONTRACT_ADDRESS,
        abi: ABI,
        functionName: "getEpochEndTime",
        args: [currentEpoch],
      }),
      readContractResilient<[bigint, bigint, bigint, boolean, boolean, boolean]>(SERVER_RPC_URLS, {
        address: CONTRACT_ADDRESS,
        abi: ABI,
        functionName: "epochs",
        args: [currentEpoch],
      }),
    ]);

    const walletClient = createWalletClient({
      account,
      chain: APP_CHAIN,
      transport: http(rpcUrl, { timeout: 15_000, retryCount: 1 }),
    });

    const isResolved = Boolean(epochData[3]);
    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    const isExpired = nowSec >= epochEndTime;

    if (isResolved || !isExpired) {
      return NextResponse.json({
        ok: true,
        action: "noop",
        currentEpoch: currentEpoch.toString(),
        isResolved,
        isExpired,
      });
    }

    const latestNonce = await publicClient.getTransactionCount({
      address: account.address,
      blockTag: "latest",
    });
    const pendingNonce = await publicClient.getTransactionCount({
      address: account.address,
      blockTag: "pending",
    });
    const replacingPendingTx = pendingNonce > latestNonce;

    const gasEstimate = await publicClient.estimateContractGas({
      account: account.address,
      address: CONTRACT_ADDRESS,
      abi: ABI,
      functionName: "resolveEpoch",
      args: [currentEpoch],
    });
    const fees = await publicClient.estimateFeesPerGas();
    const estimatedFeeOverrides = getKeeperFeeOverrides(
      fees,
      APP_CHAIN.id,
      replacingPendingTx ? REPLACE_PENDING_MAX_FEE_BUMP_PERCENT : 130n,
      replacingPendingTx ? REPLACE_PENDING_PRIORITY_BUMP_PERCENT : 125n,
    );
    const keeperBalance = await publicClient.getBalance({ address: account.address });
    const feeOverrides = clampKeeperFeeOverridesToBalance(
      estimatedFeeOverrides,
      gasEstimate,
      keeperBalance,
    );
    const gas = getAffordableKeeperGasLimit(gasEstimate, keeperBalance, feeOverrides, 150n);

    if (gas === null) {
      return NextResponse.json({
        ok: false,
        reason: "resolve_failed",
        error: `keeper_insufficient_funds balance=${keeperBalance.toString()} estimatedGas=${gasEstimate.toString()}`,
      }, { status: 500 });
    }

    const hash = await walletClient.writeContract({
      address: CONTRACT_ADDRESS,
      abi: ABI,
      functionName: "resolveEpoch",
      args: [currentEpoch],
      gas,
      ...(replacingPendingTx ? { nonce: latestNonce } : {}),
      ...(feeOverrides?.gasPrice !== undefined
        ? { gasPrice: feeOverrides.gasPrice }
        : {
            maxFeePerGas: feeOverrides?.maxFeePerGas,
            maxPriorityFeePerGas: feeOverrides?.maxPriorityFeePerGas,
          }),
    });

    return NextResponse.json({
      ok: true,
      action: "sent",
      currentEpoch: currentEpoch.toString(),
      hash,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const noopReason = getResolveNoopReason(message);
    if (noopReason) {
      return NextResponse.json({
        ok: true,
        action: "noop",
        reason: noopReason,
        retryAfter: noopReason === "resolve_fee_bump_needed"
          ? Math.max(1, Math.ceil(RESOLVE_THROTTLE_MS / 1000))
          : undefined,
      });
    }
    if (isRpcReadRetryableError(message)) {
      return NextResponse.json({
        ok: true,
        action: "noop",
        reason: "bootstrap_rpc_unavailable",
        retryAfter: Math.max(1, Math.ceil(BOOTSTRAP_RPC_UNAVAILABLE_RETRY_MS / 1000)),
      });
    }
    return NextResponse.json({ ok: false, reason: "resolve_failed", error: message }, { status: 500 });
  }
}
