import { NextResponse } from "next/server";

function mergeVary(current: string | null, next: string) {
  if (!current) return next;
  const values = new Set(
    current
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  values.add(next);
  return [...values].join(", ");
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
