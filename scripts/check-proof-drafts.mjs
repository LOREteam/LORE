import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const tmp = mkdtempSync(join(tmpdir(), "lore-proof-drafts-"));
const canaryLog = join(tmp, "canary.jsonl");
const emptyCanaryLog = join(tmp, "empty-canary.jsonl");
const canaryTargetArtifact = join(tmp, "canary-target-proof.log");
const canaryRecoveryArtifact = join(tmp, "canary-recovery-proof.log");
const canarySessionArtifact = join(tmp, "canary-session-summary.log");
const canaryTxArtifact = join(tmp, "canary-transaction-scan.log");
const canaryEvent = JSON.stringify({ timestamp: "2026-07-09T00:00:00.000Z", round: 0, ok: true, txStatus: "success", role: "AUTOMINER_A", mode: "bet", epoch: 1, tiles: [1], txHash: "0x1111111111111111111111111111111111111111111111111111111111111111", rpcLabel: "redacted-mainnet-rpc" });
writeFileSync(canaryLog, `${canaryEvent}\n`, "utf8");
writeFileSync(emptyCanaryLog, "", "utf8");
writeFileSync(canaryTargetArtifact, "synthetic canary target proof\n", "utf8");
writeFileSync(canaryRecoveryArtifact, "synthetic canary recovery proof\n", "utf8");
writeFileSync(canarySessionArtifact, "synthetic canary session proof\n", "utf8");
writeFileSync(canaryTxArtifact, "synthetic canary transaction proof\n", "utf8");
const qaWalletArtifact = join(tmp, "qa-wallet-flow-report.md");
const qaFailureArtifact = join(tmp, "qa-failure-state-report.md");
const qaSupportArtifact = join(tmp, "qa-support-audit-report.md");
const qaFinalArtifact = join(tmp, "qa-final-browser-report.md");
const qaSmokeArtifact = join(tmp, "qa-smoke-debug-autominer.log");
writeFileSync(qaWalletArtifact, "synthetic wallet QA report\n", "utf8");
writeFileSync(qaFailureArtifact, "synthetic failure-state QA report\n", "utf8");
writeFileSync(qaSupportArtifact, "synthetic support audit QA report\n", "utf8");
writeFileSync(qaFinalArtifact, "synthetic final browser QA report\n", "utf8");
writeFileSync(qaSmokeArtifact, "synthetic debug autominer smoke log\n", "utf8");
const signoffEnvLog = join(tmp, "signoff-env.log");
const signoffChainLog = join(tmp, "signoff-chain.log");
writeFileSync(signoffEnvLog, "Summary: synthetic redacted proof:mainnet output", "utf8");
writeFileSync(signoffChainLog, "Summary: synthetic direct-chain proof output", "utf8");
const hostHealthLog = join(tmp, "host-health-prod.log");
const hostLoadLog = join(tmp, "host-load-http.log");
const hostHealthMissingBaseLog = join(tmp, "host-health-missing-base.log");
const hostLoadMissingBaseLog = join(tmp, "host-load-missing-base.log");
writeFileSync(hostHealthLog, "[prod-health] OK\nbase=https://playlore.xyz runtime=ok dataSync=ok effectiveLagBlocks=2 finalityLagBlocks=2\n", "utf8");
writeFileSync(hostLoadLog, "Load base URL: https://canary.playlore.xyz\nConcurrency: 10; client IPs: 10; duration: 60000ms; timeout: 10000ms\nTOTAL count= 100 fail= 0 err= 0.00% p50= 100ms p95= 400ms p99= 700ms\n", "utf8");
writeFileSync(hostHealthMissingBaseLog, "[prod-health] OK\nruntime=ok dataSync=ok effectiveLagBlocks=2 finalityLagBlocks=2\n", "utf8");
writeFileSync(hostLoadMissingBaseLog, "Concurrency: 10; client IPs: 10; duration: 60000ms; timeout: 10000ms\nTOTAL count= 100 fail= 0 err= 0.00% p50= 100ms p95= 400ms p99= 700ms\n", "utf8");
const indexerLog = join(tmp, "indexer-once.log");
const indexerRepoDbLog = join(tmp, "indexer-repo-db.log");
const indexerHealthLog = join(tmp, "indexer-health-prod.log");
const indexerChainSnapshot = join(tmp, "chain-proof-snapshot.json");
writeFileSync(indexerLog, "[indexer] SQLite path: C:\\external\\lore.sqlite\n[indexer] Contract: 0x1111111111111111111111111111111111111111\n[indexer] Deploy block: 1\n[indexer] Start block: 1\n[indexer] Finality blocks: 1\n[indexer] Scanning blocks 1..10\n[indexer] Finished runOnce\n", "utf8");
writeFileSync(indexerRepoDbLog, `[indexer] SQLite path: ${join(process.cwd(), "repo-indexer.sqlite")}\n[indexer] Contract: 0x1111111111111111111111111111111111111111\n[indexer] Deploy block: 1\n[indexer] Start block: 1\n[indexer] Finality blocks: 1\n[indexer] Scanning blocks 1..10\n[indexer] Finished runOnce\n`, "utf8");
writeFileSync(indexerHealthLog, "[prod-health] OK\nbase=https://playlore.xyz runtime=ok dataSync=ok effectiveLagBlocks=1 finalityLagBlocks=1\n", "utf8");
writeFileSync(indexerChainSnapshot, JSON.stringify({ expectedChainId: 59144, rpcChainId: 59144, rpcSource: "redacted-mainnet-rpc", contractAddress: "0x1111111111111111111111111111111111111111", epochs: [{ epoch: 1 }] }), "utf8");
const monitoringAlertArtifact = join(tmp, "monitoring-alert-export.log");
const monitoringRecoveryArtifact = join(tmp, "monitoring-recovery-export.log");
const monitoringAlertTargetArtifact = join(tmp, "monitoring-alert-target-test.log");
const monitoringErrorEventArtifact = join(tmp, "error-tracking-test-event.log");
writeFileSync(monitoringAlertArtifact, "ALERT synthetic fired monitor export\n", "utf8");
writeFileSync(monitoringRecoveryArtifact, "RECOVERY synthetic resolved monitor export\n", "utf8");
writeFileSync(monitoringAlertTargetArtifact, "SLACK synthetic alert target test export\n", "utf8");
writeFileSync(monitoringErrorEventArtifact, "SENTRY synthetic error tracking test event\n", "utf8");

