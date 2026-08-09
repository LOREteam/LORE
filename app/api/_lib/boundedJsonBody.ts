export type BoundedJsonBodyResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "invalid" | "too-large" | "unsupported-content-type" };

const JSON_CONTENT_TYPE_RE = /^application\/(?:json|[a-z0-9!#$&^_.+-]+\+json)$/;
const MAX_JSON_BODY_BYTES = 256 * 1024;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

function parseContentLengthHeader(value: string | null): number | null {
  if (value === null) return null;
  if (!/^(?:0|[1-9]\d{0,15})$/.test(value)) return -1;
  const parsed = BigInt(value);
  if (parsed > MAX_SAFE_INTEGER_BIGINT) return -1;
  return Number(parsed);
}

function normalizeJsonBodyMaxBytes(value: number): number | null {
  return Number.isSafeInteger(value) && value > 0 && value <= MAX_JSON_BODY_BYTES ? value : null;
}

function isJsonContentType(value: string | null): boolean {
  const contentType = value?.split(";", 1)[0]?.trim().toLowerCase();
  return Boolean(contentType && JSON_CONTENT_TYPE_RE.test(contentType));
}

export async function readBoundedJsonBody<T>(
  request: Request,
  maxBytes: number,
): Promise<BoundedJsonBodyResult<T>> {
  const byteLimit = normalizeJsonBodyMaxBytes(maxBytes);
  if (byteLimit === null) {
    return { ok: false, reason: "invalid" };
  }
  const contentLength = parseContentLengthHeader(request.headers.get("content-length"));
  if (contentLength === -1) {
    return { ok: false, reason: "invalid" };
  }
  if (contentLength !== null && contentLength > byteLimit) {
    return { ok: false, reason: "too-large" };
  }
  if (!isJsonContentType(request.headers.get("content-type"))) {
    return { ok: false, reason: "unsupported-content-type" };
  }
  if (!request.body) return { ok: false, reason: "invalid" };

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let totalBytes = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > byteLimit) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, reason: "too-large" };
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return { ok: true, value: JSON.parse(text) as T };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}
