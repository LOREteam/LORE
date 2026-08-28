import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(SCRIPT_DIR, "..");
const LIVE_CANARY_SCRIPT = path.join(SCRIPT_DIR, "live-round-canary.ts");
const TSX_CLI = createRequire(import.meta.url).resolve("tsx/cli");
const SIGNING_ENV_NAME_RE = /(?:^|_)(?:PRIVATE_KEY|MNEMONIC|SEED(?:_PHRASE)?|SIGNING_KEY)(?:_|$)/i;
const CONTROLLED_CANARY_ENV_NAME_RE = /^(?:LIVE_TEST_|LIVE_CANARY_|LINEA_(?:CHAIN_ID|NETWORK)$|NEXT_PUBLIC_(?:LINEA_|CONTRACT_))/i;
const FETCH_GUARD = `data:text/javascript,${encodeURIComponent(
  'globalThis.fetch=async()=>{throw new Error("NETWORK_CALL_FORBIDDEN")}',
)}`;

function sanitizedInspectionEnvironment() {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => (
      !SIGNING_ENV_NAME_RE.test(name) && !CONTROLLED_CANARY_ENV_NAME_RE.test(name)
    )),
  );
  return {
    ...inherited,
    HEALTH_DIAGNOSTICS_SECRET: "",
    LINEA_CHAIN_ID: "59141",
    LINEA_NETWORK: "sepolia",
    LIVE_CANARY_RPC_LABEL: "offline-runtime-enforcement-inspection",
    LIVE_TEST_APPROVE_AMOUNT: "",
    LIVE_TEST_EXECUTE: "0",
    LIVE_TEST_HEALTH_BASE_URL: "",
    LIVE_TEST_ROLES: "MANUAL,AUTOMINER_A,AUTOMINER_B",
    NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS: "1",
    NEXT_PUBLIC_LINEA_CHAIN_ID: "59141",
    NEXT_PUBLIC_LINEA_NETWORK: "sepolia",
    NODE_OPTIONS: "",
  };
}

function runInspection(extraEnvironment = {}) {
  return spawnSync(
    process.execPath,
    [
      `--import=${FETCH_GUARD}`,
      TSX_CLI,
      LIVE_CANARY_SCRIPT,
      "--v10-matrix-only",
      "--inspect-runtime-enforcement",
    ],
    {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
      env: { ...sanitizedInspectionEnvironment(), ...extraEnvironment },
      maxBuffer: 1024 * 1024,
      timeout: 20_000,
      windowsHide: true,
    },
  );
}

function runEpochBoundGuardInspection(extraEnvironment = {}) {
  return spawnSync(
    process.execPath,
    [
      `--import=${FETCH_GUARD}`,
      TSX_CLI,
      LIVE_CANARY_SCRIPT,
      "--require-epoch-bound",
      "--inspect-runtime-enforcement",
    ],
    {
      cwd: REPOSITORY_ROOT,
      encoding: "utf8",
      env: { ...sanitizedInspectionEnvironment(), ...extraEnvironment },
      maxBuffer: 1024 * 1024,
      timeout: 20_000,
      windowsHide: true,
    },
  );
}

function sourceSection(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(start >= 0, `missing source marker: ${startMarker}`);
  assert.ok(end > start, `missing source marker after ${startMarker}: ${endMarker}`);
  return source.slice(start, end);
}

function assertSourceOrder(label, source, markers) {
  let cursor = -1;
  for (const marker of markers) {
    const index = source.indexOf(marker, cursor + 1);
    assert.ok(index > cursor, `${label}: missing or out-of-order source marker: ${marker}`);
    cursor = index;
  }
}

