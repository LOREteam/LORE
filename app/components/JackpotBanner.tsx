"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatUnits, parseAbiItem, type PublicClient } from "viem";
import { usePublicClient } from "wagmi";
import { cn } from "../lib/cn";
import { APP_CHAIN_ID, CONTRACT_ADDRESS, CONTRACT_DEPLOY_BLOCK } from "../lib/constants";
import { getJackpotVisualTheme, resolveJackpotVisualKind } from "../lib/jackpotVisualTheme";
import { readJsonResponse } from "../lib/readJsonResponse";
import { UiButton } from "./ui/UiButton";

interface JackpotApiPayload {
  jackpots?: Array<{
    epoch?: unknown;
    kind?: unknown;
    amount?: unknown;
    amountNum?: unknown;
  }>;
}

const DAILY_JACKPOT_EVENT = parseAbiItem("event DailyJackpotAwarded(uint256 indexed epoch, uint256 amount)");
const WEEKLY_JACKPOT_EVENT = parseAbiItem("event WeeklyJackpotAwarded(uint256 indexed epoch, uint256 amount)");
const EPOCH_RESOLVED_EVENT = parseAbiItem(
  "event EpochResolved(uint256 indexed epoch, uint256 winningTile, uint256 totalPool, uint256 fee, uint256 rewardPool, uint256 jackpotBonus)",
);
const PUBLIC_SHARE_ORIGIN = "https://lore.game";

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
  jackpotFallbackAmount?: number;
  hasMyWinningBet?: boolean;
  reducedMotion?: boolean;
}

function parseJackpotAmount(value: unknown, fallback = 0) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number.parseFloat(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getPreviousEpoch(epoch: string | null) {
  if (!epoch) return null;
  const epochNumber = Number(epoch);
  return Number.isFinite(epochNumber) && epochNumber > 0 ? String(epochNumber - 1) : null;
}

function getCandidateEpochs(epoch: string | null) {
  return [epoch, getPreviousEpoch(epoch)].filter((item): item is string => Boolean(item));
}

function getShareOrigin() {
  const configuredSiteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? PUBLIC_SHARE_ORIGIN).trim();
  if (!configuredSiteUrl.startsWith("http")) return PUBLIC_SHARE_ORIGIN;
  const normalized = configuredSiteUrl.replace(/\/+$/, "");
  return /localhost|127\.0\.0\.1/i.test(normalized) ? PUBLIC_SHARE_ORIGIN : normalized;
}

function findIndexedJackpotAmount(
  rows: JackpotApiPayload["jackpots"],
  epoch: string | null,
  isDailyJackpot: boolean,
  isWeeklyJackpot: boolean,
) {
  if (!rows?.length || !epoch) return 0;
  const candidateEpochs = new Set([epoch, getPreviousEpoch(epoch)].filter((item): item is string => Boolean(item)));
  const kinds = [
    isDailyJackpot ? "daily" : null,
    isWeeklyJackpot ? "weekly" : null,
  ].filter((item): item is "daily" | "weekly" => item !== null);

  return kinds.reduce((total, kind) => {
    const row = rows.find((item) => String(item.epoch ?? "") === epoch && item.kind === kind)
      ?? rows.find((item) => candidateEpochs.has(String(item.epoch ?? "")) && item.kind === kind);
    const amount = parseJackpotAmount(row?.amountNum, parseJackpotAmount(row?.amount));
    return amount > 0 ? total + amount : total;
  }, 0);
}

async function fetchOnChainJackpotAmount({
  publicClient,
  epoch,
  isDailyJackpot,
  isWeeklyJackpot,
}: {
  publicClient: PublicClient | undefined;
  epoch: string | null;
  isDailyJackpot: boolean;
  isWeeklyJackpot: boolean;
}) {
  if (!publicClient || !epoch) return 0;
  const candidateEpochs = getCandidateEpochs(epoch);
  if (candidateEpochs.length === 0) return 0;

  const headBlock = await publicClient.getBlockNumber();
  const fromBlock = headBlock > 5000n ? headBlock - 5000n : CONTRACT_DEPLOY_BLOCK;
  let total = 0;

  for (const candidateEpoch of candidateEpochs) {
    const epochArg = BigInt(candidateEpoch);
    if (isDailyJackpot) {
      const logs = await publicClient.getLogs({
        address: CONTRACT_ADDRESS,
        event: DAILY_JACKPOT_EVENT,
        args: { epoch: epochArg },
        fromBlock,
        toBlock: headBlock,
      });
      total += logs.reduce((sum, log) => sum + parseJackpotAmount(formatUnits(log.args.amount ?? 0n, 18)), 0);
    }
    if (isWeeklyJackpot) {
      const logs = await publicClient.getLogs({
        address: CONTRACT_ADDRESS,
        event: WEEKLY_JACKPOT_EVENT,
        args: { epoch: epochArg },
        fromBlock,
        toBlock: headBlock,
      });
      total += logs.reduce((sum, log) => sum + parseJackpotAmount(formatUnits(log.args.amount ?? 0n, 18)), 0);
    }
    if (total > 0) return total;

    const resolvedLogs = await publicClient.getLogs({
      address: CONTRACT_ADDRESS,
      event: EPOCH_RESOLVED_EVENT,
      args: { epoch: epochArg },
      fromBlock,
      toBlock: headBlock,
    });
    const resolvedAmount = resolvedLogs.reduce(
      (sum, log) => sum + parseJackpotAmount(formatUnits(log.args.jackpotBonus ?? 0n, 18)),
      0,
    );
    if (resolvedAmount > 0) return resolvedAmount;
  }

  return total;
}

