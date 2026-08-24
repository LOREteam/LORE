import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  copyFileSync,
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
import nodeTest from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { privateKeyToAccount } from "viem/accounts";
import { resolveTrustedGitExecutable } from "./build-provenance.mjs";
import { loadLiveTestPublicWalletConfig } from "./live-test-wallet-config.mjs";
import {
  resolveTrustedNpmCli,
  trustedNpmCommand,
  trustedNpmEnvironment,
} from "./trusted-npm-cli.mjs";
import { verifyV10SepoliaDeploymentManifest } from "./verify-v10-sepolia-deployment-manifest.mjs";
import {
  canonicalJsonSha256,
  consentEnvelopeSha256,
  createV10PreviewConsentEnvelope,
  parseV10DryRunLogEvidence,
} from "./v10-preview-consent-envelope.mjs";
import { captureV10PreviewRepositoryState } from "./v10-preview-repository-state.mjs";

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
const DRY_RUN_LOG_NAME = "live-canary-20260813T000000Z.jsonl";
const DRY_RUN_LOG_RELATIVE_PATH = path.join("data", "live-test-runs", DRY_RUN_LOG_NAME);
const LIVE_WALLET_ROLES = ["MANUAL", "AUTOMINER_A", "AUTOMINER_B", "AUTOMINER_C", "RESOLVER"];
const WALLET_SET_SHA256 = "a".repeat(64);
const CANARY_PLAN_SHA256 = "b".repeat(64);
const AUTHORIZATION_RUN_ID = "123e4567-e89b-42d3-a456-426614174000";
const DRY_RUN_ADMISSION_RUN_ID = "123e4567-e89b-42d3-a456-426614174001";
const FIXTURE_APPLICATION_GIT_SHA = "c".repeat(40);
const FIXTURE_SOURCE_STATE_SHA256 = "d".repeat(64);
const GIT_EXECUTABLE = resolveTrustedGitExecutable();
const DEPLOYMENT_MANIFEST = verifyV10SepoliaDeploymentManifest({
  projectRoot: REPO_ROOT,
  verifyGitArtifact: false,
});
const CANONICAL_CONSENT_PLAN = createConsentPlanFixture();
const DRY_RUN_LOG_TEXT = createDryRunLogText(CANONICAL_CONSENT_PLAN);
const previewEnvBoundaryCases = [];

function test(name, fn) {
  previewEnvBoundaryCases.push({ name, fn });
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function createConsentPlanFixture() {
  return {
    schema: 1,
    tranche: "v10-matrix",
    profile: "v10-matrix",
    target: {
      network: "sepolia",
      chainId: 59141,
      contractAddress: DEPLOYMENT_MANIFEST.contractAddress,
      contractDeployBlock: DEPLOYMENT_MANIFEST.deployBlock,
      epochBoundBetsRequired: true,
    },
    provenance: {
      deploymentTransactionHash: DEPLOYMENT_MANIFEST.deploymentTransactionHash,
      deploymentManifestSha256: DEPLOYMENT_MANIFEST.deploymentManifestSha256,
      compilationManifestSha256: DEPLOYMENT_MANIFEST.compilationManifestSha256,
      normalizedExecutableRuntimeSha256: DEPLOYMENT_MANIFEST.normalizedExecutableRuntimeSha256,
      sourceArtifactGitSha: DEPLOYMENT_MANIFEST.sourceArtifactGitSha,
      canonicalDeploymentManifestVerified: true,
    },
    walletSetSha256: WALLET_SET_SHA256,
    canaryPlanSha256: CANARY_PLAN_SHA256,
    roles: {
      selectedRoles: ["AUTOMINER_A", "AUTOMINER_B", "MANUAL"],
      resolverCandidateRoles: ["RESOLVER", "AUTOMINER_A", "AUTOMINER_B", "MANUAL"],
      roleCaps: [
        { role: "AUTOMINER_A", spendCapWei: "160000000000000000", allowanceCapWei: "160000000000000000" },
        { role: "AUTOMINER_B", spendCapWei: "560000000000000000", allowanceCapWei: "560000000000000000" },
        { role: "MANUAL", spendCapWei: "120000000000000000", allowanceCapWei: "120000000000000000" },
      ],
    },
    txCaps: { approval: 3, bet: 12, resolve: 5, pendingReplacement: 0, total: 20 },
    valueCaps: {
      totalSpendWei: "840000000000000000",
      maxApprovalCostPerTxWei: "200000000000000",
      maxKeeperCostPerTxWei: "2000000000000000",
      maxNativeGasWei: "34600000000000000",
    },
    maxEpochs: 11,
    stopPolicy: {
      maxFailures: 1,
      maxResolveTransactions: 5,
      safeWindowTimeoutMs: 180000,
      transactionReceiptTimeoutMs: 120000,
      liveLogMaxBytes: 48 * 1024 * 1024,
      stopOnBindingFailure: true,
      stopOnPreflightFailure: true,
      stopOnPendingNonce: true,
      stopOnBetFailure: true,
      stopOnRepeatFailure: true,
      stopOnResolveFailure: true,
      stopOnSafeWindowTimeout: true,
    },
    liveExecutionRequiresFreshAuthorization: true,
  };
}

function canonicalAdmissionPayload(admission) {
  return JSON.stringify({
    schema: admission.schema,
    runId: admission.runId,
    execution: admission.execution,
    profile: admission.profile,
    network: admission.network,
    chainId: admission.chainId,
    contractAddress: admission.contractAddress.toLowerCase(),
    contractDeployBlock: admission.contractDeployBlock,
    runtimeSha256: admission.runtimeSha256,
    manifestSha256: admission.manifestSha256,
    deploymentManifestSha256: admission.deploymentManifestSha256,
    sourceArtifactGitSha: admission.sourceArtifactGitSha,
    canonicalProvenanceVerified: admission.canonicalProvenanceVerified,
    previewSha256: admission.previewSha256,
    walletSetSha256: admission.walletSetSha256,
    canaryPlanSha256: admission.canaryPlanSha256,
    selectedRoles: [...admission.selectedRoles].sort(),
    roleCaps: [...admission.roleCaps]
      .map((cap) => ({ ...cap }))
      .sort((left, right) => left.role.localeCompare(right.role)),
  });
}

function canonicalTokenAmountFromWei(value) {
  const amount = BigInt(value);
  const scale = 1_000_000_000_000_000_000n;
  const whole = amount / scale;
  const fraction = amount % scale;
  if (fraction === 0n) return whole.toString();
  return `${whole}.${fraction.toString().padStart(18, "0").replace(/0+$/, "")}`;
}

function createDryRunEvents(
  consentPlan,
  timestamp = new Date().toISOString(),
  admissionRunId = AUTHORIZATION_RUN_ID,
) {
  const admission = {
    schema: 2,
    runId: admissionRunId,
    execution: "dry-run",
    profile: "v10-matrix",
    network: consentPlan.target.network,
    chainId: consentPlan.target.chainId,
    contractAddress: consentPlan.target.contractAddress,
    contractDeployBlock: consentPlan.target.contractDeployBlock,
    runtimeSha256: consentPlan.provenance.normalizedExecutableRuntimeSha256,
    manifestSha256: consentPlan.provenance.compilationManifestSha256,
    deploymentManifestSha256: consentPlan.provenance.deploymentManifestSha256,
    sourceArtifactGitSha: consentPlan.provenance.sourceArtifactGitSha,
    canonicalProvenanceVerified: true,
    previewSha256: null,
    walletSetSha256: consentPlan.walletSetSha256,
    canaryPlanSha256: consentPlan.canaryPlanSha256,
    selectedRoles: [...consentPlan.roles.selectedRoles],
    roleCaps: consentPlan.roles.roleCaps.map((cap) => ({ ...cap })),
  };
  const admissionSha256 = sha256(canonicalAdmissionPayload(admission));
  const common = {
    network: consentPlan.target.network,
    chainId: consentPlan.target.chainId,
    contractAddress: consentPlan.target.contractAddress,
    rpcLabel: "fixture-public-sepolia",
    rpcFailoverInjected: false,
  };
  const binding = {
    admissionSha256,
    runId: admission.runId,
    walletSetSha256: consentPlan.walletSetSha256,
  };
  const observedBlock = (BigInt(consentPlan.target.contractDeployBlock) + 1n).toString();
  return [
    {
      ...common,
      admission,
      admissionSha256,
      amount: "0",
      mode: "admission",
      ok: true,
      role: "SYSTEM",
      round: -1,
      signatureRequested: false,
      signingMaterialLoaded: false,
      timestamp,
      transactionSent: false,
      walletClientCreated: false,
    },
    {
      ...common,
      ...binding,
      amount: "0",
      mode: "preflight",
      ok: true,
      role: "SYSTEM",
      round: -1,
      runtimeIdentity: {
        canonicalProvenanceVerified: true,
        chainId: consentPlan.target.chainId,
        contractAddress: consentPlan.target.contractAddress,
        deployBlock: consentPlan.target.contractDeployBlock,
        executableBytes: 1024,
        executableRuntimeBytes: 1024,
        immutableReferences: 2,
        manifestDigest: consentPlan.provenance.compilationManifestSha256,
        manifestMatched: true,
        normalizedRuntimeSha256: consentPlan.provenance.normalizedExecutableRuntimeSha256,
        observedBlock,
        observedBlockHash: `0x${"7".repeat(64)}`,
      },
      deploymentManifestSha256: consentPlan.provenance.deploymentManifestSha256,
      sourceArtifactGitSha: consentPlan.provenance.sourceArtifactGitSha,
      timestamp,
    },
    ...consentPlan.roles.roleCaps.map((cap, index) => ({
      ...common,
      ...binding,
      amount: "0",
      allowance: "0",
      allowanceCapWei: cap.allowanceCapWei,
      allowanceWei: "0",
      allowanceWithinRunCap: true,
      approvalRequired: true,
      approvalTarget: canonicalTokenAmountFromWei(cap.allowanceCapWei),
      enoughEth: true,
      enoughToken: true,
      mode: "preflight",
      nonceLatest: index + 8,
      noncePending: index + 8,
      ok: true,
      participant: true,
      role: cap.role,
      round: -1,
      timestamp,
      totalAmount: canonicalTokenAmountFromWei(cap.spendCapWei),
      totalAmountWei: cap.spendCapWei,
    })),
  ];
}

function createDryRunLogText(
  consentPlan,
  timestamp = new Date().toISOString(),
  admissionRunId = AUTHORIZATION_RUN_ID,
) {
  return `${createDryRunEvents(consentPlan, timestamp, admissionRunId).map((event) => JSON.stringify(event)).join("\n")}\n`;
}

function createAnalyzerSummary(logPath, logText, walletPreflights) {
  return {
    status: "pass",
    mode: "preview-dry-run",
    previewDryRunVerdict: "passed",
    liveLaunchGates: ["G10", "G11"],
    logName: path.basename(logPath),
    logSha256: sha256(logText),
    logBytes: Buffer.byteLength(logText, "utf8"),
    actionEvents: 0,
    successfulActionTx: 0,
    transactionEvidenceEvents: 0,
    runtimeIdentityPreflights: 1,
    walletPreflights,
    issues: [],
  };
}

function fixtureGitEnvironment() {
  const env = {
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_CONFIG_SYSTEM: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    GIT_PAGER: "cat",
    GIT_AUTHOR_NAME: "Preview Fixture",
    GIT_AUTHOR_EMAIL: "preview-fixture@example.invalid",
    GIT_COMMITTER_NAME: "Preview Fixture",
    GIT_COMMITTER_EMAIL: "preview-fixture@example.invalid",
  };
  for (const key of ["SystemRoot", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "TMPDIR"]) {
    if (typeof process.env[key] === "string") env[key] = process.env[key];
  }
  return env;
}

function runFixtureGit(root, args) {
  const result = spawnSync(GIT_EXECUTABLE, [
    "--no-pager",
    "-c", `safe.directory=${root.replaceAll("\\", "/")}`,
    "-c", "core.hooksPath=",
    "-c", "commit.gpgsign=false",
    ...args,
  ], {
    cwd: root,
    encoding: "utf8",
    env: fixtureGitEnvironment(),
    timeout: 10_000,
    windowsHide: true,
  });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.signal, null, result.stderr || result.stdout);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return String(result.stdout ?? "").trim();
}

