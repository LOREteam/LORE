# Current release-candidate permission manifest

Snapshot date: 2026-08-25. Base `HEAD`:
`5e8dc4faa5be8a529a57b2a5699eaf4f0b995114` on `codex/repo-cleanup`.

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

- Candidate: `4` tracked paths; `0` untracked paths.
- Excluded and retained generated evidence: `32` paths in `3` top-level
  directories under `artifacts/`.
- Staged paths: `5` (including this self-excluded manifest).
- Exactness: `missing=0`, `extra=0`, `duplicates=0` under the exclusion above.
- Canonical path-set SHA-256 (UTF-8, sorted paths, LF after every path):
  `1fcde825cd80a7fbba06055b1d53331a34c7088661c13cd504476a4cab10d773`.
- Canonical content-set SHA-256 for the other `4` candidate files (this
  self-referential manifest excluded; sorted `path + NUL + file SHA-256 + LF`):
  `796bfc451763f12d9b40cc472a5b0f1a6c487dadbcee1ecb2ec826816486faf7`.

```text
docs/agent-progress.md
docs/current_state.md
docs/release-candidate-current.md
docs/remaining-worklist.md
scripts/collect-p1-performance-evidence.mjs
```

The 32 historical/test artifacts stay on disk and must not be staged by a
future authorized packet. Any candidate path-set change invalidates this
manifest and requires a fresh zero-omission audit before a new permission is
requested or used.