test("offline V10 runtime enforcement inspection proves bounded behavior without side effects", () => {
  const result = runInspection();
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.signal, null, output);
  assert.equal(result.status, 0, output);
  assert.doesNotMatch(output, /NETWORK_CALL_FORBIDDEN/);
  assert.equal(String(result.stderr ?? "").trim(), "");

  const lines = String(result.stdout ?? "").trim().split(/\r?\n/).filter(Boolean);
  assert.equal(lines.length, 1, "runtime enforcement inspection must emit one canonical JSON line");
  const summary = JSON.parse(lines[0]);

  assert.deepEqual(Object.keys(summary), [
    "status",
    "mode",
    "policy",
    "counters",
    "nonce",
    "deadline",
    "resolverRotation",
    "failureAccounting",
    "operationalBoundary",
  ]);
  assert.equal(summary.status, "pass");
  assert.equal(summary.mode, "runtime-enforcement-inspection");
  assert.deepEqual(Object.keys(summary.policy), ["txCaps", "valueCaps", "maxEpochs", "stopPolicy"]);
  assert.deepEqual(summary.policy.txCaps, {
    approval: 3,
    bet: 12,
    resolve: 5,
    pendingReplacement: 0,
    total: 20,
  });
  assert.deepEqual(summary.policy.valueCaps, {
    totalSpendWei: "840000000000000000",
    maxApprovalCostPerTxWei: "200000000000000",
    maxKeeperCostPerTxWei: "2000000000000000",
    maxNativeGasWei: "34600000000000000",
  });
  assert.equal(summary.policy.maxEpochs, 11);
  assert.equal(summary.policy.stopPolicy.maxFailures, 1);
  assert.equal(summary.policy.stopPolicy.maxResolveTransactions, 5);
  for (const field of [
    "stopOnBindingFailure",
    "stopOnPreflightFailure",
    "stopOnPendingNonce",
    "stopOnBetFailure",
    "stopOnRepeatFailure",
    "stopOnResolveFailure",
    "stopOnSafeWindowTimeout",
  ]) {
    assert.equal(summary.policy.stopPolicy[field], true, `${field} must remain fail-closed`);
  }

  assert.deepEqual(summary.counters, {
    exactCaps: { approval: 3, bet: 12, resolve: 5, total: 20 },
    approvalOverflowRejected: true,
    betOverflowRejected: true,
    resolveOverflowRejected: true,
    totalOverflowRejected: true,
    rejectionPreservedState: true,
  });
  assert.deepEqual(summary.nonce, {
    equalAccepted: true,
    resolverPendingRejected: true,
    approvalPendingRejected: true,
  });
  assert.deepEqual(summary.deadline, {
    beforeAccepted: true,
    atRejected: true,
    afterRejected: true,
    invalidRejected: true,
  });
  assert.deepEqual(summary.resolverRotation, {
    epoch0: ["RESOLVER", "MANUAL", "AUTOMINER_A", "AUTOMINER_B"],
    epoch1: ["RESOLVER", "AUTOMINER_A", "AUTOMINER_B", "MANUAL"],
    epoch2: ["RESOLVER", "AUTOMINER_B", "MANUAL", "AUTOMINER_A"],
  });
  assert.deepEqual(summary.failureAccounting, {
    countedPrimaryCatchIncrement: 0,
    countedRepeatCatchIncrement: 0,
    ordinaryCatchIncrement: 1,
  });
  assert.deepEqual(summary.operationalBoundary, {
    signingMaterialLoaded: false,
    signatureRequested: false,
    walletClientCreated: false,
    networkRequests: 0,
    contractWrites: 0,
    transactionSent: false,
  });

  const secret = "runtime-rpc-label-secret-sentinel";
  const unsafeLabelResult = runInspection({
    LIVE_CANARY_RPC_LABEL: `API_KEY=${secret}\nsepolia`,
  });
  const unsafeLabelOutput = `${unsafeLabelResult.stdout ?? ""}\n${unsafeLabelResult.stderr ?? ""}`;
  assert.notEqual(unsafeLabelResult.status, 0, unsafeLabelOutput);
  assert.doesNotMatch(unsafeLabelOutput, new RegExp(secret));
  assert.match(unsafeLabelOutput, /LIVE_CANARY_RPC_LABEL must be a short redacted identifier/);
  assert.doesNotMatch(unsafeLabelOutput, /NETWORK_CALL_FORBIDDEN/);
});

test("explicit epoch-bound mode fails closed before runner side effects when the runtime flag is disabled", () => {
  const rejected = runEpochBoundGuardInspection({
    NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS: "0",
  });
  const rejectedOutput = `${rejected.stdout ?? ""}\n${rejected.stderr ?? ""}`;
  assert.equal(rejected.error, undefined, rejected.error?.message);
  assert.equal(rejected.signal, null, rejectedOutput);
  assert.notEqual(rejected.status, 0, rejectedOutput);
  assert.match(
    rejectedOutput,
    /Epoch-bound canary requires NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS=1/,
  );
  assert.doesNotMatch(rejectedOutput, /NETWORK_CALL_FORBIDDEN/);
});

