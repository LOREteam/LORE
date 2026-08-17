import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import {
  assertOwnedBusinessLogicTempRoot,
  businessLogicChildExitCode,
  runIsolatedBusinessLogicChild,
} from "./business-logic-isolated-runner.mjs";
import { summarizeBusinessLogicResult } from "./run-business-logic-summary.mjs";

const FIXTURE_ROOT = resolve(".");
const FIXTURE_TEMP = resolve(join(FIXTURE_ROOT, "..", "business-logic-isolated-fixture-temp"));
const protectedPaths = [
  join(FIXTURE_ROOT, "data", "lore-v10.sqlite"),
  join(FIXTURE_ROOT, "data", "lore-v10.sqlite-wal"),
  join(FIXTURE_ROOT, "data", "lore-v10.sqlite-shm"),
];

function makeFsApi({
  mutateProtected = false,
  parentReparse = false,
  rootReparse = false,
  snapshotFailure = false,
} = {}) {
  let generation = 0;
  let removed = null;
  let snapshotReads = 0;
  const ownedRoot = join(FIXTURE_TEMP, "lore-business-logic-fixture");
  const directories = new Set([FIXTURE_ROOT, join(FIXTURE_ROOT, "data"), FIXTURE_TEMP, ownedRoot]);
  return {
    existsSync: (filePath) => directories.has(filePath) || protectedPaths.includes(filePath),
    lstatSync: (filePath) => directories.has(filePath)
      ? {
          size: 0,
          mtimeMs: 1,
          birthtimeMs: 1,
          dev: 1,
          ino: filePath === ownedRoot ? 4 : filePath === FIXTURE_TEMP ? 3 : 2,
          isDirectory: () => true,
          isFile: () => false,
          isSymbolicLink: () => (filePath === ownedRoot && rootReparse) || (filePath === FIXTURE_TEMP && parentReparse),
        }
      : {
          size: 10,
          mtimeMs: generation,
          birthtimeMs: 1,
          dev: 1,
          ino: 5,
          isDirectory: () => false,
          isFile: () => true,
          isSymbolicLink: () => false,
        },
    readFileSync: () => {
      snapshotReads += 1;
      if (snapshotFailure && snapshotReads === 1) throw new Error("fixture snapshot failure");
      return Buffer.from(`fixture-${generation}`);
    },
    realpathSync: (filePath) => {
      if (filePath === ownedRoot && rootReparse) return join(FIXTURE_TEMP, "external-reparse-target");
      if (filePath === FIXTURE_TEMP && parentReparse) return join(FIXTURE_ROOT, "data");
      return filePath;
    },
    mkdtempSync: (prefix) => `${prefix}fixture`,
    rmSync: (filePath) => { removed = filePath; },
    mutate: () => { if (mutateProtected) generation += 1; },
    getRemoved: () => removed,
  };
}

function runFixture({ mutateProtected = false, throwFromSpawn = false } = {}) {
  const fsApi = makeFsApi({ mutateProtected });
  let observedEnvironment;
  const result = runIsolatedBusinessLogicChild({
    args: ["fixture-child.mjs"],
    cwd: FIXTURE_ROOT,
    env: {
      KEEP_ME: "preserved",
      lore_allow_contract_scope_purge: "1",
      lore_db_path: "C:\\protected\\wrong.sqlite",
      lore_hermetic_build: "1",
      LORE_HERMETIC_BUILD_DB_ROOT: "C:\\protected\\wrong-root",
    },
    temporaryDirectory: FIXTURE_TEMP,
    fsApi,
    spawnSyncFn: (_execPath, _args, options) => {
      observedEnvironment = options.env;
      fsApi.mutate();
      if (throwFromSpawn) throw new Error("fixture spawn failure");
      return { status: 0, stdout: "fixture pass\n", stderr: "" };
    },
  });
  return { fsApi, observedEnvironment, result };
}

const passing = runFixture();
assert.equal(passing.result.status, 0);
assert.match(passing.observedEnvironment.LORE_DB_PATH, /lore-business-logic-fixture[\\/]lore\.sqlite$/);
assert.equal(passing.observedEnvironment.LORE_ALLOW_CONTRACT_SCOPE_PURGE, "0");
assert.equal(passing.observedEnvironment.KEEP_ME, "preserved");
assert.equal(passing.observedEnvironment.lore_db_path, undefined);
assert.equal(passing.observedEnvironment.lore_hermetic_build, undefined);
assert.equal(passing.observedEnvironment.LORE_HERMETIC_BUILD_DB_ROOT, undefined);
assert.equal(passing.fsApi.getRemoved(), passing.observedEnvironment.LORE_DB_PATH.replace(/[\\/]lore\.sqlite$/, ""));

