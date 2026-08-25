import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const IMAGE = "valkey/valkey@sha256:f0ba225266310efba5fb33383e21c64fbd07907304224786c780606e7ebd7327";
const PLATFORM = "linux/amd64";
const ARTIFACT_PATH = resolve(REPO_ROOT, "artifacts", "valkey-runtime", "valkey-lua-engine.json");
const PROTECTED_DB_PATH = resolve(REPO_ROOT, "data", "lore-v10.sqlite");
const TEMP_PREFIX = "lore-valkey-lua-runtime-";
const OWNERSHIP_LABEL = "lore.valkey.lua.run";
const PERSISTENCE_TTL_MS = 300_000;
const SOURCE_BINDING_PATHS = Object.freeze([
  "app/api/_lib/adminSession.ts",
  "app/api/_lib/externalRateLimit.ts",
  "package.json",
  "scripts/test-valkey-lua-engine.mjs",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function extractLua(source, name) {
  const match = source.match(new RegExp(`const ${name} = \\\`([\\s\\S]*?)\\\`;`));
  if (!match) throw new Error(`Could not extract ${name}.`);
  return match[1];
}

function run(command, args, { environment = {}, allowFailure = false } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: REPO_ROOT,
      env: { ...process.env, ...environment },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (status) => {
      const result = {
        status: status ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8").trim(),
        stderr: Buffer.concat(stderr).toString("utf8").trim(),
      };
      if (result.status !== 0 && !allowFailure) {
        reject(new Error(`${command} ${args[0] ?? "command"} failed (${result.status}): ${result.stderr || result.stdout}`));
        return;
      }
      resolvePromise(result);
    });
  });
}

function docker(args, options = {}) {
  return run("docker", args, options);
}

function git(args, options = {}) {
  return run("git", args, options);
}

