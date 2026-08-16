import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runDependencyAuditCli } from "./check-production-dependency-audit.mjs";
import {
  REQUIRED_WALLET_PACKAGES,
  runWalletDependencyAuditCli,
} from "./check-wallet-dependencies.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function canonicalAuditReport(vulnerabilities = {}) {
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
  for (const item of Object.values(vulnerabilities)) {
    counts[item.severity] += 1;
    counts.total += 1;
  }
  return { auditReportVersion: 2, vulnerabilities, metadata: { vulnerabilities: counts } };
}

function vulnerability(name, severity, overrides = {}) {
  return {
    name,
    severity,
    via: [],
    effects: [],
    range: "*",
    nodes: [`node_modules/${name}`],
    fixAvailable: false,
    ...overrides,
  };
}

async function runAudit(report, {
  argv = ["--summary-only"],
  spawnError = null,
  resolveError = null,
  rawOutput = null,
  env = {},
} = {}) {
  const logs = [];
  const errors = [];
  let invocation = null;
  const trustedLauncher = {
    command: process.execPath,
    cliPath: "trusted-npm-cli.mjs",
    repoRoot: REPO_ROOT,
    version: "11.5.1",
  };
  const trustedEnvironment = (sourceEnv) => {
    const sanitized = Object.fromEntries(
      Object.entries(sourceEnv).filter(([key]) => ![
        "npm_execpath",
        "comspec",
        "node_options",
        "npm_config_registry",
      ].includes(key.toLowerCase())),
    );
    return {
      ...sanitized,
      npm_config_registry: "https://registry.npmjs.org/",
      npm_config_ignore_scripts: "true",
    };
  };
  const result = await runDependencyAuditCli({
    argv,
    env: {
      ...process.env,
      npm_execpath: "malicious-npm-sentinel",
      ComSpec: "malicious-shell-sentinel",
      NODE_OPTIONS: "--require=malicious-node-options-sentinel",
      NPM_CONFIG_REGISTRY: "https://malicious-registry.example.invalid/",
      ...env,
    },
    spawnSyncFn: (command, args, options) => {
      invocation = { command, args, options };
      if (spawnError) return { error: spawnError, stdout: "", stderr: "" };
      return {
        status: 1,
        signal: null,
        stdout: rawOutput === null ? JSON.stringify(report) : rawOutput,
        stderr: "",
      };
    },
    resolveTrustedNpmCliFn: () => {
      if (resolveError) throw resolveError;
      return trustedLauncher;
    },
    trustedNpmCommandFn: (args, launcher) => ({
      command: launcher.command,
      args: [launcher.cliPath, ...args],
    }),
    trustedNpmEnvironmentFn: trustedEnvironment,
    log: (value) => logs.push(String(value)),
    errorLog: (value) => errors.push(String(value)),
    now: () => new Date("2026-08-14T10:00:00.000Z"),
  });
  const summary = logs.length > 0 && logs.at(-1).startsWith("{")
    ? JSON.parse(logs.at(-1))
    : result.summary ?? null;
  return { result, summary, logs, errors, invocation };
}

