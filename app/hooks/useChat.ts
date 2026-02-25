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

async function fetchMessages(): Promise<ChatMessage[]> {
  const url = `${FIREBASE_DB_URL}/messages.json?orderBy="timestamp"&limitToLast=${MESSAGES_LIMIT}`;
  const res = await fetch(url);
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
  const url = `${FIREBASE_DB_URL}/messages.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Firebase write HTTP ${res.status}: ${body}`);
  }
}

export function useChat(walletAddress: string | null) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [connected, setConnected] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const lastSentRef = useRef(0);
  const proofRef = useRef<ChatAuthProof | null>(null);
  const authInFlightRef = useRef<Promise<boolean> | null>(null);
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
        if (!connected) setConnected(true);
      } catch (err) {
        console.error("[Chat] Poll error:", err);
      }
    }

    console.log("[Chat] Starting REST polling for wallet:", walletAddress.slice(0, 10) + "...");
    poll();
    const timer = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [walletAddress]); // eslint-disable-line react-hooks/exhaustive-deps

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
      } catch (err) {
        console.error("[Chat] Send failed:", err);
      }
    },
    [walletAddress, ensureChatAuth],
  );

  return { messages, sendMessage, connected, authReady, ensureChatAuth };
}
