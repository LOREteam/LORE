"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  normalizeChatMessageAvatar,
  normalizeChatMessages,
  sortChatMessagesAsc,
  type ChatMessage,
} from "../lib/chatMessages";
import { getChatPollDelayMs } from "../lib/chatPollDelay";
import { CHAT_RATE_LIMIT_MS, parseChatRetryAfterMs } from "../lib/chatRateLimit";
import { fetchWithTimeout } from "../lib/fetchWithTimeout";
import { readJsonResponse } from "../lib/readJsonResponse";
import { type ChatAuthControls, useChatAuth } from "./useChatAuth";

export type { ChatMessage } from "../lib/chatMessages";

export { CHAT_RATE_LIMIT_MS } from "../lib/chatRateLimit";

const MESSAGES_LIMIT = 100;
const MAX_TEXT_LENGTH = 280;
const CHAT_CACHE_KEY = "lore:chat-cache:v1";
const NETWORK_WARN_THROTTLE_MS = 15_000;

class ChatRateLimitError extends Error {
  readonly retryAfterMs: number;

  constructor(message: string, retryAfterMs: number) {
    super(message);
    this.name = "ChatRateLimitError";
    this.retryAfterMs = retryAfterMs;
  }
}

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

function isChatRateLimitError(err: unknown): err is ChatRateLimitError {
  return err instanceof ChatRateLimitError;
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
    return normalizeChatMessages(parsed);
  } catch {
    return [];
  }
}

function saveCachedMessages(messages: ChatMessage[]) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      CHAT_CACHE_KEY,
      JSON.stringify(sortChatMessagesAsc(messages).slice(-MESSAGES_LIMIT)),
    );
  } catch {
    // ignore cache write failures
  }
}

async function fetchMessages(signal?: AbortSignal): Promise<ChatMessage[]> {
  const res = await fetchWithTimeout("/api/chat/messages", { cache: "no-store", signal });
  const json = await readJsonResponse<{ messages?: ChatMessage[]; error?: string }>(res);
  if (!json) {
    throw new Error(`Empty response from /api/chat/messages (HTTP ${res.status})`);
  }
  if (!res.ok || json.error) {
    throw new Error(json.error || `HTTP ${res.status}`);
  }
  return normalizeChatMessages(json.messages).slice(-MESSAGES_LIMIT);
}

