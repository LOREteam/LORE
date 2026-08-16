import { spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  constants as fsConstants,
  fsyncSync,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";

export const BUILD_PROVENANCE_FILENAME = "lore-build-provenance.json";
export const BUILD_OUTPUT_DIGEST_DOMAIN = "lore-next-output/v1";

const BUILD_PROVENANCE_KIND = "lore-next-build-provenance";
const BUILD_PROVENANCE_FORMAT_VERSION = 1;
const BUILD_PROVENANCE_TEMP_PREFIX = ".lore-build-provenance.";
const BUILD_PROVENANCE_TEMP_SUFFIX = ".tmp";
const MAX_BUILD_OUTPUT_BYTES = 512 * 1_024 * 1_024;
const MAX_BUILD_MARKER_BYTES = 64 * 1_024;
const MAX_GIT_OUTPUT_BYTES = 4 * 1_024 * 1_024;
const CLEAN_STATUS_DIGEST_SHA256 = createHash("sha256").update("", "utf8").digest("hex");
const FULL_SHA_PATTERN = /^[a-f0-9]{40}$/;
const DIGEST_PATTERN = /^[a-f0-9]{64}$/;
const TRUSTED_GIT_CANDIDATES = process.platform === "win32"
  ? [
      "C:\\Program Files\\Git\\cmd\\git.exe",
      "C:\\Program Files\\Git\\bin\\git.exe",
    ]
  : ["/usr/bin/git"];
const TRUSTED_GIT_READ_CONFIG = [
  "-c",
  "core.fsmonitor=false",
  "-c",
  "core.untrackedCache=false",
  "-c",
  "diff.external=",
];

function samePath(left, right) {
  const normalizedLeft = resolve(left);
  const normalizedRight = resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function pathIsInside(rootPath, candidatePath) {
  const relativePath = relative(rootPath, candidatePath);
  return relativePath !== ""
    && relativePath !== ".."
    && !relativePath.startsWith(`..${sep}`)
    && !isAbsolute(relativePath);
}

function lstatIfPresent(filePath) {
  try {
    return lstatSync(filePath, { bigint: true });
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function requireOrdinaryDirectory(directoryPath, label) {
  const stats = lstatIfPresent(directoryPath);
  if (!stats || stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`${label} must be an ordinary non-reparse directory: ${directoryPath}`);
  }
  return realpathSync(directoryPath);
}

function resolveBuildContext(projectRoot, distDir) {
  const resolvedProjectRoot = realpathSync(projectRoot);
  const resolvedDistDir = resolve(resolvedProjectRoot, distDir);
  if (!pathIsInside(resolvedProjectRoot, resolvedDistDir)) {
    throw new Error("Build provenance output must resolve inside the repository");
  }
  const relativeBuildRoot = relative(resolvedProjectRoot, resolvedDistDir).replaceAll(sep, "/");
  const stats = lstatIfPresent(resolvedDistDir);
  if (stats && (stats.isSymbolicLink() || !stats.isDirectory())) {
    throw new Error("Build provenance output must be absent or an ordinary non-reparse directory");
  }
  if (stats) {
    const canonicalDistDir = realpathSync(resolvedDistDir);
    if (!samePath(canonicalDistDir, resolvedDistDir)) {
      throw new Error("Build provenance output must not resolve through a symlink, junction, or reparse point");
    }
  }
  return { resolvedProjectRoot, resolvedDistDir, relativeBuildRoot };
}

function stableFileStatsEqual(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeNs === right.mtimeNs
    && left.ctimeNs === right.ctimeNs;
}

function readRegularFileStable(filePath, label, maxBytes) {
  const pathStats = lstatIfPresent(filePath);
  if (!pathStats || pathStats.isSymbolicLink() || !pathStats.isFile()) {
    throw new Error(`${label} must be a regular non-symlink file`);
  }
  if (pathStats.size > BigInt(maxBytes)) {
    throw new Error(`${label} exceeds the bounded ${maxBytes}-byte limit`);
  }

  let descriptor;
  try {
    descriptor = openSync(filePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
    const before = fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || !stableFileStatsEqual(pathStats, before)) {
      throw new Error(`${label} changed before it could be read`);
    }
    const contents = readFileSync(descriptor);
    const after = fstatSync(descriptor, { bigint: true });
    if (!stableFileStatsEqual(before, after) || BigInt(contents.byteLength) !== after.size) {
      throw new Error(`${label} changed while it was read`);
    }
    return contents;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function normalizeRelativePath(value) {
  return String(value).replaceAll("\\", "/");
}

function isExcludedBuildPath(relativePath) {
  const topLevel = relativePath.split("/")[0];
  return topLevel === "cache"
    || topLevel === "dev"
    || relativePath === BUILD_PROVENANCE_FILENAME
    || (
      !relativePath.includes("/")
      && relativePath.startsWith(BUILD_PROVENANCE_TEMP_PREFIX)
      && relativePath.endsWith(BUILD_PROVENANCE_TEMP_SUFFIX)
    );
}

function comparePathBytes(left, right) {
  return Buffer.compare(left.pathBytes, right.pathBytes);
}

function assertOutputIdentitiesMatch(left, right, label) {
  if (
    left.domain !== right.domain
    || left.algorithm !== right.algorithm
    || left.contentDigestSha256 !== right.contentDigestSha256
    || left.fileCount !== right.fileCount
    || left.totalBytes !== right.totalBytes
    || left.buildId !== right.buildId
  ) {
    throw new Error(`${label} does not match the observed build output`);
  }
}

function buildGitEnvironment(baseEnvironment) {
  const environment = { ...baseEnvironment };
  for (const key of Object.keys(environment)) {
    if (key.toUpperCase().startsWith("GIT_")) delete environment[key];
  }
  environment.GIT_CONFIG_NOSYSTEM = "1";
  environment.GIT_CONFIG_GLOBAL = process.platform === "win32" ? "NUL" : "/dev/null";
  environment.GIT_OPTIONAL_LOCKS = "0";
  environment.GIT_TERMINAL_PROMPT = "0";
  return environment;
}

export function resolveTrustedGitExecutable() {
  for (const candidate of TRUSTED_GIT_CANDIDATES) {
    const stats = lstatIfPresent(candidate);
    if (stats?.isFile() && !stats.isSymbolicLink()) return candidate;
  }
  throw new Error("No trusted absolute Git executable is available for build provenance");
}

function executeGit(gitExecutable, projectRoot, args, environment) {
  return spawnSync(gitExecutable, [
    "-c",
    `safe.directory=${projectRoot}`,
    "-C",
    projectRoot,
    ...TRUSTED_GIT_READ_CONFIG,
    ...args,
  ], {
    cwd: projectRoot,
    env: buildGitEnvironment(environment),
    encoding: "utf8",
    maxBuffer: MAX_GIT_OUTPUT_BYTES,
    windowsHide: true,
    shell: false,
  });
}

function gitFailure(result) {
  if (result.error) throw result.error;
  const detail = String(result.stderr ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
  return new Error(`Trusted Git command failed (${result.status})${detail ? `: ${detail}` : ""}`);
}

function runGit(gitExecutable, projectRoot, args, environment) {
  const result = executeGit(gitExecutable, projectRoot, args, environment);
  if (result.error || result.status !== 0) throw gitFailure(result);
  return result.stdout;
}

function runGitQuietCheck(gitExecutable, projectRoot, args, environment) {
  const result = executeGit(gitExecutable, projectRoot, args, environment);
  if (result.error || (result.status !== 0 && result.status !== 1)) throw gitFailure(result);
  return result.status === 0;
}

function assertNoTrackedIndexFlags(gitExecutable, projectRoot, environment) {
  const taggedEntries = runGit(
    gitExecutable,
    projectRoot,
    ["ls-files", "-v", "-f", "-z", "--cached"],
    environment,
  );
  for (const entry of taggedEntries.split("\0")) {
    if (!entry) continue;
    if (entry.length < 3 || entry[1] !== " " || entry[0] !== "H") {
      throw new Error(
        "Sealed build provenance rejects non-default tracked-file index flags "
        + "(including assume-unchanged, skip-worktree, and fsmonitor-valid)",
      );
    }
  }
}

export function captureCleanGitRevision(projectRoot, environment = process.env) {
  const resolvedProjectRoot = realpathSync(projectRoot);
  const gitExecutable = resolveTrustedGitExecutable();
  const reportedRoot = runGit(gitExecutable, resolvedProjectRoot, ["rev-parse", "--show-toplevel"], environment).trim();
  if (!reportedRoot || !samePath(realpathSync(reportedRoot), resolvedProjectRoot)) {
    throw new Error("Build provenance Git root does not match the repository root");
  }
  const headBefore = runGit(
    gitExecutable,
    resolvedProjectRoot,
    ["rev-parse", "--verify", "HEAD^{commit}"],
    environment,
  ).trim().toLowerCase();
  assertNoTrackedIndexFlags(gitExecutable, resolvedProjectRoot, environment);
  const indexMatchesHead = runGitQuietCheck(
    gitExecutable,
    resolvedProjectRoot,
    [
      "diff-index",
      "--cached",
      "--quiet",
      "--no-ext-diff",
      "--no-textconv",
      "--ignore-submodules=none",
      headBefore,
      "--",
    ],
    environment,
  );
  const trackedWorktreeMatchesIndex = runGitQuietCheck(
    gitExecutable,
    resolvedProjectRoot,
    [
      "diff-files",
      "--quiet",
      "--no-ext-diff",
      "--no-textconv",
      "--ignore-submodules=none",
      "--",
    ],
    environment,
  );
  const status = runGit(gitExecutable, resolvedProjectRoot, [
    "-c",
    "color.status=false",
    "-c",
    "core.quotepath=true",
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--ignore-submodules=none",
  ], environment);
  const headAfter = runGit(
    gitExecutable,
    resolvedProjectRoot,
    ["rev-parse", "--verify", "HEAD^{commit}"],
    environment,
  ).trim().toLowerCase();
  if (!FULL_SHA_PATTERN.test(headBefore) || headBefore !== headAfter) {
    throw new Error("Git HEAD changed while build provenance inspected the worktree");
  }
  if (!indexMatchesHead) {
    throw new Error("Sealed build provenance requires a clean worktree: the Git index must match HEAD exactly");
  }
  if (!trackedWorktreeMatchesIndex) {
    throw new Error(
      "Sealed build provenance requires a clean worktree: "
      + "tracked bytes, modes, and submodules must match the Git index",
    );
  }
  if (status.length !== 0) {
    throw new Error("Sealed build provenance requires a clean worktree, including untracked files and submodules");
  }
  return {
    status: "clean",
    headSha: headBefore,
    statusDigestSha256: CLEAN_STATUS_DIGEST_SHA256,
  };
}

export function invalidateBuildProvenanceMarker(projectRoot, distDir) {
  const context = resolveBuildContext(projectRoot, distDir);
  const distStats = lstatIfPresent(context.resolvedDistDir);
  if (!distStats) return { removed: false, removedTemporaryFiles: 0 };
  requireOrdinaryDirectory(context.resolvedDistDir, "Build output");

  let removed = false;
  let removedTemporaryFiles = 0;
  for (const entry of readdirSync(context.resolvedDistDir, { withFileTypes: true })) {
    const isMarker = entry.name === BUILD_PROVENANCE_FILENAME;
    const isTemporary = entry.name.startsWith(BUILD_PROVENANCE_TEMP_PREFIX)
      && entry.name.endsWith(BUILD_PROVENANCE_TEMP_SUFFIX);
    if (!isMarker && !isTemporary) continue;
    const entryPath = resolve(context.resolvedDistDir, entry.name);
    const stats = lstatIfPresent(entryPath);
    if (!stats) continue;
    if (stats.isDirectory() && !stats.isSymbolicLink()) {
      throw new Error(`Refusing to remove a provenance marker path that became a directory: ${entryPath}`);
    }
    unlinkSync(entryPath);
    if (isMarker) removed = true;
    else removedTemporaryFiles += 1;
  }
  return { removed, removedTemporaryFiles };
}

function clearCanonicalSealedBuildOutput(context) {
  if (context.relativeBuildRoot !== ".next") {
    throw new Error("Sealed build provenance requires the canonical .next output directory");
  }
  const stats = lstatIfPresent(context.resolvedDistDir);
  if (!stats) return { removed: false };
  const canonicalDistDir = requireOrdinaryDirectory(context.resolvedDistDir, "Sealed build output");
  if (!samePath(canonicalDistDir, context.resolvedDistDir)) {
    throw new Error("Sealed build output must not resolve through a symlink, junction, or reparse point");
  }
  rmSync(context.resolvedDistDir, {
    recursive: true,
    force: false,
    maxRetries: 3,
    retryDelay: 100,
  });
  if (lstatIfPresent(context.resolvedDistDir)) {
    throw new Error("Sealed build output remained after its fresh output boundary was cleared");
  }
  return { removed: true };
}

export function collectBuildOutputIdentity(projectRoot, distDir) {
  const context = resolveBuildContext(projectRoot, distDir);
  const canonicalDistDir = requireOrdinaryDirectory(context.resolvedDistDir, "Build output");
  if (!samePath(canonicalDistDir, context.resolvedDistDir)) {
    throw new Error("Build output must not resolve through a symlink, junction, or reparse point");
  }

  const files = [];
  const pending = [{ absolutePath: context.resolvedDistDir, relativePath: "" }];
  while (pending.length > 0) {
    const directory = pending.pop();
    for (const entry of readdirSync(directory.absolutePath, { withFileTypes: true })) {
      const absolutePath = resolve(directory.absolutePath, entry.name);
      const relativePath = normalizeRelativePath(
        directory.relativePath ? `${directory.relativePath}/${entry.name}` : entry.name,
      );
      const stats = lstatSync(absolutePath, { bigint: true });
      if (stats.isSymbolicLink()) {
        throw new Error(`Build output identity refuses a symbolic link or reparse point: ${relativePath}`);
      }
      if (stats.isDirectory()) {
        if (!isExcludedBuildPath(relativePath)) pending.push({ absolutePath, relativePath });
      } else if (stats.isFile()) {
        if (!isExcludedBuildPath(relativePath)) {
          files.push({ absolutePath, relativePath, pathBytes: Buffer.from(relativePath, "utf8") });
        }
      } else {
        throw new Error(`Build output identity refuses a non-file entry: ${relativePath}`);
      }
    }
  }
  files.sort(comparePathBytes);

  const hash = createHash("sha256");
  hash.update(`${BUILD_OUTPUT_DIGEST_DOMAIN}\0`, "utf8");
  let totalBytes = 0;
  let buildId = null;
  for (const file of files) {
    const contents = readRegularFileStable(
      file.absolutePath,
      `Build output file ${file.relativePath}`,
      MAX_BUILD_OUTPUT_BYTES - totalBytes,
    );
    totalBytes += contents.byteLength;
    if (totalBytes > MAX_BUILD_OUTPUT_BYTES) {
      throw new Error(`Build output identity exceeded the bounded ${MAX_BUILD_OUTPUT_BYTES}-byte limit`);
    }
    hash.update(`${file.pathBytes.byteLength}:`, "utf8");
    hash.update(file.pathBytes);
    hash.update(`\0${contents.byteLength}:`, "utf8");
    hash.update(contents);
    if (file.relativePath === "BUILD_ID") buildId = contents.toString("utf8").trim();
  }
  if (!buildId) throw new Error("Build output BUILD_ID is missing or empty");
  return {
    domain: BUILD_OUTPUT_DIGEST_DOMAIN,
    algorithm: "sha256",
    contentDigestSha256: hash.digest("hex"),
    fileCount: files.length,
    totalBytes,
    buildId,
    scope: "ordinary production output excluding cache, dev, and provenance marker/temp files",
  };
}

function validateBuildMarker(marker, relativeBuildRoot) {
  const outputIdentity = marker?.outputIdentity;
  if (
    !marker
    || typeof marker !== "object"
    || Array.isArray(marker)
    || marker.formatVersion !== BUILD_PROVENANCE_FORMAT_VERSION
    || marker.kind !== BUILD_PROVENANCE_KIND
    || marker.relativeBuildRoot !== relativeBuildRoot
    || !FULL_SHA_PATTERN.test(marker.sourceRevisionSha ?? "")
    || marker.sourceStatusDigestSha256 !== CLEAN_STATUS_DIGEST_SHA256
    || typeof marker.buildId !== "string"
    || marker.buildId.length === 0
    || !outputIdentity
    || outputIdentity.domain !== BUILD_OUTPUT_DIGEST_DOMAIN
    || outputIdentity.algorithm !== "sha256"
    || !DIGEST_PATTERN.test(outputIdentity.contentDigestSha256 ?? "")
    || !Number.isSafeInteger(outputIdentity.fileCount)
    || outputIdentity.fileCount < 1
    || !Number.isSafeInteger(outputIdentity.totalBytes)
    || outputIdentity.totalBytes < 1
    || typeof marker.generatedAt !== "string"
    || !Number.isFinite(Date.parse(marker.generatedAt))
  ) {
    throw new Error("Build provenance marker has an invalid or unsupported schema");
  }
  if (marker.buildId !== outputIdentity.buildId) {
    throw new Error("Build provenance marker BUILD_ID fields disagree");
  }
  return marker;
}

export function readBuildProvenanceMarker(projectRoot, distDir) {
  const context = resolveBuildContext(projectRoot, distDir);
  requireOrdinaryDirectory(context.resolvedDistDir, "Build output");
  const markerPath = resolve(context.resolvedDistDir, BUILD_PROVENANCE_FILENAME);
  const contents = readRegularFileStable(markerPath, "Build provenance marker", MAX_BUILD_MARKER_BYTES);
  let marker;
  try {
    marker = JSON.parse(contents.toString("utf8"));
  } catch {
    throw new Error("Build provenance marker is not valid JSON");
  }
  return {
    marker: validateBuildMarker(marker, context.relativeBuildRoot),
    markerPath,
    fileDigestSha256: createHash("sha256").update(contents).digest("hex"),
  };
}

function publishBuildMarkerAtomic(context, marker) {
  requireOrdinaryDirectory(context.resolvedDistDir, "Build output");
  const markerPath = resolve(context.resolvedDistDir, BUILD_PROVENANCE_FILENAME);
  if (lstatIfPresent(markerPath)) {
    throw new Error("Refusing to replace an existing build provenance marker");
  }
  const token = `${process.pid}-${Date.now()}-${randomBytes(8).toString("hex")}`;
  const temporaryPath = resolve(
    context.resolvedDistDir,
    `${BUILD_PROVENANCE_TEMP_PREFIX}${token}${BUILD_PROVENANCE_TEMP_SUFFIX}`,
  );
  const serialized = Buffer.from(`${JSON.stringify(marker, null, 2)}\n`, "utf8");
  let descriptor;
  try {
    descriptor = openSync(temporaryPath, "wx", 0o600);
    writeFileSync(descriptor, serialized);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    if (lstatIfPresent(markerPath)) {
      throw new Error("Build provenance marker appeared before atomic publication");
    }
    renameSync(temporaryPath, markerPath);
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    try {
      unlinkSync(temporaryPath);
    } catch (cleanupError) {
      if (cleanupError?.code !== "ENOENT") throw new AggregateError([error, cleanupError], "Build marker publication failed");
    }
    throw error;
  }
  return markerPath;
}

export function prepareBuildProvenance({ projectRoot, distDir, seal, environment = process.env }) {
  const context = resolveBuildContext(projectRoot, distDir);
  const invalidated = invalidateBuildProvenanceMarker(context.resolvedProjectRoot, context.resolvedDistDir);
  if (!seal) return { seal: false, context, invalidated };
  const repositoryBefore = captureCleanGitRevision(context.resolvedProjectRoot, environment);
  const clearedBuildOutput = clearCanonicalSealedBuildOutput(context);
  return {
    seal: true,
    context,
    invalidated,
    clearedBuildOutput,
    repositoryBefore,
    environment,
  };
}

export function verifyBuildProvenance({
  projectRoot,
  distDir,
  expectedSourceRevisionSha,
  expectedOutputIdentity,
}) {
  const markerBefore = readBuildProvenanceMarker(projectRoot, distDir);
  const outputIdentity = collectBuildOutputIdentity(projectRoot, distDir);
  const markerAfter = readBuildProvenanceMarker(projectRoot, distDir);
  if (markerBefore.fileDigestSha256 !== markerAfter.fileDigestSha256) {
    throw new Error("Build provenance marker changed during verification");
  }
  const marker = markerAfter.marker;
  if (expectedSourceRevisionSha && marker.sourceRevisionSha !== expectedSourceRevisionSha) {
    throw new Error("Build provenance marker does not match the expected Git HEAD");
  }
  if (marker.buildId !== outputIdentity.buildId) {
    throw new Error("Build provenance marker BUILD_ID does not match the build output");
  }
  assertOutputIdentitiesMatch(marker.outputIdentity, outputIdentity, "Build provenance marker output identity");
  if (expectedOutputIdentity) {
    assertOutputIdentitiesMatch(expectedOutputIdentity, outputIdentity, "Final build output identity");
  }
  return {
    marker,
    markerPath: markerAfter.markerPath,
    markerFileDigestSha256: markerAfter.fileDigestSha256,
    outputIdentity,
  };
}

export function sealBuildProvenance(session) {
  if (!session?.seal || !session.context || !session.repositoryBefore) {
    throw new Error("A prepared sealed build provenance session is required");
  }
  const { context, environment, repositoryBefore } = session;
  const repositoryAfterBuild = captureCleanGitRevision(context.resolvedProjectRoot, environment);
  if (repositoryAfterBuild.headSha !== repositoryBefore.headSha) {
    throw new Error("Git HEAD changed during the sealed build");
  }
  const outputIdentityBeforeMarker = collectBuildOutputIdentity(
    context.resolvedProjectRoot,
    context.resolvedDistDir,
  );
  const marker = {
    formatVersion: BUILD_PROVENANCE_FORMAT_VERSION,
    kind: BUILD_PROVENANCE_KIND,
    relativeBuildRoot: context.relativeBuildRoot,
    sourceRevisionSha: repositoryBefore.headSha,
    sourceStatusDigestSha256: repositoryBefore.statusDigestSha256,
    buildId: outputIdentityBeforeMarker.buildId,
    outputIdentity: outputIdentityBeforeMarker,
    generatedAt: new Date().toISOString(),
  };
  publishBuildMarkerAtomic(context, marker);
  try {
    const verified = verifyBuildProvenance({
      projectRoot: context.resolvedProjectRoot,
      distDir: context.resolvedDistDir,
      expectedSourceRevisionSha: repositoryBefore.headSha,
      expectedOutputIdentity: outputIdentityBeforeMarker,
    });
    const repositoryAfterSeal = captureCleanGitRevision(context.resolvedProjectRoot, environment);
    if (repositoryAfterSeal.headSha !== repositoryBefore.headSha) {
      throw new Error("Git HEAD changed while build provenance was sealed");
    }
    return {
      status: "sealed",
      repositoryBefore,
      repositoryAfterBuild,
      repositoryAfterSeal,
      ...verified,
    };
  } catch (error) {
    try {
      invalidateBuildProvenanceMarker(context.resolvedProjectRoot, context.resolvedDistDir);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Build provenance sealing and cleanup failed");
    }
    throw error;
  }
}
