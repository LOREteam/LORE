import { decodeEventLog, encodeEventTopics, formatUnits, getAddress, parseAbi } from "viem";
import { parseOptionalNonNegativeBigIntEnv } from "../../../config/envParsing";
import {
  computeWinningAmountWei,
  formatLineaAmountFixed,
  formatLineaWeiDisplayNumber,
  parseLineaAmountWei,
} from "../../lib/tokenAmountMath";
import {
  getMetaBigInt,
  getMetaJson,
  getBetRowsByEpochs,
  getEpochMap,
  getRecentRewardClaims,
  setMetaJson,
  upsertRewardClaims,
} from "../../../server/storage";
import {
  CONTRACT_ADDRESS,
  CONTRACT_DEPLOY_BLOCK,
  isSafePositiveInteger,
  publicClient,
} from "../_lib/dataBridge";
import {
  parseStoredBlockNumberOrZero,
  parseStoredPositiveIntegerOrZero,
} from "../_lib/storedNumberParsing";

const RECENT_WINS_LIMIT = 100;
const RECENT_WINS_SNAPSHOT_MAX_AGE_MS = 60 * 60 * 1000;
const RECENT_WINS_SNAPSHOT_META_KEY = "snapshot:recent-wins:v1";
const RECENT_WINS_LOG_SCAN_CHUNK = 10_000n;
const RECENT_WINS_LOG_SCAN_MIN_CHUNK = 2_000n;
const RECENT_WINS_BOOTSTRAP_SCAN_CHUNK = 10_000n;
const RECENT_WINS_RECOVERY_BLOCK_LAG = parseOptionalNonNegativeBigIntEnv(process.env.RECENT_WINS_RECOVERY_BLOCK_LAG, 256n);
const MAX_TILE_ID = 25;

const EVENTS_ABI = parseAbi([
  "event RewardClaimed(uint256 indexed epoch, address indexed user, uint256 reward)",
]);
const [rewardClaimedSig] = encodeEventTopics({ abi: EVENTS_ABI, eventName: "RewardClaimed" });

export type RecentWinJackpotKind = "daily" | "weekly" | "daily-weekly";

export type RecentWinRow = {
  epoch: string;
  user: string;
  amount: string;
  amountRaw: string;
  tileId?: number;
  jackpotKind?: RecentWinJackpotKind;
  txHash?: string;
  blockNumber?: string;
};

export type RecentWinsPayload = {
  wins: RecentWinRow[];
  error?: string;
};

type RecentWinsSnapshotEnvelope = {
  payload: RecentWinsPayload;
  savedAt: number;
  watermark: string | null;
};

type StoredClaimRow = ReturnType<typeof getRecentRewardClaims>[number];
type RewardClaimLog = Awaited<ReturnType<typeof publicClient.getLogs>>[number];

function normalizeStoredUserAddress(user: string): `0x${string}` | null {
  try {
    return getAddress(user).toLowerCase() as `0x${string}`;
  } catch {
    return null;
  }
}

function normalizeClaimTxIdentity(txHash: string | null | undefined): `0x${string}` | null {
  const normalized = typeof txHash === "string" ? txHash.trim().toLowerCase() : "";
  return /^0x[0-9a-f]{64}$/.test(normalized) ? (normalized as `0x${string}`) : null;
}

function buildRewardClaimStorageIdentity(row: Pick<StoredClaimRow, "txHash" | "user" | "epoch" | "blockNumber">) {
  const txHash = normalizeClaimTxIdentity(row.txHash);
  if (txHash) return `${txHash}_${row.user}_${row.epoch}`;
  return `nohash_${parseStoredBlockNumber(row.blockNumber).toString()}_${row.user}_${row.epoch}`;
}
type StoredBetRow = ReturnType<typeof getBetRowsByEpochs>[number];

function getJackpotKind(row: { isDailyJackpot?: boolean; isWeeklyJackpot?: boolean } | undefined): RecentWinJackpotKind | undefined {
  if (!row) return undefined;
  if (row.isDailyJackpot && row.isWeeklyJackpot) return "daily-weekly";
  if (row.isDailyJackpot) return "daily";
  if (row.isWeeklyJackpot) return "weekly";
  return undefined;
}

