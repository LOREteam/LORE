"use client";

import { log } from "../lib/logger";
import { useCallback, useEffect, useRef, useState } from "react";
import { loadChatAuthSession } from "../lib/chatSessionClient";
import { normalizeChatAuthAddress } from "../lib/chatAuth";
import {
  emptyChatProfile,
  fetchRemoteChatProfile,
  hasMeaningfulChatProfile,
  normalizeChatProfile,
  persistChatProfileCache,
  readChatProfileCache,
  sameChatProfileContent,
  saveRemoteChatProfile,
  selectNewerChatProfile,
  type ChatProfile,
} from "../lib/chatProfileRuntime";
import { type ChatAuthControls, useChatAuth } from "./useChatAuth";

export type { ChatProfile } from "../lib/chatProfileRuntime";

function isChatAuthError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes("http 401") || msg.includes("chat auth required");
}

function loadProfile(walletAddress: string | null): ChatProfile {
  if (typeof localStorage === "undefined") return emptyChatProfile();
  return readChatProfileCache(localStorage, walletAddress);
}

function saveProfile(walletAddress: string | null, profile: ChatProfile) {
  if (typeof localStorage === "undefined") return;
  persistChatProfileCache(localStorage, walletAddress, profile);
}

export function useChatProfile(walletAddress: string | null, auth?: ChatAuthControls) {
  const normalizedWallet = normalizeChatAuthAddress(walletAddress);
  const [profile, setProfile] = useState<ChatProfile>(() => loadProfile(normalizedWallet));
  const localAuth = useChatAuth(walletAddress, "Verify wallet for chat profile");
  const { ensureChatAuth, refreshAuth, clearAuth } = auth ?? localAuth;
  const lastSyncedProfileRef = useRef<string | null>(null);

  useEffect(() => {
    setProfile(loadProfile(normalizedWallet));
  }, [normalizedWallet]);

  const persistRemoteProfile = useCallback(async (nextProfile: ChatProfile) => {
    if (!normalizedWallet) return;
    const syncKey = JSON.stringify({
      name: nextProfile.name,
      avatar: nextProfile.avatar,
      customAvatar: nextProfile.customAvatar,
      updatedAt: nextProfile.updatedAt ?? 0,
    });
    if (lastSyncedProfileRef.current === syncKey) return;

    const attemptSave = async () => {
      await saveRemoteChatProfile(normalizedWallet, nextProfile);
    };

    try {
      await attemptSave();
      lastSyncedProfileRef.current = syncKey;
    } catch (err) {
      if (!isChatAuthError(err)) throw err;
      const refreshed = await refreshAuth();
      if (refreshed) {
        await attemptSave();
        lastSyncedProfileRef.current = syncKey;
        return;
      }
      clearAuth();
      const reauthed = await ensureChatAuth();
      if (!reauthed) throw err;
      await attemptSave();
      lastSyncedProfileRef.current = syncKey;
    }
  }, [clearAuth, ensureChatAuth, normalizedWallet, refreshAuth]);

  useEffect(() => {
    if (!normalizedWallet) return;
    let cancelled = false;

    const syncProfile = async () => {
      const local = loadProfile(normalizedWallet);
      const remote = await fetchRemoteChatProfile(normalizedWallet);

      const best = selectNewerChatProfile(local, remote);
      if (!best || !hasMeaningfulChatProfile(best)) return;

      if (!cancelled) setProfile(best);
      saveProfile(normalizedWallet, best);

      // Keep dedicated profile path populated for fast restore after cache clear.
      if (!remote || (best.updatedAt ?? 0) > (remote.updatedAt ?? 0)) {
        const existing = loadChatAuthSession(normalizedWallet);
        if (existing?.address === normalizedWallet) {
          void saveRemoteChatProfile(normalizedWallet, best).catch((err) => {
            if (!isChatAuthError(err)) {
              log.warn("ChatProfile", "background profile sync failed", { message: err instanceof Error ? err.message : String(err) });
            }
          });
        }
      }
    };

    void syncProfile();
    return () => {
      cancelled = true;
    };
  }, [normalizedWallet]);

  const displayName = profile.name || (walletAddress ? shortenAddr(walletAddress) : "Anon");

  const effectiveAvatar = profile.customAvatar ?? profile.avatar;

  const updateProfile = useCallback((updates: Partial<ChatProfile>) => {
    const next = normalizeChatProfile({ ...profile, ...updates, updatedAt: Date.now() });
    if (updates.customAvatar) {
      next.avatar = null;
    } else if (updates.avatar) {
      next.customAvatar = null;
    }
    if (sameChatProfileContent(profile, next)) {
      return;
    }
    setProfile(next);
    saveProfile(normalizedWallet, next);
    if (normalizedWallet && hasMeaningfulChatProfile(next)) {
      void (async () => {
        if (await ensureChatAuth()) {
          await persistRemoteProfile(next);
        }
      })().catch(() => {
        // Keep the local profile and auth marker intact when remote sync fails.
      });
    }
  }, [ensureChatAuth, normalizedWallet, persistRemoteProfile, profile]);

  return { profile, displayName, effectiveAvatar, updateProfile };
}

function shortenAddr(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}
