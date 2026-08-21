"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type PublicClient } from "viem";
import { usePublicClient } from "wagmi";
import { GAME_EVENTS_ABI } from "../../config/generated/lineaOreV10Abi";
import { formatBalanceFixed, formatDecimalTextFixed, formatScaledUnitsFixed } from "../lib/balanceFormatting";
import { cn } from "../lib/cn";
import { APP_CHAIN_ID, CONTRACT_ADDRESS, CONTRACT_DEPLOY_BLOCK } from "../lib/constants";
import { getJackpotVisualTheme, resolveJackpotVisualKind, type JackpotVisualKind } from "../lib/jackpotVisualTheme";
import { readJsonResponse } from "../lib/readJsonResponse";
import { fetchWithTimeout } from "../lib/fetchWithTimeout";
import { useDialogFocusTrap } from "../hooks/useDialogFocusTrap";
import { UiButton } from "./ui/UiButton";

interface JackpotApiPayload {
  jackpots?: Array<{
    epoch?: unknown;
    kind?: unknown;
    amount?: unknown;
    amountNum?: unknown;
  }>;
}

function getGameEvent<Name extends (typeof GAME_EVENTS_ABI)[number]["name"]>(name: Name) {
  const event = GAME_EVENTS_ABI.find((candidate) => candidate.name === name);
  if (!event) throw new Error(`Missing generated game event: ${name}`);
  return event as Extract<(typeof GAME_EVENTS_ABI)[number], { name: Name }>;
}

const DAILY_JACKPOT_EVENT = getGameEvent("DailyJackpotAwarded");
const WEEKLY_JACKPOT_EVENT = getGameEvent("WeeklyJackpotAwarded");
const EPOCH_RESOLVED_EVENT = getGameEvent("EpochResolved");
const JACKPOT_SPARKLES = [
  { id: 0, left: "14%", top: "18%", size: 18, delay: "0s", duration: "2.8s", rotate: 12, opacity: 0.92 },
  { id: 1, left: "28%", top: "68%", size: 12, delay: "0.35s", duration: "2.35s", rotate: 32, opacity: 0.68 },
  { id: 2, left: "42%", top: "24%", size: 8, delay: "0.7s", duration: "3.05s", rotate: 12, opacity: 0.68 },
  { id: 3, left: "58%", top: "76%", size: 18, delay: "1.05s", duration: "2.55s", rotate: 32, opacity: 0.92 },
  { id: 4, left: "72%", top: "22%", size: 12, delay: "0.2s", duration: "3.2s", rotate: 12, opacity: 0.68 },
  { id: 5, left: "86%", top: "62%", size: 8, delay: "0.9s", duration: "2.65s", rotate: 32, opacity: 0.68 },
];
const JACKPOT_COINS = [
  { id: 0, left: "12%", top: "38%", delay: "0.15s", size: 20, rotate: -18, opacity: 0.92 },
  { id: 1, left: "34%", top: "14%", delay: "0.55s", size: 14, rotate: 18, opacity: 0.72 },
  { id: 2, left: "66%", top: "18%", delay: "0.85s", size: 20, rotate: -18, opacity: 0.92 },
  { id: 3, left: "82%", top: "54%", delay: "0.35s", size: 14, rotate: 18, opacity: 0.72 },
];
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
  dailyJackpotFallbackAmount?: number;
  weeklyJackpotFallbackAmount?: number;
  hasMyWinningBet?: boolean;
  reducedMotion?: boolean;
}

interface ActiveJackpotWin {
  key: string;
  kind: JackpotVisualKind;
  amountText: string;
  epoch: string | null;
  tileId: number | null;
}

const JACKPOT_AMOUNT_FRACTION_DIGITS = 6;
const JACKPOT_DISPLAY_FRACTION_DIGITS = 4;

function fixedAmountToScaled(text: string): bigint | null {
  if (!/^\d+\.\d{6}$/.test(text)) return null;
  return BigInt(text.replace(".", ""));
}