function getLatestRewardClaimMarker() {
  const latest = getRecentRewardClaims(1)[0];
  if (!latest) return "none";
  return `${parseStoredBlockNumber(latest.blockNumber).toString()}:${normalizeClaimTxIdentity(latest.txHash) ?? ""}:${latest.epoch}`;
}

export function getRecentWinsDataWatermark() {
  const lastIndexedBlock = getMetaBigInt("lastIndexedBlock")?.toString() ?? "null";
  return `${lastIndexedBlock}|${getLatestRewardClaimMarker()}`;
}

function parseAmountWei(value: string | undefined) {
  return parseLineaAmountWei(value);
}

function parseStoredBlockNumber(value: string | null | undefined): bigint {
  return parseStoredBlockNumberOrZero(value);
}

function parseStoredEpochNumber(value: string | null | undefined): number {
  return parseStoredPositiveIntegerOrZero(value);
}

function parseRecentWinTileId(value: number | null | undefined): number | null {
  if (typeof value !== "number") return null;
  return Number.isSafeInteger(value) && value >= 1 && value <= MAX_TILE_ID ? value : null;
}

function getWinningAmountWeiForBet(row: StoredBetRow, winningTile: number) {
  return computeWinningAmountWei(row.tileIds, row.amounts, winningTile, row.totalAmount);
}

function compareBigIntDesc(left: bigint, right: bigint) {
  if (left === right) return 0;
  return left > right ? -1 : 1;
}

function toDisplayNumberWei(value: bigint): number {
  return formatLineaWeiDisplayNumber(value);
}

function formatRecentClaimAmount(value: string | undefined): string {
  return formatLineaAmountFixed(parseAmountWei(value), 2);
}

function buildRecentResolvedWins(limit = RECENT_WINS_LIMIT): RecentWinRow[] {
  const epochs = getEpochMap();
  const recentResolvedEpochs = Object.entries(epochs)
    .filter(([, row]) => parseRecentWinTileId(row.winningTile) !== null && parseAmountWei(row.rewardPool) > 0n)
    .sort((a, b) => {
      const aBlock = parseStoredBlockNumber(a[1].resolvedBlock);
      const bBlock = parseStoredBlockNumber(b[1].resolvedBlock);
      if (aBlock === bBlock) {
        return parseStoredEpochNumber(b[0]) - parseStoredEpochNumber(a[0]);
      }
      return aBlock > bBlock ? -1 : 1;
    })
    .slice(0, 36);

  if (recentResolvedEpochs.length === 0) {
    return [];
  }

  const epochRows = new Map<
    string,
    {
      winningTile: number;
      rewardPoolWei: bigint;
      resolvedBlock: string;
      jackpotKind?: RecentWinJackpotKind;
    }
  >(
    recentResolvedEpochs.map(([epoch, row]) => [
      epoch,
      {
        winningTile: parseRecentWinTileId(row.winningTile) ?? 0,
        rewardPoolWei: parseAmountWei(row.rewardPool),
        resolvedBlock: row.resolvedBlock ?? "0",
        jackpotKind: getJackpotKind(row),
      },
    ]),
  );

  const byEpochUser = new Map<string, Map<string, bigint>>();
  const totalWinningByEpoch = new Map<string, bigint>();
  const recentResolvedEpochIds = recentResolvedEpochs
    .map(([epoch]) => parseStoredEpochNumber(epoch))
    .filter(isSafePositiveInteger);
  for (const bet of getBetRowsByEpochs(recentResolvedEpochIds)) {
    const epochInfo = epochRows.get(bet.epoch);
    if (!epochInfo) continue;
    const winningAmountWei = getWinningAmountWeiForBet(bet, epochInfo.winningTile);
    if (winningAmountWei <= 0n) continue;
    const user = normalizeStoredUserAddress(bet.user);
    if (!user) continue;
    const perUser = byEpochUser.get(bet.epoch) ?? new Map<string, bigint>();
    perUser.set(user, (perUser.get(user) ?? 0n) + winningAmountWei);
    byEpochUser.set(bet.epoch, perUser);
    totalWinningByEpoch.set(bet.epoch, (totalWinningByEpoch.get(bet.epoch) ?? 0n) + winningAmountWei);
  }

  const rows: RecentWinRow[] = [];
  for (const [epoch] of recentResolvedEpochs) {
    const epochInfo = epochRows.get(epoch);
    const perUser = byEpochUser.get(epoch);
    const totalWinningWei = totalWinningByEpoch.get(epoch) ?? 0n;
    if (!epochInfo || !perUser || totalWinningWei <= 0n || epochInfo.rewardPoolWei <= 0n) continue;

    const winners = [...perUser.entries()]
      .map(([user, winningAmountWei]) => {
        const rewardWei = (epochInfo.rewardPoolWei * winningAmountWei) / totalWinningWei;
        const reward = formatUnits(rewardWei, 18);
        return {
          row: {
            epoch,
            user,
            amount: formatLineaAmountFixed(rewardWei, 2),
            amountRaw: reward,
            tileId: epochInfo.winningTile,
            ...(epochInfo.jackpotKind ? { jackpotKind: epochInfo.jackpotKind } : {}),
            blockNumber: epochInfo.resolvedBlock,
          } satisfies RecentWinRow,
          rewardWei,
        };
      })
      .sort((a, b) => {
        const amountDelta = compareBigIntDesc(a.rewardWei, b.rewardWei);
        if (amountDelta !== 0) return amountDelta;
        return a.row.user.localeCompare(b.row.user);
      })
      .map(({ row }) => row);

    rows.push(...winners);
    if (rows.length >= limit) break;
  }

  return rows.slice(0, limit);
}

