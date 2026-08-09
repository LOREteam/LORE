import { spawnSync } from "node:child_process";
import { redactProofText } from "./redact-proof-output.mjs";

const checks = [
  { label: "V9 compile", script: "proof:contract-compile:summary", requiredLocal: true },
  { label: "V10 compile", script: "proof:contract-compile:v10:summary", requiredLocal: true },
  { label: "V10 compiler advisories", script: "proof:contract-compiler-advisories:v10:summary", requiredLocal: true },
  { label: "V10 compiler matrix", script: "bench:contract:v10:compiler-matrix:summary", requiredLocal: true },
  { label: "V10 no-RPC diagnostics", script: "bench:contract:v10:diagnostics:summary", requiredLocal: true },
  { label: "V10 offline identity", script: "proof:contract-deployed:v10:offline:summary", requiredLocal: true },
  { label: "V10 deployed identity", script: "proof:contract-deployed:v10:summary" },
  { label: "V9 compatibility invariants", script: "test:contract:summary", requiredLocal: true },
  { label: "V10 invariants", script: "test:contract:v10:summary", requiredLocal: true },
  { label: "ABI/indexer storage", script: "test:indexer-storage:summary", requiredLocal: true },
  { label: "fetch timeout", script: "test:fetch-timeout:summary", requiredLocal: true },
  { label: "stored number parsing", script: "test:stored-number-parsing:summary", requiredLocal: true },
  { label: "TypeScript typecheck", script: "typecheck:summary", requiredLocal: true },
  { label: "ESLint", script: "lint:summary", requiredLocal: true },
  { label: "production build", script: "build:summary", requiredLocal: true },
  { label: "bundle baseline", script: "baseline:bundle:summary", requiredLocal: true },
  { label: "SQLite operations", script: "test:db-operations:summary", requiredLocal: true },
  { label: "runtime monitoring drill", script: "test:monitoring:summary", requiredLocal: true },
  { label: "process model preflight", script: "proof:process-model:summary", requiredLocal: true },
  { label: "business logic and removed-wallet guard", script: "test:logic:summary", requiredLocal: true },
  { label: "security follow-up", script: "proof:security-followup:summary", requiredLocal: true },
  { label: "production dependencies", script: "proof:deps:summary", requiredLocal: true },
  { label: "full dependency/toolchain audit", script: "proof:deps:all:summary", requiredLocal: true },
  { label: "wallet dependencies", script: "proof:wallet-deps:summary", requiredLocal: true },
  { label: "workspace cleanup dry-run", script: "cleanup:workspace:dry-run:summary", requiredLocal: true },
  { label: "workspace cleanup loop", script: "cleanup:workspace:loop:status", requiredLocal: true },
  { label: "launch docs", script: "proof:launch-docs:summary", requiredLocal: true },
  { label: "proof templates", script: "proof:templates:summary", requiredLocal: true },
  { label: "proof drafts", script: "proof:drafts:summary", requiredLocal: true },
  { label: "proof files", script: "proof:files:summary", requiredLocal: true },
  { label: "proof collector redaction", script: "proof:collector-redaction:summary", requiredLocal: true },
  { label: "launch command map", script: "proof:launch-map:summary", requiredLocal: true },
  { label: "host proof load-target guard", script: "proof:host-guard:summary", requiredLocal: true },
  { label: "launch gates structure", script: "proof:gates:structure", requiredLocal: true },
  { label: "readiness checklist", script: "proof:readiness:summary", requiredLocal: true },
  { label: "remaining gates", script: "proof:remaining:summary" },
  { label: "testnet soak", script: "soak:testnet:status:summary" },
  { label: "pending nonce dry-run", script: "soak:testnet:clear-pending:summary" },
  { label: "V10 dry-run preview", script: "preview:canary:v10:dry-run:summary" },
  { label: "V10 authorization-ready preview", script: "preview:canary:v10:authorization-ready:summary" },
  { label: "mainnet env", script: "proof:mainnet:summary" },
  { label: "mainnet env strict", script: "proof:mainnet:strict:summary" },
  { label: "chain", script: "proof:chain:summary" },
  { label: "chain strict", script: "proof:chain:strict:summary" },
  { label: "signoff", script: "proof:signoff:summary" },
  { label: "signoff strict", script: "proof:signoff:strict:summary" },
  { label: "host", script: "proof:host:summary" },
  { label: "host strict", script: "proof:host:strict:summary" },
  { label: "indexer", script: "proof:indexer:summary" },
  { label: "indexer strict", script: "proof:indexer:strict:summary" },
  { label: "restore", script: "proof:restore:summary" },
  { label: "restore strict", script: "proof:restore:strict:summary" },
  { label: "runtime monitor config", script: "monitor:runtime:summary" },
  { label: "monitoring", script: "proof:monitoring:summary" },
  { label: "monitoring strict", script: "proof:monitoring:strict:summary" },
  { label: "QA", script: "proof:qa:summary" },
  { label: "QA strict", script: "proof:qa:strict:summary" },
  { label: "testnet canary", script: "proof:testnet:canary:summary" },
  { label: "testnet canary strict", script: "proof:testnet:canary:strict:summary" },
  { label: "testnet V10 canary matrix", script: "proof:testnet:canary:v10:summary" },
  { label: "backup", script: "db:backup:summary" },
  { label: "backup strict", script: "db:backup:strict:summary" },
  { label: "launch strict", script: "proof:launch:strict:summary" },
];

const npmCommand = process.env.npm_execpath ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
const DECIMAL_INTEGER_RE = /^(?:0|[1-9]\d{0,15})$/;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const checkTimeoutMs = parsePositiveIntegerEnv("PRELAUNCH_CHECK_TIMEOUT_MS", 300_000, 1_000, 1_800_000);
const quietNpmEnv = {
  ...process.env,
  NO_UPDATE_NOTIFIER: "1",
  npm_config_update_notifier: "false",
  npm_config_fund: "false",
};

function parsePositiveIntegerEnv(name, fallback, min, max) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  if (!DECIMAL_INTEGER_RE.test(raw)) {
    throw new Error(`${name} must be a canonical decimal integer`);
  }
  const parsed = BigInt(raw);
  if (parsed > MAX_SAFE_INTEGER_BIGINT) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  const numeric = Number(parsed);
  if (numeric < min || numeric > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return numeric;
}

function formatSafeTokenList(value, empty = "none") {
  if (!Array.isArray(value) || value.length === 0) return empty;
  const safe = value
    .map((entry) => String(entry ?? "").trim())
    .filter((entry) => /^[a-z0-9-]{1,64}$/.test(entry))
    .slice(0, 8);
  if (safe.length === 0) return empty;
  return safe.join(",");
}

function formatSafeCategoryList(value, empty = "none") {
  if (!Array.isArray(value) || value.length === 0) return empty;
  const safe = value
    .map((entry) => String(entry ?? "").trim())
    .filter((entry) => /^[a-z_]{1,64}$/.test(entry))
    .slice(0, 8);
  if (safe.length === 0) return empty;
  return safe.join(",");
}

function formatSafeCountMap(value, empty = "none") {
  if (!value || typeof value !== "object" || Array.isArray(value)) return empty;
  const safe = Object.entries(value)
    .filter(([key, count]) => /^[a-z0-9-]{1,64}$/.test(String(key)) && Number.isSafeInteger(count) && count >= 0)
    .slice(0, 8)
    .map(([key, count]) => `${key}:${count}`);
  return safe.length > 0 ? safe.join(",") : empty;
}

function formatStatus(value, fallback = "unknown") {
  return formatSafeTokenList([value], fallback);
}

