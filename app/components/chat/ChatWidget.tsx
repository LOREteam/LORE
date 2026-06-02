"use client";

import React from "react";
import { createPortal } from "react-dom";
import { useChatWidgetRuntime } from "../../hooks/useChatWidgetRuntime";
import { ChatWindow } from "./ChatWindow";

interface Props {
  walletAddress: string | null;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
}

export const ChatWidget = React.memo(function ChatWidget({ walletAddress, onOpenChange, open: controlledOpen }: Props) {
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
    sendCooldownRemainingMs,
    isSending,
    updateProfile,
    handleToggle,
    handleClose,
    handleSend,
  } = useChatWidgetRuntime({ walletAddress, onOpenChange, open: controlledOpen });

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
          sendCooldownRemainingMs={sendCooldownRemainingMs}
          isSending={isSending}
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
        className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-violet-600 shadow-lg shadow-violet-500/20 transition-all duration-200 hover:scale-105 hover:bg-violet-500 active:scale-95 focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070712] sm:h-11 sm:w-11"
        aria-label={open ? "Close chat" : "Open chat"}
        title={open ? "Close chat" : "Open chat"}
      >
        {open ? (
          /* Close — rounded X */
          <svg aria-hidden="true" className="h-3.5 w-3.5 sm:h-4 sm:w-4" viewBox="0 0 16 16" fill="none">
            <path d="M4 4l8 8M12 4l-8 8" stroke="white" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        ) : (
          /* Chat bubble with three dots */
          <svg aria-hidden="true" className="h-3.5 w-3.5 sm:h-[18px] sm:w-[19px]" viewBox="0 0 19 18" fill="none">
            <path
              d="M1.5 2.75C1.5 1.784 2.284 1 3.25 1h12.5C16.716 1 17.5 1.784 17.5 2.75v8.5c0 .966-.784 1.75-1.75 1.75H11l-1.5 2.5L8 13H3.25C2.284 13 1.5 12.216 1.5 11.25v-8.5z"
              fill="white"
              opacity="0.95"
            />
            <circle cx="6.25" cy="7" r="1.15" fill="#0a0a1c"/>
            <circle cx="9.5"  cy="7" r="1.15" fill="#0a0a1c"/>
            <circle cx="12.75" cy="7" r="1.15" fill="#0a0a1c"/>
          </svg>
        )}

        {!open && unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-red-500 px-1 text-[8px] font-bold text-white sm:h-4.5 sm:min-w-4.5 sm:text-[10px]">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
    </>
  );
});