async function postMessage(payload: Record<string, unknown>, signal?: AbortSignal): Promise<ChatMessage | null> {
  const res = await fetchWithTimeout("/api/chat/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(payload),
    signal,
  });
  const json = await readJsonResponse<{ ok?: boolean; message?: ChatMessage; error?: string; retryAfter?: unknown }>(res);
  if (res.status === 429) {
    throw new ChatRateLimitError(json?.error || "Too many requests", parseChatRetryAfterMs(json?.retryAfter));
  }
  if (!res.ok) {
    throw new Error(json?.error || `Chat write HTTP ${res.status}`);
  }
  if (json?.error) throw new Error(json.error);
  return json?.message ?? null;
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
  const sendCooldownUntilRef = useRef(0);
  const messagesRef = useRef(messages);
  const pollWarnAtRef = useRef(0);
  const sendWarnAtRef = useRef(0);
  const localAuth = useChatAuth(walletAddress, "Verify wallet for chat");
  const { authReady, ensureChatAuth, refreshAuth, clearAuth } = options?.auth ?? localAuth;

  const commitMessages = useCallback((nextMessages: ChatMessage[]) => {
    const next = sortChatMessagesAsc(nextMessages).slice(-MESSAGES_LIMIT);
    messagesRef.current = next;
    setMessages(next);
    saveCachedMessages(next);
  }, []);

  const mergeLocalPendingMessages = useCallback((serverMessages: ChatMessage[]) => {
    const pending = messagesRef.current.filter((message) => message.id.startsWith("local:"));
    if (pending.length === 0) return serverMessages;
    const serverIds = new Set(serverMessages.map((message) => message.id));
    return [
      ...serverMessages,
      ...pending.filter((message) => !serverIds.has(message.id)),
    ];
  }, []);

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
    const remaining = Math.max(0, sendCooldownUntilRef.current - Date.now());
    if (remaining <= 0) {
      setSendCooldownRemainingMs(0);
      return;
    }
    const timer = window.setTimeout(() => {
      setSendCooldownRemainingMs(Math.max(0, sendCooldownUntilRef.current - Date.now()));
    }, Math.min(remaining, 1000));
    return () => {
      window.clearTimeout(timer);
    };
  }, [sendCooldownRemainingMs]);

  const startSendCooldown = useCallback((durationMs: number) => {
    const now = Date.now();
    const cooldownMs = parseChatRetryAfterMs(durationMs / 1000);
    lastSentRef.current = now;
    sendCooldownUntilRef.current = now + cooldownMs;
    setSendCooldownRemainingMs(cooldownMs);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let pollRunning = false;
    let cancelled = false;
    let failureCount = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const getNextPollDelay = () => {
      return getChatPollDelayMs({ failureCount, isPageVisible, open });
    };

    async function poll() {
      if (pollRunning) return;
      pollRunning = true;
      try {
        const msgs = await fetchMessages(controller.signal);
        if (controller.signal.aborted) return;
        const nextMessages = mergeLocalPendingMessages(msgs);
        if (!areMessagesEqual(messagesRef.current, nextMessages)) {
          commitMessages(nextMessages);
        }
        setConnected(true);
        pollWarnAtRef.current = 0;
        failureCount = 0;
      } catch (err) {
        if (controller.signal.aborted) return;
        setConnected(false);
        failureCount = Math.min(3, failureCount + 1);
        if (isNetworkFetchError(err)) {
          warnNetworkOnce("[Chat] Poll network unavailable:", pollWarnAtRef, err);
        } else {
          warnNetworkOnce("[Chat] Poll failed:", pollWarnAtRef, err);
        }
      } finally {
        pollRunning = false;
      }
    }

    const schedule = (delayMs: number) => {
      timer = setTimeout(async () => {
        if (cancelled) return;
        await poll();
        if (cancelled) return;
        schedule(getNextPollDelay());
      }, delayMs);
    };

    void poll().finally(() => {
      if (!cancelled) schedule(getNextPollDelay());
    });

    return () => {
      cancelled = true;
      controller.abort();
      pollRunning = false;
      if (timer) clearTimeout(timer);
    };
  }, [commitMessages, isPageVisible, mergeLocalPendingMessages, open]);

  const sendMessage = useCallback(
    async (text: string, senderName: string | null, senderAvatar: string | null) => {
      if (!walletAddress) return false;
      const trimmed = text.trim().slice(0, MAX_TEXT_LENGTH);
      if (!trimmed) return false;

      const now = Date.now();
      const cooldownRemainingMs = Math.max(0, sendCooldownUntilRef.current - now);
      if (cooldownRemainingMs > 0) {
        setSendCooldownRemainingMs(cooldownRemainingMs);
        return false;
      }
      startSendCooldown(CHAT_RATE_LIMIT_MS);
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
      const normalizedAvatar = normalizeChatMessageAvatar(senderAvatar);
      if (normalizedAvatar) payload.senderAvatar = normalizedAvatar;
      const optimisticMessage: ChatMessage = {
        id: `local:${now}:${Math.random().toString(36).slice(2)}`,
        text: trimmed,
        sender: walletAddress.toLowerCase(),
        senderName: senderName || null,
        senderAvatar: normalizedAvatar || null,
        timestamp: now,
      };
      const addOptimisticMessage = () => {
        if (messagesRef.current.some((message) => message.id === optimisticMessage.id)) return;
        commitMessages([...messagesRef.current, optimisticMessage]);
      };
      const removeOptimisticMessage = () => {
        if (!messagesRef.current.some((message) => message.id === optimisticMessage.id)) return;
        commitMessages(messagesRef.current.filter((message) => message.id !== optimisticMessage.id));
      };
      const replaceOptimisticMessage = (message: ChatMessage | null) => {
        if (!message) return;
        const withoutOptimistic = messagesRef.current.filter((item) => item.id !== optimisticMessage.id);
        if (withoutOptimistic.some((item) => item.id === message.id)) {
          commitMessages(withoutOptimistic);
          return;
        }
        commitMessages([...withoutOptimistic, message]);
      };

      try {
        addOptimisticMessage();
        let savedMessage: ChatMessage | null = null;
        try {
          savedMessage = await postMessage(payload);
        } catch (err) {
          if (!isChatAuthError(err)) throw err;

          const refreshed = await refreshAuth();
          if (refreshed) {
            savedMessage = await postMessage(payload);
          } else {
            clearAuth();
            const reauthed = await ensureChatAuth();
            if (!reauthed) throw err;
            savedMessage = await postMessage(payload);
          }
        }

        replaceOptimisticMessage(savedMessage);
        setConnected(true);
        sendWarnAtRef.current = 0;
        setIsSending(false);
        return true;
      } catch (err) {
        removeOptimisticMessage();
        setConnected(false);
        if (isChatRateLimitError(err)) {
          startSendCooldown(err.retryAfterMs);
          warnNetworkOnce("[Chat] Send rate limited:", sendWarnAtRef, err);
        } else if (isNetworkFetchError(err)) {
          warnNetworkOnce("[Chat] Send network unavailable:", sendWarnAtRef, err);
        } else {
          warnNetworkOnce("[Chat] Send failed:", sendWarnAtRef, err);
        }
        setIsSending(false);
        return false;
      }
    },
    [walletAddress, clearAuth, commitMessages, ensureChatAuth, refreshAuth, startSendCooldown],
  );

  return { messages, sendMessage, connected, authReady, ensureChatAuth, sendCooldownRemainingMs, isSending };
}
