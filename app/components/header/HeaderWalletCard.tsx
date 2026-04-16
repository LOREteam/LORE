"use client";

import React from "react";
import { getConfiguredLineaNetwork, getLineaExplorerAddressBaseUrl } from "../../../config/publicConfig";
import { shortenAddress } from "../../lib/utils";
import { UiButton } from "../ui/UiButton";

interface HeaderWalletCardProps {
  authenticated: boolean;
  embeddedWalletAddress: string | null;
  embeddedWalletSyncing: boolean;
  embeddedAddressCopied: boolean;
  onCopyEmbeddedAddress: () => void;
  onLogin: () => void;
  onLogout: () => void;
  onOpenWalletSettings: () => void;
  privyEthBalance: string;
  privyEthBalanceLoading: boolean;
  privyTokenBalance: string;
  privyTokenBalanceLoading: boolean;
}

function HeaderWalletActions({
  onLogout,
  onOpenWalletSettings,
}: Pick<HeaderWalletCardProps, "onLogout" | "onOpenWalletSettings">) {
  return (
    <div className="flex gap-1 p-1 border-b border-violet-500/15 bg-[#0d0d1a]">
      <UiButton
        onClick={onOpenWalletSettings}
        variant="secondary"
        size="sm"
        uppercase
        className="flex-[2] min-w-0 px-2 py-1 rounded-md text-[10px] tracking-[0.08em]"
      >
        Settings
      </UiButton>
      <UiButton
        onClick={onLogout}
        variant="ghost"
        size="sm"
        uppercase
        className="flex-1 min-w-0 px-2 py-1 rounded-md text-[9px] tracking-[0.08em] text-gray-500 hover:bg-red-500/10 hover:border-red-500/20 hover:text-red-400"
        title="Log out (use carefully)"
      >
        Out
      </UiButton>
    </div>
  );
}

export function HeaderWalletCard({
  authenticated,
  embeddedWalletAddress,
  embeddedWalletSyncing,
  embeddedAddressCopied,
  onCopyEmbeddedAddress,
  onLogin,
  onLogout,
  onOpenWalletSettings,
  privyEthBalance,
  privyEthBalanceLoading,
  privyTokenBalance,
  privyTokenBalanceLoading,
}: HeaderWalletCardProps) {
  const explorerAddressBaseUrl = getLineaExplorerAddressBaseUrl(getConfiguredLineaNetwork());
  const explorerAddressUrl = embeddedWalletAddress
    ? `${explorerAddressBaseUrl}/${embeddedWalletAddress}`
    : null;

  return (
    <div id="header-wallet-card" className="min-[900px]:col-span-3 min-[900px]:h-[90px] min-w-0 flex flex-col rounded-xl border border-violet-500/10 bg-[#0d0d1a] shadow-[0_0_16px_rgba(139,92,246,0.05)] overflow-hidden animate-slide-up" style={{ animationDelay: "0.15s" }}>
      {!authenticated ? (
        <UiButton
          onClick={onLogin}
          variant="primary"
          size="md"
          fullWidth
          uppercase
          className="h-full min-h-[64px] px-4 py-2 text-[10px] tracking-[0.08em] text-white bg-gradient-to-r from-violet-600 to-indigo-600 border-violet-500/35 hover:from-violet-500 hover:to-indigo-500 shadow-lg shadow-violet-500/20 shimmer-btn"
        >
          Login / Connect
        </UiButton>
      ) : embeddedWalletAddress ? (
        <>
          <HeaderWalletActions onLogout={onLogout} onOpenWalletSettings={onOpenWalletSettings} />
          <div className="flex-1 min-h-0 px-3 py-1 bg-violet-500/[0.06] flex flex-col gap-0.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-gray-400 font-bold uppercase tracking-[0.08em]">Privy</span>
              <span className="text-[10px] font-bold uppercase tracking-[0.08em] flex items-center gap-1 text-emerald-400">
                <span className="w-1 h-1 rounded-full bg-emerald-400 animate-synced-pulse" />
                Active
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={onCopyEmbeddedAddress}
                className={embeddedAddressCopied ? "text-[11px] font-mono font-bold text-emerald-300 drop-shadow-[0_0_10px_rgba(52,211,153,0.3)] leading-tight transition-colors duration-200 flex items-center gap-1 group animate-pulse" : "text-[11px] font-mono font-bold text-emerald-400 drop-shadow-[0_0_6px_rgba(52,211,153,0.2)] leading-tight hover:text-emerald-300 transition-colors flex items-center gap-1 group"}
                title={embeddedAddressCopied ? "Copied" : "Copy address"}
              >
                {embeddedAddressCopied ? "Copied" : shortenAddress(embeddedWalletAddress)}
                {embeddedAddressCopied ? (
                  <svg className="w-2.5 h-2.5 text-emerald-300 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="w-2.5 h-2.5 text-emerald-400/40 group-hover:text-emerald-300 transition-colors shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <rect x="9" y="9" width="13" height="13" rx="2" />
                    <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
                  </svg>
                )}
              </button>
              {explorerAddressUrl && (
                <a
                  href={explorerAddressUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center justify-center text-emerald-400/40 transition-colors hover:text-emerald-300 shrink-0"
                  title="Open wallet in explorer"
                >
                  <svg className="w-2.5 h-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M14 3h7v7" />
                    <path d="M10 14 21 3" />
                    <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
                  </svg>
                </a>
              )}
            </div>
            <div className="flex flex-col items-start gap-0.5 text-[11px] leading-tight min-[420px]:flex-row min-[420px]:items-center min-[420px]:justify-between">
              <span className="lore-nums text-gray-400">
                {privyEthBalanceLoading ? <span className="inline-block h-3 w-12 animate-pulse rounded bg-white/10" /> : privyEthBalance}<span className="text-gray-500 font-medium"> ETH</span>
              </span>
              <span className="lore-nums text-white font-bold">
                {privyTokenBalanceLoading ? <span className="inline-block h-3 w-16 animate-pulse rounded bg-white/10" /> : privyTokenBalance}<span className="text-gray-500 font-medium"> LINEA</span>
              </span>
            </div>
          </div>
        </>
      ) : embeddedWalletSyncing ? (
        <>
          <HeaderWalletActions onLogout={onLogout} onOpenWalletSettings={onOpenWalletSettings} />
          <div className="flex-1 min-h-0 px-3 py-1 bg-violet-500/[0.06] flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-gray-400 font-bold uppercase tracking-[0.08em]">Privy</span>
              <span className="text-[10px] font-bold uppercase tracking-[0.08em] flex items-center gap-1 text-violet-300/90">
                <span className="w-1 h-1 rounded-full bg-violet-300 animate-pulse" />
                Syncing
              </span>
            </div>
            <p className="text-[10px] text-gray-500 leading-tight">
              Restoring embedded wallet session...
            </p>
          </div>
        </>
      ) : (
        <>
          <HeaderWalletActions onLogout={onLogout} onOpenWalletSettings={onOpenWalletSettings} />
          <div className="flex-1 min-h-0 px-3 py-1 bg-violet-500/[0.06] flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-gray-400 font-bold uppercase tracking-[0.08em]">Privy</span>
              <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-amber-400/90">Not created</span>
            </div>
            <p className="text-[10px] text-gray-500 leading-tight">
              Create embedded wallet in Settings to play and receive rewards.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