function initializeFixtureProjectClone(root, {
  includeGenerator = false,
  linkDependencies = false,
  includeLiveCanary = linkDependencies,
} = {}) {
  const clone = spawnSync(GIT_EXECUTABLE, [
    "-c", `safe.directory=${REPO_ROOT.replaceAll("\\", "/")}`,
    "-c", `safe.directory=${path.join(REPO_ROOT, ".git").replaceAll("\\", "/")}`,
    "clone", "--quiet", "--shared", "--no-checkout", REPO_ROOT, root,
  ], {
    cwd: path.dirname(root),
    encoding: "utf8",
    env: fixtureGitEnvironment(),
    timeout: 30_000,
    windowsHide: true,
  });
  assert.equal(clone.error, undefined, clone.error?.message);
  assert.equal(clone.signal, null, clone.stderr || clone.stdout);
  assert.equal(clone.status, 0, clone.stderr || clone.stdout);
  const fixtureEntryFiles = [
    "scripts/analyze-live-canary-proof.mjs",
    "scripts/check-v10-dry-run-preview.mjs",
    ".gitignore",
    ".npmrc",
    "package.json",
    "tsconfig.json",
    "config/lineaV10SepoliaDeploymentManifest.json",
    "config/publicConfig.ts",
    "config/generated/lineaOreV10Abi.ts",
    "contracts/LineaOreV10.sol",
    "contracts/LineaOreV10.compilation.json",
    "contracts/LineaOreV10.compiler-config.json",
  ];
  if (includeGenerator) fixtureEntryFiles.push("scripts/create-v10-canary-dry-run-preview.mjs");
  if (includeLiveCanary) fixtureEntryFiles.push("scripts/live-round-canary.ts");
  copyFixtureProjectGraph(root, fixtureEntryFiles);
  mkdirSync(path.join(root, "docs"), { recursive: true });
  writeFileSync(path.join(root, "docs", "v10-canary-dry-run-preview.md"), "# Preview fixture\n", "utf8");
  runFixtureGit(root, ["config", "core.autocrlf", "false"]);
  runFixtureGit(root, ["add", "-A"]);
  runFixtureGit(root, ["commit", "--quiet", "--no-gpg-sign", "-m", "current Preview contracts"]);
  mkdirSync(path.join(root, "artifacts"), { recursive: true });
  mkdirSync(path.join(root, "data", "live-test-runs"), { recursive: true });
  if (linkDependencies) {
    symlinkSync(
      path.join(REPO_ROOT, "node_modules"),
      path.join(root, "node_modules"),
      process.platform === "win32" ? "junction" : "dir",
    );
  }
  return captureV10PreviewRepositoryState({ root });
}

function copyFixtureProjectGraph(root, entryFiles) {
  const queue = [...entryFiles];
  const copied = new Set();
  const importPattern = /(?:\bfrom\s*|\bimport\s*)["'](\.\.?\/[^"']+)["']/g;
  while (queue.length > 0) {
    const relativePath = queue.shift().replaceAll("\\", "/");
    if (copied.has(relativePath)) continue;
    const sourcePath = path.join(REPO_ROOT, relativePath);
    assert.equal(lstatSync(sourcePath).isFile(), true, `fixture source must be a file: ${relativePath}`);
    const targetPath = path.join(root, relativePath);
    mkdirSync(path.dirname(targetPath), { recursive: true });
    copyFileSync(sourcePath, targetPath);
    copied.add(relativePath);
    if (!/\.(?:[cm]?[jt]sx?)$/.test(relativePath)) continue;
    const fixtureModuleText = readFileSync(sourcePath, "utf8");
    for (const match of fixtureModuleText.matchAll(importPattern)) {
      const basePath = path.resolve(path.dirname(sourcePath), match[1]);
      const candidates = [basePath, ...[".ts", ".tsx", ".js", ".mjs", ".json"].map((suffix) => `${basePath}${suffix}`)];
      const importedPath = candidates.find((candidate) => existsSync(candidate) && lstatSync(candidate).isFile());
      if (!importedPath) continue;
      const importedRelativePath = path.relative(REPO_ROOT, importedPath).replaceAll("\\", "/");
      assert.equal(importedRelativePath.startsWith("../"), false, "fixture import escaped the project root");
      queue.push(importedRelativePath);
    }
  }
}

function defaultRepositoryState() {
  return {
    applicationGitSha: FIXTURE_APPLICATION_GIT_SHA,
    sourceTreeClean: true,
    sourceStateSha256: FIXTURE_SOURCE_STATE_SHA256,
  };
}

function createConsentEnvelopeFixture({
  consentPlan = CANONICAL_CONSENT_PLAN,
  logText = createDryRunLogText(consentPlan),
  repositoryState = defaultRepositoryState(),
  authorizationRunId = AUTHORIZATION_RUN_ID,
} = {}) {
  const runtimeEvidence = parseV10DryRunLogEvidence(
    logText,
    consentPlan,
    { expectedAdmissionRunId: authorizationRunId },
  );
  return createV10PreviewConsentEnvelope({
    authorizationRunId,
    repositoryState,
    consentPlan,
    consentPlanSha256: canonicalJsonSha256(consentPlan),
    runtimeEvidence,
    operationalBoundary: {
      execution: "dry-run",
      transactionSent: false,
      signingMaterialLoaded: false,
      walletClientCreated: false,
      contractWriteSubmitted: false,
    },
  });
}

