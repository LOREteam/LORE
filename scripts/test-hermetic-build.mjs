import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  BUILD_PROVENANCE_FILENAME,
  collectBuildOutputIdentity,
  readBuildProvenanceMarker,
  resolveTrustedGitExecutable,
  verifyBuildProvenance,
} from "./build-provenance.mjs";
import {
  acquireBuildOutputLock,
  runHermeticBuild,
  snapshotProtectedDatabaseFiles,
} from "./run-hermetic-build.mjs";
import { resolveNextDistDir } from "./next-dist-dir.mjs";

const systemTempRoot = realpathSync(tmpdir());
const hermeticBuildWrapperPath = resolve("scripts", "run-hermetic-build.mjs");

function createFixture() {
  const root = mkdtempSync(join(systemTempRoot, "lore-hermetic-build-test-"));
  const dataDir = join(root, "data");
  mkdirSync(dataDir);
  for (const [name, contents] of [
    ["lore-v10.sqlite", "main-database"],
    ["lore-v10.sqlite-wal", "write-ahead-log"],
    ["lore-v10.sqlite-shm", "shared-memory"],
  ]) {
    writeFileSync(join(dataDir, name), contents, "utf8");
  }
  return root;
}

function removeFixture(root) {
  rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}

function runFixtureChild(root, source, markerName, extraEnv = {}, timeoutMs) {
  const markerPath = join(root, markerName);
  const outcome = runHermeticBuild({
    projectRoot: root,
    command: process.execPath,
    args: ["-e", source],
    env: {
      ...process.env,
      HERMETIC_BUILD_TEST_MARKER: markerPath,
      LORE_DB_PATH: join(root, "data", "lore-v10.sqlite"),
      LORE_ALLOW_CONTRACT_SCOPE_PURGE: "1",
      LORE_HERMETIC_BUILD: "spoofed",
      NEXT_DIST_DIR: ".next-test-output",
      NEXT_TSCONFIG_PATH: "tsconfig.test.json",
      ...extraEnv,
    },
    stdio: "pipe",
    encoding: "utf8",
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
  });
  return { ...outcome, markerPath };
}

{
  const root = createFixture();
  const descendantMarkerPath = join(root, "timed-out-descendant.txt");
  try {
    const source = `
      const { spawn } = require("node:child_process");
      const markerPath = ${JSON.stringify(descendantMarkerPath)};
      spawn(process.execPath, ["-e", ${JSON.stringify(`
        const { writeFileSync } = require("node:fs");
        setTimeout(() => writeFileSync(${JSON.stringify(descendantMarkerPath)}, "late"), 1_000);
        setTimeout(() => {}, 10_000);
      `)}], { stdio: "ignore" });
      setTimeout(() => {}, 10_000);
    `;
    assert.throws(
      () => runFixtureChild(root, source, "timeout.json", {}, 100),
      (error) => error?.code === "ETIMEDOUT",
      "a timed-out hermetic build must expose the timeout result",
    );
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_200);
    assert.throws(
      () => lstatSync(descendantMarkerPath),
      (error) => error?.code === "ENOENT",
      "a timed-out hermetic build must terminate descendant processes before they can write later",
    );
  } finally {
    removeFixture(root);
  }
}

function readMarker(markerPath) {
  return JSON.parse(readFileSync(markerPath, "utf8"));
}

function assertTemporaryDbWasRemoved(dbPath) {
  assert.throws(
    () => lstatSync(dirname(dbPath)),
    (error) => error?.code === "ENOENT",
    "temporary build directory must be absent, including dangling reparse points",
  );
}

