import assert from "node:assert/strict";
import { fetchWithTimeout } from "../app/lib/fetchWithTimeout";

const originalFetch = globalThis.fetch;

async function main() {
try {
  globalThis.fetch = async (_input, init) => {
    assert.ok(init?.signal instanceof AbortSignal);
    return new Response("ok", { status: 200 });
  };
  const response = await fetchWithTimeout("http://localhost/test", {}, 100);
  assert.equal(response.status, 200);

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

  console.log("fetchWithTimeout tests passed");
} finally {
  globalThis.fetch = originalFetch;
}
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
