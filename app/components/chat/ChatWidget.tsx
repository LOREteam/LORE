"use client";

import React from "react";
import { createPortal } from "react-dom";
import { useChatWidgetRuntime } from "../../hooks/useChatWidgetRuntime";
import { ChatToggleButton, ChatWindow } from "./ChatWindow";

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

      <ChatToggleButton open={open} unread={unread} onToggle={handleToggle} />
    </>
  );
});
