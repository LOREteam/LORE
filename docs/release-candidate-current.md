# Current release-candidate permission manifest

Snapshot date: 2026-08-26. Base `HEAD`:
`7918fba2a6aa1ea17629af267a234bd2d47f83f3` on `codex/repo-cleanup`.

Status: the user has granted authority for local commits. This manifest remains
the exact staging boundary for the current packet; that authority does not
authorize a push, deployment, hosting change, signing, wallet/RPC use, Preview
generation, approval, or a chain transaction.

## Exact current scope

The path set below is the exact proposed index relative to
`7918fba2a6aa1ea17629af267a234bd2d47f83f3`. It records the bounded prelaunch
timeout-policy correction and its executable regression coverage, plus this
self-excluded manifest.
It does not authorize a push, deployment, hosting change, wallet/RPC action,
Preview, signing, or chain transaction.

- Proposed child: `4` other tracked paths plus this manifest.
- Excluded and retained generated evidence: `393` files in `7` top-level
  directories under `artifacts/`.
- Authorized/expected staging paths: `5` (the `4` candidates plus this
  self-excluded manifest).
- Exactness: `missing=0`, `extra=0`, `duplicates=0` under the exclusion above.
- Canonical path-set SHA-256 (UTF-8, sorted paths, LF after every path):
  `4fd8a9af06bf2b4e4e45bd99fbce666abbcc8ed2fa63bd2d2f23be5c63ee93a0`.
- Canonical current content-set SHA-256 for the other `4` candidate files (this
  self-referential manifest excluded; sorted
  `path + NUL + file SHA-256 + LF`):
  `762ca6381b8393450a8d754314530eb296d861f91fa9eb4f1bef7afb6e30f934`.

```text
docs/release-candidate-current.md
scripts/report-prelaunch-status.mjs
scripts/run-business-logic-summary.mjs
scripts/test-business-prelaunch-status.mjs
scripts/test-business-summary-timeout.mjs
```

The 393 historical/test artifact files stay on disk and must not be staged by a
future authorized packet. Any candidate path-set change invalidates this
manifest and requires a fresh zero-omission audit before a new permission is
requested or used.
