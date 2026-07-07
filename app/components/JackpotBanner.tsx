"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatUnits, parseAbiItem, type PublicClient } from "viem";
import { usePublicClient } from "wagmi";
import { cn } from "../lib/cn";
import { APP_CHAIN_ID, CONTRACT_ADDRESS, CONTRACT_DEPLOY_BLOCK } from "../lib/constants";
import { getJackpotVisualTheme, resolveJackpotVisualKind, type JackpotVisualKind } from "../lib/jackpotVisualTheme";
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
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

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
  amount: number;
  epoch: string | null;
  tileId: number | null;
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

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter((element) => {
    if (element.hasAttribute("disabled")) return false;
    if (element.getAttribute("aria-hidden") === "true") return false;
    return element.offsetParent !== null || document.activeElement === element;
  });
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
  const [indexedJackpotAmount, setIndexedJackpotAmount] = useState(0);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dismissedWinKeyRef = useRef<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const titleId = React.useId();
  const publicClient = usePublicClient({ chainId: APP_CHAIN_ID });

  const isMyWin = useMemo(() => {
    if (hasMyWinningBet) return true;
    if (winningTileId === null) return false;
    return tileViewData.some((t) => t.tileId === winningTileId && t.hasMyBet);
  }, [hasMyWinningBet, tileViewData, winningTileId]);

  const isJackpotWin = isMyWin && (isDailyJackpot || isWeeklyJackpot);
  const candidateKind = isJackpotWin ? resolveJackpotVisualKind(isDailyJackpot, isWeeklyJackpot) : null;
  const kindFallbackAmount =
    candidateKind === "dual"
      ? dailyJackpotFallbackAmount + weeklyJackpotFallbackAmount
      : candidateKind === "daily"
        ? dailyJackpotFallbackAmount
        : candidateKind === "weekly"
          ? weeklyJackpotFallbackAmount
          : 0;
  const displayJackpotAmount = jackpotAmount > 0
    ? jackpotAmount
    : kindFallbackAmount > 0
      ? kindFallbackAmount
      : jackpotFallbackAmount > 0 && candidateKind === "dual"
      ? jackpotFallbackAmount
      : indexedJackpotAmount;
  const candidateWinKey = useMemo(() => {
    if (!candidateKind) return null;
    return [
      epoch ?? "unknown",
      winningTileId ?? "none",
      candidateKind,
    ].join(":");
  }, [candidateKind, epoch, winningTileId]);
  const readyWin = useMemo<ActiveJackpotWin | null>(() => {
    if (!candidateKind || !candidateWinKey || displayJackpotAmount <= 0) return null;
    return {
      key: candidateWinKey,
      kind: candidateKind,
      amount: displayJackpotAmount,
      epoch,
      tileId: winningTileId,
    };
  }, [candidateKind, candidateWinKey, displayJackpotAmount, epoch, winningTileId]);

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
    setIndexedJackpotAmount(0);
  }, [candidateWinKey]);

  useEffect(() => {
    if (!candidateWinKey || displayJackpotAmount > 0 || !epoch) return;
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
  }, [candidateWinKey, displayJackpotAmount, epoch, isDailyJackpot, isWeeklyJackpot, publicClient]);

  useEffect(() => {
    if (!readyWin) {
      if (openTimerRef.current) {
        clearTimeout(openTimerRef.current);
        openTimerRef.current = null;
      }
      return;
    }
    if (activeWin?.key === readyWin.key) {
      if (activeWin.amount !== readyWin.amount) setActiveWin(readyWin);
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
  const activeAmount = activeWin?.amount ?? 0;
  const activeEpoch = activeWin?.epoch ?? null;
  const activeTileId = activeWin?.tileId ?? null;
  const amountText = activeAmount > 0
    ? activeAmount.toLocaleString("en-US", { maximumFractionDigits: 4 })
    : null;
  const amountShareText = amountText ? `${amountText} LINEA` : "";
  const isModalOpen = showBanner && !isDismissed && Boolean(activeWin) && Boolean(amountText);

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
    const dialog = dialogRef.current;
    if (!overlay || !dialog) return;

    restoreFocusRef.current =
      typeof document !== "undefined" && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const disabledElements = getElementsOutsideDialog(overlay).map((element) => ({
      element,
      ariaHidden: element.getAttribute("aria-hidden"),
      inert: element.inert,
    }));
    for (const { element } of disabledElements) {
      element.inert = true;
      element.setAttribute("aria-hidden", "true");
    }

    const focusInitial = window.requestAnimationFrame(() => {
      const focusable = getFocusableElements(dialog);
      (focusable[0] ?? dialog).focus();
    });

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        handleClose();
        return;
      }

      if (event.key !== "Tab") return;
      const focusable = getFocusableElements(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;

      if (event.shiftKey) {
        if (!active || active === first || !dialog.contains(active)) {
          event.preventDefault();
          last.focus();
        }
        return;
      }

      if (!active || active === last || !dialog.contains(active)) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(focusInitial);
      document.removeEventListener("keydown", onKey);
      for (const { element, ariaHidden, inert } of disabledElements) {
        element.inert = inert;
        if (ariaHidden === null) {
          element.removeAttribute("aria-hidden");
        } else {
          element.setAttribute("aria-hidden", ariaHidden);
        }
      }
      restoreFocusRef.current?.focus();
      restoreFocusRef.current = null;
    };
  }, [handleClose, isModalOpen]);

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
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
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
            className="absolute right-3 top-3 z-20 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/12 bg-black/42 text-lg text-white/72 transition hover:bg-black/58 hover:text-white active:scale-95 focus-visible:ring-2 focus-visible:ring-white/50 sm:right-5 sm:top-5"
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
