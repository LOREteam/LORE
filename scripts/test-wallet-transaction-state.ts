import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { selectApprovalSubmissionNonce } from "../app/hooks/useMiningAllowance";
import { didPreferredMiningActorChange } from "../app/hooks/useMiningRuntimeState";
import { shouldRecoverSilentSendAsPending } from "../app/hooks/useMiningStandardBetPath";
import { selectBootstrapApprovalSubmissionNonce } from "../app/lib/mining/autoMineBootstrap";

type SilentSubmissionResult =
  | { state: "success"; hash: `0x${string}` }
  | { state: "pending" }
  | { state: "throw"; error: unknown };

async function runSilentSubmission(
  send: () => Promise<`0x${string}`>,
): Promise<SilentSubmissionResult> {
  try {
    return { state: "success", hash: await send() };
  } catch (error) {
    return shouldRecoverSilentSendAsPending(error)
      ? { state: "pending" }
      : { state: "throw", error };
  }
}

async function main() {
  let acceptedBeforeError = false;
  const acceptedThenErrored = await runSilentSubmission(async () => {
    acceptedBeforeError = true;
    throw new Error("ECONNRESET after provider accepted eth_sendRawTransaction");
  });
  assert.equal(acceptedBeforeError, true);
  assert.deepEqual(
    acceptedThenErrored,
    { state: "pending" },
    "an accepted transaction followed by a generic network error must not enter wallet fallback",
  );

  const pendingTimeout = Object.assign(new Error("Privy sendTransaction timed out"), {
    name: "WalletSendTimeoutError",
  });
  assert.deepEqual(await runSilentSubmission(async () => { throw pendingTimeout; }), { state: "pending" });

  const rejected = Object.assign(new Error("User rejected the request"), { code: 4001 });
  assert.equal((await runSilentSubmission(async () => { throw rejected; })).state, "throw");
  assert.equal(
    (await runSilentSubmission(async () => { throw new Error("Transaction reverted before broadcast"); })).state,
    "throw",
  );
  assert.deepEqual(await runSilentSubmission(async () => "0x1234"), {
    state: "success",
    hash: "0x1234",
  });

  const latestConfirmedNonce = 7;
  const pendingNonceAfterUnrelatedTransaction = 8;
  assert.equal(
    selectApprovalSubmissionNonce(undefined, pendingNonceAfterUnrelatedTransaction),
    8,
    "fresh approval must queue after an unrelated pending transaction",
  );
  assert.equal(
    selectBootstrapApprovalSubmissionNonce(undefined, pendingNonceAfterUnrelatedTransaction),
    8,
    "fresh bootstrap approval must queue after an unrelated pending transaction",
  );
  assert.equal(
    selectApprovalSubmissionNonce(latestConfirmedNonce, pendingNonceAfterUnrelatedTransaction),
    7,
    "only a tracked app approval may deliberately reuse its saved nonce",
  );
  assert.equal(
    selectBootstrapApprovalSubmissionNonce(latestConfirmedNonce, pendingNonceAfterUnrelatedTransaction),
    7,
    "bootstrap replacement must retain the tracked app approval nonce",
  );
  assert.equal(selectApprovalSubmissionNonce(undefined, Number.MAX_SAFE_INTEGER + 1), null);
  assert.equal(selectBootstrapApprovalSubmissionNonce(undefined, -1), null);

  const actorA = "0x00000000000000000000000000000000000000aA";
  const actorB = "0x00000000000000000000000000000000000000bB";
  assert.equal(didPreferredMiningActorChange(actorA, actorA.toLowerCase()), false);
  assert.equal(didPreferredMiningActorChange(actorA, null), false, "transient wallet absence remains recoverable");
  assert.equal(didPreferredMiningActorChange(actorA, actorB), true, "a live signer hot-swap must stop the run");

  const allowanceSource = readFileSync("app/hooks/useMiningAllowance.ts", "utf8");
  const bootstrapSource = readFileSync("app/lib/mining/autoMineBootstrap.ts", "utf8");
  const standardBetSource = readFileSync("app/hooks/useMiningStandardBetPath.ts", "utf8");
  const runtimeStateSource = readFileSync("app/hooks/useMiningRuntimeState.ts", "utf8");
  assert.match(
    allowanceSource,
    /approve\.getTransactionCount[\s\S]*?blockTag: "pending"|blockTag: "pending"[\s\S]*?approve\.getTransactionCount/,
  );
  assert.match(
    bootstrapSource,
    /bootstrap\.getTransactionCount[\s\S]*?blockTag: "pending"|blockTag: "pending"[\s\S]*?bootstrap\.getTransactionCount/,
  );
  assert.match(
    standardBetSource,
    /catch \(error\) \{\s*if \(shouldRecoverSilentSendAsPending\(error\)\)/,
  );
  assert.match(
    runtimeStateSource,
    /if \(!preferredActorChanged\) \{[\s\S]*silentSendRef\.current[\s\S]*preferredAddressRef\.current[\s\S]*ensurePreferredWalletRef\.current/,
  );
  assert.match(
    runtimeStateSource,
    /if \(!preferredActorChanged\) return;[\s\S]*autoMineRef\.current = false;[\s\S]*Auto-Miner stopped because the embedded wallet changed/,
  );

  console.log("wallet transaction state tests passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