function lines(result) {
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

function validateOwnedName(name) {
  assert.match(name, /^lore-valkey-lua-\d+-[0-9a-f]{8}-(?:primary|restore)$/);
  return name;
}

function validateOwnedTempRoot(path) {
  const resolvedTemp = resolve(tmpdir());
  const resolvedPath = resolve(path);
  assert.equal(dirname(resolvedPath), resolvedTemp);
  assert.ok(basename(resolvedPath).startsWith(TEMP_PREFIX));
  return resolvedPath;
}

async function snapshotFile(path) {
  try {
    const metadata = await stat(path, { bigint: true });
    const contents = await readFile(path);
    return {
      exists: true,
      length: metadata.size.toString(),
      mtimeNs: metadata.mtimeNs.toString(),
      sha256: sha256(contents),
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false };
    throw error;
  }
}

async function snapshotProtectedDb() {
  return {
    base: await snapshotFile(PROTECTED_DB_PATH),
    wal: await snapshotFile(`${PROTECTED_DB_PATH}-wal`),
    shm: await snapshotFile(`${PROTECTED_DB_PATH}-shm`),
  };
}

async function captureSourceProvenance() {
  const [revision, trackedStatus] = await Promise.all([
    git(["rev-parse", "HEAD"]),
    git(["status", "--porcelain=v1", "--untracked-files=no"]),
  ]);
  const files = {};
  const bindings = {};
  for (const path of SOURCE_BINDING_PATHS) {
    const [source, revisionBlob, workingTreeBlob] = await Promise.all([
      readFile(resolve(REPO_ROOT, ...path.split("/")), "utf8"),
      git(["rev-parse", `HEAD:${path}`]),
      git(["hash-object", "--", path]),
    ]);
    files[path] = source;
    bindings[path] = {
      boundToSourceRevision: revisionBlob.stdout === workingTreeBlob.stdout,
      revisionBlob: revisionBlob.stdout,
      trackedAtRevision: true,
      workingTreeBlob: workingTreeBlob.stdout,
    };
  }
  return {
    bindings,
    files,
    sourceRevisionSha: revision.stdout,
    sourceSha256: Object.fromEntries(Object.entries(files).map(([path, source]) => [path, sha256(source)])),
    trackedWorktreeStatus: trackedStatus.stdout,
  };
}

async function waitForReady(container, commandWithOptions) {
  let lastPing = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const ping = await commandWithOptions(container, ["PING"], { allowFailure: true });
    lastPing = ping;
    if (ping.status === 0 && ping.stdout === "PONG") return;
    if (attempt === 39) {
      const logs = await docker(["logs", "--tail", "20", container], { allowFailure: true });
      throw new Error(
        `Valkey did not become ready: ping=${lastPing.stderr || lastPing.stdout || "no diagnostic"}; `
        + `logs=${logs.stderr || logs.stdout || "no diagnostic"}`,
      );
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
}

async function startContainer({ appendOnly, container, dataPath, runLabel, secret }) {
  validateOwnedName(container);
  const result = await docker([
    "run", "--detach", "--name", container,
    "--label", `${OWNERSHIP_LABEL}=${runLabel}`,
    "--network", "none", "--platform", PLATFORM,
    "--user", "999:999", "--entrypoint", "valkey-server",
    "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m",
    "--mount", `type=bind,source=${dataPath},target=/data`,
    "--cap-drop", "ALL",
    "--security-opt", "no-new-privileges",
    IMAGE,
    "--dir", "/data", "--dbfilename", "dump.rdb", "--save", "",
    "--appendonly", appendOnly ? "yes" : "no",
    "--appendfsync", appendOnly ? "always" : "everysec",
    "--requirepass", secret,
  ]);
  assert.match(result.stdout, /^[0-9a-f]{64}$/);
  return result.stdout;
}

async function removeOwnedContainer(container, expectedId, runLabel) {
  const inspected = await docker(["container", "inspect", container], { allowFailure: true });
  if (inspected.status !== 0) return false;
  const record = JSON.parse(inspected.stdout)?.[0];
  assert.equal(record?.Id, expectedId, `${container} identity changed before cleanup`);
  assert.equal(record?.Config?.Labels?.[OWNERSHIP_LABEL], runLabel, `${container} ownership label changed`);
  const removed = await docker(["rm", "--force", expectedId]);
  assert.equal(removed.stdout, expectedId);
  return true;
}

async function assertNoOwnedContainers(runLabel) {
  const result = await docker([
    "ps", "--all", "--filter", `label=${OWNERSHIP_LABEL}=${runLabel}`, "--format", "{{.ID}}",
  ]);
  assert.equal(result.stdout, "", "no run-owned Valkey container may remain after cleanup");
}

async function assertPathAbsent(path) {
  const exists = await stat(path).then(() => true).catch((error) => {
    if (error?.code === "ENOENT") return false;
    throw error;
  });
  assert.equal(exists, false, `${path} must be absent after cleanup`);
}

function normalizeHash(values) {
  assert.equal(values.length % 2, 0);
  const entries = [];
  for (let index = 0; index < values.length; index += 2) entries.push([values[index], values[index + 1]]);
  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
}

async function capturePersistentState(command, { budgetKey, rateKey, sessionKey }) {
  const [rateValue, rateExpiry, budgetValue, budgetExpiry, sessionValue, sessionExpiry] = await Promise.all([
    command("GET", rateKey),
    command("PEXPIRETIME", rateKey),
    command("HGETALL", budgetKey),
    command("PEXPIRETIME", budgetKey),
    command("GET", sessionKey),
    command("PEXPIRETIME", sessionKey),
  ]);
  const state = {
    budget: normalizeHash(lines(budgetValue)),
    budgetExpiresAt: Number(lines(budgetExpiry)[0]),
    rate: lines(rateValue)[0],
    rateExpiresAt: Number(lines(rateExpiry)[0]),
    session: lines(sessionValue)[0],
    sessionExpiresAt: Number(lines(sessionExpiry)[0]),
  };
  assert.equal(state.rate, "3");
  assert.equal(state.session, "next");
  assert.ok(Number.isSafeInteger(state.rateExpiresAt) && state.rateExpiresAt > Date.now());
  assert.ok(Number.isSafeInteger(state.sessionExpiresAt) && state.sessionExpiresAt > Date.now());
  assert.ok(Number.isSafeInteger(state.budgetExpiresAt) && state.budgetExpiresAt > Date.now());
  return state;
}

async function main() {
  const protectedDbBefore = await snapshotProtectedDb();
  assert.equal(protectedDbBefore.base.exists, true, "protected SQLite base must exist before Valkey testing");
  const sourceProvenanceAtStartup = await captureSourceProvenance();
  const rateLimitSource = sourceProvenanceAtStartup.files["app/api/_lib/externalRateLimit.ts"];
  const sessionSource = sourceProvenanceAtStartup.files["app/api/_lib/adminSession.ts"];
  const rateLimitScript = extractLua(rateLimitSource, "RATE_LIMIT_SCRIPT");
  const keeperBudgetScript = extractLua(rateLimitSource, "KEEPER_DAILY_BUDGET_SCRIPT");
  const rotateSessionScript = extractLua(sessionSource, "ROTATE_SESSION_SCRIPT");
  const secret = randomBytes(32).toString("hex");
  const suffix = `${process.pid}-${randomBytes(4).toString("hex")}`;
  const runLabel = suffix;
  const primaryContainer = validateOwnedName(`lore-valkey-lua-${suffix}-primary`);
  const restoreContainer = validateOwnedName(`lore-valkey-lua-${suffix}-restore`);
  const tempRoot = validateOwnedTempRoot(await mkdtemp(join(tmpdir(), TEMP_PREFIX)));
  const primaryDataPath = join(tempRoot, "primary-data");
  const backupPath = join(tempRoot, "backup", "dump.rdb");
  const restoreDataPath = join(tempRoot, "restore-data");
  await Promise.all([
    mkdir(primaryDataPath, { recursive: false }),
    mkdir(dirname(backupPath), { recursive: false }),
    mkdir(restoreDataPath, { recursive: false }),
  ]);
  const createdContainers = new Map();
  const activeContainers = new Set();
  let activeContainer = primaryContainer;
  let artifact = null;
  let mainError = null;
  let cleanupVerified = false;
  const commandWithOptions = (container, args, options = {}) => docker(
    ["exec", "--env", `REDISCLI_AUTH=${secret}`, container, "valkey-cli", "--raw", "--no-auth-warning", ...args],
    options,
  );
  const command = (...args) => commandWithOptions(activeContainer, args);
  const evalScript = async (script, key, args) => lines(await command("EVAL", script, "1", key, ...args));

  try {
    const primaryId = await startContainer({
      appendOnly: true,
      container: primaryContainer,
      dataPath: primaryDataPath,
      runLabel,
      secret,
    });
    createdContainers.set(primaryContainer, primaryId);
    activeContainers.add(primaryContainer);
    await waitForReady(primaryContainer, commandWithOptions);
    const persistenceConfig = normalizeHash(lines(await command("CONFIG", "GET", "appendonly", "appendfsync")));
    assert.deepEqual(persistenceConfig, { appendfsync: "always", appendonly: "yes" });

    const rateKey = "lore:test:rate";
    const rateFirst = await evalScript(rateLimitScript, rateKey, [String(PERSISTENCE_TTL_MS)]);
    const rateSecond = await evalScript(rateLimitScript, rateKey, [String(PERSISTENCE_TTL_MS)]);
    const rateThird = await evalScript(rateLimitScript, rateKey, [String(PERSISTENCE_TTL_MS)]);
    assert.equal(rateFirst[0], "1");
    assert.equal(rateSecond[0], "2");
    assert.equal(rateThird[0], "3");
    assert.ok(Number(rateFirst[1]) > 0 && Number(rateFirst[1]) <= PERSISTENCE_TTL_MS);
    assert.ok(Number(rateSecond[1]) > 0 && Number(rateSecond[1]) <= Number(rateFirst[1]));

    const budgetKey = "lore:test:keeper";
    const budgetFirst = await evalScript(keeperBudgetScript, budgetKey, ["r:one", "fingerprint-one", "2", "3", "10"]);
    const budgetReplay = await evalScript(keeperBudgetScript, budgetKey, ["r:one", "fingerprint-one", "2", "3", "10"]);
    const budgetConflict = await evalScript(keeperBudgetScript, budgetKey, ["r:one", "fingerprint-conflict", "2", "3", "10"]);
    const budgetSecond = await evalScript(keeperBudgetScript, budgetKey, ["r:two", "fingerprint-two", "2", "3", "10"]);
    const budgetExhausted = await evalScript(keeperBudgetScript, budgetKey, ["r:three", "fingerprint-three", "2", "3", "10"]);
    assert.deepEqual(budgetFirst.slice(0, 1), ["reserved"]);
    assert.deepEqual(budgetReplay.slice(0, 1), ["already_reserved"]);
    assert.deepEqual(budgetConflict, ["reservation_conflict"]);
    assert.deepEqual(budgetSecond.slice(0, 1), ["reserved"]);
    assert.deepEqual(budgetExhausted, ["signature_exhausted"]);
    const malformedBudgetKey = "lore:test:keeper:malformed";
    const day = budgetFirst[1];
    await command("HSET", malformedBudgetKey, "__day", day, "__count", "not-a-number", "__cost", "0");
    const budgetMalformed = await evalScript(
      keeperBudgetScript,
      malformedBudgetKey,
      ["r:four", "fingerprint-four", "2", "3", "10"],
    );
    assert.deepEqual(budgetMalformed, ["invalid_state"]);

    const sessionKey = "lore:test:session";
    await command("SET", sessionKey, "current");
    const sessionRotated = await evalScript(
      rotateSessionScript,
      sessionKey,
      ["current", "next", String(PERSISTENCE_TTL_MS)],
    );
    const sessionReplay = await evalScript(
      rotateSessionScript,
      sessionKey,
      ["current", "third", String(PERSISTENCE_TTL_MS)],
    );
    const sessionCurrent = lines(await command("GET", sessionKey));
    assert.deepEqual(sessionRotated, ["1"]);
    assert.deepEqual(sessionReplay, ["0"]);
    assert.deepEqual(sessionCurrent, ["next"]);

    const expectedState = await capturePersistentState(command, { budgetKey, rateKey, sessionKey });
    const restarted = await docker(["restart", primaryContainer]);
    assert.equal(restarted.stdout, primaryContainer);
    await waitForReady(primaryContainer, commandWithOptions);
    assert.deepEqual(
      normalizeHash(lines(await command("CONFIG", "GET", "appendonly", "appendfsync"))),
      persistenceConfig,
      "AOF configuration must remain exact after restart",
    );
    const restartState = await capturePersistentState(command, { budgetKey, rateKey, sessionKey });
    assert.deepEqual(restartState, expectedState, "AOF restart must preserve values and absolute expiries");

    const saved = await command("SAVE");
    assert.deepEqual(lines(saved), ["OK"]);
    const primaryRdbPath = join(primaryDataPath, "dump.rdb");
    const primaryRdb = await readFile(primaryRdbPath);
    assert.ok(primaryRdb.byteLength > 0, "SAVE must create a non-empty RDB snapshot");
    await copyFile(primaryRdbPath, backupPath);
    const backupRdb = await readFile(backupPath);
    assert.equal(sha256(backupRdb), sha256(primaryRdb), "backup copy must match the saved RDB byte-for-byte");

    await command("SET", rateKey, "999", "PX", String(PERSISTENCE_TTL_MS));
    await command("HSET", budgetKey, "__count", "99");
    await command("DEL", sessionKey);
    assert.equal(lines(await command("GET", rateKey))[0], "999");
    assert.equal(lines(await command("HGET", budgetKey, "__count"))[0], "99");
    assert.equal(lines(await command("EXISTS", sessionKey))[0], "0");

    assert.equal(
      await removeOwnedContainer(primaryContainer, primaryId, runLabel),
      true,
      "primary container must be removed before restore",
    );
    activeContainers.delete(primaryContainer);
    await copyFile(backupPath, join(restoreDataPath, "dump.rdb"));
    const restoreId = await startContainer({
      appendOnly: false,
      container: restoreContainer,
      dataPath: restoreDataPath,
      runLabel,
      secret,
    });
    createdContainers.set(restoreContainer, restoreId);
    activeContainers.add(restoreContainer);
    activeContainer = restoreContainer;
    await waitForReady(restoreContainer, commandWithOptions);
    const restoredState = await capturePersistentState(command, { budgetKey, rateKey, sessionKey });
    assert.deepEqual(restoredState, expectedState, "RDB restore must recover the pre-mutation values and deadlines");

    const info = lines(await command("INFO", "server"));
    const valkeyVersion = info.find((line) => line.startsWith("valkey_version:"))?.slice("valkey_version:".length) ?? "unknown";
    assert.equal(valkeyVersion, "8.1.9");
    const sourceProvenanceBeforeCleanup = await captureSourceProvenance();
    assert.deepEqual(
      sourceProvenanceBeforeCleanup,
      sourceProvenanceAtStartup,
      "HEAD, tracked status, and relevant source blobs must remain stable through execution",
    );
    const sourceBindings = sourceProvenanceAtStartup.bindings;
    artifact = {
      status: "partial",
      scope: "direct-lua-engine-persistence-restore",
      sourceRevisionSha: sourceProvenanceAtStartup.sourceRevisionSha,
      sourceBinding: {
        allRelevantFilesBoundToRevision: Object.values(sourceBindings).every((binding) => binding.boundToSourceRevision),
        files: sourceBindings,
        stableAcrossExecution: true,
        trackedWorktreeClean: sourceProvenanceAtStartup.trackedWorktreeStatus === "",
      },
      image: IMAGE,
      containerPlatform: PLATFORM,
      hostNode: {
        architecture: process.arch,
        platform: process.platform,
        version: process.version,
      },
      valkeyVersion,
      sourceSha256: {
        adminSession: sourceProvenanceAtStartup.sourceSha256["app/api/_lib/adminSession.ts"],
        externalRateLimit: sourceProvenanceAtStartup.sourceSha256["app/api/_lib/externalRateLimit.ts"],
        testHarness: sourceProvenanceAtStartup.sourceSha256["scripts/test-valkey-lua-engine.mjs"],
      },
      scriptSha256: {
        rateLimit: sha256(rateLimitScript),
        keeperDailyBudget: sha256(keeperBudgetScript),
        rotateSession: sha256(rotateSessionScript),
      },
      backup: {
        bytes: backupRdb.byteLength,
        format: "RDB",
        sha256: sha256(backupRdb),
      },
      checks: {
        aofConfigurationExact: true,
        aofRestartPreservedValuesAndAbsoluteExpiries: true,
        backupCopyByteExact: true,
        keeperReservationReplayConflictCapAndMalformedState: true,
        rateLimitGlobalIncrementAndTtl: true,
        rdbRestoreRecoveredPreMutationSnapshot: true,
        rotateSessionAtomicAndStaleRotationRejected: true,
      },
      missing: [
        "authenticated public HTTPS REST facade (covered separately by the local parity artifact)",
        "deployed provider-managed persistence and externally retained backup",
        "deployed web replicas plus indexer/bot/monitor restore rehearsal",
        "external relational database backup/restore evidence",
      ],
    };
  } catch (error) {
    mainError = error;
  } finally {
    const cleanupFailures = [];
    for (const container of [...activeContainers].reverse()) {
      try {
        assert.equal(
          await removeOwnedContainer(container, createdContainers.get(container), runLabel),
          true,
          `${container} must exist with its original identity at cleanup`,
        );
        activeContainers.delete(container);
      } catch (error) {
        cleanupFailures.push(error);
      }
    }
    try {
      await assertNoOwnedContainers(runLabel);
    } catch (error) {
      cleanupFailures.push(error);
    }
    try {
      await rm(validateOwnedTempRoot(tempRoot), { force: true, recursive: true });
      await assertPathAbsent(tempRoot);
    } catch (error) {
      cleanupFailures.push(error);
    }
    try {
      assert.deepEqual(await snapshotProtectedDb(), protectedDbBefore, "protected SQLite base/WAL/SHM identity must not change");
    } catch (error) {
      cleanupFailures.push(error);
    }
    if (cleanupFailures.length > 0) {
      if (mainError) cleanupFailures.unshift(mainError);
      throw new AggregateError(cleanupFailures, "Valkey persistence/restore cleanup failed");
    }
    cleanupVerified = true;
  }

  if (mainError) throw mainError;
  assert.ok(artifact, "Valkey persistence/restore evidence must exist after a successful run");
  assert.equal(cleanupVerified, true, "exact cleanup must succeed before artifact publication");
  const sourceProvenanceAfterCleanup = await captureSourceProvenance();
  assert.deepEqual(
    sourceProvenanceAfterCleanup,
    sourceProvenanceAtStartup,
    "HEAD, tracked status, and relevant source blobs must remain stable through cleanup",
  );
  artifact.sourceBinding.stableThroughCleanup = true;
  artifact.checks.exactOwnedCleanup = true;
  artifact.checks.protectedDbUnchanged = true;
  await mkdir(dirname(ARTIFACT_PATH), { recursive: true });
  await writeFile(ARTIFACT_PATH, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(artifact));
}

await main();
