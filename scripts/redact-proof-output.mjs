const ASSIGNMENT_PATTERN =
  /\b([A-Z0-9_]*(?:PRIVATE_KEY|MNEMONIC|SECRET|API_KEY|AUTH_TOKEN|ACCESS_TOKEN|REFRESH_TOKEN|BEARER_TOKEN|RPC_URL|DATABASE_URL|WEBHOOK_URL|SENTRY_DSN)[A-Z0-9_]*)\s*=\s*("[^"]*"|'[^']*'|[^\s]+)/gi;

const ARG_PATTERN =
  /(--[a-z0-9-]*(?:private-key|mnemonic|secret|api-key|auth-token|access-token|refresh-token|bearer-token|rpc-url|database-url|webhook-url|dsn)[a-z0-9-]*=)("[^"]*"|'[^']*'|[^\s]+)/gi;

const QUERY_SECRET_PATTERN =
  /([?&](?:key|token|secret|api_key|apikey|access_token|auth)=)([^&#\s]+)/gi;

export function redactProofText(value) {
  if (!value) return "";
  return String(value)
    .replace(ASSIGNMENT_PATTERN, "$1=<redacted>")
    .replace(ARG_PATTERN, "$1<redacted>")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1<redacted>")
    .replace(QUERY_SECRET_PATTERN, "$1<redacted>");
}

export function redactCommandPart(value) {
  return redactProofText(value);
}
