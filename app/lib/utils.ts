/** Sleep for a given number of milliseconds */
export const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Normalize decimal separators (comma -> dot) for numeric input */
export const normalizeDecimalInput = (value: string): string => value.replace(/,/g, ".");

/** Format seconds as MM:SS */
export const formatTime = (seconds: number): string => {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
};

/** Truncate an Ethereum address for display */
export const shortenAddress = (address: string): string =>
  `${address.slice(0, 6)}...${address.slice(-4)}`;

/** Parse a numeric string safely, returning 0 on failure */
export const safeParseFloat = (value: string): number => {
  const n = parseFloat(normalizeDecimalInput(value));
  return isNaN(n) ? 0 : n;
};

/** Race a promise against a timeout. Rejects with a named error on timeout. */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  const guarded = promise.catch((err) => {
    // Prevent unhandled rejection noise when timeout wins the race.
    throw err;
  });
  return Promise.race([
    guarded,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

/** Format an unknown caught error into a single-line diagnostic string. */
export function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    const parts = [error.message];
    const named = error.name && error.name !== "Error" ? error.name : null;
    if (named && !parts.some((part) => part.includes(named))) {
      parts.unshift(named);
    }
    const maybeStatus = (error as Error & { status?: unknown }).status;
    if (
      (typeof maybeStatus === "number" || typeof maybeStatus === "string") &&
      !parts.some((part) => part.includes(`Status:`))
    ) {
      parts.push(`Status: ${String(maybeStatus)}`);
    }
    const maybeCode = (error as Error & { code?: unknown }).code;
    if ((typeof maybeCode === "number" || typeof maybeCode === "string") && !parts.some((part) => part.includes(`Code:`))) {
      parts.push(`Code: ${String(maybeCode)}`);
    }
    const maybeDetails = (error as Error & { details?: unknown }).details;
    if (typeof maybeDetails === "string" && maybeDetails && !parts.includes(maybeDetails)) {
      parts.push(`Details: ${maybeDetails}`);
    }
    const maybeData = (error as Error & { data?: unknown }).data;
    if (maybeData !== undefined) {
      try {
        const serializedData = JSON.stringify(maybeData);
        if (serializedData && serializedData !== "{}" && !parts.includes(serializedData)) {
          parts.push(`Data: ${serializedData}`);
        }
      } catch { /* ignore serialization failures */ }
    }
    const cause = (error as Error & { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message && !parts.includes(cause.message)) {
      parts.push(`Cause: ${cause.message}`);
    } else if (typeof cause === "string" && cause && !parts.includes(cause)) {
      parts.push(`Cause: ${cause}`);
    }
    return parts.join(" | ");
  }
  return String(error);
}

/** Check if an error was a user rejection (MetaMask, WalletConnect, Coinbase, etc.) */
export const isUserRejection = (err: unknown): boolean => {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    msg.includes("user rejected") ||
    msg.includes("user denied") ||
    msg.includes("rejected by user") ||
    msg.includes("user cancelled") ||
    msg.includes("user canceled") ||
    msg.includes("action_rejected") ||
    msg.includes("request rejected")
  );
};