function formatInfoToken(value, fallback = "unknown", max = 96) {
  const text = String(value ?? "").trim();
  if (text.length === 0 || text.length > max || /0x[a-fA-F0-9]{8,}/.test(text)) return fallback;
  return /^[a-zA-Z0-9._+-]+$/.test(text) ? text : fallback;
}

function formatBundleFilePath(value) {
  const text = String(value ?? "").trim();
  if (text.length === 0 || text.length > 160 || text.includes("..") || text.includes("//") || text.includes("\\")) {
    return "unknown";
  }
  return /^static\/[a-zA-Z0-9._/-]+$/.test(text) ? text : "unknown";
}

function formatPackageVersion(value) {
  const text = String(value ?? "").trim();
  return /^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9._-]+)?$/.test(text) ? text : "missing";
}

function runScript(script) {
  const args = process.env.npm_execpath
    ? [process.env.npm_execpath, "--silent", "run", script]
    : ["--silent", "run", script];
  const startedAt = Date.now();
  const result = spawnSync(npmCommand, args, {
    cwd: process.cwd(),
    env: quietNpmEnv,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
    timeout: checkTimeoutMs,
  });
  return { ...result, elapsedMs: Date.now() - startedAt };
}

function stripAnsi(value) {
  return String(value ?? "").replace(/\u001b\[[0-9;]*m/g, "");
}

function clamp(value, max = 220) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

function formatRoleCounts(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "none";
  const entries = Object.entries(value)
    .filter(([role, count]) => /^[A-Z0-9_]{1,32}$/.test(role) && Number.isSafeInteger(count) && count > 0)
    .sort(([left], [right]) => left.localeCompare(right));
  return entries.length > 0 ? entries.map(([role, count]) => `${role}:${count}`).join(",") : "none";
}

function formatPreflightFailures(value) {
  if (!Array.isArray(value)) return "none";
  const entries = value
    .filter((item) =>
      item &&
      typeof item === "object" &&
      /^[A-Z0-9_]{1,32}$/.test(item.role) &&
      /^[a-z0-9-]{1,48}$/.test(item.reason)
    )
    .map((item) => `${item.role}:${item.reason}`)
    .sort();
  if (entries.length === 0) return "none";
  const shown = entries.slice(0, 5).join(",");
  return entries.length > 5 ? `${shown},+${entries.length - 5}` : shown;
}

function formatSafeCounts(value, maxEntries = 4) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "none";
  const entries = Object.entries(value)
    .filter(([key, count]) => /^[a-zA-Z0-9_-]{1,48}$/.test(key) && Number.isSafeInteger(count) && count > 0)
    .sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return "none";
  const shown = entries.slice(0, maxEntries).map(([key, count]) => `${key}:${count}`).join(",");
  return entries.length > maxEntries ? `${shown},+${entries.length - maxEntries}` : shown;
}

function safeInteger(value) {
  return Number.isSafeInteger(value) ? value : null;
}

function nonNegativeSafeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function nonNegativeSafeIntegerText(value) {
  const text = String(value ?? "").trim();
  if (!DECIMAL_INTEGER_RE.test(text)) return null;
  const parsed = BigInt(text);
  return parsed <= MAX_SAFE_INTEGER_BIGINT ? Number(parsed) : null;
}

function integerMetric(value) {
  const parsed = safeInteger(value);
  return parsed === null ? "n/a" : String(parsed);
}

function nonNegativeIntegerMetric(value) {
  const parsed = nonNegativeSafeInteger(value);
  return parsed === null ? "n/a" : String(parsed);
}

function nonNegativeIntegerField(value) {
  return nonNegativeSafeInteger(value) ?? 0;
}

function formatMetric(value) {
  return integerMetric(value);
}

function formatDiskCapacity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "n/a";
  if (value.diskCapacityAvailable !== true) return "unavailable";
  return [
    `now:${nonNegativeIntegerMetric(value.diskFreeBytesNow)}`,
    `min:${nonNegativeIntegerMetric(value.diskFreeMinimumBytes)}`,
    `below:${value.diskFreeBelowMinimum === true}`,
  ].join(",");
}

function formatDurationMs(value) {
  const parsed = nonNegativeSafeInteger(value);
  return parsed === null ? "n/a" : `${parsed}ms`;
}

function blockerGroupForScript(script) {
  if (script.includes("contract")) return "contract";
  if (script.includes("mainnet")) return "env";
  if (script.includes("chain")) return "chain";
  if (script.includes("signoff")) return "signoff";
  if (script.includes("host")) return "host";
  if (script.includes("indexer")) return "indexer";
  if (script.includes("restore")) return "restore";
  if (script.includes("monitoring") || script.startsWith("monitor:")) return "monitoring";
  if (script.includes("qa")) return "qa";
  if (script.includes("canary")) return "canary";
  if (script.includes("backup")) return "backup";
  if (script.includes("launch")) return "launch";
  if (script.includes("remaining")) return "remaining";
  return "other";
}

