"use client";

const MAX_JSON_RESPONSE_BYTES = 2 * 1024 * 1024;
const JSON_CONTENT_TYPE_RE = /^application\/(?:json|[a-z0-9!#$&^_.+-]+\+json)$/;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

function parseContentLengthHeader(value: string | null): number | null {
  if (value === null) return null;
  if (!/^(?:0|[1-9]\d{0,15})$/.test(value)) return -1;
  const parsed = BigInt(value);
  if (parsed > MAX_SAFE_INTEGER_BIGINT) return -1;
  return Number(parsed);
}

function normalizeJsonResponseMaxBytes(value: number): number | null {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_JSON_RESPONSE_BYTES ? value : null;
}

function isJsonContentType(value: string | null): boolean {
  if (!value) return true;
  const contentType = value.split(";", 1)[0]?.trim().toLowerCase();
  return Boolean(contentType && JSON_CONTENT_TYPE_RE.test(contentType));
}

export async function readJsonResponse<T>(
  response: Response,
  maxBytes = MAX_JSON_RESPONSE_BYTES,
): Promise<T | null> {
  const byteLimit = normalizeJsonResponseMaxBytes(maxBytes);
  if (byteLimit === null) {
    throw new Error("Invalid JSON response");
  }
  const contentLength = parseContentLengthHeader(response.headers.get("content-length"));
  if (contentLength === -1) {
    throw new Error("Invalid JSON response");
  }
  if (contentLength !== null && contentLength > byteLimit) {
    throw new Error("JSON response too large");
  }
  if (!isJsonContentType(response.headers.get("content-type"))) {
    throw new Error("Invalid JSON response");
  }
  if (!response.body) return null;

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let totalBytes = 0;
  let raw = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > byteLimit) {
        await reader.cancel().catch(() => undefined);
        throw new Error("JSON response too large");
      }
      raw += decoder.decode(value, { stream: true });
    }
    raw += decoder.decode();
  } catch (error) {
    if (error instanceof Error && error.message === "JSON response too large") throw error;
    throw new Error("Invalid JSON response");
  }

  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error("Invalid JSON response");
  }
}
