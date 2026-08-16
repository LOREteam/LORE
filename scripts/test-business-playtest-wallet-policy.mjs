import assert from "node:assert/strict";
import {
  MAX_PLAYTEST_ERROR_CHARS,
  MAX_PLAYTEST_JSON_RESPONSE_BYTES,
  describeWalletPlaytestError,
  fetchPlaytestJson,
  fetchPlaytestStatus,
  hasWalletSigningMaterial,
  parsePlaytestContentLength,
  readBoundedPlaytestResponseText,
  resolveWalletPlaytestAdmission,
} from "./playtest-wallet-policy.mjs";

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

export async function runPlaytestWalletPolicyTests() {
  assert.deepEqual(resolveWalletPlaytestAdmission({
    executeRequested: false,
    executeEnvironmentValue: undefined,
    signingMaterialPresent: false,
  }), { dryRun: true, liveExecutionConfirmed: false });
  assert.deepEqual(resolveWalletPlaytestAdmission({
    executeRequested: true,
    executeEnvironmentValue: "1",
    signingMaterialPresent: true,
  }), { dryRun: false, liveExecutionConfirmed: true });
  assert.throws(
    () => resolveWalletPlaytestAdmission({
      executeRequested: true,
      executeEnvironmentValue: undefined,
      signingMaterialPresent: false,
    }),
    /without TEST_WALLET_EXECUTE=1/,
  );
  assert.throws(
    () => resolveWalletPlaytestAdmission({
      executeRequested: false,
      executeEnvironmentValue: "1",
      signingMaterialPresent: true,
    }),
    /refuses inherited signing material/,
  );
  assert.equal(hasWalletSigningMaterial({ TEST_WALLET_PRIVATE_KEY: "  value  " }), true);
  assert.equal(hasWalletSigningMaterial({ TEST_WALLET_PRIVATE_KEY: "   ", PUBLIC_KEY: "value" }), false);
  assert.equal(hasWalletSigningMaterial({ DEPLOY_SEED_PHRASE: "value" }), true);

  assert.equal(parsePlaytestContentLength(null), null);
  assert.equal(parsePlaytestContentLength(""), null);
  assert.equal(parsePlaytestContentLength("0"), 0);
  assert.equal(
    parsePlaytestContentLength(String(MAX_PLAYTEST_JSON_RESPONSE_BYTES)),
    MAX_PLAYTEST_JSON_RESPONSE_BYTES,
  );
  for (const invalid of ["00", "01", "-1", "+1", "1e3", " 1", "1 ", "9007199254740992"]) {
    assert.throws(() => parsePlaytestContentLength(invalid), /invalid content-length/);
  }

  const fetchCalls = [];
  let timerClears = 0;
  const jsonResult = await fetchPlaytestJson({
    url: "https://example.test/api/deposits",
    timeoutMs: 1_000,
    fetchImpl: async (url, init) => {
      fetchCalls.push({ url: String(url), init });
      return jsonResponse({ ok: true, rows: 2 });
    },
    setTimeoutImpl: setTimeout,
    clearTimeoutImpl: (timer) => {
      timerClears += 1;
      clearTimeout(timer);
    },
  });
  assert.deepEqual(jsonResult, { status: 200, ok: true, json: { ok: true, rows: 2 } });
  assert.equal(fetchCalls[0].url, "https://example.test/api/deposits");
  assert.deepEqual(fetchCalls[0].init.headers, { accept: "application/json" });
  assert.equal(fetchCalls[0].init.signal instanceof AbortSignal, true);
  assert.equal(timerClears, 1);

  const textResult = await fetchPlaytestJson({
    url: "https://example.test/api/rebates",
    timeoutMs: 1_000,
    fetchImpl: async () => new Response("not-json", { status: 503 }),
  });
  assert.deepEqual(textResult, { status: 503, ok: false, json: "not-json" });

  const statusResult = await fetchPlaytestStatus({
    url: "https://example.test/",
    accept: "text/html",
    timeoutMs: 1_000,
    fetchImpl: async (_url, init) => {
      assert.deepEqual(init.headers, { accept: "text/html" });
      assert.equal(init.signal instanceof AbortSignal, true);
      return new Response(null, { status: 204 });
    },
  });
  assert.deepEqual(statusResult, { status: 204, ok: true });

  await assert.rejects(
    readBoundedPlaytestResponseText({
      headers: new Headers({ "content-length": String(MAX_PLAYTEST_JSON_RESPONSE_BYTES + 1) }),
      body: new ReadableStream(),
    }),
    /body too large/,
  );
  await assert.rejects(
    readBoundedPlaytestResponseText(
      new Response(new Uint8Array([0xc3, 0x28]), { headers: { "content-length": "2" } }),
    ),
    /encoded data|encoding|UTF-8/i,
  );

  let oversizedBodyCanceled = false;
  const oversizedBody = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3, 4]));
    },
    cancel() {
      oversizedBodyCanceled = true;
    },
  });
  await assert.rejects(
    readBoundedPlaytestResponseText(new Response(oversizedBody), { maxBytes: 3 }),
    /body too large/,
  );
  assert.equal(oversizedBodyCanceled, true);

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
    fetchPlaytestJson({
      url: "https://example.test/api/deposits",
      timeoutMs: 5,
      fetchImpl: async () => new Response(stalledBody),
    }),
    /request timed out/,
  );
  assert.equal(stalledBodyCanceled, true);

  const neverSettles = new Promise(() => {});
  await assert.rejects(
    fetchPlaytestStatus({
      url: "https://example.test/",
      accept: "text/html",
      timeoutMs: 5,
      fetchImpl: () => neverSettles,
    }),
    /request timed out/,
  );
  await assert.rejects(
    fetchPlaytestJson({
      url: "https://example.test/api/deposits",
      timeoutMs: 0,
      fetchImpl: () => neverSettles,
    }),
    /positive safe integer/,
  );

  const compactError = describeWalletPlaytestError(
    new Error("failed at https://private.example/path C:\\Users\\operator\\secret.txt"),
  );
  assert.doesNotMatch(compactError, /private\.example|operator|secret\.txt/i);
  assert.equal(compactError.includes("\n"), false);
  const longError = describeWalletPlaytestError("x".repeat(MAX_PLAYTEST_ERROR_CHARS + 100));
  assert.equal(longError.length, MAX_PLAYTEST_ERROR_CHARS);
  assert.equal(longError.endsWith("...<truncated>"), true);
}
