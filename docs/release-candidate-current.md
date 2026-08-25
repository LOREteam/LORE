# Current release-candidate permission manifest

Snapshot date: 2026-08-26. Base `HEAD`:
`8797e30d3e985a8307ad24c721258da7a86f341a` on `codex/repo-cleanup`.

Status: the user has granted authority for local commits. This manifest remains
the exact staging boundary for the current packet; that authority does not
authorize a push, deployment, hosting change, signing, wallet/RPC use, Preview
generation, approval, or a chain transaction.

## Exact current scope

The path set below is taken from the NUL-delimited proposed amended index via
`git diff --cached --name-only -z 8797e30d3e985a8307ad24c721258da7a86f341a`.
It is the exact four-path change relative to that parent and records the local
evidence boundary for the documentation-only clean-HEAD AdminOps path-redaction
behavior record containing this manifest.
It does not authorize a push, deployment, hosting change, wallet/RPC action,
Preview, signing, or chain transaction.

- Proposed amended child: `3` other tracked paths plus this manifest.
- Excluded and retained generated evidence: `330` files in `4` top-level
  directories under `artifacts/`.
- Authorized/expected staging paths: `4` (the `3` candidates plus this
  self-excluded manifest).
- Exactness: `missing=0`, `extra=0`, `duplicates=0` under the exclusion above.
- Canonical path-set SHA-256 (UTF-8, sorted paths, LF after every path):
  `768f8c58400ab2977379de8611c7e91d064a5f561d5edbd4e274870f4c5376ad`.
- Canonical current content-set SHA-256 for the other `3` candidate files (this
  self-referential manifest excluded; sorted
  `path + NUL + file SHA-256 + LF`):
  `e1f476558e425dbe6e5914fd7b25056490bd1ffbbffb21112fe3398b4c049f93`.

```text
docs/agent-progress.md
docs/current_state.md
docs/release-candidate-current.md
docs/remaining-worklist.md
```

The 330 historical/test artifact files stay on disk and must not be staged by a
future authorized packet. Any candidate path-set change invalidates this
manifest and requires a fresh zero-omission audit before a new permission is
requested or used.
