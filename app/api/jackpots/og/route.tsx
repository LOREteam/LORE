import { ImageResponse } from "next/og";
import { type NextRequest, NextResponse } from "next/server";
import {
  acquireResponseConcurrencySlot,
  releaseResponseConcurrencySlotOnSettled,
} from "../../_lib/responseConcurrencyBudget";
import { applyNoStoreHeaders } from "../../_lib/responseHeaders";
import { enforceSharedRateLimit } from "../../_lib/sharedRateLimit";
import { getTrustedAuthOrigin } from "../../_lib/trustedAuthOrigin";
import { getJackpotVisualTheme } from "../../../lib/jackpotVisualTheme";
import { readVerifiedJackpotShare } from "../../_lib/jackpotShare";

/* eslint-disable @next/next/no-img-element -- next/og ImageResponse renders raw img assets. */

export const runtime = "nodejs";

const SIZE = { width: 1200, height: 630 };
const CANONICAL_SITE_ORIGIN = "https://playlore.xyz";
const OG_RENDER_BUDGET_KEY = "api-jackpots-og-render";
const MAX_CONCURRENT_OG_RENDERS = 2;
const OG_IMAGE_CACHE_CONTROL = "public, max-age=0, must-revalidate";

async function enforceOgRateLimit(request: NextRequest) {
  return await enforceSharedRateLimit(request, {
    bucket: "api-jackpots-og",
    limit: 20,
    windowMs: 60_000,
  });
}

function renderBudgetExceededResponse() {
  return applyNoStoreHeaders(NextResponse.json(
    { error: "OpenGraph render capacity is busy", retryAfter: 1 },
    { status: 503, headers: { "Retry-After": "1" } },
  ));
}

