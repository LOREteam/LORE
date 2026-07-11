"use client";

import { useSignMessage, useWallets } from "@privy-io/react-auth";
import { useCallback, useEffect, useRef, useState } from "react";
import { toHex } from "viem";
import { APP_CHAIN_ID } from "../lib/constants";
import { buildChatAuthMessage, createChatAuthNonce } from "../lib/chatAuth";
import { fetchWithTimeout } from "../lib/fetchWithTimeout";
import {
  buildFallbackChatAuthSession,
  CHAT_AUTH_SESSION_EVENT,
  clearChatAuthSession,
  loadChatAuthSession,
  saveChatAuthSession,
  type ChatAuthSession,
} from "../lib/chatSessionClient";

const CHAT_AUTH_REFRESH_LEAD_MS = 24 * 60 * 60 * 1000;
const CHAT_AUTH_REFRESH_MIN_DELAY_MS = 60_000;

type Eip1193Provider = {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
};

async function createChatSession(payload: Record<string, unknown>): Promise<number> {
  const response = await fetchWithTimeout("/api/chat/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(payload),
  });
  const json = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok || json?.error) {
    throw new Error(json?.error || `Chat auth HTTP ${response.status}`);
  }
  return Number(response.headers.get("x-chat-session-expires-at") ?? NaN);
}

async function refreshChatSession(): Promise<number> {
  const response = await fetchWithTimeout("/api/chat/auth", {
    method: "GET",
    cache: "no-store",
  });
  const json = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok || json?.error) {
    throw new Error(json?.error || `Chat auth HTTP ${response.status}`);
  }
  return Number(response.headers.get("x-chat-session-expires-at") ?? NaN);
}

