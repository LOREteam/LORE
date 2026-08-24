import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { redactProofText } from "./redact-proof-output.mjs";

export const MAX_CHECK_LOCAL_ERROR_CHARS = 500;

export function isCheckLocalSummaryOnly(argv = []) {
  return Array.isArray(argv) && argv.includes("--summary-only");
}

export function createCheckLocalChildEnvironment({ tempDir, distDir, joinPath = join }) {
  if (typeof tempDir !== "string" || tempDir.length === 0) throw new Error("check-local temp directory is required");
  if (typeof distDir !== "string" || distDir.length === 0) throw new Error("check-local dist directory is required");
  const dbPath = joinPath(tempDir, "lore.sqlite");
  const env = { LORE_DB_PATH: dbPath };
  return {
    dbPath,
    env,
    nextEnv: { ...env, NEXT_DIST_DIR: distDir, ALLOW_WEAK_RATE_LIMIT_IDENTITY: "1" },
  };
}

export function snapshotCheckLocalDatabaseFiles(
  filePaths,
  {
    pathExists = existsSync,
    readFile = readFileSync,
    statFile = (filePath) => statSync(filePath, { bigint: true }),
  } = {},
) {
  if (!Array.isArray(filePaths)) throw new Error("protected database paths must be an array");
  return filePaths.map((filePath) => {
    if (!pathExists(filePath)) return { filePath, exists: false };
    const stats = statFile(filePath);
    return {
      filePath,
      exists: true,
      regularFile: stats.isFile(),
      size: stats.size.toString(),
      mtimeNs: stats.mtimeNs.toString(),
      sha256: stats.isFile() ? createHash("sha256").update(readFile(filePath)).digest("hex") : null,
    };
  });
}

export function checkLocalProtectedDatabaseIssues(before, after) {
  if (!Array.isArray(before) || !Array.isArray(after) || before.length !== after.length) {
    return ["protected database snapshot shape changed"];
  }
  return before.flatMap((entry, index) => (
    JSON.stringify(entry) === JSON.stringify(after[index])
      ? []
      : [`protected database changed: ${basename(String(entry?.filePath ?? "unknown"))}`]
  ));
}

export async function startCheckLocalServerAfterAdmission({ baseUrl, canReach, spawnServer }) {
  if (typeof canReach !== "function" || typeof spawnServer !== "function") {
    throw new Error("check-local server admission dependencies are required");
  }
  if (await canReach(baseUrl)) {
    throw new Error(`Refusing to start local server because smoke base URL is already reachable: ${baseUrl}`);
  }
  return spawnServer();
}

export async function finalizeCheckLocalRun({
  primaryError = null,
  serverProcess = null,
  stopServer,
  tempDir,
  removeTempDir,
  protectedPaths,
  protectedSnapshot,
  snapshotFiles = snapshotCheckLocalDatabaseFiles,
  reportSecondary = () => {},
}) {
  let failure = primaryError;
  const capture = (error, context = "") => {
    if (!failure) {
      failure = error;
      return;
    }
    const prefix = context ? `${context}: ` : "Additional local-check failure: ";
    reportSecondary(`${prefix}${describeCheckLocalError(error)}`);
  };
  if (serverProcess) {
    try {
      await stopServer(serverProcess);
    } catch (error) {
      capture(error, "Failed to stop local smoke server");
    }
  }
  try {
    removeTempDir(tempDir);
  } catch (error) {
    capture(error, "Failed to clean isolated local-check directory");
  }
  try {
    const issues = checkLocalProtectedDatabaseIssues(protectedSnapshot, snapshotFiles(protectedPaths));
    if (issues.length > 0) throw new Error(issues.join(", "));
  } catch (error) {
    capture(error);
  }
  return failure;
}

const NPM_CORE_POLICY = Object.freeze([
  ["lint", "lint"],
  ["hermetic-build", "test:build-hermetic"],
  ["business-logic", "test:logic"],
  ["security-followup", "proof:security-followup"],
  ["fetch-timeout", "test:fetch-timeout"],
  ["stored-number-parsing", "test:stored-number-parsing"],
  ["p1-hardening", "test:p1-hardening"],
  ["performance-self-test", "perf:p1:self-test"],
  ["contract-v10", "test:contract:v10"],
  ["indexer-storage", "test:indexer-storage"],
  ["db-operations", "test:db-operations"],
  ["monitoring", "test:monitoring"],
  ["build", "build", { kind: "build" }],
  ["typecheck", "typecheck", { retryOnce: true }],
]);

const DIRECT_CORE_POLICY = Object.freeze([
  ["lint", ["node_modules", "eslint", "bin", "eslint.js"], ["."]],
  ["hermetic-build", ["scripts", "test-hermetic-build.mjs"]],
  ["business-logic", ["scripts", "business-logic-isolated-runner.mjs"]],
  ["security-followup", ["scripts", "check-security-followup.mjs"]],
  ["fetch-timeout", ["node_modules", "tsx", "dist", "cli.mjs"], [["scripts", "test-fetch-with-timeout.ts"]]],
  ["stored-number-parsing", ["node_modules", "tsx", "dist", "cli.mjs"], [["scripts", "test-stored-number-parsing.ts"]]],
  ["p1-hardening", ["scripts", "run-p1-hardening-tests.mjs"]],
  ["performance-self-test", ["scripts", "collect-p1-performance-evidence.mjs"], ["--self-test"]],
  ["contract-v10", ["scripts", "test-contract-v10-invariants.mjs"]],
  ["indexer-storage", ["node_modules", "tsx", "dist", "cli.mjs"], [["scripts", "test-indexer-event-storage.ts"]]],
  ["db-operations", ["scripts", "test-sqlite-operations.mjs"]],
  ["monitoring", ["scripts", "test-runtime-monitor-drill.mjs"]],
  ["build", ["scripts", "run-hermetic-build.mjs"], [], { kind: "build" }],
  ["next-typegen", ["node_modules", "next", "dist", "bin", "next"], ["typegen"], { retryOnce: true }],
  ["typescript", ["node_modules", "typescript", "bin", "tsc"], ["--noEmit", "--incremental", "false"], { retryOnce: true }],
]);