function isTooManyResultsError(err: unknown): boolean {
  const message = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return (
    message.includes("more than 10000 results") ||
    message.includes("query returned more than 10000 results") ||
    (message.includes("range") && message.includes("exceeds limit")) ||
    message.includes("request exceeds defined limit")
  );
}

function sortClaimsDesc<T extends { blockNumber: string; txHash?: string; user: string; epoch: string }>(rows: T[]) {
  return [...rows].sort((a, b) => {
    const aBlock = parseStoredBlockNumber(a.blockNumber);
    const bBlock = parseStoredBlockNumber(b.blockNumber);
    if (aBlock === bBlock) {
      if ((a.txHash ?? "") === (b.txHash ?? "")) {
        if (a.epoch === b.epoch) return a.user.localeCompare(b.user);
        return parseStoredEpochNumber(b.epoch) - parseStoredEpochNumber(a.epoch);
      }
      return (b.txHash ?? "").localeCompare(a.txHash ?? "");
    }
    return aBlock > bBlock ? -1 : 1;
  });
}

async function getLogsChunked(
  request: Omit<Parameters<typeof publicClient.getLogs>[0], "fromBlock" | "toBlock"> & {
    fromBlock: bigint;
    toBlock: bigint;
  },
) {
  const all: Awaited<ReturnType<typeof publicClient.getLogs>> = [];
  let cursor = request.fromBlock;
  let chunkSize = RECENT_WINS_LOG_SCAN_CHUNK;

  while (cursor <= request.toBlock) {
    const chunkTo = cursor + chunkSize - 1n > request.toBlock ? request.toBlock : cursor + chunkSize - 1n;
    try {
      const logs = await publicClient.getLogs({
        ...request,
        fromBlock: cursor,
        toBlock: chunkTo,
      } as Parameters<typeof publicClient.getLogs>[0]);
      all.push(...logs);
      cursor = chunkTo + 1n;
      if (chunkSize < RECENT_WINS_LOG_SCAN_CHUNK) {
        chunkSize = chunkSize * 2n > RECENT_WINS_LOG_SCAN_CHUNK ? RECENT_WINS_LOG_SCAN_CHUNK : chunkSize * 2n;
      }
    } catch (err) {
      if (!isTooManyResultsError(err) || chunkSize <= RECENT_WINS_LOG_SCAN_MIN_CHUNK) throw err;
      chunkSize = chunkSize / 2n;
    }
  }

  return all;
}

