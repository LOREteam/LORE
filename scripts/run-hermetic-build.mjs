import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  basename,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";

const PROTECTED_DATABASE_RELATIVE_PATHS = [
  join("data", "lore-v10.sqlite"),
  join("data", "lore-v10.sqlite-wal"),
  join("data", "lore-v10.sqlite-shm"),
];
const BUILD_OUTPUT_LOCK_ROOT_NAME = "lore-build-output-locks";
const BUILD_OUTPUT_LOCK_WAIT_MS = 15 * 60 * 1000;
const BUILD_OUTPUT_LOCK_POLL_MS = 100;
const BUILD_LOCK_SLEEP_ARRAY = new Int32Array(new SharedArrayBuffer(4));

function isPathInsideOrSame(rootPath, candidatePath) {
  const relativePath = relative(rootPath, candidatePath);
  return relativePath === ""
    || (relativePath !== ".." && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath));
}

function lstatIfPresent(filePath) {
  try {
    return lstatSync(filePath, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function snapshotFile(filePath) {
  const stats = lstatIfPresent(filePath);
  if (!stats) {
    return { filePath, exists: false };
  }

  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(
      `Protected database path must be absent or a regular file, not a symlink, junction, or other non-regular path: ${filePath}`,
    );
  }

  return {
    filePath,
    exists: true,
    regularFile: true,
    device: stats.dev.toString(),
    inode: stats.ino.toString(),
    size: stats.size.toString(),
    mtimeNs: stats.mtimeNs.toString(),
    sha256: createHash("sha256").update(readFileSync(filePath)).digest("hex"),
  };
}

export function snapshotProtectedDatabaseFiles(projectRoot = process.cwd()) {
  return PROTECTED_DATABASE_RELATIVE_PATHS
    .map((relativePath) => snapshotFile(resolve(projectRoot, relativePath)));
}

export function changedProtectedDatabaseFiles(before, after) {
  return before
    .filter((snapshot, index) => JSON.stringify(snapshot) !== JSON.stringify(after[index]))
    .map(({ filePath }) => basename(filePath));
}

function removeEnvironmentKeyCaseInsensitive(env, name) {
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === name.toLowerCase()) {
      delete env[key];
    }
  }
}

function combineFailures(failures) {
  if (failures.length === 1) return failures[0];
  return new AggregateError(failures, "Hermetic build child or postcondition checks failed");
}

function captureOwnedDirectoryIdentity(directoryPath) {
  const stats = lstatIfPresent(directoryPath);
  if (!stats) {
    throw new Error(`Hermetic build temporary directory is missing: ${directoryPath}`);
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(
      `Hermetic build temporary path is a symlink, junction, reparse point, or non-directory: ${directoryPath}`,
    );
  }
  return {
    device: stats.dev.toString(),
    inode: stats.ino.toString(),
    birthtimeNs: stats.birthtimeNs.toString(),
  };
}

function sleepForBuildLock(milliseconds) {
  Atomics.wait(BUILD_LOCK_SLEEP_ARRAY, 0, 0, milliseconds);
}

function requireRegularDirectory(directoryPath, label) {
  const stats = lstatIfPresent(directoryPath);
  if (!stats || stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`${label} must be a non-reparse directory: ${directoryPath}`);
  }
}

