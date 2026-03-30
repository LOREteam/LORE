"use client";

import React, { memo } from "react";
import type { ChatMessage as ChatMessageType } from "../../hooks/useChat";
import { ChatAvatar, type AvatarId } from "./chatAvatars";
import { isSupportedChatAvatarDataUrl } from "../../lib/chatAvatar";

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

export const ChatMessageRow = memo(function ChatMessageRow({ message, isOwn }: Props) {
  const name = message.senderName || shortenAddr(message.sender);
  const ts = typeof message.timestamp === "number" ? formatTimestamp(message.timestamp) : "";

  const avatarStr = message.senderAvatar;
  const customSrc = isSupportedChatAvatarDataUrl(avatarStr) ? avatarStr : null;
  const avatarId = customSrc ? null : (avatarStr as AvatarId | null);

  return (
    <div className={`flex gap-2.5 px-3 py-2 ${isOwn ? "flex-row-reverse" : ""}`}>
      <ChatAvatar
        avatarId={avatarId}
        customSrc={customSrc}
        walletAddress={message.sender}
        size={28}
        className="shrink-0 mt-0.5"
      />
      <div className={`min-w-0 max-w-[82%] ${isOwn ? "items-end" : ""}`}>
        <div className={`mb-1 flex items-baseline gap-1.5 text-[10px] ${isOwn ? "flex-row-reverse" : ""}`}>
          <span className={`font-medium truncate ${isOwn ? "text-violet-400" : "text-slate-400"}`}>
            {name}
          </span>
          {ts && <span className="text-slate-600 tabular-nums">{ts}</span>}
        </div>
        <div
          className={`break-words rounded-2xl px-3 py-2 text-[13px] leading-snug shadow-[inset_0_1px_0_rgba(255,255,255,0.02)] ${
            isOwn
              ? "rounded-tr-md bg-violet-600/28 text-violet-100"
              : "rounded-tl-md border border-white/[0.04] bg-white/[0.045] text-slate-300"
          }`}
        >
          {message.text}
        </div>
      </div>
    </div>
  );
});
