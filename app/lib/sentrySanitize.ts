const REDACTED = "<redacted>";
const MAX_DEPTH = 8;
const SENSITIVE_KEY = /(?:authorization|cookie|set-cookie|token|secret|password|passphrase|mnemonic|private[-_]?key|seed|dsn|rpc(?:url)?|provider|wallet|address|account)/i;
const BEARER_VALUE = /\bBearer\s+[^\s,;]+/gi;
const HEX_IDENTIFIER = /\b0x(?:[a-fA-F0-9]{64}|[a-fA-F0-9]{40})\b/g;
const ADDRESS_IDENTIFIER = /\b0x[a-fA-F0-9]{40}\b/g;
const HTTP_URL = /https?:\/\/[^\s"'<>)}\]]+/gi;
const TRANSACTION_HASH_KEY = /^(?:txHash|transactionHash)$/i;

function sanitizeString(value: string, preserveTransactionHash = false) {
  return value
    .replace(BEARER_VALUE, REDACTED)
    .replace(preserveTransactionHash ? ADDRESS_IDENTIFIER : HEX_IDENTIFIER, REDACTED)
    .replace(HTTP_URL, REDACTED);
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
