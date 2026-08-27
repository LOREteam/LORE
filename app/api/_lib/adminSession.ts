import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_AUTH_SESSION_ABSOLUTE_TTL_MS,
  ADMIN_AUTH_SESSION_IDLE_TTL_MS,
  ADMIN_AUTH_WALLET,
  ADMIN_AUTH_WALLET_CONFIGURED,
  normalizeAdminAuthAddress,
} from "../../lib/adminAuth";
import {
  hasPublicExternalRateLimitStore,
  requiresExternalSharedLock,
} from "./externalRateLimit";
import {
  createLocalAdminSessionRecord,
  deleteLocalAdminSessionRecordIfMatch,
  readLocalAdminSessionRecord,
  rotateLocalAdminSessionRecord,
} from "../../../server/storage";

const COOKIE_NAME = "lore_admin_session";
const SESSION_AUDIENCE = "lore-admin";
const SESSION_TYPE = "admin-session";
const SIGNING_CONTEXT = "lore-admin-session-v2\0";
const SESSION_COOKIE_MAX_LENGTH = 1024;
const SESSION_COOKIE_PART_RE = /^[A-Za-z0-9_-]+$/;
const SESSION_ID_RE = /^[A-Za-z0-9_-]{43}$/;
const SESSION_MAX_FUTURE_SKEW_MS = 60_000;
const MAX_EXTERNAL_SESSION_STORE_RESPONSE_BYTES = 8_192;
const EXTERNAL_CONTENT_LENGTH_RE = /^(?:0|[1-9]\d{0,15})$/;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const ROTATE_SESSION_SCRIPT = `
local current = redis.call("GET", KEYS[1])
if current ~= ARGV[1] then return 0 end
redis.call("SET", KEYS[1], ARGV[2], "PX", ARGV[3])
return 1
`;
const DELETE_SESSION_SCRIPT = `
local current = redis.call("GET", KEYS[1])
if not current then return 0 end
if current ~= ARGV[1] then return -1 end
return redis.call("DEL", KEYS[1])
`;

let missingSecretWarningShown = false;
let developmentSessionSecret: string | null = null;

export type AdminSessionPayload = {
  aud: typeof SESSION_AUDIENCE;
  type: typeof SESSION_TYPE;
  address: string;
  sessionId: string;
  sessionVersion: number;
  startedAt: number;
  issuedAt: number;
  expiresAt: number;
  absoluteExpiresAt: number;
};

export type AdminSessionRevocationOutcome = "invalid" | "missing" | "superseded" | "revoked";

type ExternalSessionStorePayload = {
  result?: unknown;
  error?: unknown;
};

type FetchLike = typeof fetch;

function getSessionSecret() {
  const configured = process.env.ADMIN_AUTH_SECRET?.trim();
  if (process.env.NODE_ENV === "production") {
    if (!configured || configured.length < 32) {
      throw new Error("ADMIN_AUTH_SECRET must contain at least 32 characters in production.");
    }
    const chatSecret =
      process.env.CHAT_AUTH_SECRET?.trim() ||
      process.env.NEXTAUTH_SECRET?.trim();
    if (chatSecret && configured === chatSecret) {
      throw new Error("ADMIN_AUTH_SECRET must be distinct from the chat authentication secret in production.");
    }
  }
  if (configured) return configured;

  if (!missingSecretWarningShown) {
    missingSecretWarningShown = true;
    console.warn("[admin-session] Using an ephemeral development fallback secret. Set ADMIN_AUTH_SECRET to match production behavior.");
  }

  developmentSessionSecret ??= randomBytes(32).toString("hex");
  return developmentSessionSecret;
}

function toBase64Url(value: string) {
  return Buffer.from(value, "utf8").toString("base64url");
}

