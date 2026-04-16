"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../lib/cn";
import { UiButton } from "./ui/UiButton";

interface JackpotBannerProps {
  winningTileId: number | null;
  isRevealing: boolean;
  tileViewData: Array<{
    tileId: number;
    hasMyBet: boolean;
  }>;
  epoch: string | null;
  walletAddress?: string | null;
  isDailyJackpot?: boolean;
  isWeeklyJackpot?: boolean;
  jackpotAmount?: number;
  hasMyWinningBet?: boolean;
  reducedMotion?: boolean;
}

export const JackpotBanner = React.memo(function JackpotBanner({
  winningTileId,
  isRevealing,
  tileViewData,
  epoch,
  walletAddress,
  isDailyJackpot = false,
  isWeeklyJackpot = false,
  jackpotAmount = 0,
  hasMyWinningBet = false,
  reducedMotion = false,
}: JackpotBannerProps) {
  void isRevealing;
  const [showBanner, setShowBanner] = useState(false);
  const [showContent, setShowContent] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [activeWinKey, setActiveWinKey] = useState<string | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isMyWin = useMemo(() => {
    if (hasMyWinningBet) return true;
    if (winningTileId === null) return false;
    return tileViewData.some((t) => t.tileId === winningTileId && t.hasMyBet);
  }, [hasMyWinningBet, tileViewData, winningTileId]);

  const isDualJackpot = isDailyJackpot && isWeeklyJackpot;
  const isJackpotWin = isMyWin && (isDailyJackpot || isWeeklyJackpot);
  const currentWinKey = useMemo(() => {
    if (!isJackpotWin) return null;
    return [
      epoch ?? "unknown",
      winningTileId ?? "none",
      isDailyJackpot ? "daily" : "no-daily",
      isWeeklyJackpot ? "weekly" : "no-weekly",
      Math.round(jackpotAmount * 100),
    ].join(":");
  }, [epoch, isDailyJackpot, isJackpotWin, isWeeklyJackpot, jackpotAmount, winningTileId]);

  const sparkles = useMemo(
    () =>
      Array.from({ length: 10 }, (_, index) => ({
        id: index,
        left: `${10 + Math.random() * 80}%`,
        top: `${10 + Math.random() * 78}%`,
        size: index % 3 === 0 ? 18 : index % 3 === 1 ? 12 : 8,
        delay: `${Math.random() * 1.4}s`,
        duration: `${2.2 + Math.random() * 1.1}s`,
        rotate: index % 2 === 0 ? 12 : 32,
        opacity: index % 3 === 0 ? 0.92 : 0.68,
      })),
    [],
  );

  const coins = useMemo(
    () =>
      Array.from({ length: 6 }, (_, index) => ({
        id: index,
        left: `${8 + Math.random() * 84}%`,
        top: `${8 + Math.random() * 84}%`,
        delay: `${Math.random() * 1.1}s`,
        size: index % 2 === 0 ? 20 : 14,
        rotate: index % 2 === 0 ? -18 : 18,
        opacity: index % 2 === 0 ? 0.92 : 0.72,
      })),
    [],
  );

  useEffect(() => {
    if (!currentWinKey) return;
    if (activeWinKey === currentWinKey) return;
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setActiveWinKey(currentWinKey);
    setIsDismissed(false);
    setShowBanner(true);
    const timer = setTimeout(() => setShowContent(true), 100);
    return () => clearTimeout(timer);
  }, [activeWinKey, currentWinKey]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (showBanner && !isDismissed) {
      if (!showContent) {
        timer = setTimeout(() => setShowContent(true), 100);
      }
    } else if (showBanner) {
      setShowContent(false);
      timer = setTimeout(() => setShowBanner(false), 450);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [isDismissed, showBanner, showContent]);

  const handleClose = useCallback(() => {
    setIsDismissed(true);
    setShowContent(false);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      setShowBanner(false);
    }, 280);
  }, []);

  useEffect(() => {
    if (!showBanner) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") handleClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handleClose, showBanner]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const headerText = isDualJackpot
    ? "DOUBLE JACKPOT!"
    : isDailyJackpot
      ? "DAILY JACKPOT!"
      : "WEEKLY JACKPOT!";
  const amountText =
    jackpotAmount > 0
      ? jackpotAmount.toLocaleString("en-US", { maximumFractionDigits: 2 })
      : "0";
  const palette = isDailyJackpot
    ? {
        shell: "from-[#120e14] via-[#20171d] to-[#120d14]",
        shellInner: "from-[#1a1418] via-[#2a2023] to-[#171117]",
        glow: "rgba(234,194,113,0.24)",
        frame: "border-[#d7b16d]",
        rim: "border-[#f2d89f]/10",
        beam: "rgba(226,186,97,0.08)",
        beamAlt: "rgba(226,186,97,0.03)",
        accent: "text-[#e2bc75]",
        headlineFrom: "#fff1c9",
        headlineVia: "#ffd67b",
        headlineTo: "#b77b2f",
        prize: "from-[#171116] via-[#24191d] to-[#151015]",
        prizeBorder: "border-[#d7b16d]/40",
        button: "from-[#6f4923] via-[#b9873e] to-[#694520]",
        buttonBorder: "border-[#f0d08c]/55",
        shareBorder: "border-[#d7b16d]/18",
        shareBg: "bg-white/[0.04]",
        shareText: "text-[#f3e3c1]",
      }
    : {
        shell: "from-[#10131d] via-[#172130] to-[#0f131d]",
        shellInner: "from-[#151b27] via-[#1c2736] to-[#141a25]",
        glow: "rgba(139,166,255,0.22)",
        frame: "border-[#9fb6ee]",
        rim: "border-[#dce8ff]/10",
        beam: "rgba(145,166,255,0.07)",
        beamAlt: "rgba(110,199,255,0.04)",
        accent: "text-[#a7c2ff]",
        headlineFrom: "#eff6ff",
        headlineVia: "#9fd3ff",
        headlineTo: "#5f8dff",
        prize: "from-[#111824] via-[#172233] to-[#111723]",
        prizeBorder: "border-[#8eb8ff]/40",
        button: "from-[#36548d] via-[#5583d4] to-[#304d84]",
        buttonBorder: "border-[#bed7ff]/45",
        shareBorder: "border-[#a8c7ff]/18",
        shareBg: "bg-white/[0.04]",
        shareText: "text-[#e3edff]",
      };

  const share = useCallback(() => {
    if (typeof window === "undefined") return;
    const kind = isDualJackpot ? "dual" : isDailyJackpot ? "daily" : "weekly";
    const ogParams = new URLSearchParams();
    ogParams.set("kind", kind);
    ogParams.set("amount", amountText);
    if (winningTileId !== null) ogParams.set("tile", String(winningTileId));
    if (epoch) ogParams.set("epoch", epoch);
    if (walletAddress) ogParams.set("winner", walletAddress);
    const sharePageUrl = `${window.location.origin}/jackpot-win?${ogParams.toString()}`;

    const lines = [
      `I just hit the ${headerText.replace("!", "")} in LORE!`,
      winningTileId !== null ? `Winning Tile: #${winningTileId}` : null,
      `Reward: ${amountText} LINEA`,
      "",
      sharePageUrl,
    ].filter((l) => l !== null);

    const tweetUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(lines.join("\n"))}`;
    window.open(tweetUrl, "_blank", "noopener,noreferrer");
  }, [amountText, epoch, headerText, isDailyJackpot, isDualJackpot, walletAddress, winningTileId]);

  if (!showBanner || isDismissed || !activeWinKey) return null;

  return (
    <div
      role="region"
      aria-label={`${headerText} Win`}
      className={`pointer-events-none fixed inset-x-0 top-3 z-[100] flex justify-center px-3 transition-opacity duration-500 sm:top-4 ${
        showContent ? "opacity-100" : "opacity-0"
      }`}
    >
      {!reducedMotion && (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[36rem] overflow-hidden">
          <div
            className="absolute left-1/2 top-0 h-[46rem] w-[46rem] -translate-x-1/2 -translate-y-[18%] rounded-full"
            style={{
              background: `repeating-conic-gradient(from 0deg, ${palette.beam} 0deg 8deg, transparent 8deg 28deg, ${palette.beamAlt} 28deg 35deg, transparent 35deg 56deg)`,
              filter: "blur(2px)",
            }}
          />
          <div
            className="absolute left-1/2 top-0 h-[28rem] w-[28rem] -translate-x-1/2 -translate-y-[12%] rounded-full"
            style={{
              background: `radial-gradient(circle, ${palette.glow} 0%, rgba(255,255,255,0.06) 16%, transparent 62%)`,
            }}
          />
        </div>
      )}

      <div
        className={cn(
          "pointer-events-auto relative z-10 w-full max-w-[42rem] overflow-hidden rounded-[2rem] border bg-gradient-to-br px-5 py-5 text-center sm:px-6 sm:py-6",
          palette.shell,
          palette.frame,
        )}
        style={{
          boxShadow: `0 0 38px ${palette.glow}, 0 30px 80px rgba(0,0,0,0.42)`,
          animation: !reducedMotion && showContent ? "jackpot-scale 0.52s cubic-bezier(0.22, 1, 0.36, 1)" : undefined,
        }}
      >
        <div className={cn("absolute inset-[10px] rounded-[1.55rem] border bg-gradient-to-br", palette.shellInner, palette.rim)} />
        <div className="absolute inset-x-10 top-0 h-28 bg-[radial-gradient(circle_at_top,rgba(255,244,205,0.14),transparent_70%)]" />
        <div className="absolute left-1/2 top-[18%] h-[26rem] w-[26rem] -translate-x-1/2 rounded-full border border-white/5" />
        <div className="absolute left-1/2 top-[18%] h-[26rem] w-[26rem] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(255,214,124,0.08),transparent_62%)]" />

        <button
          type="button"
          autoFocus
          aria-label="Close jackpot banner"
          onClick={handleClose}
          className="absolute right-4 z-20 inline-flex h-11 w-11 items-center justify-center rounded-full border border-white/10 bg-black/20 text-lg text-white/70 transition hover:bg-black/30 hover:text-white active:scale-95 focus-visible:ring-2 focus-visible:ring-white/50 sm:right-6 sm:top-6"
          style={{ top: "max(1.5rem, env(safe-area-inset-top, 1.5rem))" }}
        >
          <span aria-hidden="true">&times;</span>
        </button>

        <div className="relative z-10">
          <div className="mx-auto max-w-[30rem]">
            <div className={cn("mx-auto inline-flex rounded-full border px-4 py-2 text-[0.72rem] font-semibold uppercase tracking-[0.34em]", palette.shareBorder, palette.accent)}>
              {isDualJackpot ? "Dual payout unlocked" : isDailyJackpot ? "Daily reward pool" : "Weekly reward pool"}
            </div>

            <h2
              className="mt-6 text-[2.25rem] font-semibold uppercase tracking-[0.24em] text-white/92 sm:text-[3rem]"
              style={{ fontFamily: 'Georgia, "Times New Roman", serif' }}
            >
              {headerText.replace("!", "")}
            </h2>

            <div className="mt-3">
              <div
                className="bg-clip-text text-[5.5rem] font-semibold uppercase leading-[0.88] tracking-[0.06em] text-transparent sm:text-[7rem]"
                style={{
                  fontFamily: 'Georgia, "Times New Roman", serif',
                  backgroundImage: `linear-gradient(180deg, ${palette.headlineFrom} 0%, ${palette.headlineVia} 46%, ${palette.headlineTo} 100%)`,
                  textShadow: "0 12px 28px rgba(0,0,0,0.32)",
                  filter: "drop-shadow(0 0 12px rgba(255,218,122,0.12))",
                }}
              >
                WIN!
              </div>
            </div>

            <div className="mt-6 flex items-center justify-center gap-4 text-white/78">
              <div className="h-px w-16 bg-gradient-to-r from-transparent to-white/35 sm:w-24" />
              <div className="text-[0.92rem] font-medium uppercase tracking-[0.28em] sm:text-[1rem]">
                {winningTileId !== null ? `Winning Tile ${winningTileId}` : "Jackpot Winner"}
              </div>
              <div className="h-px w-16 bg-gradient-to-l from-transparent to-white/35 sm:w-24" />
            </div>

            <div
              className={cn(
                "mx-auto mt-7 w-full max-w-[26rem] rounded-[1.25rem] border bg-gradient-to-br px-6 py-5 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]",
                palette.prize,
                palette.prizeBorder,
              )}
            >
              <div className="text-[0.76rem] uppercase tracking-[0.3em] text-white/44">Payout</div>
              <div className="mt-2 text-[1.1rem] text-white/78 sm:text-[1.2rem]">You won</div>
              <div className={cn("mt-1 text-[2rem] font-semibold tracking-[0.04em] sm:text-[2.5rem]", palette.accent)}>
                {amountText} LINEA
              </div>
            </div>

            <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-center">
              <UiButton
                onClick={handleClose}
                variant="ghost"
                size="md"
                className={cn(
                  "min-h-14 min-w-[15rem] rounded-[0.95rem] border bg-gradient-to-r px-8 py-4 text-[0.95rem] font-semibold uppercase tracking-[0.24em] text-white transition hover:brightness-105",
                  palette.button,
                  palette.buttonBorder,
                )}
              >
                Close Banner
              </UiButton>

              <UiButton
                onClick={share}
                variant="ghost"
                size="md"
                className={cn(
                  "min-h-14 min-w-[15rem] rounded-[0.95rem] border px-8 py-4 text-[0.95rem] font-semibold uppercase tracking-[0.18em] transition hover:bg-white/[0.08]",
                  palette.shareBorder,
                  palette.shareBg,
                  palette.shareText,
                )}
              >
                <span className="text-base font-bold">X</span>
                Share on X
              </UiButton>
            </div>
          </div>
        </div>

        {!reducedMotion && (
          <div className="pointer-events-none absolute inset-0 overflow-hidden">
            {sparkles.map((sparkle) => (
              <div
                key={sparkle.id}
                className="absolute"
                style={{
                  left: sparkle.left,
                  top: sparkle.top,
                  animation: `jackpot-glow ${sparkle.duration} ease-in-out infinite`,
                  animationDelay: sparkle.delay,
                }}
              >
                <div
                  className="bg-[#ffe9ad]"
                  style={{
                    width: `${sparkle.size}px`,
                    height: `${sparkle.size}px`,
                    clipPath: "polygon(50% 0%, 62% 38%, 100% 50%, 62% 62%, 50% 100%, 38% 62%, 0% 50%, 38% 38%)",
                    transform: `rotate(${sparkle.rotate}deg)`,
                    opacity: sparkle.opacity,
                    filter: "drop-shadow(0 0 8px rgba(255,224,146,0.34))",
                  }}
                />
              </div>
            ))}

            {coins.map((coin) => (
              <div
                key={coin.id}
                className="absolute rounded-full border border-[#ffefab]/45 bg-[radial-gradient(circle_at_30%_30%,#fff6ba,#ffcb4e_45%,#d97b15_100%)]"
                style={{
                  left: coin.left,
                  top: coin.top,
                  width: `${coin.size}px`,
                  height: `${coin.size}px`,
                  transform: `rotate(${coin.rotate}deg)`,
                  opacity: coin.opacity,
                  animation: "jackpot-glow 2.8s ease-in-out infinite",
                  animationDelay: coin.delay,
                  boxShadow: "0 0 14px rgba(255,203,94,0.18)",
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
