# Current release-candidate permission manifest

Snapshot date: 2026-08-25. Base `HEAD`:
`5227b73c41c46badda66b41909ced3631a773f39` on `codex/repo-cleanup`.

Status: the user has granted authority for local commits. This manifest remains
the exact staging boundary for the current packet; that authority does not
authorize a push, deployment, hosting change, signing, wallet/RPC use, Preview
generation, approval, or a chain transaction.

## Exact current scope

The path set below is taken from NUL-delimited
`git status --porcelain=v1 -z --untracked-files=all` and is bound to the base
`HEAD` above. It records the current release-state handoff and exact local
evidence boundary. It does not authorize a push, deployment, hosting change,
wallet/RPC action, Preview, signing, or chain transaction.

- Candidate: `0` other tracked paths; `0` other untracked paths.
- Excluded and retained generated evidence: `32` paths in `3` top-level
  directories under `artifacts/`.
- Staged paths: `1` (this self-excluded manifest only).
- Exactness: `missing=0`, `extra=0`, `duplicates=0` under the exclusion above.
- Canonical path-set SHA-256 (UTF-8, sorted paths, LF after every path):
  `34a295a466abafd03dac057f8144e2627519db4ba2e877b2569eb89c3b61c9ef`.
- Canonical content-set SHA-256 for the other `0` candidate files (this
  self-referential manifest excluded; sorted `path + NUL + file SHA-256 + LF`):
  `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.

```text
docs/release-candidate-current.md
```

The 32 historical/test artifacts stay on disk and must not be staged by a
future authorized packet. Any candidate path-set change invalidates this
manifest and requires a fresh zero-omission audit before a new permission is
requested or used.
