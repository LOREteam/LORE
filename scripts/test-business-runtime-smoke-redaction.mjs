import assert from "node:assert/strict";
import {
  createRuntimePageErrorCounter,
  formatRuntimeSmokeError,
  MAX_RUNTIME_SMOKE_ERROR_CHARS,
} from "./runtime-smoke-error-policy.mjs";
import { runSqliteStartupCli } from "./check-sqlite-startup.mjs";
import {
  runLiveStateRecoveryCli,
  runLiveStateRecoverySmoke,
} from "./smoke-live-state-recovery.mjs";

export async function runRuntimeSmokeRedactionBehaviorTests() {
  assert.equal(
    formatRuntimeSmokeError(new Error("  first line\n\tsecond line  ")),
    "first line second line",
  );
  const secretError = new Error(
    "DATABASE_URL=postgres://user:password@example.invalid/db "
      + "--rpc-url=https://rpc.example.invalid/path?token=query-secret",
  );
  const sanitized = formatRuntimeSmokeError(secretError);
  assert.match(sanitized, /DATABASE_URL=<redacted>/);
  assert.match(sanitized, /--rpc-url=<redacted>/);
  assert.doesNotMatch(sanitized, /user:password|query-secret/i);

  const longError = new Error(`prefix ${"x".repeat(800)} API_KEY=tail-secret`);
  const bounded = formatRuntimeSmokeError(longError);
  assert.equal(bounded.length, MAX_RUNTIME_SMOKE_ERROR_CHARS);
  assert.match(bounded, /\.\.\.<truncated>$/);
  assert.doesNotMatch(bounded, /tail-secret/);
  assert.equal(
    formatRuntimeSmokeError({ toString() { throw new Error("stringification secret"); } }),
    "unknown runtime error",
  );

  const sqliteLogs = [];
  const sqliteErrors = [];
  let sqliteVerifyCalls = 0;
  const sqliteFailureExit = runSqliteStartupCli({
    sourceInput: "must-not-open.sqlite",
    verify: (sourceInput) => {
      sqliteVerifyCalls += 1;
      assert.equal(sourceInput, "must-not-open.sqlite");
      throw secretError;
    },
    log: (value) => sqliteLogs.push(String(value)),
    errorLog: (value) => sqliteErrors.push(String(value)),
  });
  assert.equal(sqliteFailureExit, 1);
  assert.equal(sqliteVerifyCalls, 1);
  assert.deepEqual(sqliteLogs, []);
  assert.equal(sqliteErrors.length, 1);
  assert.match(sqliteErrors[0], /^\[db-startup\] FAIL /);
  assert.doesNotMatch(sqliteErrors[0], /user:password|query-secret/i);

  const sqliteSuccessLogs = [];
  assert.equal(runSqliteStartupCli({
    sourceInput: ":memory:",
    verify: () => ({ status: "pass", state: "memory" }),
    log: (value) => sqliteSuccessLogs.push(String(value)),
    errorLog: () => assert.fail("successful SQLite startup must not log an error"),
  }), 0);
  assert.deepEqual(JSON.parse(sqliteSuccessLogs[0]), {
    status: "pass",
    state: "memory",
    bytes: 0,
  });

  assert.equal(typeof runLiveStateRecoverySmoke, "function");
  const pageErrors = createRuntimePageErrorCounter();
  pageErrors.record(new Error("page-error-secret-sentinel"));
  pageErrors.record({ message: "second-page-error-secret" });
  assert.equal(pageErrors.count(), 2);
  assert.doesNotMatch(JSON.stringify(pageErrors), /page-error-secret|second-page-error/i);
  let recoveryRuns = 0;
  const recoveryErrors = [];
  const recoveryExit = await runLiveStateRecoveryCli({
    run: async () => {
      recoveryRuns += 1;
      throw new Error("AUTH_TOKEN=recovery-secret\ncontrolled failure");
    },
    errorLog: (value) => recoveryErrors.push(String(value)),
  });
  assert.equal(recoveryExit, 1);
  assert.equal(recoveryRuns, 1);
  assert.deepEqual(recoveryErrors, ["AUTH_TOKEN=<redacted> controlled failure"]);

  const rawFormatterMutant = (error) => error.message.replace(/\s+/g, " ").trim();
  assert.match(rawFormatterMutant(secretError), /user:password|query-secret/i);
  const unboundedFormatterMutant = (error) => error.message;
  assert.ok(unboundedFormatterMutant(longError).length > MAX_RUNTIME_SMOKE_ERROR_CHARS);
}
