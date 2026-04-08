"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { sanitizeCustomChatAvatar, sanitizePresetChatAvatar } from "../lib/chatAvatar";
import { loadChatAuthSession } from "../lib/chatSessionClient";
import { readJsonResponse } from "../lib/readJsonResponse";
import { type ChatAuthControls, useChatAuth } from "./useChatAuth";

const LEGACY_STORAGE_KEY = "lore:chat-profile";
const STORAGE_KEY_PREFIX = "lore:chat-profile:";
const PROFILE_NAME_MAX = 20;
const MAX_AVATAR_LEN = 8_000;
export interface ChatProfile {
  name: string | null;
  avatar: string | null;
  customAvatar: string | null;
  updatedAt?: number;
}

function storageKey(walletAddress: string | null): string {
  return walletAddress ? `${STORAGE_KEY_PREFIX}${walletAddress.toLowerCase()}` : LEGACY_STORAGE_KEY;
}

function isChatAuthError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes("http 401") || msg.includes("chat auth required");
}

function normalizeProfile(input: Partial<ChatProfile>): ChatProfile {
  const nameRaw = typeof input.name === "string" ? input.name.trim() : "";
  const name = nameRaw ? nameRaw.slice(0, PROFILE_NAME_MAX) : null;
  const avatar = sanitizePresetChatAvatar(input.avatar);
  const customAvatar = sanitizeCustomChatAvatar(input.customAvatar, MAX_AVATAR_LEN);
  const updatedAt = typeof input.updatedAt === "number" ? input.updatedAt : 0;
  return { name, avatar, customAvatar, updatedAt };
}

function hasMeaningfulProfile(profile: ChatProfile): boolean {
  return !!(profile.name || profile.avatar || profile.customAvatar);
}

function sameProfileContent(a: ChatProfile | null, b: ChatProfile | null): boolean {
  if (!a || !b) return false;
  return a.name === b.name && a.avatar === b.avatar && a.customAvatar === b.customAvatar;
}

function loadProfile(walletAddress: string | null): ChatProfile {
  if (typeof localStorage === "undefined") return { name: null, avatar: null, customAvatar: null };
  try {
    const key = storageKey(walletAddress);
    const raw = localStorage.getItem(key);
    if (raw) return normalizeProfile(JSON.parse(raw) as Partial<ChatProfile>);

    // Backward compatibility: migrate old single-key profile to per-wallet key.
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!legacy) return { name: null, avatar: null, customAvatar: null, updatedAt: 0 };
    const parsedLegacy = normalizeProfile(JSON.parse(legacy) as Partial<ChatProfile>);
    if (walletAddress) {
      localStorage.setItem(key, JSON.stringify(parsedLegacy));
    }
    return parsedLegacy;
  } catch {
    return { name: null, avatar: null, customAvatar: null, updatedAt: 0 };
  }
}

function saveProfile(walletAddress: string | null, profile: ChatProfile) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(storageKey(walletAddress), JSON.stringify(profile));
  } catch {
    // ignore quota / private mode
  }
}

function newerProfile(a: ChatProfile | null, b: ChatProfile | null): ChatProfile | null {
  if (!a) return b;
  if (!b) return a;
  return (a.updatedAt ?? 0) >= (b.updatedAt ?? 0) ? a : b;
}

async function fetchRemoteProfile(walletAddress: string): Promise<ChatProfile | null> {
  try {
    const res = await fetch(`/api/chat/profile?walletAddress=${walletAddress.toLowerCase()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const json = await readJsonResponse<{ profile?: Partial<ChatProfile> | null }>(res);
    if (!json) return null;
    if (!json.profile || typeof json.profile !== "object") return null;
    const profile = normalizeProfile(json.profile);
    return hasMeaningfulProfile(profile) ? profile : null;
  } catch {
    return null;
  }
}

async function saveRemoteProfile(walletAddress: string, profile: ChatProfile): Promise<void> {
  const payload = {
    walletAddress: walletAddress.toLowerCase(),
    name: profile.name,
    avatar: profile.avatar,
    customAvatar: profile.customAvatar,
    updatedAt: profile.updatedAt ?? Date.now(),
  };
  const response = await fetch("/api/chat/profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(body || `HTTP ${response.status}`);
  }
}

export function useChatProfile(walletAddress: string | null, auth?: ChatAuthControls) {
  const normalizedWallet = walletAddress ? walletAddress.toLowerCase() : null;
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
      await saveRemoteProfile(normalizedWallet, nextProfile);
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
      const remote = await fetchRemoteProfile(normalizedWallet);

      const best = newerProfile(local, remote);
      if (!best || !hasMeaningfulProfile(best)) return;

      if (!cancelled) setProfile(best);
      saveProfile(normalizedWallet, best);

      // Keep dedicated profile path populated for fast restore after cache clear.
      if (!remote || (best.updatedAt ?? 0) > (remote.updatedAt ?? 0)) {
        const existing = loadChatAuthSession(normalizedWallet);
        if (existing?.address === normalizedWallet) {
          void saveRemoteProfile(normalizedWallet, best).catch((err) => {
            if (!isChatAuthError(err)) {
              console.warn("[ChatProfile] Background profile sync failed:", err);
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
    const next = normalizeProfile({ ...profile, ...updates, updatedAt: Date.now() });
    if (updates.customAvatar) {
      next.avatar = null;
    } else if (updates.avatar) {
      next.customAvatar = null;
    }
    if (sameProfileContent(profile, next)) {
      return;
    }
    setProfile(next);
    saveProfile(normalizedWallet, next);
    if (normalizedWallet && hasMeaningfulProfile(next)) {
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

export function resizeImageToBase64(file: File, maxSize = 64): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = maxSize;
        canvas.height = maxSize;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("No canvas context"));

        const min = Math.min(img.width, img.height);
        const sx = (img.width - min) / 2;
        const sy = (img.height - min) / 2;
        ctx.drawImage(img, sx, sy, min, min, 0, 0, maxSize, maxSize);

        resolve(canvas.toDataURL("image/jpeg", 0.7));
      };
      img.onerror = reject;
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
