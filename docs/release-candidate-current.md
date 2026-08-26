# Current release-candidate permission manifest

Snapshot date: 2026-08-26. Base immutable SHA:
`304d3a45c22b988622d929bdc5492ae1fc53d964` on `codex/repo-cleanup`.

Status: the user has granted standing authority for local commits. This
manifest binds the exact four security-remediation packets, the two test-only
post-remediation contract corrections, and their current status documentation.
It does not authorize push, deployment, hosting changes,
Preview generation, RPC access, signing, wallet use, approval, or any chain
transaction.

## Exact current scope

The path set below is the exact proposed index relative to
`304d3a45c22b988622d929bdc5492ae1fc53d964`.

- Production paths: `8`.
- Test paths: `7`.
- Current status/worklist/manifest paths: `4`.
- Excluded and retained generated evidence: the three user-owned untracked
  directories `artifacts/final-sha-local-gates-12c4909c/`,
  `artifacts/test-campaign-2026-08-20/`, and `artifacts/valkey-runtime/`.
- Authorized/expected staging paths: `19`.
- Exactness: `missing=0`, `extra=0`, `duplicates=0` under the exclusion above.
- Canonical path-set SHA-256 (UTF-8, ordinal-sorted paths, LF after every path):
  `45f02af17e5e88b52698e94f6d9cd43f22e609f982240cf7d3251844b635f241`.
- Canonical staged Git-blob content-set SHA-256 for the other `18` candidate
  files (this self-referential manifest excluded; ordinal-sorted
  `path + NUL + lowercase blob SHA-256 + LF`):
  `5e13c78d42200202dbcaf1463dc5f9c08990ef0e6e33a6a13f3c65403624576b`.

```text
app/api/_lib/externalRateLimit.ts
app/hooks/useMiningAllowance.ts
app/hooks/usePrivyWallet.ts
app/lib/mining/autoMineBootstrap.ts
app/lib/miningTxPath.ts
config/productionRuntime.ts
docs/agent-progress.md
docs/current_state.md
docs/release-candidate-current.md
docs/remaining-worklist.md
scripts/fixtures/api-route-matrix-worker.ts
scripts/test-business-client-identity-rate-limit.mjs
scripts/test-business-indexer-storage-behavior.mjs
scripts/test-business-production-runtime-env.mjs
scripts/test-business-wallet-external-boundaries.mjs
scripts/test-business-wallet-route-safety.mjs
scripts/test-wallet-transfer-intent.mjs
server/db.ts
server/dbPathSafety.ts
```

The retained artifact directories stay on disk and must not be staged. Any
candidate path-set or candidate-content change invalidates this manifest and
requires fresh digests and a zero-omission audit before staging.
