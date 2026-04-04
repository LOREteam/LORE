"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../../hooks/useChat";
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
  onSend: (text: string, name: string | null, avatar: string | null) => void;
  onUpdateProfile: (updates: Partial<ChatProfile>) => void;
  onClose: () => void;
  variant?: "embedded" | "floating";
}

export function ChatWindow({
  messages,
  walletAddress,
  profile,
  displayName,
  connected,
  authReady,
  onEnsureAuth,
  onSend,
  onUpdateProfile,
  onClose,
  variant = "embedded",
}: Props) {
  const [input, setInput] = useState("");
  const [showProfile, setShowProfile] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const scrollToBottom = useCallback(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    if (stickToBottom.current) scrollToBottom();
  }, [messages, scrollToBottom]);

  const handleScroll = useCallback(() => {
    const el = listRef.current;
    if (!el) return;
    stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  }, []);

  const handleSend = useCallback(() => {
    const text = input.trim();
    if (!text) return;
    onSend(text, profile.name, profile.customAvatar ?? profile.avatar);
    setInput("");
  }, [input, onSend, profile]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  const myAddr = walletAddress?.toLowerCase() ?? "";
  const containerShadowClass =
    variant === "floating"
      ? "shadow-[0_24px_72px_rgba(2,6,23,0.5)]"
      : "shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]";

  return (
    <div
      className={`flex flex-col overflow-hidden rounded-xl border border-violet-500/22 bg-[#090914]/97 ${containerShadowClass} backdrop-blur-xl animate-slide-up ${
        variant === "embedded" ? "h-full min-h-[35.25rem]" : "fixed z-[210]"
      }`}
      style={
        variant === "floating"
          ? {
              width: "min(34rem, calc(100vw - 1.5rem))",
              right: "0.75rem",
              top: "clamp(8.8rem, 18vh, 10.2rem)",
              bottom: "max(7.6rem, calc(env(safe-area-inset-bottom, 0px) + 7.1rem))",
            }
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
            onClick={() => setShowProfile(true)}
            aria-label="Profile"
            title="Profile"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-transparent text-slate-500 transition-all duration-200 hover:border-violet-500/20 hover:bg-white/[0.04] hover:text-violet-300"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <circle cx="8" cy="5.5" r="2.5" />
              <path d="M3 14c0-2.5 2.2-4 5-4s5 1.5 5 4" />
            </svg>
          </button>
          <button
            onClick={onClose}
            aria-label="Close chat panel"
            title="Close chat"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-transparent text-slate-500 transition-all duration-200 hover:border-violet-500/20 hover:bg-white/[0.04] hover:text-slate-200"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="4" y1="4" x2="12" y2="12" />
              <line x1="12" y1="4" x2="4" y2="12" />
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
                  onClick={handleSend}
                  disabled={!input.trim()}
                  aria-label="Send message"
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-600 text-white transition-all duration-200 hover:bg-violet-500 disabled:pointer-events-none disabled:opacity-35"
                  title="Send message"
                >
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                    <path d="M2.5 2.1l11.8 5.5c.4.2.4.7 0 .8L2.5 13.9c-.5.2-1-.2-.8-.7L3.4 8 1.7 2.8c-.2-.5.3-.9.8-.7z" />
                  </svg>
                </button>
              </div>
            ) : (
              <button
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
          onClose={() => setShowProfile(false)}
        />
      )}
    </div>
  );
}
