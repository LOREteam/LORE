"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export function useEmbeddedWalletUi(embeddedWalletAddress: string | null) {
  const [embeddedAddressCopied, setEmbeddedAddressCopied] = useState(false);
  const mountedRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!embeddedAddressCopied) return;
    const timeoutId = window.setTimeout(() => setEmbeddedAddressCopied(false), 1600);
    return () => window.clearTimeout(timeoutId);
  }, [embeddedAddressCopied]);

  const handleCopyEmbeddedAddress = useCallback(async () => {
    if (!embeddedWalletAddress) return;
    try {
      await navigator.clipboard.writeText(embeddedWalletAddress);
      if (mountedRef.current) {
        setEmbeddedAddressCopied(true);
      }
    } catch {
      // Ignore clipboard denials so the modal does not throw in unsupported contexts.
    }
  }, [embeddedWalletAddress]);

  return {
    embeddedAddressCopied,
    handleCopyEmbeddedAddress,
  };
}
