"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { sanitizeChatAvatarValue } from "../lib/chatAvatar";
import { readJsonResponse } from "../lib/readJsonResponse";
import { type ChatAuthControls, useChatAuth } from "./useChatAuth";

export interface ChatMessage {
  id: string;
  text: string;
  sender: string;
  senderName: string | null;
  senderAvatar: string | null;
  timestamp: number;
}

const MESSAGES_LIMIT = 100;
export const CHAT_RATE_LIMIT_MS = 1_500;
const MAX_TEXT_LENGTH = 280;
const POLL_INTERVAL_MS = 3_000;
const HIDDEN_POLL_INTERVAL_MS = 15_000;
const CLOSED_POLL_INTERVAL_MS = 12_000;
const HIDDEN_CLOSED_POLL_INTERVAL_MS = 45_000;
const CHAT_CACHE_KEY = "lore:chat-cache:v1";
const NETWORK_WARN_THROTTLE_MS = 15_000;
const MAX_AVATAR_LENGTH = 8_000;

function areMessagesEqual(a: ChatMessage[], b: ChatMessage[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    const left = a[index];
    const right = b[index];
    if (
      left.id !== right.id ||
      left.text !== right.text ||
      left.sender !== right.sender ||
      left.senderName !== right.senderName ||
      left.senderAvatar !== right.senderAvatar ||
      left.timestamp !== right.timestamp
    ) {
      return false;
    }
  }
  return true;
}

function isNetworkFetchError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes("failed to fetch") || msg.includes("networkerror") || msg.includes("network request failed");
}

function isChatAuthError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes("http 401") || msg.includes("chat auth required");
}

function warnNetworkOnce(tag: string, ref: { current: number }, err: unknown) {
  const now = Date.now();
  if (now - ref.current < NETWORK_WARN_THROTTLE_MS) return;
  ref.current = now;
  const message = err instanceof Error ? err.message : String(err);
  console.warn(`${tag} ${message}`);
}

function loadCachedMessages(): ChatMessage[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(CHAT_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        const v = (item ?? {}) as Record<string, unknown>;
        return {
          id: typeof v.id === "string" ? v.id : "",
          text: typeof v.text === "string" ? v.text : "",
          sender: typeof v.sender === "string" ? v.sender : "",
          senderName: typeof v.senderName === "string" ? v.senderName : null,
          senderAvatar: sanitizeChatAvatarValue(v.senderAvatar, MAX_AVATAR_LENGTH),
          timestamp: typeof v.timestamp === "number" ? v.timestamp : Number(v.timestamp ?? 0),
        } as ChatMessage;
      })
      .filter((m) => m.id && m.sender && m.text)
      .sort((a, b) => a.timestamp - b.timestamp);
  } catch {
    return [];
  }
}

function saveCachedMessages(messages: ChatMessage[]) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(CHAT_CACHE_KEY, JSON.stringify(messages.slice(-MESSAGES_LIMIT)));
  } catch {
    // ignore cache write failures
  }
}

async function fetchMessages(signal?: AbortSignal): Promise<ChatMessage[]> {
  const res = await fetch("/api/chat/messages", { cache: "no-store", signal });
  const json = await readJsonResponse<{ messages?: ChatMessage[]; error?: string }>(res);
  if (!json) {
    throw new Error(`Empty response from /api/chat/messages (HTTP ${res.status})`);
  }
  if (!res.ok || json.error) {
    throw new Error(json.error || `HTTP ${res.status}`);
  }
  return (json.messages ?? []).slice(-MESSAGES_LIMIT);
}

