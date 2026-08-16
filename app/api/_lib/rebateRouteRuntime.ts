export const REBATE_UNCHANGED_WATERMARK_REFRESH_MS = 5 * 60_000;
export const REBATE_TIMING_MAX_MS = 24 * 60 * 60 * 1000;

export type RebateBuildTimings = {
  indexedMs: number;
  summaryMs: number;
  exactMs: number;
  recentMs: number;
  totalMs: number;
  epochCount: number;
  summaryChunks: number;
  exactChunks: number;
};

export type RebateCacheStatus = "fresh" | "stale" | "miss" | "inflight";

export type RebateCacheWatermark = {
  refreshedAt: number;
  watermark: string;
};

export function normalizeRebateTimingMs(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(value, REBATE_TIMING_MAX_MS);
}

export function formatRebateTimingMs(value: number): string {
  return normalizeRebateTimingMs(value).toFixed(1);
}

export function formatRebateTimingLogValue(value: number): number {
  return Number(formatRebateTimingMs(value));
}

export function formatRebateServerTiming(params: {
  cacheStatus: RebateCacheStatus;
  timings?: RebateBuildTimings | null;
}) {
  const { cacheStatus, timings } = params;
  const metrics = [`cache;desc="${cacheStatus}"`];
  if (timings) {
    metrics.push(`indexed;dur=${formatRebateTimingMs(timings.indexedMs)}`);
    metrics.push(`summary;dur=${formatRebateTimingMs(timings.summaryMs)}`);
    metrics.push(`exact;dur=${formatRebateTimingMs(timings.exactMs)}`);
    metrics.push(`recent;dur=${formatRebateTimingMs(timings.recentMs)}`);
    metrics.push(`total;dur=${formatRebateTimingMs(timings.totalMs)}`);
  }
  return metrics.join(", ");
}

export function shouldSkipUnchangedRebateRefresh(params: {
  hasWorkingCycle: boolean;
  cachedWatermark: RebateCacheWatermark | null | undefined;
  currentWatermark: string;
  now?: number;
  ttlMs?: number;
}) {
  const {
    hasWorkingCycle,
    cachedWatermark,
    currentWatermark,
    now = Date.now(),
    ttlMs = REBATE_UNCHANGED_WATERMARK_REFRESH_MS,
  } = params;
  if (hasWorkingCycle || !cachedWatermark || cachedWatermark.watermark !== currentWatermark) return false;
  if (!Number.isSafeInteger(now) || now < 0) return false;
  if (!Number.isSafeInteger(cachedWatermark.refreshedAt) || cachedWatermark.refreshedAt < 0) return false;
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0) return false;
  const ageMs = now - cachedWatermark.refreshedAt;
  return ageMs >= 0 && ageMs < ttlMs;
}
