export const CHAT_POLL_INTERVAL_MS = 3_000;
export const CHAT_HIDDEN_POLL_INTERVAL_MS = 30_000;
export const CHAT_CLOSED_POLL_INTERVAL_MS = 20_000;
export const CHAT_HIDDEN_CLOSED_POLL_INTERVAL_MS = 60_000;

export function getChatPollDelayMs({
  failureCount,
  isPageVisible,
  open,
}: {
  failureCount: number;
  isPageVisible: boolean;
  open: boolean;
}) {
  const baseDelay = open
    ? (isPageVisible ? CHAT_POLL_INTERVAL_MS : CHAT_HIDDEN_POLL_INTERVAL_MS)
    : (isPageVisible ? CHAT_CLOSED_POLL_INTERVAL_MS : CHAT_HIDDEN_CLOSED_POLL_INTERVAL_MS);

  if (failureCount <= 0) return baseDelay;
  const multiplier = Math.min(4, 2 ** failureCount);
  return baseDelay * multiplier;
}