const restoreSourcePath = join(mkdtempSync(join(tmpdir(), "lore-proof-restore-source-")), "source.sqlite");
const restoreBackupDir = mkdtempSync(join(tmpdir(), "lore-proof-restore-backup-"));
const restoreDir = mkdtempSync(join(tmpdir(), "lore-proof-restore-restored-"));
const restoreBackupPath = join(restoreBackupDir, "backup.sqlite");
const restoreLog = join(tmp, "restore-drill.log");
const restoreHealthLog = join(tmp, "restore-health-prod.log");
const restoreHealthMissingRuntimeLog = join(tmp, "restore-health-missing-runtime.log");
writeFileSync(restoreSourcePath, "synthetic source db for collector draft guard", "utf8");
writeFileSync(restoreBackupPath, "synthetic backup artifact for collector draft guard", "utf8");
writeFileSync(restoreLog, "Summary: backup/restore drill completed without detected issues.\n", "utf8");
writeFileSync(restoreHealthLog, "[prod-health] OK\nbase=https://restore.playlore.xyz runtime=ok dataSync=ok effectiveLagBlocks=1 finalityLagBlocks=1\n", "utf8");
writeFileSync(restoreHealthMissingRuntimeLog, "[prod-health] OK\nbase=https://restore.playlore.xyz dataSync=ok effectiveLagBlocks=1 finalityLagBlocks=1\n", "utf8");

