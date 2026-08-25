# Current release-candidate permission manifest

Snapshot date: 2026-08-25. Base `HEAD`:
`3c8886acc1fa33045aa7bcc1d03bab9fa84fd09b` on `codex/repo-cleanup`.

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
  `501d6375fa10572d41d6c1f882dc347ee9333289f45d2971195af748f7a2c9e9`.
- Canonical content-set SHA-256 for the other `2` candidate files (this
  self-referential manifest excluded; sorted `path + NUL + file SHA-256 + LF`):
  `b09e72eba3927c9f49a37edac57c909daafef43486c9687c064c542325980728`.

```text
docs/agent-progress.md
docs/current_state.md
docs/release-candidate-current.md
```

The 32 historical/test artifacts stay on disk and must not be staged by a
future authorized packet. Any candidate path-set change invalidates this
manifest and requires a fresh zero-omission audit before a new permission is
requested or used.