function fromBase64Url(value: string) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function sign(payload: string) {
  return createHmac("sha256", getSessionSecret())
    .update(SIGNING_CONTEXT)
    .update(payload)
    .digest("base64url");
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function serialize(payload: AdminSessionPayload) {
  const encoded = toBase64Url(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

function parseSessionCookie(raw: string): [encoded: string, signature: string] | null {
  if (raw.length > SESSION_COOKIE_MAX_LENGTH) return null;
  const dotIndex = raw.indexOf(".");
  if (dotIndex <= 0 || raw.indexOf(".", dotIndex + 1) !== -1) return null;
  const encoded = raw.slice(0, dotIndex);
  const signature = raw.slice(dotIndex + 1);
  if (!SESSION_COOKIE_PART_RE.test(encoded) || !SESSION_COOKIE_PART_RE.test(signature)) return null;
  return [encoded, signature];
}

function normalizeTimestamp(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

export function normalizeAdminSessionExpiresAt(value: unknown, now = Date.now()) {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return null;
  const expiresAt = value;
  if (typeof now !== "number" || !Number.isSafeInteger(now) || now < 0) return null;
  if (expiresAt <= now) return null;
  if (expiresAt - now > ADMIN_AUTH_SESSION_IDLE_TTL_MS + SESSION_MAX_FUTURE_SKEW_MS) return null;
  return expiresAt;
}

function parse(raw: string, expectedAddress: string, now = Date.now()): AdminSessionPayload | null {
  const cookie = parseSessionCookie(raw);
  if (!cookie) return null;
  const normalizedExpectedAddress = normalizeAdminAuthAddress(expectedAddress);
  if (!normalizedExpectedAddress) return null;
  const [encoded, signature] = cookie;
  const expected = sign(encoded);
  if (!safeEqual(signature, expected)) return null;

  try {
    const decoded = fromBase64Url(encoded);
    if (toBase64Url(decoded) !== encoded) return null;
    const parsed = JSON.parse(decoded) as Partial<AdminSessionPayload>;
    if (parsed.aud !== SESSION_AUDIENCE || parsed.type !== SESSION_TYPE) return null;
    if (!parsed.address || typeof parsed.address !== "string") return null;
    if (!parsed.sessionId || typeof parsed.sessionId !== "string" || !SESSION_ID_RE.test(parsed.sessionId)) return null;
    if (
      typeof parsed.sessionVersion !== "number" ||
      !Number.isSafeInteger(parsed.sessionVersion) ||
      parsed.sessionVersion < 1
    ) return null;
    if (typeof now !== "number" || !Number.isSafeInteger(now) || now < 0) return null;

    const startedAt = normalizeTimestamp(parsed.startedAt);
    const issuedAt = normalizeTimestamp(parsed.issuedAt);
    const absoluteExpiresAt = normalizeTimestamp(parsed.absoluteExpiresAt);
    const expiresAt = normalizeAdminSessionExpiresAt(parsed.expiresAt, now);
    if (startedAt === null || issuedAt === null || absoluteExpiresAt === null || expiresAt === null) return null;
    if (startedAt > now + SESSION_MAX_FUTURE_SKEW_MS) return null;
    if (issuedAt < startedAt || issuedAt > now + SESSION_MAX_FUTURE_SKEW_MS) return null;
    if (startedAt > Number.MAX_SAFE_INTEGER - ADMIN_AUTH_SESSION_ABSOLUTE_TTL_MS) return null;
    if (absoluteExpiresAt !== startedAt + ADMIN_AUTH_SESSION_ABSOLUTE_TTL_MS) return null;
    if (absoluteExpiresAt <= now || expiresAt > absoluteExpiresAt) return null;
    if (issuedAt > Number.MAX_SAFE_INTEGER - ADMIN_AUTH_SESSION_IDLE_TTL_MS) return null;
    if (expiresAt !== Math.min(issuedAt + ADMIN_AUTH_SESSION_IDLE_TTL_MS, absoluteExpiresAt)) return null;

    const address = normalizeAdminAuthAddress(parsed.address);
    if (address !== normalizedExpectedAddress) return null;
    return {
      aud: SESSION_AUDIENCE,
      type: SESSION_TYPE,
      address,
      sessionId: parsed.sessionId,
      sessionVersion: parsed.sessionVersion,
      startedAt,
      issuedAt,
      expiresAt,
      absoluteExpiresAt,
    };
  } catch {
    return null;
  }
}

function sessionStoreKey(sessionId: string) {
  const id = createHash("sha256").update(sessionId).digest("hex");
  return `lore:admin-session:v2:${id}`;
}

function serializeSessionRecord(payload: AdminSessionPayload) {
  const addressHash = createHash("sha256").update(payload.address).digest("hex");
  return `${addressHash}:${payload.absoluteExpiresAt}:${payload.sessionVersion}`;
}

function sessionStoreTtlMs(expiresAt: number, now: number) {
  const ttlMs = expiresAt - now;
  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > ADMIN_AUTH_SESSION_IDLE_TTL_MS) {
    throw new Error("admin session store TTL is invalid");
  }
  return ttlMs;
}

function requiresExternalAdminSessionStore() {
  return requiresExternalSharedLock();
}

function parseExternalContentLength(value: string | null) {
  if (value === null) return null;
  if (!EXTERNAL_CONTENT_LENGTH_RE.test(value)) return -1;
  const parsed = BigInt(value);
  return parsed <= MAX_SAFE_INTEGER_BIGINT ? Number(parsed) : -1;
}

async function readExternalSessionStoreJson(response: Response): Promise<ExternalSessionStorePayload | null> {
  const contentLength = parseExternalContentLength(response.headers.get("content-length"));
  if (
    contentLength === -1 ||
    (contentLength !== null && contentLength > MAX_EXTERNAL_SESSION_STORE_RESPONSE_BYTES) ||
    !response.body
  ) return null;

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      bytes += value.byteLength;
      if (bytes > MAX_EXTERNAL_SESSION_STORE_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const payload = JSON.parse(text) as unknown;
    return payload && typeof payload === "object"
      ? payload as ExternalSessionStorePayload
      : null;
  } catch {
    return null;
  }
}

async function executeExternalSessionStoreCommand(
  command: unknown[],
  fetchImpl: FetchLike = fetch,
) {
  if (!hasPublicExternalRateLimitStore()) {
    throw new Error("shared admin session store is not configured");
  }
  const endpoint = process.env.UPSTASH_REDIS_REST_URL?.trim().replace(/\/$/, "");
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!endpoint || !token) throw new Error("shared admin session store is not configured");

  let response: Response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(command),
      signal: AbortSignal.timeout(3_000),
    });
  } catch {
    throw new Error("shared admin session store request failed");
  }
  const payload = await readExternalSessionStoreJson(response);
  if (!response.ok || payload?.error || !payload || !("result" in payload)) {
    throw new Error("shared admin session store rejected the request");
  }
  return payload.result;
}

