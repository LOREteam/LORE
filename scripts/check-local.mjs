import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parsePositiveIntegerEnv } from "./env-parsing.mjs";
import { redactProofText } from "./redact-proof-output.mjs";

const CHECK_LOCAL_PORT = parsePositiveIntegerEnv(process.env.CHECK_LOCAL_PORT, 3101);
const CHECK_LOCAL_DIST_DIR = process.env.CHECK_LOCAL_DIST_DIR || ".next-check";
const DEFAULT_LOCAL_SMOKE_BASE_URL = `http://127.0.0.1:${CHECK_LOCAL_PORT}`;
const SMOKE_BASE_URL = process.env.SMOKE_BASE_URL || DEFAULT_LOCAL_SMOKE_BASE_URL;
const SHOULD_START_LOCAL_SERVER = !process.env.SMOKE_BASE_URL;
const SERVER_START_TIMEOUT_MS = parsePositiveIntegerEnv(process.env.CHECK_LOCAL_SERVER_START_TIMEOUT_MS, 90_000);
const MAX_CHECK_LOCAL_ERROR_CHARS = 500;
const MAX_CHECK_LOCAL_SUMMARY_LINES = parsePositiveIntegerEnv(process.env.CHECK_LOCAL_SUMMARY_LINES, 40);
const summaryOnly = process.argv.includes("--summary-only");
const CHECK_LOCAL_TEMP_ROOT = resolve(".tmp");
mkdirSync(CHECK_LOCAL_TEMP_ROOT, { recursive: true });
const CHECK_LOCAL_TEMP_DIR = mkdtempSync(join(CHECK_LOCAL_TEMP_ROOT, "check-local-"));
const CHECK_LOCAL_DB_PATH = join(CHECK_LOCAL_TEMP_DIR, "lore.sqlite");
const CHECK_LOCAL_PROTECTED_DB_PATHS = [
  resolve("data", "lore-v10.sqlite"),
  resolve("data", "lore-v10.sqlite-wal"),
  resolve("data", "lore-v10.sqlite-shm"),
];
const CHECK_LOCAL_PROTECTED_DB_SNAPSHOT = snapshotDatabaseFiles(CHECK_LOCAL_PROTECTED_DB_PATHS);
const CHECK_LOCAL_ENV = {
  LORE_DB_PATH: CHECK_LOCAL_DB_PATH,
};
const CHECK_LOCAL_NEXT_ENV = {
  ...CHECK_LOCAL_ENV,
  NEXT_DIST_DIR: CHECK_LOCAL_DIST_DIR,
  ALLOW_WEAK_RATE_LIMIT_IDENTITY: "1",
};

function snapshotDatabaseFiles(filePaths) {
  return filePaths.map((filePath) => {
    if (!existsSync(filePath)) {
      return { filePath, exists: false };
    }

    const stats = statSync(filePath, { bigint: true });
    return {
      filePath,
      exists: true,
      regularFile: stats.isFile(),
      size: stats.size.toString(),
      mtimeNs: stats.mtimeNs.toString(),
      sha256: stats.isFile()
        ? createHash("sha256").update(readFileSync(filePath)).digest("hex")
        : null,
    };
  });
}

function assertProtectedDatabaseFilesUnchanged() {
  const after = snapshotDatabaseFiles(CHECK_LOCAL_PROTECTED_DB_PATHS);
  const changed = CHECK_LOCAL_PROTECTED_DB_SNAPSHOT
    .filter((before, index) => JSON.stringify(before) !== JSON.stringify(after[index]))
    .map(({ filePath }) => basename(filePath));
  if (changed.length > 0) {
    throw new Error(`Local check changed protected database state: ${changed.join(", ")}`);
  }
}

function describeCheckLocalError(error) {
  const text = redactProofText(error instanceof Error ? error.message : String(error))
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= MAX_CHECK_LOCAL_ERROR_CHARS) return text;
  return `${text.slice(0, MAX_CHECK_LOCAL_ERROR_CHARS - 15)}...<truncated>`;
}

