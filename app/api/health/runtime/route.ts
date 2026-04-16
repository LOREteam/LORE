import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedHealthDiagnosticsRequest } from "../_lib/diagnosticsAuth";
import { getRuntimeMetricsSnapshot } from "../../_lib/runtimeMetrics";
import { enforceSharedRateLimit } from "../../_lib/sharedRateLimit";

export async function GET(request: NextRequest) {
  const rateLimited = await enforceSharedRateLimit(request, {
    bucket: "api-health-runtime",
    limit: 30,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  const authorized = isAuthorizedHealthDiagnosticsRequest(request);

  return NextResponse.json({
    status: "ok",
    visibility: authorized ? "private" : "public",
    redacted: !authorized,
    ts: Date.now(),
    metrics: authorized ? getRuntimeMetricsSnapshot() : {},
  }, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}
