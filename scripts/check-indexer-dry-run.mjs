import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

const strict = process.argv.includes("--strict") || process.env.PROOF_STRICT === "1";
const repoRoot = process.cwd();
const args = new Map(
  process.argv
    .slice(2)
    .filter((arg) => arg.startsWith("--") && arg.includes("="))
    .map((arg) => {
      const [key, ...rest] = arg.slice(2).split("=");
      return [key, rest.join("=")];
    }),
);

const REQUIRED_TABLES = [
  "meta",
  "epochs",
  "scoped_epochs",
  "bets",
  "scoped_bets",
  "jackpots",
  "scoped_jackpots",
  "reward_claims",
  "scoped_reward_claims",
];
const REQUIRED_CHAIN_COMPARISONS = ["jackpot", "deposits", "rewards", "rebates", "latestEpochs"];
const TEMPLATE_VALUE_RE = /REPLACE_|<REDACTED>|TODO|TBD/i;
const secretKeyPattern = /(secret|private[_-]?key|mnemonic|webhook|dsn|api[_-]?key|api[_-]?token|auth[_-]?token|access[_-]?token|bearer|session|cookie|password)/i;
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const knownNetworkChainIds = new Map([
  ["mainnet", "59144"],
  ["sepolia", "59141"],
]);

function env(name) {
  return process.env[name]?.trim() || "";
}

function argOrEnv(argName, envName) {
  return args.get(argName)?.trim() || env(envName);
}

function pathStatus(rawPath) {
  if (!rawPath) return { absolute: "", isAbsolute: false, insideRepo: false };
  const absolute = isAbsolute(rawPath) ? rawPath : resolve(repoRoot, rawPath);
  const normalizedAbsolute = absolute.toLowerCase();
  const normalizedRepo = repoRoot.toLowerCase();
  const insideRepo = normalizedAbsolute === normalizedRepo ||
    normalizedAbsolute.startsWith(`${normalizedRepo}\\`) ||
    normalizedAbsolute.startsWith(`${normalizedRepo}/`);
  return { absolute, isAbsolute: isAbsolute(rawPath), insideRepo };
}

function samePath(left, right) {
  if (!left || !right) return false;
  return resolve(left).replace(/[\\/]+/g, "/").toLowerCase() === resolve(right).replace(/[\\/]+/g, "/").toLowerCase();
}

function isNonNegativeInteger(value) {
  return /^\d+$/.test(value || "");
}

function isPositiveInteger(value) {
  return /^[1-9]\d*$/.test(value || "");
}

function integerString(value) {
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return value.trim();
  return "";
}

function nonEmptyEpochList(value) {
  if (!Array.isArray(value) || value.length === 0) return false;
  return value.every((entry) => {
    if (typeof entry === "number") return Number.isSafeInteger(entry) && entry >= 0;
    return typeof entry === "string" && /^\d+$/.test(entry.trim());
  });
}

function normalizeNetwork(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["main", "linea", "prod", "production"].includes(normalized)) return "mainnet";
  if (["testnet", "linea-sepolia", "sepolia-testnet"].includes(normalized)) return "sepolia";
  return normalized;
}

function normalizeAddress(value) {
  return String(value ?? "").trim().toLowerCase();
}

function isRealAddress(value) {
  const normalized = String(value ?? "").trim();
  return ADDRESS_RE.test(normalized) && normalizeAddress(normalized) !== "0x0000000000000000000000000000000000000000";
}

function printTable(headers, rows) {
  console.log(`| ${headers.join(" | ")} |`);
  console.log(`| ${headers.map(() => "---").join(" | ")} |`);
  for (const row of rows) console.log(`| ${row.join(" | ")} |`);
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasRealText(value) {
  return hasText(value) && !TEMPLATE_VALUE_RE.test(value);
}

function hasIsoTimestamp(value) {
  if (!hasRealText(value)) return false;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(text)) return false;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return false;
  const normalized = text.includes(".") ? text : text.replace("Z", ".000Z");
  return parsed.toISOString() === normalized;
}

function statusOk(value) {
  return ["ok", "pass", "passed", "healthy", "success", "green", "verified"].includes(String(value ?? "").trim().toLowerCase());
}

