import { decodeEventLog, encodeEventTopics, formatUnits, getAddress } from "viem";
import { GAME_EVENTS_ABI as EVENTS_ABI } from "../../../config/generated/lineaOreV10Abi";
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
import {
  getCanonicalRecoveryLogIdentity,
  isRecoveryContextCurrent,
  loadFinalizedRecoveryContext,
  type FinalizedRecoveryContext,
} from "../_lib/jackpotsService";

const RECENT_WINS_LIMIT = 100;
const RECENT_WINS_SNAPSHOT_MAX_AGE_MS = 60 * 60 * 1000;
const RECENT_WINS_SNAPSHOT_META_KEY = "snapshot:recent-wins:v2";
const RECENT_WINS_LOG_SCAN_CHUNK = 10_000n;
const RECENT_WINS_LOG_SCAN_MIN_CHUNK = 2_000n;
const RECENT_WINS_RECOVERY_MAX_BLOCKS = 100_000n;
const RECENT_WINS_RECOVERY_MAX_RPC_CALLS = 12;
const RECENT_WINS_RECOVERY_MAX_LOGS = 250;
const RECENT_WINS_RECOVERY_MAX_TIME_MS = 5_000;
const RECENT_WINS_RECOVERY_BLOCK_LAG = parseOptionalNonNegativeBigIntEnv(process.env.RECENT_WINS_RECOVERY_BLOCK_LAG, 256n);
const MAX_TILE_ID = 25;

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
  recovery?: {
    status: "partial";
    direction: "backward" | "forward";
    continuationBlock: string;
  };
};

type RecentWinsSnapshotEnvelope = {
  payload: RecentWinsPayload;
  savedAt: number;
  watermark: string | null;
};

type StoredClaimRow = ReturnType<typeof getRecentRewardClaims>[number];
type RewardClaimLog = Awaited<ReturnType<typeof publicClient.getLogs>>[number];
type RecentWinsRecoveryDirection = "backward" | "forward";
type RecentWinsRecoveryCursor = {
  direction: RecentWinsRecoveryDirection;
  nextBlock: bigint;
  context: FinalizedRecoveryContext;
};
type BoundedClaimScan = {
  logs: RewardClaimLog[];
  complete: boolean;
  direction: RecentWinsRecoveryDirection;
  continuationBlock: bigint | null;
};

let recentWinsRecoveryCursor: RecentWinsRecoveryCursor | null = null;

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

function hasSameRecoveryContext(
  left: FinalizedRecoveryContext,
  right: FinalizedRecoveryContext,
) {
  return (
    left.blockNumber === right.blockNumber &&
    left.blockHash === right.blockHash &&
    left.finalityBlocks === right.finalityBlocks &&
    left.durableThroughBlock === right.durableThroughBlock &&
    left.durableCheckpointHash === right.durableCheckpointHash
  );
}

function getRecentWinsRecoveryCursor(): RecentWinsRecoveryCursor | null {
  const cursor = recentWinsRecoveryCursor;
  if (!cursor || (cursor.direction !== "backward" && cursor.direction !== "forward")) return null;
  if (
    typeof cursor.nextBlock !== "bigint" ||
    cursor.nextBlock < CONTRACT_DEPLOY_BLOCK ||
    cursor.context.blockNumber < CONTRACT_DEPLOY_BLOCK ||
    !/^0x[0-9a-f]{64}$/.test(cursor.context.blockHash)
  ) {
    recentWinsRecoveryCursor = null;
    return null;
  }
  return cursor;
}

function readRecentWinsRecoveryCursor(
  context: FinalizedRecoveryContext,
): RecentWinsRecoveryCursor | null {
  const cursor = getRecentWinsRecoveryCursor();
  return cursor && hasSameRecoveryContext(cursor.context, context) ? cursor : null;
}

async function loadRecentWinsRecoveryContext() {
  const cursor = getRecentWinsRecoveryCursor();
  if (cursor) {
    if (await isRecoveryContextCurrent(cursor.context)) {
      return cursor.context;
    }
    recentWinsRecoveryCursor = null;
  }
  return loadFinalizedRecoveryContext();
}

function saveRecentWinsRecoveryCursor(
  scan: BoundedClaimScan,
  context: FinalizedRecoveryContext,
) {
  if (scan.complete || scan.continuationBlock === null) {
    recentWinsRecoveryCursor = null;
    return;
  }
  recentWinsRecoveryCursor = {
    direction: scan.direction,
    nextBlock: scan.continuationBlock,
    context: { ...context },
  };
}

function recoveryDeadlineAt(now = Date.now()) {
  return now > Number.MAX_SAFE_INTEGER - RECENT_WINS_RECOVERY_MAX_TIME_MS
    ? Number.MAX_SAFE_INTEGER
    : now + RECENT_WINS_RECOVERY_MAX_TIME_MS;
}

