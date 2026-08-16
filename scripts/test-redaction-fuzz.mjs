import assert from "node:assert/strict";

import * as routeErrorModule from "../app/api/_lib/routeError.ts";
import * as sentrySanitizeModule from "../app/lib/sentrySanitize.ts";

const routeError = routeErrorModule.default ?? routeErrorModule;
const sentrySanitize = sentrySanitizeModule.default ?? sentrySanitizeModule;

const FUZZ_SEED = 0x5a17c0de;
const FUZZ_CASES = 96;
const MAX_SAFE_ERROR_NAME = 80;
const MAX_SAFE_ERROR_MESSAGE = 600;
const MAX_ROUTE_LOG_BYTES = 16 * 1024;
const MAX_EXTRA_DEPTH = 4;
const MAX_EXTRA_STRING = 240;
const MAX_EXTRA_ARRAY = 8;
const MAX_EXTRA_KEYS = 16;
const ASCII_CONTROL = /[\u0000-\u001f\u007f]/;

function createXorshift32(seed) {
  let state = seed >>> 0;
  assert.notEqual(state, 0, "the deterministic fuzz seed must be non-zero");
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return state >>> 0;
  };
}

function randomHex(nextUint32, length) {
  let value = "";
  while (value.length < length) {
    value += nextUint32().toString(16).padStart(8, "0");
  }
  return value.slice(0, length);
}

function buildDeepValue(leaf, depth) {
  let value = leaf;
  for (let index = 0; index < depth; index += 1) {
    value = { [`level${index}`]: value };
  }
  return value;
}

function generateCases(seed) {
  const nextUint32 = createXorshift32(seed);
  const unicodeNoise = ["ошибка", "例外", "خطأ", "emoji-🛡️", "e\u0301", "zero-width-\u200b"];
  const controls = ["\u0000", "\u0007", "\u000b", "\u001b", "\u007f", "\r\n"];
  const bearerLabels = ["Bearer", "bearer", "BEARER"];
  const apiKeyLabels = ["api_key", "api-key", "apiKey", "API_KEY"];
  const privateKeyLabels = ["private_key", "private-key", "privateKey", "PRIVATE_KEY"];
  const urlSchemes = ["https", "http", "wss"];
  return Array.from({ length: FUZZ_CASES }, (_, index) => {
    const caseTag = `${index}-${randomHex(nextUint32, 12)}`;
    const bearerSecret = `bearer-${caseTag}-${randomHex(nextUint32, 20)}`;
    const apiSecret = `api-${caseTag}-${randomHex(nextUint32, 20)}`;
    const urlUser = `user-${caseTag}`;
    const urlPassword = `pass-${caseTag}-${randomHex(nextUint32, 12)}`;
    const querySecret = `query-${caseTag}-${randomHex(nextUint32, 12)}`;
    const privateKey = randomHex(nextUint32, 64);
    const unicode = unicodeNoise[nextUint32() % unicodeNoise.length];
    const control = controls[nextUint32() % controls.length];
    const bearerLabel = bearerLabels[nextUint32() % bearerLabels.length];
    const apiKeyLabel = apiKeyLabels[nextUint32() % apiKeyLabels.length];
    const privateKeyLabel = privateKeyLabels[nextUint32() % privateKeyLabels.length];
    const urlScheme = urlSchemes[nextUint32() % urlSchemes.length];
    const credentialedUrl =
      `${urlScheme}://${urlUser}:${urlPassword}@rpc-${index}.example.invalid/v1/${unicode}` +
      `?api_key=${querySecret}&token=${apiSecret}#private`;
    const message =
      `${unicode}${control} upstream ${credentialedUrl} failed; ` +
      `${bearerLabel} ${bearerSecret}; ${apiKeyLabel}=${apiSecret}; ${privateKeyLabel}=0x${privateKey}`;
    const secrets = [bearerSecret, apiSecret, urlUser, urlPassword, querySecret, privateKey];
    return { caseTag, control, credentialedUrl, index, message, privateKey, secrets, unicode };
  });
}