const draftCases = [
  {
    id: "signoff",
    out: join(tmp, "signoff-proof.draft.json"),
    create: ["scripts/create-signoff-proof-draft.mjs"],
    createArgs: [],
    check: ["scripts/check-signoff-proof.mjs"],
    checkArgs: (out) => ["--strict", `--file=${out}`],
  },
  {
    id: "host",
    out: join(tmp, "host-proof.draft.json"),
    create: ["scripts/create-host-proof-draft.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--load-origin=https://canary.playlore.xyz", "--load-host-type=canary"],
    check: ["scripts/check-host-proof.mjs"],
    checkArgs: (out) => ["--strict", `--file=${out}`],
  },
  {
    id: "indexer",
    out: join(tmp, "indexer-proof.draft.json"),
    create: ["scripts/create-indexer-proof-draft.mjs"],
    createArgs: [],
    check: ["scripts/check-indexer-dry-run.mjs"],
    checkArgs: (out) => ["--strict", `--manifest=${out}`],
  },
  {
    id: "restore",
    out: join(tmp, "restore-proof.draft.json"),
    create: ["scripts/create-restore-proof-draft.mjs"],
    createArgs: ["--restored-origin=https://restore.playlore.xyz", "--restored-host-type=restore"],
    check: ["scripts/verify-db-restore.mjs"],
    checkArgs: (out) => ["--strict", `--manifest=${out}`],
  },
  {
    id: "monitoring",
    out: join(tmp, "monitoring-proof.draft.json"),
    create: ["scripts/create-monitoring-proof-draft.mjs"],
    createArgs: ["--provider=synthetic-monitor", "--error-provider=synthetic-error-tracker", "--origin=https://playlore.xyz", `--monitor-artifact=${monitoringAlertArtifact}`, `--recovery-artifact=${monitoringRecoveryArtifact}`, `--alert-target-artifact=${monitoringAlertTargetArtifact}`, `--error-event-artifact=${monitoringErrorEventArtifact}`],
    check: ["scripts/check-monitoring-proof.mjs"],
    checkArgs: (out) => ["--strict", `--file=${out}`],
  },
  {
    id: "qa",
    out: join(tmp, "qa-proof.draft.json"),
    create: ["scripts/create-qa-proof-draft.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--network=linea-mainnet", "--chain-id=59144", `--wallet-artifact=${qaWalletArtifact}`, `--failure-artifact=${qaFailureArtifact}`, `--support-artifact=${qaSupportArtifact}`, `--finalqa-artifact=${qaFinalArtifact}`, `--smoke-artifact=${qaSmokeArtifact}`, "--clean-wallet-tx=0x1111111111111111111111111111111111111111111111111111111111111111"],
    check: ["scripts/check-qa-proof.mjs"],
    checkArgs: (out) => ["--strict", `--file=${out}`],
  },
  {
    id: "canary",
    out: join(tmp, "canary-proof.draft.json"),
    create: ["scripts/create-canary-proof-draft.mjs"],
    createArgs: ["--network=linea-mainnet", "--chain-id=59144", "--contract=0x1111111111111111111111111111111111111111", "--rpc-label=redacted-mainnet-rpc", `--live-log=${canaryLog}`, `--target-artifact=${canaryTargetArtifact}`, `--recovery-artifact=${canaryRecoveryArtifact}`, `--session-artifact=${canarySessionArtifact}`, `--tx-artifact=${canaryTxArtifact}`],
    check: ["scripts/analyze-live-canary-proof.mjs"],
    checkArgs: (out) => [canaryLog, "--strict", `--manifest=${out}`],
  },
];

