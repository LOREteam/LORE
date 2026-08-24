import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalJsonSha256,
  consentEnvelopeSha256,
  createV10PreviewConsentEnvelope,
  parseCanonicalV10PreviewConsentEnvelope,
  parseV10ConsentPlanOutput,
  parseV10DryRunLogEvidence,
  validateV10ConsentPlan,
  validateV10PreviewConsentEnvelope,
} from "./v10-preview-consent-envelope.mjs";

const CONTRACT_ADDRESS = `0x${"1".repeat(40)}`;
const DEPLOYMENT_TRANSACTION_HASH = `0x${"2".repeat(64)}`;
const OBSERVED_BLOCK_HASH = `0x${"3".repeat(64)}`;
const DEPLOYMENT_MANIFEST_SHA256 = "4".repeat(64);
const COMPILATION_MANIFEST_SHA256 = "5".repeat(64);
const RUNTIME_SHA256 = "6".repeat(64);
const SOURCE_ARTIFACT_GIT_SHA = "7".repeat(40);
const WALLET_SET_SHA256 = "8".repeat(64);
const CANARY_PLAN_SHA256 = "9".repeat(64);
const APPLICATION_GIT_SHA = "a".repeat(40);
const SOURCE_STATE_SHA256 = "b".repeat(64);
const AUTHORIZATION_RUN_ID = "123e4567-e89b-42d3-a456-426614174000";
const OTHER_AUTHORIZATION_RUN_ID = "123e4567-e89b-42d3-a456-426614174001";
const CONTRACT_DEPLOY_BLOCK = "31678224";
const OBSERVED_BLOCK = "31678300";
const TIMESTAMP = "2026-08-23T12:00:00.000Z";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function differentDigest(digest) {
  return `${digest[0] === "0" ? "1" : "0"}${digest.slice(1)}`;
}

function canonicalTokenAmountFromWei(value) {
  const wei = BigInt(value);
  const scale = 1_000_000_000_000_000_000n;
  const whole = wei / scale;
  const fraction = wei % scale;
  if (fraction === 0n) return whole.toString();
  return `${whole}.${fraction.toString().padStart(18, "0").replace(/0+$/, "")}`;
}