test("V10 enforcement guards remain ordered before every affected write sink", () => {
  const source = readFileSync(LIVE_CANARY_SCRIPT, "utf8");
  const inspection = sourceSection(
    source,
    "function inspectV10RuntimeEnforcement()",
    "function createCanaryPlanSha256()",
  );
  assert.doesNotMatch(inspection, /\bcreate(?:Public|Wallet)Client\s*\(|\.writeContract\s*\(|\bfetch\s*\(/);

  const resolver = sourceSection(
    source,
    "async function resolveIfNeeded",
    "function getBudgetedLiveGasLimit",
  );
  assertSourceOrder("resolver pending nonce and deadline", resolver, [
    "if (noncePending > nonceLatest) {",
    'assertV10NonceQueueClear(nonceLatest, noncePending, "resolver");',
    "continue;",
    "assertV10SafeWindowDeadline(",
    "const [writeNonceLatest, writeNoncePending] = await Promise.all([",
    'assertV10NonceQueueClear(writeNonceLatest, writeNoncePending, "resolver");',
    'reserveV10RuntimeTransaction("resolve");',
    "const hash = await walletClient.writeContract({",
  ]);

  const main = sourceSection(
    source,
    "async function main()",
    'if (process.argv.includes("--inspect-runtime-enforcement"))',
  );
  assert.match(
    main,
    /const previewBinding = DRY_RUN \|\| !V10_MATRIX_ONLY\s*\? null\s*:\s*assertFreshPreviewBinding\(publicWalletConfig\)/,
    "the V10 Preview/consent chain must not disable the existing managed-soak live profile",
  );
  assert.match(
    main,
    /if \(V10_MATRIX_ONLY && !DRY_RUN && !previewBinding\)/,
    "only the V10 matrix live profile must require the V10 Preview binding",
  );
  assert.match(
    sourceSection(source, "function writeCanaryAdmission", "function writeEvent"),
    /execution === "live" && V10_MATRIX_ONLY && !params\.previewBinding/,
    "managed-soak admission must not be routed through the V10-only Preview contract",
  );
  assert.match(
    main,
    /if \(previewBinding\) \{[\s\S]*assertIdenticalV10PreviewBinding\(previewBinding, previewBindingBeforeWrites\);[\s\S]*\}/,
    "the second Preview check must remain conditional on a bound V10 matrix execution",
  );

  const safeWindow = sourceSection(
    source,
    "async function waitForSafeWindow",
    "async function ensureAllowance",
  );
  assertSourceOrder("safe-window loop deadline", safeWindow, [
    "const deadlineAtMs = startedAt + SAFE_WINDOW_TIMEOUT_MS;",
    'assertV10SafeWindowDeadline(deadlineAtMs, "before-resolve");',
    "await resolveIfNeeded({ ...params, safeWindowDeadlineAtMs: deadlineAtMs });",
  ]);

  const approval = sourceSection(
    source,
    "async function ensureAllowance",
    "async function placeRound",
  );
  assertSourceOrder("approval pending nonce and transaction cap", approval, [
    'assertV10NonceQueueClear(nonceLatest, noncePending, "approval");',
    "const walletClient = createWalletClient({",
    'reserveV10RuntimeTransaction("approval");',
    "const hash = await walletClient.writeContract({",
  ]);

  const bet = sourceSection(
    source,
    "async function placeRound",
    "async function runPreflight",
  );
  assertSourceOrder("bet pending nonce and transaction cap", bet, [
    "const { latest: nonceLatest, pending: noncePending } = await waitForNonceQueueSettlement({",
    'reserveV10RuntimeTransaction("bet");',
    "const hash = await walletClient.writeContract({",
  ]);

  const roundLoop = sourceSection(
    source,
    "let failures = 0;",
    "if (TARGET_ROUNDS % HEALTH_SAMPLE_EVERY_ROUNDS !== 0)",
  );
  assert.match(
    roundLoop,
    /if \(!repeatEvent\.ok\) \{[\s\S]*?failures \+= 1;[\s\S]*?throw new CountedRoundFailure\(/,
    "a repeat failure must be counted before it is marked as already counted",
  );
  assert.match(
    roundLoop,
    /\} else \{\s*failures \+= 1;\s*const errorKind = event\.errorKind[\s\S]*?throw new CountedRoundFailure\(/,
    "a primary terminal failure must be counted before it is marked as already counted",
  );
  assert.match(
    roundLoop,
    /\} catch \(error\) \{\s*if \(shouldCountCaughtRoundFailure\(error\)\) \{\s*const classified = classifyError\(error\);\s*failures \+= 1;/,
    "the common catch must increment only failures that were not already counted",
  );

  const dispatch = source.slice(source.indexOf('if (process.argv.includes("--inspect-runtime-enforcement"))'));
  assertSourceOrder("offline inspection dispatch", dispatch, [
    'if (process.argv.includes("--inspect-runtime-enforcement"))',
    "inspectV10RuntimeEnforcement();",
    '} else if (process.argv.includes("--inspect-canary-plan"))',
    "main().catch((error) => {",
  ]);
});
