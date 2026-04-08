"use client";

import React from "react";
import { createPortal } from "react-dom";
import { useChatWidgetRuntime } from "../../hooks/useChatWidgetRuntime";
import { ChatWindow } from "./ChatWindow";

interface Props {
  walletAddress: string | null;
  onOpenChange?: (open: boolean) => void;
}

export function ChatWidget({ walletAddress, onOpenChange }: Props) {
  const {
    open,
    unread,
    portalReady,
    mountTarget,
    messages,
    profile,
    displayName,
    connected,
    authReady,
    ensureChatAuth,
    updateProfile,
    handleToggle,
    handleClose,
    handleSend,
  } = useChatWidgetRuntime({ walletAddress, onOpenChange });

  return (
    <>
      {open && portalReady && mountTarget && createPortal(
        <ChatWindow
          messages={messages}
          walletAddress={walletAddress}
          profile={profile}
          displayName={displayName}
          connected={connected}
          authReady={authReady}
          onEnsureAuth={ensureChatAuth}
          onSend={handleSend}
          onUpdateProfile={updateProfile}
          onClose={handleClose}
          variant={mountTarget.id === "chat-panel-slot" ? "embedded" : "floating"}
        />,
        mountTarget,
      )}

      {/* Chat toggle button (positioned by parent floating container) */}
      <button
        onClick={handleToggle}
        className="w-11 h-11 rounded-full bg-violet-600 hover:bg-violet-500 shadow-lg shadow-violet-500/20 flex items-center justify-center transition-all duration-200 hover:scale-105 active:scale-95 animate-fade-in shrink-0 relative focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070712]"
        aria-label={open ? "Close chat" : "Open chat"}
        title={open ? "Close chat" : "Open chat"}
      >
        {open ? (
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round">
            <line x1="5" y1="5" x2="15" y2="15" />
            <line x1="15" y1="5" x2="5" y2="15" />
          </svg>
        ) : (
          <svg width="16" height="16" viewBox="0 0 20 20" fill="white">
            <path d="M3 3h14a1 1 0 011 1v9a1 1 0 01-1 1h-4l-3 3-3-3H3a1 1 0 01-1-1V4a1 1 0 011-1zm2 3h10v1.5H5V6zm0 3h7v1.5H5V9z" />
          </svg>
        )}

        {!open && unread > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-1 animate-slide-up">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
    </>
  );
}
