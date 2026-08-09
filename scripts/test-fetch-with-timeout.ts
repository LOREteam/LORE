import assert from "node:assert/strict";
import { fetchWithTimeout } from "../app/lib/fetchWithTimeout";
import { redactProofText } from "./redact-proof-output.mjs";

const originalFetch = globalThis.fetch;
const MAX_FETCH_TIMEOUT_TEST_ERROR_CHARS = 500;

function describeFetchTimeoutTestError(error: unknown) {
  const text = redactProofText(error instanceof Error ? error.message : String(error))
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= MAX_FETCH_TIMEOUT_TEST_ERROR_CHARS) return text;
  return `${text.slice(0, MAX_FETCH_TIMEOUT_TEST_ERROR_CHARS - 15)}...<truncated>`;
}

async function main() {
try {
  globalThis.fetch = async (_input, init) => {
    assert.ok(init?.signal instanceof AbortSignal);
    return new Response("ok", { status: 200 });
  };
  const response = await fetchWithTimeout("http://localhost/test", {}, 100);
  assert.equal(response.status, 200);

  const cleanupController = new AbortController();
  const originalAddAbortListener = cleanupController.signal.addEventListener.bind(cleanupController.signal);
  const originalRemoveAbortListener = cleanupController.signal.removeEventListener.bind(cleanupController.signal);
  let callerAbortListeners = 0;
  cleanupController.signal.addEventListener = ((
    type: Parameters<AbortSignal["addEventListener"]>[0],
    listener: Parameters<AbortSignal["addEventListener"]>[1],
    options?: Parameters<AbortSignal["addEventListener"]>[2],
  ) => {
    if (type === "abort") callerAbortListeners += 1;
    return originalAddAbortListener(type, listener, options);
  }) as AbortSignal["addEventListener"];
  cleanupController.signal.removeEventListener = ((
    type: Parameters<AbortSignal["removeEventListener"]>[0],
    listener: Parameters<AbortSignal["removeEventListener"]>[1],
    options?: Parameters<AbortSignal["removeEventListener"]>[2],
  ) => {
    if (type === "abort") callerAbortListeners -= 1;
    return originalRemoveAbortListener(type, listener, options);
  }) as AbortSignal["removeEventListener"];
  await fetchWithTimeout("http://localhost/cleanup", { signal: cleanupController.signal }, 100);
  assert.equal(callerAbortListeners, 0, "fetchWithTimeout must remove caller abort listeners after success");
  await fetchWithTimeout("http://localhost/max", {}, 120_000);

  globalThis.fetch = (_input, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  });
  await assert.rejects(
    fetchWithTimeout("http://localhost/timeout", {}, 20),
    (error: unknown) => error instanceof DOMException && error.name === "TimeoutError",
  );

  const callerController = new AbortController();
  const callerRequest = fetchWithTimeout(
    "http://localhost/abort",
    { signal: callerController.signal },
    1_000,
  );
  callerController.abort(new DOMException("caller stopped", "AbortError"));
  await assert.rejects(
    callerRequest,
    (error: unknown) => error instanceof DOMException && error.name === "AbortError",
  );

  await assert.rejects(
    fetchWithTimeout("http://localhost/invalid", {}, 0),
    (error: unknown) => error instanceof RangeError,
  );
  for (const invalidTimeoutMs of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 120_001, 2_147_483_648, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(
      fetchWithTimeout("http://localhost/invalid", {}, invalidTimeoutMs),
      (error: unknown) => error instanceof RangeError,
      `fetchWithTimeout must reject invalid timeout ${String(invalidTimeoutMs)}`,
    );
  }

  console.log("fetchWithTimeout tests passed");
} finally {
  globalThis.fetch = originalFetch;
}
}

void main().catch((error) => {
  console.error(describeFetchTimeoutTestError(error));
  process.exitCode = 1;
});
