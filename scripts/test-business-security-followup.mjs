import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  MAX_SECURITY_FOLLOWUP_SOURCE_BYTES,
  formatSecurityFollowupResult,
  listSecurityFollowupFiles,
  readSecurityFollowupSource,
  runSecurityFollowupCheck,
  runSecurityFollowupCli,
} from "./check-security-followup.mjs";

const REPO_ROOT = process.cwd();
const REQUIRED_SOURCE_PATHS = [
  "app/api/bootstrap-resolve/shared.ts",
  "app/api/bootstrap-resolve/route.ts",
  "bot.ts",
  "server/keeperSigningSafety.ts",
  "app/hooks/useMiningTabLock.ts",
  "app/api/deposits/route.ts",
  "app/hooks/useAutoResolve.ts",
  "scripts/clear-live-test-pending-nonce.ts",
  "scripts/live-round-canary.ts",
  "scripts/create-v10-canary-dry-run-preview.mjs",
  ".github/workflows/ci.yml",
  "scripts/check-ci-security.mjs",
];
const EXPECTED_CHECK_IDS = [
  "host-auth",
  "web-locks",
  "keeper-nonce",
  "keeper-bot-receipts",
  "deposit-limiter",
  "dry-run-defaults",
  "ci-security",
  "auto-resolve",
];

function replaceRequired(source, needle, replacement) {
  assert.ok(source.includes(needle), `security follow-up fixture is missing ${needle}`);
  return source.replace(needle, replacement);
}

function buildCurrentFixture() {
  const appFiles = listSecurityFollowupFiles(REPO_ROOT, "app");
  const files = new Set([...REQUIRED_SOURCE_PATHS, ...appFiles]);
  const sources = new Map([...files].map((relativePath) => [
    relativePath,
    readSecurityFollowupSource(REPO_ROOT, relativePath),
  ]));
  return { appFiles, sources };
}

function runFixture({ fixture, overrides = new Map(), appFiles = fixture.appFiles }) {
  return runSecurityFollowupCheck({
    repoRoot: REPO_ROOT,
    readSource: (relativePath) => {
      if (overrides.has(relativePath)) return overrides.get(relativePath);
      const source = fixture.sources.get(relativePath);
      if (typeof source !== "string") throw new Error(`missing fixture source: ${relativePath}`);
      return source;
    },
    listFiles: (root) => {
      assert.equal(root, "app");
      return appFiles;
    },
  });
}

function assertFailedCheck(result, id) {
  assert.equal(result.summary.status, "fail");
  assert.ok(result.summary.failedIds.includes(id), `${id} mutant must fail its security follow-up check`);
}

