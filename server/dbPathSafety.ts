import { existsSync, lstatSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";

type DbPathSafetyFs = Pick<typeof import("node:fs"), "existsSync" | "lstatSync" | "realpathSync">;

const DEFAULT_FS: DbPathSafetyFs = { existsSync, lstatSync, realpathSync };

function samePath(left: string, right: string) {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function assertCanonicalOrdinaryDirectory(directoryPath: string, fsApi: DbPathSafetyFs) {
  if (!fsApi.existsSync(directoryPath)) {
    throw new Error("Production SQLite parent directory must be provisioned before startup.");
  }
  const stats = fsApi.lstatSync(directoryPath);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error("Production SQLite parent must be an ordinary non-reparse directory.");
  }
  if (!samePath(fsApi.realpathSync(directoryPath), directoryPath)) {
    throw new Error("Production SQLite parent must not resolve through a symlink, junction, or reparse point.");
  }
}

function assertCanonicalOrdinaryFile(filePath: string, label: string, fsApi: DbPathSafetyFs) {
  if (!fsApi.existsSync(filePath)) return;
  const stats = fsApi.lstatSync(filePath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be an ordinary non-reparse file.`);
  }
  if (!samePath(fsApi.realpathSync(filePath), filePath)) {
    throw new Error(`${label} must not resolve through a symlink, junction, or reparse point.`);
  }
}

export function assertProductionDatabasePathSafe(
  databasePath: string,
  fsApi: DbPathSafetyFs = DEFAULT_FS,
) {
  const absolutePath = resolve(databasePath);
  assertCanonicalOrdinaryDirectory(dirname(absolutePath), fsApi);
  assertCanonicalOrdinaryFile(absolutePath, "Production SQLite database", fsApi);
  assertCanonicalOrdinaryFile(`${absolutePath}-wal`, "Production SQLite WAL", fsApi);
  assertCanonicalOrdinaryFile(`${absolutePath}-shm`, "Production SQLite SHM", fsApi);
  return absolutePath;
}
