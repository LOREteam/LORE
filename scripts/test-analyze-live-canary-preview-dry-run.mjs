import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const repositoryRoot = process.cwd();
const analyzerPath = resolve(repositoryRoot, "scripts", "analyze-live-canary-proof.mjs");
const contractAddress = "0x1111111111111111111111111111111111111111";
const runtimeSha256 = "1".repeat(64);
const manifestSha256 = "2".repeat(64);
const deploymentManifestSha256 = "3".repeat(64);
const sourceArtifactGitSha = "4".repeat(40);
const walletSetSha256 = "5".repeat(64);
const canaryPlanSha256 = "6".repeat(64);
const timestamp = "2026-08-23T12:00:00.000Z";

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

function createValidEvents() {
  const admission = {
    schema: 2,
    runId: "123e4567-e89b-42d3-a456-426614174000",
    execution: "dry-run",
    profile: "v10-matrix",
    network: "sepolia",
    chainId: 59141,
    contractAddress,
    contractDeployBlock: "31678224",
    runtimeSha256,
    manifestSha256,
    deploymentManifestSha256,
    sourceArtifactGitSha,
    canonicalProvenanceVerified: true,
    previewSha256: null,
    walletSetSha256,
    canaryPlanSha256,
    selectedRoles: ["MANUAL"],
    roleCaps: [{ role: "MANUAL", spendCapWei: "100", allowanceCapWei: "100" }],
  };
  const admissionSha256 = createHash("sha256")
    .update(canonicalAdmissionPayload(admission), "utf8")
    .digest("hex");
  const common = {
    network: "sepolia",
    chainId: 59141,
    contractAddress,
    rpcLabel: "linea-sepolia-public",
    rpcFailoverInjected: false,
  };
  const binding = {
    admissionSha256,
    runId: admission.runId,
    walletSetSha256,
  };
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
        chainId: 59141,
        contractAddress,
        deployBlock: "31678224",
        executableBytes: 1024,
        executableRuntimeBytes: 960,
        immutableReferences: 2,
        manifestDigest: manifestSha256,
        manifestMatched: true,
        normalizedRuntimeSha256: runtimeSha256,
        observedBlock: "31678300",
        observedBlockHash: `0x${"7".repeat(64)}`,
      },
      deploymentManifestSha256,
      sourceArtifactGitSha,
      timestamp,
    },
    {
      ...common,
      ...binding,
      amount: "0",
      allowance: "0.0000000000000001",
      allowanceCapWei: "100",
      allowanceWei: "100",
      allowanceWithinRunCap: true,
      approvalRequired: false,
      approvalTarget: "0.0000000000000001",
      enoughEth: true,
      enoughToken: true,
      mode: "preflight",
      nonceLatest: 8,
      noncePending: 8,
      ok: true,
      participant: true,
      role: "MANUAL",
      round: -1,
      timestamp,
      totalAmount: "0.0000000000000001",
      totalAmountWei: "100",
    },
  ];
}

function refreshAdmissionBinding(events) {
  const admissionEvent = events.find((event) => event.mode === "admission");
  assert.ok(admissionEvent, "fixture admission missing");
  const admissionSha256 = createHash("sha256")
    .update(canonicalAdmissionPayload(admissionEvent.admission), "utf8")
    .digest("hex");
  admissionEvent.admissionSha256 = admissionSha256;
  for (const event of events) {
    if (event === admissionEvent) continue;
    event.admissionSha256 = admissionSha256;
    event.runId = admissionEvent.admission.runId;
    event.walletSetSha256 = admissionEvent.admission.walletSetSha256;
  }
}

function runAnalyzer(root, events, { previewDryRun = true } = {}) {
  const logPath = join(root, `canary-${Math.random().toString(16).slice(2)}.jsonl`);
  return runAnalyzerText(logPath, `${events.map((event) => JSON.stringify(event)).join("\n")}\n`, { previewDryRun });
}

