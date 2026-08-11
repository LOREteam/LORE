import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export function runWalletPresentationTests() {
  const walletSettingsModalSource = readFileSync("app/components/WalletSettingsModal.tsx", "utf8");
  const betPanelSource = readFileSync("app/components/BetPanel.tsx", "utf8");
  assert.match(
    betPanelSource,
    /className="console-input lore-nums h-11 px-3 text-base font-black"/,
    "manual bet amount input must use the shared numeric font class and 44px touch height",
  );
  const hubSidePanelSourceForTypography = readFileSync("app/components/HubSidePanel.tsx", "utf8");
  assert.match(
    hubSidePanelSourceForTypography,
    /value=\{manualBetForm\.betAmount\}[\s\S]*lore-nums h-11 w-full[\s\S]*tabular-nums/,
    "mobile compact manual bet amount input must use the shared numeric font class",
  );
  assert.match(
    hubSidePanelSourceForTypography,
    /aria-label="Exact total stake"[\s\S]*lore-nums[\s\S]*tabular-nums[\s\S]*\{exactTotal \?\? "Unavailable"\} LINEA/,
    "mobile compact manual bet total must use the shared numeric font class",
  );
  assert.match(
    betPanelSource,
    /SmallInput[\s\S]*console-input lore-nums/,
    "auto-miner numeric inputs must keep the shared numeric font class",
  );
  assert.match(
    betPanelSource,
    /data-testid="manual-bet-action"/,
    "manual bet primary action must expose a stable smoke-test selector",
  );
  assert.match(
    betPanelSource,
    /manualButtonDescriptionId[\s\S]*manual-bet-readonly-reason[\s\S]*manual-bet-insufficient-reason[\s\S]*bet-amount-per-tile-error[\s\S]*manual-bet-status[\s\S]*manual-bet-disabled-reason[\s\S]*aria-describedby=\{manualButtonDescriptionId\}/,
    "manual bet primary action must only reference a visible disabled/status reason",
  );
  assert.match(
    betPanelSource,
    /Bet network fee[\s\S]*feeEstimateUnavailable[\s\S]*Unavailable/,
    "desktop manual bet must show the live fee estimate or an explicit unavailable state",
  );
  assert.match(
    betPanelSource,
    /data-testid="auto-miner-action"/,
    "auto-miner primary action must expose a stable smoke-test selector",
  );
  assert.match(
    betPanelSource,
    /top up \{lineaDeficitDisplay\} LINEA/,
    "auto-miner insufficient-balance copy must show the exact LINEA top-up deficit",
  );
  assert.match(
    betPanelSource,
    /aria-describedby=\{autoAction\.disabled && disabledReason && !isAutoMining \? "auto-miner-disabled-reason" : undefined\}/,
    "auto-miner disabled reason must be associated with the disabled primary action",
  );
  assert.match(
    betPanelSource,
    /manualAnnouncement[\s\S]*role="status" aria-live="polite" aria-atomic="true"[\s\S]*\{manualAnnouncement\}/,
    "manual bet state transitions must be announced without relying on visible text changes",
  );
  assert.match(
    betPanelSource,
    /autoMinerAnnouncement[\s\S]*role="status" aria-live="polite" aria-atomic="true"[\s\S]*\{autoMinerAnnouncement\}/,
    "auto-miner phase transitions must be announced without reading every progress update",
  );
  assert.match(
    betPanelSource,
    /showAutoMineProgress[\s\S]*autoMinePhase === "retry-wait"[\s\S]*autoMinePhase === "session-expired"/,
    "auto-miner recovery states must keep the progress message visible after the active loop pauses",
  );
  assert.match(
    betPanelSource,
    /showAutoMineProgress && phaseProgressText/,
    "auto-miner progress card must use the shared recovery progress visibility guard",
  );
  const walletTransferRowSource = readFileSync("app/components/wallet/WalletTransferRow.tsx", "utf8");
  assert.match(
    walletTransferRowSource,
    /className="lore-nums h-8 min-w-0 px-4 py-1\.5 text-sm"/,
    "wallet transfer amount inputs must use the shared numeric font class",
  );
  assert.match(
    walletTransferRowSource,
    /maxLength=\{20\}/,
    "wallet transfer amount inputs must keep the same bounded length as manual bet amount input",
  );
  assert.match(
    walletTransferRowSource,
    /onChange\(e\.target\.value\.slice\(0, 20\)\)/,
    "wallet transfer amount changes must clamp pasted values before state update",
  );
  const walletTransferPanelsSource = readFileSync("app/components/wallet/WalletSettingsTransferPanels.tsx", "utf8");
  assert.match(
    walletTransferPanelsSource,
    /lore-nums[\s\S]*totalIn/,
    "wallet transfer summary totals must use the shared numeric font class",
  );
  assert.match(
    walletTransferPanelsSource,
    /walletTransfers\.totalInDisplay[\s\S]*walletTransfers\.totalOutDisplay/,
    "wallet transfer summary totals must render bigint-safe display strings",
  );
  assert.doesNotMatch(
    walletTransferPanelsSource,
    /walletTransfers\.(?:totalIn|totalOut)\.toFixed\(2\)/,
    "wallet transfer summary totals must not format numeric compatibility fields for display",
  );
  assert.match(
    walletTransferPanelsSource,
    /transferHistoryLoadLabel[\s\S]*role="status"[\s\S]*aria-live="polite"[\s\S]*aria-label=\{transferHistoryLoadLabel\}[\s\S]*title=\{transferHistoryLoadLabel\}/,
    "wallet transfer history load action must expose a state-aware label and polite loading status",
  );
  assert.match(
    walletTransferPanelsSource,
    /role="list"[\s\S]*aria-label="LINEA transfer history"[\s\S]*explorerLabel[\s\S]*role="listitem"[\s\S]*aria-label=\{explorerLabel\}[\s\S]*title=\{explorerLabel\}/,
    "wallet transfer history rows must expose list semantics and clear Lineascan link labels",
  );
  const pendingTxPanelSource = readFileSync("app/components/wallet/WalletSettingsPendingTxPanel.tsx", "utf8");
  assert.match(
    pendingTxPanelSource,
    /Check latest and pending nonces/,
    "pending tx check action must explain what it inspects",
  );
  assert.match(
    pendingTxPanelSource,
    /checkPendingTxLabel[\s\S]*clearPendingTxLabel[\s\S]*aria-label=\{checkPendingTxLabel\}[\s\S]*title=\{checkPendingTxLabel\}[\s\S]*aria-label=\{clearPendingTxLabel\}[\s\S]*title=\{clearPendingTxLabel\}/,
    "pending tx check and clear actions must expose state-aware accessible labels and titles",
  );
  assert.match(
    pendingTxPanelSource,
    /role="status"[\s\S]*aria-live="polite"[\s\S]*aria-atomic="true"[\s\S]*aria-busy=\{isRefreshingPendingTx \|\| isCancellingPendingTx\}/,
    "pending tx panel must announce nonce blocker status and busy state to assistive technology",
  );
  assert.match(
    pendingTxPanelSource,
    /const isPendingTxActionBusy = isRefreshingPendingTx \|\| isCancellingPendingTx/,
    "pending tx check and clear actions must share one busy guard to avoid overlapping nonce operations",
  );
  assert.match(
    pendingTxPanelSource,
    /disabled=\{isPendingTxActionBusy\}[\s\S]*disabled=\{isPendingTxActionBusy \|\| !hasPending\}/,
    "pending tx check and clear actions must both be disabled while either nonce operation is running",
  );
  assert.match(
    pendingTxPanelSource,
    /Run Check first; available only when a stuck nonce is detected/,
    "pending tx clear action must explain why it is disabled",
  );
  assert.match(
    walletSettingsModalSource,
    /aria-pressed=\{activeSection === s\.id\}/,
    "mobile wallet settings sections must expose their selected state",
  );
  assert.match(
    walletSettingsModalSource,
    /min-h-11[^"]*focus-visible:ring-2/,
    "mobile wallet settings sections must keep a 44px touch target and visible keyboard focus",
  );
  const headerPoolChartSource = readFileSync("app/components/header/HeaderPoolChart.tsx", "utf8");
  assert.match(
    headerPoolChartSource,
    /EMPTY_POOL_LINE_PATH/,
    "pool chart must keep a visible empty-state path when there are no bets",
  );
  assert.match(
    headerPoolChartSource,
    /const showChartVisual\s*=\s*true/,
    "pool chart visual must remain mounted for empty no-bet epochs",
  );
  assert.match(
    headerPoolChartSource,
    /data-testid="header-pool-chart-line"/,
    "pool chart line must expose a stable selector for browser smoke",
  );
  assert.match(
    headerPoolChartSource,
    /data-testid="header-pool-chart-visual"[\s\S]*data-empty-pool=\{realTotalStaked <= 0 \? "true" : "false"\}/,
    "pool chart visual must expose a stable empty-pool state for browser smoke",
  );
  assert.match(
    headerPoolChartSource,
    /aria-label=\{realTotalStaked <= 0 \? "Pool chart empty state" : "Pool activity chart"\}/,
    "pool chart empty state must be accessible without relying on pixels",
  );
}
