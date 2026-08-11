import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import * as miningShared from "../app/hooks/useMining.shared.ts";
import * as miningLifecycle from "../app/hooks/useMiningLifecycle.ts";
import * as autoMineRuntime from "../app/lib/mining/autoMineRuntimeController.ts";

const miningSharedExports = miningShared.default ?? miningShared;
const miningLifecycleExports = miningLifecycle.default ?? miningLifecycle;
const autoMineRuntimeExports = autoMineRuntime.default ?? autoMineRuntime;

const ACTOR = "0x0000000000000000000000000000000000000001";
const NOW = 1_800_000_000_000;

const legacy = miningSharedExports.sanitizePersistedAutoMinerSession({
  active: true,
  runId: "run:legacy",
  actor: ACTOR,
  betStr: "1.5",
  blocks: 3,
  rounds: 7,
  nextRoundIndex: 2,
  lastPlacedEpoch: "15",
});
assert.ok(legacy);
assert.equal(legacy.active, false, "legacy persisted sessions must migrate as paused");
assert.equal(legacy.issuedAt, 0);
assert.equal(legacy.expiresAt, 0);
assert.equal(legacy.maxSpendPerBetRaw, "4500000000000000000");
assert.equal(legacy.totalSpendRaw, "31500000000000000000");
assert.equal(legacy.remainingSpendRaw, "22500000000000000000");
assert.deepEqual(
  miningSharedExports.sanitizePersistedAutoMinerSession(legacy),
  legacy,
  "migrated paused sessions must remain readable without becoming authorized",
);

let session = null;
let currentTime = NOW;
const controller = autoMineRuntimeExports.createAutoMineRuntimeController({
  clearSession: () => {
    session = null;
  },
  readSession: () => session,
  releaseTabLock: () => {},
  saveSession: (next) => {
    session = next;
  },
  now: () => currentTime,
});

session = legacy;
assert.deepEqual(controller.readRestorableRun(ACTOR), {
  kind: "paused",
  session: legacy,
});
assert.throws(
  () => controller.assertCurrentAuthorization(),
  /authorization is missing/i,
  "persisted state alone must never authorize a wallet send",
);

session = { ...legacy, active: true };
assert.equal(controller.readRestorableRun("0x0000000000000000000000000000000000000002").kind, "actor-mismatch");
assert.equal(session.active, false, "actor-mismatched persisted sessions must also be paused");

controller.persistStart({ actor: ACTOR, betStr: "1.5", blocks: 3, rounds: 7 });
assert.equal(session.active, true);
assert.equal(session.issuedAt, NOW);
assert.equal(session.expiresAt, NOW + miningSharedExports.AUTO_MINER_AUTHORIZATION_TTL_MS);
assert.equal(session.maxSpendPerBetRaw, "4500000000000000000");
assert.equal(session.totalSpendRaw, "31500000000000000000");
controller.assertCurrentAuthorization();
assert.doesNotThrow(() => controller.assertCurrentAuthorizationForActor(ACTOR));
assert.throws(
  () => controller.assertCurrentAuthorizationForActor("0x0000000000000000000000000000000000000002"),
  /wallet changed/i,
  "an Auto-Miner authorization must not be reusable by a replacement wallet",
);

const perBet = 4_500_000_000_000_000_000n;
controller.reserveSpend({ expectedEpoch: 101n, amountRaw: perBet });
assert.equal(session.remainingSpendRaw, "27000000000000000000");
controller.reserveSpend({ expectedEpoch: 101n, amountRaw: perBet });
assert.equal(session.remainingSpendRaw, "27000000000000000000", "same-epoch retry must reuse one reservation");
controller.persistCheckpoint({
  betStr: "1.5",
  blocks: 3,
  rounds: 7,
  nextRoundIndex: 1,
  lastPlacedEpoch: 101n,
});
assert.equal(session.remainingSpendRaw, "27000000000000000000");
assert.throws(
  () => controller.reserveSpend({ expectedEpoch: 102n, amountRaw: perBet + 1n }),
  /per-bet spend limit exceeded/i,
);
for (let epoch = 102n; epoch <= 107n; epoch += 1n) {
  controller.reserveSpend({ expectedEpoch: epoch, amountRaw: perBet });
}
assert.equal(session.remainingSpendRaw, "0");
assert.throws(
  () => controller.reserveSpend({ expectedEpoch: 108n, amountRaw: 1n }),
  /total remaining spend limit exceeded/i,
);

controller.persistStart({ actor: ACTOR, betStr: "1", blocks: 1, rounds: 1 });
currentTime += miningSharedExports.AUTO_MINER_AUTHORIZATION_TTL_MS;
assert.throws(() => controller.assertCurrentAuthorization(), /authorization expired/i);
assert.equal(session, null, "expired authorization must clear the persisted run");

controller.persistStart({ actor: ACTOR, betStr: "1", blocks: 1, rounds: 1 });
const legitimateLease = controller.reserveSpend({ expectedEpoch: 201n, amountRaw: 1_000_000_000_000_000_000n });
assert.doesNotThrow(
  () => legitimateLease.assertCurrent(),
  "a fresh explicit-start authorization must remain valid at the immediate send boundary",
);
controller.pauseAndRelease();
assert.equal(session.active, false, "unmount-style revocation must persist the run as paused");
assert.throws(
  () => legitimateLease.assertCurrent(),
  /authorization is missing|authorization is stale/i,
  "a paused run must revoke its outstanding sink lease",
);

