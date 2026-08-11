# Release candidate partition

Snapshot date: 2026-08-11. This is a staging plan only: it does not authorize
index writes, commits, publishing, or live operations. It partitions the 96
changed paths other than itself exactly once; this document is the 97th path in the
documentation commit. A later candidate can therefore stage every path without
mixing runtime behavior, proof/test code, release metadata, or documentation.

## 1. Runtime security and data behavior

```text
app/api/_lib/chatSignatureVerification.ts
app/api/_lib/jackpotsService.ts
app/api/_lib/rewardSummary.ts
app/api/admin/auth/route.ts
app/api/bootstrap-resolve/route.ts
app/api/bootstrap-resolve/shared.ts
app/api/chat/auth/route.ts
app/api/chat/messages/route.ts
app/api/deposits/recoveryIdentity.ts
app/api/deposits/route.ts
app/api/epochs/route.ts
app/api/jackpots/og/route.tsx
app/api/live-state/shared.ts
app/api/rebates/rebateRefreshBudget.ts
app/api/rebates/route.ts
app/api/recent-wins/data.ts
app/api/recent-wins/route.ts
app/hooks/useMining.shared.ts
app/hooks/useMiningAllowance.ts
app/hooks/useMiningAutoMineRunner.ts
app/hooks/useMiningLifecycle.ts
app/hooks/useMiningRuntimeState.ts
app/hooks/useMiningStandardBetPath.ts
app/hooks/usePrivyWallet.ts
app/hooks/useRebate.ts
app/hooks/useWalletActions.ts
app/lib/lineaFees.ts
app/lib/mining/autoMineRuntimeController.ts
app/lib/miningTxPath.ts
app/lib/walletTransferIntent.ts
bot.ts
config/productionRuntime.ts
next.config.mjs
server/db.ts
server/keeperSigningSafety.ts
server/storage.ts
```

## 2. Runtime and release tooling

```text
scripts/check-local.mjs
scripts/check-production-health.mjs
scripts/check-v10-dry-run-preview.mjs
scripts/clear-live-test-pending-nonce.ts
scripts/collect-mainnet-proof.mjs
scripts/create-v10-canary-dry-run-preview.mjs
scripts/health-credential-origin.mjs
scripts/indexer.ts
scripts/indexerSafety.ts
scripts/live-round-canary.ts
scripts/monitor-runtime-health.mjs
scripts/plan-v10-postdeploy-canary.ts
scripts/playtest-wallet.ts
scripts/preview-freshness.mjs
scripts/run-hermetic-build.mjs
scripts/run-isolated-build.mjs
```

## 3. Tests, CI proofs, and fixtures

```text
scripts/check-local-dist-dir.mjs
scripts/check-security-followup.mjs
scripts/fixtures/api-route-matrix-worker.ts
scripts/run-business-logic-summary.mjs
scripts/run-p1-hardening-tests.mjs
scripts/test-admin-auth-local-signature.mjs
scripts/test-api-recovery-admission.ts
scripts/test-api-recovery-provenance.ts
scripts/test-api-route-matrix.ts
scripts/test-auto-miner-persistence-security.mjs
scripts/test-bootstrap-resolve-lock.mjs
scripts/test-business-indexer-normalization.mjs
scripts/test-business-live-state-api.mjs
scripts/test-business-logic.mjs
scripts/test-business-read-models.mjs
scripts/test-business-reward-scanner.mjs
scripts/test-business-wallet-models.mjs
scripts/test-chat-auth-rpc-quorum.mjs
scripts/test-deposits-recovery-identity.ts
scripts/test-deposits-recovery-safety.mjs
scripts/test-expiring-lock-cleanup.mjs
scripts/test-health-credential-origin.mjs
scripts/test-hermetic-build.mjs
scripts/test-indexer-fork-recovery.ts
scripts/test-indexer-input-safety.ts
scripts/test-jackpot-api-admission.ts
scripts/test-keeper-daily-budget.ts
scripts/test-linea-fee-policy.mjs
scripts/test-live-state-snapshot-provenance.mjs
scripts/test-mining-tx-recovery-identity.ts
scripts/test-purpose-separated-secrets.mjs
scripts/test-rebate-refresh-budget.ts
scripts/test-runtime-tooling-guards.mjs
scripts/test-sqlite-operations.mjs
scripts/test-v10-preview-env-boundary.mjs
scripts/test-wallet-transfer-intent.mjs
```

## 4. Toolchain and line-ending policy

```text
.env.example
.gitattributes
package-lock.json
package.json
```

## 5. Current-state documentation

```text
docs/agent-progress.md
docs/current_state.md
docs/remaining-worklist.md
docs/v10-canary-dry-run-preview.md
```

The partition document itself belongs with this final documentation commit.
After staging is available, compare these five lists to `git status
--porcelain=v1` before every commit, stage no `.env` files, DB/WAL/SHM files,
or build output, then run `git diff --cached --check` per partition.
