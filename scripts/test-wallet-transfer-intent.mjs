import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { encodeFunctionData } from "viem";
import * as transferIntentModule from "../app/lib/walletTransferIntent.ts";
import * as utilsModule from "../app/lib/utils.ts";
import * as externalWalletProviderContextModule from "../app/lib/externalWalletProviderContext.ts";

const transferIntent = transferIntentModule.default ?? transferIntentModule;
const utils = utilsModule.default ?? utilsModule;
const externalWalletProviderContext = externalWalletProviderContextModule.default ?? externalWalletProviderContextModule;
const {
  ExternalWalletProviderContextError,
  assertExternalWalletProviderContext,
  isSafeExternalWalletProviderContextError,
} = externalWalletProviderContext;

class MemoryStorage {
  #values = new Map();
  #fault = null;

  failNext({ operation, key, phase = "before", errorName = "Error" }) {
    this.#fault = { operation, key, phase, errorName };
  }

  #maybeFail(operation, key, phase) {
    if (
      !this.#fault ||
      this.#fault.operation !== operation ||
      this.#fault.key !== key ||
      this.#fault.phase !== phase
    ) {
      return;
    }
    const { errorName } = this.#fault;
    this.#fault = null;
    const error = new Error(`injected ${operation} ${phase} failure for ${key}`);
    error.name = errorName;
    throw error;
  }

  get length() {
    return this.#values.size;
  }

  clear() {
    this.#values.clear();
    this.#fault = null;
  }

  getItem(key) {
    const normalizedKey = String(key);
    this.#maybeFail("getItem", normalizedKey, "before");
    const value = this.#values.has(normalizedKey) ? this.#values.get(normalizedKey) : null;
    this.#maybeFail("getItem", normalizedKey, "after");
    return value;
  }

  key(index) {
    return [...this.#values.keys()][index] ?? null;
  }

  removeItem(key) {
    const normalizedKey = String(key);
    this.#maybeFail("removeItem", normalizedKey, "before");
    this.#values.delete(normalizedKey);
    this.#maybeFail("removeItem", normalizedKey, "after");
  }

  setItem(key, value) {
    const normalizedKey = String(key);
    this.#maybeFail("setItem", normalizedKey, "before");
    this.#values.set(normalizedKey, String(value));
    this.#maybeFail("setItem", normalizedKey, "after");
  }
}

class MemoryLockManager {
  #held = new Set();

  async request(name, options, callback) {
    if (this.#held.has(name)) {
      if (options?.ifAvailable) return callback(null);
      throw new Error(`test lock unexpectedly queued: ${name}`);
    }
    this.#held.add(name);
    try {
      return await callback({ name, mode: "exclusive" });
    } finally {
      this.#held.delete(name);
    }
  }
}

const storage = new MemoryStorage();
const locks = new MemoryLockManager();
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { localStorage: storage },
});
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: { locks },
});
if (!globalThis.crypto?.randomUUID) {
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: webcrypto,
  });
}

const actor = "0x1111111111111111111111111111111111111111";
const destination = "0x2222222222222222222222222222222222222222";
const baseIntent = transferIntent.createWalletTransferIntent({
  actor,
  chainId: 59144,
  asset: "native",
  destination,
  amountWei: 1_000_000_000_000_000n,
});
const stableNonceClient = {
  getTransactionCount: async ({ blockTag }) => blockTag === "latest" ? 7 : 7,
};
const stableNonceClients = [stableNonceClient, stableNonceClient];

const externalProviderActor = "0x3333333333333333333333333333333333333333";
const targetExternalProvider = {
  request: async ({ method }) => {
    if (method === "eth_chainId") return "0xe705";
    if (method === "eth_accounts") return [externalProviderActor];
    throw new Error(`unexpected external provider method ${method}`);
  },
};
assert.equal(
  await assertExternalWalletProviderContext({
    provider: targetExternalProvider,
    expectedActor: externalProviderActor,
    expectedChainId: 59141,
    timeoutMs: 100,
  }),
  externalProviderActor,
  "a matching external provider chain and selected actor must pass sink-adjacent validation",
);
await assert.rejects(
  assertExternalWalletProviderContext({
    provider: {
      request: async () => new Promise(() => {}),
    },
    expectedActor: externalProviderActor,
    expectedChainId: 59141,
    timeoutMs: 20,
  }),
  /request timed out/,
  "external provider context validation must be time bounded before the wallet send sink",
);
const changedChainError = new ExternalWalletProviderContextError("wallet_transfer_intent_external_chain_changed");
assert.equal(isSafeExternalWalletProviderContextError(changedChainError), true);
assert.equal(isSafeExternalWalletProviderContextError(new Error("rpc unavailable")), false);
await assert.rejects(
  assertExternalWalletProviderContext({
    provider: {
      request: async ({ method }) => method === "eth_chainId" ? "0x1" : [externalProviderActor],
    },
    expectedActor: externalProviderActor,
    expectedChainId: 59141,
    timeoutMs: 100,
  }),
  (error) => error instanceof ExternalWalletProviderContextError &&
    error.code === "wallet_transfer_intent_external_chain_changed",
  "a known chain change must be classified as safe-before-submission",
);
await assert.rejects(
  assertExternalWalletProviderContext({
    provider: {
      request: async ({ method }) => method === "eth_chainId" ? "0xe705" : [destination],
    },
    expectedActor: externalProviderActor,
    expectedChainId: 59141,
    timeoutMs: 100,
  }),
  (error) => error instanceof ExternalWalletProviderContextError &&
    error.code === "wallet_transfer_intent_actor_changed",
  "a selected-account change must be classified as safe-before-submission",
);
await assert.rejects(
  assertExternalWalletProviderContext({
    provider: {
      request: async () => { throw new Error("rpc unavailable"); },
    },
    expectedChainId: 59141,
    timeoutMs: 100,
  }),
  /rpc unavailable/,
  "unknown provider failures must not be recategorized as safe pre-submission mismatches",
);

const walletTransferStorageKey = (intent) => [
  "lineaore:wallet-transfer-intent:v1",
  intent.chainId,
  intent.actor,
  intent.asset,
  intent.destination,
  intent.amountWei.toString(),
].join(":");

const replacementObservationStorageKey = (intent, rpcIndex) =>
  `${walletTransferStorageKey(intent)}:replacement-observation:${rpcIndex}`;

const transactionClients = (first, second = first, receiptStatus = "success") => [
  ...[first, second].map((transaction) => {
    const receipt = {
      status: receiptStatus,
      transactionHash: transaction.hash,
      blockHash: `0x${"b1".repeat(32)}`,
      blockNumber: 100n,
      transactionIndex: 0,
    };
    return {
      getTransaction: async () => transaction,
      getTransactionReceipt: async () => receipt,
      getBlockNumber: async () => 101n,
      waitForTransactionReceipt: async () => receipt,
    };
  }),
];

function transactionForIntent(intent, hash, nonce, overrides = {}) {
  const input = intent.asset === "native"
    ? "0x"
    : intent.asset === "contract-call"
      ? intent.calldata
      : encodeFunctionData({
          abi: [{
            type: "function",
            name: "transfer",
            stateMutability: "nonpayable",
            inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
            outputs: [{ name: "", type: "bool" }],
          }],
          functionName: "transfer",
          args: [intent.destination, intent.amountWei],
        });
  return {
    hash,
    chainId: intent.chainId,
    from: intent.actor,
    nonce,
    to: intent.asset === "native" || intent.asset === "contract-call"
      ? intent.destination
      : intent.asset,
    value: intent.asset === "native" ? intent.amountWei : 0n,
    input,
    type: "eip1559",
    ...overrides,
  };
}

const initialNow = Date.now();
const first = await transferIntent.acquireWalletTransferIntentLease(
  baseIntent,
  stableNonceClients,
  initialNow,
);
assert.equal(first.status, "acquired");
assert.equal(first.lease.nonce, 7);
await assert.rejects(
  transferIntent.acquireWalletTransferIntentLease(baseIntent, stableNonceClients, initialNow + 1),
  /wallet_transfer_intent_unresolved/,
  "an unresolved exact transfer intent must block a same-tab or cross-tab retry",
);

const reconciled = await transferIntent.acquireWalletTransferIntentLease(
  baseIntent,
  stableNonceClients,
  initialNow + transferIntent.HASHLESS_TRANSFER_RECONCILIATION_GRACE_MS,
);
assert.equal(reconciled.status, "acquired");
assert.equal(reconciled.lease.id, first.lease.id, "reconciliation must retain ownership for an older late result");
assert.equal(reconciled.lease.nonce, 7);

storage.clear();
let releaseNonceReads;
const nonceGate = new Promise((resolve) => {
  releaseNonceReads = resolve;
});
const delayedNonceClient = {
  getTransactionCount: async ({ blockTag }) => {
    await nonceGate;
    return blockTag === "latest" ? 9 : 9;
  },
};
const delayedNonceClients = [delayedNonceClient, delayedNonceClient];
const acquiring = transferIntent.acquireWalletTransferIntentLease(baseIntent, delayedNonceClients, Date.now());
await Promise.resolve();
await assert.rejects(
  transferIntent.acquireWalletTransferIntentLease(baseIntent, stableNonceClients, Date.now()),
  /wallet_transfer_intent_locked/,
  "the actor-scoped browser lock must reject a concurrent tab before either can submit",
);
releaseNonceReads();
await acquiring;

storage.clear();
let resolveLateSend;
const rawLateSend = new Promise((resolve) => {
  resolveLateSend = resolve;
});
let retainedLateSend;
await assert.rejects(
  transferIntent.withWalletTransferIntentLease(
    baseIntent,
    stableNonceClients,
    async (acquisition, retainResult) => {
      assert.equal(acquisition.status, "acquired");
      retainedLateSend = retainResult(rawLateSend, acquisition.lease);
      return utils.withTimeout(retainedLateSend, 1, "test Privy sendTransaction");
    },
  ),
  /timed out/,
);
const lateHash = `0x${"ab".repeat(32)}`;
resolveLateSend({ hash: lateHash });
await retainedLateSend;
const reloadedTransferIntentModule = await import(
  new URL(`../app/lib/walletTransferIntent.ts?reload=${Date.now()}`, import.meta.url).href
);
const reloadedTransferIntent = reloadedTransferIntentModule.default ?? reloadedTransferIntentModule;
const recoveredKnownHash = await reloadedTransferIntent.acquireWalletTransferIntentLease(
  baseIntent,
  stableNonceClients,
  Date.now(),
);
assert.deepEqual(
  recoveredKnownHash,
  { status: "known-hash", hash: lateHash },
  "a hash arriving after the caller timeout must survive a module reload and suppress a second send",
);

