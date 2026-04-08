(() => {
  if (typeof BigInt !== "undefined" && typeof BigInt.prototype.toJSON !== "function") {
    Object.defineProperty(BigInt.prototype, "toJSON", {
      value() {
        return this.toString();
      },
      configurable: true,
      writable: true,
    });
  }

  const STORAGE_KEY = "lore:chunk-reload-once";
  const WINDOW_MS = 15_000;

  const isChunkLoadMessage = (value) => {
    const message = String(value || "").toLowerCase();
    return message.includes("chunkloaderror")
      || (message.includes("loading chunk") && message.includes("/_next/static/chunks/"))
      || (message.includes("loading chunk") && message.includes("failed"));
  };

  const hasRecentRetry = () => {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const lastAt = Number(raw);
      return Number.isFinite(lastAt) && Date.now() - lastAt < WINDOW_MS;
    } catch {
      return false;
    }
  };

  const reloadOnce = () => {
    try {
      if (hasRecentRetry()) return false;
      sessionStorage.setItem(STORAGE_KEY, Date.now().toString());
    } catch {}

    try {
      const url = new URL(window.location.href);
      url.searchParams.set("_r", Date.now().toString());
      window.location.replace(url.toString());
    } catch {
      window.location.reload();
    }
    return true;
  };

  window.addEventListener("pageshow", () => {
    window.setTimeout(() => {
      try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const lastAt = Number(raw);
        if (!Number.isFinite(lastAt) || Date.now() - lastAt >= WINDOW_MS) {
          sessionStorage.removeItem(STORAGE_KEY);
        }
      } catch {}
    }, WINDOW_MS);
  });

  window.addEventListener("error", (event) => {
    const message = event?.error?.message || event?.message || "";
    if (!isChunkLoadMessage(message)) return;
    if (reloadOnce()) {
      event.preventDefault?.();
    }
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event?.reason;
    const message =
      reason instanceof Error
        ? `${reason.name}: ${reason.message}`
        : typeof reason === "string"
          ? reason
          : "";
    if (!isChunkLoadMessage(message)) return;
    if (reloadOnce()) {
      event.preventDefault?.();
    }
  });
})();
