import {
  normalizeChatMessages,
  sortChatMessagesAsc,
  type ChatMessage,
} from "./chatMessages";
import { parseChatRetryAfterMs } from "./chatRateLimit";

export const CHAT_CACHE_KEY = "lore:chat-cache:v1";
export const CHAT_MESSAGES_LIMIT = 100;
export const CHAT_NETWORK_WARN_THROTTLE_MS = 15_000;

type ChatIdCrypto = {
  randomUUID?: () => string;
  getRandomValues?: (bytes: Uint8Array) => Uint8Array;
};

function defaultChatIdCrypto(): ChatIdCrypto | undefined {
  if (typeof crypto === "undefined") return undefined;
  return {
    randomUUID: typeof crypto.randomUUID === "function" ? () => crypto.randomUUID() : undefined,
    getRandomValues: typeof crypto.getRandomValues === "function"
      ? (bytes) => crypto.getRandomValues(bytes)
      : undefined,
  };
}

export function createOptimisticMessageId(
  now: number,
  cryptoSource: ChatIdCrypto | undefined = defaultChatIdCrypto(),
  random: () => number = Math.random,
): string {
  if (typeof cryptoSource?.randomUUID === "function") {
    return `local:${now}:${cryptoSource.randomUUID()}`;
  }
  if (typeof cryptoSource?.getRandomValues === "function") {
    const bytes = new Uint8Array(12);
    cryptoSource.getRandomValues(bytes);
    return `local:${now}:${Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
  }
  return `local:${now}:${random().toString(36).slice(2)}`;
}

export function readChatMessageCache(
  storage: Pick<Storage, "getItem" | "removeItem">,
): ChatMessage[] {
  try {
    const raw = storage.getItem(CHAT_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) {
      storage.removeItem(CHAT_CACHE_KEY);
      return [];
    }
    return normalizeChatMessages(parsed);
  } catch {
    try {
      storage.removeItem(CHAT_CACHE_KEY);
    } catch {
      // ignore cache cleanup failures
    }
    return [];
  }
}

export function persistChatMessageCache(
  storage: Pick<Storage, "setItem">,
  messages: ChatMessage[],
): void {
  try {
    storage.setItem(
      CHAT_CACHE_KEY,
      JSON.stringify(sortChatMessagesAsc(messages).slice(-CHAT_MESSAGES_LIMIT)),
    );
  } catch {
    // ignore cache write failures
  }
}

export function createChatSendCooldown(durationMs: number, now: number) {
  const cooldownMs = parseChatRetryAfterMs(durationMs / 1000);
  return { startedAt: now, cooldownUntil: now + cooldownMs, remainingMs: cooldownMs };
}

export function getChatSendCooldownRemaining(cooldownUntil: number, now: number): number {
  return Math.max(0, cooldownUntil - now);
}

export function warnChatNetworkOnce(
  tag: string,
  ref: { current: number },
  err: unknown,
  now: number,
  warn: (scope: string, warningTag: string, error: unknown) => void,
): boolean {
  if (now - ref.current < CHAT_NETWORK_WARN_THROTTLE_MS) return false;
  ref.current = now;
  warn("Chat", tag, err);
  return true;
}