const NPM_SMOKE_POLICY = Object.freeze([
  ["http-smoke", "smoke:http", { env: { SMOKE_SKIP_WARMUP: "1" } }],
  ["browser-smoke", "smoke:browser", {
    env: { SMOKE_BROWSER_TIMEOUT_MS: "60000", SMOKE_INCLUDE_DEBUG_AUTOMINER_SCENARIOS: "1" },
    retryOnce: true,
  }],
]);

function directArgs(resolvePath, executableSegments, extraArgs = []) {
  return [resolvePath(...executableSegments), ...extraArgs.map((arg) => Array.isArray(arg) ? resolvePath(...arg) : arg)];
}

function buildCheckLocalPlan({ npmCommand, processExecPath, resolvePath = resolve }) {
  const npmMode = Boolean(npmCommand);
  const steps = npmMode
    ? NPM_CORE_POLICY.map(([id, script, options = {}]) => ({ id, command: npmCommand, args: ["run", script], ...options }))
    : DIRECT_CORE_POLICY.map(([id, executable, extraArgs = [], options = {}]) => ({
      id,
      command: processExecPath,
      args: directArgs(resolvePath, executable, extraArgs),
      ...options,
    }));
  const smokeSteps = npmMode
    ? NPM_SMOKE_POLICY.map(([id, script, options]) => ({ id, command: npmCommand, args: ["run", script], ...options }))
    : [
      {
        id: "http-smoke",
        command: processExecPath,
        args: [resolvePath("scripts", "smoke-http.mjs")],
        env: { SMOKE_SKIP_WARMUP: "1" },
      },
      {
        id: "browser-smoke",
        command: processExecPath,
        args: [resolvePath("scripts", "smoke-browser.mjs")],
        env: { SMOKE_BROWSER_TIMEOUT_MS: "60000", SMOKE_INCLUDE_DEBUG_AUTOMINER_SCENARIOS: "1" },
        retryOnce: true,
      },
    ];
  return { npmMode, steps, smokeSteps };
}

function comparablePlan(plan) {
  return JSON.stringify({
    npmMode: plan?.npmMode,
    steps: plan?.steps,
    smokeSteps: plan?.smokeSteps,
  });
}

export function checkLocalPlanIssues(plan, options) {
  const expected = buildCheckLocalPlan(options);
  return comparablePlan(plan) === comparablePlan(expected) ? [] : ["check-local execution plan mismatch"];
}

export function createCheckLocalPlan(options) {
  const plan = buildCheckLocalPlan(options);
  const issues = checkLocalPlanIssues(plan, options);
  if (issues.length > 0) throw new Error(issues.join(", "));
  return plan;
}

const FILTERED_WARNING_PATTERNS = [
  /ExperimentalWarning: SQLite is an experimental feature/i,
  /Using edge runtime on a page currently disables static generation/i,
  /\[MODULE_TYPELESS_PACKAGE_JSON\]/i,
  /Reparsing as ES module because module syntax was detected/i,
  /To eliminate this warning, add "type": "module"/i,
  /\(Use `node --trace-warnings .*` to show where the warning was created\)/i,
];

export function filterCheckLocalWarnings(output) {
  if (typeof output !== "string" || output.length === 0) return "";
  const filtered = output
    .split(/\r?\n/)
    .filter((line) => !FILTERED_WARNING_PATTERNS.some((pattern) => pattern.test(line)))
    .join("\n");
  return redactProofText(filtered);
}

export function tailCheckLocalLines(output, maxLines) {
  const lines = output.split(/\r?\n/).filter(Boolean);
  if (lines.length <= maxLines) return lines.join("\n");
  return [`...<truncated ${lines.length - maxLines} line(s)>`, ...lines.slice(-maxLines)].join("\n");
}

export function prepareCheckLocalOutput(result, { compact = false, maxLines = 40 } = {}) {
  const stdout = filterCheckLocalWarnings(result?.stdout);
  const stderr = filterCheckLocalWarnings(result?.stderr);
  if (compact && result?.status === 0) return { stdout: "", stderr: "" };
  return {
    stdout: compact ? tailCheckLocalLines(stdout, maxLines) : stdout,
    stderr: compact ? tailCheckLocalLines(stderr, maxLines) : stderr,
  };
}

export function describeCheckLocalError(error) {
  const text = redactProofText(error instanceof Error ? error.message : String(error))
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= MAX_CHECK_LOCAL_ERROR_CHARS) return text;
  return `${text.slice(0, MAX_CHECK_LOCAL_ERROR_CHARS - 15)}...<truncated>`;
}