function mapClaimLog(log: RewardClaimLog): StoredClaimRow | null {
  try {
    const decoded = decodeEventLog({ abi: EVENTS_ABI, data: log.data, topics: log.topics });
    if (decoded.eventName !== "RewardClaimed") return null;
    const args = decoded.args as { epoch: bigint; user: string; reward: bigint };
    const user = normalizeStoredUserAddress(args.user);
    if (!user) return null;
    return {
      epoch: args.epoch.toString(),
      user,
      reward: formatUnits(args.reward, 18),
      rewardNum: toDisplayNumberWei(args.reward),
      txHash: normalizeClaimTxIdentity(log.transactionHash) ?? "",
      blockNumber: (log.blockNumber ?? 0n).toString(),
    };
  } catch {
    return null;
  }
}

async function fetchRewardClaimLogsInRange(fromBlock: bigint, toBlock: bigint) {
  if (toBlock < fromBlock) return [] as RewardClaimLog[];
  return getLogsChunked({
    address: CONTRACT_ADDRESS,
    topics: [rewardClaimedSig],
    fromBlock,
    toBlock,
  } as Parameters<typeof publicClient.getLogs>[0] & { fromBlock: bigint; toBlock: bigint });
}

async function fetchRecentRewardClaimLogsFromChain(limit = RECENT_WINS_LIMIT) {
  const currentBlock = await publicClient.getBlockNumber();
  const collected: RewardClaimLog[] = [];
  let toBlock = currentBlock;
  let chunkSize = RECENT_WINS_BOOTSTRAP_SCAN_CHUNK;

  while (toBlock >= CONTRACT_DEPLOY_BLOCK && collected.length < limit) {
    const fromBlock = toBlock - chunkSize + 1n > CONTRACT_DEPLOY_BLOCK ? toBlock - chunkSize + 1n : CONTRACT_DEPLOY_BLOCK;
    try {
      const logs = await publicClient.getLogs({
        address: CONTRACT_ADDRESS,
        topics: [rewardClaimedSig],
        fromBlock,
        toBlock,
      } as Parameters<typeof publicClient.getLogs>[0]);
      collected.push(...logs);
      if (fromBlock === CONTRACT_DEPLOY_BLOCK) break;
      toBlock = fromBlock - 1n;
    } catch (err) {
      if (!isTooManyResultsError(err) || chunkSize <= RECENT_WINS_LOG_SCAN_MIN_CHUNK) throw err;
      chunkSize = chunkSize / 2n;
    }
  }

  return collected;
}

function mergeClaims(existing: StoredClaimRow[], incoming: StoredClaimRow[]) {
  const byKey = new Map<string, StoredClaimRow>();
  for (const row of existing) byKey.set(buildRewardClaimStorageIdentity(row), row);
  for (const row of incoming) byKey.set(buildRewardClaimStorageIdentity(row), row);
  return sortClaimsDesc(Array.from(byKey.values())).slice(0, RECENT_WINS_LIMIT);
}

async function shouldRecoverRecentWins(storedClaims: StoredClaimRow[]) {
  if (storedClaims.length === 0) return true;
  const lastIndexedBlock = getMetaBigInt("lastIndexedBlock");
  if (!lastIndexedBlock || lastIndexedBlock < CONTRACT_DEPLOY_BLOCK) return true;
  const headBlock = await publicClient.getBlockNumber();
  return headBlock > lastIndexedBlock && headBlock - lastIndexedBlock >= RECENT_WINS_RECOVERY_BLOCK_LAG;
}

