import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { redactProofText } from "./redact-proof-output.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli");
const MAX_OUTPUT_BYTES = 512 * 1024;
const MAX_FAILURE_OUTPUT_CHARS = 4_000;
const MAX_FAILURE_OUTPUT_LINES = 40;
const RUN_DIR_PREFIX = "lore-p1-hardening-";

const CORE_STEPS = [
  { id: "admin-session", file: "scripts/test-admin-session-security.mjs", timeoutMs: 60_000 },
  { id: "admin-auth-local-signature", file: "scripts/test-admin-auth-local-signature.mjs", timeoutMs: 30_000 },
  { id: "chat-auth-rpc-quorum", file: "scripts/test-chat-auth-rpc-quorum.mjs", timeoutMs: 60_000 },
  { id: "linea-fee-policy", file: "scripts/test-linea-fee-policy.mjs", timeoutMs: 30_000 },
  { id: "keeper-daily-budget", file: "scripts/test-keeper-daily-budget.ts", timeoutMs: 45_000 },
  { id: "runtime-tooling-guards", file: "scripts/test-runtime-tooling-guards.mjs", timeoutMs: 30_000 },
  { id: "purpose-separated-secrets", file: "scripts/test-purpose-separated-secrets.mjs", timeoutMs: 30_000 },
  { id: "health-credential-origin", file: "scripts/test-health-credential-origin.mjs", timeoutMs: 45_000 },
  { id: "live-test-wallet-config", file: "scripts/test-check-live-test-wallet-config.mjs", timeoutMs: 30_000 },
  { id: "preview-env-boundary", file: "scripts/test-v10-preview-env-boundary.mjs", timeoutMs: 30_000 },
  { id: "deposits-recovery", file: "scripts/test-deposits-recovery-safety.mjs", timeoutMs: 30_000 },
  { id: "deposits-recovery-identity", file: "scripts/test-deposits-recovery-identity.ts", timeoutMs: 30_000 },
  { id: "live-state-snapshot-provenance", file: "scripts/test-live-state-snapshot-provenance.mjs", timeoutMs: 30_000 },
  { id: "jackpot-admission", file: "scripts/test-jackpot-api-admission.ts", timeoutMs: 45_000 },
  { id: "api-recovery-admission", file: "scripts/test-api-recovery-admission.ts", timeoutMs: 45_000 },
  { id: "api-recovery-provenance", file: "scripts/test-api-recovery-provenance.ts", timeoutMs: 45_000 },
  { id: "rebate-refresh-budget", file: "scripts/test-rebate-refresh-budget.ts", timeoutMs: 45_000 },
  { id: "api-route-matrix", file: "scripts/test-api-route-matrix.ts", timeoutMs: 90_000 },
  { id: "redaction-fuzz", file: "scripts/test-redaction-fuzz.mjs", timeoutMs: 30_000 },
  { id: "data-sync-coverage", file: "scripts/test-data-sync-epoch-coverage.ts", timeoutMs: 30_000 },
  { id: "current-round-evidence", file: "scripts/test-current-round-evidence.ts", timeoutMs: 30_000 },
  { id: "bootstrap-lock", file: "scripts/test-bootstrap-resolve-lock.mjs", timeoutMs: 30_000 },
  { id: "wallet-state", file: "scripts/test-wallet-transaction-state.ts", timeoutMs: 30_000 },
  {
    id: "wallet-actions-hook",
    file: "scripts/test-wallet-actions-hook-behavior.ts",
    timeoutMs: 30_000,
    nodeArgs: ["--experimental-test-module-mocks", "--import", "tsx"],
    directNode: true,
  },
  { id: "mining-tx-recovery-identity", file: "scripts/test-mining-tx-recovery-identity.ts", timeoutMs: 30_000 },
  { id: "wallet-transfer-intent", file: "scripts/test-wallet-transfer-intent.mjs", timeoutMs: 30_000 },
  { id: "wallet-two-context", file: "scripts/test-wallet-two-context-nonce-lock.ts", timeoutMs: 45_000 },
  { id: "auto-miner-persistence", file: "scripts/test-auto-miner-persistence-security.mjs", timeoutMs: 30_000 },
  { id: "expiring-lock-cleanup", file: "scripts/test-expiring-lock-cleanup.mjs", timeoutMs: 45_000 },
  { id: "indexer-fork", file: "scripts/test-indexer-fork-recovery.ts", timeoutMs: 60_000 },
  { id: "indexer-process-restart", file: "scripts/test-indexer-process-restart.ts", timeoutMs: 45_000 },
  { id: "sqlite-scope-backup", file: "scripts/test-sqlite-operations.mjs", timeoutMs: 90_000 },
  { id: "indexer-lease", file: "scripts/test-indexer-lease-contention.ts", timeoutMs: 60_000 },
  { id: "indexer-bet-identity", file: "scripts/test-indexer-bet-identity.ts", timeoutMs: 30_000 },
  { id: "indexer-input-safety", file: "scripts/test-indexer-input-safety.ts", timeoutMs: 45_000 },
  { id: "round-presentation", file: "scripts/test-round-presentation.ts", timeoutMs: 30_000 },
  { id: "mobile-mining-action", file: "scripts/test-mobile-mining-action.ts", timeoutMs: 30_000 },
  { id: "privy-login-accessibility", file: "scripts/test-privy-login-accessibility.ts", timeoutMs: 30_000 },
  { id: "motion-dialog-accessibility", file: "scripts/test-motion-dialog-accessibility.ts", timeoutMs: 30_000 },
  { id: "soak-pid-identity", file: "scripts/test-soak-supervisor-process-identity.mjs", timeoutMs: 45_000 },
  {
    id: "performance-evidence-verifier",
    file: "scripts/verify-p1-performance-evidence.mjs",
    timeoutMs: 30_000,
    args: ["--self-test"],
  },
];

