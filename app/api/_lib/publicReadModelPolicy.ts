import { getAddress } from "viem";
import { NextResponse } from "next/server";
import {
  formatLineaAmountFixed,
  formatLineaWeiDisplayNumber,
  parseLineaAmountWei,
} from "../../lib/tokenAmountMath";
import { parsePositiveIntegerValue } from "./queryParams";
import {
  parseStoredBlockNumberOrZero,
  parseStoredPositiveIntegerOrZero,
} from "./storedNumberParsing";
import { applyNoStoreHeaders } from "./responseHeaders";

export const PUBLIC_REWARDS_MAX_EPOCHS = 400;
export const PUBLIC_REWARDS_MAX_EPOCH_NUMBER = 1_000_000;
export const PUBLIC_READ_MODEL_MAX_TILE_ID = 25;
export const PUBLIC_READ_MODEL_FETCH_ERROR = "fetch failed";
export const PUBLIC_LEADERBOARD_NAME_MAX_LENGTH = 20;

export const RECENT_WINS_RECOVERY_POLICY = Object.freeze({
  logScanChunk: 10_000n,
  logScanMinChunk: 2_000n,
  maxBlocks: 100_000n,
  maxRpcCalls: 12,
  maxLogs: 250,
  maxTimeMs: 5_000,
});

export type PublicRewardsEpochsResult =
  | { ok: true; epochs: number[] }
  | { ok: false; error: "Too many epochs" | "Invalid epochs" };

export type PublicRewardClaimIdentityRow = {
  blockNumber: string;
  epoch: string;
  txHash?: string | null;
  user: string;
};

export function parsePublicRewardsEpochs(epochsRaw: unknown): PublicRewardsEpochsResult {
  if (!Array.isArray(epochsRaw)) return { ok: true, epochs: [] };
  if (epochsRaw.length > PUBLIC_REWARDS_MAX_EPOCHS) {
    return { ok: false, error: "Too many epochs" };
  }
  const epochs = new Set<number>();
  for (const value of epochsRaw) {
    const parsed = parsePositiveIntegerValue(value);
    if (parsed === null || parsed > PUBLIC_REWARDS_MAX_EPOCH_NUMBER) {
      return { ok: false, error: "Invalid epochs" };
    }
    epochs.add(parsed);
  }
  return { ok: true, epochs: [...epochs] };
}

export function createPublicReadModelJsonResponse(
  payload: unknown,
  status = 200,
): NextResponse {
  return applyNoStoreHeaders(NextResponse.json(payload, { status }));
}

export function buildPublicReadModelFailure<T extends object>(emptyPayload: T): T & { error: string } {
  return { ...emptyPayload, error: PUBLIC_READ_MODEL_FETCH_ERROR };
}

export function sanitizePublicLeaderboardName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/gu, " ")
    .trim();
  if (!normalized) return null;
  return normalized.slice(0, PUBLIC_LEADERBOARD_NAME_MAX_LENGTH);
}

export function normalizePublicReadModelAddress(user: string): `0x${string}` | null {
  try {
    return getAddress(user).toLowerCase() as `0x${string}`;
  } catch {
    return null;
  }
}

export function normalizePublicTransactionHash(
  txHash: string | null | undefined,
): `0x${string}` | null {
  const normalized = typeof txHash === "string" ? txHash.trim().toLowerCase() : "";
  return /^0x[0-9a-f]{64}$/.test(normalized) ? (normalized as `0x${string}`) : null;
}

export function parsePublicReadModelTileId(
  value: bigint | number | null | undefined,
): number | null {
  if (typeof value === "bigint") {
    return value >= 1n && value <= BigInt(PUBLIC_READ_MODEL_MAX_TILE_ID)
      ? Number(value)
      : null;
  }
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= PUBLIC_READ_MODEL_MAX_TILE_ID
    ? value
    : null;
}

export function selectPublicLeaderboardWinningTile<T extends { winningTile?: unknown }>(
  epochRow: T | null | undefined,
): number | null {
  const value = epochRow?.winningTile;
  return typeof value === "number" || typeof value === "bigint"
    ? parsePublicReadModelTileId(value)
    : null;
}

export function collectPublicLeaderboardWinningTiles<T extends { winningTile?: unknown }>(
  epochRows: Iterable<T>,
): { counts: Map<number, number>; resolvedCount: number } {
  const counts = new Map<number, number>();
  let resolvedCount = 0;
  for (const row of epochRows) {
    const winningTile = selectPublicLeaderboardWinningTile(row);
    if (winningTile === null) continue;
    counts.set(winningTile, (counts.get(winningTile) ?? 0) + 1);
    resolvedCount += 1;
  }
  return { counts, resolvedCount };
}

