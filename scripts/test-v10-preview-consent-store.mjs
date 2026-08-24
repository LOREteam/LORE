import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  closeSync,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  acquireV10CanaryExecutionLease,
  consumeV10PreviewConsent,
  releaseV10CanaryExecutionLease,
  V10_CANARY_EXECUTION_LEASE_RELATIVE_PATH,
  V10_PREVIEW_CONSENT_LEDGER_RELATIVE_PATH,
} from "./v10-preview-consent-store.mjs";

const CURRENT_FILE = fileURLToPath(import.meta.url);
const FIXED_NOW = new Date("2026-08-23T00:00:00.000Z");
const BINDING = Object.freeze({
  runId: "12345678-1234-4123-8123-123456789abc",
  previewSha256: "a".repeat(64),
  walletSetSha256: "b".repeat(64),
  canaryPlanSha256: "c".repeat(64),
  consentPlanSha256: "d".repeat(64),
});

const REAL_FS_API = Object.freeze({
  closeSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeSync,
});

function withTemporaryRoot(prefix, fn) {
  const root = mkdtempSync(path.join(tmpdir(), prefix));
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

function markerPath(root, runId = BINDING.runId) {
  return path.join(root, V10_PREVIEW_CONSENT_LEDGER_RELATIVE_PATH, `${runId}.json`);
}

function leasePath(root) {
  return path.join(root, V10_CANARY_EXECUTION_LEASE_RELATIVE_PATH);
}

function consume(root, options = {}) {
  return consumeV10PreviewConsent({
    root,
    binding: options.binding ?? BINDING,
    now: options.now ?? FIXED_NOW,
    fsApi: options.fsApi ?? REAL_FS_API,
  });
}

function acquireLease(root, options = {}) {
  return acquireV10CanaryExecutionLease({
    root,
    binding: options.binding ?? BINDING,
    now: options.now ?? FIXED_NOW,
    fsApi: options.fsApi ?? REAL_FS_API,
  });
}

function assertAlreadyConsumed(fn) {
  assert.throws(fn, (error) => {
    assert.equal(error?.code, "V10_PREVIEW_CONSENT_ALREADY_CONSUMED");
    assert.equal(error?.message, "V10 Preview consent is already consumed or reserved");
    return true;
  });
}

function runConsumeChild(root) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CURRENT_FILE, "--consume-child", root], {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

const childMode = process.argv[2] === "--consume-child";

if (childMode) {
  try {
    const result = consume(process.argv[3]);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    if (error?.code === "V10_PREVIEW_CONSENT_ALREADY_CONSUMED") {
      process.stderr.write("already-consumed\n");
      process.exitCode = 2;
    } else {
      process.stderr.write("consume-failed\n");
      process.exitCode = 1;
    }
  }
} else {
  test("first consume creates a complete public tombstone and replay fails closed", () => {
    withTemporaryRoot("lore-v10-consent-first-", (root) => {
      const secretSentinel = "must-never-enter-consent-tombstone";
      const result = consume(root, {
        binding: { ...BINDING, privateKey: secretSentinel, nestedSecret: { value: secretSentinel } },
      });
      assert.deepEqual(result, {
        status: "consumed",
        runId: BINDING.runId,
        markerPath: path.join(V10_PREVIEW_CONSENT_LEDGER_RELATIVE_PATH, `${BINDING.runId}.json`),
      });
      const raw = readFileSync(markerPath(root), "utf8");
      assert.equal(raw.includes(secretSentinel), false);
      assert.equal(raw.includes("privateKey"), false);
      assert.deepEqual(JSON.parse(raw), {
        schema: 1,
        ...BINDING,
        consumedAt: FIXED_NOW.toISOString(),
      });
      assertAlreadyConsumed(() => consume(root));
    });
  });

  test("two concurrent consumers produce exactly one durable winner", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "lore-v10-consent-race-"));
    try {
      const results = await Promise.all([runConsumeChild(root), runConsumeChild(root)]);
      assert.deepEqual(results.map((result) => result.code).sort(), [0, 2]);
      assert.equal(results.every((result) => result.signal === null), true);
      assert.equal(results.filter((result) => result.code === 0).length, 1);
      assert.equal(results.filter((result) => result.code === 2).length, 1);
      assert.deepEqual(JSON.parse(readFileSync(markerPath(root), "utf8")), {
        schema: 1,
        ...BINDING,
        consumedAt: FIXED_NOW.toISOString(),
      });
    } finally {
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    }
  });

  test("a precreated tombstone is never read, replaced, or retried", () => {
    withTemporaryRoot("lore-v10-consent-precreated-", (root) => {
      const ledger = path.dirname(markerPath(root));
      mkdirSync(ledger, { recursive: true });
      const sentinel = "preexisting-content-must-survive";
      writeFileSync(markerPath(root), sentinel, "utf8");
      assertAlreadyConsumed(() => consume(root));
      assert.equal(readFileSync(markerPath(root), "utf8"), sentinel);
    });
  });

  test("leaf links and ledger reparse points fail closed without touching their targets", (t) => {
    withTemporaryRoot("lore-v10-consent-link-", (root) => {
      const external = mkdtempSync(path.join(tmpdir(), "lore-v10-consent-external-"));
      try {
        const ledger = path.dirname(markerPath(root));
        mkdirSync(ledger, { recursive: true });
        const externalLeaf = path.join(external, "sentinel.json");
        writeFileSync(externalLeaf, "leaf-target", "utf8");
        let leafLinkCreated = false;
        try {
          symlinkSync(externalLeaf, markerPath(root), "file");
          leafLinkCreated = true;
        } catch (error) {
          if (!new Set(["EPERM", "EACCES", "UNKNOWN"]).has(error?.code)) throw error;
        }
        if (leafLinkCreated) {
          assertAlreadyConsumed(() => consume(root));
          assert.equal(readFileSync(externalLeaf, "utf8"), "leaf-target");
          rmSync(markerPath(root), { force: true });
        } else {
          t.diagnostic("leaf symlink creation is unavailable on this host");
        }

        rmSync(ledger, { recursive: true, force: true });
        let parentLinkCreated = false;
        try {
          symlinkSync(external, ledger, process.platform === "win32" ? "junction" : "dir");
          parentLinkCreated = true;
        } catch (error) {
          if (!new Set(["EPERM", "EACCES", "UNKNOWN"]).has(error?.code)) throw error;
        }
        if (parentLinkCreated) {
          assert.throws(
            () => consume(root),
            (error) => error?.code === "V10_PREVIEW_CONSENT_PATH_UNSAFE",
          );
          assert.equal(existsSync(path.join(external, `${BINDING.runId}.json`)), false);
        } else {
          t.diagnostic("ledger symlink or junction creation is unavailable on this host");
        }
      } finally {
        rmSync(external, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
      }
    });
  });

  test("a write failure leaves a permanent tombstone and retry is rejected", () => {
    withTemporaryRoot("lore-v10-consent-write-failure-", (root) => {
      assert.throws(
        () => consume(root, {
          fsApi: {
            ...REAL_FS_API,
            writeSync() {
              throw new Error("injected write failure");
            },
          },
        }),
        (error) => error?.code === "V10_PREVIEW_CONSENT_PERSISTENCE_FAILED",
      );
      assert.equal(existsSync(markerPath(root)), true);
      assertAlreadyConsumed(() => consume(root));
    });
  });

  test("an fsync failure leaves a permanent tombstone and retry is rejected", () => {
    withTemporaryRoot("lore-v10-consent-fsync-failure-", (root) => {
      assert.throws(
        () => consume(root, {
          fsApi: {
            ...REAL_FS_API,
            fsyncSync() {
              throw new Error("injected fsync failure");
            },
          },
        }),
        (error) => error?.code === "V10_PREVIEW_CONSENT_PERSISTENCE_FAILED",
      );
      assert.equal(existsSync(markerPath(root)), true);
      assertAlreadyConsumed(() => consume(root));
    });
  });

  test("repository-local lease serializes different runIds and only its owner can release it", () => {
    withTemporaryRoot("lore-v10-consent-lease-", (root) => {
      const secretSentinel = "must-never-enter-active-lease";
      const lease = acquireLease(root, {
        binding: { ...BINDING, privateKey: secretSentinel, nestedSecret: { value: secretSentinel } },
      });
      assert.deepEqual(lease, {
        status: "acquired",
        runId: BINDING.runId,
        markerPath: V10_CANARY_EXECUTION_LEASE_RELATIVE_PATH,
      });
      const leaseText = readFileSync(leasePath(root), "utf8");
      assert.equal(leaseText.includes(secretSentinel), false);
      assert.equal(leaseText.includes("privateKey"), false);
      const raw = JSON.parse(leaseText);
      assert.deepEqual(raw, {
        schema: 1,
        kind: "active-v10-canary",
        ...BINDING,
        acquiredAt: FIXED_NOW.toISOString(),
      });
      const secondBinding = {
        ...BINDING,
        runId: "87654321-4321-4123-8123-cba987654321",
        previewSha256: "e".repeat(64),
      };
      assert.throws(
        () => acquireLease(root, { binding: secondBinding }),
        (error) => error?.code === "V10_CANARY_EXECUTION_LEASE_HELD",
      );
      assert.throws(
        () => releaseV10CanaryExecutionLease({ ...lease }),
        (error) => error?.code === "V10_CANARY_EXECUTION_LEASE_NOT_OWNER",
      );
      assert.equal(existsSync(leasePath(root)), true);
      assert.deepEqual(releaseV10CanaryExecutionLease(lease), {
        status: "released",
        runId: BINDING.runId,
        markerPath: V10_CANARY_EXECUTION_LEASE_RELATIVE_PATH,
      });
      assert.equal(existsSync(leasePath(root)), false);
      assert.throws(
        () => releaseV10CanaryExecutionLease(lease),
        (error) => error?.code === "V10_CANARY_EXECUTION_LEASE_NOT_OWNER",
      );
    });
  });

  test("lease persistence failure is fail-closed and never auto-released", () => {
    withTemporaryRoot("lore-v10-consent-lease-failure-", (root) => {
      assert.throws(
        () => acquireLease(root, {
          fsApi: {
            ...REAL_FS_API,
            fsyncSync() {
              throw new Error("injected lease fsync failure");
            },
          },
        }),
        (error) => error?.code === "V10_CANARY_EXECUTION_LEASE_PERSISTENCE_FAILED",
      );
      assert.equal(existsSync(leasePath(root)), true);
      assert.throws(
        () => acquireLease(root),
        (error) => error?.code === "V10_CANARY_EXECUTION_LEASE_HELD",
      );
    });
  });

  test("lease release rejects a changed marker and leaves it fail-closed", () => {
    withTemporaryRoot("lore-v10-consent-lease-change-", (root) => {
      const lease = acquireLease(root);
      writeFileSync(leasePath(root), "changed-public-lease\n", "utf8");
      assert.throws(
        () => releaseV10CanaryExecutionLease(lease),
        (error) => error?.code === "V10_CANARY_EXECUTION_LEASE_RELEASE_FAILED",
      );
      assert.equal(readFileSync(leasePath(root), "utf8"), "changed-public-lease\n");
      assert.throws(
        () => acquireLease(root),
        (error) => error?.code === "V10_CANARY_EXECUTION_LEASE_HELD",
      );
    });
  });

  test("normal lease release does not remove the consumed authorization tombstone", () => {
    withTemporaryRoot("lore-v10-consent-lease-consume-", (root) => {
      const lease = acquireLease(root);
      consume(root);
      releaseV10CanaryExecutionLease(lease);
      assert.equal(existsSync(leasePath(root)), false);
      assert.equal(existsSync(markerPath(root)), true);
      assertAlreadyConsumed(() => consume(root));
    });
  });
}
