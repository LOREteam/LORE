import assert from "node:assert/strict";
import {
  deriveRoundPresentation,
  KEEPER_DELAY_THRESHOLD_MS,
  normalizeRoundEpochEndMs,
  type RoundPhase,
  type RoundPresentation,
  type RoundPresentationInput,
  type RoundPresentationKind,
} from "../app/lib/roundPresentation";
import type { CurrentRoundEvidence } from "../app/lib/currentRoundEvidence";

const END_SECONDS = 1_700_000_000n;
const END_MS = Number(END_SECONDS) * 1000;

function evidence(
  currentEpoch: bigint | null,
  currentEpochTotalPoolWei: bigint | null,
  effectiveEpochEndTime: bigint | null = END_SECONDS,
): CurrentRoundEvidence {
  return { currentEpoch, currentEpochTotalPoolWei, effectiveEpochEndTime };
}

const baseInput: RoundPresentationInput = {
  actualCurrentEpoch: 12n,
  gridDisplayEpoch: "12",
  visualEpoch: "12",
  isRevealing: false,
  liveStateReady: true,
  timerReady: true,
  timeLeft: 30,
  currentRoundEvidence: evidence(12n, 1n),
  nowMs: END_MS - 30_000,
};

type ExpectedPresentation = Pick<RoundPresentation, "kind"> &
  Partial<Omit<RoundPresentation, "kind">>;

const cases: ReadonlyArray<{
  name: string;
  input: Partial<RoundPresentationInput>;
  expected: ExpectedPresentation;
}> = [
  {
    name: "syncing until live state is ready",
    input: { liveStateReady: false },
    expected: { kind: "syncing", phase: "syncing", timerDisplay: "placeholder" },
  },
  {
    name: "stale RPC suppresses an untrusted countdown",
    input: { health: { rpc: "stale" } },
    expected: {
      kind: "stale-rpc",
      phase: "syncing",
      statusLabel: "RPC stale",
      timerDisplay: "placeholder",
    },
  },
  {
    name: "stale indexer keeps exact chain countdown",
    input: { health: { rpc: "fresh", indexer: "stale" } },
    expected: {
      kind: "stale-indexer",
      phase: "active",
      statusLabel: "Indexer stale",
      timerDisplay: "countdown",
    },
  },
  {
    name: "999ms before canonical end is the exact 00:00 window",
    input: { timeLeft: 0, nowMs: END_MS - 999 },
    expected: { kind: "countdown-zero", statusLabel: "00:00", timerStalled: true },
  },
  {
    name: "one wei is an active funded round",
    input: {},
    expected: { kind: "active", statusLabel: "Mining", timerStalled: false },
  },
  {
    name: "zero wei is an active empty round",
    input: { currentRoundEvidence: evidence(12n, 0n) },
    expected: { kind: "active-empty", statusLabel: "No bets yet", timerStalled: false },
  },
  {
    name: "exact canonical end is settlement pending",
    input: { timeLeft: 0, nowMs: END_MS },
    expected: { kind: "settlement-pending", statusLabel: "Settling", timerStalled: true },
  },
  {
    name: "exactly 120000ms overdue remains settlement pending",
    input: { timeLeft: 0, nowMs: END_MS + KEEPER_DELAY_THRESHOLD_MS },
    expected: { kind: "settlement-pending", statusLabel: "Settling", timerStalled: true },
  },
  {
    name: "reload at 120001ms overdue is immediately keeper delayed",
    input: { timeLeft: 0, nowMs: END_MS + KEEPER_DELAY_THRESHOLD_MS + 1 },
    expected: { kind: "keeper-delayed", statusLabel: "Keeper delayed", accent: "danger" },
  },
  {
    name: "expired zero-wei round remains actionable",
    input: {
      timeLeft: 0,
      nowMs: END_MS,
      currentRoundEvidence: evidence(12n, 0n),
    },
    expected: { kind: "expired-empty", statusLabel: "No bets", blocksBetting: false },
  },
  {
    name: "resolved grid round keeps the exact next-round countdown",
    input: {
      actualCurrentEpoch: 43n,
      gridDisplayEpoch: "42",
      visualEpoch: "43",
      isRevealing: true,
      timeLeft: 27,
      currentRoundEvidence: evidence(43n, 0n),
    },
    expected: {
      kind: "resolved-next-round",
      epochHeading: "Resolved",
      epoch: "42",
      nextEpoch: "43",
      timerHeading: "Next #43",
      timerDisplay: "countdown",
      statusLabel: "Resolved",
      blocksBetting: false,
    },
  },
];

