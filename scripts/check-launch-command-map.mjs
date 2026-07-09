import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const commandMapPath = resolve(process.cwd(), "docs/launch-evidence-command-map.md");
const packagePath = resolve(process.cwd(), "package.json");

const linkedDocs = [
  "docs/mainnet-readiness-checklist.md",
  "docs/mainnet-status-board.md",
  "docs/production-runbook.md",
];

const requiredScripts = [
  "proof:signoff:collect",
  "proof:mainnet",
  "proof:chain",
  "proof:signoff",
  "proof:collector-redaction",
  "proof:process-model",
  "proof:host:collect",
  "proof:host",
  "proof:host-guard",
  "indexer:once",
  "proof:indexer:collect",
  "proof:indexer",
  "proof:restore:collect",
  "proof:restore",
  "proof:monitoring:plan",
  "proof:monitoring:draft",
  "proof:monitoring",
  "proof:qa:plan",
  "proof:qa:draft",
  "proof:qa",
  "proof:canary:draft",
  "proof:canary",
  "proof:files",
  "proof:gates",
  "proof:readiness",
  "proof:launch-docs",
  "proof:launch-map",
  "proof:remaining",
  "proof:local",
  "proof:launch",
];

const requiredProofFiles = [
  "docs/signoff-proof.json",
  "docs/host-proof.json",
  "docs/indexer-proof.json",
  "docs/restore-proof.json",
  "docs/monitoring-proof.json",
  "docs/qa-proof.json",
  "docs/canary-proof.json",
];

const commandMapEvidenceMarkers = [
  "## Required Evidence Markers",
  "contractEnv",
  "ownership.directOwnerReadEvidence",
  "Safe/multisig governance evidence",
  "randomness.decision",
  "operator/signer sign-off",
  "chainComparison",
  "jackpot",
  "safetyPool",
  "deposits",
  "rewards",
  "rebates",
  "resolve",
  "docs/host-health-prod.log",
  "docs/host-load-http.log",
  "fresh external DB",
  "docs/indexer-once.log",
  "$env:LORE_DB_PATH",
  "$env:INDEXER_START_BLOCK",
  "$env:NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK",
  "$env:INDEXER_FINALITY_BLOCKS",
  "backup schedule",
  "docs/restore-drill.log",
  "docs/restore-health-prod.log",
  "indexer preservation evidence",
  "health-prod",
  "data-sync",
  "stale-indexer-heartbeat",
  "indexer-lag",
  "bot-restart",
  "indexer-restart",
  "reverted-tx",
  "fired alert",
  "recovery alert",
  "alert target",
  "error event artifacts",
  "target-RPC JSONL",
  "50 successful auto-miner unique epochs",
  "unique tx hashes",
  "reload/reconnect/tab-close/pending tx/remount recovery",
  "noDuplicateBets",
  "noNonceLoops",
  "noStuckPending",
  "Privy allowed origins",
  "wrong network",
  "mobile Web3 browser",
  "clean-wallet first tx",
  "failure-state UX",
  "support/audit visibility",
  "debug autominer smoke",
  "mobile layout",
  "overlays",
  "chat geometry",
  "mainnet wording",
];

const strictRequiredScripts = [
  "proof:mainnet",
  "proof:chain",
  "proof:signoff",
  "proof:process-model",
  "proof:host",
  "proof:indexer",
  "proof:restore",
  "proof:monitoring",
  "proof:qa",
  "proof:canary",
  "proof:gates",
  "proof:launch",
];

function readText(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`Missing required file: ${filePath}`);
  }
  return readFileSync(filePath, "utf8");
}

function extractNpmScripts() {
  const pkg = JSON.parse(readText(packagePath));
  return pkg.scripts ?? {};
}

function commandLinesFor(text, scriptName) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.includes(scriptName));
}

function hasLineWith(text, scriptName, requiredParts) {
  return commandLinesFor(text, scriptName).some((line) => requiredParts.every((part) => line.includes(part)));
}

