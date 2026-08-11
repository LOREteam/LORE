import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { resolve } from "node:path";

import { resolveCheckLocalDistDir } from "./check-local-dist-dir.mjs";
import { getPreviewAgeMs, MAX_PREVIEW_FUTURE_SKEW_MS } from "./preview-freshness.mjs";

const REPO_ROOT = resolve(".");

test("CHECK_LOCAL_DIST_DIR accepts only canonical tool-owned directories inside the repo", () => {
  assert.deepEqual(resolveCheckLocalDistDir(".next-check", REPO_ROOT), {
    relativePath: ".next-check",
    resolvedPath: resolve(REPO_ROOT, ".next-check"),
  });
  assert.equal(
    resolveCheckLocalDistDir(".next-check-ci-42", REPO_ROOT).resolvedPath,
    resolve(REPO_ROOT, ".next-check-ci-42"),
  );

  for (const value of [
    "",
    " ",
    ".",
    "..",
    "../.next-check",
    ".next-check/child",
    "next-check",
    "dist",
    REPO_ROOT,
  ]) {
    assert.throws(() => resolveCheckLocalDistDir(value, REPO_ROOT), /CHECK_LOCAL_DIST_DIR/);
  }
});

test("check-local rejects an escaping dist directory before starting its checks", () => {
  const result = spawnSync(process.execPath, ["scripts/check-local.mjs", "--summary-only"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, CHECK_LOCAL_DIST_DIR: ".." },
  });
  assert.equal(result.status, 1);
  assert.match(`${result.stdout}\n${result.stderr}`, /CHECK_LOCAL_DIST_DIR/);
});

test("Preview freshness rejects timestamps beyond the explicit future clock skew", () => {
  const nowMs = Date.parse("2026-08-09T12:00:00.000Z");
  assert.equal(getPreviewAgeMs(nowMs - 60_000, nowMs), 60_000);
  assert.equal(getPreviewAgeMs(nowMs + MAX_PREVIEW_FUTURE_SKEW_MS, nowMs), 0);
  assert.throws(
    () => getPreviewAgeMs(nowMs + MAX_PREVIEW_FUTURE_SKEW_MS + 1, nowMs),
    /must not be in the future/,
  );
});
