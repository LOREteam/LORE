import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { createLiveCanaryLogPath, initializeLiveCanaryLogFile } from "./live-canary-log-path.mjs";

function ordinaryDirectory() {
  return { isDirectory: () => true, isFile: () => false, isSymbolicLink: () => false };
}

function ordinaryFile() {
  return { isDirectory: () => false, isFile: () => true, isSymbolicLink: () => false };
}

function makeFsApi({ canonicalParent, targetExists = false, targetStats = ordinaryFile() } = {}) {
  let createdParent = null;
  return {
    api: {
      lstatSync: (path) => {
        if (path === createdParent) return ordinaryDirectory();
        if (targetExists) return targetStats;
        const error = new Error("missing fixture path");
        error.code = "ENOENT";
        throw error;
      },
      mkdirSync: (path) => { createdParent = path; },
      realpathSync: (path) => canonicalParent ?? path,
    },
    getCreatedParent: () => createdParent,
  };
}

const configuredPath = resolve(".tmp", "soak-fixture", "live-canary.jsonl");
const configuredFs = makeFsApi();
assert.equal(
  createLiveCanaryLogPath({ configuredPath, fsApi: configuredFs.api }),
  configuredPath,
);
assert.equal(configuredFs.getCreatedParent(), dirname(configuredPath));

const defaultFs = makeFsApi();
assert.equal(
  createLiveCanaryLogPath({
    configuredPath: "",
    cwd: resolve("fixture-project"),
    fsApi: defaultFs.api,
    now: new Date("2026-08-17T12:00:00.000Z"),
  }),
  join(resolve("fixture-project", "data", "live-test-runs"), "live-canary-2026-08-17T12-00-00-000Z.jsonl"),
);

assert.throws(
  () => createLiveCanaryLogPath({ configuredPath: join("relative", "live.jsonl") }),
  /must be an absolute path/,
);

const symlinkTargetFs = makeFsApi({
  targetExists: true,
  targetStats: { isDirectory: () => false, isFile: () => true, isSymbolicLink: () => true },
});
assert.throws(
  () => createLiveCanaryLogPath({ configuredPath, fsApi: symlinkTargetFs.api }),
  /ordinary file/,
);

const redirectedParentFs = makeFsApi({ canonicalParent: resolve("other-parent") });
assert.throws(
  () => createLiveCanaryLogPath({ configuredPath, fsApi: redirectedParentFs.api }),
  /must not resolve through a reparse point/,
);

let openedPath = null;
let openedFlags = null;
let closedHandle = null;
initializeLiveCanaryLogFile({
  logPath: configuredPath,
  fsApi: {
    openSync: (path, flags) => {
      openedPath = path;
      openedFlags = flags;
      return 17;
    },
    closeSync: (handle) => { closedHandle = handle; },
  },
});
assert.equal(openedPath, configuredPath);
assert.equal(openedFlags, "wx");
assert.equal(closedHandle, 17);