async function createSessionRecord(payload: AdminSessionPayload, now: number) {
  const key = sessionStoreKey(payload.sessionId);
  const value = serializeSessionRecord(payload);
  const ttlMs = sessionStoreTtlMs(payload.expiresAt, now);
  if (requiresExternalAdminSessionStore()) {
    const result = await executeExternalSessionStoreCommand([
      "SET",
      key,
      value,
      "NX",
      "PX",
      String(ttlMs),
    ]);
    if (result === "OK") return true;
    if (result === null) return false;
    throw new Error("shared admin session store returned an invalid create response");
  }

  return createLocalAdminSessionRecord(key, value, payload.expiresAt, now);
}

async function readSessionRecord(payload: AdminSessionPayload, now: number) {
  const key = sessionStoreKey(payload.sessionId);
  if (requiresExternalAdminSessionStore()) {
    const result = await executeExternalSessionStoreCommand(["GET", key]);
    if (result === null) return null;
    if (typeof result !== "string") {
      throw new Error("shared admin session store returned an invalid read response");
    }
    return result;
  }

  return readLocalAdminSessionRecord(key, now);
}

async function rotateSessionRecord(
  previous: AdminSessionPayload,
  next: AdminSessionPayload,
  now: number,
) {
  const key = sessionStoreKey(previous.sessionId);
  const previousValue = serializeSessionRecord(previous);
  const nextValue = serializeSessionRecord(next);
  const ttlMs = sessionStoreTtlMs(next.expiresAt, now);
  if (requiresExternalAdminSessionStore()) {
    const result = await executeExternalSessionStoreCommand([
      "EVAL",
      ROTATE_SESSION_SCRIPT,
      "1",
      key,
      previousValue,
      nextValue,
      String(ttlMs),
    ]);
    if (result === 1 || result === "1") return true;
    if (result === 0 || result === "0" || result === null) return false;
    throw new Error("shared admin session store returned an invalid rotate response");
  }

  return rotateLocalAdminSessionRecord(
    key,
    previousValue,
    nextValue,
    next.expiresAt,
    now,
  );
}

async function deleteSessionRecord(payload: AdminSessionPayload, now: number) {
  const key = sessionStoreKey(payload.sessionId);
  const expectedValue = serializeSessionRecord(payload);
  if (requiresExternalAdminSessionStore()) {
    const result = await executeExternalSessionStoreCommand([
      "EVAL",
      DELETE_SESSION_SCRIPT,
      "1",
      key,
      expectedValue,
    ]);
    if (result === 1 || result === "1") return "revoked" as const;
    if (result === 0 || result === "0" || result === null) return "missing" as const;
    if (result === -1 || result === "-1") return "superseded" as const;
    throw new Error("shared admin session store returned an invalid delete response");
  }
  const result = deleteLocalAdminSessionRecordIfMatch(key, expectedValue, now);
  if (result === 1) return "revoked" as const;
  if (result === 0) return "missing" as const;
  return "superseded" as const;
}

