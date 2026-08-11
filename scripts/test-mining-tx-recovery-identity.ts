import assert from "node:assert/strict";

import {
  recoverPendingMiningTx,
  sanitizePendingMiningTxState,
} from "../app/lib/miningTxPath";

const actor = "0x2222222222222222222222222222222222222222" as const;
const contract = "0x1111111111111111111111111111111111111111" as const;

async function main() {
  const hashless = sanitizePendingMiningTxState({
    chainId: 59141,
    contract,
    actor,
    nonce: 7,
    ts: 1_000,
  }, 2_000);
  assert.ok(hashless);

  assert.equal(
    await recoverPendingMiningTx({
      getTransactionReceipt: async () => {
        throw new Error("hashless recovery must not request a receipt without a transaction identity");
      },
      getTransaction: async () => {
        throw new Error("hashless recovery must not request a transaction without a hash");
      },
      getTransactionCount: async ({ blockTag }) => blockTag === "latest" ? 8 : 8,
    }, hashless),
    "manual-reconciliation-required",
    "a consumed nonce without a hash must retain the duplicate-send block until the user reconciles it",
  );

  assert.equal(
    await recoverPendingMiningTx({
      getTransactionReceipt: async () => {
        throw new Error("hashless recovery must not request a receipt without a transaction identity");
      },
      getTransaction: async () => {
        throw new Error("hashless recovery must not request a transaction without a hash");
      },
      getTransactionCount: async ({ blockTag }) => blockTag === "latest" ? 7 : 8,
    }, hashless),
    "pending",
    "a node-observed pending nonce must remain pending",
  );

  const hash = `0x${"a".repeat(64)}` as `0x${string}`;
  const identified = sanitizePendingMiningTxState({
    chainId: 59141,
    contract,
    actor,
    hash,
    nonce: 7,
    ts: 1_000,
  }, 2_000);
  assert.ok(identified);

  let receiptCalls = 0;
  assert.equal(
    await recoverPendingMiningTx({
      getTransactionReceipt: async ({ hash: requestedHash }) => {
        receiptCalls += 1;
        assert.equal(requestedHash, hash);
        return { status: "success" as const };
      },
      getTransaction: async () => {
        throw new Error("a successful identified receipt must finish recovery");
      },
      getTransactionCount: async () => {
        throw new Error("an identified transaction must not use nonce-only recovery");
      },
    }, identified),
    "confirmed",
    "a successful receipt for the tracked hash must preserve confirmed recovery",
  );
  assert.equal(receiptCalls, 1);

  console.log("Mining transaction recovery identity checks passed.");
}

void main();
