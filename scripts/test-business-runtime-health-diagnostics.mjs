import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as diagnosticsAuthModule from "../app/api/health/_lib/diagnosticsAuth.ts";
import { HTTP_SMOKE_CHECKS } from "./smoke-http.mjs";

const EXECUTABLE_PROBE_ARGUMENT = "--runtime-health-executable-probe";
const ADMIN_OPS_HANDLER_PROBE_ARGUMENT = "--admin-ops-handler-executable-probe";
const EXECUTABLE_PROBE_MODE = Boolean(
  process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url
  && process.argv[2] === EXECUTABLE_PROBE_ARGUMENT,
);
const ADMIN_OPS_HANDLER_PROBE_MODE = Boolean(
  process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url
  && process.argv[2] === ADMIN_OPS_HANDLER_PROBE_ARGUMENT,
);

async function runExecutableRuntimeHealthProbe() {
  const { mock } = await import("node:test");
  const require = createRequire(import.meta.url);
  const diagnosticsAuth = diagnosticsAuthModule.default ?? diagnosticsAuthModule;
  const runtimeMetrics = { "api/probe": { requests: 1, errors: 0 } };
  const runtimeProcess = { pid: 41, uptimeSeconds: 12 };
  let runtimeHealthPublicConfigOptions = null;
  let adminSessionAuthorized = false;
  let adminSessionReads = 0;
  let authorized = false;
  let networkCalls = 0;
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    networkCalls += 1;
    throw new Error("runtime-health executable probe forbids network access");
  };

  try {
    mock.module(new URL("../app/api/_lib/sharedRateLimit.ts", import.meta.url).href, {
      namedExports: { enforceSharedRateLimit: async () => null },
    });
    mock.module(new URL("../app/api/health/_lib/diagnosticsAuth.ts", import.meta.url).href, {
      namedExports: {
        buildRuntimeHealthPublicConfig: (options) => {
          runtimeHealthPublicConfigOptions = options;
          return diagnosticsAuth.buildRuntimeHealthPublicConfig(options);
        },
        isAuthorizedHealthDiagnosticsRequest: async () => authorized,
      },
    });
    mock.module(new URL("../app/api/_lib/adminSession.ts", import.meta.url).href, {
      namedExports: {
        readAdminSession: async () => {
          adminSessionReads += 1;
          return adminSessionAuthorized ? { authorized: true } : null;
        },
      },
    });
    mock.module(new URL("../app/api/_lib/externalRateLimit.ts", import.meta.url).href, {
      namedExports: { hasPublicExternalRateLimitStore: () => true },
    });
    mock.module(new URL("../config/publicConfig.ts", import.meta.url).href, {
      namedExports: { getConfiguredReadOnlyMode: () => true },
    });
    mock.module(new URL("../app/api/_lib/runtimeMetrics.ts", import.meta.url).href, {
      namedExports: {
        getRuntimeMetricsSnapshot: () => runtimeMetrics,
        getRuntimeProcessSnapshot: () => runtimeProcess,
      },
    });
    mock.module(new URL("../app/lib/constants.ts", import.meta.url).href, {
      namedExports: {
        APP_CHAIN_ID: 59144,
        APP_CHAIN_NAME: "Linea",
        CONTRACT_REQUIRES_EPOCH_BOUND_BETS: true,
      },
    });

    const { NextRequest } = await import("next/server");
    const routeModule = await import("../app/api/health/runtime/route.ts?runtime-health-executable-probe");
    const runtimeHealthRoute = routeModule.default ?? routeModule;
    const request = () => new NextRequest("https://health-probe.invalid/api/health/runtime");

    const publicResponse = await runtimeHealthRoute.GET(request());
    const publicBody = await publicResponse.json();
    assert.deepEqual({
      status: publicResponse.status,
      cacheControl: publicResponse.headers.get("cache-control"),
      pragma: publicResponse.headers.get("pragma"),
      expires: publicResponse.headers.get("expires"),
      visibility: publicBody.visibility,
      redacted: publicBody.redacted,
      metrics: publicBody.metrics,
      processPresent: "process" in publicBody,
      publicConfig: {
        chainId: publicBody.publicConfig.chainId,
        readOnlyMode: publicBody.publicConfig.readOnlyMode,
        externalRateLimitConfigured: publicBody.publicConfig.externalRateLimitConfigured,
      },
    }, {
      status: 200,
      cacheControl: "no-store, no-cache, must-revalidate",
      pragma: "no-cache",
      expires: "0",
      visibility: "public",
      redacted: true,
      metrics: {},
      processPresent: false,
      publicConfig: { chainId: 59144, readOnlyMode: true, externalRateLimitConfigured: true },
    });
    assert.ok(runtimeHealthPublicConfigOptions, "runtime health GET must build its public config");
    assert.equal(
      runtimeHealthPublicConfigOptions.env === process.env,
      true,
      "runtime health GET must derive public config from the current process environment",
    );
    assert.deepEqual({
      chainId: runtimeHealthPublicConfigOptions.chainId,
      chainName: runtimeHealthPublicConfigOptions.chainName,
      contractRequiresEpochBoundBets: runtimeHealthPublicConfigOptions.contractRequiresEpochBoundBets,
      readOnlyMode: runtimeHealthPublicConfigOptions.readOnlyMode,
      externalRateLimitConfigured: runtimeHealthPublicConfigOptions.externalRateLimitConfigured,
    }, {
      chainId: 59144,
      chainName: "Linea",
      contractRequiresEpochBoundBets: true,
      readOnlyMode: true,
      externalRateLimitConfigured: true,
    }, "runtime health GET must pass the behavior-tested chain and readiness inputs to public config policy");

    authorized = true;
    const privateResponse = await runtimeHealthRoute.GET(request());
    const privateBody = await privateResponse.json();
    assert.deepEqual({
      status: privateResponse.status,
      cacheControl: privateResponse.headers.get("cache-control"),
      visibility: privateBody.visibility,
      redacted: privateBody.redacted,
      metrics: privateBody.metrics,
      process: privateBody.process,
    }, {
      status: 200,
      cacheControl: "no-store, no-cache, must-revalidate",
      visibility: "private",
      redacted: false,
      metrics: runtimeMetrics,
      process: runtimeProcess,
    });

    const diagnosticsRequest = (providedSecret) => new NextRequest(
      "https://health-probe.invalid/api/health/runtime",
      providedSecret
        ? { headers: { "x-health-diagnostics-secret": providedSecret } }
        : undefined,
    );
    adminSessionAuthorized = false;
    assert.equal(
      await diagnosticsAuth.isAuthorizedHealthDiagnosticsRequest(diagnosticsRequest("h".repeat(32))),
      true,
      "runtime health auth must accept the exact configured diagnostics secret after admin-session validation",
    );
    assert.equal(
      await diagnosticsAuth.isAuthorizedHealthDiagnosticsRequest(diagnosticsRequest("x".repeat(32))),
      false,
      "runtime health auth must reject a wrong diagnostics secret after admin-session validation",
    );
    adminSessionAuthorized = true;
    assert.equal(
      await diagnosticsAuth.isAuthorizedHealthDiagnosticsRequest(diagnosticsRequest(null)),
      true,
      "runtime health auth must accept an authorized admin session without requiring the diagnostics header",
    );
    assert.equal(adminSessionReads, 3, "runtime health auth must validate the admin session before each secret fallback decision");

    mock.module(pathToFileURL(require.resolve("@privy-io/react-auth")).href, {
      namedExports: {
        usePrivy: () => ({ ready: false, authenticated: false, login() {}, logout() {} }),
        useWallets: () => ({ wallets: [] }),
      },
    });
    mock.module("wagmi", {
      namedExports: { useAccount: () => ({ address: undefined }) },
    });
    mock.module("next/dynamic", {
      defaultExport: () => () => null,
    });
    mock.module(new URL("../app/hooks/usePrivyLoginAccessibility.ts", import.meta.url).href, {
      namedExports: {
        PRIVY_LOGIN_ACCESSIBLE_NAME: "Log in",
        usePrivyLoginAccessibility: () => ({
          requestLogin() {},
          uiState: {
            error: null,
            statusAnnouncement: "",
            modalOpen: false,
            busy: false,
            disabled: false,
            buttonText: "Log in",
          },
        }),
      },
    });
    const adminOpsModule = await import("../app/admin/AdminOpsClient.tsx?runtime-health-executable-probe");
    const AdminOpsClient = adminOpsModule.default?.default ?? adminOpsModule.default ?? adminOpsModule;
    const ReadOnlyBettingMode = adminOpsModule.ReadOnlyBettingMode
      ?? adminOpsModule.default?.ReadOnlyBettingMode;
    assert.equal(typeof ReadOnlyBettingMode, "function", "admin ops read-only presenter must be exported");
    assert.deepEqual(
      [undefined, null, false, true].map((value) => renderToStaticMarkup(React.createElement(ReadOnlyBettingMode, { value }))),
      [
        '<b class="text-slate-200">unknown</b>',
        '<b class="text-slate-200">unknown</b>',
        '<b class="text-slate-200">off</b>',
        '<b class="text-slate-200">on</b>',
      ],
      "admin ops must render unavailable runtime health distinctly from explicit read-only on/off values",
    );
    const adminOpsMarkup = renderToStaticMarkup(React.createElement(AdminOpsClient));
    assert.match(
      adminOpsMarkup,
      /Read-only betting:\s*<b[^>]*>unknown<\/b>/,
      "admin ops SSR must not claim betting is writable before runtime health loads",
    );
    assert.equal(networkCalls, 0, "runtime-health route and admin SSR probes must remain hermetic");

    const adminOpsHandlerProbe = spawnSync(
      process.execPath,
      [
        "--no-warnings",
        "--experimental-test-module-mocks",
        "--import",
        "tsx",
        fileURLToPath(import.meta.url),
        ADMIN_OPS_HANDLER_PROBE_ARGUMENT,
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, TSX_DISABLE_CACHE: "1" },
        encoding: "utf8",
        timeout: 30_000,
        maxBuffer: 512 * 1024,
        windowsHide: true,
      },
    );
    if (adminOpsHandlerProbe.signal !== null || adminOpsHandlerProbe.status !== 0) {
      throw new Error(
        `admin ops handler executable probe failed:\n${`${adminOpsHandlerProbe.stdout}\n${adminOpsHandlerProbe.stderr}`.slice(-4_000)}`,
      );
    }
  } finally {
    if (previousFetch) globalThis.fetch = previousFetch;
    else delete globalThis.fetch;
  }
}

