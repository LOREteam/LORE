"use client";

import { useCallback, useState } from "react";
import { JackpotBanner } from "../../components/JackpotBanner";

type Variant = "daily" | "weekly" | "dual";

const VARIANTS: { label: string; value: Variant; color: string }[] = [
  { label: "Daily (Gold)", value: "daily", color: "#daa520" },
  { label: "Weekly (Purple)", value: "weekly", color: "#8b5cf6" },
  { label: "Dual (Combined)", value: "dual", color: "#c084fc" },
];

export function JackpotPreviewClient({ initialVariant }: { initialVariant: Variant }) {
  const [variant, setVariant] = useState<Variant>(initialVariant);
  const [counter, setCounter] = useState(0);

  const switchVariant = useCallback((nextVariant: Variant) => {
    const url = new URL(window.location.href);
    url.searchParams.set("variant", nextVariant);
    window.history.replaceState({}, "", url);
    setVariant(nextVariant);
    setCounter((n) => n + 1);
  }, []);

  return (
    <main style={{ minHeight: "100vh", background: "#060612" }}>
      <div
        style={{
          position: "fixed",
          left: "16px",
          top: "16px",
          zIndex: 200,
          display: "flex",
          gap: "8px",
        }}
      >
        {VARIANTS.map((entry) => (
          <button
            key={entry.value}
            type="button"
            onClick={() => switchVariant(entry.value)}
            style={{
              padding: "8px 18px",
              borderRadius: "10px",
              border: variant === entry.value ? `2px solid ${entry.color}` : "1px solid rgba(255,255,255,0.12)",
              background: variant === entry.value ? `${entry.color}22` : "rgba(255,255,255,0.04)",
              color: variant === entry.value ? "#fff" : "rgba(255,255,255,0.5)",
              fontSize: "13px",
              fontWeight: 700,
              cursor: "pointer",
              transition: "all 0.2s",
            }}
          >
            {entry.label}
          </button>
        ))}
      </div>

      <JackpotBanner
        key={`${variant}-${counter}`}
        winningTileId={3}
        isRevealing
        tileViewData={[
          { tileId: 1, hasMyBet: false },
          { tileId: 2, hasMyBet: false },
          { tileId: 3, hasMyBet: true },
          { tileId: 4, hasMyBet: false },
        ]}
        epoch="1284"
        walletAddress="0x1234567890abcdef1234567890abcdef12345678"
        isDailyJackpot={variant === "daily" || variant === "dual"}
        isWeeklyJackpot={variant === "weekly" || variant === "dual"}
        jackpotAmount={variant === "dual" ? 185.5 : variant === "weekly" ? 320 : 40}
        hasMyWinningBet
        reducedMotion={false}
      />
    </main>
  );
}
