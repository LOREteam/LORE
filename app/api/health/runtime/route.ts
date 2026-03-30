import { NextResponse } from "next/server";
import { getRuntimeMetricsSnapshot } from "../../_lib/runtimeMetrics";

export async function GET() {
  return NextResponse.json({
    status: "ok",
    ts: Date.now(),
    metrics: getRuntimeMetricsSnapshot(),
  });
}
