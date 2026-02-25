"use client";

import { useState, useEffect } from "react";

export function OfflineBanner() {
  // Start as null so server and client first paint match (no navigator on server).
  // After mount, set from navigator.onLine to avoid hydration mismatch.
  const [isOnline, setIsOnline] = useState<boolean | null>(null);

  useEffect(() => {
    setIsOnline(navigator.onLine);
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  if (isOnline === null || isOnline) return null;

  return (
    <div
      className="sticky top-0 z-50 w-full px-3 py-2 text-center text-xs font-bold uppercase tracking-wider bg-amber-500/20 text-amber-400 border-b border-amber-500/40"
      role="status"
    >
      No internet connection. Data may be outdated.
    </div>
  );
}
