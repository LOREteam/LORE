export const MAX_PREVIEW_FUTURE_SKEW_MS = 5 * 60 * 1000;

export function getPreviewAgeMs(
  updatedMs,
  nowMs = Date.now(),
  maxFutureSkewMs = MAX_PREVIEW_FUTURE_SKEW_MS,
) {
  if (!Number.isFinite(updatedMs)) {
    throw new Error("V10 dry-run Preview timestamp is missing or invalid");
  }
  if (updatedMs > nowMs + maxFutureSkewMs) {
    throw new Error("V10 dry-run Preview timestamp must not be in the future");
  }
  return Math.max(0, nowMs - updatedMs);
}