function formatBlockerGroups(scripts) {
  const counts = new Map();
  for (const script of scripts) {
    const group = blockerGroupForScript(script);
    counts.set(group, (counts.get(group) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([group, count]) => `${group}=${count}`)
    .join(", ");
}

function formatGroupSummary(value) {
  if (typeof value !== "string" || value.length === 0) return "";
  const groups = value
    .split(/\s*,\s*/)
    .map((entry) => entry.trim())
    .filter((entry) => /^[a-z0-9-]{1,32}=[1-9]\d{0,3}$/.test(entry))
    .slice(0, 16);
  return groups.length > 0 ? `, groups=${groups.join(",")}` : "";
}

function knownIssueToken(value) {
  if (typeof value !== "string" || value.length === 0) return "";
  const text = redactProofText(value).toLowerCase();
  if (
    text.includes("lore_db_path") &&
    text.includes("lore_backup_dir") &&
    text.includes("--source") &&
    text.includes("--out")
  ) {
    return "backup-paths-or-source-output-required";
  }
  if (
    text.includes("strict chain proof requires configured rpc env") &&
    text.includes("built-in fallback")
  ) {
    return "strict-chain-proof-requires-configured-rpc-env";
  }
  return "";
}

function formatIssueToken(value) {
  const known = knownIssueToken(value);
  if (known) return `, issue=${known}`;
  if (typeof value !== "string" || value.length === 0) return "";
  const token = redactProofText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  return token ? `, issue=${token}` : "";
}

function formatGateList(value) {
  if (typeof value !== "string" || value.length === 0) return "";
  const gates = value
    .split(/\s*,\s*/)
    .map((entry) => entry.trim().replace(/\.$/, ""))
    .filter((entry) => /^G\d{1,2}$/.test(entry))
    .slice(0, 8);
  return gates.length > 0 ? gates.join(",") : "";
}

function formatLineToken(value, max = 96) {
  if (typeof value !== "string" || value.length === 0) return "";
  const token = redactProofText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return token;
}

function formatSummaryLine(line) {
  if (typeof line !== "string" || !line.startsWith("Summary:")) return "";
  const text = line.replace(/^Summary:\s*/, "").trim();
  const issueMatch = text.match(/^(\d+)\s+(?:proof\s+)?issue\(s\):\s*([^;.]*)/i);
  if (issueMatch) {
    const issues = nonNegativeSafeIntegerText(issueMatch[1]);
    const gates = formatGateList(text.match(/blocked gates:\s*([^;.]+)/i)?.[1] ?? "");
    const groups = formatGroupSummary(text.match(/groups:\s*([^;.]+)/i)?.[1] ?? "").replace(/^, /, "");
    const issue = formatIssueToken(issueMatch[2]).replace(/^, /, "");
    return [
      issues !== null ? `issues=${issues}` : "",
      gates ? `gates=${gates}` : "",
      groups,
      issue,
    ].filter(Boolean).join(" ");
  }
  const envGateMatch = text.match(/^(\d+)\s+env gate\(s\)\s+missing or failing/i);
  if (envGateMatch) {
    const failing = nonNegativeSafeIntegerText(envGateMatch[1]);
    return failing !== null ? `failing=${failing}` : "";
  }
  const readyGates = formatGateList(text.match(/covered gates:\s*([^;.]+)/i)?.[1] ?? "");
  const readyGroups = formatGroupSummary(text.match(/groups:\s*([^;.]+)/i)?.[1] ?? "").replace(/^, /, "");
  if (/without detected issues|status inputs are ready|is consistent|guard passed|are clean|are rejected/.test(text)) {
    return [
      "status=ready",
      readyGates ? `gates=${readyGates}` : "",
      readyGroups,
      `summary=${formatLineToken(text)}`,
    ].filter(Boolean).join(" ");
  }
  const summaryToken = formatLineToken(text);
  return summaryToken ? `summary=${summaryToken}` : "";
}

function formatGrowthDeltas(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "n/a";
  const parts = [
    ["r", value.rssBytes?.delta],
    ["d", value.dbBytes?.delta],
    ["w", value.walBytes?.delta],
    ["f", value.diskFreeBytes?.delta],
  ].map(([label, delta]) => `${label}:${formatMetric(delta)}`);
  return parts.join(",");
}

function summarizeJson(text) {
  const objects = extractJsonObjects(text);
  if (objects.length === 0) return "";
  const parsedObjects = objects.flatMap((item) => {
    try {
      return [JSON.parse(item)];
    } catch {
      return [];
    }
  });
  if (parsedObjects.length === 0) return "";
  try {
    const parsed = parsedObjects.find((item) => item && typeof item === "object" && item.status === "ready" && "transactionSent" in item)
      ?? parsedObjects.find((item) => item && typeof item === "object" && item.status === "passed" && "functionSelectors" in item)
      ?? parsedObjects.find((item) => item && typeof item === "object" && item.status === "pass" && "knownBugCount" in item)
      ?? parsedObjects.find((item) => item && typeof item === "object" && item.status === "pass" && "target" in item && ("runtimeBytecodeBytes" in item || "bytecodeBytes" in item))
      ?? parsedObjects.find((item) => item && typeof item === "object" && item.status === "pass" && "idempotentEventUpsert" in item)
      ?? parsedObjects[0];
    if (parsed && typeof parsed === "object" && "status" in parsed && "progress" in parsed) {
      const progress = parsed.progress ?? {};
      return `st=${formatStatus(parsed.status)} dry=${parsed.dryRun === true} ok=${nonNegativeIntegerField(progress.successfulBets)}/${nonNegativeIntegerField(progress.epochBoundBets)}/${nonNegativeIntegerField(progress.epochUnboundBets)} fail=${nonNegativeIntegerField(progress.failedBets)} roles=${formatRoleCounts(progress.successfulBetRoles)}/${formatRoleCounts(progress.failedBetRoles)} pre=${formatPreflightFailures(progress.preflightFailures)} rev=${nonNegativeIntegerField(progress.revertedTransactions)} h=${nonNegativeIntegerField(progress.healthFailures)}/${nonNegativeIntegerField(progress.healthRetries)} rpc=${nonNegativeIntegerField(progress.rpcFailoverInjectionEvents)} gas=${nonNegativeIntegerField(progress.estimateGasRetries)} slow=${nonNegativeIntegerField(progress.slowSendCount)} p95=${nonNegativeIntegerMetric(progress.latencyMs?.p95)} free=${nonNegativeIntegerMetric(progress.healthGrowth?.diskFreeBytes?.min)} disk=${formatDiskCapacity(parsed.diskCapacity)} gr=${formatGrowthDeltas(progress.healthGrowth)} fk=${formatSafeCounts(progress.failedBetErrorKinds)} ff=${formatSafeCounts(progress.failedBetFamilies)} fm=${formatSafeCounts(progress.failedBetModes)} fs=${formatSafeCounts(progress.failedBetStages)} streak=${formatRoleCounts(progress.maxConsecutiveFailedBetsByRole)}`;
    }
    if (parsed && typeof parsed === "object" && "pendingNonceGap" in parsed) {
      const boundary = parsed.operationalBoundary && typeof parsed.operationalBoundary === "object"
        ? parsed.operationalBoundary
        : {};
      return `role=${formatInfoToken(parsed.role)}, mode=${formatInfoToken(parsed.mode)}, pendingGap=${nonNegativeIntegerField(parsed.pendingNonceGap)}, replacementCap=${nonNegativeIntegerField(parsed.replacementCap)}, wouldSend=${parsed.wouldSendReplacement === true}, dryRunDefault=${boundary.dryRunDefault === true}, signing=${boundary.signingMaterialLoaded === true}, walletClient=${boundary.walletClientCreated === true}, contractWrite=${boundary.contractWriteSubmitted === true}, txSent=${boundary.transactionSent === true}`;
    }
    if (parsed && typeof parsed === "object" && "authorizationFreshnessRequired" in parsed && "issue" in parsed) {
      return `status=${formatStatus(parsed.status)}, authFresh=${parsed.authorizationFreshnessRequired === true}, ageMinutes=${nonNegativeIntegerField(parsed.ageMinutes)}, maxAgeMinutes=${nonNegativeIntegerField(parsed.maxPreviewAgeMinutes)}, issue=${formatInfoToken(parsed.issue)}`;
    }
    if (parsed && typeof parsed === "object" && "dryRunProofBlocksG10G11" in parsed && "plannedBetTx" in parsed) {
      return `status=${formatStatus(parsed.status)}, authFresh=${parsed.authorizationFreshnessRequired === true}, ageMinutes=${nonNegativeIntegerField(parsed.ageMinutes)}, maxAgeMinutes=${nonNegativeIntegerField(parsed.maxPreviewAgeMinutes)}, transactionLimit=${nonNegativeIntegerField(parsed.transactionLimit)}, estimatedGas=${nonNegativeIntegerField(parsed.estimatedGas)}, plannedBetTx=${nonNegativeIntegerField(parsed.plannedBetTx)}, log=${parsed.canaryLog ? "present" : "missing"}, logLines=${nonNegativeIntegerField(parsed.logLines)}, txSent=${parsed.transactionSent === true}, signing=${parsed.signingMaterialLoaded === true}, walletClient=${parsed.walletClientCreated === true}, contractWrite=${parsed.contractWriteSubmitted === true}, dryRunBlocksG10G11=${parsed.dryRunProofBlocksG10G11 === true}`;
    }
    if (parsed && typeof parsed === "object" && parsed.status === "ready" && "transactionSent" in parsed) {
      return `status=ready, compiler=${formatInfoToken(parsed.compilerVersion)}, runtimeBytes=${nonNegativeIntegerMetric(parsed.runtimeBytes)}, executableBytes=${nonNegativeIntegerMetric(parsed.executableRuntimeBytes)}, transactionSent=${parsed.transactionSent === true}`;
    }
    if (parsed && typeof parsed === "object" && parsed.status === "passed" && "transactionSent" in parsed && "rpcUsed" in parsed) {
      return `status=passed, rpcUsed=${parsed.rpcUsed === true}, transactionSent=${parsed.transactionSent === true}, envLoaded=${parsed.environmentFilesLoaded === true}, probes=${Array.isArray(parsed.probes) ? parsed.probes.length : 0}`;
    }
    if (parsed && typeof parsed === "object" && parsed.status === "passed" && "functionSelectors" in parsed) {
      return `status=passed, selectors=${nonNegativeIntegerField(parsed.functionSelectors)}, stateChanging=${nonNegativeIntegerField(parsed.stateChangingEntrypoints)}, events=${nonNegativeIntegerField(parsed.frontendEvents)}/${nonNegativeIntegerField(parsed.indexedEvents)}/${nonNegativeIntegerField(parsed.frontendOnlyEvents)}, frontendOnlyReviewed=${parsed.reviewedFrontendOnlyEvents === true}, exits=${nonNegativeIntegerField(parsed.checkedFinancialExits)}, v9Abi=${nonNegativeIntegerField(parsed.preservedV9AbiItems)}`;
    }
    if (parsed && typeof parsed === "object" && "invariantSuite" in parsed && "fullRangeAccountingCases" in parsed) {
      return `status=${formatStatus(parsed.status)}, suite=${formatSafeTokenList([parsed.invariantSuite])}, runtimeBytes=${nonNegativeIntegerField(parsed.runtimeBytes)}, selectors=${nonNegativeIntegerField(parsed.functionSelectors)}, guarded=${nonNegativeIntegerField(parsed.guardedLocalMutationEntrypoints)}, accountingCases=${nonNegativeIntegerField(parsed.fullRangeAccountingCases)}, proportionalCases=${nonNegativeIntegerField(parsed.fullRangeProportionalCases)}, assertionFailures=${nonNegativeIntegerField(parsed.assertionFailures)}, protocolFeeFlushCases=${nonNegativeIntegerField(parsed.protocolFeeFlushModelCases)}, protocolFeeFlushEntrypointCases=${nonNegativeIntegerField(parsed.protocolFeeFlushEntrypointCases)}, duplicateBatchCases=${nonNegativeIntegerField(parsed.duplicateBatchModelCases)}, timelockBoundaryCases=${nonNegativeIntegerField(parsed.timelockBoundaryCases)}, dustBoundaryCases=${nonNegativeIntegerField(parsed.dustBoundaryCases)}, packedBoundaryCases=${nonNegativeIntegerField(parsed.packedBoundaryCases)}`;
    }
    if (parsed && typeof parsed === "object" && "invariantSuite" in parsed && "assertionFailures" in parsed && "passed" in parsed) {
      return `status=${formatStatus(parsed.status)}, suite=${formatSafeTokenList([parsed.invariantSuite])}, passed=${parsed.passed === true}, assertionFailures=${nonNegativeIntegerField(parsed.assertionFailures)}`;
    }
    if (parsed && typeof parsed === "object" && parsed.status === "passed" && "profilesChecked" in parsed) {
      const canonicalV10 = parsed.canonical?.LineaOreV10 ?? {};
      return `status=passed, profiles=${nonNegativeIntegerField(parsed.profilesPassing)}/${nonNegativeIntegerField(parsed.profilesChecked)}, evm=${formatInfoToken(parsed.evmVersion)}, v10RuntimeBytes=${nonNegativeIntegerMetric(canonicalV10.runtimeBytes)}, headroom=${integerMetric(canonicalV10.runtimeHeadroomBytes)}`;
    }
    if (parsed && typeof parsed === "object" && parsed.status === "pass" && "knownBugCount" in parsed) {
      return `status=pass, compiler=${formatInfoToken(parsed.compilerVersion)}, knownBugs=${nonNegativeIntegerField(parsed.knownBugCount)}, source=${formatInfoToken(parsed.source)}`;
    }
    if (parsed && typeof parsed === "object" && parsed.status === "pass" && "target" in parsed && ("runtimeBytecodeBytes" in parsed || "bytecodeBytes" in parsed)) {
      const creationBytes = nonNegativeIntegerMetric(parsed.bytecodeBytes);
      const runtimeBytes = nonNegativeIntegerMetric(parsed.runtimeBytecodeBytes);
      return `status=pass, target=${formatStatus(parsed.target)}, compiler=${formatInfoToken(parsed.compilerVersion)}, creationBytes=${creationBytes}, runtimeBytes=${runtimeBytes}, manifestMatches=${parsed.manifestMatches === true}, wouldWrite=${parsed.wouldWrite === true ? "true" : "false"}`;
    }
    if (parsed && typeof parsed === "object" && "v10OfflineIdentity" in parsed && "runtimeBytes" in parsed) {
      return `status=${formatStatus(parsed.status)}, compiler=${formatInfoToken(parsed.compilerVersion)}, profile=${formatSafeTokenList([parsed.compilerProfile])}, runtimeBytes=${nonNegativeIntegerField(parsed.runtimeBytes)}, executableRuntimeBytes=${nonNegativeIntegerField(parsed.executableRuntimeBytes)}, manifestMatches=${parsed.manifestMatches === true}, transactionSent=${parsed.transactionSent === true}, assertionFailures=${nonNegativeIntegerField(parsed.assertionFailures)}`;
    }
    if (parsed && typeof parsed === "object" && "v10DeployedReadOnly" in parsed && "runtimeBytes" in parsed) {
      return `status=${formatStatus(parsed.status)}, network=${formatSafeTokenList([parsed.network])}, chainId=${nonNegativeIntegerField(parsed.chainId)}, manifestMatches=${parsed.manifestMatches === true}, runtimeBytes=${nonNegativeIntegerField(parsed.runtimeBytes)}, expectedRuntimeBytes=${nonNegativeIntegerField(parsed.expectedRuntimeBytes)}, runtimeBytecode=${parsed.runtimeBytecode === true}, runtimeExecutable=${parsed.runtimeExecutable === true}, metadataOnlyMismatch=${parsed.metadataOnlyMismatch === true}, transactionSent=${parsed.transactionSent === true}, assertionFailures=${nonNegativeIntegerField(parsed.assertionFailures)}`;
      }
      if (parsed && typeof parsed === "object" && parsed.status === "pass" && "idempotentEventUpsert" in parsed) {
        return `status=pass, categories=${nonNegativeIntegerField(parsed.categories)}, financialEventCategories=${formatSafeCategoryList(parsed.financialEventCategories)}, depositScopeIsolation=${parsed.depositScopeIsolation === true}, idempotentDepositUpsert=${parsed.idempotentDepositUpsert === true}, resolverRewardScopeIsolation=${parsed.resolverRewardScopeIsolation === true}, idempotentResolverRewardUpsert=${parsed.idempotentResolverRewardUpsert === true}, dustSettlementScopeIsolation=${parsed.dustSettlementScopeIsolation === true}, idempotentDustSettlementUpsert=${parsed.idempotentDustSettlementUpsert === true}, singleRebateClaimParity=${parsed.singleRebateClaimParity === true}, epochScopeIsolation=${parsed.epochScopeIsolation === true}, idempotentEpochUpsert=${parsed.idempotentEpochUpsert === true}, jackpotScopeIsolation=${parsed.jackpotScopeIsolation === true}, idempotentJackpotUpsert=${parsed.idempotentJackpotUpsert === true}, rewardClaimScopeIsolation=${parsed.rewardClaimScopeIsolation === true}, idempotentRewardClaimUpsert=${parsed.idempotentRewardClaimUpsert === true}, batchClaimKindParity=${parsed.batchClaimKindParity === true}, dustSettlementKindParity=${parsed.dustSettlementKindParity === true}, sameBlockEventOrdering=${parsed.sameBlockEventOrdering === true}, staleEventReplayIgnored=${parsed.staleEventReplayIgnored === true}, staleEpochReplayIgnored=${parsed.staleEpochReplayIgnored === true}, staleFinancialReplayIgnored=${parsed.staleFinancialReplayIgnored === true}, normalizedEventIdRequiresTxLog=${parsed.normalizedEventIdRequiresTxLog === true}, partialRpcLogFallback=${parsed.partialRpcLogFallback === true}, malformedPayloadFallback=${parsed.malformedPayloadFallback === true}, boundedEventStorage=${parsed.boundedEventStorage === true}, limitedEventReads=${parsed.limitedEventReads === true}, legacyRead=${parsed.legacyRead === true}, pagination=${parsed.candidatePagination === true}, tileUserCounts=${parsed.tileUserCounts === true}, chainScopeIsolation=${parsed.chainScopeIsolation === true}, scopeIsolation=${parsed.contractScopeIsolation === true}, categoryIdIsolation=${parsed.categoryIdIsolation === true}, normalizedEventScopeIsolation=${parsed.normalizedEventScopeIsolation === true}, protocolFeeScopeIsolation=${parsed.protocolFeeScopeIsolation === true}, idempotentUpsert=${parsed.idempotentEventUpsert === true}, idempotentBetUpsert=${parsed.idempotentBetUpsert === true}, idempotentProtocolFeeUpsert=${parsed.idempotentProtocolFeeUpsert === true}`;
      }
      if (parsed && typeof parsed === "object" && "idempotentUpsert" in parsed && "malformedPayloadFallback" in parsed) {
        return `status=${formatStatus(parsed.status)}, categories=${nonNegativeIntegerField(parsed.categories)}, financialEventCategories=${formatSafeCategoryList(parsed.financialEventCategories)}, depositScopeIsolation=${parsed.depositScopeIsolation === true}, idempotentDepositUpsert=${parsed.idempotentDepositUpsert === true}, resolverRewardScopeIsolation=${parsed.resolverRewardScopeIsolation === true}, idempotentResolverRewardUpsert=${parsed.idempotentResolverRewardUpsert === true}, dustSettlementScopeIsolation=${parsed.dustSettlementScopeIsolation === true}, idempotentDustSettlementUpsert=${parsed.idempotentDustSettlementUpsert === true}, singleRebateClaimParity=${parsed.singleRebateClaimParity === true}, epochScopeIsolation=${parsed.epochScopeIsolation === true}, idempotentEpochUpsert=${parsed.idempotentEpochUpsert === true}, jackpotScopeIsolation=${parsed.jackpotScopeIsolation === true}, idempotentJackpotUpsert=${parsed.idempotentJackpotUpsert === true}, rewardClaimScopeIsolation=${parsed.rewardClaimScopeIsolation === true}, idempotentRewardClaimUpsert=${parsed.idempotentRewardClaimUpsert === true}, batchClaimKindParity=${parsed.batchClaimKindParity === true}, dustSettlementKindParity=${parsed.dustSettlementKindParity === true}, sameBlockEventOrdering=${parsed.sameBlockEventOrdering === true}, staleEventReplayIgnored=${parsed.staleEventReplayIgnored === true}, staleEpochReplayIgnored=${parsed.staleEpochReplayIgnored === true}, staleFinancialReplayIgnored=${parsed.staleFinancialReplayIgnored === true}, normalizedEventIdRequiresTxLog=${parsed.normalizedEventIdRequiresTxLog === true}, partialRpcLogFallback=${parsed.partialRpcLogFallback === true}, malformedPayloadFallback=${parsed.malformedPayloadFallback === true}, boundedEventStorage=${parsed.boundedEventStorage === true}, limitedEventReads=${parsed.limitedEventReads === true}, legacyRead=${parsed.legacyRead === true}, pagination=${parsed.pagination === true}, tileUserCounts=${parsed.tileUserCounts === true}, chainScopeIsolation=${parsed.chainScopeIsolation === true}, scopeIsolation=${parsed.scopeIsolation === true}, normalizedEventScopeIsolation=${parsed.normalizedEventScopeIsolation === true}, protocolFeeScopeIsolation=${parsed.protocolFeeScopeIsolation === true}, idempotentUpsert=${parsed.idempotentUpsert === true}, idempotentBetUpsert=${parsed.idempotentBetUpsert === true}, idempotentProtocolFeeUpsert=${parsed.idempotentProtocolFeeUpsert === true}, assertionFailures=${nonNegativeIntegerField(parsed.assertionFailures)}`;
      }
    if (parsed && typeof parsed === "object" && "sqliteOperations" in parsed && "backupIntegrity" in parsed) {
      return `status=${formatStatus(parsed.status)}, backupIntegrity=${parsed.backupIntegrity === true}, retentionRemoved=${nonNegativeIntegerField(parsed.retentionExpiredRemoved)}, scopeReadOnly=${parsed.scopeReadOnly === true}, foreignRows=${nonNegativeIntegerField(parsed.foreignRows)}, futureSourceBackupRejected=${parsed.futureSourceBackupSummaryRejected === true}, restoreUsesSuppliedBackup=${parsed.restoreUsesSuppliedBackupArtifact === true}, corruptBackupRestoreRejected=${parsed.corruptBackupRestoreRejected === true}, diskFullRejected=${parsed.diskFullRejected === true}, corruptStartupRejected=${parsed.corruptStartupRejected === true}, assertionFailures=${nonNegativeIntegerField(parsed.assertionFailures)}`;
    }
    if (parsed && typeof parsed === "object" && "runtimeMonitoring" in parsed && "duplicateAlertsAfterRestart" in parsed) {
      return `status=${formatStatus(parsed.status)}, alerts=${nonNegativeIntegerField(parsed.alerts)}, recoveries=${nonNegativeIntegerField(parsed.recoveries)}, duplicateAfterRestart=${nonNegativeIntegerField(parsed.duplicateAlertsAfterRestart)}, deliveries=${nonNegativeIntegerField(parsed.deliveries)}, repoLocalBackupRejected=${parsed.repoLocalBackupDirRejected === true}, localPathBaseUrlRejected=${parsed.localPathBaseUrlRejected === true}, malformedDiagnosticsSecretRejected=${parsed.malformedDiagnosticsSecretRejected === true}, malformedNumericEnvRejected=${parsed.malformedNumericEnvRejected === true}, stateCleared=${parsed.stateCleared === true}, assertionFailures=${nonNegativeIntegerField(parsed.assertionFailures)}`;
    }
    if (parsed && typeof parsed === "object" && "fetchTimeout" in parsed && "assertionFailures" in parsed) {
      return `status=${formatStatus(parsed.status)}, fetchTimeout=${parsed.fetchTimeout === true}, passed=${parsed.passed === true}, assertionFailures=${nonNegativeIntegerField(parsed.assertionFailures)}`;
    }
    if (parsed && typeof parsed === "object" && "storedNumberParsing" in parsed && "assertionFailures" in parsed) {
      return `status=${formatStatus(parsed.status)}, storedNumberParsing=${parsed.storedNumberParsing === true}, passed=${parsed.passed === true}, assertionFailures=${nonNegativeIntegerField(parsed.assertionFailures)}`;
    }
    if (parsed && typeof parsed === "object" && parsed.status === "pass" && "faults" in parsed) {
      return `status=pass, integrity=${parsed.backup?.integrity === true}, retentionRemoved=${nonNegativeIntegerField(parsed.retention?.expiredRemoved)}, readOnly=${parsed.scopeAudit?.readOnly === true}, futureSourceBackupRejected=${parsed.faults?.futureSourceBackupSummaryRejected === true}, restoreUsesSuppliedBackup=${parsed.faults?.restoreUsesSuppliedBackupArtifact === true}, corruptBackupRestoreRejected=${parsed.faults?.corruptBackupRestoreRejected === true}, diskFullRejected=${parsed.faults?.diskFullRejected === true}`;
    }
    if (parsed && typeof parsed === "object" && parsed.status === "pass" && "totalBytes" in parsed && "fileCount" in parsed) {
      return `status=pass, files=${nonNegativeIntegerField(parsed.fileCount)}, totalBytes=${nonNegativeIntegerField(parsed.totalBytes)}, jsBytes=${nonNegativeIntegerField(parsed.jsBytes)}, largestJsBytes=${nonNegativeIntegerField(parsed.largestJsBytes)}, largestJsFile=${formatBundleFilePath(parsed.largestJsFile?.path)}, maxSingleJsBytes=${nonNegativeIntegerField(parsed.budget?.maxSingleJsBytes)}, cssBytes=${nonNegativeIntegerField(parsed.cssBytes)}, wasmBytes=${nonNegativeIntegerField(parsed.wasmBytes)}`;
    }
    if (parsed && typeof parsed === "object" && parsed.status === "pass" && "duplicateAlertsAfterRestart" in parsed) {
      return `status=pass, alerts=${nonNegativeIntegerField(parsed.alerts)}, recoveries=${nonNegativeIntegerField(parsed.recoveries)}, duplicateAfterRestart=${nonNegativeIntegerField(parsed.duplicateAlertsAfterRestart)}, stateCleared=${parsed.stateCleared === true}`;
    }
    if (parsed && typeof parsed === "object" && "businessLogic" in parsed && "assertionFailures" in parsed) {
      return `status=${formatStatus(parsed.status)}, businessLogic=${parsed.businessLogic === true}, localProof=${parsed.localProof === true}, apiBoundaryProof=${parsed.apiBoundaryProof === true}, walletTxStateMachineProof=${parsed.walletTxStateMachineProof === true}, walletClaimStateMachineProof=${parsed.walletClaimStateMachineProof === true}, authBoundaryProof=${parsed.authBoundaryProof === true}, replicaRateLimitBoundaryProof=${parsed.replicaRateLimitBoundaryProof === true}, browserBaselineCompactPerformance=${parsed.browserBaselineCompactPerformance === true}, jsonNoStoreRoutes=${parsed.jsonNoStoreRoutes === true}, sessionVaryCookie=${parsed.sessionVaryCookie === true}, boundedJsonRoutes=${parsed.boundedJsonRoutes === true}, rateLimitNoStore=${parsed.rateLimitNoStore === true}, routeErrorRedaction=${parsed.routeErrorRedaction === true}, depositsRecoveryGlobalBound=${parsed.depositsRecoveryGlobalBound === true}, miningPendingRecoveryScoped=${parsed.miningPendingRecoveryScoped === true}, miningReceiptRevertExplicit=${parsed.miningReceiptRevertExplicit === true}, walletHashlessNonceRecovery=${parsed.walletHashlessNonceRecovery === true}, manualMinePendingAmbiguousSafe=${parsed.manualMinePendingAmbiguousSafe === true}, approvalDuplicateSendSafe=${parsed.approvalDuplicateSendSafe === true}, autoMinerNonceRecoverySafe=${parsed.autoMinerNonceRecoverySafe === true}, autoMinerRpcReconnectSafe=${parsed.autoMinerRpcReconnectSafe === true}, rewardClaimStateSafe=${parsed.rewardClaimStateSafe === true}, safetyPoolClaimStateSafe=${parsed.safetyPoolClaimStateSafe === true}, resolverClaimStateSafe=${parsed.resolverClaimStateSafe === true}, authTrustedOriginFailClosed=${parsed.authTrustedOriginFailClosed === true}, authReplayNonceBoundary=${parsed.authReplayNonceBoundary === true}, authCanonicalNonceBoundary=${parsed.authCanonicalNonceBoundary === true}, authSessionCookieBoundary=${parsed.authSessionCookieBoundary === true}, sharedRateLimitRetryAfterBound=${parsed.sharedRateLimitRetryAfterBound === true}, externalRateLimitPublicEndpoint=${parsed.externalRateLimitPublicEndpoint === true}, externalRateLimitResponseBound=${parsed.externalRateLimitResponseBound === true}, externalSharedLockCanonical=${parsed.externalSharedLockCanonical === true}, replicaRateLimitStrictConfig=${parsed.replicaRateLimitStrictConfig === true}, warnings=${nonNegativeIntegerField(parsed.expectedWarnings)}, assertionFailures=${nonNegativeIntegerField(parsed.assertionFailures)}`;
    }
    if (parsed && typeof parsed === "object" && "checks" in parsed && "failedIds" in parsed) {
      const appResolveEpochFiles = "appResolveEpochFiles" in parsed
        ? `, appResolveEpochFiles=${nonNegativeIntegerField(parsed.appResolveEpochFiles)}`
        : "";
      const securityFollowupFields = "hostAuth" in parsed
        ? `, hostAuth=${parsed.hostAuth === true}, webLocks=${parsed.webLocks === true}, keeperNonce=${parsed.keeperNonce === true}, keeperBotReceipts=${parsed.keeperBotReceipts === true}, depositLimiter=${parsed.depositLimiter === true}, dryRunDefaults=${parsed.dryRunDefaults === true}, ciSecurity=${parsed.ciSecurity === true}, autoResolve=${parsed.autoResolve === true}`
        : "";
      return `status=${formatStatus(parsed.status)}, checks=${nonNegativeIntegerField(parsed.checks)}, passed=${nonNegativeIntegerField(parsed.passed)}, failed=${nonNegativeIntegerField(parsed.failed)}, failedIds=${formatSafeTokenList(parsed.failedIds)}${securityFollowupFields}${appResolveEpochFiles}`;
    }
    if (parsed && typeof parsed === "object" && parsed.mode === "runtime-monitor-config") {
      return `status=${formatStatus(parsed.status)}, strict=${parsed.strictProductionLike === true}, resend=${parsed.resendConfigured === true}, backup=${parsed.backupConfigured === true}, backupAge=${parsed.backupMaxAgeConfigured === true}, canary=${parsed.canaryLogConfigured === true}, audit=${parsed.chainAuditConfigured === true}, missing=${formatSafeTokenList(parsed.missingConfig)}, wouldPoll=${parsed.wouldPoll === true}, wouldSendAlerts=${parsed.wouldSendAlerts === true}`;
    }
    if (parsed && typeof parsed === "object" && "scope" in parsed && "blockingHighCritical" in parsed) {
      return `status=${formatStatus(parsed.status)}, scope=${formatSafeTokenList([parsed.scope])}, total=${nonNegativeIntegerField(parsed.total)}, high=${nonNegativeIntegerField(parsed.high)}, critical=${nonNegativeIntegerField(parsed.critical)}, blocking=${nonNegativeIntegerField(parsed.blockingHighCritical)}, knownDev=${nonNegativeIntegerField(parsed.knownDevToolchainHigh)}, breaking=${nonNegativeIntegerField(parsed.breakingFixes)}`;
    }
    if (parsed && typeof parsed === "object" && "privyWagmi" in parsed && "wagmi" in parsed && "viem" in parsed) {
      return `status=${formatStatus(parsed.status)}, privy=${formatPackageVersion(parsed.privy)}, privyWagmi=${formatPackageVersion(parsed.privyWagmi)}, wagmi=${formatPackageVersion(parsed.wagmi)}, viem=${formatPackageVersion(parsed.viem)}, missing=${formatSafeTokenList(parsed.missing)}`;
    }
    if (parsed && typeof parsed === "object" && "tsErrors" in parsed && "tsCodes" in parsed) {
      return `status=${formatStatus(parsed.status)}, nextTypegen=${parsed.nextTypegen === true}, tsc=${parsed.tsc === true}, tsErrors=${nonNegativeIntegerField(parsed.tsErrors)}, tsCodes=${formatSafeTokenList(parsed.tsCodes)}`;
    }
    if (parsed && typeof parsed === "object" && "compiled" in parsed && "proxy" in parsed && "warnings" in parsed) {
      return `status=${formatStatus(parsed.status)}, compiled=${parsed.compiled === true}, proxy=${parsed.proxy === true}, warnings=${nonNegativeIntegerField(parsed.warnings)}, warningKinds=${formatSafeTokenList(parsed.warningKinds)}, warningKindCounts=${formatSafeCountMap(parsed.warningKindCounts)}, classifiedWarnings=${nonNegativeIntegerField(parsed.classifiedWarnings)}, unclassifiedWarnings=${nonNegativeIntegerField(parsed.unclassifiedWarnings)}, notices=${nonNegativeIntegerField(parsed.notices)}, noticeKinds=${formatSafeTokenList(parsed.noticeKinds)}, errors=${nonNegativeIntegerField(parsed.errors)}`;
    }
    if (parsed && typeof parsed === "object" && "checkedDocs" in parsed && "inlineSyntaxIssues" in parsed) {
      return `status=${formatStatus(parsed.status)}, docs=${nonNegativeIntegerField(parsed.checkedDocs)}, syntax=${nonNegativeIntegerField(parsed.inlineSyntaxIssues)}, missingScripts=${nonNegativeIntegerField(parsed.missingPackageScripts)}, readIssues=${nonNegativeIntegerField(parsed.readIssues)}, missingExamples=${nonNegativeIntegerField(parsed.missingPowerShellExamples)}, gate=${formatSafeTokenList([parsed.launchGate])}`;
    }
    if (parsed && typeof parsed === "object" && "fixtures" in parsed && "issues" in parsed && "launchGate" in parsed) {
      return `status=${formatStatus(parsed.status)}, fixtures=${nonNegativeIntegerField(parsed.fixtures)}, issues=${nonNegativeIntegerField(parsed.issues)}, gate=${formatSafeTokenList([parsed.launchGate])}`;
    }
    if (parsed && typeof parsed === "object" && "filesChecked" in parsed && "filesWithIssues" in parsed && "ruleIds" in parsed) {
      return `status=${formatStatus(parsed.status)}, files=${nonNegativeIntegerField(parsed.filesChecked)}, issueFiles=${nonNegativeIntegerField(parsed.filesWithIssues)}, errors=${nonNegativeIntegerField(parsed.errors)}, warnings=${nonNegativeIntegerField(parsed.warnings)}, rules=${formatSafeTokenList(parsed.ruleIds)}`;
    }
    if (parsed && typeof parsed === "object" && "status" in parsed && "pid" in parsed) {
      const issue = formatSafeTokenList([parsed.issue], "");
      const stop = parsed.stopRequested === true ? ", stopRequested=true" : "";
      return `status=${formatStatus(parsed.status)}, pid=${Number.isSafeInteger(parsed.pid) ? "present" : "none"}${issue ? `, issue=${issue}` : ""}${stop}`;
    }
    if (parsed && typeof parsed === "object" && "status" in parsed && typeof parsed.issue === "string") {
      const status = formatSafeTokenList([parsed.status], "unknown");
      const groups = formatGroupSummary(parsed.groups);
      const issue = formatIssueToken(parsed.issue);
      return `status=${status}${groups}${issue}`;
    }
    if (parsed && typeof parsed === "object" && "status" in parsed) {
      return `status=${formatStatus(parsed.status)}`;
    }
  } catch {
    return "invalid JSON summary";
  }
  return "";
}

function extractJsonObjects(text) {
  const source = String(text ?? "");
  const objects = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let start = -1;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        objects.push(source.slice(start, index + 1));
        start = -1;
      }
    }
  }
  return objects;
}