function assertOrderedMarkers(docName, text, markers) {
  let previousIndex = -1;
  let previousLabel = "start";
  for (const [label, marker] of markers) {
    const index = text.indexOf(marker);
    if (index === -1) {
      issues.push(`${docName} is missing order marker ${label}: ${marker}`);
      continue;
    }
    if (index <= previousIndex) {
      issues.push(`${docName} must show ${label} after ${previousLabel}`);
    }
    previousIndex = index;
    previousLabel = label;
  }
}
function printTable(title, rows) {
  console.log(title);
  for (const row of rows) {
    console.log(`- ${row}`);
  }
}

const issues = [];
const commandMap = readText(commandMapPath);
const scripts = extractNpmScripts();

for (const scriptName of requiredScripts) {
  if (!scripts[scriptName]) {
    issues.push(`package.json is missing npm script ${scriptName}`);
  }
  if (!commandMap.includes(`npm.cmd run ${scriptName}`)) {
    issues.push(`command map does not mention npm.cmd run ${scriptName}`);
  }
}

for (const file of requiredProofFiles) {
  if (!commandMap.includes(file)) {
    issues.push(`command map does not mention required proof file ${file}`);
  }
}

for (const marker of commandMapEvidenceMarkers) {
  if (!commandMap.includes(marker)) {
    issues.push(`command map does not mention required evidence marker ${marker}`);
  }
}

const linkedDocTexts = new Map();
for (const doc of linkedDocs) {
  const docPath = resolve(process.cwd(), doc);
  if (!existsSync(docPath)) {
    issues.push(`linked launch doc is missing: ${doc}`);
  } else {
    linkedDocTexts.set(doc, readText(docPath));
    if (!commandMap.includes(doc)) {
      issues.push(`command map does not link ${doc}`);
    }
  }
}

for (const scriptName of strictRequiredScripts) {
  if (!hasLineWith(commandMap, scriptName, ["--strict"])) {
    issues.push(`command map must show ${scriptName} with --strict`);
  }
}

const commandExpectations = [
  ["proof:mainnet", ["--strict", "--out="]],
  ["proof:chain", ["--strict", "--out="]],
  ["proof:launch", ["--strict", "--canary-log="]],
  ["proof:files", ["--canary-log="]],
  ["proof:signoff:collect", ["--epochs=", "--user=", "--env-log=docs/mainnet-env-proof.log", "--chain-log=docs/chain-proof-snapshot.json", "--out=docs/signoff-proof.draft.json"]],
  ["proof:host:collect", ["--load-origin=", "--load-host-type=", "--health-log=docs/host-health-prod.log", "--load-log=docs/host-load-http.log", "--out=docs/host-proof.draft.json"]],
  ["proof:indexer:collect", ["--fresh-db=true", "--epochs=", "--chain-id=59144", "--deploy-block=", "--finality-blocks=", "--indexer-log=docs/indexer-once.log", "--health-log=docs/indexer-health-prod.log", "--chain-snapshot=docs/chain-proof-snapshot.json", "--out=docs/indexer-proof.draft.json"]],
  ["proof:restore:collect", ["--source=", "--backup-dir=", "--restore-dir=", "--backup=", "--restored-origin=", "--restored-host-type=", "--restore-log=docs/restore-drill.log", "--health-log=docs/restore-health-prod.log", "--out=docs/restore-proof.draft.json"]],
  ["proof:monitoring:plan", ["--provider=", "--error-provider=", "--origin="]],
  ["proof:monitoring:draft", ["--provider=", "--error-provider=", "--origin=", "--monitor-artifact=docs/monitoring-alert-export.log", "--recovery-artifact=docs/monitoring-recovery-export.log", "--alert-target-artifact=docs/monitoring-alert-target-test.log", "--error-event-artifact=docs/error-tracking-test-event.log"]],
  ["proof:qa:plan", ["--origin=", "--network="]],
  ["proof:qa:draft", ["--origin=", "--network=", "--wallet-artifact=docs/qa-wallet-flow-report.md", "--failure-artifact=docs/qa-failure-state-report.md", "--support-artifact=docs/qa-support-audit-report.md", "--finalqa-artifact=docs/qa-final-browser-report.md", "--smoke-artifact=docs/qa-smoke-debug-autominer.log", "--clean-wallet-tx="]],
  ["proof:canary:draft", ["--network=", "--chain-id=", "--contract=", "--rpc-label=", "--live-log=data/live-test-runs/live-canary-YYYY.jsonl", "--target-artifact=docs/canary-target-proof.log", "--recovery-artifact=docs/canary-recovery-proof.log", "--session-artifact=docs/canary-session-summary.log", "--tx-artifact=docs/canary-transaction-scan.log", "<redacted-provider-rpc-label>"]],
  ["proof:canary", [".jsonl", "--strict"]],
];

