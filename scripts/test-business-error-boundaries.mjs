import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as routeErrorModule from "../app/api/_lib/routeError.ts";

const routeError = routeErrorModule.default ?? routeErrorModule;
const LOGGER_STORAGE_KEY = "lineaore:logs";
const ERROR_BOUNDARY_TEST_MODE = process.env.ERROR_BOUNDARY_TEST_MODE;
const LOGGER_SANITIZER_FAULT_PROBE = ERROR_BOUNDARY_TEST_MODE === "logger-sanitizer-fault-probe";

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

async function runSoundStorageProbe() {
  const { mock } = await import("node:test");
  let stateIndex = 0;
  mock.module("react", {
    namedExports: {
      useRef: (value) => ({ current: value }),
      useState: (value) => {
        stateIndex += 1;
        return [value, (next) => {
          if (typeof next === "function") next(value);
        }];
      },
      useEffect: (effect) => {
        effect();
      },
      useCallback: (callback) => callback,
    },
  });

  const storage = createMemoryStorage();
  storage.values.set("lore:sound-muted", "invalid");
  storage.values.set("lore:sound-settings", "{not-json");
  const restoreStorage = installTemporaryGlobal("localStorage", storage);
  try {
    const imported = await import("../app/hooks/useSound.ts?sound-storage-probe");
    const soundModule = imported.default ?? imported;
    soundModule.useSound();
    process.stdout.write(`${JSON.stringify({ removals: storage.removals, stateCount: stateIndex })}\n`);
  } finally {
    restoreStorage();
  }
}

