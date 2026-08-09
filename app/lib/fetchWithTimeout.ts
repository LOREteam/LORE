const DEFAULT_FETCH_TIMEOUT_MS = 12_000;
const MAX_FETCH_TIMEOUT_MS = 120_000;

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException("The request was aborted", "AbortError");
}

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
): Promise<Response> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_FETCH_TIMEOUT_MS) {
    throw new RangeError("fetch timeout must be between 1 and 120000 milliseconds");
  }

  const controller = new AbortController();
  const callerSignal = init.signal;
  const abortFromCaller = () => controller.abort(abortReason(callerSignal!));

  if (callerSignal?.aborted) {
    abortFromCaller();
  } else {
    callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
  }

  const timeoutId = setTimeout(() => {
    controller.abort(new DOMException(`Request timed out after ${timeoutMs}ms`, "TimeoutError"));
  }, timeoutMs);

  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
    callerSignal?.removeEventListener("abort", abortFromCaller);
  }
}
