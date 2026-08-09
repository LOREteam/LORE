export const CHAT_RATE_LIMIT_MS = 1_500;
export const CHAT_RATE_LIMIT_MAX_MS = 120_000;

function parsePositiveIntegerMs(value: unknown): number | null {
  if (typeof value !== "number") return null;
  if (!Number.isSafeInteger(value) || value <= 0) return null;
  return value;
}

function parsePositiveIntegerSeconds(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^(?:0|[1-9]\d{0,5})$/.test(trimmed)) return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function parseChatRetryAfterMs(value: unknown, fallbackMs = CHAT_RATE_LIMIT_MS): number {
  const fallback = parsePositiveIntegerMs(fallbackMs) ?? CHAT_RATE_LIMIT_MS;
  const seconds = parsePositiveIntegerSeconds(value);
  if (seconds === null) return fallback;
  return Math.min(CHAT_RATE_LIMIT_MAX_MS, Math.max(fallback, seconds * 1000));
}
