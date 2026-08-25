# Current release-candidate permission manifest

Snapshot date: 2026-08-25. Base `HEAD`:
`632a8b09c814dd5ce318647e4adc41cea7d494ec` on `codex/repo-cleanup`.

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

- Candidate: `6` other tracked paths; `0` other untracked paths.
- Excluded and retained generated evidence: `32` paths in `3` top-level
  directories under `artifacts/`.
- Authorized/expected staging paths: `7` (the `6` candidates plus this
  self-excluded manifest).
- Exactness: `missing=0`, `extra=0`, `duplicates=0` under the exclusion above.
- Canonical path-set SHA-256 (UTF-8, sorted paths, LF after every path):
  `2cabcfef36aebecda916fd49e30d9d23b6f45a79bc61529796bfb495029dbbdc`.
- Canonical content-set SHA-256 for the other `6` candidate files (this
  self-referential manifest excluded; sorted `path + NUL + file SHA-256 + LF`):
  `87eb78e4d96bda046d0f4516cb6b2339dab6d11324f17a20e83f981b260aa2a8`.

```text
docs/agent-progress.md
docs/current_state.md
docs/release-candidate-current.md
docs/remaining-worklist.md
scripts/collect-p1-performance-evidence.mjs
scripts/p1-performance-evidence-model.mjs
scripts/verify-p1-performance-evidence.mjs
```

The 32 historical/test artifacts stay on disk and must not be staged by a
future authorized packet. Any candidate path-set change invalidates this
manifest and requires a fresh zero-omission audit before a new permission is
requested or used.
