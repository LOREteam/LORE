import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as miningGridModule from "../app/components/MiningGrid.tsx";
import * as gameDataHelpersModule from "../app/hooks/useGameData.helpers.ts";
import * as roundPresentationModule from "../app/lib/roundPresentation.ts";

export function runGameDataPresentationTests() {
  const gameDataHelpers = gameDataHelpersModule.default ?? gameDataHelpersModule;
  const miningGrid = miningGridModule.default ?? miningGridModule;
  const roundPresentation = roundPresentationModule.default ?? roundPresentationModule;
  const roundInput = {
    actualCurrentEpoch: 17n,
    gridDisplayEpoch: "17",
    visualEpoch: "17",
    isRevealing: false,
    liveStateReady: true,
    timerReady: true,
    timeLeft: 30,
    currentRoundEvidence: {
      currentEpoch: 17n,
      currentEpochTotalPoolWei: 1n,
      effectiveEpochEndTime: 2n,
    },
    nowMs: 1_000,
  };
  assert.equal(roundPresentation.normalizeRoundEpochEndMs(2n), 2_000);
  assert.equal(roundPresentation.normalizeRoundEpochEndMs(0n), null);
  assert.equal(roundPresentation.normalizeRoundEpochEndMs("2"), null);
  assert.equal(roundPresentation.normalizeRoundEpochEndMs(BigInt(Number.MAX_SAFE_INTEGER)), null);
  assert.equal(
    roundPresentation.deriveRoundPresentation({ ...roundInput, timeLeft: 0, nowMs: 1_500 }).kind,
    "countdown-zero",
    "a live epoch with a local 00:00 countdown must show its imminent end state",
  );
  assert.equal(
    roundPresentation.deriveRoundPresentation({ ...roundInput, currentRoundEvidence: { ...roundInput.currentRoundEvidence, currentEpochTotalPoolWei: 0n } }).kind,
    "active-empty",
    "an active empty epoch must remain distinct from resolution states",
  );
  assert.equal(
    roundPresentation.deriveRoundPresentation({ ...roundInput, nowMs: 2_001 }).kind,
    "settlement-pending",
    "a funded expired epoch must show settlement pending before the keeper-delay threshold",
  );
  assert.equal(
    roundPresentation.deriveRoundPresentation({ ...roundInput, nowMs: 122_001 }).kind,
    "keeper-delayed",
    "a funded epoch beyond the keeper-delay threshold must expose a distinct delay state",
  );
  assert.equal(
    roundPresentation.deriveRoundPresentation({ ...roundInput, health: { rpc: "stale" } }).kind,
    "stale-rpc",
    "stale chain evidence must override normal live presentation",
  );
  assert.equal(
    roundPresentation.deriveRoundPresentation({ ...roundInput, health: { indexer: "stale" } }).kind,
    "stale-indexer",
    "stale indexed evidence must be visible after a valid chain presentation is derived",
  );
  assert.equal(gameDataHelpers.buildJackpotInfo({}), null);
  assert.equal(gameDataHelpers.buildRolloverAmount("bad-shape"), 0);
  assert.equal(gameDataHelpers.buildRealTotalStaked([[1_000_000_000_000_000_000n, "bad"], []], 2_000_000_000_000_000_000n), 3);
  assert.equal(
    gameDataHelpers.buildWinningTileId(true, [0n, 0n, 25n, true, false, false]),
    25,
    "resolved current epoch winner should publish valid grid tile IDs",
  );
  assert.equal(
    gameDataHelpers.buildWinningTileId(true, [0n, 0n, 26n, true, false, false]),
    null,
    "resolved current epoch winner must reject out-of-range grid tile IDs",
  );
  assert.equal(
    gameDataHelpers.buildWinningTileId(true, [0n, 0n, 0n, true, false, false]),
    null,
    "resolved current epoch winner must reject zero tile IDs",
  );
  assert.equal(
    gameDataHelpers.buildWinningTileId(false, [0n, 0n, 2n, true, false, false]),
    null,
    "winner tile must stay hidden when not revealing",
  );
  assert.deepEqual(
    gameDataHelpers.buildEpochDurationChange(60n, 120n, 999n, 44n),
    {
      current: 60,
      next: 120,
      eta: 999,
      effectiveFromEpoch: "44",
    },
    "epoch duration change helper should publish safe chain integer evidence",
  );
  assert.equal(
    gameDataHelpers.buildEpochDurationChange(60n, 0n, 999n, 44n),
    null,
    "epoch duration change helper should ignore zero pending duration",
  );
  assert.equal(
    gameDataHelpers.buildEpochDurationChange(60n, BigInt(Number.MAX_SAFE_INTEGER) + 1n, 999n, 44n),
    null,
    "epoch duration change helper should reject unsafe pending duration evidence",
  );
  assert.deepEqual(
    gameDataHelpers.buildEpochDurationChange(BigInt(Number.MAX_SAFE_INTEGER) + 1n, 120n, BigInt(Number.MAX_SAFE_INTEGER) + 1n, 44n),
    {
      current: null,
      next: 120,
      eta: null,
      effectiveFromEpoch: "44",
    },
    "epoch duration change helper should null unsafe optional timing fields",
  );
  assert.equal(
    gameDataHelpers.buildTileViewData(
      [[1_234_567_899_000_000_000_000n], [1n]],
      [1],
    )[0].poolDisplay,
    "1234.57",
    "tile pool display must format raw wei without unsafe Number(formatUnits()) conversion",
  );
  assert.equal(
    gameDataHelpers.buildTileViewData(
      [[10_000_000_000_000_000n], [0n]],
      [0],
    )[0].users,
    1,
    "displayed positive tile pool should show at least one player while user counts catch up",
  );
  assert.equal(
    gameDataHelpers.buildTileViewData(
      [[10_000_000_000_000_000n], [7n]],
      [0],
    )[0].users,
    7,
    "tile view data should publish safe live user counts",
  );
  assert.equal(
    gameDataHelpers.buildTileViewData(
      [[10_000_000_000_000_000n], [BigInt(Number.MAX_SAFE_INTEGER) + 1n]],
      [0],
    )[0].users,
    1,
    "tile view data should reject unsafe live user counts and keep visible positive pool fallback",
  );
  assert.deepEqual(
    gameDataHelpers.buildTileViewData(
      [[1n], [4n]],
      [4],
    )[0],
    {
      tileId: 1,
      users: 0,
      poolDisplay: "0.00",
      hasMyBet: false,
    },
    "tile with display-zero pool must not show players",
  );
  assert.deepEqual(
    miningGrid.deriveMiningGridTilePresentation({
      displayAmount: "1000000000000000000.005",
      users: 3,
      hasMyBet: false,
      liveStateReady: true,
      coldBootDefaults: false,
    }),
    {
      isLiveDisplayReady: true,
      compactAmount: "1000000000000000000.01",
      hasDisplayedStake: true,
      showUserBadge: true,
      displayedUsers: 3,
    },
    "mining grid pool display must retain canonical decimal-text precision instead of coercing to Number",
  );
  assert.deepEqual(
    miningGrid.deriveMiningGridTilePresentation({
      displayAmount: "0.004",
      users: 7,
      hasMyBet: false,
      liveStateReady: true,
      coldBootDefaults: false,
    }),
    {
      isLiveDisplayReady: true,
      compactAmount: "0",
      hasDisplayedStake: false,
      showUserBadge: false,
      displayedUsers: 0,
    },
    "display-zero tile stakes must not surface a player badge or player count",
  );
  assert.equal(
    miningGrid.deriveMiningGridTilePresentation({
      displayAmount: "0.005",
      users: 0,
      hasMyBet: true,
      liveStateReady: true,
      coldBootDefaults: false,
    }).displayedUsers,
    1,
    "a positive own stake must remain visible even when an upstream player count is zero",
  );
  assert.equal(
    miningGrid.isMiningGridTileSelectable({ liveStateReady: true, isRevealing: false, isAnalyzing: true }),
    true,
    "a quiet expired epoch must remain selectable so the next bet can atomically advance it",
  );
  assert.equal(
    miningGrid.isMiningGridTileSelectable({ liveStateReady: false, isRevealing: false, isAnalyzing: false }),
    false,
    "unavailable live state must disable tile selection",
  );
  assert.equal(
    miningGrid.isMiningGridTileSelectable({ liveStateReady: true, isRevealing: true, isAnalyzing: false }),
    false,
    "revealing state must disable tile selection",
  );
  for (const [rawTileId, expected] of [
    ["1", 1],
    ["25", 25],
    [undefined, null],
    ["0", null],
    ["1.5", null],
    ["26", null],
    ["9007199254740992", null],
  ]) {
    assert.equal(
      miningGrid.parseMiningGridTileId(rawTileId),
      expected,
      `delegated tile selection must reject malformed grid id ${String(rawTileId)}`,
    );
  }
  const manualBetFormSource = readFileSync("app/hooks/useManualBetForm.ts", "utf8");
  assert.doesNotMatch(
    manualBetFormSource,
    /isRevealing \|\| isAnalyzing/,
    "manual bets must not be disabled solely because an expired epoch is awaiting atomic resolution",
  );
  const manualBetPanelSource = readFileSync("app/components/BetPanel.tsx", "utf8");
  assert.doesNotMatch(
    manualBetPanelSource,
    /quickPickDisabled[^\n]*isAnalyzing/,
    "quick picks must stay available for a quiet expired epoch",
  );
  const pageRuntimeEffectsSource = readFileSync("app/hooks/usePageRuntimeEffects.ts", "utf8");
  assert.doesNotMatch(
    pageRuntimeEffectsSource,
    /handleTileClick\(id,\s*isRevealingRef\.current\s*\|\|\s*isAnalyzingRef\.current\)/,
    "tile selection must not silently no-op while a quiet expired epoch is awaiting atomic resolution",
  );
}
