"use client";

import React, { memo } from "react";
import type { ChatMessage as ChatMessageType } from "../../hooks/useChat";
import { ChatAvatar, type AvatarId } from "./chatAvatars";

interface Props {
  message: ChatMessageType;
  isOwn: boolean;
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function shortenAddr(addr: string): string {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function isDataUrl(s: string | null): boolean {
  return !!s && s.startsWith("data:");
}

export const ChatMessageRow = memo(function ChatMessageRow({ message, isOwn }: Props) {
  const name = message.senderName || shortenAddr(message.sender);
  const ts = typeof message.timestamp === "number" ? formatTimestamp(message.timestamp) : "";

  const avatarStr = message.senderAvatar;
  const customSrc = isDataUrl(avatarStr) ? avatarStr : null;
  const avatarId = customSrc ? null : (avatarStr as AvatarId | null);

  return (
    <div className={`flex gap-2 px-3 py-1.5 ${isOwn ? "flex-row-reverse" : ""}`}>
      <ChatAvatar
        avatarId={avatarId}
        customSrc={customSrc}
        walletAddress={message.sender}
        size={28}
        className="shrink-0 mt-0.5"
      />
      <div className={`min-w-0 max-w-[80%] ${isOwn ? "items-end" : ""}`}>
        <div className={`flex items-baseline gap-1.5 text-[10px] mb-0.5 ${isOwn ? "flex-row-reverse" : ""}`}>
          <span className={`font-medium truncate ${isOwn ? "text-violet-400" : "text-slate-400"}`}>
            {name}
          </span>
          {ts && <span className="text-slate-600 tabular-nums">{ts}</span>}
        </div>
        <div
          className={`text-[13px] leading-snug px-2.5 py-1.5 rounded-xl break-words ${
            isOwn
              ? "bg-violet-600/30 text-violet-100 rounded-tr-sm"
              : "bg-white/[0.06] text-slate-300 rounded-tl-sm"
          }`}
        >
          {message.text}
        </div>
      </div>
    </div>
  );
});
