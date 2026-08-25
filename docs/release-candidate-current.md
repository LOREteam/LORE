# Current release-candidate permission manifest

Snapshot date: 2026-08-25. Base `HEAD`:
`154b29b592182600d118736f1c2d312d92fcc9a3` on `codex/repo-cleanup`.

Status: the user has granted authority for local commits. This manifest remains
the exact staging boundary for the current packet; that authority does not
authorize a push, deployment, hosting change, signing, wallet/RPC use, Preview
generation, approval, or a chain transaction.

## Exact current scope

The path set below is taken from the NUL-delimited proposed amended index via
`git diff --cached --name-only -z 154b29b592182600d118736f1c2d312d92fcc9a3`.
It is the exact five-path change relative to that parent and records the local
evidence boundary for the documentation-only clean-HEAD persistence/restore record
containing this manifest.
It does not authorize a push, deployment, hosting change, wallet/RPC action,
Preview, signing, or chain transaction.

- Proposed amended child: `4` other tracked paths plus this manifest.
- Excluded and retained generated evidence: `329` files in `3` top-level
  directories under `artifacts/`.
- Authorized/expected staging paths: `5` (the `4` candidates plus this
  self-excluded manifest).
- Exactness: `missing=0`, `extra=0`, `duplicates=0` under the exclusion above.
- Canonical path-set SHA-256 (UTF-8, sorted paths, LF after every path):
  `13a8019722374a3ecd2e3729ec5fc456583fed90907b9eb9d7a3c2411bc920e9`.
- Canonical current content-set SHA-256 for the other `4` candidate files (this
  self-referential manifest excluded; sorted
  `path + NUL + file SHA-256 + LF`):
  `35cb39aa76bb42ab7b2925e1832b65945ebc57a76bb588c62547615ec8f75f4a`.

```text
docs/agent-progress.md
docs/current_state.md
docs/release-candidate-current.md
docs/remaining-worklist.md
docs/valkey-upstash-parity-plan.md
```

The 329 historical/test artifact files stay on disk and must not be staged by a
future authorized packet. Any candidate path-set change invalidates this
manifest and requires a fresh zero-omission audit before a new permission is
requested or used.
