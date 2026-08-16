# Release candidate partition

Snapshot date: 2026-08-14. This is the historical staging map for the candidate
that was subsequently committed locally in the eight sections below. It does
not authorize pushes, deployment, signing, wallet actions, network writes, or
chain transactions.

The committed candidate contained `320` changed paths: `227` tracked changes,
`93` untracked files, and `0` staged paths before staging. The eight whole-file
partitions below assigned all `320` paths exactly once (`missing=0`, `extra=0`,
`duplicates=0`). The committed `.gitattributes` and normalized line-ending
partition already lived in the baseline HEAD, so no line-ending file was mixed
into this plan.

## 1. API and server read-model security (32)

```text
app/api/_lib/adminSession.ts
app/api/_lib/chatSession.ts
app/api/_lib/externalRateLimit.ts
app/api/_lib/jackpotRouteRuntime.ts
app/api/_lib/jackpotsService.ts
app/api/_lib/publicReadModelPolicy.ts
app/api/_lib/readModelSafety.ts
app/api/_lib/rebateRouteRuntime.ts
app/api/_lib/rewardSummary.ts
app/api/_lib/sharedRateLimit.ts
app/api/admin/ops/route.ts
app/api/admin/ops/runtimePolicy.ts
app/api/bootstrap-resolve/route.ts
app/api/bootstrap-resolve/shared.ts
app/api/chat/profile/readPolicy.ts
app/api/chat/profile/route.ts
app/api/deposits/recoveryPolicy.ts
app/api/deposits/route.ts
app/api/epochs/route.ts
app/api/health/_lib/diagnosticsAuth.ts
app/api/health/data-sync/dataSyncHealthPolicy.ts
app/api/health/data-sync/route.ts
app/api/health/runtime/route.ts
app/api/jackpots/route.ts
app/api/leaderboards/route.ts
app/api/live-state/route.ts
app/api/live-state/runtimePolicy.ts
app/api/live-state/shared.ts
app/api/rebates/route.ts
app/api/recent-wins/data.ts
app/api/recent-wins/route.ts
app/api/rewards/route.ts
```

## 2. Wallet, mining, rewards, and frontend runtime (63)

```text
app/admin/AdminOpsClient.tsx
app/admin/adminOpsPresentation.tsx
app/components/BackupGate.tsx
app/components/HubContent.tsx
app/components/HubSidePanel.tsx
app/components/FAQ.tsx
app/components/MaintenanceOverlay.tsx
app/components/PageBackdrop.tsx
app/components/chat/ChatWindow.tsx
app/components/chat/ChatWidget.tsx
app/components/wallet/types.ts
app/components/wallet/WalletSettingsPendingTxPanel.tsx
app/components/wallet/WalletTransferRow.tsx
app/hooks/useAnalyticsAncillaryData.ts
app/hooks/useAppShellState.ts
app/hooks/useChat.ts
app/hooks/useChatAuth.ts
app/hooks/useChatProfile.ts
app/hooks/useChatWidgetRuntime.ts
app/hooks/useDeepRewardScan.ts
app/hooks/useDepositHistory.ts
app/hooks/useDialogFocusTrap.ts
app/hooks/useGameEpochUiState.ts
app/hooks/useGameLiveStateSnapshot.ts
app/hooks/useGlobalStats.ts
app/hooks/useJackpotHistory.ts
app/hooks/useLeaderboards.ts
app/hooks/useMiningAllowance.ts
app/hooks/useMiningAutoMineRunner.ts
app/hooks/useMiningBetExecution.ts
app/hooks/useMiningGuards.ts
app/hooks/useMiningManualActions.ts
app/hooks/useMiningReceipt.ts
app/hooks/useMiningRoundBetting.ts
app/hooks/useMiningRuntimeHelpers.ts
app/hooks/useMiningRuntimeState.ts
app/hooks/useMiningStandardBetPath.ts
app/hooks/useMiningTabLock.ts
app/hooks/usePageAncillaryData.ts
app/hooks/useRebate.ts
app/hooks/useRecentWins.ts
app/hooks/useReducedMotion.ts
app/hooks/useRewardScanner.ts
app/hooks/useStableChatWalletAddress.ts
app/hooks/useWalletActions.ts
app/lib/chatAuthRuntime.ts
app/lib/chatProfileRuntime.ts
app/lib/chatRuntimePolicy.ts
app/lib/chatSendState.ts
app/lib/chatWalletRuntime.ts
app/lib/globalStatsRuntime.ts
app/lib/hubFeeEstimate.ts
app/lib/eoaNonceLock.ts
app/lib/lineaEstimateGasShadow.ts
app/lib/logger.ts
app/lib/miningGasPolicy.ts
app/lib/mining/autoMineBootstrap.ts
app/lib/mining/manualMineAttempt.ts
app/lib/miningTxPath.ts
app/lib/readModelCache.ts
app/lib/reducedMotionRuntime.ts
app/lib/rewardScanPolicy.ts
app/lib/walletTransferIntent.ts
```

