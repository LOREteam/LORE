import { createHash } from "node:crypto";

const SHA256_RE = /^[a-f0-9]{64}$/;
const GIT_SHA_RE = /^[a-f0-9]{40}$/;
const ADDRESS_RE = /^0x[a-f0-9]{40}$/;
const TX_HASH_RE = /^0x[a-f0-9]{64}$/;
const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const RUN_ID_RE = /^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/;
const UINT_RE = /^(?:0|[1-9]\d{0,77})$/;
const POSITIVE_DECIMAL_RE = /^[1-9]\d*$/;
const MAX_UINT256 = (1n << 256n) - 1n;
const MAX_NATIVE_GAS_WEI = 50_000_000_000_000_000n;
const MAX_DRY_RUN_EVIDENCE_WINDOW_MS = 10 * 60 * 1000;
const PARTICIPANT_ROLES = new Set(["MANUAL", "AUTOMINER_A", "AUTOMINER_B", "AUTOMINER_C"]);
const RPC_LABEL_RE = /^[a-z0-9]{2,24}(?:[-_.][a-z0-9]{2,24}){1,4}$/i;
const GENERIC_RPC_LABEL_RE = /^(?:configured|default|fallback|mainnet|rpc|redacted|target|unlabeled)(?:[-_ ]?rpc(?:[-_ ]?label)?(?:[-_ ]?required)?)?$/i;
const SENSITIVE_RPC_LABEL_SEGMENT_RE = /^(?:api|apikey|auth|authorization|bearer|credential|key|password|passwd|pk|private|privatekey|secret|sk|token)$/i;
const CONTEXT_RPC_LABEL_SEGMENT_RE = /^(?:dev|development|fallback|fixture|linea|local|mainnet|managed|offline|production|public|runtime|sepolia|staging|test|testnet)$/i;

const CONSENT_PLAN_KEYS = [
  "schema",
  "tranche",
  "profile",
  "target",
  "provenance",
  "walletSetSha256",
  "canaryPlanSha256",
  "roles",
  "txCaps",
  "valueCaps",
  "maxEpochs",
  "stopPolicy",
  "liveExecutionRequiresFreshAuthorization",
];

export function requireV10RedactedRpcLabel(value, label = "V10 RPC label") {
  const normalized = typeof value === "string" ? value.trim() : "";
  const segments = normalized.split(/[-_.]/);
  if (
    normalized.length < 5
    || normalized.length > 96
    || !RPC_LABEL_RE.test(normalized)
    || GENERIC_RPC_LABEL_RE.test(normalized)
    || segments.some((segment) => SENSITIVE_RPC_LABEL_SEGMENT_RE.test(segment))
    || !segments.some((segment) => CONTEXT_RPC_LABEL_SEGMENT_RE.test(segment))
    || segments.some((segment) => (
      segment.length >= 16
      && /[a-z]/i.test(segment)
      && /\d/.test(segment)
    ))
  ) {
    throw new Error(
      `${label} must be a short redacted identifier with a network or environment descriptor, not a URL, credential, or arbitrary value`,
    );
  }
  return normalized;
}

