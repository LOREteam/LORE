import type { NextRequest } from "next/server";
import { readAdminSession } from "./adminSession";

export function isAuthorizedAdminRouteRequest(
  request: NextRequest,
  headerName = "x-health-diagnostics-secret",
) {
  if (readAdminSession(request)) return true;

  const secret = process.env.HEALTH_DIAGNOSTICS_SECRET?.trim();
  if (!secret) return false;

  const provided = request.headers.get(headerName)?.trim();
  return Boolean(provided && provided === secret);
}
