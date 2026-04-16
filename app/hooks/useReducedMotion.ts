"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "lore:reduced-motion";

function readPreferredReducedMotion() {
  if (typeof window === "undefined") return false;

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "true") return true;
    if (stored === "false") return false;
  } catch {
    // Ignore storage errors and fall back to system preference.
  }

  return window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ?? false;
}

export function useReducedMotion() {
  // Keep the first SSR and client render identical; load the real preference after mount.
  const [reducedMotion, setReducedMotionState] = useState(false);
  const [motionReady, setMotionReady] = useState(false);

  useEffect(() => {
    setReducedMotionState(readPreferredReducedMotion());
    setMotionReady(true);
  }, []);

  useEffect(() => {
    if (!motionReady) return;

    try {
      localStorage.setItem(STORAGE_KEY, String(reducedMotion));
    } catch {
      // Ignore storage errors.
    }
  }, [reducedMotion, motionReady]);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const root = document.documentElement;
    if (reducedMotion) root.setAttribute("data-motion", "reduced");
    else root.removeAttribute("data-motion");

    return () => {
      if (reducedMotion) root.removeAttribute("data-motion");
    };
  }, [reducedMotion]);

  const setReducedMotion = useCallback((enabled: boolean) => {
    setMotionReady(true);
    setReducedMotionState(enabled);
  }, []);

  return { reducedMotion, setReducedMotion, motionReady };
}