const TARGET_KEYS = [
  "network",
  "chainId",
  "contractAddress",
  "contractDeployBlock",
  "epochBoundBetsRequired",
];
const PROVENANCE_KEYS = [
  "deploymentTransactionHash",
  "deploymentManifestSha256",
  "compilationManifestSha256",
  "normalizedExecutableRuntimeSha256",
  "sourceArtifactGitSha",
  "canonicalDeploymentManifestVerified",
];
const ROLES_KEYS = ["selectedRoles", "resolverCandidateRoles", "roleCaps"];
const ROLE_CAP_KEYS = ["role", "spendCapWei", "allowanceCapWei"];
const TX_CAP_KEYS = ["approval", "bet", "resolve", "pendingReplacement", "total"];
const VALUE_CAP_KEYS = [
  "totalSpendWei",
  "maxApprovalCostPerTxWei",
  "maxKeeperCostPerTxWei",
  "maxNativeGasWei",
];
const STOP_POLICY_KEYS = [
  "maxFailures",
  "maxResolveTransactions",
  "safeWindowTimeoutMs",
  "transactionReceiptTimeoutMs",
  "liveLogMaxBytes",
  "stopOnBindingFailure",
  "stopOnPreflightFailure",
  "stopOnPendingNonce",
  "stopOnBetFailure",
  "stopOnRepeatFailure",
  "stopOnResolveFailure",
  "stopOnSafeWindowTimeout",
];
const CONSENT_ENVELOPE_KEYS = [
  "schema",
  "authorizationRunId",
  "applicationGitSha",
  "sourceTreeClean",
  "sourceStateSha256",
  "consentPlan",
  "consentPlanSha256",
  "runtimeEvidence",
  "operationalBoundary",
];
const RUNTIME_EVIDENCE_KEYS = [
  "admissionRunId",
  "admissionSha256",
  "canonicalProvenanceVerified",
  "observedBlock",
  "observedBlockHash",
  "runtimeSha256",
  "compilationManifestSha256",
  "deploymentManifestSha256",
  "sourceArtifactGitSha",
  "evidenceStartedAt",
  "evidenceCompletedAt",
];
const OPERATIONAL_BOUNDARY_KEYS = [
  "execution",
  "transactionSent",
  "signingMaterialLoaded",
  "walletClientCreated",
  "contractWriteSubmitted",
];
const ADMISSION_KEYS = [
  "schema",
  "runId",
  "execution",
  "profile",
  "network",
  "chainId",
  "contractAddress",
  "contractDeployBlock",
  "runtimeSha256",
  "manifestSha256",
  "deploymentManifestSha256",
  "sourceArtifactGitSha",
  "canonicalProvenanceVerified",
  "previewSha256",
  "walletSetSha256",
  "canaryPlanSha256",
  "selectedRoles",
  "roleCaps",
];
const ADMISSION_EVENT_KEYS = [
  "network",
  "chainId",
  "contractAddress",
  "rpcLabel",
  "rpcFailoverInjected",
  "admission",
  "admissionSha256",
  "amount",
  "mode",
  "ok",
  "role",
  "round",
  "signatureRequested",
  "signingMaterialLoaded",
  "timestamp",
  "transactionSent",
  "walletClientCreated",
];
const RUNTIME_IDENTITY_KEYS = [
  "canonicalProvenanceVerified",
  "chainId",
  "contractAddress",
  "deployBlock",
  "executableBytes",
  "executableRuntimeBytes",
  "immutableReferences",
  "manifestMatched",
  "manifestDigest",
  "normalizedRuntimeSha256",
  "observedBlock",
  "observedBlockHash",
];
const RUNTIME_EVENT_KEYS = [
  "network",
  "chainId",
  "contractAddress",
  "rpcLabel",
  "rpcFailoverInjected",
  "amount",
  "mode",
  "ok",
  "role",
  "round",
  "runtimeIdentity",
  "deploymentManifestSha256",
  "sourceArtifactGitSha",
  "timestamp",
  "admissionSha256",
  "runId",
  "walletSetSha256",
];
const WALLET_PREFLIGHT_EVENT_KEYS = [
  "network",
  "chainId",
  "contractAddress",
  "rpcLabel",
  "rpcFailoverInjected",
  "amount",
  "allowance",
  "allowanceCapWei",
  "allowanceWei",
  "allowanceWithinRunCap",
  "approvalTarget",
  "approvalRequired",
  "enoughEth",
  "enoughToken",
  "mode",
  "nonceLatest",
  "noncePending",
  "ok",
  "participant",
  "role",
  "round",
  "timestamp",
  "totalAmount",
  "totalAmountWei",
  "admissionSha256",
  "runId",
  "walletSetSha256",
];

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function requireExactKeys(value, keys, label) {
  if (!isPlainObject(value) || JSON.stringify(Object.keys(value)) !== JSON.stringify(keys)) {
    throw new Error(`${label} has an unexpected schema`);
  }
}

function requireExactKeySet(value, keys, label) {
  const expected = [...keys].sort();
  const actual = isPlainObject(value) ? Object.keys(value).sort() : [];
  if (!isPlainObject(value) || JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label} has an unexpected schema`);
  }
}

function requireCanonicalTimestamp(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new Error(`${label} must be a canonical UTC timestamp`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(`${label} must be a canonical UTC timestamp`);
  }
}

function requireCanonicalDryRunEventTarget(event, consentPlan, label) {
  if (
    event.network !== consentPlan.target.network
    || event.chainId !== consentPlan.target.chainId
    || event.contractAddress !== consentPlan.target.contractAddress
    || typeof event.rpcFailoverInjected !== "boolean"
    || event.amount !== "0"
  ) {
    throw new Error(`${label} target metadata is invalid`);
  }
  requireV10RedactedRpcLabel(event.rpcLabel, `${label} rpcLabel`);
  requireCanonicalTimestamp(event.timestamp, `${label} timestamp`);
}

function requireSha256(value, label) {
  if (typeof value !== "string" || !SHA256_RE.test(value)) {
    throw new Error(`${label} must be a canonical SHA-256 digest`);
  }
  return value;
}

function requireGitSha(value, label) {
  if (typeof value !== "string" || !GIT_SHA_RE.test(value)) {
    throw new Error(`${label} must be a canonical Git SHA`);
  }
  return value;
}

function requireUint(value, label, { positive = false } = {}) {
  if (typeof value !== "string" || !UINT_RE.test(value)) {
    throw new Error(`${label} must be a canonical uint256 decimal string`);
  }
  const parsed = BigInt(value);
  if (parsed > MAX_UINT256 || (positive && parsed === 0n)) {
    throw new Error(`${label} is outside its uint256 policy bound`);
  }
  return parsed;
}

function requireSafeInteger(value, label, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${label} must be an integer in [${min}, ${max}]`);
  }
  return value;
}

