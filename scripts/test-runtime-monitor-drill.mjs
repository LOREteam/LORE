import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  applyRuntimeIssueDeliveryResult,
  createResendAlertSender,
  createTelegramAlertSender,
  evaluateChainIndexerAudit,
  evaluateBackupFreshness,
  evaluateCanaryActivity,
  evaluateCanaryRevertWindow,
  evaluateRuntimeSnapshot,
  loadRuntimeIssueState,
  reconcileRuntimeIssues,
  readBoundedTextTail,
  readBoundedJsonFile,
  readLatestBackupSnapshot,
  saveRuntimeIssueState,
} from "./runtime-monitor-lib.mjs";

const drillDir = path.resolve(process.env.MONITOR_DRILL_DIR || ".tmp/pre-mainnet/monitor-drill");
const statePath = path.join(drillDir, "state.json");
const canaryPath = path.join(drillDir, "canary.jsonl");
const chainAuditPath = path.join(drillDir, "chain-indexer-audit.json");
const artifactDirectoryPath = path.join(drillDir, "artifact-directory");
const backupDir = path.join(drillDir, "backups");
mkdirSync(drillDir, { recursive: true });
rmSync(backupDir, { force: true, recursive: true });
mkdirSync(backupDir, { recursive: true });
rmSync(artifactDirectoryPath, { force: true, recursive: true });
mkdirSync(artifactDirectoryPath, { recursive: true });
rmSync(statePath, { force: true });

const deliveries = [];
let now = Date.UTC(2026, 6, 17, 12);
const sender = createTelegramAlertSender({
  env: {
    ALERT_TELEGRAM_BOT_TOKEN: "test-token",
    ALERT_TELEGRAM_CHAT_ID: "test-chat",
    ALERT_PREFIX: "LORE Monitor Drill",
  },
  now: () => now,
  fetchImpl: async (url, options) => {
    deliveries.push({ url: String(url), body: String(options.body) });
    return { ok: true };
  },
});

const failedDeliveries = [];
const retryingSender = createTelegramAlertSender({
  env: {
    ALERT_TELEGRAM_BOT_TOKEN: "test-token",
    ALERT_TELEGRAM_CHAT_ID: "test-chat",
  },
  now: () => now,
  fetchImpl: async () => {
    failedDeliveries.push(now);
    return { ok: failedDeliveries.length > 1 };
  },
});
assert.equal(await retryingSender.send("retry", "retry-key"), false);
assert.equal(await retryingSender.send("retry", "retry-key"), true, "failed delivery must not consume cooldown");
assert.equal(failedDeliveries.length, 2);
let invalidClockDeliveries = 0;
const invalidClockSender = createTelegramAlertSender({
  env: {
    ALERT_TELEGRAM_BOT_TOKEN: "test-token",
    ALERT_TELEGRAM_CHAT_ID: "test-chat",
  },
  now: () => Number.NaN,
  fetchImpl: async () => {
    invalidClockDeliveries += 1;
    return { ok: true };
  },
});
assert.equal(await invalidClockSender.send("bad clock", "bad-clock-key"), false);
assert.equal(invalidClockDeliveries, 0, "malformed monitor clock must not send alerts");
let cooldownNow = 1_000;
let cooldownDeliveries = 0;
const invalidCooldownSender = createTelegramAlertSender({
  env: {
    ALERT_TELEGRAM_BOT_TOKEN: "test-token",
    ALERT_TELEGRAM_CHAT_ID: "test-chat",
  },
  now: () => cooldownNow,
  fetchImpl: async () => {
    cooldownDeliveries += 1;
    return { ok: true };
  },
});
assert.equal(await invalidCooldownSender.send("first", "cooldown-key", 0), true);
cooldownNow += 1_000;
assert.equal(await invalidCooldownSender.send("second", "cooldown-key", Number.NaN), false);
assert.equal(cooldownDeliveries, 1, "malformed alert cooldown must fall back to the safe default window");

