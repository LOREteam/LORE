"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { TabId } from "../lib/types";
import type { NoticeItem, NoticeTone } from "../components/NoticeStack";
import { log } from "../lib/logger";

const VALID_TABS: TabId[] = ["hub", "analytics", "rebate", "leaderboards", "whitepaper", "faq"];
const HOT_TILES_STORAGE_KEY = "lore:hot-tiles:v1";
const ACTIVE_TAB_STORAGE_KEY = "lore:active-tab:v1";

type HotTile = { tileId: number; wins: number };

function loadSavedTab(): TabId | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(ACTIVE_TAB_STORAGE_KEY);
    return VALID_TABS.includes(raw as TabId) ? (raw as TabId) : null;
  } catch {
    return null;
  }
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

function loadCachedHotTiles(): HotTile[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(HOT_TILES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((item) => {
        const value = (item ?? {}) as Record<string, unknown>;
        const tileId = Number(value.tileId);
        const wins = Number(value.wins);
        if (!Number.isInteger(tileId) || tileId <= 0) return null;
        if (!Number.isInteger(wins) || wins <= 0) return null;
        return { tileId, wins };
      })
      .filter((item): item is HotTile => item !== null)
      .slice(0, 5);
  } catch {
    return [];
  }
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
    log.info("App", "mounted", { url: window.location.href, time: new Date().toISOString() });
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
    if (hotTiles.length === 0) return;
    setVisibleHotTiles((current) => {
      const unchanged =
        current.length === hotTiles.length &&
        current.every((item, index) =>
          item.tileId === hotTiles[index]?.tileId && item.wins === hotTiles[index]?.wins,
        );
      return unchanged ? current : hotTiles;
    });
    try {
      window.localStorage.setItem(HOT_TILES_STORAGE_KEY, JSON.stringify(hotTiles));
    } catch {
      // ignore storage write failures
    }
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

  return {
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
  };
}
