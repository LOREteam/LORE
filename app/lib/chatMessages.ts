import { sanitizeChatAvatarValue } from "./chatAvatar";

export interface ChatMessage {
  id: string;
  text: string;
  sender: string;
  senderName: string | null;
  senderAvatar: string | null;
  timestamp: number;
}

const MAX_AVATAR_LENGTH = 8_000;

export function normalizeChatMessageAvatar(value: unknown) {
  return sanitizeChatAvatarValue(value, MAX_AVATAR_LENGTH);
}

export function sortChatMessagesAsc(messages: ChatMessage[]) {
  return [...messages].sort((a, b) => {
    if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp;
    return a.id.localeCompare(b.id);
  });
}

export function normalizeChatMessages(value: unknown): ChatMessage[] {
  if (!Array.isArray(value)) return [];
  return sortChatMessagesAsc(
    value
      .map((item) => {
        const v = (item ?? {}) as Record<string, unknown>;
        const timestamp = typeof v.timestamp === "number" ? v.timestamp : Number(v.timestamp ?? 0);
        return {
          id: typeof v.id === "string" ? v.id : "",
          text: typeof v.text === "string" ? v.text : "",
          sender: typeof v.sender === "string" ? v.sender : "",
          senderName: typeof v.senderName === "string" ? v.senderName : null,
          senderAvatar: normalizeChatMessageAvatar(v.senderAvatar),
          timestamp: Number.isFinite(timestamp) ? timestamp : Number.NaN,
        } satisfies ChatMessage;
      })
      .filter((message) => message.id && message.sender && message.text && Number.isFinite(message.timestamp)),
  );
}