const emailDeliveries = [];
const emailSender = createResendAlertSender({
  env: {
    RESEND_API_KEY: "test-key",
    RUNTIME_MONITOR_EMAIL_TO: "alerts@example.test",
    RUNTIME_MONITOR_EMAIL_FROM: "LORE <alerts@example.test>",
    ALERT_PREFIX: "LORE Monitor Drill",
  },
  now: () => now,
  fetchImpl: async (url, options) => {
    emailDeliveries.push({ url: String(url), options });
    return { ok: true };
  },
});
assert.equal(await emailSender.send("ALERT: test issue", "email-key"), true);
assert.equal(await emailSender.send("ALERT: test issue", "email-key"), false, "email sender must honor cooldown");
assert.equal(emailDeliveries.length, 1);
assert.equal(emailDeliveries[0].url, "https://api.resend.com/emails");
assert.equal(emailDeliveries[0].options.headers.Authorization, "Bearer test-key");
assert.deepEqual(JSON.parse(emailDeliveries[0].options.body), {
  from: "LORE <alerts@example.test>",
  to: ["alerts@example.test"],
  subject: "LORE Monitor Drill: Alert",
  text: "LORE Monitor Drill\nALERT: test issue",
});

const deliveryRetryState = new Map([["alert-key", "Alert message"]]);
applyRuntimeIssueDeliveryResult(
  deliveryRetryState,
  { kind: "alert", key: "alert-key", message: "Alert message" },
  { configured: true, delivered: false },
);
assert.equal(deliveryRetryState.has("alert-key"), false, "failed alert must be eligible on the next poll");
applyRuntimeIssueDeliveryResult(
  deliveryRetryState,
  { kind: "recovery", key: "recovery-key", message: "Recovery message" },
  { configured: true, delivered: false },
);
assert.equal(deliveryRetryState.get("recovery-key"), "Recovery message", "failed recovery must be retried while healthy");