## 3. Operator, indexer, persistence, and recovery runtime (23)

```text
bot.ts
config/productionRuntime.ts
ecosystem.config.cjs
scripts/backup-sqlite.mjs
scripts/check-production-health.mjs
scripts/check-sqlite-startup.mjs
scripts/check-v10-dry-run-preview.mjs
scripts/clear-live-test-pending-nonce.ts
scripts/create-v10-canary-dry-run-preview.mjs
scripts/indexer.ts
scripts/indexerNormalization.mjs
scripts/indexerSafety.ts
scripts/live-canary-health-policy.mjs
scripts/live-round-canary.ts
scripts/monitor-runtime-health.mjs
scripts/playtest-wallet-policy.mjs
scripts/playtest-wallet.ts
scripts/run-testnet-soak-supervisor.mjs
scripts/runtime-monitor-lib.mjs
scripts/sqlite-scope-audit-lib.mjs
scripts/sqlite-backup-lib.mjs
scripts/verify-db-restore.mjs
server/keeperSigningSafety.ts
```

## 4. Hermetic build, browser, HTTP, and performance tooling (28)

```text
.codexignore
.gitignore
next.config.mjs
scripts/browser-baseline-model.mjs
scripts/build-provenance.mjs
scripts/audit-p1-behavior.mjs
scripts/check-local.mjs
scripts/check-local-policy.mjs
scripts/cleanup-workspace.mjs
scripts/cleanup-workspace-loop.mjs
scripts/cleanup-workspace-model.mjs
scripts/collect-p1-performance-evidence.mjs
scripts/load-http.mjs
scripts/manage-workspace-cleanup-loop.mjs
scripts/measure-build-output.mjs
scripts/measure-browser-baseline.mjs
scripts/p1-performance-evidence-model.mjs
scripts/run-autonomous-cleanup.mjs
scripts/run-hermetic-build.mjs
scripts/runtime-smoke-error-policy.mjs
scripts/smoke-browser.mjs
scripts/smoke-browser-lib/core.mjs
scripts/smoke-browser-policy.mjs
scripts/smoke-http.mjs
scripts/smoke-live-state-recovery.mjs
scripts/trusted-npm-cli.mjs
scripts/verify-p1-performance-evidence.mjs
tsconfig.json
```

## 5. Executable tests and hermetic fixtures (105)

