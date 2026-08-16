import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";

const MIN_HEALTH_DIAGNOSTICS_SECRET_LENGTH = 32;
const MAX_HEALTH_DIAGNOSTICS_SECRET_LENGTH = 256;
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;
const MAX_EMAIL_RECIPIENTS = 10;
const MAX_EMAIL_ENTRY_LENGTH = 254;
const MIN_TRUST_PROXY_SECRET_LENGTH = 32;
const MAX_TRUST_PROXY_SECRET_LENGTH = 256;
const POSITIVE_SAFE_INTEGER_TEXT_RE = /^[1-9]\d{0,15}$/;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

type RuntimeHealthEnvironment = Readonly<Record<string, string | undefined>>;

type RuntimeHealthPublicConfigOptions = {
  env: RuntimeHealthEnvironment;
  chainId: number;
  chainName: string;
  contractRequiresEpochBoundBets: boolean;
  readOnlyMode: boolean;
  externalRateLimitConfigured: boolean;
};

function extractEmailAddress(value: string) {
  const trimmed = value.trim();
  if (trimmed.length > MAX_EMAIL_ENTRY_LENGTH) return "";
  const angleMatch = trimmed.match(/<([^<>\s@]+@[^<>\s@]+)>$/);
  return angleMatch ? angleMatch[1] : trimmed;
}

function isEmailAddress(value: string) {
  const email = extractEmailAddress(value);
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email);
}

function parseEmailRecipients(value: string | undefined) {
  const raw = (value ?? "").split(",").map((entry) => entry.trim());
  if (raw.length === 0 || raw.length > MAX_EMAIL_RECIPIENTS) return null;
  if (raw.some((entry) => entry.length === 0 || entry.length > MAX_EMAIL_ENTRY_LENGTH)) return null;
  return raw;
}

function parsePositiveSafeIntegerText(value: string | undefined, fallback: number | null) {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  if (!POSITIVE_SAFE_INTEGER_TEXT_RE.test(trimmed)) return null;
  const parsed = BigInt(trimmed);
  if (parsed > MAX_SAFE_INTEGER_BIGINT) return null;
  return Number(parsed);
}

function hasUsableTrustedProxySecret(value: string | undefined) {
  const trimmed = value?.trim() ?? "";
  return (
    trimmed.length >= MIN_TRUST_PROXY_SECRET_LENGTH &&
    trimmed.length <= MAX_TRUST_PROXY_SECRET_LENGTH &&
    !CONTROL_CHAR_RE.test(trimmed)
  );
}

export function buildRuntimeHealthPublicConfig({
  env,
  chainId,
  chainName,
  contractRequiresEpochBoundBets,
  readOnlyMode,
  externalRateLimitConfigured,
}: RuntimeHealthPublicConfigOptions) {
  const privyAppIdConfigured = Boolean(env.NEXT_PUBLIC_PRIVY_APP_ID?.trim());
  const emailAlertRecipients = parseEmailRecipients(env.RUNTIME_MONITOR_EMAIL_TO);
  const webReplicaCount = parsePositiveSafeIntegerText(env.WEB_REPLICA_COUNT, 1);
  return {
    chainId,
    chainName,
    privyAppIdConfigured,
    privyFallbackActive: !privyAppIdConfigured && chainId !== 59144,
    contractRequiresEpochBoundBets,
    readOnlyMode,
    productionLikeMonitoring:
      env.NODE_ENV === "production" || chainId === 59144 || env.LORE_PREMAINNET_RUNTIME_STRICT === "1",
    backupMonitorConfigured: Boolean(env.RUNTIME_MONITOR_BACKUP_DIR?.trim() || env.LORE_BACKUP_DIR?.trim()),
    backupMonitorMaxAgeConfigured: parsePositiveSafeIntegerText(env.RUNTIME_MONITOR_BACKUP_MAX_AGE_MS, null) !== null,
    emailAlertConfigured: Boolean(
      env.RESEND_API_KEY?.trim() &&
      isEmailAddress(env.RUNTIME_MONITOR_EMAIL_FROM ?? "") &&
      emailAlertRecipients !== null &&
      emailAlertRecipients.every(isEmailAddress)
    ),
    multiReplicaWeb: webReplicaCount !== null && webReplicaCount > 1,
    externalRateLimitConfigured,
    trustedProxyConfigured: Boolean(
      env.TRUST_PROXY_HEADERS === "1" && hasUsableTrustedProxySecret(env.TRUST_PROXY_SECRET)
    ),
    weakRateLimitIdentityAllowed: env.ALLOW_WEAK_RATE_LIMIT_IDENTITY === "1",
  };
}

export function normalizeHealthDiagnosticsSecret(value: string | null | undefined) {
  const secret = value?.trim();
  if (!secret) return null;
  if (
    secret.length < MIN_HEALTH_DIAGNOSTICS_SECRET_LENGTH ||
    secret.length > MAX_HEALTH_DIAGNOSTICS_SECRET_LENGTH ||
    CONTROL_CHAR_RE.test(secret)
  ) {
    return null;
  }
  return secret;
}

export function matchesHealthDiagnosticsSecret(
  configured: string | null | undefined,
  provided: string | null | undefined,
) {
  const secret = normalizeHealthDiagnosticsSecret(configured);
  const candidate = normalizeHealthDiagnosticsSecret(provided);
  if (!secret || !candidate) return false;
  const secretBuf = Buffer.from(secret, "utf8");
  const candidateBuf = Buffer.from(candidate, "utf8");
  return candidateBuf.length === secretBuf.length && timingSafeEqual(candidateBuf, secretBuf);
}

export async function isAuthorizedHealthDiagnosticsRequest(
  request: NextRequest,
  headerName = "x-health-diagnostics-secret",
) {
  const { readAdminSession } = await import("../../_lib/adminSession");
  if (await readAdminSession(request)) return true;
  return matchesHealthDiagnosticsSecret(
    process.env.HEALTH_DIAGNOSTICS_SECRET,
    request.headers.get(headerName),
  );
}