for (const [scriptName, parts] of commandExpectations) {
  if (!hasLineWith(commandMap, scriptName, parts)) {
    issues.push(`command map must show ${scriptName} with ${parts.join(", ")}`);
  }
}

const artifactBackedDocExpectations = [
  [
    "docs/production-runbook.md",
    [
      ["proof:mainnet", ["--strict", "--out=docs/mainnet-env-proof.log"]],
      ["proof:chain", ["--strict", "--out=docs/chain-proof-snapshot.json"]],
      ["proof:signoff:collect", ["--env-log=docs/mainnet-env-proof.log", "--chain-log=docs/chain-proof-snapshot.json", "--out=docs/signoff-proof.draft.json"]],
      ["proof:signoff", ["--strict"]],
      ["proof:host:collect", ["--health-log=docs/host-health-prod.log", "--load-log=docs/host-load-http.log"]],
      ["proof:indexer:collect", ["--indexer-log=docs/indexer-once.log", "--health-log=docs/indexer-health-prod.log", "--chain-snapshot=docs/chain-proof-snapshot.json"]],
      ["proof:restore:collect", ["--restore-log=docs/restore-drill.log", "--health-log=docs/restore-health-prod.log"]],
      ["proof:monitoring:draft", ["--monitor-artifact=docs/monitoring-alert-export.log", "--recovery-artifact=docs/monitoring-recovery-export.log", "--alert-target-artifact=docs/monitoring-alert-target-test.log", "--error-event-artifact=docs/error-tracking-test-event.log"]],
      ["proof:qa:draft", ["--wallet-artifact=docs/qa-wallet-flow-report.md", "--failure-artifact=docs/qa-failure-state-report.md", "--support-artifact=docs/qa-support-audit-report.md", "--finalqa-artifact=docs/qa-final-browser-report.md", "--smoke-artifact=docs/qa-smoke-debug-autominer.log", "--clean-wallet-tx="]],
      ["proof:canary:draft", ["--live-log=data/live-test-runs/live-canary-YYYY.jsonl", "--target-artifact=docs/canary-target-proof.log", "--recovery-artifact=docs/canary-recovery-proof.log", "--session-artifact=docs/canary-session-summary.log", "--tx-artifact=docs/canary-transaction-scan.log"]],
      ["proof:files", ["--canary-log="]],
    ],
  ],
  [
    "docs/mainnet-readiness-checklist.md",
    [
      ["proof:signoff:collect", ["--env-log=docs/mainnet-env-proof.log", "--chain-log=docs/chain-proof-snapshot.json"]],
      ["proof:host:collect", ["--health-log=docs/host-health-prod.log", "--load-log=docs/host-load-http.log"]],
      ["proof:indexer:collect", ["--indexer-log=docs/indexer-once.log", "--health-log=docs/indexer-health-prod.log", "--chain-snapshot=docs/chain-proof-snapshot.json"]],
      ["proof:restore:collect", ["--restore-log=docs/restore-drill.log", "--health-log=docs/restore-health-prod.log"]],
      ["proof:monitoring:draft", ["--monitor-artifact=docs/monitoring-alert-export.log", "--recovery-artifact=docs/monitoring-recovery-export.log", "--alert-target-artifact=docs/monitoring-alert-target-test.log", "--error-event-artifact=docs/error-tracking-test-event.log"]],
      ["proof:qa:draft", ["--wallet-artifact=docs/qa-wallet-flow-report.md", "--failure-artifact=docs/qa-failure-state-report.md", "--support-artifact=docs/qa-support-audit-report.md", "--finalqa-artifact=docs/qa-final-browser-report.md", "--smoke-artifact=docs/qa-smoke-debug-autominer.log", "--clean-wallet-tx="]],
      ["proof:canary:draft", ["--live-log=data/live-test-runs/live-canary-YYYY.jsonl", "--target-artifact=docs/canary-target-proof.log", "--recovery-artifact=docs/canary-recovery-proof.log", "--session-artifact=docs/canary-session-summary.log", "--tx-artifact=docs/canary-transaction-scan.log"]],
      ["proof:files", ["--canary-log="]],
    ],
  ],
];

