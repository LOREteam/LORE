"use client";

import { useEffect, useState } from "react";

export function usePageVisibility(initialValue = true) {
  const [isPageVisible, setIsPageVisible] = useState(initialValue);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibility = () => setIsPageVisible(document.visibilityState === "visible");
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  return isPageVisible;
}
