import { NextRequest, NextResponse } from "next/server";
import { getConfiguredReadOnlyMode } from "../../../../config/publicConfig";
import {
  APP_CHAIN_ID,
  APP_CHAIN_NAME,
  CONTRACT_REQUIRES_EPOCH_BOUND_BETS,
} from "../../../lib/constants";
import { isAuthorizedHealthDiagnosticsRequest } from "../_lib/diagnosticsAuth";
import { hasPublicExternalRateLimitStore } from "../../_lib/externalRateLimit";
import { applyNoStoreHeaders } from "../../_lib/responseHeaders";
import { getRuntimeMetricsSnapshot, getRuntimeProcessSnapshot } from "../../_lib/runtimeMetrics";
import { enforceSharedRateLimit } from "../../_lib/sharedRateLimit";

const MAX_EMAIL_RECIPIENTS = 10;
const MAX_EMAIL_ENTRY_LENGTH = 254;
const MIN_TRUST_PROXY_SECRET_LENGTH = 32;
const MAX_TRUST_PROXY_SECRET_LENGTH = 256;
const ASCII_CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;
const POSITIVE_SAFE_INTEGER_TEXT_RE = /^[1-9]\d{0,15}$/;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

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
  const raw = (value ?? "")
    .split(",")
    .map((entry) => entry.trim());
  if (raw.length === 0 || raw.length > MAX_EMAIL_RECIPIENTS) return null;
  if (raw.some((entry) => entry.length === 0 || entry.length > MAX_EMAIL_ENTRY_LENGTH)) return null;
  return raw;
}

function isPositiveSafeIntegerText(value: string | undefined) {
  return parsePositiveSafeIntegerText(value, null) !== null;
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
    !ASCII_CONTROL_CHAR_RE.test(trimmed)
  );
}

export async function GET(request: NextRequest) {
  const rateLimited = await enforceSharedRateLimit(request, {
    bucket: "api-health-runtime",
    limit: 30,
    windowMs: 60_000,
  });
  if (rateLimited) return applyNoStoreHeaders(rateLimited);

  const authorized = await isAuthorizedHealthDiagnosticsRequest(request);
  const privyAppIdConfigured = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim());
  const productionLikeMonitoring =
    process.env.NODE_ENV === "production" ||
    APP_CHAIN_ID === 59144 ||
    process.env.LORE_PREMAINNET_RUNTIME_STRICT === "1";
  const backupMonitorConfigured = Boolean(
    process.env.RUNTIME_MONITOR_BACKUP_DIR?.trim() ||
    process.env.LORE_BACKUP_DIR?.trim(),
  );
  const backupMonitorMaxAgeConfigured = isPositiveSafeIntegerText(process.env.RUNTIME_MONITOR_BACKUP_MAX_AGE_MS);
  const emailAlertRecipients = parseEmailRecipients(process.env.RUNTIME_MONITOR_EMAIL_TO);
  const emailAlertConfigured = Boolean(
    process.env.RESEND_API_KEY?.trim() &&
    isEmailAddress(process.env.RUNTIME_MONITOR_EMAIL_FROM ?? "") &&
    emailAlertRecipients !== null &&
    emailAlertRecipients.every(isEmailAddress),
  );
  const webReplicaCount = parsePositiveSafeIntegerText(process.env.WEB_REPLICA_COUNT, 1);
  const multiReplicaWeb = webReplicaCount !== null && webReplicaCount > 1;
  const externalRateLimitConfigured = hasPublicExternalRateLimitStore();
  const trustedProxyConfigured = Boolean(
    process.env.TRUST_PROXY_HEADERS === "1" &&
    hasUsableTrustedProxySecret(process.env.TRUST_PROXY_SECRET),
  );
  const weakRateLimitIdentityAllowed = process.env.ALLOW_WEAK_RATE_LIMIT_IDENTITY === "1";
  const publicConfig = {
    chainId: APP_CHAIN_ID,
    chainName: APP_CHAIN_NAME,
    privyAppIdConfigured,
    privyFallbackActive: !privyAppIdConfigured && APP_CHAIN_ID !== 59144,
    contractRequiresEpochBoundBets: CONTRACT_REQUIRES_EPOCH_BOUND_BETS,
    readOnlyMode: getConfiguredReadOnlyMode(),
    productionLikeMonitoring,
    backupMonitorConfigured,
    backupMonitorMaxAgeConfigured,
    emailAlertConfigured,
    multiReplicaWeb,
    externalRateLimitConfigured,
    trustedProxyConfigured,
    weakRateLimitIdentityAllowed,
  };

  return applyNoStoreHeaders(NextResponse.json({
    status: "ok",
    visibility: authorized ? "private" : "public",
    redacted: !authorized,
    ts: Date.now(),
    publicConfig,
    metrics: authorized ? getRuntimeMetricsSnapshot() : {},
    process: authorized ? getRuntimeProcessSnapshot() : undefined,
  }));
}