const collectorDraftCases = [
  {
    id: "signoff-collector",
    out: join(tmp, "signoff-proof.collector.json"),
    create: ["scripts/collect-signoff-evidence.mjs"],
    createArgs: ["--epochs=1", "--user=0x1111111111111111111111111111111111111111", `--env-log=${signoffEnvLog}`, `--chain-log=${signoffChainLog}`],
    requiredSections: ["contractEnv", "ownership", "randomness", "chainComparison"],
    check: ["scripts/check-signoff-proof.mjs"],
    checkArgs: (out) => ["--strict", `--file=${out}`],
  },
  {
    id: "host-collector",
    out: join(tmp, "host-proof.collector.json"),
    create: ["scripts/collect-host-evidence.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--host-type=production", "--load-origin=https://canary.playlore.xyz", "--load-host-type=canary", `--health-log=${hostHealthLog}`, `--load-log=${hostLoadLog}`],
    requiredSections: ["processModel", "persistentDb", "healthProd", "loadHttp"],
    check: ["scripts/check-host-proof.mjs"],
    checkArgs: (out) => ["--strict", `--file=${out}`],
  },
  {
    id: "indexer-collector",
    out: join(tmp, "indexer-proof.collector.json"),
    create: ["scripts/collect-indexer-evidence.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=1", "--chain-id=59144", "--deploy-block=1", "--finality-blocks=1", `--indexer-log=${indexerLog}`, `--health-log=${indexerHealthLog}`, `--chain-snapshot=${indexerChainSnapshot}`],
    requiredSections: ["dryRun", "finality", "chainSnapshot", "chainComparison"],
    check: ["scripts/check-indexer-dry-run.mjs"],
    checkArgs: (out) => ["--strict", `--manifest=${out}`],
  },
  {
    id: "restore-collector",
    out: join(tmp, "restore-proof.collector.json"),
    create: ["scripts/collect-restore-evidence.mjs"],
    createArgs: [
      `--source=${restoreSourcePath}`,
      `--backup-dir=${restoreBackupDir}`,
      `--restore-dir=${restoreDir}`,
      `--backup=${restoreBackupPath}`,
      "--restored-origin=https://restore.playlore.xyz",
      "--restored-host-type=restore",
      `--restore-log=${restoreLog}`,
      `--health-log=${restoreHealthLog}`,
    ],
    requiredSections: ["backupSchedule", "restoreDrill", "restoredStagingHealth", "indexerPreservation"],
    check: ["scripts/verify-db-restore.mjs"],
    checkArgs: (out) => ["--strict", `--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, `--manifest=${out}`],
  },
];
const collectorRejectCases = [
  {
    id: "host-collector-missing-logs",
    create: ["scripts/collect-host-evidence.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--host-type=production", "--load-origin=https://canary.playlore.xyz", "--load-host-type=canary"],
    expected: "--health-log is required when collecting launch host evidence",
  },
  {
    id: "host-collector-missing-health-base",
    create: ["scripts/collect-host-evidence.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--host-type=production", "--load-origin=https://canary.playlore.xyz", "--load-host-type=canary", `--health-log=${hostHealthMissingBaseLog}`, `--load-log=${hostLoadLog}`],
    expected: "--health-log must include base=<production origin>",
  },
  {
    id: "host-collector-missing-load-base",
    create: ["scripts/collect-host-evidence.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--host-type=production", "--load-origin=https://canary.playlore.xyz", "--load-host-type=canary", `--health-log=${hostHealthLog}`, `--load-log=${hostLoadMissingBaseLog}`],
    expected: "--load-log must include Load base URL line",
  },
  {
    id: "indexer-collector-repo-db",
    create: ["scripts/collect-indexer-evidence.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=1", "--chain-id=59144", "--deploy-block=1", "--finality-blocks=1", `--indexer-log=${indexerRepoDbLog}`, `--health-log=${indexerHealthLog}`, `--chain-snapshot=${indexerChainSnapshot}`],
    expected: "--indexer-log [indexer] SQLite path must be outside the repo checkout",
  },
  {
    id: "restore-collector-missing-runtime",
    create: ["scripts/collect-restore-evidence.mjs"],
    createArgs: [`--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, "--restored-origin=https://restore.playlore.xyz", "--restored-host-type=restore", `--restore-log=${restoreLog}`, `--health-log=${restoreHealthMissingRuntimeLog}`],
    expected: "--health-log must include runtime=ok/pass/healthy",
  },
  {
    id: "canary-draft-empty-live-log",
    create: ["scripts/create-canary-proof-draft.mjs"],
    createArgs: ["--network=linea-mainnet", "--chain-id=59144", "--contract=0x1111111111111111111111111111111111111111", "--rpc-label=redacted-mainnet-rpc", `--live-log=${emptyCanaryLog}`, `--target-artifact=${canaryTargetArtifact}`, `--recovery-artifact=${canaryRecoveryArtifact}`, `--session-artifact=${canarySessionArtifact}`, `--tx-artifact=${canaryTxArtifact}`],
    expected: "--live-log must include at least one successful auto-miner canary tx",
  },
];

