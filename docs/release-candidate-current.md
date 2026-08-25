# Current release-candidate permission manifest

Snapshot date: 2026-08-25. Base `HEAD`:
`333d7a81bb8780c5fc631646492ece53bbfa3926` on `codex/repo-cleanup`.

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

- Candidate: `2` tracked paths; `0` untracked paths.
- Excluded and retained generated evidence: `32` paths in `3` top-level
  directories under `artifacts/`.
- Staged paths: `3` (including this self-excluded manifest).
- Exactness: `missing=0`, `extra=0`, `duplicates=0` under the exclusion above.
- Canonical path-set SHA-256 (UTF-8, sorted paths, LF after every path):
  `39dc14a00c8f804d02c74fd1309f88fa28bd97f7aaea7f74cdf29d9ad89b4751`.
- Canonical content-set SHA-256 for the other `2` candidate files (this
  self-referential manifest excluded; sorted `path + NUL + file SHA-256 + LF`):
  `ecc04ddfa33ae7a2ca02f062b09629b5f9e27570bb1242097912a1fc540d0698`.

```text
docs/agent-progress.md
docs/current_state.md
docs/release-candidate-current.md
```

The 32 historical/test artifacts stay on disk and must not be staged by a
future authorized packet. Any candidate path-set change invalidates this
manifest and requires a fresh zero-omission audit before a new permission is
requested or used.
