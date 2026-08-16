import assert from "node:assert/strict";
import {
  EXPECTED_V10_DUPLICATE_BATCH_MODEL_DIGEST,
  runContractV10Summary,
  summarizeContractV10Result,
} from "./run-contract-v10-summary.mjs";

function childResult(overrides = {}) {
  const payload = {
    status: "passed",
    compilerVersion: "0.8.36+commit.8a079791.Emscripten.clang",
    duplicateBatchModelCases: 10,
    duplicateBatchModelDigest: EXPECTED_V10_DUPLICATE_BATCH_MODEL_DIGEST,
    ...overrides.payload,
  };
  return {
    status: 0,
    stdout: JSON.stringify(payload),
    stderr: "",
    ...overrides,
  };
}

export function runContractV10SummaryBehaviorTests() {
  const accepted = summarizeContractV10Result(childResult());
  assert.equal(accepted.status, "pass");
  assert.equal(accepted.duplicateBatchModelCases, 10);
  assert.equal(accepted.duplicateBatchModelManifest, true);

  for (const [result, expectedManifest] of [
    [childResult({ payload: { duplicateBatchModelCases: 9 } }), false],
    [childResult({ payload: { duplicateBatchModelCases: 11 } }), false],
    [childResult({ payload: { duplicateBatchModelDigest: undefined } }), false],
    [childResult({ payload: { duplicateBatchModelDigest: "0".repeat(64) } }), false],
    [childResult({ payload: { status: "failed" } }), true],
  ]) {
    const rejected = summarizeContractV10Result(result);
    assert.equal(rejected.status, "fail");
    assert.equal(rejected.duplicateBatchModelManifest, expectedManifest);
  }

  const stderrOverride = summarizeContractV10Result(childResult({
    stderr: JSON.stringify({ status: "failed", duplicateBatchModelCases: 0 }),
  }));
  assert.equal(stderrOverride.status, "pass", "stderr JSON must not override the authoritative child stdout summary");

  const calls = [];
  const lines = [];
  const execution = runContractV10Summary({
    platform: "win32",
    env: {},
    spawn(command, args, options) {
      calls.push({ command, args, options });
      return childResult();
    },
    writeLine: (line) => lines.push(line),
  });
  assert.equal(execution.exitCode, 0);
  assert.deepEqual(calls.map(({ command, args }) => ({ command, args })), [{
    command: "npm.cmd",
    args: ["--silent", "run", "test:contract:v10"],
  }]);
  assert.equal(JSON.parse(lines[0]).duplicateBatchModelManifest, true);

  const countOnlyMutant = (result) => JSON.parse(result.stdout).duplicateBatchModelCases === 10;
  assert.equal(
    countOnlyMutant(childResult({ payload: { duplicateBatchModelDigest: "f".repeat(64) } })),
    true,
    "digest-mismatch fixture must kill a summary that trusts only the case count",
  );
}