const mutation = runFixture({ mutateProtected: true });
assert.equal(mutation.result.status, 1);
assert.match(String(mutation.result.stderr), /protected SQLite snapshot changed/);
assert.equal(
  summarizeBusinessLogicResult(mutation.result).issue,
  "business-logic-db-isolation-violation",
  "protected DB mutation must retain a distinct summary issue",
);

const mutationWithThrow = runFixture({ mutateProtected: true, throwFromSpawn: true });
assert.equal(mutationWithThrow.result.status, 1);
assert.match(String(mutationWithThrow.result.stderr), /protected SQLite snapshot changed/);
assert.equal(
  mutationWithThrow.fsApi.getRemoved(),
  mutationWithThrow.observedEnvironment.LORE_DB_PATH.replace(/[\\/]lore\.sqlite$/, ""),
);

const cleanThrowFsApi = makeFsApi();
assert.throws(
  () => runIsolatedBusinessLogicChild({
    args: ["fixture-child.mjs"],
    cwd: FIXTURE_ROOT,
    temporaryDirectory: FIXTURE_TEMP,
    fsApi: cleanThrowFsApi,
    spawnSyncFn: () => { throw new Error("fixture spawn failure"); },
  }),
  /fixture spawn failure/,
);
assert.equal(cleanThrowFsApi.getRemoved(), join(FIXTURE_TEMP, "lore-business-logic-fixture"));

const setupFailureFsApi = makeFsApi({ snapshotFailure: true });
assert.throws(
  () => runIsolatedBusinessLogicChild({
    args: ["fixture-child.mjs"],
    cwd: FIXTURE_ROOT,
    temporaryDirectory: FIXTURE_TEMP,
    fsApi: setupFailureFsApi,
    spawnSyncFn: () => assert.fail("snapshot setup failure must happen before spawn"),
  }),
  /fixture snapshot failure/,
);
assert.equal(
  setupFailureFsApi.getRemoved(),
  join(FIXTURE_TEMP, "lore-business-logic-fixture"),
  "a verified owned root must be cleaned after setup failure",
);

const reparseFsApi = makeFsApi({ rootReparse: true });
assert.throws(
  () => runIsolatedBusinessLogicChild({
    args: ["fixture-child.mjs"],
    cwd: FIXTURE_ROOT,
    temporaryDirectory: FIXTURE_TEMP,
    fsApi: reparseFsApi,
    spawnSyncFn: () => assert.fail("reparse root must fail before spawn"),
  }),
  /ordinary non-reparse directory|symlink, junction, or reparse point/,
);
assert.equal(reparseFsApi.getRemoved(), null, "an unverified reparse target must never be recursively removed");

const parentReparseFsApi = makeFsApi({ parentReparse: true });
assert.throws(
  () => runIsolatedBusinessLogicChild({
    args: ["fixture-child.mjs"],
    cwd: FIXTURE_ROOT,
    temporaryDirectory: FIXTURE_TEMP,
    fsApi: parentReparseFsApi,
    spawnSyncFn: () => assert.fail("reparse parent must fail before spawn"),
  }),
  /ordinary non-reparse directory|symlink, junction, or reparse point/,
);
assert.equal(parentReparseFsApi.getRemoved(), null, "a reparse OS-temp parent must never reach recursive cleanup");

assert.throws(
  () => assertOwnedBusinessLogicTempRoot(join(FIXTURE_ROOT, "data", "lore-business-logic-fixture"), {
    cwd: FIXTURE_ROOT,
    temporaryDirectory: FIXTURE_TEMP,
    fsApi: makeFsApi(),
  }),
  /outside the repository and protected data directory|owned OS-temp directory/,
);

assert.equal(businessLogicChildExitCode({ status: 0, signal: null, error: undefined }), 0);
assert.equal(businessLogicChildExitCode({ status: 2, signal: null, error: undefined }), 1);
assert.equal(businessLogicChildExitCode({ status: null, signal: "SIGTERM", error: undefined }), 1);
assert.equal(businessLogicChildExitCode({ status: null, signal: null, error: undefined }), 1);
assert.equal(
  businessLogicChildExitCode({ status: null, signal: "SIGTERM", error: Object.assign(new Error("timeout"), { code: "ETIMEDOUT" }) }),
  1,
);
