export const ADMIN_AUTH_HEADER = "LORE Admin Verification";
export const ADMIN_AUTH_PROOF_TTL_MS = 5 * 60 * 1000;
export const ADMIN_AUTH_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const ADMIN_AUTH_WALLET =
  (process.env.NEXT_PUBLIC_ADMIN_WALLET_ADDRESS?.trim() || "0x3EcABA03124D8e0Ce7709638276e69F1016CA5Fa").toLowerCase();

export type AdminAuthMessageFields = {
  address: string;
  uri: string;
  chainId: number;
  nonce: string;
  issuedAt: string;
};

function normalizeLineBreaks(value: string) {
  return value.replace(/\r\n/g, "\n").trim();
}

export function createAdminAuthNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function buildAdminAuthMessage(fields: AdminAuthMessageFields) {
  return [
    ADMIN_AUTH_HEADER,
    `Address: ${fields.address.toLowerCase()}`,
    `URI: ${fields.uri}`,
    `Chain ID: ${fields.chainId}`,
    `Nonce: ${fields.nonce}`,
    `Issued At: ${fields.issuedAt}`,
    "Purpose: Verify wallet ownership for LORE admin diagnostics.",
    "This signature does not trigger any blockchain transaction.",
  ].join("\n");
}

export function parseAdminAuthMessage(message: string): AdminAuthMessageFields | null {
  const normalized = normalizeLineBreaks(message);
  const lines = normalized.split("\n");
  if (lines[0] !== ADMIN_AUTH_HEADER) return null;

  const values = new Map<string, string>();
  for (const line of lines.slice(1)) {
    const separator = line.indexOf(":");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    values.set(key, value);
  }

  const address = values.get("address")?.toLowerCase() ?? "";
  const uri = values.get("uri") ?? "";
  const nonce = values.get("nonce") ?? "";
  const issuedAt = values.get("issued at") ?? "";
  const chainId = Number(values.get("chain id") ?? NaN);

  if (!/^0x[a-f0-9]{40}$/i.test(address)) return null;
  if (!/^https?:\/\/[^ ]+/i.test(uri)) return null;
  if (!/^[a-f0-9]{32,128}$/i.test(nonce)) return null;
  if (!Number.isInteger(chainId) || chainId <= 0) return null;
  if (!issuedAt || Number.isNaN(Date.parse(issuedAt))) return null;

  return {
    address,
    uri,
    chainId,
    nonce,
    issuedAt,
  };
}

export function isAdminAuthIssuedAtValid(
  issuedAt: string,
  now = Date.now(),
  ttlMs = ADMIN_AUTH_PROOF_TTL_MS,
) {
  const issuedAtMs = Date.parse(issuedAt);
  if (Number.isNaN(issuedAtMs)) return false;
  if (issuedAtMs > now + 60_000) return false;
  return now - issuedAtMs <= ttlMs;
}
