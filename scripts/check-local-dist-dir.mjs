import { isAbsolute, relative, resolve } from "node:path";

const TOOL_OWNED_DIST_DIR_RE = /^\.next-check(?:-[a-z0-9][a-z0-9._-]*)?$/i;

export function resolveCheckLocalDistDir(rawValue, repoRoot = process.cwd()) {
  const value = String(rawValue ?? "").trim();
  if (!value) {
    throw new Error("CHECK_LOCAL_DIST_DIR must be a nonempty tool-owned directory");
  }
  if (isAbsolute(value)) {
    throw new Error("CHECK_LOCAL_DIST_DIR must be relative to the repository");
  }
  if (!TOOL_OWNED_DIST_DIR_RE.test(value)) {
    throw new Error("CHECK_LOCAL_DIST_DIR must be .next-check or a .next-check-<name> directory");
  }

  const resolvedRoot = resolve(repoRoot);
  const resolvedPath = resolve(resolvedRoot, value);
  const relativePath = relative(resolvedRoot, resolvedPath);
  if (!relativePath || isAbsolute(relativePath) || relativePath.startsWith("..")) {
    throw new Error("CHECK_LOCAL_DIST_DIR must resolve strictly inside the repository");
  }

  return { relativePath, resolvedPath };
}
