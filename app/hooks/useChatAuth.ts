"use client";

import { useSignMessage, useWallets } from "@privy-io/react-auth";
import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeChatAuthAddress } from "../lib/chatAuth";
import { createChatAuthProof, requestChatAuthSession } from "../lib/chatAuthRuntime";
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
    const normalizedWallet = normalizeChatAuthAddress(walletAddress);
    if (!normalizedWallet) {
      sessionRef.current = null;
      authInFlightRef.current = null;
      authInFlightForRef.current = null;
      refreshInFlightRef.current = null;
      setAuthReady(false);
      setSessionExpiresAt(null);
      return;
    }

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
    const normalizedWallet = normalizeChatAuthAddress(walletAddress);
    if (!normalizedWallet) return false;
    if (sessionRef.current && sessionRef.current.expiresAt > Date.now()) return true;
    if (authInFlightRef.current && authInFlightForRef.current === normalizedWallet) {
      return authInFlightRef.current;
    }

    const task = (async () => {
      try {
        const proof = await createChatAuthProof({
          walletAddress: normalizedWallet,
          origin: window.location.origin,
          wallets,
          signMessage: async (message, title) => {
            const result = await signMessage(
              { message },
              { uiOptions: { title } },
            );
            return result.signature;
          },
          uiTitle,
        });
        if (!proof) return false;
        const expiresAt = await requestChatAuthSession("POST", proof);
        const fallbackSession = buildFallbackChatAuthSession(normalizedWallet);
        const nextSession: ChatAuthSession = {
          address: normalizedWallet,
          expiresAt: expiresAt ?? fallbackSession.expiresAt,
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

    const normalizedWallet = normalizeChatAuthAddress(walletAddress);
    if (!normalizedWallet) return false;
    const task = (async () => {
      try {
        const expiresAt = await requestChatAuthSession("GET");
        const nextSession: ChatAuthSession = {
          address: normalizedWallet,
          expiresAt: expiresAt ?? buildFallbackChatAuthSession(normalizedWallet).expiresAt,
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
