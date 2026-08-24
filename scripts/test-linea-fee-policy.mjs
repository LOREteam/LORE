import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { decodeFunctionData } from "viem";
import * as lineaFeesModule from "../app/lib/lineaFees.ts";
import * as miningAllowanceModule from "../app/hooks/useMiningAllowance.ts";
import * as miningRuntimeHelpersModule from "../app/hooks/useMiningRuntimeHelpers.ts";
import * as miningSharedModule from "../app/hooks/useMining.shared.ts";

const lineaFees = lineaFeesModule.default ?? lineaFeesModule;
const miningAllowance = miningAllowanceModule.default ?? miningAllowanceModule;
const miningRuntimeHelpers = miningRuntimeHelpersModule.default ?? miningRuntimeHelpersModule;
const miningShared = miningSharedModule.default ?? miningSharedModule;

assert.equal(
  lineaFees.assertNormalFeeBudget(
    { maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 60_000_000n },
    2_000_000n,
    59144,
  ),
  2_000_000_000_000_000n,
  "a normal mainnet EIP-1559 send exactly at the absolute budget must remain valid",
);
assert.equal(
  lineaFees.assertNormalFeeBudget(
    { gasPrice: 100_000_000n },
    700_000n,
    59144,
  ),
  70_000_000_000_000n,
  "a bounded normal mainnet legacy send must remain valid",
);
assert.equal(
  lineaFees.assertNormalFeeBudget(
    { maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 80_000_000n },
    2_000_000n,
    59141,
  ),
  4_000_000_000_000_000n,
  "a normal Sepolia send exactly at its chain-specific budget must remain valid",
);
assert.equal(
  lineaFees.assertNormalFeeBudget(
    lineaFees.getFallbackFeeOverrides(59144, "normal"),
    25_600_000n,
    59144,
  ),
  1_536_000_000_000_000n,
  "the largest existing reward-batch fallback must remain within the normal mainnet budget",
);
assert.deepEqual(
  lineaFees.mergeFeeOverrides(
    { maxFeePerGas: 100_000_000n, maxPriorityFeePerGas: 10_000_000n },
    { maxPriorityFeePerGas: 60_000_000n },
  ),
  { maxFeePerGas: 100_000_000n, maxPriorityFeePerGas: 60_000_000n },
  "a bounded partial EIP-1559 override must merge with resolved fees",
);
assert.deepEqual(
  lineaFees.mergeFeeOverrides(
    { maxFeePerGas: 100_000_000n, maxPriorityFeePerGas: 10_000_000n },
    { gasPrice: 100_000_000n },
  ),
  { gasPrice: 100_000_000n },
  "a complete bounded legacy override must replace resolved EIP-1559 fields",
);
const oversizedMergedPriority = lineaFees.mergeFeeOverrides(
  { maxFeePerGas: 100_000_000n, maxPriorityFeePerGas: 10_000_000n },
  { maxPriorityFeePerGas: 60_000_001n },
);
assert.throws(
  () => lineaFees.assertNormalFeeBudget(oversizedMergedPriority, 21_000n, 59144),
  /linea_fee_field_cap_exceeded field=maxPriorityFeePerGas/,
  "an oversized partial caller override must be rejected after merging",
);