const unhealthy = evaluateRuntimeSnapshot({
  runtime: { status: "degraded", redacted: false, process: { rssBytes: 2_000 } },
  dataSync: {
    status: "degraded",
    redacted: false,
    indexer: { run: { stale: true } },
    storage: { lagToFinalityTargetBlocks: 20, walBytes: 3_000, diskFreeBytes: 500 },
    env: { lagWarnBlocks: 3 },
  },
  liveState: { fetchedAt: 1, currentEpoch: "1", epochEndTime: 1, currentEpochData: ["1", 0, false, false] },
  nowMs: now,
  maxLiveStateAgeMs: 100,
  maxRssBytes: 1_000,
  maxWalBytes: 2_000,
  minDiskFreeBytes: 1_000,
});
assert.ok(unhealthy.length >= 4);
assert.ok(unhealthy.some((issue) => issue.key === "runtime-rss"));
assert.ok(unhealthy.some((issue) => issue.key === "sqlite-wal-size"));
assert.ok(unhealthy.some((issue) => issue.key === "disk-free-space"));
assert.deepEqual(
  evaluateRuntimeSnapshot({
    runtime: { status: "ok", redacted: false, process: { rssBytes: String(900) } },
    dataSync: {
      status: "healthy",
      redacted: false,
      indexer: { run: { stale: false } },
      storage: { lagToFinalityTargetBlocks: "2", walBytes: "100", diskFreeBytes: "2000" },
      env: { lagWarnBlocks: "3" },
    },
    liveState: { fetchedAt: String(now), currentEpoch: "1", epochEndTime: "9999999999", currentEpochData: ["0", 0, false, false] },
    nowMs: now,
    maxLiveStateAgeMs: 100,
    maxRssBytes: "1000",
    maxWalBytes: "2000",
    minDiskFreeBytes: "1000",
  }),
  [],
  "canonical integer telemetry strings must remain compatible",
);
assert.deepEqual(
  evaluateRuntimeSnapshot({
    runtime: { status: "ok", redacted: false },
    dataSync: { status: "healthy", redacted: false },
    liveState: { fetchedAt: String(now), currentEpoch: "1", epochEndTime: "9999999999", currentEpochData: ["0", 0, false, false] },
    nowMs: Number.NaN,
  }).map((issue) => issue.key),
  ["runtime-snapshot-invalid"],
  "malformed runtime snapshot monitor clock must fail closed",
);
assert.deepEqual(
  evaluateRuntimeSnapshot({
    runtime: { status: "ok", redacted: false },
    dataSync: { status: "healthy", redacted: false },
    liveState: { fetchedAt: String(now - 60_000), currentEpoch: "1", epochEndTime: "9999999999", currentEpochData: ["0", 0, false, false] },
    nowMs: now,
    maxLiveStateAgeMs: Number.NaN,
  }),
  [],
  "malformed live-state max age must fall back to the safe default freshness window",
);
assert.deepEqual(
  evaluateRuntimeSnapshot({
    runtime: { status: "ok", redacted: false },
    dataSync: { status: "healthy", redacted: false },
    liveState: { fetchedAt: String(now + 120_000), currentEpoch: "1", epochEndTime: "9999999999", currentEpochData: ["0", 0, false, false] },
    nowMs: now,
    maxLiveStateAgeMs: 300_000,
  }).map((issue) => issue.key),
  ["live-state-stale"],
  "future live-state fetchedAt outside clock-skew tolerance must not count as fresh",
);
assert.deepEqual(
  evaluateRuntimeSnapshot({
    runtime: { status: "ok", redacted: false },
    dataSync: { status: "healthy", redacted: false },
    liveState: {
      fetchedAt: String(now),
      currentEpoch: "2",
      epochEndTime: String((now - 121_000) / 1000),
      currentEpochData: ["1", 0, false, false],
    },
    nowMs: now,
    stuckGraceMs: Number.NaN,
  }).map((issue) => issue.key),
  ["stuck-non-empty-epoch"],
  "malformed stuck-epoch grace window must fall back to the safe default",
);
const malformedTelemetryIssues = evaluateRuntimeSnapshot({
  runtime: { status: "ok", redacted: false, process: { rssBytes: "1e3" } },
  dataSync: {
    status: "healthy",
    redacted: false,
    indexer: { run: { stale: false } },
    storage: { lagToFinalityTargetBlocks: "04", walBytes: "100.5", diskFreeBytes: "2000" },
    env: { lagWarnBlocks: "3" },
  },
  liveState: { fetchedAt: "1e3", currentEpoch: "1", epochEndTime: "9999999999", currentEpochData: ["0", 0, false, false] },
  nowMs: now,
  maxLiveStateAgeMs: 100,
  maxRssBytes: "1000",
  maxWalBytes: "2000",
  minDiskFreeBytes: "1000",
});
assert.deepEqual(
  malformedTelemetryIssues.map((issue) => issue.key),
  ["live-state-stale"],
  "malformed runtime telemetry numbers must not become freshness, lag, or threshold evidence",
);
writeFileSync(canaryPath, [0, 1, 2].map((round) => JSON.stringify({
  timestamp: new Date(now - round * 1_000).toISOString(),
  txStatus: "reverted",
  hash: `0x${String(round + 1).repeat(64)}`,
  round,
})).join("\n") + "\n");
const canaryIssues = evaluateCanaryRevertWindow(readBoundedTextTail(canaryPath), {
  nowMs: now,
  windowMs: 60_000,
  threshold: 3,
});
assert.deepEqual(canaryIssues.map((issue) => issue.key), ["canary-reverted-tx-series"]);
unhealthy.push(...canaryIssues);
assert.deepEqual(
  evaluateCanaryRevertWindow(readBoundedTextTail(canaryPath), {
    nowMs: now,
    windowMs: Number.NaN,
    threshold: 0,
  }).map((issue) => issue.key),
  ["canary-reverted-tx-series"],
  "malformed canary revert threshold/window must fall back to safe defaults instead of disabling alerts",
);
assert.deepEqual(
  evaluateCanaryRevertWindow(readBoundedTextTail(canaryPath), {
    nowMs: Number.NaN,
    windowMs: 60_000,
    threshold: 3,
  }).map((issue) => issue.key),
  ["canary-log-invalid"],
  "malformed canary revert monitor clock must fail closed as invalid canary evidence",
);
assert.deepEqual(
  evaluateCanaryRevertWindow(JSON.stringify({
    timestamp: "2026-07-17 12:00:00",
    txStatus: "reverted",
    hash: `0x${"f".repeat(64)}`,
    round: 1,
  }), { nowMs: now, windowMs: 60_000, threshold: 1 }),
  [],
  "non-ISO canary revert timestamps must not become revert-window evidence",
);
assert.deepEqual(
  evaluateCanaryRevertWindow(JSON.stringify({
    timestamp: "2026-02-31T00:00:00.000Z",
    txStatus: "reverted",
    hash: `0x${"e".repeat(64)}`,
    round: 1,
  }), { nowMs: now, windowMs: 60_000, threshold: 1 }),
  [],
  "impossible canary revert dates must not become revert-window evidence",
);
assert.deepEqual(evaluateCanaryActivity(readBoundedTextTail(canaryPath), {
  nowMs: now,
  maxAgeMs: 60_000,
}), []);
assert.deepEqual(evaluateCanaryActivity(JSON.stringify({
  timestamp: new Date(now - 120_000).toISOString(),
  mode: "epoch-wait",
  round: 1,
}), { nowMs: now, maxAgeMs: 60_000 }).map((issue) => issue.key), ["canary-log-stale"]);
assert.deepEqual(evaluateCanaryActivity(JSON.stringify({
  timestamp: new Date(now).toISOString(),
  mode: "epoch-wait",
  round: 1,
}), { nowMs: Number.NaN, maxAgeMs: 60_000 }).map((issue) => issue.key), ["canary-log-invalid"], "malformed canary activity monitor clock must fail closed");
assert.deepEqual(evaluateCanaryActivity(JSON.stringify({
  timestamp: new Date(now - 120_000).toISOString(),
  mode: "epoch-wait",
  round: 1,
}), { nowMs: now, maxAgeMs: Number.NaN }), [], "malformed canary activity max age must fall back to the safe default window");
assert.deepEqual(evaluateCanaryActivity(JSON.stringify({
  timestamp: "2026-07-17 12:00:00",
  mode: "epoch-wait",
  round: 1,
}), { nowMs: now, maxAgeMs: 60_000 }).map((issue) => issue.key), ["canary-log-invalid"], "non-ISO canary activity timestamps must not become freshness evidence");
assert.deepEqual(evaluateCanaryActivity(JSON.stringify({
  timestamp: "2026-02-31T00:00:00.000Z",
  mode: "epoch-wait",
  round: 1,
}), { nowMs: now, maxAgeMs: 60_000 }).map((issue) => issue.key), ["canary-log-invalid"], "impossible canary activity dates must not become freshness evidence");
assert.deepEqual(evaluateCanaryActivity(JSON.stringify({
  timestamp: new Date(now - 120_000).toISOString(),
  mode: "summary",
  round: 50,
  targetRounds: 50,
  failures: 0,
}), { nowMs: now, maxAgeMs: 60_000 }), []);
assert.deepEqual(evaluateCanaryActivity(JSON.stringify({
  timestamp: new Date(now).toISOString(),
  mode: "summary",
  round: 50,
  targetRounds: 50,
  failures: 2,
}), { nowMs: now }).map((issue) => issue.key), ["canary-completed-with-failures"]);
assert.deepEqual(evaluateCanaryActivity(JSON.stringify({
  timestamp: new Date(now).toISOString(),
  mode: "summary",
  round: "50",
  targetRounds: 50,
  failures: 0,
}), { nowMs: now, maxAgeMs: 60_000 }).map((issue) => issue.key), [], "string summary round must not count as completed canary success");
assert.deepEqual(evaluateCanaryActivity(JSON.stringify({
  timestamp: new Date(now).toISOString(),
  mode: "summary",
  round: 50,
  targetRounds: 50,
  failures: "0",
}), { nowMs: now }).map((issue) => issue.key), ["canary-log-invalid"], "malformed summary failure count must fail closed");

