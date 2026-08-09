import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { readAdminSession } from "../../_lib/adminSession";

const MIN_HEALTH_DIAGNOSTICS_SECRET_LENGTH = 32;
const MAX_HEALTH_DIAGNOSTICS_SECRET_LENGTH = 256;
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;

function normalizeHealthDiagnosticsSecret(value: string | null | undefined) {
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

export async function isAuthorizedHealthDiagnosticsRequest(
  request: NextRequest,
  headerName = "x-health-diagnostics-secret",
) {
  if (await readAdminSession(request)) return true;

  const secret = normalizeHealthDiagnosticsSecret(process.env.HEALTH_DIAGNOSTICS_SECRET);
  if (!secret) return false;

  const provided = normalizeHealthDiagnosticsSecret(request.headers.get(headerName));
  if (!provided) return false;

  const secretBuf = Buffer.from(secret, "utf8");
  const providedBuf = Buffer.from(provided, "utf8");
  return (
    providedBuf.length === secretBuf.length &&
    timingSafeEqual(providedBuf, secretBuf)
  );
}