for (const [overrides, expectedError] of [
  [{ gasPrice: 1_000_000_001n }, /linea_fee_field_cap_exceeded field=gasPrice/],
  [{ maxFeePerGas: 1_000_000_001n, maxPriorityFeePerGas: 60_000_000n }, /linea_fee_field_cap_exceeded field=maxFeePerGas/],
  [{ maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 60_000_001n }, /linea_fee_field_cap_exceeded field=maxPriorityFeePerGas/],
  [{ gasPrice: 100_000_000n, maxFeePerGas: 100_000_000n, maxPriorityFeePerGas: 10_000_000n }, /linea_fee_policy_mixed_fee_fields/],
]) {
  assert.throws(
    () => lineaFees.assertNormalFeeBudget(overrides, 21_000n, 59144),
    expectedError,
  );
}
assert.throws(
  () => lineaFees.assertNormalFeeBudget(
    { maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 60_000_000n },
    2_000_001n,
    59144,
  ),
  /linea_fee_total_cap_exceeded kind=normal/,
  "normal fees within their field caps must still fail when total maximum gas cost is over budget",
);
assert.throws(
  () => lineaFees.assertNormalFeeBudget(
    { maxFeePerGas: 100_000_000n, maxPriorityFeePerGas: 10_000_000n },
    undefined,
    59144,
  ),
  /linea_fee_policy_missing_gas_limit/,
  "normal contract sends without a gas limit must fail closed",
);
assert.throws(
  () => lineaFees.assertNormalFeeBudget(
    lineaFees.getLineaFeeOverrides({ gasPrice: 100_000_000_000n }, 59144),
    21_000n,
    59144,
  ),
  /linea_fee_field_cap_exceeded field=gasPrice/,
  "an adversarial RPC legacy estimate must remain rejected after the normal bump transform",
);
assert.throws(
  () => lineaFees.assertNormalFeeBudget(
    lineaFees.getLineaFeeOverrides(
      { maxFeePerGas: 100_000_000_000n, maxPriorityFeePerGas: 10_000_000n },
      59144,
    ),
    21_000n,
    59144,
  ),
  /linea_fee_field_cap_exceeded field=maxFeePerGas/,
  "an adversarial RPC EIP-1559 estimate must remain rejected after the normal bump transform",
);
let terminalMiningFeeError;
try {
  lineaFees.assertNormalFeeBudget(
    { gasPrice: 1_000_000_001n },
    21_000n,
    59144,
  );
} catch (error) {
  terminalMiningFeeError = error;
}
assert.ok(terminalMiningFeeError instanceof Error, "the malicious legacy fee must produce a policy error");
assert.equal(
  miningShared.isDeterministicBetExecutionError(terminalMiningFeeError),
  true,
  "a fee-policy rejection must be terminal before manual or Auto-Miner wallet fallback",
);
assert.match(
  miningShared.getBetErrorMessage(terminalMiningFeeError),
  /fee safety limit was exceeded/,
  "a terminal fee-policy rejection must keep a clear user-facing failure state",
);

assert.deepEqual(
  lineaFees.getKeeperFeeOverrides(
    { maxFeePerGas: 50_000_000n, maxPriorityFeePerGas: 20_000_000n },
    59144,
  ),
  { maxFeePerGas: 65_000_000n, maxPriorityFeePerGas: 25_000_000n },
  "normal Linea mainnet keeper fees must retain the existing bumps",
);

assert.deepEqual(
  lineaFees.getKeeperFeeOverrides(
    { maxFeePerGas: 1_500_000_000n, maxPriorityFeePerGas: 100_000_000n },
    59141,
    100n,
    100n,
  ),
  { maxFeePerGas: 1_500_000_000n, maxPriorityFeePerGas: 100_000_000n },
  "the Sepolia field cap must retain its chain-specific headroom",
);

assert.throws(
  () => lineaFees.getKeeperFeeOverrides(
    { maxFeePerGas: 1_500_000_000n, maxPriorityFeePerGas: 100_000_000n },
    59144,
    100n,
    100n,
  ),
  /linea_fee_field_cap_exceeded field=maxFeePerGas/,
);
assert.throws(
  () => lineaFees.getKeeperFeeOverrides(
    { maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 200_000_001n },
    59144,
    100n,
    100n,
  ),
  /linea_fee_field_cap_exceeded field=maxPriorityFeePerGas/,
);
assert.throws(
  () => lineaFees.getKeeperFeeOverrides(
    { gasPrice: 1_000_000_001n },
    59144,
    100n,
    100n,
  ),
  /linea_fee_field_cap_exceeded field=gasPrice/,
);
assert.throws(
  () => lineaFees.getKeeperFeeOverrides(
    { maxFeePerGas: 1n, maxPriorityFeePerGas: 1n },
    1,
    100n,
    100n,
  ),
  /linea_fee_policy_unsupported_chain/,
);

