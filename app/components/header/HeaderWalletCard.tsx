"use client";

import { getExplorerAddressUrl } from "../../lib/explorerLinks";
import { shortenAddress } from "../../lib/utils";
import {
  PRIVY_LOGIN_ACCESSIBLE_NAME,
  type PrivyLoginUiState,
} from "../../hooks/usePrivyLoginAccessibility";
import {
  UNKNOWN_WALLET_BALANCE_DATA_STATUS,
  type WalletBalanceDataStatus,
} from "../../lib/walletBalanceDataStatus";
import { UiButton } from "../ui/UiButton";

interface HeaderWalletCardProps {
  authenticated: boolean;
  loginState: PrivyLoginUiState;
  embeddedWalletAddress: string | null;
  embeddedWalletSyncing: boolean;
  embeddedAddressCopied: boolean;
  onCopyEmbeddedAddress: () => void;
  onLogin: (trigger: HTMLButtonElement, focusFallback?: HTMLElement | null) => void;
  onLogout: () => void;
  onOpenWalletSettings: () => void;
  privyEthBalance: string;
  privyEthBalanceStatus?: WalletBalanceDataStatus;
  privyTokenBalance: string;
  privyTokenBalanceStatus?: WalletBalanceDataStatus;
}

function HeaderWalletActions({
  onLogout,
  onOpenWalletSettings,
}: Pick<HeaderWalletCardProps, "onLogout" | "onOpenWalletSettings">) {
  return (
    <div className="flex gap-1 p-1 border-b border-violet-500/15 bg-surface-raised">
      <UiButton
        onClick={onOpenWalletSettings}
        variant="secondary"
        size="sm"
        uppercase
        className="flex-2 min-h-11 min-w-0 rounded-md px-2 text-[11px] tracking-[0.08em] focus-visible:ring-2 focus-visible:ring-violet-300/70"
      >
        Settings
      </UiButton>
      <UiButton
        onClick={onLogout}
        variant="ghost"
        size="sm"
        uppercase
        className="flex-1 min-h-11 min-w-0 rounded-md px-2 text-[11px] tracking-[0.08em] text-gray-300 hover:border-red-500/30 hover:bg-red-500/10 hover:text-red-300 focus-visible:ring-2 focus-visible:ring-red-300/70"
        title="Log out (use carefully)"
      >
        Out
      </UiButton>
    </div>
  );
}
type HeaderWalletBalanceState = "error" | "loading" | "refreshing" | "ready" | "stale" | "unavailable";

