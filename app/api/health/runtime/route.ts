import { NextRequest, NextResponse } from "next/server";
import { getConfiguredReadOnlyMode } from "../../../../config/publicConfig";
import {
  APP_CHAIN_ID,
  APP_CHAIN_NAME,
  CONTRACT_REQUIRES_EPOCH_BOUND_BETS,
} from "../../../lib/constants";
import {
  buildRuntimeHealthPublicConfig,
  isAuthorizedHealthDiagnosticsRequest,
} from "../_lib/diagnosticsAuth";
import { hasPublicExternalRateLimitStore } from "../../_lib/externalRateLimit";
import { applyNoStoreHeaders } from "../../_lib/responseHeaders";
import { getRuntimeMetricsSnapshot, getRuntimeProcessSnapshot } from "../../_lib/runtimeMetrics";
import { enforceSharedRateLimit } from "../../_lib/sharedRateLimit";

export async function GET(request: NextRequest) {
  const rateLimited = await enforceSharedRateLimit(request, {
    bucket: "api-health-runtime",
    limit: 30,
    windowMs: 60_000,
  });
  if (rateLimited) return applyNoStoreHeaders(rateLimited);

  const authorized = await isAuthorizedHealthDiagnosticsRequest(request);
  const publicConfig = buildRuntimeHealthPublicConfig({
    env: process.env,
    chainId: APP_CHAIN_ID,
    chainName: APP_CHAIN_NAME,
    contractRequiresEpochBoundBets: CONTRACT_REQUIRES_EPOCH_BOUND_BETS,
    readOnlyMode: getConfiguredReadOnlyMode(),
    externalRateLimitConfigured: hasPublicExternalRateLimitStore(),
  });

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