function runAnalyzerText(logPath, text, { previewDryRun = true } = {}) {
  writeFileSync(logPath, text, "utf8");
  const result = spawnSync(process.execPath, [
    analyzerPath,
    logPath,
    "--profile=v10-matrix",
    "--strict",
    "--summary-only",
    ...(previewDryRun ? ["--preview-dry-run"] : []),
  ], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      CANARY_PROOF_PATH: "",
      CANARY_REQUIRE_ADMISSION: "0",
      CANARY_REQUIRE_EPOCH_BOUND: "0",
      CANARY_REQUIRE_V10_DEPLOYMENT_MANIFEST: "0",
      CANARY_REQUIRE_V10_GAS_MATRIX: "0",
      KEEPER_CONTRACT_ADDRESS: contractAddress,
      LINEA_CHAIN_ID: "59141",
      LINEA_NETWORK: "sepolia",
      NEXT_PUBLIC_CONTRACT_ADDRESS: contractAddress,
      NEXT_PUBLIC_LINEA_CHAIN_ID: "59141",
      NEXT_PUBLIC_LINEA_NETWORK: "sepolia",
      NODE_OPTIONS: "",
      PROOF_STRICT: "0",
    },
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
    timeout: 30_000,
    windowsHide: true,
  });
  assert.equal(result.error, undefined, result.error?.message);
  return { status: result.status, stdout: String(result.stdout ?? ""), stderr: String(result.stderr ?? "") };
}

function lastJsonLine(stdout) {
  const line = stdout.trim().split(/\r?\n/).at(-1);
  assert.ok(line, "canonical Preview analyzer JSON summary is missing");
  return JSON.parse(line);
}

