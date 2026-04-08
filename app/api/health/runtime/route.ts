import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedHealthDiagnosticsRequest } from "../_lib/diagnosticsAuth";
import { getRuntimeMetricsSnapshot } from "../../_lib/runtimeMetrics";

export async function GET(request: NextRequest) {
  const authorized = isAuthorizedHealthDiagnosticsRequest(request);

  return NextResponse.json({
    status: "ok",
    visibility: authorized ? "private" : "public",
    redacted: !authorized,
    ts: Date.now(),
    metrics: authorized ? getRuntimeMetricsSnapshot() : {},
  });
}
