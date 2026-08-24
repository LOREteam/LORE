# Current release-candidate permission manifest

Snapshot date: 2026-08-24. Base `HEAD`:
`63da5c4428d429ddda7e5d5a8fd7df56f01e5c73` on `codex/repo-cleanup`.

Status: the user has granted authority for local commits. This manifest remains
the exact staging boundary for the current packet; that authority does not
authorize a push, deployment, hosting change, signing, wallet/RPC use, Preview
generation, approval, or a chain transaction.

## Exact current scope

The path set below is taken from NUL-delimited
`git status --porcelain=v1 -z --untracked-files=all` and is bound to the base
`HEAD` above. It is a successor to the committed 74-path packet, not a staging
map for it.

- Candidate: `13` tracked paths; `0` untracked paths.
- Excluded and retained generated evidence: `31` paths under `artifacts/`.
- Staged paths: `13`.
- Exactness: `missing=0`, `extra=0`, `duplicates=0` under the exclusion above.
- Canonical path-set SHA-256 (UTF-8, sorted paths, LF after every path):
  `3e1065088550a0a44a70b8f0874ddbf659469d2f6adb70d24564591d4aa2700f`.
- Canonical content-set SHA-256 for the other `12` candidate files (this
  self-referential manifest excluded; sorted `path + NUL + file SHA-256 + LF`):
  `854bfb8d09f4e37fc6af76090213b26039138c4022f0f0b470c3db48364b2005`.

```text
docs/agent-progress.md
docs/current_state.md
docs/release-candidate-current.md
docs/remaining-worklist.md
scripts/check-local-policy.mjs
scripts/run-p1-hardening-tests.mjs
scripts/smoke-browser-lib/flows.mjs
scripts/smoke-http.mjs
scripts/test-business-check-local-policy.mjs
scripts/test-business-http-smoke-boundaries.mjs
scripts/test-indexer-lease-contention.ts
scripts/test-v10-preview-env-boundary.mjs
scripts/trusted-npm-cli.mjs
```

The 31 historical campaign artifacts stay on disk and must not be staged by a
future authorized packet. Any candidate path-set change invalidates this
manifest and requires a fresh zero-omission audit before a new permission is
requested or used.