assert.equal(
  await transferIntent.resolveWalletTransferIntent(
    baseIntent,
    lateHash,
    "confirmed",
    transactionClients(transactionForIntent(baseIntent, lateHash, recoveredKnownHash.lease?.nonce ?? 7)),
  ),
  true,
  "a confirmed known hash must explicitly resolve its transfer intent",
);
const afterConfirmed = await transferIntent.acquireWalletTransferIntentLease(
  baseIntent,
  stableNonceClients,
  Date.now(),
);
assert.equal(afterConfirmed.status, "acquired", "a confirmed intent must not block a later deliberate transfer");

storage.clear();
const repairIntent = transferIntent.createWalletRepairIntent({ actor, chainId: 59144 });
const pendingGapNonceClient = {
  getTransactionCount: async ({ blockTag }) => blockTag === "latest" ? 7 : 8,
};
const pendingGapNonceClients = [pendingGapNonceClient, pendingGapNonceClient];
await assert.rejects(
  transferIntent.withWalletTransferRepairIntentLease(
    repairIntent,
    pendingGapNonceClients,
    8,
    async () => undefined,
  ),
  /wallet_repair_intent_nonce_reconciliation_unsafe/,
  "repair must target the agreed oldest blocked nonce rather than the pending tail",
);
await assert.rejects(
  transferIntent.withWalletTransferRepairIntentLease(
    repairIntent,
    stableNonceClients,
    7,
    async () => undefined,
  ),
  /wallet_repair_intent_nonce_reconciliation_unsafe/,
  "repair must not reserve a nonce when the two-RPC snapshot has no pending gap",
);
const repairAcquisition = await transferIntent.withWalletTransferRepairIntentLease(
  repairIntent,
  pendingGapNonceClients,
  7,
  async (acquisition) => acquisition,
);
assert.equal(repairAcquisition.status, "acquired");
assert.equal(
  repairAcquisition.lease.nonce,
  7,
  "an exact repair intent must durably reserve the agreed oldest blocked nonce",
);

storage.clear();
let repairNonceAdvanced = false;
const advancingRepairNonceClient = {
  getTransactionCount: async ({ blockTag }) => {
    if (!repairNonceAdvanced) return blockTag === "latest" ? 7 : 8;
    return 8;
  },
};
const nonceTooLowError = new Error("nonce too low");
await assert.rejects(
  transferIntent.withWalletTransferRepairIntentLease(
    repairIntent,
    [advancingRepairNonceClient, advancingRepairNonceClient],
    7,
    async () => {
      repairNonceAdvanced = true;
      throw nonceTooLowError;
    },
    { abandonOnNonceAdvanceError: (error) => error === nonceTooLowError },
  ),
  /nonce too low/,
  "a pre-hash nonce-too-low result may release only after both RPCs prove that exact repair nonce advanced",
);
const reloadedAfterAdvancedRepair = await import(
  new URL(`../app/lib/walletTransferIntent.ts?repair-advanced=${Date.now()}`, import.meta.url).href
);
assert.equal(
  reloadedAfterAdvancedRepair.hasTrackedWalletTransferNonce(59144, actor, 7),
  false,
  "a safely advanced hashless repair must remain released after a module reload",
);

storage.clear();
await assert.rejects(
  transferIntent.withWalletTransferRepairIntentLease(
    repairIntent,
    pendingGapNonceClients,
    7,
    async () => {
      throw nonceTooLowError;
    },
    { abandonOnNonceAdvanceError: (error) => error === nonceTooLowError },
  ),
  /wallet_transfer_intent_rejection_unresolved/,
  "a nonce-too-low string without matching two-RPC nonce advancement must stay fail-closed",
);
const reloadedAfterUnprovenRepair = await import(
  new URL(`../app/lib/walletTransferIntent.ts?repair-unproven=${Date.now()}`, import.meta.url).href
);
assert.equal(
  reloadedAfterUnprovenRepair.hasTrackedWalletTransferNonce(59144, actor, 7),
  true,
  "an unproven hashless repair failure must remain durably blocked after a module reload",
);

storage.clear();
const contractCalldata = `0x${"12".repeat(32)}`;
const contractIntent = transferIntent.createWalletContractIntent({
  actor,
  chainId: 59144,
  contract: destination,
  calldata: contractCalldata,
});
assert.doesNotThrow(() => transferIntent.assertWalletTransferIntentMatchesTransaction(
  contractIntent,
  { to: destination, data: contractCalldata },
));
assert.throws(
  () => transferIntent.assertWalletTransferIntentMatchesTransaction(
    contractIntent,
    { to: destination, data: `0x${"34".repeat(32)}` },
  ),
  /wallet_contract_intent_transaction_mismatch/,
  "a durable contract intent must bind the exact calldata rather than only the destination",
);

let resolveLateContractSend;
const rawLateContractSend = new Promise((resolve) => {
  resolveLateContractSend = resolve;
});
let retainedLateContractSend;
let contractProviderSends = 0;
await assert.rejects(
  transferIntent.withWalletTransferIntentLease(
    contractIntent,
    stableNonceClients,
    async (acquisition, retainResult) => {
      assert.equal(acquisition.status, "acquired");
      contractProviderSends += 1;
      retainedLateContractSend = retainResult(rawLateContractSend, acquisition.lease);
      return utils.withTimeout(retainedLateContractSend, 1, "test contract claim send");
    },
  ),
  /timed out/,
);
await assert.rejects(
  transferIntent.withWalletTransferIntentLease(
    contractIntent,
    stableNonceClients,
    async () => {
      contractProviderSends += 1;
      throw new Error("second contract send must stay unreachable");
    },
  ),
  /wallet_transfer_intent_unresolved/,
  "a hashless contract-call timeout must block a second provider send",
);
await assert.rejects(
  transferIntent.acquireWalletTransferIntentLease(baseIntent, stableNonceClients, Date.now()),
  /wallet_transfer_actor_unresolved/,
  "a pending contract-call intent must also block a different transfer at the shared actor nonce",
);
const lateContractHash = `0x${"cd".repeat(32)}`;
resolveLateContractSend({ hash: lateContractHash });
await retainedLateContractSend;
const reloadedContractIntentModule = await import(
  new URL(`../app/lib/walletTransferIntent.ts?contract-reload=${Date.now()}`, import.meta.url).href
);
assert.deepEqual(
  await reloadedContractIntentModule.acquireWalletTransferIntentLease(
    contractIntent,
    stableNonceClients,
    Date.now(),
  ),
  { status: "known-hash", hash: lateContractHash },
  "a late contract-call hash must survive reload and be returned instead of resubmitting",
);
assert.equal(contractProviderSends, 1, "the timeout/reload path must reach the contract provider sink exactly once");
assert.equal(
  await transferIntent.resolveWalletTransferIntent(
    contractIntent,
    lateContractHash,
    "confirmed",
    transactionClients(transactionForIntent(contractIntent, lateContractHash, 7)),
  ),
  true,
  "two exact canonical transaction observations must release a confirmed contract intent",
);
assert.equal(
  (await transferIntent.acquireWalletTransferIntentLease(
    contractIntent,
    stableNonceClients,
    Date.now(),
  )).status,
  "acquired",
  "terminal resolution must preserve a later legitimate identical contract claim",
);

storage.clear();
const lostProviderPromiseStartedAt = Date.now();
assert.equal(
  (await transferIntent.acquireWalletTransferIntentLease(
    contractIntent,
    stableNonceClients,
    lostProviderPromiseStartedAt,
  )).status,
  "acquired",
);
const reloadedWithoutProviderPromise = await import(
  new URL(`../app/lib/walletTransferIntent.ts?contract-real-reload=${Date.now()}`, import.meta.url).href
);
let reloadRetrySends = 0;
await assert.rejects(
  reloadedWithoutProviderPromise.withWalletTransferIntentLease(
    contractIntent,
    stableNonceClients,
    async () => {
      reloadRetrySends += 1;
      throw new Error("a post-reload contract claim must not reach a second provider sink");
    },
    undefined,
    lostProviderPromiseStartedAt + transferIntent.HASHLESS_TRANSFER_RECONCILIATION_GRACE_MS + 1,
  ),
  /wallet_transfer_intent_unresolved/,
  "a real reload with no surviving provider promise must remain blocked even after the nonce grace period",
);
assert.equal(reloadRetrySends, 0, "nonce equality alone must never reauthorize a hashless contract call");

storage.clear();
const rejectedError = Object.assign(new Error("User rejected the request"), { code: 4001 });
await assert.rejects(
  transferIntent.withWalletTransferIntentLease(
    baseIntent,
    stableNonceClients,
    async () => { throw rejectedError; },
    { abandonOnError: (error) => error?.code === 4001 },
  ),
  (error) => error === rejectedError,
  "a definite pre-hash user rejection with an unchanged agreed nonce must be preserved as a rejection",
);
assert.equal(
  (await transferIntent.acquireWalletTransferIntentLease(baseIntent, stableNonceClients, Date.now())).status,
  "acquired",
  "a proven pre-broadcast rejection must release the exact intent without a grace delay",
);

storage.clear();
await assert.rejects(
  transferIntent.withWalletTransferIntentLease(
    baseIntent,
    stableNonceClients,
    async () => { throw changedChainError; },
    { abandonOnError: isSafeExternalWalletProviderContextError },
  ),
  (error) => error === changedChainError,
  "a proven sink-adjacent chain change must abort before broadcast",
);
assert.equal(
  (await transferIntent.acquireWalletTransferIntentLease(baseIntent, stableNonceClients, Date.now())).status,
  "acquired",
  "a known pre-send chain change with unchanged nonce must not leave a retry-blocking transfer intent",
);

storage.clear();
const unknownPreSendFailure = new Error("rpc unavailable");
await assert.rejects(
  transferIntent.withWalletTransferIntentLease(
    baseIntent,
    stableNonceClients,
    async () => { throw unknownPreSendFailure; },
    { abandonOnError: isSafeExternalWalletProviderContextError },
  ),
  (error) => error === unknownPreSendFailure,
  "an unknown provider failure must not be treated as a proven pre-broadcast abort",
);
await assert.rejects(
  transferIntent.acquireWalletTransferIntentLease(baseIntent, stableNonceClients, Date.now()),
  /wallet_transfer_intent_unresolved/,
  "an unknown provider failure must retain the duplicate-send block",
);