writeFileSync(chainAuditPath, JSON.stringify({
  generatedAt: new Date(now).toISOString(),
  status: "fail",
  mismatches: [{ kind: "resolve" }, { kind: "bet" }],
}));
const chainAuditIssues = evaluateChainIndexerAudit(readBoundedJsonFile(chainAuditPath), { nowMs: now });
assert.deepEqual(chainAuditIssues.map((issue) => issue.key), ["chain-indexer-audit-mismatch"]);
unhealthy.push(...chainAuditIssues);
assert.deepEqual(evaluateChainIndexerAudit({
  generatedAt: new Date(now).toISOString(),
  status: "pass",
  mismatches: [],
}, { nowMs: now }), []);
assert.deepEqual(evaluateChainIndexerAudit({
  generatedAt: new Date(now).toISOString(),
  status: "pass",
  mismatches: [],
}, { nowMs: Number.NaN }).map((issue) => issue.key), ["chain-indexer-audit-invalid"], "malformed chain/indexer audit monitor clock must fail closed");
assert.deepEqual(evaluateChainIndexerAudit({
  generatedAt: new Date(now - 120_000).toISOString(),
  status: "pass",
  mismatches: [],
}, { nowMs: now, maxAgeMs: Number.NaN }), [], "malformed chain/indexer audit max age must fall back to the safe default window");
assert.deepEqual(evaluateChainIndexerAudit({
  generatedAt: "2026-07-17 12:00:00",
  status: "pass",
  mismatches: [],
}, { nowMs: now }).map((issue) => issue.key), ["chain-indexer-audit-invalid"], "non-ISO chain/indexer audit timestamps must not become freshness evidence");
assert.deepEqual(evaluateChainIndexerAudit({
  generatedAt: "2026-02-31T00:00:00.000Z",
  status: "pass",
  mismatches: [],
}, { nowMs: now }).map((issue) => issue.key), ["chain-indexer-audit-invalid"], "impossible chain/indexer audit dates must not become freshness evidence");
const feeAccrualAudit = {
  generatedAt: new Date(now).toISOString(),
  status: "pass",
  mismatches: [],
  accounting: {
    actualEnd: {
      accruedOwnerFees: "40",
      accruedBurnFees: "61",
    },
  },
};
assert.deepEqual(evaluateChainIndexerAudit(feeAccrualAudit, {
  nowMs: now,
  maxAccruedProtocolFeesWei: 100n,
}).map((issue) => issue.key), ["protocol-fees-accrued"]);
assert.deepEqual(evaluateChainIndexerAudit(feeAccrualAudit, {
  nowMs: now,
  maxAccruedProtocolFeesWei: 101n,
}), []);
assert.deepEqual(evaluateChainIndexerAudit({
  generatedAt: new Date(now).toISOString(),
  status: "pass",
  mismatches: [],
}, {
  nowMs: now,
  maxAccruedProtocolFeesWei: 100n,
}).map((issue) => issue.key), ["chain-indexer-audit-invalid"]);
assert.deepEqual(evaluateChainIndexerAudit({
  generatedAt: new Date(now - 7_200_000).toISOString(),
  status: "pass",
  mismatches: [],
}, { nowMs: now, maxAgeMs: 3_600_000 }).map((issue) => issue.key), ["chain-indexer-audit-stale"]);
assert.deepEqual(evaluateChainIndexerAudit({ status: "pass", mismatches: [] }, { nowMs: now })
  .map((issue) => issue.key), ["chain-indexer-audit-invalid"]);