```text
scripts/fixtures/api-route-matrix-worker.ts
scripts/test-admin-auth-local-signature.mjs
scripts/test-admin-session-security.mjs
scripts/test-api-route-matrix.ts
scripts/test-api-storage-persistence-behavior.ts
scripts/test-auto-miner-persistence-security.mjs
scripts/test-bootstrap-resolve-lock.mjs
scripts/test-business-contract-v10-summary.mjs
scripts/test-business-api-integer-queries.mjs
scripts/test-business-api-recovery-storage.mjs
scripts/test-business-api-request-boundaries.mjs
scripts/test-business-admin-ops-policy.mjs
scripts/test-business-admin-ops-presentation.mjs
scripts/test-business-autonomous-daily-status.mjs
scripts/test-business-autonomous-status.mjs
scripts/test-business-backup-summary.mjs
scripts/test-business-browser-tooling-behavior.mjs
scripts/test-business-cache-planners.mjs
scripts/test-business-chain-indexer-audit-policy.mjs
scripts/test-business-chain-proof-policy.mjs
scripts/test-business-chat-client-safety.mjs
scripts/test-business-ci-security.mjs
scripts/test-business-check-local-policy.mjs
scripts/test-business-cleanup-workspace.mjs
scripts/test-business-cleanup-loop-manager.mjs
scripts/test-business-client-identity-rate-limit.mjs
scripts/test-business-compiler-advisory.mjs
scripts/test-business-contract-v9-summary.mjs
scripts/test-business-data-sync-health-policy.mjs
scripts/test-business-dependency-audit.mjs
scripts/test-business-dialog-accessibility.mjs
scripts/test-business-error-boundaries.mjs
scripts/test-business-explorer-links.mjs
scripts/test-business-gas-shadow.mjs
scripts/test-business-host-evidence-policy.mjs
scripts/test-business-host-proof-policy.mjs
scripts/test-business-http-smoke-boundaries.mjs
scripts/test-business-hub-readonly-controls.mjs
scripts/test-business-indexer-storage-behavior.mjs
scripts/test-business-jackpot-rebate-security.mjs
scripts/test-business-launch-command-map.mjs
scripts/test-business-launch-docs.mjs
scripts/test-business-launch-remaining.mjs
scripts/test-business-live-canary-health.mjs
scripts/test-business-live-state-api.mjs
scripts/test-business-local-proof-preflight.mjs
scripts/test-business-mainnet-proof-output.mjs
scripts/test-business-mainnet-proof-policy.mjs
scripts/test-business-logic.mjs
scripts/test-business-mining-runtime-safety.mjs
scripts/test-business-notice-stack.mjs
scripts/test-business-prelaunch-status.mjs
scripts/test-business-playtest-wallet-policy.mjs
scripts/test-business-process-model.mjs
scripts/test-business-production-runtime-env.mjs
scripts/test-business-production-runtime-network-matrix.mjs
scripts/test-business-proof-collector-redaction.mjs
scripts/test-business-proof-drafts.mjs
scripts/test-business-proof-files.mjs
scripts/test-business-proof-templates.mjs
scripts/test-business-public-api-read-models.mjs
scripts/test-business-public-presentation.mjs
scripts/test-business-read-models.mjs
scripts/test-business-readiness-checklist.mjs
scripts/test-business-release-documentation.mjs
scripts/test-business-release-operations.mjs
scripts/test-business-reward-scanner.mjs
scripts/test-business-runtime-health-diagnostics.mjs
scripts/test-business-runtime-monitor-alerts.mjs
scripts/test-business-runtime-monitor-boundaries.mjs
scripts/test-business-runtime-smoke-redaction.mjs
scripts/test-business-summary-timeout.mjs
scripts/test-business-ui-motion-readonly.mjs
scripts/test-contract-v10-invariants.mjs
scripts/test-business-v10-deployed-input-policy.mjs
scripts/test-business-wallet-action-boundaries.mjs
scripts/test-business-wallet-funding-presentation.mjs
scripts/test-business-wallet-models.mjs
scripts/test-business-wallet-presentation.mjs
scripts/test-business-wallet-route-safety.mjs
scripts/test-business-wallet-runtime.mjs
scripts/test-business-wallet-shell-actions.mjs
scripts/test-deposits-recovery-identity.ts
scripts/test-deposits-recovery-safety.mjs
scripts/test-fetch-with-timeout.ts
scripts/test-health-credential-origin.mjs
scripts/test-hermetic-build.mjs
scripts/test-indexer-input-safety.ts
scripts/test-indexer-lease-contention.ts
scripts/test-indexer-process-restart.ts
scripts/test-jackpot-api-admission.ts
scripts/test-keeper-daily-budget.ts
scripts/test-linea-fee-policy.mjs
scripts/test-mining-tx-recovery-identity.ts
scripts/test-purpose-separated-secrets.mjs
scripts/test-rebate-claim-behavior.ts
scripts/test-rebate-refresh-budget.ts
scripts/test-rebate-route-runtime.ts
scripts/test-redaction-fuzz.mjs
scripts/test-sqlite-operations.mjs
scripts/test-v10-preview-env-boundary.mjs
scripts/test-wallet-actions-hook-behavior.ts
scripts/test-wallet-transaction-state.ts
scripts/test-wallet-transfer-intent.mjs
scripts/test-wallet-two-context-nonce-lock.ts
```

