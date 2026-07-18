import assert from "node:assert/strict";
import { mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
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
const backupDir = path.join(drillDir, "backups");
mkdirSync(drillDir, { recursive: true });
rmSync(backupDir, { force: true, recursive: true });
mkdirSync(backupDir, { recursive: true });
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
  generatedAt: new Date(now - 7_200_000).toISOString(),
  status: "pass",
  mismatches: [],
}, { nowMs: now, maxAgeMs: 3_600_000 }).map((issue) => issue.key), ["chain-indexer-audit-stale"]);
assert.deepEqual(evaluateChainIndexerAudit({ status: "pass", mismatches: [] }, { nowMs: now })
  .map((issue) => issue.key), ["chain-indexer-audit-invalid"]);
writeFileSync(chainAuditPath, "x".repeat(128 * 1024 + 1));
assert.throws(() => readBoundedJsonFile(chainAuditPath), /exceeds size limit/);

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
assert.equal(deliveries.length, unhealthy.length * 2);
for (const delivery of deliveries) {
  assert.match(delivery.url, /^https:\/\/api\.telegram\.org\/bot[^/]+\/sendMessage$/);
  assert.doesNotMatch(delivery.body, /0x[a-f0-9]{40}|https?:\/\//i);
  const body = new URLSearchParams(delivery.body);
  assert.equal(body.get("chat_id"), "test-chat");
  assert.match(body.get("text") || "", /^(?:LORE Monitor Drill\n)(?:ALERT|RECOVERED):/);
}

console.log(JSON.stringify({
  status: "pass",
  alerts: first.alerts.length,
  duplicateAlertsAfterRestart: afterRestart.alerts.length,
  recoveries: recovered.recoveries.length,
  deliveries: deliveries.length,
  stateCleared: true,
}));