writeFileSync(chainAuditPath, "x".repeat(128 * 1024 + 1));
assert.throws(() => readBoundedJsonFile(chainAuditPath), /exceeds size limit/);
assert.throws(() => readBoundedJsonFile(artifactDirectoryPath), /JSON artifact must be a file/);
assert.throws(() => readBoundedTextTail(artifactDirectoryPath), /Text artifact must be a file/);

writeFileSync(path.join(backupDir, "operator-note.txt"), "not a backup", "utf8");
assert.deepEqual(evaluateBackupFreshness(readLatestBackupSnapshot(backupDir), { nowMs: now })
  .map((issue) => issue.key), ["sqlite-backup-missing"]);
const staleBackupPath = path.join(backupDir, "lore-backup-2026-01-01T00-00-00-000Z.sqlite");
writeFileSync(staleBackupPath, "backup", "utf8");
utimesSync(staleBackupPath, new Date(now - 48 * 60 * 60 * 1000), new Date(now - 48 * 60 * 60 * 1000));
const staleBackupIssues = evaluateBackupFreshness(readLatestBackupSnapshot(backupDir), {
  nowMs: now,
  maxAgeMs: 36 * 60 * 60 * 1000,
});
assert.deepEqual(staleBackupIssues.map((issue) => issue.key), ["sqlite-backup-stale"]);
unhealthy.push(...staleBackupIssues);
assert.deepEqual(
  evaluateBackupFreshness({ mtimeMs: String(now), bytes: "1024" }, { nowMs: now }),
  [],
  "canonical integer backup metadata strings must remain compatible",
);
assert.deepEqual(
  evaluateBackupFreshness({ mtimeMs: String(now), bytes: "1024" }, { nowMs: Number.NaN })
    .map((issue) => issue.key),
  ["sqlite-backup-invalid"],
  "malformed backup freshness monitor clock must fail closed",
);
assert.deepEqual(
  evaluateBackupFreshness({ mtimeMs: String(now - 120_000), bytes: "1024" }, {
    nowMs: now,
    maxAgeMs: Number.NaN,
  }),
  [],
  "malformed backup freshness max age must fall back to the safe default window",
);
for (const malformedBackupSnapshot of [
  { mtimeMs: "1e3", bytes: "1024" },
  { mtimeMs: "01", bytes: "1024" },
  { mtimeMs: String(now), bytes: "100.5" },
  { mtimeMs: String(now), bytes: "0" },
]) {
  assert.deepEqual(
    evaluateBackupFreshness(malformedBackupSnapshot, { nowMs: now }).map((issue) => issue.key),
    ["sqlite-backup-invalid"],
    `malformed backup metadata ${JSON.stringify(malformedBackupSnapshot)} must fail closed`,
  );
}
const freshBackupPath = path.join(backupDir, "lore-backup-2026-07-17T00-00-00-000Z.sqlite");
writeFileSync(freshBackupPath, "backup", "utf8");
utimesSync(freshBackupPath, new Date(now), new Date(now));
assert.deepEqual(evaluateBackupFreshness(readLatestBackupSnapshot(backupDir), { nowMs: now }), []);

