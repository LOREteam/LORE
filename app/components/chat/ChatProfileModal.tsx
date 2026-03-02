"use client";

import React, { useCallback, useRef, useState } from "react";
import Image from "next/image";
import type { ChatProfile } from "../../hooks/useChatProfile";
import { resizeImageToBase64 } from "../../hooks/useChatProfile";
import { ChatAvatar, AVATAR_IDS, type AvatarId } from "./chatAvatars";

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
    <div className="absolute inset-0 z-10 flex flex-col bg-[#0d0d1a]/98 backdrop-blur-lg rounded-2xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-violet-500/15">
        <span className="text-sm font-semibold text-slate-200">Profile Settings</span>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-lg leading-none">&times;</button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {/* Name */}
        <div>
          <label className="text-xs text-slate-400 uppercase tracking-wider mb-1.5 block">Display Name</label>
          <input
            type="text"
            maxLength={20}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={walletAddress ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}` : "Anon"}
            className="w-full bg-white/[0.06] border border-violet-500/20 rounded-lg px-3 py-2 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-violet-500/40"
          />
          <p className="text-[10px] text-slate-600 mt-1">{name.length}/20</p>
        </div>

        {/* Upload */}
        <div>
          <label className="text-xs text-slate-400 uppercase tracking-wider mb-2 block">Custom Avatar</label>
          <div className="flex items-center gap-3">
            <div
              className={`shrink-0 rounded-lg border-2 p-1 transition-colors ${
                activeIsCustom ? "border-violet-500/60 bg-violet-500/10" : "border-white/10"
              }`}
            >
              {customAvatar ? (
                <Image
                  src={customAvatar}
                  alt="custom"
                  width={40}
                  height={40}
                  unoptimized
                  className="w-10 h-10 rounded-md object-cover"
                />
              ) : (
                <div className="w-10 h-10 rounded-md bg-white/5 flex items-center justify-center text-slate-600">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-1.5">
              <button
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="text-xs px-3 py-1.5 rounded-md bg-violet-600/30 hover:bg-violet-600/50 text-violet-300 transition-colors disabled:opacity-50"
              >
                {uploading ? "Processing..." : "Upload image"}
              </button>
              {customAvatar && (
                <button
                  onClick={() => setCustomAvatar(null)}
                  className="text-xs px-3 py-1 rounded-md text-slate-500 hover:text-red-400 transition-colors"
                >
                  Remove
                </button>
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
          <div className="grid grid-cols-4 gap-2">
            <button
              onClick={() => selectPreset(null)}
              className={`p-1.5 rounded-lg border transition-colors flex items-center justify-center ${
                !avatar && !customAvatar
                  ? "border-violet-500/60 bg-violet-500/10"
                  : "border-white/5 hover:border-violet-500/30"
              }`}
            >
              <ChatAvatar avatarId={null} walletAddress={walletAddress ?? undefined} size={36} />
            </button>
            {AVATAR_IDS.map((id) => (
              <button
                key={id}
                onClick={() => selectPreset(id)}
                className={`p-1.5 rounded-lg border transition-colors flex items-center justify-center ${
                  avatar === id && !customAvatar
                    ? "border-violet-500/60 bg-violet-500/10"
                    : "border-white/5 hover:border-violet-500/30"
                }`}
              >
                <ChatAvatar avatarId={id as AvatarId} size={36} />
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="px-4 py-3 border-t border-violet-500/15">
        <button
          onClick={handleSave}
          className="w-full py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-sm font-semibold text-white transition-colors"
        >
          Save
        </button>
      </div>
    </div>
  );
}
