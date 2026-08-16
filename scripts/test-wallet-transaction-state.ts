import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { selectApprovalSubmissionNonce } from "../app/hooks/useMiningAllowance";
import { assertPendingTxRepairNonceIsUntracked } from "../app/hooks/useWalletActions";
import { didPreferredMiningActorChange } from "../app/hooks/useMiningRuntimeState";
import {
  createMiningEpochWriteGuard,
  executeReservedMiningWalletSink,
  settleRecoveredMiningAttempt,
  shouldClearDefinitelyUnsentMiningReservation,
  shouldRecoverSilentSendAsPending,
} from "../app/hooks/useMiningStandardBetPath";
import { selectBootstrapApprovalSubmissionNonce } from "../app/lib/mining/autoMineBootstrap";
import {
  clearPendingMiningApprovalState,
  clearPendingMiningTxState,
  executeReservedMiningApprovalWalletSink,
  readPendingMiningApprovalState,
  readPendingMiningTxState,
  withPendingMiningApprovalLock,
  writePendingMiningApprovalState,
  writePendingMiningTxState,
  hasTrackedMiningNonce,
} from "../app/lib/miningTxPath";
import {
  createWalletTransferIntent,
  hasTrackedWalletTransferNonce,
  withWalletTransferIntentLease,
} from "../app/lib/walletTransferIntent";
import { APP_CHAIN_ID } from "../app/lib/constants";

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
  let confirmedRecoveryClears = 0;
  let confirmedRecoverySends = 0;
  const confirmedRecovery = settleRecoveredMiningAttempt("confirmed", () => {
    confirmedRecoveryClears += 1;
  });
  if (confirmedRecovery === null) confirmedRecoverySends += 1;
  assert.equal(confirmedRecovery, "confirmed");
  assert.equal(confirmedRecoveryClears, 1);
  assert.equal(
    confirmedRecoverySends,
    0,
    "a verified confirmed recovery must terminate the current attempt without a second send",
  );

  let revertedRecoveryClears = 0;
  assert.equal(
    settleRecoveredMiningAttempt("clear", () => {
      revertedRecoveryClears += 1;
    }),
    null,
    "a verified reverted recovery may clear the old reservation and allow a distinct new attempt",
  );
  assert.equal(revertedRecoveryClears, 1);

  const boundaryActor = "0x5555555555555555555555555555555555555555" as const;
  const boundaryContract = "0x6666666666666666666666666666666666666666" as const;
  const boundarySpender = "0x7777777777777777777777777777777777777777" as const;
  const boundaryHash = `0x${"e".repeat(64)}` as `0x${string}`;
  const priorWindow = globalThis.window;
  const priorNavigator = globalThis.navigator;
  const boundaryStorage = new Map<string, string>();
  try {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          get length() { return boundaryStorage.size; },
          key: (index: number) => Array.from(boundaryStorage.keys())[index] ?? null,
          getItem: (key: string) => boundaryStorage.get(key) ?? null,
          setItem: (key: string, value: string) => boundaryStorage.set(key, value),
          removeItem: (key: string) => boundaryStorage.delete(key),
        },
      },
    });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        locks: {
          request: async (_name: string, _options: unknown, callback: (lock: object) => Promise<unknown>) => callback({}),
        },
      },
    });

    assert.equal(writePendingMiningTxState({
      chainId: APP_CHAIN_ID,
      contract: boundaryContract,
      actor: boundaryActor,
      nonce: 1,
    }), true);
    assert.equal(
      hasTrackedMiningNonce(APP_CHAIN_ID, boundaryActor, 1),
      true,
      "Settings repair must detect a tracked mining bet nonce",
    );
    assert.equal(hasTrackedMiningNonce(APP_CHAIN_ID, boundaryActor, 99), false);
    assert.throws(
      () => assertPendingTxRepairNonceIsUntracked(APP_CHAIN_ID, boundaryActor, 1),
      /pending_tx_repair_tracked_nonce/,
    );
    const preSinkMiningState = readPendingMiningTxState(APP_CHAIN_ID, boundaryContract, boundaryActor);
    assert.ok(preSinkMiningState);
    let epochRolloverSinkCalls = 0;
    await assert.rejects(
      executeReservedMiningWalletSink(
        preSinkMiningState,
        async () => { throw new Error("Epoch changed before wallet write"); },
        async () => {
          epochRolloverSinkCalls += 1;
          return boundaryHash;
        },
      ),
      /epoch changed/i,
    );
    assert.equal(epochRolloverSinkCalls, 0, "epoch rollover before the wallet sink must produce zero sends");
    assert.equal(
      readPendingMiningTxState(APP_CHAIN_ID, boundaryContract, boundaryActor),
      null,
      "a verified reservation must clear when the final guard fails before the sink",
    );

    assert.equal(writePendingMiningTxState({
      chainId: APP_CHAIN_ID,
      contract: boundaryContract,
      actor: boundaryActor,
      nonce: 2,
    }), true);
    const rejectedMiningState = readPendingMiningTxState(APP_CHAIN_ID, boundaryContract, boundaryActor);
    assert.ok(rejectedMiningState);
    const rejected = Object.assign(new Error("User rejected the request"), { code: 4001 });
    await assert.rejects(
      executeReservedMiningWalletSink(rejectedMiningState, () => undefined, async () => { throw rejected; }),
      /user rejected/i,
    );
    assert.equal(
      readPendingMiningTxState(APP_CHAIN_ID, boundaryContract, boundaryActor),
      null,
      "an unequivocal wallet rejection before any hash exists must exact-clear the verified reservation",
    );

    assert.equal(writePendingMiningTxState({
      chainId: APP_CHAIN_ID,
      contract: boundaryContract,
      actor: boundaryActor,
      nonce: 3,
    }), true);
    const ambiguousMiningState = readPendingMiningTxState(APP_CHAIN_ID, boundaryContract, boundaryActor);
    assert.ok(ambiguousMiningState);
    const nestedBroadcastTimeout = Object.assign(
      new Error('The contract function "placeBet" reverted.'),
      {
        name: "ContractFunctionExecutionError",
        cause: Object.assign(new Error("eth_sendTransaction timed out after provider acceptance"), {
          name: "TimeoutError",
        }),
      },
    );
    await assert.rejects(
      executeReservedMiningWalletSink(ambiguousMiningState, () => undefined, async () => {
        throw nestedBroadcastTimeout;
      }),
      /placeBet/,
    );
    assert.ok(
      readPendingMiningTxState(APP_CHAIN_ID, boundaryContract, boundaryActor),
      "a nested post-broadcast timeout must retain the exact reconciliation latch",
    );
    assert.equal(clearPendingMiningTxState(APP_CHAIN_ID, boundaryContract, boundaryActor), true);

    assert.equal(writePendingMiningTxState({
      chainId: APP_CHAIN_ID,
      contract: boundaryContract,
      actor: boundaryActor,
      hash: boundaryHash,
    }), true);
    assert.equal(
      hasTrackedMiningNonce(APP_CHAIN_ID, boundaryActor, 99),
      true,
      "a legacy tracked mining hash with unknown nonce must block every self-cancel attempt",
    );
    assert.equal(clearPendingMiningTxState(APP_CHAIN_ID, boundaryContract, boundaryActor), true);

    assert.equal(writePendingMiningTxState({
      chainId: APP_CHAIN_ID,
      contract: boundaryContract,
      actor: boundaryActor,
      nonce: 4,
    }), true);
    const deterministicFailureState = readPendingMiningTxState(APP_CHAIN_ID, boundaryContract, boundaryActor);
    assert.ok(deterministicFailureState);
    await assert.rejects(
      executeReservedMiningWalletSink(deterministicFailureState, () => undefined, async () => {
        throw new Error("execution reverted: EpochEnded");
      }),
      /epochended/i,
    );
    assert.equal(
      readPendingMiningTxState(APP_CHAIN_ID, boundaryContract, boundaryActor),
      null,
      "an unequivocal deterministic pre-broadcast failure must exact-clear the verified reservation",
    );

    assert.equal(writePendingMiningTxState({
      chainId: APP_CHAIN_ID,
      contract: boundaryContract,
      actor: boundaryActor,
      nonce: 5,
    }), true);
    const successfulMiningState = readPendingMiningTxState(APP_CHAIN_ID, boundaryContract, boundaryActor);
    assert.ok(successfulMiningState);
    assert.equal(
      await executeReservedMiningWalletSink(successfulMiningState, () => undefined, async () => boundaryHash),
      boundaryHash,
    );
    assert.equal(
      readPendingMiningTxState(APP_CHAIN_ID, boundaryContract, boundaryActor)?.hash,
      boundaryHash,
      "the returned transaction hash must be durably attached before the sink helper resolves",
    );
    assert.equal(clearPendingMiningTxState(APP_CHAIN_ID, boundaryContract, boundaryActor), true);

    assert.equal(writePendingMiningTxState({
      chainId: APP_CHAIN_ID,
      contract: boundaryContract,
      actor: boundaryActor,
      nonce: 6,
    }), true);
    const attachmentFaultState = readPendingMiningTxState(APP_CHAIN_ID, boundaryContract, boundaryActor);
    assert.ok(attachmentFaultState);
    const originalSetItem = (globalThis.window as unknown as {
      localStorage: { setItem: (key: string, value: string) => void };
    }).localStorage.setItem;
    (globalThis.window as unknown as {
      localStorage: { setItem: (key: string, value: string) => void };
    }).localStorage.setItem = (key, value) => {
      if (value.includes(`"hash":"${boundaryHash}"`)) throw new Error("simulated hash persistence crash window");
      originalSetItem(key, value);
    };
    await assert.rejects(
      executeReservedMiningWalletSink(attachmentFaultState, () => undefined, async () => boundaryHash),
      /hash could not be persisted|manual reconciliation/i,
    );
    (globalThis.window as unknown as {
      localStorage: { setItem: (key: string, value: string) => void };
    }).localStorage.setItem = originalSetItem;
    assert.ok(
      readPendingMiningTxState(APP_CHAIN_ID, boundaryContract, boundaryActor),
      "a hash persistence fault must retain the reservation instead of clearing and permitting a resend",
    );
    assert.equal(clearPendingMiningTxState(APP_CHAIN_ID, boundaryContract, boundaryActor), true);

    const rejectedApprovalReservation = writePendingMiningApprovalState({
      chainId: APP_CHAIN_ID,
      token: boundaryContract,
      spender: boundarySpender,
      actor: boundaryActor,
      nonce: 3,
    });
    assert.ok(rejectedApprovalReservation);
    assert.equal(
      hasTrackedMiningNonce(APP_CHAIN_ID, boundaryActor, 3),
      true,
      "Settings repair must detect a tracked approval nonce",
    );
    await assert.rejects(
      executeReservedMiningApprovalWalletSink(
        rejectedApprovalReservation,
        () => undefined,
        async () => { throw Object.assign(new Error("User rejected the request"), { code: 4001 }); },
      ),
      /user rejected/i,
    );
    assert.equal(
      readPendingMiningApprovalState(APP_CHAIN_ID, boundaryContract, boundarySpender, boundaryActor),
      null,
      "a true wallet rejection before any approval hash exists may clear the exact reservation",
    );

    const approvalReservation = writePendingMiningApprovalState({
      chainId: APP_CHAIN_ID,
      token: boundaryContract,
      spender: boundarySpender,
      actor: boundaryActor,
      nonce: 3,
    });
    assert.ok(approvalReservation);
    const submittedHash = await executeReservedMiningApprovalWalletSink(
      approvalReservation,
      () => undefined,
      async () => boundaryHash,
    );
    const submittedApproval = writePendingMiningApprovalState({ ...approvalReservation, hash: submittedHash });
    assert.ok(submittedApproval);
    await assert.rejects(
      Promise.reject(Object.assign(new Error("receipt provider surfaced wallet rejection"), { code: 4001 })),
      /receipt provider/i,
    );
    assert.equal(
      readPendingMiningApprovalState(APP_CHAIN_ID, boundaryContract, boundarySpender, boundaryActor)?.hash,
      boundaryHash,
      "a rejection or error after approval hash persistence must never clear the durable latch",
    );
    await withPendingMiningApprovalLock({
      chainId: APP_CHAIN_ID,
      token: boundaryContract,
      spender: boundarySpender,
      actor: boundaryActor,
    }, async () => {
      assert.equal(
        clearPendingMiningApprovalState(APP_CHAIN_ID, boundaryContract, boundarySpender, boundaryActor),
        true,
        "sufficient allowance may clear durable approval only while holding the shared approval lock",
      );
    });
    assert.equal(readPendingMiningApprovalState(APP_CHAIN_ID, boundaryContract, boundarySpender, boundaryActor), null);
  } finally {
    if (priorWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else Object.defineProperty(globalThis, "window", { configurable: true, value: priorWindow });
    if (priorNavigator === undefined) delete (globalThis as { navigator?: unknown }).navigator;
    else Object.defineProperty(globalThis, "navigator", { configurable: true, value: priorNavigator });
  }


  const transferStorage = new Map<string, string>();
  const transferActor = "0x8888888888888888888888888888888888888888" as const;
  const transferIntent = createWalletTransferIntent({
    actor: transferActor,
    chainId: APP_CHAIN_ID,
    asset: "native",
    destination: boundaryActor,
    amountWei: 1n,
  });
  try {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          get length() { return transferStorage.size; },
          key: (index: number) => Array.from(transferStorage.keys())[index] ?? null,
          getItem: (key: string) => transferStorage.get(key) ?? null,
          setItem: (key: string, value: string) => transferStorage.set(key, value),
          removeItem: (key: string) => transferStorage.delete(key),
        },
      },
    });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        locks: {
          request: async (_name: string, _options: unknown, callback: (lock: object) => Promise<unknown>) => callback({}),
        },
      },
    });
    await withWalletTransferIntentLease(
      transferIntent,
      [
        { getTransactionCount: async ({ blockTag }) => blockTag === "latest" ? 7 : 8 },
        { getTransactionCount: async ({ blockTag }) => blockTag === "latest" ? 7 : 8 },
      ],
      async () => undefined,
    );
    assert.equal(hasTrackedWalletTransferNonce(APP_CHAIN_ID, transferActor, 8), true);
    assert.equal(hasTrackedWalletTransferNonce(APP_CHAIN_ID, transferActor, 7), false);
    assert.throws(
      () => assertPendingTxRepairNonceIsUntracked(APP_CHAIN_ID, transferActor, 8),
      /pending_tx_repair_tracked_nonce/,
    );
    assert.doesNotThrow(
      () => assertPendingTxRepairNonceIsUntracked(APP_CHAIN_ID, transferActor, 7),
    );
  } finally {
    if (priorWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else Object.defineProperty(globalThis, "window", { configurable: true, value: priorWindow });
    if (priorNavigator === undefined) delete (globalThis as { navigator?: unknown }).navigator;
    else Object.defineProperty(globalThis, "navigator", { configurable: true, value: priorNavigator });
  }

  for (const unresolvedRecovery of ["pending", "manual-reconciliation-required"] as const) {
    let unresolvedClears = 0;
    assert.equal(
      settleRecoveredMiningAttempt(unresolvedRecovery, () => {
        unresolvedClears += 1;
      }),
      "pending",
    );
    assert.equal(unresolvedClears, 0, `${unresolvedRecovery} must retain its recovery latch`);
  }

  const nestedBroadcastTimeout = Object.assign(
    new Error('The contract function "placeBet" reverted.'),
    {
      name: "ContractFunctionExecutionError",
      cause: Object.assign(new Error("eth_sendTransaction timed out after provider acceptance"), {
        name: "TimeoutError",
      }),
    },
  );
  assert.equal(
    shouldClearDefinitelyUnsentMiningReservation(nestedBroadcastTimeout),
    false,
    "a viem contract wrapper must not turn a nested post-broadcast timeout into a definitely-unsent error",
  );
  assert.equal(
    shouldClearDefinitelyUnsentMiningReservation(
      Object.assign(new Error('The contract function "placeBet" failed.'), {
        name: "ContractFunctionExecutionError",
        cause: new Error("ECONNRESET after eth_sendTransaction"),
      }),
    ),
    false,
    "a nested post-broadcast network failure must retain the reconciliation latch",
  );
  assert.equal(
    shouldClearDefinitelyUnsentMiningReservation(
      Object.assign(new Error("User rejected the request"), { code: 4001 }),
    ),
    true,
    "an explicit wallet rejection remains safe to clear",
  );
  assert.equal(
    shouldClearDefinitelyUnsentMiningReservation(new Error("execution reverted: EpochEnded")),
    true,
    "a deterministic pre-broadcast contract rejection remains safe to clear",
  );

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

  let staleApprovalWrites = 0;
  const staleGuard = createMiningEpochWriteGuard({
    expectedEpoch: 41n,
    readCurrentEpoch: async () => 42n,
  });
  await assert.rejects(
    async () => {
      await staleGuard.establish();
      staleApprovalWrites += 1;
    },
    /epoch changed/i,
    "a stale UI epoch must be rejected before allowance approval can start",
  );
  assert.equal(staleApprovalWrites, 0);

  await assert.rejects(
    () => createMiningEpochWriteGuard({
      readCurrentEpoch: async () => 42n,
    }).establish(),
    /expected epoch is unavailable/i,
    "a wallet path without an exact UI epoch must fail closed instead of adopting chain state implicitly",
  );

  const changingEpochReads = [42n, 43n];
  let changedEpochApprovalWrites = 0;
  const changingEpochGuard = createMiningEpochWriteGuard({
    expectedEpoch: 42n,
    readCurrentEpoch: async () => changingEpochReads.shift() ?? 43n,
  });
  assert.equal(await changingEpochGuard.establish(), 42n);
  await assert.rejects(
    async () => {
      await changingEpochGuard.assertBeforeWalletWrite();
      changedEpochApprovalWrites += 1;
    },
    /epoch changed/i,
    "an epoch transition during async allowance preflight must stop the approval sink",
  );
  assert.equal(changedEpochApprovalWrites, 0);

  const exactEpochEvents: string[] = [];
  const exactEpochGuard = createMiningEpochWriteGuard({
    expectedEpoch: 44n,
    readCurrentEpoch: async () => {
      exactEpochEvents.push("read:44");
      return 44n;
    },
    assertBeforeSend: () => {
      exactEpochEvents.push("authorization");
    },
  });
  assert.equal(await exactEpochGuard.establish(), 44n);
  await exactEpochGuard.assertBeforeWalletWrite();
  exactEpochEvents.push("approval-write");
  await exactEpochGuard.assertBeforeWalletWrite();
  exactEpochEvents.push("bet-write");
  assert.deepEqual(
    exactEpochEvents,
    [
      "read:44",
      "read:44",
      "authorization",
      "approval-write",
      "read:44",
      "authorization",
      "bet-write",
    ],
    "the legitimate exact-epoch path must recheck chain state and authorization immediately before each wallet write",
  );

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
    null,
    "a saved approval nonce must not authorize a replacement without exact two-RPC recovery",
  );
  assert.equal(
    selectBootstrapApprovalSubmissionNonce(latestConfirmedNonce, pendingNonceAfterUnrelatedTransaction),
    null,
    "Auto-Miner must not reuse a tracked approval nonce by age alone",
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
    /readAgreedPendingMiningApprovalNonce\(approvalAgreementClients, actor\)/,
  );
  assert.match(
    bootstrapSource,
    /readAgreedPendingMiningApprovalNonce\([\s\S]*approvalAgreementClients,[\s\S]*actorAddress/,
  );
  assert.match(
    allowanceSource,
    /readAgreedPendingMiningAllowance\([\s\S]*approvalAgreementClients,[\s\S]*LINEA_TOKEN_ADDRESS,[\s\S]*CONTRACT_ADDRESS,[\s\S]*actor/,
  );
  assert.match(
    bootstrapSource,
    /readAgreedPendingMiningAllowance\([\s\S]*approvalAgreementClients,[\s\S]*LINEA_TOKEN_ADDRESS,[\s\S]*CONTRACT_ADDRESS,[\s\S]*actorAddress/,
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
