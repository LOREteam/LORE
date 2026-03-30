import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { CHAT_AUTH_SESSION_TTL_MS } from "../../lib/chatAuth";

const COOKIE_NAME = "lore_chat_session";
let missingSecretWarningShown = false;

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
    console.warn("[chat-session] Using a deterministic development fallback secret. Set CHAT_AUTH_SECRET to match production behavior.");
  }

  return createHash("sha256")
    .update(`dev-chat-session:${process.cwd()}`)
    .digest("hex");
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

function parse(raw: string): SessionPayload | null {
  const [encoded, signature] = raw.split(".", 2);
  if (!encoded || !signature) return null;
  const expected = sign(encoded);
  if (!safeEqual(signature, expected)) return null;

  try {
    const parsed = JSON.parse(fromBase64Url(encoded)) as Partial<SessionPayload>;
    if (!parsed.address || typeof parsed.address !== "string") return null;
    if (!parsed.expiresAt || typeof parsed.expiresAt !== "number") return null;
    return {
      address: parsed.address.toLowerCase(),
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

export function issueChatSession(response: NextResponse, address: string) {
  const expiresAt = Date.now() + CHAT_AUTH_SESSION_TTL_MS;
  const token = serialize({ address: address.toLowerCase(), expiresAt });
  response.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/chat",
    expires: new Date(expiresAt),
  });
  return expiresAt;
}

export function clearChatSession(response: NextResponse) {
  response.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/chat",
    expires: new Date(0),
  });
}

export function readChatSession(request: NextRequest): SessionPayload | null {
  const raw = request.cookies.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  const payload = parse(raw);
  if (!payload) return null;
  if (payload.expiresAt <= Date.now()) return null;
  return payload;
}