function requireTrue(value, label) {
  if (value !== true) throw new Error(`${label} must be true`);
}

function requireSortedUniqueRoles(value, label) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) {
    throw new Error(`${label} must contain one to four participant roles`);
  }
  const roles = value.map((role) => String(role ?? ""));
  if (roles.some((role) => !PARTICIPANT_ROLES.has(role))) {
    throw new Error(`${label} contains an unsupported participant role`);
  }
  const sorted = [...roles].sort();
  if (new Set(roles).size !== roles.length || JSON.stringify(roles) !== JSON.stringify(sorted)) {
    throw new Error(`${label} must be sorted and unique`);
  }
  return roles;
}

export function canonicalJsonSha256(value) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

export function validateV10ConsentPlan(plan, { deploymentManifest } = {}) {
  requireExactKeys(plan, CONSENT_PLAN_KEYS, "V10 consent plan");
  if (plan.schema !== 1 || plan.tranche !== "v10-matrix" || plan.profile !== "v10-matrix") {
    throw new Error("V10 consent plan identity is invalid");
  }

  requireExactKeys(plan.target, TARGET_KEYS, "V10 consent target");
  if (
    plan.target.network !== "sepolia"
    || plan.target.chainId !== 59141
    || !ADDRESS_RE.test(plan.target.contractAddress)
    || !POSITIVE_DECIMAL_RE.test(plan.target.contractDeployBlock)
    || plan.target.epochBoundBetsRequired !== true
  ) {
    throw new Error("V10 consent target is invalid");
  }

  requireExactKeys(plan.provenance, PROVENANCE_KEYS, "V10 consent provenance");
  if (!TX_HASH_RE.test(plan.provenance.deploymentTransactionHash)) {
    throw new Error("V10 consent deployment transaction hash is invalid");
  }
  requireSha256(plan.provenance.deploymentManifestSha256, "V10 consent deploymentManifestSha256");
  requireSha256(plan.provenance.compilationManifestSha256, "V10 consent compilationManifestSha256");
  requireSha256(plan.provenance.normalizedExecutableRuntimeSha256, "V10 consent normalizedExecutableRuntimeSha256");
  requireGitSha(plan.provenance.sourceArtifactGitSha, "V10 consent sourceArtifactGitSha");
  requireTrue(plan.provenance.canonicalDeploymentManifestVerified, "V10 consent canonicalDeploymentManifestVerified");
  requireSha256(plan.walletSetSha256, "V10 consent walletSetSha256");
  requireSha256(plan.canaryPlanSha256, "V10 consent canaryPlanSha256");

  requireExactKeys(plan.roles, ROLES_KEYS, "V10 consent roles");
  const selectedRoles = requireSortedUniqueRoles(plan.roles.selectedRoles, "V10 consent selectedRoles");
  const expectedResolverCandidates = ["RESOLVER", ...selectedRoles];
  if (JSON.stringify(plan.roles.resolverCandidateRoles) !== JSON.stringify(expectedResolverCandidates)) {
    throw new Error("V10 consent resolverCandidateRoles must contain RESOLVER followed by every selected role");
  }
  if (!Array.isArray(plan.roles.roleCaps) || plan.roles.roleCaps.length !== selectedRoles.length) {
    throw new Error("V10 consent roleCaps must match selectedRoles");
  }
  let totalSpendWei = 0n;
  for (let index = 0; index < plan.roles.roleCaps.length; index += 1) {
    const cap = plan.roles.roleCaps[index];
    requireExactKeys(cap, ROLE_CAP_KEYS, `V10 consent roleCaps[${index}]`);
    if (cap.role !== selectedRoles[index]) throw new Error("V10 consent roleCaps must follow selectedRoles order");
    const spendCapWei = requireUint(cap.spendCapWei, `V10 consent ${cap.role} spendCapWei`, { positive: true });
    const allowanceCapWei = requireUint(cap.allowanceCapWei, `V10 consent ${cap.role} allowanceCapWei`, { positive: true });
    if (spendCapWei !== allowanceCapWei) throw new Error("V10 consent allowance cap must equal its spend cap");
    totalSpendWei += spendCapWei;
  }

  requireExactKeys(plan.txCaps, TX_CAP_KEYS, "V10 consent txCaps");
  const approval = requireSafeInteger(plan.txCaps.approval, "V10 consent approval tx cap", 1, 4);
  const bet = requireSafeInteger(plan.txCaps.bet, "V10 consent bet tx cap", 1, 12);
  const resolve = requireSafeInteger(plan.txCaps.resolve, "V10 consent resolve tx cap", 0, 5);
  const pendingReplacement = requireSafeInteger(
    plan.txCaps.pendingReplacement,
    "V10 consent pending replacement tx cap",
    0,
    0,
  );
  const total = requireSafeInteger(plan.txCaps.total, "V10 consent total tx cap", 1, 21);
  const maxEpochs = requireSafeInteger(plan.maxEpochs, "V10 consent maxEpochs", 1, 11);
  const betEpochs = bet / 2;
  if (
    approval !== selectedRoles.length
    || !Number.isInteger(betEpochs)
    || betEpochs < 1
    || betEpochs > 6
    || resolve !== betEpochs - 1
    || maxEpochs !== betEpochs + resolve
    || total !== approval + bet + resolve + pendingReplacement
  ) {
    throw new Error("V10 consent transaction caps are internally inconsistent");
  }

  requireExactKeys(plan.valueCaps, VALUE_CAP_KEYS, "V10 consent valueCaps");
  const declaredTotalSpendWei = requireUint(plan.valueCaps.totalSpendWei, "V10 consent totalSpendWei", { positive: true });
  const approvalCost = requireUint(
    plan.valueCaps.maxApprovalCostPerTxWei,
    "V10 consent maxApprovalCostPerTxWei",
    { positive: true },
  );
  const keeperCost = requireUint(
    plan.valueCaps.maxKeeperCostPerTxWei,
    "V10 consent maxKeeperCostPerTxWei",
    { positive: true },
  );
  const nativeGas = requireUint(plan.valueCaps.maxNativeGasWei, "V10 consent maxNativeGasWei", { positive: true });
  const calculatedNativeGas = BigInt(approval) * approvalCost
    + BigInt(bet + resolve + pendingReplacement) * keeperCost;
  if (declaredTotalSpendWei !== totalSpendWei) throw new Error("V10 consent totalSpendWei does not equal role cap sum");
  if (nativeGas !== calculatedNativeGas || nativeGas > MAX_NATIVE_GAS_WEI) {
    throw new Error("V10 consent native gas budget is inconsistent or exceeds policy");
  }

  requireExactKeys(plan.stopPolicy, STOP_POLICY_KEYS, "V10 consent stopPolicy");
  if (
    plan.stopPolicy.maxFailures !== 1
    || plan.stopPolicy.maxResolveTransactions !== resolve
    || !Number.isSafeInteger(plan.stopPolicy.safeWindowTimeoutMs)
    || plan.stopPolicy.safeWindowTimeoutMs < 30_000
    || plan.stopPolicy.safeWindowTimeoutMs > 3_600_000
    || !Number.isSafeInteger(plan.stopPolicy.transactionReceiptTimeoutMs)
    || plan.stopPolicy.transactionReceiptTimeoutMs < 1_000
    || plan.stopPolicy.transactionReceiptTimeoutMs > 3_600_000
    || !Number.isSafeInteger(plan.stopPolicy.liveLogMaxBytes)
    || plan.stopPolicy.liveLogMaxBytes < 1024 * 1024
    || plan.stopPolicy.liveLogMaxBytes > 64 * 1024 * 1024
  ) {
    throw new Error("V10 consent stop-policy limits are invalid");
  }
  for (const key of STOP_POLICY_KEYS.filter((key) => key.startsWith("stopOn"))) {
    requireTrue(plan.stopPolicy[key], `V10 consent stopPolicy.${key}`);
  }
  requireTrue(
    plan.liveExecutionRequiresFreshAuthorization,
    "V10 consent liveExecutionRequiresFreshAuthorization",
  );

  if (deploymentManifest) {
    if (
      plan.target.contractAddress !== deploymentManifest.contractAddress
      || plan.target.contractDeployBlock !== deploymentManifest.deployBlock
      || plan.provenance.deploymentTransactionHash !== deploymentManifest.deploymentTransactionHash
      || plan.provenance.deploymentManifestSha256 !== deploymentManifest.deploymentManifestSha256
      || plan.provenance.compilationManifestSha256 !== deploymentManifest.compilationManifestSha256
      || plan.provenance.normalizedExecutableRuntimeSha256 !== deploymentManifest.normalizedExecutableRuntimeSha256
      || plan.provenance.sourceArtifactGitSha !== deploymentManifest.sourceArtifactGitSha
      || deploymentManifest.epochBoundBetsRequired !== true
    ) {
      throw new Error("V10 consent plan does not match the canonical deployment manifest");
    }
  }
  return plan;
}