const npmCommand = process.env.npm_execpath && process.execPath ? process.execPath : null;
const nextBin = resolve("node_modules", "next", "dist", "bin", "next");
const steps = npmCommand
  ? [
      { command: npmCommand, args: ["run", "lint"] },
      { command: npmCommand, args: ["run", "test:logic"] },
      { command: npmCommand, args: ["run", "proof:security-followup"] },
      { command: npmCommand, args: ["run", "test:fetch-timeout"] },
      { command: npmCommand, args: ["run", "test:stored-number-parsing"] },
      { command: npmCommand, args: ["run", "test:contract"] },
      { command: npmCommand, args: ["run", "test:contract:v10"] },
      { command: npmCommand, args: ["run", "test:indexer-storage"] },
      { command: npmCommand, args: ["run", "test:db-operations"] },
      { command: npmCommand, args: ["run", "test:monitoring"] },
      { command: npmCommand, args: ["run", "build"] },
      { command: npmCommand, args: ["run", "typecheck"], retryOnce: true },
    ]
  : [
      { command: process.execPath, args: [resolve("node_modules", "eslint", "bin", "eslint.js"), "."] },
      { command: process.execPath, args: [resolve("node_modules", "tsx", "dist", "cli.mjs"), resolve("scripts", "test-business-logic.mjs")] },
      { command: process.execPath, args: [resolve("scripts", "check-security-followup.mjs")] },
      { command: process.execPath, args: [resolve("node_modules", "tsx", "dist", "cli.mjs"), resolve("scripts", "test-fetch-with-timeout.ts")] },
      { command: process.execPath, args: [resolve("node_modules", "tsx", "dist", "cli.mjs"), resolve("scripts", "test-stored-number-parsing.ts")] },
      { command: process.execPath, args: [resolve("scripts", "test-contract-v9-invariants.mjs")] },
      { command: process.execPath, args: [resolve("scripts", "test-contract-v10-invariants.mjs")] },
      { command: process.execPath, args: [resolve("node_modules", "tsx", "dist", "cli.mjs"), resolve("scripts", "test-indexer-event-storage.ts")] },
      { command: process.execPath, args: [resolve("scripts", "test-sqlite-operations.mjs")] },
      { command: process.execPath, args: [resolve("scripts", "test-runtime-monitor-drill.mjs")] },
      { command: process.execPath, args: [nextBin, "build", "--webpack"], kind: "build" },
      { command: process.execPath, args: [nextBin, "typegen"], retryOnce: true },
      { command: process.execPath, args: [resolve("node_modules", "typescript", "bin", "tsc"), "--noEmit", "--incremental", "false"], retryOnce: true },
    ];
const smokeSteps = npmCommand
  ? [
      {
        command: npmCommand,
        args: ["run", "smoke:http"],
        env: { SMOKE_SKIP_WARMUP: "1" },
      },
      {
        command: npmCommand,
        args: ["run", "smoke:browser"],
        env: { SMOKE_BROWSER_TIMEOUT_MS: "60000", SMOKE_INCLUDE_DEBUG_AUTOMINER_SCENARIOS: "1" },
        retryOnce: true,
      },
    ]
  : [
      {
        command: process.execPath,
        args: [resolve("scripts", "smoke-http.mjs")],
        env: { SMOKE_SKIP_WARMUP: "1" },
      },
      {
        command: process.execPath,
        args: [resolve("scripts", "smoke-browser.mjs")],
        env: { SMOKE_BROWSER_TIMEOUT_MS: "60000", SMOKE_INCLUDE_DEBUG_AUTOMINER_SCENARIOS: "1" },
        retryOnce: true,
      },
    ];
const FILTERED_WARNING_PATTERNS = [
  /ExperimentalWarning: SQLite is an experimental feature/i,
  /Using edge runtime on a page currently disables static generation/i,
  /\[MODULE_TYPELESS_PACKAGE_JSON\]/i,
  /Reparsing as ES module because module syntax was detected/i,
  /To eliminate this warning, add "type": "module"/i,
  /\(Use `node --trace-warnings .*` to show where the warning was created\)/i,
];

function shouldSkipStepFailure(step, result) {
  if (!isNpmScript(step, "smoke:browser") && !step.args?.some((arg) => String(arg).endsWith("smoke-browser.mjs"))) {
    return false;
  }

  const combinedOutput = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  return combinedOutput.includes("no Chrome/Edge executable found; set SMOKE_BROWSER_EXECUTABLE");
}

function formatStepLabel(command, args) {
  if (process.env.npm_execpath && process.execPath) {
    return `npm ${args.join(" ")}`;
  }
  return `${command} ${args.join(" ")}`;
}

function isNpmScript(step, scriptName) {
  return Array.isArray(step.args) && step.args[0] === "run" && step.args[1] === scriptName;
}