function createConsentPlan() {
  return {
    schema: 1,
    tranche: "v10-matrix",
    profile: "v10-matrix",
    target: {
      network: "sepolia",
      chainId: 59141,
      contractAddress: CONTRACT_ADDRESS,
      contractDeployBlock: CONTRACT_DEPLOY_BLOCK,
      epochBoundBetsRequired: true,
    },
    provenance: {
      deploymentTransactionHash: DEPLOYMENT_TRANSACTION_HASH,
      deploymentManifestSha256: DEPLOYMENT_MANIFEST_SHA256,
      compilationManifestSha256: COMPILATION_MANIFEST_SHA256,
      normalizedExecutableRuntimeSha256: RUNTIME_SHA256,
      sourceArtifactGitSha: SOURCE_ARTIFACT_GIT_SHA,
      canonicalDeploymentManifestVerified: true,
    },
    walletSetSha256: WALLET_SET_SHA256,
    canaryPlanSha256: CANARY_PLAN_SHA256,
    roles: {
      selectedRoles: ["AUTOMINER_A", "AUTOMINER_B", "MANUAL"],
      resolverCandidateRoles: ["RESOLVER", "AUTOMINER_A", "AUTOMINER_B", "MANUAL"],
      roleCaps: [
        {
          role: "AUTOMINER_A",
          spendCapWei: "160000000000000000",
          allowanceCapWei: "160000000000000000",
        },
        {
          role: "AUTOMINER_B",
          spendCapWei: "560000000000000000",
          allowanceCapWei: "560000000000000000",
        },
        {
          role: "MANUAL",
          spendCapWei: "120000000000000000",
          allowanceCapWei: "120000000000000000",
        },
      ],
    },
    txCaps: {
      approval: 3,
      bet: 12,
      resolve: 5,
      pendingReplacement: 0,
      total: 20,
    },
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
      liveLogMaxBytes: 50331648,
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

function createDeploymentManifest() {
  return {
    contractAddress: CONTRACT_ADDRESS,
    deployBlock: CONTRACT_DEPLOY_BLOCK,
    deploymentTransactionHash: DEPLOYMENT_TRANSACTION_HASH,
    deploymentManifestSha256: DEPLOYMENT_MANIFEST_SHA256,
    compilationManifestSha256: COMPILATION_MANIFEST_SHA256,
    normalizedExecutableRuntimeSha256: RUNTIME_SHA256,
    sourceArtifactGitSha: SOURCE_ARTIFACT_GIT_SHA,
    epochBoundBetsRequired: true,
  };
}

function canonicalAdmissionPayload(admission) {
  return {
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
  };
}

function createDryRunEvents(consentPlan = createConsentPlan()) {
  const admission = {
    schema: 2,
    runId: AUTHORIZATION_RUN_ID,
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
    roleCaps: clone(consentPlan.roles.roleCaps),
  };
  const admissionSha256 = canonicalJsonSha256(canonicalAdmissionPayload(admission));
  const common = {
    network: consentPlan.target.network,
    chainId: consentPlan.target.chainId,
    contractAddress: consentPlan.target.contractAddress,
    rpcLabel: "linea-sepolia-fixture",
    rpcFailoverInjected: false,
  };
  const binding = {
    admissionSha256,
    runId: admission.runId,
    walletSetSha256: admission.walletSetSha256,
  };
  const admissionEvent = {
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
    timestamp: TIMESTAMP,
    transactionSent: false,
    walletClientCreated: false,
  };
  const runtimeEvent = {
    ...common,
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
      executableBytes: 960,
      executableRuntimeBytes: 960,
      immutableReferences: 2,
      manifestDigest: consentPlan.provenance.compilationManifestSha256,
      manifestMatched: true,
      normalizedRuntimeSha256: consentPlan.provenance.normalizedExecutableRuntimeSha256,
      observedBlock: OBSERVED_BLOCK,
      observedBlockHash: OBSERVED_BLOCK_HASH,
    },
    deploymentManifestSha256: consentPlan.provenance.deploymentManifestSha256,
    sourceArtifactGitSha: consentPlan.provenance.sourceArtifactGitSha,
    timestamp: TIMESTAMP,
    ...binding,
  };
  const walletEvents = consentPlan.roles.roleCaps.map((cap, index) => ({
    ...common,
    amount: "0",
    allowance: "0",
    allowanceCapWei: cap.allowanceCapWei,
    allowanceWei: "0",
    allowanceWithinRunCap: true,
    approvalTarget: canonicalTokenAmountFromWei(cap.allowanceCapWei),
    approvalRequired: true,
    enoughEth: true,
    enoughToken: true,
    mode: "preflight",
    nonceLatest: index + 7,
    noncePending: index + 7,
    ok: true,
    participant: true,
    role: cap.role,
    round: -1,
    timestamp: TIMESTAMP,
    totalAmount: canonicalTokenAmountFromWei(cap.spendCapWei),
    totalAmountWei: cap.spendCapWei,
    ...binding,
  }));
  return [admissionEvent, runtimeEvent, ...walletEvents];
}

function serializeEvents(events) {
  return `${events.map((event) => JSON.stringify(event)).join("\n")}\n`;
}

function createEnvelopeFixture() {
  const consentPlan = createConsentPlan();
  const consentPlanSha256 = canonicalJsonSha256(consentPlan);
  const runtimeEvidence = parseV10DryRunLogEvidence(
    serializeEvents(createDryRunEvents(consentPlan)),
    consentPlan,
    { expectedAdmissionRunId: AUTHORIZATION_RUN_ID },
  );
  return createV10PreviewConsentEnvelope({
    authorizationRunId: AUTHORIZATION_RUN_ID,
    repositoryState: {
      applicationGitSha: APPLICATION_GIT_SHA,
      sourceTreeClean: true,
      sourceStateSha256: SOURCE_STATE_SHA256,
    },
    consentPlan,
    consentPlanSha256,
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

test("canonical consent plan and envelope round-trip with stable digests", () => {
  const consentPlan = createConsentPlan();
  const deploymentManifest = createDeploymentManifest();
  const consentPlanSha256 = canonicalJsonSha256(consentPlan);
  const canonicalPlan = JSON.stringify(consentPlan);
  const output = [
    "[fixture] harmless preceding output",
    `[live-canary] consentPlan=${canonicalPlan} consentPlanSha256=${consentPlanSha256}`,
    "[fixture] harmless following output",
  ].join("\n");

  assert.equal(validateV10ConsentPlan(consentPlan, { deploymentManifest }), consentPlan);
  assert.deepEqual(parseV10ConsentPlanOutput(output, { deploymentManifest }), {
    consentPlan,
    consentPlanSha256,
    canonicalJson: canonicalPlan,
  });

  const envelope = createEnvelopeFixture();
  const rawEnvelope = JSON.stringify(envelope);
  assert.deepEqual(
    parseCanonicalV10PreviewConsentEnvelope(rawEnvelope, { deploymentManifest }),
    envelope,
  );
  assert.equal(validateV10PreviewConsentEnvelope(envelope, { deploymentManifest }), envelope);
  assert.equal(consentEnvelopeSha256(envelope), canonicalJsonSha256(envelope));

  const changedEnvelope = clone(envelope);
  changedEnvelope.sourceStateSha256 = "c".repeat(64);
  assert.notEqual(consentEnvelopeSha256(changedEnvelope), consentEnvelopeSha256(envelope));
});

test("consent and admission digest tampering fails closed", () => {
  const consentPlan = createConsentPlan();
  const canonicalPlan = JSON.stringify(consentPlan);
  const consentPlanSha256 = canonicalJsonSha256(consentPlan);
  assert.throws(() => parseV10ConsentPlanOutput(
    `[live-canary] consentPlan=${canonicalPlan} consentPlanSha256=${differentDigest(consentPlanSha256)}`,
  ));

  const envelope = createEnvelopeFixture();
  envelope.consentPlanSha256 = differentDigest(envelope.consentPlanSha256);
  assert.throws(() => validateV10PreviewConsentEnvelope(envelope));

  const events = createDryRunEvents(consentPlan);
  events[0].admissionSha256 = differentDigest(events[0].admissionSha256);
  assert.throws(
    () => parseV10DryRunLogEvidence(serializeEvents(events), consentPlan),
    undefined,
    "the dry-run admission digest must be recomputed rather than format-checked",
  );
});

test("generator challenge binds the dry-run admission to the consent envelope", () => {
  const consentPlan = createConsentPlan();
  const logText = serializeEvents(createDryRunEvents(consentPlan));
  const runtimeEvidence = parseV10DryRunLogEvidence(
    logText,
    consentPlan,
    { expectedAdmissionRunId: AUTHORIZATION_RUN_ID },
  );
  assert.equal(runtimeEvidence.admissionRunId, AUTHORIZATION_RUN_ID);
  assert.throws(
    () => parseV10DryRunLogEvidence(
      logText,
      consentPlan,
      { expectedAdmissionRunId: OTHER_AUTHORIZATION_RUN_ID },
    ),
    /does not match the generator challenge/,
  );

  const reboundEnvelope = createEnvelopeFixture();
  reboundEnvelope.runtimeEvidence.admissionRunId = OTHER_AUTHORIZATION_RUN_ID;
  assert.throws(
    () => validateV10PreviewConsentEnvelope(reboundEnvelope),
    /does not match its authorization run ID/,
  );
});

test("wallet preflight order is role keyed while duplicate, missing, and unknown roles fail", () => {
  const consentPlan = createConsentPlan();
  const events = createDryRunEvents(consentPlan);
  const orderedEvidence = parseV10DryRunLogEvidence(serializeEvents(events), consentPlan);
  const reordered = [events[0], events[1], events[4], events[2], events[3]];
  assert.deepEqual(parseV10DryRunLogEvidence(serializeEvents(reordered), consentPlan), orderedEvidence);

  const duplicate = clone(events);
  duplicate[4] = clone(duplicate[2]);
  assert.throws(() => parseV10DryRunLogEvidence(serializeEvents(duplicate), consentPlan));

  const missing = clone(events);
  missing.pop();
  assert.throws(() => parseV10DryRunLogEvidence(serializeEvents(missing), consentPlan));

  const unknown = clone(events);
  unknown[4].role = "RESOLVER";
  assert.throws(() => parseV10DryRunLogEvidence(serializeEvents(unknown), consentPlan));
});

test("extra keys and non-canonical JSON are rejected at every consent boundary", () => {
  const extraPlanKey = createConsentPlan();
  extraPlanKey.unexpected = true;
  assert.throws(() => validateV10ConsentPlan(extraPlanKey));

  const extraTargetKey = createConsentPlan();
  extraTargetKey.target.unexpected = true;
  assert.throws(() => validateV10ConsentPlan(extraTargetKey));

  const consentPlan = createConsentPlan();
  const canonicalPlan = JSON.stringify(consentPlan);
  const spacedPlan = canonicalPlan.replace('{"schema":1', '{"schema": 1');
  assert.throws(() => parseV10ConsentPlanOutput(
    `[live-canary] consentPlan=${spacedPlan} consentPlanSha256=${canonicalJsonSha256(consentPlan)}`,
  ));

  const extraEventKey = createDryRunEvents(consentPlan);
  extraEventKey[1].unexpected = true;
  assert.throws(
    () => parseV10DryRunLogEvidence(serializeEvents(extraEventKey), consentPlan),
    undefined,
    "dry-run events must reject fields outside their canonical schema",
  );

  const extraAdmissionKey = createDryRunEvents(consentPlan);
  extraAdmissionKey[0].admission.unexpected = true;
  assert.throws(
    () => parseV10DryRunLogEvidence(serializeEvents(extraAdmissionKey), consentPlan),
    undefined,
    "the nested admission must reject fields outside its canonical schema",
  );

  for (const unsafeRpcLabel of [
    "API_KEY=secret\nsepolia",
    "sk-sepolia",
    "provider-primary",
    "sepolia-abcdef0123456789abcdef",
  ]) {
    const unsafeRpcEvidence = createDryRunEvents(consentPlan);
    unsafeRpcEvidence[0].rpcLabel = unsafeRpcLabel;
    assert.throws(
      () => parseV10DryRunLogEvidence(serializeEvents(unsafeRpcEvidence), consentPlan),
      undefined,
      `unsafe persisted rpcLabel must fail closed: ${JSON.stringify(unsafeRpcLabel)}`,
    );
  }

  const envelope = createEnvelopeFixture();
  const extraEnvelopeKey = clone(envelope);
  extraEnvelopeKey.unexpected = true;
  assert.throws(() => validateV10PreviewConsentEnvelope(extraEnvelopeKey));

  const extraEvidenceKey = clone(envelope);
  extraEvidenceKey.runtimeEvidence.unexpected = true;
  assert.throws(() => validateV10PreviewConsentEnvelope(extraEvidenceKey));

  const rawEnvelope = JSON.stringify(envelope);
  const spacedEnvelope = rawEnvelope.replace('{"schema":1', '{"schema": 1');
  assert.throws(() => parseCanonicalV10PreviewConsentEnvelope(spacedEnvelope));
});

test("unsafe uint256 and aggregate spend mutations fail closed", () => {
  const mutations = [
    ["negative role spend", (plan) => { plan.roles.roleCaps[0].spendCapWei = "-1"; }],
    ["leading-zero role spend", (plan) => { plan.roles.roleCaps[0].spendCapWei = "0160000000000000000"; }],
    ["zero role spend", (plan) => { plan.roles.roleCaps[0].spendCapWei = "0"; }],
    ["uint256 overflow", (plan) => { plan.roles.roleCaps[0].spendCapWei = (1n << 256n).toString(); }],
    ["allowance above spend cap", (plan) => { plan.roles.roleCaps[0].allowanceCapWei = "160000000000000001"; }],
    ["aggregate spend mismatch", (plan) => { plan.valueCaps.totalSpendWei = "840000000000000001"; }],
    ["non-canonical gas decimal", (plan) => { plan.valueCaps.maxNativeGasWei = "034600000000000000"; }],
  ];
  for (const [label, mutate] of mutations) {
    const plan = createConsentPlan();
    mutate(plan);
    assert.throws(() => validateV10ConsentPlan(plan), undefined, label);
  }
});

test("unsafe transaction and gas-cap mutations fail closed", () => {
  const txMutations = [
    ["approval count does not match roles", (plan) => { plan.txCaps.approval = 2; }],
    ["bet count does not match epochs", (plan) => { plan.txCaps.bet = 11; }],
    ["resolve count does not match epochs", (plan) => { plan.txCaps.resolve = 4; }],
    ["pending replacements are authorized", (plan) => { plan.txCaps.pendingReplacement = 1; }],
    ["total omits a transaction class", (plan) => { plan.txCaps.total = 19; }],
    ["affected epoch bound is understated", (plan) => { plan.maxEpochs = 6; }],
    ["affected epoch bound exceeds the bounded matrix", (plan) => { plan.maxEpochs = 12; }],
    ["gas formula is understated", (plan) => { plan.valueCaps.maxNativeGasWei = "34600000000000000".replace("6", "5"); }],
    ["gas budget exceeds policy", (plan) => {
      plan.valueCaps.maxApprovalCostPerTxWei = "10000000000000000";
      plan.valueCaps.maxKeeperCostPerTxWei = "2000000000000000";
      plan.valueCaps.maxNativeGasWei = "64000000000000000";
    }],
  ];
  for (const [label, mutate] of txMutations) {
    const plan = createConsentPlan();
    mutate(plan);
    assert.throws(() => validateV10ConsentPlan(plan), undefined, label);
  }
});

test("unsafe stop-policy and execution-boundary mutations fail closed", () => {
  const planMutations = [
    ["more than one failure", (plan) => { plan.stopPolicy.maxFailures = 2; }],
    ["resolve stop cap mismatch", (plan) => { plan.stopPolicy.maxResolveTransactions = 4; }],
    ["safe-window timeout below policy", (plan) => { plan.stopPolicy.safeWindowTimeoutMs = 29999; }],
    ["receipt timeout below policy", (plan) => { plan.stopPolicy.transactionReceiptTimeoutMs = 999; }],
    ["live-log cap below policy", (plan) => { plan.stopPolicy.liveLogMaxBytes = 1048575; }],
    ["binding failure does not stop", (plan) => { plan.stopPolicy.stopOnBindingFailure = false; }],
    ["bet failure does not stop", (plan) => { plan.stopPolicy.stopOnBetFailure = false; }],
    ["fresh authorization is disabled", (plan) => { plan.liveExecutionRequiresFreshAuthorization = false; }],
  ];
  for (const [label, mutate] of planMutations) {
    const plan = createConsentPlan();
    mutate(plan);
    assert.throws(() => validateV10ConsentPlan(plan), undefined, label);
  }

  const dirtyEnvelope = createEnvelopeFixture();
  dirtyEnvelope.sourceTreeClean = false;
  assert.equal(validateV10PreviewConsentEnvelope(dirtyEnvelope), dirtyEnvelope);
  assert.throws(
    () => validateV10PreviewConsentEnvelope(dirtyEnvelope, { requireSourceTreeClean: true }),
    undefined,
    "a dirty Preview may be recorded but cannot satisfy the authorization-ready boundary",
  );

  const liveBoundary = createEnvelopeFixture();
  liveBoundary.operationalBoundary.execution = "live";
  assert.throws(() => validateV10PreviewConsentEnvelope(liveBoundary));

  const transactionBoundary = createEnvelopeFixture();
  transactionBoundary.operationalBoundary.transactionSent = true;
  assert.throws(() => validateV10PreviewConsentEnvelope(transactionBoundary));
});

test("canonical deployment manifest is cross-checked field by field", () => {
  const consentPlan = createConsentPlan();
  assert.equal(
    validateV10ConsentPlan(consentPlan, { deploymentManifest: createDeploymentManifest() }),
    consentPlan,
  );

  const manifestMutations = [
    ["contract address", (manifest) => { manifest.contractAddress = `0x${"d".repeat(40)}`; }],
    ["deploy block", (manifest) => { manifest.deployBlock = "31678225"; }],
    ["deployment transaction", (manifest) => { manifest.deploymentTransactionHash = `0x${"e".repeat(64)}`; }],
    ["deployment manifest digest", (manifest) => { manifest.deploymentManifestSha256 = "d".repeat(64); }],
    ["compilation manifest digest", (manifest) => { manifest.compilationManifestSha256 = "d".repeat(64); }],
    ["runtime digest", (manifest) => { manifest.normalizedExecutableRuntimeSha256 = "d".repeat(64); }],
    ["source artifact Git SHA", (manifest) => { manifest.sourceArtifactGitSha = "d".repeat(40); }],
    ["epoch-bound capability", (manifest) => { manifest.epochBoundBetsRequired = false; }],
  ];
  for (const [label, mutate] of manifestMutations) {
    const deploymentManifest = createDeploymentManifest();
    mutate(deploymentManifest);
    assert.throws(
      () => validateV10ConsentPlan(consentPlan, { deploymentManifest }),
      undefined,
      label,
    );
  }
});
