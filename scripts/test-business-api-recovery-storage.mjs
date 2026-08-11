import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export function runApiRecoveryStorageTests() {
  const recentWinsRouteSource = readFileSync("app/api/recent-wins/route.ts", "utf8");
  assert.match(
    recentWinsRouteSource,
    /function computeRecentWinsExpiresAt\(ttlMs: number, now = Date\.now\(\)\)[\s\S]*Number\.isSafeInteger\(now\)[\s\S]*Number\.isSafeInteger\(ttlMs\)[\s\S]*Number\.MAX_SAFE_INTEGER - now[\s\S]*expiresAt: computeRecentWinsExpiresAt\(ttlMs\)[\s\S]*expiresAt: computeRecentWinsExpiresAt\(RECENT_WINS_ROUTE_CACHE_MS\)/,
    "recent wins route cache writes must compute expiry through the fail-closed helper",
  );
  assert.match(
    recentWinsRouteSource,
    /function isFreshRecentWinsCache\(entry: RecentWinsCacheEntry \| null, now = Date\.now\(\)\): entry is RecentWinsCacheEntry[\s\S]*Number\.isSafeInteger\(entry\.expiresAt\)[\s\S]*entry\.expiresAt > now[\s\S]*const freshCache = recentWinsCache[\s\S]*if \(isFreshRecentWinsCache\(freshCache, now\)\)[\s\S]*return jsonNoStore\(freshCache\.payload\)/,
    "recent wins route cache reads must reject malformed expiresAt or caller time",
  );
  assert.doesNotMatch(
    recentWinsRouteSource,
    /expiresAt:\s*Date\.now\(\)\s*\+\s*(?:ttlMs|RECENT_WINS_ROUTE_CACHE_MS)/,
    "recent wins route cache writes must not use broad Date.now() + ttlMs expiry",
  );
  const depositsRouteSource = readFileSync("app/api/deposits/route.ts", "utf8");
  assert.match(
    depositsRouteSource,
    /function parseStoredBlockNumber/,
    "deposits API must tolerate corrupted stored block numbers",
  );
  assert.match(
    depositsRouteSource,
    /formatLineaWeiDisplayNumber[\s\S]*function toDisplayNumberWei\(value: bigint\)[\s\S]*return formatLineaWeiDisplayNumber\(value\)/,
    "deposits API totalAmountNum compatibility fields must derive from bounded raw-wei formatting",
  );
  assert.doesNotMatch(
    depositsRouteSource,
    /totalAmountNum:\s*(?:Number\.)?parseFloat\(formatUnits\(|prev\.totalAmountNum = Number\.parseFloat\(prev\.totalAmount\)/,
    "deposits API must not derive totalAmountNum through parseFloat(formatUnits()) or parsed decimal strings",
  );
  assert.doesNotMatch(
    depositsRouteSource,
    /Number\(formatLineaAmountFixed\(value, 6\)\)/,
    "deposits API totalAmountNum compatibility fields must not parse formatted decimal strings",
  );
  assert.doesNotMatch(
    depositsRouteSource,
    /BigInt\([^)]*blockNumber\s*\|\|\s*"0"\)/,
    "deposits API must not call BigInt directly on stored blockNumber strings",
  );
  assert.match(
    depositsRouteSource,
    /function parseStoredEpochNumber/,
    "deposits API must parse stored epochs safely for sorting and inline rewards",
  );
  assert.match(
    depositsRouteSource,
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function parseChainEpochNumber\(value: bigint\)[\s\S]*value <= 0n \|\| value > MAX_SAFE_INTEGER_BIGINT[\s\S]*const ep = parseChainEpochNumber\(args\.epoch\)[\s\S]*const onChainCurrentEpochNum = parseChainEpochNumber\(onChainCurrentEpoch\)/,
    "deposits API must safely narrow chain uint256 epochs before recovery and current-epoch decisions",
  );
  assert.doesNotMatch(
    depositsRouteSource,
    /(^|[^A-Za-z0-9_])Number\(args\.epoch\)|(^|[^A-Za-z0-9_])Number\(onChainCurrentEpoch\)/,
    "deposits API must not broadly coerce chain epoch evidence",
  );
  assert.match(
    depositsRouteSource,
    /const MAX_TILE_ID = 25[\s\S]*function parseDepositTileId\(value: bigint\)[\s\S]*value > BigInt\(MAX_TILE_ID\)[\s\S]*function parseDepositTileIds\(values: readonly bigint\[\]\)[\s\S]*const tileId = parseDepositTileId\(args\.tileId\)[\s\S]*const tileIds = parseDepositTileIds\(args\.tileIds\)/,
    "deposits chain recovery must validate single and batch tile ids before publishing rows",
  );
  assert.doesNotMatch(
    depositsRouteSource,
    /Number\(args\.tileId\)|args\.tileIds\.map\(Number\)/,
    "deposits chain recovery must not broadly coerce event tile ids",
  );
  assert.match(
    depositsRouteSource,
    /function hasDepositTiles\(row: DepositRow\)[\s\S]*row\.tileIds\.length > 0[\s\S]*dedupeDeposits\(deposits\)\.map\(normalizeDepositRow\)\.filter\(hasDepositTiles\)[\s\S]*dedupeDeposits\(\[\.\.\.deposits, \.\.\.recovered\]\)\.map\(normalizeDepositRow\)\.filter\(hasDepositTiles\)/,
    "deposits API must not publish stored or recovered rows with no valid tile evidence",
  );
  assert.match(
    depositsRouteSource,
    /function buildDepositKey\(epoch: string, txHash: string, blockNumber: string\)[\s\S]*\/\^0x\[0-9a-f\]\{64\}\$\/\.test\(normalizedHash\)[\s\S]*return `\$\{epoch\}_nohash_\$\{blockNumber\}`/,
    "deposits API storage keys must only treat full 32-byte transaction hashes as tx identity",
  );
  assert.match(
    depositsRouteSource,
    /function normalizeDepositTxHash\(txHash: string \| null \| undefined\)[\s\S]*\/\^0x\[0-9a-f\]\{64\}\$\/\.test\(normalized\)[\s\S]*const txHash = normalizeDepositTxHash\(row\.txHash\)[\s\S]*const txHash = normalizeDepositTxHash\(log\.transactionHash\)/,
    "deposits API public rows must only publish full 32-byte transaction hashes",
  );
  assert.doesNotMatch(
    depositsRouteSource,
    /txHash:\s*log\.transactionHash|log\.transactionHash \?\? ""|txHash:\s*String\(row\.txHash/,
    "deposits API must not publish raw chain or stored txHash values",
  );
  assert.doesNotMatch(
    depositsRouteSource,
    /\/\^0x\[0-9a-f\]\+\$\/\.test\(normalizedHash\)/,
    "deposits API storage keys must not accept short or malformed tx hashes as tx identity",
  );
  assert.match(
    depositsRouteSource,
    /user\s*=\s*getAddress\(userParam \?\? ""\)\.toLowerCase\(\)/,
    "deposits API must normalize query user addresses with the EVM address parser",
  );
  assert.match(
    depositsRouteSource,
    /addressToTopic[\s\S]*getAddress\(address\)/,
    "deposits chain recovery must normalize user addresses before building indexed log topics",
  );
  assert.doesNotMatch(
    depositsRouteSource,
    /Number\(b\.epoch\)\s*-\s*Number\(a\.epoch\)/,
    "deposits API must not sort using unchecked stored epoch numbers",
  );
  assert.match(
    depositsRouteSource,
    /const LOG_CHUNK_BLOCKS = 10_000n/,
    "deposits API log scans must stay within the Linea public RPC 10k block limit",
  );
  assert.match(
    depositsRouteSource,
    /DEPOSITS_BACKGROUND_RECOVERY_COOLDOWN_MS[\s\S]*depositsRecoveryInflight[\s\S]*function recoverDepositsWithGlobalBound[\s\S]*depositsRecoveryInflight \|\|[\s\S]*return null[\s\S]*recoverDepositsWithGlobalBound\(user, currentEpochNum\)/,
    "deposits API must globally bound distinct-address slow recovery scans",
  );
  assert.doesNotMatch(
    depositsRouteSource,
    /return\s+(?:await\s+)?depositsRecoveryInflight\b/,
    "deposits slow recovery must not return another user's in-flight chain scan result",
  );
  assert.match(
    depositsRouteSource,
    /depositsRecoveryStartedAt = now[\s\S]*const task = recoverDepositsFromChain\(user, currentEpochNum\)[\s\S]*depositsRecoveryInflight = task[\s\S]*finally \{[\s\S]*if \(depositsRecoveryInflight === task\)[\s\S]*depositsRecoveryInflight = null/,
    "deposits recovery limiter must set cooldown before chain scan and clear only its own in-flight task",
  );
  assert.match(
    depositsRouteSource,
    /startDepositsRefresh[\s\S]*buildDepositsPayload\(user, includeRewards, \{ allowSlowRecovery: true \}\)[\s\S]*buildDepositsPayload\(user, includeRewards, \{ allowSlowRecovery: false \}\)/,
    "deposits API must keep slow chain recovery in the background path, not the foreground request build",
  );
  assert.match(
    depositsRouteSource,
    /bucket: "api-deposits"[\s\S]*if \(rateLimited\) return applyNoStoreHeaders\(rateLimited\)/,
    "deposits API rate-limit responses must remain no-store before cache lookup or recovery",
  );
  const storageSource = readFileSync("server/storage.ts", "utf8");
  assert.match(
    storageSource,
    /export function buildIndexerBetIdentity\([\s\S]*\/\^0x\[0-9a-f\]\{64\}\$\/\.test\(normalizedHash\)[\s\S]*`\$\{epoch\}_nohash_\$\{blockNumber\}`/,
    "central scoped bet storage keys must only treat full 32-byte transaction hashes as tx identity",
  );
  assert.doesNotMatch(
    storageSource,
    /\/\^0x\[0-9a-f\]\+\$\/\.test\(normalizedHash\)/,
    "central scoped bet storage keys must not accept short or malformed tx hashes as tx identity",
  );
  assert.match(
    storageSource,
    /new Set\(\[currentBase, `\$\{currentBase\}-shm`, `\$\{currentBase\}-wal`\]\)[\s\S]*currentArtifacts\.has\(entry\)/,
    "contract-scope cleanup must never remove the active SQLite DB, WAL, or SHM files",
  );
  assert.match(
    storageSource,
    /function isSafePositiveInteger/,
    "storage helpers must centralize safe positive integer checks for epoch ids",
  );
  assert.match(
    storageSource,
    /function parseSafePositiveIntegerString/,
    "storage writes must parse string epoch and block numbers before SQL writes",
  );
  assert.doesNotMatch(
    storageSource,
    /Number\.isInteger\(epoch\)\s*&&\s*epoch\s*>\s*0/,
    "storage helpers must reject unsafe epoch numbers, not only integer-looking values",
  );
  assert.doesNotMatch(
    storageSource,
    /Number\(row\.(?:epoch|blockNumber)\)/,
    "storage upserts must not write unvalidated row epoch or blockNumber values",
  );
  assert.match(
    storageSource,
    /function normalizePageLimit[\s\S]*Number\.isSafeInteger\(value\)[\s\S]*return Math\.min\(maxValue, value\)/,
    "storage pagination must clamp page limits before SQL LIMIT use",
  );
  assert.match(
    storageSource,
    /getUserParticipatingEpochs[\s\S]*parseSafePositiveIntegerString\(String\(row\.epoch \?\? ""\)\)[\s\S]*getUserParticipatingEpochPage[\s\S]*parseSafePositiveIntegerString\(String\(row\.epoch \?\? ""\)\)/,
    "participating epoch readers must parse stored DB epoch rows safely",
  );
  assert.doesNotMatch(
    storageSource,
    /Number\(row\.epoch\s*\?\?/,
    "participating epoch readers must not coerce stored DB epoch rows through Number(row.epoch ?? ...)",
  );
  assert.match(
    storageSource,
    /function describeStorageError[\s\S]*sanitizeSentryPayload/,
    "storage write and cleanup errors must use the shared server-side redaction boundary",
  );
  assert.doesNotMatch(
    storageSource,
    /console\.(?:error|warn)\([^\n]*(?:error|rollbackErr) instanceof Error/,
    "storage write errors must not print raw provider or database messages",
  );
  const dataBridgeSource = readFileSync("app/api/_lib/dataBridge.ts", "utf8");
  assert.match(
    dataBridgeSource,
    /export function isSafePositiveInteger/,
    "API data bridge must expose a safe positive integer guard for epoch values",
  );
  assert.doesNotMatch(
    dataBridgeSource,
    /Number\.isInteger\(n\)|Number\.isInteger\(epoch\)/,
    "API data bridge must reject unsafe epoch numbers",
  );
  assert.doesNotMatch(
    dataBridgeSource,
    /Number\((?:value|row\.epoch)\)/,
    "API data bridge must not broadly coerce current or stored epoch values",
  );
  assert.match(
    dataBridgeSource,
    /parsePositiveIntegerValue\(value\)[\s\S]*parsePositiveIntegerValue\(row\.epoch\)/,
    "API data bridge must reuse strict decimal epoch parsing for current and stored epochs",
  );
  assert.match(
    dataBridgeSource,
    /export async function fetchStorageJson<T>\(path: string, limitToLast\?: number\)[\s\S]*readJsonPath<T>\(path, limitToLast\)/,
    "API data bridge must preserve the storage read limit hook for bounded normalized event reads",
  );
  assert.match(
    dataBridgeSource,
    /function isSupportedApiStoragePatchPath\(path: string\)[\s\S]*path === "gamedata\/epochs"[\s\S]*path === "gamedata\/jackpots"[\s\S]*\^gamedata\\\/bets\\\/0x\[a-f0-9\]\{40\}\$/s,
    "API storage writes must be allow-listed to recovery paths with canonical lowercase wallet scope",
  );
  assert.match(
    dataBridgeSource,
    /if \(!isSupportedApiStoragePatchPath\(path\)\)[\s\S]*Unsupported API storage patch path[\s\S]*return false[\s\S]*patchJsonPath\(path, payload\)[\s\S]*return true/,
    "API storage writes must fail closed before calling storage for unsupported paths",
  );
  const rewardSummarySource = readFileSync("app/api/_lib/rewardSummary.ts", "utf8");
  assert.match(
    rewardSummarySource,
    /isSafePositiveInteger/,
    "reward summary must use safe epoch integer filtering",
  );
  assert.match(
    rewardSummarySource,
    /const MAX_TILE_ID = 25[\s\S]*function parseRewardTileNumber\(value: bigint \| number\)[\s\S]*value > BigInt\(MAX_TILE_ID\)[\s\S]*storedWinningTile = stored \? parseRewardTileNumber\(stored\.winningTile\) : null[\s\S]*const winningTile = parseRewardTileNumber\(row\[2\]\)/,
    "reward summary must validate stored and recovered winningTile evidence before cache writes and reward reads",
  );
  assert.match(
    rewardSummarySource,
    /parseStoredPositiveIntegerOrZero[\s\S]*function parseRewardEpochKey\(value: string\)[\s\S]*const parsedEpoch = parseRewardEpochKey\(epoch\)[\s\S]*epoch: parsedEpoch/,
    "reward summary must canonical-parse runtime epoch keys before reward multicalls",
  );
  assert.doesNotMatch(
    rewardSummarySource,
    /winningTile:\s*Number\(winningTile\)|winningTile:\s*Number\(entry\.winningTile\)|Number\(epoch\)|stored\.winningTile > 0/,
    "reward summary must not publish unchecked winningTile or broadly coerced epoch evidence",
  );
  const epochsRouteSource = readFileSync("app/api/epochs/route.ts", "utf8");
  assert.match(
    epochsRouteSource,
    /isSafePositiveInteger/,
    "epochs API must use safe epoch integer filtering",
  );
  assert.match(
    epochsRouteSource,
    /parseStoredPositiveIntegerOrZero[\s\S]*const epoch = parseStoredPositiveIntegerOrZero\(key\)[\s\S]*\.map\(\(key\) => parseStoredPositiveIntegerOrZero\(key\)\)/,
    "epochs API must reuse strict stored epoch parsing for current filtering and missing-epoch reconciliation",
  );
  assert.match(
    epochsRouteSource,
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function parseChainEpochNumber\(value: bigint\)[\s\S]*value <= 0n \|\| value > MAX_SAFE_INTEGER_BIGINT[\s\S]*const onChainCurrentEpochNum = parseChainEpochNumber\(onChainCurrentEpoch\)/,
    "epochs API must safely narrow chain currentEpoch before cache and reconcile decisions",
  );
  assert.match(
    epochsRouteSource,
    /const MAX_TILE_ID = 25[\s\S]*function parseEpochWinningTile\(value: bigint\)[\s\S]*value > BigInt\(MAX_TILE_ID\)[\s\S]*const winningTile = parseEpochWinningTile\(row\[2\]\)[\s\S]*winningTile === null/,
    "epochs API must validate recovered winningTile evidence before cache and storage patch writes",
  );
  assert.doesNotMatch(
    epochsRouteSource,
    /winningTile:\s*Number\(row\[2\]\)/,
    "epochs API must not publish unchecked recovered winningTile evidence",
  );
  assert.doesNotMatch(
    epochsRouteSource,
    /(^|[^A-Za-z0-9_])Number\(onChainCurrentEpoch\)/,
    "epochs API must not broadly coerce chain currentEpoch evidence",
  );
  assert.doesNotMatch(
    epochsRouteSource,
    /Number\(key\)/,
    "epochs API must not broadly coerce stored epoch keys",
  );
  assert.doesNotMatch(
    epochsRouteSource,
    /Number\.isInteger\(epoch\)/,
    "epochs API must reject unsafe epoch numbers",
  );
  assert.doesNotMatch(
    epochsRouteSource,
    /getEpochEndTime/,
    "resolved-epoch chain fallback must not issue guaranteed-zero end-time RPC reads",
  );
}
