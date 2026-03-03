"use client";

import React, { useCallback, useRef, useState } from "react";
import Image from "next/image";
import type { ChatProfile } from "../../hooks/useChatProfile";
import { resizeImageToBase64 } from "../../hooks/useChatProfile";
import { ChatAvatar, AVATAR_IDS, type AvatarId } from "./chatAvatars";
import { UiButton } from "../ui/UiButton";
import { UiInput } from "../ui/UiInput";
import { uiTokens } from "../ui/tokens";

interface Props {
  profile: ChatProfile;
  walletAddress: string | null;
  onSave: (updates: Partial<ChatProfile>) => void;
  onClose: () => void;
}

export function ChatProfileModal({ profile, walletAddress, onSave, onClose }: Props) {
  const [name, setName] = useState(profile.name ?? "");
  const [avatar, setAvatar] = useState<string | null>(profile.avatar);
  const [customAvatar, setCustomAvatar] = useState<string | null>(profile.customAvatar ?? null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const handleSave = useCallback(() => {
    if (customAvatar) {
      onSave({ name: name.trim() || null, avatar: null, customAvatar });
    } else {
      onSave({ name: name.trim() || null, avatar, customAvatar: null });
    }
    onClose();
  }, [name, avatar, customAvatar, onSave, onClose]);

  const handleFileChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return;
    if (file.size > 5 * 1024 * 1024) return;

    setUploading(true);
    try {
      const dataUrl = await resizeImageToBase64(file, 64);
      setCustomAvatar(dataUrl);
      setAvatar(null);
    } catch {
      /* ignore */
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }, []);

  const selectPreset = useCallback((id: string | null) => {
    setAvatar(id);
    setCustomAvatar(null);
  }, []);

  const activeIsCustom = !!customAvatar;

  return (
    <div role="dialog" aria-modal="true" aria-label="Profile Settings" className={`absolute inset-0 z-10 flex flex-col bg-[#0d0d1a]/98 backdrop-blur-lg ${uiTokens.radius.lg} overflow-hidden`}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-violet-500/15">
        <span className="text-sm font-semibold text-slate-200">Profile Settings</span>
        <UiButton onClick={onClose} variant="ghost" size="xs" className="px-2.5 leading-none" aria-label="Close">
          &times;
        </UiButton>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {/* Name */}
        <div>
          <label htmlFor="profile-name" className="text-xs text-slate-400 uppercase tracking-wider mb-1.5 block">Display Name</label>
          <UiInput
            id="profile-name"
            type="text"
            maxLength={20}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={walletAddress ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : "Anon"}
            className="bg-white/[0.06] border-violet-500/20 text-slate-200 placeholder:text-slate-600"
          />
          <p className={`${uiTokens.helperText} mt-1`}>{name.length}/20 · wallet-linked profile sync</p>
        </div>

        {/* Upload */}
        <div>
          <label className="text-xs text-slate-400 uppercase tracking-wider mb-2 block">Custom Avatar</label>
          <div className="flex items-center gap-3">
            <div
              className={`shrink-0 rounded-xl border-2 p-1.5 transition-colors ${
                activeIsCustom
                  ? "border-violet-400/80 bg-violet-500/15 shadow-[0_0_28px_rgba(124,58,237,0.3)]"
                  : "border-white/10 bg-white/[0.02]"
              }`}
            >
              {customAvatar ? (
                <Image
                  src={customAvatar}
                  alt="custom"
                  width={44}
                  height={44}
                  unoptimized
                  className="w-11 h-11 rounded-lg object-cover"
                />
              ) : (
                <div className="w-11 h-11 rounded-lg bg-white/5 flex items-center justify-center text-slate-600">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <UiButton
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                variant="secondary"
                size="sm"
                className="text-xs"
              >
                {uploading ? "Processing..." : "Upload image"}
              </UiButton>
              {customAvatar && (
                <UiButton
                  onClick={() => setCustomAvatar(null)}
                  variant="danger"
                  size="xs"
                  className="text-xs"
                >
                  Remove
                </UiButton>
              )}
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>
          <p className="text-[10px] text-slate-600 mt-1.5">JPG, PNG, GIF up to 5 MB. Cropped to 64×64.</p>
        </div>

        {/* Presets */}
        <div>
          <label className="text-xs text-slate-400 uppercase tracking-wider mb-2 block">Preset Avatars</label>
          <div className="grid grid-cols-4 gap-2.5">
            <button
              onClick={() => selectPreset(null)}
              className={`h-16 ${uiTokens.radius.md} border transition-all flex items-center justify-center ${uiTokens.focusRing} ${
                !avatar && !customAvatar
                  ? "border-violet-400/80 bg-violet-500/15 shadow-[0_0_24px_rgba(124,58,237,0.28)]"
                  : "border-white/10 bg-white/[0.02] hover:border-violet-500/50 hover:bg-violet-500/5"
              }`}
            >
              <ChatAvatar avatarId={null} walletAddress={walletAddress ?? undefined} size={44} />
            </button>
            {AVATAR_IDS.map((id) => (
              <button
                key={id}
                onClick={() => selectPreset(id)}
                className={`h-16 ${uiTokens.radius.md} border transition-all flex items-center justify-center ${uiTokens.focusRing} ${
                  avatar === id && !customAvatar
                    ? "border-violet-400/80 bg-violet-500/15 shadow-[0_0_24px_rgba(124,58,237,0.28)]"
                    : "border-white/10 bg-white/[0.02] hover:border-violet-500/50 hover:bg-violet-500/5"
                }`}
              >
                <ChatAvatar avatarId={id as AvatarId} size={44} />
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="px-4 py-3 border-t border-violet-500/15">
        <UiButton
          onClick={handleSave}
          variant="primary"
          size="md"
          fullWidth
        >
          Save
        </UiButton>
      </div>
    </div>
  );
}