function inspectChildEnv(extraEnv, { allowFailure = false } = {}) {
  const result = spawnSync(process.execPath, [PREVIEW_SCRIPT, "--inspect-read-only-child-env"], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, ...extraEnv },
  });
  if (allowFailure) return result;
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
  return JSON.parse(lines.at(-1));
}

function previewStepOutputs({
  planner = {},
  pending = {},
  matrix = {},
  logPath = DRY_RUN_LOG_RELATIVE_PATH,
  logText = DRY_RUN_LOG_TEXT,
  consentPlan = CANONICAL_CONSENT_PLAN,
  consentPlanSha256 = canonicalJsonSha256(consentPlan),
  consentPlanLines,
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
    rounds: String(consentPlan.txCaps.bet / 2),
    plannedBetTx: String(consentPlan.txCaps.bet),
    plannedStake: "0.84",
    ready: `${consentPlan.roles.selectedRoles.length}/${consentPlan.roles.selectedRoles.length}`,
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
  const effectiveConsentPlanLines = consentPlanLines ?? [
    `[live-canary] consentPlan=${JSON.stringify(consentPlan)} consentPlanSha256=${consentPlanSha256}`,
  ];
  const analyzerSummary = createAnalyzerSummary(
    logPath,
    logText,
    consentPlan.roles.selectedRoles.length,
  );
  return [
    { status: 0, stdout: `${JSON.stringify(plannerSummary)}\n`, stderr: "" },
    { status: 0, stdout: `${JSON.stringify(pendingSummary)}\n`, stderr: "" },
    {
      status: 0,
      stdout: `${effectiveConsentPlanLines.join("\n")}\n[live-canary] ${matrixLine}\n[live-canary] log=${logPath}\n`,
      stderr: "",
    },
    {
      status: 0,
      signal: null,
      stdout: `${JSON.stringify(analyzerSummary)}\n`,
      stderr: "",
      ...analyzer,
    },
  ];
}

function runMockedPreview(
  overrides = {},
  {
    matrixLogPath,
    absoluteMatrixLog = false,
    analyzer,
    logText,
    extraEnv = {},
    captureChildCalls = false,
    mutateLogOnPreviewRename = false,
  } = {},
) {
  const cwd = mkdtempSync(path.join(tmpdir(), "lore-preview-boundary-"));
  initializeFixtureProjectClone(cwd, { includeGenerator: true });
  unlinkSync(path.join(cwd, "docs", "v10-canary-dry-run-preview.md"));
  const logDir = path.join(cwd, "data", "live-test-runs");
  const consentPlan = overrides.consentPlan ?? CANONICAL_CONSENT_PLAN;
  const effectiveLogText = logText ?? createDryRunLogText(consentPlan);
  writeFileSync(path.join(logDir, DRY_RUN_LOG_NAME), effectiveLogText, "utf8");
  const childCallsPath = path.join(cwd, "artifacts", "mock-preview-child-calls.jsonl");
  const outputLogPath = matrixLogPath ?? (absoluteMatrixLog
    ? path.join(logDir, DRY_RUN_LOG_NAME)
    : DRY_RUN_LOG_RELATIVE_PATH);
  const outputs = previewStepOutputs({
    ...overrides,
    logPath: outputLogPath,
    logText: effectiveLogText,
    consentPlan,
    analyzer,
  });
  const preloadSource = `
    import childProcess from "node:child_process";
    import crypto from "node:crypto";
    import fs, { appendFileSync } from "node:fs";
    import { syncBuiltinESMExports } from "node:module";
    const outputs = ${JSON.stringify(outputs)};
    const capturePath = ${captureChildCalls ? JSON.stringify(childCallsPath) : "null"};
    const mutateLogOnPreviewRename = ${JSON.stringify(mutateLogOnPreviewRename)};
    const fixtureLogPath = ${JSON.stringify(path.join(logDir, DRY_RUN_LOG_NAME))};
    crypto.randomUUID = () => ${JSON.stringify(AUTHORIZATION_RUN_ID)};
    const originalRenameSync = fs.renameSync.bind(fs);
    let previewRenameMutated = false;
    fs.renameSync = (oldPath, newPath, ...args) => {
      const result = originalRenameSync(oldPath, newPath, ...args);
      const normalizedTarget = String(newPath).replaceAll("\\\\", "/");
      if (
        mutateLogOnPreviewRename &&
        !previewRenameMutated &&
        normalizedTarget.endsWith("/docs/v10-canary-dry-run-preview.md")
      ) {
        appendFileSync(fixtureLogPath, "\\n");
        previewRenameMutated = true;
      }
      return result;
    };
    const originalSpawnSync = childProcess.spawnSync.bind(childProcess);
    const mockedChildren = new Set([
      "plan:canary:v10:postdeploy:summary",
      "soak:testnet:clear-pending:summary",
      "live:canary:v10:matrix",
      "scripts/analyze-live-canary-proof.mjs",
    ]);
    let callIndex = 0;
    childProcess.spawnSync = (command, args, options) => {
      const normalizedArgs = Array.isArray(args) ? args.map((value) => String(value).replaceAll("\\\\", "/")) : [];
      if (!normalizedArgs.some((value) => mockedChildren.has(value))) {
        return originalSpawnSync(command, args, options);
      }
      if (capturePath) {
        appendFileSync(capturePath, JSON.stringify({
          command: String(command),
          args: normalizedArgs,
          cwd: String(options?.cwd ?? ""),
          npmBoundary: {
            path: options?.env?.PATH ?? null,
            scriptShell: options?.env?.npm_config_script_shell ?? null,
            userConfig: options?.env?.npm_config_userconfig ?? null,
            registry: options?.env?.npm_config_registry ?? null,
            global: options?.env?.npm_config_global ?? null,
            offline: options?.env?.npm_config_offline ?? null,
            ignoreScripts: options?.env?.npm_config_ignore_scripts ?? null,
            npmExecpathPresent: Object.keys(options?.env ?? {}).some((key) => key.toLowerCase() === "npm_execpath"),
            npmNodeExecpathPresent: Object.keys(options?.env ?? {}).some((key) => key.toLowerCase() === "npm_node_execpath"),
          },
          executionGates: Object.fromEntries([
            "LIVE_TEST_DRY_RUN",
            "LIVE_TEST_EXECUTE",
            "SOAK_EXECUTE_LIVE",
            "TEST_WALLET_EXECUTE",
          ].map((name) => [name, options?.env?.[name] ?? null])),
          liveTestRunId: options?.env?.LIVE_TEST_RUN_ID ?? null,
          timeout: options?.timeout ?? null,
        }) + "\\n");
      }
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
    const result = spawnSync(process.execPath, [
      "--import",
      preloadUrl,
      path.join(cwd, "scripts", path.basename(PREVIEW_SCRIPT)),
    ], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, LIVE_CANARY_RPC_LABEL: "test-public-sepolia", ...extraEnv },
    });
    const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
    const previewPath = path.join(cwd, "docs", "v10-canary-dry-run-preview.md");
    const capturedChildCalls = captureChildCalls && existsSync(childCallsPath)
      ? readFileSync(childCallsPath, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
      : [];
    const loadedPreviewMarkdown = existsSync(previewPath) ? readFileSync(previewPath, "utf8") : null;
    return {
      fixtureRoot: cwd,
      upstreamMatrixLogPath: outputLogPath,
      logText: effectiveLogText,
      result,
      summary: lines.length > 0 ? JSON.parse(lines.at(-1)) : null,
      markdown: loadedPreviewMarkdown,
      childCalls: capturedChildCalls,
    };
  } finally {
    rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

function checkPreviewMarkdown(markdown, { logText = DRY_RUN_LOG_TEXT, args = [], extraEnv = {} } = {}) {
  const cwd = mkdtempSync(path.join(tmpdir(), "lore-preview-check-"));
  const docsDir = path.join(cwd, "docs");
  const logDir = path.join(cwd, "data", "live-test-runs");
  const requireFreshAuthorization = args.includes("--require-fresh-authorization");
  const repositoryState = requireFreshAuthorization
    ? initializeFixtureProjectClone(cwd)
    : null;
  if (!requireFreshAuthorization) {
    mkdirSync(docsDir);
    mkdirSync(logDir, { recursive: true });
  }
  const effectiveMarkdown = repositoryState
    ? mutateConsentEnvelopeInMarkdown(markdown, (envelope) => {
        envelope.applicationGitSha = repositoryState.applicationGitSha;
        envelope.sourceTreeClean = repositoryState.sourceTreeClean;
        envelope.sourceStateSha256 = repositoryState.sourceStateSha256;
      })
    : markdown;
  writeFileSync(path.join(docsDir, "v10-canary-dry-run-preview.md"), effectiveMarkdown, "utf8");
  writeFileSync(path.join(logDir, "live-canary-20260813T000000Z.jsonl"), logText, "utf8");
  try {
    const checkerScript = requireFreshAuthorization
      ? path.join(cwd, "scripts", path.basename(PREVIEW_CHECK_SCRIPT))
      : PREVIEW_CHECK_SCRIPT;
    const result = spawnSync(process.execPath, [checkerScript, ...args], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, ...extraEnv },
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

function rebindDryRunAdmission(logText, admissionRunId, { recomputeDigest = true } = {}) {
  const events = String(logText).split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
  events[0].admission.runId = admissionRunId;
  if (recomputeDigest) {
    const admissionSha256 = sha256(canonicalAdmissionPayload(events[0].admission));
    events[0].admissionSha256 = admissionSha256;
    for (const event of events.slice(1)) {
      event.runId = admissionRunId;
      event.admissionSha256 = admissionSha256;
    }
  }
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

function makeBoundPreviewMarkdown(
  logText,
  {
    consentPlan = CANONICAL_CONSENT_PLAN,
    walletSetSha256,
    canaryPlanSha256,
    repositoryState = defaultRepositoryState(),
    authorizationRunId = AUTHORIZATION_RUN_ID,
    updatedAt = new Date().toISOString(),
  } = {},
) {
  const effectiveConsentPlan = JSON.parse(JSON.stringify(consentPlan));
  if (walletSetSha256 !== undefined) effectiveConsentPlan.walletSetSha256 = walletSetSha256;
  if (canaryPlanSha256 !== undefined) effectiveConsentPlan.canaryPlanSha256 = canaryPlanSha256;
  const envelope = createConsentEnvelopeFixture({
    consentPlan: effectiveConsentPlan,
    logText,
    repositoryState,
    authorizationRunId,
  });
  const envelopeDigest = consentEnvelopeSha256(envelope);
  const digest = sha256(logText);
  const bytes = Buffer.byteLength(logText, "utf8");
  return `# V10 Canary Dry-Run Preview

Last updated: ${updatedAt}.

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
- dryRunPreviewVerdictPassed: true
- liveLaunchGatesBlocked: G10,G11
- consentPlanBound: true
- canaryLogBound: true
- applicationGitSha: ${envelope.applicationGitSha}
- sourceTreeClean: ${envelope.sourceTreeClean}
- authorizationReady: ${envelope.sourceTreeClean}
- authorizationRunId: ${envelope.authorizationRunId}
- sourceStateSha256: ${envelope.sourceStateSha256}
- walletSetSha256: ${effectiveConsentPlan.walletSetSha256}
- canaryPlanSha256: ${effectiveConsentPlan.canaryPlanSha256}
- consentPlanSha256: ${envelope.consentPlanSha256}
- consentEnvelopeSha256: ${envelopeDigest}

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
- rounds: ${effectiveConsentPlan.txCaps.bet / 2}
- plannedBetTx: ${effectiveConsentPlan.txCaps.bet}
- walletSetSha256: ${effectiveConsentPlan.walletSetSha256}
- canaryPlanSha256: ${effectiveConsentPlan.canaryPlanSha256}
- transactionSent: false
- signingMaterialLoaded: false
- walletClientCreated: false
- contractWriteSubmitted: false
- log: data/live-test-runs/live-canary-20260813T000000Z.jsonl
- logBytes: ${bytes}
- logSha256: ${digest}

## Dry-Run Proof Analysis

- exit: 0
- previewDryRunVerdict: passed
- liveLaunchGates: G10,G11
- actionEvents: 0
- successfulActionTx: 0
- transactionEvidenceEvents: 0
- runtimeIdentityPreflights: 1
- walletPreflights: ${effectiveConsentPlan.roles.selectedRoles.length}
- logSha256: ${digest}
- logBytes: ${bytes}

## Machine-Readable Consent Envelope

- authorizationRunId: ${envelope.authorizationRunId}
- applicationGitSha: ${envelope.applicationGitSha}
- sourceTreeClean: ${envelope.sourceTreeClean}
- sourceStateSha256: ${envelope.sourceStateSha256}
- walletSetSha256: ${effectiveConsentPlan.walletSetSha256}
- canaryPlanSha256: ${effectiveConsentPlan.canaryPlanSha256}
- consentPlanSha256: ${envelope.consentPlanSha256}
- consentEnvelopeSha256: ${envelopeDigest}

\`\`\`json
${JSON.stringify(envelope)}
\`\`\`

## Fresh Consent Boundary

Do not execute any of the following without a fresh exact authorization after a
fresh Preview rerun:

- confirmation that this authorizationRunId is unconsumed in the protected ledger of this canonical
  repository; repository-local consumption is not a global one-shot guarantee
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

function mutateConsentEnvelopeInMarkdown(markdown, mutate) {
  const matches = [...markdown.matchAll(/^```json\r?\n([^\r\n]+)\r?\n```\s*$/gm)];
  assert.equal(matches.length, 1, "expected exactly one canonical consent envelope JSON block");
  const [match] = matches;
  const envelope = JSON.parse(match[1]);
  mutate(envelope);
  envelope.consentPlanSha256 = canonicalJsonSha256(envelope.consentPlan);
  const envelopeDigest = consentEnvelopeSha256(envelope);
  let result = `${markdown.slice(0, match.index)}${match[0].replace(match[1], JSON.stringify(envelope))}${markdown.slice(match.index + match[0].length)}`;
  for (const title of ["Overall Status", "Machine-Readable Consent Envelope"]) {
    result = replaceSectionBullet(result, title, "authorizationRunId", envelope.authorizationRunId);
    result = replaceSectionBullet(result, title, "applicationGitSha", envelope.applicationGitSha);
    result = replaceSectionBullet(result, title, "sourceTreeClean", String(envelope.sourceTreeClean));
    result = replaceSectionBullet(result, title, "sourceStateSha256", envelope.sourceStateSha256);
    result = replaceSectionBullet(result, title, "walletSetSha256", envelope.consentPlan.walletSetSha256);
    result = replaceSectionBullet(result, title, "canaryPlanSha256", envelope.consentPlan.canaryPlanSha256);
    result = replaceSectionBullet(result, title, "consentPlanSha256", envelope.consentPlanSha256);
    result = replaceSectionBullet(result, title, "consentEnvelopeSha256", envelopeDigest);
  }
  result = replaceSectionBullet(result, "Overall Status", "authorizationReady", String(envelope.sourceTreeClean));
  result = replaceSectionBullet(result, "V10 Matrix Dry-Run", "walletSetSha256", envelope.consentPlan.walletSetSha256);
  result = replaceSectionBullet(result, "V10 Matrix Dry-Run", "canaryPlanSha256", envelope.consentPlan.canaryPlanSha256);
  result = replaceSectionBullet(result, "V10 Matrix Dry-Run", "rounds", String(envelope.consentPlan.txCaps.bet / 2));
  return replaceSectionBullet(result, "V10 Matrix Dry-Run", "plannedBetTx", String(envelope.consentPlan.txCaps.bet));
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
  return spawnSync(process.execPath, [
    `--import=${fetchGuard}`,
    TSX_CLI,
    path.join(cwd, "scripts", path.basename(LIVE_CANARY_SCRIPT)),
    ...args,
  ], {
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

function inspectFreshPreviewBinding({
  executionExtraEnv = {},
  mutateAfterBinding,
  rebindPreviewShaAfterMutation = false,
} = {}) {
  const cwd = mkdtempSync(path.join(tmpdir(), "lore-fresh-preview-binding-"));
  try {
    const docsDir = path.join(cwd, "docs");
    const logDir = path.join(cwd, "data", "live-test-runs");
    initializeFixtureProjectClone(cwd, { linkDependencies: true });

    const signerKeys = LIVE_WALLET_ROLES.map((_, index) => `0x${String(index + 1).padStart(64, "0")}`);
    const signerAddresses = signerKeys.map((key) => privateKeyToAccount(key).address);
    const publicFilePath = path.join(cwd, ".env.live-test-addresses");
    const publicFileText = `${LIVE_WALLET_ROLES.map(
      (role, index) => `LORE_LIVE_TEST_${role}_ADDRESS=${signerAddresses[index]}`,
    ).join("\n")}\n`;
    writeFileSync(publicFilePath, publicFileText, "utf8");
    runFixtureGit(cwd, ["add", "-f", "--", ".env.live-test-addresses"]);
    runFixtureGit(cwd, ["commit", "--quiet", "--no-gpg-sign", "-m", "public wallet fixture"]);

    const publicConfig = loadLiveTestPublicWalletConfig({
      cwd,
      environment: clearPendingEnv(),
    });
    const planResult = runLiveCanaryInspection(cwd, ["--v10-matrix-only", "--inspect-canary-plan"]);
    assert.equal(planResult.status, 0, planResult.stderr || planResult.stdout);
    const planSummary = JSON.parse(planResult.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1));
    const consentPlan = planSummary.consentPlan;
    const logText = createDryRunLogText(consentPlan);
    const repositoryState = captureV10PreviewRepositoryState({ root: cwd });

    writeFileSync(path.join(logDir, DRY_RUN_LOG_NAME), logText, "utf8");
    const previewPath = path.join(docsDir, "v10-canary-dry-run-preview.md");
    const markdown = makeBoundPreviewMarkdown(logText, {
      consentPlan,
      repositoryState,
    });
    writeFileSync(previewPath, markdown, "utf8");
    let previewSha256 = sha256(markdown);

    mutateAfterBinding?.({
      cwd,
      previewPath,
      publicFilePath,
      publicFileText,
      signerAddresses,
      consentPlan,
      logText,
    });
    if (rebindPreviewShaAfterMutation) previewSha256 = sha256(readFileSync(previewPath, "utf8"));
    const result = runLiveCanaryInspection(
      cwd,
      ["--v10-matrix-only", "--execute", "--execute-live", "--inspect-fresh-preview-binding"],
      {
        LIVE_TEST_EXECUTE: "1",
        LIVE_TEST_PREVIEW_SHA256: previewSha256,
        ...executionExtraEnv,
      },
    );
    return {
      result,
      previewSha256,
      walletSetSha256: publicConfig.walletSetSha256,
      canaryPlanSha256: planSummary.canaryPlanSha256,
      consentPlanSha256: planSummary.consentPlanSha256,
    };
  } finally {
    rmSync(cwd, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

function appendPreviewArtifactNewline({ previewPath }) {
  const previewArtifactText = readFileSync(previewPath, "utf8");
  writeFileSync(previewPath, `${previewArtifactText}\n`, "utf8");
}

function incrementPreviewSafeWindowTimeout({ previewPath }) {
  const previewConsentArtifactText = readFileSync(previewPath, "utf8");
  const mutatedPreviewArtifact = mutateConsentEnvelopeInMarkdown(
    previewConsentArtifactText,
    (envelope) => {
      envelope.consentPlan.stopPolicy.safeWindowTimeoutMs += 1_000;
    },
  );
  writeFileSync(previewPath, mutatedPreviewArtifact, "utf8");
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

test("Preview child env preserves public planning config and refuses malicious credentials", () => {
  const publicConfig = {
    LINEA_NETWORK: "sepolia",
    NEXT_PUBLIC_LINEA_NETWORK: "sepolia",
    NEXT_PUBLIC_CONTRACT_ADDRESS: "0x1111111111111111111111111111111111111111",
    NEXT_PUBLIC_LINEA_TOKEN_ADDRESS: "0x2222222222222222222222222222222222222222",
    NEXT_PUBLIC_CONTRACT_HAS_TOKEN_GETTER: "1",
    NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS: "1",
    NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "31678224",
    INDEXER_START_BLOCK: "31678224",
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
    LIVE_TEST_EXECUTE: "1",
    SOAK_EXECUTE_LIVE: "1",
    TEST_WALLET_EXECUTE: "1",
  });

  assert.equal(inspection.signingMaterialLoaded, false);
  assert.equal(inspection.sensitiveCredentialKeysPresent, false);
  assert.deepEqual(inspection.publicConfig, publicConfig);
  const conflictingInspection = inspectChildEnv({
    ...publicConfig,
    LINEA_NETWORK: "mainnet",
    NEXT_PUBLIC_LINEA_NETWORK: "sepolia",
    NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "31678224",
    INDEXER_START_BLOCK: "31678225",
  });
  assert.deepEqual(
    {
      LINEA_NETWORK: conflictingInspection.publicConfig.LINEA_NETWORK,
      NEXT_PUBLIC_LINEA_NETWORK: conflictingInspection.publicConfig.NEXT_PUBLIC_LINEA_NETWORK,
      NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: conflictingInspection.publicConfig.NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK,
      INDEXER_START_BLOCK: conflictingInspection.publicConfig.INDEXER_START_BLOCK,
    },
    {
      LINEA_NETWORK: "mainnet",
      NEXT_PUBLIC_LINEA_NETWORK: "sepolia",
      NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "31678224",
      INDEXER_START_BLOCK: "31678225",
    },
    "inspection must expose both sides of conflicting public network and block bindings",
  );
  assert.deepEqual(inspection.executionGates, {
    LIVE_TEST_EXECUTE: "0",
    SOAK_EXECUTE_LIVE: "0",
    TEST_WALLET_EXECUTE: "0",
  });
  const nonSigningCredentials = {
    HEALTH_DIAGNOSTICS_SECRET: "malicious-health-secret-only",
    ADMIN_AUTH_TOKEN: "malicious-auth-token-only",
    SENTRY_DSN: "https://credential@example.invalid/non-signing",
    ALERT_WEBHOOK_URL: "https://credential@example.invalid/non-signing-hook",
    LIVE_TEST_RPC_URL: "https://credential@example.invalid/non-signing-rpc",
    NEXT_PUBLIC_LINEA_RPCS: "https://credential@example.invalid/non-signing-public-rpc",
  };
  const filteredInspection = inspectChildEnv({ ...publicConfig, ...nonSigningCredentials });
  assert.equal(filteredInspection.sensitiveCredentialKeysPresent, false);
  assert.deepEqual(
    filteredInspection.childEnvKeys.filter((key) => Object.hasOwn(nonSigningCredentials, key)),
    [],
    "non-signing credentials and RPC endpoints must stay outside the read-only child allowlist",
  );
  const filteredInspectionText = JSON.stringify(filteredInspection);
  for (const secret of Object.values(nonSigningCredentials)) {
    assert.equal(filteredInspectionText.includes(secret), false, "inspection must not echo filtered credential values");
  }
  const refused = inspectChildEnv({ ...publicConfig, ...forbidden }, { allowFailure: true });
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /Preview generator refuses inherited signing material/);
  for (const secret of Object.values(forbidden)) {
    assert.equal(`${refused.stdout}\n${refused.stderr}`.includes(secret), false, "refusal must not echo credentials");
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

  const generated = runMockedPreview({}, {
    captureChildCalls: true,
    extraEnv: {
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
      ...networkPoison,
    },
  });
  assert.equal(generated.result.status, 0, generated.result.stderr || generated.result.stdout);
  const npmCalls = generated.childCalls.slice(0, 3);
  assert.equal(npmCalls.length, 3);
  assert.deepEqual(
    npmCalls.map((call) => ({ command: call.command, npmCli: call.args[0], cwd: call.cwd })),
    Array.from({ length: 3 }, () => ({
      command: launcher.command,
      npmCli: launcher.cliPath.replaceAll("\\", "/"),
      cwd: generated.fixtureRoot,
    })),
  );
  assert.deepEqual(
    npmCalls.map((call) => call.npmBoundary),
    Array.from({ length: 3 }, () => ({
      path: [path.dirname(launcher.command), path.join(generated.fixtureRoot, "node_modules", ".bin")].join(path.delimiter),
      scriptShell: env.npm_config_script_shell,
      userConfig: path.join(generated.fixtureRoot, ".npmrc"),
      registry: "https://registry.npmjs.org/",
      global: "false",
      offline: "false",
      ignoreScripts: "true",
      npmExecpathPresent: false,
      npmNodeExecpathPresent: false,
    })),
  );
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
  const dotenvSentinel = "dotenv-preload-signing-sentinel";
  const previewInspection = inspectChildEnv({
    UNRELATED_PREVIEW_ENV_SENTINEL: dotenvSentinel,
  });
  assert.equal(previewInspection.childEnvKeys.includes("UNRELATED_PREVIEW_ENV_SENTINEL"), false);
  assert.equal(JSON.stringify(previewInspection).includes(dotenvSentinel), false);

  const probeRoot = mkdtempSync(path.join(tmpdir(), "lore-preview-dotenv-boundary-"));
  const fetchGuard = `data:text/javascript,${encodeURIComponent(
    'globalThis.fetch=async()=>{throw new Error("NETWORK_CALL_FORBIDDEN")}',
  )}`;
  const runProbe = (scriptPath, args, extraEnv = {}) => spawnSync(
    process.execPath,
    [`--import=${fetchGuard}`, TSX_CLI, scriptPath, ...args],
    {
      cwd: probeRoot,
      encoding: "utf8",
      env: clearPendingEnv(extraEnv),
      timeout: 30_000,
    },
  );
  try {
    writeFileSync(
      path.join(probeRoot, ".env"),
      "V10_POSTDEPLOY_SCAN_EPOCHS=dotenv-preload-invalid-integer\n",
      "utf8",
    );
    const planner = runProbe(
      path.join(SCRIPT_DIR, "plan-v10-postdeploy-canary.ts"),
      ["--summary-only"],
      { NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS: "0" },
    );
    const plannerOutput = `${planner.stdout ?? ""}\n${planner.stderr ?? ""}`;
    assert.notEqual(planner.status, 0);
    assert.match(plannerOutput, /V10 post-deploy planning requires epoch-bound runtime mode/);
    assert.doesNotMatch(plannerOutput, /V10_POSTDEPLOY_SCAN_EPOCHS/);

    writeFileSync(
      path.join(probeRoot, ".env"),
      `LORE_LIVE_TEST_MANUAL_PRIVATE_KEY=${dotenvSentinel}\n`,
      "utf8",
    );
    const live = runProbe(
      LIVE_CANARY_SCRIPT,
      ["--v10-matrix-only", "--inspect-runtime-enforcement"],
      {
        NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS: "1",
        LIVE_CANARY_RPC_LABEL: "fixture-public-sepolia",
        LIVE_TEST_ROLES: "MANUAL",
      },
    );
    assert.equal(live.status, 0, live.stderr || live.stdout);
    const liveSummary = JSON.parse(live.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1));
    assert.equal(liveSummary.status, "pass");
    assert.deepEqual(liveSummary.operationalBoundary, {
      signingMaterialLoaded: false,
      signatureRequested: false,
      walletClientCreated: false,
      networkRequests: 0,
      contractWrites: 0,
      transactionSent: false,
    });

    writeFileSync(
      path.join(probeRoot, ".env"),
      `KEEPER_PRIVATE_KEY=${dotenvSentinel}\nTEST_WALLET_PRIVATE_KEY=${dotenvSentinel}\n`,
      "utf8",
    );
    const importOnlyUrls = [
      "monitor-runtime-health.mjs",
      "smoke-browser.mjs",
      "check-sqlite-startup.mjs",
    ].map((name) => pathToFileURL(path.join(SCRIPT_DIR, name)).href);
    const importOnlyProbe = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "--eval",
        [
          `const signingNameRe = ${SIGNING_ENV_NAME_RE};`,
          `for (const moduleUrl of ${JSON.stringify(importOnlyUrls)}) await import(moduleUrl);`,
          "const signingKeyNames = Object.keys(process.env).filter((name) => signingNameRe.test(name) && String(process.env[name] ?? '').trim()).sort();",
          "console.log(JSON.stringify({ signingKeyNames }));",
        ].join("\n"),
      ],
      {
        cwd: probeRoot,
        encoding: "utf8",
        env: clearPendingEnv({ DOTENV_CONFIG_PATH: path.join(probeRoot, ".env") }),
        timeout: 30_000,
      },
    );
    assert.equal(importOnlyProbe.status, 0, importOnlyProbe.stderr || importOnlyProbe.stdout);
    const importOnlySummary = JSON.parse(importOnlyProbe.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1));
    assert.deepEqual(importOnlySummary.signingKeyNames, []);
    assert.doesNotMatch(`${importOnlyProbe.stdout}\n${importOnlyProbe.stderr}`, new RegExp(dotenvSentinel));

    const playtest = runProbe(
      path.join(SCRIPT_DIR, "playtest-wallet.ts"),
      [],
      {
        NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS: "1",
        TEST_WALLET_ADDRESS: "not-an-address",
        TEST_WALLET_EXECUTE: "0",
      },
    );
    const playtestOutput = `${playtest.stdout ?? ""}\n${playtest.stderr ?? ""}`;
    assert.notEqual(playtest.status, 0);
    assert.match(playtestOutput, /Address "not-an-address" is invalid/i);
    assert.doesNotMatch(playtestOutput, /Dry-run wallet playtest refuses inherited signing material/);
    assert.doesNotMatch(playtestOutput, new RegExp(dotenvSentinel));
  } finally {
    rmSync(probeRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }

  const liveSource = readFileSync(path.join(SCRIPT_DIR, "live-round-canary.ts"), "utf8");
  const playtestSource = readFileSync(path.join(SCRIPT_DIR, "playtest-wallet.ts"), "utf8");

  // These sequencing constraints are intentionally structural: a final summary cannot prove
  // that signing admission preceded dotenv loading and every wallet/network side effect.
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
    authorizationRunId: AUTHORIZATION_RUN_ID,
    previewSha256: control.previewSha256,
    walletSetSha256: control.walletSetSha256,
    canaryPlanSha256: control.canaryPlanSha256,
    consentPlanSha256: control.consentPlanSha256,
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
    mutateAfterBinding: appendPreviewArtifactNewline,
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
  assert.match(changedWalletSet.result.stderr, /(?:validation failed before live execution|does not match this execution wallet set and canary plan)/);

  const semanticallyReboundPlan = inspectFreshPreviewBinding({
    mutateAfterBinding: incrementPreviewSafeWindowTimeout,
    rebindPreviewShaAfterMutation: true,
  });
  assert.notEqual(
    semanticallyReboundPlan.result.status,
    0,
    "a canonical but semantically changed consent plan must not authorize the local canary plan",
  );
  assert.match(semanticallyReboundPlan.result.stderr, /does not match this execution wallet set and canary plan/);

  for (const candidate of [changedPlan, changedPreview, changedWalletSet, semanticallyReboundPlan]) {
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
  assert.equal(control.summary.consentPlanSha256, canonicalJsonSha256(CANONICAL_CONSENT_PLAN));
  assert.match(control.summary.consentEnvelopeSha256, /^[a-f0-9]{64}$/);
  assert.equal(control.summary.authorizationRunId, AUTHORIZATION_RUN_ID);
  assert.match(control.summary.applicationGitSha, /^[a-f0-9]{40}$/);
  assert.equal(control.summary.sourceTreeClean, true);
  assert.equal(control.summary.authorizationReady, true);
  assert.equal(control.summary.finalLogBoundaryVerified, true);
  assert.match(control.summary.previewSha256, /^[a-f0-9]{64}$/);
  assert.match(control.markdown, /^- operationalBoundaryVerified: true$/m);
  assert.match(control.markdown, /^## Machine-Readable Consent Envelope$/m);
  const envelopeJson = control.markdown.match(/^```json\r?\n([^\r\n]+)\r?\n```\s*$/m)?.[1];
  assert.ok(envelopeJson, "generated Preview must contain its canonical envelope JSON");
  const envelope = JSON.parse(envelopeJson);
  const admission = JSON.parse(control.logText.split(/\r?\n/).filter(Boolean)[0]).admission;
  assert.equal(envelope.authorizationRunId, AUTHORIZATION_RUN_ID);
  assert.equal(envelope.runtimeEvidence.admissionRunId, AUTHORIZATION_RUN_ID);
  assert.equal(admission.runId, AUTHORIZATION_RUN_ID);

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

  const canonicalConsentLine = `[live-canary] consentPlan=${JSON.stringify(CANONICAL_CONSENT_PLAN)} consentPlanSha256=${canonicalJsonSha256(CANONICAL_CONSENT_PLAN)}`;
  for (const [label, consentPlanLines] of [
    ["missing consent plan", []],
    ["duplicate consent plan", [canonicalConsentLine, canonicalConsentLine]],
  ]) {
    const mutation = runMockedPreview({ consentPlanLines });
    assert.notEqual(mutation.result.status, 0, label);
    assert.equal(mutation.summary.status, "fail", label);
    assert.match(mutation.summary.consentPlanIssue ?? "", /exactly one consent plan/, label);
  }

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

test("Preview generator rejects dry-run admission outside its fresh challenge", () => {
  const mismatchedLog = createDryRunLogText(
    CANONICAL_CONSENT_PLAN,
    new Date().toISOString(),
    DRY_RUN_ADMISSION_RUN_ID,
  );
  const generated = runMockedPreview({}, { logText: mismatchedLog });
  assert.notEqual(generated.result.status, 0);
  assert.equal(generated.summary.status, "fail");
  assert.equal(generated.summary.authorizationReady, false);
  assert.equal(generated.summary.authorizationRunId, null);
  assert.match(generated.summary.logBindingIssue ?? "", /admission run ID does not match the generator challenge/);
});

test("Preview generator invokes the ordered sanitized dry-run child contract", () => {
  const timeoutMs = 12_345;
  const generated = runMockedPreview({}, {
    captureChildCalls: true,
    extraEnv: {
      LIVE_TEST_RUN_ID: "inherited-run-id-must-not-control-preview",
      V10_CANARY_DRY_RUN_PREVIEW_TIMEOUT_MS: String(timeoutMs),
    },
  });
  assert.equal(generated.result.status, 0, generated.result.stderr || generated.result.stdout);
  assert.equal(generated.childCalls.length, 4);
  const expectedScripts = [
    "plan:canary:v10:postdeploy:summary",
    "soak:testnet:clear-pending:summary",
    "live:canary:v10:matrix",
    "scripts/analyze-live-canary-proof.mjs",
  ];
  assert.deepEqual(
    generated.childCalls.map((call) => call.args.find((arg) => expectedScripts.includes(arg)) ?? null),
    expectedScripts,
    "Preview must preserve the planner, pending nonce, matrix, and strict analyzer order",
  );
  assert.deepEqual(
    generated.childCalls.slice(0, 3).map((call) => call.args.slice(-2)),
    [
      ["run", "plan:canary:v10:postdeploy:summary"],
      ["run", "soak:testnet:clear-pending:summary"],
      ["run", "live:canary:v10:matrix"],
    ],
  );
  assert.deepEqual(generated.childCalls.at(-1).args, [
    "scripts/analyze-live-canary-proof.mjs",
    DRY_RUN_LOG_RELATIVE_PATH.replaceAll("\\", "/"),
    "--profile=v10-matrix",
    "--preview-dry-run",
    "--summary-only",
    "--require-epoch-bound",
  ]);
  for (const call of generated.childCalls) {
    assert.deepEqual(call.executionGates, {
      LIVE_TEST_DRY_RUN: "1",
      LIVE_TEST_EXECUTE: "0",
      SOAK_EXECUTE_LIVE: "0",
      TEST_WALLET_EXECUTE: "0",
    });
    for (const forbidden of ["--execute", "--execute-live", "--confirm-lowest-pending-nonce-replacement"]) {
      assert.equal(call.args.includes(forbidden), false, `${forbidden} must not reach a Preview child`);
    }
  }
  assert.deepEqual(
    generated.childCalls.map((call) => call.liveTestRunId),
    [null, null, AUTHORIZATION_RUN_ID, null],
    "only the matrix child receives the generator challenge, overriding inherited LIVE_TEST_RUN_ID",
  );
  assert.deepEqual(generated.childCalls.map((call) => call.timeout), [timeoutMs, timeoutMs, timeoutMs, timeoutMs]);
});

test("Preview generator demotes a final log mutation during atomic publication", () => {
  const generated = runMockedPreview({}, { mutateLogOnPreviewRename: true });
  assert.notEqual(generated.result.status, 0);
  assert.equal(generated.summary.status, "fail");
  assert.equal(generated.summary.authorizationReady, false);
  assert.equal(generated.summary.canaryLogBound, false);
  assert.equal(generated.summary.finalLogBoundaryVerified, false);
  assert.match(generated.markdown, /^- status: fail$/m);
  assert.match(generated.markdown, /^- authorizationReady: false$/m);
  assert.match(generated.markdown, /^- canaryLogBound: false$/m);
});

test("Preview generator rejects invalid timeout values before invoking a child", () => {
  const invalidTimeouts = [
    ["scientific notation", "1e3", /must be a canonical decimal integer/],
    ["unit suffix", "1200ms", /must be a canonical decimal integer/],
    ["below the safe minimum", "999", /must be between 1000 and 900000/],
    ["above the safe maximum", "900001", /must be between 1000 and 900000/],
  ];
  for (const [label, timeout, expectedError] of invalidTimeouts) {
    const generated = runMockedPreview({}, {
      captureChildCalls: true,
      extraEnv: { V10_CANARY_DRY_RUN_PREVIEW_TIMEOUT_MS: timeout },
    });
    assert.notEqual(generated.result.status, 0, label);
    assert.match(
      generated.result.stderr,
      new RegExp(`V10_CANARY_DRY_RUN_PREVIEW_TIMEOUT_MS ${expectedError.source}`),
      label,
    );
    assert.deepEqual(generated.childCalls, [], label);
    assert.equal(generated.summary, null, label);
    assert.equal(generated.markdown, null, label);
  }
});

test("Preview generator redacts and bounds compact Markdown fields", () => {
  const secret = "preview-output-secret-sentinel";
  const generated = runMockedPreview({
    planner: { plannedTransfersLinea: `API_KEY=${secret} ${"x".repeat(240)}` },
  });
  assert.equal(generated.result.status, 0, generated.result.stderr || generated.result.stdout);
  assert.doesNotMatch(generated.markdown, new RegExp(secret));
  const field = generated.markdown.match(/^- plannedTransfersLinea: (.+)$/m)?.[1] ?? "";
  assert.match(field, /API_KEY=<redacted>/);
  assert.match(field, /\.\.\.<truncated>$/);
  assert.ok(field.length <= 180, `compact field must be bounded, got ${field.length}`);
});

test("Preview generator rejects credential-like or multiline rpc labels before child work", () => {
  const secret = "preview-rpc-label-secret-sentinel";
  const generated = runMockedPreview({}, {
    extraEnv: { LIVE_CANARY_RPC_LABEL: `API_KEY=${secret}\n${"x".repeat(240)}` },
  });
  assert.notEqual(generated.result.status, 0);
  assert.equal(generated.summary, null);
  assert.equal(generated.markdown, null);
  assert.doesNotMatch(`${generated.result.stdout}\n${generated.result.stderr}`, new RegExp(secret));
  assert.match(
    `${generated.result.stdout}\n${generated.result.stderr}`,
    /LIVE_CANARY_RPC_LABEL must be a short redacted identifier/,
  );
});

test("Preview generator normalizes the upstream absolute live-canary log path into its safe binding", () => {
  const generated = runMockedPreview({}, { absoluteMatrixLog: true });
  assert.equal(generated.result.status, 0, generated.result.stderr || generated.result.stdout);
  assert.equal(generated.summary.status, "pass");
  assert.equal(generated.summary.canaryLog, DRY_RUN_LOG_RELATIVE_PATH);
  assert.equal(path.isAbsolute(generated.upstreamMatrixLogPath), true);
  assert.equal(generated.markdown.includes(generated.upstreamMatrixLogPath), false);
  assert.match(generated.markdown, new RegExp(`^- log: ${DRY_RUN_LOG_RELATIVE_PATH.replace(/\\/g, "\\\\")}$`, "m"));
  const escapedLogPath = DRY_RUN_LOG_RELATIVE_PATH.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  assert.match(generated.markdown, new RegExp(`^\\[live-canary\\]\\s+log=${escapedLogPath}$`, "m"));
});

test("Preview generator fails closed for unsafe and oversized canary log bindings", () => {
  const unsafeLogPaths = [
    ["path traversal", "../outside.jsonl"],
    ["unexpected filename", "data/live-test-runs/not-canary.jsonl"],
  ];
  for (const [label, matrixLogPath] of unsafeLogPaths) {
    const generated = runMockedPreview({}, { matrixLogPath, captureChildCalls: true });
    assert.notEqual(generated.result.status, 0, label);
    assert.equal(generated.summary.status, "fail", label);
    assert.equal(generated.summary.canaryLog, null, label);
    assert.equal(generated.summary.canaryLogBound, false, label);
    assert.equal(generated.summary.dryRunPreviewVerdictPassed, false, label);
    assert.equal(
      generated.childCalls.some((call) => call.args.includes("scripts/analyze-live-canary-proof.mjs")),
      false,
      `${label} must not invoke the analyzer without a valid log path`,
    );
    assert.doesNotMatch(generated.markdown, /^- log:/m, label);
    assert.equal(generated.markdown.includes(matrixLogPath), false, `${label} path must not be published`);
    assert.doesNotMatch(generated.markdown, /\[live-canary\]\s+log\s*=/i, `${label} log assignment must be omitted`);
    assert.match(generated.markdown, /\[live-canary\]\s+network=sepolia\b/, `${label} must retain safe matrix evidence`);
  }

  const oversized = runMockedPreview({}, {
    captureChildCalls: true,
    logText: "x".repeat(256 * 1024 + 1),
  });
  assert.notEqual(oversized.result.status, 0);
  assert.equal(oversized.summary.status, "fail");
  assert.equal(oversized.summary.canaryLog, DRY_RUN_LOG_RELATIVE_PATH);
  assert.equal(oversized.summary.canaryLogBound, false);
  assert.equal(oversized.summary.dryRunPreviewVerdictPassed, false);
  assert.match(oversized.summary.logBindingIssue ?? "", /too large to bind safely/);
  assert.equal(
    oversized.childCalls.some((call) => call.args.includes("scripts/analyze-live-canary-proof.mjs")),
    false,
    "an oversized log must not reach the analyzer after safe binding rejected it",
  );
  assert.match(oversized.markdown, /- analyzer skipped because the matrix dry-run log did not pass safe binding/);
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
    assert.equal(generated.summary.dryRunPreviewVerdictPassed, false, label);
    assert.match(generated.markdown, /^- dryRunPreviewVerdictPassed: false$/m, label);
  }
});

test("Preview checker behavior requires the generated operational boundary evidence", () => {
  const generated = runMockedPreview();
  assert.equal(generated.result.status, 0, generated.result.stderr || generated.result.stdout);

  const control = checkPreviewMarkdown(generated.markdown, { logText: generated.logText });
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
    generated.markdown.replace(
      "not an authorization to send transactions, start a soak, deploy, or change\ncontract behavior.",
      "this Preview authorizes execution.",
    ),
    generated.markdown.replace(
      "Do not execute any of the following without a fresh exact authorization after a\nfresh Preview rerun:",
      "Execution may use a previously issued authorization.",
    ),
  ];
  for (const markdown of mutations) {
    const mutation = checkPreviewMarkdown(markdown, { logText: generated.logText });
    assert.notEqual(mutation.result.status, 0);
    assert.equal(mutation.summary.status, "fail");
  }
});

test("Preview checker rejects duplicate required headings and unknown flags", () => {
  const markdown = makeBoundPreviewMarkdown(DRY_RUN_LOG_TEXT);
  const duplicateHeading = checkPreviewMarkdown(`${markdown}\n## Overall Status\n`);
  assert.notEqual(duplicateHeading.result.status, 0);
  assert.equal(duplicateHeading.summary.status, "fail");
  assert.equal(duplicateHeading.summary.issue, "v10-dry-run-preview-must-contain-only-the-exact-visible-heading-contract");

  const unknownFlag = checkPreviewMarkdown(markdown, { args: ["--unknown-preview-flag"] });
  assert.notEqual(unknownFlag.result.status, 0);
  assert.equal(unknownFlag.summary.status, "fail");
  assert.equal(unknownFlag.summary.issue, "v10-dry-run-preview-checker-received-an-unknown-argument");
});

