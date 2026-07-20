const REDACTED = "<redacted>";
const MAX_DEPTH = 8;
const SENSITIVE_KEY = /(?:authorization|cookie|set-cookie|token|secret|password|passphrase|mnemonic|private[-_]?key|seed|dsn|rpc(?:url)?|provider|wallet|address|account)/i;
const BEARER_VALUE = /\bBearer\s+[^\s,;]+/gi;
const HEX_IDENTIFIER = /\b0x(?:[a-fA-F0-9]{64}|[a-fA-F0-9]{40})\b/g;
const ADDRESS_IDENTIFIER = /\b0x[a-fA-F0-9]{40}\b/g;
const BARE_HEX_SECRET = /(^|[^a-fA-F0-9])([a-fA-F0-9]{64})(?![a-fA-F0-9])/g;
const ASSIGNED_SECRET = /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|secret|password|private[_-]?key)\s*[:=]\s*["']?[^\s,;"']+/gi;
const JWT_VALUE = /\beyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g;
const HTTP_URL = /https?:\/\/[^\s"'<>)}\]]+/gi;
const TRANSACTION_HASH_KEY = /^(?:txHash|transactionHash)$/i;

function sanitizeString(value: string, preserveTransactionHash = false) {
  const sanitized = value
    .replace(BEARER_VALUE, REDACTED)
    .replace(ASSIGNED_SECRET, REDACTED)
    .replace(JWT_VALUE, REDACTED)
    .replace(preserveTransactionHash ? ADDRESS_IDENTIFIER : HEX_IDENTIFIER, REDACTED)
    .replace(HTTP_URL, REDACTED);
  return sanitized.replace(BARE_HEX_SECRET, (match, prefix: string, _secret: string, offset: number, input: string) => {
    if ((prefix === "x" || prefix === "X") && offset > 0 && input[offset - 1] === "0") return match;
    return `${prefix}${REDACTED}`;
  });
}

function sanitizeValue(value: unknown, key: string, seen: WeakSet<object>, depth: number, preserveTransactionHashes = false): unknown {
  if (SENSITIVE_KEY.test(key)) return REDACTED;
  if (typeof value === "string") return sanitizeString(value, preserveTransactionHashes && TRANSACTION_HASH_KEY.test(key));
  if (value === null || typeof value !== "object") return value;
  if (depth >= MAX_DEPTH) return "<truncated>";
  if (seen.has(value)) return "<circular>";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry, "", seen, depth + 1, preserveTransactionHashes));
  }

  return Object.fromEntries(
    Object.entries(value).map(([entryKey, entryValue]) => [
      entryKey,
      sanitizeValue(entryValue, entryKey, seen, depth + 1, preserveTransactionHashes),
    ]),
  );
}

export function sanitizeSentryPayload<T>(payload: T): T {
  return sanitizeValue(payload, "", new WeakSet(), 0, false) as T;
}

export function sanitizeSupportLogPayload<T>(payload: T): T {
  return sanitizeValue(payload, "", new WeakSet(), 0, true) as T;
}