const duplicateHashEvent = JSON.stringify({
  timestamp: new Date(now).toISOString(),
  txStatus: "reverted",
  hash: `0x${"a".repeat(64)}`,
  round: 10,
});
assert.deepEqual(
  evaluateCanaryRevertWindow(`${duplicateHashEvent}\n${duplicateHashEvent}\n{`, {
    nowMs: now,
    windowMs: 60_000,
    threshold: 2,
  }),
  [],
  "duplicate hashes and partial JSONL lines must not create a revert series",
);
const staleEvents = [0, 1, 2].map((round) => JSON.stringify({
  timestamp: new Date(now - 120_000).toISOString(),
  errorKind: "tx-reverted",
  round,
})).join("\n");
assert.deepEqual(
  evaluateCanaryRevertWindow(staleEvents, { nowMs: now, windowMs: 60_000, threshold: 3 }),
  [],
  "reverts outside the configured window must not alert",
);
const simulatedFailures = [0, 1, 2].map((round) => JSON.stringify({
  timestamp: new Date(now).toISOString(),
  errorKind: "revert",
  round,
})).join("\n");
assert.deepEqual(
  evaluateCanaryRevertWindow(simulatedFailures, { nowMs: now, windowMs: 60_000, threshold: 3 }),
  [],
  "pre-submission revert errors must not be reported as signed on-chain reverts",
);

let activeIssues = new Map();
const first = reconcileRuntimeIssues(activeIssues, unhealthy);
assert.equal(first.recoveries.length, 0);
for (const issue of first.alerts) {
  assert.equal(await sender.send(`ALERT: ${issue.message}`, `runtime-${issue.key}`), true);
}
saveRuntimeIssueState(statePath, activeIssues);

activeIssues = loadRuntimeIssueState(statePath);
const afterRestart = reconcileRuntimeIssues(activeIssues, unhealthy);
assert.equal(afterRestart.alerts.length, 0, "monitor restart must not duplicate active alerts");
assert.equal(afterRestart.recoveries.length, 0);

now += 120_000;
const recovered = reconcileRuntimeIssues(activeIssues, []);
assert.equal(recovered.recoveries.length, unhealthy.length);
for (const recovery of recovered.recoveries) {
  assert.equal(await sender.send(`RECOVERED: ${recovery.message}`, `runtime-recovered-${recovery.key}`, 60_000), true);
}
saveRuntimeIssueState(statePath, activeIssues);
assert.equal(loadRuntimeIssueState(statePath).size, 0);

writeFileSync(statePath, JSON.stringify({
  activeIssues: [
    ["valid", "Valid persisted issue."],
    ["", "Empty key."],
    ["k".repeat(81), "Oversized key."],
    ["oversized-message", "m".repeat(501)],
  ],
}));
const sanitized = loadRuntimeIssueState(statePath);
assert.deepEqual([...sanitized.entries()], [["valid", "Valid persisted issue."]]);

writeFileSync(statePath, "x".repeat(128 * 1024 + 1));
assert.equal(loadRuntimeIssueState(statePath).size, 0, "oversized state files must be ignored");
assert.equal(loadRuntimeIssueState(artifactDirectoryPath).size, 0, "directory state paths must be ignored");
assert.equal(deliveries.length, unhealthy.length * 2);
for (const delivery of deliveries) {
  assert.match(delivery.url, /^https:\/\/api\.telegram\.org\/bot[^/]+\/sendMessage$/);
  assert.doesNotMatch(delivery.body, /0x[a-f0-9]{40}|https?:\/\//i);
  const body = new URLSearchParams(delivery.body);
  assert.equal(body.get("chat_id"), "test-chat");
  assert.match(body.get("text") || "", /^(?:LORE Monitor Drill\n)(?:ALERT|RECOVERED):/);
}

const monitorSummaryResult = spawnSync(process.execPath, ["scripts/monitor-runtime-health.mjs", "--summary-only"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: "production",
    LINEA_NETWORK: "sepolia",
    LORE_PREMAINNET_RUNTIME_STRICT: "1",
    RUNTIME_MONITOR_BASE_URL: "https://playlore.xyz",
    HEALTH_DIAGNOSTICS_SECRET: "h".repeat(32),
    RESEND_API_KEY: "re_synthetic",
    RUNTIME_MONITOR_EMAIL_FROM: "LORE <alerts@playlore.xyz>",
    RUNTIME_MONITOR_EMAIL_TO: "playlore88@gmail.com",
    RUNTIME_MONITOR_BACKUP_DIR: path.join(path.parse(process.cwd()).root, "lore-monitor-backups"),
    RUNTIME_MONITOR_BACKUP_MAX_AGE_MS: "129600000",
  },
  encoding: "utf8",
});
assert.equal(monitorSummaryResult.status, 0, monitorSummaryResult.stderr);
const monitorSummary = JSON.parse(monitorSummaryResult.stdout);
assert.deepEqual(
  {
    status: monitorSummary.status,
    mode: monitorSummary.mode,
    strictProductionLike: monitorSummary.strictProductionLike,
    resendConfigured: monitorSummary.resendConfigured,
    backupConfigured: monitorSummary.backupConfigured,
    backupMaxAgeConfigured: monitorSummary.backupMaxAgeConfigured,
    wouldPoll: monitorSummary.wouldPoll,
    wouldSendAlerts: monitorSummary.wouldSendAlerts,
  },
  {
    status: "pass",
    mode: "runtime-monitor-config",
    strictProductionLike: true,
    resendConfigured: true,
    backupConfigured: true,
    backupMaxAgeConfigured: true,
    wouldPoll: false,
    wouldSendAlerts: false,
  },
);