export const JackpotBanner = React.memo(function JackpotBanner({
  winningTileId,
  isRevealing,
  tileViewData,
  epoch,
  isDailyJackpot = false,
  isWeeklyJackpot = false,
  jackpotAmount = 0,
  jackpotFallbackAmount = 0,
  hasMyWinningBet = false,
  reducedMotion = false,
}: JackpotBannerProps) {
  void isRevealing;
  const [showBanner, setShowBanner] = useState(false);
  const [showContent, setShowContent] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [activeWinKey, setActiveWinKey] = useState<string | null>(null);
  const [indexedJackpotAmount, setIndexedJackpotAmount] = useState(0);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const publicClient = usePublicClient({ chainId: APP_CHAIN_ID });

  const isMyWin = useMemo(() => {
    if (hasMyWinningBet) return true;
    if (winningTileId === null) return false;
    return tileViewData.some((t) => t.tileId === winningTileId && t.hasMyBet);
  }, [hasMyWinningBet, tileViewData, winningTileId]);

  const isJackpotWin = isMyWin && (isDailyJackpot || isWeeklyJackpot);
  const displayJackpotAmount = jackpotAmount > 0
    ? jackpotAmount
    : jackpotFallbackAmount > 0
      ? jackpotFallbackAmount
      : indexedJackpotAmount;
  const currentWinKey = useMemo(() => {
    if (!isJackpotWin) return null;
    return [
      epoch ?? "unknown",
      winningTileId ?? "none",
      isDailyJackpot ? "daily" : "no-daily",
      isWeeklyJackpot ? "weekly" : "no-weekly",
    ].join(":");
  }, [epoch, isDailyJackpot, isJackpotWin, isWeeklyJackpot, winningTileId]);

  const sparkles = useMemo(
    () =>
      Array.from({ length: 6 }, (_, index) => ({
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
      Array.from({ length: 4 }, (_, index) => ({
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
    setIndexedJackpotAmount(0);
    setIsDismissed(false);
    setShowBanner(true);
    const timer = setTimeout(() => setShowContent(true), 100);
    return () => clearTimeout(timer);
  }, [activeWinKey, currentWinKey]);

  useEffect(() => {
    if (!showBanner || !currentWinKey || displayJackpotAmount > 0 || !epoch) return;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();

    const fetchAmount = async (attempt: number) => {
      try {
        const response = await fetch("/api/jackpots?fresh=1", { cache: "no-store", signal: controller.signal });
        if (controller.signal.aborted) return;
        const payload = await readJsonResponse<JackpotApiPayload>(response);
        if (!response.ok || !payload) throw new Error(`HTTP ${response.status}`);
        const amount = findIndexedJackpotAmount(payload.jackpots, epoch, isDailyJackpot, isWeeklyJackpot);
        if (!cancelled && amount > 0) {
          setIndexedJackpotAmount(amount);
          return;
        }
      } catch {
        // The indexer can lag the resolve tx; retry briefly while the banner is visible.
      }

      try {
        const amount = await fetchOnChainJackpotAmount({
          publicClient,
          epoch,
          isDailyJackpot,
          isWeeklyJackpot,
        });
        if (!cancelled && amount > 0) {
          setIndexedJackpotAmount(amount);
          return;
        }
      } catch {
        // RPC logs can fail on public providers; the next attempt will retry.
      }

      if (!cancelled && attempt < 8) {
        timeoutId = setTimeout(() => void fetchAmount(attempt + 1), 1800);
      }
    };

    void fetchAmount(1);

    return () => {
      cancelled = true;
      controller.abort();
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [currentWinKey, displayJackpotAmount, epoch, isDailyJackpot, isWeeklyJackpot, publicClient, showBanner]);

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

  const theme = getJackpotVisualTheme(resolveJackpotVisualKind(isDailyJackpot, isWeeklyJackpot));
  const palette = theme.banner;
  const headerText = theme.winTitle;
  const jackpotLabel = theme.label;
  const amountText =
    displayJackpotAmount > 0
      ? displayJackpotAmount.toLocaleString("en-US", { maximumFractionDigits: 4 })
      : null;
  const amountShareText = amountText ? `${amountText} LINEA` : "reward confirmed on-chain";

  const share = useCallback(() => {
    if (typeof window === "undefined") return;
    if (!amountText) return;
    const ogParams = new URLSearchParams();
    ogParams.set("kind", theme.kind);
    ogParams.set("amount", amountText);
    if (winningTileId !== null) ogParams.set("tile", String(winningTileId));
    if (epoch) ogParams.set("epoch", epoch);
    const shareOrigin = getShareOrigin();
    const sharePageUrl = `${shareOrigin}/jackpot-win?${ogParams.toString()}`;

    const lines = [
      `I just mined the ${jackpotLabel} in LORE.`,
      `Won: ${amountShareText}`,
      [epoch ? `Epoch #${epoch}` : null, winningTileId !== null ? `Tile #${winningTileId}` : null].filter(Boolean).join(" - ") || null,
      "Play: lore.game",
    ].filter((l) => l !== null);

    const tweetParams = new URLSearchParams({
      text: lines.join("\n"),
      url: sharePageUrl,
      hashtags: "LORE,Linea",
    });
    const tweetUrl = `https://x.com/intent/tweet?${tweetParams.toString()}`;
    window.open(tweetUrl, "_blank", "noopener,noreferrer");
  }, [amountShareText, amountText, epoch, jackpotLabel, theme.kind, winningTileId]);

  if (!showBanner || isDismissed || !activeWinKey) return null;

  return (
    <div
      role="region"
      aria-label={`${headerText} Win`}
      className={`pointer-events-none fixed inset-0 z-[9999] flex items-start justify-center overflow-y-auto px-3 py-3 transition-opacity duration-500 sm:py-4 ${
        showContent ? "opacity-100" : "opacity-0"
      }`}
    >
      <div className="pointer-events-none absolute inset-0 bg-black/88" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_38%,rgba(17,24,39,0.16),rgba(0,0,0,0.84)_58%,rgba(0,0,0,0.94)_100%)]" />

      {!reducedMotion && (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-144 overflow-hidden">
          <div
            className="absolute left-1/2 top-0 h-184 w-184 -translate-x-1/2 -translate-y-[18%] rounded-full"
            style={{
              background: `repeating-conic-gradient(from 0deg, ${palette.beam} 0deg 8deg, transparent 8deg 28deg, ${palette.beamAlt} 28deg 35deg, transparent 35deg 56deg)`,
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
          "pointer-events-auto relative z-10 w-full max-w-[58rem] overflow-hidden rounded-[1.25rem] border bg-[#07040d] text-center",
          palette.frame,
        )}
        style={{
          boxShadow: `0 0 24px ${palette.glow}, 0 24px 64px rgba(0,0,0,0.52)`,
          animation: !reducedMotion && showContent ? "jackpot-scale 0.52s cubic-bezier(0.22, 1, 0.36, 1)" : undefined,
        }}
      >
        <div className="relative aspect-[16/9] min-h-[30rem] overflow-hidden sm:min-h-0">
          <div
            className="absolute inset-0 scale-[1.035] bg-cover bg-center"
            style={{ backgroundImage: `url('${theme.ogArt}')` }}
          />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.70)_0%,rgba(0,0,0,0.22)_34%,rgba(0,0,0,0.18)_62%,rgba(0,0,0,0.78)_100%)]" />
          <div className="absolute inset-x-[9%] top-[11%] h-[34%] rounded-full bg-black/45" />
          <div
            className="absolute inset-0"
            style={{
              background: `radial-gradient(circle at 50% 44%, ${palette.glow} 0%, rgba(255,255,255,0.06) 20%, transparent 48%), radial-gradient(circle at 50% 50%, transparent 0%, transparent 56%, rgba(0,0,0,0.55) 100%)`,
            }}
          />

          <button
            type="button"
            autoFocus
            aria-label="Close jackpot banner"
            onClick={handleClose}
            className="absolute right-3 top-3 z-20 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/12 bg-black/42 text-lg text-white/72 transition hover:bg-black/58 hover:text-white active:scale-95 focus-visible:ring-2 focus-visible:ring-white/50 sm:right-5 sm:top-5"
          >
            <span aria-hidden="true">&times;</span>
          </button>

          <div className="relative z-10 flex h-full flex-col items-center px-5 py-7 sm:px-9 sm:py-9">
            <h2
              className="lore-display mx-auto max-w-[44rem] bg-clip-text text-[2.35rem] font-black uppercase leading-[0.86] text-transparent sm:text-[4.55rem] lg:text-[5.1rem]"
              style={{
                backgroundImage: `linear-gradient(180deg, ${palette.headlineFrom} 0%, ${palette.headlineVia} 48%, ${palette.headlineTo} 100%)`,
                textShadow: "0 12px 34px rgba(0,0,0,0.88)",
                filter: `drop-shadow(0 0 20px ${theme.colors.shadow})`,
              }}
            >
              {theme.winTitle}
            </h2>

            <div className="mt-auto flex flex-col items-center pb-4 sm:pb-5">
              <div
                className={cn(
                  "rounded-[1.15rem] border px-5 py-4 sm:px-7",
                  palette.prize,
                  palette.prizeBorder,
                )}
              >
                <div className="text-[0.66rem] font-black uppercase tracking-[0.28em] text-white/58">
                  You mined the jackpot
                </div>
                <div
                  className={cn(
                    "lore-hud-number mt-2 font-black leading-none",
                    amountText ? "text-[2.6rem] sm:text-[4.4rem]" : "text-[2rem] sm:text-[3.15rem]",
                    palette.accent,
                  )}
                  style={{ textShadow: `0 0 18px ${theme.colors.shadow}, 0 10px 30px rgba(0,0,0,0.9)` }}
                >
                  {amountText ? `${amountText} LINEA` : "JACKPOT AWARDED"}
                </div>
              </div>

              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {winningTileId !== null && (
                  <div className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-full border border-white/13 bg-black/44 px-4 py-0">
                    <span className="text-[0.62rem] font-black uppercase leading-none tracking-[0.22em] text-white/48">
                      Tile
                    </span>
                    <span className={cn("lore-nums text-sm font-black leading-none", palette.accent)}>
                      #{winningTileId}
                    </span>
                  </div>
                )}
                {epoch && (
                  <div className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-full border border-white/13 bg-black/44 px-4 py-0">
                    <span className="text-[0.62rem] font-black uppercase leading-none tracking-[0.22em] text-white/48">
                      Epoch
                    </span>
                    <span className="lore-nums text-sm font-black leading-none text-white/82">#{epoch}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex w-full flex-col gap-2.5 sm:flex-row sm:justify-center">
              <UiButton
                onClick={share}
                disabled={!amountText}
                variant="ghost"
                size="md"
                className={cn(
                  "min-h-[2.8rem] min-w-[11rem] rounded-[0.85rem] border bg-linear-to-r px-6 py-3 text-[0.78rem] font-black uppercase tracking-[0.14em] text-white shadow-[0_0_24px_rgba(255,255,255,0.07)] transition hover:brightness-110 sm:min-h-12 sm:text-[0.86rem]",
                  palette.button,
                  palette.buttonBorder,
                )}
              >
                <span className="text-base font-bold">X</span>
                {amountText ? "Share" : "Preparing"}
              </UiButton>

              <UiButton
                onClick={handleClose}
                variant="ghost"
                size="md"
                className={cn(
                  "min-h-[2.8rem] min-w-[11rem] rounded-[0.85rem] border px-6 py-3 text-[0.78rem] font-black uppercase tracking-[0.14em] transition hover:bg-white/8 sm:min-h-12 sm:text-[0.86rem]",
                  palette.shareBorder,
                  palette.shareBg,
                  palette.shareText,
                )}
              >
                Close
              </UiButton>
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
                  style={{
                    width: `${sparkle.size}px`,
                    height: `${sparkle.size}px`,
                    background: palette.sparkle,
                    clipPath: "polygon(50% 0%, 62% 38%, 100% 50%, 62% 62%, 50% 100%, 38% 62%, 0% 50%, 38% 38%)",
                    transform: `rotate(${sparkle.rotate}deg)`,
                    opacity: sparkle.opacity,
                  }}
                />
              </div>
            ))}

            {coins.map((coin) => (
              <div
                key={coin.id}
                className="absolute rounded-full border"
                style={{
                  left: coin.left,
                  top: coin.top,
                  width: `${coin.size}px`,
                  height: `${coin.size}px`,
                  borderColor: theme.colors.chipBorder,
                  background: palette.mote,
                  transform: `rotate(${coin.rotate}deg)`,
                  opacity: coin.opacity,
                  animation: "jackpot-glow 2.8s ease-in-out infinite",
                  animationDelay: coin.delay,
                }}
              />
            ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
