"use client";

import { useSignMessage } from "@privy-io/react-auth";
import { useCallback, useEffect, useRef, useState } from "react";
import { verifyMessage } from "viem";
import { FIREBASE_DB_URL } from "../lib/firebase";

export interface ChatMessage {
  id: string;
  text: string;
  sender: string;
  senderName: string | null;
  senderAvatar: string | null;
  timestamp: number;
}

const MESSAGES_LIMIT = 100;
const RATE_LIMIT_MS = 1_500;
const MAX_TEXT_LENGTH = 280;
const POLL_INTERVAL_MS = 3_000;
const AUTH_STORAGE_PREFIX = "lore:chat-auth:";
const CHAT_CACHE_KEY = "lore:chat-cache:v1";
const NETWORK_WARN_THROTTLE_MS = 15_000;

interface ChatAuthProof {
  address: string;
  message: string;
  signature: string;
}

function getAuthStorageKey(address: string) {
  return `${AUTH_STORAGE_PREFIX}${address.toLowerCase()}`;
}

function loadProof(address: string): ChatAuthProof | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(getAuthStorageKey(address));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ChatAuthProof>;
    if (!parsed.address || !parsed.message || !parsed.signature) return null;
    return {
      address: parsed.address.toLowerCase(),
      message: parsed.message,
      signature: parsed.signature,
    };
  } catch {
    return null;
  }
}

function saveProof(proof: ChatAuthProof) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(getAuthStorageKey(proof.address), JSON.stringify(proof));
}

function isNetworkFetchError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes("failed to fetch") || msg.includes("networkerror") || msg.includes("network request failed");
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
          senderAvatar: typeof v.senderAvatar === "string" ? v.senderAvatar : null,
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

async function fetchMessages(): Promise<ChatMessage[]> {
  const url = `${FIREBASE_DB_URL}/messages.json?orderBy="timestamp"&limitToLast=${MESSAGES_LIMIT}`;
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Firebase read HTTP ${res.status}`);
  const data = await res.json();
  if (!data || typeof data !== "object") return [];

  return Object.entries(data)
    .map(([id, val]: [string, unknown]) => {
      const v = val as Record<string, unknown>;
      return {
        id,
        text: (v.text as string) ?? "",
        sender: (v.sender as string) ?? "",
        senderName: (v.senderName as string) ?? null,
        senderAvatar: (v.senderAvatar as string) ?? null,
        timestamp: (v.timestamp as number) ?? 0,
      };
    })
    .sort((a, b) => a.timestamp - b.timestamp);
}

async function postMessage(payload: Record<string, unknown>): Promise<void> {
  const res = await fetch("/api/chat/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Firebase write HTTP ${res.status}: ${body}`);
  }
}

