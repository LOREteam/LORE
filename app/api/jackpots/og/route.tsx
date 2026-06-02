import { ImageResponse } from "next/og";
import { type NextRequest } from "next/server";
import { getJackpotVisualTheme, type JackpotVisualKind } from "../../../lib/jackpotVisualTheme";

/* eslint-disable @next/next/no-img-element -- next/og ImageResponse renders raw img assets. */

export const runtime = "edge";

const SIZE = { width: 1200, height: 630 };

function resolveKind(raw: string | null): JackpotVisualKind {
  if (raw === "weekly") return "weekly";
  if (raw === "dual") return "dual";
  return "daily";
}

function sanitizeAmount(raw: string | null) {
  const value = raw?.trim();
  if (!value) return null;
  if (value.length > 24) return null;
  if (!/^[0-9][0-9,. ]*$/.test(value)) return null;
  return value;
}

function sanitizePositiveInt(raw: string | null, max: number) {
  const value = raw?.trim();
  if (!value || !/^[0-9]{1,10}$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > max) return null;
  return String(parsed);
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const kind = resolveKind(searchParams.get("kind"));
  const amount = sanitizeAmount(searchParams.get("amount"));
  const tile = sanitizePositiveInt(searchParams.get("tile"), 25);
  const epoch = sanitizePositiveInt(searchParams.get("epoch"), 1_000_000_000);
  const theme = getJackpotVisualTheme(kind);
  const artUrl = new URL(theme.ogArt, request.url).toString();
  const rewardDisplay = amount ? amount : "REWARD";
  const rewardUnit = amount ? "LINEA" : "CONFIRMED";

  return new ImageResponse(
    (
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
                fontSize: kind === "weekly" ? "70px" : "76px",
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
                letterSpacing: "-3px",
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
            {tile && (
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
                  TILE
                </span>
                <span
                  style={{
                    color: theme.colors.title,
                    fontSize: "23px",
                    fontWeight: 950,
                  }}
                >
                  #{tile}
                </span>
              </div>
            )}
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
    ),
    { ...SIZE },
  );
}
