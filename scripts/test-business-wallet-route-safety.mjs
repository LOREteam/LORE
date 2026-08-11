import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as envParsingModule from "../config/envParsing.ts";
import * as scriptEnvParsingModule from "./env-parsing.mjs";
import * as publicConfigModule from "../config/publicConfig.ts";
import * as autoMineErrorModule from "../app/hooks/useMiningAutoMineError.ts";
import * as miningSharedModule from "../app/hooks/useMining.shared.ts";
import * as lineaFeesModule from "../app/lib/lineaFees.ts";
import * as runtimeMonitorModule from "./runtime-monitor-lib.mjs";
import * as boundedJsonBodyModule from "../app/api/_lib/boundedJsonBody.ts";

function assertNoRemovedWalletExperimentInStandardFlow(file) {
  const source = readFileSync(file, "utf8");
  const removedExperimentNames = [
    ["EIP-?77", "02"].join(""),
    ["eip", "7702"].join(""),
    ["authorization", "List"].join(""),
    ["WalletSettings", "7702"].join(""),
    ["usePrivy", "7702Diagnostics"].join(""),
    ["deploy:", "7702"].join(""),
    ["delegated ", "wallet"].join(""),
  ];
  const removedExperimentPattern = new RegExp(`\\b(?:${removedExperimentNames.join("|")})\\b`, "i");
  assert.doesNotMatch(
    source,
    removedExperimentPattern,
    `${file} must not reintroduce the removed delegated-wallet experiment into standard wallet or mining flows`,
  );
}

