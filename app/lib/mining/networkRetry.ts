import { log } from "../logger";
import { delay } from "../utils";

export function getNetworkRetryDelayMs(
  attempt: number,
  initialMs: number,
  maxMs: number,
  maxExponent?: number,
) {
  const exponent = maxExponent == null ? attempt : Math.min(attempt, maxExponent);
  return Math.min(initialMs * 2 ** exponent, maxMs);
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
    maxAttempts,
    maxMs,
    onProgress,
    read,
    shouldRetry,
  } = params;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await read();
    } catch (error) {
      if (!shouldRetry(error) || !isActive()) throw error;
      const wait = getNetworkRetryDelayMs(attempt, initialMs, maxMs);
      log.warn("AutoMine", `network error ${actionLabel} (retry ${attempt + 1}), waiting ${(wait / 1000).toFixed(0)}s...`, error);
      onProgress(`RPC offline - retrying in ${(wait / 1000).toFixed(0)}s...`);
      await delay(wait);
    }
  }

  throw new Error(`Failed to ${actionLabel} after retries`);
}
