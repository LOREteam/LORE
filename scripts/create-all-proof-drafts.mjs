import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";

function argValue(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : fallback;
}

const outDir = resolve(process.cwd(), argValue("out-dir", "docs/proof-drafts"));
mkdirSync(outDir, { recursive: true });

const syntheticCanaryLog = join(outDir, "synthetic-canary-live-log.jsonl");
const syntheticCanaryTarget = join(outDir, "synthetic-canary-target-proof.log");
const syntheticCanaryRecovery = join(outDir, "synthetic-canary-recovery-proof.log");
const syntheticCanarySession = join(outDir, "synthetic-canary-session-summary.log");
const syntheticCanaryTx = join(outDir, "synthetic-canary-transaction-scan.log");
const syntheticMonitoringAlert = join(outDir, "synthetic-monitoring-alert-export.log");
const syntheticMonitoringRecovery = join(outDir, "synthetic-monitoring-recovery-export.log");
const syntheticMonitoringTarget = join(outDir, "synthetic-monitoring-alert-target.log");
const syntheticMonitoringError = join(outDir, "synthetic-monitoring-error-event.log");
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

const tasks = [
  ["signoff", "scripts/create-signoff-proof-draft.mjs", []],
  ["host", "scripts/create-host-proof-draft.mjs", ["--origin=https://playlore.xyz", "--load-origin=https://canary.playlore.xyz", "--load-host-type=canary"]],
  ["indexer", "scripts/create-indexer-proof-draft.mjs", []],
  ["restore", "scripts/create-restore-proof-draft.mjs", ["--restored-origin=https://restore.playlore.xyz", "--restored-host-type=restore"]],
  ["monitoring", "scripts/create-monitoring-proof-draft.mjs", ["--provider=synthetic-monitor", "--error-provider=synthetic-error-tracker", "--origin=https://playlore.xyz", `--monitor-artifact=${syntheticMonitoringAlert}`, `--recovery-artifact=${syntheticMonitoringRecovery}`, `--alert-target-artifact=${syntheticMonitoringTarget}`, `--error-event-artifact=${syntheticMonitoringError}`]],
  ["qa", "scripts/create-qa-proof-draft.mjs", ["--origin=https://playlore.xyz", "--network=linea-mainnet", "--chain-id=59144"]],
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

console.log("| Draft | Status | Path |");
console.log("| --- | --- | --- |");
for (const row of rows) console.log(`| ${row.join(" | ")} |`);
console.log(`Summary: ${issues.length === 0 ? "all proof drafts were created; Draft files are not launch proof; promote only after real external evidence and strict validation" : `${issues.length} issue(s): ${issues.join("; ")}`}.`);

if (issues.length > 0) process.exitCode = 1;