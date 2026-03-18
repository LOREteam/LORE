import { NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http, parseAbi } from "viem";
import type { PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { getKeeperFeeOverrides } from "../../lib/lineaFees";
import {
  APP_CHAIN,
  CONTRACT_ADDRESS,
  FIREBASE_DB_AUTH,
  SERVER_RPC_URLS,
  firebaseWriteUrl,
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
const RESOLVE_LOCK_PATH = "_internal/bootstrapResolveLock";
let lastResolveAttemptAt = 0;
let sharedLockAuthMisconfigured = false;

type ResolveLockState = {
  epoch?: string;
  acquiredAt?: number;
  expiresAt?: number;
};

function getResolveNoopReason(message: string): string | null {
  const lower = message.toLowerCase();
  if (lower.includes("known transaction")) return "resolve_tx_known";
  if (lower.includes("nonce too low") || lower.includes("lower than the current nonce")) return "resolve_nonce_already_used";
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

function normalizeResolveLock(value: unknown): ResolveLockState | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as ResolveLockState;
  return {
    epoch: typeof raw.epoch === "string" ? raw.epoch : undefined,
    acquiredAt: typeof raw.acquiredAt === "number" ? raw.acquiredAt : undefined,
    expiresAt: typeof raw.expiresAt === "number" ? raw.expiresAt : undefined,
  };
}

async function acquireResolveLock(epoch: bigint) {
  const now = Date.now();

  // If Firebase write auth isn't configured (or is known-bad), fall back to a process-local throttle.
  // This avoids turning an auth misconfig into a 500-loop and request storm from clients.
  if (!FIREBASE_DB_AUTH || sharedLockAuthMisconfigured) {
    if (now - lastResolveAttemptAt < RESOLVE_THROTTLE_MS) return false;
    lastResolveAttemptAt = now;
    return true;
  }

  const url = firebaseWriteUrl(RESOLVE_LOCK_PATH);
  const readRes = await fetch(url, { headers: { "X-Firebase-ETag": "true" }, cache: "no-store" });
  if (!readRes.ok) {
    // If auth is invalid (401/403), degrade to local throttle rather than breaking resolve entirely.
    if (readRes.status === 401 || readRes.status === 403) {
      sharedLockAuthMisconfigured = true;
      if (now - lastResolveAttemptAt < RESOLVE_THROTTLE_MS) return false;
      lastResolveAttemptAt = now;
      return true;
    }
    throw new Error(`bootstrap lock read failed: ${readRes.status}`);
  }

  const etag = readRes.headers.get("etag") ?? "null_etag";
  const current = normalizeResolveLock(await readRes.json());
  if (
    current?.epoch === epoch.toString() &&
    typeof current.expiresAt === "number" &&
    current.expiresAt > now
  ) {
    return false;
  }

  const nextLock = {
    epoch: epoch.toString(),
    acquiredAt: now,
    expiresAt: now + RESOLVE_THROTTLE_MS,
  };
  const writeRes = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "If-Match": etag,
    },
    body: JSON.stringify(nextLock),
    cache: "no-store",
  });
  if (writeRes.ok) return true;
  if (writeRes.status === 412) return false;
  if (writeRes.status === 401 || writeRes.status === 403) {
    sharedLockAuthMisconfigured = true;
    if (now - lastResolveAttemptAt < RESOLVE_THROTTLE_MS) return false;
    lastResolveAttemptAt = now;
    return true;
  }
  throw new Error(`bootstrap lock write failed: ${writeRes.status}`);
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

export async function POST(request: Request) {
  const rateLimited = await enforceSharedRateLimit(request, {
    bucket: "api-bootstrap-resolve",
    limit: 6,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  try {
    const account = getBootstrapKeeperAccount();
    if (!account) {
      return NextResponse.json({ ok: true, action: "noop", reason: "bootstrap_keeper_disabled" });
    }

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

    const gasEstimate = await publicClient.estimateContractGas({
      account: account.address,
      address: CONTRACT_ADDRESS,
      abi: ABI,
      functionName: "resolveEpoch",
      args: [currentEpoch],
    });
    const gas = (gasEstimate * 150n) / 100n;
    const fees = await publicClient.estimateFeesPerGas();
    const feeOverrides = getKeeperFeeOverrides(fees, APP_CHAIN.id);

    const hash = await walletClient.writeContract({
      address: CONTRACT_ADDRESS,
      abi: ABI,
      functionName: "resolveEpoch",
      args: [currentEpoch],
      gas,
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
      return NextResponse.json({ ok: true, action: "noop", reason: noopReason });
    }
    return NextResponse.json({ ok: false, reason: "resolve_failed", error: message }, { status: 500 });
  }
}