const finalOutputCases = [
  {
    id: "signoff-final-output",
    create: ["scripts/create-signoff-proof-draft.mjs"],
    createArgs: ["--out=docs/signoff-proof.json"],
    expected: "writes incomplete drafts only",
  },
  {
    id: "host-final-output",
    create: ["scripts/create-host-proof-draft.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--load-origin=https://canary.playlore.xyz", "--load-host-type=canary", "--out=docs/host-proof.json"],
    expected: "writes incomplete drafts only",
  },
  {
    id: "indexer-final-output",
    create: ["scripts/create-indexer-proof-draft.mjs"],
    createArgs: ["--out=docs/indexer-proof.json"],
    expected: "writes incomplete drafts only",
  },
  {
    id: "restore-final-output",
    create: ["scripts/create-restore-proof-draft.mjs"],
    createArgs: ["--out=docs/restore-proof.json"],
    expected: "writes incomplete drafts only",
  },
  {
    id: "qa-final-output",
    create: ["scripts/create-qa-proof-draft.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--network=linea-mainnet", "--chain-id=59144", "--out=docs/qa-proof.json"],
    expected: "writes incomplete drafts only",
  },
  {
    id: "canary-final-output",
    create: ["scripts/create-canary-proof-draft.mjs"],
    createArgs: ["--network=linea-mainnet", "--chain-id=59144", "--contract=0x1111111111111111111111111111111111111111", "--rpc-label=redacted-mainnet-rpc", "--out=docs/canary-proof.json"],
    expected: "writes incomplete drafts only",
  },
  {
    id: "monitoring-final-output",
    create: ["scripts/create-monitoring-proof-draft.mjs"],
    createArgs: ["--provider=synthetic-monitor", "--error-provider=synthetic-error-tracker", "--origin=https://playlore.xyz", "--out=docs/monitoring-proof.json"],
    expected: "writes incomplete drafts only",
  },
];

function runNode(args) {
  return spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    env: process.env,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
}

function oneLine(output) {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const preferred = lines.find((line) => /writes incomplete drafts only|collector writes incomplete evidence drafts only/i.test(line));
  const compact = preferred || lines.slice(-3).join(" | ");
  return compact.length > 260 ? `${compact.slice(0, 257)}...` : compact;
}

function printTable(headers, rows) {
  console.log(`| ${headers.join(" | ")} |`);
  console.log(`| ${headers.map(() => "---").join(" | ")} |`);
  for (const row of rows) console.log(`| ${row.join(" | ")} |`);
}

const rows = [];
const issues = [];

for (const item of draftCases) {
  const createResult = runNode([...item.create, ...item.createArgs, `--out=${item.out}`]);
  const createOutput = `${createResult.stdout || ""}\n${createResult.stderr || ""}`;
  if (createResult.status !== 0) {
    issues.push(`${item.id}: draft generation failed`);
    rows.push([item.id, "create failed", String(createResult.status), oneLine(createOutput).replace(/\|/g, "\\|")]);
    continue;
  }

  const checkResult = runNode([...item.check, ...item.checkArgs(item.out)]);
  const checkOutput = `${checkResult.stdout || ""}\n${checkResult.stderr || ""}`;
  const rejectedAsDraft = checkResult.status !== 0 && /draft proof manifests are not accepted as launch proof/i.test(checkOutput);
  if (!rejectedAsDraft) {
    issues.push(`${item.id}: strict validator did not reject draft proof manifest`);
  }
  rows.push([item.id, rejectedAsDraft ? "rejected" : "issue", String(checkResult.status), oneLine(checkOutput).replace(/\|/g, "\\|")]);
}

