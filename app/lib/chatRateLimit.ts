export const CHAT_RATE_LIMIT_MS = 1_500;
export const CHAT_RATE_LIMIT_MAX_MS = 120_000;

export function parseChatRetryAfterMs(value: unknown, fallbackMs = CHAT_RATE_LIMIT_MS): number {
  const fallback = Number.isFinite(fallbackMs) && fallbackMs > 0 ? Math.floor(fallbackMs) : CHAT_RATE_LIMIT_MS;
  const seconds = typeof value === "string" || typeof value === "number" ? Number(value) : Number.NaN;
  if (!Number.isFinite(seconds) || seconds <= 0) return fallback;
  return Math.min(CHAT_RATE_LIMIT_MAX_MS, Math.max(fallback, Math.ceil(seconds * 1000)));
}
