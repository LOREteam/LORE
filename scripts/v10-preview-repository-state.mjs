import { createHash } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { resolveTrustedGitExecutable } from "./build-provenance.mjs";

const MAX_GIT_OUTPUT_BYTES = 4 * 1024 * 1024;
const APPLICATION_GIT_SHA_RE = /^[a-f0-9]{40}$/;
const ALLOWED_TRACKED_PREVIEW_PATH = "docs/v10-canary-dry-run-preview.md";
const ALLOWED_UNTRACKED_PREFIXES = Object.freeze([
  "artifacts/",
  "data/live-test-runs/",
]);

function samePath(left, right) {
  const resolvedLeft = path.resolve(left);
  const resolvedRight = path.resolve(right);
  return process.platform === "win32"
    ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
    : resolvedLeft === resolvedRight;
}

function normalizeGitPath(value) {
  return String(value ?? "").replaceAll("\\", "/");
}

function gitEnvironment(sourceEnv) {
  const env = {
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_CONFIG_SYSTEM: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_PAGER: "cat",
    GIT_TERMINAL_PROMPT: "0",
    LANG: "C",
    LC_ALL: "C",
  };
  for (const key of ["SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR"]) {
    if (typeof sourceEnv[key] === "string") env[key] = sourceEnv[key];
  }
  return env;
}

function runGit(root, args, { allowDifference = false, sourceEnv = process.env } = {}) {
  const executable = resolveTrustedGitExecutable();
  const safeDirectory = root.replaceAll("\\", "/");
  const result = spawnSync(executable, [
    "--no-pager",
    "-c", `safe.directory=${safeDirectory}`,
    "-c", "core.fsmonitor=false",
    "-c", "core.untrackedCache=false",
    "-c", "core.preloadIndex=false",
    "-c", "core.hooksPath=",
    "-c", "diff.external=",
    ...args,
  ], {
    cwd: root,
    encoding: "utf8",
    env: gitEnvironment(sourceEnv),
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    timeout: 10_000,
    windowsHide: true,
  });
  if (result.error?.code === "ETIMEDOUT") throw new Error("V10 Preview Git inspection timed out");
  if (result.error?.code === "ENOBUFS") throw new Error("V10 Preview Git inspection exceeded its output bound");
  if (result.error || result.signal || (result.status !== 0 && !(allowDifference && result.status === 1))) {
    throw new Error("V10 Preview trusted Git inspection failed");
  }
  return { different: result.status === 1, output: String(result.stdout ?? "") };
}

function nulEntries(output) {
  return output.split("\0").filter(Boolean);
}

function assertDefaultTrackedIndexFlags(root, sourceEnv) {
  const entries = nulEntries(runGit(root, ["ls-files", "-v", "-f", "-z", "--cached"], { sourceEnv }).output);
  return entries.every((entry) => entry.length >= 3 && entry[0] === "H" && entry[1] === " ");
}

function captureUnexpectedState(root, sourceEnv) {
  const indexMatchesHead = !runGit(root, [
    "diff-index",
    "--cached",
    "--quiet",
    "--no-ext-diff",
    "--no-textconv",
    "--ignore-submodules=none",
    "HEAD",
    "--",
  ], { allowDifference: true, sourceEnv }).different;
  const trackedPaths = nulEntries(runGit(root, [
    "diff-files",
    "--name-only",
    "-z",
    "--no-ext-diff",
    "--no-textconv",
    "--ignore-submodules=none",
    "--",
  ], { sourceEnv }).output).map(normalizeGitPath);
  const unexpectedTrackedPaths = trackedPaths.filter((entry) => entry !== ALLOWED_TRACKED_PREVIEW_PATH);
  const untrackedPaths = nulEntries(runGit(root, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
  ], { sourceEnv }).output).map(normalizeGitPath);
  const unexpectedUntrackedPaths = untrackedPaths.filter(
    (entry) => !ALLOWED_UNTRACKED_PREFIXES.some((prefix) => entry.startsWith(prefix)),
  );
  const defaultTrackedIndexFlags = assertDefaultTrackedIndexFlags(root, sourceEnv);
  const fingerprint = createHash("sha256").update(JSON.stringify({
    defaultTrackedIndexFlags,
    indexMatchesHead,
    unexpectedTrackedPaths: [...unexpectedTrackedPaths].sort(),
    unexpectedUntrackedPaths: [...unexpectedUntrackedPaths].sort(),
  }), "utf8").digest("hex");
  return {
    defaultTrackedIndexFlags,
    indexMatchesHead,
    unexpectedTrackedPaths,
    unexpectedUntrackedPaths,
    fingerprint,
  };
}

export function captureV10PreviewRepositoryState({ root = process.cwd(), sourceEnv = process.env } = {}) {
  const requestedRoot = path.resolve(root);
  const rootStats = lstatSync(requestedRoot);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error("V10 Preview repository root must be an ordinary directory");
  }
  const canonicalRoot = realpathSync(requestedRoot);
  if (!samePath(requestedRoot, canonicalRoot)) {
    throw new Error("V10 Preview repository root must not resolve through a reparse point");
  }
  const reportedRoot = runGit(canonicalRoot, ["rev-parse", "--show-toplevel"], { sourceEnv }).output.trim();
  const reportedPrefix = runGit(canonicalRoot, ["rev-parse", "--show-prefix"], { sourceEnv }).output.trim();
  // On hosted Windows, Git and Node can report equivalent checkout paths
  // through different runner mount aliases. Ask trusted Git whether the given
  // canonical directory is the worktree root instead of comparing those aliases.
  if (!reportedRoot || reportedPrefix) {
    throw new Error("V10 Preview Git root does not match the working root");
  }
  const headBefore = runGit(canonicalRoot, ["rev-parse", "--verify", "HEAD^{commit}"], { sourceEnv }).output.trim().toLowerCase();
  if (!APPLICATION_GIT_SHA_RE.test(headBefore)) {
    throw new Error("V10 Preview application Git SHA is invalid");
  }
  const unexpectedState = captureUnexpectedState(canonicalRoot, sourceEnv);
  const headAfter = runGit(canonicalRoot, ["rev-parse", "--verify", "HEAD^{commit}"], { sourceEnv }).output.trim().toLowerCase();
  if (headAfter !== headBefore) throw new Error("V10 Preview Git HEAD changed during inspection");
  return Object.freeze({
    applicationGitSha: headBefore,
    sourceTreeClean:
      unexpectedState.indexMatchesHead
      && unexpectedState.defaultTrackedIndexFlags
      && unexpectedState.unexpectedTrackedPaths.length === 0
      && unexpectedState.unexpectedUntrackedPaths.length === 0,
    sourceStateSha256: unexpectedState.fingerprint,
    unexpectedTrackedPaths: unexpectedState.unexpectedTrackedPaths.length,
    unexpectedUntrackedPaths: unexpectedState.unexpectedUntrackedPaths.length,
    indexMatchesHead: unexpectedState.indexMatchesHead,
    defaultTrackedIndexFlags: unexpectedState.defaultTrackedIndexFlags,
  });
}
