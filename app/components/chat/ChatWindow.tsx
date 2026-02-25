"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../../hooks/useChat";
import type { ChatProfile } from "../../hooks/useChatProfile";
import { ChatMessageRow } from "./ChatMessage";
import { ChatProfileModal } from "./ChatProfileModal";
import { emptyStates } from "../../lib/loreTexts";
import { LoreText } from "../LoreText";

const CHAT_LAYOUT_KEY = "lore-chat-layout";
const MIN_W = 240;
const MIN_H = 280;
const DEFAULT_W = 320;
const DEFAULT_H = 420;

interface ChatLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

function loadLayout(): ChatLayout | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(CHAT_LAYOUT_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (
      typeof data?.x === "number" &&
      typeof data?.y === "number" &&
      typeof data?.w === "number" &&
      typeof data?.h === "number"
    ) {
      return { x: data.x, y: data.y, w: Math.max(MIN_W, data.w), h: Math.max(MIN_H, data.h) };
    }
  } catch {
    /* ignore */
  }
  return null;
}

function saveLayout(layout: ChatLayout) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(CHAT_LAYOUT_KEY, JSON.stringify(layout));
  } catch {
    /* ignore */
  }
}

function defaultLayout(): ChatLayout {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1920;
  const vh = typeof window !== "undefined" ? window.innerHeight : 900;
  const margin = 16;
  const buttonArea = 56; // space for floating toggle (bottom-3 = 12px + button ~44px)
  const x = vw - DEFAULT_W - margin;
  const h = Math.min(DEFAULT_H, vh - margin * 2 - buttonArea);
  const y = vh - h - buttonArea - margin;
  return {
    x: Math.max(margin, x),
    y: Math.max(margin, y),
    w: DEFAULT_W,
    h,
  };
}

function clampToViewport(layout: ChatLayout): ChatLayout {
  const vw = typeof window !== "undefined" ? window.innerWidth : 1920;
  const vh = typeof window !== "undefined" ? window.innerHeight : 900;
  const margin = 8;
  const maxW = vw - margin * 2;
  const maxH = vh - margin - 56;
  return {
    x: Math.max(margin, Math.min(layout.x, vw - layout.w - margin)),
    y: Math.max(margin, Math.min(layout.y, vh - layout.h - 56 - margin)),
    w: Math.max(MIN_W, Math.min(layout.w, maxW)),
    h: Math.max(MIN_H, Math.min(layout.h, maxH)),
  };
}

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
}

