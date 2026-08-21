import assert from "node:assert/strict";
import * as jackpotShareModule from "../app/lib/jackpotShareVerification.ts";

const { normalizeJackpotShareEventId, selectVerifiedJackpotShare } = jackpotShareModule.default ?? jackpotShareModule;

const txA = `0x${"aa".repeat(32)}`;
const txB = `0x${"bb".repeat(32)}`;
const blockHash = `0x${"cc".repeat(32)}`;

function event(overrides = {}) {
  return {
    epoch: "42",
    kind: "daily",
    amount: "12.5",
    txHash: txA,
    blockNumber: "100",
    eventId: `${txA}:7`,
    logIndex: "7",
    blockHash,
    finalizedAtBlock: "112",
    ...overrides,
  };
}

export function runJackpotShareVerificationTests() {
  assert.equal(normalizeJackpotShareEventId(`${txA.toUpperCase()}:0007`), `${txA}:7`);
  assert.equal(normalizeJackpotShareEventId(`${txA}:9007199254740992`), null);

  const canonical = event();
  assert.deepEqual(selectVerifiedJackpotShare([canonical], canonical.eventId), {
    eventId: `${txA}:7`,
    txHash: txA,
    logIndex: "7",
    epoch: "42",
    kind: "daily",
    amount: "12.5",
  });
  assert.equal(
    selectVerifiedJackpotShare([canonical], txA)?.eventId,
    canonical.eventId,
    "a legacy tx URL may resolve only one finalized canonical event",
  );
  assert.equal(
    selectVerifiedJackpotShare([canonical, event({ eventId: `${txA}:8`, logIndex: "8" })], txA),
    null,
    "a tx with multiple jackpot logs must not select an arbitrary event",
  );
  assert.equal(
    selectVerifiedJackpotShare([event({ eventId: `${txA}:7`, logIndex: "8" })], `${txA}:7`),
    null,
    "event IDs must be bound to their stored log index",
  );
  assert.equal(
    selectVerifiedJackpotShare([event({ blockHash: "0xnot-a-block-hash" })], `${txA}:7`),
    null,
    "events without canonical block-hash evidence are never shareable",
  );
  assert.equal(
    selectVerifiedJackpotShare([event({ finalizedAtBlock: "99" })], `${txA}:7`),
    null,
    "events above the recorded finalized target are never shareable",
  );
  assert.equal(
    selectVerifiedJackpotShare([{ ...event(), txHash: txB, eventId: undefined, logIndex: undefined }], txB),
    null,
    "pre-migration tx-only rows remain history, not trusted share evidence",
  );
}

if (process.argv[1]?.endsWith("test-business-jackpot-share-verification.mjs")) {
  runJackpotShareVerificationTests();
}