# Current release-candidate permission manifest

Snapshot date: 2026-08-24. Base `HEAD`:
`f26f259e115c552f334771916be9c51108dc3409` on `codex/repo-cleanup`.

Status: the user has granted authority for local commits. This manifest remains
the exact staging boundary for the current packet; that authority does not
authorize a push, deployment, hosting change, signing, wallet/RPC use, Preview
generation, approval, or a chain transaction.

## Exact current scope

The path set below is taken from NUL-delimited
`git status --porcelain=v1 -z --untracked-files=all` and is bound to the base
`HEAD` above. It covers only the P1.17 artifact-publication integrity fix and
its current-state note.

- Candidate: `3` tracked paths; `0` untracked paths.
- Excluded and retained generated evidence: `31` paths under `artifacts/`.
- Staged paths: `3`.
- Exactness: `missing=0`, `extra=0`, `duplicates=0` under the exclusion above.
- Canonical path-set SHA-256 (UTF-8, sorted paths, LF after every path):
  `641577ea999a3f16e65ff9701d6002b2d1259211843bc06f56ca0e422254c716`.
- Canonical content-set SHA-256 for the other `2` candidate files (this
  self-referential manifest excluded; sorted `path + NUL + file SHA-256 + LF`):
  `ee65959c4c1453fabeff3dde89a0c67bd9b21dbf65250aea0b23f56c7a115882`.

```text
docs/current_state.md
docs/release-candidate-current.md
scripts/collect-p1-performance-evidence.mjs
```

The 31 historical campaign artifacts stay on disk and must not be staged by a
future authorized packet. Any candidate path-set change invalidates this
manifest and requires a fresh zero-omission audit before a new permission is
requested or used.
