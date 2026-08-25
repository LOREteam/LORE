import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const THIS_FILE = fileURLToPath(import.meta.url);
const REPO_ROOT = dirname(dirname(THIS_FILE));
const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli");
const MAX_CHILD_OUTPUT_BYTES = 512 * 1024;
const CHILD_TIMEOUT_MS = 180_000;
const PROTECTED_DB_PATH = join(REPO_ROOT, "data", "lore-v10.sqlite");
const EVIDENCE_ROOT = join(REPO_ROOT, "artifacts", "runtime-topology");
const REQUIRE_CLEAN = process.argv.includes("--require-clean");
const SOURCE_BINDING_PATHS = Object.freeze([
  ".gitignore",
  "app/api/_lib/externalRateLimit.ts",
  "bot.ts",
  "package.json",
  "scripts/indexer.ts",
  "scripts/monitor-runtime-health.mjs",
  "scripts/test-indexer-lease-contention.ts",
  "scripts/test-indexer-process-restart.ts",
  "scripts/test-keeper-daily-budget.ts",
  "scripts/test-runtime-monitor-drill.mjs",
  "scripts/test-runtime-role-topology.mjs",
  "server/storage.ts",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function runGit(args, { allowFailure = false } = {}) {
  const result = spawnSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
    windowsHide: true,
  });
  if (!allowFailure) {
    assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr?.trim() || "unknown error"}`);
  }
  return result;
}

function captureSourceProvenance() {
  const sourceRevisionSha = runGit(["rev-parse", "HEAD"]).stdout.trim();
  const trackedWorktreeStatus = runGit(["status", "--porcelain=v1", "--untracked-files=no"]).stdout.trim();
  const files = Object.fromEntries(SOURCE_BINDING_PATHS.map((path) => {
    const absolutePath = join(REPO_ROOT, path);
    const workingTreeContent = readFileSync(absolutePath);
    const workingTreeBlob = runGit(["hash-object", "--", path]).stdout.trim();
    const revisionResult = runGit(["rev-parse", `${sourceRevisionSha}:${path}`], { allowFailure: true });
    const revisionBlob = revisionResult.stdout.trim();
    const trackedAtRevision = revisionResult.status === 0 && /^[0-9a-f]{40,64}$/.test(revisionBlob);
    return [path, {
      boundToSourceRevision: trackedAtRevision && revisionBlob === workingTreeBlob,
      revisionBlob: trackedAtRevision ? revisionBlob : null,
      sha256: sha256(workingTreeContent),
      trackedAtRevision,
      workingTreeBlob,
    }];
  }));
  return {
    allRelevantFilesBoundToRevision: Object.values(files).every((file) => file.boundToSourceRevision),
    files,
    sourceRevisionSha,
    trackedWorktreeClean: trackedWorktreeStatus === "",
    trackedWorktreeStatus,
  };
}

function captureFileIdentity(path) {
  if (!existsSync(path)) return { exists: false };
  const stat = lstatSync(path);
  assert.equal(stat.isFile(), true, `protected path must remain a file: ${path}`);
  const content = readFileSync(path);
  return {
    exists: true,
    mtimeUtc: stat.mtime.toISOString(),
    sha256: sha256(content),
    size: stat.size,
  };
}

function captureProtectedDbIdentity() {
  return {
    base: captureFileIdentity(PROTECTED_DB_PATH),
    shm: captureFileIdentity(`${PROTECTED_DB_PATH}-shm`),
    wal: captureFileIdentity(`${PROTECTED_DB_PATH}-wal`),
  };
}

function boundedAppend(current, chunk, label) {
  const next = `${current}${chunk.toString()}`;
  assert.ok(Buffer.byteLength(next) <= MAX_CHILD_OUTPUT_BYTES, `${label} exceeded the bounded output limit`);
  return next;
}

function buildIsolatedEnv(emptyDotenvPath) {
  const env = {};
  for (const name of [
    "ComSpec",
    "LOCALAPPDATA",
    "NUMBER_OF_PROCESSORS",
    "OS",
    "Path",
    "PATH",
    "PATHEXT",
    "PROCESSOR_ARCHITECTURE",
    "SystemDrive",
    "SystemRoot",
    "TEMP",
    "TMP",
    "TMPDIR",
    "WINDIR",
  ]) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  return {
    ...env,
    CI: "1",
    DOTENV_CONFIG_PATH: emptyDotenvPath,
    DOTENV_CONFIG_QUIET: "true",
    NODE_ENV: "test",
    NODE_NO_WARNINGS: "1",
    NO_COLOR: "1",
  };
}

function parseSummary(stdout, role) {
  const lines = stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  assert.equal(lines.length, 1, `${role} must emit exactly one JSON summary line`);
  const summary = JSON.parse(lines[0]);
  assert.equal(summary?.status, "pass", `${role} summary must pass`);
  return summary;
}

function runRole(role, args, env) {
  return new Promise((resolveRole, rejectRole) => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, args, {
      cwd: REPO_ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      rejectRole(new Error(`${role} exceeded ${CHILD_TIMEOUT_MS}ms`));
    }, CHILD_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      stdout = boundedAppend(stdout, chunk, `${role} stdout`);
    });
    child.stderr.on("data", (chunk) => {
      stderr = boundedAppend(stderr, chunk, `${role} stderr`);
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectRole(error);
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        assert.equal(signal, null, `${role} must exit without a signal`);
        assert.equal(code, 0, `${role} failed: ${stderr.trim() || stdout.trim() || "no output"}`);
        assert.equal(stderr.trim(), "", `${role} emitted unexpected stderr`);
        resolveRole({
          durationMs: Date.now() - startedAt,
          exitCode: code,
          summary: parseSummary(stdout, role),
        });
      } catch (error) {
        rejectRole(error);
      }
    });
  });
}

function parseEvidencePath() {
  const index = process.argv.indexOf("--evidence");
  if (index === -1) return null;
  const value = process.argv[index + 1];
  assert.ok(value && !value.startsWith("--"), "--evidence requires a path");
  const target = resolve(REPO_ROOT, value);
  const relativeTarget = relative(EVIDENCE_ROOT, target);
  assert.ok(
    relativeTarget !== "" && !relativeTarget.startsWith("..") && !isAbsolute(relativeTarget),
    "evidence path must be a file below artifacts/runtime-topology",
  );
  return target;
}

async function main() {
  const evidencePath = parseEvidencePath();
  const tempRoot = mkdtempSync(join(tmpdir(), "lore-runtime-role-topology-"));
  const emptyDotenvPath = join(tempRoot, "empty.env");
  writeFileSync(emptyDotenvPath, "", { encoding: "utf8", flag: "wx" });
  const provenanceBefore = captureSourceProvenance();
  const protectedDbBefore = captureProtectedDbIdentity();
  if (REQUIRE_CLEAN) {
    assert.equal(provenanceBefore.trackedWorktreeClean, true, "relevant tracked worktree must be clean");
    assert.equal(
      provenanceBefore.allRelevantFilesBoundToRevision,
      true,
      "all relevant sources must be bound to the current revision",
    );
  }

  try {
    const isolatedEnv = {
      ...buildIsolatedEnv(emptyDotenvPath),
      MONITOR_DRILL_DIR: join(tempRoot, "monitor-drill"),
    };
    const indexerLease = await runRole(
      "indexer shared-lease process test",
      [TSX_CLI, join(REPO_ROOT, "scripts", "test-indexer-lease-contention.ts")],
      isolatedEnv,
    );
    const indexerRestart = await runRole(
      "indexer crash/restart process test",
      [TSX_CLI, join(REPO_ROOT, "scripts", "test-indexer-process-restart.ts")],
      isolatedEnv,
    );
    const keeper = await runRole(
      "keeper shared-budget process test",
      [TSX_CLI, join(REPO_ROOT, "scripts", "test-keeper-daily-budget.ts")],
      isolatedEnv,
    );
    const monitor = await runRole(
      "runtime monitor process drill",
      [join(REPO_ROOT, "scripts", "test-runtime-monitor-drill.mjs")],
      isolatedEnv,
    );

    assert.equal(indexerLease.summary.independentConnections, 2);
    assert.equal(indexerLease.summary.runFailClosed, true);
    assert.equal(indexerLease.summary.watchFailClosed, true);
    assert.equal(indexerLease.summary.crashExpiryRecovery, true);
    assert.equal(indexerRestart.summary.entrypoint, "scripts/indexer.ts");
    assert.equal(indexerRestart.summary.rpcProviders, 2);
    assert.equal(indexerRestart.summary.indexedRows, 2);
    assert.equal(indexerRestart.summary.unfinalizedRows, 0);
    assert.equal(indexerRestart.summary.forkRows, 0);
    assert.equal(keeper.summary.reservationBeforeSigning, true);
    assert.equal(keeper.summary.restartPersistence, true);
    assert.equal(keeper.summary.replicaAtomicity, true);
    assert.equal(keeper.summary.externalReplicaAtomicity, true);
    assert.equal(monitor.summary.duplicateAlertsAfterRestart, 0);
    assert.equal(monitor.summary.repoLocalBackupDirRejected, true);
    assert.equal(monitor.summary.stateCleared, true);

    const protectedDbAfter = captureProtectedDbIdentity();
    assert.deepEqual(protectedDbAfter, protectedDbBefore, "protected DB base/WAL/SHM identity must remain unchanged");
    const provenanceAfter = captureSourceProvenance();
    assert.deepEqual(provenanceAfter, provenanceBefore, "source provenance must remain stable during the role tests");

    const evidence = {
      boundaries: {
        botEntrypointStarted: false,
        deployedProcessesProved: false,
        externalNetworkEndpointConfiguredByHarness: false,
        liveMonitorPollingStarted: false,
        loopbackRpcFixtureStarted: true,
        signingMaterialLoadedByHarness: false,
        walletOrTransactionAction: false,
      },
      claimScope: "local-runtime-role-wiring-partial",
      node: {
        arch: process.arch,
        execPath: process.execPath,
        platform: process.platform,
        version: process.version,
      },
      protectedDb: {
        after: protectedDbAfter,
        before: protectedDbBefore,
        unchanged: true,
      },
      roles: {
        indexer: {
          actualEntrypointContendedBeforeRpc: true,
          crashRestart: indexerRestart,
          leaseContention: indexerLease,
          loopbackRpcFixtureOnly: true,
        },
        keeper: {
          ...keeper,
          productionStorageBudgetSeamUsed: true,
          signerProcessIntentionallyNotStarted: true,
        },
        monitor: {
          ...monitor,
          actualEntrypointSummaryPreflightUsed: true,
          livePollingIntentionallyNotStarted: true,
        },
      },
      schemaVersion: 1,
      sourceBinding: provenanceBefore,
      status: "pass",
      tempCleanup: {
        ownedRoot: tempRoot,
        removed: false,
      },
      unproved: [
        "deployed web/indexer/bot/monitor processes",
        "provider-managed Valkey durability and cross-host behavior",
        "external relational database restore",
        "live monitor polling and alert delivery",
        "wallet, signing, RPC, Preview, or chain behavior",
      ],
    };

    rmSync(tempRoot, { force: true, recursive: true });
    assert.equal(existsSync(tempRoot), false, "owned topology temp root must be removed");
    evidence.tempCleanup.removed = true;
    if (evidencePath) {
      mkdirSync(dirname(evidencePath), { recursive: true });
      writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, { encoding: "utf8" });
    }
    process.stdout.write(`${JSON.stringify(evidence)}\n`);
  } finally {
    if (existsSync(tempRoot)) rmSync(tempRoot, { force: true, recursive: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});
