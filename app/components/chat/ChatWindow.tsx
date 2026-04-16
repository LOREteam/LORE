"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { CHAT_RATE_LIMIT_MS, type ChatMessage } from "../../hooks/useChat";
import type { ChatProfile } from "../../hooks/useChatProfile";
import { ChatMessageRow } from "./ChatMessage";
import { ChatProfileModal } from "./ChatProfileModal";
import { emptyStates } from "../../lib/loreTexts";
import { LoreText } from "../LoreText";

interface Props {
  messages: ChatMessage[];
  walletAddress: string | null;
  profile: ChatProfile;
  displayName: string;
  connected: boolean;
  authReady: boolean;
  onEnsureAuth: () => Promise<boolean>;
  sendCooldownRemainingMs: number;
  isSending: boolean;
  onSend: (text: string, name: string | null, avatar: string | null) => Promise<boolean>;
  onUpdateProfile: (updates: Partial<ChatProfile>) => void;
  onClose: () => void;
  variant?: "embedded" | "floating";
}

export const ChatWindow = React.memo(function ChatWindow({
  messages,
  walletAddress,
  profile,
  displayName,
  connected,
  authReady,
  onEnsureAuth,
  sendCooldownRemainingMs,
  isSending,
  onSend,
  onUpdateProfile,
  onClose,
  variant = "embedded",
}: Props) {
  const [input, setInput] = useState("");
  const [showProfile, setShowProfile] = useState(false);
  const [isDesktopViewport, setIsDesktopViewport] = useState(false);
  const [desktopFloatingStyle, setDesktopFloatingStyle] = useState<React.CSSProperties | null>(null);
  const [embeddedDesktopHeight, setEmbeddedDesktopHeight] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const scrollToBottom = useCallback(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    if (stickToBottom.current) scrollToBottom();
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const updateViewport = () => {
      setIsDesktopViewport(window.innerWidth >= 900);
    };
    updateViewport();
    window.addEventListener("resize", updateViewport);
    return () => {
      window.removeEventListener("resize", updateViewport);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !isDesktopViewport) return;
    if (variant !== "floating") return;

    let frameId = 0;
    const fallbackStyle = {
      width: "24rem",
      top: "13.75rem",
      right: "0.75rem",
      bottom: "4.5rem",
    } satisfies React.CSSProperties;

    const measureFloatingRect = () => {
      const walletCard = document.getElementById("header-wallet-card");
      const dock = document.querySelector(".hud-dock");
      if (!(walletCard instanceof HTMLElement) || !(dock instanceof HTMLElement)) {
        setDesktopFloatingStyle(fallbackStyle);
        return;
      }

      const walletRect = walletCard.getBoundingClientRect();
      const dockRect = dock.getBoundingClientRect();
      const dockGapPx = 4;
      const nextBottom = Math.max(window.innerHeight - dockRect.top + dockGapPx, 0);
      setDesktopFloatingStyle({
        top: `${Math.max(walletRect.bottom + 8, 0)}px`,
        right: `${Math.max(window.innerWidth - walletRect.right, 0)}px`,
        width: `${walletRect.width}px`,
        bottom: `${nextBottom}px`,
      });
    };

    const scheduleMeasure = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(measureFloatingRect);
    };

    const walletCard = document.getElementById("header-wallet-card");
    const dock = document.querySelector(".hud-dock");
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            scheduleMeasure();
          });

    if (walletCard instanceof HTMLElement) resizeObserver?.observe(walletCard);
    if (dock instanceof HTMLElement) resizeObserver?.observe(dock);
    measureFloatingRect();
    window.addEventListener("resize", scheduleMeasure);
    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
    };
  }, [isDesktopViewport, variant]);

  useEffect(() => {
    if (typeof window === "undefined" || !isDesktopViewport) return;
    if (variant !== "embedded") return;

    let frameId = 0;
    const dockGapPx = 4;

    const measureEmbeddedHeight = () => {
      const node = rootRef.current;
      const dock = document.querySelector(".hud-dock");
      if (!(node instanceof HTMLElement) || !(dock instanceof HTMLElement)) {
        setEmbeddedDesktopHeight(null);
        return;
      }

      const rootRect = node.getBoundingClientRect();
      const dockRect = dock.getBoundingClientRect();
      const nextHeight = Math.max(dockRect.top - rootRect.top - dockGapPx, 360);
      setEmbeddedDesktopHeight(`${nextHeight}px`);
    };

    const scheduleMeasure = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(measureEmbeddedHeight);
    };

    const dock = document.querySelector(".hud-dock");
    const parent = rootRef.current?.parentElement ?? null;
    const resizeObserver =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            scheduleMeasure();
          });

    if (dock instanceof HTMLElement) resizeObserver?.observe(dock);
    if (parent instanceof HTMLElement) resizeObserver?.observe(parent);
    measureEmbeddedHeight();
    window.addEventListener("resize", scheduleMeasure);
    return () => {
      window.cancelAnimationFrame(frameId);
      resizeObserver?.disconnect();
      window.removeEventListener("resize", scheduleMeasure);
    };
  }, [isDesktopViewport, variant]);

  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }, []);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text) return;
    const sent = await onSend(text, profile.name, profile.customAvatar ?? profile.avatar);
    if (sent) setInput("");
  }, [input, onSend, profile]);

  const handleOpenProfile = useCallback(() => {
    setShowProfile(true);
  }, []);

  const handleCloseProfile = useCallback(() => {
    setShowProfile(false);
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend],
  );

  const myAddr = walletAddress?.toLowerCase() ?? "";
  const sendLocked = sendCooldownRemainingMs > 0;
  const sendCooldownProgress = Math.min(1, Math.max(0, sendCooldownRemainingMs / CHAT_RATE_LIMIT_MS));
  const sendCooldownCircumference = 2 * Math.PI * 18;
  const sendCooldownOffset = sendCooldownCircumference * (1 - sendCooldownProgress);
  const containerShadowClass =
    variant === "floating"
      ? "shadow-[0_24px_72px_rgba(2,6,23,0.5)]"
      : "shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]";

  return (
    <div
      ref={rootRef}
      className={`flex flex-col overflow-hidden rounded-xl border border-violet-500/22 bg-[#090914]/97 ${containerShadowClass} backdrop-blur-xl animate-slide-up ${
        variant === "embedded"
          ? "max-[899px]:h-full max-[899px]:min-h-[35.25rem] max-[899px]:pb-[6.75rem] min-[900px]:h-[calc(100dvh-17rem)] min-[900px]:min-h-[22.5rem]"
          : "fixed z-[210]"
      }`}
      style={
        variant === "floating"
          ? isDesktopViewport
            ? desktopFloatingStyle ?? {
                width: "24rem",
                top: "13.75rem",
                right: "0.75rem",
                bottom: "4.5rem",
              }
            : {
                width: "min(20rem, calc(100vw - 12.75rem))",
                height: "min(35.25rem, calc(100dvh - 7.5rem))",
                right: "max(10.75rem, calc(env(safe-area-inset-right, 0px) + 10.25rem))",
                bottom: "max(calc(7rem + 1cm), calc(env(safe-area-inset-bottom, 0px) + 6.55rem + 1cm))",
              }
          : variant === "embedded" && isDesktopViewport && embeddedDesktopHeight
            ? { height: embeddedDesktopHeight }
            : undefined
      }
    >
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute inset-x-5 top-0 h-px bg-gradient-to-r from-transparent via-violet-400/35 to-transparent" />
      </div>

      <div className="relative flex items-center gap-2 border-b border-violet-500/14 px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[1rem] font-semibold tracking-[-0.02em] text-slate-100">Chat</span>
            <span
              className={`h-2.5 w-2.5 rounded-full ${connected ? "bg-emerald-400 shadow-[0_0_14px_rgba(52,211,153,0.7)]" : "bg-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.55)]"}`}
              title={connected ? "Connected" : "Connecting..."}
            />
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={handleOpenProfile}
            aria-label="Profile"
            title="Profile"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-transparent text-slate-500 transition-all duration-200 hover:border-violet-500/20 hover:bg-white/[0.04] hover:text-violet-300"
          >
            <svg aria-hidden="true" width="17" height="17" viewBox="0 0 17 17" fill="none">
              <circle cx="8.5" cy="5.5" r="2.9" fill="currentColor" opacity="0.85" />
              <path
                d="M2.5 15.5c0-3.038 2.686-5.5 6-5.5s6 2.462 6 5.5"
                stroke="currentColor"
                strokeWidth="1.55"
                strokeLinecap="round"
                fill="none"
              />
            </svg>
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close chat panel"
            title="Close chat"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-transparent text-slate-500 transition-all duration-200 hover:border-violet-500/20 hover:bg-white/[0.04] hover:text-slate-200"
          >
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M3 3l8 8M11 3l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div ref={listRef} onScroll={handleScroll} className="no-scrollbar flex-1 overflow-y-auto px-2 py-2.5">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-10 text-center italic">
              <div className="space-y-2 text-sm leading-relaxed text-slate-600">
                <div><LoreText items={emptyStates.chat} /></div>
                <div className="text-slate-700"><LoreText items={emptyStates.chatSub} /></div>
              </div>
            </div>
          ) : (
            messages.map((msg) => (
              <ChatMessageRow key={msg.id} message={msg} isOwn={msg.sender.toLowerCase() === myAddr} />
            ))
          )}
        </div>

        <div className="border-t border-violet-500/14 px-3 pb-2.5 pt-2">
          {walletAddress ? (
            authReady ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  maxLength={280}
                  placeholder={`Message as ${displayName}`}
                  className="h-11 min-w-0 flex-1 rounded-xl border border-violet-500/14 bg-[#1a1a30] px-4 text-[15px] text-slate-100 placeholder:text-slate-500 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] focus:outline-none focus:border-violet-500/38"
                />
                <button
                  type="button"
                  onClick={() => {
                    void handleSend();
                  }}
                  disabled={!input.trim() || sendLocked || isSending}
                  aria-label="Send message"
                  className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-violet-600 text-white transition-all duration-200 hover:bg-violet-500 active:scale-95 disabled:pointer-events-none disabled:opacity-55"
                  title={sendLocked ? "Message cooldown active" : "Send message"}
                >
                  {(sendLocked || isSending) && (
                    <svg
                      aria-hidden="true"
                      className={`pointer-events-none absolute inset-0 h-full w-full -rotate-90 ${isSending && !sendLocked ? "animate-spin" : ""}`}
                      viewBox="0 0 44 44"
                      fill="none"
                    >
                      <circle cx="22" cy="22" r="18" stroke="rgba(255,255,255,0.16)" strokeWidth="2.5" />
                      <circle
                        cx="22"
                        cy="22"
                        r="18"
                        stroke="rgba(216,180,254,0.95)"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeDasharray={sendCooldownCircumference}
                        strokeDashoffset={sendLocked ? sendCooldownOffset : sendCooldownCircumference * 0.72}
                        style={{ transition: "stroke-dashoffset 80ms linear" }}
                      />
                    </svg>
                  )}
                  <svg
                    aria-hidden="true"
                    className={`relative z-10 transition-opacity ${sendLocked || isSending ? "opacity-75" : "opacity-100"}`}
                    width="17"
                    height="17"
                    viewBox="0 0 17 17"
                    fill="none"
                  >
                    <path
                      d="M2 2.5L15 8.5L2 14.5V10L10.5 8.5L2 7V2.5Z"
                      fill="currentColor"
                      stroke="currentColor"
                      strokeWidth="0.6"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  void onEnsureAuth();
                }}
                className="h-11 w-full rounded-xl bg-violet-600 px-4 text-sm font-semibold text-white transition-colors hover:bg-violet-500"
              >
                Verify wallet to chat
              </button>
            )
          ) : (
            <div className="flex h-11 items-center justify-center rounded-xl border border-dashed border-violet-500/14 bg-[#161627] px-4 text-sm text-slate-500">
              Connect wallet to chat
            </div>
          )}
        </div>
      </div>

      {showProfile && (
        <ChatProfileModal
          profile={profile}
          walletAddress={walletAddress}
          onSave={onUpdateProfile}
          onClose={handleCloseProfile}
        />
      )}
    </div>
  );
});