controller.persistStart({ actor: ACTOR, betStr: "1", blocks: 1, rounds: 1 });
const stoppedLease = controller.reserveSpend({ expectedEpoch: 202n, amountRaw: 1_000_000_000_000_000_000n });
let releasePreSend;
const preSendGate = new Promise((resolve) => {
  releasePreSend = resolve;
});
let simulatedWalletSends = 0;
const stoppedPipeline = (async () => {
  await preSendGate;
  stoppedLease.assertCurrent();
  simulatedWalletSends += 1;
})();
controller.stopByUser();
releasePreSend();
await assert.rejects(
  stoppedPipeline,
  /authorization is missing|authorization is stale/i,
  "Stop during asynchronous preflight must revoke the sink-adjacent lease",
);
assert.equal(simulatedWalletSends, 0, "a stopped async pipeline must not reach the wallet sink");

controller.persistStart({ actor: ACTOR, betStr: "1", blocks: 1, rounds: 1 });
const expiringLease = controller.reserveSpend({ expectedEpoch: 203n, amountRaw: 1_000_000_000_000_000_000n });
currentTime += miningSharedExports.AUTO_MINER_AUTHORIZATION_TTL_MS;
assert.throws(
  () => expiringLease.assertCurrent(),
  /authorization expired/i,
  "TTL expiry during asynchronous preflight must revoke the sink-adjacent lease",
);

const runnerSource = readFileSync("app/hooks/useMiningAutoMineRunner.ts", "utf8");
const standardBetPathSource = readFileSync("app/hooks/useMiningStandardBetPath.ts", "utf8");
const allowanceSource = readFileSync("app/hooks/useMiningAllowance.ts", "utf8");
assert.match(
  runnerSource,
  /const authorizationLease = runtimeController\.reserveSpend\([\s\S]*assertCurrentAuthorizationForActor\(getPreferredActorAddress\(\)\);[\s\S]*authorizationLease\.assertCurrent/,
  "Auto-Miner must carry each reservation lease and the original-wallet check to the shared send path",
);
assert.match(
  runnerSource,
  /useEffect\([\s\S]*runtimeController\.pauseAndRelease\(\)/,
  "Auto-Miner must revoke its authorization lease on unmount",
);
assert.match(
  standardBetPathSource,
  /const writeAuthorizedContract = \(args: unknown, gas: bigint\) => \{\s*assertNormalFeeBudget\(overrides, gas, APP_CHAIN_ID\);\s*assertBeforeSend\?\.\(\);\s*return writeContractAsync\(args\);/,
  "wallet contract writes must revalidate both the fee budget and authorization immediately at the shared sink",
);
assert.equal(
  [...standardBetPathSource.matchAll(/await writeAuthorizedContract\(\{/g)].length,
  5,
  "every standard wallet-write bet variant must use the authorized sink wrapper",
);
assert.match(
  standardBetPathSource,
  /assertBeforeSend\?\.\(\);\s*hash = await silentSend\(/,
  "silent bets must revalidate authorization immediately at the shared sink",
);
assert.match(
  allowanceSource,
  /assertBeforeSend\?\.\(\);\s*approveHash = await silentSend\([\s\S]*\} else \{\s*assertBeforeSend\?\.\(\);\s*approveHash = await readWriteContractAsync\(\)\(/,
  "allowance writes reached from Auto-Miner must revalidate authorization at both wallet sinks",
);

let releaseDelayedRestore;
const delayedRestoreGate = new Promise((resolve) => {
  releaseDelayedRestore = resolve;
});
let explicitStartsInFlight = 1;
let restoreCalls = 0;
const delayedRestore = (async () => {
  await delayedRestoreGate;
  if (miningLifecycleExports.shouldSkipAutoMineRestore(explicitStartsInFlight, false)) return;
  restoreCalls += 1;
})();
releaseDelayedRestore();
await delayedRestore;
assert.equal(restoreCalls, 0, "a delayed restore must not override an explicit start already in flight");
assert.equal(
  miningLifecycleExports.shouldSkipAutoMineRestore(2, false),
  true,
  "overlapping explicit start calls must keep restore suppressed until every caller settles",
);
explicitStartsInFlight = 0;
if (!miningLifecycleExports.shouldSkipAutoMineRestore(explicitStartsInFlight, false)) restoreCalls += 1;
assert.equal(restoreCalls, 1, "a reload with no explicit start or active runtime must still inspect and pause saved state");

const lifecycleSource = readFileSync("app/hooks/useMiningLifecycle.ts", "utf8");
assert.match(
  lifecycleSource,
  /shouldSkipAutoMineRestore\(explicitStartsInFlightRef\.current, autoMineRef\.current\)[\s\S]*runtimeController\.readRestorableRun/,
  "the live restore callback must evaluate the synchronous explicit-start guard before reading or pausing saved state",
);
assert.match(
  lifecycleSource,
  /explicitStartsInFlightRef\.current \+= 1;[\s\S]*await runAutoMiningRef\.current[\s\S]*explicitStartsInFlightRef\.current = Math\.max\(0, explicitStartsInFlightRef\.current - 1\)/,
  "explicit-start suppression must span the complete asynchronous runner lifetime",
);

console.log("auto-miner persistence security: ok");
