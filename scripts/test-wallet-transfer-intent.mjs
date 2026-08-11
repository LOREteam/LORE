import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { encodeFunctionData } from "viem";
import * as transferIntentModule from "../app/lib/walletTransferIntent.ts";
import * as utilsModule from "../app/lib/utils.ts";

const transferIntent = transferIntentModule.default ?? transferIntentModule;
const utils = utilsModule.default ?? utilsModule;

class MemoryStorage {
  #values = new Map();

  get length() {
    return this.#values.size;
  }

  clear() {
    this.#values.clear();
  }

  getItem(key) {
    return this.#values.has(key) ? this.#values.get(key) : null;
  }

  key(index) {
    return [...this.#values.keys()][index] ?? null;
  }

  removeItem(key) {
    this.#values.delete(key);
  }

  setItem(key, value) {
    this.#values.set(String(key), String(value));
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
  await transferIntent.resolveWalletTransferIntent(baseIntent, lateHash, "confirmed"),
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
} = {}) => ({
  waitForTransactionReceipt: wait,
  getTransactionReceipt: read,
  getTransaction: transaction,
});

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
  /selectWalletTransferAgreementRpcUrls\([\s\S]*createPublicClient\(\{ chain: APP_CHAIN, transport: http\(urls\[0\]\) \}\)[\s\S]*if \(lease\) baseRequest\.nonce = BigInt\(lease\.nonce\)[\s\S]*const sendPromise = sendTransaction\(baseRequest, \{[\s\S]*address: embeddedWalletAddress[\s\S]*withWalletTransferIntentLease\([\s\S]*WALLET_TRANSFER_NONCE_CLIENTS[\s\S]*submitSilentTransaction\(acquisition\.lease, retainResult\)/,
  "the final silent-send boundary must acquire the durable lease, bind reconciled retries, and retain late results",
);
assert.match(
  privyWalletSource,
  /sendTransactionFromExternal[\s\S]*wallet_switchEthereumChain[\s\S]*wallet_transfer_intent_actor_changed[\s\S]*eth_sendTransaction[\s\S]*withWalletTransferIntentLease\([\s\S]*submitExternalTransaction\(acquisition\.lease, retainResult\)[\s\S]*abandonOnError: isUserRejection/,
  "external transfers must retain their explicit wallet prompt while sharing the durable late-hash lease",
);

const walletActionsSource = readFileSync("app/hooks/useWalletActions.ts", "utf8");
assert.match(
  walletActionsSource,
  /selectWalletTransferAgreementRpcUrls\([\s\S]*WALLET_TRANSFER_RECEIPT_CLIENTS[\s\S]*const waitForTransferReceipt[\s\S]*waitForStableWalletTransferReceipt\([\s\S]*WALLET_TRANSFER_RECEIPT_CLIENTS/,
  "transfer receipt decisions must use two distinct per-URL clients rather than one fallback client",
);
assert.match(
  walletActionsSource,
  /handleWithdrawEthToExternal[\s\S]*createWalletTransferIntent\([\s\S]*sendTransactionSilent\([\s\S]*if \(receiptState === "pending"\)[\s\S]*return;[\s\S]*resolveWalletTransferIntent\(transferIntent, hash, "confirmed"\)/,
  "known-hash pending behavior must retain the lease and confirmed receipts must resolve it",
);
assert.match(
  walletActionsSource,
  /waitForStableWalletTransferReceipt\([\s\S]*err instanceof WalletTransactionRevertedError[\s\S]*resolveWalletTransferIntent\(transferIntent, knownHash, "reverted"\)/,
  "only a stably re-read typed reverted receipt for the same hash may release the transfer intent for retry",
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
  assert.match(source, /waitForTransferReceipt\(hash\)/, `${handlerName} must require independent receipt agreement`);
  assert.match(source, /if \(!await resolveWalletTransferIntent\(transferIntent, hash, "confirmed"\)\)/, `${handlerName} must fail closed when confirmed intent resolution returns false`);
  assert.match(source, /WalletTransactionRevertedError[\s\S]*resolveWalletTransferIntent\(transferIntent, knownHash, "reverted"\)/, `${handlerName} must require stable typed revert evidence`);
}
for (const handlerName of ["handleDepositEthToEmbedded", "handleDepositTokenToEmbedded"]) {
  const start = walletActionsSource.indexOf(`const ${handlerName}`);
  const end = walletActionsSource.indexOf("const handle", start + 10);
  const source = walletActionsSource.slice(start, end >= 0 ? end : undefined);
  assert.match(source, /expectedActor: getAddress\(externalWalletAddress\)/, `${handlerName} must bind the explicit prompt to the prepared external account`);
}

console.log("wallet transfer intent tests passed");