function runStep(step) {
  const { command, args, env } = step;
  const stepEnv = shouldUseIsolatedNextDistDir(step)
    ? { ...process.env, ...CHECK_LOCAL_NEXT_ENV, ...(env ?? {}) }
    : { ...process.env, ...CHECK_LOCAL_ENV, ...(env ?? {}) };
  if (npmCommand && process.env.npm_execpath) {
    return spawnSync(command, [process.env.npm_execpath, ...args], {
      stdio: "pipe",
      encoding: "utf8",
      env: stepEnv,
    });
  }

  return spawnSync(command, args, {
    stdio: "pipe",
    encoding: "utf8",
    env: stepEnv,
  });
}

function shouldUseIsolatedNextDistDir(step) {
  return step.kind === "build" || isNpmScript(step, "build");
}

function filterKnownWarnings(output) {
  if (typeof output !== "string" || output.length === 0) {
    return "";
  }

  const filtered = output
    .split(/\r?\n/)
    .filter((line) => !FILTERED_WARNING_PATTERNS.some((pattern) => pattern.test(line)))
    .join("\n");
  return redactProofText(filtered);
}

function tailLines(output, maxLines = MAX_CHECK_LOCAL_SUMMARY_LINES) {
  const lines = output.split(/\r?\n/).filter(Boolean);
  if (lines.length <= maxLines) return lines.join("\n");
  return [
    `...<truncated ${lines.length - maxLines} line(s)>`,
    ...lines.slice(-maxLines),
  ].join("\n");
}

function flushStepOutput(result, { compact = false } = {}) {
  const stdout = filterKnownWarnings(result.stdout);
  const stderr = filterKnownWarnings(result.stderr);
  if (compact && result.status === 0) {
    return;
  }
  const visibleStdout = compact ? tailLines(stdout) : stdout;
  const visibleStderr = compact ? tailLines(stderr) : stderr;
  if (visibleStdout) {
    process.stdout.write(visibleStdout.endsWith("\n") ? visibleStdout : `${visibleStdout}\n`);
  }
  if (visibleStderr) {
    process.stderr.write(visibleStderr.endsWith("\n") ? visibleStderr : `${visibleStderr}\n`);
  }
}

function prepareStep(step) {
  if (!Array.isArray(step.args) || step.args.length < 2) {
    return;
  }

  if (!shouldUseIsolatedNextDistDir(step)) {
    return;
  }

  const nextDir = resolve(CHECK_LOCAL_DIST_DIR);
  if (existsSync(nextDir)) {
    rmSync(nextDir, { recursive: true, force: true });
  }
}

async function canReachSmokeBaseUrl(baseUrl) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1500);
    const response = await fetch(baseUrl, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
}

function formatServerLogs(lines) {
  if (lines.length === 0) {
    return "(no server output captured)";
  }
  return lines.slice(-40).join("\n");
}

async function ensureReachableSmokeBaseUrl(baseUrl) {
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    if (await canReachSmokeBaseUrl(baseUrl)) {
      return;
    }
    await delay(1000);
  }
  throw new Error(`Smoke base URL is not reachable: ${baseUrl}`);
}

async function stopLocalServer(serverProcess) {
  if (!serverProcess || serverProcess.exitCode !== null) {
    return;
  }

  const waitForExit = (timeoutMs) =>
    new Promise((resolveWait) => {
      if (serverProcess.exitCode !== null) {
        resolveWait(true);
        return;
      }
      const timeout = setTimeout(() => {
        serverProcess.off("exit", onExit);
        resolveWait(false);
      }, timeoutMs);
      const onExit = () => {
        clearTimeout(timeout);
        resolveWait(true);
      };
      serverProcess.once("exit", onExit);
    });

  try {
    serverProcess.kill();
  } catch {
    // Continue to platform-specific forced cleanup below.
  }

  if (await waitForExit(1_500)) {
    return;
  }

  if (process.platform === "win32") {
    spawnSync("taskkill", ["/pid", String(serverProcess.pid), "/t", "/f"], {
      stdio: "ignore",
      windowsHide: true,
    });
  } else {
    serverProcess.kill("SIGKILL");
  }

  if (!(await waitForExit(5_000))) {
    throw new Error(`Local server process ${serverProcess.pid} did not exit after stop request.`);
  }
}