export function formatHeaderWalletBalanceUpdatedAt(updatedAt: number | null): string | null {
  if (!updatedAt || !Number.isSafeInteger(updatedAt) || updatedAt <= 0) return null;
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.toISOString().slice(11, 16)} UTC`;
}

export function getHeaderWalletBalancePresentation(
  asset: "ETH" | "LINEA",
  value: string,
  status: WalletBalanceDataStatus,
): {
  state: HeaderWalletBalanceState;
  text: string;
  suffix: string;
  label: string;
} {
  const hasKnownValue = Boolean(value.trim() && value !== "—");
  if (status.error) {
    return {
      state: "error",
      text: hasKnownValue ? value : "Error",
      suffix: asset,
      label: hasKnownValue
        ? `${asset} balance RPC error; showing last known ${value}`
        : `${asset} balance unavailable after RPC error`,
    };
  }
  if (status.fetching && hasKnownValue) {
    return {
      state: "refreshing",
      text: value,
      suffix: asset,
      label: `${asset} balance refreshing; showing last known ${value}`,
    };
  }
  if (status.fetching) {
    return { state: "loading", text: "", suffix: asset, label: `${asset} balance loading` };
  }
  if (status.stale && hasKnownValue) {
    return {
      state: "stale",
      text: value,
      suffix: asset,
      label: `${asset} balance stale; showing last known ${value}`,
    };
  }
  if (!value.trim() || value === "—") {
    return { state: "unavailable", text: "Unavailable", suffix: asset, label: `${asset} balance unavailable` };
  }
  return { state: "ready", text: value, suffix: asset, label: `${asset} balance ${value}` };
}
export function HeaderWalletCard({
  authenticated,
  loginState,
  embeddedWalletAddress,
  embeddedWalletSyncing,
  embeddedAddressCopied,
  onCopyEmbeddedAddress,
  onLogin,
  onLogout,
  onOpenWalletSettings,
  privyEthBalance,
  privyEthBalanceStatus = UNKNOWN_WALLET_BALANCE_DATA_STATUS,
  privyTokenBalance,
  privyTokenBalanceStatus = UNKNOWN_WALLET_BALANCE_DATA_STATUS,
}: HeaderWalletCardProps) {
  const explorerAddressUrl = getExplorerAddressUrl(embeddedWalletAddress);
  const ethBalancePresentation = getHeaderWalletBalancePresentation("ETH", privyEthBalance, privyEthBalanceStatus);
  const tokenBalancePresentation = getHeaderWalletBalancePresentation("LINEA", privyTokenBalance, privyTokenBalanceStatus);
  const ethUpdatedAt = formatHeaderWalletBalanceUpdatedAt(privyEthBalanceStatus.updatedAt);
  const tokenUpdatedAt = formatHeaderWalletBalanceUpdatedAt(privyTokenBalanceStatus.updatedAt);
  const ethBalanceClass = ethBalancePresentation.state === "error"
    ? "font-semibold text-red-100"
    : ethBalancePresentation.state === "unavailable"
      ? "font-semibold text-amber-100"
      : ethBalancePresentation.state === "refreshing" || ethBalancePresentation.state === "stale"
        ? "text-amber-200/90"
        : "text-gray-400";
  const tokenBalanceClass = tokenBalancePresentation.state === "error"
    ? "text-red-100"
    : tokenBalancePresentation.state === "unavailable"
      ? "text-amber-200/85"
      : tokenBalancePresentation.state === "refreshing" || tokenBalancePresentation.state === "stale"
        ? "text-amber-100"
        : "text-white";
  const showLoginReload = Boolean(
    loginState.error && (loginState.error.includes("still loading") || loginState.error.includes("timed out")),
  );

  return (
    <div
      id="header-wallet-card"
      data-privy-login-focus-root
      role="group"
      aria-label={authenticated ? "Wallet account" : "Wallet login"}
      tabIndex={-1}
      className="min-[900px]:col-span-3 min-[900px]:min-h-22.5 min-w-0 flex flex-col rounded-xl border border-violet-500/10 bg-surface-raised shadow-[0_0_16px_rgba(139,92,246,0.05)] overflow-hidden"
    >
      {!authenticated ? (
        <div className="flex h-full min-h-14 flex-col justify-center gap-1 p-1">
          <span id="header-privy-login-status" className="sr-only" role="status" aria-live="polite" aria-atomic="true">
            {loginState.statusAnnouncement}
          </span>
          <UiButton
            id="header-privy-login-trigger"
            onClick={(event) => onLogin(event.currentTarget, event.currentTarget.closest<HTMLElement>("[data-privy-login-focus-root]"))}
            aria-label={PRIVY_LOGIN_ACCESSIBLE_NAME}
            aria-describedby="header-privy-login-status"
            aria-haspopup="dialog"
            aria-expanded={loginState.modalOpen}
            aria-busy={loginState.busy}
            disabled={loginState.disabled}
            title={
              !loginState.error && loginState.modalOpen
                ? "Wallet login dialog is open"
                : loginState.error
                  ? loginState.error
                  : loginState.busy
                ? "Wallet login is still loading"
                : "Open wallet login"
            }
            variant={!loginState.disabled ? "secondary" : "pending"}
            size="md"
            fullWidth
            uppercase
            className="h-12 min-h-12 rounded-xl border-violet-300/14 bg-linear-to-r from-violet-700/38 via-violet-600/32 to-indigo-600/38 px-4 py-2 text-[11px] font-black tracking-[0.1em] text-violet-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.055)] hover:border-violet-300/24 hover:from-violet-600/46 hover:via-violet-500/38 hover:to-indigo-500/46 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_18px_rgba(124,58,237,0.12)]"
          >
            {loginState.buttonText}
          </UiButton>
          {loginState.error && (
            <div
              role="status"
              aria-live="polite"
              className="flex min-h-11 items-center justify-center gap-2 px-1"
            >
              <p className="min-w-0 truncate text-center text-[11px] font-semibold leading-tight text-red-300/90">
                {loginState.error}
              </p>
              {showLoginReload && (
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  aria-label="Reload page to retry wallet login"
                  title="Reload page to retry wallet login"
                  className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded border border-red-300/20 px-3 py-1 text-[9px] font-black uppercase tracking-[0.08em] text-red-100 outline-none transition-colors hover:border-red-300/35 hover:bg-red-400/10 focus-visible:ring-2 focus-visible:ring-red-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-[#090914]"
                >
                  Reload
                </button>
              )}
            </div>
          )}
        </div>
      ) : embeddedWalletAddress ? (
        <>
          <HeaderWalletActions onLogout={onLogout} onOpenWalletSettings={onOpenWalletSettings} />
          <div className="flex-1 min-h-0 px-3 py-1 bg-violet-500/6 flex flex-col gap-0.5">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-gray-400 font-bold uppercase tracking-[0.08em]">Privy</span>
              <span className="text-[11px] font-bold uppercase tracking-[0.08em] flex items-center gap-1 text-emerald-400">
                <span className="w-1 h-1 rounded-full bg-emerald-400" />
                Active
              </span>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={onCopyEmbeddedAddress}
                aria-label={embeddedAddressCopied ? "Privy wallet address copied" : "Copy Privy wallet address"}
                className={embeddedAddressCopied ? "group inline-flex min-h-11 items-center gap-1 rounded px-2 text-[11px] font-mono font-bold leading-tight text-emerald-200 drop-shadow-[0_0_10px_rgba(52,211,153,0.3)] transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-emerald-300/70" : "group inline-flex min-h-11 items-center gap-1 rounded px-2 text-[11px] font-mono font-bold leading-tight text-emerald-300 drop-shadow-[0_0_6px_rgba(52,211,153,0.2)] transition-colors hover:text-emerald-200 focus-visible:ring-2 focus-visible:ring-emerald-300/70"}
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
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded text-emerald-300 transition-colors hover:text-emerald-200 focus-visible:ring-2 focus-visible:ring-emerald-300/70"
                  aria-label="Open Privy wallet address in explorer"
                  title="Open wallet in explorer"
                >
                  <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
                    <path d="M14 3h7v7" />
                    <path d="M10 14 21 3" />
                    <path d="M21 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5" />
                  </svg>
                </a>
              )}
            </div>
            <div className="flex flex-col items-start gap-0.5 text-[11px] leading-tight min-[420px]:flex-row min-[420px]:items-center min-[420px]:justify-between">
              <span
                aria-label={ethBalancePresentation.label}
                className={`lore-nums ${ethBalanceClass}`}
                data-balance-state={ethBalancePresentation.state}
                title={ethBalancePresentation.label}
              >
                {ethBalancePresentation.state === "loading" ? <span className="inline-block h-3 w-12 animate-pulse rounded bg-white/10" /> : ethBalancePresentation.text}<span className="text-gray-300 font-medium"> {ethBalancePresentation.suffix}</span>
                {ethBalancePresentation.state === "refreshing" && <span className="ml-1 text-[11px] font-bold uppercase tracking-[0.06em] text-amber-100">Refreshing</span>}
                {ethBalancePresentation.state === "stale" && <span className="ml-1 text-[11px] font-bold uppercase tracking-[0.06em] text-amber-100">Stale</span>}
                {ethBalancePresentation.state === "error" && <span className="ml-1 text-[11px] font-bold uppercase tracking-[0.06em] text-red-100">RPC error</span>}
              </span>
              <span
                aria-label={tokenBalancePresentation.label}
                className={`lore-nums text-[13px] font-black leading-none min-[900px]:text-sm ${tokenBalanceClass}`}
                data-balance-state={tokenBalancePresentation.state}
                title={tokenBalancePresentation.label}
              >
                {tokenBalancePresentation.state === "loading" ? <span className="inline-block h-3 w-16 animate-pulse rounded bg-white/10" /> : tokenBalancePresentation.text}<span className="text-[11px] font-medium text-gray-300"> {tokenBalancePresentation.suffix}</span>
                {tokenBalancePresentation.state === "refreshing" && <span className="ml-1 text-[11px] font-bold uppercase tracking-[0.06em] text-amber-100">Refreshing</span>}
                {tokenBalancePresentation.state === "stale" && <span className="ml-1 text-[11px] font-bold uppercase tracking-[0.06em] text-amber-100">Stale</span>}
                {tokenBalancePresentation.state === "error" && <span className="ml-1 text-[11px] font-bold uppercase tracking-[0.06em] text-red-100">RPC error</span>}
              </span>
            </div>
            {(ethUpdatedAt || tokenUpdatedAt) && (
              <p className="text-[11px] font-semibold tracking-[0.04em] text-gray-300" data-balance-last-updated>
                Last updated: {ethUpdatedAt && `ETH ${ethUpdatedAt}`}{ethUpdatedAt && tokenUpdatedAt && " · "}{tokenUpdatedAt && `LINEA ${tokenUpdatedAt}`}
              </p>
            )}
          </div>
        </>
      ) : embeddedWalletSyncing ? (
        <>
          <HeaderWalletActions onLogout={onLogout} onOpenWalletSettings={onOpenWalletSettings} />
          <div className="flex-1 min-h-0 px-3 py-1 bg-violet-500/6 flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-gray-400 font-bold uppercase tracking-[0.08em]">Privy</span>
              <span className="text-[11px] font-bold uppercase tracking-[0.08em] flex items-center gap-1 text-violet-300/90">
                <span className="w-1 h-1 rounded-full bg-violet-300" />
                Syncing
              </span>
            </div>
            <p className="text-[11px] text-gray-300 leading-tight">
              Restoring embedded wallet session...
            </p>
          </div>
        </>
      ) : (
        <>
          <HeaderWalletActions onLogout={onLogout} onOpenWalletSettings={onOpenWalletSettings} />
          <div className="flex-1 min-h-0 px-3 py-1 bg-violet-500/6 flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-gray-400 font-bold uppercase tracking-[0.08em]">Privy</span>
              <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-amber-400/90">Not created</span>
            </div>
            <p className="text-[11px] text-gray-300 leading-tight">
              Create embedded wallet in Settings to play and receive rewards.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
