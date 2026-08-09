import { timingSafeEqual } from "node:crypto";
import { createPublicClient, http } from "viem";
import type { PublicClient } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { RESOLVE_ABI } from "../../../config/abi";
import { acquireExpiringLock } from "../../../server/storage";
import { acquireExternalExpiringLock, requiresExternalSharedLock } from "../_lib/externalRateLimit";
import { APP_CHAIN, CONTRACT_ADDRESS, SERVER_RPC_URLS } from "../_lib/dataBridge";
import { logRouteError } from "../_lib/routeError";

export const BOOTSTRAP_RESOLVE_ABI = RESOLVE_ABI;

// Empty epochs advance on demand through the contract bet paths, so the keeper
// is reserved for funded epochs that remain stuck after their deadline.
export const RESOLVE_THROTTLE_MS = 5_000;
export const BOOTSTRAP_RPC_UNAVAILABLE_RETRY_MS = 12_000;
const RESOLVE_LOCK_PATH = "_internal/bootstrapResolveLock";
const MIN_BOOTSTRAP_RESOLVE_SECRET_LENGTH = 32;
const MAX_BOOTSTRAP_RESOLVE_SECRET_LENGTH = 256;
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;

let lastResolveAttemptAt = 0;

export function isLocalDevBootstrapRequest(_request: Request) {
  // Request URL/Host values are not an authentication boundary. A keeper key
  // therefore always requires BOOTSTRAP_RESOLVE_SECRET, including local dev.
  void _request;
  return false;
}

function isBootstrapKeeperKeyConfigured() {
  return Boolean(
    process.env.BOOTSTRAP_KEEPER_PRIVATE_KEY?.trim() ||
    process.env.KEEPER_PRIVATE_KEY?.trim(),
  );
}

function normalizeBootstrapResolveSecret(value: string | null | undefined) {
  const secret = value?.trim();
  if (!secret) return null;
  if (
    secret.length < MIN_BOOTSTRAP_RESOLVE_SECRET_LENGTH ||
    secret.length > MAX_BOOTSTRAP_RESOLVE_SECRET_LENGTH ||
    CONTROL_CHAR_RE.test(secret)
  ) {
    return null;
  }
  return secret;
}

export function getResolveNoopReason(message: string): string | null {
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
  if (lower.includes("alreadyresolved")) return "epoch_already_resolved";
  if (lower.includes("canonlyresolvecurrent")) return "epoch_no_longer_current";
  if (lower.includes("timernotended")) return "epoch_not_expired";
  return null;
}

export function isRpcReadRetryableError(message: string) {
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

export function createRpcClient(url: string) {
  return createPublicClient({
    chain: APP_CHAIN,
    transport: http(url, { timeout: 15_000, retryCount: 1 }),
  });
}

export async function acquireResolveLock(epoch: bigint) {
  if (requiresExternalSharedLock()) {
    try {
      return await acquireExternalExpiringLock(`${RESOLVE_LOCK_PATH}:${epoch}`, RESOLVE_THROTTLE_MS);
    } catch (err) {
      logRouteError("api/bootstrap-resolve", err, {
        phase: "external-lock",
        fallback: "deny",
      });
      return false;
    }
  }

  try {
    return acquireExpiringLock(RESOLVE_LOCK_PATH, epoch.toString(), RESOLVE_THROTTLE_MS);
  } catch (err) {
    const production = process.env.NODE_ENV === "production";
    logRouteError("api/bootstrap-resolve", err, {
      phase: "sqlite-lock",
      fallback: production ? "deny" : "memory-throttle",
    });
    if (production) return false;
    const now = Date.now();
    if (now - lastResolveAttemptAt < RESOLVE_THROTTLE_MS) return false;
    lastResolveAttemptAt = now;
    return true;
  }
}

export async function readContractResilient<T>(
  request: Parameters<PublicClient["readContract"]>[0],
): Promise<{ result: T; rpcUrl: string; client: PublicClient }> {
  let lastError: unknown = null;

  for (const rpcUrl of SERVER_RPC_URLS) {
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

export function getBootstrapKeeperAccount() {
  const privateKey =
    process.env.BOOTSTRAP_KEEPER_PRIVATE_KEY?.trim() ||
    process.env.KEEPER_PRIVATE_KEY?.trim();
  if (!privateKey) return null;
  const normalized = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(normalized)) {
    console.error("[bootstrap-resolve] Invalid private key format (expected 64 hex chars)");
    return null;
  }
  return privateKeyToAccount(normalized as `0x${string}`);
}

export function isAuthorizedBootstrapRequest(request: Request) {
  const secret = normalizeBootstrapResolveSecret(process.env.BOOTSTRAP_RESOLVE_SECRET);
  const provided = normalizeBootstrapResolveSecret(request.headers.get("x-bootstrap-resolve-secret"));
  if (!secret) {
    if (!isBootstrapKeeperKeyConfigured()) return true;
    return false;
  }
  if (!provided) return false;
  const secretBuf = Buffer.from(secret, "utf8");
  const providedBuf = Buffer.from(provided, "utf8");
  return (
    providedBuf.length === secretBuf.length &&
    timingSafeEqual(providedBuf, secretBuf)
  );
}

export { APP_CHAIN, CONTRACT_ADDRESS };