export async function runWalletAndRouteSafetyTests() {
  const envParsing = envParsingModule.default ?? envParsingModule;
  const scriptEnvParsing = scriptEnvParsingModule.default ?? scriptEnvParsingModule;
  const publicConfig = publicConfigModule.default ?? publicConfigModule;
  const autoMineError = autoMineErrorModule.default ?? autoMineErrorModule;
  const miningShared = miningSharedModule.default ?? miningSharedModule;
  const lineaFees = lineaFeesModule.default ?? lineaFeesModule;
  const runtimeMonitor = runtimeMonitorModule.default ?? runtimeMonitorModule;
  const boundedJsonBody = boundedJsonBodyModule.default ?? boundedJsonBodyModule;
  const standardBetPathSource = readFileSync("app/hooks/useMiningStandardBetPath.ts", "utf8");
  const miningReceiptSource = readFileSync("app/hooks/useMiningReceipt.ts", "utf8");
  [
    "app/hooks/useLineaOreWalletRuntime.ts",
    "app/hooks/useMining.ts",
    "app/hooks/useMiningAllowance.ts",
    "app/hooks/useMiningAutoMineLoop.ts",
    "app/hooks/useMiningAutoMineRunner.ts",
    "app/hooks/useMiningBetExecution.ts",
    "app/hooks/useMiningManualActions.ts",
    "app/hooks/useMiningRoundBetting.ts",
    "app/hooks/useMiningStandardBetPath.ts",
    "app/hooks/useWalletActions.ts",
    "app/hooks/useWalletTransfers.ts",
    "app/lib/mining/autoMineBootstrap.ts",
    "app/lib/mining/autoMineLoopAdapter.ts",
    "app/lib/mining/autoMineLoopRoundCommand.ts",
    "app/lib/mining/autoMineRunSetup.ts",
    "app/lib/mining/manualMineAttempt.ts",
  ].forEach(assertNoRemovedWalletExperimentInStandardFlow);
  assert.match(
    standardBetPathSource,
    /bet transaction submitted[\s\S]*hash,[\s\S]*nonce: nonce \?\? null/,
    "support logs must capture the submitted bet hash and known nonce without wallet identity",
  );
  assert.match(
    standardBetPathSource,
    /writePendingMiningTxState\(\{[\s\S]*chainId: APP_CHAIN_ID,[\s\S]*contract: CONTRACT_ADDRESS,[\s\S]*actor: actor as `0x\$\{string\}`,[\s\S]*hash,[\s\S]*nonce/,
    "mining wallet writes must persist chain, contract, actor, hash, and nonce before waiting for receipt recovery",
  );
  assert.match(
    standardBetPathSource,
    /const state = await waitReceipt\(hash, client\);[\s\S]*if \(state === "confirmed" && actor\) \{[\s\S]*clearPendingMiningTxState\(APP_CHAIN_ID, CONTRACT_ADDRESS, actor\)/,
    "mining wallet writes must clear pending recovery state only after a confirmed receipt",
  );
  assert.match(
    standardBetPathSource,
    /if \(recovery === "pending" \|\| recovery === "manual-reconciliation-required"\) return "pending";[\s\S]*clearPendingMiningTxState\(APP_CHAIN_ID, CONTRACT_ADDRESS, actor\);[\s\S]*return null;/,
    "mining wallet recovery must block duplicate sends while a tracked pending transaction remains unresolved",
  );
  assert.match(
    miningReceiptSource,
    /waitForTransactionReceipt\(\{ hash, timeout: TX_RECEIPT_TIMEOUT_MS \}\)[\s\S]*receipt\.status === "reverted"[\s\S]*Transaction reverted \(hash: \$\{hash\}\)[\s\S]*const lateReceipt = await client\.getTransactionReceipt\(\{ hash \}\);[\s\S]*lateReceipt\.status === "reverted"[\s\S]*Transaction reverted \(hash: \$\{hash\}\)/,
    "manual and Auto-Miner receipt waits must throw explicit reverted errors from both primary and late receipt checks",
  );
  const miningAllowanceSource = readFileSync("app/hooks/useMiningAllowance.ts", "utf8");
  assert.match(
    miningAllowanceSource,
    /function computeAllowancePollDeadline[\s\S]*Number\.isSafeInteger\(now\)[\s\S]*Number\.isSafeInteger\(timeoutMs\)[\s\S]*timeoutMs > Number\.MAX_SAFE_INTEGER - now[\s\S]*const deadline = computeAllowancePollDeadline\(Date\.now\(\), timeoutMs\)/,
    "approve allowance polling must compute deadlines through safe integer timeout normalization",
  );
  assert.match(
    miningAllowanceSource,
    /function normalizeApprovalNonce\(value: unknown\)[\s\S]*typeof value === "bigint"[\s\S]*value > BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*typeof value !== "number" \|\| !Number\.isSafeInteger\(value\)[\s\S]*function selectApprovalSubmissionNonce[\s\S]*function getPendingApproveAgeMs[\s\S]*pendingApprove\.submittedAt > now \+ 5_000[\s\S]*const trackedApprovalNonce = pendingApproveRef\.current\?\.nonce[\s\S]*const approvalNonceRaw = trackedApprovalNonce \?\? await withMiningRpcTimeout[\s\S]*blockTag: "pending"[\s\S]*const approvalNonce = selectApprovalSubmissionNonce\(trackedApprovalNonce, approvalNonceRaw\)[\s\S]*Approval nonce is unavailable or unsafe[\s\S]*const pendingAgeMs = pendingApproveRef\.current[\s\S]*getPendingApproveAgeMs\(pendingApproveRef\.current, Date\.now\(\)\)[\s\S]*Approval pending state is unavailable or unsafe/,
    "approve nonce selection must reject unsafe RPC or pending nonce evidence before wallet submission",
  );
  assert.match(
    miningAllowanceSource,
    /function assertPendingApproveReplacementReady\(pendingApprove: PendingApproveState, waitMessage: string\)[\s\S]*getPendingApproveAgeMs\(pendingApprove, Date\.now\(\)\)[\s\S]*pendingAgeMs <= APPROVE_PENDING_TIMEOUT_MS[\s\S]*throw new Error\(waitMessage\)[\s\S]*if \(pendingApproveRef\.current\) \{[\s\S]*assertPendingApproveReplacementReady\([\s\S]*Approval transaction is still pending\. Wait for confirmation before placing a bet\./,
    "approval duplicate-send guard must stop manual approve replacement until pending timeout",
  );
  assert.doesNotMatch(
    miningAllowanceSource,
    /Date\.now\(\) \+ timeoutMs|pendingApproveRef\.current\?\.nonce \?\? Number\(|Date\.now\(\) - pendingApproveRef\.current\.submittedAt/,
    "approve allowance flow must not return to broad deadline, nonce, or pending-age coercion",
  );
  const autoMineBootstrapAllowanceSource = readFileSync("app/lib/mining/autoMineBootstrap.ts", "utf8");
  assert.match(
    autoMineBootstrapAllowanceSource,
    /function computeBootstrapAllowancePollDeadline[\s\S]*Number\.isSafeInteger\(now\)[\s\S]*Number\.isSafeInteger\(timeoutMs\)[\s\S]*timeoutMs > Number\.MAX_SAFE_INTEGER - now[\s\S]*function normalizeBootstrapApprovalNonce[\s\S]*typeof value === "bigint"[\s\S]*value > BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*Number\.isSafeInteger\(value\)[\s\S]*function selectBootstrapApprovalSubmissionNonce[\s\S]*function getPendingApproveAgeMs[\s\S]*pendingApprove\.submittedAt > now \+ 5_000[\s\S]*function formatLineaWeiOneDecimal[\s\S]*10n \*\* 18n[\s\S]*roundedTenths[\s\S]*const have = formatLineaWeiOneDecimal\(initBalance\)[\s\S]*const need = formatLineaWeiOneDecimal\(roundCost\)[\s\S]*const deadline = computeBootstrapAllowancePollDeadline\(Date\.now\(\), timeoutMs\)[\s\S]*while \(autoMineActive\(\) && Date\.now\(\) < deadline\)[\s\S]*const trackedApprovalNonce = pendingApproveRef\.current\?\.nonce[\s\S]*const approvalNonceRaw = trackedApprovalNonce \?\? await withMiningRpcTimeout[\s\S]*blockTag: "pending"[\s\S]*approvalNonce = selectBootstrapApprovalSubmissionNonce\(trackedApprovalNonce, approvalNonceRaw\)[\s\S]*Approval nonce is unavailable or unsafe[\s\S]*const pendingAgeMs = getPendingApproveAgeMs\(pendingApproveRef\.current, Date\.now\(\)\)[\s\S]*Approval pending state is unavailable or unsafe/,
    "Auto-Miner bootstrap approval must reject unsafe nonce and pending-age evidence before approval retry or replacement decisions",
  );
  assert.match(
    autoMineBootstrapAllowanceSource,
    /function assertPendingApproveReplacementReady\(pendingApprove: PendingApproveState, waitMessage: string\)[\s\S]*getPendingApproveAgeMs\(pendingApprove, Date\.now\(\)\)[\s\S]*pendingAgeMs <= APPROVE_PENDING_TIMEOUT_MS[\s\S]*throw new Error\(waitMessage\)[\s\S]*if \(pendingApproveRef\.current\) \{[\s\S]*assertPendingApproveReplacementReady\([\s\S]*Approval transaction is still pending\. Wait for confirmation before auto-mine continues\./,
    "approval duplicate-send guard must stop Auto-Miner approve replacement until pending timeout",
  );
  assert.ok(
    miningAllowanceSource.includes("Approval transaction is still pending. Wait for confirmation before placing a bet.") &&
      autoMineBootstrapAllowanceSource.includes("Approval transaction is still pending. Wait for confirmation before auto-mine continues."),
    "approval duplicate-send guard must stop manual and Auto-Miner approve replacement until pending timeout",
  );
  assert.doesNotMatch(
    autoMineBootstrapAllowanceSource,
    /pendingApproveRef\.current\?\.nonce \?\? Number\(|Date\.now\(\) - pendingApproveRef\.current\.submittedAt|Date\.now\(\) - startedAt < timeoutMs|Number\(initBalance\)|Number\(roundCost\)/,
    "Auto-Miner bootstrap approval must not use broad nonce coercion, raw pending-age arithmetic, raw poll timeout arithmetic, or broad balance formatting",
  );
  const roundBettingNonceSource = readFileSync("app/hooks/useMiningRoundBetting.ts", "utf8");
  assert.match(
    roundBettingNonceSource,
    /function normalizeAutoMineNonce[\s\S]*typeof value === "bigint"[\s\S]*value > BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*Number\.isSafeInteger\(value\)[\s\S]*function normalizePendingBetState[\s\S]*normalizeAutoMineNonce\(value\.nonce\)[\s\S]*value\.submittedAt > now \+ 5_000[\s\S]*const latestNonce = normalizeAutoMineNonce\(latestNonceRaw\)[\s\S]*const pendingNonce = normalizeAutoMineNonce\(pendingNonceRaw\)[\s\S]*Pending nonce status is unavailable or unsafe[\s\S]*const trackedPendingBet = normalizePendingBetState\(pendingBet, now\)[\s\S]*Tracked pending bet state is unavailable or unsafe/,
    "Auto-Miner bet loop must reject unsafe latest/pending nonce evidence before replacement or duplicate-send decisions",
  );
  assert.match(
    roundBettingNonceSource,
    /const waitSeconds = formatRetryWaitSeconds\(wait\)[\s\S]*retry in \$\{waitSeconds\}s/,
    "Auto-Miner bet loop retry progress must format wait seconds through the shared bounded helper",
  );
  assert.doesNotMatch(
    roundBettingNonceSource,
    /\(wait \/ 1000\)\.toFixed\(0\)/,
    "Auto-Miner bet loop retry progress must not use raw wait toFixed display",
  );
  assert.doesNotMatch(
    roundBettingNonceSource,
    /const latestNonce = Number\(latestNonceRaw\)|const pendingNonce = Number\(pendingNonceRaw\)|Date\.now\(\) - pendingBet\.submittedAt|pendingNonce > pendingBet\.nonce|txNonce = pendingBet\.nonce/,
    "Auto-Miner bet loop must not use broad nonce coercion or raw tracked pending-bet state",
  );
  const walletActionsNonceRecoverySource = readFileSync("app/hooks/useWalletActions.ts", "utf8");
  assert.match(
    walletActionsNonceRecoverySource,
    /function normalizePendingTransactionNonce[\s\S]*typeof value === "bigint"[\s\S]*value > BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*Number\.isSafeInteger\(value\)[\s\S]*const latestNonce = normalizePendingTransactionNonce\(latestNonceRaw\)[\s\S]*const pendingNonce = normalizePendingTransactionNonce\(pendingNonceRaw\)[\s\S]*Pending transaction nonce evidence is unavailable or unsafe/,
    "wallet settings pending-tx recovery must reject unsafe latest/pending nonce evidence before exposing a nonce gap",
  );
  assert.doesNotMatch(
    walletActionsNonceRecoverySource,
    /const latestNonce = Number\(latestNonceRaw\)|const pendingNonce = Number\(pendingNonceRaw\)/,
    "wallet settings pending-tx recovery must not use broad Number coercion for nonce evidence",
  );
  const autoMineLoopSource = readFileSync("app/hooks/useMiningAutoMineLoop.ts", "utf8");
  assert.match(
    autoMineLoopSource,
    /writeAutoMineDiagnostics\(\{[\s\S]*lastEpoch: outcome\.placedEpoch\.toString\(\),[\s\S]*retryCount: 0/,
    "Auto-Miner diagnostics must retain the latest confirmed epoch and reset retries",
  );
  assert.match(
    autoMineLoopSource,
    /formatRetryWaitSeconds\(waitMs\)[\s\S]*formatRetryWaitSeconds\(retryDecision\.waitMs\)/,
    "Auto-Miner loop retry logs must format wait seconds through the shared bounded helper",
  );
  assert.doesNotMatch(
    autoMineLoopSource,
    /\([^)]*waitMs[^)]*\/ 1000\)\.toFixed\(0\)|\([^)]*retryDecision\.waitMs[^)]*\/ 1000\)\.toFixed\(0\)/,
    "Auto-Miner loop retry logs must not use raw wait toFixed display",
  );
  assert.match(
    autoMineLoopSource,
    /writeAutoMineDiagnostics\(\{ retryCount/,
    "Auto-Miner diagnostics must retain retry progress for support export",
  );

  assert.deepEqual(
    runtimeMonitor.evaluateRuntimeSnapshot({
      runtime: { status: "ok" },
      dataSync: { status: "healthy", storage: { lagToFinalityTargetBlocks: 1 }, env: { lagWarnBlocks: 5 } },
      liveState: { currentEpoch: "42", epochEndTime: "100", currentEpochData: ["1000", "0", "0", false], fetchedAt: 220_000 },
      nowMs: 221_000,
      stuckGraceMs: 120_000,
    }),
    [{ key: "stuck-non-empty-epoch", message: "Non-empty epoch #42 is overdue by 121s and still unresolved." }],
  );
  assert.deepEqual(
    runtimeMonitor.evaluateRuntimeSnapshot({
      runtime: { status: "ok" },
      dataSync: { status: "healthy", storage: { lagToFinalityTargetBlocks: 1 }, env: { lagWarnBlocks: 5 } },
      liveState: { currentEpoch: "43", epochEndTime: "100", currentEpochData: ["0", "0", "0", false], fetchedAt: 499_000 },
      nowMs: 500_000,
    }),
    [],
  );
  assert.deepEqual(
    runtimeMonitor.evaluateRuntimeSnapshot({
      runtime: { status: "ok" },
      dataSync: { status: "healthy" },
      liveState: { currentEpoch: "44", epochEndTime: "100", currentEpochData: ["1000", "0", "0", false], fetchedAt: 1 },
      nowMs: 500_000,
    }),
    [{ key: "live-state-stale", message: "Live-state snapshot is missing or stale." }],
  );
  assert.deepEqual(
    runtimeMonitor.evaluateRuntimeSnapshot({
      runtime: { status: "ok" },
      dataSync: { status: "healthy" },
      liveState: { currentEpoch: "45", epochEndTime: "100", currentEpochData: ["0", "0", "0", false], fetchedAt: 500_000 },
      nowMs: Number.NaN,
    }).map((issue) => issue.key),
    ["runtime-snapshot-invalid"],
    "runtime monitor snapshot evaluation must fail closed on malformed monitor clocks",
  );
  assert.deepEqual(
    runtimeMonitor.evaluateRuntimeSnapshot({
      runtime: { status: "ok" },
      dataSync: { status: "healthy" },
      liveState: { currentEpoch: "46", epochEndTime: "100", currentEpochData: ["0", "0", "0", false], fetchedAt: 440_000 },
      nowMs: 500_000,
      maxLiveStateAgeMs: Number.NaN,
    }),
    [],
    "runtime monitor snapshot evaluation must fall back to the safe live-state freshness window",
  );
  assert.deepEqual(
    runtimeMonitor.evaluateRuntimeSnapshot({
      runtime: { status: "ok" },
      dataSync: { status: "healthy" },
      liveState: { currentEpoch: "48", epochEndTime: "100", currentEpochData: ["0", "0", "0", false], fetchedAt: 620_001 },
      nowMs: 500_000,
      maxLiveStateAgeMs: 300_000,
    }),
    [{ key: "live-state-stale", message: "Live-state snapshot is missing or stale." }],
    "runtime monitor snapshot evaluation must reject future live-state fetchedAt evidence outside clock-skew tolerance",
  );
  assert.deepEqual(
    runtimeMonitor.evaluateRuntimeSnapshot({
      runtime: { status: "ok" },
      dataSync: { status: "healthy" },
      liveState: { currentEpoch: "47", epochEndTime: "379", currentEpochData: ["1000", "0", "0", false], fetchedAt: 500_000 },
      nowMs: 500_000,
      stuckGraceMs: Number.NaN,
    }).map((issue) => issue.key),
    ["stuck-non-empty-epoch"],
    "runtime monitor snapshot evaluation must fall back to the safe stuck-epoch grace window",
  );
  const activeRuntimeIssues = new Map();
  const runtimeIssue = { key: "indexer-heartbeat", message: "Indexer heartbeat is stale." };
  assert.deepEqual(runtimeMonitor.reconcileRuntimeIssues(activeRuntimeIssues, [runtimeIssue]), {
    alerts: [runtimeIssue],
    recoveries: [],
  });
  assert.deepEqual(runtimeMonitor.reconcileRuntimeIssues(activeRuntimeIssues, [runtimeIssue]), {
    alerts: [],
    recoveries: [],
  });
  assert.deepEqual(runtimeMonitor.reconcileRuntimeIssues(activeRuntimeIssues, []), {
    alerts: [],
    recoveries: [runtimeIssue],
  });

  assert.equal(
    miningShared.getBetErrorMessage(new Error("HTTP request failed: private provider endpoint")),
    "Bet failed: RPC unavailable. Check your connection and try again.",
  );
  assert.equal(
    miningShared.getBetErrorMessage(
      Object.assign(new Error("Privy sendTransaction timed out after 45000ms against private provider"), {
        name: "WalletSendTimeoutError",
      }),
    ),
    "Bet status is still pending or unavailable. Check wallet activity before retrying.",
  );
  assert.equal(
    miningShared.getBetErrorMessage(
      Object.assign(new Error("transaction receipt could not be found for provider hash"), {
        name: "TransactionReceiptNotFoundError",
      }),
    ),
    "Bet status is still pending or unavailable. Check wallet activity before retrying.",
  );
  assert.equal(
    miningShared.getBetErrorMessage(
      Object.assign(new Error("must have valid access token and privy wallet for private session"), {
        name: "PrivyApiError",
      }),
    ),
    "Bet failed: wallet session expired. Log in again and retry.",
  );
  assert.equal(
    miningShared.getBetErrorMessage(new Error("embedded wallet not found for current actor")),
    "Bet failed: Privy wallet is not ready. Reconnect and retry.",
  );
  assert.equal(
    miningShared.getBetErrorMessage(new Error("Connector chain mismatch: wallet is on the wrong network")),
    "Bet failed: wallet is on the wrong network. Switch to Linea Sepolia and retry.",
  );
  assert.equal(
    miningShared.getBetErrorMessage(new Error("insufficient funds for gas * price + value")),
    "Bet failed: not enough ETH for gas on Privy wallet.",
  );
  assert.equal(
    miningShared.getBetErrorMessage(new Error("execution reverted: internal provider payload")),
    "Bet reverted on-chain. No bet was placed.",
  );
  assert.equal(
    miningShared.getBetErrorMessage(new Error("execution reverted: ERC20InsufficientAllowance")),
    "Bet failed: token approve is still pending or too low. Wait for approve confirmation, then retry.",
  );
  assert.equal(
    miningShared.getBetErrorMessage(new Error("transfer amount exceeds balance")),
    "Bet failed: not enough LINEA token balance.",
  );
  assert.equal(
    miningShared.getBetErrorMessage(new Error("unclassified provider detail")),
    "Bet failed. Try again or export logs if the problem continues.",
  );
  assert.equal(
    miningShared.getBetErrorMessage(new Error("The contract function reverted with UnexpectedEpoch()")),
    "Bet failed: epoch already ended. Try again.",
  );
  assert.equal(miningShared.isEpochEndedError(new Error("UnexpectedEpoch()")), true);
  assert.equal(miningShared.isDeterministicBetExecutionError(new Error("UnexpectedEpoch()")), true);
  assert.equal(
    miningShared.getBetErrorMessage(new Error("Configured contract is missing required epoch-bound betting support.")),
    "Betting is unavailable: configured contract does not support protected V10 bets.",
  );
  assert.equal(
    miningShared.isDeterministicBetExecutionError(
      new Error("Configured contract is missing required epoch-bound betting support."),
    ),
    true,
  );
  assert.equal(
    autoMineError.getAutoMineUserMessage(
      new Error("Configured contract is missing required epoch-bound betting support."),
    ).userMessage,
    "Auto-miner stopped: configured contract does not support protected V10 bets.",
  );
  assert.equal(
    autoMineError.getAutoMineUserMessage(new Error("unclassified provider detail")).userMessage,
    "Auto-miner stopped. Try again or export logs if the problem continues.",
  );

  assert.equal(lineaFees.getLineaFeeOverrides({ maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n }, 59141)?.maxPriorityFeePerGas, 80_000_000n);
  assert.equal(publicConfig.getContractRequiresEpochBoundBets("1"), true);
  assert.equal(publicConfig.getContractRequiresEpochBoundBets("true"), true);
  assert.equal(publicConfig.getContractRequiresEpochBoundBets("0"), false);
  assert.equal(publicConfig.getContractRequiresEpochBoundBets("bogus"), false);
  assert.equal(publicConfig.getConfiguredReadOnlyMode("1"), true);
  assert.equal(publicConfig.getConfiguredReadOnlyMode("true"), true);
  assert.equal(publicConfig.getConfiguredReadOnlyMode("0"), false);
  assert.equal(publicConfig.getConfiguredReadOnlyMode("bogus"), false);
  assert.equal(publicConfig.isUnstableLineaReadRpc("https://linea-sepolia-rpc.publicnode.com", "sepolia"), true);
  assert.equal(publicConfig.isUnstableLineaReadRpc("https://rpc.sepolia.linea.build", "sepolia"), false);
  assert.equal(publicConfig.isUnstableLineaReadRpc("https://linea-sepolia.drpc.org", "sepolia"), false);
  assert.deepEqual(
    publicConfig.getStableLineaReadRpcs(undefined, "sepolia"),
    ["https://linea-sepolia.drpc.org", "https://rpc.sepolia.linea.build"],
  );
  assert.equal(
    publicConfig.getPreferredLineaRpcs(undefined, "sepolia")[0],
    "https://linea-sepolia-rpc.publicnode.com",
  );
  assert.deepEqual(
    publicConfig.getPreferredLineaRpcs(" https://rpc-a.test , https://rpc-b.test ,, https://linea-sepolia.drpc.org ", "sepolia"),
    [
      "https://rpc-a.test",
      "https://rpc-b.test",
      "https://linea-sepolia.drpc.org",
      "https://linea-sepolia-rpc.publicnode.com",
      "https://rpc.sepolia.linea.build",
    ],
  );
  assert.throws(
    () => publicConfig.getConfiguredDeployBlock("bad", "sepolia"),
    /INDEXER_START_BLOCK must be a non-negative integer/,
  );
  assert.throws(
    () => publicConfig.getConfiguredDeployBlock("-1", "sepolia"),
    /INDEXER_START_BLOCK must be a non-negative integer/,
  );
  assert.equal(envParsing.parseOptionalNonNegativeBigIntEnv("bad", 256n), 256n);
  assert.equal(envParsing.parseOptionalNonNegativeBigIntEnv("-1", 256n), 256n);
  assert.equal(envParsing.parseOptionalNonNegativeBigIntEnv("512", 256n), 512n);
  assert.equal(envParsing.parseOptionalNonNegativeNumberEnv("bad", 256), 256);
  assert.equal(envParsing.parseOptionalNonNegativeNumberEnv("-1", 256), 256);
  assert.equal(envParsing.parseOptionalNonNegativeNumberEnv("512", 256), 512);
  assert.equal(envParsing.parseOptionalNonNegativeNumberEnv(String(Number.MAX_SAFE_INTEGER), 256), Number.MAX_SAFE_INTEGER);
  assert.equal(envParsing.parseOptionalNonNegativeNumberEnv((BigInt(Number.MAX_SAFE_INTEGER) + 1n).toString(), 256), 256);
  assert.equal(envParsing.parseOptionalPositiveIntegerEnv("bad", 15_000), 15_000);
  assert.equal(envParsing.parseOptionalPositiveIntegerEnv("0", 15_000), 15_000);
  assert.equal(envParsing.parseOptionalPositiveIntegerEnv("-1", 15_000), 15_000);
  assert.equal(envParsing.parseOptionalPositiveIntegerEnv("1e3", 15_000), 15_000);
  assert.equal(envParsing.parseOptionalPositiveIntegerEnv("90000", 15_000), 90_000);
  assert.equal(envParsing.parseOptionalPositiveIntegerInRangeEnv("bad", 3, 1, 24), 3);
  assert.equal(envParsing.parseOptionalPositiveIntegerInRangeEnv("0", 3, 1, 24), 3);
  assert.equal(envParsing.parseOptionalPositiveIntegerInRangeEnv("12", 3, 1, 24), 12);
  assert.equal(envParsing.parseOptionalPositiveIntegerInRangeEnv("999", 3, 1, 24), 24);
  assert.equal(scriptEnvParsing.parsePositiveIntegerEnv("bad", 60_000), 60_000);
  assert.equal(scriptEnvParsing.parsePositiveIntegerEnv("0", 60_000), 60_000);
  assert.equal(scriptEnvParsing.parsePositiveIntegerEnv("01", 60_000), 60_000);
  assert.equal(scriptEnvParsing.parsePositiveIntegerEnv("1e3", 60_000), 60_000);
  assert.equal(scriptEnvParsing.parsePositiveIntegerEnv("90000", 60_000), 90_000);
  assert.equal(scriptEnvParsing.parsePositiveIntegerEnv(String(Number.MAX_SAFE_INTEGER), 60_000), Number.MAX_SAFE_INTEGER);
  assert.equal(scriptEnvParsing.parsePositiveIntegerEnv((BigInt(Number.MAX_SAFE_INTEGER) + 1n).toString(), 60_000), 60_000);
  assert.equal(scriptEnvParsing.parsePositiveIntegerInRangeEnv("999", 3, 1, 24), 24);
  assert.equal(scriptEnvParsing.parseNonNegativeNumberInRangeEnv("-1", 0.01, 0, 1), 0.01);
  assert.equal(scriptEnvParsing.parseNonNegativeNumberInRangeEnv("1.5", 0.01, 0, 1), 1);
  assert.deepEqual(
    await boundedJsonBody.readBoundedJsonBody(
      new Request("https://play.example/api", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ok: true }),
      }),
      64,
    ),
    { ok: true, value: { ok: true } },
  );
  assert.deepEqual(
    await boundedJsonBody.readBoundedJsonBody(
      new Request("https://play.example/api", {
        method: "POST",
        headers: { "content-length": "65" },
        body: "{}",
      }),
      64,
    ),
    { ok: false, reason: "too-large" },
  );
  assert.deepEqual(
    await boundedJsonBody.readBoundedJsonBody(
      new Request("https://play.example/api", {
        method: "POST",
        headers: { "content-length": String(Number.MAX_SAFE_INTEGER) },
        body: "{}",
      }),
      64,
    ),
    { ok: false, reason: "too-large" },
    "safe-max Content-Length must be bounded against the route byte limit before body reads",
  );
  for (const malformedContentLength of ["01", "1e3", "-1", "1.5", (BigInt(Number.MAX_SAFE_INTEGER) + 1n).toString()]) {
    assert.deepEqual(
      await boundedJsonBody.readBoundedJsonBody(
        new Request("https://play.example/api", {
          method: "POST",
          headers: { "content-length": malformedContentLength },
          body: "{}",
        }),
        64,
      ),
      { ok: false, reason: "invalid" },
      `malformed Content-Length ${malformedContentLength} must not be broadly coerced`,
    );
  }
  for (const invalidMaxBytes of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    assert.deepEqual(
      await boundedJsonBody.readBoundedJsonBody(
        {
          headers: new Headers({ "content-type": "application/json" }),
          get body() {
            throw new Error("invalid maxBytes must fail before reading the request body");
          },
        },
        invalidMaxBytes,
      ),
      { ok: false, reason: "invalid" },
      `invalid JSON maxBytes ${String(invalidMaxBytes)} must fail closed before body reads`,
    );
  }
  assert.deepEqual(
    await boundedJsonBody.readBoundedJsonBody(
      {
        headers: new Headers({ "content-type": "application/json" }),
        get body() {
          throw new Error("oversized maxBytes config must fail before reading the request body");
        },
      },
      256 * 1024 + 1,
    ),
    { ok: false, reason: "invalid" },
    "bounded JSON body parser must reject route byte limits above the API-wide cap before body reads",
  );
  assert.deepEqual(
    await boundedJsonBody.readBoundedJsonBody(
      new Request("https://play.example/api", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ok: true }),
      }),
      256 * 1024,
    ),
    { ok: true, value: { ok: true } },
    "bounded JSON body parser must preserve the exact API-wide cap as a valid route byte limit",
  );
  let oversizedCancelCalled = false;
  assert.deepEqual(
    await boundedJsonBody.readBoundedJsonBody(
      new Request("https://play.example/api", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(JSON.stringify({ value: "x".repeat(65) })));
          },
          cancel() {
            oversizedCancelCalled = true;
            throw new Error("synthetic cancel failure");
          },
        }),
        duplex: "half",
      }),
      64,
    ),
    { ok: false, reason: "too-large" },
    "oversized JSON body must stay classified as too-large even if stream cancellation fails",
  );
  assert.equal(oversizedCancelCalled, true, "oversized JSON body should cancel the unread request stream");
  assert.deepEqual(
    await boundedJsonBody.readBoundedJsonBody(
      new Request("https://play.example/api", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value: "x".repeat(65) }),
      }),
      64,
    ),
    { ok: false, reason: "too-large" },
  );
  assert.deepEqual(
    await boundedJsonBody.readBoundedJsonBody(
      new Request("https://play.example/api", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ ok: true }),
      }),
      64,
    ),
    { ok: false, reason: "unsupported-content-type" },
  );
  assert.deepEqual(
    await boundedJsonBody.readBoundedJsonBody(
      new Request("https://play.example/api", {
        method: "POST",
        headers: { "content-type": "text/plain+json" },
        body: JSON.stringify({ ok: true }),
      }),
      64,
    ),
    { ok: false, reason: "unsupported-content-type" },
    "bounded JSON body parser must only accept application/json or application/*+json content types",
  );
  assert.deepEqual(
    await boundedJsonBody.readBoundedJsonBody(
      new Request("https://play.example/api", {
        method: "POST",
        body: JSON.stringify({ ok: true }),
      }),
      64,
    ),
    { ok: false, reason: "unsupported-content-type" },
  );
  assert.deepEqual(
    await boundedJsonBody.readBoundedJsonBody(
      new Request("https://play.example/api", {
        method: "POST",
        headers: { "content-type": "application/vnd.lore+json; charset=utf-8" },
        body: JSON.stringify({ ok: true }),
      }),
      64,
    ),
    { ok: true, value: { ok: true } },
  );
  assert.deepEqual(
    await boundedJsonBody.readBoundedJsonBody(
      new Request("https://play.example/api", { method: "POST", headers: { "content-type": "application/json" }, body: "{" }),
      64,
    ),
    { ok: false, reason: "invalid" },
  );
  assert.deepEqual(
    await boundedJsonBody.readBoundedJsonBody(
      new Request("https://play.example/api", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: new Uint8Array([...new TextEncoder().encode('{"value":"'), 0xff, ...new TextEncoder().encode('"}')]),
      }),
      64,
    ),
    { ok: false, reason: "invalid" },
    "bounded JSON body parser must fail closed on malformed UTF-8 instead of accepting replacement characters",
  );
  assert.match(
    readFileSync("app/api/_lib/boundedJsonBody.ts", "utf8"),
    /await reader\.cancel\(\)\.catch\(\(\) => undefined\)[\s\S]*return \{ ok: false, reason: "too-large" \}/,
    "bounded JSON body cancellation failures must not downgrade an oversized request to invalid JSON",
  );
  assert.match(
    readFileSync("app/api/_lib/boundedJsonBody.ts", "utf8"),
    /const MAX_JSON_BODY_BYTES = 256 \* 1024[\s\S]*MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function parseContentLengthHeader[\s\S]*const parsed = BigInt\(value\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)[\s\S]*function normalizeJsonBodyMaxBytes[\s\S]*Number\.isSafeInteger\(value\) && value > 0 && value <= MAX_JSON_BODY_BYTES[\s\S]*const byteLimit = normalizeJsonBodyMaxBytes\(maxBytes\)[\s\S]*byteLimit === null[\s\S]*contentLength === -1/,
    "bounded JSON body parser must reject malformed or non-canonical Content-Length and invalid maxBytes before body reads",
  );
}
