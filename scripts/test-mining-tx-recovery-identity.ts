import assert from "node:assert/strict";
import { encodeFunctionData, maxUint256 } from "viem";

import { APP_CHAIN_ID, TOKEN_ABI } from "../app/lib/constants";
import { withEoaNonceLock } from "../app/lib/eoaNonceLock";
import {
  createWalletTransferIntent,
  withWalletTransferIntentLease,
} from "../app/lib/walletTransferIntent";
import {
  attachPendingMiningTxHash,
  clearPendingMiningApprovalState,
  clearPendingMiningTxState,
  parsePendingMiningFinalityBlocks,
  readAgreedPendingMiningAllowance,
  readAgreedPendingMiningApprovalNonce,
  readPendingMiningTxState,
  readPendingMiningApprovalState,
  recoverAndClearPendingMiningTx,
  recoverPendingMiningApproval,
  recoverPendingMiningTx,
  reservePendingMiningTxIntent,
  sanitizePendingMiningApprovalState,
  sanitizePendingMiningTxState,
  selectPendingMiningAgreementRpcUrls,
  waitForPendingMiningReceiptAgreement,
  withPendingMiningApprovalLock,
  writePendingMiningApprovalState,
  writePendingMiningTxState,
  type PendingMiningTxClient,
  type PendingMiningTxClients,
} from "../app/lib/miningTxPath";

const actor = "0x2222222222222222222222222222222222222222" as const;
const contract = "0x1111111111111111111111111111111111111111" as const;
const hash = `0x${"a".repeat(64)}` as `0x${string}`;
const calldata = "0x1234" as const;
const blockHash = `0x${"b".repeat(64)}` as `0x${string}`;
const receipt = { status: "success" as const, transactionHash: hash, blockHash, blockNumber: 10n, transactionIndex: 1 };
const transaction = { hash, from: actor, to: contract, type: "eip1559", nonce: 7, input: calldata, blockHash, blockNumber: 10n, transactionIndex: 1 };
const approvalSpender = "0x3333333333333333333333333333333333333333" as const;
const approvalCalldata = encodeFunctionData({
  abi: TOKEN_ABI,
  functionName: "approve",
  args: [approvalSpender, maxUint256],
});
const standardApprovalAmount = 123n;
const standardApprovalCalldata = encodeFunctionData({
  abi: TOKEN_ABI,
  functionName: "approve",
  args: [approvalSpender, standardApprovalAmount],
});

function createClient(overrides: Partial<PendingMiningTxClient> = {}): PendingMiningTxClient {
  return {
    waitForTransactionReceipt: async () => receipt,
    getTransactionReceipt: async () => receipt,
    getTransaction: async () => transaction,
    getTransactionCount: async ({ blockTag }) => blockTag === "latest" ? 8 : 8,
    getChainId: async () => APP_CHAIN_ID,
    getBlockNumber: async () => 11n,
    getBlock: async () => ({ hash: blockHash }),
    readContract: async () => Array.from({ length: 25 }, (_, index) => index === 0 ? 5n : 0n),
    ...overrides,
  };
}

function pair(first: PendingMiningTxClient, second: PendingMiningTxClient = first): PendingMiningTxClients {
  return [first, second];
}

