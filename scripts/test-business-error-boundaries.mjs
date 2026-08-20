import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as routeErrorModule from "../app/api/_lib/routeError.ts";

const routeError = routeErrorModule.default ?? routeErrorModule;
const LOGGER_STORAGE_KEY = "lineaore:logs";
const LOGGER_SANITIZER_FAULT_PROBE = process.env.ERROR_BOUNDARY_TEST_MODE === "logger-sanitizer-fault-probe";

function createMemoryStorage() {
  const values = new Map();
  const removals = [];
  return {
    values,
    removals,
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      removals.push(key);
      values.delete(key);
    },
  };
}

function installTemporaryGlobal(name, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, {
    configurable: true,
    enumerable: previous?.enumerable ?? false,
    writable: true,
    value,
  });
  return () => {
    if (previous) Object.defineProperty(globalThis, name, previous);
    else delete globalThis[name];
  };
}

async function runLoggerSanitizerFaultProbe() {
  const { mock } = await import("node:test");
  mock.module(new URL("../app/lib/sentrySanitize.ts", import.meta.url).href, {
    namedExports: {
      sanitizeSentryPayload: (value) => value,
      sanitizeSupportLogPayload: (value) => value,
    },
  });
  const storage = createMemoryStorage();
  const queuedFlushes = [];
  const restoreWindow = installTemporaryGlobal("window", {
    location: { origin: "https://logger-probe.invalid", href: "https://logger-probe.invalid/" },
    localStorage: storage,
    dispatchEvent() {},
  });
  const restoreStorage = installTemporaryGlobal("localStorage", storage);
  const restoreSetTimeout = installTemporaryGlobal("setTimeout", (callback) => {
    queuedFlushes.push(callback);
    return queuedFlushes.length;
  });
  const originalConsoleWarn = console.warn;
  const logged = [];
  console.warn = (...args) => logged.push(args);
  try {
    const loggerModule = await import("../app/lib/logger.ts?logger-sanitizer-fault-probe");
    loggerModule.log.error("FaultProbe", "Bearer logger-sanitizer-mutant-secret");
    assert.doesNotMatch(
      JSON.stringify(logged),
      /logger-sanitizer-mutant-secret/,
      "logger sanitizer fault probe must reject an identity-sanitizer mutant",
    );
  } finally {
    console.warn = originalConsoleWarn;
    restoreSetTimeout();
    restoreStorage();
    restoreWindow();
  }
}

if (LOGGER_SANITIZER_FAULT_PROBE) {
  await runLoggerSanitizerFaultProbe();
  process.exit(0);
}

function assertLoggerSanitizerFaultIsCaught() {
  const result = spawnSync(
    process.execPath,
    ["--experimental-test-module-mocks", "--import", "tsx", fileURLToPath(import.meta.url)],
    {
      cwd: process.cwd(),
      env: { ...process.env, ERROR_BOUNDARY_TEST_MODE: "logger-sanitizer-fault-probe" },
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 512 * 1024,
      windowsHide: true,
    },
  );
  assert.equal(result.signal, null, "logger sanitizer fault probe must not be killed");
  assert.equal(result.status, 1, "identity-sanitizer mutant must fail the logger redaction assertion");
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /logger sanitizer fault probe must reject an identity-sanitizer mutant/,
  );
}

