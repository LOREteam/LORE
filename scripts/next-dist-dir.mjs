import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";

const NEXT_DIST_DIR_RE = /^\.next(?:-[a-z0-9]+(?:[._-][a-z0-9]+)*)?$/i;

function samePath(left, right) {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

export function resolveNextDistDir(rawValue, repoRoot) {
  const value = String(rawValue ?? "").trim() || ".next";
  if (isAbsolute(value) || !NEXT_DIST_DIR_RE.test(value)) {
    throw new Error("NEXT_DIST_DIR must be .next or a repository-local .next-<safe-name> directory");
  }

  const resolvedRoot = resolve(repoRoot);
  const resolvedPath = resolve(resolvedRoot, value);
  const relativePath = relative(resolvedRoot, resolvedPath);
  if (relativePath !== value || isAbsolute(relativePath) || relativePath.startsWith("..")) {
    throw new Error("NEXT_DIST_DIR must resolve directly inside the repository");
  }

  let stats;
  try {
    stats = lstatSync(resolvedPath);
  } catch (error) {
    if (error?.code === "ENOENT") return { relativePath, resolvedPath };
    throw error;
  }
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error("NEXT_DIST_DIR must be absent or an ordinary directory, not a reparse point or non-directory");
  }

  const canonicalRoot = realpathSync(resolvedRoot);
  const canonicalDistDir = realpathSync(resolvedPath);
  if (!samePath(canonicalDistDir, join(canonicalRoot, value))) {
    throw new Error("NEXT_DIST_DIR must not resolve through a symlink, junction, or reparse point");
  }

  return { relativePath, resolvedPath };
}