async function scanRewardClaimLogsForward(fromBlock: bigint, toBlock: bigint): Promise<BoundedClaimScan> {
  if (toBlock < fromBlock) {
    return { logs: [], complete: true, direction: "forward", continuationBlock: null };
  }

  const logs: RewardClaimLog[] = [];
  const deadlineAt = recoveryDeadlineAt();
  let cursor = fromBlock;
  let chunkSize = RECENT_WINS_LOG_SCAN_CHUNK;
  let queriedBlocks = 0n;
  let rpcCalls = 0;

  while (cursor <= toBlock && logs.length < RECENT_WINS_RECOVERY_MAX_LOGS) {
    if (
      rpcCalls >= RECENT_WINS_RECOVERY_MAX_RPC_CALLS ||
      queriedBlocks >= RECENT_WINS_RECOVERY_MAX_BLOCKS ||
      Date.now() >= deadlineAt
    ) break;

    const remainingBlockBudget = RECENT_WINS_RECOVERY_MAX_BLOCKS - queriedBlocks;
    const requestedBlocks = [chunkSize, toBlock - cursor + 1n, remainingBlockBudget]
      .reduce((smallest, value) => value < smallest ? value : smallest);
    if (requestedBlocks <= 0n) break;
    const chunkTo = cursor + requestedBlocks - 1n;
    rpcCalls += 1;
    queriedBlocks += requestedBlocks;

    try {
      const chunkLogs = await publicClient.getLogs({
        address: CONTRACT_ADDRESS,
        topics: [rewardClaimedSig],
        fromBlock: cursor,
        toBlock: chunkTo,
      } as Parameters<typeof publicClient.getLogs>[0]);
      const remainingLogBudget = RECENT_WINS_RECOVERY_MAX_LOGS - logs.length;
      logs.push(...chunkLogs.slice(-remainingLogBudget));
      cursor = chunkTo + 1n;
      if (chunkSize < RECENT_WINS_LOG_SCAN_CHUNK) {
        chunkSize = chunkSize * 2n > RECENT_WINS_LOG_SCAN_CHUNK ? RECENT_WINS_LOG_SCAN_CHUNK : chunkSize * 2n;
      }
    } catch (err) {
      if (!isTooManyResultsError(err) || chunkSize <= RECENT_WINS_LOG_SCAN_MIN_CHUNK) throw err;
      chunkSize = chunkSize / 2n;
    }
  }

  const complete = cursor > toBlock;
  return {
    logs,
    complete,
    direction: "forward",
    continuationBlock: complete ? null : cursor,
  };
}

async function scanRewardClaimLogsBackward(
  startToBlock: bigint,
  limit = RECENT_WINS_LIMIT,
): Promise<BoundedClaimScan> {
  if (startToBlock < CONTRACT_DEPLOY_BLOCK) {
    return { logs: [], complete: true, direction: "backward", continuationBlock: null };
  }

  const logs: RewardClaimLog[] = [];
  const deadlineAt = recoveryDeadlineAt();
  let toBlock = startToBlock;
  let chunkSize = RECENT_WINS_LOG_SCAN_CHUNK;
  let queriedBlocks = 0n;
  let rpcCalls = 0;

  while (toBlock >= CONTRACT_DEPLOY_BLOCK && logs.length < limit) {
    if (
      rpcCalls >= RECENT_WINS_RECOVERY_MAX_RPC_CALLS ||
      queriedBlocks >= RECENT_WINS_RECOVERY_MAX_BLOCKS ||
      Date.now() >= deadlineAt
    ) break;

    const remainingBlockBudget = RECENT_WINS_RECOVERY_MAX_BLOCKS - queriedBlocks;
    const requestedBlocks = [chunkSize, toBlock - CONTRACT_DEPLOY_BLOCK + 1n, remainingBlockBudget]
      .reduce((smallest, value) => value < smallest ? value : smallest);
    if (requestedBlocks <= 0n) break;
    const fromBlock = toBlock - requestedBlocks + 1n;
    rpcCalls += 1;
    queriedBlocks += requestedBlocks;

    try {
      const chunkLogs = await publicClient.getLogs({
        address: CONTRACT_ADDRESS,
        topics: [rewardClaimedSig],
        fromBlock,
        toBlock,
      } as Parameters<typeof publicClient.getLogs>[0]);
      const remainingLogBudget = RECENT_WINS_RECOVERY_MAX_LOGS - logs.length;
      logs.push(...chunkLogs.slice(-remainingLogBudget));
      toBlock = fromBlock - 1n;
    } catch (err) {
      if (!isTooManyResultsError(err) || chunkSize <= RECENT_WINS_LOG_SCAN_MIN_CHUNK) throw err;
      chunkSize = chunkSize / 2n;
    }
  }

  const complete = toBlock < CONTRACT_DEPLOY_BLOCK || logs.length >= limit;
  return {
    logs,
    complete,
    direction: "backward",
    continuationBlock: complete ? null : toBlock,
  };
}

function mapClaimLog(log: RewardClaimLog): StoredClaimRow | null {
  const identity = getCanonicalRecoveryLogIdentity(log);
  if (!identity) return null;

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
      txHash: identity.txHash,
      blockNumber: identity.blockNumber.toString(),
    };
  } catch {
    return null;
  }
}