storage.clear();
let rejectionNonceRead = 0;
const advancingAfterRejectionClient = {
  getTransactionCount: async ({ blockTag }) => {
    rejectionNonceRead += 1;
    const reconciliationRead = rejectionNonceRead > 4;
    return blockTag === "latest" ? 7 : reconciliationRead ? 8 : 7;
  },
};
await assert.rejects(
  transferIntent.withWalletTransferIntentLease(
    baseIntent,
    [advancingAfterRejectionClient, advancingAfterRejectionClient],
    async () => { throw rejectedError; },
    { abandonOnError: (error) => error?.code === 4001 },
  ),
  /wallet_transfer_intent_rejection_unresolved/,
  "a rejection concurrent with nonce consumption must remain blocked as potentially broadcast",
);

storage.clear();
const advancingNow = Date.now();
await transferIntent.acquireWalletTransferIntentLease(baseIntent, stableNonceClients, advancingNow);
const advancedPendingClient = {
  getTransactionCount: async ({ blockTag }) => blockTag === "latest" ? 7 : 8,
};
await assert.rejects(
  transferIntent.acquireWalletTransferIntentLease(
    baseIntent,
    [advancedPendingClient, advancedPendingClient],
    advancingNow + transferIntent.HASHLESS_TRANSFER_RECONCILIATION_GRACE_MS + 1,
  ),
  /wallet_transfer_intent_unresolved/,
  "nonce advancement must remain unresolved instead of authorizing a duplicate transfer",
);

storage.clear();
const droppedNow = Date.now();
const droppedLease = await transferIntent.acquireWalletTransferIntentLease(
  baseIntent,
  stableNonceClients,
  droppedNow,
);
assert.equal(droppedLease.status, "acquired");
const droppedHash = `0x${"bc".repeat(32)}`;
await transferIntent.recordWalletTransferIntentHash(
  baseIntent,
  droppedLease.lease.id,
  droppedHash,
  droppedNow + 1,
);
assert.deepEqual(
  await transferIntent.acquireWalletTransferIntentLease(
    baseIntent,
    stableNonceClients,
    droppedNow + 2,
  ),
  { status: "known-hash", hash: droppedHash },
  "a recent known hash must suppress another wallet prompt",
);
const droppedRetry = await transferIntent.acquireWalletTransferIntentLease(
  baseIntent,
  stableNonceClients,
  droppedNow + transferIntent.HASHLESS_TRANSFER_RECONCILIATION_GRACE_MS + 2,
);
assert.equal(droppedRetry.status, "acquired");
assert.equal(droppedRetry.lease.id, droppedLease.lease.id);
assert.equal(droppedRetry.lease.nonce, droppedLease.lease.nonce);

storage.clear();
const priorBroadcastNow = Date.now();
const priorBroadcastLease = await transferIntent.acquireWalletTransferIntentLease(
  baseIntent,
  stableNonceClients,
  priorBroadcastNow,
);
assert.equal(priorBroadcastLease.status, "acquired");
await transferIntent.recordWalletTransferIntentHash(
  baseIntent,
  priorBroadcastLease.lease.id,
  droppedHash,
  priorBroadcastNow + 1,
);
await assert.rejects(
  transferIntent.withWalletTransferIntentLease(
    baseIntent,
    stableNonceClients,
    async () => { throw rejectedError; },
    { abandonOnError: (error) => error?.code === 4001 },
    priorBroadcastNow + transferIntent.HASHLESS_TRANSFER_RECONCILIATION_GRACE_MS + 2,
  ),
  /wallet_transfer_intent_rejection_unresolved/,
  "rejecting a same-nonce dropped-hash replacement must not erase prior broadcast evidence",
);

storage.clear();
const replacedNow = Date.now();
const replacedLease = await transferIntent.acquireWalletTransferIntentLease(
  baseIntent,
  stableNonceClients,
  replacedNow,
);
assert.equal(replacedLease.status, "acquired");
const replacedHash = `0x${"bd".repeat(32)}`;
await transferIntent.recordWalletTransferIntentHash(
  baseIntent,
  replacedLease.lease.id,
  replacedHash,
  replacedNow + 1,
);
assert.deepEqual(
  await transferIntent.acquireWalletTransferIntentLease(
    baseIntent,
    [advancedPendingClient, advancedPendingClient],
    replacedNow + transferIntent.HASHLESS_TRANSFER_RECONCILIATION_GRACE_MS + 2,
  ),
  { status: "known-hash", hash: replacedHash },
  "a consumed nonce with a missing or replaced known hash must stay blocked for manual reconciliation",
);

storage.clear();
const otherAmountIntent = transferIntent.createWalletTransferIntent({
  actor,
  chainId: 59144,
  asset: "native",
  destination,
  amountWei: baseIntent.amountWei + 1n,
});
const propagationLagNow = Date.now();
const propagationLagLease = await transferIntent.acquireWalletTransferIntentLease(
  baseIntent,
  stableNonceClients,
  propagationLagNow,
);
assert.equal(propagationLagLease.status, "acquired");
const propagationLagHash = `0x${"be".repeat(32)}`;
await transferIntent.recordWalletTransferIntentHash(
  baseIntent,
  propagationLagLease.lease.id,
  propagationLagHash,
  propagationLagNow + 1,
);
assert.deepEqual(
  await transferIntent.acquireWalletTransferIntentLease(
    baseIntent,
    stableNonceClients,
    propagationLagNow + 2,
  ),
  { status: "known-hash", hash: propagationLagHash },
  "the exact intent must retain its known-hash recovery while the actor-wide guard is active",
);
await assert.rejects(
  transferIntent.acquireWalletTransferIntentLease(
    otherAmountIntent,
    stableNonceClients,
    propagationLagNow + 2,
  ),
  /wallet_transfer_actor_unresolved/,
  "a different cross-tab intent must not reuse a nonce before the first hash propagates to both RPCs",
);
assert.equal(
  await transferIntent.resolveWalletTransferIntent(
    baseIntent,
    propagationLagHash,
    "confirmed",
    transactionClients(transactionForIntent(baseIntent, propagationLagHash, propagationLagLease.lease.nonce)),
    propagationLagNow + 3,
  ),
  true,
);
const otherAmount = await transferIntent.acquireWalletTransferIntentLease(
  otherAmountIntent,
  stableNonceClients,
  propagationLagNow + 4,
);
assert.equal(
  otherAmount.status,
  "acquired",
  "terminal reconciliation must release the actor for a later deliberate transfer",
);

assert.deepEqual(
  transferIntent.selectWalletTransferAgreementRpcUrls([
    "HTTPS://RPC-ONE.EXAMPLE/path?key=one#fragment",
    "https://rpc-one.example/other-path?key=two",
    "https://rpc-one.example.:443/trailing-dot-alias",
    "https://rpc-two.example",
  ]),
  ["https://rpc-one.example/path?key=one", "https://rpc-two.example/"],
  "RPC aliases on one canonical origin must not count as independent nonce evidence",
);
assert.throws(
  () => transferIntent.selectWalletTransferAgreementRpcUrls([
    "https://rpc-one.example",
    "HTTPS://RPC-ONE.EXAMPLE:443/path?other=key",
    "https://rpc-one.example./trailing-dot-alias",
  ]),
  /wallet_transfer_intent_independent_rpc_required/,
  "two URL aliases for one RPC origin must fail closed",
);
assert.throws(
  () => transferIntent.selectWalletTransferAgreementRpcUrls([
    "https://rpc-one.example:443/path-a",
    "http://RPC-ONE.EXAMPLE:8545/path-b",
  ]),
  /wallet_transfer_intent_independent_rpc_required/,
  "scheme and nondefault-port aliases on one host must fail closed",
);
assert.throws(
  () => transferIntent.selectWalletTransferAgreementRpcUrls([
    "https://@rpc-one.example",
    "https://rpc-two.example",
  ]),
  /wallet_transfer_intent_rpc_url_invalid/,
  "even empty URL userinfo must be rejected at the wallet RPC trust boundary",
);
assert.throws(
  () => transferIntent.selectWalletTransferAgreementRpcUrls([
    "https:////@rpc-one.example",
    "https://rpc-two.example",
  ]),
  /wallet_transfer_intent_rpc_url_invalid/,
  "alternate empty-userinfo URL syntax must also be rejected",
);

storage.clear();
const staleNonceClient = {
  getTransactionCount: async ({ blockTag }) => blockTag === "latest" ? 7 : 7,
};
const honestPendingClient = {
  getTransactionCount: async ({ blockTag }) => blockTag === "latest" ? 7 : 8,
};
await assert.rejects(
  transferIntent.acquireWalletTransferIntentLease(
    baseIntent,
    [staleNonceClient, honestPendingClient],
    Date.now(),
  ),
  /wallet_transfer_intent_nonce_rpc_disagreement/,
  "one stale or malicious RPC must not select a silent transfer nonce",
);

const tokenAddress = "0x3333333333333333333333333333333333333333";
const tokenIntent = transferIntent.createWalletTransferIntent({
  actor,
  chainId: 59144,
  asset: tokenAddress,
  destination,
  amountWei: 42n,
});
const tokenData = encodeFunctionData({
  abi: [{
    type: "function",
    name: "transfer",
    stateMutability: "nonpayable",
    inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ name: "", type: "bool" }],
  }],
  functionName: "transfer",
  args: [destination, 42n],
});
assert.doesNotThrow(() => transferIntent.assertWalletTransferIntentMatchesTransaction(
  tokenIntent,
  { to: tokenAddress, data: tokenData },
));
assert.throws(
  () => transferIntent.assertWalletTransferIntentMatchesTransaction(
    tokenIntent,
    {
      to: tokenAddress,
      data: `${tokenData.slice(0, -1)}${tokenData.endsWith("0") ? "1" : "0"}`,
    },
  ),
  /wallet_transfer_intent_transaction_mismatch/,
  "token intent metadata must be cryptographically bound to destination and amount calldata",
);

async function recordResolutionIntent(intent, hash) {
  storage.clear();
  const now = Date.now();
  const acquisition = await transferIntent.acquireWalletTransferIntentLease(
    intent,
    stableNonceClients,
    now,
  );
  assert.equal(acquisition.status, "acquired");
  await transferIntent.recordWalletTransferIntentHash(
    intent,
    acquisition.lease.id,
    hash,
    now + 1,
  );
  return { lease: acquisition.lease, now };
}

