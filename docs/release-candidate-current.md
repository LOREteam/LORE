# Current release-candidate permission manifest

Snapshot date: 2026-08-25. Base `HEAD`:
`3553c36085d2f95f35cbb0e2d1cefb0b541fb800` on `codex/repo-cleanup`.

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

- Candidate: `3` tracked paths; `0` untracked paths.
- Excluded and retained generated evidence: `32` paths in `3` top-level
  directories under `artifacts/`.
- Staged paths: `4` (including this self-excluded manifest).
- Exactness: `missing=0`, `extra=0`, `duplicates=0` under the exclusion above.
- Canonical path-set SHA-256 (UTF-8, sorted paths, LF after every path):
  `461c0c193914b189d1326a49e4545b14ed82ad48e80de25bbcf15f2540623e8f`.
- Canonical content-set SHA-256 for the other `3` candidate files (this
  self-referential manifest excluded; sorted `path + NUL + file SHA-256 + LF`):
  `f073e48044acf60ef750afe524a443f442df222c0b8a803d32a4fe77db0dc259`.

```text
docs/agent-progress.md
docs/current_state.md
docs/release-candidate-current.md
scripts/fixtures/api-route-matrix-worker.ts
```

The 32 historical/test artifacts stay on disk and must not be staged by a
future authorized packet. Any candidate path-set change invalidates this
manifest and requires a fresh zero-omission audit before a new permission is
requested or used.
