# Current release-candidate permission manifest

Snapshot date: 2026-08-26. Base immutable SHA:
`cbf93b230476b8c823daebbc8e8f4707a53903e5` on `codex/repo-cleanup`.

Status: the user has granted standing authority for local commits. This
manifest binds the exact wallet actor-remediation code, the project-native V10
canary runner hardening and tests, and current status documentation. It does
not authorize push, deployment, hosting changes, Preview generation, signing,
wallet use, approval, or any chain transaction beyond separately granted
bounded testnet work.

## Exact current scope

The path set below is the exact proposed index relative to
`cbf93b230476b8c823daebbc8e8f4707a53903e5`.

- Production paths: `10`.
- Test and test-runner paths: `8`.
- Current status/worklist/manifest paths: `5`.
- Excluded and retained generated evidence: the three user-owned untracked
  directories `artifacts/final-sha-local-gates-12c4909c/`,
  `artifacts/test-campaign-2026-08-20/`, and `artifacts/valkey-runtime/`.
- Authorized/expected staging paths: `23`.
- Exactness: `missing=0`, `extra=0`, `duplicates=0` under the exclusion above.
- Canonical path-set SHA-256 (UTF-8, ordinal-sorted paths, LF after every path):
  `a000c4f8217292232844faabe4222f3bbb51d6f475da590e513f7dd635431c2a`.
- Canonical candidate file-content-set SHA-256 for the other `22` candidate
  files (this self-referential manifest excluded; ordinal-sorted
  `path + NUL + lowercase file-content SHA-256 + LF`):
  `50dd236f29ce6feb182464f6a17130252709ff84720520113268fed924d8f23c`.

```text
app/api/_lib/adminSession.ts
app/api/_lib/chatSession.ts
app/api/admin/auth/route.ts
app/api/chat/auth/route.ts
app/hooks/useMining.shared.ts
app/hooks/useMining.types.ts
app/hooks/useMiningAllowance.ts
app/hooks/useMiningStandardBetPath.ts
app/lib/mining/autoMineBootstrap.ts
docs/agent-progress.md
docs/current_state.md
docs/release-candidate-current.md
docs/remaining-worklist.md
docs/testnet-readiness.md
scripts/lib/canary-nonce-settlement.mjs
scripts/live-round-canary.ts
scripts/test-admin-session-security.mjs
scripts/test-business-chat-client-safety.mjs
scripts/test-canary-nonce-settlement.mjs
scripts/test-chat-refresh-expiry-boundary.mjs
scripts/test-live-round-canary-enforcement.mjs
scripts/test-wallet-transaction-state.ts
server/storage.ts
```

The retained artifact directories stay on disk and must not be staged. Any
candidate path-set or candidate-content change invalidates this manifest and
requires fresh digests and a zero-omission audit before staging.
