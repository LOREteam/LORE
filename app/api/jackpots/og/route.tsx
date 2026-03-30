import { ImageResponse } from "next/og";
import { type NextRequest } from "next/server";

export const runtime = "edge";

const SIZE = { width: 1200, height: 630 };

const DAILY = {
  bg1: "#1a1208",
  bg2: "#2d1f06",
  bg3: "#1a1208",
  accent: "#fbbf24",
  accentDim: "#92700a",
  glow: "rgba(251,191,36,0.35)",
  glowWide: "rgba(251,191,36,0.12)",
  textMain: "#fff7e0",
  textSub: "#fde68a",
  textDim: "rgba(253,230,138,0.6)",
  ring: "rgba(251,191,36,0.18)",
  ringInner: "rgba(251,191,36,0.08)",
  sparkle: "#ffe066",
  coinFrom: "#fff6ba",
  coinVia: "#ffcb4e",
  coinTo: "#d97b15",
  badgeBg: "rgba(251,191,36,0.12)",
  badgeBorder: "rgba(251,191,36,0.3)",
  divider: "rgba(251,191,36,0.2)",
  label: "DAILY JACKPOT",
};

const WEEKLY = {
  bg1: "#0c0618",
  bg2: "#1a0f36",
  bg3: "#0c0618",
  accent: "#a78bfa",
  accentDim: "#5b3fa0",
  glow: "rgba(139,92,246,0.35)",
  glowWide: "rgba(139,92,246,0.12)",
  textMain: "#f0eaff",
  textSub: "#c4b5fd",
  textDim: "rgba(196,181,253,0.6)",
  ring: "rgba(139,92,246,0.18)",
  ringInner: "rgba(139,92,246,0.08)",
  sparkle: "#d8b4fe",
  coinFrom: "#e9d5ff",
  coinVia: "#a78bfa",
  coinTo: "#6d28d9",
  badgeBg: "rgba(139,92,246,0.12)",
  badgeBorder: "rgba(139,92,246,0.3)",
  divider: "rgba(139,92,246,0.2)",
  label: "WEEKLY JACKPOT",
};

const DUAL = {
  bg1: "#120916",
  bg2: "#291538",
  bg3: "#140b1a",
  accent: "#fbbf24",
  accentDim: "#8b5cf6",
  glow: "rgba(192,132,252,0.34)",
  glowWide: "rgba(251,191,36,0.12)",
  textMain: "#fff7f0",
  textSub: "#f5d0fe",
  textDim: "rgba(245,208,254,0.62)",
  ring: "rgba(192,132,252,0.18)",
  ringInner: "rgba(251,191,36,0.1)",
  sparkle: "#fde68a",
  coinFrom: "#fff6ba",
  coinVia: "#f0abfc",
  coinTo: "#8b5cf6",
  badgeBg: "rgba(251,191,36,0.1)",
  badgeBorder: "rgba(192,132,252,0.32)",
  divider: "rgba(245,208,254,0.2)",
  label: "DOUBLE JACKPOT",
};

