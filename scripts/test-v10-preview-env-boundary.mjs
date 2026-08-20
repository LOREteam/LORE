import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { privateKeyToAccount } from "viem/accounts";
import { loadLiveTestPublicWalletConfig } from "./live-test-wallet-config.mjs";
import {
  resolveTrustedNpmCli,
  trustedNpmCommand,
  trustedNpmEnvironment,
} from "./trusted-npm-cli.mjs";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const PREVIEW_SCRIPT = path.join(SCRIPT_DIR, "create-v10-canary-dry-run-preview.mjs");
const PREVIEW_CHECK_SCRIPT = path.join(SCRIPT_DIR, "check-v10-dry-run-preview.mjs");
const DEPENDENCY_AUDIT_SCRIPT = path.join(SCRIPT_DIR, "check-production-dependency-audit.mjs");
const CLEAR_PENDING_SCRIPT = path.join(SCRIPT_DIR, "clear-live-test-pending-nonce.ts");
const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli");
const LIVE_CANARY_SCRIPT = path.join(SCRIPT_DIR, "live-round-canary.ts");
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
const DRY_RUN_LOG_TEXT = "{}\n";
const DRY_RUN_LOG_NAME = "live-canary-20260813T000000Z.jsonl";
const DRY_RUN_LOG_RELATIVE_PATH = path.join("data", "live-test-runs", DRY_RUN_LOG_NAME);
const LIVE_WALLET_ROLES = ["MANUAL", "AUTOMINER_A", "AUTOMINER_B", "AUTOMINER_C", "RESOLVER"];
const WALLET_SET_SHA256 = "a".repeat(64);
const CANARY_PLAN_SHA256 = "b".repeat(64);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

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

function previewStepOutputs({
  planner = {},
  pending = {},
  matrix = {},
  logPath = DRY_RUN_LOG_RELATIVE_PATH,
  analyzer = {},
} = {}) {
  const plannerSummary = {
    mode: "read-only",
    network: "sepolia",
    chainId: 59141,
    transactionSent: false,
    signingMaterialLoaded: false,
    walletClientCreated: false,
    contractWriteSubmitted: false,
    transactionLimit: 4,
    estimatedGas: 21000,
    plannedTransfersLinea: "0",
    ...planner,
  };
  const pendingSummary = {
    role: "AUTOMINER_A",
    mode: "dry-run",
    pendingNonceGap: 0,
    wouldSendReplacement: false,
    txSent: false,
    signing: false,
    walletClient: false,
    contractWrite: false,
    ...pending,
  };
  const matrixSummary = {
    network: "sepolia",
    chainId: "59141",
    execution: "dry-run",
    rounds: "2",
    plannedBetTx: "4",
    plannedStake: "0",
    ready: "4/4",
    transactionSent: "false",
    signingMaterialLoaded: "false",
    walletClientCreated: "false",
    contractWriteSubmitted: "false",
    walletSetSha256: WALLET_SET_SHA256,
    canaryPlanSha256: CANARY_PLAN_SHA256,
    ...matrix,
  };
  const matrixLine = Object.entries(matrixSummary)
    .map(([name, value]) => `${name}=${value}`)
    .join(" ");
  return [
    { status: 0, stdout: `${JSON.stringify(plannerSummary)}\n`, stderr: "" },
    { status: 0, stdout: `${JSON.stringify(pendingSummary)}\n`, stderr: "" },
    {
      status: 0,
      stdout: `[live-canary] ${matrixLine}\n[live-canary] log=${logPath}\n`,
      stderr: "",
    },
    {
      status: 1,
      signal: null,
      stdout: [
        `Log: ${path.basename(logPath)}`,
        `Log SHA-256: ${sha256(DRY_RUN_LOG_TEXT)}`,
        `Log bytes: ${Buffer.byteLength(DRY_RUN_LOG_TEXT, "utf8")}`,
        "blocked gates: G10, G11",
        "successful bet tx: 0",
        "unique bet epochs: 0",
        "missing V10 gas cases: all",
      ].join("\n"),
      stderr: "",
      ...analyzer,
    },
  ];
}

