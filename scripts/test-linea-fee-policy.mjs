import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as lineaFeesModule from "../app/lib/lineaFees.ts";

const lineaFees = lineaFeesModule.default ?? lineaFeesModule;

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

const miningRuntimeHelpersSource = readFileSync("app/hooks/useMiningRuntimeHelpers.ts", "utf8");
assert.match(
  miningRuntimeHelpersSource,
  /getApproveFees[\s\S]*getKeeperFeeOverrides\(fees, APP_CHAIN_ID, maxFeeBump, priorityBump\)[\s\S]*assertKeeperFeeBudget\(feeOverrides, APPROVAL_GAS_LIMIT, APP_CHAIN_ID, "approval"\)[\s\S]*catch \(err\)[\s\S]*if \(isLineaFeePolicyError\(err\)\) throw err/,
  "browser approval fees must fail closed on policy violations before silent submission",
);

const keeperBotSource = readFileSync("bot.ts", "utf8");
assert.match(
  keeperBotSource,
  /const gas = \(est \* gasLimitMarginPercent \+ 99n\) \/ 100n;[\s\S]*assertKeeperFeeBudget\([\s\S]*"keeper"[\s\S]*keeperBalance < requiredMaxCost[\s\S]*walletClient\.writeContract/,
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
  /const gas = \([\s\S]*gasEstimate \* RESOLVE_GAS_BUFFER_PERCENT \+ 99n[\s\S]*assertKeeperFeeBudget\([\s\S]*"keeper"[\s\S]*keeperBalance < requiredMaxCost[\s\S]*walletClient\.writeContract/,
  "bootstrap resolve must enforce the absolute keeper budget before signing",
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
