import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as routeErrorModule from "../app/api/_lib/routeError.ts";

const routeError = routeErrorModule.default ?? routeErrorModule;

export async function runErrorBoundaryAndJsonTests() {
  const loggerSource = readFileSync("app/lib/logger.ts", "utf8");
  assert.match(loggerSource, /JSON\.stringify\(value, jsonReplacer, space\) \?\? "null"/);
  assert.match(loggerSource, /sanitizeSupportLogPayload\(sanitize\(data\)\)/);
  assert.match(
    loggerSource,
    /MAX_LOG_STRING_LENGTH[\s\S]*MAX_LOG_ARRAY_ITEMS[\s\S]*MAX_LOG_OBJECT_KEYS[\s\S]*MAX_LOG_DEPTH[\s\S]*function clampSupportLogValue/,
    "support logger must bound string, array, object, and depth growth before persistence/export",
  );
  assert.match(
    loggerSource,
    /safeData = data !== undefined \? clampSupportLogValue\(sanitizeSupportLogPayload\(sanitize\(data\)\)\)/,
    "support logger must redact and clamp structured log data before storing or printing it",
  );
  assert.match(
    loggerSource,
    /msg: clampLogString\(sanitizeSupportLogPayload\(msg\)\)/,
    "support logger must redact and clamp log messages before storing or printing them",
  );
  assert.match(
    loggerSource,
    /clampSupportLogValue\(sanitizeSupportLogPayload\(parsed\)\)/,
    "support log loader must clamp legacy oversized entries before returning the buffer",
  );
  assert.match(
    loggerSource,
    /clampSupportLogValue\(sanitizeSupportLogPayload\(buffer\)\)/,
    "support log export must clamp persisted entries before rendering the text artifact",
  );
  assert.match(loggerSource, /writeError\(`\[\$\{tag\}\]`, entry\.msg, safeData/);
  assert.doesNotMatch(loggerSource, /window\.location\.href/);
  assert.match(
    loggerSource,
    /autoMiner:\s*getAutoMineSupportDiagnostics\(readAutoMineDiagnostics\(\)\)/,
    "support log export must include the safe persisted Auto-Miner snapshot",
  );
  assert.match(
    loggerSource,
    /const parsed = JSON\.parse\(raw\) as unknown[\s\S]*if \(!Array\.isArray\(parsed\)\)[\s\S]*localStorage\.removeItem\(STORAGE_KEY\)/,
    "support log loader must clear corrupt or invalid localStorage instead of returning a non-array buffer",
  );
  assert.match(loggerSource, /safeMeta\s*=\s*clampSupportLogValue\(sanitizeSupportLogPayload\(meta\)\)/);
  assert.match(
    readFileSync("app/hooks/useSound.ts", "utf8"),
    /const raw = localStorage\.getItem\(SOUND_SETTINGS_KEY\)[\s\S]*localStorage\.removeItem\(SOUND_SETTINGS_KEY\)/,
    "sound settings loader must clear corrupt or invalid localStorage entries",
  );
  assert.match(
    readFileSync("app/hooks/useSound.ts", "utf8"),
    /const stored = localStorage\.getItem\(STORAGE_KEY\)[\s\S]*stored !== null && stored !== "true"[\s\S]*localStorage\.removeItem\(STORAGE_KEY\)/,
    "sound muted restore must clear invalid localStorage values",
  );
  const routeErrorSource = readFileSync("app/api/_lib/routeError.ts", "utf8");
  assert.match(routeErrorSource, /describeSafeRouteError\(error\)/);
  assert.match(routeErrorSource, /describeSafeRouteLabel\(route\)/);
  assert.match(routeErrorSource, /sanitizeSentryPayload\(describeRouteError\(error\)\)/);
  assert.match(routeErrorSource, /sanitizeSentryPayload\(extra\)/);
  const safePublicRouteError = routeError.describeSafeRouteError(
    new Error(`rpc_url=https://rpc.example.test/private Bearer synthetic-token privateKey=${"a".repeat(64)} wallet=0x1111111111111111111111111111111111111111`),
  );
  assert.equal(safePublicRouteError.name, "Error");
  assert.doesNotMatch(
    `${safePublicRouteError.name} ${safePublicRouteError.message}`,
    /rpc\.example|synthetic-token|a{64}|1111111111111111111111111111111111111111/i,
    "safe route errors must redact provider URLs, bearer tokens, hex secrets, and wallet addresses",
  );
  {
    const originalConsoleError = console.error;
    const loggedRouteErrors = [];
    try {
      console.error = (...args) => {
        loggedRouteErrors.push(args);
      };
      routeError.logRouteError(
        "/api/live-state?rpc_url=https://rpc.example.test/private",
        new Error("provider https://rpc.example.test/private failed with Bearer synthetic-token"),
        {
          rpcUrl: "https://rpc.example.test/key",
          nested: { privateKey: "0x" + "b".repeat(64), safeStatus: "pending" },
          walletAddress: "0x2222222222222222222222222222222222222222",
        },
      );
    } finally {
      console.error = originalConsoleError;
    }
    assert.equal(loggedRouteErrors.length, 1);
    const serializedRouteLog = JSON.stringify(loggedRouteErrors[0]);
    assert.doesNotMatch(
      serializedRouteLog,
      /rpc\.example|synthetic-token|b{64}|2222222222222222222222222222222222222222/i,
      "route error logger must redact route labels, messages, and structured extras before console output",
    );
    assert.match(serializedRouteLog, /pending/);
  }
  const redactedErrorCatcherSource = readFileSync("app/components/ErrorCatcher.tsx", "utf8");
  assert.match(redactedErrorCatcherSource, /sanitizeSupportLogPayload\(normalizeConsoleArg\(value\)\)/);
  assert.match(redactedErrorCatcherSource, /originalConsoleError\(\.\.\.args\.map\(sanitizeConsoleArg\)\)/);
  const redactedGlobalErrorSource = readFileSync("app/global-error.tsx", "utf8");
  const errorBoundarySource = readFileSync("app/error.tsx", "utf8");
  assert.match(redactedGlobalErrorSource, /safeError\s*=\s*sanitizeSupportLogPayload\(\{/);
  assert.match(redactedGlobalErrorSource, /console\.error\("\[GlobalError\]", safeError\.name, safeError\.message, safeError\.digest\)/);
  assert.match(errorBoundarySource, /safeError\s*=\s*sanitizeSupportLogPayload\(\{[\s\S]*stack: error\.stack\?\.slice\(0, 400\)/);
  assert.match(errorBoundarySource, /log\.error\("ErrorBoundary", "route render error", safeError\)/);
  assert.match(errorBoundarySource, /safeChunkError\s*=\s*sanitizeSupportLogPayload\(\{ message: error\.message\.slice\(0, 180\) \}\)/);
  assert.doesNotMatch(
    errorBoundarySource,
    /log\.error\("ErrorBoundary", "route render error", \{[\s\S]*message: error\.message/,
  );
  const adminOpsRouteSource = readFileSync("app/api/admin/ops/route.ts", "utf8");
  assert.doesNotMatch(
    adminOpsRouteSource,
    /type LogSourceSummary = \{[\s\S]*\n\s*file:\s*string;/,
    "admin ops log source responses must not expose absolute server log paths",
  );
  assert.match(
    errorBoundarySource,
    /min-h-11[\s\S]*Try again[\s\S]*min-h-11[\s\S]*Hard reload/,
    "route error boundary actions must keep 44px touch targets",
  );
  assert.match(
    redactedGlobalErrorSource,
    /minHeight:\s*"44px"[\s\S]*Try again[\s\S]*minHeight:\s*"44px"[\s\S]*Hard reload/,
    "global error boundary actions must keep 44px touch targets",
  );
  const readJsonResponseSource = readFileSync("app/lib/readJsonResponse.ts", "utf8");
  assert.match(readJsonResponseSource, /throw new Error\("Invalid JSON response"\)/);
  assert.match(readJsonResponseSource, /JSON response too large/);
  assert.ok(
    readJsonResponseSource.includes("const JSON_CONTENT_TYPE_RE = /^application\\/(?:json|[a-z0-9!#$&^_.+-]+\\+json)$/;") &&
      /function isJsonContentType[\s\S]*JSON_CONTENT_TYPE_RE\.test\(contentType\)/.test(readJsonResponseSource),
    "client JSON response parsing must reject explicit non-application JSON content types",
  );
  assert.match(
    readJsonResponseSource,
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function parseContentLengthHeader[\s\S]*const parsed = BigInt\(value\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)[\s\S]*contentLength === -1/,
    "client JSON response parsing must reject malformed or non-canonical Content-Length instead of broad Number coercion",
  );
  assert.match(
    readJsonResponseSource,
    /const MAX_JSON_RESPONSE_BYTES = 2 \* 1024 \* 1024[\s\S]*function normalizeJsonResponseMaxBytes[\s\S]*Number\.isSafeInteger\(value\) && value > 0 && value <= MAX_JSON_RESPONSE_BYTES[\s\S]*const byteLimit = normalizeJsonResponseMaxBytes\(maxBytes\)[\s\S]*byteLimit === null/,
    "client JSON response parsing must reject invalid maxBytes before body reads",
  );
  const { readJsonResponse } = await import("../app/lib/readJsonResponse.ts");
  assert.deepEqual(
    await readJsonResponse(new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } })),
    { ok: true },
  );
  assert.equal(await readJsonResponse(new Response("", { headers: { "content-type": "application/json" } })), null);
  await assert.rejects(
    () => readJsonResponse(new Response("<html>proxy failure</html>", { headers: { "content-type": "text/html" } })),
    /Invalid JSON response/,
    "client JSON response parsing must reject explicit HTML/text payloads before exposing raw proxy errors",
  );
  await assert.rejects(
    () => readJsonResponse(new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "text/plain+json" } })),
    /Invalid JSON response/,
    "client JSON response parsing must only accept application/json or application/*+json content types",
  );
  for (const malformedContentLength of ["0001", "01", "1e3", "-1", "1.5", (BigInt(Number.MAX_SAFE_INTEGER) + 1n).toString()]) {
    await assert.rejects(
      () =>
        readJsonResponse(
          new Response(JSON.stringify({ ok: true }), {
            headers: { "content-type": "application/json", "content-length": malformedContentLength },
          }),
        ),
      /Invalid JSON response/,
      "client JSON response parsing must reject malformed Content-Length before reading API bodies",
    );
  }
  await assert.rejects(
    () =>
      readJsonResponse(
        new Response(JSON.stringify({ ok: true }), {
          headers: { "content-type": "application/json", "content-length": String(Number.MAX_SAFE_INTEGER) },
        }),
        64,
      ),
    /JSON response too large/,
    "safe-max client Content-Length must be bounded against the helper byte limit before body reads",
  );
  await assert.rejects(
    () =>
      readJsonResponse(
        new Response(JSON.stringify({ value: "x".repeat(128) }), { headers: { "content-type": "application/json" } }),
        64,
      ),
    /JSON response too large/,
    "client JSON response parsing must bound response bodies",
  );
  for (const invalidMaxBytes of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(
      () =>
        readJsonResponse(
          {
            headers: new Headers({ "content-type": "application/json" }),
            get body() {
              throw new Error("invalid maxBytes must fail before reading the response body");
            },
          },
          invalidMaxBytes,
        ),
      /Invalid JSON response/,
      `client JSON response parsing must reject invalid maxBytes ${String(invalidMaxBytes)}`,
    );
  }
  await assert.rejects(
    () =>
      readJsonResponse(
        {
          headers: new Headers({ "content-type": "application/json" }),
          get body() {
            throw new Error("oversized maxBytes must fail before reading the response body");
          },
        },
        2 * 1024 * 1024 + 1,
      ),
    /Invalid JSON response/,
    "client JSON response parsing must reject response byte limits above the helper-wide cap before body reads",
  );
  assert.deepEqual(
    await readJsonResponse(
      new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } }),
      2 * 1024 * 1024,
    ),
    { ok: true },
    "client JSON response parsing must preserve the exact helper-wide cap as a valid byte limit",
  );
  await assert.rejects(
    () =>
      readJsonResponse(
        new Response(new Uint8Array([...new TextEncoder().encode('{"value":"'), 0xff, ...new TextEncoder().encode('"}')]), {
          headers: { "content-type": "application/json" },
        }),
      ),
    /Invalid JSON response/,
    "client JSON response parsing must fail closed on malformed UTF-8 instead of accepting replacement characters",
  );
  assert.match(
    readJsonResponseSource,
    /new TextDecoder\("utf-8", \{ fatal: true \}\)/,
    "client JSON response parsing must use fatal UTF-8 decoding",
  );
  assert.doesNotMatch(
    readJsonResponseSource,
    /Invalid JSON response:\s*\$\{raw\.slice/,
    "JSON response parsing failures must not expose raw response bodies",
  );
  const safeRouteError = routeError.describeSafeRouteError(
    new Error(`RPC https://rpc.example.test/private failed for 0x${"ab".repeat(20)}`),
  );
  assert.equal(safeRouteError.message.includes("rpc.example.test"), false);
  assert.equal(safeRouteError.message.includes("ab".repeat(20)), false);
  const safeQueryRouteError = routeError.describeSafeRouteError(
    new Error(
      `request failed: rpc_url=https://rpc.example.test/?key=inline-secret wallet=0x${"12".repeat(20)} authorization=Bearer synthetic-token`,
    ),
  );
  assert.doesNotMatch(
    safeQueryRouteError.message,
    /rpc\.example|inline-secret|0x[12]{40}|Bearer|synthetic-token/i,
    "safe route errors must redact query-style RPC, wallet, and auth tokens",
  );
  const clampedRouteError = routeError.describeSafeRouteError(
    new Error(`first line\n${"x".repeat(1_000)}`),
  );
  assert.equal(clampedRouteError.message.includes("\n"), false);
  assert.ok(clampedRouteError.message.length <= 600, "safe route errors must keep log lines bounded");
  const controlCharRouteError = routeError.describeSafeRouteError(new Error("bad\u0000route\u0007error"));
  assert.doesNotMatch(
    controlCharRouteError.message,
    /[\u0000-\u001f\u007f]/,
    "safe route errors must strip ASCII control characters from messages",
  );
  const routeLabelLogs = [];
  const routeExtraLogs = [];
  const originalConsoleError = console.error;
  console.error = (...args) => {
    routeLabelLogs.push(args.map(String).join(" "));
    routeExtraLogs.push(args);
  };
  try {
    routeError.logRouteError(
      `/api/${"x".repeat(180)}?rpc=https://rpc.example.test/private&wallet=0x${"cd".repeat(20)}\nnext\u0000tail`,
      new Error("synthetic route label failure\u0007"),
      {
        safe: true,
        longText: `secret\u0000 ${"z".repeat(1_000)}`,
        [`rpc=https://rpc.example.test/private&wallet=0x${"ef".repeat(20)}`]: "key must be redacted",
        many: Array.from({ length: 20 }, (_, index) => index),
        nested: {
          authorization: "Bearer nested-secret",
          webhookUrl: "https://hooks.example.test/private",
          value: { deeper: { final: "kept", tooDeep: { hidden: true } } },
        },
        ...Object.fromEntries(Array.from({ length: 24 }, (_, index) => [`extraKey${index}`, index])),
      },
    );
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(routeLabelLogs.length, 1, "route error logger must emit one sanitized log line");
  assert.doesNotMatch(routeLabelLogs[0], /rpc\.example|0x[cd]{40}|[\u0000-\u001f\u007f]/);
  assert.ok(routeLabelLogs[0].split("]")[0].length <= 121, "route error labels must stay bounded");
  const loggedRouteExtra = routeExtraLogs[0]?.[1];
  assert.ok(loggedRouteExtra, "route error logger must keep sanitized extra context when present");
  assert.equal(String(loggedRouteExtra.longText).length <= 240, true, "route error extra strings must stay bounded");
  assert.equal(loggedRouteExtra.many.length, 8, "route error extra arrays must stay bounded");
  assert.equal(Object.keys(loggedRouteExtra).length <= 16, true, "route error extra objects must stay bounded");
  assert.doesNotMatch(JSON.stringify(loggedRouteExtra), /z{300}|rpc\.example|hooks\.example|nested-secret|0x[cd]{40}|0x[ef]{40}|[\u0000-\u001f\u007f]/);

}
