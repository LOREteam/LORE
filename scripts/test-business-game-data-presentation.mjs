import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as gameDataHelpersModule from "../app/hooks/useGameData.helpers.ts";

export function runGameDataPresentationTests() {
  const gameDataHelpers = gameDataHelpersModule.default ?? gameDataHelpersModule;
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
  const gameDataHelpersSource = readFileSync("app/hooks/useGameData.helpers.ts", "utf8");
  assert.match(
    gameDataHelpersSource,
    /formatLineaWeiDisplayNumber[\s\S]*function formatWeiToNumber\(value: unknown\)[\s\S]*return formatLineaWeiDisplayNumber\(value\)/,
    "game data numeric compatibility fields must derive from bounded raw-wei formatting",
  );
  assert.doesNotMatch(
    gameDataHelpersSource,
    /function formatWeiToNumber\(value: unknown\)[\s\S]*(?:Number\(formatUnits\(|Number\(formatLineaAmountFixed\(value, 6\)\))/,
    "game data helpers must not coerce live wei values through Number(formatUnits()) or formatted decimal strings",
  );
  assert.match(
    gameDataHelpersSource,
    /function parseGridTileId\(value: unknown\)[\s\S]*value < 1n \|\| value > BigInt\(GRID_SIZE\)[\s\S]*return tuple\[3\] \? parseGridTileId\(tuple\[2\]\) : null/,
    "game data winner tile helper must reject unsafe or out-of-range grid tile IDs",
  );
  assert.doesNotMatch(
    gameDataHelpersSource,
    /Number\(tuple\[2\]\) > 0|return Number\(tuple\[2\]\)/,
    "game data winner tile helper must not use positive-only tile parsing",
  );
  assert.match(
    gameDataHelpersSource,
    /function parseChainSafeInteger\(value: unknown\)[\s\S]*value > BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*Number\.isSafeInteger\(value\)[\s\S]*const next = parseChainSafeInteger\(pendingEpochDuration\)[\s\S]*current: parseChainSafeInteger\(epochDurationSec\)[\s\S]*eta: parseChainSafeInteger\(pendingEpochDurationEta\)/,
    "game data epoch duration change helper must safely narrow chain timing evidence",
  );
  assert.doesNotMatch(
    gameDataHelpersSource,
    /const next = pendingEpochDuration \? Number\(pendingEpochDuration\) : 0|current: epochDurationSec \? Number\(epochDurationSec\) : null|eta: pendingEpochDurationEta \? Number\(pendingEpochDurationEta\) : null/,
    "game data epoch duration change helper must not broadly coerce chain timing evidence",
  );
  assert.match(
    gameDataHelpersSource,
    /const liveUsers = parseChainSafeInteger\(liveUsersArr\?\.\[i\]\) \?\? 0[\s\S]*Math\.max\([\s\S]*liveUsers/,
    "game data tile view helper must safely narrow live user count evidence",
  );
  assert.doesNotMatch(
    gameDataHelpersSource,
    /const liveUsers = Number\(liveUsersArr\?\.\[i\] \?\? 0n\)|Number\.isFinite\(liveUsers\) \? liveUsers : 0/,
    "game data tile view helper must not broadly coerce live user counts",
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
  const miningGridSource = readFileSync("app/components/MiningGrid.tsx", "utf8");
  assert.match(
    miningGridSource,
    /formatTileAmountFixed\(value: string\)[\s\S]*formatDecimalTextFixed\(value\.trim\(\), 2\)[\s\S]*isPositiveFixedDecimalText\(formatTileAmountFixed\(displayAmount\)\)/,
    "mining grid tile display and visible stake detection must use canonical decimal-text formatting",
  );
  assert.doesNotMatch(
    miningGridSource,
    /Number\.parseFloat\(value\)|Number\.parseFloat\(displayAmount\)|amount\.toFixed\(2\)/,
    "mining grid tile display must not use parseFloat().toFixed() for pool amounts",
  );
  assert.match(
    miningGridSource,
    /showUserBadge[\s\S]*hasDisplayedStake[\s\S]*showUserBadge &&/,
    "mining grid must hide the player badge on display-zero tiles",
  );
  assert.doesNotMatch(
    miningGridSource,
    /disabled=\{!liveStateReady \|\| isRevealing \|\| isAnalyzing\}/,
    "an expired quiet epoch must remain selectable so the next bet can atomically advance it",
  );
  assert.match(
    miningGridSource,
    /Number\.isSafeInteger\(tileId\)[\s\S]*tileId < 1 \|\| tileId > GRID_SIZE[\s\S]*onTileClick\(tileId\)/,
    "mining grid delegated click handling must reject malformed tile ids before invoking bet selection",
  );
  assert.doesNotMatch(
    miningGridSource,
    /Number\.isInteger\(tileId\) \|\| tileId <= 0/,
    "mining grid delegated click handling must not use positive-only tile guards",
  );
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
  assert.match(
    pageRuntimeEffectsSource,
    /GRID_SIZE[\s\S]*function parseHistoryWinningTile\(value: string\)[\s\S]*\^\[1-9\]\\d\*\$[\s\S]*Number\.isSafeInteger\(tile\)[\s\S]*tile >= 1 && tile <= GRID_SIZE[\s\S]*const tile = parseHistoryWinningTile\(round\.winningTile\)[\s\S]*tile !== null/,
    "hot-tile history stats must reject unsafe or out-of-range winning tile IDs",
  );
  assert.doesNotMatch(
    pageRuntimeEffectsSource,
    /Number\(round\.winningTile\)[\s\S]*tile > 0/,
    "hot-tile history stats must not use positive-only winning tile parsing",
  );
  assert.doesNotMatch(
    pageRuntimeEffectsSource,
    /handleTileClick\(id,\s*isRevealingRef\.current\s*\|\|\s*isAnalyzingRef\.current\)/,
    "tile selection must not silently no-op while a quiet expired epoch is awaiting atomic resolution",
  );
}
