# Current release-candidate permission manifest

Snapshot date: 2026-08-25. Base `HEAD`:
`e448e4fefd1dbe77ae3579875f66e070472c79cb` on `codex/repo-cleanup`.

Status: the user has granted authority for local commits. This manifest remains
the exact staging boundary for the current packet; that authority does not
authorize a push, deployment, hosting change, signing, wallet/RPC use, Preview
generation, approval, or a chain transaction.

## Exact current scope

The path set below is taken from the NUL-delimited proposed amended index via
`git diff --cached --name-only -z e448e4fefd1dbe77ae3579875f66e070472c79cb`.
It is the exact five-path change relative to that parent and records the local
evidence boundary for the keeper HTTPS/REST parity child containing this
manifest.
It does not authorize a push, deployment, hosting change, wallet/RPC action,
Preview, signing, or chain transaction.

- Proposed amended child: `4` other tracked paths plus this manifest.
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
  `397cfb831dfe3ce1f365f8bc1fbb6bed2c77ef727bb82143de13c941b3b9a5a0`.

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