function hasEvidence(value) {
  if (!isPlainObject(value)) return false;
  return [
    value.evidence,
    value.evidencePath,
    value.link,
    value.summary,
    value.artifact,
    value.notes,
  ].some(hasRealText);
}

function hasConcreteText(value) {
  if (!hasRealText(value)) return false;
  const text = String(value).trim();
  return /https?:\/\//i.test(text) ||
    /(?:^|[\\/\s])[^\s]+\.(?:json|jsonl|log|md|txt|csv|sqlite|db)(?:\b|$)/i.test(text) ||
    /\bnpm(?:\.cmd)?\s+run\s+(?:indexer:once|health:prod|proof:[a-z0-9:-]+)\b/i.test(text) ||
    /\bproof:[a-z0-9:-]+\b/i.test(text) ||
    /\[indexer\]/i.test(text) ||
    /\b(?:direct[-\s]?chain|chain[-\s]?snapshot|rpcChainId|contractAddress|finalityLagBlocks)\b/i.test(text) ||
    /\b0x[a-fA-F0-9]{40}\b/.test(text);
}

function hasConcreteEvidence(value) {
  if (!isPlainObject(value)) return false;
  return [
    value.evidence,
    value.evidencePath,
    value.link,
    value.summary,
    value.artifact,
    value.notes,
    value.path,
  ].some(hasConcreteText);
}

