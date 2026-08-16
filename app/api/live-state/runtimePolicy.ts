export const LIVE_STATE_LOG_SCAN_CHUNK = 10_000n;
export const LIVE_STATE_SNAPSHOT_CACHE_MS = 2_000;
export const LIVE_STATE_STALE_FAST_PATH_MS = 60_000;
export const LIVE_STATE_MAX_TIMER_DELAY_MS = 2_147_483_647;

const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

export type LiveStateSnapshotMemoryEntry<T> = {
  payload: T | null;
  savedAt: number | null;
  loadedAt: number;
};

export type RequestedEpochsParseResult =
  | { ok: true; epochs: number[] }
  | { ok: false; error: string };

export function parseRequestedEpochsParam(
  search: string | null,
  parsePositiveInteger: (value: string) => number | null,
  maxRequestedEpochs = 100,
): RequestedEpochsParseResult {
  if (!search) return { ok: true, epochs: [] };
  if (!Number.isSafeInteger(maxRequestedEpochs) || maxRequestedEpochs <= 0) {
    return { ok: false, error: "Invalid epochs" };
  }
  const rawEpochs = search
    .split(",", maxRequestedEpochs + 1)
    .map((value) => value.trim());
  if (rawEpochs.length > maxRequestedEpochs) {
    return { ok: false, error: "Too many epochs" };
  }
  const parsedEpochs = rawEpochs.map(parsePositiveInteger);
  if (parsedEpochs.some((value) => value === null || value > 1_000_000)) {
    return { ok: false, error: "Invalid epochs" };
  }
  return { ok: true, epochs: [...new Set(parsedEpochs as number[])] };
}

export function normalizeLiveStateSnapshotMaxAge(maxAgeMs: number): number | null {
  if (maxAgeMs === Number.POSITIVE_INFINITY) return null;
  if (!Number.isSafeInteger(maxAgeMs) || maxAgeMs < 0) return 0;
  return maxAgeMs;
}

export function normalizeLiveStateSnapshotSavedAt(savedAt: unknown): number | null {
  return typeof savedAt === "number" && Number.isSafeInteger(savedAt) && savedAt >= 0
    ? savedAt
    : null;
}

export function isFreshLiveStateSnapshotSavedAt(
  savedAt: unknown,
  maxAgeMs: number | null,
  now = Date.now(),
): boolean {
  const normalizedSavedAt = normalizeLiveStateSnapshotSavedAt(savedAt);
  if (normalizedSavedAt === null || !Number.isSafeInteger(now) || now < 0) return false;
  if (normalizedSavedAt > now) return false;
  return maxAgeMs === null || now - normalizedSavedAt <= maxAgeMs;
}

export function isFreshLiveStateSnapshotMemoryEntry<T>(
  entry: LiveStateSnapshotMemoryEntry<T> | null,
  maxAgeMs: number | null,
  now = Date.now(),
): entry is LiveStateSnapshotMemoryEntry<T> {
  return Boolean(
    entry &&
      Number.isSafeInteger(now) &&
      now >= 0 &&
      Number.isSafeInteger(entry.loadedAt) &&
      entry.loadedAt >= 0 &&
      entry.loadedAt <= now &&
      now - entry.loadedAt <= LIVE_STATE_SNAPSHOT_CACHE_MS &&
      (entry.savedAt === null || isFreshLiveStateSnapshotSavedAt(entry.savedAt, maxAgeMs, now)),
  );
}

export function isFreshLiveStatePayloadFetchedAt(fetchedAt: unknown, now = Date.now()): boolean {
  return (
    typeof fetchedAt === "number" &&
    Number.isSafeInteger(fetchedAt) &&
    fetchedAt >= 0 &&
    Number.isSafeInteger(now) &&
    now >= 0 &&
    fetchedAt <= now &&
    now - fetchedAt <= LIVE_STATE_STALE_FAST_PATH_MS
  );
}

export function isValidLiveStateTimerDelay(timeoutMs: number): boolean {
  return (
    Number.isSafeInteger(timeoutMs) &&
    timeoutMs > 0 &&
    timeoutMs <= LIVE_STATE_MAX_TIMER_DELAY_MS
  );
}

export async function withLiveStateTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  if (!isValidLiveStateTimerDelay(timeoutMs)) {
    promise.catch(() => {});
    throw new RangeError(`${label} timeout must be between 1 and 2147483647 milliseconds`);
  }

  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function resolveLiveStateAdmission<TRateLimit, TCached>(input: {
  enforceRateLimit: () => Promise<TRateLimit | null>;
  readFreshCache: (now: number) => TCached | null;
  now?: () => number;
}) {
  const rateLimited = await input.enforceRateLimit();
  if (rateLimited !== null) {
    return { kind: "rate-limited" as const, response: rateLimited };
  }
  const now = (input.now ?? Date.now)();
  return {
    kind: "allowed" as const,
    now,
    cached: input.readFreshCache(now),
  };
}

export async function buildLiveStateWithSnapshotFallback<T>(input: {
  build: () => Promise<T>;
  loadSnapshot: () => T | null;
  buildStoredBootstrap: () => T | null;
}): Promise<T> {
  try {
    return await input.build();
  } catch (error) {
    const snapshot = input.loadSnapshot() ?? input.buildStoredBootstrap();
    if (snapshot !== null) return snapshot;
    throw error;
  }
}

export function parseLiveStateChainEpoch(value: bigint): number | null {
  if (value <= 0n || value > MAX_SAFE_INTEGER_BIGINT) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function parseLiveStateStoredBlock(value: string | null | undefined): bigint {
  if (!value || !/^\d+$/.test(value)) return 0n;
  return BigInt(value);
}

export function parseLiveStateChainTileId(value: bigint, gridSize: number): number | null {
  if (!Number.isSafeInteger(gridSize) || gridSize <= 0) return null;
  if (value <= 0n || value > BigInt(gridSize)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function planLiveStateLogScanWindow(input: {
  cursor: bigint;
  toBlock: bigint;
  chunkSize: bigint;
  remainingBlockBudget: bigint;
}) {
  if (
    input.cursor < 0n ||
    input.toBlock < input.cursor ||
    input.chunkSize <= 0n ||
    input.remainingBlockBudget <= 0n
  ) return null;

  const requestedBlocks = [
    LIVE_STATE_LOG_SCAN_CHUNK,
    input.chunkSize,
    input.toBlock - input.cursor + 1n,
    input.remainingBlockBudget,
  ].reduce((smallest, value) => value < smallest ? value : smallest);
  if (requestedBlocks <= 0n) return null;
  return {
    requestedBlocks,
    chunkTo: input.cursor + requestedBlocks - 1n,
  };
}
