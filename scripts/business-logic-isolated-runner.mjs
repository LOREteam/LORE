import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const PROTECTED_DB_RELATIVE_PATHS = Object.freeze([
  "data/lore-v10.sqlite",
  "data/lore-v10.sqlite-wal",
  "data/lore-v10.sqlite-shm",
]);
const TEMP_PREFIX = "lore-business-logic-";

function sameOrInside(candidate, root) {
  const relativePath = relative(root, candidate);
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
}

function samePath(left, right) {
  return sameOrInside(left, right) && sameOrInside(right, left);
}

function directoryIdentity(stats) {
  return {
    device: String(stats.dev),
    inode: String(stats.ino),
    birthtimeMs: String(stats.birthtimeMs),
  };
}

function sameDirectoryIdentity(left, right) {
  return left.device === right.device
    && left.inode === right.inode
    && left.birthtimeMs === right.birthtimeMs;
}

function captureOrdinaryDirectory(directoryPath, label, fsApi) {
  const requestedPath = resolve(directoryPath);
  const stats = fsApi.lstatSync(requestedPath);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`${label} must be an ordinary non-reparse directory`);
  }
  const canonicalPath = resolve(fsApi.realpathSync(requestedPath));
  if (!samePath(requestedPath, canonicalPath)) {
    throw new Error(`${label} must not traverse a symlink, junction, or reparse point`);
  }
  return {
    path: requestedPath,
    canonicalPath,
    identity: directoryIdentity(stats),
  };
}

function snapshotFile(filePath, fsApi) {
  if (!fsApi.existsSync(filePath)) return null;
  const stats = fsApi.lstatSync(filePath);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error("protected SQLite snapshot path must be a regular non-reparse file");
  }
  return {
    bytes: stats.size,
    mtimeMs: stats.mtimeMs,
    sha256: createHash("sha256").update(fsApi.readFileSync(filePath)).digest("hex"),
  };
}

export function snapshotProtectedBusinessLogicDatabase({ cwd = process.cwd(), fsApi = { existsSync, lstatSync, readFileSync } } = {}) {
  const projectRoot = resolve(cwd);
  return Object.fromEntries(
    PROTECTED_DB_RELATIVE_PATHS.map((relativePath) => [
      relativePath,
      snapshotFile(join(projectRoot, relativePath), fsApi),
    ]),
  );
}

export function protectedBusinessLogicDatabaseChanged(before, after) {
  return JSON.stringify(before) !== JSON.stringify(after);
}

export function createBusinessLogicChildEnvironment({ env = process.env, dbPath }) {
  if (typeof dbPath !== "string" || !isAbsolute(dbPath)) {
    throw new Error("business logic child requires an absolute isolated LORE_DB_PATH");
  }
  const childEnv = { ...env };
  const removedKeys = new Set([
    "lore_allow_contract_scope_purge",
    "lore_db_path",
    "lore_hermetic_build",
    "lore_hermetic_build_db_root",
  ]);
  for (const name of Object.keys(childEnv)) {
    if (removedKeys.has(name.toLowerCase())) delete childEnv[name];
  }
  childEnv.LORE_ALLOW_CONTRACT_SCOPE_PURGE = "0";
  childEnv.LORE_DB_PATH = dbPath;
  return childEnv;
}

function validateOwnedBusinessLogicTempRoot(tempRoot, {
  cwd = process.cwd(),
  temporaryDirectory = tmpdir(),
  expectedIdentity,
  expectedTemporaryIdentity,
  canonicalProjectRoot,
  canonicalProtectedDataRoot,
  fsApi = { lstatSync, realpathSync },
} = {}) {
  const projectRoot = canonicalProjectRoot ?? resolve(fsApi.realpathSync(resolve(cwd)));
  // `data/` is intentionally ignored and may be absent in a fresh checkout.
  // The temp root is already required to sit outside the canonical repository,
  // so its lexical child path is sufficient for the additional containment
  // check without manufacturing or opening runtime storage.
  const protectedDataRoot = canonicalProtectedDataRoot ?? resolve(join(projectRoot, "data"));
  const systemTemp = captureOrdinaryDirectory(temporaryDirectory, "business logic OS-temp parent", fsApi);
  if (expectedTemporaryIdentity && !sameDirectoryIdentity(systemTemp.identity, expectedTemporaryIdentity)) {
    throw new Error("refusing to use or clean through a replaced business logic OS-temp parent");
  }
  const requestedRoot = resolve(tempRoot);
  if (
    !sameOrInside(requestedRoot, systemTemp.canonicalPath)
    || dirname(requestedRoot) !== systemTemp.canonicalPath
    || !basename(requestedRoot).startsWith(TEMP_PREFIX)
  ) {
    throw new Error("business logic temporary SQLite root is not an owned OS-temp directory");
  }
  const ownedRoot = captureOrdinaryDirectory(requestedRoot, "business logic temporary SQLite root", fsApi);
  if (sameOrInside(ownedRoot.canonicalPath, projectRoot) || sameOrInside(ownedRoot.canonicalPath, protectedDataRoot)) {
    throw new Error("business logic temporary SQLite root must stay outside the repository and protected data directory");
  }
  if (expectedIdentity && !sameDirectoryIdentity(ownedRoot.identity, expectedIdentity)) {
    throw new Error("refusing to use or clean a replaced business logic temporary SQLite root");
  }
  return ownedRoot;
}