const resolutionHash = `0x${"c1".repeat(32)}`;
const otherResolutionHash = `0x${"c2".repeat(32)}`;
const alternateAddress = "0x4444444444444444444444444444444444444444";
const unsafeResolutionTransactions = [
  {
    name: "an unrelated wallet-returned hash",
    mutate: (transaction) => ({ ...transaction, hash: otherResolutionHash }),
    error: /wallet_transfer_transaction_intent_mismatch/,
  },
  {
    name: "the wrong chain",
    mutate: (transaction) => ({ ...transaction, chainId: baseIntent.chainId + 1 }),
    error: /wallet_transfer_transaction_intent_mismatch/,
  },
  {
    name: "the wrong sender",
    mutate: (transaction) => ({ ...transaction, from: alternateAddress }),
    error: /wallet_transfer_transaction_intent_mismatch/,
  },
  {
    name: "the wrong leased nonce",
    mutate: (transaction) => ({ ...transaction, nonce: transaction.nonce + 1 }),
    error: /wallet_transfer_transaction_intent_mismatch/,
  },
  {
    name: "the wrong destination",
    mutate: (transaction) => ({ ...transaction, to: alternateAddress }),
    error: /wallet_transfer_transaction_intent_mismatch/,
  },
  {
    name: "the wrong native value",
    mutate: (transaction) => ({ ...transaction, value: transaction.value + 1n }),
    error: /wallet_transfer_transaction_intent_mismatch/,
  },
  {
    name: "unexpected calldata",
    mutate: (transaction) => ({ ...transaction, input: "0x00" }),
    error: /wallet_transfer_transaction_intent_mismatch/,
  },
  {
    name: "a missing critical transaction field",
    mutate: (transaction) => {
      const missingType = { ...transaction };
      delete missingType.type;
      return missingType;
    },
    error: /wallet_transfer_transaction_identity_invalid/,
  },
  {
    name: "an unsupported transaction type",
    mutate: (transaction) => ({ ...transaction, type: ["eip", "7702"].join("") }),
    error: /wallet_transfer_transaction_identity_invalid/,
  },
];

for (const vector of unsafeResolutionTransactions) {
  const { lease, now } = await recordResolutionIntent(baseIntent, resolutionHash);
  const transaction = vector.mutate(
    transactionForIntent(baseIntent, resolutionHash, lease.nonce),
  );
  await assert.rejects(
    transferIntent.resolveWalletTransferIntent(
      baseIntent,
      resolutionHash,
      "confirmed",
      transactionClients(transaction),
      now + 2,
    ),
    vector.error,
    `${vector.name} must not clear the exact durable intent`,
  );
  assert.deepEqual(
    await transferIntent.acquireWalletTransferIntentLease(
      baseIntent,
      stableNonceClients,
      now + 3,
    ),
    { status: "known-hash", hash: resolutionHash },
    `${vector.name} must remain manually blocked after failed resolution`,
  );
}

const rpcDivergenceTransactions = [
  ...unsafeResolutionTransactions.slice(0, 7),
  {
    name: "a different supported transaction type",
    mutate: (transaction) => ({ ...transaction, type: "legacy" }),
  },
];
for (const vector of rpcDivergenceTransactions) {
  const { lease, now } = await recordResolutionIntent(baseIntent, resolutionHash);
  const transaction = transactionForIntent(baseIntent, resolutionHash, lease.nonce);
  await assert.rejects(
    transferIntent.resolveWalletTransferIntent(
      baseIntent,
      resolutionHash,
      "confirmed",
      transactionClients(transaction, vector.mutate(transaction)),
      now + 2,
    ),
    /wallet_transfer_transaction_diverged/,
    `the two canonical RPCs must agree exactly when observing ${vector.name}`,
  );
}

const missingResolutionTransaction = Object.assign(new Error("transaction not found"), {
  name: "TransactionNotFoundError",
});
const missingResolutionClient = {
  getTransaction: async () => { throw missingResolutionTransaction; },
};
{
  const { now } = await recordResolutionIntent(baseIntent, resolutionHash);
  await assert.rejects(
    transferIntent.resolveWalletTransferIntent(
      baseIntent,
      resolutionHash,
      "confirmed",
      [missingResolutionClient, missingResolutionClient],
      now + 2,
    ),
    /wallet_transfer_transaction_missing_manual_reconciliation/,
    "a hash missing from both canonical RPCs must require manual reconciliation",
  );
  assert.deepEqual(
    await transferIntent.acquireWalletTransferIntentLease(baseIntent, stableNonceClients, now + 3),
    { status: "known-hash", hash: resolutionHash },
    "a transaction missing from both RPCs must leave its durable intent blocked",
  );
}

{
  const { lease, now } = await recordResolutionIntent(baseIntent, resolutionHash);
  const transaction = transactionForIntent(baseIntent, resolutionHash, lease.nonce);
  await assert.rejects(
    transferIntent.resolveWalletTransferIntent(
      baseIntent,
      resolutionHash,
      "confirmed",
      [transactionClients(transaction)[0], missingResolutionClient],
      now + 2,
    ),
    /wallet_transfer_transaction_diverged/,
    "one missing RPC observation must not be treated as quorum",
  );
  assert.deepEqual(
    await transferIntent.acquireWalletTransferIntentLease(baseIntent, stableNonceClients, now + 3),
    { status: "known-hash", hash: resolutionHash },
    "one missing RPC observation must leave its durable intent blocked",
  );
}

{
  const { lease, now } = await recordResolutionIntent(baseIntent, resolutionHash);
  const transaction = transactionForIntent(baseIntent, resolutionHash, lease.nonce);
  assert.equal(
    await transferIntent.resolveWalletTransferIntent(
      baseIntent,
      resolutionHash,
      "confirmed",
      transactionClients(transaction),
      now + 2,
    ),
    true,
    "an exact native transfer observed identically by both RPCs must resolve",
  );
}

{
  const { lease, now } = await recordResolutionIntent(tokenIntent, resolutionHash);
  const transaction = transactionForIntent(tokenIntent, resolutionHash, lease.nonce);
  assert.equal(
    await transferIntent.resolveWalletTransferIntent(
      tokenIntent,
      resolutionHash,
      "reverted",
      transactionClients(transaction, transaction, "reverted"),
      now + 2,
    ),
    true,
    "an exact ERC-20 transfer observed identically by both RPCs must preserve reverted retry recovery",
  );
}

const receiptHash = `0x${"cd".repeat(32)}`;
const revertedReceipt = {
  status: "reverted",
  transactionHash: receiptHash,
  blockHash: `0x${"ef".repeat(32)}`,
  blockNumber: 123n,
  transactionIndex: 4,
};
const successfulReceipt = { ...revertedReceipt, status: "success" };
const timeoutError = Object.assign(new Error("timed out"), { name: "TimeoutError" });
const receiptNotFound = Object.assign(new Error("transaction receipt not found"), {
  name: "TransactionReceiptNotFoundError",
});
const transactionNotFound = Object.assign(new Error("transaction not found"), {
  name: "TransactionNotFoundError",
});
const makeReceiptClient = ({
  wait = async () => revertedReceipt,
  read = async () => revertedReceipt,
  transaction = async () => ({ hash: receiptHash }),
  head = async () => 124n,
} = {}) => ({
  waitForTransactionReceipt: wait,
  getTransactionReceipt: read,
  getTransaction: transaction,
  getBlockNumber: head,
});

const finalityReceiptFor = (hash, status = "success", overrides = {}) => ({
  status,
  transactionHash: hash,
  blockHash: `0x${"d1".repeat(32)}`,
  blockNumber: 123n,
  transactionIndex: 1,
  ...overrides,
});

const makeFinalityClient = ({ transaction, receipts, head = 124n }) => {
  let receiptRead = 0;
  return {
    getTransaction: async () => transaction,
    getBlockNumber: async () => head,
    getTransactionReceipt: async () => {
      const value = receipts[Math.min(receiptRead, receipts.length - 1)];
      receiptRead += 1;
      if (value instanceof Error) throw value;
      return value;
    },
    waitForTransactionReceipt: async () => receipts[0],
  };
};

{
  const { lease, now } = await recordResolutionIntent(baseIntent, resolutionHash);
  const transaction = transactionForIntent(baseIntent, resolutionHash, lease.nonce);
  const receipt = finalityReceiptFor(resolutionHash);
  const clients = [
    makeFinalityClient({ transaction, receipts: [receipt] }),
    makeFinalityClient({ transaction, receipts: [receipt] }),
  ];
  assert.deepEqual(
    await transferIntent.waitForWalletTransferIntentReceipt(
      clients,
      baseIntent,
      resolutionHash,
      1_000,
      now + 2,
    ),
    { status: "confirmed", hash: resolutionHash },
    "an unchanged exact transaction must preserve the normal confirmed path",
  );
  assert.equal(
    await transferIntent.resolveWalletTransferIntent(
      baseIntent,
      resolutionHash,
      "confirmed",
      clients,
      now + 3,
    ),
    true,
    "the unchanged exact transaction must still clear after finality revalidation",
  );
}

{
  const { lease, now } = await recordResolutionIntent(baseIntent, resolutionHash);
  const transaction = transactionForIntent(baseIntent, resolutionHash, lease.nonce);
  const clients = [
    makeReceiptClient({
      wait: async () => { throw timeoutError; },
      read: async () => { throw receiptNotFound; },
      transaction: async () => transaction,
    }),
    makeReceiptClient({
      wait: async () => { throw timeoutError; },
      read: async () => { throw receiptNotFound; },
      transaction: async () => transaction,
    }),
  ];
  assert.deepEqual(
    await transferIntent.waitForWalletTransferIntentReceipt(
      clients,
      baseIntent,
      resolutionHash,
      1_000,
      now + 2,
    ),
    { status: "pending", hash: resolutionHash },
    "an exact transaction without a receipt must preserve the pending path",
  );
  assert.deepEqual(
    await transferIntent.acquireWalletTransferIntentLease(baseIntent, stableNonceClients, now + 3),
    { status: "known-hash", hash: resolutionHash },
    "pending behavior must retain the exact durable intent",
  );
}

{
  const { lease, now } = await recordResolutionIntent(baseIntent, resolutionHash);
  const transaction = transactionForIntent(baseIntent, resolutionHash, lease.nonce);
  const receipt = finalityReceiptFor(resolutionHash);
  const clients = [
    makeFinalityClient({ transaction, receipts: [receipt], head: receipt.blockNumber }),
    makeFinalityClient({ transaction, receipts: [receipt], head: receipt.blockNumber }),
  ];
  await assert.rejects(
    transferIntent.resolveWalletTransferIntent(
      baseIntent,
      resolutionHash,
      "confirmed",
      clients,
      now + 2,
    ),
    /wallet_transfer_receipt_finality_insufficient/,
    "a one-block observation must not clear a durable transfer intent",
  );
  assert.deepEqual(
    await transferIntent.acquireWalletTransferIntentLease(baseIntent, stableNonceClients, now + 3),
    { status: "known-hash", hash: resolutionHash },
    "insufficient finality must preserve the known hash",
  );
}

