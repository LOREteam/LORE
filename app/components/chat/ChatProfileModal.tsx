"use client";

import React, { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { ChatProfile } from "../../hooks/useChatProfile";
import { ChatAvatar, AVATAR_IDS, isAvatarId, type AvatarId } from "./chatAvatars";
import { resizeImageToBase64, validateCustomAvatarFile } from "../../lib/chatAvatarUpload";
import { UiButton } from "../ui/UiButton";
import { UiInput } from "../ui/UiInput";
import { uiTokens } from "../ui/tokens";

interface Props {
  profile: ChatProfile;
  walletAddress: string | null;
  onSave: (updates: Partial<ChatProfile>) => void;
  onClose: () => void;
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter((element) => {
    if (element.hasAttribute("disabled")) return false;
    if (element.getAttribute("aria-hidden") === "true") return false;
    return element.offsetParent !== null || document.activeElement === element;
  });
}

export function ChatProfileModal({ profile, walletAddress, onSave, onClose }: Props) {
  const [name, setName] = useState(profile.name ?? "");
  const [avatar, setAvatar] = useState<string | null>(profile.customAvatar ? null : profile.avatar);
  const [customAvatar, setCustomAvatar] = useState<string | null>(profile.customAvatar ?? null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const lastScrollTopRef = useRef(0);
  const restoreFrameARef = useRef<number | null>(null);
  const restoreFrameBRef = useRef<number | null>(null);
  const titleId = React.useId();

  const restoreScrollPosition = useCallback((scrollTop: number) => {
    lastScrollTopRef.current = scrollTop;
    if (restoreFrameARef.current !== null) cancelAnimationFrame(restoreFrameARef.current);
    if (restoreFrameBRef.current !== null) cancelAnimationFrame(restoreFrameBRef.current);
    restoreFrameARef.current = requestAnimationFrame(() => {
      restoreFrameBRef.current = requestAnimationFrame(() => {
        if (scrollAreaRef.current) {
          scrollAreaRef.current.scrollTop = lastScrollTopRef.current;
        }
      });
    });
  }, []);

  const handleScrollArea = useCallback(() => {
    if (scrollAreaRef.current) {
      lastScrollTopRef.current = scrollAreaRef.current.scrollTop;
    }
  }, []);

  useLayoutEffect(() => {
    const scrollArea = scrollAreaRef.current;
    if (!scrollArea) return;
    if (Math.abs(scrollArea.scrollTop - lastScrollTopRef.current) > 2) {
      scrollArea.scrollTop = lastScrollTopRef.current;
    }
  });

  React.useEffect(() => {
    restoreFocusRef.current =
      typeof document !== "undefined" && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const dialog = dialogRef.current;
    const initialFocus = dialog?.querySelector<HTMLElement>("#profile-name");
    initialFocus?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab" || !dialog) return;
      const focusable = getFocusableElements(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;

      if (event.shiftKey) {
        if (!active || active === first || !dialog.contains(active)) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if (!active || active === last || !dialog.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (restoreFrameARef.current !== null) cancelAnimationFrame(restoreFrameARef.current);
      if (restoreFrameBRef.current !== null) cancelAnimationFrame(restoreFrameBRef.current);
      restoreFocusRef.current?.focus();
    };
  }, [onClose]);

  const handleSave = useCallback(() => {
    onSave({
      name: name.trim() || null,
      avatar: customAvatar ? null : avatar,
      customAvatar,
    });
    onClose();
  }, [avatar, customAvatar, name, onClose, onSave]);

  const selectPreset = useCallback((id: string | null) => {
    const scrollTop = scrollAreaRef.current?.scrollTop ?? 0;
    setAvatar(id);
    setCustomAvatar(null);
    setUploadError(null);
    if (fileRef.current) fileRef.current.value = "";
    restoreScrollPosition(scrollTop);
  }, [restoreScrollPosition]);

  const handleCustomAvatarClear = useCallback(() => {
    const scrollTop = scrollAreaRef.current?.scrollTop ?? 0;
    setCustomAvatar(null);
    setUploadError(null);
    if (fileRef.current) fileRef.current.value = "";
    restoreScrollPosition(scrollTop);
  }, [restoreScrollPosition]);

  const handleFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const scrollTop = scrollAreaRef.current?.scrollTop ?? 0;

    const validationError = validateCustomAvatarFile(file);
    if (validationError) {
      setUploadError(validationError);
      event.target.value = "";
      restoreScrollPosition(scrollTop);
      return;
    }

    setUploading(true);
    setUploadError(null);

    try {
      const dataUrl = await resizeImageToBase64(file, 64);
      setCustomAvatar(dataUrl);
      setAvatar(null);
    } catch {
      setUploadError("Could not process that image.");
    } finally {
      setUploading(false);
      event.target.value = "";
      restoreScrollPosition(scrollTop);
    }
  }, [restoreScrollPosition]);

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      className={`absolute inset-0 z-10 flex min-h-0 flex-col overflow-hidden bg-[#0d0d1a]/98 backdrop-blur-lg ${uiTokens.radius.lg}`}
    >
      <div className="flex items-center justify-between border-b border-violet-500/15 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="h-4 w-1.5 rounded-full bg-violet-500/60" />
          <span id={titleId} className="text-sm font-semibold text-slate-200">Profile Settings</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-white/[0.06] hover:text-slate-300"
        >
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      <div
        ref={scrollAreaRef}
        onScroll={handleScrollArea}
        className="flex-1 min-h-0 space-y-4 overflow-y-auto overscroll-contain px-4 py-3"
      >
        <div>
          <label
            htmlFor="profile-name"
            className="mb-1.5 block text-[10px] font-bold uppercase tracking-wider text-slate-400"
          >
            Display Name
          </label>
          <UiInput
            id="profile-name"
            type="text"
            maxLength={20}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={
              walletAddress
                ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
                : "Anon"
            }
            className="border-violet-500/20 bg-white/[0.06] text-slate-200 placeholder:text-slate-600"
          />
          <p className={`${uiTokens.helperText} mt-1`}>{name.length}/20</p>
        </div>

        <div>
          <label className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Custom Avatar
          </label>
          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-3">
            <div
              className={`shrink-0 rounded-2xl border p-1.5 transition-all ${
                customAvatar
                  ? "border-violet-400/70 bg-violet-500/14 shadow-[0_0_20px_rgba(124,58,237,0.2)]"
                  : "border-white/10 bg-white/[0.02]"
              }`}
            >
              <ChatAvatar
                customSrc={customAvatar}
                avatarId={customAvatar ? null : (isAvatarId(avatar) ? avatar : null)}
                walletAddress={walletAddress ?? undefined}
                size={48}
              />
            </div>

            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-slate-200">
                {customAvatar ? "Custom avatar selected" : "Upload your own image"}
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
                JPG, PNG, GIF, or WEBP up to 5 MB. We crop to a centered 64x64 square.
              </p>
              {uploadError ? (
                <p className="mt-1 text-[11px] text-rose-400" role="alert">
                  {uploadError}
                </p>
              ) : null}
            </div>
          </div>

          <div className="mt-2 flex gap-2">
            <UiButton
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              variant="secondary"
              size="sm"
              className="text-xs"
            >
              {uploading ? "Processing..." : customAvatar ? "Change image" : "Upload image"}
            </UiButton>
            {customAvatar ? (
              <UiButton
                onClick={handleCustomAvatarClear}
                disabled={uploading}
                variant="ghost"
                size="sm"
                className="text-xs"
              >
                Remove
              </UiButton>
            ) : null}
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/webp,image/gif"
            onChange={handleFileChange}
            className="hidden"
          />
        </div>

        <div>
          <label className="mb-2 block text-[10px] font-bold uppercase tracking-wider text-slate-400">
            Avatar
          </label>
          <div className="grid grid-cols-4 gap-2">
            <button
              type="button"
              onClick={() => selectPreset(null)}
              title="Wallet identity"
              className={`flex h-[4.2rem] items-center justify-center border transition-all duration-150 ${uiTokens.radius.md} ${uiTokens.focusRing} ${
                !avatar && !customAvatar
                  ? "border-violet-400/80 bg-violet-500/15 shadow-[0_0_20px_rgba(124,58,237,0.25)]"
                  : "border-white/10 bg-white/[0.03] hover:border-violet-500/40 hover:bg-violet-500/5"
              }`}
            >
              <ChatAvatar avatarId={null} walletAddress={walletAddress ?? undefined} size={44} />
            </button>

            {AVATAR_IDS.map((id) => (
              <button
                key={id}
                type="button"
                onClick={() => selectPreset(id)}
                title={id}
                className={`flex h-[4.2rem] items-center justify-center border transition-all duration-150 ${uiTokens.radius.md} ${uiTokens.focusRing} ${
                  avatar === id && !customAvatar
                    ? "border-violet-400/80 bg-violet-500/15 shadow-[0_0_20px_rgba(124,58,237,0.25)]"
                    : "border-white/10 bg-white/[0.03] hover:border-violet-500/40 hover:bg-violet-500/5"
                }`}
              >
                <ChatAvatar avatarId={id as AvatarId} size={44} />
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="border-t border-violet-500/15 px-4 py-3">
        <UiButton onClick={handleSave} variant="primary" size="md" fullWidth disabled={uploading}>
          Save
        </UiButton>
      </div>
    </div>
  );
}
