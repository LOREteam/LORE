# Current release-candidate permission manifest

Snapshot date: 2026-08-25. Base `HEAD`:
`93522a1be1753d4b6da82e53aacbabb24d4e61f4` on `codex/repo-cleanup`.

Status: the user has granted authority for local commits. This manifest remains
the exact staging boundary for the current packet; that authority does not
authorize a push, deployment, hosting change, signing, wallet/RPC use, Preview
generation, approval, or a chain transaction.

## Exact current scope

The path set below is taken from NUL-delimited
`git status --porcelain=v1 -z --untracked-files=all` and is bound to the base
`HEAD` above. It increases only the bounded parent timeout for the isolated
V10 Preview environment fixture after a complete direct run exceeded the old
budget by `472ms`; current-state records the two subsequent full P1 passes.

- Candidate: `2` tracked paths; `0` untracked paths.
- Excluded and retained generated evidence: `32` paths under `artifacts/`.
- Staged paths: `3`.
- Exactness: `missing=0`, `extra=0`, `duplicates=0` under the exclusion above.
- Canonical path-set SHA-256 (UTF-8, sorted paths, LF after every path):
  `80e358c9f1804b59e57e94b43cd4c677d4df917fef517c2bfa3088d9fbda8127`.
- Canonical content-set SHA-256 for the other `2` candidate files (this
  self-referential manifest excluded; sorted `path + NUL + file SHA-256 + LF`):
  `f42e01b74293a21fa68a7feb40799ae7b37759c077262f9ccbbd6b0760f44dde`.

```text
docs/current_state.md
docs/release-candidate-current.md
scripts/run-p1-hardening-tests.mjs
```

The 32 historical/test artifacts stay on disk and must not be staged by a
future authorized packet. Any candidate path-set change invalidates this
manifest and requires a fresh zero-omission audit before a new permission is
requested or used.
