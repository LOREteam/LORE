import assert from "node:assert/strict";
import * as runtimeMonitorModule from "./runtime-monitor-lib.mjs";

export async function runRuntimeMonitorAlertTests() {
  const runtimeMonitor = runtimeMonitorModule.default ?? runtimeMonitorModule;
  const nowMs = Date.parse("2026-08-12T10:00:00.000Z");
  const validAudit = {
    generatedAt: "2026-08-12T09:59:59.000Z",
    status: "pass",
    mismatches: [],
    accounting: { actualEnd: { accruedOwnerFees: "1", accruedBurnFees: "2" } },
  };
  assert.deepEqual(
    runtimeMonitor.evaluateChainIndexerAudit(validAudit, {
      nowMs,
      maxAgeMs: 60_000,
      maxAccruedProtocolFeesWei: "3",
    }),
    [],
  );
  assert.equal(
    runtimeMonitor.evaluateChainIndexerAudit({ ...validAudit, generatedAt: "2026-08-12 09:59:59Z" }, { nowMs })[0]?.key,
    "chain-indexer-audit-invalid",
    "audit timestamps must be canonical UTC before freshness decisions",
  );
  assert.equal(
    runtimeMonitor.evaluateChainIndexerAudit({ ...validAudit, generatedAt: "2026-08-12T10:01:01.000Z" }, { nowMs })[0]?.key,
    "chain-indexer-audit-invalid",
    "future audit timestamps must fail closed",
  );
  assert.equal(
    runtimeMonitor.evaluateBackupFreshness({ mtimeMs: nowMs - 1_000, bytes: 1 }, { nowMs, maxAgeMs: 60_000 }).length,
    0,
  );
  assert.equal(
    runtimeMonitor.evaluateBackupFreshness({ mtimeMs: "1e3", bytes: 1 }, { nowMs })[0]?.key,
    "sqlite-backup-invalid",
    "backup metadata must reject non-canonical numeric input",
  );
  const revertedSeries = [
    { timestamp: "2026-08-12T09:59:57.000Z", txStatus: "reverted", hash: "0x01" },
    { timestamp: "2026-08-12T09:59:58.000Z", txStatus: "reverted", hash: "0x02" },
    { timestamp: "2026-08-12T09:59:59.000Z", txStatus: "reverted", hash: "0x03" },
  ].map((event) => JSON.stringify(event)).join("\n");
  assert.equal(
    runtimeMonitor.evaluateCanaryRevertWindow(revertedSeries, { nowMs })[0]?.key,
    "canary-reverted-tx-series",
    "three unique recent reverted transactions must trigger the canary circuit breaker",
  );
  assert.equal(
    runtimeMonitor.evaluateCanaryActivity(JSON.stringify({
      timestamp: "2026-08-12T09:59:59.000Z",
      mode: "summary",
      targetRounds: 2,
      round: 2,
      failures: -1,
    }), { nowMs })[0]?.key,
    "canary-log-invalid",
    "completed canary summaries must reject negative failure counters",
  );
  const healthySnapshot = {
    runtime: { status: "ok", process: { rssBytes: 1 } },
    dataSync: { status: "healthy", storage: { walBytes: 1, diskFreeBytes: 10, lagToFinalityTargetBlocks: 0 }, env: { lagWarnBlocks: 0 } },
    liveState: { currentEpoch: "1", epochEndTime: Math.floor(nowMs / 1000) + 60, currentEpochData: ["0", "0", "0", false], fetchedAt: nowMs },
    nowMs,
  };
  assert.deepEqual(runtimeMonitor.evaluateRuntimeSnapshot(healthySnapshot), []);
  assert.equal(
    runtimeMonitor.evaluateRuntimeSnapshot({
      ...healthySnapshot,
      liveState: { ...healthySnapshot.liveState, fetchedAt: nowMs + 60_001 },
    }).some((issue) => issue.key === "live-state-stale"),
    true,
    "future live-state timestamps must not be treated as fresh",
  );
  assert.equal(
    runtimeMonitor.evaluateRuntimeSnapshot({
      ...healthySnapshot,
      liveState: {
        ...healthySnapshot.liveState,
        epochEndTime: Math.floor(nowMs / 1000) - 121,
        currentEpochData: ["1", "0", "0", false],
      },
    }).some((issue) => issue.key === "stuck-non-empty-epoch"),
    true,
    "overdue non-empty unresolved epochs must remain visible to the monitor",
  );
  const invalidResendSender = runtimeMonitor.createResendAlertSender({
    env: {
      RESEND_API_KEY: "re_synthetic",
      RUNTIME_MONITOR_EMAIL_FROM: "LORE <alerts@playlore.xyz>",
      RUNTIME_MONITOR_EMAIL_TO: "not-an-email",
    },
  });
  assert.equal(
    invalidResendSender.configured,
    false,
    "runtime monitor must not treat invalid Resend email addresses as configured",
  );

  let resendRequestBody = null;
  const validResendSender = runtimeMonitor.createResendAlertSender({
    env: {
      RESEND_API_KEY: "re_synthetic",
      RUNTIME_MONITOR_EMAIL_FROM: "LORE <alerts@playlore.xyz>",
      RUNTIME_MONITOR_EMAIL_TO: "playlore88@gmail.com, ops@playlore.xyz",
      ALERT_PREFIX: "LORE Keeper",
    },
    fetchImpl: async (_url, init) => {
      resendRequestBody = JSON.parse(String(init.body));
      return { ok: true };
    },
    now: () => 1_000,
  });
  assert.equal(
    validResendSender.configured,
    true,
    "runtime monitor must accept verified-sender display names and comma-separated email recipients",
  );
  assert.equal(await validResendSender.send("ALERT: synthetic", "synthetic-alert", 0), true);
  assert.deepEqual(resendRequestBody?.to, ["playlore88@gmail.com", "ops@playlore.xyz"]);
  assert.equal(resendRequestBody?.from, "LORE <alerts@playlore.xyz>");
}