function removeTestEntry(entryPath) {
  if (!entryPath) return;
  let stats;
  try {
    stats = lstatSync(entryPath);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  if (stats.isSymbolicLink()) {
    unlinkSync(entryPath);
    return;
  }
  rmSync(entryPath, {
    recursive: stats.isDirectory(),
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });
}

function waitForFile(filePath, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      lstatSync(filePath);
      return;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  throw new Error(`Timed out waiting for fixture marker: ${filePath}`);
}

function gitTestEnvironment(extraEnvironment = {}) {
  const environment = { ...process.env, ...extraEnvironment };
  for (const key of Object.keys(environment)) {
    if (key.toUpperCase().startsWith("GIT_")) delete environment[key];
  }
  environment.GIT_CONFIG_NOSYSTEM = "1";
  environment.GIT_CONFIG_GLOBAL = process.platform === "win32" ? "NUL" : "/dev/null";
  environment.GIT_OPTIONAL_LOCKS = "0";
  environment.GIT_TERMINAL_PROMPT = "0";
  return environment;
}

function runFixtureGit(root, args) {
  const result = spawnSync(resolveTrustedGitExecutable(), ["-C", root, ...args], {
    cwd: root,
    env: gitTestEnvironment(),
    encoding: "utf8",
    windowsHide: true,
    shell: false,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, 0, `${result.stdout ?? ""}${result.stderr ?? ""}`);
  return result.stdout.trim().toLowerCase();
}

function initializeGitFixture(root, sourceContents = "fixture-source\n") {
  writeFileSync(
    join(root, ".gitignore"),
    "/data/\n/.next/\n/.next-*/\n/node_modules/\n",
    "utf8",
  );
  writeFileSync(join(root, "source.txt"), sourceContents, "utf8");
  runFixtureGit(root, ["init", "--quiet"]);
  runFixtureGit(root, ["add", "--", ".gitignore", "source.txt"]);
  runFixtureGit(root, [
    "-c",
    "user.name=LORE Hermetic Test",
    "-c",
    "user.email=lore-hermetic-test@example.invalid",
    "commit",
    "--quiet",
    "-m",
    "fixture",
  ]);
  return runFixtureGit(root, ["rev-parse", "--verify", "HEAD^{commit}"]);
}

function fixtureBuildSource(buildId = "fixture-build", extraSource = "") {
  return `
    const fs = require("node:fs");
    const path = require("node:path");
    const distDir = path.join(process.cwd(), ".next");
    fs.rmSync(distDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(distDir, "server"), { recursive: true });
    fs.mkdirSync(path.join(distDir, "cache"), { recursive: true });
    fs.mkdirSync(path.join(distDir, "dev"), { recursive: true });
    fs.writeFileSync(path.join(distDir, "BUILD_ID"), ${JSON.stringify(`${buildId}\n`)});
    fs.writeFileSync(path.join(distDir, "server", "app.js"), "compiled-output");
    fs.writeFileSync(path.join(distDir, "cache", "mutable-cache"), String(Date.now()));
    fs.writeFileSync(path.join(distDir, "dev", "mutable-dev"), String(Date.now()));
    ${extraSource}
  `;
}

function runProvenanceFixtureChild(root, source, { seal = true, extraEnv = {} } = {}) {
  return runHermeticBuild({
    projectRoot: root,
    command: process.execPath,
    args: ["-e", source],
    env: {
      ...process.env,
      NEXT_DIST_DIR: ".next",
      ...extraEnv,
    },
    stdio: "pipe",
    encoding: "utf8",
    buildProvenance: { distDir: join(root, ".next"), seal },
  });
}

function fixtureProvenancePath(root) {
  return join(root, ".next", BUILD_PROVENANCE_FILENAME);
}

function installFixtureNextCli(root, source) {
  const nextBinDirectory = join(root, "node_modules", "next", "dist", "bin");
  mkdirSync(nextBinDirectory, { recursive: true });
  writeFileSync(join(nextBinDirectory, "next"), source, "utf8");
}

function runBuildWrapperCli(root, wrapperArgs, { seal = true } = {}) {
  return spawnSync(
    process.execPath,
    [hermeticBuildWrapperPath, ...(seal ? ["--seal-provenance"] : []), ...wrapperArgs],
    {
      cwd: root,
      env: { ...process.env, NEXT_DIST_DIR: ".next" },
      encoding: "utf8",
      windowsHide: true,
      shell: false,
    },
  );
}

{
  const root = createFixture();
  const target = mkdtempSync(join(systemTempRoot, "lore-next-dist-target-"));
  const sentinelPath = join(target, "sentinel.txt");
  const ordinaryDir = join(root, ".next-build-check");
  const filePath = join(root, ".next-file");
  const reparsePath = join(root, ".next-link");
  try {
    mkdirSync(ordinaryDir);
    writeFileSync(filePath, "must-not-be-removed", "utf8");
    writeFileSync(sentinelPath, "must-survive", "utf8");
    symlinkSync(target, reparsePath, process.platform === "win32" ? "junction" : "dir");

    assert.deepEqual(resolveNextDistDir(undefined, root), {
      relativePath: ".next",
      resolvedPath: join(root, ".next"),
    });
    assert.deepEqual(resolveNextDistDir(".next-build-check", root), {
      relativePath: ".next-build-check",
      resolvedPath: ordinaryDir,
    });
    for (const value of [
      "../outside",
      ".next/child",
      ".next-../outside",
      resolve(root, ".next-absolute"),
    ]) {
      assert.throws(() => resolveNextDistDir(value, root), /NEXT_DIST_DIR/);
    }
    assert.throws(() => resolveNextDistDir(".next-file", root), /reparse point or non-directory/);
    assert.throws(() => resolveNextDistDir(".next-link", root), /reparse point|symlink|junction/);
    assert.equal(readFileSync(filePath, "utf8"), "must-not-be-removed");
    assert.equal(readFileSync(sentinelPath, "utf8"), "must-survive");
  } finally {
    removeTestEntry(reparsePath);
    removeFixture(root);
    removeFixture(target);
  }
}

{
  const root = createFixture();
  const distDir = join(root, ".next");
  const observationPath = join(root, "ordinary-build-marker-observation.txt");
  try {
    mkdirSync(distDir);
    writeFileSync(fixtureProvenancePath(root), "stale-marker", "utf8");
    const source = `
      const fs = require("node:fs");
      const path = require("node:path");
      const markerPath = path.join(process.cwd(), ".next", ${JSON.stringify(BUILD_PROVENANCE_FILENAME)});
      fs.writeFileSync(${JSON.stringify(observationPath)}, fs.existsSync(markerPath) ? "present" : "absent");
      fs.mkdirSync(path.join(process.cwd(), ".next", "server"), { recursive: true });
      fs.writeFileSync(path.join(process.cwd(), ".next", "BUILD_ID"), "ordinary-build\\n");
      fs.writeFileSync(path.join(process.cwd(), ".next", "server", "app.js"), "ordinary-output");
    `;
    const outcome = runProvenanceFixtureChild(root, source, { seal: false });
    assert.equal(outcome.result.status, 0);
    assert.equal(readFileSync(observationPath, "utf8"), "absent", "ordinary builds must invalidate a stale marker before their child starts");
    assert.equal(existsSync(fixtureProvenancePath(root)), false);
    assert.equal(outcome.buildProvenance.status, "unsealed");
    assert.equal(outcome.buildProvenance.invalidated.removed, true);
  } finally {
    removeFixture(root);
  }
}

{
  const root = createFixture();
  const childMarkerPath = join(root, ".next", "fixture-next-ran.txt");
  try {
    initializeGitFixture(root);
    mkdirSync(join(root, ".next", "server"), { recursive: true });
    writeFileSync(join(root, ".next", "BUILD_ID"), "stale-build\n", "utf8");
    writeFileSync(join(root, ".next", "server", "app.js"), "stale-output", "utf8");
    installFixtureNextCli(root, `
      const fs = require("node:fs");
      const path = require("node:path");
      fs.writeFileSync(path.join(process.cwd(), ".next", "fixture-next-ran.txt"), "ran");
    `);

    for (const extraArguments of [
      ["--help"],
      ["--debug"],
      ["--experimental-build-mode=compile"],
    ]) {
      const result = runBuildWrapperCli(root, extraArguments);
      assert.notEqual(
        result.status,
        0,
        `sealed builds must reject child arguments: ${extraArguments.join(" ")}`,
      );
      assert.match(
        `${result.stdout ?? ""}${result.stderr ?? ""}`,
        /sealed build provenance does not accept Next build arguments/i,
      );
      assert.equal(existsSync(childMarkerPath), false, "rejected sealed arguments must not start Next");
      assert.equal(existsSync(fixtureProvenancePath(root)), false);
    }

    const ordinary = runBuildWrapperCli(root, ["--help"], { seal: false });
    assert.equal(ordinary.status, 0, `${ordinary.stdout ?? ""}${ordinary.stderr ?? ""}`);
    assert.equal(existsSync(childMarkerPath), true, "ordinary builds must continue forwarding supported Next arguments");
  } finally {
    removeFixture(root);
  }
}

{
  const root = createFixture();
  const sentinelPath = join(root, ".next", "stale-sentinel.txt");
  const observationPath = join(root, ".next", "stale-observation.txt");
  try {
    initializeGitFixture(root);
    mkdirSync(join(root, ".next", "server"), { recursive: true });
    writeFileSync(join(root, ".next", "BUILD_ID"), "stale-build\n", "utf8");
    writeFileSync(join(root, ".next", "server", "app.js"), "stale-output", "utf8");
    writeFileSync(sentinelPath, "must-not-survive", "utf8");
    installFixtureNextCli(root, `
      const fs = require("node:fs");
      const path = require("node:path");
      const distDir = path.join(process.cwd(), ".next");
      const staleWasPresent = fs.existsSync(path.join(distDir, "stale-sentinel.txt"));
      fs.mkdirSync(path.join(distDir, "server"), { recursive: true });
      fs.writeFileSync(path.join(distDir, "BUILD_ID"), "fresh-build\\n");
      fs.writeFileSync(path.join(distDir, "server", "app.js"), "fresh-output");
      fs.writeFileSync(path.join(distDir, "stale-observation.txt"), staleWasPresent ? "present" : "absent");
    `);

    const result = runBuildWrapperCli(root, []);
    assert.equal(result.status, 0, `${result.stdout ?? ""}${result.stderr ?? ""}`);
    assert.equal(readFileSync(observationPath, "utf8"), "absent");
    assert.equal(existsSync(sentinelPath), false, "sealed builds must start from an absent canonical output");
    assert.equal(readBuildProvenanceMarker(root, join(root, ".next")).marker.buildId, "fresh-build");
  } finally {
    removeFixture(root);
  }
}

{
  const root = createFixture();
  const externalTarget = createFixture();
  const externalSentinelPath = join(externalTarget, "must-survive.txt");
  try {
    initializeGitFixture(root);
    mkdirSync(join(root, ".next"));
    writeFileSync(externalSentinelPath, "outside-canonical-output", "utf8");
    symlinkSync(
      externalTarget,
      join(root, ".next", "nested-external-link"),
      process.platform === "win32" ? "junction" : "dir",
    );
    installFixtureNextCli(root, `
      const fs = require("node:fs");
      const path = require("node:path");
      const distDir = path.join(process.cwd(), ".next");
      fs.mkdirSync(path.join(distDir, "server"), { recursive: true });
      fs.writeFileSync(path.join(distDir, "BUILD_ID"), "reparse-safe-build\\n");
      fs.writeFileSync(path.join(distDir, "server", "app.js"), "fresh-output");
    `);

    const result = runBuildWrapperCli(root, []);
    assert.equal(result.status, 0, `${result.stdout ?? ""}${result.stderr ?? ""}`);
    assert.equal(
      readFileSync(externalSentinelPath, "utf8"),
      "outside-canonical-output",
      "clearing canonical .next must not traverse a nested symlink, junction, or reparse point",
    );
  } finally {
    removeFixture(root);
    removeFixture(externalTarget);
  }
}

{
  const root = createFixture();
  const sentinelPath = join(root, ".next", "stale-sentinel.txt");
  try {
    initializeGitFixture(root);
    mkdirSync(join(root, ".next", "server"), { recursive: true });
    writeFileSync(join(root, ".next", "BUILD_ID"), "stale-noop-build\n", "utf8");
    writeFileSync(join(root, ".next", "server", "app.js"), "stale-noop-output", "utf8");
    writeFileSync(sentinelPath, "must-not-be-sealed", "utf8");
    installFixtureNextCli(root, "// Intentional no-op fixture: a partial/no-op build must not seal stale output.\n");

    const result = runBuildWrapperCli(root, []);
    assert.notEqual(result.status, 0, "a no-op sealed child must fail after the fresh output boundary is cleared");
    assert.equal(existsSync(sentinelPath), false);
    assert.equal(existsSync(fixtureProvenancePath(root)), false);
  } finally {
    removeFixture(root);
  }
}

{
  const root = createFixture();
  try {
    const expectedHead = initializeGitFixture(root);
    const outcome = runProvenanceFixtureChild(root, fixtureBuildSource());
    assert.equal(outcome.result.status, 0);
    assert.equal(outcome.buildProvenance.status, "sealed");
    assert.equal(outcome.buildProvenance.sourceRevisionSha, expectedHead);

    const markerObservation = readBuildProvenanceMarker(root, join(root, ".next"));
    const outputIdentity = collectBuildOutputIdentity(root, join(root, ".next"));
    assert.equal(markerObservation.marker.sourceRevisionSha, expectedHead);
    assert.equal(markerObservation.marker.relativeBuildRoot, ".next");
    assert.equal(markerObservation.marker.outputIdentity.contentDigestSha256, outputIdentity.contentDigestSha256);
    assert.equal(outputIdentity.fileCount, 2, "marker, cache, and dev files must be outside the digest domain");
    assert.equal(lstatSync(fixtureProvenancePath(root)).isFile(), true, "atomic publication must leave a regular marker file");
    assert.equal(
      readdirSync(join(root, ".next")).some((name) => name.startsWith(".lore-build-provenance.") && name.endsWith(".tmp")),
      false,
      "atomic publication must not leave a temporary marker",
    );

    writeFileSync(join(root, ".next", "cache", "mutable-cache"), "changed-cache", "utf8");
    writeFileSync(join(root, ".next", "dev", "mutable-dev"), "changed-dev", "utf8");
    const verified = verifyBuildProvenance({
      projectRoot: root,
      distDir: join(root, ".next"),
      expectedSourceRevisionSha: expectedHead,
      expectedOutputIdentity: outputIdentity,
    });
    assert.equal(verified.outputIdentity.contentDigestSha256, outputIdentity.contentDigestSha256);
  } finally {
    removeFixture(root);
  }
}

{
  const root = createFixture();
  const childMarkerPath = join(root, "dirty-child-ran.txt");
  try {
    initializeGitFixture(root);
    mkdirSync(join(root, ".next"));
    writeFileSync(fixtureProvenancePath(root), "stale-marker", "utf8");
    writeFileSync(join(root, "dirty-untracked.txt"), "dirty", "utf8");
    assert.throws(
      () => runProvenanceFixtureChild(
        root,
        `require("node:fs").writeFileSync(${JSON.stringify(childMarkerPath)}, "ran");`,
      ),
      /requires a clean worktree/,
      "sealed builds must fail before their child starts on a dirty worktree",
    );
    assert.equal(existsSync(childMarkerPath), false);
    assert.equal(existsSync(fixtureProvenancePath(root)), false, "dirty sealed builds must still invalidate stale provenance");
  } finally {
    removeFixture(root);
  }
}

for (const testCase of [
  {
    setFlag: "--assume-unchanged",
    clearFlag: "--no-assume-unchanged",
    label: "assume-unchanged",
  },
  {
    setFlag: "--skip-worktree",
    clearFlag: "--no-skip-worktree",
    label: "skip-worktree",
  },
]) {
  const root = createFixture();
  const childMarkerPath = join(root, ".next", "hidden-index-flag-child-ran.txt");
  try {
    initializeGitFixture(root);
    runFixtureGit(root, ["update-index", testCase.setFlag, "--", "source.txt"]);
    writeFileSync(join(root, "source.txt"), `hidden-${testCase.label}-change\n`, "utf8");
    assert.equal(
      runFixtureGit(root, ["status", "--porcelain=v1", "--untracked-files=all"]),
      "",
      `${testCase.label} must reproduce the status-based false-clean condition`,
    );

    assert.throws(
      () => runProvenanceFixtureChild(
        root,
        fixtureBuildSource(`hidden-${testCase.label}`, `
          fs.writeFileSync(${JSON.stringify(childMarkerPath)}, "ran");
        `),
      ),
      /non-default tracked-file index flags/i,
      `sealed builds must reject ${testCase.label} before the child starts`,
    );
    assert.equal(existsSync(childMarkerPath), false);
    assert.equal(existsSync(fixtureProvenancePath(root)), false);

    runFixtureGit(root, ["update-index", testCase.clearFlag, "--", "source.txt"]);
    assert.notEqual(
      runFixtureGit(root, ["status", "--porcelain=v1", "--untracked-files=all"]),
      "",
      `clearing ${testCase.label} must expose the changed tracked file`,
    );
    writeFileSync(join(root, "source.txt"), "fixture-source\n", "utf8");
    runFixtureGit(root, ["update-index", "--refresh"]);
    assert.equal(runFixtureGit(root, ["status", "--porcelain=v1", "--untracked-files=all"]), "");
    assert.equal(runProvenanceFixtureChild(root, fixtureBuildSource()).buildProvenance.status, "sealed");
  } finally {
    removeFixture(root);
  }
}

{
  const root = createFixture();
  try {
    initializeGitFixture(root);
    const gitExecutable = resolveTrustedGitExecutable();
    const source = fixtureBuildSource("head-drift-build", `
      const { spawnSync } = require("node:child_process");
      fs.writeFileSync(path.join(process.cwd(), "source.txt"), "changed-during-build\\n");
      const commit = spawnSync(${JSON.stringify(gitExecutable)}, [
        "-C", process.cwd(),
        "-c", "user.name=LORE Hermetic Test",
        "-c", "user.email=lore-hermetic-test@example.invalid",
        "commit", "--quiet", "-am", "head drift",
      ], { encoding: "utf8", windowsHide: true, shell: false });
      if (commit.status !== 0) throw new Error(commit.stderr || "fixture commit failed");
    `);
    assert.throws(
      () => runProvenanceFixtureChild(root, source),
      /Git HEAD changed during the sealed build/,
      "a clean but different post-build HEAD must not receive a marker",
    );
    assert.equal(existsSync(fixtureProvenancePath(root)), false);
  } finally {
    removeFixture(root);
  }
}

{
  const root = createFixture();
  try {
    initializeGitFixture(root);
    const source = fixtureBuildSource("dirty-after-build", `
      fs.writeFileSync(path.join(process.cwd(), "source.txt"), "dirty-after-build\\n");
    `);
    assert.throws(
      () => runProvenanceFixtureChild(root, source),
      /requires a clean worktree/,
      "a post-build dirty worktree must not receive a marker",
    );
    assert.equal(existsSync(fixtureProvenancePath(root)), false);
  } finally {
    removeFixture(root);
  }
}

{
  const root = createFixture();
  try {
    initializeGitFixture(root);
    mkdirSync(join(root, ".next"));
    writeFileSync(fixtureProvenancePath(root), "stale-marker", "utf8");
    const outcome = runProvenanceFixtureChild(root, `
      const fs = require("node:fs");
      const path = require("node:path");
      const distDir = path.join(process.cwd(), ".next");
      fs.mkdirSync(distDir, { recursive: true });
      fs.writeFileSync(path.join(distDir, ${JSON.stringify(BUILD_PROVENANCE_FILENAME)}), "child-forged-marker");
      fs.writeFileSync(path.join(distDir, ".lore-build-provenance.child.tmp"), "child-forged-temp");
      process.exit(7);
    `);
    assert.equal(outcome.result.status, 7, "failed build child status must be preserved");
    assert.equal(existsSync(fixtureProvenancePath(root)), false, "failed builds must not retain stale provenance");
    assert.equal(
      readdirSync(join(root, ".next")).some((name) => name.startsWith(".lore-build-provenance.") && name.endsWith(".tmp")),
      false,
      "failed builds must remove child-forged provenance temp files",
    );
  } finally {
    removeFixture(root);
  }
}

{
  const root = createFixture();
  try {
    mkdirSync(join(root, ".next"));
    const outcome = runProvenanceFixtureChild(root, `
      const fs = require("node:fs");
      const path = require("node:path");
      const distDir = path.join(process.cwd(), ".next");
      fs.writeFileSync(path.join(distDir, ${JSON.stringify(BUILD_PROVENANCE_FILENAME)}), "child-forged-marker");
      fs.writeFileSync(path.join(distDir, ".lore-build-provenance.child.tmp"), "child-forged-temp");
    `, { seal: false });
    assert.equal(outcome.result.status, 0);
    assert.equal(existsSync(fixtureProvenancePath(root)), false, "ordinary builds must not retain child-forged provenance");
    assert.equal(
      readdirSync(join(root, ".next")).some((name) => name.startsWith(".lore-build-provenance.") && name.endsWith(".tmp")),
      false,
      "ordinary builds must remove child-forged provenance temp files",
    );
  } finally {
    removeFixture(root);
  }
}

{
  const root = createFixture();
  try {
    initializeGitFixture(root);
    runProvenanceFixtureChild(root, fixtureBuildSource("mutation-build"));
    appendFileSync(join(root, ".next", "server", "app.js"), "mutated-after-seal", "utf8");
    assert.throws(
      () => verifyBuildProvenance({ projectRoot: root, distDir: join(root, ".next") }),
      /output identity|does not match/,
      "post-seal output mutation must invalidate the marker",
    );
  } finally {
    removeFixture(root);
  }
}

{
  const root = createFixture();
  try {
    initializeGitFixture(root);
    runProvenanceFixtureChild(root, fixtureBuildSource("build-id-match"));
    const markerPath = fixtureProvenancePath(root);
    const marker = JSON.parse(readFileSync(markerPath, "utf8"));
    marker.buildId = "forged-build-id";
    writeFileSync(markerPath, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
    assert.throws(
      () => verifyBuildProvenance({ projectRoot: root, distDir: join(root, ".next") }),
      /BUILD_ID fields disagree/,
      "marker BUILD_ID disagreement must fail closed",
    );
  } finally {
    removeFixture(root);
  }
}

{
  const root = createFixture();
  const alternateRoot = createFixture();
  try {
    const expectedHead = initializeGitFixture(root, "real-source\n");
    const alternateHead = initializeGitFixture(alternateRoot, "alternate-source\n");
    assert.notEqual(expectedHead, alternateHead);
    runProvenanceFixtureChild(root, fixtureBuildSource("poison-resistant-build"), {
      extraEnv: {
        GIT_DIR: join(alternateRoot, ".git"),
        GIT_WORK_TREE: alternateRoot,
      },
    });
    const marker = readBuildProvenanceMarker(root, join(root, ".next")).marker;
    assert.equal(marker.sourceRevisionSha, expectedHead, "inherited Git redirection must not change provenance root");
    assert.notEqual(marker.sourceRevisionSha, alternateHead);
  } finally {
    removeFixture(root);
    removeFixture(alternateRoot);
  }
}

{
  const root = createFixture();
  try {
    const protectedBefore = snapshotProtectedDatabaseFiles(root);
    const source = `
      const fs = require("node:fs");
      fs.writeFileSync(process.env.LORE_DB_PATH, "isolated-build-db");
      fs.writeFileSync(process.env.HERMETIC_BUILD_TEST_MARKER, JSON.stringify({
        dbPath: process.env.LORE_DB_PATH,
        purge: process.env.LORE_ALLOW_CONTRACT_SCOPE_PURGE,
        hermetic: process.env.LORE_HERMETIC_BUILD,
        dist: process.env.NEXT_DIST_DIR,
        tsconfig: process.env.NEXT_TSCONFIG_PATH,
      }));
    `;
    const first = runFixtureChild(root, source, "first.json");
    const second = runFixtureChild(root, source, "second.json");
    const firstMarker = readMarker(first.markerPath);
    const secondMarker = readMarker(second.markerPath);

    assert.equal(first.result.status, 0);
    assert.equal(second.result.status, 0);
    assert.notEqual(firstMarker.dbPath, secondMarker.dbPath, "every build must receive a unique database path");
    assert.equal(isAbsolute(firstMarker.dbPath), true);
    assert.equal(relative(root, firstMarker.dbPath).startsWith(".."), true);
    assert.equal(firstMarker.purge, "0", "build must disable contract-scope purge");
    assert.equal(firstMarker.hermetic, "1", "build must set the hermetic config marker itself");
    assert.equal(firstMarker.dist, ".next-test-output");
    assert.equal(firstMarker.tsconfig, "tsconfig.test.json");
    assertTemporaryDbWasRemoved(firstMarker.dbPath);
    assertTemporaryDbWasRemoved(secondMarker.dbPath);
    assert.deepEqual(snapshotProtectedDatabaseFiles(root), protectedBefore);
  } finally {
    removeFixture(root);
  }
}

{
  const root = createFixture();
  const temporaryRoot = mkdtempSync(join(systemTempRoot, "lore-hermetic-lock-race-"));
  const moduleUrl = pathToFileURL(resolve("scripts", "run-hermetic-build.mjs")).href;
  try {
    const race = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { createRequire, syncBuiltinESMExports } from "node:module";
      import { dirname, join } from "node:path";
      const require = createRequire(import.meta.url);
      const mutableFs = require("node:fs");
      const originalMkdirSync = mutableFs.mkdirSync;
      const lockRoot = join(${JSON.stringify(temporaryRoot)}, "lore-build-output-locks");
      let injected = false;
      mutableFs.mkdirSync = (target, options) => {
        if (!injected && dirname(target) === lockRoot) {
          injected = true;
          mutableFs.rmSync(lockRoot, { recursive: true, force: true });
        }
        return originalMkdirSync(target, options);
      };
      syncBuiltinESMExports();
      try {
        const { acquireBuildOutputLock } = await import(${JSON.stringify(moduleUrl)} + "?lock-root-race");
        const lock = acquireBuildOutputLock(
          ${JSON.stringify(root)},
          ${JSON.stringify(temporaryRoot)},
        );
        lock.release();
        process.stdout.write(JSON.stringify({ injected }));
      } finally {
        mutableFs.mkdirSync = originalMkdirSync;
        syncBuiltinESMExports();
      }
    `], { cwd: resolve("."), encoding: "utf8" });
    assert.equal(race.status, 0, race.stderr);
    assert.deepEqual(JSON.parse(race.stdout), { injected: true });
  } finally {
    removeFixture(temporaryRoot);
    removeFixture(root);
  }
}

{
  const root = createFixture();
  const markerPath = join(root, "lock-held.txt");
  const moduleUrl = pathToFileURL(resolve("scripts", "run-hermetic-build.mjs")).href;
  const child = spawn(process.execPath, ["--input-type=module", "-e", `
    import { writeFileSync } from "node:fs";
    import { acquireBuildOutputLock } from ${JSON.stringify(moduleUrl)};
    const lock = acquireBuildOutputLock(${JSON.stringify(root)});
    writeFileSync(${JSON.stringify(markerPath)}, "held");
    setTimeout(() => { lock.release(); }, 350);
  `], { cwd: resolve("."), stdio: "pipe" });
  try {
    waitForFile(markerPath);
    const startedAt = Date.now();
    const lock = acquireBuildOutputLock(root);
    const elapsedMs = Date.now() - startedAt;
    lock.release();
    assert.ok(elapsedMs >= 200, `second build must wait for the output lock, elapsed=${elapsedMs}`);
  } finally {
    child.kill();
    removeFixture(root);
  }
}

{
  const root = createFixture();
  const markerPath = join(root, "abandoned-lock.txt");
  const moduleUrl = pathToFileURL(resolve("scripts", "run-hermetic-build.mjs")).href;
  try {
    const abandonedOwner = spawnSync(process.execPath, ["--input-type=module", "-e", `
      import { writeFileSync } from "node:fs";
      import { acquireBuildOutputLock } from ${JSON.stringify(moduleUrl)};
      acquireBuildOutputLock(${JSON.stringify(root)});
      writeFileSync(${JSON.stringify(markerPath)}, "owner-exited-without-release");
    `], { cwd: resolve("."), encoding: "utf8" });
    assert.equal(abandonedOwner.status, 0, abandonedOwner.stderr);
    assert.equal(readFileSync(markerPath, "utf8"), "owner-exited-without-release");

    const startedAt = Date.now();
    const recoveredLock = acquireBuildOutputLock(root);
    const elapsedMs = Date.now() - startedAt;
    try {
      assert.ok(elapsedMs < 5_000, `dead build owner must be reclaimed promptly, elapsed=${elapsedMs}`);
    } finally {
      recoveredLock.release();
    }
  } finally {
    removeFixture(root);
  }
}

{
  const root = createFixture();
  const target = mkdtempSync(join(systemTempRoot, "lore-hermetic-junction-target-"));
  const sentinelPath = join(target, "sentinel.txt");
  const markerPath = join(root, "junction.json");
  let ownedDirectory;
  try {
    writeFileSync(sentinelPath, "must-survive", "utf8");
    const source = `
      const fs = require("node:fs");
      const path = require("node:path");
      const ownedDirectory = path.dirname(process.env.LORE_DB_PATH);
      fs.writeFileSync(process.env.HERMETIC_BUILD_TEST_MARKER, JSON.stringify({ ownedDirectory }));
      fs.rmSync(ownedDirectory, { recursive: true, force: true });
      fs.symlinkSync(process.env.HERMETIC_BUILD_TEST_TARGET, ownedDirectory, "junction");
    `;
    assert.throws(
      () => runFixtureChild(root, source, "junction.json", {
        HERMETIC_BUILD_TEST_TARGET: target,
      }),
      /symlink, junction, reparse point, or non-directory/,
      "cleanup must reject a child-created junction",
    );
    ownedDirectory = JSON.parse(readFileSync(markerPath, "utf8")).ownedDirectory;
    assert.equal(lstatSync(ownedDirectory).isSymbolicLink(), true);
    assert.equal(readFileSync(sentinelPath, "utf8"), "must-survive");
  } finally {
    removeTestEntry(ownedDirectory);
    removeFixture(root);
    removeFixture(target);
  }
}

{
  const root = createFixture();
  const markerPath = join(root, "replacement.json");
  let ownedDirectory;
  try {
    const source = `
      const fs = require("node:fs");
      const path = require("node:path");
      const ownedDirectory = path.dirname(process.env.LORE_DB_PATH);
      fs.writeFileSync(process.env.HERMETIC_BUILD_TEST_MARKER, JSON.stringify({ ownedDirectory }));
      fs.rmSync(ownedDirectory, { recursive: true, force: true });
      fs.mkdirSync(ownedDirectory);
      fs.writeFileSync(path.join(ownedDirectory, "replacement.txt"), "must-survive");
    `;
    assert.throws(
      () => runFixtureChild(root, source, "replacement.json"),
      /Refusing to clean a replaced hermetic build directory/,
      "cleanup must reject a different directory at the owned lexical path",
    );
    ownedDirectory = JSON.parse(readFileSync(markerPath, "utf8")).ownedDirectory;
    assert.equal(readFileSync(join(ownedDirectory, "replacement.txt"), "utf8"), "must-survive");
  } finally {
    removeTestEntry(ownedDirectory);
    removeFixture(root);
  }
}

{
  const root = createFixture();
  try {
    const source = `
      const fs = require("node:fs");
      fs.writeFileSync(process.env.LORE_DB_PATH, "failed-build-db");
      fs.writeFileSync(process.env.HERMETIC_BUILD_TEST_MARKER, process.env.LORE_DB_PATH);
      process.exit(7);
    `;
    const outcome = runFixtureChild(root, source, "failed.txt");
    assert.equal(outcome.result.status, 7, "child exit status must be preserved");
    assertTemporaryDbWasRemoved(readFileSync(outcome.markerPath, "utf8"));
  } finally {
    removeFixture(root);
  }
}

for (const testCase of [
  {
    label: "existence",
    source: `require("node:fs").rmSync(require("node:path").join(process.cwd(), "data", "lore-v10.sqlite-shm"));`,
  },
  {
    label: "hash",
    source: `require("node:fs").writeFileSync(require("node:path").join(process.cwd(), "data", "lore-v10.sqlite-wal"), "changed-content");`,
  },
  {
    label: "mtime",
    source: `
      const fs = require("node:fs");
      const path = require("node:path").join(process.cwd(), "data", "lore-v10.sqlite");
      const stats = fs.statSync(path);
      fs.utimesSync(path, stats.atime, new Date(stats.mtimeMs + 5000));
    `,
  },
]) {
  const root = createFixture();
  try {
    assert.throws(
      () => runFixtureChild(root, testCase.source, `${testCase.label}.json`),
      /Hermetic build changed protected database state/,
      `${testCase.label} drift must fail closed`,
    );
  } finally {
    removeFixture(root);
  }
}

{
  const root = createFixture();
  const target = mkdtempSync(join(systemTempRoot, "lore-hermetic-protected-target-"));
  const sentinelPath = join(target, "sentinel.txt");
  const protectedPath = join(root, "data", "lore-v10.sqlite");
  try {
    writeFileSync(sentinelPath, "must-survive", "utf8");
    const source = `
      const fs = require("node:fs");
      const path = require("node:path");
      const protectedPath = path.join(process.cwd(), "data", "lore-v10.sqlite");
      fs.rmSync(protectedPath, { force: true });
      fs.symlinkSync(process.env.HERMETIC_BUILD_TEST_TARGET, protectedPath, "junction");
    `;
    assert.throws(
      () => runFixtureChild(root, source, "protected-junction.json", {
        HERMETIC_BUILD_TEST_TARGET: target,
      }),
      /Protected database path must be absent or a regular file/,
      "protected database snapshots must reject reparse points",
    );
    assert.equal(lstatSync(protectedPath).isSymbolicLink(), true);
    assert.equal(readFileSync(sentinelPath, "utf8"), "must-survive");
  } finally {
    removeTestEntry(protectedPath);
    removeFixture(root);
    removeFixture(target);
  }
}

{
  const root = createFixture();
  const markerPath = join(root, "nonzero-drift.txt");
  try {
    const source = `
      const fs = require("node:fs");
      const path = require("node:path");
      fs.writeFileSync(process.env.HERMETIC_BUILD_TEST_MARKER, process.env.LORE_DB_PATH);
      fs.writeFileSync(path.join(process.cwd(), "data", "lore-v10.sqlite-wal"), "changed-and-failed");
      process.exit(7);
    `;
    let caught;
    try {
      runFixtureChild(root, source, "nonzero-drift.txt");
    } catch (error) {
      caught = error;
    }
    assert.equal(caught instanceof AggregateError, true);
    const childOutcome = caught.errors.find((error) => error.name === "HermeticBuildChildOutcomeError");
    assert.equal(childOutcome?.status, 7, "combined failure must preserve child status");
    assert.equal(childOutcome?.signal, null);
    assert.equal(
      caught.errors.some((error) => /changed protected database state/.test(error.message)),
      true,
      "combined failure must preserve invariant diagnostics",
    );
    assertTemporaryDbWasRemoved(readFileSync(markerPath, "utf8"));
  } finally {
    removeFixture(root);
  }
}

const packageJson = JSON.parse(readFileSync(resolve("package.json"), "utf8"));
assert.equal(packageJson.scripts.build, "node scripts/run-hermetic-build.mjs");
assert.equal(packageJson.scripts["build:sealed"], "node scripts/run-hermetic-build.mjs --seal-provenance");
assert.equal(packageJson.scripts["test:build-hermetic"], "node scripts/test-hermetic-build.mjs");

const summarySource = readFileSync(resolve("scripts", "run-build-summary.mjs"), "utf8");
assert.match(summarySource, /"run", "build"/);

const isolatedSource = readFileSync(resolve("scripts", "run-isolated-build.mjs"), "utf8");
assert.match(isolatedSource, /run-hermetic-build\.mjs/);
assert.doesNotMatch(isolatedSource, /next["']?,\s*"dist"[\s\S]*"build"/);

const ciSource = readFileSync(resolve(".github", "workflows", "ci.yml"), "utf8");
assert.doesNotMatch(ciSource, /run:\s+(?:npx\s+)?next build/);
assert.match(ciSource, /run:\s+npm run build\s*$/m);
assert.match(ciSource, /run:\s+npm run build:summary\s*$/m);

function configProbe(phase, marker, command = "build", extraEnv = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === "lore_hermetic_build") delete env[key];
  }
  if (marker !== undefined) env.LORE_HERMETIC_BUILD = marker;
  Object.assign(env, extraEnv);
  env.HERMETIC_CONFIG_TEST_PHASE = phase;
  const configUrl = pathToFileURL(resolve("next.config.mjs")).href;
  const source = `
    const configureNext = (await import(${JSON.stringify(configUrl)})).default;
    const result = configureNext(process.env.HERMETIC_CONFIG_TEST_PHASE);
    if (!result || typeof result !== "object") throw new Error("Next config factory returned no config");
  `;
  return spawnSync(process.execPath, ["--input-type=module", "-e", source, command], {
    cwd: resolve("."),
    env,
    encoding: "utf8",
  });
}

const rejectedConfig = configProbe("phase-production-build");
assert.notEqual(rejectedConfig.status, 0);
assert.match(
  `${rejectedConfig.stdout}${rejectedConfig.stderr}`,
  /Production builds must run through `npm run build`/,
);
assert.equal(configProbe("phase-production-build", "1").status, 0);
const escapingDistConfig = configProbe("phase-production-build", "1", "build", {
  NEXT_DIST_DIR: "../outside",
});
assert.notEqual(escapingDistConfig.status, 0);
assert.match(`${escapingDistConfig.stdout}${escapingDistConfig.stderr}`, /NEXT_DIST_DIR/);
assert.equal(
  configProbe("phase-production-build", "1", "build", { NEXT_DIST_DIR: ".next-build-check" }).status,
  0,
);
assert.equal(configProbe("phase-production-build", undefined, "typegen").status, 0);
assert.equal(configProbe("phase-development-server", undefined, "dev").status, 0);

const rawNextEnv = { ...process.env };
for (const key of Object.keys(rawNextEnv)) {
  if (key.toLowerCase() === "lore_hermetic_build") delete rawNextEnv[key];
}
const rawNext = spawnSync(
  process.execPath,
  [resolve("node_modules", "next", "dist", "bin", "next"), "build", "--webpack"],
  { cwd: resolve("."), env: rawNextEnv, encoding: "utf8" },
);
assert.notEqual(rawNext.status, 0, "raw Next production build must fail closed");
assert.match(
  `${rawNext.stdout}${rawNext.stderr}`,
  /Production builds must run through `npm run build`/,
);

console.log("Hermetic build wrapper tests passed.");
