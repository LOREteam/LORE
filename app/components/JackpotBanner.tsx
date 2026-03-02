"use client";

import React, { useEffect, useState, useMemo, useCallback, useRef } from "react";

interface JackpotBannerProps {
  winningTileId: number | null;
  isRevealing: boolean;
  tileViewData: Array<{
    tileId: number;
    hasMyBet: boolean;
  }>;
  epoch: string | null;
  isDailyJackpot?: boolean;
  isWeeklyJackpot?: boolean;
  jackpotAmount?: number;
}

export const JackpotBanner = React.memo(function JackpotBanner({
  winningTileId,
  isRevealing,
  tileViewData,
  epoch,
  isDailyJackpot = false,
  isWeeklyJackpot = false,
  jackpotAmount = 0,
}: JackpotBannerProps) {
  const [showBanner, setShowBanner] = useState(false);
  const [showContent, setShowContent] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isMyWin = useMemo(() => {
    if (winningTileId === null) return false;
    return tileViewData.some((t) => t.tileId === winningTileId && t.hasMyBet);
  }, [winningTileId, tileViewData]);

  const isJackpotWin = isMyWin && (isDailyJackpot || isWeeklyJackpot);

  const particleItems = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => ({
        id: i,
        left: `${Math.random() * 100}%`,
        duration: `${1.5 + Math.random()}s`,
        delay: `${Math.random() * 0.5}s`,
        icon: i % 2 === 0 ? "🪙" : "💎",
      })),
    [],
  );

  // Reset dismissed state when a new reveal starts
  useEffect(() => {
    if (isRevealing && isJackpotWin) {
      setIsDismissed(false);
    }
  }, [isRevealing, isJackpotWin, winningTileId]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (isRevealing && isJackpotWin && !isDismissed) {
      setShowBanner(true);
      timer = setTimeout(() => setShowContent(true), 100);
    } else {
      setShowContent(false);
      timer = setTimeout(() => setShowBanner(false), 500);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [isRevealing, isJackpotWin, isDismissed, winningTileId]);

  const handleClose = useCallback(() => {
    setIsDismissed(true);
    setShowContent(false);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      setShowBanner(false);
    }, 300);
  }, []);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const handleShareToX = useCallback(() => {
    const typeLabel = isDailyJackpot ? "Daily Jackpot" : isWeeklyJackpot ? "Weekly Jackpot" : "Jackpot";
    const amountPart =
      jackpotAmount > 0
        ? `${jackpotAmount.toLocaleString("en-US", { maximumFractionDigits: 2 })} LINEA`
        : "a big reward";
    const epochPart = epoch ? ` in epoch #${epoch}` : "";
    const text = `I just hit a ${typeLabel} on LORE! Winning tile #${winningTileId}${epochPart}. Reward: ${amountPart}. Built with @Linea_Ore on @LineaBuild.`;
    const pageUrl = typeof window !== "undefined" ? window.location.origin : "https://lore.game";
    const shareUrl = `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(pageUrl)}&via=${encodeURIComponent("Linea_Ore")}`;
    window.open(shareUrl, "_blank", "noopener,noreferrer");
  }, [isDailyJackpot, isWeeklyJackpot, jackpotAmount, epoch, winningTileId]);

  if (!showBanner || isDismissed) return null;

  const jackpotType = isDailyJackpot ? "DAILY" : isWeeklyJackpot ? "WEEKLY" : "JACKPOT";
  const theme = isDailyJackpot
    ? {
        gradient: "from-amber-500 via-yellow-400 to-amber-500",
        glow: "shadow-[0_0_60px_rgba(251,191,36,0.5),0_0_100px_rgba(251,191,36,0.3)]",
        button: "bg-amber-900/35 hover:bg-amber-900/55 border border-amber-200/40",
      }
    : isWeeklyJackpot
      ? {
          gradient: "from-cyan-500 via-sky-500 to-indigo-600",
          glow: "shadow-[0_0_60px_rgba(56,189,248,0.5),0_0_100px_rgba(59,130,246,0.3)]",
          button: "bg-sky-900/35 hover:bg-sky-900/55 border border-cyan-200/40",
        }
      : {
          gradient: "from-violet-500 via-fuchsia-500 to-violet-500",
          glow: "shadow-[0_0_60px_rgba(139,92,246,0.5),0_0_100px_rgba(139,92,246,0.3)]",
          button: "bg-violet-900/35 hover:bg-violet-900/55 border border-violet-200/40",
        };

  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center transition-all duration-500 ${
        showContent ? "opacity-100" : "opacity-0"
      }`}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Main Banner */}
      <div
        className={`relative z-10 mx-4 p-6 md:p-8 rounded-2xl bg-gradient-to-r ${theme.gradient} ${theme.glow} animate-scale-in`}
        style={{ animation: showContent ? "jackpot-scale 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)" : undefined }}
      >
        {/* Glow effect */}
        <div className="absolute inset-0 rounded-2xl animate-pulse opacity-50">
          <div className="absolute inset-0 rounded-2xl bg-gradient-to-r from-white/20 to-transparent" />
        </div>

        {/* Content */}
        <div className="relative text-center">
          {/* JACKPOT text */}
          <div className="mb-2">
            <span className="text-xs md:text-sm font-black tracking-[0.3em] text-white/80 uppercase">
              {jackpotType} JACKPOT! 🎰
            </span>
          </div>

          {/* Big WIN text */}
          <h1 className="text-5xl md:text-7xl font-black text-white drop-shadow-[0_0_20px_rgba(255,255,255,0.8)] mb-2 animate-bounce">
            WIN!
          </h1>

          {/* Tile number */}
          <div className="mb-4">
            <span className="text-lg md:text-xl font-bold text-white/90">
              Winning Tile: <span className="text-3xl md:text-4xl font-black text-white">#{winningTileId}</span>
            </span>
          </div>

          {/* Amount */}
          {jackpotAmount > 0 && (
            <div className="mb-4">
              <div className="inline-block px-4 py-2 rounded-lg bg-black/30 border border-white/20">
                <span className="text-sm text-white/70">You won</span>
                <div className="text-2xl md:text-3xl font-black text-white">
                  {jackpotAmount.toLocaleString("en-US", { maximumFractionDigits: 2 })} LINEA
                </div>
              </div>
            </div>
          )}

          {/* Epoch */}
          {epoch && (
            <div className="mb-6">
              <span className="text-sm text-white/60">Epoch #{epoch}</span>
            </div>
          )}

          {/* Close button */}
          <div className="flex flex-col sm:flex-row gap-2 justify-center">
            <button
              onClick={handleClose}
              className="px-6 py-2 rounded-lg bg-white/20 hover:bg-white/30 text-white font-bold text-sm transition-all"
            >
              AWESOME!
            </button>
            <button
              onClick={handleShareToX}
              className={`px-6 py-2 rounded-lg text-white font-bold text-sm transition-all ${theme.button}`}
            >
              Share on X
            </button>
          </div>
        </div>

        {/* Particle effects - sparkles */}
        <div className="absolute top-4 left-4 text-2xl animate-ping">✨</div>
        <div className="absolute top-4 right-4 text-2xl animate-ping" style={{ animationDelay: "0.2s" }}>✨</div>
        <div className="absolute bottom-4 left-4 text-2xl animate-ping" style={{ animationDelay: "0.4s" }}>✨</div>
        <div className="absolute bottom-4 right-4 text-2xl animate-ping" style={{ animationDelay: "0.6s" }}>✨</div>

        {/* Coins falling effect */}
        <div className="absolute inset-0 pointer-events-none overflow-hidden rounded-2xl">
          {particleItems.map((item) => (
            <div
              key={item.id}
              className="absolute text-2xl"
              style={{
                left: item.left,
                animation: `coin-fall ${item.duration} linear infinite`,
                animationDelay: item.delay,
              }}
            >
              {item.icon}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
});