test("Preview checker rejects fenced structural substitution and extra visible sections", () => {
  const markdown = makeBoundPreviewMarkdown(DRY_RUN_LOG_TEXT);
  const fencedSubstitution = checkPreviewMarkdown([
    "````markdown",
    markdown,
    "````",
    "",
    "## Operator Summary",
    "- status: pass",
    "",
  ].join("\n"));
  assert.notEqual(fencedSubstitution.result.status, 0);
  assert.equal(fencedSubstitution.summary.status, "fail");
  assert.match(fencedSubstitution.summary.issue, /exact-visible-heading-contract/);

  const extraVisibleSection = checkPreviewMarkdown(`${markdown}\n## Operator Summary\n- status: pass\n`);
  assert.notEqual(extraVisibleSection.result.status, 0);
  assert.equal(extraVisibleSection.summary.status, "fail");
  assert.match(extraVisibleSection.summary.issue, /exact-visible-heading-contract/);

  const fencedDecoy = checkPreviewMarkdown([
    "```text",
    "## Operator Summary",
    "- status: fail",
    "```",
    "",
    markdown,
  ].join("\n"));
  assert.equal(fencedDecoy.result.status, 0, fencedDecoy.result.stderr || fencedDecoy.result.stdout);
  assert.equal(fencedDecoy.summary.status, "pass");

  const globalOneShotClaim = checkPreviewMarkdown(markdown.replace(
    "repository-local consumption is not a global one-shot guarantee",
    "repository-local consumption is a global one-shot guarantee",
  ));
  assert.notEqual(globalOneShotClaim.result.status, 0);
  assert.equal(globalOneShotClaim.summary.status, "fail");
  assert.match(globalOneShotClaim.summary.issue, /repository-local-consumption-boundary/);
});