export function useChat(walletAddress: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => loadCachedMessages());
  const [connected, setConnected] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const lastSentRef = useRef(0);
  const proofRef = useRef<ChatAuthProof | null>(null);
  const authInFlightRef = useRef<Promise<boolean> | null>(null);
  const pollWarnAtRef = useRef(0);
  const sendWarnAtRef = useRef(0);
  const { signMessage } = useSignMessage();

  useEffect(() => {
    let cancelled = false;
    if (!walletAddress) {
      proofRef.current = null;
      setAuthReady(false);
      return;
    }

    const proof = loadProof(walletAddress);
    if (proof) {
      proofRef.current = proof;
      setAuthReady(true);
    } else {
      proofRef.current = null;
      setAuthReady(false);
    }

    const verifyStored = async () => {
      const p = loadProof(walletAddress);
      if (!p) return;
      try {
        const ok = await verifyMessage({
          address: walletAddress as `0x${string}`,
          message: p.message,
          signature: p.signature as `0x${string}`,
        });
        if (cancelled) return;
        if (!ok) {
          localStorage.removeItem(getAuthStorageKey(walletAddress));
          proofRef.current = null;
          setAuthReady(false);
        }
      } catch (err) {
        if (!cancelled) {
          console.warn("[Chat] Stored proof verification failed:", err);
          localStorage.removeItem(getAuthStorageKey(walletAddress));
          proofRef.current = null;
          setAuthReady(false);
        }
      }
    };

    void verifyStored();
    return () => {
      cancelled = true;
    };
  }, [walletAddress]);

  useEffect(() => {
    if (!walletAddress) return;

    let active = true;

    async function poll() {
      try {
        const msgs = await fetchMessages();
        if (!active) return;
        setMessages(msgs);
        saveCachedMessages(msgs);
        setConnected(true);
        pollWarnAtRef.current = 0;
      } catch (err) {
        if (!active) return;
        setConnected(false);
        if (isNetworkFetchError(err)) {
          warnNetworkOnce("[Chat] Poll network unavailable:", pollWarnAtRef, err);
        } else {
          warnNetworkOnce("[Chat] Poll failed:", pollWarnAtRef, err);
        }
      }
    }

    console.log("[Chat] Starting REST polling for wallet:", walletAddress.slice(0, 10) + "...");
    void poll();
    const timer = setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [walletAddress]);

  const ensureChatAuth = useCallback(async (): Promise<boolean> => {
    if (!walletAddress) return false;
    if (proofRef.current) return true;
    if (authInFlightRef.current) return authInFlightRef.current;

    const task = (async () => {
      try {
        const addr = walletAddress.toLowerCase();
        const message = [
          "LORE Chat Verification",
          `Address: ${addr}`,
          "Purpose: Verify wallet ownership for chat messages.",
          "This signature does not trigger any blockchain transaction.",
        ].join("\n");
        const { signature } = await signMessage(
          { message },
          { uiOptions: { title: "Verify wallet for chat" } },
        );
        const ok = await verifyMessage({
          address: walletAddress as `0x${string}`,
          message,
          signature: signature as `0x${string}`,
        });
        if (!ok) return false;
        const proof: ChatAuthProof = { address: addr, message, signature };
        proofRef.current = proof;
        saveProof(proof);
        setAuthReady(true);
        return true;
      } catch {
        return false;
      } finally {
        authInFlightRef.current = null;
      }
    })();

    authInFlightRef.current = task;
    return task;
  }, [walletAddress, signMessage]);

  const sendMessage = useCallback(
    async (text: string, senderName: string | null, senderAvatar: string | null) => {
      if (!walletAddress) return;
      const trimmed = text.trim().slice(0, MAX_TEXT_LENGTH);
      if (!trimmed) return;

      const now = Date.now();
      if (now - lastSentRef.current < RATE_LIMIT_MS) return;
      lastSentRef.current = now;

      const authOk = await ensureChatAuth();
      if (!authOk || !proofRef.current) return;

      const payload: Record<string, unknown> = {
        text: trimmed,
        sender: walletAddress.toLowerCase(),
        authAddress: proofRef.current.address,
        authMessage: proofRef.current.message,
        authSignature: proofRef.current.signature,
        timestamp: { ".sv": "timestamp" },
      };
      if (senderName) payload.senderName = senderName;
      if (senderAvatar) payload.senderAvatar = senderAvatar;

      try {
        console.log("[Chat] Sending message:", trimmed.slice(0, 30));
        await postMessage(payload);
        console.log("[Chat] Message sent OK");

        const msgs = await fetchMessages();
        setMessages(msgs);
        saveCachedMessages(msgs);
        setConnected(true);
        sendWarnAtRef.current = 0;
      } catch (err) {
        setConnected(false);
        if (isNetworkFetchError(err)) {
          warnNetworkOnce("[Chat] Send network unavailable:", sendWarnAtRef, err);
        } else {
          warnNetworkOnce("[Chat] Send failed:", sendWarnAtRef, err);
        }
      }
    },
    [walletAddress, ensureChatAuth],
  );

  return { messages, sendMessage, connected, authReady, ensureChatAuth };
}