assert.equal(
  lineaFees.assertKeeperFeeBudget(
    { maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 20_000_000n },
    100_000n,
    59144,
    "approval",
  ),
  100_000_000_000_000n,
  "an approval exactly at the fixed mainnet budget must remain valid",
);
assert.throws(
  () => lineaFees.assertKeeperFeeBudget(
    { maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 20_000_000n },
    100_001n,
    59144,
    "approval",
  ),
  /linea_fee_total_cap_exceeded kind=approval/,
);
assert.equal(
  lineaFees.assertKeeperFeeBudget(
    { maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 20_000_000n },
    1_000_000n,
    59144,
    "keeper",
  ),
  1_000_000_000_000_000n,
  "a keeper resolve exactly at the fixed mainnet budget must remain valid",
);
assert.throws(
  () => lineaFees.assertKeeperFeeBudget(
    { maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 20_000_000n },
    1_000_001n,
    59144,
    "keeper",
  ),
  /linea_fee_total_cap_exceeded kind=keeper/,
);

let approvalFeeEstimateCalls = 0;
let approvalFeePolicyHelpers;
function ApprovalFeePolicyProbe() {
  approvalFeePolicyHelpers = miningRuntimeHelpers.useMiningRuntimeHelpers({
    getActorAddress: () => null,
    publicClientRef: {
      current: {
        estimateFeesPerGas: async () => {
          approvalFeeEstimateCalls += 1;
          return { gasPrice: 100_000_000_000n };
        },
      },
    },
    tokenGetterWarningShownRef: { current: false },
    gasBumpBase: 110n,
    minGasPlaceBet: 180_000n,
    minGasPlaceBatch: 260_000n,
    gasCostBufferBps: 12_000n,
    bpsDenominator: 10_000n,
    recordEstimateGasShadow: () => undefined,
  });
  return null;
}
renderToStaticMarkup(React.createElement(ApprovalFeePolicyProbe));
await assert.rejects(
  () => approvalFeePolicyHelpers.getApproveFees(),
  /linea_fee_field_cap_exceeded field=gasPrice/,
  "browser approval fees must rethrow fee-policy violations before silent submission",
);
assert.equal(
  approvalFeeEstimateCalls,
  1,
  "browser approval fee policy must validate the real resolved estimate",
);