{
  const { lease, now } = await recordResolutionIntent(baseIntent, resolutionHash);
  const transaction = transactionForIntent(baseIntent, resolutionHash, lease.nonce);
  const receipt = finalityReceiptFor(resolutionHash);
  const reorgedReceipt = {
    ...receipt,
    blockHash: `0x${"d2".repeat(32)}`,
  };
  const clients = [
    makeFinalityClient({ transaction, receipts: [receipt, reorgedReceipt] }),
    makeFinalityClient({ transaction, receipts: [receipt, reorgedReceipt] }),
  ];
  await assert.rejects(
    transferIntent.resolveWalletTransferIntent(
      baseIntent,
      resolutionHash,
      "confirmed",
      clients,
      now + 2,
    ),
    /wallet_transfer_receipt_diverged/,
    "a post-finality-read reorg must not clear a durable transfer intent",
  );
  assert.deepEqual(
    await transferIntent.acquireWalletTransferIntentLease(baseIntent, stableNonceClients, now + 3),
    { status: "known-hash", hash: resolutionHash },
    "a post-read reorg must preserve the known hash",
  );
}

const originalReplacementHash = `0x${"e1".repeat(32)}`;
const repricedReplacementHash = `0x${"e2".repeat(32)}`;

const makeReplacementClient = ({
  reason = "repriced",
  replacedTransaction,
  transaction,
  canonicalTransaction = transaction,
  emitReplacement = true,
  receipt = finalityReceiptFor(transaction.hash),
  head = receipt.blockNumber + 1n,
}) => ({
  waitForTransactionReceipt: async ({ confirmations, onReplaced }) => {
    assert.equal(
      confirmations,
      transferIntent.WALLET_TRANSFER_FINALITY_CONFIRMATIONS,
      "wallet transfer waits must request the bounded finality depth",
    );
    if (emitReplacement) {
      onReplaced?.({ reason, replacedTransaction, transaction, transactionReceipt: receipt });
    }
    return receipt;
  },
  getTransactionReceipt: async () => receipt,
  getBlockNumber: async () => head,
  getTransaction: async ({ hash }) => {
    if (hash === transaction.hash) return canonicalTransaction;
    if (hash === replacedTransaction.hash) return replacedTransaction;
    throw transactionNotFound;
  },
});

{
  const { lease, now } = await recordResolutionIntent(baseIntent, originalReplacementHash);
  const replacedTransaction = transactionForIntent(
    baseIntent,
    originalReplacementHash,
    lease.nonce,
  );
  const replacementTransaction = transactionForIntent(
    baseIntent,
    repricedReplacementHash,
    lease.nonce,
  );
  const clients = [
    makeReplacementClient({ replacedTransaction, transaction: replacementTransaction }),
    makeReplacementClient({ replacedTransaction, transaction: replacementTransaction }),
  ];
  assert.deepEqual(
    await transferIntent.waitForWalletTransferIntentReceipt(
      clients,
      baseIntent,
      originalReplacementHash,
      1_000,
      now + 2,
    ),
    { status: "confirmed", hash: repricedReplacementHash },
    "two exact repriced observations must migrate the durable known hash",
  );
  assert.deepEqual(
    await transferIntent.acquireWalletTransferIntentLease(baseIntent, stableNonceClients, now + 3),
    { status: "known-hash", hash: repricedReplacementHash },
    "replacement migration must be durable before terminal resolution",
  );
  assert.equal(
    await transferIntent.resolveWalletTransferIntent(
      baseIntent,
      repricedReplacementHash,
      "confirmed",
      clients,
      now + 4,
    ),
    true,
    "the exact repriced hash must resolve after bounded finality and canonical recheck",
  );
}

async function persistOriginalTransactionType(lease, now) {
  const originalTransaction = transactionForIntent(
    baseIntent,
    originalReplacementHash,
    lease.nonce,
  );
  const pendingClients = [0, 1].map(() => ({
    waitForTransactionReceipt: async () => { throw timeoutError; },
    getTransactionReceipt: async () => { throw receiptNotFound; },
    getBlockNumber: async () => 124n,
    getTransaction: async ({ hash }) => {
      if (hash === originalReplacementHash) return originalTransaction;
      throw transactionNotFound;
    },
  }));
  assert.deepEqual(
    await transferIntent.waitForWalletTransferIntentReceipt(
      pendingClients,
      baseIntent,
      originalReplacementHash,
      1_000,
      now + 2,
    ),
    { status: "pending", hash: originalReplacementHash },
  );
}

const replacementMigrationFaults = [
  ...[0, 1].flatMap((rpcIndex) => ["before", "after"].map((phase) => ({
    name: `quota ${phase} RPC ${rpcIndex} observation commit`,
    operation: "setItem",
    key: replacementObservationStorageKey(baseIntent, rpcIndex),
    phase,
    errorName: "QuotaExceededError",
    error: /wallet_transfer_replacement_storage_write_failed/,
    emitOnReload: phase === "before",
  }))),
  ...["before", "after"].map((phase) => ({
    name: `quota ${phase} candidate state commit`,
    operation: "setItem",
    key: walletTransferStorageKey(baseIntent),
    phase,
    errorName: "QuotaExceededError",
    error: /wallet_transfer_intent_storage_write_failed/,
    prepareType: true,
  })),
  ...[0, 1].flatMap((rpcIndex) => ["before", "after"].map((phase) => ({
    name: `remove failure ${phase} RPC ${rpcIndex} observation cleanup`,
    operation: "removeItem",
    key: replacementObservationStorageKey(baseIntent, rpcIndex),
    phase,
    error: /wallet_transfer_replacement_storage_clear_failed/,
  }))),
];

for (const [faultIndex, fault] of replacementMigrationFaults.entries()) {
  const { lease, now } = await recordResolutionIntent(baseIntent, originalReplacementHash);
  if (fault.prepareType) await persistOriginalTransactionType(lease, now);
  const replacedTransaction = transactionForIntent(
    baseIntent,
    originalReplacementHash,
    lease.nonce,
  );
  const replacementTransaction = transactionForIntent(
    baseIntent,
    repricedReplacementHash,
    lease.nonce,
  );
  const clients = [
    makeReplacementClient({ replacedTransaction, transaction: replacementTransaction }),
    makeReplacementClient({ replacedTransaction, transaction: replacementTransaction }),
  ];
  storage.failNext(fault);
  await assert.rejects(
    transferIntent.waitForWalletTransferIntentReceipt(
      clients,
      baseIntent,
      originalReplacementHash,
      1_000,
      now + 3,
    ),
    fault.error,
    `${fault.name} must surface without unlocking the actor`,
  );
  const crashReloadModule = await import(
    new URL(
      `../app/lib/walletTransferIntent.ts?crash-reload=${Date.now()}-${faultIndex}`,
      import.meta.url,
    ).href
  );
  const crashReloadIntent = crashReloadModule.default ?? crashReloadModule;
  const resumedClients = [0, 1].map(() => makeReplacementClient({
    replacedTransaction,
    transaction: replacementTransaction,
    emitReplacement: fault.emitOnReload === true,
  }));
  const reloadedKnownHash = (
    await crashReloadIntent.acquireWalletTransferIntentLease(
      baseIntent,
      stableNonceClients,
      now + 4,
    )
  ).hash;
  assert.ok(
    reloadedKnownHash === originalReplacementHash ||
      reloadedKnownHash === repricedReplacementHash,
    `${fault.name} must retain either the original or exact candidate hash`,
  );
  assert.deepEqual(
    await crashReloadIntent.waitForWalletTransferIntentReceipt(
      resumedClients,
      baseIntent,
      originalReplacementHash,
      1_000,
      now + 5,
    ),
    { status: "confirmed", hash: repricedReplacementHash },
    `${fault.name} must recover the exact candidate after reload`,
  );
  assert.deepEqual(
    await crashReloadIntent.acquireWalletTransferIntentLease(
      baseIntent,
      stableNonceClients,
      now + 6,
    ),
    { status: "known-hash", hash: repricedReplacementHash },
    `${fault.name} must never unlock the actor during recovery`,
  );
}

{
  const { lease, now } = await recordResolutionIntent(baseIntent, originalReplacementHash);
  const replacedTransaction = transactionForIntent(
    baseIntent,
    originalReplacementHash,
    lease.nonce,
  );
  const replacementTransaction = transactionForIntent(
    baseIntent,
    repricedReplacementHash,
    lease.nonce,
  );
  const clients = [
    makeReplacementClient({ replacedTransaction, transaction: replacementTransaction }),
    makeReplacementClient({ replacedTransaction, transaction: replacementTransaction }),
  ];
  storage.failNext({
    operation: "removeItem",
    key: replacementObservationStorageKey(baseIntent, 0),
  });
  await assert.rejects(
    transferIntent.waitForWalletTransferIntentReceipt(
      clients,
      baseIntent,
      originalReplacementHash,
      1_000,
      now + 2,
    ),
    /wallet_transfer_replacement_storage_clear_failed/,
  );
  const observationKey = replacementObservationStorageKey(baseIntent, 0);
  const mismatchedObservation = JSON.parse(storage.getItem(observationKey));
  mismatchedObservation.candidateHash = otherResolutionHash;
  storage.setItem(observationKey, JSON.stringify(mismatchedObservation));
  const mismatchReloadModule = await import(
    new URL(`../app/lib/walletTransferIntent.ts?mismatch-reload=${Date.now()}`, import.meta.url).href
  );
  const mismatchReloadIntent = mismatchReloadModule.default ?? mismatchReloadModule;
  const resumedClients = [0, 1].map(() => makeReplacementClient({
    replacedTransaction,
    transaction: replacementTransaction,
    emitReplacement: false,
  }));
  await assert.rejects(
    mismatchReloadIntent.waitForWalletTransferIntentReceipt(
      resumedClients,
      baseIntent,
      repricedReplacementHash,
      1_000,
      now + 3,
    ),
    /wallet_transfer_replacement_rpc_disagreement/,
    "stale evidence for a different candidate must remain quarantined after reload",
  );
  assert.deepEqual(
    await mismatchReloadIntent.acquireWalletTransferIntentLease(
      baseIntent,
      stableNonceClients,
      now + 4,
    ),
    { status: "known-hash", hash: repricedReplacementHash },
    "mismatched stale evidence must not unlock the actor or overwrite the exact current candidate",
  );
}

