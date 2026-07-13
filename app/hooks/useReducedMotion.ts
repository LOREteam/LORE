"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "lore:reduced-motion";

function readPreferredReducedMotion() {
  if (typeof window === "undefined") return { explicit: false, reduced: false };

  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "true") return { explicit: true, reduced: true };
    if (stored === "false") return { explicit: true, reduced: false };
  } catch {
    // Ignore storage errors.
  }

  return {
    explicit: false,
    reduced: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  };
}

export function useReducedMotion() {
  // Keep the first SSR and client render identical; load the real preference after mount.
  const [reducedMotion, setReducedMotionState] = useState(false);
  const [motionReady, setMotionReady] = useState(false);
  const explicitPreferenceRef = useRef(false);

  useEffect(() => {
    const preference = readPreferredReducedMotion();
    explicitPreferenceRef.current = preference.explicit;
    setReducedMotionState(preference.reduced);
    setMotionReady(true);

    if (preference.explicit) return;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleChange = (event: MediaQueryListEvent) => {
      if (!explicitPreferenceRef.current) setReducedMotionState(event.matches);
    };
    media.addEventListener("change", handleChange);
    return () => media.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    if (!motionReady || !explicitPreferenceRef.current) return;

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
    explicitPreferenceRef.current = true;
    setMotionReady(true);
    setReducedMotionState(enabled);
  }, []);

  return { reducedMotion, setReducedMotion, motionReady };
}