export function acquireBuildOutputLock(projectRoot = process.cwd(), temporaryRoot = tmpdir()) {
  const resolvedProjectRoot = realpathSync(projectRoot);
  const resolvedTemporaryRoot = realpathSync(temporaryRoot);
  if (isPathInsideOrSame(resolvedProjectRoot, resolvedTemporaryRoot)) {
    throw new Error("Hermetic build temporary root must be outside the repository checkout");
  }

  const lockRoot = join(resolvedTemporaryRoot, BUILD_OUTPUT_LOCK_ROOT_NAME);
  mkdirSync(lockRoot, { recursive: true });
  requireRegularDirectory(lockRoot, "Hermetic build lock root");
  const lockName = createHash("sha256").update(resolvedProjectRoot).digest("hex");
  const lockPath = join(lockRoot, `${lockName}.lock`);
  const ownerPath = join(lockPath, "owner");
  const ownerToken = `${process.pid}:${Date.now()}:${Math.random().toString(16).slice(2)}`;
  const deadline = Date.now() + BUILD_OUTPUT_LOCK_WAIT_MS;

  while (true) {
    try {
      mkdirSync(lockPath);
      const identity = captureOwnedDirectoryIdentity(lockPath);
      writeFileSync(ownerPath, ownerToken, { encoding: "utf8", flag: "wx" });
      return {
        release() {
          const currentIdentity = captureOwnedDirectoryIdentity(lockPath);
          if (
            currentIdentity.device !== identity.device
            || currentIdentity.inode !== identity.inode
            || currentIdentity.birthtimeNs !== identity.birthtimeNs
          ) {
            throw new Error(`Refusing to release a replaced hermetic build lock: ${lockPath}`);
          }
          if (readFileSync(ownerPath, "utf8") !== ownerToken) {
            throw new Error(`Refusing to release a hermetic build lock owned by another process: ${lockPath}`);
          }
          unlinkSync(ownerPath);
          rmdirSync(lockPath);
        },
      };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for the hermetic build output lock: ${lockPath}`);
      }
      sleepForBuildLock(Math.min(BUILD_OUTPUT_LOCK_POLL_MS, deadline - Date.now()));
    }
  }
}

function removeOwnedTemporaryDirectory(directoryPath, expectedIdentity) {
  const currentIdentity = captureOwnedDirectoryIdentity(directoryPath);
  if (
    currentIdentity.device !== expectedIdentity.device
    || currentIdentity.inode !== expectedIdentity.inode
    || currentIdentity.birthtimeNs !== expectedIdentity.birthtimeNs
  ) {
    throw new Error(`Refusing to clean a replaced hermetic build directory: ${directoryPath}`);
  }

  rmSync(directoryPath, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });
}

function childOutcomeFailure(result) {
  const description = result.signal
    ? `signal ${result.signal}`
    : `status ${result.status}`;
  const error = new Error(`Hermetic build child exited with ${description}`);
  error.name = "HermeticBuildChildOutcomeError";
  error.status = result.status;
  error.signal = result.signal;
  return error;
}

export function runHermeticBuild({
  projectRoot = process.cwd(),
  command,
  args = [],
  env = process.env,
  stdio = "inherit",
  encoding,
  temporaryRoot = tmpdir(),
} = {}) {
  if (typeof command !== "string" || command.length === 0) {
    throw new Error("Hermetic build command is required");
  }

  const resolvedProjectRoot = realpathSync(projectRoot);
  const resolvedTemporaryRoot = realpathSync(temporaryRoot);
  if (isPathInsideOrSame(resolvedProjectRoot, resolvedTemporaryRoot)) {
    throw new Error("Hermetic build temporary root must be outside the repository checkout");
  }

  const protectedBefore = snapshotProtectedDatabaseFiles(resolvedProjectRoot);
  const buildTemporaryDirectory = mkdtempSync(join(resolvedTemporaryRoot, "lore-build-"));
  const buildTemporaryDirectoryIdentity = captureOwnedDirectoryIdentity(buildTemporaryDirectory);
  const temporaryDbPath = join(buildTemporaryDirectory, "lore.sqlite");
  if (!isPathInsideOrSame(buildTemporaryDirectory, temporaryDbPath)) {
    throw new Error("Hermetic build database path escaped its temporary directory");
  }

  const childEnv = { ...env };
  removeEnvironmentKeyCaseInsensitive(childEnv, "LORE_DB_PATH");
  removeEnvironmentKeyCaseInsensitive(childEnv, "LORE_ALLOW_CONTRACT_SCOPE_PURGE");
  removeEnvironmentKeyCaseInsensitive(childEnv, "LORE_HERMETIC_BUILD");
  childEnv.LORE_DB_PATH = temporaryDbPath;
  childEnv.LORE_ALLOW_CONTRACT_SCOPE_PURGE = "0";
  childEnv.LORE_HERMETIC_BUILD = "1";

  let result = null;
  let childFailure = null;
  let buildOutputLock = null;
  try {
    buildOutputLock = acquireBuildOutputLock(resolvedProjectRoot, resolvedTemporaryRoot);
    result = spawnSync(command, args, {
      cwd: resolvedProjectRoot,
      env: childEnv,
      stdio,
      ...(encoding ? { encoding } : {}),
    });
    childFailure = result.error ?? null;
  } catch (error) {
    childFailure = error;
  }

  const failures = [];
  const postconditionFailures = [];
  if (childFailure) failures.push(childFailure);

  try {
    if (!isPathInsideOrSame(resolvedTemporaryRoot, buildTemporaryDirectory)) {
      throw new Error("Refusing to clean a hermetic build directory outside the temporary root");
    }
    removeOwnedTemporaryDirectory(buildTemporaryDirectory, buildTemporaryDirectoryIdentity);
  } catch (error) {
    postconditionFailures.push(error);
  }

  try {
    const protectedAfter = snapshotProtectedDatabaseFiles(resolvedProjectRoot);
    const changed = changedProtectedDatabaseFiles(protectedBefore, protectedAfter);
    if (changed.length > 0) {
      throw new Error(`Hermetic build changed protected database state: ${changed.join(", ")}`);
    }
  } catch (error) {
    postconditionFailures.push(error);
  }

  try {
    buildOutputLock?.release();
  } catch (error) {
    postconditionFailures.push(error);
  }

  const childDidNotExitCleanly = result
    && (result.signal || (typeof result.status === "number" && result.status !== 0));
  if (postconditionFailures.length > 0 && childDidNotExitCleanly) {
    failures.push(childOutcomeFailure(result));
  }
  failures.push(...postconditionFailures);

  if (failures.length > 0) {
    throw combineFailures(failures);
  }

  return { result, temporaryDbPath };
}

function runNextBuild() {
  const projectRoot = process.cwd();
  const nextBin = resolve(projectRoot, "node_modules", "next", "dist", "bin", "next");
  const { result } = runHermeticBuild({
    projectRoot,
    command: process.execPath,
    args: [nextBin, "build", "--webpack", ...process.argv.slice(2)],
  });

  if (result?.status === null) {
    if (result.signal) {
      console.error(`Next build ended from signal ${result.signal}`);
    }
    process.exitCode = 1;
    return;
  }
  process.exitCode = result?.status ?? 1;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === resolve(fileURLToPath(import.meta.url))) {
  runNextBuild();
}