export function useChatAuth(walletAddress: string | null, uiTitle = "Verify wallet for chat") {
  const [authReady, setAuthReady] = useState(false);
  const [sessionExpiresAt, setSessionExpiresAt] = useState<number | null>(null);
  const sessionRef = useRef<ChatAuthSession | null>(null);
  const authInFlightRef = useRef<Promise<boolean> | null>(null);
  const authInFlightForRef = useRef<string | null>(null);
  const refreshInFlightRef = useRef<Promise<boolean> | null>(null);
  const { signMessage } = useSignMessage();
  const { wallets } = useWallets();

  useEffect(() => {
    if (!walletAddress) {
      sessionRef.current = null;
      authInFlightRef.current = null;
      authInFlightForRef.current = null;
      refreshInFlightRef.current = null;
      setAuthReady(false);
      setSessionExpiresAt(null);
      return;
    }

    const normalizedWallet = walletAddress.toLowerCase();
    const syncAuthState = () => {
      const session = loadChatAuthSession(normalizedWallet);
      if (session) {
        sessionRef.current = session;
        setAuthReady(true);
        setSessionExpiresAt(session.expiresAt);
      } else {
        sessionRef.current = null;
        setAuthReady(false);
        setSessionExpiresAt(null);
      }
    };

    syncAuthState();
    authInFlightRef.current = null;
    authInFlightForRef.current = null;

    const onStorage = (event: StorageEvent) => {
      if (!event.key || event.key.endsWith(normalizedWallet)) {
        syncAuthState();
      }
    };
    const onSessionChange = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail as { address?: string } | undefined : undefined;
      if (!detail?.address || detail.address === normalizedWallet) {
        syncAuthState();
      }
    };

    window.addEventListener("storage", onStorage);
    window.addEventListener(CHAT_AUTH_SESSION_EVENT, onSessionChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(CHAT_AUTH_SESSION_EVENT, onSessionChange);
    };
  }, [walletAddress]);

  const ensureChatAuth = useCallback(async (): Promise<boolean> => {
    if (!walletAddress) return false;
    if (sessionRef.current && sessionRef.current.expiresAt > Date.now()) return true;
    const normalizedWallet = walletAddress.toLowerCase();
    if (authInFlightRef.current && authInFlightForRef.current === normalizedWallet) {
      return authInFlightRef.current;
    }

    const task = (async () => {
      try {
        const issuedAt = new Date().toISOString();
        const message = buildChatAuthMessage({
          address: normalizedWallet,
          uri: `${window.location.origin}/chat`,
          chainId: APP_CHAIN_ID,
          nonce: createChatAuthNonce(),
          issuedAt,
        });
        const targetWallet = wallets.find((wallet) => wallet.address.toLowerCase() === normalizedWallet);
        let signature = "";
        if (targetWallet) {
          const provider = (await targetWallet.getEthereumProvider()) as Eip1193Provider;
          const messageHex = toHex(message);
          signature = String(
            await provider.request({
              method: "personal_sign",
              params: [messageHex, normalizedWallet],
            }),
          );
        } else {
          const result = await signMessage(
            { message },
            { uiOptions: { title: uiTitle } },
          );
          signature = result.signature;
        }
        const expiresAt = await createChatSession({
          authAddress: normalizedWallet,
          authMessage: message,
          authSignature: signature,
        });
        const fallbackSession = buildFallbackChatAuthSession(normalizedWallet);
        const nextSession: ChatAuthSession = {
          address: normalizedWallet,
          expiresAt: Number.isFinite(expiresAt) ? expiresAt : fallbackSession.expiresAt,
        };
        sessionRef.current = nextSession;
        saveChatAuthSession(nextSession);
        setAuthReady(true);
        setSessionExpiresAt(nextSession.expiresAt);
        return true;
      } catch {
        return false;
      } finally {
        authInFlightRef.current = null;
        authInFlightForRef.current = null;
      }
    })();

    authInFlightRef.current = task;
    authInFlightForRef.current = normalizedWallet;
    return task;
  }, [signMessage, uiTitle, walletAddress, wallets]);

  const clearAuth = useCallback(() => {
    if (!walletAddress) return;
    clearChatAuthSession(walletAddress);
    sessionRef.current = null;
    setAuthReady(false);
    setSessionExpiresAt(null);
  }, [walletAddress]);

  const refreshAuth = useCallback(async (): Promise<boolean> => {
    if (!walletAddress) return false;
    const currentSession = sessionRef.current;
    if (!currentSession || currentSession.expiresAt <= Date.now()) return false;
    if (refreshInFlightRef.current) return refreshInFlightRef.current;

    const normalizedWallet = walletAddress.toLowerCase();
    const task = (async () => {
      try {
        const expiresAt = await refreshChatSession();
        const nextSession: ChatAuthSession = {
          address: normalizedWallet,
          expiresAt: Number.isFinite(expiresAt) ? expiresAt : buildFallbackChatAuthSession(normalizedWallet).expiresAt,
        };
        sessionRef.current = nextSession;
        saveChatAuthSession(nextSession);
        setAuthReady(true);
        setSessionExpiresAt(nextSession.expiresAt);
        return true;
      } catch {
        return false;
      } finally {
        refreshInFlightRef.current = null;
      }
    })();

    refreshInFlightRef.current = task;
    return task;
  }, [walletAddress]);

  useEffect(() => {
    if (!walletAddress || !authReady || !sessionExpiresAt) return;

    const msUntilRefresh = Math.max(
      CHAT_AUTH_REFRESH_MIN_DELAY_MS,
      sessionExpiresAt - Date.now() - CHAT_AUTH_REFRESH_LEAD_MS,
    );
    const timerId = window.setTimeout(() => {
      void refreshAuth();
    }, msUntilRefresh);

    return () => {
      window.clearTimeout(timerId);
    };
  }, [authReady, refreshAuth, sessionExpiresAt, walletAddress]);

  return {
    authReady,
    ensureChatAuth,
    refreshAuth,
    clearAuth,
  };
}

export type ChatAuthControls = {
  authReady: boolean;
  ensureChatAuth: () => Promise<boolean>;
  refreshAuth: () => Promise<boolean>;
  clearAuth: () => void;
};
