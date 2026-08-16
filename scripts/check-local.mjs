import { spawn, spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { resolveCheckLocalDistDir } from "./check-local-dist-dir.mjs";
import {
  createCheckLocalPlan,
  createCheckLocalChildEnvironment,
  describeCheckLocalError,
  finalizeCheckLocalRun,
  isCheckLocalSummaryOnly,
  prepareCheckLocalOutput,
  snapshotCheckLocalDatabaseFiles,
  startCheckLocalServerAfterAdmission,
} from "./check-local-policy.mjs";
import { parsePositiveIntegerEnv } from "./env-parsing.mjs";

const CHECK_LOCAL_REPO_ROOT = resolve(".");
const CHECK_LOCAL_TEMP_ROOT = resolve(".tmp");
const CHECK_LOCAL_PROTECTED_DB_PATHS = [
  resolve("data", "lore-v10.sqlite"),
  resolve("data", "lore-v10.sqlite-wal"),
  resolve("data", "lore-v10.sqlite-shm"),
];
let CHECK_LOCAL_PORT;
let CHECK_LOCAL_DIST_DIR;
let CHECK_LOCAL_DIST_PATH;
let SMOKE_BASE_URL;
let SHOULD_START_LOCAL_SERVER;
let SERVER_START_TIMEOUT_MS;
let MAX_CHECK_LOCAL_SUMMARY_LINES;
let summaryOnly;
let CHECK_LOCAL_TEMP_DIR;
let CHECK_LOCAL_PROTECTED_DB_SNAPSHOT;
let CHECK_LOCAL_ENV;
let CHECK_LOCAL_NEXT_ENV;
let npmCommand;
let nextBin;
let steps;
let smokeSteps;

function initializeCheckLocalRuntime(argv = process.argv) {
  CHECK_LOCAL_PORT = parsePositiveIntegerEnv(process.env.CHECK_LOCAL_PORT, 3101);
  const dist = resolveCheckLocalDistDir(process.env.CHECK_LOCAL_DIST_DIR ?? ".next-check", CHECK_LOCAL_REPO_ROOT);
  CHECK_LOCAL_DIST_DIR = dist.relativePath;
  CHECK_LOCAL_DIST_PATH = dist.resolvedPath;
  const defaultBaseUrl = `http://127.0.0.1:${CHECK_LOCAL_PORT}`;
  SMOKE_BASE_URL = process.env.SMOKE_BASE_URL || defaultBaseUrl;
  SHOULD_START_LOCAL_SERVER = !process.env.SMOKE_BASE_URL;
  SERVER_START_TIMEOUT_MS = parsePositiveIntegerEnv(process.env.CHECK_LOCAL_SERVER_START_TIMEOUT_MS, 90_000);
  MAX_CHECK_LOCAL_SUMMARY_LINES = parsePositiveIntegerEnv(process.env.CHECK_LOCAL_SUMMARY_LINES, 40);
  summaryOnly = isCheckLocalSummaryOnly(argv);
  mkdirSync(CHECK_LOCAL_TEMP_ROOT, { recursive: true });
  CHECK_LOCAL_TEMP_DIR = mkdtempSync(join(CHECK_LOCAL_TEMP_ROOT, "check-local-"));
  CHECK_LOCAL_PROTECTED_DB_SNAPSHOT = snapshotCheckLocalDatabaseFiles(CHECK_LOCAL_PROTECTED_DB_PATHS);
  const childEnvironment = createCheckLocalChildEnvironment({
    tempDir: CHECK_LOCAL_TEMP_DIR,
    distDir: CHECK_LOCAL_DIST_DIR,
  });
  CHECK_LOCAL_ENV = childEnvironment.env;
  CHECK_LOCAL_NEXT_ENV = childEnvironment.nextEnv;
  npmCommand = process.env.npm_execpath && process.execPath ? process.execPath : null;
  nextBin = resolve("node_modules", "next", "dist", "bin", "next");
  ({ steps, smokeSteps } = createCheckLocalPlan({ npmCommand, processExecPath: process.execPath }));
}

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

function flushStepOutput(result, { compact = false } = {}) {
  const { stdout: visibleStdout, stderr: visibleStderr } = prepareCheckLocalOutput(result, {
    compact,
    maxLines: MAX_CHECK_LOCAL_SUMMARY_LINES,
  });
  if (visibleStdout) {
    process.stdout.write(visibleStdout.endsWith("\n") ? visibleStdout : `${visibleStdout}\n`);
  }
  if (visibleStderr) {
    process.stderr.write(visibleStderr.endsWith("\n") ? visibleStderr : `${visibleStderr}\n`);
  }
}

function prepareStep(step) {
  if (!Array.isArray(step.args)) {
    return;
  }

  if (!shouldUseIsolatedNextDistDir(step)) {
    return;
  }

  if (existsSync(CHECK_LOCAL_DIST_PATH)) {
    const stats = lstatSync(CHECK_LOCAL_DIST_PATH);
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
      throw new Error("CHECK_LOCAL_DIST_DIR must reference a real tool-owned directory");
    }
    rmSync(CHECK_LOCAL_DIST_PATH, { recursive: true, force: true });
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
  const serverLogs = [];
  const serverProcess = await startCheckLocalServerAfterAdmission({
    baseUrl,
    canReach: canReachSmokeBaseUrl,
    spawnServer: () => spawn(process.execPath, [nextBin, "start", "--port", String(CHECK_LOCAL_PORT)], {
      cwd: process.cwd(),
      env: { ...process.env, ...CHECK_LOCAL_NEXT_ENV },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }),
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

export async function runCheckLocalCli(argv = process.argv) {
  initializeCheckLocalRuntime(argv);
  let localServer = null;
  let checkFailure = null;
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
    checkFailure = error;
  } finally {
    checkFailure = await finalizeCheckLocalRun({
      primaryError: checkFailure,
      serverProcess: localServer?.serverProcess ?? null,
      stopServer: stopLocalServer,
      tempDir: CHECK_LOCAL_TEMP_DIR,
      removeTempDir: (tempDir) => rmSync(tempDir, { recursive: true, force: true }),
      protectedPaths: CHECK_LOCAL_PROTECTED_DB_PATHS,
      protectedSnapshot: CHECK_LOCAL_PROTECTED_DB_SNAPSHOT,
      reportSecondary: (message) => console.error(message),
    });
  }

  if (checkFailure) {
    console.error(describeCheckLocalError(checkFailure));
    const exitCode = Number(checkFailure.exitCode);
    process.exitCode = Number.isSafeInteger(exitCode) && exitCode > 0 ? exitCode : 1;
  } else {
    console.log("\nLocal check completed successfully.");
  }
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1])) {
  await runCheckLocalCli();
}
