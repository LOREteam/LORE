import type { NextRequest } from "next/server";

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
  if (isLoopbackValue(requestUrl.hostname)) return true;
  if (isLoopbackValue(request.headers.get("x-forwarded-for"))) return true;
  if (isLoopbackValue(request.headers.get("x-real-ip"))) return true;

  const secret = process.env.HEALTH_DIAGNOSTICS_SECRET?.trim();
  if (!secret) return false;

  const provided = request.headers.get(headerName)?.trim();
  return Boolean(provided && provided === secret);
}
