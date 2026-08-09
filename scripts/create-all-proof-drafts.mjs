import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : fallback;
}

const outDir = resolve(process.cwd(), argValue("out-dir", "docs/proof-drafts"));
const summaryOnly = process.argv.includes("--summary-only");
mkdirSync(outDir, { recursive: true });
const externalRestoreRoot = mkdtempSync(join(tmpdir(), "lore-proof-draft-restore-"));
const syntheticRestoreSourceDb = join(externalRestoreRoot, "source", "lore-source.sqlite");
const syntheticRestoreBackupDir = join(externalRestoreRoot, "backups");
const syntheticRestoreDir = join(externalRestoreRoot, "restore");
const syntheticRestoreBackup = join(syntheticRestoreBackupDir, "synthetic-backup.sqlite");
mkdirSync(join(externalRestoreRoot, "source"), { recursive: true });
mkdirSync(syntheticRestoreBackupDir, { recursive: true });
mkdirSync(syntheticRestoreDir, { recursive: true });

const syntheticSignoffEnvLog = join(outDir, "synthetic-signoff-mainnet-env.log");
const syntheticSignoffChainLog = join(outDir, "synthetic-signoff-chain-snapshot.log");
const syntheticHostHealthLog = join(outDir, "synthetic-host-health-prod.log");
const syntheticHostLoadLog = join(outDir, "synthetic-host-load-http.log");
const syntheticHostProcess = join(outDir, "synthetic-host-process-model.log");
const syntheticIndexerLog = join(outDir, "synthetic-indexer-once.log");
const syntheticIndexerHealth = join(outDir, "synthetic-indexer-health-prod.log");
const syntheticIndexerSnapshot = join(outDir, "synthetic-indexer-chain-snapshot.json");
const syntheticRestoreLog = join(outDir, "synthetic-restore-drill.log");
const syntheticRestoreHealth = join(outDir, "synthetic-restore-health-prod.log");
const syntheticRestoreSchedule = join(outDir, "synthetic-restore-backup-schedule.log");
const syntheticRestorePreservation = join(outDir, "synthetic-restore-indexer-preservation.log");
const syntheticCanaryLog = join(outDir, "synthetic-canary-live-log.jsonl");
const syntheticCanaryTarget = join(outDir, "synthetic-canary-target-proof.log");
const syntheticCanaryRecovery = join(outDir, "synthetic-canary-recovery-proof.log");
const syntheticCanarySession = join(outDir, "synthetic-canary-session-summary.log");
const syntheticCanaryTx = join(outDir, "synthetic-canary-transaction-scan.log");
const syntheticMonitoringAlert = join(outDir, "synthetic-monitoring-alert-export.log");
const syntheticMonitoringRecovery = join(outDir, "synthetic-monitoring-recovery-export.log");
const syntheticMonitoringTarget = join(outDir, "synthetic-monitoring-alert-target.log");
const syntheticMonitoringError = join(outDir, "synthetic-monitoring-error-event.log");
const syntheticQaWallet = join(outDir, "synthetic-qa-wallet-flow-report.md");
const syntheticQaFailure = join(outDir, "synthetic-qa-failure-state-report.md");
const syntheticQaSupport = join(outDir, "synthetic-qa-support-audit-report.md");
const syntheticQaFinal = join(outDir, "synthetic-qa-final-browser-report.md");
const syntheticQaSmoke = join(outDir, "synthetic-qa-smoke-debug-autominer.log");
writeFileSync(syntheticSignoffEnvLog, "Summary: all checked env gates passed. Synthetic draft bundle only; not launch proof.\n", "utf8");
writeFileSync(syntheticSignoffChainLog, "Summary: synthetic non-proof proof:chain direct-chain comparison output for draft bundle only: jackpot safetyPool deposits rewards rebates resolve\n", "utf8");
writeFileSync(syntheticHostHealthLog, "[prod-health] OK\nbase=https://playlore.xyz runtime=ok dataSync=ok finalityLagBlocks=1\n", "utf8");
writeFileSync(syntheticHostLoadLog, "Load base URL: https://canary.playlore.xyz\nConcurrency: 1; client IPs: 1; duration: 1000ms; timeout: 10000ms\nTOTAL count= 1 fail= 0 err= 0.00% p50= 100ms p95= 100ms p99= 100ms\n", "utf8");
writeFileSync(syntheticHostProcess, "synthetic non-proof host process model artifact for draft bundle only\n", "utf8");
writeFileSync(syntheticIndexerLog, "[indexer] SQLite path: C:\\\\external\\\\lore-indexer.sqlite\n[indexer] Contract: 0x1111111111111111111111111111111111111111\n[indexer] Deploy block: 1\n[indexer] Start block: 1\n[indexer] Finality blocks: 1\n[indexer] Scanning blocks 1..10\n[indexer] Finished runOnce\n", "utf8");
writeFileSync(syntheticIndexerHealth, "[prod-health] OK\nbase=https://playlore.xyz runtime=ok dataSync=ok finalityLagBlocks=1\n", "utf8");
writeFileSync(syntheticIndexerSnapshot, JSON.stringify({ generatedAt: "2026-07-09T00:00:00.000Z", expectedChainId: 59144, rpcChainId: 59144, rpcSource: "redacted-mainnet-rpc", contractAddress: "0x1111111111111111111111111111111111111111", epochs: [{ epoch: 1 }] }), "utf8");
writeFileSync(syntheticRestoreLog, "Summary: backup/restore drill completed without detected issues.\n", "utf8");
writeFileSync(syntheticRestoreHealth, "[prod-health] OK\nbase=https://restore.playlore.xyz runtime=ok dataSync=ok finalityLagBlocks=1\n", "utf8");
writeFileSync(syntheticRestoreSourceDb, "synthetic source db for draft bundle only", "utf8");
writeFileSync(syntheticRestoreBackup, "synthetic backup artifact for draft bundle only", "utf8");
writeFileSync(syntheticRestoreSchedule, "synthetic non-proof restore backup schedule artifact for draft bundle only\n", "utf8");
writeFileSync(syntheticRestorePreservation, "heartbeatBefore=abc heartbeatAfter=abc latestIndexedEpochBefore=1 latestIndexedEpochAfter=1\n", "utf8");
const syntheticCanaryEvent = JSON.stringify({ timestamp: "2026-07-09T00:00:00.000Z", round: 0, ok: true, txStatus: "success", role: "AUTOMINER_A", mode: "bet", epoch: 1, tiles: [1], txHash: "0x1111111111111111111111111111111111111111111111111111111111111111", network: "linea-mainnet", chainId: 59144, contractAddress: "0x1111111111111111111111111111111111111111", rpcLabel: "redacted-mainnet-rpc" });
writeFileSync(syntheticCanaryLog, `${syntheticCanaryEvent}\n`, "utf8");
writeFileSync(syntheticCanaryTarget, "synthetic non-proof canary target artifact for draft bundle only\n", "utf8");
writeFileSync(syntheticCanaryRecovery, "synthetic non-proof canary recovery artifact for draft bundle only\n", "utf8");
writeFileSync(syntheticCanarySession, "synthetic non-proof canary session artifact for draft bundle only\n", "utf8");
writeFileSync(syntheticCanaryTx, "synthetic non-proof canary transaction artifact for draft bundle only\n", "utf8");
writeFileSync(syntheticMonitoringAlert, "synthetic non-proof monitoring fired-alert artifact for draft bundle only\n", "utf8");
writeFileSync(syntheticMonitoringRecovery, "synthetic non-proof monitoring recovery artifact for draft bundle only\n", "utf8");
writeFileSync(syntheticMonitoringTarget, "synthetic non-proof monitoring alert-target artifact for draft bundle only\n", "utf8");
writeFileSync(syntheticMonitoringError, "synthetic non-proof monitoring error-event artifact for draft bundle only\n", "utf8");
writeFileSync(syntheticQaWallet, "synthetic non-proof QA wallet artifact for draft bundle only\n", "utf8");
writeFileSync(syntheticQaFailure, "synthetic non-proof QA failure-state artifact for draft bundle only\n", "utf8");
writeFileSync(syntheticQaSupport, "synthetic non-proof QA support audit artifact for draft bundle only\n", "utf8");
writeFileSync(syntheticQaFinal, "synthetic non-proof QA final browser artifact for draft bundle only\n", "utf8");
writeFileSync(syntheticQaSmoke, "synthetic non-proof QA smoke artifact for draft bundle only\n", "utf8");

