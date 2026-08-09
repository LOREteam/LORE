"use client";

import { CHAT_AUTH_SESSION_TTL_MS, normalizeChatAuthAddress } from "./chatAuth";

const AUTH_STORAGE_PREFIX = "lore:chat-session:";
const CHAT_AUTH_SESSION_MAX_FUTURE_SKEW_MS = 60_000;
export const CHAT_AUTH_SESSION_EVENT = "lore:chat-session-change";

export interface ChatAuthSession {
  address: string;
  expiresAt: number;
}

function emitChatAuthSessionChange(address: string, expiresAt: number | null) {
  if (typeof window === "undefined") return;
  const normalizedAddress = normalizeChatAuthAddress(address);
  if (!normalizedAddress) return;
  window.dispatchEvent(new CustomEvent(CHAT_AUTH_SESSION_EVENT, {
    detail: {
      address: normalizedAddress,
      expiresAt,
    },
  }));
}

export function normalizeChatAuthSessionExpiresAt(value: unknown, now = Date.now()) {
  let expiresAt: number | null = null;
  if (typeof value === "number") {
    expiresAt = Number.isSafeInteger(value) ? value : null;
  } else if (typeof value === "string") {
    const trimmed = value.trim();
    if (/^(?:0|[1-9]\d{0,15})$/.test(trimmed)) {
      const parsed = Number.parseInt(trimmed, 10);
      expiresAt = Number.isSafeInteger(parsed) ? parsed : null;
    }
  }
  if (expiresAt === null) return null;
  if (typeof now !== "number" || !Number.isSafeInteger(now) || now < 0) return null;
  if (expiresAt <= now) return null;
  if (expiresAt - now > CHAT_AUTH_SESSION_TTL_MS + CHAT_AUTH_SESSION_MAX_FUTURE_SKEW_MS) return null;
  return expiresAt;
}

export function getChatAuthStorageKey(address: string) {
  const normalizedAddress = normalizeChatAuthAddress(address);
  return normalizedAddress ? `${AUTH_STORAGE_PREFIX}${normalizedAddress}` : "";
}

export function loadChatAuthSession(address: string): ChatAuthSession | null {
  if (typeof localStorage === "undefined") return null;
  const storageKey = getChatAuthStorageKey(address);
  if (!storageKey) return null;
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ChatAuthSession>;
    if (!parsed.address) {
      localStorage.removeItem(storageKey);
      return null;
    }
    const expiresAt = normalizeChatAuthSessionExpiresAt(parsed.expiresAt);
    if (expiresAt === null) {
      localStorage.removeItem(storageKey);
      return null;
    }
    const normalizedAddress = normalizeChatAuthAddress(parsed.address);
    if (!normalizedAddress) {
      localStorage.removeItem(storageKey);
      return null;
    }
    if (normalizedAddress !== normalizeChatAuthAddress(address)) {
      localStorage.removeItem(storageKey);
      return null;
    }
    return {
      address: normalizedAddress,
      expiresAt,
    };
  } catch {
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // ignore
    }
    return null;
  }
}

export function saveChatAuthSession(session: ChatAuthSession) {
  if (typeof localStorage === "undefined") return;
  const normalizedAddress = normalizeChatAuthAddress(session.address);
  if (!normalizedAddress) return;
  const expiresAt = normalizeChatAuthSessionExpiresAt(session.expiresAt);
  if (expiresAt === null) return;
  const normalizedSession = { address: normalizedAddress, expiresAt };
  try {
    localStorage.setItem(getChatAuthStorageKey(normalizedAddress), JSON.stringify(normalizedSession));
  } catch {
    // ignore quota / private mode
  }
  emitChatAuthSessionChange(normalizedAddress, expiresAt);
}

export function clearChatAuthSession(address: string) {
  if (typeof localStorage === "undefined") return;
  const storageKey = getChatAuthStorageKey(address);
  if (!storageKey) return;
  try {
    localStorage.removeItem(storageKey);
  } catch {
    // ignore
  }
  emitChatAuthSessionChange(address, null);
}

export function buildFallbackChatAuthSession(address: string): ChatAuthSession {
  const normalizedAddress = normalizeChatAuthAddress(address);
  if (!normalizedAddress) throw new Error("Cannot build chat session for an invalid wallet address.");
  return {
    address: normalizedAddress,
    expiresAt: Date.now() + CHAT_AUTH_SESSION_TTL_MS,
  };
}