export function assertOwnedBusinessLogicTempRoot(tempRoot, options = {}) {
  return validateOwnedBusinessLogicTempRoot(tempRoot, options).canonicalPath;
}

function isolationFailureResult(result, before, after) {
  const priorStderr = String(result?.stderr ?? "");
  return {
    ...result,
    status: 1,
    error: new Error("business logic child modified protected SQLite files"),
    businessLogicDbIsolationViolation: true,
    stderr: `${priorStderr}${priorStderr.endsWith("\n") || priorStderr === "" ? "" : "\n"}[business-logic-db-isolation] protected SQLite snapshot changed\n`,
    protectedDatabaseBefore: before,
    protectedDatabaseAfter: after,
  };
}

export function businessLogicChildExitCode(result) {
  return result?.status === 0 && result?.signal == null && result?.error == null ? 0 : 1;
}

export function runIsolatedBusinessLogicChild({
  args,
  cwd = process.cwd(),
  env = process.env,
  processExecPath = process.execPath,
  encoding = "utf8",
  maxBuffer,
  timeout,
  windowsHide = true,
  spawnSyncFn = spawnSync,
  temporaryDirectory = tmpdir(),
  fsApi = { existsSync, lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync },
} = {}) {
  if (!Array.isArray(args) || args.length === 0) throw new Error("business logic child command is required");
  const projectRoot = resolve(fsApi.realpathSync(resolve(cwd)));
  const protectedDataRoot = resolve(join(projectRoot, "data"));
  const temporaryRoot = captureOrdinaryDirectory(temporaryDirectory, "business logic OS-temp parent", fsApi);
  if (sameOrInside(temporaryRoot.canonicalPath, projectRoot)) {
    throw new Error("business logic OS-temp parent must stay outside the repository");
  }
  const createdRoot = fsApi.mkdtempSync(join(temporaryRoot.canonicalPath, TEMP_PREFIX));
  let ownedRoot;
  let result;
  let before;
  let spawnError;
  try {
    ownedRoot = validateOwnedBusinessLogicTempRoot(createdRoot, {
      cwd: projectRoot,
      temporaryDirectory: temporaryRoot.canonicalPath,
      expectedTemporaryIdentity: temporaryRoot.identity,
      canonicalProjectRoot: projectRoot,
      canonicalProtectedDataRoot: protectedDataRoot,
      fsApi,
    });
    const dbPath = join(ownedRoot.canonicalPath, "lore.sqlite");
    before = snapshotProtectedBusinessLogicDatabase({ cwd: projectRoot, fsApi });
    validateOwnedBusinessLogicTempRoot(ownedRoot.canonicalPath, {
      cwd: projectRoot,
      temporaryDirectory: temporaryRoot.canonicalPath,
      expectedIdentity: ownedRoot.identity,
      expectedTemporaryIdentity: temporaryRoot.identity,
      canonicalProjectRoot: projectRoot,
      canonicalProtectedDataRoot: protectedDataRoot,
      fsApi,
    });
    try {
      result = spawnSyncFn(processExecPath, args, {
        cwd: projectRoot,
        env: createBusinessLogicChildEnvironment({ env, dbPath }),
        encoding,
        ...(maxBuffer === undefined ? {} : { maxBuffer }),
        ...(timeout === undefined ? {} : { timeout }),
        windowsHide,
      });
    } catch (error) {
      spawnError = error;
    }
    const after = snapshotProtectedBusinessLogicDatabase({ cwd: projectRoot, fsApi });
    if (protectedBusinessLogicDatabaseChanged(before, after)) {
      return isolationFailureResult(result ?? { status: null, stdout: "", stderr: "", error: spawnError }, before, after);
    }
    if (spawnError) throw spawnError;
    return result;
  } finally {
    if (ownedRoot) {
      validateOwnedBusinessLogicTempRoot(ownedRoot.canonicalPath, {
        cwd: projectRoot,
        temporaryDirectory: temporaryRoot.canonicalPath,
        expectedIdentity: ownedRoot.identity,
        expectedTemporaryIdentity: temporaryRoot.identity,
        canonicalProjectRoot: projectRoot,
        canonicalProtectedDataRoot: protectedDataRoot,
        fsApi,
      });
      fsApi.rmSync(ownedRoot.canonicalPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 });
    }
  }
}

function isDirectRun() {
  return Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  const result = runIsolatedBusinessLogicChild({
    args: [resolve("node_modules/tsx/dist/cli.mjs"), "scripts/test-business-logic.mjs"],
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(String(result.stdout));
  if (result.stderr) process.stderr.write(String(result.stderr));
  process.exitCode = businessLogicChildExitCode(result);
}