export async function GET(request: NextRequest) {
  const rateLimited = await enforceOgRateLimit(request);
  if (rateLimited) return applyNoStoreHeaders(rateLimited);

  const share = await readVerifiedJackpotShare(
    request.nextUrl.searchParams.get("event") ?? request.nextUrl.searchParams.get("tx"),
  );
  if (!share) {
    return applyNoStoreHeaders(NextResponse.json({ error: "Verified jackpot event not found" }, { status: 404 }));
  }
  const { amount, epoch } = share;
  const theme = getJackpotVisualTheme(share.kind);
  const artOrigin = getTrustedAuthOrigin(request.url) ?? CANONICAL_SITE_ORIGIN;
  const artUrl = new URL(theme.ogArt, artOrigin).toString();
  const rewardDisplay = amount ? amount : "REWARD";
  const rewardUnit = amount ? "LINEA" : "CONFIRMED";

  const image = (
    <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          overflow: "hidden",
          background: "#08050f",
          fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
        }}
      >
        <img
          src={artUrl}
          alt=""
          width="1200"
          height="630"
          style={{
            position: "absolute",
            inset: "-26px",
            width: "1252px",
            height: "682px",
            objectFit: "cover",
          }}
        />

        <div
          style={{
            position: "absolute",
            inset: "0",
            background:
              "linear-gradient(180deg, rgba(0,0,0,0.62) 0%, rgba(0,0,0,0.18) 36%, rgba(0,0,0,0.18) 64%, rgba(0,0,0,0.72) 100%)",
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            left: "120px",
            right: "120px",
            top: "78px",
            height: "305px",
            borderRadius: "999px",
            background:
              "radial-gradient(ellipse at center, rgba(0,0,0,0.62) 0%, rgba(0,0,0,0.36) 42%, rgba(0,0,0,0) 72%)",
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            inset: "0",
            background:
              "radial-gradient(circle at 50% 50%, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0) 30%), radial-gradient(circle at 50% 50%, transparent 0%, transparent 54%, rgba(0,0,0,0.46) 100%)",
            display: "flex",
          }}
        />

        <div
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "1080px",
              marginTop: "76px",
              textAlign: "center",
            }}
          >
            <span
              style={{
                color: theme.colors.title,
                fontFamily: 'Georgia, "Times New Roman", serif',
                fontSize: share.kind === "weekly" ? "70px" : "76px",
                fontWeight: 950,
                letterSpacing: "1px",
                lineHeight: "0.94",
                textShadow: `0 0 18px ${theme.colors.shadow}, 0 9px 34px rgba(0,0,0,0.9)`,
              }}
            >
              {theme.winTitle.toUpperCase()}
            </span>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "center",
              gap: "20px",
              marginTop: "66px",
            }}
          >
            <span
              style={{
                color: theme.colors.amount,
                fontSize: amount ? "128px" : "84px",
                fontWeight: 950,
                letterSpacing: "0px",
                lineHeight: "0.82",
                textShadow: `0 0 18px ${theme.colors.shadow}, 0 0 42px ${theme.colors.shadow}, 0 10px 36px rgba(0,0,0,0.95), 3px 3px 0 rgba(0,0,0,0.42), -3px 3px 0 rgba(0,0,0,0.42), 3px -3px 0 rgba(0,0,0,0.42), -3px -3px 0 rgba(0,0,0,0.42)`,
              }}
            >
              {rewardDisplay}
            </span>
            <span
              style={{
                color: theme.colors.accentSoft,
                fontSize: "38px",
                fontWeight: 900,
                letterSpacing: "5px",
                textShadow: `0 0 18px ${theme.colors.shadow}, 0 6px 22px rgba(0,0,0,0.95), 2px 2px 0 rgba(0,0,0,0.5), -2px 2px 0 rgba(0,0,0,0.5), 2px -2px 0 rgba(0,0,0,0.5), -2px -2px 0 rgba(0,0,0,0.5)`,
              }}
            >
              {rewardUnit}
            </span>
          </div>

          <div
            style={{
              display: "flex",
              gap: "18px",
              marginTop: "28px",
            }}
          >
            {epoch && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  padding: "11px 19px",
                  borderRadius: "999px",
                  border: `1px solid ${theme.colors.chipBorder}`,
                  background: theme.colors.chipBg,
                  boxShadow: "0 10px 26px rgba(0,0,0,0.28)",
                }}
              >
                <span
                  style={{
                    color: "rgba(255,255,255,0.66)",
                    fontSize: "15px",
                    fontWeight: 850,
                    letterSpacing: "3px",
                  }}
                >
                  EPOCH
                </span>
                <span
                  style={{
                    color: theme.colors.title,
                    fontSize: "23px",
                    fontWeight: 950,
                  }}
                >
                  #{epoch}
                </span>
              </div>
            )}
          </div>

          <div
            style={{
              position: "absolute",
              bottom: "34px",
              left: "58px",
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-start",
              gap: "14px",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
              <span
                style={{
                  color: theme.colors.title,
                  fontSize: "30px",
                  fontWeight: 950,
                  letterSpacing: "7px",
                  textShadow: `0 0 18px ${theme.colors.shadow}, 0 7px 24px rgba(0,0,0,1), 2px 2px 0 rgba(0,0,0,0.65), -2px 2px 0 rgba(0,0,0,0.65), 2px -2px 0 rgba(0,0,0,0.65), -2px -2px 0 rgba(0,0,0,0.65)`,
                }}
              >
                LORE
              </span>
            </div>
          </div>
        </div>
      </div>
  );

  const releaseRenderSlot = acquireResponseConcurrencySlot(
    OG_RENDER_BUDGET_KEY,
    MAX_CONCURRENT_OG_RENDERS,
  );
  if (!releaseRenderSlot) return renderBudgetExceededResponse();

  try {
    const imageResponse = new ImageResponse(image, { ...SIZE });
    return releaseResponseConcurrencySlotOnSettled(imageResponse, releaseRenderSlot);
  } catch (error) {
    releaseRenderSlot();
    throw error;
  }
}

export async function HEAD(request: NextRequest) {
  const rateLimited = await enforceOgRateLimit(request);
  if (rateLimited) return applyNoStoreHeaders(rateLimited);

  const share = await readVerifiedJackpotShare(
    request.nextUrl.searchParams.get("event") ?? request.nextUrl.searchParams.get("tx"),
  );
  if (!share) {
    return applyNoStoreHeaders(NextResponse.json({ error: "Verified jackpot event not found" }, { status: 404 }));
  }

  return new Response(null, {
    status: 200,
    headers: {
      "Cache-Control": OG_IMAGE_CACHE_CONTROL,
      "Content-Type": "image/png",
    },
  });
}
