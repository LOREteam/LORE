"use client";

import { useEffect } from "react";
import { log } from "../lib/logger";
import {
  CHUNK_RELOAD_WINDOW_MS,
  clearExpiredChunkReloadAttempt,
  isChunkLoadLikeErrorMessage,
  reloadWithCacheBust,
  shouldAttemptChunkReloadOnce,
} from "../lib/chunkReloadRecovery";

const RESOLVE_STORAGE_KEY = "lore_resolve_epoch";

export function ErrorCatcher() {
  useEffect(() => {
    const sanitizeConsoleArg = (value: unknown): unknown => {
      if (value instanceof Error) {
        return {
          name: value.name,
          message: value.message,
          stack: value.stack?.slice(0, 400),
        };
      }
      if (typeof value === "bigint") {
        return value.toString();
      }
      if (typeof value === "object" && value !== null) {
        try {
          return JSON.parse(
            JSON.stringify(value, (_key, current) =>
              typeof current === "bigint" ? current.toString() : current,
            ),
          );
        } catch {
          return String(value);
        }
      }
      return value;
    };

    const stringifySafe = (value: unknown) => {
      try {
        return JSON.stringify(value, (_key, current) => (typeof current === "bigint" ? current.toString() : current));
      } catch {
        return String(value);
      }
    };

    const isBenignConsoleWarning = (args: unknown[]): boolean => {
      const first = args[0];
      const msg = typeof first === "string" ? first : "";
      if (msg.includes("Error checking Cross-Origin-Opener-Policy")) {
        // Coinbase Wallet SDK occasionally emits this in dev; benign for app flow.
        return true;
      }
      if (msg.includes('Each child in a list should have a unique "key" prop.')) {
        const serialized = args
          .map((arg) => (typeof arg === "string" ? arg : ""))
          .join(" ");
        if (serialized.includes("passed a child from Me")) {
          // Privy currently emits this warning internally under React 19 in dev.
          return true;
        }
      }
      return false;
    };

    const tryRecoverChunkLoad = (message: string): boolean => {
      if (!isChunkLoadLikeErrorMessage(message)) return false;
      const canReload = shouldAttemptChunkReloadOnce(
        typeof sessionStorage !== "undefined" ? sessionStorage : null,
      );
      if (!canReload) return false;

      log.warn("Global", "chunk load failed, reloading page once", { message: message.slice(0, 180) });
      reloadWithCacheBust(window.location);
      return true;
    };

    const originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      if (isBenignConsoleWarning(args)) {
        return;
      }
      originalConsoleError(...args.map(sanitizeConsoleArg));
    };

    const onError = (e: ErrorEvent) => {
      const reasonMessage =
        (e.error instanceof Error ? e.error.message : "") ||
        e.message ||
        "";
      if (reasonMessage && tryRecoverChunkLoad(reasonMessage)) {
        e.preventDefault();
        return;
      }
      log.error("Global", e.message, { filename: e.filename, lineno: e.lineno, colno: e.colno });
    };
    const onUnhandledRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason;
      const reasonMessage =
        reason instanceof Error
          ? `${reason.name}: ${reason.message}`
          : typeof reason === "string"
            ? reason
            : stringifySafe(reason);
      if (reasonMessage && tryRecoverChunkLoad(reasonMessage)) {
        e.preventDefault();
        return;
      }
      const isResolveRevert =
        reason instanceof Error &&
        (reason.name === "EstimateGasExecutionError" || reason.message?.includes("execution reverted")) &&
        (reason.message?.includes("9c407b6e") || reason.message?.includes("resolveEpoch") ||
         reason.message?.includes("TimerNotEnded") || reason.message?.includes("CanOnlyResolveCurrent"));
      if (isResolveRevert && typeof localStorage !== "undefined") {
        try {
          localStorage.removeItem(RESOLVE_STORAGE_KEY);
        } catch { /* ignore */ }
        e.preventDefault();
        log.warn("Global", "resolve estimate reverted (cleared lock)", { message: reason.message?.slice(0, 120) });
        return;
      }

      const payload = reason instanceof Error
        ? { name: reason.name, message: reason.message, stack: reason.stack?.slice(0, 400) }
        : String(reason);
      log.error("Global", "unhandled promise rejection", payload);
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);

    const cleanupId = window.setTimeout(() => {
      clearExpiredChunkReloadAttempt(typeof sessionStorage !== "undefined" ? sessionStorage : null);
    }, CHUNK_RELOAD_WINDOW_MS);

    return () => {
      window.clearTimeout(cleanupId);
      console.error = originalConsoleError;
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  return null;
}
