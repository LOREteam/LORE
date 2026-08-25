# Current release-candidate permission manifest

Snapshot date: 2026-08-25. Base `HEAD`:
`ab9914e785afa778d23423ce8a954faa9e8fe800` on `codex/repo-cleanup`.

Status: the user has granted authority for local commits. This manifest remains
the exact staging boundary for the current packet; that authority does not
authorize a push, deployment, hosting change, signing, wallet/RPC use, Preview
generation, approval, or a chain transaction.

## Exact current scope

The path set below is taken from NUL-delimited
`git status --porcelain=v1 -z --untracked-files=all` and is bound to the base
`HEAD` above. It adds a repeatable, direct Lua-engine test on the selected
Valkey Linux AMD64 image, exposes that test through `package.json`, and records
the intentionally partial (non-REST, non-replica, non-persistent) evidence.

- Candidate: `4` tracked paths; `1` untracked path.
- Excluded and retained generated evidence: `32` paths under `artifacts/`.
- Staged paths: `5`.
- Exactness: `missing=0`, `extra=0`, `duplicates=0` under the exclusion above.
- Canonical path-set SHA-256 (UTF-8, sorted paths, LF after every path):
  `c101c03292ee0428b77146d44d1be7a2bc22aa4ccfa7188383bb86113c8f41f4`.
- Canonical content-set SHA-256 for the other `4` candidate files (this
  self-referential manifest excluded; sorted `path + NUL + file SHA-256 + LF`):
  `f7cdd796fad45aac20ee42ceb8eebe3a6962cb1feefb5b342d6349b2fb1c9c1f`.

```text
docs/current_state.md
docs/release-candidate-current.md
docs/valkey-upstash-parity-plan.md
package.json
scripts/test-valkey-lua-engine.mjs
```

The 32 historical/test artifacts stay on disk and must not be staged by a
future authorized packet. Any candidate path-set change invalidates this
manifest and requires a fresh zero-omission audit before a new permission is
requested or used.