function resolveKind(raw: string | null): "daily" | "weekly" | "dual" {
  if (raw === "weekly") return "weekly";
  if (raw === "dual") return "dual";
  return "daily";
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const kind = resolveKind(searchParams.get("kind"));
  const amount = searchParams.get("amount") || "0.00";
  const tile = searchParams.get("tile") || null;
  const epoch = searchParams.get("epoch") || null;
  const winner = searchParams.get("winner") || null;

  const p = kind === "daily" ? DAILY : kind === "weekly" ? WEEKLY : DUAL;

  const sparkles = [
    { x: 90, y: 80, s: 22, o: 0.8 },
    { x: 1080, y: 100, s: 18, o: 0.7 },
    { x: 160, y: 520, s: 14, o: 0.6 },
    { x: 1040, y: 490, s: 20, o: 0.75 },
    { x: 300, y: 140, s: 10, o: 0.5 },
    { x: 900, y: 160, s: 12, o: 0.55 },
    { x: 200, y: 380, s: 16, o: 0.65 },
    { x: 1000, y: 350, s: 14, o: 0.6 },
    { x: 500, y: 580, s: 11, o: 0.45 },
    { x: 700, y: 570, s: 13, o: 0.5 },
  ];

  const coins = [
    { x: 65, y: 220, s: 38, r: -15 },
    { x: 1095, y: 250, s: 34, r: 20 },
    { x: 120, y: 430, s: 28, r: 10 },
    { x: 1050, y: 420, s: 30, r: -25 },
    { x: 50, y: 350, s: 22, r: 35 },
    { x: 1130, y: 370, s: 24, r: -10 },
  ];

  const shortAddr = winner ? `${winner.slice(0, 6)}...${winner.slice(-4)}` : null;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: `linear-gradient(165deg, ${p.bg1} 0%, ${p.bg2} 48%, ${p.bg3} 100%)`,
          fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif',
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "-200px",
            left: "50%",
            transform: "translateX(-50%)",
            width: "1000px",
            height: "1000px",
            borderRadius: "50%",
            border: `2px solid ${p.ring}`,
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: "-140px",
            left: "50%",
            transform: "translateX(-50%)",
            width: "880px",
            height: "880px",
            borderRadius: "50%",
            border: `1px solid ${p.ringInner}`,
            display: "flex",
          }}
        />

        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: "700px",
            height: "500px",
            borderRadius: "50%",
            background: `radial-gradient(circle, ${p.glow} 0%, ${p.glowWide} 40%, transparent 70%)`,
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: "0",
            left: "50%",
            transform: "translateX(-50%)",
            width: "600px",
            height: "200px",
            background: `radial-gradient(ellipse at center top, ${p.glowWide}, transparent 80%)`,
            display: "flex",
          }}
        />

        {sparkles.map((sp, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${sp.x}px`,
              top: `${sp.y}px`,
              width: `${sp.s}px`,
              height: `${sp.s}px`,
              opacity: sp.o,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                width: `${sp.s}px`,
                height: `${sp.s}px`,
                background: p.sparkle,
                clipPath:
                  "polygon(50% 0%, 62% 38%, 100% 50%, 62% 62%, 50% 100%, 38% 62%, 0% 50%, 38% 38%)",
                filter: `drop-shadow(0 0 ${sp.s / 2}px ${p.sparkle})`,
                display: "flex",
              }}
            />
          </div>
        ))}

        {coins.map((c, i) => (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${c.x}px`,
              top: `${c.y}px`,
              width: `${c.s}px`,
              height: `${c.s}px`,
              borderRadius: "50%",
              background: `linear-gradient(135deg, ${p.coinFrom}, ${p.coinVia} 50%, ${p.coinTo})`,
              border: `1px solid ${p.ring}`,
              transform: `rotate(${c.r}deg)`,
              opacity: 0.7,
              boxShadow: `0 0 ${c.s}px ${p.glowWide}`,
              display: "flex",
            }}
          />
        ))}

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 10,
            gap: "0px",
            position: "relative",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "8px 28px",
              borderRadius: "40px",
              background: p.badgeBg,
              border: `1.5px solid ${p.badgeBorder}`,
              marginBottom: "16px",
            }}
          >
            <span
              style={{
                fontSize: "18px",
                fontWeight: 800,
                color: p.textSub,
                letterSpacing: "5px",
                textTransform: "uppercase",
              }}
            >
              {p.label}
            </span>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "0px",
            }}
          >
            <span
              style={{
                fontSize: "28px",
                fontWeight: 600,
                color: p.textDim,
                letterSpacing: "8px",
                textTransform: "uppercase",
                marginBottom: "-4px",
              }}
            >
              JACKPOT
            </span>
            <span
              style={{
                fontSize: "96px",
                fontWeight: 900,
                letterSpacing: "-1px",
                lineHeight: "1",
                background: `linear-gradient(180deg, ${p.textMain} 0%, ${p.accent} 50%, ${p.accentDim} 100%)`,
                backgroundClip: "text",
                color: "transparent",
                textShadow: "none",
                filter: `drop-shadow(0 4px 20px ${p.glow})`,
              }}
            >
              WINNER!
            </span>
          </div>

          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              gap: "12px",
              marginTop: "8px",
            }}
          >
            <span
              style={{
                fontSize: "72px",
                fontWeight: 900,
                color: p.accent,
                letterSpacing: "-2px",
                lineHeight: "1",
                filter: `drop-shadow(0 0 16px ${p.glow})`,
              }}
            >
              {amount}
            </span>
            <span
              style={{
                fontSize: "28px",
                fontWeight: 700,
                color: p.textDim,
                letterSpacing: "3px",
              }}
            >
              LINEA
            </span>
          </div>

          <div
            style={{
              width: "400px",
              height: "1px",
              background: `linear-gradient(90deg, transparent, ${p.divider}, transparent)`,
              margin: "20px 0 16px 0",
              display: "flex",
            }}
          />

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "32px",
              justifyContent: "center",
            }}
          >
            {tile && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "2px",
                }}
              >
                <span
                  style={{
                    fontSize: "13px",
                    fontWeight: 600,
                    color: p.textDim,
                    letterSpacing: "3px",
                    textTransform: "uppercase",
                  }}
                >
                  TILE
                </span>
                <span
                  style={{
                    fontSize: "26px",
                    fontWeight: 800,
                    color: p.textSub,
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
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "2px",
                }}
              >
                <span
                  style={{
                    fontSize: "13px",
                    fontWeight: 600,
                    color: p.textDim,
                    letterSpacing: "3px",
                    textTransform: "uppercase",
                  }}
                >
                  EPOCH
                </span>
                <span
                  style={{
                    fontSize: "26px",
                    fontWeight: 800,
                    color: p.textSub,
                  }}
                >
                  #{epoch}
                </span>
              </div>
            )}
            {shortAddr && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "2px",
                }}
              >
                <span
                  style={{
                    fontSize: "13px",
                    fontWeight: 600,
                    color: p.textDim,
                    letterSpacing: "3px",
                    textTransform: "uppercase",
                  }}
                >
                  WINNER
                </span>
                <span
                  style={{
                    fontSize: "22px",
                    fontWeight: 700,
                    color: p.textSub,
                    fontFamily: "monospace",
                  }}
                >
                  {shortAddr}
                </span>
              </div>
            )}
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            bottom: "0",
            left: "0",
            right: "0",
            height: "56px",
            background: "linear-gradient(180deg, transparent, rgba(0,0,0,0.5))",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "16px",
          }}
        >
          <div
            style={{
              width: "20px",
              height: "28px",
              background: `linear-gradient(180deg, ${p.accent}, ${p.accentDim})`,
              clipPath: "polygon(50% 0%, 100% 100%, 0% 100%)",
              opacity: 0.7,
              display: "flex",
            }}
          />
          <span
            style={{
              fontSize: "22px",
              fontWeight: 900,
              color: "rgba(255,255,255,0.55)",
              letterSpacing: "6px",
            }}
          >
            LORE
          </span>
          <span
            style={{
              fontSize: "13px",
              fontWeight: 500,
              color: "rgba(255,255,255,0.3)",
              letterSpacing: "2px",
            }}
          >
            LINEA MINING GAME
          </span>
        </div>

        <div
          style={{
            position: "absolute",
            top: "20px",
            left: "20px",
            width: "60px",
            height: "60px",
            borderTop: `2px solid ${p.badgeBorder}`,
            borderLeft: `2px solid ${p.badgeBorder}`,
            borderRadius: "4px 0 0 0",
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            top: "20px",
            right: "20px",
            width: "60px",
            height: "60px",
            borderTop: `2px solid ${p.badgeBorder}`,
            borderRight: `2px solid ${p.badgeBorder}`,
            borderRadius: "0 4px 0 0",
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: "60px",
            left: "20px",
            width: "60px",
            height: "60px",
            borderBottom: `2px solid ${p.badgeBorder}`,
            borderLeft: `2px solid ${p.badgeBorder}`,
            borderRadius: "0 0 0 4px",
            display: "flex",
          }}
        />
        <div
          style={{
            position: "absolute",
            bottom: "60px",
            right: "20px",
            width: "60px",
            height: "60px",
            borderBottom: `2px solid ${p.badgeBorder}`,
            borderRight: `2px solid ${p.badgeBorder}`,
            borderRadius: "0 0 4px 0",
            display: "flex",
          }}
        />
      </div>
    ),
    { ...SIZE },
  );
}
