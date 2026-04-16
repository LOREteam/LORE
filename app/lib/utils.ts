/** Sleep for a given number of milliseconds */
export const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Normalize decimal separators (comma -> dot) for numeric input */
export const normalizeDecimalInput = (value: string): string => value.replace(/,/g, ".");

/**
 * Validate a bet-amount string before passing it to parseUnits.
 * Returns null if valid (caller proceeds), or an error message string.
 * Guards against: NaN, Infinity, exponential notation (e.g. 1e300), negative, zero.
 */
export function validateBetAmount(raw: string): string | null {
  const normalized = normalizeDecimalInput(raw.trim());
  if (!normalized) return "Enter an amount";
  // Reject exponential notation — parseUnits doesn't support it and Number("1e300") = Infinity
  if (/e/i.test(normalized)) return "Invalid amount";
  const n = Number(normalized);
  if (!Number.isFinite(n)) return "Invalid amount";
  if (Number.isNaN(n)) return "Invalid amount";
  if (n <= 0) return "Amount must be greater than 0";
  return null;
}

/** Format seconds as MM:SS */
export const formatTime = (seconds: number): string => {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
};

/** Truncate an Ethereum address for display */
export const shortenAddress = (address: string): string =>
  `${address.slice(0, 6)}...${address.slice(-4)}`;

/** Parse a numeric string safely, returning 0 on failure or non-finite result (NaN, Infinity) */
export const safeParseFloat = (value: string): number => {
  const n = parseFloat(normalizeDecimalInput(value));
  return Number.isFinite(n) ? n : 0;
};

/**
 * Safe toFixed: if value is NaN, Infinity, or not finite, returns the fallback string.
 * Prevents "NaN LINEA" or "Infinity LINEA" from rendering in the UI.
 */
export const safeToFixed = (value: number, decimals: number, fallback = "0.00"): string => {
  if (!Number.isFinite(value)) return fallback;
  return value.toFixed(decimals);
};

/** Race a promise against a timeout. Rejects with a named error on timeout. */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  let timerId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timerId = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  // Prevent unhandled rejection noise when timeout wins the race.
  const guarded = promise.catch((err) => { throw err; });
  return Promise.race([guarded, timeoutPromise]).finally(() => {
    if (timerId !== null) { clearTimeout(timerId); timerId = null; }
  });
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