function serialize(value) {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function assertNoSentinelLeak(value, secrets, context) {
  const output = serialize(value);
  for (const secret of secrets) {
    assert.equal(output.includes(secret), false, `${context} leaked sentinel ${secret.slice(0, 20)}`);
  }
}

function assertBoundedRouteExtra(value, depth = 0) {
  if (typeof value === "string") {
    assert.ok(value.length <= MAX_EXTRA_STRING, `route extra string exceeded ${MAX_EXTRA_STRING} characters`);
    assert.doesNotMatch(value, ASCII_CONTROL, "route extra strings must not contain ASCII controls");
    return;
  }
  if (value === null || typeof value !== "object") return;
  assert.ok(depth < MAX_EXTRA_DEPTH, `route extra object exceeded depth ${MAX_EXTRA_DEPTH}`);
  if (Array.isArray(value)) {
    assert.ok(value.length <= MAX_EXTRA_ARRAY, `route extra array exceeded ${MAX_EXTRA_ARRAY} entries`);
    for (const entry of value) assertBoundedRouteExtra(entry, depth + 1);
    return;
  }
  const entries = Object.entries(value);
  assert.ok(entries.length <= MAX_EXTRA_KEYS, `route extra object exceeded ${MAX_EXTRA_KEYS} keys`);
  for (const [key, entry] of entries) {
    assert.ok(key.length <= MAX_SAFE_ERROR_NAME, "sanitized route extra key was not bounded");
    assert.doesNotMatch(key, ASCII_CONTROL, "sanitized route extra keys must not contain ASCII controls");
    assertBoundedRouteExtra(entry, depth + 1);
  }
}

function buildHostileExtra(testCase) {
  const nestedError = {
    name: `Nested${testCase.control}Error`,
    message: testCase.message,
    cause: {
      message: `Bearer ${testCase.secrets[0]} via ${testCase.credentialedUrl}`,
      privateKey: `0x${testCase.privateKey}`,
    },
  };
  return {
    caseIndex: testCase.index,
    nested: {
      error: nestedError,
      causes: Array.from({ length: 24 }, () => ({ reason: testCase.message })),
    },
    oversized: `${testCase.message} ${"x".repeat(12_000)}`,
    list: Array.from({ length: 32 }, (_, index) => `${index}:${testCase.message}`),
    deep: buildDeepValue({ message: testCase.message }, 12),
    apiKey: testCase.secrets[1],
    safeStatus: "pending",
    ...Object.fromEntries(Array.from({ length: 32 }, (_, index) => [`extra${index}`, index])),
  };
}

const firstGeneration = generateCases(FUZZ_SEED);
assert.deepEqual(firstGeneration, generateCases(FUZZ_SEED), "seeded fuzz cases must be exactly reproducible");

for (const testCase of firstGeneration) {
  const hostileExtra = buildHostileExtra(testCase);
  const circular = { message: testCase.message };
  circular.self = circular;
  const sanitizerInput = {
    nested: hostileExtra,
    circular,
    error: { name: "UpstreamError", message: testCase.message },
  };
  const sanitized = sentrySanitize.sanitizeSentryPayload(sanitizerInput);
  assertNoSentinelLeak(sanitized, testCase.secrets, `sanitizeSentryPayload case ${testCase.caseTag}`);
  assert.equal(sanitized.circular.self, "<circular>", "circular payloads must terminate deterministically");
  assert.match(serialize(sanitized.nested.deep), /<truncated>/, "deep payloads must terminate at the sanitizer depth bound");

  const error = new Error(`${testCase.message} ${"y".repeat(2_000)}`);
  error.name = `Remote${testCase.control}${testCase.unicode}Error${"N".repeat(120)}`;
  const safeDetails = routeError.describeSafeRouteError(error);
  assert.ok(safeDetails.name.length <= MAX_SAFE_ERROR_NAME, "safe error name was not bounded");
  assert.ok(safeDetails.message.length <= MAX_SAFE_ERROR_MESSAGE, "safe error message was not bounded");
  assert.doesNotMatch(`${safeDetails.name}${safeDetails.message}`, ASCII_CONTROL, "safe error details retained ASCII controls");
  assertNoSentinelLeak(safeDetails, testCase.secrets, `describeSafeRouteError case ${testCase.caseTag}`);

  const captured = [];
  const originalConsoleError = console.error;
  try {
    console.error = (...args) => captured.push(args);
    routeError.logRouteError(
      `/api/fuzz/${testCase.index}/${testCase.credentialedUrl}${testCase.control}${"r".repeat(240)}`,
      error,
      hostileExtra,
    );
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(captured.length, 1, "each route error must emit exactly one sanitized record");
  const record = captured[0];
  const serializedRecord = JSON.stringify(record);
  assert.ok(Buffer.byteLength(serializedRecord, "utf8") <= MAX_ROUTE_LOG_BYTES, "route error record exceeded its fuzz byte bound");
  assert.doesNotMatch(serializedRecord, ASCII_CONTROL, "route error record retained raw ASCII controls");
  assertNoSentinelLeak(record, testCase.secrets, `logRouteError case ${testCase.caseTag}`);
  assert.ok(String(record[0]).length <= 810, "formatted route error line exceeded its component bounds");
  assert.doesNotMatch(String(record[0]), ASCII_CONTROL, "formatted route error line retained ASCII controls");
  assertBoundedRouteExtra(record[1]);
}

console.log(`Redaction fuzz tests passed: ${FUZZ_CASES} deterministic cases (seed 0x${FUZZ_SEED.toString(16)})`);