function summarizeMainnetEnvProofLines(lines) {
  const summary = [...lines].reverse().find((line) => line.startsWith("Summary:"));
  const groups = lines.find((line) => line.startsWith("Failing gate groups:"));
  const tokens = lines.find((line) => line.startsWith("Failing gate tokens:"));
  if (!summary || !groups) return "";
  const summaryToken = formatSummaryLine(summary);
  const groupTokens = formatGroupSummary(groups.replace(/^Failing gate groups:\s*/, "")).replace(/^, groups=/, "");
  const tokenSummary = tokens
    ? `tokens=${formatSafeTokenList(tokens.replace(/^Failing gate tokens:\s*/, "").split(/\s*,\s*/))}`
    : "";
  return [summaryToken, groupTokens ? `groups=${groupTokens}` : "groups=none", tokenSummary].filter(Boolean).join("; ");
}

function summarizeRemainingGateLines(lines) {
  const summary = [...lines].reverse().find((line) => line.startsWith("Summary:"));
  const completeGates = lines.find((line) => line.startsWith("Complete gates:"));
  const remainingGroups = lines.find((line) => line.startsWith("Remaining gate groups:"));
  const nextGate = lines.find((line) => line.startsWith("Next gate:"));
  const nextGroup = lines.find((line) => line.startsWith("Next gate group:"));
  const nextProofFiles = lines.find((line) => line.startsWith("Next proof files:"));
  const nextMarkers = lines.find((line) => line.startsWith("Next marker tokens:"));
  const nextStatusCheck = lines.find((line) => line.startsWith("Next status check:"));
  const autonomousNext = lines.find((line) => line.startsWith("Autonomous next:"));
  const transactionBoundary = lines.find((line) => line.startsWith("Transaction boundary:"));
  const previewChecks = lines.find((line) => line.startsWith("Pre-transaction preview checks:"));
  const consentRequirement = lines.find((line) => line.startsWith("Consent requirement:"));
  if (!summary || !nextGate) return "";
  const gateProgress = completeGates?.match(/(\d+)\/(\d+)/);
  const completedGates = gateProgress ? nonNegativeSafeIntegerText(gateProgress[1]) : null;
  const totalGates = gateProgress ? nonNegativeSafeIntegerText(gateProgress[2]) : null;
  const remainingCount = completedGates !== null && totalGates !== null && totalGates >= completedGates
    ? totalGates - completedGates
    : null;
  const gateId = nextGate.match(/^Next gate:\s*(G\d+)\b/)?.[1] ?? "unknown";
  const remainingGroupTokens = remainingGroups
    ? formatGroupSummary(remainingGroups.replace(/^Remaining gate groups:\s*/, "")).replace(/^, groups=/, "")
    : "";
  const groupsSummary = remainingGroupTokens ? `; groups=${remainingGroupTokens}` : "";
  const groupSummary = nextGroup
    ? `; nextGroup=${formatSafeTokenList([nextGroup.replace(/^Next gate group:\s*/, "")])}`
    : "";
  const proofSummary = nextProofFiles
    ? `; nextProof=${formatSafeTokenList(nextProofFiles.replace(/^Next proof files:\s*/, "").split(/\s*,\s*/).map((entry) => entry.replace(/^.*\//, "").replace(/\./g, "-")))}`
    : "";
  const markerSummary = nextMarkers
    ? `; nextTokens=${formatSafeTokenList(nextMarkers.replace(/^Next marker tokens:\s*/, "").split(/\s*,\s*/))}`
    : "";
  const nextStatusToken = nextStatusCheck
    ?.replace(/^Next status check:\s*/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const statusSummary = nextStatusToken ? `; nextStatus=${formatSafeTokenList([nextStatusToken])}` : "";
  const autonomousNextToken = autonomousNext
    ?.replace(/^Autonomous next:\s*/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const autonomousSummary = autonomousNextToken ? `; autonomousNext=${formatSafeTokenList([autonomousNextToken])}` : "";
  const transactionBoundaryToken = transactionBoundary
    ?.replace(/^Transaction boundary:\s*/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const consentSummary = consentRequirement ? "; consent=present" : "";
  const transactionSummary = transactionBoundaryToken ? `; txBoundary=${formatSafeTokenList([transactionBoundaryToken])}` : "";
  const previewCheckTokens = previewChecks
    ? formatSafeTokenList(previewChecks
      .replace(/^Pre-transaction preview checks:\s*/, "")
      .split(/\s*\|\s*/)
      .map((entry) => entry.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")))
    : "";
  const previewSummary = previewCheckTokens && previewCheckTokens !== "none" ? `; previewChecks=${previewCheckTokens}` : "";
  return `status=blocked, remaining=${remainingCount === null || totalGates === null ? "unknown" : `${remainingCount}/${totalGates}`}; next=${gateId}${groupSummary}${proofSummary}${statusSummary}${autonomousSummary}${consentSummary}${transactionSummary}${previewSummary}${markerSummary}${groupsSummary}`;
}

function summarizeCollectorRedactionLines(lines) {
  const statusLine = lines.find((line) => /^status=(?:pass|fail),\s*cases=/.test(line));
  if (!statusLine) return "";
  const match = statusLine.match(/^status=(pass|fail),\s*cases=(\d+),\s*redacted=(\d+),\s*leaked=(\d+),\s*issues=(\d+)$/);
  if (!match) return "status=fail, issue=invalid-collector-redaction-summary";
  const [, status, casesRaw, redactedRaw, leakedRaw, issuesRaw] = match;
  const cases = nonNegativeSafeIntegerText(casesRaw);
  const redacted = nonNegativeSafeIntegerText(redactedRaw);
  const leaked = nonNegativeSafeIntegerText(leakedRaw);
  const issues = nonNegativeSafeIntegerText(issuesRaw);
  if (cases === null || redacted === null || leaked === null || issues === null) {
    return "status=fail, issue=invalid-collector-redaction-counters";
  }
  return `status=${status}, cases=${cases}, redacted=${redacted}, leaked=${leaked}, issues=${issues}`;
}

function summarizeOutput(output) {
  const text = redactProofText(stripAnsi(output));
  const jsonSummary = summarizeJson(text);
  if (jsonSummary) return jsonSummary;
  if (/Types generated successfully/.test(text) && !/\berror TS\d+\b/.test(text)) {
    return "status=pass, nextTypegen=true, tsc=true";
  }
  if (/\bBusiness logic tests passed\.(?:\s|$)/.test(text)) return "status=pass, businessLogic=true, removedWalletGuard=true";
  const walletDependencySummary = summarizeWalletDependencies(text);
  if (walletDependencySummary) return walletDependencySummary;
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const mainnetEnvSummary = summarizeMainnetEnvProofLines(lines);
  if (mainnetEnvSummary) return mainnetEnvSummary;
  const remainingGateSummary = summarizeRemainingGateLines(lines);
  if (remainingGateSummary) return remainingGateSummary;
  const collectorRedactionSummary = summarizeCollectorRedactionLines(lines);
  if (collectorRedactionSummary) return collectorRedactionSummary;
  const proofDraftRows = [...lines].reverse().find((line) => line.startsWith("Rows: total="));
  if (proofDraftRows) return proofDraftRows.replace(/^Rows:\s*/, "status=pass, ");
  const summary = [...lines].reverse().find((line) => line.startsWith("Summary:"));
  if (summary) return formatSummaryLine(summary) || "summary=unknown";
  const nextGate = lines.find((line) => line.startsWith("Next gate:"));
  if (nextGate) return nextGate;
  return lines.at(-1) ?? "no output";
}

function summarizeToolError(error) {
  return clamp(redactProofText(stripAnsi(error instanceof Error ? error.message : String(error))));
}

function summarizeWalletDependencies(text) {
  const required = ["@privy-io/react-auth", "@privy-io/wagmi", "wagmi@", "viem@"];
  if (!required.every((marker) => text.includes(marker))) return "";
  const versionFor = (name) => {
    const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = text.match(new RegExp(`(?:^|[\\s├└─])${escapedName}@(\\d+\\.\\d+\\.\\d+)`, "m"));
    return match?.[1] ?? "present";
  };
  return `status=pass, privy=${versionFor("@privy-io/react-auth")}, privyWagmi=${versionFor("@privy-io/wagmi")}, wagmi=${versionFor("wagmi")}, viem=${versionFor("viem")}`;
}

const rows = [];
const launchBlocking = [];
const externalEvidenceIssues = [];
const requiredLocalFailures = [];
const toolFailures = [];
const timings = [];

console.log("# Prelaunch Status Summary");
console.log("");
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log("");
console.log("| Check | Command | Required Local | Exit | Summary |");
console.log("| --- | --- | --- | --- | --- |");

for (const check of checks) {
  const { label, requiredLocal, script } = check;
  const result = runScript(script);
  const exitCode = typeof result.status === "number" ? result.status : 1;
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  timings.push({ elapsedMs: result.elapsedMs, label });
  let summary = clamp(summarizeOutput(output)).replace(/\|/g, "\\|");
  if (result.error?.code === "ETIMEDOUT") {
    summary = `status=timeout, timeoutMs=${checkTimeoutMs}`;
  }
  if (script === "lint" && exitCode === 0 && summary === "no output") {
    summary = "status=pass, eslint=true";
  }
  if (script === "build" && exitCode === 0 && /Compiled successfully/.test(output) && /Proxy \(Middleware\)/.test(output)) {
    summary = "status=pass, compiled=true, proxy=true";
  }
  const row = [label, script, requiredLocal ? "yes" : "no", String(exitCode), summary];
  rows.push(row);
  console.log(`| ${row.join(" | ")} |`);
  if (exitCode !== 0 && requiredLocal) requiredLocalFailures.push(script);
  if (exitCode !== 0 && !requiredLocal) launchBlocking.push(script);
  if (
    !requiredLocal &&
    /\b(missing|issue\(s\)|proof issue|failing|status=fail|still require|requires external|require external|blocking launch evidence)\b/i.test(summary)
  ) {
    externalEvidenceIssues.push(script);
  }
  if (result.error) toolFailures.push(`${script}: ${summarizeToolError(result.error)}`);
}

const externalBlockers = [...new Set([...externalEvidenceIssues, ...launchBlocking])];
const blockerGroups = formatBlockerGroups(externalBlockers);
const slowestChecks = timings
  .filter((item) => nonNegativeSafeInteger(item.elapsedMs) !== null)
  .sort((a, b) => b.elapsedMs - a.elapsedMs)
  .slice(0, 5)
  .map((item) => `${item.label}=${formatDurationMs(item.elapsedMs)}`)
  .join(", ");

console.log("");
console.log(
  requiredLocalFailures.length > 0
    ? `Summary: ${requiredLocalFailures.length} required local status command(s) failed: ${requiredLocalFailures.join(", ")}.`
    : toolFailures.length > 0
    ? `Summary: ${toolFailures.length} status command(s) could not start: ${toolFailures.join("; ")}.`
    : externalBlockers.length > 0
      ? `Summary: required local checks passed; ${externalBlockers.length} external/status command(s) still report missing or blocking launch evidence: ${externalBlockers.join(", ")}.`
      : "Summary: all compact status commands completed without blocking status.",
);
if (blockerGroups) console.log(`Blocker groups: ${blockerGroups}.`);
if (slowestChecks) console.log(`Slowest checks: ${slowestChecks}.`);

if (requiredLocalFailures.length > 0 || toolFailures.length > 0) {
  process.exitCode = 1;
}