## 6. Proof, security, package, and release coordinators (63)

```text
package-lock.json
package.json
scripts/analyze-live-canary-proof.mjs
scripts/audit-chain-indexer-window.mjs
scripts/chain-indexer-audit-policy.mjs
scripts/chain-indexer-audit-runtime.mjs
scripts/chain-proof-policy.mjs
scripts/check-ci-security.mjs
scripts/check-launch-gates.mjs
scripts/check-monitoring-proof.mjs
scripts/check-qa-proof.mjs
scripts/collect-chain-proof.mjs
scripts/collect-host-evidence.mjs
scripts/collect-indexer-evidence.mjs
scripts/collect-mainnet-proof.mjs
scripts/collect-proof-common.mjs
scripts/collect-restore-evidence.mjs
scripts/create-host-proof-draft.mjs
scripts/create-indexer-proof-draft.mjs
scripts/create-monitoring-proof-draft.mjs
scripts/create-monitoring-test-plan.mjs
scripts/create-qa-canary-test-plan.mjs
scripts/create-qa-proof-draft.mjs
scripts/create-restore-proof-draft.mjs
scripts/host-evidence-policy.mjs
scripts/host-proof-policy.mjs
scripts/launch-gate-policy.mjs
scripts/launch-command-script-policy.mjs
scripts/check-proof-drafts.mjs
scripts/check-proof-templates.mjs
scripts/check-launch-command-map.mjs
scripts/check-launch-doc-command-syntax.mjs
scripts/check-host-proof.mjs
scripts/check-indexer-dry-run.mjs
scripts/check-production-dependency-audit.mjs
scripts/check-wallet-dependencies.mjs
scripts/check-security-followup.mjs
scripts/check-signoff-proof.mjs
scripts/test-business-security-followup.mjs
scripts/check-readiness-checklist.mjs
scripts/check-solidity-compiler-advisories.mjs
scripts/mainnet-proof-policy.mjs
scripts/qa-proof-policy.mjs
scripts/report-autonomous-daily-status.mjs
scripts/report-autonomous-status.mjs
scripts/report-launch-remaining.mjs
scripts/report-prelaunch-status.mjs
scripts/run-db-operations-summary.mjs
scripts/run-business-logic-summary.mjs
scripts/run-contract-v9-summary.mjs
scripts/run-contract-v10-summary.mjs
scripts/run-fetch-timeout-summary.mjs
scripts/run-indexer-storage-summary.mjs
scripts/run-monitoring-drill-summary.mjs
scripts/run-p1-hardening-tests.mjs
scripts/run-stored-number-parsing-summary.mjs
scripts/run-typecheck-summary.mjs
scripts/run-build-summary.mjs
scripts/run-eslint-summary.mjs
scripts/run-v10-deployed-summary.mjs
scripts/run-v10-offline-identity-summary.mjs
scripts/v10DeployedInputPolicy.ts
scripts/verify-v10-deployed.ts
```

## 7. CI workflow (1)

```text
.github/workflows/ci.yml
```

## 8. Current-state documentation (5)

```text
docs/agent-progress.md
docs/archive/release-hardening-2026-08-10-through-2026-08-14.md
docs/current_state.md
docs/release-candidate-partition.md
docs/remaining-worklist.md
```

## Dependency and approval order

Use the order above. Runtime partitions 1-4 precede their executable tests in
partition 5. Proof/package coordination in partition 6 follows all referenced
runtime and test paths. CI follows the complete local command surface, and docs
remain last. Whole-file choke points such as `package.json`,
`scripts/test-business-logic.mjs`, and
`scripts/test-business-release-operations.mjs` intentionally stay in one
partition instead of unsafe partial staging.

Before each authorized commit, the process was to recompute
`git status --porcelain=v1`, verify the remaining paths against this map, stage
only the named partition, and run `git diff --cached --check` plus its focused
gate. `.env*`, DB/WAL/SHM files, build output, caches, artifacts, secrets, and
wallet material remain excluded. Any subsequent tree change requires a new
zero-omission audit. The local commit authorization does not authorize push or
any live action.