export async function runDependencyAuditBehaviorTests() {
  const moderate = canonicalAuditReport({
    "safe-moderate-package": vulnerability("safe-moderate-package", "moderate"),
  });
  const control = await runAudit(moderate);
  assert.equal(control.result.exitCode, 0);
  assert.deepEqual(control.summary, {
    status: "pass",
    scope: "production",
    total: 1,
    critical: 0,
    high: 0,
    moderate: 1,
    low: 0,
    blockingHighCritical: 0,
    knownDevToolchainHigh: 0,
    breakingFixes: 0,
    countIssues: 0,
  });
  assert.ok(control.invocation);
  assert.match(control.invocation.args.join(" "), /audit --omit=dev --json/);
  assert.equal(resolve(String(control.invocation.options.cwd)), REPO_ROOT);
  assert.doesNotMatch(String(control.invocation.options.cwd), /malicious/i);
  assert.equal(Object.values(control.invocation.options.env).includes("malicious-npm-sentinel"), false);
  assert.equal(Object.values(control.invocation.options.env).includes("malicious-shell-sentinel"), false);
  assert.equal("npm_execpath" in control.invocation.options.env, false);
  assert.equal("NODE_OPTIONS" in control.invocation.options.env, false);
  assert.equal(control.invocation.options.env.npm_config_registry, "https://registry.npmjs.org/");
  assert.equal(control.invocation.options.env.npm_config_ignore_scripts, "true");
  assert.equal(control.invocation.options.maxBuffer, 8 * 1024 * 1024);

  const launcherFailure = await runAudit(null, {
    resolveError: new Error(
      "launcher failed API_KEY=super-secret https://user:password@example.invalid/path?token=query-secret",
    ),
  });
  assert.equal(launcherFailure.result.exitCode, 1);
  assert.equal(launcherFailure.summary.issue, "audit-startup");
  assert.doesNotMatch(
    JSON.stringify(launcherFailure.summary),
    /super-secret|user:password|query-secret/i,
  );
  assert.equal(launcherFailure.invocation, null);

  const eslintHigh = canonicalAuditReport({ eslint: vulnerability("eslint", "high") });
  const allowedDev = await runAudit(eslintHigh, {
    argv: ["--include-dev", "--allow-known-dev-toolchain-high", "--summary-only"],
  });
  assert.equal(allowedDev.result.exitCode, 0);
  assert.equal(allowedDev.summary.scope, "all");
  assert.equal(allowedDev.summary.knownDevToolchainHigh, 1);
  assert.equal(allowedDev.summary.blockingHighCritical, 0);
  assert.doesNotMatch(allowedDev.invocation.args.join(" "), /--omit=dev/);

  for (const argv of [
    ["--include-dev", "--summary-only"],
    ["--allow-known-dev-toolchain-high", "--summary-only"],
  ]) {
    const rejected = await runAudit(eslintHigh, { argv });
    assert.equal(rejected.result.exitCode, 1);
    assert.equal(rejected.summary.status, "fail");
    assert.equal(rejected.summary.knownDevToolchainHigh, 0);
    assert.equal(rejected.summary.blockingHighCritical, 1);
  }

  for (const [name, report] of [
    ["critical allowlisted name", canonicalAuditReport({ eslint: vulnerability("eslint", "critical") })],
    ["unrelated high", canonicalAuditReport({ "runtime-package": vulnerability("runtime-package", "high") })],
  ]) {
    const blocked = await runAudit(report, {
      argv: ["--include-dev", "--allow-known-dev-toolchain-high", "--summary-only"],
    });
    assert.equal(blocked.result.exitCode, 1, name);
    assert.equal(blocked.summary.blockingHighCritical, 1, name);
    assert.equal(blocked.summary.knownDevToolchainHigh, 0, name);
  }

  for (const [report, detail] of [
    [null, "top-level-object"],
    [{ error: { code: "EAUDIT" } }, "top-level-error"],
    [{ ...canonicalAuditReport(), auditReportVersion: 1 }, "audit-report-version"],
    [{ ...canonicalAuditReport(), metadata: null }, "metadata-object"],
    [{ ...canonicalAuditReport(), metadata: { vulnerabilities: [] } }, "metadata-vulnerabilities-object"],
    [{ ...canonicalAuditReport(), vulnerabilities: [] }, "vulnerabilities-object"],
  ]) {
    const malformed = await runAudit(report);
    assert.equal(malformed.result.exitCode, 1);
    assert.deepEqual(malformed.summary, {
      status: "fail",
      scope: "production",
      issue: "audit-report",
      detail,
    });
  }

  const malformedCountReports = [];
  for (const value of ["1", "1e3", 1.5, -1, Number.MAX_SAFE_INTEGER + 1]) {
    const report = canonicalAuditReport();
    report.metadata.vulnerabilities.total = value;
    malformedCountReports.push(report);
  }
  {
    const report = canonicalAuditReport();
    delete report.metadata.vulnerabilities.low;
    malformedCountReports.push(report);
  }
  {
    const report = canonicalAuditReport();
    report.metadata.vulnerabilities.unknown = 0;
    malformedCountReports.push(report);
  }
  {
    const report = canonicalAuditReport({ pkg: vulnerability("pkg", "low") });
    report.metadata.vulnerabilities.total = 0;
    malformedCountReports.push(report);
  }
  {
    const report = canonicalAuditReport({ pkg: vulnerability("other-name", "low") });
    malformedCountReports.push(report);
  }
  for (const report of malformedCountReports) {
    const malformed = await runAudit(report);
    assert.equal(malformed.result.exitCode, 1);
    assert.equal(malformed.summary.status, "fail");
    assert.equal(malformed.summary.issue, "audit-counts");
    assert.ok(malformed.summary.countIssues > 0);
  }

  const startupSecret = "dependency-startup-secret-sentinel";
  const startup = await runAudit(null, {
    spawnError: new Error(`failed https://user:${startupSecret}@registry.example.invalid/${"x".repeat(700)}`),
  });
  assert.equal(startup.result.exitCode, 1);
  assert.equal(startup.summary.issue, "audit-startup");
  assert.ok(startup.summary.detail.length <= 500);
  assert.match(startup.summary.detail, /<truncated>$/);
  assert.doesNotMatch(startup.summary.detail, new RegExp(startupSecret));
  assert.match(startup.summary.detail, /<redacted>/);

  const jsonSecret = "dependency-json-secret-sentinel";
  const invalidJson = await runAudit(null, {
    rawOutput: `not-json https://user:${jsonSecret}@registry.example.invalid/${"y".repeat(700)}`,
  });
  assert.equal(invalidJson.result.exitCode, 1);
  assert.equal(invalidJson.summary.issue, "audit-json");
  assert.ok(invalidJson.summary.sample.length <= 500);
  assert.doesNotMatch(invalidJson.summary.sample, new RegExp(jsonSecret));
  assert.match(invalidJson.summary.sample, /<redacted>/);

  const full = await runAudit(moderate, { argv: [] });
  assert.equal(full.result.exitCode, 0);
  assert.equal(full.errors.length, 0);
  assert.match(full.logs.join("\n"), /Timestamp: 2026-08-14T10:00:00\.000Z/);
  assert.match(full.logs.join("\n"), /Production Dependency Audit/);
  assert.match(full.logs.join("\n"), /dependency audit passed with no high or critical advisories/);
}

