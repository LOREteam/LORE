"use client";

import { CHAT_AUTH_SESSION_TTL_MS } from "./chatAuth";

const AUTH_STORAGE_PREFIX = "lore:chat-session:";
export const CHAT_AUTH_SESSION_EVENT = "lore:chat-session-change";

export interface ChatAuthSession {
  address: string;
  expiresAt: number;
}

function emitChatAuthSessionChange(address: string, expiresAt: number | null) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(CHAT_AUTH_SESSION_EVENT, {
    detail: {
      address: address.toLowerCase(),
      expiresAt,
    },
  }));
}

export function getChatAuthStorageKey(address: string) {
  return `${AUTH_STORAGE_PREFIX}${address.toLowerCase()}`;
}

export function loadChatAuthSession(address: string): ChatAuthSession | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(getChatAuthStorageKey(address));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ChatAuthSession>;
    if (!parsed.address || typeof parsed.expiresAt !== "number") return null;
    if (parsed.expiresAt <= Date.now()) return null;
    return {
      address: parsed.address.toLowerCase(),
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

export function saveChatAuthSession(session: ChatAuthSession) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(getChatAuthStorageKey(session.address), JSON.stringify(session));
  } catch {
    // ignore quota / private mode
  }
  emitChatAuthSessionChange(session.address, session.expiresAt);
}

export function clearChatAuthSession(address: string) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(getChatAuthStorageKey(address));
  } catch {
    // ignore
  }
  emitChatAuthSessionChange(address, null);
}

export function buildFallbackChatAuthSession(address: string): ChatAuthSession {
  return {
    address: address.toLowerCase(),
    expiresAt: Date.now() + CHAT_AUTH_SESSION_TTL_MS,
  };
}