for (const [faultIndex, fault] of [
  {
    name: "manual quota before candidate commit",
    operation: "setItem",
    key: walletTransferStorageKey(baseIntent),
    phase: "before",
    errorName: "QuotaExceededError",
    error: /wallet_transfer_intent_storage_write_failed/,
  },
  {
    name: "manual quota after candidate commit",
    operation: "setItem",
    key: walletTransferStorageKey(baseIntent),
    phase: "after",
    errorName: "QuotaExceededError",
    error: /wallet_transfer_intent_storage_write_failed/,
  },
  ...["before", "after"].map((phase) => ({
    name: `manual cleanup failure ${phase} remove`,
    operation: "removeItem",
    key: replacementObservationStorageKey(baseIntent, 0),
    phase,
    error: /wallet_transfer_replacement_storage_clear_failed/,
  })),
].entries()) {
  const { lease, now } = await recordResolutionIntent(baseIntent, originalReplacementHash);
  await persistOriginalTransactionType(lease, now);
  const replacedTransaction = transactionForIntent(
    baseIntent,
    originalReplacementHash,
    lease.nonce,
  );
  const replacementTransaction = transactionForIntent(
    baseIntent,
    repricedReplacementHash,
    lease.nonce,
  );
  const clients = [0, 1].map(() => makeReplacementClient({
    replacedTransaction,
    transaction: replacementTransaction,
    emitReplacement: false,
  }));
  storage.failNext(fault);
  await assert.rejects(
    transferIntent.reconcileWalletTransferReplacementCandidate(
      clients,
      [actor],
      repricedReplacementHash,
      1_000,
      now + 3,
    ),
    fault.error,
    `${fault.name} must surface without clearing the pending actor`,
  );
  const manualCrashReloadModule = await import(
    new URL(
      `../app/lib/walletTransferIntent.ts?manual-crash-reload=${Date.now()}-${faultIndex}`,
      import.meta.url,
    ).href
  );
  const manualCrashReloadIntent = manualCrashReloadModule.default ?? manualCrashReloadModule;
  assert.deepEqual(
    await manualCrashReloadIntent.reconcileWalletTransferReplacementCandidate(
      clients,
      [actor],
      repricedReplacementHash,
      1_000,
      now + 4,
    ),
    { status: "confirmed", hash: repricedReplacementHash },
    `${fault.name} must resume idempotently after reload`,
  );
  assert.equal(
    (
      await manualCrashReloadIntent.acquireWalletTransferIntentLease(
        baseIntent,
        stableNonceClients,
        now + 5,
      )
    ).status,
    "acquired",
    `${fault.name} may unlock only after exact finality and terminal resolution`,
  );
}

{
  const { lease, now } = await recordResolutionIntent(baseIntent, originalReplacementHash);
  const replacedTransaction = transactionForIntent(
    baseIntent,
    originalReplacementHash,
    lease.nonce,
  );
  const replacementTransaction = transactionForIntent(
    baseIntent,
    repricedReplacementHash,
    lease.nonce,
  );
  const replacementReceipt = finalityReceiptFor(repricedReplacementHash);
  let signalFirstObservation;
  let releaseInterruptedWait;
  const firstObservation = new Promise((resolve) => {
    signalFirstObservation = resolve;
  });
  const interruptedWait = new Promise((resolve) => {
    releaseInterruptedWait = resolve;
  });
  const interruptedClients = [0, 1].map((rpcIndex) => ({
    waitForTransactionReceipt: async ({ onReplaced }) => {
      if (rpcIndex === 0) {
        onReplaced?.({
          reason: "repriced",
          replacedTransaction,
          transaction: replacementTransaction,
          transactionReceipt: replacementReceipt,
        });
        signalFirstObservation();
      }
      await interruptedWait;
      throw timeoutError;
    },
    getTransactionReceipt: async () => { throw receiptNotFound; },
    getBlockNumber: async () => replacementReceipt.blockNumber + 1n,
    getTransaction: async ({ hash }) => {
      if (hash === originalReplacementHash) return replacedTransaction;
      if (hash === repricedReplacementHash) return replacementTransaction;
      throw transactionNotFound;
    },
  }));
  const interruptedAttempt = transferIntent.waitForWalletTransferIntentReceipt(
    interruptedClients,
    baseIntent,
    originalReplacementHash,
    1_000,
    now + 2,
  );
  await firstObservation;

  const reloadedModule = await import(
    new URL(`../app/lib/walletTransferIntent.ts?replacement-reload=${Date.now()}`, import.meta.url).href
  );
  const reloadedIntent = reloadedModule.default ?? reloadedModule;
  const resumedClients = [0, 1].map((rpcIndex) => ({
    waitForTransactionReceipt: async ({ onReplaced }) => {
      if (rpcIndex === 1) {
        onReplaced?.({
          reason: "repriced",
          replacedTransaction,
          transaction: replacementTransaction,
          transactionReceipt: replacementReceipt,
        });
      }
      return replacementReceipt;
    },
    getTransactionReceipt: async ({ hash }) => {
      if (hash === repricedReplacementHash) return replacementReceipt;
      throw receiptNotFound;
    },
    getBlockNumber: async () => replacementReceipt.blockNumber + 1n,
    getTransaction: async ({ hash }) => {
      if (hash === repricedReplacementHash) return replacementTransaction;
      throw transactionNotFound;
    },
  }));
  assert.deepEqual(
    await reloadedIntent.waitForWalletTransferIntentReceipt(
      resumedClients,
      baseIntent,
      originalReplacementHash,
      1_000,
      now + 3,
    ),
    { status: "confirmed", hash: repricedReplacementHash },
    "a reload between independent callbacks must combine their separately persisted exact observations",
  );
  assert.deepEqual(
    await reloadedIntent.acquireWalletTransferIntentLease(baseIntent, stableNonceClients, now + 4),
    { status: "known-hash", hash: repricedReplacementHash },
    "restart recovery must migrate the durable hash before any actor unlock",
  );
  releaseInterruptedWait();
  await assert.rejects(
    interruptedAttempt,
    /wallet_transfer_replacement_manual_reconciliation|wallet_transfer_receipt_finality_unavailable/,
    "the interrupted watcher must not overwrite the hash recovered by the reloaded watcher",
  );
  assert.equal(
    await reloadedIntent.resolveWalletTransferIntent(
      baseIntent,
      repricedReplacementHash,
      "confirmed",
      resumedClients,
      now + 5,
    ),
    true,
  );
}

{
  storage.clear();
  const now = Date.now();
  const originalTransaction = transactionForIntent(
    baseIntent,
    originalReplacementHash,
    7,
  );
  const replacementTransaction = transactionForIntent(
    baseIntent,
    repricedReplacementHash,
    7,
  );
  const identityNonceClients = [0, 1].map(() => ({
    ...stableNonceClient,
    getTransaction: async ({ hash }) => {
      if (hash === originalReplacementHash) return originalTransaction;
      throw transactionNotFound;
    },
  }));
  assert.equal(
    await transferIntent.withWalletTransferIntentLease(
      baseIntent,
      identityNonceClients,
      async (acquisition, retainResult) => {
        assert.equal(acquisition.status, "acquired");
        return (await retainResult(
          Promise.resolve({ hash: originalReplacementHash }),
          acquisition.lease,
        )).hash;
      },
      undefined,
      now,
    ),
    originalReplacementHash,
    "the final submit boundary must durably bind the original transaction type before returning its hash",
  );

  const replacementReceipt = finalityReceiptFor(repricedReplacementHash);
  const candidateClients = [0, 1].map(() => ({
    waitForTransactionReceipt: async () => replacementReceipt,
    getTransactionReceipt: async ({ hash }) => {
      if (hash === repricedReplacementHash) return replacementReceipt;
      throw receiptNotFound;
    },
    getBlockNumber: async () => replacementReceipt.blockNumber + 1n,
    getTransaction: async ({ hash }) => {
      if (hash === repricedReplacementHash) return replacementTransaction;
      throw transactionNotFound;
    },
  }));
  const manualReloadModule = await import(
    new URL(`../app/lib/walletTransferIntent.ts?manual-reload=${Date.now()}`, import.meta.url).href
  );
  const manualReloadIntent = manualReloadModule.default ?? manualReloadModule;
  assert.deepEqual(
    await manualReloadIntent.reconcileWalletTransferReplacementCandidate(
      candidateClients,
      [actor],
      repricedReplacementHash,
      1_000,
      now + 3,
    ),
    { status: "confirmed", hash: repricedReplacementHash },
    "a wired manual candidate must recover after reload when the original hash vanished before callbacks",
  );
  assert.equal(
    (await manualReloadIntent.acquireWalletTransferIntentLease(
      baseIntent,
      stableNonceClients,
      now + 4,
    )).status,
    "acquired",
    "only exact two-RPC identity plus finality may release the actor after manual recovery",
  );
}

{
  const { lease, now } = await recordResolutionIntent(baseIntent, originalReplacementHash);
  const originalTransaction = transactionForIntent(
    baseIntent,
    originalReplacementHash,
    lease.nonce,
  );
  const pendingOriginalClients = [0, 1].map(() => ({
    waitForTransactionReceipt: async () => { throw timeoutError; },
    getTransactionReceipt: async () => { throw receiptNotFound; },
    getBlockNumber: async () => 124n,
    getTransaction: async () => originalTransaction,
  }));
  await transferIntent.waitForWalletTransferIntentReceipt(
    pendingOriginalClients,
    baseIntent,
    originalReplacementHash,
    1_000,
    now + 2,
  );
  const attackerTransaction = transactionForIntent(
    baseIntent,
    repricedReplacementHash,
    lease.nonce,
    { value: baseIntent.amountWei + 1n },
  );
  const attackerClients = transactionClients(attackerTransaction);
  await assert.rejects(
    transferIntent.reconcileWalletTransferReplacementCandidate(
      attackerClients,
      [actor],
      repricedReplacementHash,
      1_000,
      now + 3,
    ),
    /wallet_transfer_transaction_intent_mismatch/,
    "an attacker-selected candidate with a different payload must fail before hash migration",
  );
  assert.deepEqual(
    await transferIntent.acquireWalletTransferIntentLease(baseIntent, stableNonceClients, now + 4),
    { status: "known-hash", hash: originalReplacementHash },
    "a mismatched manual candidate must never unlock the actor",
  );
}