for (const item of collectorDraftCases) {
  const createResult = runNode([...item.create, ...item.createArgs, `--out=${item.out}`]);
  const createOutput = `${createResult.stdout || ""}\n${createResult.stderr || ""}`;
  if (createResult.status !== 0) {
    issues.push(`${item.id}: collector draft generation failed`);
    rows.push([item.id, "create failed", String(createResult.status), oneLine(createOutput).replace(/\|/g, "\\|")]);
    continue;
  }

  let manifest = null;
  try {
    manifest = JSON.parse(readFileSync(item.out, "utf8"));
  } catch {
    issues.push(`${item.id}: collector output is not valid JSON`);
  }
  const missingSections = item.requiredSections.filter((section) => !manifest || !(section in manifest));
  if (missingSections.length > 0) {
    issues.push(`${item.id}: collector output missing ${missingSections.join(", ")}`);
  }

  const checkResult = runNode([...item.check, ...item.checkArgs(item.out)]);
  const checkOutput = `${checkResult.stdout || ""}\n${checkResult.stderr || ""}`;
  const rejectedAsIncomplete = checkResult.status !== 0;
  if (!rejectedAsIncomplete) {
    issues.push(`${item.id}: strict validator accepted incomplete collector draft`);
  }
  rows.push([item.id, rejectedAsIncomplete && missingSections.length === 0 ? "rejected incomplete" : "issue", String(checkResult.status), oneLine(checkOutput).replace(/\|/g, "\\|")]);
}
for (const item of collectorRejectCases) {
  const createResult = runNode([...item.create, ...item.createArgs]);
  const createOutput = `${createResult.stdout || ""}\n${createResult.stderr || ""}`;
  const rejected = createResult.status !== 0 && createOutput.includes(item.expected);
  if (!rejected) {
    issues.push(`${item.id}: incomplete collector evidence was not rejected`);
  }
  rows.push([item.id, rejected ? "rejected" : "issue", String(createResult.status), oneLine(createOutput).replace(/\|/g, "\\|")]);
}

for (const item of finalOutputCases) {
  const createResult = runNode([...item.create, ...item.createArgs]);
  const createOutput = `${createResult.stdout || ""}\n${createResult.stderr || ""}`;
  const rejected = createResult.status !== 0 && createOutput.includes(item.expected);
  if (!rejected) {
    issues.push(`${item.id}: final proof output was not rejected`);
  }
  rows.push([item.id, rejected ? "rejected" : "issue", String(createResult.status), oneLine(createOutput).replace(/\|/g, "\\|")]);
}

const bundleOutDir = join(tmp, "proof-draft-bundle");
const bundleResult = runNode(["scripts/create-all-proof-drafts.mjs", `--out-dir=${bundleOutDir}`]);
const bundleOutput = `${bundleResult.stdout || ""}\n${bundleResult.stderr || ""}`;
const bundleWarns = bundleResult.status === 0 && /Draft files are not launch proof/i.test(bundleOutput) && /strict validation/i.test(bundleOutput);
if (!bundleWarns) {
  issues.push("draft-bundle: bundle generator did not warn that drafts are not launch proof");
}
let bundleRejectedCount = 0;
if (bundleResult.status === 0) {
  for (const item of draftCases) {
    const out = join(bundleOutDir, `${item.id}-proof.draft.json`);
    const checkResult = runNode([...item.check, ...item.checkArgs(out)]);
    if (checkResult.status !== 0) {
      bundleRejectedCount += 1;
    } else {
      issues.push(`draft-bundle: strict validator accepted ${item.id}-proof.draft.json`);
    }
  }
}
const bundleOk = bundleWarns && bundleRejectedCount === draftCases.length;
rows.push(["draft-bundle", bundleOk ? "created as non-proof" : "issue", String(bundleResult.status), oneLine(bundleOutput).replace(/\|/g, "\\|")]);
printTable(["Draft", "Strict Result", "Exit", "Evidence"], rows);
console.log(`Summary: ${issues.length === 0 ? "all proof drafts are rejected by strict validators" : `${issues.length} issue(s): ${issues.join("; ")}`}.`);

if (issues.length > 0) process.exitCode = 1;