function mergeClaims(existing: StoredClaimRow[], incoming: StoredClaimRow[]) {
  const byKey = new Map<string, StoredClaimRow>();
  for (const row of existing) byKey.set(buildRewardClaimStorageIdentity(row), row);
  for (const row of incoming) byKey.set(buildRewardClaimStorageIdentity(row), row);
  return sortClaimsDesc(Array.from(byKey.values())).slice(0, RECENT_WINS_LIMIT);
}

function shouldRecoverRecentWins(
  storedClaims: StoredClaimRow[],
  context: FinalizedRecoveryContext,
) {
  if (readRecentWinsRecoveryCursor(context)) return true;
  if (storedClaims.length === 0) return true;
  const lastIndexedBlock = getMetaBigInt("lastIndexedBlock");
  if (!lastIndexedBlock || lastIndexedBlock < CONTRACT_DEPLOY_BLOCK) return true;
  return (
    context.blockNumber > lastIndexedBlock &&
    context.blockNumber - lastIndexedBlock >= RECENT_WINS_RECOVERY_BLOCK_LAG
  );
}

async function fetchOnchainClaims(
  existingClaims: StoredClaimRow[],
  context: FinalizedRecoveryContext,
) {
  const currentBlock = context.blockNumber;
  const highestStoredBlock = existingClaims.reduce<bigint>((max, row) => {
    const value = parseStoredBlockNumber(row.blockNumber);
    return value > max ? value : max;
  }, 0n);
  const savedCursor = readRecentWinsRecoveryCursor(context);
  let scan: BoundedClaimScan;

  if (savedCursor?.direction === "backward" && existingClaims.length < RECENT_WINS_LIMIT) {
    const savedToBlock = savedCursor.nextBlock;
    scan = await scanRewardClaimLogsBackward(
      savedToBlock < currentBlock ? savedToBlock : currentBlock,
      RECENT_WINS_LIMIT - existingClaims.length,
    );
  } else if (existingClaims.length === 0) {
    scan = await scanRewardClaimLogsBackward(currentBlock);
  } else {
    const storedNextBlock = highestStoredBlock > 0n ? highestStoredBlock + 1n : CONTRACT_DEPLOY_BLOCK;
    const savedNextBlock = savedCursor?.direction === "forward"
      ? savedCursor.nextBlock
      : CONTRACT_DEPLOY_BLOCK;
    const fromBlock = [CONTRACT_DEPLOY_BLOCK, storedNextBlock, savedNextBlock]
      .reduce((largest, value) => value > largest ? value : largest);
    scan = await scanRewardClaimLogsForward(fromBlock, currentBlock);
  }

  const claimRows = scan.logs
    .map((log) => mapClaimLog(log))
    .filter((row): row is StoredClaimRow => row !== null);

  if (!(await isRecoveryContextCurrent(context))) {
    recentWinsRecoveryCursor = null;
    return { claims: existingClaims, recovery: undefined };
  }
  saveRecentWinsRecoveryCursor(scan, context);

  return {
    claims: mergeClaims(existingClaims, claimRows),
    recovery: scan.complete || scan.continuationBlock === null
      ? undefined
      : {
          status: "partial" as const,
          direction: scan.direction,
          continuationBlock: scan.continuationBlock.toString(),
        },
  };
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
): Promise<{
  payload: RecentWinsPayload;
  recoveryNeeded: boolean;
  durableSnapshotEligible: boolean;
}> {
  const recentResolvedWins = buildRecentResolvedWins(RECENT_WINS_LIMIT);
  if (recentResolvedWins.length > 0) {
    recentWinsRecoveryCursor = null;
    return {
      payload: { wins: recentResolvedWins },
      recoveryNeeded: false,
      durableSnapshotEligible: true,
    };
  }

  const storedClaims = sortClaimsDesc(getRecentRewardClaims(RECENT_WINS_LIMIT));
  const recoveryContext = await loadRecentWinsRecoveryContext();
  const recoveryNeeded = recoveryContext !== null
    ? shouldRecoverRecentWins(storedClaims, recoveryContext)
    : false;
  const performedSlowRecovery = Boolean(
    recoveryNeeded && options.allowSlowRecovery && recoveryContext !== null,
  );
  const recovered = performedSlowRecovery && recoveryContext !== null
    ? await fetchOnchainClaims(storedClaims, recoveryContext)
    : { claims: storedClaims, recovery: undefined };
  if (!recoveryNeeded) {
    recentWinsRecoveryCursor = null;
  }
  return {
    payload: {
      ...buildPayloadFromClaims(recovered.claims),
      ...(recovered.recovery ? { recovery: recovered.recovery } : {}),
    },
    recoveryNeeded,
    // Slow chain recovery remains process-cache-only. Only indexed storage may
    // later produce a durable render snapshot.
    durableSnapshotEligible: !performedSlowRecovery,
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