for (const [doc, expectations] of artifactBackedDocExpectations) {
  const docText = linkedDocTexts.get(doc) ?? "";
  for (const [scriptName, parts] of expectations) {
    if (!hasLineWith(docText, scriptName, parts)) {
      issues.push(`${doc} must show ${scriptName} with ${parts.join(", ")}`);
    }
  }
}

const productionRunbook = linkedDocTexts.get("docs/production-runbook.md") ?? "";
for (const marker of ["docs/signoff-proof.json", "contractEnv", "ownership.directOwnerReadEvidence", "Safe/multisig governance evidence", "proof tx", "randomness.decision", "operator/signer sign-off", "chainComparison", "jackpot", "safetyPool", "deposits", "rewards", "rebates", "resolve"]) {
  if (!productionRunbook.includes(marker)) {
    issues.push(`docs/production-runbook.md must show signoff evidence marker ${marker}`);
  }
}
for (const marker of ["$env:PROD_HEALTH_BASE_URL", "https://playlore.xyz", "npm.cmd run health:prod", "docs/host-health-prod.log", "$env:LOAD_BASE_URL", "https://canary.playlore.xyz", "npm.cmd run load:http", "docs/host-load-http.log", "Load base URL:"]) {
  if (!productionRunbook.includes(marker)) {
    issues.push(`docs/production-runbook.md must show production host evidence marker ${marker}`);
  }
}
for (const marker of ["target-RPC JSONL", "$env:LIVE_CANARY_RPC_LABEL", "<redacted-provider-rpc-label>", "npm.cmd run live:canary", "50 successful auto-miner unique epochs", "reload/reconnect/tab-close/pending tx/remount", "no duplicate bets", "nonce loops", "stuck pending", "Privy allowed origins", "wrong network", "mobile Web3 browser", "clean-wallet first tx", "Wallet browser checks must record the exact production origin", "debug autominer smoke", "docs/qa-wallet-flow-report.md", "docs/qa-failure-state-report.md", "docs/qa-support-audit-report.md", "docs/qa-final-browser-report.md", "docs/qa-smoke-debug-autominer.log", "data/live-test-runs/live-canary-YYYY.jsonl", "docs/canary-target-proof.log", "docs/canary-recovery-proof.log", "docs/canary-session-summary.log", "docs/canary-transaction-scan.log"]) {
  if (!productionRunbook.includes(marker)) {
    issues.push(`docs/production-runbook.md must show canary/QA evidence marker ${marker}`);
  }
}
for (const marker of ["health-prod", "data-sync", "stale-indexer-heartbeat", "indexer-lag", "bot-restart", "indexer-restart", "reverted-tx", "distinct fired alert", "recovery timestamp", "docs/monitoring-alert-export.log", "docs/monitoring-recovery-export.log", "docs/monitoring-alert-target-test.log", "docs/error-tracking-test-event.log"]) {
  if (!productionRunbook.includes(marker)) {
    issues.push(`docs/production-runbook.md must show monitoring evidence marker ${marker}`);
  }
}
for (const marker of ["$env:LORE_BACKUP_DIR", "$env:LORE_RESTORE_DRILL_DIR", "--backup=<absolute-backup-file-inside-backup-dir>", "docs/restore-drill.log", "successful restore summary", "https://restore.playlore.xyz", "docs/restore-health-prod.log", "[prod-health] OK", "base=<restored-origin>", "finalityLagBlocks", "--manifest=docs/restore-proof.json"]) {
  if (!productionRunbook.includes(marker)) {
    issues.push(`docs/production-runbook.md must show restore drill evidence marker ${marker}`);
  }
}
for (const marker of ["fresh external DB", "docs/indexer-once.log", "[indexer] SQLite path:", "matching the external `LORE_DB_PATH`", "[indexer] Finished runOnce", "no `[indexer] Fatal:` line", "$env:LORE_DB_PATH", "$env:INDEXER_START_BLOCK", "$env:NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK", "$env:INDEXER_FINALITY_BLOCKS"]) {
  if (!productionRunbook.includes(marker)) {
    issues.push(`docs/production-runbook.md must show fresh indexer dry-run marker ${marker}`);
  }
}
assertOrderedMarkers("docs/production-runbook.md", productionRunbook, [
  ["prepare evidence", "## 1. Prepare evidence drafts"],
  ["contract/funds safety", "## 2. Contract and funds safety"],
  ["signoff evidence markers", "ownership.directOwnerReadEvidence"],
  ["mainnet env proof", "npm.cmd run proof:mainnet -- --strict --out=docs/mainnet-env-proof.log"],
  ["chain snapshot proof", "npm.cmd run proof:chain -- --strict --out=docs/chain-proof-snapshot.json"],
  ["signoff collector", "npm.cmd run proof:signoff:collect"],
  ["strict signoff", "npm.cmd run proof:signoff -- --strict"],
  ["production host", "## 3. Production host"],
  ["production health", "npm.cmd run health:prod"],
  ["canary load", "npm.cmd run load:http"],
  ["host collector", "npm.cmd run proof:host:collect"],
  ["indexer and db", "## 4. Indexer and DB"],
  ["fresh indexer db", "$env:LORE_DB_PATH"],
  ["indexer once", "npm.cmd run indexer:once"],
  ["indexer collector", "npm.cmd run proof:indexer:collect"],
  ["restore drill", "npm.cmd run proof:restore -- --source="],
  ["restored health", "https://restore.playlore.xyz"],
  ["restore collector", "npm.cmd run proof:restore:collect"],
  ["strict restore", "npm.cmd run proof:restore -- --strict --source="],
  ["monitoring", "## 5. Monitoring"],
  ["monitoring required kinds", "stale-indexer-heartbeat"],
  ["monitoring plan", "npm.cmd run proof:monitoring:plan"],
  ["monitoring draft", "npm.cmd run proof:monitoring:draft"],
  ["strict monitoring", "npm.cmd run proof:monitoring -- --strict"],
  ["canary and final QA", "## 6. Canary and final QA"],
  ["canary qa invariants", "50 successful auto-miner unique epochs"],
  ["qa draft", "npm.cmd run proof:qa:draft"],
  ["strict qa", "npm.cmd run proof:qa -- --strict"],
  ["canary draft", "npm.cmd run proof:canary:draft"],
  ["strict canary", "npm.cmd run proof:canary -- data/live-test-runs/live-canary-YYYY.jsonl --strict"],
  ["proof files", "npm.cmd run proof:files -- --canary-log=<canary-log-file>"],
  ["strict launch", "npm.cmd run proof:launch -- --strict --canary-log=<canary-log-file>"],
  ["launch hold conditions", "## 7. Launch hold conditions"],
]);
if (!/Draft files are not launch proof/i.test(commandMap)) {
  issues.push('command map must state "Draft files are not launch proof"');
}
if (/\b[A-Z][A-Z0-9_]*=.*npm\.cmd run/.test(commandMap)) {
  issues.push("command map must not use bash-style inline env assignment before npm.cmd run");
}
if (commandMap.includes("CANARY_LOG=") && !commandMap.includes("$env:CANARY_LOG")) {
  issues.push("canary env examples must use PowerShell $env: variables, not bash inline variables");
}

printTable("Launch command map coverage", requiredScripts.map((scriptName) => `${scriptName}: ${scripts[scriptName] ? "package" : "missing package"}, ${commandLinesFor(commandMap, scriptName).length} doc line(s)`));

if (issues.length > 0) {
  printTable("Launch command map issues", issues);
  process.exit(1);
}

console.log("Launch command map checks passed.");
console.log("Summary: launch evidence command map is consistent.");
