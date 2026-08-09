import { createPublicClient, fallback, http } from "viem";
import {
  getConfiguredContractAddress,
  getConfiguredDeployBlock,
  getConfiguredLineaNetwork,
  getLineaChain,
  getStableLineaReadRpcs,
} from "../../../config/publicConfig";
import { patchJsonPath, readJsonPath } from "../../../server/storage";
import { parsePositiveIntegerValue } from "./queryParams";
import { logRouteError } from "./routeError";

export const APP_NETWORK = getConfiguredLineaNetwork();
export const APP_CHAIN = getLineaChain(APP_NETWORK);

export const CONTRACT_ADDRESS = getConfiguredContractAddress(
  process.env.KEEPER_CONTRACT_ADDRESS ??
    process.env.NEXT_PUBLIC_CONTRACT_ADDRESS,
  APP_NETWORK,
) as `0x${string}`;
export const CONTRACT_DEPLOY_BLOCK = getConfiguredDeployBlock(
  process.env.INDEXER_START_BLOCK ??
    process.env.NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK,
  APP_NETWORK,
);
export const SERVER_RPC_URLS = getStableLineaReadRpcs(process.env.KEEPER_RPC_URL, APP_NETWORK);
export const RPC_URL = SERVER_RPC_URLS[0];

export const publicClient = createPublicClient({
  chain: APP_CHAIN,
  transport: fallback(
    SERVER_RPC_URLS.map((url) => http(url, { timeout: 20_000, retryCount: 1 })),
    { rank: true },
  ),
});

export async function fetchStorageJson<T>(path: string, limitToLast?: number) {
  try {
    const data = readJsonPath<T>(path, limitToLast);
    return { ok: true as const, status: 200, data };
  } catch (err) {
    logRouteError("api/storage-read", err);
    return { ok: false as const, status: 500, data: null as T | null };
  }
}

function isSupportedApiStoragePatchPath(path: string) {
  return (
    path === "gamedata/epochs" ||
    path === "gamedata/jackpots" ||
    /^gamedata\/bets\/0x[a-f0-9]{40}$/.test(path)
  );
}

export async function patchStorage(path: string, payload: Record<string, unknown>) {
  if (!isSupportedApiStoragePatchPath(path)) {
    logRouteError("api/storage-write", new Error("Unsupported API storage patch path"));
    return false;
  }
  try {
    patchJsonPath(path, payload);
    return true;
  } catch (error) {
    logRouteError("api/storage-write", error);
    return false;
  }
}

export function isSafePositiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

export function parseCurrentEpoch(value: unknown): number | null {
  return parsePositiveIntegerValue(value);
}

export function filterByCurrentEpoch<T extends { epoch: string }>(rows: T[], currentEpoch: number | null) {
  if (!currentEpoch) return rows;
  return rows.filter((row) => {
    const n = parsePositiveIntegerValue(row.epoch);
    return n !== null && n <= currentEpoch;
  });
}
