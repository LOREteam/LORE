import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  assessContractV9SummaryResult,
  countContractV9AssertionFailures,
  runContractV9Summary,
} from "./run-contract-v9-summary.mjs";

const PASS_MARKER = "Contract V9 invariant checks passed.";

export function runContractV9SummaryBehaviorTests() {
  assert.deepEqual(
    assessContractV9SummaryResult({ status: 0, stdout: PASS_MARKER, stderr: "" }),
    {
      status: "pass",
      invariantSuite: "v9",
      passed: true,
      assertionFailures: 0,
      timedOut: false,
    },
  );
  assert.equal(assessContractV9SummaryResult({ status: 1, stdout: PASS_MARKER }).status, "fail");
  assert.equal(assessContractV9SummaryResult({ status: 0, stdout: "no marker" }).status, "fail");
  assert.deepEqual(
    assessContractV9SummaryResult({ status: 0, stdout: `${PASS_MARKER}\nAssertionError` }),
    {
      status: "fail",
      invariantSuite: "v9",
      passed: true,
      assertionFailures: 1,
      timedOut: false,
    },
  );
  assert.equal(
    countContractV9AssertionFailures("AssertionError\n".repeat(10_050)),
    9999,
    "assertion failure counting must stay bounded",
  );
  assert.deepEqual(
    assessContractV9SummaryResult({ status: null, error: { code: "ETIMEDOUT" } }),
    {
      status: "fail",
      invariantSuite: "v9",
      passed: false,
      assertionFailures: 0,
      timedOut: true,
    },
  );
  assert.equal(
    assessContractV9SummaryResult({ status: null, error: { code: "ENOBUFS" } }).issue,
    "contract-v9-output-too-large",
  );
  assert.equal(
    assessContractV9SummaryResult({ status: null, error: { code: "ENOENT" } }).issue,
    "contract-v9-spawn-failed",
  );

  let invocation;
  const summary = runContractV9Summary({
    spawn(command, args, options) {
      invocation = { command, args, options };
      return { status: 0, stdout: PASS_MARKER, stderr: "" };
    },
    env: { npm_execpath: "C:\\npm\\npm-cli.js", CONTRACT_V9_SECRET: "do-not-print" },
    cwd: "C:\\repo",
    platform: "win32",
    execPath: "C:\\node\\node.exe",
    timeoutMs: 1234,
  });
  assert.equal(summary.status, "pass");
  assert.equal(invocation.command, "C:\\node\\node.exe");
  assert.deepEqual(invocation.args, ["C:\\npm\\npm-cli.js", "--silent", "run", "test:contract"]);
  assert.equal(invocation.options.cwd, "C:\\repo");
  assert.equal(invocation.options.encoding, "utf8");
  assert.equal(invocation.options.maxBuffer, 1024 * 1024);
  assert.equal(invocation.options.timeout, 1234);
  assert.equal(invocation.options.env.NO_UPDATE_NOTIFIER, "1");
  assert.equal(invocation.options.env.npm_config_update_notifier, "false");
  assert.equal(invocation.options.env.npm_config_fund, "false");

  let fallbackInvocation;
  runContractV9Summary({
    spawn(command, args, options) {
      fallbackInvocation = { command, args, options };
      return { status: 0, stdout: PASS_MARKER, stderr: "" };
    },
    env: {},
    cwd: "C:\\repo",
    platform: "win32",
    execPath: "C:\\node\\node.exe",
    timeoutMs: 180_000,
  });
  assert.equal(fallbackInvocation.command, "npm.cmd");
  assert.deepEqual(fallbackInvocation.args, ["--silent", "run", "test:contract"]);

  const scriptPath = resolve("scripts/run-contract-v9-summary.mjs");
  const scriptUrl = pathToFileURL(scriptPath).href;
  const invalidEnv = { ...process.env, CONTRACT_V9_SUMMARY_TIMEOUT_MS: "01" };
  const imported = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", `await import(${JSON.stringify(scriptUrl)})`],
    { cwd: process.cwd(), env: invalidEnv, encoding: "utf8", timeout: 10_000 },
  );
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(imported.stdout, "");
  assert.equal(imported.stderr, "");

  const direct = spawnSync(process.execPath, [scriptPath], {
    cwd: process.cwd(),
    env: invalidEnv,
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(direct.status, 1);
  assert.equal(direct.stdout, "");
  assert.equal(
    direct.stderr.trim(),
    "CONTRACT_V9_SUMMARY_TIMEOUT_MS must be a canonical decimal integer",
  );
  assert.doesNotMatch(direct.stderr, /at file:|do-not-print|npm-cli/i);
}
