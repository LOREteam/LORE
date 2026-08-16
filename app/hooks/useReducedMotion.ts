"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  REDUCED_MOTION_CHANGE_EVENT,
  REDUCED_MOTION_STORAGE_KEY,
  readReducedMotionPreference,
  subscribeToReducedMotionPreference,
  subscribeToSystemReducedMotion,
} from "../lib/reducedMotionRuntime";

export function useReducedMotion() {
  // Keep the first SSR and client render identical; load the real preference after mount.
  const [reducedMotion, setReducedMotionState] = useState(false);
  const [motionReady, setMotionReady] = useState(false);
  const explicitPreferenceRef = useRef(false);
  const unsubscribeSystemPreferenceRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const preference = readReducedMotionPreference({ storage: window.localStorage, media });
    explicitPreferenceRef.current = preference.explicit;
    setReducedMotionState(preference.reduced);
    setMotionReady(true);

    const unsubscribeExplicitPreference = subscribeToReducedMotionPreference(window, (reduced) => {
      explicitPreferenceRef.current = true;
      unsubscribeSystemPreferenceRef.current?.();
      unsubscribeSystemPreferenceRef.current = null;
      setReducedMotionState(reduced);
      setMotionReady(true);
    });
    if (!preference.explicit) {
      unsubscribeSystemPreferenceRef.current = subscribeToSystemReducedMotion(
        media,
        () => explicitPreferenceRef.current,
        setReducedMotionState,
      );
    }
    return () => {
      unsubscribeSystemPreferenceRef.current?.();
      unsubscribeSystemPreferenceRef.current = null;
      unsubscribeExplicitPreference();
    };
  }, []);

  useEffect(() => {
    if (!motionReady || !explicitPreferenceRef.current) return;

    try {
      localStorage.setItem(REDUCED_MOTION_STORAGE_KEY, String(reducedMotion));
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
    explicitPreferenceRef.current = true;
    unsubscribeSystemPreferenceRef.current?.();
    unsubscribeSystemPreferenceRef.current = null;
    setMotionReady(true);
    setReducedMotionState(enabled);
    window.dispatchEvent(new CustomEvent(REDUCED_MOTION_CHANGE_EVENT, { detail: enabled }));
  }, []);

  return { reducedMotion, setReducedMotion, motionReady };
}
