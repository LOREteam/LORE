import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstatSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  resolveTrustedNpmCli,
  trustedNpmCommand,
  trustedNpmEnvironment,
} from "./trusted-npm-cli.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const PREVIEW_SCRIPT = path.join(SCRIPT_DIR, "create-v10-canary-dry-run-preview.mjs");
const DEPENDENCY_AUDIT_SCRIPT = path.join(SCRIPT_DIR, "check-production-dependency-audit.mjs");
const CLEAR_PENDING_SCRIPT = path.join(SCRIPT_DIR, "clear-live-test-pending-nonce.ts");
const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli");
const SIGNING_ENV_NAME_RE = /(?:^|_)(?:PRIVATE_KEY|MNEMONIC|SEED(?:_PHRASE)?|SIGNING_KEY)(?:_|$)/i;
const UNTRUSTED_NPM_NETWORK_ENV_KEYS = [
  "all_proxy",
  "global_agent_http_proxy",
  "global_agent_https_proxy",
  "global_agent_no_proxy",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "node_extra_ca_certs",
  "node_tls_reject_unauthorized",
  "node_use_env_proxy",
  "node_use_system_ca",
  "openssl_conf",
  "openssl_modules",
  "ssl_cert_dir",
  "ssl_cert_file",
];

function inspectChildEnv(extraEnv) {
  const result = spawnSync(process.execPath, [PREVIEW_SCRIPT, "--inspect-read-only-child-env"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
  return JSON.parse(lines.at(-1));
}

function clearPendingEnv(extraEnv = {}) {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (
      SIGNING_ENV_NAME_RE.test(name) ||
      /^LORE_LIVE_TEST_(?:MANUAL|AUTOMINER_A|AUTOMINER_B|AUTOMINER_C|RESOLVER)_ADDRESS$/.test(name)
    ) {
      delete env[name];
    }
  }
  return {
    ...env,
    LINEA_NETWORK: "sepolia",
    NEXT_PUBLIC_LINEA_NETWORK: "sepolia",
    LIVE_TEST_EXECUTE: "0",
    ...extraEnv,
  };
}

function inspectClearPendingAddressFile(contents, extraEnv = {}) {
  const cwd = mkdtempSync(path.join(tmpdir(), "lore-preview-address-env-"));
  try {
    writeFileSync(path.join(cwd, ".env.live-test-addresses"), contents, "utf8");
    return spawnSync(process.execPath, [TSX_CLI, CLEAR_PENDING_SCRIPT, "--inspect-public-address-env"], {
      cwd,
      encoding: "utf8",
      env: clearPendingEnv(extraEnv),
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

function canonicalAuditReport(vulnerabilities = {}) {
  const counts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
  for (const item of Object.values(vulnerabilities)) {
    counts[item.severity] += 1;
    counts.total += 1;
  }
  return {
    auditReportVersion: 2,
    vulnerabilities,
    metadata: { vulnerabilities: counts },
  };
}

function runMockedDependencyAudit(report, {
  auditStatus = 0,
  args = [],
  extraEnv = {},
} = {}) {
  const cwd = mkdtempSync(path.join(tmpdir(), "lore-audit-cwd-"));
  const expectedRepoRoot = realpathSync(REPO_ROOT);
  const expectedUserConfig = realpathSync(path.join(REPO_ROOT, ".npmrc"));
  const preloadSource = `
    import childProcess from "node:child_process";
    import { syncBuiltinESMExports } from "node:module";
    const expectedRepoRoot = ${JSON.stringify(expectedRepoRoot)};
    const expectedUserConfig = ${JSON.stringify(expectedUserConfig)};
    const report = ${JSON.stringify(report)};
    const samePath = (left, right) => process.platform === "win32"
      ? String(left).toLowerCase() === String(right).toLowerCase()
      : String(left) === String(right);
    childProcess.spawnSync = (_command, _args, options) => {
      const npmKeys = Object.keys(options.env ?? {}).filter((key) => key.toLowerCase().startsWith("npm_"));
    const allowedNpmKeys = new Set([
        "npm_config_fund",
        "npm_config_global",
        "npm_config_ignore_scripts",
        "npm_config_offline",
        "npm_config_registry",
        "npm_config_script_shell",
        "npm_config_update_notifier",
        "npm_config_userconfig",
      ]);
      const poisoned = npmKeys.some((key) => !allowedNpmKeys.has(key.toLowerCase()));
      const forbiddenNetworkKeys = new Set(${JSON.stringify(UNTRUSTED_NPM_NETWORK_ENV_KEYS)});
      const poisonedNetwork = Object.keys(options.env ?? {})
        .some((key) => forbiddenNetworkKeys.has(key.toLowerCase()));
      const boundaryValid =
        samePath(options.cwd, expectedRepoRoot) &&
        samePath(options.env?.npm_config_userconfig, expectedUserConfig) &&
        options.env?.npm_config_global === "false" &&
        options.env?.npm_config_offline === "false" &&
        options.env?.npm_config_registry === "https://registry.npmjs.org/" &&
        options.env?.npm_config_ignore_scripts === "true" &&
        !poisoned &&
        !poisonedNetwork;
      const output = boundaryValid ? report : { error: { code: "MOCK_BOUNDARY_BYPASS" } };
      return {
        status: ${JSON.stringify(auditStatus)},
        signal: null,
        stdout: JSON.stringify(output),
        stderr: "",
      };
    };
    syncBuiltinESMExports();
  `;
  const preloadUrl = `data:text/javascript;base64,${Buffer.from(preloadSource).toString("base64")}`;
  try {
    const result = spawnSync(
      process.execPath,
      ["--import", preloadUrl, DEPENDENCY_AUDIT_SCRIPT, "--summary-only", ...args],
      {
        cwd,
        encoding: "utf8",
        env: { ...process.env, ...extraEnv },
      },
    );
    const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
    return { result, summary: lines.length > 0 ? JSON.parse(lines.at(-1)) : null };
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

test("Preview child env preserves public planning config and excludes malicious credentials", () => {
  const publicConfig = {
    LINEA_NETWORK: "sepolia",
    NEXT_PUBLIC_CONTRACT_ADDRESS: "0x1111111111111111111111111111111111111111",
    NEXT_PUBLIC_LINEA_TOKEN_ADDRESS: "0x2222222222222222222222222222222222222222",
    NEXT_PUBLIC_CONTRACT_HAS_TOKEN_GETTER: "1",
    V10_POSTDEPLOY_SCAN_EPOCHS: "17",
    V10_EXPECTED_CURRENT_OWNER: "0x3333333333333333333333333333333333333333",
    LIVE_CANARY_RPC_LABEL: "public-sepolia-fallback",
  };
  const forbidden = {
    TEST_WALLET_PRIVATE_KEY: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    KEEPER_MNEMONIC: "malicious test mnemonic",
    HEALTH_DIAGNOSTICS_SECRET: "malicious-health-secret",
    ADMIN_AUTH_TOKEN: "malicious-auth-token",
    SENTRY_DSN: "https://credential@example.invalid/1",
    ALERT_WEBHOOK_URL: "https://credential@example.invalid/hook",
    LIVE_TEST_RPC_URL: "https://credential@example.invalid/rpc",
    NEXT_PUBLIC_LINEA_RPCS: "https://credential@example.invalid/public-rpc",
  };
  const inspection = inspectChildEnv({
    ...publicConfig,
    ...forbidden,
    LIVE_TEST_EXECUTE: "1",
    SOAK_EXECUTE_LIVE: "1",
    TEST_WALLET_EXECUTE: "1",
  });

  assert.equal(inspection.signingMaterialLoaded, false);
  assert.equal(inspection.sensitiveCredentialKeysPresent, false);
  assert.deepEqual(inspection.publicConfig, publicConfig);
  assert.deepEqual(inspection.executionGates, {
    LIVE_TEST_EXECUTE: "0",
    SOAK_EXECUTE_LIVE: "0",
    TEST_WALLET_EXECUTE: "0",
  });
  for (const name of Object.keys(forbidden)) {
    assert.equal(inspection.childEnvKeys.includes(name), false, `${name} escaped the child env allowlist`);
  }
});

test("Preview and proof commands ignore poisoned package-manager, PATH, and shell environment", () => {
  const poison = path.join(REPO_ROOT, "malicious-launcher-sentinel");
  const networkPoison = {
    aLl_PrOxY: "http://malicious-proxy.example.invalid/",
    Global_Agent_Http_Proxy: "http://malicious-proxy.example.invalid/",
    GLOBAL_AGENT_HTTPS_PROXY: "http://malicious-proxy.example.invalid/",
    global_agent_NO_proxy: "*",
    hTtP_pRoXy: "http://malicious-proxy.example.invalid/",
    HtTpS_pRoXy: "http://malicious-proxy.example.invalid/",
    No_Proxy: "*",
    Node_Extra_CA_Certs: poison,
    nOdE_TlS_rEjEcT_uNaUtHoRiZeD: "0",
    NODE_USE_ENV_PROXY: "1",
    Node_Use_System_CA: "1",
    OpenSSL_CONF: poison,
    oPeNsSl_MoDuLeS: poison,
    SSL_CERT_FILE: poison,
    sSl_CeRt_DiR: poison,
  };
  const launcher = resolveTrustedNpmCli({ repoRoot: REPO_ROOT });
  const command = trustedNpmCommand(["--version"], launcher);
  const env = trustedNpmEnvironment({
    ...process.env,
    npm_execpath: poison,
    npm_node_execpath: poison,
    PATH: poison,
    Path: poison,
    PATHEXT: ".POISON",
    ComSpec: poison,
    COMSPEC: poison,
    npm_config_script_shell: poison,
    NPM_CONFIG_USERCONFIG: poison,
    NPM_CONFIG_NODE_OPTIONS: `--require=${poison}`,
    npm_config_global: "true",
    NPM_CONFIG_REGISTRY: "https://malicious-registry.example.invalid/",
    npm_config_offline: "true",
    npm_package_json: poison,
    NPM_PACKAGE_SCRIPTS_BUILD: poison,
    npm_lifecycle_event: "postinstall",
    NPM_LIFECYCLE_SCRIPT: poison,
    npm_command: "exec",
    INIT_CWD: poison,
    NODE_OPTIONS: `--require=${poison}`,
    NODE_PATH: poison,
    BASH_ENV: poison,
    ...networkPoison,
  }, launcher);

  assert.equal(command.command, realpathSync(process.execPath));
  assert.equal(command.args[0], launcher.cliPath);
  assert.equal(lstatSync(command.command).isFile(), true);
  assert.equal(lstatSync(command.args[0]).isFile(), true);
  assert.equal(Object.values(env).includes(poison), false);
  assert.equal("npm_execpath" in env, false);
  assert.equal("npm_node_execpath" in env, false);
  assert.doesNotMatch(env.PATH, /malicious-launcher-sentinel/);
  assert.doesNotMatch(env.npm_config_script_shell, /malicious-launcher-sentinel/);
  assert.equal(env.npm_config_userconfig, realpathSync(path.join(REPO_ROOT, ".npmrc")));
  assert.equal("NPM_CONFIG_USERCONFIG" in env, false);
  assert.equal("NPM_CONFIG_NODE_OPTIONS" in env, false);
  assert.equal("NPM_CONFIG_REGISTRY" in env, false);
  assert.equal("npm_package_json" in env, false);
  assert.equal("NPM_PACKAGE_SCRIPTS_BUILD" in env, false);
  assert.equal("npm_lifecycle_event" in env, false);
  assert.equal("NPM_LIFECYCLE_SCRIPT" in env, false);
  assert.equal("npm_command" in env, false);
  assert.equal("INIT_CWD" in env, false);
  assert.equal(env.npm_config_global, "false");
  assert.equal(env.npm_config_offline, "false");
  assert.equal(env.npm_config_registry, "https://registry.npmjs.org/");
  assert.equal(env.npm_config_ignore_scripts, "true");
  assert.deepEqual(
    Object.keys(env)
      .filter((key) => key.toLowerCase().startsWith("npm_"))
      .map((key) => key.toLowerCase())
      .sort(),
    [
      "npm_config_fund",
      "npm_config_global",
      "npm_config_ignore_scripts",
      "npm_config_offline",
      "npm_config_registry",
      "npm_config_script_shell",
      "npm_config_update_notifier",
      "npm_config_userconfig",
    ],
  );
  assert.equal("NODE_OPTIONS" in env, false);
  assert.equal("NODE_PATH" in env, false);
  assert.equal("BASH_ENV" in env, false);
  for (const key of Object.keys(networkPoison)) {
    assert.equal(
      Object.keys(env).some((candidate) => candidate.toLowerCase() === key.toLowerCase()),
      false,
      `${key} escaped the canonical npm network boundary`,
    );
  }
  if (process.platform === "win32") assert.notEqual(env.ComSpec, poison);

  const result = spawnSync(command.command, command.args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout.trim(), /^\d+\.\d+\.\d+/);

  if (process.platform === "win32") {
    const runtimeDerivedEnv = trustedNpmEnvironment({}, launcher);
    const runtimeDerivedSystemRoot = realpathSync(
      path.resolve(path.parse(REPO_ROOT).root, "Windows"),
    );
    assert.equal(runtimeDerivedEnv.SystemRoot.toLowerCase(), runtimeDerivedSystemRoot.toLowerCase());
    assert.equal(runtimeDerivedEnv.WINDIR.toLowerCase(), runtimeDerivedSystemRoot.toLowerCase());
    const alternateDriveLauncher = {
      ...launcher,
      command: "D:\\trusted-node\\node.exe",
    };
    const alternateDriveEnv = trustedNpmEnvironment({}, alternateDriveLauncher);
    assert.equal(alternateDriveEnv.SystemRoot.toLowerCase(), runtimeDerivedSystemRoot.toLowerCase());
    assert.equal(alternateDriveEnv.ComSpec.toLowerCase(), path.join(
      runtimeDerivedSystemRoot,
      "System32",
      "cmd.exe",
    ).toLowerCase());
    assert.throws(
      () => trustedNpmEnvironment({ ...process.env, SystemRoot: "X:\\Windows" }, launcher),
      /runtime-derived canonical Windows installation/,
    );
    assert.throws(
      () => trustedNpmEnvironment({
        ...process.env,
        SystemRoot: `${process.env.SystemRoot}\\System32\\..`,
      }, launcher),
      /runtime-derived canonical Windows installation/,
    );
  }

  const previewSource = readFileSync(PREVIEW_SCRIPT, "utf8");
  const dependencyAuditSource = readFileSync(
    path.join(SCRIPT_DIR, "check-production-dependency-audit.mjs"),
    "utf8",
  );
  for (const source of [previewSource, dependencyAuditSource]) {
    assert.match(source, /resolveTrustedNpmCli/);
    assert.match(source, /trustedNpmCommand/);
    assert.match(source, /trustedNpmEnvironment/);
    assert.doesNotMatch(source, /process\.env\.npm_execpath|process\.env\.ComSpec|command:\s*["']npm(?:\.cmd)?["']/);
  }
  assert.match(previewSource, /cwd: TRUSTED_NPM_LAUNCHER\.repoRoot/);
  assert.match(dependencyAuditSource, /cwd: trustedNpmLauncher\.repoRoot/);
});

test("dependency audit accepts a complete canonical report despite npm's advisory exit status", () => {
  const report = canonicalAuditReport({
    "safe-moderate-package": {
      name: "safe-moderate-package",
      severity: "moderate",
      via: [],
      effects: [],
      range: "*",
      nodes: ["node_modules/safe-moderate-package"],
      fixAvailable: false,
    },
  });
  const { result, summary } = runMockedDependencyAudit(report, {
    auditStatus: 1,
    extraEnv: {
      npm_config_global: "true",
      NPM_CONFIG_REGISTRY: "https://malicious-registry.example.invalid/",
      npm_config_offline: "true",
      npm_package_json: "malicious-package.json",
      npm_lifecycle_script: "malicious-command",
      HtTpS_pRoXy: "http://malicious-proxy.example.invalid/",
      Node_Extra_CA_Certs: path.join(REPO_ROOT, "malicious-ca.pem"),
      nOdE_TlS_rEjEcT_uNaUtHoRiZeD: "0",
    },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(summary.status, "pass");
  assert.equal(summary.moderate, 1);
  assert.equal(summary.blockingHighCritical, 0);
});

test("dependency audit preserves only the documented dev high exception", () => {
  const report = canonicalAuditReport({
    eslint: {
      name: "eslint",
      severity: "high",
      via: [],
      effects: [],
      range: "*",
      nodes: ["node_modules/eslint"],
      fixAvailable: false,
    },
  });
  const { result, summary } = runMockedDependencyAudit(report, {
    auditStatus: 1,
    args: ["--include-dev", "--allow-known-dev-toolchain-high"],
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(summary.status, "pass");
  assert.equal(summary.knownDevToolchainHigh, 1);
  assert.equal(summary.blockingHighCritical, 0);
});

test("dependency audit rejects error, versionless, incomplete, and non-object reports", () => {
  const cases = [
    [{ error: { code: "EAUDIT", summary: "registry unavailable" } }, "top-level-error"],
    [{ ...canonicalAuditReport(), auditReportVersion: undefined }, "audit-report-version"],
    [{
      ...canonicalAuditReport(),
      metadata: { vulnerabilities: { low: 0, moderate: 0, high: 0, critical: 0, total: 0 } },
    }, null],
    [{
      ...canonicalAuditReport(),
      metadata: {
        vulnerabilities: {
          ...canonicalAuditReport().metadata.vulnerabilities,
          unknown: 0,
        },
      },
    }, null],
    [{ ...canonicalAuditReport(), vulnerabilities: [] }, "vulnerabilities-object"],
  ];

  for (const [report, expectedDetail] of cases) {
    const { result, summary } = runMockedDependencyAudit(report, { auditStatus: 1 });
    assert.equal(result.status, 1, result.stderr || result.stdout);
    assert.equal(summary.status, "fail");
    if (expectedDetail) {
      assert.equal(summary.issue, "audit-report");
      assert.equal(summary.detail, expectedDetail);
    } else {
      assert.equal(summary.issue, "audit-counts");
      assert.ok(summary.countIssues > 0);
    }
  }
});

test("read-only planner, matrix, and playtest paths do not preload combined dotenv", () => {
  const previewSource = readFileSync(PREVIEW_SCRIPT, "utf8");
  const plannerSource = readFileSync(path.join(SCRIPT_DIR, "plan-v10-postdeploy-canary.ts"), "utf8");
  const liveSource = readFileSync(path.join(SCRIPT_DIR, "live-round-canary.ts"), "utf8");
  const playtestSource = readFileSync(path.join(SCRIPT_DIR, "playtest-wallet.ts"), "utf8");

  assert.doesNotMatch(previewSource, /\.\.\.process\.env/);
  assert.doesNotMatch(plannerSource, /dotenv\/config/);
  assert.doesNotMatch(liveSource, /dotenv\/config/);
  assert.doesNotMatch(playtestSource, /dotenv\/config/);
  assert.match(liveSource, /processEnv: isolatedEnv/);
  assert.match(liveSource, /may contain only public live-test role addresses/);
  assert.match(liveSource, /const wallets = DRY_RUN \? loadDryRunWallets\(\) : loadWallets\(\)/);
  assert.match(
    playtestSource,
    /if \(EXECUTE_REQUESTED[\s\S]*if \(LIVE_EXECUTION_CONFIRMED\) \{[\s\S]*loadDotenv\([\s\S]*const account = LIVE_EXECUTION_CONFIRMED/,
  );
});

test("Preview distinguishes an unreported child boundary from detected signing material", () => {
  const previewSource = readFileSync(PREVIEW_SCRIPT, "utf8");
  assert.match(
    previewSource,
    /const operationBoundaryReports = \[[\s\S]*plannerSummary\.signingMaterialLoaded,[\s\S]*pendingSummary\.signingMaterialLoaded,[\s\S]*matrixSummary\.signingMaterialLoaded,[\s\S]*\];[\s\S]*operationBoundaryReports\.some\(\(reported\) => reported === true\)[\s\S]*operationBoundaryReports\.every\(\(reported\) => reported === false\)/,
    "a child that exits before reporting its boundary must remain unverified, not be reported as signing material",
  );
  assert.match(
    previewSource,
    /hardFailures\.length === 0 &&[\s\S]*operationBoundaryVerified &&[\s\S]*!signingMaterialLoaded/,
    "Preview success must still fail closed until every child reports no signing material",
  );
  assert.match(
    previewSource,
    /operationalBoundaryVerified: operationBoundaryVerified/,
    "the compact Preview summary must publish the verified-boundary field without a misspelled shorthand",
  );
});

test("pending-nonce Preview child parses only exact public role address keys", () => {
  const publicAddressFile = [
    "LORE_LIVE_TEST_MANUAL_ADDRESS=0x1111111111111111111111111111111111111111",
    "LORE_LIVE_TEST_AUTOMINER_A_ADDRESS=0x2222222222222222222222222222222222222222",
    "LORE_LIVE_TEST_AUTOMINER_B_ADDRESS=0x3333333333333333333333333333333333333333",
    "LORE_LIVE_TEST_AUTOMINER_C_ADDRESS=0x4444444444444444444444444444444444444444",
    "LORE_LIVE_TEST_RESOLVER_ADDRESS=0x5555555555555555555555555555555555555555",
    "",
  ].join("\n");
  const result = inspectClearPendingAddressFile(publicAddressFile);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const inspection = JSON.parse(result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1));
  assert.equal(inspection.mode, "dry-run");
  assert.equal(inspection.signingMaterialLoaded, false);
  assert.deepEqual(inspection.publicAddressKeys, [
    "LORE_LIVE_TEST_AUTOMINER_A_ADDRESS",
    "LORE_LIVE_TEST_AUTOMINER_B_ADDRESS",
    "LORE_LIVE_TEST_AUTOMINER_C_ADDRESS",
    "LORE_LIVE_TEST_MANUAL_ADDRESS",
    "LORE_LIVE_TEST_RESOLVER_ADDRESS",
  ]);
  assert.equal(inspection.walletClientCreated, false);
  assert.equal(inspection.contractWriteSubmitted, false);
  assert.equal(inspection.transactionSent, false);
});

test("pending-nonce Preview child rejects a non-Sepolia network before RPC work", () => {
  const result = inspectClearPendingAddressFile(
    "LORE_LIVE_TEST_AUTOMINER_A_ADDRESS=0x2222222222222222222222222222222222222222\n",
    {
      LINEA_NETWORK: "mainnet",
      NEXT_PUBLIC_LINEA_NETWORK: "mainnet",
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /limited to Linea Sepolia live-test wallets/);
  assert.equal(result.stdout.trim(), "");
});

test("pending-nonce Preview child rejects signing material in the public address file", () => {
  const sentinel = "malicious-preview-private-key-sentinel";
  const result = inspectClearPendingAddressFile([
    "LORE_LIVE_TEST_AUTOMINER_A_ADDRESS=0x2222222222222222222222222222222222222222",
    `LORE_LIVE_TEST_AUTOMINER_A_PRIVATE_KEY=${sentinel}`,
    "",
  ].join("\n"));
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /may contain only public live-test role addresses/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(sentinel));
});

test("pending-nonce Preview child detects inherited signing material before RPC work", () => {
  const result = inspectClearPendingAddressFile(
    "LORE_LIVE_TEST_AUTOMINER_A_ADDRESS=0x2222222222222222222222222222222222222222\n",
    { LORE_LIVE_TEST_AUTOMINER_A_PRIVATE_KEY: "inherited-signing-sentinel" },
  );
  assert.notEqual(result.status, 0);
  const inspection = JSON.parse(result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1));
  assert.equal(inspection.signingMaterialLoaded, true);
  assert.equal(inspection.walletClientCreated, false);
  assert.equal(inspection.contractWriteSubmitted, false);
  assert.equal(inspection.transactionSent, false);
  assert.match(result.stderr, /inspection refuses inherited signing material/);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /inherited-signing-sentinel/);
});