function evidenceText(value) {
  if (!isPlainObject(value)) return "";
  return [
    value.evidence,
    value.evidencePath,
    value.link,
    value.summary,
    value.artifact,
    value.notes,
    value.path,
  ].filter(hasRealText).join("\n");
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasIndexerBlockMarker(value, label, expected) {
  const text = evidenceText(value);
  if (!text || !expected) return false;
  const pattern = new RegExp(`\\[indexer\\]\\s+${escapeRegExp(label)}:\\s*${escapeRegExp(expected)}\\b`, "i");
  return pattern.test(text);
}

function hasNumericFinalityLagEvidence(value) {
  if (!isPlainObject(value)) return false;
  const text = [value.evidence, value.evidencePath, value.link, value.summary, value.artifact, value.notes]
    .filter(hasRealText)
    .join("\n");
  const match = text.match(/\bfinalityLagBlocks=([^\s]+)/i);
  return Boolean(match && Number.isFinite(Number(match[1])));
}
function hasConfiguredRpcSource(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized.length > 0 &&
    !TEMPLATE_VALUE_RE.test(normalized) &&
    normalized !== "built-in fallback" &&
    normalized !== "fallback" &&
    normalized !== "default";
}

function findSecretLikeValues(value, path = "$") {
  const findings = [];
  if (Array.isArray(value)) {
    value.forEach((entry, index) => findings.push(...findSecretLikeValues(entry, `${path}[${index}]`)));
    return findings;
  }
  if (!isPlainObject(value)) return findings;
  for (const [key, entry] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (secretKeyPattern.test(key) && typeof entry === "string") {
      const normalized = entry.trim().toLowerCase();
      if (!["", "present", "configured", "redacted", "<redacted>"].includes(normalized)) {
        findings.push(childPath);
      }
    }
    findings.push(...findSecretLikeValues(entry, childPath));
  }
  return findings;
}

function findTemplateLikeValues(value, path = "$") {
  const findings = [];
  if (Array.isArray(value)) {
    value.forEach((entry, index) => findings.push(...findTemplateLikeValues(entry, `${path}[${index}]`)));
    return findings;
  }
  if (typeof value === "string") {
    if (TEMPLATE_VALUE_RE.test(value)) findings.push(path);
    return findings;
  }
  if (!isPlainObject(value)) return findings;
  for (const [key, entry] of Object.entries(value)) {
    findings.push(...findTemplateLikeValues(entry, `${path}.${key}`));
  }
  return findings;
}

function validateManifest(manifest, issues) {
  if (!isPlainObject(manifest)) {
    issues.push("indexer proof manifest must be an object");
    return null;
  }

  const secretFindings = findSecretLikeValues(manifest);
  if (secretFindings.length > 0) {
    issues.push(`secret-like values must be redacted: ${secretFindings.slice(0, 5).join(", ")}`);
  }
  const templateFindings = findTemplateLikeValues(manifest);
  if (templateFindings.length > 0) {
    issues.push(`template placeholder values must be replaced: ${templateFindings.slice(0, 5).join(", ")}`);
  }

  const dryRun = isPlainObject(manifest.dryRun) ? manifest.dryRun : {};
  if (!isPlainObject(manifest.dryRun)) issues.push("dryRun section is missing");
  if (!statusOk(dryRun.status)) issues.push("dryRun.status must be ok/pass/verified");
  if (!String(dryRun.command ?? "").includes("indexer:once")) issues.push("dryRun.command must record npm run indexer:once");
  if (dryRun.freshDb !== true) issues.push("dryRun.freshDb must be true");
  if (dryRun.fromDeployBlock !== true) issues.push("dryRun.fromDeployBlock must be true");
  if (!hasRealText(dryRun.dbPath)) {
    issues.push("dryRun.dbPath must record the [indexer] SQLite path used by indexer:once");
  } else {
    const dryRunDb = pathStatus(dryRun.dbPath);
    if (!dryRunDb.isAbsolute) issues.push("dryRun.dbPath must be absolute");
    if (dryRunDb.insideRepo) issues.push("dryRun.dbPath must be outside the repo checkout");
    if (sourceRaw && !samePath(dryRunDb.absolute, source.absolute)) {
      issues.push("dryRun.dbPath must match LORE_DB_PATH or --db");
    }
  }
  const manifestStartBlock = integerString(dryRun.startBlock);
  const manifestDeployBlock = integerString(dryRun.deployBlock);
  if (!manifestStartBlock) issues.push("dryRun.startBlock must be a non-negative integer");
  if (!manifestDeployBlock) issues.push("dryRun.deployBlock must be a non-negative integer");
  if (manifestStartBlock && manifestDeployBlock && manifestStartBlock !== manifestDeployBlock) {
    issues.push("dryRun.startBlock must match dryRun.deployBlock");
  }
  if (startBlock && manifestStartBlock && manifestStartBlock !== startBlock) {
    issues.push("dryRun.startBlock must match INDEXER_START_BLOCK");
  }
  if (publicDeployBlock && manifestDeployBlock && manifestDeployBlock !== publicDeployBlock) {
    issues.push("dryRun.deployBlock must match NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK");
  }
  if (manifestDeployBlock && !hasIndexerBlockMarker(dryRun, "Deploy block", manifestDeployBlock)) {
    issues.push("dryRun evidence must include [indexer] Deploy block matching dryRun.deployBlock");
  }
  if (manifestStartBlock && !hasIndexerBlockMarker(dryRun, "Start block", manifestStartBlock)) {
    issues.push("dryRun evidence must include [indexer] Start block matching dryRun.startBlock");
  }
  if (!hasIsoTimestamp(dryRun.timestamp)) issues.push("dryRun.timestamp must be ISO-8601 UTC");
  if (!hasEvidence(dryRun)) issues.push("dryRun has no evidence");
  if (hasEvidence(dryRun) && !hasConcreteEvidence(dryRun)) issues.push("dryRun must include concrete indexer:once evidence path, command output, or indexer log summary");

  const finality = isPlainObject(manifest.finality) ? manifest.finality : {};
  if (!isPlainObject(manifest.finality)) issues.push("finality section is missing");
  if (finality.finalityBlocksPositive !== true) issues.push("finality.finalityBlocksPositive must be true");
  const manifestFinalityBlocks = integerString(finality.finalityBlocks);
  if (!isPositiveInteger(manifestFinalityBlocks)) issues.push("finality.finalityBlocks must be a positive integer");
  if (finalityBlocks && manifestFinalityBlocks && manifestFinalityBlocks !== finalityBlocks) {
    issues.push("finality.finalityBlocks must match INDEXER_FINALITY_BLOCKS");
  }
  if (finality.dataSyncHealthFinalityAware !== true) issues.push("finality.dataSyncHealthFinalityAware must be true");
  if (!hasNumericFinalityLagEvidence(finality)) issues.push("finality.evidence must include numeric finalityLagBlocks from health:prod");
  if (!hasIsoTimestamp(finality.checkedAt)) issues.push("finality.checkedAt must be ISO-8601 UTC");
  if (!hasEvidence(finality)) issues.push("finality has no evidence");
  if (hasEvidence(finality) && !hasConcreteEvidence(finality)) issues.push("finality must include concrete health:prod/finality evidence path, command output, or finalityLagBlocks summary");

  const chainSnapshot = isPlainObject(manifest.chainSnapshot) ? manifest.chainSnapshot : {};
  if (!isPlainObject(manifest.chainSnapshot)) issues.push("chainSnapshot section is missing");
  if (!hasRealText(chainSnapshot.path)) issues.push("chainSnapshot.path is missing");
  const expectedSnapshotChainId = integerString(chainSnapshot.expectedChainId);
  const rpcSnapshotChainId = integerString(chainSnapshot.rpcChainId);
  if (!isPositiveInteger(expectedSnapshotChainId)) issues.push("chainSnapshot.expectedChainId must be a positive integer");
  if (!isPositiveInteger(rpcSnapshotChainId)) issues.push("chainSnapshot.rpcChainId must be a positive integer");
  if (expectedSnapshotChainId && expectedSnapshotChainId !== "59144") {
    issues.push("chainSnapshot.expectedChainId must be 59144 for Linea mainnet launch proof");
  }
  if (rpcSnapshotChainId && rpcSnapshotChainId !== "59144") {
    issues.push("chainSnapshot.rpcChainId must be 59144 for Linea mainnet launch proof");
  }
  if (expectedSnapshotChainId && rpcSnapshotChainId && expectedSnapshotChainId !== rpcSnapshotChainId) {
    issues.push("chainSnapshot.expectedChainId must match chainSnapshot.rpcChainId");
  }
  if (chainSnapshot.rpcChainIdMatches !== true) issues.push("chainSnapshot.rpcChainIdMatches must be true");
  const envChainId = env("LINEA_CHAIN_ID") || env("NEXT_PUBLIC_LINEA_CHAIN_ID");
  const networkChainId = knownNetworkChainIds.get(normalizeNetwork(env("LINEA_NETWORK") || env("NEXT_PUBLIC_LINEA_NETWORK")));
  const configuredChainId = envChainId || networkChainId || "";
  if (configuredChainId && expectedSnapshotChainId && expectedSnapshotChainId !== configuredChainId) {
    issues.push("chainSnapshot.expectedChainId must match configured Linea chain id");
  }
  if (!isRealAddress(chainSnapshot.contractAddress)) issues.push("chainSnapshot.contractAddress is missing, zero, or invalid");
  if (!hasConfiguredRpcSource(chainSnapshot.rpcSource)) {
    issues.push("chainSnapshot.rpcSource must record a configured RPC source");
  }
  const configuredContractAddress = env("KEEPER_CONTRACT_ADDRESS") || env("NEXT_PUBLIC_CONTRACT_ADDRESS");
  if (
    configuredContractAddress &&
    isRealAddress(chainSnapshot.contractAddress) &&
    normalizeAddress(chainSnapshot.contractAddress) !== normalizeAddress(configuredContractAddress)
  ) {
    issues.push("chainSnapshot.contractAddress must match configured contract address");
  }
  if (chainSnapshot.contractAddressMatches !== true) {
    issues.push("chainSnapshot.contractAddressMatches must be true");
  }
  if (!hasIsoTimestamp(chainSnapshot.checkedAt)) issues.push("chainSnapshot.checkedAt must be ISO-8601 UTC");
  if (!hasEvidence(chainSnapshot)) issues.push("chainSnapshot has no evidence");
  if (hasEvidence(chainSnapshot) && !hasConcreteEvidence(chainSnapshot)) issues.push("chainSnapshot must include concrete direct-chain snapshot path, link, artifact, or RPC/contract summary");

  const chainComparison = isPlainObject(manifest.chainComparison) ? manifest.chainComparison : {};
  if (!isPlainObject(manifest.chainComparison)) issues.push("chainComparison section is missing");
  for (const key of REQUIRED_CHAIN_COMPARISONS) {
    const comparison = chainComparison[key];
    if (!isPlainObject(comparison)) {
      issues.push(`chainComparison.${key} is missing`);
      continue;
    }
    if (comparison.matches !== true) issues.push(`chainComparison.${key}.matches must be true`);
    if (!nonEmptyEpochList(comparison.checkedEpochs)) {
      issues.push(`chainComparison.${key}.checkedEpochs must include at least one checked epoch`);
    }
    if (!hasIsoTimestamp(comparison.checkedAt)) {
      issues.push(`chainComparison.${key}.checkedAt must be ISO-8601 UTC`);
    }
    if (!hasEvidence(comparison)) issues.push(`chainComparison.${key} has no evidence`);
    if (hasEvidence(comparison) && !hasConcreteEvidence(comparison)) {
      issues.push(`chainComparison.${key} must include concrete direct-chain comparison path, link, artifact, or summary`);
    }
  }

  return { dryRun, finality, chainSnapshot, chainComparison };
}

function readCount(db, table) {
  try {
    const row = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get();
    return Number(row?.count ?? 0);
  } catch {
    return null;
  }
}

function getMetaRows(db) {
  try {
    return db.prepare(`
      SELECT key, value
      FROM meta
      WHERE key = ?
        OR key LIKE ?
        OR key LIKE ?
        OR key LIKE ?
      ORDER BY key
    `).all(
      "__storage_active_contract_scope",
      "%lastIndexedBlock",
      "%currentEpoch",
      "%repairCursorBlock",
    );
  } catch {
    return [];
  }
}

function findMetaValue(rows, suffix) {
  const row = [...rows].reverse().find((entry) => String(entry.key ?? "").endsWith(suffix));
  return typeof row?.value === "string" ? row.value : "";
}

function fmtMtime(filePath) {
  if (!existsSync(filePath)) return "missing";
  return statSync(filePath).mtime.toISOString();
}

async function inspectDb(dbPath) {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(dbPath);
  try {
    const integrityRows = db.prepare("PRAGMA integrity_check").all();
    const integrity = integrityRows.map((row) => String(row.integrity_check ?? Object.values(row)[0] ?? "")).join(", ");
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all()
      .map((row) => String(row.name));
    const counts = Object.fromEntries(REQUIRED_TABLES.map((table) => [table, readCount(db, table)]));
    const metaRows = getMetaRows(db);
    return { integrity, tables, counts, metaRows };
  } finally {
    db.close();
  }
}

const sourceRaw = argOrEnv("db", "LORE_DB_PATH");
const source = pathStatus(sourceRaw);
const startBlock = env("INDEXER_START_BLOCK");
const publicDeployBlock = env("NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK");
const finalityBlocks = env("INDEXER_FINALITY_BLOCKS");
const minScopedEpochs = Number(env("INDEXER_DRY_RUN_MIN_SCOPED_EPOCHS") || args.get("min-scoped-epochs") || "0");
const minScopedBets = Number(env("INDEXER_DRY_RUN_MIN_SCOPED_BETS") || args.get("min-scoped-bets") || "0");
const manifestPath = args.get("manifest")?.trim() || env("INDEXER_PROOF_PATH") || "docs/indexer-proof.json";
const issues = [];
let manifestSummary = null;

console.log("# Indexer Dry-Run Proof");
console.log("");
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log(`Strict: ${strict ? "yes" : "no"}`);
console.log(`Manifest: ${resolve(repoRoot, manifestPath)}`);
console.log("");

if (!sourceRaw) issues.push("LORE_DB_PATH or --db is missing");
if (sourceRaw && !existsSync(source.absolute)) issues.push("dry-run DB does not exist");
if (strict && sourceRaw && (!source.isAbsolute || source.insideRepo)) {
  issues.push("dry-run DB path must be absolute and outside repo for launch proof");
}
if (strict && (!isNonNegativeInteger(startBlock) || !isNonNegativeInteger(publicDeployBlock))) {
  issues.push("INDEXER_START_BLOCK and NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK must be non-negative integers");
}
if (strict && startBlock && publicDeployBlock && startBlock !== publicDeployBlock) {
  issues.push("INDEXER_START_BLOCK and NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK must match");
}
if (strict && !isPositiveInteger(finalityBlocks)) {
  issues.push("INDEXER_FINALITY_BLOCKS must be positive for launch proof");
}
if (strict && /\.draft\.json$/i.test(resolve(repoRoot, manifestPath))) {
  issues.push("draft proof manifests are not accepted as launch proof");
}
if (strict && !existsSync(resolve(repoRoot, manifestPath))) {
  issues.push("indexer proof manifest is missing");
}
if (existsSync(resolve(repoRoot, manifestPath))) {
  try {
    const manifest = JSON.parse(readFileSync(resolve(repoRoot, manifestPath), "utf8"));
    manifestSummary = validateManifest(manifest, issues);
  } catch (error) {
    issues.push(`indexer proof manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

printTable(["Field", "Value"], [
  ["db", sourceRaw ? source.absolute : "missing"],
  ["db mtime", sourceRaw ? fmtMtime(source.absolute) : "missing"],
  ["INDEXER_START_BLOCK", startBlock || "missing"],
  ["NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK", publicDeployBlock || "missing"],
  ["INDEXER_FINALITY_BLOCKS", finalityBlocks || "missing"],
  ["min scoped epochs", String(minScopedEpochs)],
  ["min scoped bets", String(minScopedBets)],
  ["manifest", resolve(repoRoot, manifestPath)],
]);

if (manifestSummary) {
  console.log("");
  console.log("## Indexer Manifest");
  printTable(["Section", "Status"], [
    ["dryRun", statusOk(manifestSummary.dryRun.status) ? "checked" : "issue"],
    ["finality", manifestSummary.finality.finalityBlocksPositive === true ? "checked" : "issue"],
    ["chainSnapshot", manifestSummary.chainSnapshot.rpcChainIdMatches === true ? "checked" : "issue"],
    [
      "chainComparison",
      REQUIRED_CHAIN_COMPARISONS.every((key) => manifestSummary.chainComparison[key]?.matches === true) ? "checked" : "issue",
    ],
  ]);
}

if (issues.length === 0) {
  const inspected = await inspectDb(source.absolute);
  if (inspected.integrity !== "ok") issues.push(`integrity_check returned ${inspected.integrity}`);
  for (const table of REQUIRED_TABLES) {
    if (!inspected.tables.includes(table)) issues.push(`missing required table ${table}`);
  }

  const lastIndexedBlock = findMetaValue(inspected.metaRows, "lastIndexedBlock");
  const currentEpoch = findMetaValue(inspected.metaRows, "currentEpoch");
  const repairCursorBlock = findMetaValue(inspected.metaRows, "repairCursorBlock");
  if (strict && !isNonNegativeInteger(lastIndexedBlock)) issues.push("lastIndexedBlock meta is missing or invalid");
  if (strict && !isPositiveInteger(currentEpoch)) issues.push("currentEpoch meta is missing or invalid");
  if (strict && startBlock && isNonNegativeInteger(lastIndexedBlock) && BigInt(lastIndexedBlock) < BigInt(startBlock)) {
    issues.push("lastIndexedBlock is lower than INDEXER_START_BLOCK");
  }
  if (strict && inspected.counts.scoped_epochs != null && inspected.counts.scoped_epochs < minScopedEpochs) {
    issues.push(`scoped_epochs count ${inspected.counts.scoped_epochs} < ${minScopedEpochs}`);
  }
  if (strict && inspected.counts.scoped_bets != null && inspected.counts.scoped_bets < minScopedBets) {
    issues.push(`scoped_bets count ${inspected.counts.scoped_bets} < ${minScopedBets}`);
  }

  console.log("");
  console.log("## DB Integrity");
  printTable(["Field", "Value"], [
    ["integrity_check", inspected.integrity],
    ["tables", inspected.tables.join(", ") || "none"],
    ["lastIndexedBlock", lastIndexedBlock || "missing"],
    ["currentEpoch", currentEpoch || "missing"],
    ["repairCursorBlock", repairCursorBlock || "missing"],
  ]);

  console.log("");
  console.log("## Row Counts");
  printTable(
    ["Table", "Rows"],
    Object.entries(inspected.counts).map(([table, count]) => [table, count == null ? "missing" : String(count)]),
  );

  console.log("");
  console.log("## Relevant Meta");
  printTable(
    ["Key", "Value"],
    inspected.metaRows.map((row) => [String(row.key ?? ""), String(row.value ?? "")]),
  );
}

console.log("");
console.log(`Summary: ${issues.length === 0 ? "indexer dry-run proof completed without detected issues" : `${issues.length} issue(s): ${issues.join("; ")}`}.`);
console.log("Copy this summary into `docs/mainnet-proof-record.md` only after confirming `npm run indexer:once` used a fresh DB, intended RPC/deploy block, finality lag, and direct chain comparison evidence.");

if (strict && issues.length > 0) {
  process.exitCode = 1;
}
