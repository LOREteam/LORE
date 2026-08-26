# Current release-candidate permission manifest

Snapshot date: 2026-08-26. Base `HEAD`:
`849b97e8a08ad64e01c954bd4d451c7760243fbe` on `codex/repo-cleanup`.

Status: the user has granted standing authority for local commits. This
manifest binds the exact test-only correction exposed by the detached
`849b97e8…` diagnostic and its current status documentation. The correction
adds the now-required approval `amountRaw` to the max-safe nonce fixture; it
does not change production behavior. The focused wallet-model runner and full
isolated business suite pass afterward. It does not authorize push, deployment,
hosting changes, Preview generation, RPC access, signing, wallet use, approval,
or any chain transaction.

## Exact current scope

The path set below is the exact proposed index relative to
`849b97e8a08ad64e01c954bd4d451c7760243fbe`.

- Proposed child: `4` other tracked paths plus this self-excluded manifest.
- Test paths: `1`.
- Current status/worklist paths other than this manifest: `3`.
- Excluded and retained generated evidence: `329` files in the three user-owned
  untracked directories `artifacts/final-sha-local-gates-12c4909c/`,
  `artifacts/test-campaign-2026-08-20/`, and `artifacts/valkey-runtime/`.
- Authorized/expected staging paths: `5`.
- Exactness: `missing=0`, `extra=0`, `duplicates=0` under the exclusion above.
- Canonical path-set SHA-256 (UTF-8, ordinal-sorted paths, LF after every path):
  `571c36be4e2da94df8e5a0a37c36ca5003370bed67284acc30a480569668cd82`.
- Canonical current content-set SHA-256 for the other `4` candidate files
  (this self-referential manifest excluded; ordinal-sorted
  `path + NUL + lowercase file SHA-256 + LF`):
  `6a3bd9c91c5d16d7f7090d02d1dc38afea0eeae97feb07d22353c598d0ba6dc4`.

```text
docs/agent-progress.md
docs/current_state.md
docs/release-candidate-current.md
docs/remaining-worklist.md
scripts/test-business-wallet-models.mjs
```

The retained artifact directories stay on disk and must not be staged. Any
candidate path-set or candidate-content change invalidates this manifest and
requires fresh digests and a zero-omission audit before staging.