const miningAllowanceSource = readFileSync("app/hooks/useMiningAllowance.ts", "utf8");
  assert.match(
    miningAllowanceSource,
    /\} else \{\s*approveHash = await executeReservedMiningApprovalWalletSink\(\s*reservation,\s*async \(\) => assertBeforeSend\?\.\(\),\s*async \(\) => readWriteContractAsync\(\)\(\s*buildDirectApprovalWriteRequest\(approvalNonce, requiredAmount, approveOverrides\)/,
    "the guarded approval request must be built inside the reserved direct wallet sink",
  );

const directLegacyApproval = miningAllowance.buildDirectApprovalWriteRequest(
  7,
  123_456n,
  { gasPrice: 100_000_000n },
);
assert.equal(directLegacyApproval.args[1], 123_456n, "direct approval must grant exactly the required mining amount");
const silentApproval = decodeFunctionData({
  abi: directLegacyApproval.abi,
  data: miningAllowance.buildMiningApprovalCalldata(654_321n),
});
assert.equal(silentApproval.functionName, "approve");
assert.equal(silentApproval.args[1], 654_321n, "silent approval must grant exactly the required mining amount");
assert.throws(
  () => miningAllowance.buildMiningApprovalCalldata(0n),
  /positive bigint/,
  "approval builders must reject a zero-value wallet prompt",
);
assert.equal(directLegacyApproval.gas, 90_000n, "direct approval must carry the fixed gas limit");
assert.equal(directLegacyApproval.gasPrice, 100_000_000n, "direct approval must preserve bounded legacy gasPrice");
assert.equal(
  "maxFeePerGas" in directLegacyApproval,
  false,
  "legacy approval must not be reinterpreted as an incomplete EIP-1559 request",
);
const attemptedGasOverride = miningAllowance.buildDirectApprovalWriteRequest(
  7,
  42n,
  { gasPrice: 100_000_000n, gas: 9_000_000n },
);
assert.equal(
  attemptedGasOverride.gas,
  90_000n,
  "runtime-only extra fields must not override the fixed direct approval gas limit",
);

const directEip1559Approval = miningAllowance.buildDirectApprovalWriteRequest(
  8,
  900n,
  { maxFeePerGas: 1_000_000_000n, maxPriorityFeePerGas: 20_000_000n },
);
assert.equal(directEip1559Approval.args[1], 900n, "exact approval must be preserved with EIP-1559 fees");
assert.equal(directEip1559Approval.gas, 90_000n, "EIP-1559 approval must carry the same fixed gas limit");
assert.equal(directEip1559Approval.maxFeePerGas, 1_000_000_000n);
assert.equal(directEip1559Approval.maxPriorityFeePerGas, 20_000_000n);
assert.throws(
  () => miningAllowance.buildDirectApprovalWriteRequest(9, 1n, { gasPrice: 2_000_000_001n }),
  /linea_fee_field_cap_exceeded field=gasPrice/,
  "an adversarial legacy approval fee must fail before the wallet prompt",
);
assert.throws(
  () => miningAllowance.buildDirectApprovalWriteRequest(10, 1n, undefined),
  /linea_fee_policy_missing_overrides/,
  "direct approval must fail closed rather than let the wallet choose unbounded fees",
);

const privyWalletSource = readFileSync("app/hooks/usePrivyWallet.ts", "utf8");
assert.match(
  privyWalletSource,
  /const effectiveFees = mergeFeeOverrides\(resolvedFees, gasOverrides\);[\s\S]*assertNormalFeeBudget\(effectiveFees, effectiveGas, APP_CHAIN_ID\);[\s\S]*assertKeeperFeeBudget\(effectiveFees, effectiveGas \?\? 0n, APP_CHAIN_ID, "keeper"\);[\s\S]*applyFeeOverrides\(baseRequest, effectiveFees, false\);[\s\S]*sendTransaction\(baseRequest/,
  "the final silent-send boundary must reject over-budget merged normal and keeper fees before Privy submission",
);
assert.match(
  privyWalletSource,
  /const effectiveGas = tx\.gas \?\? \([\s\S]*tx\.data === undefined \? NORMAL_VALUE_TRANSFER_GAS_LIMIT : undefined[\s\S]*assertNormalFeeBudget\(effectiveFees, effectiveGas, APP_CHAIN_ID\)/,
  "plain value transfers must use an explicit gas limit and data-bearing sends must provide one for total-cost validation",
);

const standardBetPathSource = readFileSync("app/hooks/useMiningStandardBetPath.ts", "utf8");
assert.match(
  standardBetPathSource,
  /const resolvedFees = hasCompleteFeeOverrides\(gasOverrides\)[\s\S]*const overrides = mergeFeeOverrides\(resolvedFees, gasOverrides\)/,
  "the external-wallet mining path must merge partial caller fees with bounded resolved fees",
);
assert.match(
  standardBetPathSource,
  /const writeAuthorizedContract = async \([\s\S]*args: Record<string, unknown>,[\s\S]*calldata: `0x\$\{string\}`,[\s\S]*gas: bigint,[\s\S]*assertNormalFeeBudget\(overrides, gas, APP_CHAIN_ID\);[\s\S]*await epochWriteGuard\.assertBeforeWalletWrite\(\);[\s\S]*reserveSubmission\([\s\S]*executeReservedMiningWalletSink\([\s\S]*epochWriteGuard\.assertBeforeWalletWrite,[\s\S]*writeContractAsync\(/,
  "the final external-wallet mining sink must enforce fee and epoch policy, reserve exact calldata, and submit only through the guarded durable sink",
);
assert.equal(
  (standardBetPathSource.match(/writeAuthorizedContract\(\{/g) ?? []).length,
  5,
  "all five external-wallet mining selectors must share the guarded signing sink",
);
assert.equal(
  (standardBetPathSource.match(/\}, calldata, gas\);/g) ?? []).length,
  5,
  "every external-wallet mining selector must pass exact calldata and gas to the guarded signing sink",
);

for (const [label, file] of [
  ["manual mining", "app/hooks/useMiningBetExecution.ts"],
  ["Auto-Miner", "app/hooks/useMiningRoundBetting.ts"],
]) {
  const source = readFileSync(file, "utf8");
  assert.match(
    source,
    /isDeterministicBetExecutionError\(error\)[\s\S]*throw error;[\s\S]*fallback to wallet write|isDeterministicBetExecutionError\(error\)[\s\S]*throw error;[\s\S]*falling back to wallet write/,
    `${label} must reject fee-policy errors before wallet-write fallback`,
  );
}

const keeperBotSource = readFileSync("bot.ts", "utf8");
assert.match(
  keeperBotSource,
  /const gas = \(est \* gasLimitMarginPercent \+ 99n\) \/ 100n;[\s\S]*assertKeeperFeeBudget\([\s\S]*"keeper"[\s\S]*keeperBalance < requiredMaxCost[\s\S]*account\.signTransaction/,
  "keeper must reject an over-budget resolve before wallet submission",
);
assert.doesNotMatch(
  keeperBotSource,
  /clampKeeperFeeOverridesToBalance|getAffordableKeeperGasLimit/,
  "keeper must not reduce RPC-derived fees or gas to fit its wallet balance",
);

const bootstrapResolveSource = readFileSync("app/api/bootstrap-resolve/route.ts", "utf8");
assert.match(
  bootstrapResolveSource,
  /const gas = \([\s\S]*gasEstimate \* RESOLVE_GAS_BUFFER_PERCENT \+ 99n[\s\S]*assertKeeperFeeBudget\([\s\S]*"keeper"[\s\S]*keeperBalance < requiredMaxCost[\s\S]*account\.signTransaction[\s\S]*savePendingResolveRecord\([\s\S]*broadcastSignedResolve\(/,
  "bootstrap resolve must enforce the absolute keeper budget before local signing and persist the signed transaction before broadcast",
);

const liveRoundCanarySource = readFileSync("scripts/live-round-canary.ts", "utf8");
assert.match(
  liveRoundCanarySource,
  /function getBudgetedLiveGasLimit\([\s\S]*assertKeeperFeeBudget\(feeOverrides, gas, APP_CHAIN\.id, kind\)[\s\S]*nativeBalance >= requiredMaxCost/,
  "live canary writes must share the absolute fee-budget helper",
);
assert.match(
  liveRoundCanarySource,
  /resolveIfNeeded[\s\S]*getBudgetedLiveGasLimit\(gas, nativeBalance, fees, "keeper"\)[\s\S]*functionName: "resolveEpoch"[\s\S]*\.\.\.fees/,
  "live canary resolve must enforce the keeper budget before signing",
);
assert.match(
  liveRoundCanarySource,
  /ensureAllowance[\s\S]*getBudgetedLiveGasLimit\(gasEstimate\.value, nativeBalance, fees, "approval"\)[\s\S]*functionName: "approve"[\s\S]*\.\.\.fees/,
  "live canary approval must enforce the approval budget before signing",
);
assert.match(
  liveRoundCanarySource,
  /placeRound[\s\S]*getBudgetedLiveGasLimit\(gas, nativeBalance, fees, "keeper"\)[\s\S]*walletClient\.writeContract[\s\S]*\.\.\.fees/,
  "live canary bets must enforce the keeper-sized live-write budget before signing",
);

const playtestWalletSource = readFileSync("scripts/playtest-wallet.ts", "utf8");
assert.match(
  playtestWalletSource,
  /function getBudgetedPlaytestGasLimit\([\s\S]*assertKeeperFeeBudget\(feeOverrides, gas, APP_CHAIN\.id, kind\)[\s\S]*nativeBalance < requiredMaxCost/,
  "playtest writes must share the absolute fee-budget helper",
);
assert.equal(
  (playtestWalletSource.match(/getBudgetedPlaytestGasLimit\(/g) ?? []).length,
  7,
  "all six playtest write sites must use the budget helper",
);
assert.match(
  playtestWalletSource,
  /ensureAllowance[\s\S]*getBudgetedPlaytestGasLimit\([\s\S]*"approval"[\s\S]*functionName: "approve"/,
  "playtest approval must use the lower approval budget",
);

for (const [label, source] of [
  ["keeper bot", keeperBotSource],
  ["bootstrap resolve", bootstrapResolveSource],
  ["live round canary", liveRoundCanarySource],
  ["playtest wallet", playtestWalletSource],
]) {
  assert.doesNotMatch(
    source,
    /clampKeeperFeeOverridesToBalance|getAffordableKeeperGasLimit/,
    `${label} must not fit RPC-derived transaction cost to wallet balance`,
  );
}

console.log("linea fee policy tests passed");