function walletDependencyReport(overrides = {}) {
  return {
    dependencies: {
      "@privy-io/react-auth": { version: "3.27.2" },
      "@privy-io/wagmi": { version: "2.2.3" },
      wagmi: { version: "2.16.9" },
      viem: { version: "2.38.5" },
      ...overrides,
    },
  };
}

function runWalletDependencyAudit({
  report = walletDependencyReport(),
  raw = null,
  status = 0,
  spawnError = null,
  resolveError = null,
} = {}) {
  const logs = [];
  let invocation = null;
  const launcher = { command: "trusted-node", cliPath: "trusted-npm-cli", repoRoot: "C:\\trusted-repo" };
  const result = runWalletDependencyAuditCli({
    env: { ComSpec: "malicious-shell", npm_execpath: "malicious-npm" },
    resolveTrustedNpmCliFn: () => {
      if (resolveError) throw resolveError;
      return launcher;
    },
    trustedNpmCommandFn: (args) => ({ command: launcher.command, args: [launcher.cliPath, ...args] }),
    trustedNpmEnvironmentFn: () => ({ PATH: "trusted-only" }),
    spawnSyncFn: (command, args, options) => {
      invocation = { command, args, options };
      if (spawnError) return { error: spawnError, stdout: "", stderr: "" };
      return { status, stdout: raw === null ? JSON.stringify(report) : raw, stderr: "" };
    },
    log: (value) => logs.push(String(value)),
  });
  return { result, summary: JSON.parse(logs.at(-1)), invocation };
}

export function runWalletDependencyAuditBehaviorTests() {
  assert.deepEqual(REQUIRED_WALLET_PACKAGES, ["@privy-io/react-auth", "@privy-io/wagmi", "wagmi", "viem"]);
  const control = runWalletDependencyAudit();
  assert.equal(control.result.exitCode, 0);
  assert.deepEqual(control.summary, {
    status: "pass",
    privy: "3.27.2",
    privyWagmi: "2.2.3",
    wagmi: "2.16.9",
    viem: "2.38.5",
    missing: [],
  });
  assert.equal(control.invocation.command, "trusted-node");
  assert.deepEqual(control.invocation.args, ["trusted-npm-cli", "ls", ...REQUIRED_WALLET_PACKAGES, "--depth=1", "--json"]);
  assert.equal(control.invocation.options.cwd, "C:\\trusted-repo");
  assert.deepEqual(control.invocation.options.env, { PATH: "trusted-only" });
  assert.equal(control.invocation.options.maxBuffer, 1024 * 1024);

  const missing = runWalletDependencyAudit({ report: walletDependencyReport({ viem: undefined }) });
  assert.equal(missing.result.exitCode, 1);
  assert.deepEqual(missing.summary.missing, ["viem"]);
  assert.equal(runWalletDependencyAudit({ status: 1 }).result.exitCode, 1);

  for (const report of [null, [], { dependencies: [] }]) {
    const malformed = runWalletDependencyAudit({ report });
    assert.equal(malformed.result.exitCode, 1);
    assert.ok(["npm-ls-report", undefined].includes(malformed.summary.issue));
    if (malformed.summary.issue === undefined) assert.deepEqual(malformed.summary.missing, REQUIRED_WALLET_PACKAGES);
  }

  const secret = "wallet-dependency-secret-sentinel";
  for (const failure of [
    runWalletDependencyAudit({ raw: `not-json https://user:${secret}@registry.example.invalid/${"x".repeat(500)}` }),
    runWalletDependencyAudit({ spawnError: new Error(`spawn https://user:${secret}@example.invalid`) }),
    runWalletDependencyAudit({ resolveError: new Error(`resolve https://user:${secret}@example.invalid`) }),
  ]) {
    assert.equal(failure.result.exitCode, 1);
    assert.match(failure.summary.issue, /^npm-ls-(?:json|startup)$/);
    assert.doesNotMatch(JSON.stringify(failure.summary), new RegExp(secret));
    assert.ok(JSON.stringify(failure.summary).length <= 360);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runDependencyAuditBehaviorTests();
  runWalletDependencyAuditBehaviorTests();
  console.log("Dependency audit behavioral tests passed.");
}