async function startLocalServer(baseUrl) {
  if (await canReachSmokeBaseUrl(baseUrl)) {
    throw new Error(`Refusing to start local server because smoke base URL is already reachable: ${baseUrl}`);
  }

  const serverLogs = [];
  const serverProcess = spawn(process.execPath, [nextBin, "start", "--port", String(CHECK_LOCAL_PORT)], {
    cwd: process.cwd(),
    env: { ...process.env, ...CHECK_LOCAL_NEXT_ENV },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  const pushServerLog = (chunk, prefix) => {
    const text = String(chunk ?? "").trimEnd();
    if (!text) return;
    for (const line of text.split(/\r?\n/)) {
      serverLogs.push(`${prefix}${line}`);
    }
  };

  serverProcess.stdout?.on("data", (chunk) => pushServerLog(chunk, "[site] "));
  serverProcess.stderr?.on("data", (chunk) => pushServerLog(chunk, "[site] "));

  const startedAt = Date.now();
  while (Date.now() - startedAt < SERVER_START_TIMEOUT_MS) {
    if (serverProcess.exitCode !== null) {
      throw new Error(
        `Local server exited before becoming ready.\n${formatServerLogs(serverLogs)}`,
      );
    }
    if (await canReachSmokeBaseUrl(baseUrl)) {
      return { serverProcess, serverLogs };
    }
    await delay(1000);
  }

  await stopLocalServer(serverProcess);
  throw new Error(
    `Timed out waiting for local server at ${baseUrl}.\n${formatServerLogs(serverLogs)}`,
  );
}

async function runStepWithRetries(step, extraEnv = {}) {
  const { command, args, retryOnce } = step;
  const startedAt = Date.now();
  console.log(`\n> ${formatStepLabel(command, args)}`);
  prepareStep(step);
  const preparedStep = {
    ...step,
    env: {
      ...(step.env ?? {}),
      ...extraEnv,
    },
  };
  let result = runStep(preparedStep);
  flushStepOutput(result, { compact: summaryOnly });

  if (retryOnce && typeof result.status === "number" && result.status !== 0) {
    console.warn(`Retrying ${formatStepLabel(command, args)} once after initial failure...`);
    prepareStep(step);
    result = runStep(preparedStep);
    flushStepOutput(result, { compact: summaryOnly });
  }

  if (typeof result.status === "number" && result.status !== 0 && shouldSkipStepFailure(step, result)) {
    console.warn(`Skipping ${formatStepLabel(command, args)}: no local Chrome/Edge executable configured.`);
    return;
  }

  if (typeof result.status === "number" && result.status !== 0) {
    const error = new Error(`${formatStepLabel(command, args)} failed with exit code ${result.status}.`);
    error.exitCode = result.status;
    throw error;
  }

  if (result.error) {
    throw result.error;
  }

  if (result.status === null) {
    throw new Error(`${formatStepLabel(command, args)} ended without an exit code.`);
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(`Completed ${formatStepLabel(command, args)} in ${(elapsedMs / 1000).toFixed(1)}s`);
}

let localServer = null;
let checkFailure = null;

function captureCheckFailure(error, context = "") {
  if (!checkFailure) {
    checkFailure = error;
    return;
  }
  const prefix = context ? `${context}: ` : "Additional local-check failure: ";
  console.error(`${prefix}${describeCheckLocalError(error)}`);
}

try {
  for (const step of steps) {
    await runStepWithRetries(step);
  }

  if (SHOULD_START_LOCAL_SERVER) {
    console.log(`\n> starting local server for smoke at ${SMOKE_BASE_URL}`);
    localServer = await startLocalServer(SMOKE_BASE_URL);
  } else {
    await ensureReachableSmokeBaseUrl(SMOKE_BASE_URL);
  }

  for (const step of smokeSteps) {
    await runStepWithRetries(step, { SMOKE_BASE_URL });
  }

} catch (error) {
  captureCheckFailure(error);
} finally {
  if (localServer?.serverProcess) {
    try {
      await stopLocalServer(localServer.serverProcess);
    } catch (error) {
      captureCheckFailure(error, "Failed to stop local smoke server");
    }
  }
  try {
    rmSync(CHECK_LOCAL_TEMP_DIR, { recursive: true, force: true });
  } catch (error) {
    captureCheckFailure(error, "Failed to clean isolated local-check directory");
  }
  try {
    assertProtectedDatabaseFilesUnchanged();
  } catch (error) {
    captureCheckFailure(error);
  }
}

if (checkFailure) {
  console.error(describeCheckLocalError(checkFailure));
  const exitCode = Number(checkFailure.exitCode);
  process.exitCode = Number.isSafeInteger(exitCode) && exitCode > 0 ? exitCode : 1;
} else {
  console.log("\nLocal check completed successfully.");
}
