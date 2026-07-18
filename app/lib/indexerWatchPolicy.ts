export const DEFAULT_INDEXER_WATCH_FAILURE_LIMIT = 5;

export function parseIndexerWatchFailureLimit(value?: string | null) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 100
    ? parsed
    : DEFAULT_INDEXER_WATCH_FAILURE_LIMIT;
}

export function recordIndexerWatchFailure(consecutiveFailures: number, failureLimit: number) {
  const failures = Math.max(0, Math.trunc(consecutiveFailures)) + 1;
  return { failures, shouldRestart: failures >= failureLimit };
}
