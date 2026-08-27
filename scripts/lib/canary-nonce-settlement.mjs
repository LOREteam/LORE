const DEFAULT_MAX_ATTEMPTS = 4;
const DEFAULT_RETRY_DELAY_MS = 1_000;

/**
 * @param {{
 *   readNoncePair?: () => Promise<{ latest: number; pending: number }>;
 *   maxAttempts?: number;
 *   retryDelayMs?: number;
 *   sleep?: (ms: number) => Promise<unknown>;
 * }} options
 */
export async function waitForNonceQueueSettlement({
  readNoncePair,
  maxAttempts = DEFAULT_MAX_ATTEMPTS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (typeof readNoncePair !== "function") throw new Error("readNoncePair must be a function");
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) throw new Error("maxAttempts must be a positive integer");
  if (!Number.isSafeInteger(retryDelayMs) || retryDelayMs < 0) throw new Error("retryDelayMs must be a non-negative integer");

  let latest = 0;
  let pending = 0;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    ({ latest, pending } = await readNoncePair());
    if (!Number.isSafeInteger(latest) || latest < 0 || !Number.isSafeInteger(pending) || pending < 0) {
      throw new Error("Nonce reader returned an invalid value");
    }
    if (pending <= latest) return { latest, pending, attempts: attempt };
    if (attempt < maxAttempts) await sleep(retryDelayMs);
  }
  throw new Error(`Pending transaction blocked by nonce: latest=${latest} pending=${pending}`);
}
