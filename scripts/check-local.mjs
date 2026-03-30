import { spawnSync } from "node:child_process";

const npmCommand = process.env.npm_execpath && process.execPath
  ? process.execPath
  : process.platform === "win32"
    ? "npm.cmd"
    : "npm";
const steps = [
  { command: npmCommand, args: ["run", "lint"] },
  { command: npmCommand, args: ["run", "build"] },
  { command: npmCommand, args: ["run", "typecheck"], retryOnce: true },
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
];
const FILTERED_WARNING_PATTERNS = [
  /ExperimentalWarning: SQLite is an experimental feature/i,
  /Using edge runtime on a page currently disables static generation/i,
  /\(Use `node --trace-warnings .*` to show where the warning was created\)/i,
];

function formatStepLabel(command, args) {
  if (process.env.npm_execpath && process.execPath) {
    return `npm ${args.join(" ")}`;
  }
  return `${command} ${args.join(" ")}`;
}

function runStep(step) {
  const { command, args, env } = step;
  if (process.env.npm_execpath && process.execPath) {
    return spawnSync(command, [process.env.npm_execpath, ...args], {
      stdio: "pipe",
      encoding: "utf8",
      env: { ...process.env, ...(env ?? {}) },
    });
  }

  return spawnSync(command, args, {
    stdio: "pipe",
    encoding: "utf8",
    env: { ...process.env, ...(env ?? {}) },
  });
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

for (const step of steps) {
  const { command, args, retryOnce } = step;
  const startedAt = Date.now();
  console.log(`\n> ${formatStepLabel(command, args)}`);
  let result = runStep(step);
  flushStepOutput(result);

  if (retryOnce && typeof result.status === "number" && result.status !== 0) {
    console.warn(`Retrying ${formatStepLabel(command, args)} once after initial failure...`);
    result = runStep(step);
    flushStepOutput(result);
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

console.log("\nLocal check completed successfully.");
