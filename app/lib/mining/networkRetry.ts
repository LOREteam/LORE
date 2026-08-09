import { log } from "../logger";
import { delay } from "../utils";

function normalizeNonNegativeSafeInteger(value: number): number | null {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function normalizePositiveSafeInteger(value: number): number | null {
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function formatRetryWaitSeconds(waitMs: number): string {
  if (!Number.isFinite(waitMs) || waitMs < 0 || waitMs > Number.MAX_SAFE_INTEGER) return "0";
  return String(Math.round(waitMs / 1000));
}

export function getNetworkRetryDelayMs(
  attempt: number,
  initialMs: number,
  maxMs: number,
  maxExponent?: number,
) {
  const normalizedAttempt = normalizeNonNegativeSafeInteger(attempt);
  const normalizedInitialMs = normalizePositiveSafeInteger(initialMs);
  const normalizedMaxMs = normalizePositiveSafeInteger(maxMs);
  const normalizedMaxExponent = maxExponent == null ? null : normalizeNonNegativeSafeInteger(maxExponent);
  if (
    normalizedAttempt === null ||
    normalizedInitialMs === null ||
    normalizedMaxMs === null ||
    normalizedMaxMs < normalizedInitialMs ||
    (maxExponent != null && normalizedMaxExponent === null)
  ) {
    return 0;
  }
  const exponent = normalizedMaxExponent == null
    ? normalizedAttempt
    : Math.min(normalizedAttempt, normalizedMaxExponent);
  return Math.min(normalizedInitialMs * 2 ** exponent, normalizedMaxMs);
}

export async function readWithNetworkRetry<T>(params: {
  actionLabel: string;
  initialMs: number;
  isActive: () => boolean;
  maxAttempts: number;
  maxMs: number;
  onProgress: (message: string) => void;
  read: () => Promise<T>;
  shouldRetry: (error: unknown) => boolean;
}) {
  const {
    actionLabel,
    initialMs,
    isActive,
    maxMs,
    onProgress,
    read,
    shouldRetry,
  } = params;
  let lastRetryableError: unknown = null;
  const maxAttemptLimit = normalizeNonNegativeSafeInteger(params.maxAttempts) ?? 0;

  for (let attempt = 0; attempt < maxAttemptLimit; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      if (!shouldRetry(error) || !isActive()) throw error;
      lastRetryableError = error;
      const wait = getNetworkRetryDelayMs(attempt, initialMs, maxMs);
      const waitSeconds = formatRetryWaitSeconds(wait);
      log.warn("AutoMine", `network error ${actionLabel} (retry ${attempt + 1}), waiting ${waitSeconds}s...`, error);
      onProgress(`RPC offline - retrying in ${waitSeconds}s...`);
      await delay(wait);
    }
  }

  const retryExhaustedError = new Error(`Network retry exhausted while ${actionLabel}`);
  retryExhaustedError.name = "NetworkRetryExhaustedError";
  if (lastRetryableError) {
    (
      retryExhaustedError as Error & {
        cause?: unknown;
      }
    ).cause = lastRetryableError;
  }
  throw retryExhaustedError;
}