const EVM_STEP = {
  id: "v10-evm-fuzz",
  file: "scripts/test-contract-v10-evm-fuzz.mjs",
  timeoutMs: 240_000,
};

function parseArgs(argv) {
  const options = {
    includeEvm: false,
    summaryOnly: false,
    help: false,
  };
  for (const arg of argv) {
    if (arg === "--include-evm") options.includeEvm = true;
    else if (arg === "--summary-only") options.summaryOnly = true;
    else if (arg === "--help" || arg === "-h") options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function printUsage() {
  console.log([
    "Usage: node scripts/run-p1-hardening-tests.mjs [--summary-only] [--include-evm]",
    "",
    "Runs the dedicated P1 behavioral hardening suites sequentially without a shell.",
    "The offline V10 EVM fuzz suite is skipped unless --include-evm is provided.",
  ].join("\n"));
}

function resolveStepFile(step) {
  const absolutePath = resolve(REPO_ROOT, step.file);
  const relativePath = relative(REPO_ROOT, absolutePath);
  if (!relativePath || relativePath.startsWith("..") || relativePath.includes(`..${sep}`)) {
    throw new Error(`Step path escaped the repository: ${step.id}`);
  }
  if (!existsSync(absolutePath)) {
    throw new Error(`Step file is missing: ${step.file}`);
  }
  return absolutePath;
}

function assertSafeRunDirectory(runDirectory) {
  const resolvedRunDirectory = resolve(runDirectory);
  const resolvedSystemTemp = resolve(tmpdir());
  if (
    dirname(resolvedRunDirectory) !== resolvedSystemTemp ||
    !basename(resolvedRunDirectory).startsWith(RUN_DIR_PREFIX)
  ) {
    throw new Error("Refusing to clean an unexpected P1 hardening temporary directory");
  }
}

function buildChildEnvironment(dbPath) {
  const environment = {
    ...process.env,
    NODE_ENV: "test",
    LORE_DB_PATH: dbPath,
    DB_DRILL_DIR: join(dirname(dbPath), "sqlite-drill"),
    API_DEPOSITS_CHAIN_RECOVERY: "0",
    NEXT_PUBLIC_LINEA_NETWORK: "sepolia",
    LINEA_NETWORK: "sepolia",
  };

  // Dedicated suites install their own bounded fixtures when they exercise these
  // boundaries. Do not let an inherited production store or RPC credential become
  // an accidental fallback target.
  for (const key of [
    "UPSTASH_REDIS_REST_URL",
    "UPSTASH_REDIS_REST_TOKEN",
    "KEEPER_RPC_URL",
    "NEXT_PUBLIC_LINEA_RPCS",
    "RATE_LIMIT_EXTERNAL_FAIL_CLOSED",
    "WEB_REPLICA_COUNT",
  ]) {
    delete environment[key];
  }

  return environment;
}

function classifyFailure(result) {
  if (result.error?.code === "ETIMEDOUT") return "timeout";
  if (result.error?.code === "ENOBUFS") return "output-limit";
  if (result.error) return "spawn-error";
  if (result.signal) return "signal";
  return "exit";
}

function compactFailureOutput(value) {
  const redacted = redactProofText(value).trim();
  if (!redacted) return "";
  const tailLines = redacted.split(/\r?\n/).slice(-MAX_FAILURE_OUTPUT_LINES).join("\n");
  return tailLines.length > MAX_FAILURE_OUTPUT_CHARS
    ? tailLines.slice(-MAX_FAILURE_OUTPUT_CHARS)
    : tailLines;
}

function runStep(step, childEnvironment) {
  const absolutePath = resolveStepFile(step);
  const startedAt = Date.now();
  const result = spawnSync(
    process.execPath,
    [...(step.nodeArgs ?? []), ...(step.directNode ? [] : [TSX_CLI]), absolutePath, ...(step.args ?? [])],
    {
    cwd: REPO_ROOT,
    env: childEnvironment,
    encoding: "utf8",
    timeout: step.timeoutMs,
    maxBuffer: MAX_OUTPUT_BYTES,
    shell: false,
    windowsHide: true,
    killSignal: "SIGTERM",
    },
  );
  const durationMs = Date.now() - startedAt;
  const stdoutBytes = Buffer.byteLength(result.stdout ?? "", "utf8");
  const stderrBytes = Buffer.byteLength(result.stderr ?? "", "utf8");
  if (!result.error && result.status === 0) {
    return {
      ok: true,
      id: step.id,
      durationMs,
      stdoutBytes,
      stderrBytes,
    };
  }
  return {
    ok: false,
    id: step.id,
    durationMs,
    kind: classifyFailure(result),
    exitCode: result.status,
    signal: result.signal ?? null,
    stdoutBytes,
    stderrBytes,
    stdoutTail: compactFailureOutput(result.stdout),
    stderrTail: compactFailureOutput(result.stderr),
  };
}

function emitSummary(summary, summaryOnly) {
  if (summaryOnly) {
    console.log(JSON.stringify(summary));
    return;
  }
  if (summary.status === "passed") {
    console.log(
      `[p1-hardening] passed ${summary.passedSteps}/${summary.totalSteps} steps in ${summary.durationMs}ms; ` +
      `V10 EVM ${summary.evm}`,
    );
    return;
  }
  console.error(
    `[p1-hardening] failed at ${summary.failedStep ?? "cleanup"} ` +
    `(${summary.failureKind ?? "error"}) after ${summary.passedSteps}/${summary.totalSteps} steps; ` +
    `V10 EVM ${summary.evm}`,
  );
  if (summary.stdoutTail) console.error(`[p1-hardening] stdout tail:\n${summary.stdoutTail}`);
  if (summary.stderrTail) console.error(`[p1-hardening] stderr tail:\n${summary.stderrTail}`);
}

function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Invalid arguments");
    printUsage();
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    printUsage();
    return;
  }

  const steps = options.includeEvm ? [...CORE_STEPS, EVM_STEP] : CORE_STEPS;
  const startedAt = Date.now();
  const runDirectory = mkdtempSync(join(tmpdir(), RUN_DIR_PREFIX));
  const results = [];
  let failure = null;
  let cleanupFailure = null;

  try {
    for (const [index, step] of steps.entries()) {
      const dbFileName = `${String(index + 1).padStart(2, "0")}-${step.id}.sqlite`;
      const result = runStep(step, buildChildEnvironment(join(runDirectory, dbFileName)));
      results.push(result);
      if (!options.summaryOnly) {
        const state = result.ok ? "passed" : `failed:${result.kind}`;
        console.log(`[p1-hardening] ${step.id}: ${state} (${result.durationMs}ms)`);
      }
      if (!result.ok) {
        failure = result;
        break;
      }
    }
  } finally {
    try {
      assertSafeRunDirectory(runDirectory);
      rmSync(runDirectory, { recursive: true, force: true });
    } catch (error) {
      cleanupFailure = error instanceof Error ? error : new Error("Temporary cleanup failed");
    }
  }

  const passedSteps = results.filter((result) => result.ok).length;
  const summary = failure || cleanupFailure
    ? {
        status: "failed",
        totalSteps: steps.length,
        passedSteps,
        failedStep: failure?.id ?? null,
        failureKind: failure?.kind ?? "cleanup",
        exitCode: failure?.exitCode ?? null,
        signal: failure?.signal ?? null,
        stdoutBytes: failure?.stdoutBytes ?? 0,
        stderrBytes: failure?.stderrBytes ?? 0,
        ...(failure?.stdoutTail ? { stdoutTail: failure.stdoutTail } : {}),
        ...(failure?.stderrTail ? { stderrTail: failure.stderrTail } : {}),
        durationMs: Date.now() - startedAt,
        evm: options.includeEvm ? "included" : "skipped",
      }
    : {
        status: "passed",
        totalSteps: steps.length,
        passedSteps,
        durationMs: Date.now() - startedAt,
        evm: options.includeEvm ? "included" : "skipped",
        steps: results.map((result) => ({ id: result.id, durationMs: result.durationMs })),
      };

  emitSummary(summary, options.summaryOnly);
  if (summary.status !== "passed") process.exitCode = 1;
}

main();
