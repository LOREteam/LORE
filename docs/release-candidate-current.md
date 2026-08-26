# Current release-candidate permission manifest

Snapshot date: 2026-08-26. Base `HEAD`:
`949b639ff8a3a3934fd3b62b1b72558915a11015` on `codex/repo-cleanup`.

Status: the user has granted standing authority for local commits. This
manifest binds the exact wallet/mining/rebate remediation packet and its current
status documentation. It does not authorize push, deployment, hosting changes,
Preview generation, RPC access, signing, wallet use, approval, or any chain
transaction.

The packet closes three medium wallet-lifecycle gaps in the mutable worktree:

- mining approval recovery fingerprints the exact persisted approval amount;
- pending-nonce repair uses a durable exact self/zero/empty-calldata intent,
  retains ambiguous hashless state after the wallet sink, and clears only on
  exact terminal evidence or two-RPC proof that the nonce advanced;
- hash-known Safety Pool claims reach terminal reconciliation before a stale
  actor suppresses UI work.

Focused suites passed twice, TypeScript passed, schema-v2 audit passed twice at
`5839/6363` behavioral assertions (`91.76%`, `524` source operands), self-test
passed `17/17`, and P1 hardening passed `42/42` in `315622ms` including EVM
fuzz. Independent final review found no actionable issue. Diff hygiene passes.
The protected SQLite base remains `319488` bytes with SHA-256
`4EA3ECB92D5EFD081030F1C10E84C444E75460E628BB216FD063E72941BF38F7`
and no WAL/SHM. These are mutable-worktree results; the proposed child still
requires a detached fresh-`npm ci` full seal and fresh supported security scan.

## Exact current scope

The path set below is the exact proposed index relative to
`949b639ff8a3a3934fd3b62b1b72558915a11015`.

- Proposed child: `17` other tracked paths plus this self-excluded manifest.
- Source/test paths: `14`.
- Current status/worklist paths other than this manifest: `3`.
- Excluded and retained generated evidence: `329` files in the three user-owned
  untracked directories `artifacts/final-sha-local-gates-12c4909c/`,
  `artifacts/test-campaign-2026-08-20/`, and `artifacts/valkey-runtime/`.
- Authorized/expected staging paths: `18`.
- Exactness: `missing=0`, `extra=0`, `duplicates=0` under the exclusion above.
- Canonical path-set SHA-256 (UTF-8, ordinal-sorted paths, LF after every path):
  `ed9d3b413a465193f1ed05c64893685a5c944ed438b868cfadd2241baa427486`.
- Canonical current content-set SHA-256 for the other `17` candidate files
  (this self-referential manifest excluded; ordinal-sorted
  `path + NUL + lowercase file SHA-256 + LF`):
  `17777870e6ae33d62b89fa873eb51006c72dd8b20a52e0fa173ddff3906e2a7d`.

```text
app/hooks/useMiningAllowance.ts
app/hooks/useRebate.ts
app/hooks/useWalletActions.ts
app/lib/mining/autoMineBootstrap.ts
app/lib/miningTxPath.ts
app/lib/walletTransferIntent.ts
docs/agent-progress.md
docs/current_state.md
docs/release-candidate-current.md
docs/remaining-worklist.md
scripts/test-business-wallet-action-boundaries.mjs
scripts/test-business-wallet-route-safety.mjs
scripts/test-mining-tx-recovery-identity.ts
scripts/test-rebate-claim-behavior.ts
scripts/test-wallet-actions-hook-behavior.ts
scripts/test-wallet-transaction-state.ts
scripts/test-wallet-transfer-intent.mjs
scripts/test-wallet-two-context-nonce-lock.ts
```

The retained artifact directories stay on disk and must not be staged. Any
candidate path-set or candidate-content change invalidates this manifest and
requires fresh digests and a zero-omission audit before staging.