export function formatJackpotAmountText(value: unknown): string | null {
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  const fixed = formatDecimalTextFixed(String(value ?? "").trim(), JACKPOT_AMOUNT_FRACTION_DIGITS);
  return fixed && fixedAmountToScaled(fixed) !== 0n ? fixed : null;
}

export function formatJackpotAmountWei(value: bigint | null | undefined): string | null {
  const fixed = formatBalanceFixed(
    { value: value ?? 0n, decimals: 18 },
    JACKPOT_AMOUNT_FRACTION_DIGITS,
  );
  return fixed && fixedAmountToScaled(fixed) !== 0n ? fixed : null;
}

function addJackpotAmountText(totalText: string | null, amountText: string | null): string | null {
  const total = totalText ? fixedAmountToScaled(totalText) : 0n;
  const amount = amountText ? fixedAmountToScaled(amountText) : 0n;
  if (total === null || amount === null) return totalText;
  const next = total + amount;
  return next > 0n ? formatScaledUnitsFixed(next, JACKPOT_AMOUNT_FRACTION_DIGITS) : null;
}

export function formatJackpotDisplayAmount(text: string | null): string | null {
  if (!text) return null;
  const fixed = formatDecimalTextFixed(text, JACKPOT_DISPLAY_FRACTION_DIGITS);
  if (!fixed) return null;
  const [whole, fractional = ""] = fixed.split(".");
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const trimmedFractional = fractional.replace(/0+$/, "");
  return trimmedFractional ? `${groupedWhole}.${trimmedFractional}` : groupedWhole;
}

function getPreviousEpoch(epoch: string | null) {
  if (!epoch) return null;
  const epochNumber = Number(epoch);
  return Number.isFinite(epochNumber) && epochNumber > 0 ? String(epochNumber - 1) : null;
}

function getCandidateEpochs(epoch: string | null) {
  return [epoch, getPreviousEpoch(epoch)].filter((item): item is string => Boolean(item));
}

function getElementsOutsideDialog(dialogRoot: HTMLElement): HTMLElement[] {
  const elements: HTMLElement[] = [];
  let current: HTMLElement | null = dialogRoot;

  while (current.parentElement && current.parentElement !== document.body) {
    for (const sibling of Array.from(current.parentElement.children)) {
      if (sibling instanceof HTMLElement && sibling !== current && !sibling.contains(dialogRoot)) {
        elements.push(sibling);
      }
    }
    current = current.parentElement;
  }

  for (const child of Array.from(document.body.children)) {
    if (child instanceof HTMLElement && child !== current && !child.contains(dialogRoot)) {
      elements.push(child);
    }
  }

  return elements;
}