async function fetchOnchainClaims(existingClaims: StoredClaimRow[]) {
  const highestStoredBlock = existingClaims.reduce<bigint>((max, row) => {
    const value = parseStoredBlockNumber(row.blockNumber);
    return value > max ? value : max;
  }, 0n);

  const claimRows =
    existingClaims.length > 0
      ? (await fetchRewardClaimLogsInRange(
          highestStoredBlock > 0n && highestStoredBlock + 1n > CONTRACT_DEPLOY_BLOCK ? highestStoredBlock + 1n : CONTRACT_DEPLOY_BLOCK,
          await publicClient.getBlockNumber(),
        ))
          .map((log) => mapClaimLog(log))
          .filter((row): row is StoredClaimRow => row !== null)
      : (await fetchRecentRewardClaimLogsFromChain(RECENT_WINS_LIMIT))
          .map((log) => mapClaimLog(log))
          .filter((row): row is StoredClaimRow => row !== null);

  if (claimRows.length > 0) {
    upsertRewardClaims(
      claimRows.map((row) => ({
        id: buildRewardClaimStorageIdentity(row),
        epoch: row.epoch,
        user: row.user,
        reward: row.reward,
        rewardNum: row.rewardNum,
        txHash: normalizeClaimTxIdentity(row.txHash) ?? "",
        blockNumber: row.blockNumber,
      })),
    );
  }

  return mergeClaims(existingClaims, claimRows);
}

function buildPayloadFromClaims(claims: StoredClaimRow[]): RecentWinsPayload {
  const epochs = getEpochMap();
  return {
    wins: claims.map((row) => {
      const epoch = epochs[row.epoch];
      const jackpotKind = getJackpotKind(epoch);
      const tileId = parseRecentWinTileId(epoch?.winningTile);
      return {
        epoch: row.epoch,
        user: row.user,
        amount: formatRecentClaimAmount(row.reward),
        amountRaw: row.reward,
        ...(tileId !== null ? { tileId } : {}),
        ...(jackpotKind ? { jackpotKind } : {}),
        txHash: normalizeClaimTxIdentity(row.txHash) ?? "",
        blockNumber: row.blockNumber,
      };
    }),
  };
}

export async function buildRecentWinsPayload(
  options: { allowSlowRecovery?: boolean } = {},
): Promise<{ payload: RecentWinsPayload; recoveryNeeded: boolean }> {
  const recentResolvedWins = buildRecentResolvedWins(RECENT_WINS_LIMIT);
  if (recentResolvedWins.length > 0) {
    return {
      payload: { wins: recentResolvedWins },
      recoveryNeeded: false,
    };
  }

  const storedClaims = sortClaimsDesc(getRecentRewardClaims(RECENT_WINS_LIMIT));
  const recoveryNeeded = await shouldRecoverRecentWins(storedClaims);
  const claims = recoveryNeeded && options.allowSlowRecovery ? await fetchOnchainClaims(storedClaims) : storedClaims;
  return {
    payload: buildPayloadFromClaims(claims),
    recoveryNeeded,
  };
}

export async function getRecentWinsPayloadForRender(): Promise<RecentWinsPayload> {
  const { payload } = await buildRecentWinsPayload({ allowSlowRecovery: false });
  return payload;
}

function isFreshRecentWinsSnapshotSavedAt(savedAt: unknown, now = Date.now()) {
  return (
    typeof savedAt === "number" &&
    Number.isSafeInteger(savedAt) &&
    savedAt >= 0 &&
    Number.isSafeInteger(now) &&
    now >= 0 &&
    savedAt <= now &&
    now - savedAt <= RECENT_WINS_SNAPSHOT_MAX_AGE_MS
  );
}

export function loadRecentWinsSnapshot(expectedWatermark: string | null = getRecentWinsDataWatermark()): RecentWinsPayload | null {
  const snapshot = getMetaJson<RecentWinsSnapshotEnvelope | RecentWinsPayload>(RECENT_WINS_SNAPSHOT_META_KEY);
  if (!snapshot || !("savedAt" in snapshot)) return null;
  if (!isFreshRecentWinsSnapshotSavedAt(snapshot.savedAt)) {
    return null;
  }
  if (!("watermark" in snapshot) || snapshot.watermark !== expectedWatermark) {
    return null;
  }
  return snapshot.payload;
}

export function saveRecentWinsSnapshot(
  payload: RecentWinsPayload,
  watermark: string | null = getRecentWinsDataWatermark(),
) {
  setMetaJson(RECENT_WINS_SNAPSHOT_META_KEY, {
    payload,
    savedAt: Date.now(),
    watermark,
  });
}