export function parseV10ConsentPlanOutput(output, options = {}) {
  const lines = String(output ?? "").split(/\r?\n/).filter(Boolean);
  const prefix = "[live-canary] consentPlan=";
  const matches = lines.filter((line) => line.startsWith(prefix));
  if (matches.length !== 1) throw new Error("V10 matrix must emit exactly one consent plan");
  const match = /^\[live-canary\] consentPlan=(\{.*\}) consentPlanSha256=([a-f0-9]{64})$/.exec(matches[0]);
  if (!match) throw new Error("V10 matrix consent plan line is malformed");
  let consentPlan;
  try {
    consentPlan = JSON.parse(match[1]);
  } catch {
    throw new Error("V10 matrix consent plan is invalid JSON");
  }
  validateV10ConsentPlan(consentPlan, options);
  const canonicalJson = JSON.stringify(consentPlan);
  if (canonicalJson !== match[1]) throw new Error("V10 matrix consent plan JSON is not canonical");
  const consentPlanSha256 = canonicalJsonSha256(consentPlan);
  if (consentPlanSha256 !== match[2]) throw new Error("V10 matrix consent plan digest does not match its JSON");
  return { consentPlan, consentPlanSha256, canonicalJson };
}

function requireCanonicalAdmissionRoleCaps(admission, selectedRoles) {
  if (!Array.isArray(admission.roleCaps) || admission.roleCaps.length !== selectedRoles.length) {
    throw new Error("V10 dry-run admission role caps are invalid");
  }
  return admission.roleCaps.map((cap, index) => {
    requireExactKeys(cap, ROLE_CAP_KEYS, `V10 dry-run admission roleCaps[${index}]`);
    if (cap.role !== selectedRoles[index]) throw new Error("V10 dry-run admission role caps are not canonical");
    requireUint(cap.spendCapWei, `V10 dry-run admission ${cap.role} spendCapWei`, { positive: true });
    requireUint(cap.allowanceCapWei, `V10 dry-run admission ${cap.role} allowanceCapWei`, { positive: true });
    if (cap.spendCapWei !== cap.allowanceCapWei) throw new Error("V10 dry-run admission allowance cap mismatch");
    return cap;
  });
}

