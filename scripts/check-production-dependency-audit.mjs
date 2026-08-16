import { spawnSync } from "node:child_process";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { redactProofText } from "./redact-proof-output.mjs";
import {
  resolveTrustedNpmCli,
  trustedNpmCommand,
  trustedNpmEnvironment,
} from "./trusted-npm-cli.mjs";

const MAX_AUDIT_ERROR_CHARS = 500;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const CANONICAL_AUDIT_COUNTERS = ["info", "low", "moderate", "high", "critical", "total"];
const CANONICAL_AUDIT_SEVERITIES = new Set(CANONICAL_AUDIT_COUNTERS.filter((name) => name !== "total"));
const SEVERITY_RANK = new Map([["critical", 4], ["high", 3], ["moderate", 2], ["low", 1], ["info", 0]]);
const KNOWN_DEV_TOOLCHAIN_HIGH_NAMES = new Set([
  "@eslint/config-array",
  "@eslint/eslintrc",
  "brace-expansion",
  "eslint",
  "eslint-config-next",
  "eslint-plugin-import",
  "eslint-plugin-jsx-a11y",
  "eslint-plugin-react",
  "minimatch",
]);

export function describeDependencyAuditError(error) {
  const text = redactProofText(error instanceof Error ? error.message : String(error))
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= MAX_AUDIT_ERROR_CHARS) return text;
  return `${text.slice(0, MAX_AUDIT_ERROR_CHARS - 15)}...<truncated>`;
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function nonNegativeSafeInteger(value) {
  if (typeof value !== "number") return null;
  if (!Number.isSafeInteger(value) || value < 0) return null;
  return BigInt(value) <= MAX_SAFE_INTEGER_BIGINT ? value : null;
}

function formatFix(value) {
  if (value === true) return "available";
  if (!value) return "none";
  const target = value.name && value.version ? `${value.name}@${value.version}` : "available";
  return value.isSemVerMajor ? `${target} (breaking)` : target;
}

function printTable(log, headers, rows) {
  log(`| ${headers.join(" | ")} |`);
  log(`| ${headers.map(() => "---").join(" | ")} |`);
  for (const row of rows) log(`| ${row.join(" | ")} |`);
}

export function analyzeDependencyAuditReport(audit, { allowKnownDevToolchainHigh = false } = {}) {
  if (!isPlainObject(audit)) return { status: "malformed", detail: "top-level-object" };
  if (Object.hasOwn(audit, "error")) return { status: "malformed", detail: "top-level-error" };
  if (audit.auditReportVersion !== 2) return { status: "malformed", detail: "audit-report-version" };
  if (!isPlainObject(audit.metadata)) return { status: "malformed", detail: "metadata-object" };
  if (!isPlainObject(audit.metadata.vulnerabilities)) {
    return { status: "malformed", detail: "metadata-vulnerabilities-object" };
  }
  if (!isPlainObject(audit.vulnerabilities)) {
    return { status: "malformed", detail: "vulnerabilities-object" };
  }

  const counts = audit.metadata.vulnerabilities;
  const vulnerabilityEntries = Object.entries(audit.vulnerabilities);
  const vulnerabilities = vulnerabilityEntries.map(([, item]) => item).filter(isPlainObject);
  const countIssues = new Set();
  const countCache = new Map();
  for (const name of Object.keys(counts)) {
    if (!CANONICAL_AUDIT_COUNTERS.includes(name)) countIssues.add(`metadata-${name}-unexpected`);
  }

  const countOf = (name) => {
    if (countCache.has(name)) return countCache.get(name);
    if (!Object.hasOwn(counts, name)) {
      countIssues.add(`metadata-${name}-missing`);
      countCache.set(name, 0);
      return 0;
    }
    const parsed = nonNegativeSafeInteger(counts[name]);
    if (parsed !== null) {
      countCache.set(name, parsed);
      return parsed;
    }
    countIssues.add(`metadata-${name}`);
    countCache.set(name, 0);
    return 0;
  };

  for (const name of CANONICAL_AUDIT_COUNTERS) countOf(name);
  const severityTotal = CANONICAL_AUDIT_COUNTERS
    .filter((name) => name !== "total")
    .reduce((total, name) => total + countOf(name), 0);
  if (countOf("total") !== severityTotal) countIssues.add("metadata-total-mismatch");

  const observedSeverityCounts = new Map(
    [...CANONICAL_AUDIT_SEVERITIES].map((severity) => [severity, 0]),
  );
  for (const [name, item] of vulnerabilityEntries) {
    if (
      !isPlainObject(item)
      || item.name !== name
      || typeof item.severity !== "string"
      || !CANONICAL_AUDIT_SEVERITIES.has(item.severity)
    ) {
      countIssues.add(`vulnerability-${name}`);
      continue;
    }
    observedSeverityCounts.set(item.severity, observedSeverityCounts.get(item.severity) + 1);
  }
  for (const severity of CANONICAL_AUDIT_SEVERITIES) {
    if (countOf(severity) !== observedSeverityCounts.get(severity)) {
      countIssues.add(`metadata-${severity}-mismatch`);
    }
  }
  if (countOf("total") !== vulnerabilityEntries.length) {
    countIssues.add("metadata-vulnerability-total-mismatch");
  }

  const isKnownDevToolchainHigh = (item) => (
    isPlainObject(item)
    && allowKnownDevToolchainHigh
    && item.severity === "high"
    && KNOWN_DEV_TOOLCHAIN_HIGH_NAMES.has(item.name)
  );
  const allowedKnownDevToolchainHigh = vulnerabilities
    .filter(isKnownDevToolchainHigh)
    .map((item) => item.name)
    .sort();
  const blockingHighCritical = vulnerabilities.filter(
    (item) => ["critical", "high"].includes(item.severity) && !isKnownDevToolchainHigh(item),
  );
  const breakingFixes = vulnerabilities.filter(
    (item) => isPlainObject(item.fixAvailable) && item.fixAvailable.isSemVerMajor === true,
  );

  return {
    status: "analyzed",
    vulnerabilities,
    countIssues: [...countIssues].sort(),
    countOf,
    allowedKnownDevToolchainHigh,
    blockingHighCritical,
    breakingFixes,
  };
}