export function ChatWindow({ messages, walletAddress, profile, displayName, connected, authReady, onEnsureAuth, onSend, onUpdateProfile, onClose }: Props) {
  const [input, setInput] = useState("");
  const [showProfile, setShowProfile] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const [layout, setLayout] = useState<ChatLayout | null>(() =>
    typeof window !== "undefined" ? defaultLayout() : null,
  );
  const layoutRef = useRef<ChatLayout | null>(null);

  useEffect(() => {
    const loaded = loadLayout();
    if (loaded) {
      const clamped = clampToViewport(loaded);
      setLayout(clamped);
      layoutRef.current = clamped;
    } else {
      const def = defaultLayout();
      setLayout(def);
      layoutRef.current = def;
    }
  }, []);

  const persistLayout = useCallback((next: ChatLayout) => {
    layoutRef.current = next;
    setLayout(next);
    saveLayout(next);
  }, []);

  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0, layoutX: 0, layoutY: 0 });

  const handleDragStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const l = layoutRef.current ?? defaultLayout();
      setDragging(true);
      dragStart.current = { x: e.clientX, y: e.clientY, layoutX: l.x, layoutY: l.y };
    },
    [],
  );

  const [resizing, setResizing] = useState(false);
  const resizeStart = useRef({ x: 0, y: 0, lx: 0, ly: 0, w: 0, h: 0 });

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const l = layoutRef.current ?? defaultLayout();
      setResizing(true);
      resizeStart.current = { x: e.clientX, y: e.clientY, lx: l.x, ly: l.y, w: l.w, h: l.h };
    },
    [],
  );

  useEffect(() => {
    if (!dragging && !resizing) return;
    const onMove = (e: MouseEvent) => {
      if (dragging) {
        const dx = e.clientX - dragStart.current.x;
        const dy = e.clientY - dragStart.current.y;
        const next: ChatLayout = {
          ...(layoutRef.current ?? defaultLayout()),
          x: dragStart.current.layoutX + dx,
          y: dragStart.current.layoutY + dy,
        };
        persistLayout(clampToViewport(next));
      } else if (resizing) {
        const dx = e.clientX - resizeStart.current.x;
        const dy = e.clientY - resizeStart.current.y;
        const newW = Math.max(MIN_W, resizeStart.current.w - dx);
        const newH = Math.max(MIN_H, resizeStart.current.h - dy);
        const next: ChatLayout = {
          ...(layoutRef.current ?? defaultLayout()),
          x: resizeStart.current.lx + dx,
          y: resizeStart.current.ly + dy,
          w: newW,
          h: newH,
        };
        persistLayout(clampToViewport(next));
      }
    };
    const onUp = () => {
      setDragging(false);
      setResizing(false);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging, resizing, persistLayout]);

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

  const l = layout ?? { x: 100, y: 100, w: DEFAULT_W, h: DEFAULT_H };

  return (
    <div
      className="fixed z-[200] flex flex-col bg-[#0d0d1a]/95 backdrop-blur-md border border-violet-500/20 rounded-xl shadow-2xl shadow-violet-500/5 animate-slide-up overflow-hidden"
      style={{
        left: l.x,
        top: l.y,
        width: l.w,
        height: l.h,
        cursor: dragging ? "grabbing" : undefined,
      }}
    >
      {/* Header - drag handle + centered Chat title, resize handle on the left */}
      <div
        onMouseDown={handleDragStart}
        className={`relative flex items-center justify-between px-4 py-2.5 border-b border-violet-500/15 shrink-0 ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
      >
        <div className="absolute top-2 left-2" onMouseDown={(e) => e.stopPropagation()}>
          <div
            onMouseDown={handleResizeStart}
            className="w-8 h-8 cursor-nw-resize flex items-center justify-center rounded bg-[#0d0d1a]/80 border border-violet-500/30"
            title="Resize"
          >
            <svg width="18" height="18" viewBox="0 0 12 12" fill="currentColor" className="text-violet-400">
              <path d="M10 10V8h-2v2h2zM10 6V4h-2v2h2zM8 10V6H6v4h2zM6 8V4H4v4h2zM4 6V4H2v2h2z" />
            </svg>
          </div>
        </div>
        <div className="flex-1 min-w-0" />
        <div className="flex items-center justify-center gap-2 shrink-0">
          <span className="text-sm font-semibold text-slate-200">Chat</span>
          <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-emerald-400 animate-synced-pulse" : "bg-yellow-500 animate-pulse"}`} title={connected ? "Connected" : "Connecting..."} />
        </div>
        <div className="flex items-center gap-1 flex-1 justify-end min-w-0" onMouseDown={(e) => e.stopPropagation()}>
          <button
            onClick={() => setShowProfile(true)}
            title="Profile"
            className="p-1.5 rounded-md text-slate-500 hover:text-violet-400 hover:bg-white/5 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <circle cx="8" cy="5.5" r="2.5" />
              <path d="M3 14c0-2.5 2.2-4 5-4s5 1.5 5 4" />
            </svg>
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="4" y1="4" x2="12" y2="12" />
              <line x1="12" y1="4" x2="4" y2="12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={listRef} onScroll={handleScroll} className="flex-1 overflow-y-auto py-2 space-y-0.5 min-h-0">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-slate-600 text-xs gap-1 italic">
            <span><LoreText items={emptyStates.chat} /></span>
            <span className="text-slate-700"><LoreText items={emptyStates.chatSub} /></span>
          </div>
        )}
        {messages.map((msg) => (
          <ChatMessageRow key={msg.id} message={msg} isOwn={msg.sender.toLowerCase() === myAddr} />
        ))}
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-violet-500/15 p-2">
        {walletAddress ? (
          authReady ? (
            <div className="flex gap-1.5">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                maxLength={280}
                placeholder={`Message as ${displayName}`}
                className="flex-1 bg-white/[0.06] border border-violet-500/15 rounded-lg px-3 py-1.5 text-sm text-slate-200 placeholder-slate-600 focus:outline-none focus:border-violet-500/40 min-w-0"
              />
              <button
                onClick={handleSend}
                disabled={!input.trim()}
                className="px-3 py-1.5 rounded-lg bg-violet-600 hover:bg-violet-500 disabled:opacity-30 disabled:pointer-events-none text-white text-sm font-medium transition-colors shrink-0"
              >
                <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M2.5 2.1l11.8 5.5c.4.2.4.7 0 .8L2.5 13.9c-.5.2-1-.2-.8-.7L3.4 8 1.7 2.8c-.2-.5.3-.9.8-.7zM4.2 8.5l6.3 0-6.3 0z" />
                </svg>
              </button>
            </div>
          ) : (
            <button
              onClick={() => { void onEnsureAuth(); }}
              className="w-full py-2 rounded-lg bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-colors"
            >
              Verify wallet to chat (one-time signature)
            </button>
          )
        ) : (
          <div className="text-center text-xs text-slate-600 py-1">Connect wallet to chat</div>
        )}
      </div>

      {/* Profile overlay */}
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
