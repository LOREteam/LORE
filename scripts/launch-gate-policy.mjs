import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";

const EXISTING_ARTIFACT_GATES = new Set(["G1", "G2", "G3", "G4", "G8"]);
export const MAX_LIVE_CANARY_LOG_PATHS = 16;
export const MAX_LAUNCH_MARKDOWN_BYTES = 1024 * 1024;

export function regularLaunchFileStat(filePath) {
  try {
    const stats = lstatSync(filePath);
    return stats.isFile() && !stats.isSymbolicLink() ? stats : null;
  } catch {
    return null;
  }
}

export function readLaunchMarkdown(filePath, maxBytes = MAX_LAUNCH_MARKDOWN_BYTES) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error("Launch markdown byte limit must be a positive safe integer");
  }
  const stats = regularLaunchFileStat(filePath);
  if (!stats) throw new Error("Missing required launch markdown or not a regular file");
  if (stats.size > maxBytes) throw new Error("Required launch markdown is too large to validate safely");
  const bytes = readFileSync(filePath);
  if (bytes.length !== stats.size || bytes.length > maxBytes) {
    throw new Error("Required launch markdown changed while it was being validated");
  }
  return bytes.toString("utf8");
}

export function localLaunchArtifactExists(workspaceRoot, relativePath) {
  const normalized = String(relativePath ?? "").replaceAll("\\", "/");
  if (
    normalized.length < 1 ||
    path.posix.isAbsolute(normalized) ||
    path.win32.isAbsolute(normalized) ||
    path.posix.normalize(normalized) !== normalized ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) return false;
  const root = path.resolve(workspaceRoot);
  const absolutePath = path.resolve(root, ...normalized.split("/"));
  const relative = path.relative(root, absolutePath);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return false;
  return regularLaunchFileStat(absolutePath) !== null;
}

const LAUNCH_GATE_POLICY = [
  {
    id: "G1", group: "env", proofFiles: ["docs/signoff-proof.json"],
    firstCheck: ["proof:mainnet", "--strict", "--out=docs/mainnet-env-proof.log"],
    compactStatusCheck: "npm.cmd run proof:mainnet:strict:compact",
    markers: ["contractEnv", "chain ID", "deploy block", "token", "finality", "V10 protected bets"],
    verifierMarkers: ["contractEnv", "chain ID", "deploy block", "token", "finality", "V10 protected bets flag"],
  },
  {
    id: "G2", group: "signoff", proofFiles: ["docs/signoff-proof.json"],
    firstCheck: ["proof:signoff", "--strict"], compactStatusCheck: "npm.cmd run proof:signoff:strict:summary",
    markers: ["ownership.directOwnerReadEvidence", "Safe/multisig governance evidence", "proof tx"],
  },
  {
    id: "G3", group: "signoff", proofFiles: ["docs/signoff-proof.json"],
    firstCheck: ["proof:signoff", "--strict"], compactStatusCheck: "npm.cmd run proof:signoff:strict:summary",
    markers: ["randomness.decision", "operator/signer sign-off"],
  },
  {
    id: "G4", group: "chain", proofFiles: ["docs/signoff-proof.json"],
    firstCheck: ["proof:chain", "--strict", "--out=docs/chain-proof-snapshot.json"],
    compactStatusCheck: "npm.cmd run proof:chain:strict:summary",
    markers: ["chainComparison", "jackpot", "safetyPool", "deposits", "rewards", "rebates", "resolve"],
  },
  {
    id: "G5", group: "host", proofFiles: ["docs/host-proof.json"],
    firstCheck: ["proof:host:collect", "--host-type=production", "--db-path=", "--supervisor=", "--process-evidence=docs/host-process-model.log", "--health-log=docs/host-health-prod.log", "--load-log=docs/host-load-http.log", "--out=docs/host-proof.draft.json"],
    compactStatusCheck: "npm.cmd run proof:host:summary",
    markers: ["lore-site", "lore-bot", "lore-indexer", "supervisor evidence", "persistent DB"],
  },
  {
    id: "G6", group: "host", proofFiles: ["docs/host-proof.json"],
    firstCheck: ["proof:host", "--strict"], compactStatusCheck: "npm.cmd run proof:host:strict:summary",
    markers: ["health:prod", "docs/host-health-prod.log", "base=<production origin>", "finalityLagBlocks", "load:http", "docs/host-load-http.log", "Load base URL:", "externalRateLimit", "webReplicaCount", "sharedBucketVerified", "failClosed"],
  },
  {
    id: "G7", group: "indexer", proofFiles: ["docs/indexer-proof.json"],
    firstCheck: ["proof:indexer:collect", "--chain-id=59144", "--indexer-log=docs/indexer-once.log", "--health-log=docs/indexer-health-prod.log", "--chain-snapshot=docs/chain-proof-snapshot.json", "--out=docs/indexer-proof.draft.json"],
    compactStatusCheck: "npm.cmd run proof:indexer:strict:summary",
    markers: ["fresh external DB", "deploy block", "INDEXER_FINALITY_BLOCKS", "docs/indexer-once.log", "chainSnapshot", "rpcChainId", "contractAddress", "finalityLagBlocks", "chainComparison"],
  },
  {
    id: "G8", group: "restore", proofFiles: ["docs/restore-proof.json"],
    firstCheck: ["proof:restore:collect", "--restore-log=docs/restore-drill.log", "--health-log=docs/restore-health-prod.log", "--backup-schedule-artifact=docs/restore-backup-schedule.log", "--preservation-artifact=docs/restore-indexer-preservation.log", "--out=docs/restore-proof.draft.json"],
    compactStatusCheck: "npm.cmd run proof:restore:strict:summary",
    markers: ["backupSchedule", "retentionDays", "lastSuccessfulBackupAt", "docs/restore-backup-schedule.log", "docs/restore-drill.log", "docs/restore-health-prod.log", "docs/restore-indexer-preservation.log", "indexerPreservation"],
  },
  {
    id: "G9", group: "monitoring", proofFiles: ["docs/monitoring-proof.json"],
    firstCheck: ["proof:monitoring:plan", "--provider=", "--error-provider=", "--origin=", "--out=docs/monitoring-alert-test-plan.draft.md"],
    compactStatusCheck: "npm.cmd run proof:monitoring:strict:summary",
    markers: ["health-prod", "data-sync", "stale-indexer-heartbeat", "indexer-lag", "bot-restart", "indexer-restart", "reverted-tx", "docs/monitoring-alert-export.log", "docs/monitoring-recovery-export.log", "docs/monitoring-alert-target-test.log", "docs/error-tracking-test-event.log", "fired/recovery alerts", "verified email alert target", "error event"],
  },
  {
    id: "G10", group: "canary", proofFiles: ["docs/canary-proof.json"], canaryLog: true,
    firstCheck: ["proof:canary", "data/live-test-runs/live-canary-YYYY.jsonl", "--strict"],
    compactStatusCheck: "npm.cmd run proof:testnet:canary:strict:summary",
    markers: ["target-RPC JSONL", "MANUAL", "AUTOMINER_A", "AUTOMINER_B", "50 successful auto-miner unique epochs"],
  },
  {
    id: "G11", group: "canary", proofFiles: ["docs/canary-proof.json"], canaryLog: true,
    firstCheck: ["proof:canary", "data/live-test-runs/live-canary-YYYY.jsonl", "--strict"],
    compactStatusCheck: "npm.cmd run proof:testnet:canary:strict:summary",
    markers: ["noDuplicateBets", "noNonceLoops", "noStuckPending", "pendingRecoveryConverged", "recovery evidence"],
  },
  {
    id: "G12", group: "qa", proofFiles: ["docs/qa-proof.json"],
    firstCheck: ["proof:qa:plan", "--origin=https://playlore.xyz", "--network=linea-mainnet", "--chain-id=59144", "--out=docs/qa-canary-test-plan.draft.md"],
    compactStatusCheck: "npm.cmd run proof:qa:summary",
    markers: ["Privy allowed origins", "redacted production App ID configured proof", "wrong network", "mobile Web3 browser", "clean-wallet first tx", "slow auth"],
  },
  {
    id: "G13", group: "qa", proofFiles: ["docs/qa-proof.json"],
    firstCheck: ["proof:qa", "--strict"], compactStatusCheck: "npm.cmd run proof:qa:strict:summary",
    markers: ["disabled reasons", "pending states", "degraded data", "bet history", "auto-miner logs", "diagnostics"],
  },
  {
    id: "G14", group: "qa", proofFiles: ["docs/qa-proof.json"], canaryLog: true,
    firstCheck: ["proof:files", "--canary-log="], compactStatusCheck: "npm.cmd run proof:files:summary",
    markers: ["debug autominer smoke", "mobile layout", "overlays", "chat geometry", "mainnet wording", "final security scan", "no open High/Medium local findings"],
  },
];