function dependencyAuditSummary(analysis, includeDev) {
  const summaryCounts = {
    total: analysis.countOf("total"),
    critical: analysis.countOf("critical"),
    high: analysis.countOf("high"),
    moderate: analysis.countOf("moderate"),
    low: analysis.countOf("low"),
  };
  const failed = analysis.blockingHighCritical.length > 0 || analysis.countIssues.length > 0;
  return {
    status: failed ? "fail" : "pass",
    scope: includeDev ? "all" : "production",
    ...summaryCounts,
    blockingHighCritical: analysis.blockingHighCritical.length,
    knownDevToolchainHigh: analysis.allowedKnownDevToolchainHigh.length,
    breakingFixes: analysis.breakingFixes.length,
    countIssues: analysis.countIssues.length,
    ...(analysis.countIssues.length > 0 ? { issue: "audit-counts" } : {}),
  };
}

export async function runDependencyAuditCli({
  argv = process.argv.slice(2),
  env = process.env,
  spawnSyncFn = spawnSync,
  resolveTrustedNpmCliFn = resolveTrustedNpmCli,
  trustedNpmCommandFn = trustedNpmCommand,
  trustedNpmEnvironmentFn = trustedNpmEnvironment,
  log = console.log,
  errorLog = console.error,
  now = () => new Date(),
} = {}) {
  const includeDev = argv.includes("--include-dev");
  const summaryOnly = argv.includes("--summary-only");
  const allowKnownDevToolchainHigh = includeDev && argv.includes("--allow-known-dev-toolchain-high");
  const auditArgs = ["audit", ...(includeDev ? [] : ["--omit=dev"]), "--json"];
  const scope = includeDev ? "all" : "production";
  let result;
  try {
    const trustedNpmLauncher = resolveTrustedNpmCliFn();
    const auditCommand = trustedNpmCommandFn(auditArgs, trustedNpmLauncher);
    const auditEnv = trustedNpmEnvironmentFn(env, trustedNpmLauncher);
    result = spawnSyncFn(auditCommand.command, auditCommand.args, {
      cwd: trustedNpmLauncher.repoRoot,
      env: auditEnv,
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 8,
    });
  } catch (error) {
    result = { error, stdout: "", stderr: "" };
  }

  if (result.error) {
    const detail = describeDependencyAuditError(result.error);
    if (summaryOnly) log(JSON.stringify({ status: "fail", scope, issue: "audit-startup", detail }));
    else {
      errorLog(`# ${includeDev ? "All Dependency" : "Production Dependency"} Audit`);
      errorLog("");
      errorLog(`Summary: npm audit could not be started: ${detail}`);
    }
    return { exitCode: 1, issue: "audit-startup" };
  }

  const raw = result.stdout?.trim() || result.stderr?.trim() || "";
  let audit;
  try {
    audit = JSON.parse(raw);
  } catch {
    const sample = raw ? describeDependencyAuditError(raw) : "";
    if (summaryOnly) log(JSON.stringify({ status: "fail", scope, issue: "audit-json", sample }));
    else {
      errorLog(`# ${includeDev ? "All Dependency" : "Production Dependency"} Audit`);
      errorLog("");
      errorLog("Summary: npm audit did not return parseable JSON output.");
      if (raw) errorLog(`Output sample: ${sample}`);
    }
    return { exitCode: 1, issue: "audit-json" };
  }

  const analysis = analyzeDependencyAuditReport(audit, { allowKnownDevToolchainHigh });
  if (analysis.status === "malformed") {
    if (summaryOnly) {
      log(JSON.stringify({ status: "fail", scope, issue: "audit-report", detail: analysis.detail }));
    } else {
      errorLog(`# ${includeDev ? "All Dependency" : "Production Dependency"} Audit`);
      errorLog("");
      errorLog(`Summary: npm audit returned an incomplete or malformed report (${analysis.detail}).`);
    }
    return { exitCode: 1, issue: "audit-report", analysis };
  }

  const summary = dependencyAuditSummary(analysis, includeDev);
  if (summaryOnly) {
    log(JSON.stringify(summary));
    return { exitCode: summary.status === "pass" ? 0 : 1, summary, analysis };
  }

  log(`# ${includeDev ? "All Dependency" : "Production Dependency"} Audit`);
  log("");
  log(`Timestamp: ${now().toISOString()}`);
  log(`Scope: ${includeDev ? "npm audit" : "npm audit --omit=dev"}`);
  log("");
  printTable(log, ["Severity", "Count"], [
    ["critical", String(analysis.countOf("critical"))],
    ["high", String(analysis.countOf("high"))],
    ["moderate", String(analysis.countOf("moderate"))],
    ["low", String(analysis.countOf("low"))],
    ["total", String(analysis.countOf("total"))],
  ]);
  const top = analysis.vulnerabilities
    .slice()
    .sort((a, b) => (SEVERITY_RANK.get(b.severity) ?? -1) - (SEVERITY_RANK.get(a.severity) ?? -1)
      || String(a.name).localeCompare(String(b.name)))
    .slice(0, 12)
    .map((item) => [item.name, item.severity, String(item.via?.length ?? 0), formatFix(item.fixAvailable)]);
  log("");
  printTable(log, ["Package", "Severity", "Via", "Fix"], top.length > 0 ? top : [["none", "none", "0", "none"]]);
  if (analysis.allowedKnownDevToolchainHigh.length > 0) {
    log("");
    log(`Allowed known dev-toolchain high advisories: ${analysis.allowedKnownDevToolchainHigh.join(", ")}`);
    log("These are non-production ESLint/minimatch advisories; production audit must pass separately.");
  }
  if (analysis.breakingFixes.length > 0) {
    log("");
    log(`Breaking fixes suggested: ${analysis.breakingFixes.map((item) => item.name).sort().join(", ")}`);
  }
  log("");
  if (analysis.blockingHighCritical.length > 0) {
    log(`Summary: ${scope} dependency audit failed: ${analysis.blockingHighCritical.length} blocking high/critical advisories, ${analysis.countOf("total")} total advisories.`);
  } else if (analysis.countIssues.length > 0) {
    log(`Summary: ${scope} dependency audit failed: ${analysis.countIssues.length} malformed audit metadata count(s).`);
  } else if (analysis.allowedKnownDevToolchainHigh.length > 0) {
    log(`Summary: all dependency audit passed with ${analysis.allowedKnownDevToolchainHigh.length} known dev-toolchain high advisory exception(s), 0 blocking high/critical advisories, ${analysis.countOf("total")} total advisories.`);
  } else {
    log(`Summary: ${scope} dependency audit passed with no high or critical advisories.`);
  }
  return { exitCode: summary.status === "pass" ? 0 : 1, summary, analysis };
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  const result = await runDependencyAuditCli();
  process.exitCode = result.exitCode;
}
