# Current release-candidate permission manifest

Snapshot date: 2026-08-26. Base `HEAD`:
`33a090729f1aeb785c6ca8e42fc4e51740e36c55` on `codex/repo-cleanup`.

Status: the user has granted authority for local commits. This manifest is the
exact staging boundary for the documentation packet that records the sealed
Standard Security Scan of `53846fe…` and the committed independent-RPC pending
repair fix at `33a090729`. That authority does not authorize push, deployment,
hosting changes, signing, wallet/RPC use, Preview generation, approval, or a
chain transaction.

## Exact current scope

The path set below is the exact proposed index relative to
`33a090729f1aeb785c6ca8e42fc4e51740e36c55`. It contains only the durable
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
  `b9c850a9e6f92a98f9bd6d5bb9ac43d941c952bea1069896f22c0b2fa3ddc3fe`.

```text
docs/agent-progress.md
docs/current_state.md
docs/release-candidate-current.md
docs/remaining-worklist.md
```

The retained artifact files stay on disk and must not be staged by this packet.
Any candidate path-set or candidate-content change invalidates this manifest and
requires fresh digests and a zero-omission audit before staging.
