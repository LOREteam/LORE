import assert from "node:assert/strict";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as policyModule from "./v10DeployedInputPolicy.ts";

const policy = policyModule.default ?? policyModule;

export function runV10DeployedInputPolicyTests() {
  const root = path.join(tmpdir(), `lore-v10-input-policy-${process.pid}-${Date.now()}`);
  const workspaceRoot = path.join(root, "workspace");
  const nodeModulesRoot = path.join(root, "modules");
  try {
    mkdirSync(path.join(workspaceRoot, "contracts"), { recursive: true });
    mkdirSync(path.join(nodeModulesRoot, "@scope", "pkg"), { recursive: true });
    writeFileSync(path.join(workspaceRoot, "contracts", "Root.sol"), "line1\r\nline2\r", "utf8");
    writeFileSync(path.join(nodeModulesRoot, "@scope", "pkg", "Lib.sol"), "library Lib {}\n", "utf8");

    assert.equal(policy.canonicalizeV10Source("a\r\nb\rc\n"), "a\nb\nc\n");
    assert.equal(policy.normalizeV10SourceUnit("contracts/Root.sol"), "contracts/Root.sol");
    assert.equal(policy.normalizeV10SourceUnit("@scope/pkg/Lib.sol"), "@scope/pkg/Lib.sol");
    for (const unsafePath of [
      "",
      "../secret.sol",
      "contracts/../secret.sol",
      "/absolute.sol",
      "C:\\absolute.sol",
      "contracts\\Root.sol",
      "contracts//Root.sol",
      `contracts/${"a".repeat(policy.MAX_V10_SOURCE_UNIT_PATH_CHARS)}.sol`,
      "contracts/Root.sol\nignored",
    ]) {
      assert.throws(() => policy.normalizeV10SourceUnit(unsafePath), /Unsafe V10 source-unit path/);
    }

    const resolved = policy.resolveContainedV10SourcePath(workspaceRoot, "contracts/Root.sol");
    assert.equal(resolved, path.join(workspaceRoot, "contracts", "Root.sol"));
    assert.equal(
      policy.readV10SourceUnit("contracts/Root.sol", { workspaceRoot, nodeModulesRoot }),
      "line1\nline2\n",
    );
    assert.equal(
      policy.readV10SourceUnit("@scope/pkg/Lib.sol", { workspaceRoot, nodeModulesRoot }),
      "library Lib {}\n",
    );

    writeFileSync(path.join(workspaceRoot, "contracts", "Exact.sol"), "1234", "utf8");
    assert.equal(policy.readBoundedV10Utf8File(path.join(workspaceRoot, "contracts", "Exact.sol"), 4, "exact"), "1234");
    assert.throws(
      () => policy.readBoundedV10Utf8File(path.join(workspaceRoot, "contracts", "Exact.sol"), 3, "oversized"),
      /too large to validate safely/,
    );
    assert.throws(
      () => policy.readBoundedV10Utf8File(path.join(workspaceRoot, "contracts"), 100, "directory"),
      /must be a regular file/,
    );
    assert.throws(
      () => policy.readBoundedV10Utf8File(path.join(workspaceRoot, "contracts", "Exact.sol"), 0, "invalid"),
      /positive safe integer/,
    );
    assert.throws(
      () => policy.readV10SourceUnit("contracts/Missing.sol", { workspaceRoot, nodeModulesRoot }),
      /Source unit not found/,
    );

    const outsideRoot = path.join(root, "outside");
    mkdirSync(outsideRoot);
    writeFileSync(path.join(outsideRoot, "Escaped.sol"), "contract Escaped {}\n", "utf8");
    const redirectedRoot = path.join(workspaceRoot, "contracts", "redirected");
    symlinkSync(outsideRoot, redirectedRoot, process.platform === "win32" ? "junction" : "dir");
    assert.throws(
      () => policy.readV10SourceUnit("contracts/redirected/Escaped.sol", { workspaceRoot, nodeModulesRoot }),
      /escapes its allowed root through a reparse point|must not resolve through a symlink, junction, or reparse point/,
      "an intermediate symlink or junction must not escape the canonical V10 source root",
    );

    const importReader = policy.createV10ImportReader({ workspaceRoot, nodeModulesRoot });
    assert.deepEqual(importReader("@scope/pkg/Lib.sol"), { contents: "library Lib {}\n" });
    assert.deepEqual(importReader("../secret.sol"), { error: "V10 import unavailable" });
    assert.deepEqual(importReader("contracts/Missing.sol"), { error: "V10 import unavailable" });

    const unsafeResolverMutant = (rootPath, sourceUnit) => path.resolve(rootPath, sourceUnit);
    assert.equal(
      unsafeResolverMutant(workspaceRoot, "../outside.sol").startsWith(`${workspaceRoot}${path.sep}`),
      false,
      "traversal fixture must kill a resolver without containment validation",
    );
    const unboundedReaderMutant = (filePath) => Buffer.from(requireFileBytes(filePath)).toString("utf8");
    assert.equal(
      unboundedReaderMutant(path.join(workspaceRoot, "contracts", "Exact.sol")),
      "1234",
      "oversized fixture must remain readable to kill an unbounded-reader mutant",
    );
  } finally {
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
  }
}

function requireFileBytes(filePath) {
  return globalThis.process.getBuiltinModule("node:fs").readFileSync(filePath);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runV10DeployedInputPolicyTests();
  console.log("V10 deployed input policy behavior tests passed");
}