async function postMessage(payload: Record<string, unknown>, signal?: AbortSignal): Promise<void> {
  const res = await fetch("/api/chat/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(payload),
    signal,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Chat write HTTP ${res.status}: ${body}`);
  }
}

export function useChat(walletAddress: string | null, options?: { open?: boolean; auth?: ChatAuthControls }) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadCachedMessages());
  const [connected, setConnected] = useState(false);
  const [isPageVisible, setIsPageVisible] = useState(() =>
    typeof document === "undefined" ? true : document.visibilityState === "visible",
  );
  const [sendCooldownRemainingMs, setSendCooldownRemainingMs] = useState(0);
  const [isSending, setIsSending] = useState(false);
  const open = options?.open ?? false;
  const lastSentRef = useRef(0);
  const messagesRef = useRef(messages);
  const pollWarnAtRef = useRef(0);
  const sendWarnAtRef = useRef(0);
  const localAuth = useChatAuth(walletAddress, "Verify wallet for chat");
  const { authReady, ensureChatAuth, refreshAuth, clearAuth } = options?.auth ?? localAuth;

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    const syncVisibility = () => {
      setIsPageVisible(document.visibilityState === "visible");
    };
    document.addEventListener("visibilitychange", syncVisibility);
    return () => {
      document.removeEventListener("visibilitychange", syncVisibility);
    };
  }, []);

  useEffect(() => {
    if (sendCooldownRemainingMs <= 0) return;
    const timer = window.setInterval(() => {
      const remaining = Math.max(0, CHAT_RATE_LIMIT_MS - (Date.now() - lastSentRef.current));
      setSendCooldownRemainingMs(remaining);
    }, 33);
    return () => {
      window.clearInterval(timer);
    };
  }, [sendCooldownRemainingMs]);

  useEffect(() => {
    const controller = new AbortController();

    async function poll() {
      try {
        const msgs = await fetchMessages(controller.signal);
        if (controller.signal.aborted) return;
        if (!areMessagesEqual(messagesRef.current, msgs)) {
          setMessages(msgs);
          saveCachedMessages(msgs);
        }
        setConnected(true);
        pollWarnAtRef.current = 0;
      } catch (err) {
        if (controller.signal.aborted) return;
        setConnected(false);
        if (isNetworkFetchError(err)) {
          warnNetworkOnce("[Chat] Poll network unavailable:", pollWarnAtRef, err);
        } else {
          warnNetworkOnce("[Chat] Poll failed:", pollWarnAtRef, err);
        }
      }
    }

    void poll();
    const pollInterval = open
      ? (isPageVisible ? POLL_INTERVAL_MS : HIDDEN_POLL_INTERVAL_MS)
      : (isPageVisible ? CLOSED_POLL_INTERVAL_MS : HIDDEN_CLOSED_POLL_INTERVAL_MS);
    const timer = setInterval(() => {
      void poll();
    }, pollInterval);

    return () => {
      controller.abort();
      clearInterval(timer);
    };
  }, [isPageVisible, open]);

  const sendMessage = useCallback(
    async (text: string, senderName: string | null, senderAvatar: string | null) => {
      if (!walletAddress) return false;
      const trimmed = text.trim().slice(0, MAX_TEXT_LENGTH);
      if (!trimmed) return false;

      const now = Date.now();
      if (now - lastSentRef.current < CHAT_RATE_LIMIT_MS) {
        setSendCooldownRemainingMs(Math.max(0, CHAT_RATE_LIMIT_MS - (now - lastSentRef.current)));
        return false;
      }
      lastSentRef.current = now;
      setSendCooldownRemainingMs(CHAT_RATE_LIMIT_MS);
      setIsSending(true);

      const authOk = await ensureChatAuth();
      if (!authOk) {
        setIsSending(false);
        return false;
      }

      const payload: Record<string, unknown> = {
        text: trimmed,
        sender: walletAddress.toLowerCase(),
        timestamp: { ".sv": "timestamp" },
      };
      if (senderName) payload.senderName = senderName;
      const normalizedAvatar = sanitizeChatAvatarValue(senderAvatar, MAX_AVATAR_LENGTH);
      if (normalizedAvatar) payload.senderAvatar = normalizedAvatar;

      try {
        try {
          await postMessage(payload);
        } catch (err) {
          if (!isChatAuthError(err)) throw err;

          const refreshed = await refreshAuth();
          if (refreshed) {
            await postMessage(payload);
          } else {
            clearAuth();
            const reauthed = await ensureChatAuth();
            if (!reauthed) throw err;
            await postMessage(payload);
          }
        }

        const msgs = await fetchMessages();
        if (!areMessagesEqual(messagesRef.current, msgs)) {
          setMessages(msgs);
          saveCachedMessages(msgs);
        }
        setConnected(true);
        sendWarnAtRef.current = 0;
        setIsSending(false);
        return true;
      } catch (err) {
        setConnected(false);
        if (isNetworkFetchError(err)) {
          warnNetworkOnce("[Chat] Send network unavailable:", sendWarnAtRef, err);
        } else {
          warnNetworkOnce("[Chat] Send failed:", sendWarnAtRef, err);
        }
        setIsSending(false);
        return false;
      }
    },
    [walletAddress, clearAuth, ensureChatAuth, refreshAuth],
  );

  return { messages, sendMessage, connected, authReady, ensureChatAuth, sendCooldownRemainingMs, isSending };
}