test("authorization-ready Preview checker reports the actual stale age", () => {
  const staleAt = new Date(Date.now() - 60 * 60_000).toISOString();
  const staleLogText = createDryRunLogText(CANONICAL_CONSENT_PLAN, staleAt);
  const markdown = makeBoundPreviewMarkdown(staleLogText, { updatedAt: staleAt });
  const freshnessEnv = {
    V10_DRY_RUN_PREVIEW_MAX_AGE_MS: String(24 * 60 * 60_000),
    V10_DRY_RUN_AUTHORIZATION_MAX_AGE_MS: String(15 * 60_000),
  };
  const regular = checkPreviewMarkdown(markdown, { logText: staleLogText, extraEnv: freshnessEnv });
  assert.equal(regular.result.status, 0, regular.result.stderr || regular.result.stdout);
  assert.equal(regular.summary.status, "pass");
  assert.equal(regular.summary.authorizationFreshnessRequired, false);
  const result = checkPreviewMarkdown(markdown, {
    args: ["--require-fresh-authorization"],
    logText: staleLogText,
    extraEnv: freshnessEnv,
  });
  assert.notEqual(result.result.status, 0);
  assert.equal(result.summary.status, "fail");
  assert.equal(result.summary.authorizationFreshnessRequired, true);
  assert.equal(result.summary.maxPreviewAgeMinutes, 15);
  const expectedAgeMinutes = Math.floor((Date.now() - Date.parse(staleAt)) / 60_000);
  assert.ok(
    Number.isSafeInteger(result.summary.ageMinutes) &&
      result.summary.ageMinutes >= expectedAgeMinutes &&
      result.summary.ageMinutes <= expectedAgeMinutes + 1,
    `checker must report the current stale Preview age, got ${result.summary.ageMinutes}`,
  );
  assert.equal(result.summary.issue, "v10-dry-run-preview-is-not-fresh-enough-for-authorization");
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

test("Preview checker rejects admission and envelope challenge cross-splices", () => {
  const markdownA = makeBoundPreviewMarkdown(DRY_RUN_LOG_TEXT);
  const logB = rebindDryRunAdmission(DRY_RUN_LOG_TEXT, DRY_RUN_ADMISSION_RUN_ID);
  const coherentLogB = checkPreviewMarkdown(bindMarkdownLog(markdownA, logB), { logText: logB });
  assert.notEqual(coherentLogB.result.status, 0);
  assert.equal(coherentLogB.summary.status, "fail");
  assert.match(coherentLogB.summary.issue, /admission-run-id/);

  const envelopeB = mutateConsentEnvelopeInMarkdown(markdownA, (envelope) => {
    envelope.authorizationRunId = DRY_RUN_ADMISSION_RUN_ID;
    envelope.runtimeEvidence.admissionRunId = DRY_RUN_ADMISSION_RUN_ID;
  });
  const envelopeBWithLogA = checkPreviewMarkdown(envelopeB);
  assert.notEqual(envelopeBWithLogA.result.status, 0);
  assert.equal(envelopeBWithLogA.summary.status, "fail");
  assert.match(envelopeBWithLogA.summary.issue, /admission-run-id/);

  const undigestedLogB = rebindDryRunAdmission(
    DRY_RUN_LOG_TEXT,
    DRY_RUN_ADMISSION_RUN_ID,
    { recomputeDigest: false },
  );
  const undigestedMutation = checkPreviewMarkdown(
    bindMarkdownLog(envelopeB, undigestedLogB),
    { logText: undigestedLogB },
  );
  assert.notEqual(undigestedMutation.result.status, 0);
  assert.equal(undigestedMutation.summary.status, "fail");
  assert.match(undigestedMutation.summary.issue, /admission-digest/);
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

export async function runV10PreviewEnvBoundaryTests() {
  for (const { fn } of previewEnvBoundaryCases) {
    await fn();
  }
}

const currentTestPath = fileURLToPath(import.meta.url);
function sameInvocationPath(candidate, expected) {
  if (typeof candidate !== "string" || !candidate) return false;
  const candidatePath = path.resolve(candidate);
  return process.platform === "win32"
    ? candidatePath.toLowerCase() === expected.toLowerCase()
    : candidatePath === expected;
}

const isDirectTestInvocation =
  sameInvocationPath(process.argv[1], currentTestPath) ||
  (sameInvocationPath(process.argv[1], TSX_CLI) && sameInvocationPath(process.argv[2], currentTestPath));

if (isDirectTestInvocation) {
  for (const { name, fn } of previewEnvBoundaryCases) {
    nodeTest(name, fn);
  }
}
