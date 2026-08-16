import assert from "node:assert/strict";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { fetchWithTimeout } from "../app/lib/fetchWithTimeout";
import { redactProofText } from "./redact-proof-output.mjs";

const MAX_FETCH_TIMEOUT_TEST_ERROR_CHARS = 500;

export function describeFetchTimeoutTestError(error: unknown) {
  const text = redactProofText(error instanceof Error ? error.message : String(error))
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= MAX_FETCH_TIMEOUT_TEST_ERROR_CHARS) return text;
  return `${text.slice(0, MAX_FETCH_TIMEOUT_TEST_ERROR_CHARS - 15)}...<truncated>`;
}

export async function runFetchWithTimeoutTests({ writeLine = (line: string) => console.log(line) } = {}) {
  const originalFetch = globalThis.fetch;
  try {
    let fetchCalls = 0;
    globalThis.fetch = async (_input, init) => {
      fetchCalls += 1;
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
      fetchCalls += 1;
      if (init?.signal?.aborted) {
        reject(init.signal.reason);
        return;
      }
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
      (error: unknown) => error instanceof DOMException && error.name === "AbortError" && error.message === "caller stopped",
    );

    const preAbortedController = new AbortController();
    preAbortedController.abort(new DOMException("already stopped", "AbortError"));
    await assert.rejects(
      fetchWithTimeout("http://localhost/pre-aborted", { signal: preAbortedController.signal }, 1_000),
      (error: unknown) => error instanceof DOMException && error.name === "AbortError" && error.message === "already stopped",
    );

    await assert.rejects(
      fetchWithTimeout("http://localhost/invalid", {}, 0),
      (error: unknown) => error instanceof RangeError && error.message === "fetch timeout must be between 1 and 120000 milliseconds",
    );
    const fetchCallsBeforeInvalidTimeouts = fetchCalls;
    for (const invalidTimeoutMs of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 120_001, 2_147_483_648, Number.MAX_SAFE_INTEGER + 1]) {
      await assert.rejects(
        fetchWithTimeout("http://localhost/invalid", {}, invalidTimeoutMs),
        (error: unknown) => error instanceof RangeError,
        `fetchWithTimeout must reject invalid timeout ${String(invalidTimeoutMs)}`,
      );
    }
    assert.equal(fetchCalls, fetchCallsBeforeInvalidTimeouts, "invalid timeout values must fail before fetch starts");

    const secretUrl = "https://user:password@rpc.example.invalid/private/key";
    const described = describeFetchTimeoutTestError(new Error(`${secretUrl}\n${"x".repeat(800)}`));
    assert.equal(described.includes(secretUrl), false);
    assert.ok(described.length <= MAX_FETCH_TIMEOUT_TEST_ERROR_CHARS);
    assert.match(described, /<truncated>$/);

    writeLine("fetchWithTimeout tests passed");
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function isDirectRun() {
  const sourcePath = resolve(fileURLToPath(import.meta.url));
  const workspacePath = resolve(process.cwd(), "scripts", "test-fetch-with-timeout.ts");
  return process.argv.slice(1).some((argument) => {
    const argumentPath = resolve(argument);
    return argumentPath === sourcePath || argumentPath === workspacePath;
  });
}

if (isDirectRun()) {
  void runFetchWithTimeoutTests().catch((error) => {
    console.error(describeFetchTimeoutTestError(error));
    process.exitCode = 1;
  });
}