const root = mkdtempSync(join(tmpdir(), "lore-preview-analyzer-"));
try {
  const valid = runAnalyzer(root, createValidEvents());
  assert.equal(valid.status, 0, valid.stderr || valid.stdout);
  assert.equal(valid.stderr, "");
  assert.match(valid.stdout, /^Log: canary-[a-f0-9]+\.jsonl$/m);
  assert.match(valid.stdout, /^Log SHA-256: [a-f0-9]{64}$/m);
  assert.match(valid.stdout, /^Log bytes: [1-9][0-9]*$/m);
  assert.match(valid.stdout, /^Preview dry-run verdict: passed$/m);
  assert.match(valid.stdout, /^Preview action events: 0$/m);
  assert.match(valid.stdout, /^Preview successful action tx: 0$/m);
  assert.match(valid.stdout, /^Preview transaction evidence events: 0$/m);
  assert.match(valid.stdout, /^Preview runtime identity preflights: 1$/m);
  assert.match(valid.stdout, /^Preview wallet preflights: 1$/m);
  assert.match(valid.stdout, /^Live launch gates: blocked G10, G11$/m);
  assert.match(valid.stdout, /Summary: Preview dry-run evidence checks passed; live launch gates remain blocked G10, G11\./);
  const validSummary = lastJsonLine(valid.stdout);
  assert.deepEqual(Object.keys(validSummary), [
    "status",
    "mode",
    "previewDryRunVerdict",
    "liveLaunchGates",
    "logName",
    "logSha256",
    "logBytes",
    "actionEvents",
    "successfulActionTx",
    "transactionEvidenceEvents",
    "runtimeIdentityPreflights",
    "walletPreflights",
    "issues",
  ]);
  assert.equal(validSummary.status, "pass");
  assert.equal(validSummary.mode, "preview-dry-run");
  assert.equal(validSummary.previewDryRunVerdict, "passed");
  assert.deepEqual(validSummary.liveLaunchGates, ["G10", "G11"]);
  assert.match(validSummary.logName, /^canary-[a-f0-9]+\.jsonl$/);
  assert.match(validSummary.logSha256, /^[a-f0-9]{64}$/);
  assert.ok(Number.isSafeInteger(validSummary.logBytes) && validSummary.logBytes > 0);
  assert.deepEqual({
    actionEvents: validSummary.actionEvents,
    successfulActionTx: validSummary.successfulActionTx,
    transactionEvidenceEvents: validSummary.transactionEvidenceEvents,
    runtimeIdentityPreflights: validSummary.runtimeIdentityPreflights,
    walletPreflights: validSummary.walletPreflights,
    issues: validSummary.issues,
  }, {
    actionEvents: 0,
    successfulActionTx: 0,
    transactionEvidenceEvents: 0,
    runtimeIdentityPreflights: 1,
    walletPreflights: 1,
    issues: [],
  });

  const approvalPlannedEvents = createValidEvents();
  approvalPlannedEvents[2].allowance = "0";
  approvalPlannedEvents[2].allowanceWei = "0";
  approvalPlannedEvents[2].approvalRequired = true;
  const approvalPlanned = runAnalyzer(root, approvalPlannedEvents);
  assert.equal(approvalPlanned.status, 0, approvalPlanned.stderr || approvalPlanned.stdout);
  assert.equal(lastJsonLine(approvalPlanned.stdout).successfulActionTx, 0);

  const genericStrict = runAnalyzer(root, createValidEvents(), { previewDryRun: false });
  assert.equal(genericStrict.status, 1, "existing strict live-proof mode must continue rejecting dry-run evidence");
  assert.doesNotMatch(genericStrict.stdout, /^Preview dry-run verdict:/m);
  assert.match(genericStrict.stdout, /canonical canary admission execution must be live for strict proof/);

  const liveAdmissionEvents = createValidEvents();
  liveAdmissionEvents[0].admission.execution = "live";
  liveAdmissionEvents[0].admission.previewSha256 = "8".repeat(64);
  refreshAdmissionBinding(liveAdmissionEvents);
  const liveAdmission = runAnalyzer(root, liveAdmissionEvents);
  assert.equal(liveAdmission.status, 1);
  assert.match(liveAdmission.stdout, /^Preview dry-run verdict: failed$/m);
  assert.match(liveAdmission.stdout, /canonical canary admission execution must be dry-run for Preview proof/);

  const reorderedEvents = createValidEvents();
  [reorderedEvents[0], reorderedEvents[1]] = [reorderedEvents[1], reorderedEvents[0]];
  const reordered = runAnalyzer(root, reorderedEvents);
  assert.equal(reordered.status, 1);
  assert.match(reordered.stdout, /canonical canary admission must be the first event/);

  const invalidRuntimeEvents = createValidEvents();
  invalidRuntimeEvents[1].runtimeIdentity.observedBlock = "31678223";
  const invalidRuntime = runAnalyzer(root, invalidRuntimeEvents);
  assert.equal(invalidRuntime.status, 1);
  assert.match(invalidRuntime.stdout, /runtime identity preflight does not match canonical admission/);

  const failedWalletEvents = createValidEvents();
  failedWalletEvents[2].ok = false;
  const failedWallet = runAnalyzer(root, failedWalletEvents);
  assert.equal(failedWallet.status, 1);
  assert.match(failedWallet.stdout, /failed preflight checks 1/);

  const contradictoryWalletEvents = createValidEvents();
  contradictoryWalletEvents[2].enoughEth = false;
  const contradictoryWallet = runAnalyzer(root, contradictoryWalletEvents);
  assert.equal(contradictoryWallet.status, 1);
  assert.match(contradictoryWallet.stdout, /invalid wallet preflight evidence 1/);

  const actionEvents = createValidEvents();
  actionEvents.push({
    network: "sepolia",
    chainId: 59141,
    contractAddress,
    rpcLabel: "linea-sepolia-public",
    rpcFailoverInjected: false,
    admissionSha256: actionEvents[0].admissionSha256,
    runId: actionEvents[0].admission.runId,
    walletSetSha256,
    allowanceCapWei: "100",
    allowanceWei: "100",
    allowanceWithinRunCap: true,
    hash: `0x${"9".repeat(64)}`,
    mode: "approve",
    ok: true,
    role: "MANUAL",
    round: -1,
    timestamp,
    txStatus: "success",
  });
  const action = runAnalyzer(root, actionEvents);
  assert.equal(action.status, 1);
  assert.match(action.stdout, /^Preview action events: 1$/m);
  assert.match(action.stdout, /^Preview successful action tx: 1$/m);
  assert.match(action.stdout, /^Preview transaction evidence events: 1$/m);
  assert.match(action.stdout, /dry-run action events 1 != 0/);
  const actionSummary = lastJsonLine(action.stdout);
  assert.equal(actionSummary.status, "fail");
  assert.equal(actionSummary.previewDryRunVerdict, "failed");
  assert.equal(actionSummary.actionEvents, 1);
  assert.equal(actionSummary.successfulActionTx, 1);
  assert.equal(actionSummary.transactionEvidenceEvents, 1);
  assert.ok(actionSummary.issues.includes("dry-run action events 1 != 0"));

  const oversized = runAnalyzerText(
    join(root, "oversized.jsonl"),
    " ".repeat(256 * 1024 + 1),
  );
  assert.equal(oversized.status, 1);
  assert.match(oversized.stdout, /^Preview dry-run verdict: failed$/m);
  assert.match(oversized.stdout, /Preview dry-run log exceeds the 262144-byte limit/);
  const oversizedSummary = lastJsonLine(oversized.stdout);
  assert.equal(oversizedSummary.status, "fail");
  assert.equal(oversizedSummary.logSha256, null);
  assert.deepEqual(oversizedSummary.liveLaunchGates, ["G10", "G11"]);

  console.log("Preview dry-run analyzer tests passed (10 cases).");
} finally {
  rmSync(root, { recursive: true, force: true });
}
