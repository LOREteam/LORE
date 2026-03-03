"use client";

import { useEffect } from "react";
import { log } from "../lib/logger";

const RESOLVE_STORAGE_KEY = "lore_resolve_epoch";

export function ErrorCatcher() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      log.error("Global", e.message, { filename: e.filename, lineno: e.lineno, colno: e.colno });
    };
    const onUnhandledRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason;
      const reasonMessage =
        reason instanceof Error
          ? reason.message
          : typeof reason === "string"
            ? reason
            : "";
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

      // Referral claim estimate can fail in provider middleware (84ae48b5 selector).
      // We handle this in referral hook with explicit gas, but keep this guard to avoid noisy dev overlay.
      const isReferralClaimEstimateError =
        reasonMessage.includes("84ae48b5") &&
        reasonMessage.toLowerCase().includes("estimategasexecutionerror");
      if (isReferralClaimEstimateError) {
        e.preventDefault();
        log.warn("Global", "referral claim estimate reverted", { message: reasonMessage.slice(0, 160) });
        return;
      }

      const payload = reason instanceof Error
        ? { name: reason.name, message: reason.message, stack: reason.stack?.slice(0, 400) }
        : String(reason);
      log.error("Global", "unhandled promise rejection", payload);
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  return null;
}
