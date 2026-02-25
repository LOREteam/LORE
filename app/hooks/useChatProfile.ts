"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "lore:chat-profile";

export interface ChatProfile {
  name: string | null;
  avatar: string | null;
  customAvatar: string | null;
}

function loadProfile(): ChatProfile {
  if (typeof localStorage === "undefined") return { name: null, avatar: null, customAvatar: null };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { name: null, avatar: null, customAvatar: null };
    const parsed = JSON.parse(raw);
    return {
      name: parsed.name ?? null,
      avatar: parsed.avatar ?? null,
      customAvatar: parsed.customAvatar ?? null,
    };
  } catch {
    return { name: null, avatar: null, customAvatar: null };
  }
}

function saveProfile(profile: ChatProfile) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
}

export function useChatProfile(walletAddress: string | null) {
  const [profile, setProfile] = useState<ChatProfile>({ name: null, avatar: null, customAvatar: null });

  useEffect(() => {
    setProfile(loadProfile());
  }, []);

  const displayName = profile.name || (walletAddress ? shortenAddr(walletAddress) : "Anon");

  const effectiveAvatar = profile.customAvatar ?? profile.avatar;

  const updateProfile = useCallback((updates: Partial<ChatProfile>) => {
    setProfile((prev) => {
      const next = { ...prev, ...updates };
      if (next.name !== undefined) {
        next.name = next.name ? next.name.slice(0, 20) : null;
      }
      if (updates.customAvatar) {
        next.avatar = null;
      } else if (updates.avatar) {
        next.customAvatar = null;
      }
      saveProfile(next);
      return next;
    });
  }, []);

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
