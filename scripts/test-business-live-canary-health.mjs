import assert from "node:assert/strict";
import {
  MAX_CANARY_HEALTH_RESPONSE_BYTES,
  fetchCanaryHealthPayloadPair,
  parseCanaryHealthContentLength,
  readBoundedCanaryHealthJson,
} from "./live-canary-health-policy.mjs";

function jsonResponse(payload, init = {}) {
  const body = JSON.stringify(payload);
  return new Response(body, {
    ...init,
    headers: {
      "content-length": String(new TextEncoder().encode(body).byteLength),
      ...(init.headers ?? {}),
    },
  });
}

export async function runLiveCanaryHealthBehaviorTests() {
  assert.equal(parseCanaryHealthContentLength(null), null);
  assert.equal(parseCanaryHealthContentLength(""), null);
  assert.equal(parseCanaryHealthContentLength("0"), 0);
  assert.equal(parseCanaryHealthContentLength("262144"), MAX_CANARY_HEALTH_RESPONSE_BYTES);
  for (const invalid of ["00", "01", "-1", "+1", "1e3", " 1", "1 ", "9007199254740992"]) {
    assert.throws(
      () => parseCanaryHealthContentLength(invalid),
      /invalid content-length/,
      `content-length ${JSON.stringify(invalid)} must fail closed`,
    );
  }

  const calls = [];
  let timerClears = 0;
  const validPair = await fetchCanaryHealthPayloadPair({
    baseUrl: "https://example.test/base",
    secret: "test-secret",
    timeoutMs: 1_000,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return url.pathname.endsWith("/runtime")
        ? jsonResponse({ ok: true, kind: "runtime" })
        : jsonResponse({ ok: true, kind: "data-sync" });
    },
    setTimeoutImpl: setTimeout,
    clearTimeoutImpl: (timer) => {
      timerClears += 1;
      clearTimeout(timer);
    },
  });
  assert.deepEqual(validPair, {
    runtimePayload: { ok: true, kind: "runtime" },
    dataSyncPayload: { ok: true, kind: "data-sync" },
  });
  assert.deepEqual(calls.map(({ url }) => url), [
    "https://example.test/api/health/runtime",
    "https://example.test/api/health/data-sync",
  ]);
  assert.equal(calls[0].init.signal, calls[1].init.signal);
  assert.equal(calls[0].init.redirect, "error");
  assert.deepEqual(calls[0].init.headers, {
    "cache-control": "no-cache",
    "x-health-diagnostics-secret": "test-secret",
  });
  assert.equal(timerClears, 1);

  await assert.rejects(
    readBoundedCanaryHealthJson({
      headers: new Headers({ "content-length": String(MAX_CANARY_HEALTH_RESPONSE_BYTES + 1) }),
      body: new ReadableStream(),
    }),
    /body too large/,
  );
  await assert.rejects(
    readBoundedCanaryHealthJson({ headers: new Headers(), body: null }),
    /body is empty/,
  );
  await assert.rejects(
    readBoundedCanaryHealthJson(
      new Response(new Uint8Array([0xc3, 0x28]), { headers: { "content-length": "2" } }),
    ),
    /encoded data|encoding|UTF-8/i,
  );
  await assert.rejects(
    readBoundedCanaryHealthJson(jsonResponse({ ok: true }, { headers: { "content-length": "01" } })),
    /invalid content-length/,
  );

  let oversizedBodyCanceled = false;
  const oversizedStream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3, 4]));
    },
    cancel() {
      oversizedBodyCanceled = true;
    },
  });
  await assert.rejects(
    readBoundedCanaryHealthJson(new Response(oversizedStream), { maxBytes: 3 }),
    /body too large/,
  );
  assert.equal(oversizedBodyCanceled, true);

  await assert.rejects(
    fetchCanaryHealthPayloadPair({
      baseUrl: "https://example.test",
      secret: "test-secret",
      timeoutMs: 100,
      fetchImpl: async (url) => url.pathname.endsWith("/runtime")
        ? new Response("private diagnostics", { status: 503 })
        : jsonResponse({ ok: true }),
    }),
    /runtime=503 dataSync=200/,
  );

  let stalledBodyCanceled = false;
  const stalledBody = new ReadableStream({
    pull() {
      return new Promise(() => {});
    },
    cancel() {
      stalledBodyCanceled = true;
    },
  });
  await assert.rejects(
    fetchCanaryHealthPayloadPair({
      baseUrl: "https://example.test",
      secret: "test-secret",
      timeoutMs: 5,
      fetchImpl: async (url) => url.pathname.endsWith("/runtime")
        ? new Response(stalledBody)
        : jsonResponse({ ok: true }),
    }),
    /request timed out/,
  );
  assert.equal(stalledBodyCanceled, true);

  const neverSettles = new Promise(() => {});
  await assert.rejects(
    fetchCanaryHealthPayloadPair({
      baseUrl: "https://example.test",
      secret: "test-secret",
      timeoutMs: 5,
      fetchImpl: () => neverSettles,
    }),
    /request timed out/,
  );
  await assert.rejects(
    fetchCanaryHealthPayloadPair({
      baseUrl: "https://example.test",
      secret: "test-secret",
      timeoutMs: 0,
      fetchImpl: () => neverSettles,
    }),
    /positive safe integer/,
  );
}