const repoLocalBackupSummaryResult = spawnSync(process.execPath, ["scripts/monitor-runtime-health.mjs", "--summary-only"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: "production",
    LINEA_NETWORK: "sepolia",
    LORE_PREMAINNET_RUNTIME_STRICT: "1",
    RUNTIME_MONITOR_BASE_URL: "https://playlore.xyz",
    HEALTH_DIAGNOSTICS_SECRET: "h".repeat(32),
    RESEND_API_KEY: "re_synthetic",
    RUNTIME_MONITOR_EMAIL_FROM: "LORE <alerts@playlore.xyz>",
    RUNTIME_MONITOR_EMAIL_TO: "playlore88@gmail.com",
    RUNTIME_MONITOR_BACKUP_DIR: path.join(process.cwd(), ".tmp", "monitor-backups"),
    RUNTIME_MONITOR_BACKUP_MAX_AGE_MS: "129600000",
  },
  encoding: "utf8",
});
assert.equal(repoLocalBackupSummaryResult.status, 1, repoLocalBackupSummaryResult.stderr);
const repoLocalBackupSummary = JSON.parse(repoLocalBackupSummaryResult.stdout);
assert.equal(repoLocalBackupSummary.status, "fail");
assert.deepEqual(repoLocalBackupSummary.missingConfig, ["external-backup-directory"]);
assert.equal(repoLocalBackupSummary.backupConfigured, true);
assert.equal(repoLocalBackupSummary.wouldPoll, false);
assert.equal(repoLocalBackupSummary.wouldSendAlerts, false);
assert.doesNotMatch(
  repoLocalBackupSummaryResult.stdout,
  /C:\\|https?:\/\/|re_synthetic|playlore88@gmail\.com|alerts@playlore\.xyz/i,
  "runtime monitor summary failures must not print local paths, endpoints, or alert config details",
);

const localPathBaseUrlSummaryResult = spawnSync(process.execPath, ["scripts/monitor-runtime-health.mjs", "--summary-only"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: "development",
    LINEA_NETWORK: "sepolia",
    RUNTIME_MONITOR_ALLOW_LOCAL: "1",
    RUNTIME_MONITOR_ALLOW_NO_ALERTS: "1",
    RUNTIME_MONITOR_BASE_URL: "http://localhost:3000/api?token=secret",
    HEALTH_DIAGNOSTICS_SECRET: "h".repeat(32),
  },
  encoding: "utf8",
});
assert.equal(localPathBaseUrlSummaryResult.status, 1, localPathBaseUrlSummaryResult.stderr);
const localPathBaseUrlSummary = JSON.parse(localPathBaseUrlSummaryResult.stdout);
assert.equal(localPathBaseUrlSummary.status, "fail");
assert.deepEqual(localPathBaseUrlSummary.missingConfig, ["origin-only-base-url"]);
assert.match(localPathBaseUrlSummary.error, /origin without credentials/);
assert.equal(localPathBaseUrlSummary.wouldPoll, false);
assert.equal(localPathBaseUrlSummary.wouldSendAlerts, false);
assert.doesNotMatch(
  localPathBaseUrlSummaryResult.stdout,
  /https?:\/\/|token=secret|localhost:3000/i,
  "runtime monitor local origin failures must not print configured endpoints or query material",
);

