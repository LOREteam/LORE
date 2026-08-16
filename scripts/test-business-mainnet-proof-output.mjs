import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const projectRoot = process.cwd();
const guardPath = join(projectRoot, "scripts", "check-mainnet-proof-output.mjs");

function ownedTempNames() {
  return readdirSync(tmpdir(), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith("lore-mainnet-proof-out-"))
    .map((entry) => entry.name)
    .sort();
}

export function runMainnetProofOutputTests() {
  const before = ownedTempNames();
  const result = spawnSync(process.execPath, [guardPath], {
    cwd: projectRoot,
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
    windowsHide: true,
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, "Summary: mainnet proof strict-fail output guard passed.\n");
  assert.deepEqual(ownedTempNames(), before, "mainnet proof output guard must remove its strict-fail workspace");
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /(?:node:internal|at Module\.|at file:|lore-mainnet-proof-out-)/i);
}
