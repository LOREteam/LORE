"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useChat } from "./useChat";
import { useChatProfile } from "./useChatProfile";

interface UseChatWidgetRuntimeOptions {
  walletAddress: string | null;
  onOpenChange?: (open: boolean) => void;
}

export function useChatWidgetRuntime({
  walletAddress,
  onOpenChange,
}: UseChatWidgetRuntimeOptions) {
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [portalReady, setPortalReady] = useState(false);
  const [mountTarget, setMountTarget] = useState<HTMLElement | null>(null);
  const lastReadOthersRef = useRef(0);
  const initializedRef = useRef(false);

  const { messages, sendMessage, connected, authReady, ensureChatAuth } = useChat(walletAddress, { open });
  const { profile, displayName, effectiveAvatar, updateProfile } = useChatProfile(walletAddress);

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
      setMountTarget(null);
      return;
    }

    const slot = document.getElementById("chat-panel-slot");
    setMountTarget(slot ?? document.body);
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
    setOpen(next);
    onOpenChange?.(next);
    if (next) setUnread(0);
  }, [onOpenChange, open]);

  const handleClose = useCallback(() => {
    setOpen(false);
    onOpenChange?.(false);
  }, [onOpenChange]);

  const handleSend = useCallback(
    (text: string, name: string | null, avatar: string | null) => {
      sendMessage(text, name, avatar ?? effectiveAvatar);
    },
    [effectiveAvatar, sendMessage],
  );

  return {
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
    updateProfile,
    handleToggle,
    handleClose,
    handleSend,
  };
}
