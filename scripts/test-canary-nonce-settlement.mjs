import assert from "node:assert/strict";
import test from "node:test";
import { waitForNonceQueueSettlement } from "./lib/canary-nonce-settlement.mjs";

test("nonce settlement accepts a transient latest/pending propagation lag", async () => {
  const pairs = [
    { latest: 10, pending: 11 },
    { latest: 11, pending: 11 },
  ];
  const delays = [];
  const result = await waitForNonceQueueSettlement({
    readNoncePair: async () => pairs.shift(),
    retryDelayMs: 7,
    sleep: async (ms) => delays.push(ms),
  });
  assert.deepEqual(result, { latest: 11, pending: 11, attempts: 2 });
  assert.deepEqual(delays, [7]);
});

test("nonce settlement rejects a persistent pending transaction after its bounded retries", async () => {
  const delays = [];
  await assert.rejects(
    () => waitForNonceQueueSettlement({
      readNoncePair: async () => ({ latest: 10, pending: 11 }),
      maxAttempts: 3,
      retryDelayMs: 5,
      sleep: async (ms) => delays.push(ms),
    }),
    /Pending transaction blocked by nonce: latest=10 pending=11/,
  );
  assert.deepEqual(delays, [5, 5]);
});