const tasks = [
  ["signoff", "scripts/create-signoff-proof-draft.mjs", [`--env-log=${syntheticSignoffEnvLog}`, `--chain-log=${syntheticSignoffChainLog}`]],
  ["host", "scripts/create-host-proof-draft.mjs", ["--origin=https://playlore.xyz", "--host-type=production", "--load-origin=https://canary.playlore.xyz", "--load-host-type=canary", "--db-path=C:\\\\external\\\\lore-prod.sqlite", "--supervisor=pm2", `--process-evidence=${syntheticHostProcess}`, `--health-log=${syntheticHostHealthLog}`, `--load-log=${syntheticHostLoadLog}`]],
  ["indexer", "scripts/create-indexer-proof-draft.mjs", ["--fresh-db=true", "--deploy-block=1", "--start-block=1", "--finality-blocks=1", `--indexer-log=${syntheticIndexerLog}`, `--health-log=${syntheticIndexerHealth}`, `--chain-snapshot=${syntheticIndexerSnapshot}`]],
  ["restore", "scripts/create-restore-proof-draft.mjs", [`--source=${syntheticRestoreSourceDb}`, `--backup-dir=${syntheticRestoreBackupDir}`, `--restore-dir=${syntheticRestoreDir}`, `--backup=${syntheticRestoreBackup}`, "--restored-origin=https://restore.playlore.xyz", "--restored-host-type=restore", `--restore-log=${syntheticRestoreLog}`, `--health-log=${syntheticRestoreHealth}`, `--backup-schedule-artifact=${syntheticRestoreSchedule}`, `--preservation-artifact=${syntheticRestorePreservation}`]],
  ["monitoring", "scripts/create-monitoring-proof-draft.mjs", ["--provider=synthetic-monitor", "--error-provider=synthetic-error-tracker", "--origin=https://playlore.xyz", `--monitor-artifact=${syntheticMonitoringAlert}`, `--recovery-artifact=${syntheticMonitoringRecovery}`, `--alert-target-artifact=${syntheticMonitoringTarget}`, `--error-event-artifact=${syntheticMonitoringError}`]],
  ["qa", "scripts/create-qa-proof-draft.mjs", ["--origin=https://playlore.xyz", "--network=linea-mainnet", "--chain-id=59144", `--wallet-artifact=${syntheticQaWallet}`, `--failure-artifact=${syntheticQaFailure}`, `--support-artifact=${syntheticQaSupport}`, `--finalqa-artifact=${syntheticQaFinal}`, `--smoke-artifact=${syntheticQaSmoke}`, "--clean-wallet-tx=0x1111111111111111111111111111111111111111111111111111111111111111"]],
  ["canary", "scripts/create-canary-proof-draft.mjs", ["--network=linea-mainnet", "--chain-id=59144", "--contract=0x1111111111111111111111111111111111111111", "--rpc-label=redacted-mainnet-rpc", `--live-log=${syntheticCanaryLog}`, `--target-artifact=${syntheticCanaryTarget}`, `--recovery-artifact=${syntheticCanaryRecovery}`, `--session-artifact=${syntheticCanarySession}`, `--tx-artifact=${syntheticCanaryTx}`]],
];

const rows = [];
const issues = [];

for (const [id, script, args] of tasks) {
  const out = join(outDir, `${id}-proof.draft.json`);
  const result = spawnSync(process.execPath, [script, ...args, `--out=${out}`], {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
  if (result.status !== 0) issues.push(`${id}: ${script} failed`);
  rows.push([id, result.status === 0 ? "written" : "failed", out]);
}

if (summaryOnly) {
  const written = rows.filter((row) => row[1] === "written").length;
  const failed = rows.length - written;
  console.log(`status=${issues.length === 0 ? "pass" : "fail"}, drafts=${rows.length}, written=${written}, failed=${failed}, summaryOnly=true`);
} else {
  console.log("| Draft | Status | Path |");
  console.log("| --- | --- | --- |");
  for (const row of rows) console.log(`| ${row.join(" | ")} |`);
}
console.log(`Summary: ${issues.length === 0 ? "all proof drafts were created; Draft files are not launch proof; promote only after real external evidence and strict validation" : `${issues.length} issue(s): ${issues.join("; ")}`}.`);

try {
  rmSync(externalRestoreRoot, { recursive: true, force: true });
} catch {
  // Best-effort temp cleanup; draft generation status is already captured.
}

if (issues.length > 0) process.exitCode = 1;
