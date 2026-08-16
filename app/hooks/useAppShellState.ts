"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { TabId } from "../lib/types";
import type { NoticeItem, NoticeTone } from "../components/NoticeStack";
import { GRID_SIZE } from "../lib/constants";
import { log } from "../lib/logger";

const VALID_TABS: TabId[] = ["hub", "analytics", "rebate", "leaderboards", "whitepaper", "faq"];
export const HOT_TILES_STORAGE_KEY = "lore:hot-tiles:v1";
export const ACTIVE_TAB_STORAGE_KEY = "lore:active-tab:v1";
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

type HotTile = { tileId: number; wins: number };

function parsePositiveSafeInteger(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const parsed = BigInt(value);
  if (parsed > MAX_SAFE_INTEGER_BIGINT) return null;
  return Number(parsed);
}

export function normalizeCachedHotTile(item: unknown): HotTile | null {
  if (!item || typeof item !== "object") return null;
  const value = item as Record<string, unknown>;
  const tileId = parsePositiveSafeInteger(value.tileId);
  const wins = parsePositiveSafeInteger(value.wins);
  if (tileId === null || tileId > GRID_SIZE) return null;
  if (wins === null) return null;
  return { tileId, wins };
}

export function readSavedAppShellTab(
  storage: Pick<Storage, "getItem" | "removeItem">,
): TabId | null {
  try {
    const raw = storage.getItem(ACTIVE_TAB_STORAGE_KEY);
    if (raw === null) return null;
    if (VALID_TABS.includes(raw as TabId)) return raw as TabId;
    storage.removeItem(ACTIVE_TAB_STORAGE_KEY);
    return null;
  } catch {
    return null;
  }
}

function loadSavedTab(): TabId | null {
  if (typeof window === "undefined") return null;
  return readSavedAppShellTab(window.localStorage);
}

function readHashTab(): TabId {
  if (typeof window === "undefined") return "hub";
  const hash = window.location.hash.replace("#", "");
  if (VALID_TABS.includes(hash as TabId)) {
    return hash as TabId;
  }
  return loadSavedTab() ?? "hub";
}

function saveActiveTab(tab: TabId) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ACTIVE_TAB_STORAGE_KEY, tab);
  } catch {
    // ignore storage failures
  }
}

export function readCachedAppShellHotTiles(
  storage: Pick<Storage, "getItem" | "removeItem">,
): HotTile[] {
  try {
    const raw = storage.getItem(HOT_TILES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) {
      storage.removeItem(HOT_TILES_STORAGE_KEY);
      return [];
    }
    return parsed
      .map(normalizeCachedHotTile)
      .filter((item): item is HotTile => item !== null)
      .slice(0, 5);
  } catch {
    try {
      storage.removeItem(HOT_TILES_STORAGE_KEY);
    } catch {
      // ignore storage failures
    }
    return [];
  }
}

function loadCachedHotTiles(): HotTile[] {
  if (typeof window === "undefined") return [];
  return readCachedAppShellHotTiles(window.localStorage);
}

export function persistAppShellHotTiles(
  storage: Pick<Storage, "removeItem" | "setItem">,
  hotTiles: HotTile[],
): void {
  try {
    if (hotTiles.length === 0) {
      storage.removeItem(HOT_TILES_STORAGE_KEY);
      return;
    }
    storage.setItem(HOT_TILES_STORAGE_KEY, JSON.stringify(hotTiles));
  } catch {
    // ignore storage failures
  }
}

export function createAppMountDiagnostic(
  location: Pick<Location, "pathname">,
  tab: TabId,
  now = new Date(),
) {
  return { path: location.pathname, tab, time: now.toISOString() };
}

