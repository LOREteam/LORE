import assert from "node:assert/strict";
import {
  deriveCurrentRoundEvidence,
  type CurrentRoundEvidence,
  type DeriveCurrentRoundEvidenceInput,
} from "../app/lib/currentRoundEvidence";

function epochTuple(poolWei: bigint): readonly [bigint, bigint, bigint, boolean, boolean, boolean] {
  return [poolWei, 1_700_000_000n, 0n, false, false, false] as const;
}

const cases: ReadonlyArray<{
  name: string;
  input: DeriveCurrentRoundEvidenceInput;
  expected: CurrentRoundEvidence;
}> = [
  {
    name: "zero pool is authoritative empty evidence",
    input: {
      currentEpoch: 42n,
      currentEpochData: epochTuple(0n),
      effectiveEpochEndTime: 1_700_000_060n,
    },
    expected: {
      currentEpoch: 42n,
      currentEpochTotalPoolWei: 0n,
      effectiveEpochEndTime: 1_700_000_060n,
    },
  },
  {
    name: "one wei remains exact funded evidence",
    input: {
      currentEpoch: 42n,
      currentEpochData: epochTuple(1n),
      effectiveEpochEndTime: 1_700_000_060n,
    },
    expected: {
      currentEpoch: 42n,
      currentEpochTotalPoolWei: 1n,
      effectiveEpochEndTime: 1_700_000_060n,
    },
  },
  {
    name: "large pool is not converted through number",
    input: {
      currentEpoch: 42n,
      currentEpochData: epochTuple(10n ** 40n),
      effectiveEpochEndTime: 10n ** 30n,
    },
    expected: {
      currentEpoch: 42n,
      currentEpochTotalPoolWei: 10n ** 40n,
      effectiveEpochEndTime: 10n ** 30n,
    },
  },
  {
    name: "missing epoch fails the entire binding closed",
    input: {
      currentEpoch: null,
      currentEpochData: epochTuple(1n),
      effectiveEpochEndTime: 1_700_000_060n,
    },
    expected: {
      currentEpoch: null,
      currentEpochTotalPoolWei: null,
      effectiveEpochEndTime: null,
    },
  },
  {
    name: "malformed tuple does not become empty evidence",
    input: {
      currentEpoch: 42n,
      currentEpochData: [0n],
      effectiveEpochEndTime: 1_700_000_060n,
    },
    expected: {
      currentEpoch: 42n,
      currentEpochTotalPoolWei: null,
      effectiveEpochEndTime: 1_700_000_060n,
    },
  },
  {
    name: "non-bigint pool is not coerced",
    input: {
      currentEpoch: 42n,
      currentEpochData: ["1", 1n, 0n, false, false, false],
      effectiveEpochEndTime: 1_700_000_060n,
    },
    expected: {
      currentEpoch: 42n,
      currentEpochTotalPoolWei: null,
      effectiveEpochEndTime: 1_700_000_060n,
    },
  },
  {
    name: "invalid end time is independently unknown",
    input: {
      currentEpoch: 42n,
      currentEpochData: epochTuple(1n),
      effectiveEpochEndTime: 0n,
    },
    expected: {
      currentEpoch: 42n,
      currentEpochTotalPoolWei: 1n,
      effectiveEpochEndTime: null,
    },
  },
];

for (const testCase of cases) {
  assert.deepEqual(
    deriveCurrentRoundEvidence(testCase.input),
    testCase.expected,
    testCase.name,
  );
}

assert.deepEqual(
  deriveCurrentRoundEvidence({
    currentEpoch: 0n,
    currentEpochData: epochTuple(0n),
    effectiveEpochEndTime: 1n,
  }),
  { currentEpoch: null, currentEpochTotalPoolWei: null, effectiveEpochEndTime: null },
  "epoch zero cannot bind current-round evidence",
);

assert.equal(
  deriveCurrentRoundEvidence({
    currentEpoch: 42n,
    currentEpochData: [-1n, 1n, 0n, false, false, false],
    effectiveEpochEndTime: 1n,
  }).currentEpochTotalPoolWei,
  null,
  "negative pool fails closed",
);

console.log(`current round evidence tests passed (${cases.length} table cases)`);
