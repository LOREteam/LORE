import { createHash, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";

export type ClientIdentity = {
  key: string;
  weak: boolean;
};

const PROXY_SECRET_HEADER = "x-lore-proxy-secret";
const MIN_PROXY_SECRET_LENGTH = 32;
const MAX_PROXY_SECRET_LENGTH = 256;
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;

function validIp(value: string | null | undefined) {
  const candidate = value?.trim();
  return candidate && candidate.length <= 64 && isIP(candidate) !== 0 ? candidate : null;
}

function secretsMatch(provided: string, expected: string) {
  const providedHash = createHash("sha256").update(provided).digest();
  const expectedHash = createHash("sha256").update(expected).digest();
  return timingSafeEqual(providedHash, expectedHash);
}

function normalizeProxySecret(value: string | null | undefined) {
  const secret = value?.trim();
  if (!secret || secret.length < MIN_PROXY_SECRET_LENGTH || secret.length > MAX_PROXY_SECRET_LENGTH) return null;
  return CONTROL_CHAR_RE.test(secret) ? null : secret;
}

function canTrustProxyHeaders(request: Request) {
  if (process.env.TRUST_PROXY_HEADERS !== "1") return false;
  const expected = normalizeProxySecret(process.env.TRUST_PROXY_SECRET);
  const provided = normalizeProxySecret(request.headers.get(PROXY_SECRET_HEADER));
  return Boolean(expected && provided && secretsMatch(provided, expected));
}

export function getClientIdentity(request: Request): ClientIdentity {
  if (canTrustProxyHeaders(request)) {
    const cfConnectingIp = validIp(request.headers.get("cf-connecting-ip"));
    if (cfConnectingIp) return { key: `cf:${cfConnectingIp}`, weak: false };

    const realIp = validIp(request.headers.get("x-real-ip"));
    if (realIp) return { key: `real:${realIp}`, weak: false };

    const forwardedIp = validIp(request.headers.get("x-forwarded-for")?.split(",")[0]);
    if (forwardedIp) return { key: `xff:${forwardedIp}`, weak: false };
  }

  const userAgent = request.headers.get("user-agent")?.slice(0, 120) ?? "unknown";
  const lang = request.headers.get("accept-language")?.slice(0, 64) ?? "";
  return { key: `anon:${userAgent}:${lang}`, weak: true };
}
