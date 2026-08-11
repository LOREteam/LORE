import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export function runLiveStateApiTests() {
  const liveStateSharedSource = readFileSync("app/api/live-state/shared.ts", "utf8");
  const liveStateRouteSource = readFileSync("app/api/live-state/route.ts", "utf8");
  assert.match(
    liveStateRouteSource,
    /const rateLimited = await enforceSharedRateLimit\(request,[\s\S]*?if \(rateLimited\)[\s\S]*?const cached = liveStateRouteCache\.getFresh/,
    "live-state must enforce its shared rate limit before serving fresh cache entries",
  );
  assert.match(
    liveStateRouteSource,
    /function isFreshLiveStatePayloadFetchedAt\(fetchedAt: unknown, now: number\)[\s\S]*Number\.isSafeInteger\(fetchedAt\)[\s\S]*fetchedAt <= now[\s\S]*now - fetchedAt <= LIVE_STATE_STALE_FAST_PATH_MS[\s\S]*return isFreshLiveStatePayloadFetchedAt\(payload\.fetchedAt, now\)/,
    "live-state stale fast path must reject malformed or future fetchedAt timestamps",
  );
  assert.doesNotMatch(
    liveStateRouteSource,
    /Number\.isFinite\(payload\.fetchedAt\) && now - payload\.fetchedAt <= LIVE_STATE_STALE_FAST_PATH_MS/,
    "live-state stale fast path must not use broad fetchedAt age arithmetic",
  );
  assert.match(
    liveStateRouteSource,
    /MAX_TIMER_DELAY_MS = 2_147_483_647[\s\S]*async function withTimeout<T>\(promise: Promise<T>, timeoutMs: number, label: string\)[\s\S]*Number\.isSafeInteger\(timeoutMs\)[\s\S]*timeoutMs <= 0[\s\S]*timeoutMs > MAX_TIMER_DELAY_MS[\s\S]*timeout must be between 1 and 2147483647 milliseconds/,
    "live-state route timeout helper must reject fractional, unsafe, or oversized timer delays before cache joins",
  );
  assert.doesNotMatch(
    liveStateRouteSource,
    /Number\.isFinite\(timeoutMs\)/,
    "live-state route timeout helper must not broadly accept finite fractional timeout values",
  );
  assert.match(
    liveStateSharedSource,
    /catch \(error\) \{[\s\S]*?const snapshot = loadLiveStateSnapshot\(Number\.POSITIVE_INFINITY\) \?\? buildStoredLiveStateBootstrap\(\);[\s\S]*?if \(snapshot\) return snapshot;/,
    "live-state RPC fallback must preserve the snapshot timestamp instead of presenting old chain data as fresh",
  );
  assert.match(
    liveStateSharedSource,
    /function normalizeLiveStateSnapshotMaxAge\(maxAgeMs: number\)[\s\S]*!Number\.isFinite\(maxAgeMs\)[\s\S]*return null[\s\S]*Number\.isSafeInteger\(maxAgeMs\)[\s\S]*return maxAgeMs/,
    "live-state snapshot max-age checks must keep intentional unbounded fallback explicit",
  );
  assert.match(
    liveStateSharedSource,
    /MAX_TIMER_DELAY_MS = 2_147_483_647[\s\S]*function isValidTimerDelayMs\(timeoutMs: number\)[\s\S]*Number\.isSafeInteger\(timeoutMs\)[\s\S]*timeoutMs > 0[\s\S]*timeoutMs <= MAX_TIMER_DELAY_MS[\s\S]*async function withTimeout<T>[\s\S]*isValidTimerDelayMs\(timeoutMs\)[\s\S]*timeout must be between 1 and 2147483647 milliseconds/,
    "live-state shared RPC timeout helper must reject fractional, unsafe, or oversized timer delays",
  );
  assert.match(
    liveStateSharedSource,
    /function isFreshLiveStateSnapshotSavedAt\(savedAt: unknown, maxAgeMs: number \| null, now = Date\.now\(\)\)[\s\S]*Number\.isSafeInteger\(now\)[\s\S]*normalizedSavedAt > now[\s\S]*maxAgeMs === null \|\| now - normalizedSavedAt <= maxAgeMs/,
    "live-state persisted snapshots must reject malformed or future savedAt timestamps",
  );
  assert.match(
    liveStateSharedSource,
    /function isFreshLiveStateSnapshotMemoryEntry\([\s\S]*Number\.isSafeInteger\(entry\.loadedAt\)[\s\S]*entry\.loadedAt <= now[\s\S]*now - entry\.loadedAt <= LIVE_STATE_SNAPSHOT_CACHE_MS[\s\S]*isFreshLiveStateSnapshotSavedAt\(entry\.savedAt, maxAgeMs, now\)/,
    "live-state in-memory snapshots must reject malformed or future cache timestamps",
  );
  assert.match(
    liveStateSharedSource,
    /const normalizedMaxAgeMs = normalizeLiveStateSnapshotMaxAge\(maxAgeMs\)[\s\S]*isFreshLiveStateSnapshotMemoryEntry\(memorySnapshot, normalizedMaxAgeMs, now\)[\s\S]*!isFreshLiveStateSnapshotSavedAt\(snapshot\.savedAt, normalizedMaxAgeMs, now\)/,
    "live-state snapshot loading must route both memory and persisted snapshots through strict freshness helpers",
  );
  assert.doesNotMatch(
    liveStateSharedSource,
    /now - liveStateSnapshotCache\.loadedAt <= LIVE_STATE_SNAPSHOT_CACHE_MS|typeof snapshot\.savedAt !== "number" \|\| now - snapshot\.savedAt > maxAgeMs/,
    "live-state snapshots must not use broad cache or savedAt age arithmetic",
  );
  const epochsLimitRouteSource = readFileSync("app/api/epochs/route.ts", "utf8");
  assert.match(
    epochsLimitRouteSource,
    /const MAX_REQUESTED_EPOCHS = 100;[\s\S]*?split\(",", MAX_REQUESTED_EPOCHS \+ 1\)[\s\S]*?rawEpochs\.length > MAX_REQUESTED_EPOCHS[\s\S]*?Too many epochs[\s\S]*?Invalid epochs/,
    "epochs requests must reject over-limit or invalid parsed IDs before cache-key and storage work",
  );
  assert.doesNotMatch(
    epochsLimitRouteSource,
    /slice\(0, MAX_REQUESTED_EPOCHS\)/,
    "epochs requests must not silently truncate over-limit requested epoch IDs",
  );
  assert.match(
    liveStateSharedSource,
    /LIVE_STATE_LOG_SCAN_CHUNK = 10_000n/,
    "live-state RPC scans must stay within the Linea public RPC 10k-block range limit",
  );
  assert.match(liveStateSharedSource, /isSafePositiveInteger/, "live-state bootstrap must use safe current epoch validation");
  assert.match(
    liveStateSharedSource,
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function parseChainUintPositiveNumber\(value: bigint\)[\s\S]*value > MAX_SAFE_INTEGER_BIGINT[\s\S]*const currentEpochNumber = parseChainUintPositiveNumber\(currentEpoch\)[\s\S]*currentEpochNumber !== null[\s\S]*getEpochTileUserCounts\(currentEpochNumber\)[\s\S]*currentEpochNumber !== null[\s\S]*getEpochTilePoolsWei\(currentEpochNumber\)/,
    "live-state chain currentEpoch must be safely narrowed before indexed storage lookups",
  );
  assert.doesNotMatch(liveStateSharedSource, /(^|[^A-Za-z0-9_])Number\(currentEpoch\)/, "live-state must not broadly coerce chain currentEpoch before indexed storage lookups");
  assert.match(liveStateSharedSource, /function parseStoredBlockNumber/, "live-state jackpot fallback must parse stored block numbers safely");
  assert.match(
    liveStateSharedSource,
    /function parseChainTileId\(value: bigint, gridSize: number\)[\s\S]*value <= 0n \|\| value > BigInt\(gridSize\)[\s\S]*Number\.isSafeInteger\(parsed\)[\s\S]*const tileId = parseChainTileId\(args\.tileId, gridSize\)[\s\S]*args\.tileIds\.flatMap\(\(tileId\) => \{[\s\S]*parseChainTileId\(tileId, gridSize\)/,
    "live-state chain tile user recovery must safely narrow event tile IDs before counting users",
  );
  assert.doesNotMatch(liveStateSharedSource, /Number\(args\.tileId\)|args\.tileIds\.map\(\(tileId\) => Number\(tileId\)\)/, "live-state chain tile user recovery must not broadly coerce event tile IDs");
  assert.doesNotMatch(liveStateSharedSource, /BigInt\([^)]*blockNumber\s*\|\|\s*"0"[^)]*\)/, "live-state must not BigInt-parse unchecked stored block numbers");
  assert.doesNotMatch(liveStateSharedSource, /Number\.isInteger\(storedCurrentEpoch\)/, "live-state stored current epoch check must reject unsafe integers");
}
