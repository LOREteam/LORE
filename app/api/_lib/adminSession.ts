import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  ADMIN_AUTH_SESSION_TTL_MS,
  ADMIN_AUTH_WALLET,
  ADMIN_AUTH_WALLET_CONFIGURED,
  normalizeAdminAuthAddress,
} from "../../lib/adminAuth";

const COOKIE_NAME = "lore_admin_session";
const SESSION_COOKIE_MAX_LENGTH = 1024;
const SESSION_COOKIE_PART_RE = /^[A-Za-z0-9_-]+$/;
const SESSION_MAX_FUTURE_SKEW_MS = 60_000;
let missingSecretWarningShown = false;
let developmentSessionSecret: string | null = null;

function getSessionSecret() {
  const configured =
    process.env.ADMIN_AUTH_SECRET?.trim() ||
    process.env.CHAT_AUTH_SECRET?.trim() ||
    process.env.NEXTAUTH_SECRET?.trim();
  if (configured) return configured;

  if (process.env.NODE_ENV === "production") {
    throw new Error("ADMIN_AUTH_SECRET, CHAT_AUTH_SECRET, or NEXTAUTH_SECRET must be configured in production.");
  }

  if (!missingSecretWarningShown) {
    missingSecretWarningShown = true;
    console.warn("[admin-session] Using an ephemeral development fallback secret. Set ADMIN_AUTH_SECRET to match production behavior.");
  }

  developmentSessionSecret ??= randomBytes(32).toString("hex");
  return developmentSessionSecret;
}

type SessionPayload = {
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
  return createHmac("sha256", getSessionSecret()).update(payload).digest("base64url");
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

function parseSessionCookie(raw: string): [encoded: string, signature: string] | null {
  if (raw.length > SESSION_COOKIE_MAX_LENGTH) return null;
  const dotIndex = raw.indexOf(".");
  if (dotIndex <= 0 || raw.indexOf(".", dotIndex + 1) !== -1) return null;
  const encoded = raw.slice(0, dotIndex);
  const signature = raw.slice(dotIndex + 1);
  if (!SESSION_COOKIE_PART_RE.test(encoded) || !SESSION_COOKIE_PART_RE.test(signature)) return null;
  return [encoded, signature];
}

export function normalizeAdminSessionExpiresAt(value: unknown, now = Date.now()) {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) return null;
  if (typeof now !== "number" || !Number.isSafeInteger(now) || now < 0) return null;
  if (value <= now) return null;
  if (value - now > ADMIN_AUTH_SESSION_TTL_MS + SESSION_MAX_FUTURE_SKEW_MS) return null;
  return value;
}

function parse(raw: string): SessionPayload | null {
  const cookie = parseSessionCookie(raw);
  if (!cookie) return null;
  if (!ADMIN_AUTH_WALLET_CONFIGURED) return null;
  const [encoded, signature] = cookie;
  const expected = sign(encoded);
  if (!safeEqual(signature, expected)) return null;

  try {
    const parsed = JSON.parse(fromBase64Url(encoded)) as Partial<SessionPayload>;
    if (!parsed.address || typeof parsed.address !== "string") return null;
    const expiresAt = normalizeAdminSessionExpiresAt(parsed.expiresAt);
    if (expiresAt === null) return null;
    const address = normalizeAdminAuthAddress(parsed.address);
    if (address !== ADMIN_AUTH_WALLET) return null;
    return {
      address,
      expiresAt,
    };
  } catch {
    return null;
  }
}

export function issueAdminSession(response: NextResponse, address: string) {
  const expiresAt = Date.now() + ADMIN_AUTH_SESSION_TTL_MS;
  const normalizedAddress = normalizeAdminAuthAddress(address);
  if (!normalizedAddress) throw new Error("Cannot issue admin session for an invalid wallet address.");
  const token = serialize({ address: normalizedAddress, expiresAt });
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(expiresAt),
  });
  return expiresAt;
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

export function readAdminSession(request: NextRequest): SessionPayload | null {
  const raw = request.cookies.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  const payload = parse(raw);
  if (!payload) return null;
  if (payload.expiresAt <= Date.now()) return null;
  return payload;
}
