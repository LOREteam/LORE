import { createPublicClient, http } from "viem";
import { lineaSepolia } from "viem/chains";
import {
  DEFAULT_CONTRACT_ADDRESS,
  DEFAULT_FIREBASE_DB_URL,
  DEFAULT_INDEXER_START_BLOCK,
} from "../../../config/publicConfig";

export const FIREBASE_DB_URL =
  process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ||
  DEFAULT_FIREBASE_DB_URL;
export const FIREBASE_DB_AUTH = process.env.FIREBASE_DB_AUTH ?? "";
export const CONTRACT_ADDRESS = (process.env.KEEPER_CONTRACT_ADDRESS ||
  DEFAULT_CONTRACT_ADDRESS) as `0x${string}`;
export const CONTRACT_DEPLOY_BLOCK = BigInt(process.env.INDEXER_START_BLOCK ?? String(DEFAULT_INDEXER_START_BLOCK));
export const RPC_URL = process.env.KEEPER_RPC_URL || "https://rpc.sepolia.linea.build";

export const publicClient = createPublicClient({
  chain: lineaSepolia,
  transport: http(RPC_URL, { timeout: 20_000, retryCount: 1 }),
});

type QueryValue = string | number | boolean;

export function requireFirebaseWriteAuth(context: string = "server Firebase writes") {
  if (!FIREBASE_DB_AUTH) {
    throw new Error(`FIREBASE_DB_AUTH is required for ${context}.`);
  }
  return FIREBASE_DB_AUTH;
}

function toQueryString(params?: Record<string, QueryValue>) {
  if (!params) return "";
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) sp.set(k, String(v));
  const q = sp.toString();
  return q ? `?${q}` : "";
}

export function firebaseReadUrl(path: string, params?: Record<string, QueryValue>) {
  return `${FIREBASE_DB_URL}/${path}.json${toQueryString(params)}`;
}

export function firebaseWriteUrl(path: string, params?: Record<string, QueryValue>) {
  const auth = requireFirebaseWriteAuth(`Firebase write path "${path}"`);
  const base = `${FIREBASE_DB_URL}/${path}.json`;
  const p: Record<string, QueryValue> = { ...(params ?? {}) };
  p.auth = auth;
  return `${base}${toQueryString(p)}`;
}

export function firebaseWriteUrlWithHeaders(path: string, params?: Record<string, QueryValue>): { url: string; headers: Record<string, string> } {
  const auth = requireFirebaseWriteAuth(`Firebase write path "${path}"`);
  const base = `${FIREBASE_DB_URL}/${path}.json`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  headers["X-Firebase-Auth"] = auth;

  return { url: base + toQueryString(params ?? {}) || "", headers };
}

export async function fetchFirebaseWithOrderFallback<T>(path: string, orderByField: string, limitToLast?: number) {
  const params: Record<string, QueryValue> = { orderBy: JSON.stringify(orderByField) };
  if (limitToLast) params.limitToLast = limitToLast;

  let res = await fetch(firebaseReadUrl(path, params), { next: { revalidate: 10 } });
  if (res.status === 400) {
    res = await fetch(firebaseReadUrl(path), { next: { revalidate: 10 } });
  }
  if (!res.ok) return { ok: false as const, status: res.status, data: null as T | null };
  const json = (await res.json()) as T | null;
  return { ok: true as const, status: res.status, data: json };
}

export async function fetchFirebaseJson<T>(path: string) {
  const res = await fetch(firebaseReadUrl(path), { next: { revalidate: 10 } });
  if (!res.ok) return { ok: false as const, status: res.status, data: null as T | null };
  const json = (await res.json()) as T | null;
  return { ok: true as const, status: res.status, data: json };
}

export async function patchFirebase(path: string, payload: Record<string, unknown>) {
  const res = await fetch(firebaseWriteUrl(path), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    console.warn(`[api] Firebase patch failed (${res.status}) for ${path}`);
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