const malformedDiagnosticsSecretSummaryResult = spawnSync(process.execPath, ["scripts/monitor-runtime-health.mjs", "--summary-only"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: "production",
    LINEA_NETWORK: "sepolia",
    LORE_PREMAINNET_RUNTIME_STRICT: "1",
    RUNTIME_MONITOR_BASE_URL: "https://playlore.xyz",
    HEALTH_DIAGNOSTICS_SECRET: "short",
    RESEND_API_KEY: "re_synthetic",
    RUNTIME_MONITOR_EMAIL_FROM: "LORE <alerts@playlore.xyz>",
    RUNTIME_MONITOR_EMAIL_TO: "playlore88@gmail.com",
    RUNTIME_MONITOR_BACKUP_DIR: path.join(path.parse(process.cwd()).root, "lore-monitor-backups"),
    RUNTIME_MONITOR_BACKUP_MAX_AGE_MS: "129600000",
  },
  encoding: "utf8",
});
assert.equal(malformedDiagnosticsSecretSummaryResult.status, 1, malformedDiagnosticsSecretSummaryResult.stderr);
const malformedDiagnosticsSecretSummary = JSON.parse(malformedDiagnosticsSecretSummaryResult.stdout);
assert.equal(malformedDiagnosticsSecretSummary.status, "fail");
assert.deepEqual(malformedDiagnosticsSecretSummary.missingConfig, ["invalid-config", "health-diagnostics-secret"]);
assert.match(malformedDiagnosticsSecretSummary.error, /HEALTH_DIAGNOSTICS_SECRET must be 32\.\.256 non-control characters/);
assert.equal(malformedDiagnosticsSecretSummary.wouldPoll, false);
assert.equal(malformedDiagnosticsSecretSummary.wouldSendAlerts, false);
assert.doesNotMatch(
  malformedDiagnosticsSecretSummaryResult.stdout,
  /short|C:\\|https?:\/\/|re_synthetic|playlore88@gmail\.com|alerts@playlore\.xyz/i,
  "runtime monitor diagnostics-secret config failures must not print secret text, local paths, endpoints, or alert config details",
);

const malformedNumericSummaryResult = spawnSync(process.execPath, ["scripts/monitor-runtime-health.mjs", "--summary-only"], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    NODE_ENV: "production",
    LINEA_NETWORK: "sepolia",
    LORE_PREMAINNET_RUNTIME_STRICT: "1",
    RUNTIME_MONITOR_BASE_URL: "https://playlore.xyz",
    HEALTH_DIAGNOSTICS_SECRET: "h".repeat(32),
    RESEND_API_KEY: "re_synthetic",
    RUNTIME_MONITOR_EMAIL_FROM: "LORE <alerts@playlore.xyz>",
    RUNTIME_MONITOR_EMAIL_TO: "playlore88@gmail.com",
    RUNTIME_MONITOR_BACKUP_DIR: path.join(path.parse(process.cwd()).root, "lore-monitor-backups"),
    RUNTIME_MONITOR_BACKUP_MAX_AGE_MS: "129600000",
    RUNTIME_MONITOR_INTERVAL_MS: "10000.0",
  },
  encoding: "utf8",
});
assert.equal(malformedNumericSummaryResult.status, 1, malformedNumericSummaryResult.stderr);
const malformedNumericSummary = JSON.parse(malformedNumericSummaryResult.stdout);
assert.equal(malformedNumericSummary.status, "fail");
assert.deepEqual(malformedNumericSummary.missingConfig, ["invalid-config"]);
assert.match(malformedNumericSummary.error, /RUNTIME_MONITOR_INTERVAL_MS must be a canonical decimal integer/);
assert.equal(malformedNumericSummary.wouldPoll, false);
assert.equal(malformedNumericSummary.wouldSendAlerts, false);
assert.doesNotMatch(
  malformedNumericSummaryResult.stdout,
  /C:\\|https?:\/\/|re_synthetic|playlore88@gmail\.com|alerts@playlore\.xyz/i,
  "runtime monitor numeric config failures must not print local paths, endpoints, or alert config details",
);

console.log(JSON.stringify({
  status: "pass",
  alerts: first.alerts.length,
  duplicateAlertsAfterRestart: afterRestart.alerts.length,
  recoveries: recovered.recoveries.length,
  deliveries: deliveries.length,
  repoLocalBackupDirRejected: true,
  localPathBaseUrlRejected: true,
  malformedDiagnosticsSecretRejected: true,
  malformedNumericEnvRejected: true,
  stateCleared: true,
}));
