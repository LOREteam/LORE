import { NextRequest, NextResponse } from "next/server";
import {
  getConfiguredEip7702Enabled,
  getConfiguredEip7702MiningEnabled,
  getConfiguredReadOnlyMode,
} from "../../../../config/publicConfig";
import { APP_CHAIN_ID, APP_CHAIN_NAME } from "../../../lib/constants";
import { isAuthorizedHealthDiagnosticsRequest } from "../_lib/diagnosticsAuth";
import { getRuntimeMetricsSnapshot, getRuntimeProcessSnapshot } from "../../_lib/runtimeMetrics";
import { enforceSharedRateLimit } from "../../_lib/sharedRateLimit";

export async function GET(request: NextRequest) {
  const rateLimited = await enforceSharedRateLimit(request, {
    bucket: "api-health-runtime",
    limit: 30,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  const authorized = isAuthorizedHealthDiagnosticsRequest(request);
  const privyAppIdConfigured = Boolean(process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim());
  const publicConfig = {
    chainId: APP_CHAIN_ID,
    chainName: APP_CHAIN_NAME,
    privyAppIdConfigured,
    privyFallbackActive: !privyAppIdConfigured && APP_CHAIN_ID !== 59144,
    eip7702Enabled: getConfiguredEip7702Enabled(),
    eip7702MiningEnabled: getConfiguredEip7702MiningEnabled(),
    readOnlyMode: getConfiguredReadOnlyMode(),
  };

  return NextResponse.json({
    status: "ok",
    visibility: authorized ? "private" : "public",
    redacted: !authorized,
    ts: Date.now(),
    publicConfig,
    metrics: authorized ? getRuntimeMetricsSnapshot() : {},
    process: authorized ? getRuntimeProcessSnapshot() : undefined,
  }, {
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
      Pragma: "no-cache",
      Expires: "0",
    },
  });
}
