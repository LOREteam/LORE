# Current release-candidate permission manifest

Snapshot date: 2026-08-25. Base `HEAD`:
`39f68888ababf5bd26d4f9d895972986e9a40042` on `codex/repo-cleanup`.

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

- Candidate: `3` other tracked paths; `1` other untracked path.
- Excluded and retained generated evidence: `33` paths in `3` top-level
  directories under `artifacts/`.
- Authorized/expected staging paths: `5` (the `4` candidates plus this
  self-excluded manifest).
- Exactness: `missing=0`, `extra=0`, `duplicates=0` under the exclusion above.
- Canonical path-set SHA-256 (UTF-8, sorted paths, LF after every path):
  `2c1b71198bf1a5257a8b738737d440a9708a5845fec759f90a4c51e41c29f5d3`.
- Canonical current content-set SHA-256 for the other `4` candidate files (this
  self-referential manifest excluded; sorted
  `path + NUL + file SHA-256 + LF`):
  `af7f234c7702d9448892adfe2cc91fdc9bb4e9498a89e9635e07e75d698245ca`.

```text
docs/agent-progress.md
docs/current_state.md
docs/release-candidate-current.md
package.json
scripts/test-valkey-rest-rate-limit.mjs
```

The 33 historical/test artifacts stay on disk and must not be staged by a
future authorized packet. Any candidate path-set change invalidates this
manifest and requires a fresh zero-omission audit before a new permission is
requested or used.
