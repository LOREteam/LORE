const RETRY_DELAYS_MS = [500, 1_000] as const;

export function isEstimateGasMethodUnsupported(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /method\s+["']?eth_estimategas["']?\s+is not supported/i.test(message);
}

export async function estimateGasWithMethodRetry<T>(
  estimate: () => Promise<T>,
  wait: (ms: number) => Promise<unknown> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return { value: await estimate(), retryCount: attempt };
    } catch (error) {
      if (!isEstimateGasMethodUnsupported(error) || attempt >= RETRY_DELAYS_MS.length) throw error;
      await wait(RETRY_DELAYS_MS[attempt]);
    }
  }
}
