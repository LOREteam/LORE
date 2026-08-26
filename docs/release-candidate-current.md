# Current release-candidate permission manifest

Snapshot date: 2026-08-26. Base `HEAD`:
`0d5fb026487064831eb1d8eba927248bbd132c98` on `codex/repo-cleanup`.

Status: the user has granted authority for local commits. This manifest is the
exact staging boundary for the documentation packet that records the sealed
Standard Security Scan of `53846fe…` and the committed independent-RPC pending
repair fix at `33a090729`, plus the committed reserved-actor/nonce binding fix
at `6d70b0314`, authenticated chat identity fix at `0c673336f`, and bounded
chat-auth RPC admission fix at `697f03537`, plus bounded chat-profile storage at
`6d9f60411`, actor-scoped transfer-history rendering at `ff376d2fa`, and the
four-commit exact claim-lease remediation ending at `b7a678970`. All five
medium and both low scan findings now have local fixes; this documentation does
not substitute for the required detached post-fix seal and supported scan.
Diagnostic candidate `37c6fa56a` additionally exposed three stale business
contracts, fixed locally at `409402d39`; the next docs child, not the failed
diagnostic candidate, must receive the fresh detached seal. The subsequent
detached candidate `91ec244f2` passed fresh install, dependency and V9/V10
invariants plus every `check-local` row before the main build, then exposed two
disallowed policy exports in the chat-auth route module. Commit `0d5fb0264`
moves those constants into the shared verification module; focused x2,
route-matrix x2, TypeScript, ESLint, audit x2/self-test, and protected-DB checks
pass. A separate mutable-root build hit its unchanged strict 20-minute timeout
and is not green evidence. This documentation child must receive a new detached
fresh-`npm ci` full seal. The authority does not authorize push, deployment,
hosting changes, signing, wallet/RPC use, Preview generation, approval, or a
chain transaction.

## Exact current scope

The path set below is the exact proposed index relative to
`0d5fb026487064831eb1d8eba927248bbd132c98`. It contains only the durable
state/progress/worklist update and this self-excluded manifest.

- Proposed child: `3` other tracked paths plus this manifest.
- Excluded and retained generated evidence: `329` files in the three user-owned
  untracked directories `artifacts/final-sha-local-gates-12c4909c/`,
  `artifacts/test-campaign-2026-08-20/`, and `artifacts/valkey-runtime/`.
- Authorized/expected staging paths: `4` (the `3` candidates plus this
  self-excluded manifest).
- Exactness: `missing=0`, `extra=0`, `duplicates=0` under the exclusion above.
- Canonical path-set SHA-256 (UTF-8, sorted paths, LF after every path):
  `768f8c58400ab2977379de8611c7e91d064a5f561d5edbd4e274870f4c5376ad`.
- Canonical current content-set SHA-256 for the other `3` candidate files (this
  self-referential manifest excluded; sorted
  `path + NUL + file SHA-256 + LF`):
  `c234fd03ebc95ad72f2a33da4bebeec9f250f6c6ef18dcee55cfcd920f0e2b78`.

```text
docs/agent-progress.md
docs/current_state.md
docs/release-candidate-current.md
docs/remaining-worklist.md
```

The retained artifact files stay on disk and must not be staged by this packet.
Any candidate path-set or candidate-content change invalidates this manifest and
requires fresh digests and a zero-omission audit before staging.
