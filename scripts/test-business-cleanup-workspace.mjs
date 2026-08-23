import assert from "node:assert/strict";
import { lstat, mkdtemp, mkdir, readFile, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import {
  WORKSPACE_CLEANUP_AGED_CHILD_PARENTS,
  WORKSPACE_CLEANUP_PROTECTED_AGED_CHILD_PREFIXES,
  WORKSPACE_CLEANUP_WHOLE_TARGETS,
  createWorkspaceCleanupPlan,
  formatWorkspaceCleanupBytes,
  isProtectedWorkspaceCleanupAgedChildName,
  isInsideWorkspaceRoot,
  normalizeWorkspaceCleanupByteCount,
  parseCleanupMinAgeHours,
  parseDecimalHoursToThousandths,
  runWorkspaceCleanup,
} from "./cleanup-workspace-model.mjs";

const HOUR_MS = 60 * 60 * 1000;

async function createFixture(root, relativePath, contents, mtimeMs) {
  const target = join(root, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, contents);
  const stamp = new Date(mtimeMs);
  await utimes(target, stamp, stamp);
  return target;
}

function assertCleanupPlanPolicy(candidate, root) {
  const plan = candidate(root);
  assert.equal(plan.root, resolve(root));
  assert.deepEqual(
    plan.wholeTargets.map((target) => target.slice(plan.root.length + 1).replace(/\\/g, "/")),
    [".next/cache", "playwright-report", "test-results", "coverage"],
  );
  assert.deepEqual(
    plan.agedChildParents.map((target) => target.slice(plan.root.length + 1).replace(/\\/g, "/")),
    [".tmp"],
  );
}

function assertAgeParserPolicy(candidate) {
  assert.equal(candidate("0", "age"), 0n);
  assert.equal(candidate("8", "age"), 8_000n);
  assert.equal(candidate("0.001", "age"), 1n);
  assert.equal(candidate("8.25", "age"), 8_250n);
  for (const value of ["", "01", ".5", "1.", "1.0000", "1e3", "-1", "Infinity", " 8 "]) {
    assert.throws(() => candidate(value, "age"), /canonical decimal hour value/);
  }
}

function assertContainmentPolicy(candidate, root) {
  assert.equal(candidate(root, join(root, ".tmp", "old")), true);
  assert.equal(candidate(root, root), false);
  assert.equal(candidate(root, dirname(root)), false);
  assert.equal(candidate(root, join(root, "..", "escape")), false);
  assert.equal(candidate(root, `${root}-sibling`), false);
}

function assertSummarySanitizers() {
  assert.equal(normalizeWorkspaceCleanupByteCount(0), 0);
  assert.equal(normalizeWorkspaceCleanupByteCount(1), 1);
  for (const value of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(normalizeWorkspaceCleanupByteCount(value), 0);
  }
  assert.equal(formatWorkspaceCleanupBytes(-1), "0 B");
  assert.equal(formatWorkspaceCleanupBytes(1_536), "1.5 KiB");
}

async function assertCleanupBehavior(runCleanup, root) {
  const now = 2_000_000_000_000;
  const old = now - (12 * HOUR_MS);
  const recent = now - HOUR_MS;
  const oldCache = await createFixture(root, ".next/cache/old.bin", "cache", old);
  const nestedRecent = await createFixture(root, "playwright-report/nested/recent.txt", "new", recent);
  const oldTmp = await createFixture(root, ".tmp/old-run/data.txt", "temporary", old);
  const recentTmp = await createFixture(root, ".tmp/recent-run/data.txt", "keep", recent);
  const protectedRecovery = await createFixture(
    root,
    ".tmp/protected-db-recovery-exact-20260823/lore-v10.sqlite-wal",
    "recovery",
    old,
  );
  const protectedShmRecovery = await createFixture(
    root,
    ".tmp/SHM-RECONSTRUCT-20260823/lore-v10.sqlite-shm",
    "recovery",
    old,
  );
  const protectedEnv = await createFixture(root, ".env", "do-not-touch", old);
  const protectedDependency = await createFixture(root, "node_modules/example/index.js", "keep", old);
  const protectedDatabase = await createFixture(root, "data/lore.db", "keep", old);
  const outsideRoot = await mkdtemp(join(tmpdir(), "lore-cleanup-outside-"));
  const outsideFile = await createFixture(outsideRoot, "keep.txt", "outside", old);
  try {
    const dryRun = await runCleanup({
    root,
    dryRun: true,
    summaryOnly: true,
    minAgeHours: 8,
    minAgeMs: 8 * HOUR_MS,
    now,
  });
  assert.deepEqual(dryRun, {
    status: "ok",
    mode: "dry-run",
    minAgeHours: 8,
    matchedTargets: 2,
    deletedTargets: 0,
    wouldDeleteTargets: 2,
    skippedTargets: 3,
    bytes: 14,
    bytesFormatted: "14 B",
  });
  for (const path of [oldCache, nestedRecent, oldTmp, recentTmp, protectedRecovery, protectedShmRecovery, protectedEnv, protectedDependency, protectedDatabase, outsideFile]) {
    assert.equal(Boolean(await stat(path).catch(() => null)), true, `dry-run must preserve ${path}`);
  }

  const applied = await runCleanup({
    root,
    dryRun: false,
    summaryOnly: false,
    minAgeHours: 8,
    minAgeMs: 8 * HOUR_MS,
    now,
  });
  assert.equal(applied.status, "ok");
  assert.equal(applied.mode, "apply");
  assert.equal(applied.matchedTargets, 2);
  assert.equal(applied.deletedTargets, 2);
  assert.equal(applied.wouldDeleteTargets, 0);
  assert.match(applied.targets, /\.next\/cache/);
  assert.match(applied.targets, /\.tmp\/old-run/);
  assert.equal(Boolean(await stat(oldCache).catch(() => null)), false);
  assert.equal(Boolean(await stat(oldTmp).catch(() => null)), false);
  for (const path of [nestedRecent, recentTmp, protectedRecovery, protectedShmRecovery, protectedEnv, protectedDependency, protectedDatabase, outsideFile]) {
    assert.equal(Boolean(await stat(path).catch(() => null)), true, `apply must preserve ${path}`);
  }
    assert.equal(await readFile(protectedEnv, "utf8"), "do-not-touch");
  } finally {
    await rm(outsideRoot, { recursive: true, force: true });
  }
}

async function assertReparseContainmentBehavior(runCleanup) {
  const root = await mkdtemp(join(tmpdir(), "lore-cleanup-reparse-root-"));
  const externalNext = await mkdtemp(join(tmpdir(), "lore-cleanup-reparse-next-"));
  const externalTmp = await mkdtemp(join(tmpdir(), "lore-cleanup-reparse-tmp-"));
  const rootLinkParent = await mkdtemp(join(tmpdir(), "lore-cleanup-reparse-root-link-"));
  const linkedRoot = join(rootLinkParent, "workspace");
  const nextLink = join(root, ".next");
  const tmpLink = join(root, ".tmp");
  const now = 2_000_000_000_000;
  const old = now - (12 * HOUR_MS);
  const externalCache = await createFixture(externalNext, "cache/outside-cache.txt", "outside-cache", old);
  const externalTmpChild = await createFixture(externalTmp, "outside-run/data.txt", "outside-tmp", old);
  const directoryLinkType = process.platform === "win32" ? "junction" : "dir";
  await symlink(externalNext, nextLink, directoryLinkType);
  await symlink(externalTmp, tmpLink, directoryLinkType);
  await symlink(root, linkedRoot, directoryLinkType);
  try {
    await assert.rejects(
      () => runCleanup({
        root: linkedRoot,
        dryRun: true,
        summaryOnly: true,
        minAgeHours: 8,
        minAgeMs: 8 * HOUR_MS,
        now,
      }),
      /workspace cleanup root must (?:be an ordinary non-reparse directory|not resolve through a symlink, junction, or reparse point)/,
      "reparse workspace root must fail closed",
    );

    const summary = await runCleanup({
      root,
      dryRun: false,
      summaryOnly: true,
      minAgeHours: 8,
      minAgeMs: 8 * HOUR_MS,
      now,
    });
    assert.equal(summary.status, "ok");
    assert.equal(summary.matchedTargets, 0);
    assert.equal(summary.deletedTargets, 0);
    assert.equal(summary.bytes, 0);
    assert.equal(summary.skippedTargets, 4);
    assert.equal((await lstat(nextLink)).isSymbolicLink(), true, "intermediate .next link must remain");
    assert.equal((await lstat(tmpLink)).isSymbolicLink(), true, "aged-child parent link must remain");
    assert.equal(await readFile(externalCache, "utf8"), "outside-cache");
    assert.equal(await readFile(externalTmpChild, "utf8"), "outside-tmp");
  } finally {
    await rm(rootLinkParent, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
    await rm(externalNext, { recursive: true, force: true });
    await rm(externalTmp, { recursive: true, force: true });
  }
}

async function assertCleanupCliBoundary(root) {
  const cliPath = resolve("scripts", "cleanup-workspace.mjs");
  const result = spawnSync(process.execPath, [cliPath, "--dry-run", "--summary-only"], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, CLEANUP_MIN_AGE_HOURS: "0" },
    maxBuffer: 64 * 1024,
    timeout: 15_000,
    windowsHide: true,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  const summary = JSON.parse(result.stdout.trim());
  assert.equal(summary.mode, "dry-run");
  assert.equal(summary.deletedTargets, 0);
  assert.equal(Object.hasOwn(summary, "targets"), false);
  assert.equal(Boolean(await stat(join(root, "coverage", "proof.txt")).catch(() => null)), true);
}

export async function runCleanupWorkspaceBehaviorTests() {
  assert.deepEqual(WORKSPACE_CLEANUP_WHOLE_TARGETS, [
    ".next/cache",
    "playwright-report",
    "test-results",
    "coverage",
  ]);
  assert.deepEqual(WORKSPACE_CLEANUP_AGED_CHILD_PARENTS, [".tmp"]);
  assert.deepEqual(WORKSPACE_CLEANUP_PROTECTED_AGED_CHILD_PREFIXES, [
    "protected-db-recovery-exact-",
    "shm-reconstruct-",
  ]);
  assert.equal(Object.isFrozen(WORKSPACE_CLEANUP_WHOLE_TARGETS), true);
  assert.equal(Object.isFrozen(WORKSPACE_CLEANUP_AGED_CHILD_PARENTS), true);
  assert.equal(Object.isFrozen(WORKSPACE_CLEANUP_PROTECTED_AGED_CHILD_PREFIXES), true);
  for (const name of [
    "protected-db-recovery-exact-20260823",
    "PROTECTED-DB-RECOVERY-EXACT-20260823",
    "shm-reconstruct-20260823",
  ]) {
    assert.equal(isProtectedWorkspaceCleanupAgedChildName(name), true, `recovery child must be protected: ${name}`);
  }
  for (const name of ["old-run", "protected-db-recovery-exact", "shm-reconstruct", "unrelated-recovery-20260823"]) {
    assert.equal(isProtectedWorkspaceCleanupAgedChildName(name), false, `non-recovery child must stay eligible: ${name}`);
  }
  const sampleRoot = resolve(tmpdir(), "lore-cleanup-plan-root");
  assertCleanupPlanPolicy(createWorkspaceCleanupPlan, sampleRoot);
  assertAgeParserPolicy(parseDecimalHoursToThousandths);
  assertContainmentPolicy(isInsideWorkspaceRoot, sampleRoot);
  assertSummarySanitizers();
  assert.deepEqual(parseCleanupMinAgeHours(undefined), { hours: 8, milliseconds: 8 * HOUR_MS });
  assert.deepEqual(parseCleanupMinAgeHours("0.001"), { hours: 0.001, milliseconds: 3_600 });
  for (const value of ["-1", "1e3", "100000.001", "9007199254740991"]) {
    assert.throws(() => parseCleanupMinAgeHours(value), /CLEANUP_MIN_AGE_HOURS/);
  }

  assert.throws(
    () => assertAgeParserPolicy((value) => BigInt(Math.round(Number(value) * 1_000))),
    /canonical decimal hour value|cannot be converted to a BigInt|Missing expected exception/,
    "broad Number cleanup-age mutant must be killed",
  );
  assert.throws(
    () => assertContainmentPolicy((root, target) => resolve(target).startsWith(resolve(root)), sampleRoot),
    /false/,
    "prefix-only workspace containment mutant must be killed",
  );
  assert.throws(
    () => assertCleanupPlanPolicy((root) => ({
      root: resolve(root),
      wholeTargets: [resolve(root)],
      agedChildParents: [resolve(root, "node_modules")],
    }), sampleRoot),
    /Expected values to be strictly deep-equal/,
    "broad root/dependency target mutant must be killed",
  );

  const behaviorRoot = await mkdtemp(join(tmpdir(), "lore-cleanup-behavior-"));
  const cliRoot = await mkdtemp(join(tmpdir(), "lore-cleanup-cli-"));
  try {
    await assertCleanupBehavior(runWorkspaceCleanup, behaviorRoot);
    await assertReparseContainmentBehavior(runWorkspaceCleanup);
    await createFixture(cliRoot, "coverage/proof.txt", "proof", Date.now() - HOUR_MS);
    await assertCleanupCliBoundary(cliRoot);
  } finally {
    await rm(behaviorRoot, { recursive: true, force: true });
    await rm(cliRoot, { recursive: true, force: true });
  }
}

if (process.argv[1]?.endsWith("test-business-cleanup-workspace.mjs")) {
  await runCleanupWorkspaceBehaviorTests();
  console.log("Workspace cleanup behavior tests passed.");
}
