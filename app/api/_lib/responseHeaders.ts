import { NextResponse } from "next/server";

const HEADER_TOKEN_RE = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

function normalizeHeaderToken(value: string) {
  const trimmed = value.trim();
  return trimmed && HEADER_TOKEN_RE.test(trimmed) ? trimmed : null;
}

function mergeVary(current: string | null, next: string) {
  const nextToken = normalizeHeaderToken(next);
  if (!nextToken) return current ?? "";
  if (!current) return nextToken;
  const nextKey = nextToken.toLowerCase();
  const seen = new Set<string>();
  const values: string[] = [];
  for (const value of current.split(",")) {
    const trimmed = normalizeHeaderToken(value);
    if (!trimmed) continue;
    if (trimmed === "*") return "*";
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(key === nextKey ? nextToken : trimmed);
  }
  if (!seen.has(nextKey)) values.push(nextToken);
  return values.join(", ");
}

export function applyNoStoreHeaders(response: NextResponse, options?: { varyCookie?: boolean }) {
  response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
  response.headers.set("Pragma", "no-cache");
  response.headers.set("Expires", "0");
  if (options?.varyCookie) {
    response.headers.set("Vary", mergeVary(response.headers.get("Vary"), "Cookie"));
  }
  return response;
}