async function runErrorCatcherConsoleProbe() {
  const { mock } = await import("node:test");
  const cleanups = [];
  mock.module("react", {
    namedExports: {
      useEffect: (effect) => {
        const cleanup = effect();
        if (typeof cleanup === "function") cleanups.push(cleanup);
      },
    },
  });

  const storage = createMemoryStorage();
  const listeners = new Map();
  const restoreStorage = installTemporaryGlobal("localStorage", storage);
  const restoreSessionStorage = installTemporaryGlobal("sessionStorage", storage);
  const restoreWindow = installTemporaryGlobal("window", {
    location: { href: "https://app.invalid/", reload() {}, replace() {} },
    history: { state: null, replaceState() {} },
    localStorage: storage,
    addEventListener(type, listener) {
      listeners.set(type, listener);
    },
    removeEventListener(type) {
      listeners.delete(type);
    },
    setTimeout() {
      return 1;
    },
    clearTimeout() {},
  });
  const originalConsoleError = console.error;
  const forwarded = [];
  console.error = (...args) => {
    if (args.length === 1 && String(args[0]).includes("ExperimentalWarning: Module mocking")) return;
    forwarded.push(args);
  };

  let payload;
  try {
    const imported = await import("../app/components/ErrorCatcher.tsx?error-catcher-console-probe");
    const errorCatcherModule = imported.default ?? imported;
    errorCatcherModule.ErrorCatcher();
    const error = new Error(
      `Bearer catcher-secret https://rpc.catcher.invalid/private wallet=0x${"12".repeat(20)}`,
    );
    console.error(error, { privateKey: `0x${"ab".repeat(32)}`, amount: 42n });
    const record = forwarded[0];
    payload = {
      forwarding: {
        count: forwarded.length,
        argCount: record?.length,
        errorName: record?.[0]?.name,
        amount: record?.[1]?.amount,
        stackBounded: typeof record?.[0]?.stack === "string" && record[0].stack.length <= 400,
      },
      serialized: JSON.stringify(record),
    };
  } finally {
    for (const cleanup of cleanups.reverse()) cleanup();
    console.error = originalConsoleError;
    restoreWindow();
    restoreSessionStorage();
    restoreStorage();
  }
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

async function runGlobalErrorConsoleProbe() {
  const { mock } = await import("node:test");
  mock.module("react", {
    namedExports: {
      useEffect: (effect) => {
        effect();
      },
    },
  });
  mock.module("react/jsx-runtime", {
    namedExports: {
      Fragment: Symbol.for("error-boundary-probe.fragment"),
      jsx: (type, props) => ({ type, props }),
      jsxs: (type, props) => ({ type, props }),
    },
  });
  mock.module("@sentry/nextjs", {
    namedExports: {
      captureException() {},
    },
  });

  const storage = createMemoryStorage();
  const restoreSessionStorage = installTemporaryGlobal("sessionStorage", storage);
  const restoreWindow = installTemporaryGlobal("window", {
    location: { href: "https://app.invalid/", reload() {}, replace() {} },
    history: { state: null, replaceState() {} },
  });
  const originalConsoleError = console.error;
  const forwarded = [];
  console.error = (...args) => {
    if (args.length === 1 && String(args[0]).includes("ExperimentalWarning: Module mocking")) return;
    forwarded.push(args);
  };

  let payload;
  try {
    const imported = await import("../app/global-error.tsx?global-error-console-probe");
    const globalErrorModule = imported.default ?? imported;
    const GlobalError = typeof globalErrorModule === "function" ? globalErrorModule : globalErrorModule.default;
    const error = Object.assign(
      new Error(
        `Bearer global-probe-secret https://rpc.global-probe.invalid/private wallet=0x${"34".repeat(20)}`,
      ),
      { digest: "Bearer global-digest-secret" },
    );
    GlobalError({ error, reset() {} });
    payload = {
      forwardedCount: forwarded.length,
      args: forwarded[0],
      serialized: JSON.stringify(forwarded),
    };
  } finally {
    console.error = originalConsoleError;
    restoreWindow();
    restoreSessionStorage();
  }
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

async function runRouteErrorEffectProbe() {
  const { mock } = await import("node:test");
  const routeErrorUrl = new URL("../app/error.tsx", import.meta.url).href;
  const loggerUrl = new URL("../app/lib/logger.ts", import.meta.url).href;
  const chunkRecoveryUrl = new URL("../app/lib/chunkReloadRecovery.ts", import.meta.url).href;
  const effects = [];
  const sentryCaptures = [];
  const errorCalls = [];
  const warningCalls = [];
  let stripCalls = 0;
  let reloadCalls = 0;
  let networkCalls = 0;

  const reactMock = mock.module("react", {
    namedExports: {
      useEffect: (effect) => {
        effects.push(effect);
        effect();
      },
    },
  });
  const jsxRuntimeMock = mock.module("react/jsx-runtime", {
    namedExports: {
      Fragment: Symbol.for("route-error-effect-probe.fragment"),
      jsx: (type, props) => ({ type, props }),
      jsxs: (type, props) => ({ type, props }),
    },
  });
  const sentryMock = mock.module("@sentry/nextjs", {
    namedExports: {
      captureException: (...args) => sentryCaptures.push(args),
    },
  });
  const loggerMock = mock.module(loggerUrl, {
    namedExports: {
      log: {
        error: (...args) => errorCalls.push(args),
        warn: (...args) => warningCalls.push(args),
      },
    },
  });
  const chunkRecoveryMock = mock.module(chunkRecoveryUrl, {
    namedExports: {
      isChunkLoadLikeErrorMessage: (message) => message.startsWith("ChunkLoadError"),
      reloadWithCacheBust: () => {
        reloadCalls += 1;
      },
      shouldAttemptChunkReloadOnce: () => true,
      stripChunkReloadCacheParam: () => {
        stripCalls += 1;
      },
    },
  });

  const restoreWindow = installTemporaryGlobal("window", {
    location: {},
    history: {},
  });
  const restoreSessionStorage = installTemporaryGlobal("sessionStorage", {});
  const restoreFetch = installTemporaryGlobal("fetch", async () => {
    networkCalls += 1;
    throw new Error("route error effect probe forbids network access");
  });

  let payload;
  try {
    const imported = await import(`${routeErrorUrl}?route-error-effect-probe=${process.pid}`);
    const candidate = imported.default ?? imported;
    const ErrorPage = typeof candidate === "function" ? candidate : candidate.default;
    ErrorPage({
      error: Object.assign(
        new Error("Bearer route-effect-secret https://private-route-effect.invalid/path"),
        { digest: "Bearer route-digest-secret" },
      ),
      reset() {},
    });
    ErrorPage({
      error: Object.assign(
        new Error(
          `ChunkLoadError Loading chunk failed Bearer chunk-effect-secret ${"x".repeat(500)}`,
        ),
        { digest: "Bearer chunk-digest-secret" },
      ),
      reset() {},
    });

    const sensitiveData =
      /route-effect-secret|route-digest-secret|chunk-effect-secret|chunk-digest-secret|private-route-effect\.invalid/i;
    const serializedErrorCalls = JSON.stringify(errorCalls);
    const warningCall = warningCalls[0];
    const warningData = warningCall?.[2];
    payload = {
      effects: effects.length,
      sentryCaptures: sentryCaptures.length,
      errorCallCount: errorCalls.length,
      warningCallCount: warningCalls.length,
      stripCalls,
      reloadCalls,
      networkCalls,
      errorCalls: errorCalls.map(([scope, event, data]) => ({
        scope,
        event,
        dataKeys: data && typeof data === "object" ? Object.keys(data).sort() : [],
      })),
      errorSafety: {
        leaked: sensitiveData.test(serializedErrorCalls),
        stacksBounded:
          errorCalls.length === 2 &&
          errorCalls.every(([, , data]) =>
            typeof data?.stack === "string" && data.stack.length <= 400
          ),
      },
      chunkWarning: {
        scope: warningCall?.[0] ?? null,
        event: warningCall?.[1] ?? null,
        dataKeys:
          warningData && typeof warningData === "object"
            ? Object.keys(warningData).sort()
            : [],
        leaked: sensitiveData.test(JSON.stringify(warningCalls)),
        messageBounded:
          typeof warningData?.message === "string" && warningData.message.length <= 180,
      },
    };
  } finally {
    restoreFetch();
    restoreSessionStorage();
    restoreWindow();
    chunkRecoveryMock.restore();
    loggerMock.restore();
    sentryMock.restore();
    jsxRuntimeMock.restore();
    reactMock.restore();
  }
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

if (ERROR_BOUNDARY_TEST_MODE === "sound-storage-probe") {
  await runSoundStorageProbe();
  process.exit(0);
} else if (ERROR_BOUNDARY_TEST_MODE === "error-catcher-console-probe") {
  await runErrorCatcherConsoleProbe();
  process.exit(0);
} else if (ERROR_BOUNDARY_TEST_MODE === "global-error-console-probe") {
  await runGlobalErrorConsoleProbe();
  process.exit(0);
} else if (ERROR_BOUNDARY_TEST_MODE === "route-error-effect-probe") {
  await runRouteErrorEffectProbe();
  process.exit(0);
} else if (LOGGER_SANITIZER_FAULT_PROBE) {
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

function runIsolatedErrorBoundaryProbe(mode) {
  const result = spawnSync(
    process.execPath,
    [
      "--no-warnings",
      "--experimental-test-module-mocks",
      "--import",
      "tsx",
      fileURLToPath(import.meta.url),
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, ERROR_BOUNDARY_TEST_MODE: mode },
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 512 * 1024,
      windowsHide: true,
    },
  );
  if (result.error || result.signal || result.status !== 0) {
    throw new Error(
      `isolated error-boundary probe ${mode} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  const output = result.stdout.trim().split(/\r?\n/).at(-1);
  if (!output) throw new Error(`isolated error-boundary probe ${mode} returned no output`);
  return JSON.parse(output);
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
  const soundStorageProbe = runIsolatedErrorBoundaryProbe("sound-storage-probe");
  assert.equal(
    soundStorageProbe.removals.filter((key) => key === "lore:sound-settings").length,
    1,
    "sound settings loader must clear corrupt or invalid localStorage entries",
  );
  assert.equal(
    soundStorageProbe.removals.filter((key) => key === "lore:sound-muted").length,
    1,
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
  const errorCatcherProbe = runIsolatedErrorBoundaryProbe("error-catcher-console-probe");
  assert.deepEqual(
    errorCatcherProbe.forwarding,
    {
      count: 1,
      argCount: 2,
      errorName: "Error",
      amount: "42",
      stackBounded: true,
    },
    "ErrorCatcher must forward every console argument only after normalization and sanitization",
  );
  assert.doesNotMatch(
    errorCatcherProbe.serialized,
    /catcher-secret|catcher\.invalid|0x(?:12){20}|0x(?:ab){32}/i,
    "ErrorCatcher console forwarding must redact tokens, provider URLs, addresses, and private keys",
  );
  const globalErrorProbe = runIsolatedErrorBoundaryProbe("global-error-console-probe");
  assert.deepEqual(
    { count: globalErrorProbe.forwardedCount, args: globalErrorProbe.args },
    {
      count: 1,
      args: [
        "[GlobalError]",
        "Error",
        "<redacted> <redacted> wallet=<redacted>",
        "<redacted>",
      ],
    },
    "global error logging must emit only the sanitized error name, message, and digest",
  );
  assert.doesNotMatch(
    globalErrorProbe.serialized,
    /global-probe-secret|global-digest-secret|global-probe\.invalid|0x(?:34){20}/i,
    "global error logging must not expose tokens, provider URLs, wallet addresses, or digest secrets",
  );
  const routeErrorEffectProbe = runIsolatedErrorBoundaryProbe("route-error-effect-probe");
  assert.deepEqual(
    {
      effects: routeErrorEffectProbe.effects,
      sentryCaptures: routeErrorEffectProbe.sentryCaptures,
      errorCallCount: routeErrorEffectProbe.errorCallCount,
      warningCallCount: routeErrorEffectProbe.warningCallCount,
      stripCalls: routeErrorEffectProbe.stripCalls,
      reloadCalls: routeErrorEffectProbe.reloadCalls,
      networkCalls: routeErrorEffectProbe.networkCalls,
    },
    {
      effects: 2,
      sentryCaptures: 2,
      errorCallCount: 2,
      warningCallCount: 1,
      stripCalls: 2,
      reloadCalls: 1,
      networkCalls: 0,
    },
    "route error effects must execute once per error without external network access",
  );
  assert.deepEqual(
    routeErrorEffectProbe.errorCalls,
    [
      {
        scope: "ErrorBoundary",
        event: "route render error",
        dataKeys: ["digest", "message", "name", "stack"],
      },
      {
        scope: "ErrorBoundary",
        event: "route render error",
        dataKeys: ["digest", "message", "name", "stack"],
      },
    ],
    "route error effects must send the bounded support payload through the intended logger event",
  );
  assert.deepEqual(
    routeErrorEffectProbe.errorSafety,
    { leaked: false, stacksBounded: true },
    "route error logs must redact hostile error fields and bound stacks before logging",
  );
  assert.deepEqual(
    routeErrorEffectProbe.chunkWarning,
    {
      scope: "ErrorBoundary",
      event: "chunk route error detected, reloading page once",
      dataKeys: ["message"],
      leaked: false,
      messageBounded: true,
    },
    "chunk route warnings must expose only a sanitized message bounded to 180 characters",
  );
  const adminOpsRouteSource = readFileSync("app/api/admin/ops/route.ts", "utf8");
  assert.doesNotMatch(
    adminOpsRouteSource,
    /type LogSourceSummary = \{[\s\S]*\n\s*file:\s*string;/,
    "admin ops log source responses must not expose absolute server log paths",
  );
  const hostileRenderError = Object.assign(
    new Error("Bearer render-secret https://private-render.invalid/path"),
    { digest: "private-render-digest" },
  );
  const routeErrorPageModule = await import("../app/error.tsx");
  const globalErrorPageModule = await import("../app/global-error.tsx");
  const RouteErrorPage = routeErrorPageModule.default ?? routeErrorPageModule;
  const GlobalErrorPage = globalErrorPageModule.default ?? globalErrorPageModule;
  const routeErrorMarkup = renderToStaticMarkup(React.createElement(RouteErrorPage, {
    error: hostileRenderError,
    reset: () => undefined,
  }));
  const routeErrorButtons = [...routeErrorMarkup.matchAll(/<button\b[^>]*>/g)].map(([tag]) => tag);
  assert.equal(routeErrorButtons.length, 2, "route error boundary must render two recovery actions");
  assert.equal(
    routeErrorButtons.filter((tag) => /\bmin-h-11\b/.test(tag)).length,
    2,
    "route error boundary recovery actions must keep 44px touch targets",
  );
  assert.match(routeErrorMarkup, />Try again<\/button>/);
  assert.match(routeErrorMarkup, />Hard reload<\/button>/);
  assert.doesNotMatch(routeErrorMarkup, /render-secret|private-render|private-render-digest/i);

  const globalErrorMarkup = renderToStaticMarkup(React.createElement(GlobalErrorPage, {
    error: hostileRenderError,
    reset: () => undefined,
  }));
  const globalErrorButtons = [...globalErrorMarkup.matchAll(/<button\b[^>]*>/g)].map(([tag]) => tag);
  assert.equal(globalErrorButtons.length, 2, "global error boundary must render two recovery actions");
  assert.equal(
    globalErrorButtons.filter((tag) => /min-height:44px/.test(tag)).length,
    2,
    "global error boundary recovery actions must keep 44px touch targets",
  );
  assert.match(globalErrorMarkup, />Try again<\/button>/);
  assert.match(globalErrorMarkup, />Hard reload<\/button>/);
  assert.doesNotMatch(globalErrorMarkup, /render-secret|private-render|private-render-digest/i);
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
