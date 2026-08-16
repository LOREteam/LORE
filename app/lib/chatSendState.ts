import type { ChatMessage } from "./chatMessages";

export type ChatSendAttemptResult =
  | { ok: true; message: ChatMessage }
  | { ok: false; error: unknown };

export function reconcileChatSendAttempt(
  messages: ChatMessage[],
  optimisticMessage: ChatMessage,
  result: ChatSendAttemptResult,
) {
  const withoutOptimistic = messages.filter((message) => message.id !== optimisticMessage.id);
  if (!result.ok) return withoutOptimistic;
  if (withoutOptimistic.some((message) => message.id === result.message.id)) {
    return withoutOptimistic;
  }
  return [...withoutOptimistic, result.message];
}
