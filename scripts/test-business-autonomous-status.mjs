import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  AUTONOMOUS_STATUS_CHECKS,
  autonomousStatusManifestIssues,
  createAutonomousStatusChildRunner,
  parseAutonomousStatusPositiveIntegerEnv,
  runAutonomousStatus,
  summarizeAutonomousStatusCheck,
} from "./report-autonomous-status.mjs";

function check(id) {
  const found = AUTONOMOUS_STATUS_CHECKS.find((entry) => entry.id === id);
  assert.ok(found, `missing autonomous status check ${id}`);
  return found;
}

function json(value) {
  return JSON.stringify(value);
}

export function runAutonomousStatusBehaviorTests() {
  const expectedManifest = [
    ["remaining", "remaining gates", "proof:remaining:summary", [0]],
    ["security-followup", "security follow-up", "proof:security-followup:summary", [0]],
    ["collector-redaction", "proof collector redaction", "proof:collector-redaction:summary", [0]],
    ["wallet-runtime", "wallet runtime logic", "test:logic:summary", [0]],
    ["v10-invariants", "V10 invariants", "test:contract:v10:summary", [0]],
    ["abi-indexer-storage", "ABI/indexer storage", "test:indexer-storage:summary", [0]],
    ["v10-deployed", "V10 deployed identity", "proof:contract-deployed:v10:summary", [0, 1]],
    ["signoff", "contract / funds sign-off strict", "proof:signoff:strict:summary", [0, 1]],
    ["chain", "chain reconciliation strict", "proof:chain:strict:summary", [0, 1]],
    ["host", "production host strict", "proof:host:strict:summary", [0, 1]],
    ["soak", "testnet soak", "soak:testnet:status:compact", [0]],
    ["pending-nonce", "pending nonce dry-run", "soak:testnet:clear-pending:summary", [0]],
    ["v10-preview", "V10 dry-run preview", "preview:canary:v10:dry-run:summary", [0, 1]],
    ["v10-authorization-preview", "V10 authorization-ready preview", "preview:canary:v10:authorization-ready:summary", [0, 1]],
    ["cleanup", "workspace cleanup dry-run", "cleanup:workspace:dry-run:summary", [0]],
    ["qa", "wallet / UX QA strict", "proof:qa:strict:summary", [0, 1]],
    ["v10-canary", "V10 canary matrix", "proof:testnet:canary:v10:summary", [0, 1]],
    ["launch", "full launch proof strict", "proof:launch:strict:summary", [0, 1]],
    ["runtime-monitor", "runtime monitor config", "monitor:runtime:summary", [0, 1]],
    ["indexer", "indexer strict", "proof:indexer:strict:summary", [0, 1]],
    ["restore", "restore strict", "proof:restore:strict:summary", [0, 1]],
    ["backup", "backup strict", "db:backup:strict:summary", [0, 1]],
    ["g1", "G1 env status", "proof:mainnet:strict:compact", [0, 1]],
  ];
  assert.deepEqual(
    AUTONOMOUS_STATUS_CHECKS.map(({ id, label, script, ok }) => [id, label, script, [...ok]]),
    expectedManifest,
    "autonomous status manifest must preserve exact ordered read-only commands and exit policies",
  );
  assert.deepEqual(autonomousStatusManifestIssues(AUTONOMOUS_STATUS_CHECKS), []);

  for (const mutant of [
    [...AUTONOMOUS_STATUS_CHECKS, {
      id: "write-capable", label: "write capable", script: "cleanup:workspace:apply", ok: new Set([0]),
    }],
    AUTONOMOUS_STATUS_CHECKS.map((entry) => entry.id === "wallet-runtime"
      ? { ...entry, ok: new Set([0, 1]) }
      : entry),
  ]) {
    let childCalls = 0;
    assert.throws(
      () => runAutonomousStatus({
        checks: mutant,
        runScript: () => { childCalls += 1; return { status: 0, stdout: "", stderr: "" }; },
        writeLine: () => {},
      }),
      /invalid autonomous status manifest/,
    );
    assert.equal(childCalls, 0, "manifest faults must fail before any child process runs");
  }

  const remaining = summarizeAutonomousStatusCheck(check("remaining"), [
    "Complete gates: 3/14",
    "Remaining gate groups: monitoring=1, contract=2, bad=<secret>",
    "Next gate: G9 monitoring",
    "Next gate group: monitoring",
    "Autonomous next: npm.cmd run status:autonomous",
    "Transaction boundary: fresh Preview then explicit consent",
    "Pre-transaction preview checks: chain id | nonce | gas",
    "Consent requirement: exact bounded consent",
    "Summary: 11 proof issue(s); groups: monitoring=1, contract=2",
  ].join("\n"));
  assert.match(remaining, /complete=3\/14/);
  assert.match(remaining, /groups=monitoring=1,contract=2/);
  assert.match(remaining, /next=G9/);
  assert.match(remaining, /consent=present/);
  assert.match(remaining, /txBoundary=fresh-preview-then-explicit-consent/);
  assert.match(remaining, /previewChecks=chain-id,nonce,gas/);
  assert.doesNotMatch(remaining, /secret|Consent requirement:/i);

  const collectorRedaction = summarizeAutonomousStatusCheck(
    check("collector-redaction"),
    "status=pass, cases=8, redacted=5, leaked=0, issues=0\nraw=private-secret",
  );
  assert.equal(collectorRedaction, "status=pass, cases=8, redacted=5, leaked=0, issues=0");
  assert.doesNotMatch(collectorRedaction, /private-secret|raw=/);
  assert.equal(
    summarizeAutonomousStatusCheck(check("collector-redaction"), "not-a-summary"),
    "status=fail issue=invalid-collector-redaction-summary",
  );
  assert.equal(
    summarizeAutonomousStatusCheck(
      check("collector-redaction"),
      "status=pass, cases=9007199254740992, redacted=5, leaked=0, issues=0",
    ),
    "status=fail issue=invalid-collector-redaction-counters",
  );

  const pending = summarizeAutonomousStatusCheck(check("pending-nonce"), json({
    role: "AUTOMINER_A",
    mode: "dry-run",
    pendingNonceGap: 2,
    replacementCap: 1,
    wouldSendReplacement: false,
    operationalBoundary: {
      dryRunDefault: true,
      signingMaterialLoaded: false,
      walletClientCreated: false,
      contractWriteSubmitted: false,
      transactionSent: false,
    },
  }));
  assert.match(pending, /role=AUTOMINER_A/);
  assert.match(pending, /pendingGap=2/);
  assert.match(pending, /signing=false.*walletClient=false.*contractWrite=false.*txSent=false/);

  const preview = summarizeAutonomousStatusCheck(check("v10-preview"), json({
    status: "pass",
    authorizationFreshnessRequired: true,
    ageMinutes: 2,
    maxPreviewAgeMinutes: 5,
    transactionLimit: 3,
    estimatedGas: 123,
    plannedBetTx: 1,
    canaryLog: "C:\\private\\canary.jsonl",
    logLines: 2,
    transactionSent: false,
    signingMaterialLoaded: false,
    walletClientCreated: false,
    contractWriteSubmitted: false,
    dryRunProofBlocksG10G11: true,
  }));
  assert.match(preview, /authFresh=true.*transactionLimit=3.*plannedBetTx=1/);
  assert.match(preview, /txSent=false.*signing=false.*walletClient=false.*contractWrite=false/);
  assert.doesNotMatch(preview, /private|canary\.jsonl/i);

  const stalePreview = summarizeAutonomousStatusCheck(check("v10-authorization-preview"), json({
    status: "fail",
    issue: "preview expired at C:\\private\\preview.json",
    authorizationFreshnessRequired: true,
    ageMinutes: 9,
    maxPreviewAgeMinutes: 5,
    transactionLimit: 999,
  }));
  assert.match(stalePreview, /^status=fail, authFresh=true, ageMinutes=9, maxAgeMinutes=5, issue=/);
  assert.doesNotMatch(stalePreview, /transactionLimit|C:\\|preview\.json|0x[a-f0-9]{8,}/i);

  const deployed = summarizeAutonomousStatusCheck(check("v10-deployed"), json({
    status: "blocked by 0x1111111111111111111111111111111111111111",
    network: "linea-mainnet",
    chainId: 59144,
    manifestMatches: false,
    runtimeBytes: 24_000,
    expectedRuntimeBytes: 23_999,
    runtimeBytecode: true,
    runtimeExecutable: true,
    metadataOnlyMismatch: true,
    transactionSent: false,
    assertionFailures: 0,
  }));
  assert.match(deployed, /network=linea-mainnet.*chainId=59144/);
  assert.match(deployed, /metadataOnlyMismatch=true.*transactionSent=false/);
  assert.doesNotMatch(deployed, /0x1111/);

  const wallet = summarizeAutonomousStatusCheck(check("wallet-runtime"), json({
    status: "pass",
    businessLogic: true,
    localProof: true,
    apiBoundaryProof: true,
    walletTxStateMachineProof: true,
    walletClaimStateMachineProof: true,
    authBoundaryProof: true,
    replicaRateLimitBoundaryProof: true,
    browserBaselineCompactPerformance: true,
    jsonNoStoreRoutes: true,
    sessionVaryCookie: true,
    boundedJsonRoutes: true,
    rateLimitNoStore: true,
    routeErrorRedaction: true,
    depositsRecoveryGlobalBound: true,
    miningPendingRecoveryScoped: true,
    miningReceiptRevertExplicit: true,
    walletHashlessNonceRecovery: true,
    manualMinePendingAmbiguousSafe: true,
    approvalDuplicateSendSafe: true,
    autoMinerNonceRecoverySafe: true,
    autoMinerRpcReconnectSafe: true,
    rewardClaimStateSafe: true,
    safetyPoolClaimStateSafe: true,
    resolverClaimStateSafe: true,
    authTrustedOriginFailClosed: true,
    authReplayNonceBoundary: true,
    authCanonicalNonceBoundary: true,
    authSessionCookieBoundary: true,
    sharedRateLimitRetryAfterBound: true,
    externalRateLimitPublicEndpoint: true,
    externalRateLimitResponseBound: true,
    externalSharedLockCanonical: true,
    replicaRateLimitStrictConfig: true,
    expectedWarnings: 26,
    assertionFailures: 0,
    timedOut: false,
    durationMs: 100,
    childExitCode: 0,
  }));
  for (const marker of [
    "localProof=true", "apiBoundaryProof=true", "walletTxStateMachineProof=true",
    "walletClaimStateMachineProof=true", "authBoundaryProof=true", "replicaRateLimitBoundaryProof=true",
    "depositsRecoveryGlobalBound=true", "autoMinerRpcReconnectSafe=true", "resolverClaimStateSafe=true",
    "externalSharedLockCanonical=true", "expectedWarnings=26", "childExitCode=0",
  ]) assert.match(wallet, new RegExp(marker));

  const invariant = summarizeAutonomousStatusCheck(check("v10-invariants"), json({
    status: "pass",
    invariantSuite: ["v10"],
    runtimeBytes: 1,
    functionSelectors: 2,
    guardedLocalMutationEntrypoints: 3,
    fullRangeAccountingCases: 4,
    fullRangeProportionalCases: 5,
    assertionFailures: 0,
    protocolFeeFlushModelCases: 6,
    protocolFeeFlushEntrypointCases: 7,
    duplicateBatchModelCases: 8,
    packedBoundaryCases: 9,
  }));
  assert.match(invariant, /guarded=3.*accountingCases=4.*proportionalCases=5/);
  assert.match(invariant, /protocolFeeFlushCases=6.*packedBoundaryCases=9/);

  const abi = summarizeAutonomousStatusCheck(check("abi-indexer-storage"), json({
    status: "pass",
    categories: 5,
    financialEventCategories: ["deposit", "reward"],
    depositScopeIsolation: true,
    idempotentDepositUpsert: true,
    resolverRewardScopeIsolation: true,
    idempotentResolverRewardUpsert: true,
    dustSettlementScopeIsolation: true,
    idempotentDustSettlementUpsert: true,
    singleRebateClaimParity: true,
    epochScopeIsolation: true,
    idempotentEpochUpsert: true,
    jackpotScopeIsolation: true,
    idempotentJackpotUpsert: true,
    rewardClaimScopeIsolation: true,
    idempotentRewardClaimUpsert: true,
    batchClaimKindParity: true,
    dustSettlementKindParity: true,
    sameBlockEventOrdering: true,
    staleEventReplayIgnored: true,
    staleEpochReplayIgnored: true,
    staleFinancialReplayIgnored: true,
    normalizedEventIdRequiresTxLog: true,
    partialRpcLogFallback: true,
    malformedPayloadFallback: true,
    boundedEventStorage: true,
    limitedEventReads: true,
    chainScopeIsolation: true,
    normalizedEventScopeIsolation: true,
    protocolFeeScopeIsolation: true,
    idempotentProtocolFeeUpsert: true,
    assertionFailures: 0,
  }));
  assert.match(abi, /financialEventCategories=deposit,reward/);
  assert.match(abi, /depositScopeIsolation=true.*idempotentDepositUpsert=true/);
  assert.match(abi, /staleEventReplayIgnored=true.*staleEpochReplayIgnored=true.*staleFinancialReplayIgnored=true/);
  assert.match(abi, /boundedEventStorage=true.*limitedEventReads=true/);

  const soak = summarizeAutonomousStatusCheck(check("soak"),
    "status=ok dry=true alive=false stop=none ok=2 bound=2 unbound=0 fail=0 roles=AUTOMINER_A:2 epochs=2 tx=2 nonces=2 dupTx=0 dupNonce=0 rev=0 health=2/2 rpc=0 gas=0 resolver=0 slow=0 p95=10ms diskLow=false diskFree=100 preflight=none fk=none ff=none raw=https://secret.invalid");
  assert.match(soak, /roles=AUTOMINER_A:2/);
  assert.match(soak, /health=2\/2.*diskFree=100/);
  assert.doesNotMatch(soak, /secret|https?:/i);

  const security = summarizeAutonomousStatusCheck(check("security-followup"), json({
    status: "pass", checks: 8, passed: 8, failed: 0, failedIds: [], hostAuth: true,
    webLocks: true, keeperNonce: true, keeperBotReceipts: true, depositLimiter: true,
    dryRunDefaults: true, ciSecurity: true, autoResolve: true, appResolveEpochFiles: 0,
  }));
  assert.match(security, /checks=8.*failedIds=none.*hostAuth=true.*autoResolve=true/);

  const runtimeMonitor = summarizeAutonomousStatusCheck(check("runtime-monitor"), json({
    status: "fail",
    groups: "monitoring=1, injected=<secret>",
    missingConfig: ["backup-dir", "0x1111111111111111111111111111111111111111"],
    alertsConfigured: false,
    resendConfigured: false,
    backupConfigured: false,
    canaryLogConfigured: false,
    chainAuditConfigured: false,
    wouldPoll: false,
    wouldSendAlerts: false,
  }));
  assert.match(runtimeMonitor, /groups=monitoring=1/);
  assert.match(runtimeMonitor, /missing=backup-dir/);
  assert.match(runtimeMonitor, /wouldPoll=false.*wouldSendAlerts=false/);
  assert.doesNotMatch(runtimeMonitor, /secret|0x1111/i);

  const manifestSummary = summarizeAutonomousStatusCheck(check("indexer"),
    "Manifest: C:\\private\\indexer.json\nSummary: 2 proof issue(s); blocked gates: G7, G8; groups: indexer=2; issue(s): missing RPC secret");
  assert.match(manifestSummary, /manifest=c-private-indexer-json/);
  assert.match(manifestSummary, /issues=2.*gates=G7,G8.*groups=indexer=2/);
  assert.doesNotMatch(manifestSummary, /C:\\|RPC secret/i);

  const backup = summarizeAutonomousStatusCheck(check("backup"), json({
    status: "fail",
    groups: "backup=1, evil=<secret>",
    issue: "LORE_DB_PATH and LORE_BACKUP_DIR require --source and --out C:\\private\\db.sqlite",
  }));
  assert.match(backup, /groups=backup=1/);
  assert.match(backup, /issue=backup-paths-or-source-output-required/);
  assert.doesNotMatch(backup, /private|db\.sqlite/i);

  const invalidCounters = summarizeAutonomousStatusCheck(check("cleanup"), json({
    status: "ok", mode: "dry-run", matchedTargets: 1.5, bytes: -1,
  }));
  assert.equal(invalidCounters, "status=ok, mode=dry-run, matched=0, bytes=0");
  assert.equal(summarizeAutonomousStatusCheck(check("pending-nonce"), "not-json"), "status=fail issue=invalid-pending-nonce-json");
  assert.equal(summarizeAutonomousStatusCheck(check("runtime-monitor"), "not-json"), "status=fail issue=invalid-runtime-monitor-json");

  assert.equal(parseAutonomousStatusPositiveIntegerEnv("T", 10, 1, 20, {}), 10);
  assert.equal(parseAutonomousStatusPositiveIntegerEnv("T", 10, 1, 20, { T: "20" }), 20);
  for (const value of ["01", "1e1", "1.0", "9007199254740992", "21"]) {
    assert.throws(
      () => parseAutonomousStatusPositiveIntegerEnv("T", 10, 1, 20, { T: value }),
      /canonical decimal integer|between 1 and 20/,
    );
  }

  const spawnCalls = [];
  const childRunner = createAutonomousStatusChildRunner({
    env: { npm_execpath: "C:\\trusted\\npm-cli.js", AUTONOMOUS_STATUS_TIMEOUT_MS: "1234" },
    execPath: "D:\\node.exe",
    platform: "win32",
    cwd: "C:\\repo",
    spawn: (...args) => {
      spawnCalls.push(args);
      return { status: 0, stdout: "", stderr: "" };
    },
  });
  childRunner("proof:remaining:summary");
  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0][0], "D:\\node.exe");
  assert.deepEqual(spawnCalls[0][1], ["C:\\trusted\\npm-cli.js", "--silent", "run", "proof:remaining:summary"]);
  assert.equal(spawnCalls[0][2].timeout, 1234);
  assert.equal(spawnCalls[0][2].maxBuffer, 256 * 1024);
  assert.equal(spawnCalls[0][2].env.NO_UPDATE_NOTIFIER, "1");

  const lines = [];
  const executed = [];
  const result = runAutonomousStatus({
    runScript: (script) => {
      executed.push(script);
      return script === "proof:remaining:summary"
        ? { status: 0, stdout: "Complete gates: 0/14\nNext gate: G1\nSummary: 14 proof issue(s)", stderr: "" }
        : script === "db:backup:strict:summary"
          ? { status: 1, stdout: json({ status: "fail", groups: "backup=1", issue: "missing backup" }), stderr: "" }
          : { status: 0, stdout: "", stderr: "" };
    },
    writeLine: (line) => lines.push(line),
    now: () => new Date("2026-08-13T00:00:00.000Z"),
  });
  assert.deepEqual(executed, expectedManifest.map((entry) => entry[2]));
  assert.equal(result.exitCode, 0, "declared external blocker exits must remain expected and non-fatal");
  assert.match(lines.join("\n"), /Mode: read-only, no transactions, no deploys, no live soak start/);
  assert.match(lines.join("\n"), /Timestamp: 2026-08-13T00:00:00.000Z/);

  const unexpected = runAutonomousStatus({
    runScript: (script) => script === "proof:remaining:summary"
      ? { status: 9, stdout: "", stderr: "private-key=secret" }
      : { status: 0, stdout: "", stderr: "" },
    writeLine: () => {},
  });
  assert.equal(unexpected.exitCode, 1);
  assert.deepEqual(unexpected.failures, ["proof:remaining:summary"]);

  const importGuard = spawnSync(process.execPath, [
    "--input-type=module",
    "--eval",
    'await import("./scripts/report-autonomous-status.mjs")',
  ], {
    cwd: process.cwd(),
    env: { ...process.env, AUTONOMOUS_STATUS_TIMEOUT_MS: "01" },
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(importGuard.status, 0, importGuard.stderr);
  assert.equal(importGuard.stdout, "");
  assert.equal(importGuard.stderr, "");

  const directRunGuard = spawnSync(process.execPath, ["scripts/report-autonomous-status.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, AUTONOMOUS_STATUS_TIMEOUT_MS: "01" },
    encoding: "utf8",
    timeout: 10_000,
  });
  assert.equal(directRunGuard.status, 1);
  assert.equal(directRunGuard.stdout, "");
  assert.equal(
    directRunGuard.stderr.trim(),
    "AUTONOMOUS_STATUS_TIMEOUT_MS must be a canonical decimal integer",
  );
}
