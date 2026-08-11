import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export function runPublicApiReadModelTests() {
  const rewardsRouteSource = readFileSync("app/api/rewards/route.ts", "utf8");
  assert.match(
    rewardsRouteSource,
    /parsePositiveIntegerValue\(value\)[\s\S]*parsed === null \|\| parsed > 1_000_000[\s\S]*Invalid epochs/,
    "rewards API must reject unsafe epoch numbers from user payloads through the shared strict parser",
  );
  const recentWinsApiSource = readFileSync("app/api/recent-wins/data.ts", "utf8");
  assert.match(
    recentWinsApiSource,
    /RECENT_WINS_LOG_SCAN_CHUNK = 10_000n[\s\S]*RECENT_WINS_RECOVERY_MAX_BLOCKS = 100_000n[\s\S]*RECENT_WINS_RECOVERY_MAX_RPC_CALLS = 12[\s\S]*RECENT_WINS_RECOVERY_MAX_LOGS = 250[\s\S]*RECENT_WINS_RECOVERY_MAX_TIME_MS = 5_000/,
    "recent-wins RPC recovery must preserve the 10k request range and total block, call, log, and time budgets",
  );
  assert.match(
    recentWinsApiSource,
    /function normalizeStoredUserAddress[\s\S]*getAddress\(user\)\.toLowerCase\(\)/,
    "recent-wins public aggregates must normalize stored/logged user addresses with the EVM parser",
  );
  assert.match(
    recentWinsApiSource,
    /formatLineaWeiDisplayNumber[\s\S]*function toDisplayNumberWei\(value: bigint\)[\s\S]*return formatLineaWeiDisplayNumber\(value\)/,
    "recent-wins rewardNum compatibility fields must derive from bounded raw-wei formatting",
  );
  assert.match(
    recentWinsApiSource,
    /const MAX_TILE_ID = 25[\s\S]*function parseRecentWinTileId\(value: number \| null \| undefined\)[\s\S]*value >= 1 && value <= MAX_TILE_ID[\s\S]*parseRecentWinTileId\(row\.winningTile\) !== null[\s\S]*const tileId = parseRecentWinTileId\(epoch\?\.winningTile\)/,
    "recent-wins API must validate stored winningTile evidence before publishing tile ids",
  );
  assert.doesNotMatch(
    recentWinsApiSource,
    /row\.winningTile > 0|epoch\?\.winningTile && epoch\.winningTile > 0/,
    "recent-wins API must not publish unchecked positive-only winningTile evidence",
  );
  assert.match(
    recentWinsApiSource,
    /function compareBigIntDesc\(left: bigint, right: bigint\)[\s\S]*compareBigIntDesc\(a\.rewardWei, b\.rewardWei\)/,
    "recent-wins resolved winner sorting must compare bigint rewards instead of parsed display strings",
  );
  assert.doesNotMatch(
    recentWinsApiSource,
    /(?:Number\.)?parseFloat\(formatUnits\(args\.reward, 18\)\)|Number\.parseFloat\(reward\)|Number\.parseFloat\(b\.amount\) - Number\.parseFloat\(a\.amount\)/,
    "recent-wins reward mapping must not derive numeric fields or sorting from parseFloat(formatUnits())",
  );
  assert.doesNotMatch(
    recentWinsApiSource,
    /Number\(formatLineaAmountFixed\(value, 6\)\)/,
    "recent-wins rewardNum compatibility fields must not parse formatted decimal strings",
  );
  assert.match(
    recentWinsApiSource,
    /function formatRecentClaimAmount\(value: string \| undefined\)[\s\S]*formatLineaAmountFixed\(parseAmountWei\(value\), 2\)[\s\S]*amount: formatRecentClaimAmount\(row\.reward\)/,
    "recent-wins claim fallback amount display must derive from canonical raw reward text, not stale rewardNum",
  );
  assert.doesNotMatch(
    recentWinsApiSource,
    /amount:\s*row\.rewardNum\.toFixed\(2\)/,
    "recent-wins claim fallback must not format stale rewardNum directly",
  );
  const leaderboardsRouteSource = readFileSync("app/api/leaderboards/route.ts", "utf8");
  assert.match(
    leaderboardsRouteSource,
    /function normalizeStoredUserAddress[\s\S]*getAddress\(user\)\.toLowerCase\(\)/,
    "leaderboard public aggregates must normalize stored user addresses with the EVM parser",
  );
  assert.match(
    leaderboardsRouteSource,
    /formatLineaWeiDisplayNumber[\s\S]*function toDisplayNumberWei\(value: bigint\)[\s\S]*return formatLineaWeiDisplayNumber\(value\)/,
    "leaderboard valueNum compatibility fields must derive from bounded raw-wei formatting",
  );
  assert.doesNotMatch(
    leaderboardsRouteSource,
    /valueNum:\s*Number\(formatUnits\(/,
    "leaderboard valueNum fields must not coerce raw wei through Number(formatUnits())",
  );
  assert.doesNotMatch(
    leaderboardsRouteSource,
    /Number\(formatLineaAmountFixed\(value, 6\)\)/,
    "leaderboard valueNum compatibility fields must not parse formatted decimal strings",
  );
  assert.match(
    leaderboardsRouteSource,
    /function computeLeaderboardRoiBasisPoints\(totalWon: bigint, totalWagered: bigint\)[\s\S]*totalWon \* LEADERBOARDS_ROI_BASIS_POINTS_SCALE[\s\S]*function formatLeaderboardRoiPercent\(roiBasisPoints: bigint\)[\s\S]*roundedTenths[\s\S]*function toLeaderboardRoiValueNum\(roiBasisPoints: bigint\)[\s\S]*LEADERBOARDS_ROI_VALUE_NUM_MAX_BASIS_POINTS/,
    "leaderboard ROI output must keep bigint ROI evidence bounded before formatting display and compatibility fields",
  );
  assert.match(
    leaderboardsRouteSource,
    /const roiBasisPoints = computeLeaderboardRoiBasisPoints\(row\.totalWon, row\.totalWagered\)[\s\S]*value: formatLeaderboardRoiPercent\(roiBasisPoints\)[\s\S]*valueNum: toLeaderboardRoiValueNum\(roiBasisPoints\)[\s\S]*compareBigIntDesc\(a\.roiBasisPoints, b\.roiBasisPoints\)/,
    "leaderboard ROI rows must sort by exact bigint ROI while publishing bounded display values",
  );
  assert.doesNotMatch(
    leaderboardsRouteSource,
    /Number\(\(row\.totalWon \* 10_000n\) \/ row\.totalWagered\)|roi\.toFixed\(1\)/,
    "leaderboard ROI output must not coerce bigint ROI through Number(...).toFixed()",
  );
  assert.match(
    leaderboardsRouteSource,
    /function isFreshLeaderboardsSnapshotSavedAt\(savedAt: unknown, now = Date\.now\(\)\)[\s\S]*Number\.isSafeInteger\(savedAt\)[\s\S]*savedAt <= now[\s\S]*now - savedAt <= LEADERBOARDS_SNAPSHOT_MAX_AGE_MS/,
    "leaderboard snapshots must reject malformed or future savedAt timestamps",
  );
  assert.match(
    leaderboardsRouteSource,
    /!isFreshLeaderboardsSnapshotSavedAt\(snapshot\.savedAt\)/,
    "leaderboard snapshot loading must use the strict savedAt helper",
  );
  assert.doesNotMatch(
    leaderboardsRouteSource,
    /typeof snapshot\.savedAt !== "number" \|\| Date\.now\(\) - snapshot\.savedAt > LEADERBOARDS_SNAPSHOT_MAX_AGE_MS/,
    "leaderboard snapshots must not use broad savedAt age arithmetic",
  );
  assert.match(
    recentWinsApiSource,
    /function parseStoredBlockNumber/,
    "recent wins API must tolerate corrupted stored block numbers",
  );
  assert.match(
    recentWinsApiSource,
    /function parseStoredEpochNumber/,
    "recent wins API must parse stored epoch keys safely",
  );
  assert.match(
    recentWinsApiSource,
    /function isFreshRecentWinsSnapshotSavedAt\(savedAt: unknown, now = Date\.now\(\)\)[\s\S]*Number\.isSafeInteger\(savedAt\)[\s\S]*savedAt <= now[\s\S]*now - savedAt <= RECENT_WINS_SNAPSHOT_MAX_AGE_MS[\s\S]*!isFreshRecentWinsSnapshotSavedAt\(snapshot\.savedAt\)/,
    "recent wins snapshots must reject malformed or future savedAt timestamps",
  );
  assert.match(
    recentWinsApiSource,
    /function normalizeClaimTxIdentity\(txHash: string \| null \| undefined\)[\s\S]*\/\^0x\[0-9a-f\]\{64\}\$\/\.test\(normalized\)[\s\S]*function buildRewardClaimStorageIdentity\(row: Pick<StoredClaimRow, "txHash" \| "user" \| "epoch" \| "blockNumber">\)[\s\S]*return `nohash_\$\{parseStoredBlockNumber\(row\.blockNumber\)\.toString\(\)\}_\$\{row\.user\}_\$\{row\.epoch\}`/ ,
    "recent wins reward-claim storage identity must only trust full 32-byte transaction hashes",
  );
  assert.match(
    recentWinsApiSource,
    /for \(const row of existing\) byKey\.set\(buildRewardClaimStorageIdentity\(row\), row\);[\s\S]*for \(const row of incoming\) byKey\.set\(buildRewardClaimStorageIdentity\(row\), row\);/,
    "recent wins transient recovery merge must use the normalized reward-claim identity helper",
  );
  assert.doesNotMatch(
    recentWinsApiSource,
    /upsertRewardClaims|storagePut\("gamedata\/rewardClaims\//,
    "single-RPC recent-wins recovery must remain cache-only and never write normalized durable rows",
  );
  assert.doesNotMatch(
    recentWinsApiSource,
    /`\$\{row\.txHash\}_\$\{row\.user\}_\$\{row\.epoch\}`|`\$\{row\.txHash \|\| "nohash"\}_\$\{row\.user\}_\$\{row\.epoch\}`/,
    "recent wins reward-claim keys must not use raw txHash strings as identity",
  );
  assert.doesNotMatch(
    recentWinsApiSource,
    /typeof snapshot\.savedAt !== "number" \|\| Date\.now\(\) - snapshot\.savedAt > RECENT_WINS_SNAPSHOT_MAX_AGE_MS/,
    "recent wins snapshots must not use broad savedAt age arithmetic",
  );
}
