import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  acquireBuildOutputLock,
  runHermeticBuild,
  snapshotProtectedDatabaseFiles,
} from "./run-hermetic-build.mjs";

const systemTempRoot = realpathSync(tmpdir());

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

function runFixtureChild(root, source, markerName, extraEnv = {}) {
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
  });
  return { ...outcome, markerPath };
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
assert.equal(packageJson.scripts["test:build-hermetic"], "node scripts/test-hermetic-build.mjs");

const summarySource = readFileSync(resolve("scripts", "run-build-summary.mjs"), "utf8");
assert.match(summarySource, /"run", "build"/);

const isolatedSource = readFileSync(resolve("scripts", "run-isolated-build.mjs"), "utf8");
assert.match(isolatedSource, /run-hermetic-build\.mjs/);
assert.doesNotMatch(isolatedSource, /next["']?,\s*"dist"[\s\S]*"build"/);

const checkLocalSource = readFileSync(resolve("scripts", "check-local.mjs"), "utf8");
assert.match(checkLocalSource, /test:build-hermetic/);
assert.match(checkLocalSource, /hermeticBuildScript[\s\S]*kind: "build"/);

const ciSource = readFileSync(resolve(".github", "workflows", "ci.yml"), "utf8");
assert.doesNotMatch(ciSource, /run:\s+(?:npx\s+)?next build/);
assert.match(ciSource, /run:\s+npm run build\s*$/m);
assert.match(ciSource, /run:\s+npm run build:summary\s*$/m);

function configProbe(phase, marker, command = "build") {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.toLowerCase() === "lore_hermetic_build") delete env[key];
  }
  if (marker !== undefined) env.LORE_HERMETIC_BUILD = marker;
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