async function runAdminOpsHandlerProbe() {
  const { mock } = await import("node:test");
  const require = createRequire(import.meta.url);
  const adminOpsWalletAddress = "0x52908400098527886e0f7030069857d2e4169ee7";
  const personalSignFixtureError = "fixture-provider-error=https://user:password@example.invalid/?token=fixture";
  const sanitizedPersonalSignError = "[sanitized-provider-error]";
  const adminOpsFetchIds = [];
  const adminOpsReadIds = [];
  const adminOpsSanitizerInputs = [];
  const adminOpsWarnings = [];
  const capturedCallbacks = [];
  let hookStateIndex = 0;
  let adminOpsDirectJsonCalls = 0;
  let networkCalls = 0;

  const previousFetch = globalThis.fetch;
  const previousWindow = globalThis.window;
  const previousWarn = console.warn;
  globalThis.fetch = async () => {
    networkCalls += 1;
    throw new Error("admin ops executable probe forbids network access");
  };
  globalThis.window = {
    location: { hostname: "localhost", origin: "http://localhost:3000" },
    setTimeout: () => 1,
    clearTimeout() {},
    setInterval: () => 1,
    clearInterval() {},
  };
  console.warn = (...args) => adminOpsWarnings.push(args);

  try {
    mock.module(pathToFileURL(require.resolve("@privy-io/react-auth")).href, {
      namedExports: {
        usePrivy: () => ({ ready: true, authenticated: true, login() {}, logout() {} }),
        useWallets: () => ({
          wallets: [{
            address: adminOpsWalletAddress,
            async getEthereumProvider() {
              return {
                async request({ method }) {
                  if (method === "personal_sign") throw new Error(personalSignFixtureError);
                  if (method === "eth_sign") return `0x${"a".repeat(130)}`;
                  throw new Error(`Unexpected executable-probe provider method: ${method}`);
                },
              };
            },
          }],
        }),
      },
    });
    mock.module("wagmi", {
      namedExports: { useAccount: () => ({ address: adminOpsWalletAddress }) },
    });
    mock.module("next/dynamic", {
      defaultExport: () => () => null,
    });
    mock.module(new URL("../app/hooks/usePrivyLoginAccessibility.ts", import.meta.url).href, {
      namedExports: {
        PRIVY_LOGIN_ACCESSIBLE_NAME: "Log in",
        usePrivyLoginAccessibility: () => ({
          requestLogin() {},
          uiState: {
            error: null,
            statusAnnouncement: "",
            modalOpen: false,
            busy: false,
            disabled: false,
            buttonText: "Log in",
          },
        }),
      },
    });
    mock.module(new URL("../app/lib/constants.ts", import.meta.url).href, {
      namedExports: { APP_CHAIN_ID: 59144 },
    });
    mock.module(new URL("../app/lib/adminAuth.ts", import.meta.url).href, {
      namedExports: {
        ADMIN_AUTH_WALLET: adminOpsWalletAddress,
        ADMIN_AUTH_WALLET_CONFIGURED: true,
        buildAdminAuthMessage: () => "bounded-admin-auth-message",
        createAdminAuthNonce: () => "bounded-admin-auth-nonce",
        normalizeAdminAuthAddress: (value) => typeof value === "string" ? value.toLowerCase() : "",
      },
    });
    mock.module(new URL("../app/lib/fetchWithTimeout.ts", import.meta.url).href, {
      namedExports: {
        fetchWithTimeout: async (url, init = {}) => {
          const probeId = `${String(init.method ?? "GET").toUpperCase()} ${url}`;
          adminOpsFetchIds.push(probeId);
          return {
            ok: true,
            status: 200,
            probeId,
            json() {
              adminOpsDirectJsonCalls += 1;
              throw new Error("admin ops executable probe forbids direct response.json");
            },
          };
        },
      },
    });
    mock.module(new URL("../app/lib/readJsonResponse.ts", import.meta.url).href, {
      namedExports: {
        readJsonResponse: async (response) => {
          adminOpsReadIds.push(response.probeId);
          if (response.probeId === "GET /api/admin/processes") {
            return {
              processes: {
                indexer: { running: false, pid: null },
                bot: { running: false, pid: null },
              },
            };
          }
          return {};
        },
      },
    });
    mock.module(new URL("../app/lib/sentrySanitize.ts", import.meta.url).href, {
      namedExports: {
        sanitizeSupportLogPayload: (value) => {
          adminOpsSanitizerInputs.push(value);
          return sanitizedPersonalSignError;
        },
      },
    });

    const actualReact = await import("react");
    const reactNamedExports = Object.fromEntries(
      Object.entries(actualReact).filter(([name]) => name !== "default" && name !== "module.exports"),
    );
    Object.assign(reactNamedExports, {
      useCallback: (callback) => {
        capturedCallbacks.push(callback);
        return callback;
      },
      useEffect() {},
      useMemo: (factory) => factory(),
      useRef: (current) => ({ current }),
      useState: (initialValue) => {
        const slot = hookStateIndex;
        hookStateIndex += 1;
        return [slot === 5 ? true : initialValue, () => {}];
      },
    });
    mock.module(pathToFileURL(require.resolve("react")).href, {
      defaultExport: actualReact.default,
      namedExports: reactNamedExports,
    });

    const handlerModule = await import("../app/admin/AdminOpsClient.tsx?runtime-health-handler-probe");
    const normalizedHandlerModule = handlerModule.default ?? handlerModule;
    const AdminOpsHandlerClient = normalizedHandlerModule.default ?? normalizedHandlerModule;
    AdminOpsHandlerClient();
    if (capturedCallbacks.length !== 9) {
      throw new Error(`Expected 9 AdminOps callbacks, received ${capturedCallbacks.length}`);
    }
    for (const callback of capturedCallbacks) {
      await callback("indexer");
    }

    assert.deepEqual(
      {
        sanitizerInputs: adminOpsSanitizerInputs,
        warnings: adminOpsWarnings,
      },
      {
        sanitizerInputs: [personalSignFixtureError],
        warnings: [[
          "[admin-auth] personal_sign fallbacked to eth_sign:",
          sanitizedPersonalSignError,
        ]],
      },
      "admin auth wallet fallback warnings must sanitize provider error text before console output",
    );
    assert.deepEqual(
      {
        callbackCount: capturedCallbacks.length,
        fetchIds: [...new Set(adminOpsFetchIds)].sort(),
        readIds: [...new Set(adminOpsReadIds)].sort(),
        directJsonCalls: adminOpsDirectJsonCalls,
        networkCalls,
      },
      {
        callbackCount: 9,
        fetchIds: [
          "DELETE /api/admin/auth",
          "GET /api/admin/auth",
          "GET /api/admin/ops",
          "GET /api/admin/processes",
          "GET /api/health/data-sync",
          "GET /api/health/runtime",
          "POST /api/admin/auth",
          "POST /api/admin/processes",
        ],
        readIds: [
          "GET /api/admin/ops",
          "GET /api/admin/processes",
          "GET /api/health/data-sync",
          "GET /api/health/runtime",
          "POST /api/admin/auth",
          "POST /api/admin/processes",
        ],
        directJsonCalls: 0,
        networkCalls: 0,
      },
      "admin ops UI handlers must route every current JSON API read through the bounded response helper",
    );
  } finally {
    console.warn = previousWarn;
    if (previousFetch) globalThis.fetch = previousFetch;
    else delete globalThis.fetch;
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
}

if (ADMIN_OPS_HANDLER_PROBE_MODE) {
  await runAdminOpsHandlerProbe();
} else if (EXECUTABLE_PROBE_MODE) {
  await runExecutableRuntimeHealthProbe();
}

export function runRuntimeHealthDiagnosticsTests() {
  const diagnosticsAuth = diagnosticsAuthModule.default ?? diagnosticsAuthModule;
  const adminOpsClientSource = readFileSync("app/admin/AdminOpsClient.tsx", "utf8");

  const configuredPublicConfig = diagnosticsAuth.buildRuntimeHealthPublicConfig({
    env: {
      NODE_ENV: "production",
      NEXT_PUBLIC_PRIVY_APP_ID: "  app-public-id  ",
      RUNTIME_MONITOR_BACKUP_DIR: "D:\\backups",
      RUNTIME_MONITOR_BACKUP_MAX_AGE_MS: "60000",
      RESEND_API_KEY: "re_synthetic",
      RUNTIME_MONITOR_EMAIL_FROM: "LORE <alerts@playlore.xyz>",
      RUNTIME_MONITOR_EMAIL_TO: "ops@playlore.xyz, security@playlore.xyz",
      WEB_REPLICA_COUNT: "2",
      TRUST_PROXY_HEADERS: "1",
      TRUST_PROXY_SECRET: "p".repeat(32),
      ALLOW_WEAK_RATE_LIMIT_IDENTITY: "1",
    },
    chainId: 59144,
    chainName: "Linea",
    contractRequiresEpochBoundBets: true,
    readOnlyMode: true,
    externalRateLimitConfigured: true,
  });
  assert.deepEqual(configuredPublicConfig, {
    chainId: 59144,
    chainName: "Linea",
    privyAppIdConfigured: true,
    privyFallbackActive: false,
    contractRequiresEpochBoundBets: true,
    readOnlyMode: true,
    productionLikeMonitoring: true,
    backupMonitorConfigured: true,
    backupMonitorMaxAgeConfigured: true,
    emailAlertConfigured: true,
    multiReplicaWeb: true,
    externalRateLimitConfigured: true,
    trustedProxyConfigured: true,
    weakRateLimitIdentityAllowed: true,
  }, "runtime health must expose only derived readiness booleans and public chain identity");
  assert.equal("RESEND_API_KEY" in configuredPublicConfig, false, "runtime health must not return alert credentials");
  assert.equal("RUNTIME_MONITOR_EMAIL_TO" in configuredPublicConfig, false, "runtime health must not return recipients");
  assert.equal("TRUST_PROXY_SECRET" in configuredPublicConfig, false, "runtime health must not return proxy credentials");

  const runtimeHealthResponse = {
    headers: new Headers({
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    }),
  };
  const runtimeHealthSmokeCheck = HTTP_SMOKE_CHECKS.find((check) => check.name === "health-runtime");
  if (!runtimeHealthSmokeCheck) throw new Error("health-runtime HTTP smoke check is missing");
  const validateRuntimeHealthPublicConfig = (publicConfig) => runtimeHealthSmokeCheck.assert(
    runtimeHealthResponse,
    JSON.stringify({
      status: "ok",
      visibility: "public",
      redacted: true,
      ts: 1_725_000_000_000,
      metrics: {},
      publicConfig,
    }),
    {
      expectedChainId: 59144,
      expectedChainIdIssues: [],
      expectEpochBoundBets: true,
    },
  );
  assert.equal(
    validateRuntimeHealthPublicConfig(configuredPublicConfig),
    undefined,
    "HTTP smoke must accept complete bounded runtime-health diagnostics",
  );
  assert.throws(
    () => validateRuntimeHealthPublicConfig({ ...configuredPublicConfig, readOnlyMode: "false" }),
    /read-only mode diagnostics/,
    "HTTP smoke must reject non-boolean read-only diagnostics",
  );
  for (const field of ["backupMonitorConfigured", "backupMonitorMaxAgeConfigured"]) {
    assert.throws(
      () => validateRuntimeHealthPublicConfig({ ...configuredPublicConfig, [field]: null }),
      /backup (?:monitoring|freshness) diagnostics/,
      `HTTP smoke must reject malformed ${field}`,
    );
  }
  assert.throws(
    () => validateRuntimeHealthPublicConfig({ ...configuredPublicConfig, emailAlertConfigured: 1 }),
    /email alert diagnostics/,
    "HTTP smoke must reject non-boolean email alert diagnostics",
  );
  for (const field of [
    "externalRateLimitConfigured",
    "trustedProxyConfigured",
    "weakRateLimitIdentityAllowed",
  ]) {
    assert.throws(
      () => validateRuntimeHealthPublicConfig({ ...configuredPublicConfig, [field]: undefined }),
      /(?:external rate-limit|trusted proxy|weak identity) diagnostics/,
      `HTTP smoke must reject malformed ${field}`,
    );
  }
  assert.throws(
    () => validateRuntimeHealthPublicConfig({
      ...configuredPublicConfig,
      contractRequiresEpochBoundBets: false,
    }),
    /stale build without required protected V10 bets/,
    "HTTP smoke must reject stale builds when protected V10 bets are required",
  );

  const failClosedEnvCases = [
    { env: { RUNTIME_MONITOR_EMAIL_TO: "" }, field: "emailAlertConfigured" },
    { env: { RUNTIME_MONITOR_EMAIL_TO: `a@b.co,${"x@b.co,".repeat(10)}z@b.co` }, field: "emailAlertConfigured" },
    { env: { RUNTIME_MONITOR_EMAIL_TO: `ops@playlore.xyz,${"x".repeat(255)}@playlore.xyz` }, field: "emailAlertConfigured" },
    { env: { RUNTIME_MONITOR_EMAIL_TO: "ops@playlore.xyz,,security@playlore.xyz" }, field: "emailAlertConfigured" },
    { env: { WEB_REPLICA_COUNT: "1e3" }, field: "multiReplicaWeb" },
    { env: { WEB_REPLICA_COUNT: "9007199254740992" }, field: "multiReplicaWeb" },
    { env: { TRUST_PROXY_HEADERS: "1", TRUST_PROXY_SECRET: `${"p".repeat(31)}\n` }, field: "trustedProxyConfigured" },
  ];
  for (const { env: override, field } of failClosedEnvCases) {
    const env = {
      RESEND_API_KEY: "re_synthetic",
      RUNTIME_MONITOR_EMAIL_FROM: "LORE <alerts@playlore.xyz>",
      RUNTIME_MONITOR_EMAIL_TO: "ops@playlore.xyz",
      ...override,
    };
    const result = diagnosticsAuth.buildRuntimeHealthPublicConfig({
      env,
      chainId: 59141,
      chainName: "Linea Sepolia",
      contractRequiresEpochBoundBets: true,
      readOnlyMode: false,
      externalRateLimitConfigured: false,
    });
    assert.equal(result[field], false, `runtime health must fail closed for malformed ${field} inputs`);
  }

  assert.equal(diagnosticsAuth.normalizeHealthDiagnosticsSecret("s".repeat(32)), "s".repeat(32));
  for (const value of [null, "s".repeat(31), "s".repeat(257), `${"s".repeat(32)}\ncontrol`]) {
    assert.equal(diagnosticsAuth.normalizeHealthDiagnosticsSecret(value), null);
  }
  const configuredSecret = "health-secret-".padEnd(32, "s");
  assert.equal(
    diagnosticsAuth.matchesHealthDiagnosticsSecret(configuredSecret, configuredSecret),
    true,
    "an exact bounded diagnostics secret must authorize private health data",
  );
  assert.equal(
    diagnosticsAuth.matchesHealthDiagnosticsSecret(configuredSecret, `${configuredSecret.slice(0, -1)}x`),
    false,
    "same-length wrong diagnostics secrets must fail timing-safe equality",
  );
  assert.equal(
    diagnosticsAuth.matchesHealthDiagnosticsSecret(configuredSecret, "x".repeat(2_000)),
    false,
    "oversized provided diagnostics secrets must fail before Buffer comparison",
  );

  const filterEmptyRecipientsMutant = (value) => value.split(",").map((entry) => entry.trim()).filter(Boolean);
  assert.deepEqual(
    filterEmptyRecipientsMutant("ops@playlore.xyz,,security@playlore.xyz"),
    ["ops@playlore.xyz", "security@playlore.xyz"],
    "the malformed-recipient vector must kill a silent-filter fail-open mutant",
  );
  assert.equal(
    diagnosticsAuth.buildRuntimeHealthPublicConfig({
      env: {
        RESEND_API_KEY: "re_synthetic",
        RUNTIME_MONITOR_EMAIL_FROM: "alerts@playlore.xyz",
        RUNTIME_MONITOR_EMAIL_TO: "ops@playlore.xyz,,security@playlore.xyz",
      },
      chainId: 59141,
      chainName: "Linea Sepolia",
      contractRequiresEpochBoundBets: true,
      readOnlyMode: false,
      externalRateLimitConfigured: false,
    }).emailAlertConfigured,
    false,
  );

  const executableProbe = spawnSync(
    process.execPath,
    ["--experimental-test-module-mocks", "--import", "tsx", fileURLToPath(import.meta.url), EXECUTABLE_PROBE_ARGUMENT],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HEALTH_DIAGNOSTICS_SECRET: "h".repeat(32),
      },
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 512 * 1024,
      windowsHide: true,
    },
  );
  assert.equal(executableProbe.signal, null, "runtime-health executable probe must not be killed");
  assert.equal(
    executableProbe.status,
    0,
    `runtime-health executable probe failed:\n${`${executableProbe.stdout}\n${executableProbe.stderr}`.slice(-4_000)}`,
  );
  assert.doesNotMatch(adminOpsClientSource, /\.\s*json\(\)/, "admin ops UI API reads must not use unbounded response.json");
}
