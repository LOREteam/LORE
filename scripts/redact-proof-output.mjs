const ASSIGNMENT_PATTERN =
  /\b([A-Z0-9_]*(?:PRIVATE_KEY|MNEMONIC|SECRET|PASSWORD|PASSPHRASE|API_KEY|AUTH_TOKEN|ACCESS_TOKEN|REFRESH_TOKEN|BEARER_TOKEN|RPC_URL|DATABASE_URL|WEBHOOK_URL|SENTRY_DSN)[A-Z0-9_]*)\s*=\s*("[^"]*"|'[^']*'|[^\s]+)/gi;

const ARG_PATTERN =
  /(--[a-z0-9-]*(?:private-key|mnemonic|secret|password|passphrase|api-key|auth-token|access-token|refresh-token|bearer-token|rpc-url|database-url|webhook-url|dsn)[a-z0-9-]*=)("[^"]*"|'[^']*'|[^\s]+)/gi;

const ARG_VALUE_PATTERN =
  /(--[a-z0-9-]*(?:private-key|mnemonic|secret|password|passphrase|api-key|auth-token|access-token|refresh-token|bearer-token|rpc-url|database-url|webhook-url|dsn)[a-z0-9-]*)(\s+)("[^"]*"|'[^']*'|(?!--)[^\s]+)/gi;

const QUERY_SECRET_PATTERN =
  /([?&](?:key|token|secret|password|passphrase|api_key|apikey|access_token|auth)=)([^&#\s]+)/gi;

const URL_CREDENTIAL_PATTERN =
  /\b([a-z][a-z0-9+.-]*:\/\/)([^\/\s:@]+):([^@\s\/]+)@/gi;

const JWT_PATTERN = /\beyJ[a-zA-Z0-9_-]*\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g;

const LONG_HEX_PATTERN = /\b0x[a-fA-F0-9]{80,}\b/g;

const ADDRESS_OR_TX_PATTERN = /\b0x(?:[a-fA-F0-9]{64}|[a-fA-F0-9]{40})\b/g;

const BARE_HEX_SECRET_PATTERN = /(^|[^a-fA-F0-9])([a-fA-F0-9]{64})(?![a-fA-F0-9])/g;

const RPC_LIKE_URL_PATTERN =
  /\b(?:https?|wss?):\/\/[^\s"'<>)}\]]*(?:rpc|alchemy|infura|quicknode|drpc|ankr)[^\s"'<>)}\]]*/gi;

export function redactProofText(value) {
  if (!value) return "";
  return String(value)
    .replace(ASSIGNMENT_PATTERN, "$1=<redacted>")
    .replace(ARG_PATTERN, "$1<redacted>")
    .replace(ARG_VALUE_PATTERN, "$1$2<redacted>")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1<redacted>")
    .replace(JWT_PATTERN, "<redacted>")
    .replace(LONG_HEX_PATTERN, "<redacted-hex>")
    .replace(ADDRESS_OR_TX_PATTERN, "<redacted-hex>")
    .replace(BARE_HEX_SECRET_PATTERN, "$1<redacted>")
    .replace(QUERY_SECRET_PATTERN, "$1<redacted>")
    .replace(RPC_LIKE_URL_PATTERN, "<redacted-url>")
    .replace(URL_CREDENTIAL_PATTERN, "$1<redacted>:<redacted>@");
}

export function redactCommandPart(value) {
  return redactProofText(value);
}