function canonicalDryRunAdmissionPayload(admission) {
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

function canonicalTokenAmountFromWei(value) {
  const scale = 1_000_000_000_000_000_000n;
  const whole = value / scale;
  const fraction = value % scale;
  if (fraction === 0n) return whole.toString();
  return `${whole}.${fraction.toString().padStart(18, "0").replace(/0+$/, "")}`;
}

export function parseV10DryRunLogEvidence(logText, consentPlan, { expectedAdmissionRunId } = {}) {
  validateV10ConsentPlan(consentPlan);
  if (
    expectedAdmissionRunId !== undefined
    && (typeof expectedAdmissionRunId !== "string" || !UUID_RE.test(expectedAdmissionRunId))
  ) {
    throw new Error("V10 dry-run expected admission run ID must be a canonical UUID");
  }
  const lines = String(logText ?? "").split(/\r?\n/).filter((line) => line.length > 0);
  const expectedEventCount = consentPlan.roles.selectedRoles.length + 2;
  if (lines.length !== expectedEventCount) {
    throw new Error(`V10 dry-run log must contain exactly ${expectedEventCount} canonical events`);
  }
  const events = lines.map((line, index) => {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      throw new Error(`V10 dry-run log line ${index + 1} is invalid JSON`);
    }
    if (!isPlainObject(event) || JSON.stringify(event) !== line) {
      throw new Error(`V10 dry-run log line ${index + 1} is not a canonical JSON object`);
    }
    return event;
  });
  const evidenceTimes = events.map((event, index) => {
    requireCanonicalTimestamp(event.timestamp, `V10 dry-run log line ${index + 1} timestamp`);
    return Date.parse(event.timestamp);
  });
  for (let index = 1; index < evidenceTimes.length; index += 1) {
    if (evidenceTimes[index] < evidenceTimes[index - 1]) {
      throw new Error("V10 dry-run evidence timestamps must be monotonic");
    }
  }
  if (evidenceTimes.at(-1) - evidenceTimes[0] > MAX_DRY_RUN_EVIDENCE_WINDOW_MS) {
    throw new Error("V10 dry-run evidence window exceeds its bounded duration");
  }

  const admissionEvent = events[0];
  const admission = admissionEvent.admission;
  requireExactKeySet(admissionEvent, ADMISSION_EVENT_KEYS, "V10 dry-run admission event");
  requireCanonicalDryRunEventTarget(admissionEvent, consentPlan, "V10 dry-run admission event");
  requireExactKeySet(admission, ADMISSION_KEYS, "V10 dry-run admission");
  if (
    admissionEvent.mode !== "admission"
    || admissionEvent.role !== "SYSTEM"
    || admissionEvent.round !== -1
    || admissionEvent.ok !== true
    || admissionEvent.signatureRequested !== false
    || admissionEvent.signingMaterialLoaded !== false
    || admissionEvent.transactionSent !== false
    || admissionEvent.walletClientCreated !== false
    || !isPlainObject(admission)
    || admission.schema !== 2
    || admission.execution !== "dry-run"
    || admission.profile !== "v10-matrix"
    || typeof admission.runId !== "string"
    || !RUN_ID_RE.test(admission.runId)
    || admission.previewSha256 !== null
    || !SHA256_RE.test(admissionEvent.admissionSha256)
  ) {
    throw new Error("V10 dry-run admission event is invalid");
  }
  if (expectedAdmissionRunId !== undefined && admission.runId !== expectedAdmissionRunId) {
    throw new Error("V10 dry-run admission run ID does not match the generator challenge");
  }
  const selectedRoles = requireSortedUniqueRoles(admission.selectedRoles, "V10 dry-run admission selectedRoles");
  const admissionRoleCaps = requireCanonicalAdmissionRoleCaps(admission, selectedRoles);
  if (
    admission.network !== consentPlan.target.network
    || admission.chainId !== consentPlan.target.chainId
    || admission.contractAddress !== consentPlan.target.contractAddress
    || admission.contractDeployBlock !== consentPlan.target.contractDeployBlock
    || admission.runtimeSha256 !== consentPlan.provenance.normalizedExecutableRuntimeSha256
    || admission.manifestSha256 !== consentPlan.provenance.compilationManifestSha256
    || admission.deploymentManifestSha256 !== consentPlan.provenance.deploymentManifestSha256
    || admission.sourceArtifactGitSha !== consentPlan.provenance.sourceArtifactGitSha
    || admission.canonicalProvenanceVerified !== true
    || admission.walletSetSha256 !== consentPlan.walletSetSha256
    || admission.canaryPlanSha256 !== consentPlan.canaryPlanSha256
    || JSON.stringify(selectedRoles) !== JSON.stringify(consentPlan.roles.selectedRoles)
    || JSON.stringify(admissionRoleCaps) !== JSON.stringify(consentPlan.roles.roleCaps)
  ) {
    throw new Error("V10 dry-run admission does not match the consent plan");
  }
  const calculatedAdmissionSha256 = canonicalJsonSha256(canonicalDryRunAdmissionPayload(admission));
  if (admissionEvent.admissionSha256 !== calculatedAdmissionSha256) {
    throw new Error("V10 dry-run admission digest does not match its canonical payload");
  }

  const runtimeEvent = events[1];
  const runtime = runtimeEvent.runtimeIdentity;
  requireExactKeySet(runtimeEvent, RUNTIME_EVENT_KEYS, "V10 dry-run runtime event");
  requireCanonicalDryRunEventTarget(runtimeEvent, consentPlan, "V10 dry-run runtime event");
  requireExactKeySet(runtime, RUNTIME_IDENTITY_KEYS, "V10 dry-run runtime identity");
  if (
    runtimeEvent.mode !== "preflight"
    || runtimeEvent.role !== "SYSTEM"
    || runtimeEvent.round !== -1
    || runtimeEvent.ok !== true
    || !isPlainObject(runtime)
    || runtime.canonicalProvenanceVerified !== true
    || runtime.chainId !== consentPlan.target.chainId
    || runtime.contractAddress !== consentPlan.target.contractAddress
    || runtime.deployBlock !== consentPlan.target.contractDeployBlock
    || !Number.isSafeInteger(runtime.executableBytes)
    || runtime.executableBytes <= 0
    || !Number.isSafeInteger(runtime.executableRuntimeBytes)
    || runtime.executableRuntimeBytes !== runtime.executableBytes
    || !Number.isSafeInteger(runtime.immutableReferences)
    || runtime.immutableReferences < 1
    || runtime.manifestMatched !== true
    || runtime.manifestDigest !== consentPlan.provenance.compilationManifestSha256
    || runtime.normalizedRuntimeSha256 !== consentPlan.provenance.normalizedExecutableRuntimeSha256
    || !POSITIVE_DECIMAL_RE.test(runtime.observedBlock)
    || BigInt(runtime.observedBlock) < BigInt(consentPlan.target.contractDeployBlock)
    || !TX_HASH_RE.test(runtime.observedBlockHash)
    || runtimeEvent.deploymentManifestSha256 !== consentPlan.provenance.deploymentManifestSha256
    || runtimeEvent.sourceArtifactGitSha !== consentPlan.provenance.sourceArtifactGitSha
    || runtimeEvent.admissionSha256 !== calculatedAdmissionSha256
    || runtimeEvent.runId !== admission.runId
    || runtimeEvent.walletSetSha256 !== admission.walletSetSha256
  ) {
    throw new Error("V10 dry-run runtime evidence does not match the consent plan");
  }

  const walletEvents = events.slice(2);
  const walletEventsByRole = new Map();
  for (const event of walletEvents) {
    requireExactKeySet(event, WALLET_PREFLIGHT_EVENT_KEYS, "V10 dry-run wallet preflight event");
    requireCanonicalDryRunEventTarget(event, consentPlan, "V10 dry-run wallet preflight event");
    if (
      typeof event.role !== "string"
      || !selectedRoles.includes(event.role)
      || walletEventsByRole.has(event.role)
    ) {
      throw new Error("V10 dry-run wallet preflights must contain each consent role exactly once");
    }
    walletEventsByRole.set(event.role, event);
  }
  for (let index = 0; index < selectedRoles.length; index += 1) {
    const role = selectedRoles[index];
    const event = walletEventsByRole.get(role);
    const cap = admissionRoleCaps[index];
    const allowanceWei = requireUint(event.allowanceWei, `V10 dry-run ${role} allowanceWei`);
    const allowanceCapWei = requireUint(event.allowanceCapWei, `V10 dry-run ${role} allowanceCapWei`, { positive: true });
    const spendCapWei = requireUint(event.totalAmountWei, `V10 dry-run ${role} totalAmountWei`, { positive: true });
    if (
      event.mode !== "preflight"
      || event.role !== role
      || event.round !== -1
      || event.ok !== true
      || event.participant !== true
      || event.enoughEth !== true
      || event.enoughToken !== true
      || event.allowanceWithinRunCap !== true
      || typeof event.approvalRequired !== "boolean"
      || event.totalAmountWei !== cap.spendCapWei
      || event.allowanceCapWei !== cap.allowanceCapWei
      || allowanceWei > allowanceCapWei
      || spendCapWei !== allowanceCapWei
      || event.allowance !== canonicalTokenAmountFromWei(allowanceWei)
      || event.approvalTarget !== canonicalTokenAmountFromWei(allowanceCapWei)
      || event.totalAmount !== canonicalTokenAmountFromWei(spendCapWei)
      || !Number.isSafeInteger(event.nonceLatest)
      || event.nonceLatest < 0
      || event.noncePending !== event.nonceLatest
      || event.admissionSha256 !== calculatedAdmissionSha256
      || event.runId !== admission.runId
      || event.walletSetSha256 !== admission.walletSetSha256
    ) {
      throw new Error(`V10 dry-run wallet preflight does not match consent role ${role}`);
    }
  }

  return {
    admissionRunId: admission.runId,
    admissionSha256: admissionEvent.admissionSha256,
    canonicalProvenanceVerified: true,
    observedBlock: runtime.observedBlock,
    observedBlockHash: runtime.observedBlockHash.toLowerCase(),
    runtimeSha256: runtime.normalizedRuntimeSha256,
    compilationManifestSha256: runtime.manifestDigest,
    deploymentManifestSha256: runtimeEvent.deploymentManifestSha256,
    sourceArtifactGitSha: runtimeEvent.sourceArtifactGitSha,
    evidenceStartedAt: events[0].timestamp,
    evidenceCompletedAt: events.at(-1).timestamp,
  };
}

