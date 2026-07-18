import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const require = createRequire(import.meta.url);
const strict = process.argv.includes("--strict") || process.env.PROOF_STRICT === "1";

const expectedApps = new Map([
  ["lore-site", { args: "run start", packageScript: "start" }],
  ["lore-bot", { args: "run bot", packageScript: "bot" }],
  ["lore-indexer", { args: "run indexer", packageScript: "indexer" }],
  ["lore-monitor", { args: "run monitor:runtime", packageScript: "monitor:runtime" }],
  ["lore-backup", { args: "run db:backup", packageScript: "db:backup", scheduled: true }],
  ["lore-chain-audit", { args: "run audit:chain-indexer", packageScript: "audit:chain-indexer", scheduled: true }],
]);

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function printTable(headers, rows) {
  console.log(`| ${headers.join(" | ")} |`);
  console.log(`| ${headers.map(() => "---").join(" | ")} |`);
  for (const row of rows) console.log(`| ${row.join(" | ")} |`);
}

function packageScripts() {
  const packagePath = resolve(process.cwd(), "package.json");
  if (!existsSync(packagePath)) return {};
  const parsed = JSON.parse(readFileSync(packagePath, "utf8"));
  return parsed.scripts && typeof parsed.scripts === "object" ? parsed.scripts : {};
}

const issues = [];
const rows = [];
const scripts = packageScripts();
const ecosystemPath = resolve(process.cwd(), "ecosystem.config.cjs");
let apps = [];

console.log("# Process Model Preflight");
console.log("");
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log(`Strict: ${strict ? "yes" : "no"}`);
console.log(`Config: ${ecosystemPath}`);
console.log("");

if (!existsSync(ecosystemPath)) {
  issues.push("ecosystem.config.cjs is missing");
} else {
  try {
    const config = require(ecosystemPath);
    apps = Array.isArray(config?.apps) ? config.apps : [];
    if (apps.length === 0) issues.push("ecosystem.config.cjs must export a non-empty apps array");
  } catch (error) {
    issues.push(`ecosystem.config.cjs could not be loaded: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const appsByName = new Map(apps.map((app) => [app?.name, app]));

for (const [name, expected] of expectedApps) {
  const app = appsByName.get(name);
  const rowIssues = [];
  if (!app) {
    rowIssues.push("missing");
  } else {
    if (app.script !== "npm") rowIssues.push("script must be npm");
    if (app.args !== expected.args) rowIssues.push(`args must be "${expected.args}"`);
    if (!hasText(app.cwd)) rowIssues.push("cwd is missing");
    if (app.env?.NODE_ENV !== "production") rowIssues.push("NODE_ENV must be production");
    if (expected.scheduled) {
      if (app.autorestart !== false) rowIssues.push("scheduled job autorestart must be false");
      if (!hasText(app.cron_restart)) rowIssues.push("scheduled job cron_restart is missing");
    } else {
      if (app.autorestart !== true) rowIssues.push("autorestart must be true");
      if (typeof app.max_restarts !== "number" || app.max_restarts <= 0) rowIssues.push("max_restarts must be positive");
      if (typeof app.restart_delay !== "number" || app.restart_delay < 1000) rowIssues.push("restart_delay must be >= 1000");
    }
    if (!hasText(app.out_file) || !hasText(app.error_file)) rowIssues.push("log files are missing");
    if (app.merge_logs !== true) rowIssues.push("merge_logs must be true");
    if (app.time !== true) rowIssues.push("time must be true");
  }

  if (!hasText(scripts[expected.packageScript])) {
    rowIssues.push(`package script "${expected.packageScript}" is missing`);
  }

  if (rowIssues.length > 0) issues.push(`${name}: ${rowIssues.join(", ")}`);
  rows.push([name, rowIssues.length === 0 ? "checked" : "issue", rowIssues.join("; ") || "ok"]);
}

const extraLoreApps = apps
  .map((app) => app?.name)
  .filter((name) => typeof name === "string" && name.startsWith("lore-") && !expectedApps.has(name));
if (extraLoreApps.length > 0) {
  issues.push(`unexpected lore PM2 apps: ${extraLoreApps.join(", ")}`);
}

printTable(["Process", "Status", "Notes"], rows);
console.log("");
console.log(`Summary: ${issues.length === 0 ? "process model preflight completed without detected issues" : `${issues.length} issue(s): ${issues.join("; ")}`}.`);

if (strict && issues.length > 0) {
  process.exitCode = 1;
}
