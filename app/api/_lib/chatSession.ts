import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { CHAT_AUTH_SESSION_TTL_MS, normalizeChatAuthAddress } from "../../lib/chatAuth";

const COOKIE_NAME = "lore_chat_session";
const SESSION_AUDIENCE = "lore-chat";
const SESSION_TYPE = "chat-session";
const SIGNING_CONTEXT = "lore-chat-session-v2\0";
const SESSION_COOKIE_MAX_LENGTH = 1024;
const SESSION_COOKIE_PART_RE = /^[A-Za-z0-9_-]+$/;
const SESSION_MAX_FUTURE_SKEW_MS = 60_000;
let missingSecretWarningShown = false;
let developmentSessionSecret: string | null = null;

function getSessionSecret() {
  const configured =
    process.env.CHAT_AUTH_SECRET?.trim() ||
    process.env.NEXTAUTH_SECRET?.trim();
  if (configured) return configured;

  if (process.env.NODE_ENV === "production") {
    throw new Error("CHAT_AUTH_SECRET or NEXTAUTH_SECRET must be configured in production.");
  }

  if (!missingSecretWarningShown) {
    missingSecretWarningShown = true;
    console.warn("[chat-session] Using an ephemeral development fallback secret. Set CHAT_AUTH_SECRET to match production behavior.");
  }

  developmentSessionSecret ??= randomBytes(32).toString("hex");
  return developmentSessionSecret;
}

type SessionPayload = {
  aud: typeof SESSION_AUDIENCE;
  type: typeof SESSION_TYPE;
  address: string;
  expiresAt: number;
};

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

function serialize(payload: SessionPayload) {
  const encoded = toBase64Url(JSON.stringify(payload));
  return `${encoded}.${sign(encoded)}`;
}

export function parseChatSessionCookie(raw: string): [encoded: string, signature: string] | null {
  if (raw.length > SESSION_COOKIE_MAX_LENGTH) return null;
  const dotIndex = raw.indexOf(".");
  if (dotIndex <= 0 || raw.indexOf(".", dotIndex + 1) !== -1) return null;
  const encoded = raw.slice(0, dotIndex);
  const signature = raw.slice(dotIndex + 1);
  if (!SESSION_COOKIE_PART_RE.test(encoded) || !SESSION_COOKIE_PART_RE.test(signature)) return null;
  return [encoded, signature];
}

export function normalizeChatSessionExpiresAt(value: unknown, now = Date.now()) {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return null;
  if (typeof now !== "number" || !Number.isSafeInteger(now) || now < 0) return null;
  if (value <= now) return null;
  if (value - now > CHAT_AUTH_SESSION_TTL_MS + SESSION_MAX_FUTURE_SKEW_MS) return null;
  return value;
}

function parse(raw: string, now: number): SessionPayload | null {
  const cookie = parseChatSessionCookie(raw);
  if (!cookie) return null;
  const [encoded, signature] = cookie;
  const expected = sign(encoded);
  if (!safeEqual(signature, expected)) return null;

  try {
    const parsed = JSON.parse(fromBase64Url(encoded)) as Partial<SessionPayload>;
    if (parsed.aud !== SESSION_AUDIENCE || parsed.type !== SESSION_TYPE) return null;
    if (!parsed.address || typeof parsed.address !== "string") return null;
    const expiresAt = normalizeChatSessionExpiresAt(parsed.expiresAt, now);
    if (expiresAt === null) return null;
    const address = normalizeChatAuthAddress(parsed.address);
    if (!address) return null;
    return {
      aud: SESSION_AUDIENCE,
      type: SESSION_TYPE,
      address,
      expiresAt,
    };
  } catch {
    return null;
  }
}

export function issueChatSession(response: NextResponse, address: string, now = Date.now()) {
  if (!Number.isSafeInteger(now) || now < 0 || now > Number.MAX_SAFE_INTEGER - CHAT_AUTH_SESSION_TTL_MS) {
    throw new Error("Cannot issue chat session with an invalid clock.");
  }
  const expiresAt = now + CHAT_AUTH_SESSION_TTL_MS;
  const normalizedAddress = normalizeChatAuthAddress(address);
  if (!normalizedAddress) throw new Error("Cannot issue chat session for an invalid wallet address.");
  const token = serialize({
    aud: SESSION_AUDIENCE,
    type: SESSION_TYPE,
    address: normalizedAddress,
    expiresAt,
  });
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/api/chat",
    expires: new Date(expiresAt),
  });
  return expiresAt;
}

export function clearChatSession(response: NextResponse) {
  response.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/api/chat",
    expires: new Date(0),
  });
}

export function readChatSession(request: NextRequest, now = Date.now()): SessionPayload | null {
  const raw = request.cookies.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  return parse(raw, now);
}
