import {
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import path from "node:path";

export const MAX_V10_SOURCE_UNIT_BYTES = 2 * 1024 * 1024;
export const MAX_V10_COMPILER_CONFIG_BYTES = 512 * 1024;
export const MAX_V10_COMPILATION_MANIFEST_BYTES = 512 * 1024;
export const MAX_V10_SOURCE_UNIT_PATH_CHARS = 512;

export function canonicalizeV10Source(value: string) {
  return value.replace(/\r\n?/g, "\n");
}

export function normalizeV10SourceUnit(sourceUnit: string) {
  if (
    typeof sourceUnit !== "string" ||
    sourceUnit.length < 1 ||
    sourceUnit.length > MAX_V10_SOURCE_UNIT_PATH_CHARS ||
    /[\0-\x1f\x7f\\]/.test(sourceUnit) ||
    path.posix.isAbsolute(sourceUnit) ||
    path.win32.isAbsolute(sourceUnit) ||
    path.posix.normalize(sourceUnit) !== sourceUnit
  ) {
    throw new Error("Unsafe V10 source-unit path");
  }
  const segments = sourceUnit.split("/");
  if (segments.some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw new Error("Unsafe V10 source-unit path");
  }
  return sourceUnit;
}

export function resolveContainedV10SourcePath(rootPath: string, sourceUnit: string) {
  const normalized = normalizeV10SourceUnit(sourceUnit);
  const root = path.resolve(rootPath);
  const candidate = path.resolve(root, ...normalized.split("/"));
  const relative = path.relative(root, candidate);
  if (relative === "" || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("V10 source-unit path escapes its allowed root");
  }
  return candidate;
}

function pathIsInsideOrSame(rootPath: string, candidatePath: string) {
  const relative = path.relative(rootPath, candidatePath);
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function sameCanonicalPath(left: string, right: string) {
  const normalizedLeft = path.normalize(left);
  const normalizedRight = path.normalize(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

export function resolveCanonicalV10SourcePath(rootPath: string, sourceUnit: string) {
  const canonicalRoot = realpathSync.native(path.resolve(rootPath));
  const candidate = resolveContainedV10SourcePath(canonicalRoot, sourceUnit);
  const canonicalCandidate = realpathSync.native(candidate);
  if (!pathIsInsideOrSame(canonicalRoot, canonicalCandidate)) {
    throw new Error("V10 source-unit path escapes its allowed root through a reparse point");
  }
  if (!sameCanonicalPath(candidate, canonicalCandidate)) {
    throw new Error("V10 source-unit path must not resolve through a symlink, junction, or reparse point");
  }
  return canonicalCandidate;
}

export function readBoundedV10Utf8File(filePath: string, maxBytes: number, label: string) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error(`${label} byte limit must be a positive safe integer`);
  }
  const linkStats = lstatSync(filePath);
  if (!linkStats.isFile() || linkStats.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file`);
  }
  if (linkStats.size > maxBytes) {
    throw new Error(`${label} is too large to validate safely`);
  }

  const fd = openSync(filePath, "r");
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.size > maxBytes) {
      throw new Error(`${label} is too large to validate safely`);
    }
    const bytes = readFileSync(fd);
    const after = fstatSync(fd);
    if (bytes.length > maxBytes || before.size !== bytes.length || after.size !== before.size) {
      throw new Error(`${label} changed while it was being validated`);
    }
    return bytes.toString("utf8");
  } finally {
    closeSync(fd);
  }
}

export type V10SourceReadOptions = {
  workspaceRoot?: string;
  nodeModulesRoot?: string;
  maxBytes?: number;
};

export function readV10SourceUnit(sourceUnit: string, options: V10SourceReadOptions = {}) {
  const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd());
  const nodeModulesRoot = path.resolve(options.nodeModulesRoot ?? path.join(workspaceRoot, "node_modules"));
  const maxBytes = options.maxBytes ?? MAX_V10_SOURCE_UNIT_BYTES;
  for (const root of [workspaceRoot, nodeModulesRoot]) {
    try {
      const candidate = resolveCanonicalV10SourcePath(root, sourceUnit);
      return canonicalizeV10Source(readBoundedV10Utf8File(candidate, maxBytes, `Source unit ${sourceUnit}`));
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
    }
  }
  throw new Error(`Source unit not found: ${sourceUnit}`);
}

export function createV10ImportReader(options: V10SourceReadOptions = {}) {
  return (importPath: string) => {
    try {
      return { contents: readV10SourceUnit(importPath, options) };
    } catch {
      return { error: "V10 import unavailable" };
    }
  };
}
