"use client";

import { useEffect } from "react";
import { log } from "./lib/logger";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    log.error("ErrorBoundary", "route render error", {
      name: error.name,
      message: error.message,
      digest: error.digest,
      stack: error.stack?.slice(0, 400),
    });
  }, [error]);

  const handleHardReload = () => {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("_r", Date.now().toString());
      window.location.replace(url.toString());
    } catch {
      window.location.reload();
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0a0612] px-6">
      <div className="max-w-md w-full text-center">
        <div className="text-6xl mb-4 opacity-40">⚠</div>
        <h1 className="text-xl font-bold uppercase tracking-wider text-white mb-2">
          The Lattice flickered
        </h1>
        <p className="text-sm text-gray-300 mb-6 leading-relaxed">
          Something disrupted the rendering of this view. Your funds are safe on-chain.
        </p>
        {error.digest && (
          <p className="text-[10px] font-mono text-gray-500 mb-4">
            ref: {error.digest}
          </p>
        )}
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={reset}
            className="w-full rounded-md border border-violet-500/40 bg-violet-500/10 px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-violet-200 hover:bg-violet-500/20 transition-colors"
          >
            Try again
          </button>
          <button
            type="button"
            onClick={handleHardReload}
            className="w-full rounded-md border border-white/10 bg-white/[0.03] px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-gray-300 hover:bg-white/[0.06] transition-colors"
          >
            Hard reload
          </button>
        </div>
      </div>
    </div>
  );
}