export function comparePublicBigIntDesc(left: bigint, right: bigint): number {
  if (left === right) return 0;
  return left > right ? -1 : 1;
}

export function toPublicWeiDisplayNumber(value: bigint): number {
  return formatLineaWeiDisplayNumber(value);
}

export function formatPublicRecentClaimAmount(value: string | undefined): string {
  return formatLineaAmountFixed(parseLineaAmountWei(value), 2);
}

export function isFreshPublicReadModelSnapshot(
  savedAt: unknown,
  maxAgeMs: number,
  now = Date.now(),
): boolean {
  return (
    typeof savedAt === "number" &&
    Number.isSafeInteger(savedAt) &&
    savedAt >= 0 &&
    Number.isSafeInteger(maxAgeMs) &&
    maxAgeMs > 0 &&
    Number.isSafeInteger(now) &&
    now >= 0 &&
    savedAt <= now &&
    now - savedAt <= maxAgeMs
  );
}

export function buildPublicRewardClaimStorageIdentity(
  row: PublicRewardClaimIdentityRow,
): string {
  const txHash = normalizePublicTransactionHash(row.txHash);
  if (txHash) return `${txHash}_${row.user}_${row.epoch}`;
  return `nohash_${parseStoredBlockNumberOrZero(row.blockNumber).toString()}_${row.user}_${row.epoch}`;
}

export function sortPublicRewardClaimsDesc<T extends PublicRewardClaimIdentityRow>(rows: T[]): T[] {
  return [...rows].sort((left, right) => {
    const leftBlock = parseStoredBlockNumberOrZero(left.blockNumber);
    const rightBlock = parseStoredBlockNumberOrZero(right.blockNumber);
    if (leftBlock !== rightBlock) return leftBlock > rightBlock ? -1 : 1;
    const leftHash = normalizePublicTransactionHash(left.txHash) ?? "";
    const rightHash = normalizePublicTransactionHash(right.txHash) ?? "";
    if (leftHash !== rightHash) return rightHash.localeCompare(leftHash);
    const leftEpoch = parseStoredPositiveIntegerOrZero(left.epoch);
    const rightEpoch = parseStoredPositiveIntegerOrZero(right.epoch);
    if (leftEpoch !== rightEpoch) return rightEpoch - leftEpoch;
    return left.user.localeCompare(right.user);
  });
}

export function mergePublicRewardClaims<T extends PublicRewardClaimIdentityRow>(
  existing: T[],
  incoming: T[],
  limit: number,
): T[] {
  if (!Number.isSafeInteger(limit) || limit <= 0) return [];
  const byIdentity = new Map<string, T>();
  for (const row of existing) byIdentity.set(buildPublicRewardClaimStorageIdentity(row), row);
  for (const row of incoming) byIdentity.set(buildPublicRewardClaimStorageIdentity(row), row);
  return sortPublicRewardClaimsDesc([...byIdentity.values()]).slice(0, limit);
}

const LEADERBOARD_ROI_BASIS_POINTS_SCALE = 10_000n;
const LEADERBOARD_ROI_VALUE_NUM_MAX_BASIS_POINTS = BigInt(Number.MAX_SAFE_INTEGER);

export function computePublicLeaderboardRoiBasisPoints(
  totalWon: bigint,
  totalWagered: bigint,
): bigint {
  if (totalWon <= 0n || totalWagered <= 0n) return 0n;
  return (totalWon * LEADERBOARD_ROI_BASIS_POINTS_SCALE) / totalWagered;
}

export function formatPublicLeaderboardRoiPercent(roiBasisPoints: bigint): string {
  const safeBasisPoints = roiBasisPoints > 0n ? roiBasisPoints : 0n;
  const roundedTenths = (safeBasisPoints + 5n) / 10n;
  return `${roundedTenths / 10n}.${roundedTenths % 10n}%`;
}

export function toPublicLeaderboardRoiValueNum(roiBasisPoints: bigint): number {
  if (roiBasisPoints <= 0n) return 0;
  const bounded = roiBasisPoints > LEADERBOARD_ROI_VALUE_NUM_MAX_BASIS_POINTS
    ? LEADERBOARD_ROI_VALUE_NUM_MAX_BASIS_POINTS
    : roiBasisPoints;
  return Number(bounded) / 100;
}