function findIndexedJackpotAmount(
  rows: JackpotApiPayload["jackpots"],
  epoch: string | null,
  isDailyJackpot: boolean,
  isWeeklyJackpot: boolean,
) {
  if (!rows?.length || !epoch) return null;
  const candidateEpochs = new Set([epoch, getPreviousEpoch(epoch)].filter((item): item is string => Boolean(item)));
  const kinds = [
    isDailyJackpot ? "daily" : null,
    isWeeklyJackpot ? "weekly" : null,
  ].filter((item): item is "daily" | "weekly" => item !== null);

  return kinds.reduce<string | null>((total, kind) => {
    const row = rows.find((item) => String(item.epoch ?? "") === epoch && item.kind === kind)
      ?? rows.find((item) => candidateEpochs.has(String(item.epoch ?? "")) && item.kind === kind);
    const amount = formatJackpotAmountText(row?.amountNum) ?? formatJackpotAmountText(row?.amount);
    return addJackpotAmountText(total, amount);
  }, null);
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
  if (!publicClient || !epoch) return null;
  const candidateEpochs = getCandidateEpochs(epoch);
  if (candidateEpochs.length === 0) return 0;

  const headBlock = await publicClient.getBlockNumber();
  const fromBlock = headBlock > 5000n ? headBlock - 5000n : CONTRACT_DEPLOY_BLOCK;
  let total: string | null = null;

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
      total = logs.reduce<string | null>(
        (sum, log) => addJackpotAmountText(sum, formatJackpotAmountWei(log.args.amount)),
        total,
      );
    }
    if (isWeeklyJackpot) {
      const logs = await publicClient.getLogs({
        address: CONTRACT_ADDRESS,
        event: WEEKLY_JACKPOT_EVENT,
        args: { epoch: epochArg },
        fromBlock,
        toBlock: headBlock,
      });
      total = logs.reduce<string | null>(
        (sum, log) => addJackpotAmountText(sum, formatJackpotAmountWei(log.args.amount)),
        total,
      );
    }
    if (total) return total;

    const resolvedLogs = await publicClient.getLogs({
      address: CONTRACT_ADDRESS,
      event: EPOCH_RESOLVED_EVENT,
      args: { epoch: epochArg },
      fromBlock,
      toBlock: headBlock,
    });
    const resolvedAmount = resolvedLogs.reduce(
      (sum, log) => addJackpotAmountText(sum, formatJackpotAmountWei(log.args.jackpotBonus)),
      null as string | null,
    );
    if (resolvedAmount) return resolvedAmount;
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
  dailyJackpotFallbackAmount = 0,
  weeklyJackpotFallbackAmount = 0,
  hasMyWinningBet = false,
  reducedMotion = false,
}: JackpotBannerProps) {
  void isRevealing;
  const [showBanner, setShowBanner] = useState(false);
  const [showContent, setShowContent] = useState(false);
  const [isDismissed, setIsDismissed] = useState(false);
  const [activeWin, setActiveWin] = useState<ActiveJackpotWin | null>(null);
  const [indexedJackpotAmount, setIndexedJackpotAmount] = useState<string | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissedWinKeyRef = useRef<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const titleId = React.useId();
  const descriptionId = React.useId();
  const publicClient = usePublicClient({ chainId: APP_CHAIN_ID });

  const isMyWin = useMemo(() => {
    if (hasMyWinningBet) return true;
    if (winningTileId === null) return false;
    return tileViewData.some((t) => t.tileId === winningTileId && t.hasMyBet);
  }, [hasMyWinningBet, tileViewData, winningTileId]);

  const isJackpotWin = isMyWin && (isDailyJackpot || isWeeklyJackpot);
  const candidateKind = isJackpotWin ? resolveJackpotVisualKind(isDailyJackpot, isWeeklyJackpot) : null;
  const dailyFallbackText = formatJackpotAmountText(dailyJackpotFallbackAmount);
  const weeklyFallbackText = formatJackpotAmountText(weeklyJackpotFallbackAmount);
  const kindFallbackAmountText =
    candidateKind === "dual"
      ? addJackpotAmountText(dailyFallbackText, weeklyFallbackText)
      : candidateKind === "daily"
        ? dailyFallbackText
        : candidateKind === "weekly"
          ? weeklyFallbackText
          : null;
  const displayJackpotAmountText = formatJackpotAmountText(jackpotAmount)
    ?? kindFallbackAmountText
    ?? (candidateKind === "dual" ? formatJackpotAmountText(jackpotFallbackAmount) : null)
    ?? indexedJackpotAmount;
  const candidateWinKey = useMemo(() => {
    if (!candidateKind) return null;
    return [
      epoch ?? "unknown",
      winningTileId ?? "none",
      candidateKind,
    ].join(":");
  }, [candidateKind, epoch, winningTileId]);
  const readyWin = useMemo<ActiveJackpotWin | null>(() => {
    if (!candidateKind || !candidateWinKey || !displayJackpotAmountText) return null;
    return {
      key: candidateWinKey,
      kind: candidateKind,
      amountText: displayJackpotAmountText,
      epoch,
      tileId: winningTileId,
    };
  }, [candidateKind, candidateWinKey, displayJackpotAmountText, epoch, winningTileId]);

  useEffect(() => {
    setIndexedJackpotAmount(null);
  }, [candidateWinKey]);

  useEffect(() => {
    if (!candidateWinKey || displayJackpotAmountText || !epoch) return;
    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const controller = new AbortController();

    const fetchAmount = async (attempt: number) => {
      try {
        const response = await fetchWithTimeout("/api/jackpots?fresh=1", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        const payload = await readJsonResponse<JackpotApiPayload>(response);
        if (!response.ok || !payload) throw new Error(`HTTP ${response.status}`);
        const amount = findIndexedJackpotAmount(payload.jackpots, epoch, isDailyJackpot, isWeeklyJackpot);
        if (!cancelled && amount) {
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
        if (!cancelled && amount) {
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
  }, [candidateWinKey, displayJackpotAmountText, epoch, isDailyJackpot, isWeeklyJackpot, publicClient]);

  useEffect(() => {
    if (!readyWin) {
      if (openTimerRef.current) {
        clearTimeout(openTimerRef.current);
        openTimerRef.current = null;
      }
      return;
    }
    if (activeWin?.key === readyWin.key) {
      if (activeWin.amountText !== readyWin.amountText) setActiveWin(readyWin);
      return;
    }
    if (activeWin && activeWin.epoch === readyWin.epoch && activeWin.tileId === readyWin.tileId) {
      setActiveWin(readyWin);
      return;
    }
    if (dismissedWinKeyRef.current === readyWin.key) return;
    if (openTimerRef.current) clearTimeout(openTimerRef.current);

    openTimerRef.current = setTimeout(() => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      setActiveWin(readyWin);
      setIsDismissed(false);
      setShowContent(false);
      setShowBanner(true);
      openTimerRef.current = null;
    }, 180);

    return () => {
      if (openTimerRef.current) {
        clearTimeout(openTimerRef.current);
        openTimerRef.current = null;
      }
    };
  }, [activeWin, readyWin]);

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
    if (activeWin) dismissedWinKeyRef.current = activeWin.key;
    setIsDismissed(true);
    setShowContent(false);
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      setShowBanner(false);
    }, 280);
  }, [activeWin]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      if (openTimerRef.current) clearTimeout(openTimerRef.current);
    };
  }, []);

  const theme = getJackpotVisualTheme(activeWin?.kind ?? "daily");
  const palette = theme.banner;
  const jackpotLabel = theme.label;
  const activeAmountText = activeWin?.amountText ?? null;
  const activeEpoch = activeWin?.epoch ?? null;
  const activeTileId = activeWin?.tileId ?? null;
  const amountText = formatJackpotDisplayAmount(activeAmountText);
  const amountShareText = amountText ? `${amountText} LINEA` : "";
  const isModalOpen = showBanner && !isDismissed && Boolean(activeWin) && Boolean(amountText);
  const jackpotDescription = [
    amountText ? `Won ${amountText} LINEA.` : null,
    activeEpoch ? `Epoch ${activeEpoch}.` : null,
    activeTileId !== null ? `Tile ${activeTileId}.` : null,
  ].filter(Boolean).join(" ");

  const share = useCallback(() => {
    if (typeof window === "undefined") return;
    if (!amountText) return;
    const lines = [
      `I just mined the ${jackpotLabel} in LORE.`,
      `Won: ${amountShareText}`,
      [activeEpoch ? `Epoch #${activeEpoch}` : null, activeTileId !== null ? `Tile #${activeTileId}` : null].filter(Boolean).join(" - ") || null,
      "playlore.xyz",
      "#LORE #Linea",
    ].filter((l) => l !== null);

    const tweetParams = new URLSearchParams({
      text: lines.join("\n"),
    });
    const tweetUrl = `https://x.com/intent/tweet?${tweetParams.toString()}`;
    window.open(tweetUrl, "_blank", "noopener,noreferrer");
  }, [activeEpoch, activeTileId, amountShareText, amountText, jackpotLabel]);

  useEffect(() => {
    if (!isModalOpen) return;
    const overlay = overlayRef.current;
    if (!overlay) return;

    const disabledElements = getElementsOutsideDialog(overlay).map((element) => ({
      element,
      ariaHidden: element.getAttribute("aria-hidden"),
      inert: element.inert,
    }));
    for (const { element } of disabledElements) {
      element.inert = true;
      element.setAttribute("aria-hidden", "true");
    }

    return () => {
      for (const { element, ariaHidden, inert } of disabledElements) {
        element.inert = inert;
        if (ariaHidden === null) {
          element.removeAttribute("aria-hidden");
        } else {
          element.setAttribute("aria-hidden", ariaHidden);
        }
      }
    };
  }, [isModalOpen]);

  useDialogFocusTrap(isModalOpen, handleClose, undefined, overlayRef);

  if (!isModalOpen) return null;

  return (
    <div
      ref={overlayRef}
      role="presentation"
      className={`pointer-events-none fixed inset-0 z-[9999] flex items-center justify-center overflow-y-auto px-3 py-4 transition-opacity duration-500 sm:px-5 sm:py-6 ${
        showContent ? "opacity-100" : "opacity-0"
      }`}
    >
      <div className="pointer-events-none absolute inset-0 bg-black/90" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_44%,rgba(21,18,38,0.28),rgba(0,0,0,0.80)_58%,rgba(0,0,0,0.95)_100%)]" />

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
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        tabIndex={-1}
        className={cn(
          "pointer-events-auto relative z-10 w-full max-w-[58rem] overflow-hidden rounded-[1.15rem] border bg-[#07040d] text-center",
          palette.frame,
        )}
        style={{
          boxShadow: `0 0 28px ${palette.glow}, 0 28px 82px rgba(0,0,0,0.72)`,
          animation: !reducedMotion && showContent ? "jackpot-scale 0.52s cubic-bezier(0.22, 1, 0.36, 1)" : undefined,
        }}
      >
        <div className="relative flex h-[min(42rem,calc(100dvh-2rem))] min-h-[33rem] overflow-hidden">
          <div
            className="absolute inset-0 scale-[1.035] bg-cover bg-center"
            style={{ backgroundImage: `url('${theme.ogArt}')` }}
          />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.70)_0%,rgba(0,0,0,0.28)_30%,rgba(0,0,0,0.30)_58%,rgba(0,0,0,0.88)_100%)]" />
          <div className="absolute inset-x-0 top-0 h-[26%] bg-[linear-gradient(180deg,rgba(0,0,0,0.72),transparent)]" />
          <div className="absolute inset-x-0 bottom-0 h-[44%] bg-[linear-gradient(180deg,transparent,rgba(0,0,0,0.78))]" />
          <div
            className="absolute inset-0"
            style={{
              background: `radial-gradient(circle at 50% 45%, ${palette.glow} 0%, rgba(255,255,255,0.07) 18%, transparent 43%), radial-gradient(circle at 50% 50%, transparent 0%, transparent 54%, rgba(0,0,0,0.68) 100%)`,
            }}
          />

          <button
            type="button"
            aria-label="Close jackpot banner"
            onClick={handleClose}
            className="absolute right-3 top-3 z-20 inline-flex h-12 w-12 items-center justify-center rounded-full border border-white/12 bg-black/42 text-lg text-white/72 transition hover:bg-black/58 hover:text-white active:scale-95 focus-visible:ring-2 focus-visible:ring-white/50 sm:right-5 sm:top-5"
          >
            <span aria-hidden="true">&times;</span>
          </button>

          <div className="relative z-10 flex h-full min-h-0 w-full flex-col items-center justify-between gap-4 px-5 py-6 sm:px-9 sm:py-7">
            <div className="flex w-full flex-col items-center pt-1">
              <div className={cn(
                "rounded-full border border-white/12 bg-black/36 px-4 py-1.5 text-[0.62rem] font-black uppercase leading-none tracking-[0.24em] text-white/70 shadow-[0_10px_30px_rgba(0,0,0,0.36)] backdrop-blur-sm",
                palette.shareBorder,
              )}>
                {jackpotLabel} unlocked
              </div>
              <h2
                id={titleId}
                className="lore-display mx-auto mt-4 max-w-[42rem] bg-clip-text px-2 pb-2 text-[2.45rem] font-black uppercase leading-[1.02] text-transparent sm:text-[4.2rem] lg:text-[4.75rem]"
                style={{
                  backgroundImage: `linear-gradient(180deg, ${palette.headlineFrom} 0%, ${palette.headlineVia} 50%, ${palette.headlineTo} 100%)`,
                  textShadow: "0 16px 42px rgba(0,0,0,0.98)",
                  filter: `drop-shadow(0 0 20px ${theme.colors.shadow}) drop-shadow(0 8px 22px rgba(0,0,0,0.9))`,
                  textWrap: "balance",
                }}
              >
                {theme.winTitle}
              </h2>
              <p id={descriptionId} className="sr-only">{jackpotDescription}</p>
            </div>

            <div className="flex w-full min-h-0 flex-1 flex-col items-center justify-center">
              <div
                className={cn(
                  "relative w-full max-w-[38rem] overflow-hidden rounded-[1rem] border bg-black/62 px-5 py-5 shadow-[0_18px_48px_rgba(0,0,0,0.60)] backdrop-blur-md sm:px-8 sm:py-6",
                  palette.prizeBorder,
                )}
              >
                <div
                  className="pointer-events-none absolute inset-x-6 top-0 h-px"
                  style={{ background: `linear-gradient(90deg, transparent, ${theme.colors.accentSoft}, transparent)` }}
                />
                <div className="text-[0.64rem] font-black uppercase tracking-[0.28em] text-white/68">
                  You mined the jackpot
                </div>
                <div
                  className={cn(
                    "lore-hud-number mt-3 break-words font-black leading-[1.02]",
                    "text-[2.2rem] sm:text-[3.85rem]",
                    palette.accent,
                  )}
                  style={{ textShadow: `0 0 18px ${theme.colors.shadow}, 0 10px 30px rgba(0,0,0,0.96)` }}
                >
                  {amountText}
                </div>
                <div
                  className={cn(
                    "lore-hud-number mt-2 text-[1.9rem] font-black uppercase leading-none tracking-[0.10em] sm:text-[2.55rem]",
                    palette.accent,
                  )}
                  style={{ textShadow: `0 0 16px ${theme.colors.shadow}, 0 8px 24px rgba(0,0,0,0.96)` }}
                >
                  LINEA
                </div>
              </div>

              <div className="mt-4 flex flex-wrap justify-center gap-2">
                {activeTileId !== null && (
                  <div className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-full border border-white/13 bg-black/44 px-4 py-0">
                    <span className="text-[0.62rem] font-black uppercase leading-none tracking-[0.22em] text-white/48">
                      Tile
                    </span>
                    <span className={cn("lore-nums text-sm font-black leading-none", palette.accent)}>
                      #{activeTileId}
                    </span>
                  </div>
                )}
                {activeEpoch && (
                  <div className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-full border border-white/13 bg-black/44 px-4 py-0">
                    <span className="text-[0.62rem] font-black uppercase leading-none tracking-[0.22em] text-white/48">
                      Epoch
                    </span>
                    <span className="lore-nums text-sm font-black leading-none text-white/82">#{activeEpoch}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="flex w-full flex-col gap-2.5 pb-1 sm:flex-row sm:justify-center">
              <UiButton
                onClick={share}
                variant="ghost"
                size="md"
                className={cn(
                  "min-h-[2.8rem] min-w-[11rem] rounded-[0.85rem] border bg-linear-to-r px-6 py-3 text-[0.78rem] font-black uppercase tracking-[0.14em] text-white shadow-[0_0_24px_rgba(255,255,255,0.07)] transition hover:brightness-110 sm:min-h-12 sm:text-[0.86rem]",
                  palette.button,
                  palette.buttonBorder,
                )}
              >
                <span className="text-base font-bold">X</span>
                Share on X
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
            {JACKPOT_SPARKLES.map((sparkle) => (
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

            {JACKPOT_COINS.map((coin) => (
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