export function createV10PreviewConsentEnvelope({
  authorizationRunId,
  repositoryState,
  consentPlan,
  consentPlanSha256,
  runtimeEvidence,
  operationalBoundary,
}) {
  const envelope = {
    schema: 1,
    authorizationRunId,
    applicationGitSha: repositoryState.applicationGitSha,
    sourceTreeClean: repositoryState.sourceTreeClean,
    sourceStateSha256: repositoryState.sourceStateSha256,
    consentPlan,
    consentPlanSha256,
    runtimeEvidence,
    operationalBoundary,
  };
  return validateV10PreviewConsentEnvelope(envelope);
}

export function validateV10PreviewConsentEnvelope(envelope, options = {}) {
  requireExactKeys(envelope, CONSENT_ENVELOPE_KEYS, "V10 Preview consent envelope");
  if (envelope.schema !== 1 || typeof envelope.authorizationRunId !== "string" || !UUID_RE.test(envelope.authorizationRunId)) {
    throw new Error("V10 Preview authorization run ID is invalid");
  }
  requireGitSha(envelope.applicationGitSha, "V10 Preview applicationGitSha");
  if (typeof envelope.sourceTreeClean !== "boolean") throw new Error("V10 Preview sourceTreeClean must be boolean");
  if (options.requireSourceTreeClean === true && envelope.sourceTreeClean !== true) {
    throw new Error("V10 Preview source tree must be clean for authorization");
  }
  requireSha256(envelope.sourceStateSha256, "V10 Preview sourceStateSha256");
  validateV10ConsentPlan(envelope.consentPlan, options);
  requireSha256(envelope.consentPlanSha256, "V10 Preview consentPlanSha256");
  if (canonicalJsonSha256(envelope.consentPlan) !== envelope.consentPlanSha256) {
    throw new Error("V10 Preview consentPlanSha256 does not match consentPlan");
  }
  requireExactKeys(envelope.runtimeEvidence, RUNTIME_EVIDENCE_KEYS, "V10 Preview runtimeEvidence");
  if (
    typeof envelope.runtimeEvidence.admissionRunId !== "string"
    || !RUN_ID_RE.test(envelope.runtimeEvidence.admissionRunId)
    || envelope.runtimeEvidence.admissionRunId !== envelope.authorizationRunId
  ) {
    throw new Error("V10 Preview admission run ID does not match its authorization run ID");
  }
  requireSha256(envelope.runtimeEvidence.admissionSha256, "V10 Preview admissionSha256");
  requireTrue(envelope.runtimeEvidence.canonicalProvenanceVerified, "V10 Preview canonicalProvenanceVerified");
  if (!POSITIVE_DECIMAL_RE.test(envelope.runtimeEvidence.observedBlock)) {
    throw new Error("V10 Preview observedBlock is invalid");
  }
  if (
    BigInt(envelope.runtimeEvidence.observedBlock) < BigInt(envelope.consentPlan.target.contractDeployBlock)
    || !TX_HASH_RE.test(envelope.runtimeEvidence.observedBlockHash)
  ) {
    throw new Error("V10 Preview observed runtime block is invalid");
  }
  requireSha256(envelope.runtimeEvidence.runtimeSha256, "V10 Preview runtimeSha256");
  requireSha256(envelope.runtimeEvidence.compilationManifestSha256, "V10 Preview compilationManifestSha256");
  requireSha256(envelope.runtimeEvidence.deploymentManifestSha256, "V10 Preview deploymentManifestSha256");
  requireGitSha(envelope.runtimeEvidence.sourceArtifactGitSha, "V10 Preview sourceArtifactGitSha");
  requireCanonicalTimestamp(envelope.runtimeEvidence.evidenceStartedAt, "V10 Preview evidenceStartedAt");
  requireCanonicalTimestamp(envelope.runtimeEvidence.evidenceCompletedAt, "V10 Preview evidenceCompletedAt");
  const evidenceStartedMs = Date.parse(envelope.runtimeEvidence.evidenceStartedAt);
  const evidenceCompletedMs = Date.parse(envelope.runtimeEvidence.evidenceCompletedAt);
  if (
    evidenceCompletedMs < evidenceStartedMs
    || evidenceCompletedMs - evidenceStartedMs > MAX_DRY_RUN_EVIDENCE_WINDOW_MS
  ) {
    throw new Error("V10 Preview runtime evidence time window is invalid");
  }
  if (
    envelope.runtimeEvidence.runtimeSha256 !== envelope.consentPlan.provenance.normalizedExecutableRuntimeSha256
    || envelope.runtimeEvidence.compilationManifestSha256 !== envelope.consentPlan.provenance.compilationManifestSha256
    || envelope.runtimeEvidence.deploymentManifestSha256 !== envelope.consentPlan.provenance.deploymentManifestSha256
    || envelope.runtimeEvidence.sourceArtifactGitSha !== envelope.consentPlan.provenance.sourceArtifactGitSha
  ) {
    throw new Error("V10 Preview runtime evidence does not match consent provenance");
  }
  requireExactKeys(envelope.operationalBoundary, OPERATIONAL_BOUNDARY_KEYS, "V10 Preview operationalBoundary");
  if (
    envelope.operationalBoundary.execution !== "dry-run"
    || envelope.operationalBoundary.transactionSent !== false
    || envelope.operationalBoundary.signingMaterialLoaded !== false
    || envelope.operationalBoundary.walletClientCreated !== false
    || envelope.operationalBoundary.contractWriteSubmitted !== false
  ) {
    throw new Error("V10 Preview operational boundary is invalid");
  }
  return envelope;
}

export function parseCanonicalV10PreviewConsentEnvelope(raw, options = {}) {
  const source = String(raw ?? "");
  let envelope;
  try {
    envelope = JSON.parse(source);
  } catch {
    throw new Error("V10 Preview consent envelope is invalid JSON");
  }
  validateV10PreviewConsentEnvelope(envelope, options);
  if (JSON.stringify(envelope) !== source) {
    throw new Error("V10 Preview consent envelope JSON is not canonical");
  }
  return envelope;
}

export function consentEnvelopeSha256(envelope) {
  validateV10PreviewConsentEnvelope(envelope);
  return canonicalJsonSha256(envelope);
}
