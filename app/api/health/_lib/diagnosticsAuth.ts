import type { NextRequest } from "next/server";
import { readAdminSession } from "../../_lib/adminSession";

function isLoopbackValue(value: string | null) {
  if (!value) return false;
  return value
    .split(",")
    .map((part) => part.trim())
    .some((part) => part === "127.0.0.1" || part === "::1" || part === "localhost");
}

export function isAuthorizedHealthDiagnosticsRequest(
  request: NextRequest,
  headerName = "x-health-diagnostics-secret",
) {
  const requestUrl = new URL(request.url);
  const isProduction = process.env.NODE_ENV === "production";
  if (isLoopbackValue(requestUrl.hostname)) return true;
  if (!isProduction && isLoopbackValue(request.headers.get("x-forwarded-for"))) return true;
  if (!isProduction && isLoopbackValue(request.headers.get("x-real-ip"))) return true;
  if (readAdminSession(request)) return true;

  const secret = process.env.HEALTH_DIAGNOSTICS_SECRET?.trim();
  if (!secret) return false;

  const provided = request.headers.get(headerName)?.trim();
  return Boolean(provided && provided === secret);
}
