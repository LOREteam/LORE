import { spawnSync } from "node:child_process";

const includeDev = process.argv.includes("--include-dev");
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
  console.error(`# ${includeDev ? "All Dependency" : "Production Dependency"} Audit`);
  console.error("");
  console.error(`Summary: npm audit could not be started: ${result.error.message}`);
  process.exitCode = 1;
  process.exit();
}

const raw = result.stdout?.trim() || result.stderr?.trim() || "";
let audit;
try {
  audit = JSON.parse(raw);
} catch {
  console.error(`# ${includeDev ? "All Dependency" : "Production Dependency"} Audit`);
  console.error("");
  console.error("Summary: npm audit did not return parseable JSON output.");
  if (raw) console.error(raw.split(/\r?\n/).slice(0, 20).join("\n"));
  process.exitCode = 1;
  process.exit();
}

const counts = audit.metadata?.vulnerabilities ?? {};
const vulnerabilities = Object.values(audit.vulnerabilities ?? {});
const severityRank = new Map([["critical", 4], ["high", 3], ["moderate", 2], ["low", 1], ["info", 0]]);
const breakingFixes = vulnerabilities.filter((item) => item.fixAvailable && typeof item.fixAvailable === "object" && item.fixAvailable.isSemVerMajor);

function countOf(name) {
  return Number(counts[name] ?? 0);
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

if (breakingFixes.length > 0) {
  console.log("");
  console.log(`Breaking fixes suggested: ${breakingFixes.map((item) => item.name).sort().join(", ")}`);
}

if (countOf("critical") > 0 || countOf("high") > 0) {
  console.log("");
  console.log(`Summary: ${includeDev ? "all" : "production"} dependency audit failed: ${countOf("critical")} critical, ${countOf("high")} high, ${countOf("total")} total advisories.`);
  process.exitCode = 1;
} else {
  console.log("");
  console.log(`Summary: ${includeDev ? "all" : "production"} dependency audit passed with no high or critical advisories.`);
}
