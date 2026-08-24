import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import * as runtimeMonitor from "./monitor-runtime-health.mjs";
import * as runtimeMonitorLib from "./runtime-monitor-lib.mjs";
import { runRuntimeMonitorAlertTests } from "./test-business-runtime-monitor-alerts.mjs";
import { runHttpSmokeBoundaryTests } from "./test-business-http-smoke-boundaries.mjs";

function createBodyResponse(body, { contentLength = null, ok = true, status = 200 } = {}) {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
  let delivered = false;
  let cancelled = false;
  return {
    ok,
    status,
    headers: {
      get(name) {
        return name.toLowerCase() === "content-length" ? contentLength : null;
      },
    },
    body: {
      getReader() {
        return {
          async read() {
            if (delivered) return { done: true, value: undefined };
            delivered = true;
            return { done: false, value: bytes };
          },
          async cancel() {
            cancelled = true;
          },
        };
      },
    },
    wasCancelled() {
      return cancelled;
    },
  };
}

export async function runRuntimeMonitorBoundaryTests() {
  const deliveryCalls = [];
  const fallbackDelivered = await runtimeMonitor.deliverRuntimeAlert([
    {
      async send() {
        deliveryCalls.push("rejected");
        throw new Error("synthetic channel outage");
      },
    },
    {
      async send(message, key, cooldownMs) {
        deliveryCalls.push({ message, key, cooldownMs });
        return true;
      },
    },
  ], "ALERT: synthetic", "runtime-synthetic", 1_000);
  assert.equal(fallbackDelivered, true, "one rejected channel must not suppress a successful fallback channel");
  assert.deepEqual(deliveryCalls, [
    "rejected",
    { message: "ALERT: synthetic", key: "runtime-synthetic", cooldownMs: 1_000 },
  ]);
  assert.equal(
    await runtimeMonitor.deliverRuntimeAlert([{ send: async () => false }], "ALERT", "all-failed", 0),
    false,
    "the monitor must report delivery failure when no channel succeeds",
  );

  for (const alias of ["mainnet", "main", "linea", "prod", "production", " ProD "]) {
    assert.equal(runtimeMonitor.normalizeMonitorNetwork(alias), "mainnet");
  }
  for (const alias of [undefined, "", "sepolia", "preview", "production-like"]) {
    assert.equal(runtimeMonitor.normalizeMonitorNetwork(alias), "sepolia");
  }

  const tempRoot = mkdtempSync(join(tmpdir(), "lore-runtime-monitor-boundaries-"));
  try {
    const directoryPath = join(tempRoot, "artifact-directory");
    mkdirSync(directoryPath);
    assert.throws(() => runtimeMonitorLib.readBoundedTextTail(directoryPath), /must be a file/);
    assert.throws(() => runtimeMonitorLib.readBoundedJsonFile(directoryPath), /must be a file/);
    assert.deepEqual([...runtimeMonitorLib.loadRuntimeIssueState(directoryPath)], []);

    const textPath = join(tempRoot, "tail.log");
    writeFileSync(textPath, `discarded-prefix\n${"z".repeat(32)}`, "utf8");
    assert.equal(runtimeMonitorLib.readBoundedTextTail(textPath, 8), "z".repeat(8));

    const oversizedJsonPath = join(tempRoot, "oversized.json");
    writeFileSync(oversizedJsonPath, `{"value":"${"x".repeat(1_024)}"}`, "utf8");
    assert.throws(() => runtimeMonitorLib.readBoundedJsonFile(oversizedJsonPath, 32), /exceeds size limit/);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }

  assert.equal(runtimeMonitorLib.normalizeAlertTimestampMs(0), 0);
  assert.equal(runtimeMonitorLib.normalizeAlertTimestampMs(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
  for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "1000", null]) {
    assert.equal(runtimeMonitorLib.normalizeAlertTimestampMs(value), null);
  }
  assert.equal(runtimeMonitorLib.normalizeAlertCooldownMs(0), 0);
  for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, "1000", null]) {
    assert.equal(runtimeMonitorLib.normalizeAlertCooldownMs(value), 300_000);
  }

  let invalidClockFetches = 0;
  const invalidClockSenders = [
    runtimeMonitorLib.createTelegramAlertSender({
      env: { ALERT_TELEGRAM_BOT_TOKEN: "synthetic", ALERT_TELEGRAM_CHAT_ID: "1" },
      fetchImpl: async () => {
        invalidClockFetches += 1;
        return { ok: true };
      },
      now: () => Number.NaN,
    }),
    runtimeMonitorLib.createResendAlertSender({
      env: {
        RESEND_API_KEY: "re_synthetic",
        RUNTIME_MONITOR_EMAIL_FROM: "alerts@playlore.xyz",
        RUNTIME_MONITOR_EMAIL_TO: "ops@playlore.xyz",
      },
      fetchImpl: async () => {
        invalidClockFetches += 1;
        return { ok: true };
      },
      now: () => Number.NaN,
    }),
  ];
  for (const sender of invalidClockSenders) {
    assert.equal(await sender.send("ALERT", "invalid-clock", 0), false);
  }
  assert.equal(invalidClockFetches, 0, "both delivery channels must reject malformed clocks before fetch");

  const nowMs = Date.parse("2026-08-13T10:00:00.000Z");
  assert.equal(
    runtimeMonitorLib.evaluateBackupFreshness({ mtimeMs: "1e3", bytes: "1" }, { nowMs })[0]?.key,
    "sqlite-backup-invalid",
  );
  assert.equal(
    runtimeMonitorLib.evaluateChainIndexerAudit({
      generatedAt: "2026-08-13 09:59:59Z",
      status: "pass",
      mismatches: [],
    }, { nowMs })[0]?.key,
    "chain-indexer-audit-invalid",
    "broadly Date.parse-able but non-canonical evidence timestamps must fail closed",
  );

  await runRuntimeMonitorAlertTests();

  assert.equal(runtimeMonitor.isFinalHttpsOrigin("https://playlore.xyz"), true);
  for (const origin of [
    "http://playlore.xyz",
    "https://user:pass@playlore.xyz",
    "https://singlelabel",
    "https://localhost",
    "https://service.local",
    "https://127.0.0.1",
    "https://10.0.0.1",
    "https://100.64.0.1",
    "https://169.254.1.1",
    "https://172.16.0.1",
    "https://192.168.0.1",
    "https://192.0.2.1",
    "https://198.51.100.1",
    "https://203.0.113.1",
    "https://service.example",
    "https://service.test",
    "https://service.invalid",
    "https://[2001:db8::1]",
    "https://playlore.xyz/path",
    "https://playlore.xyz?query=1",
    "https://playlore.xyz#fragment",
  ]) {
    assert.equal(runtimeMonitor.isFinalHttpsOrigin(origin), false, `unsafe monitor origin must fail: ${origin}`);
  }
  assert.equal(runtimeMonitor.isRuntimeMonitorOrigin("http://localhost:3000"), true);
  for (const origin of [
    "http://user:pass@localhost:3000",
    "http://localhost:3000/path",
    "http://localhost:3000?query=1",
    "http://localhost:3000#fragment",
  ]) {
    assert.equal(runtimeMonitor.isRuntimeMonitorOrigin(origin), false);
  }

  assert.equal(runtimeMonitor.parseContentLengthHeader(null), null);
  assert.equal(runtimeMonitor.parseContentLengthHeader("0"), 0);
  assert.equal(runtimeMonitor.parseContentLengthHeader("42"), 42);
  for (const value of ["01", "1e3", "+1", "-1", " 1", "9007199254740992", "99999999999999999"]) {
    assert.throws(() => runtimeMonitor.parseContentLengthHeader(value), /invalid runtime monitor response content-length/);
  }

  let requestedUrl = null;
  let requestedInit = null;
  const fetchedPayload = await runtimeMonitor.fetchRuntimeMonitorJson({
    origin: new URL("https://playlore.xyz"),
    pathname: "/api/health/runtime",
    diagnosticsSecret: "s".repeat(32),
    timeoutMs: 1_000,
    fetchImpl: async (url, init) => {
      requestedUrl = url.toString();
      requestedInit = init;
      return createBodyResponse('{"status":"ok"}', { contentLength: "15" });
    },
  });
  assert.deepEqual(fetchedPayload, { status: "ok" });
  assert.equal(requestedUrl, "https://playlore.xyz/api/health/runtime");
  assert.equal(requestedInit?.redirect, "error");
  assert.equal(requestedInit?.headers?.["x-health-diagnostics-secret"], "s".repeat(32));

  let unboundedJsonCalled = false;
  const boundedResponse = createBodyResponse('{"ok":true}');
  boundedResponse.json = async () => {
    unboundedJsonCalled = true;
    throw new Error("response.json must not be called");
  };
  assert.deepEqual(await runtimeMonitor.readBoundedJsonResponse(boundedResponse), { ok: true });
  assert.equal(unboundedJsonCalled, false);

  const headerOversizeResponse = createBodyResponse("{}", { contentLength: String(256 * 1024 + 1) });
  await assert.rejects(() => runtimeMonitor.readBoundedJsonResponse(headerOversizeResponse), /body too large/);
  const streamedOversizeResponse = createBodyResponse(new Uint8Array(256 * 1024 + 1));
  await assert.rejects(() => runtimeMonitor.readBoundedJsonResponse(streamedOversizeResponse), /body too large/);
  assert.equal(streamedOversizeResponse.wasCancelled(), true, "oversized streamed bodies must be cancelled");
  await assert.rejects(
    () => runtimeMonitor.readBoundedJsonResponse(createBodyResponse(new Uint8Array([0xc3, 0x28]))),
    /encoded data|encoding|UTF-8/i,
  );

  const secretBearingError = new Error(
    `request failed at https://user:password@playlore.xyz/path?token=super-secret ${"x".repeat(700)}`,
  );
  const describedError = runtimeMonitor.describeRuntimeMonitorError(secretBearingError);
  assert.ok(describedError.length <= 500);
  assert.equal(describedError.endsWith("...<truncated>"), true);
  assert.doesNotMatch(describedError, /password|super-secret/);

  const repoRoot = resolve(".");
  const externalBackupDirectory = resolve(repoRoot, "..", "runtime-monitor-backups");
  assert.equal(runtimeMonitor.isBackupDirectoryExternalSafe({
    backupDirectory: externalBackupDirectory,
    repoRoot,
  }), true);
  assert.equal(runtimeMonitor.isBackupDirectoryExternalSafe({
    backupDirectory: resolve(repoRoot, "..evil"),
    repoRoot,
  }), false, "an in-repo child whose name starts with two dots must not be mistaken for a parent traversal");
  assert.equal(runtimeMonitor.isBackupDirectoryExternalSafe({
    backupDirectory: repoRoot,
    repoRoot,
  }), false, "the repository root itself must not be accepted as external backup storage");
  assert.equal(runtimeMonitor.isBackupDirectoryExternalSafe({ backupDirectory: "relative-backups", repoRoot }), false);
  assert.equal(runtimeMonitor.isBackupDirectoryExternalSafe({
    backupDirectory: resolve(repoRoot, "data", "backups"),
    repoRoot,
  }), false);
  assert.equal(runtimeMonitor.isBackupDirectoryExternalSafe({
    backupDirectory: resolve(repoRoot, "data", "backups"),
    allowLocal: true,
    repoRoot,
  }), true);
  if (/^[A-Za-z]:\\/.test(repoRoot)) {
    const alternateDrive = repoRoot[0].toLowerCase() === "c" ? "D" : "C";
    assert.equal(runtimeMonitor.isBackupDirectoryExternalSafe({
      backupDirectory: `${alternateDrive}:\\runtime-monitor-backups`,
      repoRoot,
    }), true, "an absolute backup path on a different drive must count as outside the repository");
  }

  assert.equal(runtimeMonitor.isPositiveSafeIntegerText("1"), true);
  assert.equal(runtimeMonitor.isPositiveSafeIntegerText(String(Number.MAX_SAFE_INTEGER)), true);
  for (const value of ["", "0", "01", "1e3", "+1", "-1", "9007199254740992"]) {
    assert.equal(runtimeMonitor.isPositiveSafeIntegerText(value), false);
  }

  const numericErrors = [];
  assert.equal(runtimeMonitor.parseRuntimeMonitorIntegerValue(
    "RUNTIME_MONITOR_INTERVAL_MS",
    "10000",
    30_000,
    { min: 10_000, max: 86_400_000 },
    numericErrors,
  ), 10_000);
  for (const malformed of ["1e3", "01", "+10000", " 10000 ", "9007199254740992"]) {
    const errors = [];
    assert.equal(runtimeMonitor.parseRuntimeMonitorIntegerValue(
      "RUNTIME_MONITOR_INTERVAL_MS",
      malformed,
      30_000,
      { min: 10_000, max: 86_400_000 },
      errors,
    ), 30_000);
    assert.equal(errors.length, 1, `malformed numeric env must record an error: ${malformed}`);
  }
  assert.deepEqual(numericErrors, []);

  const validSecret = "health-secret-".padEnd(32, "s");
  assert.equal(runtimeMonitor.parseHealthDiagnosticsSecretValue("HEALTH_DIAGNOSTICS_SECRET", validSecret), validSecret);
  for (const malformed of [
    "s".repeat(31),
    "s".repeat(257),
    `${"s".repeat(32)}\n`,
    `${"s".repeat(16)}\u0000${"s".repeat(16)}`,
  ]) {
    const errors = [];
    assert.equal(runtimeMonitor.parseHealthDiagnosticsSecretValue(
      "HEALTH_DIAGNOSTICS_SECRET",
      malformed,
      errors,
    ), "");
    assert.equal(errors.length, 1);
  }

  const healthyPreflight = {
    configErrors: [],
    baseUrl: "https://playlore.xyz",
    diagnosticsSecret: validSecret,
    allowLocal: false,
    alertsConfigured: true,
    allowNoAlerts: false,
    strictProductionLikeMonitor: true,
    resendConfigured: true,
    backupDirectory: externalBackupDirectory,
    backupMaxAgeMsRaw: "60000",
    repoRoot,
    canonicalOrigin: "https://playlore.xyz",
  };
  assert.deepEqual(runtimeMonitor.getRuntimeMonitorMissingConfigFor(healthyPreflight), []);
  assert.ok(runtimeMonitor.getRuntimeMonitorMissingConfigFor({
    ...healthyPreflight,
    resendConfigured: false,
  }).includes("resend-email"));
  assert.ok(runtimeMonitor.getRuntimeMonitorMissingConfigFor({
    ...healthyPreflight,
    backupDirectory: "",
  }).includes("backup-directory"));
  assert.ok(runtimeMonitor.getRuntimeMonitorMissingConfigFor({
    ...healthyPreflight,
    backupMaxAgeMsRaw: "1e3",
  }).includes("backup-max-age"));
  assert.ok(runtimeMonitor.getRuntimeMonitorMissingConfigFor({
    ...healthyPreflight,
    backupDirectory: resolve(repoRoot, "data", "backups"),
  }).includes("external-backup-directory"));
  assert.ok(runtimeMonitor.getRuntimeMonitorMissingConfigFor({
    ...healthyPreflight,
    configErrors: ["synthetic invalid setting"],
  }).includes("invalid-config"));
  assert.ok(runtimeMonitor.getRuntimeMonitorMissingConfigFor({
    ...healthyPreflight,
    alertsConfigured: false,
  }).includes("alert-channel"));
  assert.ok(runtimeMonitor.getRuntimeMonitorMissingConfigFor({
    ...healthyPreflight,
    diagnosticsSecret: "",
  }).includes("health-diagnostics-secret"));
  assert.ok(runtimeMonitor.getRuntimeMonitorMissingConfigFor({
    ...healthyPreflight,
    baseUrl: "http://localhost:3000/path",
    allowLocal: true,
    canonicalOrigin: "http://localhost:3000",
  }).includes("origin-only-base-url"));

  let summaryPolls = 0;
  let summaryStarts = 0;
  const summaryLines = [];
  await runtimeMonitor.runRuntimeMonitorLoop({
    summaryOnlyMode: true,
    validate: () => new URL("https://playlore.xyz"),
    configSummary: () => ({
      status: "pass",
      mode: "runtime-monitor-config",
      missingConfig: [],
      wouldPoll: false,
      wouldSendAlerts: false,
    }),
    pollOnce: async () => {
      summaryPolls += 1;
    },
    onStart: () => {
      summaryStarts += 1;
    },
    logger: { log: (line) => summaryLines.push(JSON.parse(line)) },
  });
  assert.equal(summaryPolls, 0, "summary preflight must not poll health endpoints");
  assert.equal(summaryStarts, 0, "summary preflight must not load state or start the monitor loop");
  assert.deepEqual(summaryLines, [{
    status: "pass",
    mode: "runtime-monitor-config",
    missingConfig: [],
    wouldPoll: false,
    wouldSendAlerts: false,
  }]);

  const broadNumericMutant = (value) => Number(value);
  assert.equal(broadNumericMutant("1e3"), 1_000, "numeric vector must kill broad Number coercion mutants");
  const broadDateMutant = (value) => Date.parse(String(value));
  assert.equal(Number.isFinite(broadDateMutant("2026-08-13 09:59:59Z")), true, "timestamp vector must kill broad Date.parse mutants");
  runHttpSmokeBoundaryTests();
}