for (const testCase of cases) {
  const actual = deriveRoundPresentation({ ...baseInput, ...testCase.input });
  for (const [key, value] of Object.entries(testCase.expected)) {
    assert.deepEqual(
      actual[key as keyof RoundPresentation],
      value,
      `${testCase.name}: ${key}`,
    );
  }
  assert.equal(actual.blocksBetting, false, `${testCase.name}: presentation must not block betting`);
}

const allKinds: RoundPresentationKind[] = [
  "syncing",
  "stale-rpc",
  "stale-indexer",
  "countdown-zero",
  "active",
  "active-empty",
  "settlement-pending",
  "keeper-delayed",
  "expired-empty",
  "resolved-next-round",
];
assert.deepEqual(
  [...new Set(cases.map((testCase) => testCase.expected.kind))].sort(),
  [...allKinds].sort(),
  "table must cover every round presentation kind",
);

const allPhases: RoundPhase[] = [
  "syncing",
  "countdown-zero",
  "active",
  "active-empty",
  "settlement-pending",
  "keeper-delayed",
  "expired-empty",
  "resolved-next-round",
];
assert.deepEqual(
  [
    ...new Set(
      cases
        .filter((testCase) => !testCase.expected.kind.startsWith("stale-"))
        .map((testCase) => testCase.expected.kind as RoundPhase),
    ),
  ].sort(),
  [...allPhases].sort(),
  "fresh-state cases must cover every round phase",
);

assert.equal(
  deriveRoundPresentation({
    ...baseInput,
    currentRoundEvidence: evidence(13n, 0n),
  }).kind,
  "syncing",
  "epoch-mismatched evidence fails closed",
);

assert.equal(
  deriveRoundPresentation({
    ...baseInput,
    currentRoundEvidence: evidence(12n, null),
  }).kind,
  "syncing",
  "unknown pool never becomes empty evidence",
);

assert.equal(
  deriveRoundPresentation({
    ...baseInput,
    currentRoundEvidence: evidence(12n, 0n, null),
  }).kind,
  "syncing",
  "unknown canonical end time fails closed",
);

assert.equal(
  deriveRoundPresentation({
    ...baseInput,
    timeLeft: 0,
    nowMs: END_MS - 1_000,
  }).kind,
  "syncing",
  "00:00 is valid only inside the final sub-second floor window",
);

assert.equal(
  deriveRoundPresentation({
    ...baseInput,
    currentRoundEvidence: evidence(12n, 10n ** 40n),
  }).kind,
  "active",
  "large exact pools never pass through number conversion",
);

const hugeEpoch = 123456789012345678901234n;
const hugeEpochPresentation = deriveRoundPresentation({
  ...baseInput,
  actualCurrentEpoch: hugeEpoch,
  gridDisplayEpoch: hugeEpoch.toString(),
  visualEpoch: hugeEpoch.toString(),
  currentRoundEvidence: evidence(hugeEpoch, 1n),
});
assert.equal(hugeEpochPresentation.kind, "active");
assert.equal(
  hugeEpochPresentation.epoch,
  hugeEpoch.toString(),
  "large exact epochs never pass through number conversion",
);

const staleResolved = deriveRoundPresentation({
  ...baseInput,
  actualCurrentEpoch: 43n,
  gridDisplayEpoch: "42",
  visualEpoch: "43",
  isRevealing: true,
  currentRoundEvidence: evidence(43n, 1n),
  health: { rpc: "fresh", indexer: "stale" },
});
assert.equal(staleResolved.kind, "stale-indexer");
assert.equal(staleResolved.phase, "resolved-next-round");
assert.equal(staleResolved.epoch, "42");
assert.equal(staleResolved.nextEpoch, "43");
assert.equal(staleResolved.timerDisplay, "countdown");

const bothSourcesStale = deriveRoundPresentation({
  ...baseInput,
  health: { rpc: "stale", indexer: "stale" },
});
assert.equal(bothSourcesStale.kind, "stale-rpc");
assert.deepEqual(bothSourcesStale.health, { rpc: "stale", indexer: "stale" });

assert.equal(normalizeRoundEpochEndMs(END_SECONDS), END_MS);
assert.equal(normalizeRoundEpochEndMs("1700000000"), null);

console.log(`round presentation tests passed (${cases.length} canonical-time cases)`);