export function useAppShellState() {
  const [activeTab, setActiveTab] = useState<TabId>("hub");
  const [chatOpen, setChatOpen] = useState(false);
  const [isPageVisible, setIsPageVisible] = useState(true);
  const [isWalletSettingsOpen, setIsWalletSettingsOpen] = useState(false);
  const [backupGateVersion, setBackupGateVersion] = useState(0);
  const [visibleHotTiles, setVisibleHotTiles] = useState<HotTile[]>([]);
  const [notices, setNotices] = useState<NoticeItem[]>([]);
  const noticeIdRef = useRef(1);
  const noticeTimeoutsRef = useRef<Map<number, number>>(new Map());

  useEffect(() => {
    log.info("App", "mounted", createAppMountDiagnostic(window.location, readHashTab()));
    const syncFromHash = () => {
      setActiveTab((current) => {
        const next = readHashTab();
        return current === next ? current : next;
      });
    };
    window.addEventListener("hashchange", syncFromHash);
    window.addEventListener("popstate", syncFromHash);

    return () => {
      window.removeEventListener("hashchange", syncFromHash);
      window.removeEventListener("popstate", syncFromHash);
    };
  }, []);

  useEffect(() => {
    const noticeTimeouts = noticeTimeoutsRef.current;
    return () => {
      for (const timeoutId of noticeTimeouts.values()) {
        clearTimeout(timeoutId);
      }
      noticeTimeouts.clear();
    };
  }, []);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibility = () => setIsPageVisible(document.visibilityState === "visible");
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  const handleTabChange = useCallback((tab: TabId) => {
    setActiveTab(tab);
    saveActiveTab(tab);
    const newHash = tab === "hub" ? "" : `#${tab}`;
    history.replaceState(null, "", window.location.pathname + newHash);
  }, []);

  useLayoutEffect(() => {
    setActiveTab((current) => {
      const next = readHashTab();
      return current === next ? current : next;
    });
    setVisibleHotTiles(loadCachedHotTiles());
  }, []);

  const syncHotTiles = useCallback((hotTiles: HotTile[]) => {
    if (hotTiles.length === 0) {
      setVisibleHotTiles((current) => (current.length === 0 ? current : []));
      persistAppShellHotTiles(window.localStorage, hotTiles);
      return;
    }
    setVisibleHotTiles((current) => {
      const unchanged =
        current.length === hotTiles.length &&
        current.every((item, index) =>
          item.tileId === hotTiles[index]?.tileId && item.wins === hotTiles[index]?.wins,
        );
      return unchanged ? current : hotTiles;
    });
    persistAppShellHotTiles(window.localStorage, hotTiles);
  }, []);

  const dismissNotice = useCallback((id: number) => {
    const timeoutId = noticeTimeoutsRef.current.get(id);
    if (timeoutId) {
      clearTimeout(timeoutId);
      noticeTimeoutsRef.current.delete(id);
    }
    setNotices((current) => current.filter((notice) => notice.id !== id));
  }, []);

  const notify = useCallback((message: string, tone: NoticeTone = "info") => {
    const id = noticeIdRef.current++;
    setNotices((current) => [...current.slice(-3), { id, message, tone }]);
    const timeoutId = window.setTimeout(() => {
      noticeTimeoutsRef.current.delete(id);
      setNotices((current) => current.filter((notice) => notice.id !== id));
    }, tone === "danger" ? 7000 : 5000);
    noticeTimeoutsRef.current.set(id, timeoutId);
  }, []);

  const openWalletSettings = useCallback(() => setIsWalletSettingsOpen(true), []);
  const closeWalletSettings = useCallback(() => setIsWalletSettingsOpen(false), []);
  const handleBackupConfirm = useCallback(() => setBackupGateVersion((value) => value + 1), []);

  return useMemo(
    () => ({
      activeTab,
      chatOpen,
      isPageVisible,
      isWalletSettingsOpen,
      backupGateVersion,
      visibleHotTiles,
      notices,
      setChatOpen,
      handleTabChange,
      dismissNotice,
      notify,
      syncHotTiles,
      openWalletSettings,
      closeWalletSettings,
      handleBackupConfirm,
    }),
    [
      activeTab,
      chatOpen,
      isPageVisible,
      isWalletSettingsOpen,
      backupGateVersion,
      visibleHotTiles,
      notices,
      setChatOpen,
      handleTabChange,
      dismissNotice,
      notify,
      syncHotTiles,
      openWalletSettings,
      closeWalletSettings,
      handleBackupConfirm,
    ],
  );
}
