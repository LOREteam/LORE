import { spawnSync } from "node:child_process";
import { redactProofText } from "./redact-proof-output.mjs";

const includeDev = process.argv.includes("--include-dev");
const summaryOnly = process.argv.includes("--summary-only");
const MAX_AUDIT_ERROR_CHARS = 500;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

function describeAuditError(error) {
  const text = redactProofText(error instanceof Error ? error.message : String(error))
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= MAX_AUDIT_ERROR_CHARS) return text;
  return `${text.slice(0, MAX_AUDIT_ERROR_CHARS - 15)}...<truncated>`;
}

const allowKnownDevToolchainHigh = includeDev && process.argv.includes("--allow-known-dev-toolchain-high");
const auditArgs = ["audit", ...(includeDev ? [] : ["--omit=dev"]), "--json"];
const auditCommand = process.platform === "win32"
  ? { command: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", `npm.cmd ${auditArgs.join(" ")}`] }
  : { command: "npm", args: auditArgs };
const result = spawnSync(auditCommand.command, auditCommand.args, {
  cwd: process.cwd(),
  encoding: "utf8",
  maxBuffer: 1024 * 1024 * 8,
});

if (result.error) {
  if (summaryOnly) {
    console.log(JSON.stringify({
      status: "fail",
      scope: includeDev ? "all" : "production",
      issue: "audit-startup",
      detail: describeAuditError(result.error),
    }));
    process.exitCode = 1;
    process.exit();
  }
  console.error(`# ${includeDev ? "All Dependency" : "Production Dependency"} Audit`);
  console.error("");
  console.error(`Summary: npm audit could not be started: ${describeAuditError(result.error)}`);
  process.exitCode = 1;
  process.exit();
}

const raw = result.stdout?.trim() || result.stderr?.trim() || "";
let audit;
try {
  audit = JSON.parse(raw);
} catch {
  if (summaryOnly) {
    console.log(JSON.stringify({
      status: "fail",
      scope: includeDev ? "all" : "production",
      issue: "audit-json",
      sample: raw ? describeAuditError(raw) : "",
    }));
    process.exitCode = 1;
    process.exit();
  }
  console.error(`# ${includeDev ? "All Dependency" : "Production Dependency"} Audit`);
  console.error("");
  console.error("Summary: npm audit did not return parseable JSON output.");
  if (raw) console.error(`Output sample: ${describeAuditError(raw)}`);
  process.exitCode = 1;
  process.exit();
}

const counts = audit.metadata?.vulnerabilities ?? {};
const vulnerabilities = Object.values(audit.vulnerabilities ?? {});
const severityRank = new Map([["critical", 4], ["high", 3], ["moderate", 2], ["low", 1], ["info", 0]]);
const breakingFixes = vulnerabilities.filter((item) => item.fixAvailable && typeof item.fixAvailable === "object" && item.fixAvailable.isSemVerMajor);
const knownDevToolchainHighNames = new Set([
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
const countIssues = new Set();
const countCache = new Map();

function nonNegativeSafeInteger(value) {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  const text = String(value ?? "").trim();
  if (!/^(?:0|[1-9]\d{0,15})$/.test(text)) return null;
  const parsed = BigInt(text);
  return parsed <= MAX_SAFE_INTEGER_BIGINT ? Number(parsed) : null;
}

function countOf(name) {
  if (countCache.has(name)) return countCache.get(name);
  const value = counts[name];
  if (value === undefined) {
    countCache.set(name, 0);
    return 0;
  }
  const parsed = nonNegativeSafeInteger(value);
  if (parsed !== null) {
    countCache.set(name, parsed);
    return parsed;
  }
  countIssues.add(`metadata-${name}`);
  countCache.set(name, 0);
  return 0;
}

function formatFix(value) {
  if (value === true) return "available";
  if (!value) return "none";
  const target = value.name && value.version ? `${value.name}@${value.version}` : "available";
  return value.isSemVerMajor ? `${target} (breaking)` : target;
}

function printTable(headers, rows) {
  console.log(`| ${headers.join(" | ")} |`);
  console.log(`| ${headers.map(() => "---").join(" | ")} |`);
  for (const row of rows) console.log(`| ${row.join(" | ")} |`);
}

function isKnownDevToolchainHigh(item) {
  return allowKnownDevToolchainHigh && item.severity === "high" && knownDevToolchainHighNames.has(item.name);
}

const allowedKnownDevToolchainHigh = vulnerabilities
  .filter(isKnownDevToolchainHigh)
  .map((item) => item.name)
  .sort();
const blockingHighCritical = vulnerabilities.filter(
  (item) => ["critical", "high"].includes(item.severity) && !isKnownDevToolchainHigh(item),
);

if (summaryOnly) {
  const summaryCounts = {
    total: countOf("total"),
    critical: countOf("critical"),
    high: countOf("high"),
    moderate: countOf("moderate"),
    low: countOf("low"),
  };
  console.log(JSON.stringify({
    status: blockingHighCritical.length > 0 || countIssues.size > 0 ? "fail" : "pass",
    scope: includeDev ? "all" : "production",
    ...summaryCounts,
    blockingHighCritical: blockingHighCritical.length,
    knownDevToolchainHigh: allowedKnownDevToolchainHigh.length,
    breakingFixes: breakingFixes.length,
    countIssues: countIssues.size,
    ...(countIssues.size > 0 ? { issue: "audit-counts" } : {}),
  }));
  if (blockingHighCritical.length > 0 || countIssues.size > 0) process.exitCode = 1;
  process.exit();
}

console.log(`# ${includeDev ? "All Dependency" : "Production Dependency"} Audit`);
console.log("");
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log(`Scope: ${includeDev ? "npm audit" : "npm audit --omit=dev"}`);
console.log("");
printTable(["Severity", "Count"], [
  ["critical", String(countOf("critical"))],
  ["high", String(countOf("high"))],
  ["moderate", String(countOf("moderate"))],
  ["low", String(countOf("low"))],
  ["total", String(countOf("total"))],
]);

const top = vulnerabilities
  .slice()
  .sort((a, b) => (severityRank.get(b.severity) ?? -1) - (severityRank.get(a.severity) ?? -1) || String(a.name).localeCompare(String(b.name)))
  .slice(0, 12)
  .map((item) => [
    item.name,
    item.severity,
    String(item.via?.length ?? 0),
    formatFix(item.fixAvailable),
  ]);

console.log("");
printTable(["Package", "Severity", "Via", "Fix"], top.length > 0 ? top : [["none", "none", "0", "none"]]);

if (allowedKnownDevToolchainHigh.length > 0) {
  console.log("");
  console.log(`Allowed known dev-toolchain high advisories: ${allowedKnownDevToolchainHigh.join(", ")}`);
  console.log("These are non-production ESLint/minimatch advisories; production audit must pass separately.");
}

if (breakingFixes.length > 0) {
  console.log("");
  console.log(`Breaking fixes suggested: ${breakingFixes.map((item) => item.name).sort().join(", ")}`);
}

if (blockingHighCritical.length > 0) {
  console.log("");
  console.log(`Summary: ${includeDev ? "all" : "production"} dependency audit failed: ${blockingHighCritical.length} blocking high/critical advisories, ${countOf("total")} total advisories.`);
  process.exitCode = 1;
} else if (countIssues.size > 0) {
  console.log("");
  console.log(`Summary: ${includeDev ? "all" : "production"} dependency audit failed: ${countIssues.size} malformed audit metadata count(s).`);
  process.exitCode = 1;
} else if (allowedKnownDevToolchainHigh.length > 0) {
  console.log("");
  console.log(`Summary: all dependency audit passed with ${allowedKnownDevToolchainHigh.length} known dev-toolchain high advisory exception(s), 0 blocking high/critical advisories, ${countOf("total")} total advisories.`);
} else {
  console.log("");
  console.log(`Summary: ${includeDev ? "all" : "production"} dependency audit passed with no high or critical advisories.`);
}
