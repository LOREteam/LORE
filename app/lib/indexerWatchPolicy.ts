export const DEFAULT_INDEXER_WATCH_FAILURE_LIMIT = 5;

export function parseIndexerWatchFailureLimit(value?: string | null) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 100
    ? parsed
    : DEFAULT_INDEXER_WATCH_FAILURE_LIMIT;
}

function normalizeIndexerWatchFailureCount(value: number) {
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function normalizeIndexerWatchFailureLimit(value: number) {
  return Number.isSafeInteger(value) && value > 0 && value <= 100
    ? value
    : DEFAULT_INDEXER_WATCH_FAILURE_LIMIT;
}

export function recordIndexerWatchFailure(consecutiveFailures: number, failureLimit: number) {
  const failures = normalizeIndexerWatchFailureCount(consecutiveFailures) + 1;
  const limit = normalizeIndexerWatchFailureLimit(failureLimit);
  return { failures, shouldRestart: failures >= limit };
}