{
  const { lease, now } = await recordResolutionIntent(baseIntent, originalReplacementHash);
  const replacedTransaction = transactionForIntent(
    baseIntent,
    originalReplacementHash,
    lease.nonce,
  );
  const replacementTransaction = transactionForIntent(
    baseIntent,
    repricedReplacementHash,
    lease.nonce,
  );
  const clients = [
    makeReplacementClient({ replacedTransaction, transaction: replacementTransaction }),
    makeReplacementClient({
      replacedTransaction,
      transaction: replacementTransaction,
      canonicalTransaction: { ...replacementTransaction, value: replacementTransaction.value + 1n },
    }),
  ];
  await assert.rejects(
    transferIntent.waitForWalletTransferIntentReceipt(
      clients,
      baseIntent,
      originalReplacementHash,
      1_000,
      now + 2,
    ),
    /wallet_transfer_transaction_diverged/,
    "replacement migration must fail before persistence when canonical RPC transaction views differ",
  );
  assert.deepEqual(
    await transferIntent.acquireWalletTransferIntentLease(baseIntent, stableNonceClients, now + 3),
    { status: "known-hash", hash: originalReplacementHash },
    "a failed canonical replacement check must atomically preserve the original known hash",
  );
}

{
  const { lease, now } = await recordResolutionIntent(baseIntent, originalReplacementHash);
  const replacedTransaction = transactionForIntent(baseIntent, originalReplacementHash, lease.nonce);
  const replacementTransaction = transactionForIntent(baseIntent, repricedReplacementHash, lease.nonce);
  const clients = [
    makeReplacementClient({ replacedTransaction, transaction: replacementTransaction }),
    makeReplacementClient({
      replacedTransaction,
      transaction: replacementTransaction,
      emitReplacement: false,
    }),
  ];
  await assert.rejects(
    transferIntent.waitForWalletTransferIntentReceipt(
      clients,
      baseIntent,
      originalReplacementHash,
      1_000,
      now + 2,
    ),
    /wallet_transfer_replacement_manual_reconciliation/,
    "a replacement reported by only one RPC must remain manual",
  );
  assert.deepEqual(
    await transferIntent.acquireWalletTransferIntentLease(baseIntent, stableNonceClients, now + 3),
    { status: "known-hash", hash: originalReplacementHash },
    "a one-sided replacement report must preserve the original hash",
  );
}

for (const vector of [
  { name: "cancelled", reason: "cancelled", mutate: (transaction) => ({ ...transaction, to: transaction.from, value: 0n }) },
  { name: "different replacement", reason: "replaced", mutate: (transaction) => ({ ...transaction, value: transaction.value + 1n }) },
  { name: "wrong chain", reason: "repriced", mutate: (transaction) => ({ ...transaction, chainId: transaction.chainId + 1 }) },
  { name: "wrong sender", reason: "repriced", mutate: (transaction) => ({ ...transaction, from: alternateAddress }) },
  { name: "wrong leased nonce", reason: "repriced", mutate: (transaction) => ({ ...transaction, nonce: transaction.nonce + 1 }) },
  { name: "wrong destination", reason: "repriced", mutate: (transaction) => ({ ...transaction, to: alternateAddress }) },
  { name: "wrong value", reason: "repriced", mutate: (transaction) => ({ ...transaction, value: transaction.value + 1n }) },
  { name: "wrong input", reason: "repriced", mutate: (transaction) => ({ ...transaction, input: "0x00" }) },
  { name: "wrong type", reason: "repriced", mutate: (transaction) => ({ ...transaction, type: "legacy" }) },
]) {
  const { lease, now } = await recordResolutionIntent(baseIntent, originalReplacementHash);
  const replacedTransaction = transactionForIntent(
    baseIntent,
    originalReplacementHash,
    lease.nonce,
  );
  const replacementTransaction = vector.mutate(transactionForIntent(
    baseIntent,
    repricedReplacementHash,
    lease.nonce,
  ));
  const clients = [
    makeReplacementClient({
      reason: vector.reason,
      replacedTransaction,
      transaction: replacementTransaction,
    }),
    makeReplacementClient({
      reason: vector.reason,
      replacedTransaction,
      transaction: replacementTransaction,
    }),
  ];
  await assert.rejects(
    transferIntent.waitForWalletTransferIntentReceipt(
      clients,
      baseIntent,
      originalReplacementHash,
      1_000,
      now + 2,
    ),
    /wallet_transfer_replacement_manual_reconciliation|wallet_transfer_transaction_intent_mismatch/,
    `${vector.name} must not migrate the durable hash automatically`,
  );
  assert.deepEqual(
    await transferIntent.acquireWalletTransferIntentLease(baseIntent, stableNonceClients, now + 3),
    { status: "known-hash", hash: originalReplacementHash },
    `${vector.name} must preserve the original known hash for manual reconciliation`,
  );
}

assert.equal(
  await transferIntent.waitForStableWalletTransferReceipt([
    makeReceiptClient({
      wait: async () => successfulReceipt,
      read: async () => successfulReceipt,
    }),
    makeReceiptClient({
      wait: async () => successfulReceipt,
      read: async () => successfulReceipt,
    }),
  ], receiptHash, 1_000),
  "confirmed",
  "a success may clear an intent only after two independent clients agree on its exact fingerprint",
);

await assert.rejects(
  transferIntent.waitForStableWalletTransferReceipt([
    makeReceiptClient({
      wait: async () => successfulReceipt,
      read: async () => ({ ...successfulReceipt, blockHash: `0x${"ac".repeat(32)}` }),
    }),
    makeReceiptClient({
      wait: async () => successfulReceipt,
      read: async () => ({ ...successfulReceipt, blockHash: `0x${"ac".repeat(32)}` }),
    }),
  ], receiptHash, 1_000),
  /wallet_transfer_receipt_diverged/,
  "a success reorg between quorum observation and immediate quorum reread must not clear the intent",
);

await assert.rejects(
  transferIntent.waitForStableWalletTransferReceipt([
    makeReceiptClient(),
    makeReceiptClient({ wait: async () => successfulReceipt }),
  ], receiptHash, 1_000),
  /wallet_transfer_receipt_diverged/,
  "one stale or malicious receipt RPC must not decide success or revert",
);

await assert.rejects(
  transferIntent.waitForStableWalletTransferReceipt([
    makeReceiptClient(),
    makeReceiptClient(),
  ], receiptHash, 1_000),
  transferIntent.WalletTransactionRevertedError,
  "two clients plus an immediate exact quorum reread of the same revert may release an intent",
);

await assert.rejects(
  transferIntent.waitForStableWalletTransferReceipt([
    makeReceiptClient({ read: async () => { throw receiptNotFound; } }),
    makeReceiptClient({ read: async () => { throw receiptNotFound; } }),
  ], receiptHash, 1_000),
  /wallet_transfer_receipt_diverged/,
  "a reverted receipt that disappears on immediate re-read must stay unresolved across a reorg or RPC divergence",
);

await assert.rejects(
  transferIntent.waitForStableWalletTransferReceipt([
    makeReceiptClient({
      wait: async () => { throw timeoutError; },
      read: async () => revertedReceipt,
    }),
    makeReceiptClient({
      wait: async () => { throw timeoutError; },
      read: async () => ({ ...revertedReceipt, blockHash: `0x${"aa".repeat(32)}` }),
    }),
  ], receiptHash, 1_000),
  /wallet_transfer_receipt_diverged/,
  "a timeout followed by two different reverted fork receipts must not clear the intent",
);

assert.equal(
  await transferIntent.waitForStableWalletTransferReceipt([
    makeReceiptClient({
      wait: async () => { throw timeoutError; },
      read: async () => { throw receiptNotFound; },
    }),
    makeReceiptClient({
      wait: async () => { throw timeoutError; },
      read: async () => { throw receiptNotFound; },
    }),
  ], receiptHash, 1_000),
  "pending",
  "a hash-known timeout with the transaction visible to both clients must remain pending",
);

await assert.rejects(
  transferIntent.waitForStableWalletTransferReceipt([
    makeReceiptClient({
      wait: async () => { throw timeoutError; },
      read: async () => { throw receiptNotFound; },
      transaction: async () => { throw transactionNotFound; },
    }),
    makeReceiptClient({
      wait: async () => { throw timeoutError; },
      read: async () => { throw receiptNotFound; },
      transaction: async () => { throw transactionNotFound; },
    }),
  ], receiptHash, 1_000),
  /wallet_transfer_transaction_missing_manual_reconciliation/,
  "a consumed or replaced known hash missing from both clients must remain manually blocked",
);