function runMockedPreview(overrides = {}, { matrixLogPath, absoluteMatrixLog = false, analyzer } = {}) {
  const cwd = mkdtempSync(path.join(tmpdir(), "lore-preview-boundary-"));
  mkdirSync(path.join(cwd, "docs"));
  const logDir = path.join(cwd, "data", "live-test-runs");
  mkdirSync(logDir, { recursive: true });
  writeFileSync(path.join(logDir, DRY_RUN_LOG_NAME), DRY_RUN_LOG_TEXT, "utf8");
  const outputLogPath = matrixLogPath ?? (absoluteMatrixLog
    ? path.join(logDir, DRY_RUN_LOG_NAME)
    : DRY_RUN_LOG_RELATIVE_PATH);
  const outputs = previewStepOutputs({
    ...overrides,
    logPath: outputLogPath,
    analyzer,
  });
  const preloadSource = `
    import childProcess from "node:child_process";
    import { syncBuiltinESMExports } from "node:module";
    const outputs = ${JSON.stringify(outputs)};
    let callIndex = 0;
    childProcess.spawnSync = () => {
      const output = outputs[callIndex++] ?? {
        status: 1,
        stdout: "",
        stderr: "unexpected mocked Preview child invocation",
      };
      return { signal: null, ...output };
    };
    syncBuiltinESMExports();
  `;
  const preloadUrl = `data:text/javascript;base64,${Buffer.from(preloadSource).toString("base64")}`;
  try {
    const result = spawnSync(process.execPath, ["--import", preloadUrl, PREVIEW_SCRIPT], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, LIVE_CANARY_RPC_LABEL: "test-public-sepolia" },
    });
    const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
    return {
      result,
      summary: lines.length > 0 ? JSON.parse(lines.at(-1)) : null,
      markdown: readFileSync(path.join(cwd, "docs", "v10-canary-dry-run-preview.md"), "utf8"),
    };
  } finally {
    rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

function checkPreviewMarkdown(markdown, { logText = DRY_RUN_LOG_TEXT } = {}) {
  const cwd = mkdtempSync(path.join(tmpdir(), "lore-preview-check-"));
  const docsDir = path.join(cwd, "docs");
  const logDir = path.join(cwd, "data", "live-test-runs");
  mkdirSync(docsDir);
  mkdirSync(logDir, { recursive: true });
  writeFileSync(path.join(docsDir, "v10-canary-dry-run-preview.md"), markdown, "utf8");
  writeFileSync(path.join(logDir, "live-canary-20260813T000000Z.jsonl"), logText, "utf8");
  try {
    const result = spawnSync(process.execPath, [PREVIEW_CHECK_SCRIPT], {
      cwd,
      encoding: "utf8",
      env: process.env,
    });
    const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
    return { result, summary: lines.length > 0 ? JSON.parse(lines.at(-1)) : null };
  } finally {
    rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

function bindMarkdownLog(markdown, logText) {
  const digest = sha256(logText);
  const bytes = String(Buffer.byteLength(logText, "utf8"));
  let result = replaceSectionBullet(markdown, "V10 Matrix Dry-Run", "logSha256", digest);
  result = replaceSectionBullet(result, "V10 Matrix Dry-Run", "logBytes", bytes);
  result = replaceSectionBullet(result, "Dry-Run Proof Analysis", "logSha256", digest);
  return replaceSectionBullet(result, "Dry-Run Proof Analysis", "logBytes", bytes);
}

function makeBoundPreviewMarkdown(
  logText,
  { walletSetSha256 = WALLET_SET_SHA256, canaryPlanSha256 = CANARY_PLAN_SHA256 } = {},
) {
  const digest = sha256(logText);
  const bytes = Buffer.byteLength(logText, "utf8");
  return `# V10 Canary Dry-Run Preview

Last updated: ${new Date().toISOString()}.

Scope: Linea Sepolia V10 read-only and dry-run readiness only. This document is
not an authorization to send transactions, start a soak, deploy, or change
contract behavior.

## Overall Status

- status: pass
- transactionSent: false
- signingMaterialLoaded: false
- operationalBoundaryVerified: true
- walletClientCreated: false
- contractWriteSubmitted: false
- dryRunProofBlocksG10G11: true
- walletSetSha256: ${walletSetSha256}
- canaryPlanSha256: ${canaryPlanSha256}

## Read-Only Planner

- exit: 0
- mode: read-only
- network: sepolia
- chainId: 59141
- transactionSent: false
- signingMaterialLoaded: false
- walletClientCreated: false
- contractWriteSubmitted: false
- transactionLimit: 4
- estimatedGas: 21000

## Pending Nonce Dry-Run

- exit: 0
- mode: dry-run
- wouldSend: false
- transactionSent: false
- signingMaterialLoaded: false
- walletClientCreated: false
- contractWriteSubmitted: false

## V10 Matrix Dry-Run

- exit: 0
- network: sepolia
- chainId: 59141
- execution: dry-run
- plannedBetTx: 4
- walletSetSha256: ${walletSetSha256}
- canaryPlanSha256: ${canaryPlanSha256}
- transactionSent: false
- signingMaterialLoaded: false
- walletClientCreated: false
- contractWriteSubmitted: false
- log: data/live-test-runs/live-canary-20260813T000000Z.jsonl
- logBytes: ${bytes}
- logSha256: ${digest}

## Dry-Run Proof Analysis

- exit: 1
- dryRunProofBlocksG10G11: true
- successfulBetTx: 0
- uniqueBetEpochs: 0
- logSha256: ${digest}
- logBytes: ${bytes}

## Fresh Consent Boundary

Do not execute any of the following without a fresh exact authorization after a
fresh Preview rerun:
`;
}

function replaceSectionBullet(markdown, title, label, value) {
  const start = markdown.indexOf(`## ${title}`);
  assert.notEqual(start, -1, `missing ${title} section`);
  const next = markdown.indexOf("\n## ", start + 3);
  const end = next === -1 ? markdown.length : next;
  const section = markdown.slice(start, end);
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`^- ${escaped}:.*(?:\\r?\\n)?`, "m");
  assert.match(section, pattern, `missing ${label} bullet in ${title}`);
  const replacement = value === null ? "" : `- ${label}: ${value}\n`;
  return `${markdown.slice(0, start)}${section.replace(pattern, replacement)}${markdown.slice(end)}`;
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

function inspectExecutionWalletBinding({ publicAddresses, signingFile, extraEnv = {} }) {
  const cwd = mkdtempSync(path.join(tmpdir(), "lore-live-wallet-binding-"));
  try {
    writeFileSync(
      path.join(cwd, ".env.live-test-addresses"),
      publicAddresses === undefined
        ? ""
        : `${LIVE_WALLET_ROLES.map((role, index) => `LORE_LIVE_TEST_${role}_ADDRESS=${publicAddresses[index]}`).join("\n")}\n`,
      "utf8",
    );
    writeFileSync(path.join(cwd, ".env.live-test-wallets"), signingFile, "utf8");
    const fetchGuard = `data:text/javascript,${encodeURIComponent(
      'globalThis.fetch=async()=>{throw new Error("NETWORK_CALL_FORBIDDEN")}',
    )}`;
    return spawnSync(
      process.execPath,
      [
        `--import=${fetchGuard}`,
        TSX_CLI,
        LIVE_CANARY_SCRIPT,
        "--execute-live",
        "--inspect-execution-wallet-binding",
      ],
      {
        cwd,
        encoding: "utf8",
        env: clearPendingEnv({
          LINEA_NETWORK: "sepolia",
          NEXT_PUBLIC_LINEA_NETWORK: "sepolia",
          LIVE_CANARY_RPC_LABEL: "fixture-public-sepolia",
          LIVE_TEST_EXECUTE: "1",
          LIVE_TEST_ROLES: "MANUAL",
          ...extraEnv,
        }),
        timeout: 10_000,
      },
    );
  } finally {
    rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

function runLiveCanaryInspection(cwd, args, extraEnv = {}) {
  const fetchGuard = `data:text/javascript,${encodeURIComponent(
    'globalThis.fetch=async()=>{throw new Error("NETWORK_CALL_FORBIDDEN")}',
  )}`;
  return spawnSync(process.execPath, [`--import=${fetchGuard}`, TSX_CLI, LIVE_CANARY_SCRIPT, ...args], {
    cwd,
    encoding: "utf8",
    env: clearPendingEnv({
      LINEA_NETWORK: "sepolia",
      NEXT_PUBLIC_LINEA_NETWORK: "sepolia",
      NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS: "1",
      LIVE_CANARY_RPC_LABEL: "fixture-public-sepolia",
      LIVE_TEST_ROLES: "MANUAL",
      ...extraEnv,
    }),
    timeout: 30_000,
  });
}

function inspectFreshPreviewBinding({ executionExtraEnv = {}, mutateAfterBinding } = {}) {
  const cwd = mkdtempSync(path.join(tmpdir(), "lore-fresh-preview-binding-"));
  try {
    const docsDir = path.join(cwd, "docs");
    const logDir = path.join(cwd, "data", "live-test-runs");
    mkdirSync(docsDir);
    mkdirSync(logDir, { recursive: true });

    const signerKeys = LIVE_WALLET_ROLES.map((_, index) => `0x${String(index + 1).padStart(64, "0")}`);
    const signerAddresses = signerKeys.map((key) => privateKeyToAccount(key).address);
    const publicFilePath = path.join(cwd, ".env.live-test-addresses");
    const publicFileText = `${LIVE_WALLET_ROLES.map(
      (role, index) => `LORE_LIVE_TEST_${role}_ADDRESS=${signerAddresses[index]}`,
    ).join("\n")}\n`;
    writeFileSync(publicFilePath, publicFileText, "utf8");

    const publicConfig = loadLiveTestPublicWalletConfig({
      cwd,
      environment: clearPendingEnv(),
    });
    const planResult = runLiveCanaryInspection(cwd, ["--v10-matrix-only", "--inspect-canary-plan"]);
    assert.equal(planResult.status, 0, planResult.stderr || planResult.stdout);
    const planSummary = JSON.parse(planResult.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1));

    writeFileSync(path.join(logDir, DRY_RUN_LOG_NAME), DRY_RUN_LOG_TEXT, "utf8");
    const previewPath = path.join(docsDir, "v10-canary-dry-run-preview.md");
    const markdown = makeBoundPreviewMarkdown(DRY_RUN_LOG_TEXT, {
      walletSetSha256: publicConfig.walletSetSha256,
      canaryPlanSha256: planSummary.canaryPlanSha256,
    });
    writeFileSync(previewPath, markdown, "utf8");
    const previewSha256 = sha256(markdown);

    mutateAfterBinding?.({ cwd, previewPath, publicFilePath, publicFileText, signerAddresses });
    const result = runLiveCanaryInspection(
      cwd,
      ["--v10-matrix-only", "--execute", "--execute-live", "--inspect-fresh-preview-binding"],
      {
        LIVE_TEST_EXECUTE: "1",
        LIVE_TEST_PREVIEW_SHA256: previewSha256,
        ...executionExtraEnv,
      },
    );
    return { result, previewSha256, walletSetSha256: publicConfig.walletSetSha256, canaryPlanSha256: planSummary.canaryPlanSha256 };
  } finally {
    rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
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
  assert.match(previewSource, /resolveTrustedNpmCli/);
  assert.match(previewSource, /trustedNpmCommand/);
  assert.match(previewSource, /trustedNpmEnvironment/);
  assert.doesNotMatch(previewSource, /process\.env\.npm_execpath|process\.env\.ComSpec|command:\s*["']npm(?:\.cmd)?["']/);
  assert.match(previewSource, /cwd: TRUSTED_NPM_LAUNCHER\.repoRoot/);
});

test("V10 post-deploy summary remains executable inside the sanitized preview PATH", () => {
  const launcher = resolveTrustedNpmCli({ repoRoot: REPO_ROOT });
  const command = trustedNpmCommand(["run", "plan:canary:v10:postdeploy:summary"], launcher);
  const env = trustedNpmEnvironment({
    SystemRoot: process.env.SystemRoot,
    WINDIR: process.env.WINDIR,
    NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS: "0",
  }, launcher);
  const result = spawnSync(command.command, command.args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env,
    timeout: 120_000,
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

  assert.equal(result.error?.code, undefined, output);
  assert.notEqual(result.status, 0, output);
  assert.match(output, /"target":"v10"[\s\S]*"manifestMatches":true/);
  assert.match(output, /V10 post-deploy planning requires epoch-bound runtime mode/);
  assert.doesNotMatch(output, /'npm' is not recognized|npm: (?:command )?not found/i);
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
  assert.match(
    liveSource,
    /operationalBoundary signingMaterialLoaded=\$\{signingMaterialLoaded\}[\s\S]*transactionSent=false walletClientCreated=false contractWriteSubmitted=false/,
  );
  assert.match(
    playtestSource,
    /resolveWalletPlaytestAdmission\(\{[\s\S]*executeRequested: EXECUTE_REQUESTED,[\s\S]*signingMaterialPresent: hasWalletSigningMaterial\(process\.env\)[\s\S]*if \(liveExecutionConfirmed\) \{[\s\S]*loadDotenv\([\s\S]*const account = liveExecutionConfirmed/,
  );
});

test("execution canary binds each signer to the strict public role file before any network work", () => {
  const signerKeys = LIVE_WALLET_ROLES.map((_, index) => `0x${String(index + 1).padStart(64, "0")}`);
  const signerAddresses = signerKeys.map((key) => privateKeyToAccount(key).address);
  const differentKey = `0x${"6".padStart(64, "0")}`;
  const differentAddress = privateKeyToAccount(differentKey).address;
  const signingFile = `${LIVE_WALLET_ROLES.flatMap((role, index) => [
    `LORE_LIVE_TEST_${role}_ADDRESS=${signerAddresses[index]}`,
    `LORE_LIVE_TEST_${role}_PRIVATE_KEY=${signerKeys[index]}`,
  ]).join("\n")}\n`;

  const control = inspectExecutionWalletBinding({ publicAddresses: signerAddresses, signingFile });
  assert.equal(control.status, 0, control.stderr || control.stdout);
  const controlOutput = JSON.parse(control.stdout);
  assert.match(controlOutput.walletSetSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual({ ...controlOutput, walletSetSha256: "<digest>" }, {
    status: "pass",
    mode: "execution-wallet-binding-inspection",
    roles: ["MANUAL"],
    publicAddressFileBinding: true,
    previewArtifactVerified: false,
    walletSetSha256: "<digest>",
    signingMaterialLoaded: true,
    signatureRequested: false,
    walletClientCreated: false,
    networkRequests: 0,
    contractWrites: 0,
  });

  const mismatch = inspectExecutionWalletBinding({
    publicAddresses: [differentAddress, ...signerAddresses.slice(1)],
    signingFile,
  });
  assert.notEqual(mismatch.status, 0);
  assert.match(mismatch.stderr, /MANUAL: signing-address-mismatch/);
  assert.doesNotMatch(`${mismatch.stdout}\n${mismatch.stderr}`, /NETWORK_CALL_FORBIDDEN|0x[0-9a-fA-F]{40}|0x[0-9a-fA-F]{64}/);

  const inheritedPair = inspectExecutionWalletBinding({
    publicAddresses: signerAddresses,
    signingFile,
    extraEnv: {
      LORE_LIVE_TEST_MANUAL_ADDRESS: differentAddress,
      LORE_LIVE_TEST_MANUAL_PRIVATE_KEY: differentKey,
    },
  });
  assert.notEqual(inheritedPair.status, 0);
  assert.match(inheritedPair.stderr, /MANUAL: inherited-address-conflict/);
  assert.doesNotMatch(`${inheritedPair.stdout}\n${inheritedPair.stderr}`, /NETWORK_CALL_FORBIDDEN|0x[0-9a-fA-F]{40}|0x[0-9a-fA-F]{64}/);

  const walletFileOnly = inspectExecutionWalletBinding({ publicAddresses: undefined, signingFile });
  assert.notEqual(walletFileOnly.status, 0);
  assert.match(walletFileOnly.stderr, /SYSTEM: address-file-empty|SYSTEM: address-keys-invalid/);
  assert.doesNotMatch(`${walletFileOnly.stdout}\n${walletFileOnly.stderr}`, /NETWORK_CALL_FORBIDDEN|0x[0-9a-fA-F]{40}|0x[0-9a-fA-F]{64}/);
});

test("live V10 matrix execution requires the exact fresh Preview, wallet set, and canary plan before network work", () => {
  const control = inspectFreshPreviewBinding();
  assert.equal(control.result.status, 0, control.result.stderr || control.result.stdout);
  const summary = JSON.parse(control.result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1));
  assert.deepEqual(summary, {
    status: "pass",
    mode: "fresh-preview-binding-inspection",
    previewSha256: control.previewSha256,
    walletSetSha256: control.walletSetSha256,
    canaryPlanSha256: control.canaryPlanSha256,
    signingMaterialLoaded: false,
    signatureRequested: false,
    walletClientCreated: false,
    networkRequests: 0,
    contractWrites: 0,
  });

  const changedPlan = inspectFreshPreviewBinding({
    executionExtraEnv: { LIVE_TEST_ROLES: "MANUAL,AUTOMINER_A" },
  });
  assert.notEqual(changedPlan.result.status, 0, "a widened role set must invalidate the Preview plan");
  assert.match(changedPlan.result.stderr, /does not match this execution wallet set and canary plan/);

  const changedPreview = inspectFreshPreviewBinding({
    mutateAfterBinding: ({ previewPath }) => {
      const markdown = readFileSync(previewPath, "utf8");
      writeFileSync(previewPath, `${markdown}\n`, "utf8");
    },
  });
  assert.notEqual(changedPreview.result.status, 0, "a changed Preview artifact must invalidate its expected SHA");
  assert.match(changedPreview.result.stderr, /does not match this execution wallet set and canary plan/);

  const changedWalletSet = inspectFreshPreviewBinding({
    mutateAfterBinding: ({ publicFilePath, publicFileText }) => {
      const replacement = privateKeyToAccount(`0x${"9".padStart(64, "0")}`).address;
      writeFileSync(
        publicFilePath,
        publicFileText.replace(/^LORE_LIVE_TEST_MANUAL_ADDRESS=.*$/m, `LORE_LIVE_TEST_MANUAL_ADDRESS=${replacement}`),
        "utf8",
      );
    },
  });
  assert.notEqual(changedWalletSet.result.status, 0, "a changed public wallet set must invalidate the Preview");
  assert.match(changedWalletSet.result.stderr, /does not match this execution wallet set and canary plan/);

  for (const candidate of [changedPlan, changedPreview, changedWalletSet]) {
    assert.doesNotMatch(`${candidate.result.stdout}\n${candidate.result.stderr}`, /NETWORK_CALL_FORBIDDEN|0x[0-9a-fA-F]{40}|0x[0-9a-fA-F]{64}/);
  }
});

test("Preview generator behavior fails closed on contradictory or unreported child boundaries", () => {
  const control = runMockedPreview();
  assert.equal(control.result.status, 0, control.result.stderr || control.result.stdout);
  assert.equal(control.summary.status, "pass");
  assert.equal(control.summary.operationalBoundaryVerified, true);
  assert.equal(control.summary.transactionSent, false);
  assert.equal(control.summary.walletClientCreated, false);
  assert.equal(control.summary.contractWriteSubmitted, false);
  assert.equal(control.summary.walletSetSha256, WALLET_SET_SHA256);
  assert.equal(control.summary.canaryPlanSha256, CANARY_PLAN_SHA256);
  assert.match(control.summary.previewSha256, /^[a-f0-9]{64}$/);
  assert.match(control.markdown, /^- operationalBoundaryVerified: true$/m);

  const missingWalletBinding = runMockedPreview({ matrix: { walletSetSha256: null } });
  assert.notEqual(missingWalletBinding.result.status, 0);
  assert.equal(missingWalletBinding.summary.status, "fail");
  assert.equal(missingWalletBinding.summary.operationalBoundaryVerified, true);
  assert.equal(missingWalletBinding.summary.walletSetSha256, null);

  const missingPlanBinding = runMockedPreview({ matrix: { canaryPlanSha256: null } });
  assert.notEqual(missingPlanBinding.result.status, 0);
  assert.equal(missingPlanBinding.summary.status, "fail");
  assert.equal(missingPlanBinding.summary.operationalBoundaryVerified, true);
  assert.equal(missingPlanBinding.summary.canaryPlanSha256, null);

  const mutants = [
    ["planner sent a transaction", { planner: { transactionSent: true } }, "transactionSent", true],
    ["pending path created a wallet client", { pending: { walletClient: true } }, "walletClientCreated", true],
    ["pending path submitted a write", { pending: { contractWrite: true } }, "contractWriteSubmitted", true],
    ["planner omitted its transaction report", { planner: { transactionSent: null } }, "transactionSent", false],
    ["planner reported a write-enabled mode", { planner: { mode: "execute" } }, "transactionSent", false],
    ["matrix reported live execution", { matrix: { execution: "enabled" } }, "transactionSent", false],
    ["matrix contradicted dry-run with a sent transaction", { matrix: { transactionSent: "true" } }, "transactionSent", true],
    ["matrix omitted its sent-transaction report", { matrix: { transactionSent: null } }, "transactionSent", false],
    ["matrix contradicted a negative transaction report", { matrix: { transactionSent: "false transactionSent=true" } }, "transactionSent", true],
    ["matrix emitted an invalid wallet-client report", { matrix: { walletClientCreated: "unknown" } }, "walletClientCreated", false],
    ["matrix reported a submitted write", { matrix: { contractWriteSubmitted: "true" } }, "contractWriteSubmitted", true],
  ];
  for (const [label, overrides, field, expectedField] of mutants) {
    const mutation = runMockedPreview(overrides);
    assert.notEqual(mutation.result.status, 0, `${label} must fail the Preview command`);
    assert.equal(mutation.summary.status, "fail", label);
    assert.equal(mutation.summary.operationalBoundaryVerified, false, label);
    assert.equal(mutation.summary[field], expectedField, label);
    assert.match(mutation.markdown, /^- status: fail$/m, label);
  }
});

test("Preview generator normalizes the upstream absolute live-canary log path into its safe binding", () => {
  const generated = runMockedPreview({}, { absoluteMatrixLog: true });
  assert.equal(generated.result.status, 0, generated.result.stderr || generated.result.stdout);
  assert.equal(generated.summary.status, "pass");
  assert.equal(generated.summary.canaryLog, DRY_RUN_LOG_RELATIVE_PATH);
  assert.match(generated.markdown, new RegExp(`^- log: ${DRY_RUN_LOG_RELATIVE_PATH.replace(/\\/g, "\\\\")}$`, "m"));
});

test("Preview generator rejects timed-out and signalled dry-run analyzers", () => {
  const interruptedAnalyzers = [
    ["timeout", { status: null, error: { code: "ETIMEDOUT" } }],
    ["signal", { status: null, signal: "SIGTERM" }],
  ];
  for (const [label, analyzer] of interruptedAnalyzers) {
    const generated = runMockedPreview({}, { analyzer });
    assert.notEqual(generated.result.status, 0, `${label} analyzer must not satisfy dry-run proof evidence`);
    assert.equal(generated.summary.status, "fail", label);
    assert.equal(generated.summary.dryRunProofBlocksG10G11, false, label);
    assert.match(generated.markdown, /^- dryRunProofBlocksG10G11: false$/m, label);
  }
});

test("Preview checker behavior requires the generated operational boundary evidence", () => {
  const generated = runMockedPreview();
  assert.equal(generated.result.status, 0, generated.result.stderr || generated.result.stdout);

  const control = checkPreviewMarkdown(generated.markdown);
  assert.equal(control.result.status, 0, control.result.stderr || control.result.stdout);
  assert.equal(control.summary.status, "pass");
  assert.equal(control.summary.authorizationFreshnessRequired, false);
  assert.equal(control.summary.walletSetSha256, WALLET_SET_SHA256);
  assert.equal(control.summary.canaryPlanSha256, CANARY_PLAN_SHA256);
  assert.equal(control.summary.previewSha256, sha256(generated.markdown));

  const mutations = [
    generated.markdown.replace("- operationalBoundaryVerified: true", "- operationalBoundaryVerified: false"),
    replaceSectionBullet(generated.markdown, "V10 Matrix Dry-Run", "signingMaterialLoaded", "true"),
    replaceSectionBullet(generated.markdown, "V10 Matrix Dry-Run", "transactionSent", "true"),
    replaceSectionBullet(generated.markdown, "V10 Matrix Dry-Run", "walletClientCreated", "unknown"),
    replaceSectionBullet(generated.markdown, "V10 Matrix Dry-Run", "contractWriteSubmitted", "true"),
    replaceSectionBullet(generated.markdown, "V10 Matrix Dry-Run", "transactionSent", null),
    replaceSectionBullet(generated.markdown, "V10 Matrix Dry-Run", "transactionSent", "false\n- transactionSent: true"),
    replaceSectionBullet(generated.markdown, "V10 Matrix Dry-Run", "walletSetSha256", "c".repeat(64)),
    replaceSectionBullet(generated.markdown, "V10 Matrix Dry-Run", "canaryPlanSha256", "d".repeat(64)),
    replaceSectionBullet(generated.markdown, "Overall Status", "walletSetSha256", null),
    replaceSectionBullet(generated.markdown, "Overall Status", "canaryPlanSha256", "not-a-digest"),
  ];
  for (const markdown of mutations) {
    const mutation = checkPreviewMarkdown(markdown);
    assert.notEqual(mutation.result.status, 0);
    assert.equal(mutation.summary.status, "fail");
  }
});

test("Preview checker binds the current regular log and independently verifies the strict dry-run verdict", () => {
  const generatedMarkdown = makeBoundPreviewMarkdown(DRY_RUN_LOG_TEXT);
  const control = checkPreviewMarkdown(generatedMarkdown);
  assert.equal(control.result.status, 0, control.result.stderr || control.result.stdout);

  const stale = generatedMarkdown.replace(
    /^Last updated:\s*.+\.$/m,
    "Last updated: 2020-01-01T00:00:00.000Z.",
  );
  const staleResult = checkPreviewMarkdown(stale);
  assert.notEqual(staleResult.result.status, 0, "stale previews must not be reusable");

  const substituted = checkPreviewMarkdown(generatedMarkdown, {
    logText: "{\"mode\":\"preflight\",\"ok\":true}\n",
  });
  assert.notEqual(substituted.result.status, 0, "a different JSONL must not satisfy the saved digest binding");

  const digestTamper = replaceSectionBullet(
    generatedMarkdown,
    "V10 Matrix Dry-Run",
    "logSha256",
    "0".repeat(64),
  );
  const digestTamperResult = checkPreviewMarkdown(digestTamper);
  assert.notEqual(digestTamperResult.result.status, 0, "digest tampering must fail closed");

  const successfulBetLog = JSON.stringify({
    round: 0,
    mode: "single",
    ok: true,
    txStatus: "success",
    epoch: 1,
  }) + "\n";
  const forgedBullets = bindMarkdownLog(generatedMarkdown, successfulBetLog);
  const forgedResult = checkPreviewMarkdown(forgedBullets, { logText: successfulBetLog });
  assert.notEqual(
    forgedResult.result.status,
    0,
    "matching markdown digest and zero-valued analyzer bullets cannot replace the independent strict analyzer",
  );
});

test("Preview checker rejects a leaf symlink or reparse docs parent", () => {
  const markdown = makeBoundPreviewMarkdown(DRY_RUN_LOG_TEXT);

  const leafCwd = mkdtempSync(path.join(tmpdir(), "lore-preview-leaf-link-"));
  let leafLinkCreated = false;
  try {
    const docsDir = path.join(leafCwd, "docs");
    mkdirSync(docsDir);
    const targetPath = path.join(docsDir, "preview-target.md");
    const previewPath = path.join(docsDir, "v10-canary-dry-run-preview.md");
    writeFileSync(targetPath, markdown, "utf8");
    try {
      symlinkSync(targetPath, previewPath, "file");
      leafLinkCreated = true;
    } catch (error) {
      if (!new Set(["EPERM", "EACCES", "UNKNOWN"]).has(error?.code)) throw error;
    }
    if (leafLinkCreated) {
      const result = spawnSync(process.execPath, [PREVIEW_CHECK_SCRIPT], { cwd: leafCwd, encoding: "utf8" });
      assert.notEqual(result.status, 0);
      assert.match(`${result.stdout}\n${result.stderr}`, /preview-markdown-must-be-an-ordinary-file/);
    }
  } finally {
    if (leafLinkCreated) unlinkSync(path.join(leafCwd, "docs", "v10-canary-dry-run-preview.md"));
    rmSync(leafCwd, { recursive: true, force: true });
  }

  const parentCwd = mkdtempSync(path.join(tmpdir(), "lore-preview-parent-link-"));
  const externalDocs = mkdtempSync(path.join(tmpdir(), "lore-preview-external-docs-"));
  const linkedDocs = path.join(parentCwd, "docs");
  let parentLinkCreated = false;
  try {
    writeFileSync(path.join(externalDocs, "v10-canary-dry-run-preview.md"), markdown, "utf8");
    try {
      symlinkSync(externalDocs, linkedDocs, "junction");
      parentLinkCreated = true;
    } catch (error) {
      if (!new Set(["EPERM", "EACCES", "UNKNOWN"]).has(error?.code)) throw error;
    }
    if (parentLinkCreated) {
      const result = spawnSync(process.execPath, [PREVIEW_CHECK_SCRIPT], { cwd: parentCwd, encoding: "utf8" });
      assert.notEqual(result.status, 0);
      assert.match(
        `${result.stdout}\n${result.stderr}`,
        /docs-directory-must-(?:be-an-ordinary-directory|not-resolve-through-a-reparse-point)/,
      );
    }
  } finally {
    if (parentLinkCreated) unlinkSync(linkedDocs);
    rmSync(parentCwd, { recursive: true, force: true });
    rmSync(externalDocs, { recursive: true, force: true });
  }
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
