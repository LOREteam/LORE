import { getAddress, type Address } from "viem";

export const CHAT_AUTH_HEADER = "LORE Chat Verification";
export const CHAT_AUTH_PROOF_TTL_MS = 5 * 60 * 1000;
export const CHAT_AUTH_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export type ChatAuthMessageFields = {
  address: string;
  uri: string;
  chainId: number;
  nonce: string;
  issuedAt: string;
};

function normalizeLineBreaks(value: string) {
  return value.replace(/\r\n/g, "\n").trim();
}

export function normalizeChatAuthAddress(value: unknown): Address | "" {
  if (typeof value !== "string") return "";
  try {
    return getAddress(value.trim()).toLowerCase() as Address;
  } catch {
    return "";
  }
}

export function createChatAuthNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseCanonicalIssuedAtMs(issuedAt: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(issuedAt)) return null;
  const issuedAtMs = Date.parse(issuedAt);
  if (!Number.isSafeInteger(issuedAtMs)) return null;
  return new Date(issuedAtMs).toISOString() === issuedAt ? issuedAtMs : null;
}

function parseCanonicalChainId(value: string | undefined): number | null {
  if (!value || !/^[1-9]\d{0,15}$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function parseCanonicalNonce(value: string | undefined): string | null {
  if (!value || !/^[a-f0-9]{32,128}$/.test(value)) return null;
  return value;
}

export function buildChatAuthMessage(fields: ChatAuthMessageFields) {
  return [
    CHAT_AUTH_HEADER,
    `Address: ${fields.address.toLowerCase()}`,
    `URI: ${fields.uri}`,
    `Chain ID: ${fields.chainId}`,
    `Nonce: ${fields.nonce}`,
    `Issued At: ${fields.issuedAt}`,
    "Purpose: Verify wallet ownership for chat actions.",
    "This signature does not trigger any blockchain transaction.",
  ].join("\n");
}

export function parseChatAuthMessage(message: string): ChatAuthMessageFields | null {
  const normalized = normalizeLineBreaks(message);
  const lines = normalized.split("\n");
  if (lines[0] !== CHAT_AUTH_HEADER) return null;

  const values = new Map<string, string>();
  for (const line of lines.slice(1)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    values.set(key, value);
  }

  const address = normalizeChatAuthAddress(values.get("address"));
  const uri = values.get("uri") ?? "";
  const nonce = parseCanonicalNonce(values.get("nonce"));
  const issuedAt = values.get("issued at") ?? "";
  const chainId = parseCanonicalChainId(values.get("chain id"));

  if (!address) return null;
  if (!/^https?:\/\/[^ ]+/i.test(uri)) return null;
  if (nonce === null) return null;
  if (chainId === null) return null;
  if (parseCanonicalIssuedAtMs(issuedAt) === null) return null;

  const fields = { address, uri, chainId, nonce, issuedAt };
  if (normalized !== buildChatAuthMessage(fields)) return null;

  return fields;
}

export function isChatAuthIssuedAtValid(
  issuedAt: string,
  now = Date.now(),
  ttlMs = CHAT_AUTH_PROOF_TTL_MS,
) {
  const issuedAtMs = parseCanonicalIssuedAtMs(issuedAt);
  if (issuedAtMs === null) return false;
  if (!Number.isSafeInteger(now)) return false;
  if (issuedAtMs > now + 60_000) return false;
  return now - issuedAtMs <= ttlMs;
}

export function getChatAuthProofTtlMs(
  issuedAt: string,
  now = Date.now(),
  ttlMs = CHAT_AUTH_PROOF_TTL_MS,
): number | null {
  const issuedAtMs = parseCanonicalIssuedAtMs(issuedAt);
  if (issuedAtMs === null) return null;
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(ttlMs) || ttlMs <= 0) return null;
  if (issuedAtMs > now + 60_000) return null;
  const remainingMs = ttlMs - (now - issuedAtMs);
  return remainingMs > 0 ? remainingMs : null;
}