const privyWalletSource = readFileSync("app/hooks/usePrivyWallet.ts", "utf8");
assert.match(
  privyWalletSource,
  /selectWalletTransferAgreementRpcUrls\([\s\S]*createPublicClient\(\{ chain: APP_CHAIN, transport: http\(urls\[0\]\) \}\)[\s\S]*if \(lease\) baseRequest\.nonce = BigInt\(lease\.nonce\)[\s\S]*assertEmbeddedWalletActorCurrent\(expectedActor\)[\s\S]*const sendPromise = sendTransaction\(baseRequest, \{[\s\S]*address: expectedActor[\s\S]*withWalletTransferIntentLease\([\s\S]*WALLET_TRANSFER_NONCE_CLIENTS[\s\S]*submitSilentTransaction\(acquisition\.lease, retainResult\)/,
  "the final silent-send boundary must acquire the durable lease, revalidate the captured actor at the sink, bind reconciled retries, and retain late results",
);
assert.match(
  privyWalletSource,
  /tx\.contractIntent[\s\S]*createWalletContractIntent\([\s\S]*const transactionIntent = transferIntent \?\? contractIntent[\s\S]*assertWalletTransferIntentMatchesTransaction\(transactionIntent, tx\)[\s\S]*withWalletTransferIntentLease\([\s\S]*transactionIntent/,
  "explicit zero-value contract calls must enter the same exact-envelope durable late-hash boundary",
);
assert.match(
  privyWalletSource,
  /sendTransactionFromExternal[\s\S]*wallet_switchEthereumChain[\s\S]*assertExternalWalletProviderContext\([\s\S]*submitExternalTransaction[\s\S]*expectedActor: providerAccount[\s\S]*eth_sendTransaction[\s\S]*withWalletTransferIntentLease\([\s\S]*submitExternalTransaction\(acquisition\.lease, retainResult\)[\s\S]*isSafeExternalWalletProviderContextError/,
  "external transfers must revalidate the selected account and chain directly before their explicit wallet prompt while sharing the durable late-hash lease",
);

const walletActionsSource = readFileSync("app/hooks/useWalletActions.ts", "utf8");
const rewardScannerSource = readFileSync("app/hooks/useRewardScanner.ts", "utf8");
const deepRewardScanSource = readFileSync("app/hooks/useDeepRewardScan.ts", "utf8");
const rebateSource = readFileSync("app/hooks/useRebate.ts", "utf8");
const walletTransferIntentSource = readFileSync("app/lib/walletTransferIntent.ts", "utf8");
for (const [source, label] of [
  [rewardScannerSource, "reward scanner"],
  [deepRewardScanSource, "deep reward scanner"],
  [rebateSource, "Safety Pool"],
  [walletActionsSource, "embedded resolver rewards"],
]) {
  assert.match(
    source,
    /contractIntent: \{ contract: CONTRACT_ADDRESS, calldata: data \}/,
    `${label} silent claims must bind their exact calldata before the provider sink`,
  );
}
assert.doesNotMatch(
  rewardScannerSource + deepRewardScanSource,
  /acquireEoaNonceLockLease/,
  "reward claim hooks must not deadlock by nesting an outer actor lock around the durable sender lock",
);
assert.doesNotMatch(
  rebateSource,
  /acquireEoaNonceLockLease/,
  "Safety Pool must not nest an outer actor lock around either durable claim sender",
);
assert.match(
  rebateSource,
  /createClaimTransactionNonceClients\(\)[\s\S]*withClaimTransactionIntentLease\([\s\S]*account: sender[\s\S]*nonce: acquisition\.lease\.nonce/,
  "Safety Pool Wagmi claims must reserve the exact actor nonce and retain late hashes",
);
assert.match(
  rebateSource,
  /const confirmation = await waitForTrackedClaimTransactionReceiptAgreement\([\s\S]*actor: sender[\s\S]*calldata/,
  "Safety Pool claims must terminally reconcile the exact calldata for both wallet senders",
);
assert.match(
  rebateSource,
  /actorChangedError: claimActorChangedError[\s\S]*abandonOnError: \(error\) =>[\s\S]*isUserRejection\(error\) \|\| error === claimActorChangedError/,
  "Safety Pool may abandon only the exact pre-sink actor-change sentinel, not an ambiguous provider error observed after an address switch",
);
assert.doesNotMatch(
  rebateSource,
  /abandonOnError: \(error\) =>[\s\S]{0,120}isActorChangedError\(error\)/,
  "Safety Pool must not reinterpret an arbitrary provider failure as a proven pre-broadcast actor change",
);
assert.match(
  walletActionsSource,
  /handleClaimEmbeddedResolverRewards[\s\S]*createWalletContractIntent\([\s\S]*waitForTransferReceipt\(claimIntent, hash\)[\s\S]*resolveTransferIntent\(claimIntent, receiptState\.hash, "confirmed"\)/,
  "embedded resolver claims must validate and terminally resolve the exact durable contract intent",
);
assert.match(
  walletActionsSource,
  /handleClaimConnectedResolverRewards[\s\S]*withClaimTransactionIntentLease\([\s\S]*account: normalizedConnectedWalletAddress[\s\S]*nonce: acquisition\.lease\.nonce[\s\S]*waitForTransferReceipt\(claimIntent, hash\)[\s\S]*resolveTransferIntent\(claimIntent, receiptState\.hash, "confirmed"\)/,
  "connected resolver claims must use the same durable exact-envelope lifecycle as embedded claims",
);
assert.match(
  walletTransferIntentSource,
  /if \(state\.asset === "contract-call"\) return false/,
  "hashless contract calls must never be retried from unchanged nonce evidence alone",
);
assert.match(
  walletTransferIntentSource,
  /async function readWalletTransferTransactionQuorum[\s\S]*Promise\.allSettled\([\s\S]*getTransaction\(\{ hash \}\)[\s\S]*walletTransferTransactionFingerprint\(first\)[\s\S]*walletTransferTransactionFingerprint\(second\)[\s\S]*async function assertWalletTransferTransactionQuorum[\s\S]*assertWalletTransferTransactionMatchesIntent\(transaction, intent, hash, nonce\)[\s\S]*resolveWalletTransferIntent[\s\S]*const transaction = await assertWalletTransferTransactionQuorum[\s\S]*current\.transactionType[\s\S]*removeState\(intent\)/,
  "every terminal intent resolution must bind two exact transaction observations to the stored intent and leased nonce before clearing",
);
assert.match(
  walletTransferIntentSource,
  /replacementObservationKey[\s\S]*recordReplacementObservation[\s\S]*writeReplacementObservation[\s\S]*recoverPersistedReplacement[\s\S]*observations\[0\]\.candidateHash !== observations\[1\]\.candidateHash[\s\S]*clearReplacementObservations/,
  "each RPC replacement callback must persist independently and only matching durable observations may migrate the hash",
);
assert.match(
  walletTransferIntentSource,
  /retainWalletTransferSendResult\(promise, lease, async[\s\S]*getWalletTransferTransactionClients\(clients\)[\s\S]*recordWalletTransferIntentHashLocked[\s\S]*persistCanonicalWalletTransferTypeLocked/,
  "the real send-result boundary must bind the original transaction type through both configured RPC clients before returning when it is observable",
);
assert.match(
  walletTransferIntentSource,
  /reconcileWalletTransferReplacementCandidate[\s\S]*readWalletTransferTransactionQuorum\(clients, candidateHash\)[\s\S]*candidate\.type !== current\.transactionType[\s\S]*waitForWalletTransferIntentReceipt[\s\S]*resolveWalletTransferIntent/,
  "the manual restart path must bind the candidate to the stored original type and finality before actor release",
);
assert.match(
  walletActionsSource,
  /selectWalletTransferAgreementRpcUrls\([\s\S]*const WALLET_TRANSFER_RECEIPT_CLIENTS = createWalletTransferReceiptClients\(\)[\s\S]*walletTransferReceiptClients = WALLET_TRANSFER_RECEIPT_CLIENTS \?\? undefined[\s\S]*const waitForTransferReceipt[\s\S]*waitForWalletTransferIntentReceipt\([\s\S]*walletTransferReceiptClients/,
  "transfer receipt decisions must default to two distinct per-URL clients while allowing the same strict client pair to be injected for behavioral tests",
);
assert.match(
  walletActionsSource,
  /refreshPendingTransactionStatus = useCallback\(async \(replacementHash\?: string\)[\s\S]*reconcileWalletTransferReplacementCandidate\([\s\S]*walletTransferReceiptClients[\s\S]*allowedActors[\s\S]*candidateHash/,
  "wallet settings must wire the user-supplied replacement hash into the strict two-RPC reconciliation path",
);
assert.match(
  walletActionsSource,
  /handleWithdrawEthToExternal[\s\S]*createWalletTransferIntent\([\s\S]*sendTransactionSilent\([\s\S]*waitForTransferReceipt\(transferIntent, hash\)[\s\S]*if \(receiptState\.status === "pending"\)[\s\S]*return;[\s\S]*resolveTransferIntent\(transferIntent, receiptState\.hash, "confirmed"\)/,
  "known-hash pending behavior must retain the lease and confirmed receipts must resolve it",
);
assert.match(
  walletActionsSource,
  /handleDepositEthToEmbedded[\s\S]*Confirm the wallet prompt if it appears[\s\S]*sendTransactionFromExternal\(/,
  "external-wallet deposits must keep their explicit prompt path",
);
for (const handlerName of [
  "handleWithdrawToExternal",
  "handleWithdrawEthToExternal",
  "handleDepositEthToEmbedded",
  "handleDepositTokenToEmbedded",
]) {
  const start = walletActionsSource.indexOf(`const ${handlerName}`);
  assert.ok(start >= 0, `${handlerName} must remain present`);
  const end = walletActionsSource.indexOf("const handle", start + 10);
  const source = walletActionsSource.slice(start, end >= 0 ? end : undefined);
  assert.match(source, /createWalletTransferIntent\(/, `${handlerName} must create a durable exact intent`);
  assert.match(source, /waitForTransferReceipt\(transferIntent, hash\)/, `${handlerName} must require independent receipt agreement`);
  assert.match(source, /if \(!await resolveTransferIntent\(transferIntent, receiptState\.hash, "confirmed"\)\)/, `${handlerName} must fail closed when confirmed intent resolution returns false`);
  assert.match(source, /WalletTransactionRevertedError[\s\S]*resolveTransferIntent\(transferIntent, knownHash, "reverted"\)/, `${handlerName} must require stable typed revert evidence`);
}
for (const handlerName of ["handleDepositEthToEmbedded", "handleDepositTokenToEmbedded"]) {
  const start = walletActionsSource.indexOf(`const ${handlerName}`);
  const end = walletActionsSource.indexOf("const handle", start + 10);
  const source = walletActionsSource.slice(start, end >= 0 ? end : undefined);
  assert.match(source, /expectedActor: getAddress\(externalWalletAddress\)/, `${handlerName} must bind the explicit prompt to the prepared external account`);
}

async function assertProviderContextFailureIsSafe({ label, chainId, accounts, expectedCode }) {
  let failure;
  try {
    await assertExternalWalletProviderContext({
      provider: {
        request: async ({ method }) => method === "eth_chainId" ? chainId : accounts,
      },
      expectedActor: "0x1111111111111111111111111111111111111111",
      expectedChainId: 59144,
      timeoutMs: 50,
    });
  } catch (error) {
    failure = error;
  }

  if (!failure) throw new Error(`${label}: expected provider-context rejection`);
  if (isSafeExternalWalletProviderContextError(failure) !== expectedCode) {
    throw new Error(`${label}: incorrect safe-abandon classification`);
  }
}

// Provider data is untrusted, so only fully valid, proven pre-sink mismatches
// may release a lease.
await assertProviderContextFailureIsSafe({
  label: "valid wrong chain",
  chainId: "0x1",
  accounts: ["0x1111111111111111111111111111111111111111"],
  expectedCode: true,
});
await assertProviderContextFailureIsSafe({
  label: "explicit empty accounts",
  chainId: "0xe708",
  accounts: [],
  expectedCode: true,
});
await assertProviderContextFailureIsSafe({
  label: "valid wrong account",
  chainId: "0xe708",
  accounts: ["0x2222222222222222222222222222222222222222"],
  expectedCode: true,
});
await assertProviderContextFailureIsSafe({
  label: "malformed chain ID",
  chainId: "not-a-chain",
  accounts: ["0x1111111111111111111111111111111111111111"],
  expectedCode: false,
});
await assertProviderContextFailureIsSafe({
  label: "malformed accounts response",
  chainId: "0xe708",
  accounts: { 0: "0x1111111111111111111111111111111111111111", length: 1 },
  expectedCode: false,
});
await assertProviderContextFailureIsSafe({
  label: "invalid account address",
  chainId: "0xe708",
  accounts: ["not-an-address"],
  expectedCode: false,
});

console.log("wallet transfer intent tests passed");