export function createLaunchGatePolicyMaps({ verifier = false } = {}) {
  const expected = [];
  const requiredProofFilesByGate = new Map();
  const launchGateGroups = new Map();
  const gatesRequiringCanaryLog = new Set();
  const statusBoardFirstCheckExpectations = new Map();
  const compactStatusCheckByGate = new Map();
  const requiredProofMarkerExpectations = new Map();

  for (const row of LAUNCH_GATE_POLICY) {
    expected.push(row.id);
    requiredProofFilesByGate.set(row.id, [...row.proofFiles]);
    launchGateGroups.set(row.id, row.group);
    if (row.canaryLog === true) gatesRequiringCanaryLog.add(row.id);
    statusBoardFirstCheckExpectations.set(row.id, [...row.firstCheck]);
    compactStatusCheckByGate.set(row.id, row.compactStatusCheck);
    const markers = verifier && row.verifierMarkers ? row.verifierMarkers : row.markers;
    requiredProofMarkerExpectations.set(row.id, [
      ...markers,
      ...(verifier && EXISTING_ARTIFACT_GATES.has(row.id) ? ["existing saved artifacts"] : []),
    ]);
  }

  return {
    expected,
    requiredProofFilesByGate,
    launchGateGroups,
    gatesRequiringCanaryLog,
    statusBoardFirstCheckExpectations,
    compactStatusCheckByGate,
    requiredProofMarkerExpectations,
  };
}

export function findLiveCanaryLogPaths(value) {
  const paths = [];
  const pattern = /\bdata\/live-test-runs\/[^|\s`]+\.jsonl\b/gi;
  const normalized = String(value ?? "").replace(/\\/g, "/");
  let match = pattern.exec(normalized);
  while (match !== null) {
    paths.push(match[0]);
    if (paths.length >= MAX_LIVE_CANARY_LOG_PATHS) return paths;
    match = pattern.exec(normalized);
  }
  return paths;
}
