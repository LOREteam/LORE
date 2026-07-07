import { spawn, spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { parsePositiveIntegerEnv } from "./env-parsing.mjs";

const CHECK_LOCAL_PORT = parsePositiveIntegerEnv(process.env.CHECK_LOCAL_PORT, 3101);
const CHECK_LOCAL_DIST_DIR = process.env.CHECK_LOCAL_DIST_DIR || ".next-check";
const DEFAULT_LOCAL_SMOKE_BASE_URL = `http://127.0.0.1:${CHECK_LOCAL_PORT}`;
const SMOKE_BASE_URL = process.env.SMOKE_BASE_URL || DEFAULT_LOCAL_SMOKE_BASE_URL;
const SHOULD_START_LOCAL_SERVER = !process.env.SMOKE_BASE_URL;
const SERVER_START_TIMEOUT_MS = parsePositiveIntegerEnv(process.env.CHECK_LOCAL_SERVER_START_TIMEOUT_MS, 90_000);
const CHECK_LOCAL_NEXT_ENV = { NEXT_DIST_DIR: CHECK_LOCAL_DIST_DIR };

const npmCommand = process.env.npm_execpath && process.execPath ? process.execPath : null;
const nextBin = resolve("node_modules", "next", "dist", "bin", "next");
const steps = npmCommand
  ? [
      { command: npmCommand, args: ["run", "lint"] },
      { command: npmCommand, args: ["run", "test:logic"] },
      { command: npmCommand, args: ["run", "test:contract"] },
      { command: npmCommand, args: ["run", "build"] },
      { command: npmCommand, args: ["run", "typecheck"], retryOnce: true },
    ]
  : [
      { command: process.execPath, args: [resolve("node_modules", "eslint", "bin", "eslint.js"), "."] },
      { command: process.execPath, args: [resolve("node_modules", "tsx", "dist", "cli.mjs"), resolve("scripts", "test-business-logic.mjs")] },
      { command: process.execPath, args: [resolve("scripts", "test-contract-v9-invariants.mjs")] },
      { command: process.execPath, args: [resolve("scripts", "patch-privy-7702.mjs")] },
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
        env: { SMOKE_BROWSER_TIMEOUT_MS: "60000" },
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
        env: { SMOKE_BROWSER_TIMEOUT_MS: "60000" },
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
    : { ...process.env, ...(env ?? {}) };
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

  return output
    .split(/\r?\n/)
    .filter((line) => !FILTERED_WARNING_PATTERNS.some((pattern) => pattern.test(line)))
    .join("\n");
}

function flushStepOutput(result) {
  const stdout = filterKnownWarnings(result.stdout);
  const stderr = filterKnownWarnings(result.stderr);
  if (stdout) {
    process.stdout.write(stdout.endsWith("\n") ? stdout : `${stdout}\n`);
  }
  if (stderr) {
    process.stderr.write(stderr.endsWith("\n") ? stderr : `${stderr}\n`);
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
  const patchResult = spawnSync(process.execPath, [resolve("scripts/patch-privy-7702.mjs")], {
    stdio: "pipe",
    encoding: "utf8",
    env: process.env,
  });
  flushStepOutput(patchResult);
  if (patchResult.status !== 0 || patchResult.error) {
    throw patchResult.error ?? new Error("Failed to patch Privy runtime before local start");
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
  flushStepOutput(result);

  if (retryOnce && typeof result.status === "number" && result.status !== 0) {
    console.warn(`Retrying ${formatStepLabel(command, args)} once after initial failure...`);
    prepareStep(step);
    result = runStep(preparedStep);
    flushStepOutput(result);
  }

  if (typeof result.status === "number" && result.status !== 0 && shouldSkipStepFailure(step, result)) {
    console.warn(`Skipping ${formatStepLabel(command, args)}: no local Chrome/Edge executable configured.`);
    return;
  }

  if (typeof result.status === "number" && result.status !== 0) {
    process.exit(result.status);
  }

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }

  const elapsedMs = Date.now() - startedAt;
  console.log(`Completed ${formatStepLabel(command, args)} in ${(elapsedMs / 1000).toFixed(1)}s`);
}

let localServer = null;

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

  console.log("\nLocal check completed successfully.");
} finally {
  if (localServer?.serverProcess) {
    await stopLocalServer(localServer.serverProcess);
  }
}