async function runSupportLoggerBehaviorTests() {
  const storage = createMemoryStorage();
  const queuedFlushes = [];
  const location = {
    origin: "https://safe-logger-origin.invalid",
    href: "https://safe-logger-origin.invalid/admin?token=href-secret-must-not-export",
  };
  const restoreWindow = installTemporaryGlobal("window", {
    location,
    localStorage: storage,
    dispatchEvent() {},
  });
  const restoreStorage = installTemporaryGlobal("localStorage", storage);
  const restoreSetTimeout = installTemporaryGlobal("setTimeout", (callback) => {
    queuedFlushes.push(callback);
    return queuedFlushes.length;
  });
  const originalConsoleWarn = console.warn;
  const consoleWarnings = [];
  console.warn = (...args) => consoleWarnings.push(args);
  let loggerModule;
  try {
    const diagnosticsModule = await import("../app/lib/mining/autoMineDiagnostics.ts");
    storage.setItem(diagnosticsModule.AUTO_MINE_DIAGNOSTICS_STORAGE_KEY, JSON.stringify({
      phase: "retry-wait",
      progress: "waiting safely",
      runningParams: null,
      isAutoMining: false,
      autoResumeRequested: true,
      sessionExpired: false,
      lastErrorKind: "network",
      lastErrorMessage: "temporary retry",
      lastErrorRawMessage: "Bearer auto-miner-raw-secret https://auto-miner-secret.invalid/private",
      lastStopReason: "retry-wait",
      lastEpoch: "42",
      retryCount: 2,
      updatedAt: 1_700_000_000_000,
    }));

    loggerModule = await import("../app/lib/logger.ts?business-error-boundaries");
    storage.setItem(LOGGER_STORAGE_KEY, "{not-json");
    assert.equal(loggerModule.getLogCount(), 0);
    assert.equal(storage.values.has(LOGGER_STORAGE_KEY), false);
    assert.ok(storage.removals.includes(LOGGER_STORAGE_KEY), "corrupt support logs must be removed");

    storage.setItem(LOGGER_STORAGE_KEY, JSON.stringify({ not: "an array" }));
    assert.equal(loggerModule.getLogCount(), 0);
    assert.equal(storage.values.has(LOGGER_STORAGE_KEY), false, "non-array support logs must be removed");

    const legacyUrl = "https://legacy-logger-secret.invalid/private";
    const legacyToken = "legacy-logger-token-must-not-export";
    const legacyWallet = `0x${"12".repeat(20)}`;
    storage.setItem(LOGGER_STORAGE_KEY, JSON.stringify([null, { lvl: "error" }, {
      ts: "2026-08-13T00:00:00.000Z",
      lvl: "error",
      tag: "Legacy",
      msg: `Bearer ${legacyToken} ${legacyUrl} ${"m".repeat(2_400)}`,
      data: {
        walletAddress: legacyWallet,
        longText: "z".repeat(2_400),
        many: Array.from({ length: 80 }, (_, index) => index),
        manyKeys: Object.fromEntries(Array.from({ length: 80 }, (_, index) => [`key${index}`, index])),
        deep: { a: { b: { c: { d: { e: { f: { hidden: legacyToken } } } } } } },
      },
    }]));
    const legacyExport = loggerModule.exportLogs();
    assert.doesNotMatch(legacyExport, new RegExp(`${legacyToken}|legacy-logger-secret|${legacyWallet}`, "i"));
    assert.match(legacyExport, /<redacted>/);
    assert.match(legacyExport, /<truncated>/);
    assert.match(legacyExport, /"autoMiner"/);
    assert.match(legacyExport, /"phase": "retry-wait"/);
    assert.doesNotMatch(legacyExport, /auto-miner-raw-secret|auto-miner-secret/);
    assert.match(legacyExport, /"origin": "<redacted>"/);
    assert.doesNotMatch(legacyExport, /safe-logger-origin|href-secret-must-not-export|\/admin\?token=/);

    loggerModule.clearLogs();
    const liveToken = "live-logger-token-must-not-leak";
    const liveUrl = "https://live-logger-secret.invalid/private";
    const livePrivateKey = `0x${"ab".repeat(32)}`;
    const liveWallet = `0x${"34".repeat(20)}`;
    for (let index = 0; index < 505; index += 1) {
      loggerModule.log.info("Capacity", `entry-${index}`);
    }
    loggerModule.log.error(
      "Runtime",
      `Bearer ${liveToken} ${liveUrl} ${livePrivateKey} ${"x".repeat(2_400)}`,
      {
        walletAddress: liveWallet,
        bigint: 42n,
        longText: "q".repeat(2_400),
        many: Array.from({ length: 80 }, (_, index) => index),
        manyKeys: Object.fromEntries(Array.from({ length: 80 }, (_, index) => [`key${index}`, index])),
        deep: { a: { b: { c: { d: { e: { f: { hidden: liveToken } } } } } } },
      },
    );
    assert.equal(queuedFlushes.length, 1, "support logger must coalesce persistence into one scheduled flush");
    queuedFlushes.shift()();

    assert.equal(consoleWarnings.length, 1, "runtime error logging must emit one sanitized console record");
    const serializedConsole = JSON.stringify(consoleWarnings[0]);
    assert.doesNotMatch(serializedConsole, new RegExp(`${liveToken}|live-logger-secret|${livePrivateKey}|${liveWallet}`, "i"));
    const persisted = JSON.parse(storage.getItem(LOGGER_STORAGE_KEY));
    assert.equal(persisted.length, 500, "persisted support logs must retain only the newest bounded window");
    const persistedError = persisted.at(-1);
    assert.equal(persistedError.tag, "Runtime");
    assert.ok(persistedError.msg.length <= 2_014, "persisted logger messages must remain bounded");
    assert.equal(persistedError.data.bigint, "42");
    assert.equal(persistedError.data.longText.length <= 2_014, true);
    assert.equal(persistedError.data.many.length, 51);
    assert.equal(persistedError.data.many.at(-1), "<truncated>");
    assert.equal(Object.keys(persistedError.data.manyKeys).length, 50);
    assert.match(JSON.stringify(persistedError.data.deep), /<truncated>/);
    assert.doesNotMatch(
      JSON.stringify(persistedError),
      new RegExp(`${liveToken}|live-logger-secret|${livePrivateKey}|${liveWallet}`, "i"),
    );
    assert.equal(loggerModule.getLogCount(), 500, "in-memory support log count must match the persisted cap after flush");
    const liveExport = loggerModule.exportLogs();
    assert.match(liveExport, /<Runtime>/);
    assert.doesNotMatch(liveExport, /<Capacity> entry-(?:[0-9]|[1-3][0-9])\b/);
    assert.doesNotMatch(
      liveExport,
      new RegExp(`${liveToken}|live-logger-secret|${livePrivateKey}|${liveWallet}|href-secret-must-not-export`, "i"),
    );
  } finally {
    try {
      loggerModule?.clearLogs();
    } catch {
      // Cleanup remains best-effort in the hermetic storage fixture.
    }
    console.warn = originalConsoleWarn;
    restoreSetTimeout();
    restoreStorage();
    restoreWindow();
  }
}

export async function runErrorBoundaryAndJsonTests() {
  assertLoggerSanitizerFaultIsCaught();
  await runSupportLoggerBehaviorTests();
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
  const { readJsonResponse } = await import("../app/lib/readJsonResponse.ts");
  assert.deepEqual(
    await readJsonResponse(new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } })),
    { ok: true },
  );
  assert.equal(await readJsonResponse(new Response("", { headers: { "content-type": "application/json" } })), null);
  const rawMalformedBody = `<html>proxy failure private-body-needle-${"x".repeat(256)}</html>`;
  await assert.rejects(
    () => readJsonResponse(new Response(rawMalformedBody, { headers: { "content-type": "text/html" } })),
    (error) => {
      assert.ok(error instanceof Error);
      assert.equal(error.message, "Invalid JSON response");
      assert.doesNotMatch(error.message, /private-body-needle|proxy failure|x{32}/);
      return true;
    },
    "client JSON response parsing must reject explicit HTML/text payloads without exposing raw body content",
  );
  assert.deepEqual(
    await readJsonResponse(new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/problem+json" } })),
    { ok: true },
    "client JSON response parsing must accept registered application/*+json payloads",
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