export function runSecurityFollowupBehaviorTests() {
  const tempRoot = mkdtempSync(path.join(tmpdir(), "lore-security-followup-"));
  try {
    mkdirSync(path.join(tempRoot, "app", ".tmp"), { recursive: true });
    mkdirSync(path.join(tempRoot, "directory.ts"));
    writeFileSync(path.join(tempRoot, "app", "good.ts"), "export const good = true;\n", "utf8");
    writeFileSync(path.join(tempRoot, "app", ".tmp", "ignored.ts"), "resolveEpoch\n", "utf8");
    writeFileSync(path.join(tempRoot, "oversized.ts"), "x".repeat(MAX_SECURITY_FOLLOWUP_SOURCE_BYTES + 1), "utf8");
    assert.equal(readSecurityFollowupSource(tempRoot, "app/good.ts"), "export const good = true;\n");
    assert.throws(() => readSecurityFollowupSource(tempRoot, "missing.ts"), /Missing source file: missing\.ts/);
    assert.throws(() => readSecurityFollowupSource(tempRoot, "directory.ts"), /must be a file/);
    assert.throws(() => readSecurityFollowupSource(tempRoot, "oversized.ts"), /too large to validate safely/);
    assert.deepEqual(listSecurityFollowupFiles(tempRoot, "app"), ["app/good.ts"]);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }

  const fixture = buildCurrentFixture();
  const baseline = runFixture({ fixture });
  assert.deepEqual(baseline.checks.map(({ id }) => id), EXPECTED_CHECK_IDS);
  assert.deepEqual(baseline.summary, {
    status: "pass",
    checks: 8,
    passed: 8,
    failed: 0,
    failedIds: [],
    hostAuth: true,
    webLocks: true,
    keeperNonce: true,
    keeperBotReceipts: true,
    depositLimiter: true,
    dryRunDefaults: true,
    ciSecurity: true,
    autoResolve: true,
    appResolveEpochFiles: 0,
  });
  assert.deepEqual(JSON.parse(formatSecurityFollowupResult(baseline, { summaryOnly: true })), baseline.summary);
  const fullReport = JSON.parse(formatSecurityFollowupResult(baseline));
  assert.equal(fullReport.status, "pass");
  assert.equal(fullReport.checks.length, 8);
  assert.deepEqual(fullReport.appResolveEpochFiles, []);

  const mutationCases = [
    {
      id: "host-auth",
      path: "app/api/bootstrap-resolve/shared.ts",
      mutate: (source) => `${source}\nconst BOOTSTRAP_RESOLVE_ALLOW_LOCAL_DEV_WITHOUT_SECRET = true;\n`,
    },
    {
      id: "web-locks",
      path: "app/hooks/useMiningTabLock.ts",
      mutate: (source) => {
        assert.ok(source.includes("ifAvailable: true"));
        return source.replaceAll("ifAvailable: true", "ifAvailable: false");
      },
    },
    {
      id: "keeper-nonce",
      path: "app/api/bootstrap-resolve/route.ts",
      mutate: (source) => replaceRequired(source, "bootstrap_pending_nonce_unbound", "bootstrap_pending_nonce_ignored"),
    },
    {
      id: "keeper-bot-receipts",
      path: "bot.ts",
      mutate: (source) => `${source}\nfunction replacePendingResolve() {}\n`,
    },
    {
      id: "deposit-limiter",
      path: "app/api/deposits/route.ts",
      mutate: (source) => `${source}\nfunction unsafeLeak() { return depositsRecoveryInflight; }\n`,
    },
    {
      id: "dry-run-defaults",
      path: "scripts/clear-live-test-pending-nonce.ts",
      mutate: (source) => replaceRequired(
        source,
        "assertExecutionAdmission(EXECUTE, EXECUTION_CONFIRMED)",
        "void EXECUTION_CONFIRMED",
      ),
    },
    {
      id: "ci-security",
      path: ".github/workflows/ci.yml",
      mutate: (source) => `${source}\npull_request_target:\n`,
    },
    {
      id: "auto-resolve",
      path: "app/hooks/useAutoResolve.ts",
      mutate: (source) => `${source}\nconst writeContract = true;\n`,
    },
  ];
  for (const mutation of mutationCases) {
    const original = fixture.sources.get(mutation.path);
    assert.equal(typeof original, "string");
    const result = runFixture({
      fixture,
      overrides: new Map([[mutation.path, mutation.mutate(original)]]),
    });
    assertFailedCheck(result, mutation.id);
  }

  const unapprovedResolve = runFixture({
    fixture,
    overrides: new Map([["app/unsafe-resolver.ts", "export const unsafe = () => resolveEpoch();\n"]]),
    appFiles: [...fixture.appFiles, "app/unsafe-resolver.ts"],
  });
  assertFailedCheck(unapprovedResolve, "auto-resolve");
  assert.deepEqual(unapprovedResolve.appResolveEpochFiles, ["app/unsafe-resolver.ts"]);

  const logs = [];
  assert.equal(runSecurityFollowupCli({ argv: ["--summary-only"], repoRoot: REPO_ROOT, log: (line) => logs.push(line) }), 0);
  assert.equal(logs.length, 1);
  assert.deepEqual(JSON.parse(logs[0]), baseline.summary);

  const importProbe = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", "await import('./scripts/check-security-followup.mjs')"],
    { cwd: REPO_ROOT, encoding: "utf8", timeout: 10_000 },
  );
  assert.equal(importProbe.status, 0, importProbe.stderr);
  assert.equal(importProbe.stdout, "");
  assert.equal(importProbe.stderr, "");

  const cliProbe = spawnSync(
    process.execPath,
    ["scripts/check-security-followup.mjs", "--summary-only"],
    { cwd: REPO_ROOT, encoding: "utf8", timeout: 30_000 },
  );
  assert.equal(cliProbe.status, 0, cliProbe.stderr);
  assert.equal(cliProbe.stderr, "");
  assert.deepEqual(JSON.parse(cliProbe.stdout), baseline.summary);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSecurityFollowupBehaviorTests();
  console.log("Security follow-up behavioral tests passed.");
}
