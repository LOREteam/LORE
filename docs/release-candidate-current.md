# Current release-candidate permission manifest

Snapshot date: 2026-08-24. Base `HEAD`:
`13522de026b1d73bdd0cb0ded7c1348f2e6ff7a2` on `codex/repo-cleanup`.

Status: local commit permission was granted on 2026-08-24 for exactly this
verified manifest. It authorizes local staging and one local commit only; it
does not authorize push, deployment, hosting changes, signing, wallet/RPC use,
Preview generation, approval, or a chain transaction.

## Historical-scope reconciliation

The goal's `318` paths were a historical dirty-tree snapshot at `281c5fd02`.
That candidate later grew to `320` paths and was committed in eight local
commits. [`release-candidate-partition.md`](release-candidate-partition.md) is an
accurate historical record, but it is not a valid staging map for this packet.

## Exact current scope

The path set below comes from NUL-delimited
`git status --porcelain=v1 -z --untracked-files=all` and is bound to the base
`HEAD` above.

- Full dirty status after adding this manifest: `105` paths.
- Candidate: `74` paths = `57` tracked changes + `17` untracked files.
- Candidate roots: `1` root, `9` app, `6` docs, `58` scripts.
- Excluded and retained generated evidence: `31` paths / `58535` bytes under
  `artifacts/`; canonical sorted-path SHA-256
  `80b1318611f71d9915395865a7bd74d49d890cb25b7318afa0e0caa8348ca72e`.
- Staged paths: `0`.
- Exactness: `missing=0`, `extra=0`, `duplicates=0` under the exclusion above.
- Canonical path-set SHA-256 (UTF-8, sorted paths, LF after every path):
  `64babbc458b207d722f5550e77ac2071b6251873863165fc4ff4b7b305521085`.
- Canonical content-set SHA-256 for the other `73` candidate files (this
  self-referential manifest excluded; sorted `path + NUL + file SHA-256 + LF`):
  `af204bf0fc1c657ae521b86519bb72c9ebb2720991fade37649c2085589b25fc`.

```text
.codexignore
app/admin/AdminOpsClient.tsx
app/components/ErrorCatcher.tsx
app/components/JackpotBanner.tsx
app/hooks/useAutoMinerForm.ts
app/hooks/useMiningGuards.ts
app/hooks/usePageWalletOverview.ts
app/hooks/useRebate.ts
app/hooks/useRewardScanner.ts
app/lib/lineaFees.ts
docs/agent-progress.md
docs/current_state.md
docs/release-candidate-current.md
docs/remaining-worklist.md
docs/transactional-ledgers-design.md
docs/valkey-upstash-parity-plan.md
scripts/analyze-live-canary-proof.mjs
scripts/audit-p1-behavior.mjs
scripts/business-logic-suite.mjs
scripts/check-sqlite-startup.mjs
scripts/check-v10-dry-run-preview.mjs
scripts/collect-p1-performance-evidence.mjs
scripts/create-canary-proof-draft.mjs
scripts/create-v10-canary-dry-run-preview.mjs
scripts/live-round-canary.ts
scripts/monitor-runtime-health.mjs
scripts/p1-performance-evidence-model.mjs
scripts/smoke-browser.mjs
scripts/smoke-http.mjs
scripts/test-analyze-live-canary-preview-dry-run.mjs
scripts/test-business-api-integer-queries.mjs
scripts/test-business-api-recovery-storage.mjs
scripts/test-business-api-request-boundaries.mjs
scripts/test-business-chat-client-safety.mjs
scripts/test-business-client-runtime-content-suite.mjs
scripts/test-business-direct-route-ssr.mjs
scripts/test-business-error-boundaries.mjs
scripts/test-business-error-shell-boundaries.mjs
scripts/test-business-http-smoke-boundaries.mjs
scripts/test-business-jackpot-banner-presentation.mjs
scripts/test-business-jackpot-rebate-security.mjs
scripts/test-business-launch-proof-guard-suite.mjs
scripts/test-business-operations-health-suite.mjs
scripts/test-business-production-runtime-suite.mjs
scripts/test-business-public-api-read-models.mjs
scripts/test-business-public-experience-suite.mjs
scripts/test-business-public-metadata.mjs
scripts/test-business-public-presentation.mjs
scripts/test-business-release-evidence-suite.mjs
scripts/test-business-release-operations.mjs
scripts/test-business-release-proof-suite.mjs
scripts/test-business-reward-scanner.mjs
scripts/test-business-runtime-health-diagnostics.mjs
scripts/test-business-runtime-monitor-boundaries.mjs
scripts/test-business-runtime-recovery.mjs
scripts/test-business-tutorial-public-copy.mjs
scripts/test-business-wallet-boundary-suite.mjs
scripts/test-business-wallet-funding-presentation.mjs
scripts/test-business-wallet-models.mjs
scripts/test-business-wallet-presentation.mjs
scripts/test-business-wallet-shell-actions.mjs
scripts/test-hermetic-build.mjs
scripts/test-linea-fee-policy.mjs
scripts/test-live-round-canary-enforcement.mjs
scripts/test-mobile-mining-action.ts
scripts/test-public-copy-presentation.tsx
scripts/test-v10-preview-consent-envelope.mjs
scripts/test-v10-preview-consent-store.mjs
scripts/test-v10-preview-env-boundary.mjs
scripts/v10-preview-consent-envelope.mjs
scripts/v10-preview-consent-store.mjs
scripts/v10-preview-repository-state.mjs
scripts/verify-p1-performance-evidence.mjs
scripts/verify-v10-sepolia-deployment-manifest.mjs
```

The excluded campaign artifacts stay on disk as historical evidence. They are
not cleanup candidates and must not be staged by an authorized commit packet.
Any candidate path addition, deletion, rename, or new dirty path invalidates
this manifest and requires a fresh zero-omission audit before permission is
requested or used.
