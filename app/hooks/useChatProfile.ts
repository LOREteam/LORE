"use client";

import { useCallback, useEffect, useState } from "react";
import { FIREBASE_DB_URL } from "../lib/firebase";

const LEGACY_STORAGE_KEY = "lore:chat-profile";
const STORAGE_KEY_PREFIX = "lore:chat-profile:";
const PROFILE_NAME_MAX = 20;
const MAX_AVATAR_LEN = 8_000;
const MESSAGE_SCAN_LIMIT = 400;

export interface ChatProfile {
  name: string | null;
  avatar: string | null;
  customAvatar: string | null;
  updatedAt?: number;
}

function storageKey(walletAddress: string | null): string {
  return walletAddress ? `${STORAGE_KEY_PREFIX}${walletAddress.toLowerCase()}` : LEGACY_STORAGE_KEY;
}

function normalizeProfile(input: Partial<ChatProfile>): ChatProfile {
  const nameRaw = typeof input.name === "string" ? input.name.trim() : "";
  const name = nameRaw ? nameRaw.slice(0, PROFILE_NAME_MAX) : null;
  const avatar = typeof input.avatar === "string" && input.avatar.length <= 120 ? input.avatar : null;
  const customAvatar =
    typeof input.customAvatar === "string" && input.customAvatar.length <= MAX_AVATAR_LEN
      ? input.customAvatar
      : null;
  const updatedAt = typeof input.updatedAt === "number" ? input.updatedAt : 0;
  return { name, avatar, customAvatar, updatedAt };
}

function hasMeaningfulProfile(profile: ChatProfile): boolean {
  return !!(profile.name || profile.avatar || profile.customAvatar);
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
  localStorage.setItem(storageKey(walletAddress), JSON.stringify(profile));
}

function newerProfile(a: ChatProfile | null, b: ChatProfile | null): ChatProfile | null {
  if (!a) return b;
  if (!b) return a;
  return (a.updatedAt ?? 0) >= (b.updatedAt ?? 0) ? a : b;
}

async function fetchRemoteProfile(walletAddress: string): Promise<ChatProfile | null> {
  try {
    const url = `${FIREBASE_DB_URL}/gamedata/chatProfiles/${walletAddress.toLowerCase()}.json`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || typeof data !== "object") return null;
    const profile = normalizeProfile(data as Partial<ChatProfile>);
    return hasMeaningfulProfile(profile) ? profile : null;
  } catch {
    return null;
  }
}

async function saveRemoteProfile(walletAddress: string, profile: ChatProfile): Promise<void> {
  const normalizedAddress = walletAddress.toLowerCase();
  const payload = {
    name: profile.name,
    avatar: profile.avatar,
    customAvatar: profile.customAvatar,
    updatedAt: profile.updatedAt ?? Date.now(),
  };
  try {
    await fetch(`${FIREBASE_DB_URL}/gamedata/chatProfiles/${normalizedAddress}.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // silent sync failure: local profile is still kept
  }
}

async function fetchProfileFromMessages(walletAddress: string): Promise<ChatProfile | null> {
  try {
    const normalizedAddress = walletAddress.toLowerCase();
    const url = `${FIREBASE_DB_URL}/messages.json?orderBy="timestamp"&limitToLast=${MESSAGE_SCAN_LIMIT}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || typeof data !== "object") return null;

    let latest: ChatProfile | null = null;
    for (const val of Object.values(data)) {
      const v = val as Record<string, unknown>;
      const sender = typeof v.sender === "string" ? v.sender.toLowerCase() : "";
      if (sender !== normalizedAddress) continue;
      const senderAvatar = typeof v.senderAvatar === "string" ? v.senderAvatar : null;
      const senderName = typeof v.senderName === "string" ? v.senderName : null;
      const timestamp = typeof v.timestamp === "number" ? v.timestamp : 0;
      const fromMessage = normalizeProfile({
        name: senderName,
        avatar: senderAvatar && !senderAvatar.startsWith("data:") ? senderAvatar : null,
        customAvatar: senderAvatar && senderAvatar.startsWith("data:") ? senderAvatar : null,
        updatedAt: timestamp,
      });
      if (!hasMeaningfulProfile(fromMessage)) continue;
      latest = newerProfile(latest, fromMessage);
    }
    return latest;
  } catch {
    return null;
  }
}

export function useChatProfile(walletAddress: string | null) {
  const normalizedWallet = walletAddress ? walletAddress.toLowerCase() : null;
  const [profile, setProfile] = useState<ChatProfile>(() => loadProfile(normalizedWallet));

  useEffect(() => {
    setProfile(loadProfile(normalizedWallet));
  }, [normalizedWallet]);

  useEffect(() => {
    if (!normalizedWallet) return;
    let cancelled = false;

    const syncProfile = async () => {
      const local = loadProfile(normalizedWallet);
      const [remote, fromMessages] = await Promise.all([
        fetchRemoteProfile(normalizedWallet),
        fetchProfileFromMessages(normalizedWallet),
      ]);

      let best = newerProfile(local, remote);
      best = newerProfile(best, fromMessages);
      if (!best || !hasMeaningfulProfile(best)) return;

      if (!cancelled) setProfile(best);
      saveProfile(normalizedWallet, best);

      // Keep dedicated profile path populated for fast restore after cache clear.
      if (!remote || (best.updatedAt ?? 0) > (remote.updatedAt ?? 0)) {
        void saveRemoteProfile(normalizedWallet, best);
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
    setProfile(next);
    saveProfile(normalizedWallet, next);
    if (normalizedWallet && hasMeaningfulProfile(next)) {
      void saveRemoteProfile(normalizedWallet, next);
    }
  }, [normalizedWallet, profile]);

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
