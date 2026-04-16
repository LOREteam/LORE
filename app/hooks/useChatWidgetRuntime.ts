"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChatAuth } from "./useChatAuth";
import { useChat } from "./useChat";
import { useChatProfile } from "./useChatProfile";

interface UseChatWidgetRuntimeOptions {
  walletAddress: string | null;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
}

export function useChatWidgetRuntime({
  walletAddress,
  onOpenChange,
  open: controlledOpen,
}: UseChatWidgetRuntimeOptions) {
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [portalReady, setPortalReady] = useState(false);
  const [mountTarget, setMountTarget] = useState<HTMLElement | null>(null);
  const lastReadOthersRef = useRef(0);
  const initializedRef = useRef(false);
  const chatAuth = useChatAuth(walletAddress, "Verify wallet for chat");
  const open = controlledOpen ?? uncontrolledOpen;

  const { messages, sendMessage, connected, authReady, ensureChatAuth, sendCooldownRemainingMs, isSending } = useChat(walletAddress, { open, auth: chatAuth });
  const { profile, displayName, effectiveAvatar, updateProfile } = useChatProfile(walletAddress, chatAuth);

  const myAddr = walletAddress?.toLowerCase() ?? "";
  const othersCount = useMemo(
    () => messages.filter((message) => message.sender.toLowerCase() !== myAddr).length,
    [messages, myAddr],
  );

  useEffect(() => {
    setPortalReady(true);
  }, []);

  useEffect(() => {
    if (!portalReady || !open) {
      setMountTarget((current) => (current === null ? current : null));
      return;
    }

    const nextTarget = document.getElementById("chat-panel-slot") ?? document.body;
    setMountTarget((current) => (current === nextTarget ? current : nextTarget));
  }, [open, portalReady]);

  useEffect(() => {
    if (open) {
      setUnread(0);
      lastReadOthersRef.current = othersCount;
      initializedRef.current = true;
      return;
    }
    if (!initializedRef.current) {
      initializedRef.current = true;
      lastReadOthersRef.current = othersCount;
      return;
    }
    if (lastReadOthersRef.current === 0 && othersCount > 0) {
      lastReadOthersRef.current = othersCount;
      return;
    }
    const newFromOthers = othersCount - lastReadOthersRef.current;
    if (newFromOthers > 0) setUnread((count) => count + newFromOthers);
    lastReadOthersRef.current = othersCount;
  }, [othersCount, open]);

  const handleToggle = useCallback(() => {
    const next = !open;
    setUncontrolledOpen(next);
    onOpenChange?.(next);
    if (next) setUnread(0);
  }, [onOpenChange, open]);

  const handleClose = useCallback(() => {
    setUncontrolledOpen(false);
    onOpenChange?.(false);
  }, [onOpenChange]);

  const handleSend = useCallback(
    (text: string, name: string | null, avatar: string | null) => {
      return sendMessage(text, name, avatar ?? effectiveAvatar);
    },
    [effectiveAvatar, sendMessage],
  );

  return useMemo(
    () => ({
      open,
      unread,
      portalReady,
      mountTarget,
      messages,
      walletAddress,
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
    }),
    [
      authReady,
      connected,
      displayName,
      ensureChatAuth,
      handleClose,
      handleSend,
      handleToggle,
      isSending,
      messages,
      mountTarget,
      open,
      portalReady,
      profile,
      sendCooldownRemainingMs,
      unread,
      updateProfile,
      walletAddress,
    ],
  );
}
