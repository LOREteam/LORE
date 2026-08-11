import assert from "node:assert/strict";
import * as canaryHealthTelemetryModule from "../app/lib/canaryHealthTelemetry.ts";
import * as gamePollingConfigModule from "../app/hooks/useGamePollingConfig.ts";

export function runRuntimePollingTests() {
  const canaryHealthTelemetry = canaryHealthTelemetryModule.default ?? canaryHealthTelemetryModule;
  const gamePollingConfig = gamePollingConfigModule.default ?? gamePollingConfigModule;
  assert.equal(canaryHealthTelemetry.parseCanaryHealthBaseUrl(undefined), null);
  assert.equal(canaryHealthTelemetry.parseCanaryHealthBaseUrl("http://localhost:3000").origin, "http://localhost:3000");
  assert.equal(canaryHealthTelemetry.parseCanaryHealthBaseUrl("https://ops.example.com").origin, "https://ops.example.com");
  assert.throws(() => canaryHealthTelemetry.parseCanaryHealthBaseUrl("http://example.com"), /must use HTTPS/);
  assert.throws(() => canaryHealthTelemetry.parseCanaryHealthBaseUrl("https://user:pass@example.com"), /without credentials/);
  assert.throws(() => canaryHealthTelemetry.parseCanaryHealthBaseUrl("https://example.com/health"), /without credentials/);
  assert.throws(() => canaryHealthTelemetry.parseCanaryHealthBaseUrl("https://example.com?token=secret"), /without credentials/);
  assert.throws(() => canaryHealthTelemetry.parseCanaryHealthBaseUrl("https://example.com#secret"), /without credentials/);
  assert.deepEqual(
    canaryHealthTelemetry.parseCanaryHealthPayloads(
      { redacted: false, process: { uptimeSeconds: 10, rssBytes: 20, heapUsedBytes: 15 } },
      { redacted: false, storage: { dbBytes: 30, walBytes: 5, diskFreeBytes: 100 } },
    ),
    { dbBytes: 30, diskFreeBytes: 100, heapUsedBytes: 15, rssBytes: 20, runtimeUptimeSeconds: 10, walBytes: 5 },
  );
  assert.throws(
    () => canaryHealthTelemetry.parseCanaryHealthPayloads({ redacted: true }, { redacted: false }),
    /redacted/,
  );
  for (const malformedMetric of [null, "", "10", 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1, -1]) {
    assert.throws(
      () => canaryHealthTelemetry.parseCanaryHealthPayloads(
        { redacted: false, process: { uptimeSeconds: malformedMetric, rssBytes: 20, heapUsedBytes: 15 } },
        { redacted: false, storage: { dbBytes: 30, walBytes: 5, diskFreeBytes: 100 } },
      ),
      /process\.uptimeSeconds/,
      `canary health metrics must reject ${String(malformedMetric)}`,
    );
  }
  assert.deepEqual(
    gamePollingConfig.getGamePollingIntervals({
      isPageVisible: true,
      pollPhase: "slow",
      liveGrid: true,
      autoMineSessionActive: false,
      isRevealing: false,
    }),
    {
      epochInterval: 5000,
      epochEndInterval: 6000,
      liveGridInterval: 3000,
      liveUserBetsInterval: 3000,
      gridEpochInterval: 5000,
    },
  );
  assert.deepEqual(
    gamePollingConfig.getGamePollingIntervals({
      isPageVisible: false,
      pollPhase: "slow",
      liveGrid: true,
      autoMineSessionActive: false,
      isRevealing: false,
    }),
    {
      epochInterval: 20_000,
      epochEndInterval: 20_000,
      liveGridInterval: 20_000,
      liveUserBetsInterval: 20_000,
      gridEpochInterval: 20_000,
    },
  );
  assert.equal(
    gamePollingConfig.getGamePollingIntervals({
      isPageVisible: false,
      pollPhase: "slow",
      liveGrid: true,
      autoMineSessionActive: true,
      isRevealing: false,
    }).liveGridInterval,
    1000,
  );
}