function createSessionPayload(address: string, now: number): AdminSessionPayload {
  if (!Number.isSafeInteger(now) || now < 0) throw new Error("Cannot issue admin session with an invalid clock.");
  if (now > Number.MAX_SAFE_INTEGER - ADMIN_AUTH_SESSION_ABSOLUTE_TTL_MS) {
    throw new Error("Cannot issue admin session beyond the supported clock range.");
  }
  const absoluteExpiresAt = now + ADMIN_AUTH_SESSION_ABSOLUTE_TTL_MS;
  return {
    aud: SESSION_AUDIENCE,
    type: SESSION_TYPE,
    address,
    sessionId: randomBytes(32).toString("base64url"),
    sessionVersion: 1,
    startedAt: now,
    issuedAt: now,
    expiresAt: Math.min(now + ADMIN_AUTH_SESSION_IDLE_TTL_MS, absoluteExpiresAt),
    absoluteExpiresAt,
  };
}

function setAdminSessionCookie(response: NextResponse, token: string, expiresAt: number) {
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expiresAt),
  });
}

export async function issueAdminSession(
  response: NextResponse,
  address: string,
  now = Date.now(),
) {
  const normalizedAddress = normalizeAdminAuthAddress(address);
  if (
    !normalizedAddress ||
    !ADMIN_AUTH_WALLET_CONFIGURED ||
    normalizedAddress !== ADMIN_AUTH_WALLET
  ) throw new Error("Cannot issue admin session for an invalid wallet address.");

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const payload = createSessionPayload(normalizedAddress, now);
    const token = serialize(payload);
    if (!(await createSessionRecord(payload, now))) continue;
    setAdminSessionCookie(response, token, payload.expiresAt);
    return payload.expiresAt;
  }
  throw new Error("Cannot allocate a unique admin session.");
}

export async function rotateAdminSession(
  response: NextResponse,
  previous: AdminSessionPayload,
  now = Date.now(),
) {
  if (
    !Number.isSafeInteger(now) ||
    now < previous.issuedAt ||
    now >= previous.expiresAt ||
    now >= previous.absoluteExpiresAt
  ) return null;
  if (previous.sessionVersion >= Number.MAX_SAFE_INTEGER) return null;
  const next: AdminSessionPayload = {
    ...previous,
    sessionVersion: previous.sessionVersion + 1,
    issuedAt: now,
    expiresAt: Math.min(now + ADMIN_AUTH_SESSION_IDLE_TTL_MS, previous.absoluteExpiresAt),
  };
  const token = serialize(next);
  if (!(await rotateSessionRecord(previous, next, now))) return null;
  setAdminSessionCookie(response, token, next.expiresAt);
  return next.expiresAt;
}

export function clearAdminSession(response: NextResponse) {
  response.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(0),
  });
}

async function readAdminSessionFromStore(
  request: NextRequest,
  now = Date.now(),
): Promise<AdminSessionPayload | null> {
  const raw = request.cookies.get(COOKIE_NAME)?.value;
  if (!raw || !ADMIN_AUTH_WALLET_CONFIGURED) return null;
  const payload = parse(raw, ADMIN_AUTH_WALLET, now);
  if (!payload) return null;
  const record = await readSessionRecord(payload, now);
  return record && safeEqual(record, serializeSessionRecord(payload))
    ? payload
    : null;
}

export async function readAdminSession(
  request: NextRequest,
  now = Date.now(),
): Promise<AdminSessionPayload | null> {
  try {
    return await readAdminSessionFromStore(request, now);
  } catch {
    return null;
  }
}

export function readAdminSessionForRefresh(
  request: NextRequest,
  now = Date.now(),
) {
  return readAdminSessionFromStore(request, now);
}

export async function revokeAdminSession(
  request: NextRequest,
  now = Date.now(),
): Promise<AdminSessionRevocationOutcome> {
  const raw = request.cookies.get(COOKIE_NAME)?.value;
  if (!raw || !ADMIN_AUTH_WALLET_CONFIGURED) return "invalid";
  const payload = parse(raw, ADMIN_AUTH_WALLET, now);
  if (!payload) return "invalid";
  return deleteSessionRecord(payload, now);
}
