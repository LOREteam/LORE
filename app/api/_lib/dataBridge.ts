import { createPublicClient, fallback, http } from "viem";
import {
  getConfiguredContractAddress,
  getConfiguredDeployBlock,
  getConfiguredLineaNetwork,
  getLineaChain,
  getStableLineaReadRpcs,
} from "../../../config/publicConfig";
import { patchJsonPath, readJsonPath } from "../../../server/storage";

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
    { rank: false },
  ),
});

export async function fetchFirebaseWithOrderFallback<T>(path: string, orderByField: string, limitToLast?: number) {
  void orderByField;
  try {
    const data = readJsonPath<T>(path, limitToLast);
    return { ok: true as const, status: 200, data };
  } catch {
    return { ok: false as const, status: 500, data: null as T | null };
  }
}

export async function fetchFirebaseJson<T>(path: string) {
  try {
    const data = readJsonPath<T>(path);
    return { ok: true as const, status: 200, data };
  } catch {
    return { ok: false as const, status: 500, data: null as T | null };
  }
}

export async function patchFirebase(path: string, payload: Record<string, unknown>) {
  try {
    patchJsonPath(path, payload);
  } catch (error) {
    console.warn(`[api] Storage patch failed for ${path}:`, error);
  }
}

export function parseCurrentEpoch(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

export function filterByCurrentEpoch<T extends { epoch: string }>(rows: T[], currentEpoch: number | null) {
  if (!currentEpoch) return rows;
  return rows.filter((row) => {
    const n = Number(row.epoch);
    return Number.isInteger(n) && n >= 1 && n <= currentEpoch;
  });
}