async function main() {
  assert.equal(parsePendingMiningFinalityBlocks("1"), 1n);
  assert.equal(parsePendingMiningFinalityBlocks("0"), null);
  assert.equal(parsePendingMiningFinalityBlocks("1e2"), null);
  assert.deepEqual(
    selectPendingMiningAgreementRpcUrls([
      "https://rpc-a.example/v1",
      "https://rpc-a.example/v2",
      "https://rpc-b.example/v1",
    ]).map((url) => new URL(url).hostname),
    ["rpc-a.example", "rpc-b.example"],
    "receipt recovery must select two distinct canonical RPC origins",
  );
  assert.throws(
    () => selectPendingMiningAgreementRpcUrls(["https://rpc-a.example/one", "https://rpc-a.example/two"]),
    /Two independent/,
  );

  const priorWindow = globalThis.window;
  const priorNavigator = globalThis.navigator;
  const storage = new Map<string, string>();
  try {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        localStorage: {
          get length() { return storage.size; },
          getItem: (key: string) => storage.get(key) ?? null,
          key: (index: number) => [...storage.keys()][index] ?? null,
          setItem: (key: string, value: string) => storage.set(key, value),
          removeItem: (key: string) => storage.delete(key),
        },
      },
    });
    Object.defineProperty(globalThis, "navigator", { configurable: true, value: {} });

    let noLockRpcCalls = 0;
    await assert.rejects(
      reservePendingMiningTxIntent(
        pair(createClient({
          getTransactionCount: async () => {
            noLockRpcCalls += 1;
            return 7;
          },
        })),
        {
          chainId: 59141,
          contract,
          actor,
          calldata,
          expectedEpoch: 12n,
          tileIds: [1],
          amountRawPerTile: 5n,
        },
      ),
      /Web Locks.*required/i,
      "a browser without a reliable cross-tab lock must fail closed",
    );
    assert.equal(noLockRpcCalls, 0, "the cross-tab guard must run before asynchronous RPC evidence");
    let noLockApprovalEntered = false;
    await assert.rejects(
      withPendingMiningApprovalLock({
        chainId: APP_CHAIN_ID,
        token: contract,
        spender: actor,
        actor,
      }, async () => {
        noLockApprovalEntered = true;
      }),
      /Web Locks.*required/i,
      "approval must fail closed when no reliable cross-tab primitive exists",
    );
    assert.equal(noLockApprovalEntered, false, "no-Web-Locks approval must stop before its operation callback");

    const nativeLocksHeld = new Set<string>();
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: {
        locks: {
          request: async (
            name: string,
            _options: unknown,
            callback: (lock: object | null) => Promise<unknown>,
          ) => {
            if (nativeLocksHeld.has(name)) return callback(null);
            nativeLocksHeld.add(name);
            try {
              return await callback({});
            } finally {
              nativeLocksHeld.delete(name);
            }
          },
        },
      },
    });

    let releaseApprovalOwner!: () => void;
    const approvalOwnerGate = new Promise<void>((resolve) => { releaseApprovalOwner = resolve; });
    const approvalOwner = withPendingMiningApprovalLock({
      chainId: APP_CHAIN_ID,
      token: contract,
      spender: actor,
      actor,
    }, async () => {
      await approvalOwnerGate;
      return "owner";
    });
    await Promise.resolve();
    let competingApprovalEntered = false;
    await assert.rejects(
      withPendingMiningApprovalLock({
        chainId: APP_CHAIN_ID,
        token: contract,
        spender: actor,
        actor,
      }, async () => {
        competingApprovalEntered = true;
        return "competitor";
      }),
      /Another tab/,
      "two browser contexts must not enter the same actor/token/spender approval sink",
    );
    assert.equal(competingApprovalEntered, false);
    releaseApprovalOwner();
    assert.equal(await approvalOwner, "owner");

    let releaseTransferOwner!: () => void;
    const transferOwnerGate = new Promise<void>((resolve) => { releaseTransferOwner = resolve; });
    let transferSinkEntries = 0;
    const transferIntent = createWalletTransferIntent({
      actor,
      chainId: APP_CHAIN_ID,
      asset: "native",
      destination: contract,
      amountWei: 1n,
    });
    const transferNonceClient = {
      getTransactionCount: async () => 6,
    };
    const transferOwner = withWalletTransferIntentLease(
      transferIntent,
      [transferNonceClient, transferNonceClient],
      async (acquisition) => {
        assert.equal(acquisition.status, "acquired");
        transferSinkEntries += 1;
        await transferOwnerGate;
        return "transfer-owner";
      },
    );
    await Promise.resolve();
    let approvalSinkEntries = 0;
    await assert.rejects(
      withPendingMiningApprovalLock({
        chainId: APP_CHAIN_ID,
        token: contract,
        spender: approvalSpender,
        actor,
      }, async () => {
        approvalSinkEntries += 1;
        return "approval-competitor";
      }),
      /already reserving or submitting/i,
      "a wallet transfer lock must exclude a mining approval nonce sink for the same actor and chain",
    );
    let repairSinkEntries = 0;
    await assert.rejects(
      withEoaNonceLock(
        { chainId: APP_CHAIN_ID, actor },
        { ifAvailable: true },
        async () => {
          repairSinkEntries += 1;
          return "repair-competitor";
        },
      ),
      /already reserving or submitting/i,
      "a wallet transfer lock must exclude Settings nonce repair for the same actor and chain",
    );
    assert.equal(transferSinkEntries, 1);
    assert.equal(approvalSinkEntries, 0);
    assert.equal(repairSinkEntries, 0);
    releaseTransferOwner();
    assert.equal(await transferOwner, "transfer-owner");
    storage.delete([
      "lineaore:wallet-transfer-intent:v1",
      transferIntent.chainId,
      transferIntent.actor,
      transferIntent.asset,
      transferIntent.destination,
      transferIntent.amountWei.toString(),
    ].join(":"));

    assert.equal(
      await withPendingMiningApprovalLock({
        chainId: APP_CHAIN_ID,
        token: contract,
        spender: approvalSpender,
        actor,
      }, async () => {
        approvalSinkEntries += 1;
        return "approval-sequential";
      }),
      "approval-sequential",
      "the legitimate approval path must enter after the transfer releases the shared nonce lock",
    );
    assert.equal(
      await withEoaNonceLock(
        { chainId: APP_CHAIN_ID, actor },
        { ifAvailable: true },
        async () => {
          repairSinkEntries += 1;
          return "repair-sequential";
        },
      ),
      "repair-sequential",
      "the legitimate Settings repair path must enter sequentially after the shared lock is released",
    );
    assert.equal(approvalSinkEntries, 1);
    assert.equal(repairSinkEntries, 1);

    let releaseApprovalDomain!: () => void;
    const approvalDomainGate = new Promise<void>((resolve) => { releaseApprovalDomain = resolve; });
    const approvalDomainOwner = withPendingMiningApprovalLock({
      chainId: APP_CHAIN_ID,
      token: contract,
      spender: approvalSpender,
      actor,
    }, async () => {
      await approvalDomainGate;
      return "approval-domain-owner";
    });
    await Promise.resolve();
    let competingMiningRpcCalls = 0;
    await assert.rejects(
      reservePendingMiningTxIntent(
        pair(createClient({
          getTransactionCount: async () => {
            competingMiningRpcCalls += 1;
            return 7;
          },
        })),
        {
          chainId: APP_CHAIN_ID,
          contract,
          actor,
          calldata,
          expectedEpoch: 12n,
          tileIds: [1],
          amountRawPerTile: 5n,
        },
      ),
      /already reserving or submitting/i,
      "an approval lock must exclude mining nonce evidence and reservation for the same actor and chain",
    );
    assert.equal(competingMiningRpcCalls, 0, "the shared lock must reject mining before any nonce RPC read");
    releaseApprovalDomain();
    assert.equal(await approvalDomainOwner, "approval-domain-owner");

    const approvalReservation = writePendingMiningApprovalState({
      chainId: APP_CHAIN_ID,
      token: contract,
      spender: actor,
      actor,
      nonce: 6,
      amountRaw: "1",
    });
    assert.ok(approvalReservation, "approval must be durably reserved before its wallet sink");
    assert.equal(
      readPendingMiningApprovalState(APP_CHAIN_ID, contract, actor, actor)?.nonce,
      6,
      "a reload/new context must recover the durable approval reservation",
    );
    assert.equal(clearPendingMiningApprovalState(APP_CHAIN_ID, contract, actor, actor), true);

    const approvalState = {
      chainId: APP_CHAIN_ID,
      token: contract,
      spender: approvalSpender,
      actor,
      nonce: 7,
      amountRaw: maxUint256.toString(),
      hash,
      ts: Date.now(),
    } as const;
    const approvalTransaction = {
      hash,
      from: actor,
      to: contract,
      type: "eip1559",
      nonce: 7,
      input: approvalCalldata,
      blockHash,
      blockNumber: 10n,
      transactionIndex: 1,
    };
    const approvalReceipt = { ...receipt, transactionHash: hash };
    const approvalClient = createClient({
      getTransaction: async () => approvalTransaction,
      getTransactionReceipt: async () => approvalReceipt,
    });
    assert.equal(
      await recoverPendingMiningApproval(pair(approvalClient), approvalState, 1n),
      "confirmed",
      "an exact finalized Auto-Miner max approval must recover as confirmed",
    );
    const standardApprovalState = {
      ...approvalState,
      amountRaw: standardApprovalAmount.toString(),
    };
    const standardApprovalClient = createClient({
      getTransaction: async () => ({ ...approvalTransaction, input: standardApprovalCalldata }),
      getTransactionReceipt: async () => approvalReceipt,
    });
    assert.equal(
      await recoverPendingMiningApproval(pair(standardApprovalClient), standardApprovalState, 1n),
      "confirmed",
      "an exact finalized standard-mining approval must recover with its persisted non-max amount",
    );
    assert.equal(
      sanitizePendingMiningApprovalState({
        chainId: APP_CHAIN_ID,
        token: contract,
        spender: approvalSpender,
        actor,
        nonce: 7,
        hash,
        ts: Date.now(),
      }),
      null,
      "legacy approval state without an exact amount must remain fail-closed",
    );
    const alteredApprovalCalldata = encodeFunctionData({
      abi: TOKEN_ABI,
      functionName: "approve",
      args: [approvalSpender, maxUint256 - 1n],
    });
    assert.equal(
      await recoverPendingMiningApproval(pair(createClient({
        getTransaction: async () => ({ ...approvalTransaction, input: alteredApprovalCalldata }),
        getTransactionReceipt: async () => approvalReceipt,
      })), approvalState, 1n),
      "manual-reconciliation-required",
      "a different approval amount must never satisfy the exact persisted intent",
    );
    const replacementHash = `0x${"d".repeat(64)}` as `0x${string}`;
    const replacementState = { ...approvalState, hash: replacementHash };
    const replacementClient = createClient({
      getTransaction: async () => ({ ...approvalTransaction, hash: replacementHash }),
      getTransactionReceipt: async () => ({ ...approvalReceipt, transactionHash: replacementHash }),
    });
    assert.equal(
      await recoverPendingMiningApproval(pair(replacementClient), replacementState, 1n),
      "confirmed",
      "an exact repriced replacement hash with the same approval intent and nonce must recover",
    );
    assert.equal(
      await recoverPendingMiningApproval(pair(createClient({
        getTransaction: async () => ({ ...approvalTransaction, input: "0x" }),
        getTransactionReceipt: async () => approvalReceipt,
      })), approvalState, 1n),
      "manual-reconciliation-required",
      "a same-nonce cancellation or different calldata must never unlock approval resend",
    );
    assert.equal(
      await recoverPendingMiningApproval(pair(createClient({
        getTransaction: async () => approvalTransaction,
        getTransactionReceipt: async () => ({ ...approvalReceipt, status: "reverted" as const }),
      })), approvalState, 1n),
      "reverted",
      "an exact reverted approval may clear only after two-RPC finality",
    );
    assert.equal(
      await recoverPendingMiningApproval(pair(approvalClient), { ...approvalState, hash: undefined }, 1n),
      "manual-reconciliation-required",
      "a nonce-only approval record cannot authorize age-based nonce reuse",
    );
    assert.equal(
      await readAgreedPendingMiningApprovalNonce(pair(createClient({
        getTransactionCount: async ({ blockTag }) => blockTag === "latest" ? 6 : 7,
      })), actor),
      7,
      "two RPC origins that agree on latest and pending nonce may reserve the exact pending nonce",
    );
    await assert.rejects(
      readAgreedPendingMiningApprovalNonce(pair(
        createClient({ getTransactionCount: async ({ blockTag }) => blockTag === "latest" ? 6 : 7 }),
        createClient({ getTransactionCount: async ({ blockTag }) => blockTag === "latest" ? 6 : 8 }),
      ), actor),
      /nonce evidence does not agree/i,
      "a lagging or malicious UI nonce cannot override two-RPC nonce disagreement",
    );
    assert.equal(
      await readAgreedPendingMiningAllowance(pair(createClient({ readContract: async () => 99n })), contract, approvalSpender, actor),
      99n,
      "two RPC origins that agree on allowance may unlock the legitimate sufficient-allowance path",
    );
    await assert.rejects(
      readAgreedPendingMiningAllowance(pair(
        createClient({ readContract: async () => 99n }),
        createClient({ readContract: async () => 0n }),
      ), contract, approvalSpender, actor),
      /allowance evidence does not agree/i,
      "allowance disagreement must retain the durable approval latch",
    );

    const reserved = await reservePendingMiningTxIntent(
      pair(createClient({ getTransactionCount: async () => 7, readContract: async () => Array(25).fill(0n) })),
      {
        chainId: 59141,
        contract,
        actor,
        calldata,
        expectedEpoch: 12n,
        tileIds: [1],
        amountRawPerTile: 5n,
      },
    );
    assert.equal(reserved.nonce, 7);
    assert.equal(reserved.baselineBets?.[0], "0");
    assert.equal(attachPendingMiningTxHash(reserved, hash), true);

    const persisted = sanitizePendingMiningTxState({ ...reserved, hash }, Date.now());
    assert.ok(persisted);
    assert.equal(
      await recoverPendingMiningTx(pair(createClient()), persisted, Date.now(), 1n),
      "confirmed",
      "two stable receipts, exact transaction identity, consumed nonce, and matching bet delta must confirm",
    );
    assert.equal(
      await recoverPendingMiningTx(pair(
        createClient(),
        createClient({ getTransaction: async () => ({ ...transaction, input: "0x5678" }) }),
      ), persisted, Date.now(), 1n),
      "manual-reconciliation-required",
      "RPC transaction identity disagreement must retain the duplicate-send block",
    );
    assert.equal(
      await recoverPendingMiningTx(pair(
        createClient(),
        createClient({ readContract: async () => Array(25).fill(0n) }),
      ), persisted, Date.now(), 1n),
      "manual-reconciliation-required",
      "RPC bet-state disagreement must retain the duplicate-send block",
    );
    assert.equal(
      await recoverPendingMiningTx(pair(createClient({
        getTransaction: async () => ({ ...transaction, blockHash: `0x${"c".repeat(64)}` as `0x${string}` }),
      })), persisted, Date.now(), 1n),
      "manual-reconciliation-required",
      "a transaction block hash that does not match its receipt must retain the duplicate-send block",
    );
    assert.equal(
      await recoverPendingMiningTx(pair(createClient({
        getTransaction: async () => ({ ...transaction, blockNumber: 11n }),
      })), persisted, Date.now(), 1n),
      "manual-reconciliation-required",
      "a transaction block number that does not match its receipt must retain the duplicate-send block",
    );
    assert.equal(
      await recoverPendingMiningTx(pair(createClient({
        getTransaction: async () => ({ ...transaction, transactionIndex: 2 }),
      })), persisted, Date.now(), 1n),
      "manual-reconciliation-required",
      "a transaction index that does not match its receipt must retain the duplicate-send block",
    );
    assert.equal(
      await recoverPendingMiningTx(pair(createClient({
        getTransaction: async () => ({ ...transaction, type: "eip" + "7702" }),
      })), persisted, Date.now(), 1n),
      "manual-reconciliation-required",
      "an " + "EIP-" + "7702 mining transaction must never clear the pending resend block",
    );

    let reportRecoveryEntered!: () => void;
    const recoveryEntered = new Promise<void>((resolve) => { reportRecoveryEntered = resolve; });
    let releaseRecovery!: () => void;
    const recoveryGate = new Promise<void>((resolve) => { releaseRecovery = resolve; });
    const delayedRecoveryClient = createClient({
      getTransactionReceipt: async () => {
        reportRecoveryEntered();
        await recoveryGate;
        return receipt;
      },
    });
    const firstRecovery = recoverAndClearPendingMiningTx(
      pair(delayedRecoveryClient),
      persisted,
      Date.now(),
      1n,
    );
    await recoveryEntered;
    assert.equal(
      await recoverAndClearPendingMiningTx(pair(createClient()), persisted, Date.now(), 1n),
      "manual-reconciliation-required",
      "a second recovery tab must fail closed while the actor mutation lock is held",
    );
    releaseRecovery();
    assert.equal(await firstRecovery, "confirmed");
    assert.equal(readPendingMiningTxState(APP_CHAIN_ID, contract, actor), null);

    const casReserved = await reservePendingMiningTxIntent(
      pair(createClient({ getTransactionCount: async () => 7, readContract: async () => Array(25).fill(0n) })),
      {
        chainId: APP_CHAIN_ID,
        contract,
        actor,
        calldata,
        expectedEpoch: 12n,
        tileIds: [1],
        amountRawPerTile: 5n,
      },
    );
    assert.equal(attachPendingMiningTxHash(casReserved, hash), true);
    const casPersisted = readPendingMiningTxState(APP_CHAIN_ID, contract, actor);
    assert.ok(casPersisted?.hash);
    const casKey = `lineaore:pending-mining-tx:v2:${APP_CHAIN_ID}:${contract}:${actor}`;
    const casReplacementState = { ...casPersisted, hash: `0x${"d".repeat(64)}` as `0x${string}`, ts: Date.now() };
    let swappedReservation = false;
    const casClient = createClient({
      getTransaction: async () => {
        if (!swappedReservation) {
          storage.set(casKey, JSON.stringify(casReplacementState));
          swappedReservation = true;
        }
        return transaction;
      },
    });
    assert.equal(
      await recoverAndClearPendingMiningTx(pair(casClient), casPersisted, Date.now(), 1n),
      "manual-reconciliation-required",
      "terminal recovery must not clear a reservation that changed after its RPC evidence started",
    );
    assert.equal(
      JSON.parse(storage.get(casKey) ?? "null")?.hash,
      casReplacementState.hash,
      "the newer exact reservation must survive a stale terminal recovery",
    );
    assert.equal(clearPendingMiningTxState(APP_CHAIN_ID, contract, actor), true);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    assert.equal(await waitForPendingMiningReceiptAgreement(pair(createClient()), hash, 1_000, 1n), "confirmed");
    assert.equal(
      await waitForPendingMiningReceiptAgreement(pair(createClient({ getBlockNumber: async () => 10n })), hash, 1_000, 1n),
      "pending",
      "an unfinalized receipt must not become terminal",
    );
    assert.equal(
      await waitForPendingMiningReceiptAgreement(pair(createClient({
        getBlock: async () => ({ hash: `0x${"c".repeat(64)}` as `0x${string}` }),
      })), hash, 1_000, 1n),
      "pending",
      "a receipt whose block is no longer canonical must not become terminal",
    );
    assert.equal(
      await waitForPendingMiningReceiptAgreement(pair(
        createClient(),
        createClient({ getBlock: async () => ({ hash: `0x${"c".repeat(64)}` as `0x${string}` }) }),
      ), hash, 1_000, 1n),
      "pending",
      "two RPC origins that disagree on the canonical block must not produce a terminal result",
    );
    assert.equal(
      await waitForPendingMiningReceiptAgreement(pair(createClient({ getChainId: async () => APP_CHAIN_ID + 1 })), hash, 1_000, 1n),
      "pending",
      "receipt finality evidence from the wrong chain must fail closed",
    );
    await assert.rejects(
      waitForPendingMiningReceiptAgreement(pair(
        createClient(),
        createClient({ getTransactionReceipt: async () => ({ ...receipt, blockNumber: 11n }) }),
      ), hash, 1_000, 1n),
      /does not agree|disagree/,
    );
    const corruptActor = "0x4444444444444444444444444444444444444444" as const;
    const corruptKey = `lineaore:pending-mining-tx:v2:${APP_CHAIN_ID}:${contract}:${corruptActor}`;
    const corruptRaw = JSON.stringify({
      chainId: APP_CHAIN_ID,
      contract,
      actor,
      nonce: 11,
      ts: Date.now(),
    });
    storage.set(corruptKey, corruptRaw);
    assert.throws(
      () => readPendingMiningTxState(APP_CHAIN_ID, contract, corruptActor),
      /invalid.*manual reconciliation/i,
      "a parseable record whose persisted identity does not match its key must fail closed",
    );
    assert.equal(storage.get(corruptKey), corruptRaw, "invalid persisted state must remain quarantined for manual review");
    await assert.rejects(
      reservePendingMiningTxIntent(pair(createClient()), {
        chainId: APP_CHAIN_ID,
        contract,
        actor: corruptActor,
        calldata,
        expectedEpoch: 15n,
        tileIds: [4],
        amountRawPerTile: 5n,
      }),
      /invalid.*manual reconciliation/i,
      "a simulated reload with an invalid durable record must block a new wallet send",
    );
    assert.equal(storage.get(corruptKey), corruptRaw, "blocked resend must not delete corrupt evidence");
    storage.delete(corruptKey);

    const invalidJsonActor = "0x5555555555555555555555555555555555555555" as const;
    const invalidJsonKey = `lineaore:pending-mining-tx:v2:${APP_CHAIN_ID}:${contract}:${invalidJsonActor}`;
    storage.set(invalidJsonKey, "{");
    assert.throws(
      () => readPendingMiningTxState(APP_CHAIN_ID, contract, invalidJsonActor),
      /storage is unavailable/i,
      "invalid JSON must fail closed instead of being treated as no pending transaction",
    );
    await assert.rejects(
      reservePendingMiningTxIntent(pair(createClient()), {
        chainId: APP_CHAIN_ID,
        contract,
        actor: invalidJsonActor,
        calldata,
        expectedEpoch: 16n,
        tileIds: [5],
        amountRawPerTile: 5n,
      }),
      /storage is unavailable/i,
      "invalid JSON recovered after reload must block a duplicate wallet submission",
    );
    assert.equal(storage.get(invalidJsonKey), "{", "invalid JSON evidence must remain quarantined");
    storage.delete(invalidJsonKey);

    let releaseFirstEvidence!: () => void;
    const firstEvidenceGate = new Promise<void>((resolve) => {
      releaseFirstEvidence = resolve;
    });
    const delayedClient = createClient({
      getTransactionCount: async () => 10,
      readContract: async () => {
        await firstEvidenceGate;
        return Array(25).fill(0n);
      },
    });
    const firstReservation = reservePendingMiningTxIntent(pair(delayedClient), {
      chainId: 59141,
      contract,
      actor,
      calldata,
      expectedEpoch: 14n,
      tileIds: [3],
      amountRawPerTile: 5n,
    });
    await Promise.resolve();
    await assert.rejects(
      reservePendingMiningTxIntent(pair(createClient()), {
        chainId: 59141,
        contract,
        actor,
        calldata,
        expectedEpoch: 14n,
        tileIds: [3],
        amountRawPerTile: 5n,
      }),
      /already reserved|already reserving or submitting/,
      "same-actor submissions must serialize before asynchronous RPC evidence",
    );
    releaseFirstEvidence();
    await firstReservation;
    assert.equal(clearPendingMiningTxState(59141, contract, actor), true);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));

    const setItem = (globalThis.window as unknown as { localStorage: { setItem: (key: string, value: string) => void } }).localStorage.setItem;
    (globalThis.window as unknown as { localStorage: { setItem: (key: string, value: string) => void } }).localStorage.setItem = () => {
      throw new Error("storage disabled");
    };
    assert.equal(writePendingMiningTxState({ chainId: 59141, contract, actor, nonce: 9 }), false);
    await assert.rejects(
      reservePendingMiningTxIntent(pair(createClient()), {
        chainId: 59141,
        contract,
        actor,
        calldata,
        expectedEpoch: 13n,
        tileIds: [2],
        amountRawPerTile: 5n,
      }),
      /already reserved|already requires reconciliation|could not be persisted|storage/i,
      "failed durable persistence must retain an actor-wide latch and block a resend",
    );
    (globalThis.window as unknown as { localStorage: { setItem: (key: string, value: string) => void } }).localStorage.setItem = setItem;
  } finally {
    if (priorWindow === undefined) delete (globalThis as { window?: unknown }).window;
    else Object.defineProperty(globalThis, "window", { configurable: true, value: priorWindow });
    if (priorNavigator === undefined) delete (globalThis as { navigator?: unknown }).navigator;
    else Object.defineProperty(globalThis, "navigator", { configurable: true, value: priorNavigator });
  }

  console.log("Mining transaction persistence and two-RPC recovery checks passed.");
}

void main();
