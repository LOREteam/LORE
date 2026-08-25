# Current release-candidate permission manifest

Snapshot date: 2026-08-26. Base `HEAD`:
`964284caaac9d2434af905cb677749e85cb81e3d` on `codex/repo-cleanup`.

Status: the user has granted authority for local commits. This manifest remains
the exact staging boundary for the current packet; that authority does not
authorize a push, deployment, hosting change, signing, wallet/RPC use, Preview
generation, approval, or a chain transaction.

## Exact current scope

The path set below is the exact proposed index relative to
`964284caaac9d2434af905cb677749e85cb81e3d`. It records the P1-hardening
prelaunch watchdog correction and its executable policy self-test, plus this
self-excluded manifest.
It does not authorize a push, deployment, hosting change, wallet/RPC action,
Preview, signing, or chain transaction.

- Proposed child: `1` other tracked path plus this manifest.
- Excluded and retained generated evidence: `393` files in `7` top-level
  directories under `artifacts/`.
- Authorized/expected staging paths: `2` (the `1` candidate plus this
  self-excluded manifest).
- Exactness: `missing=0`, `extra=0`, `duplicates=0` under the exclusion above.
- Canonical path-set SHA-256 (UTF-8, sorted paths, LF after every path):
  `59e3f3f8ce695ccca98ba0a534b89dae87fa6911df9d92ba8cd81e926951d83d`.
- Canonical current content-set SHA-256 for the other `1` candidate file (this
  self-referential manifest excluded; sorted
  `path + NUL + file SHA-256 + LF`):
  `5b1bb1e99c3c45e828ea7f06183bac9b9cb49b52cfe706639e2e876f0dec4036`.

```text
docs/release-candidate-current.md
scripts/report-prelaunch-status.mjs
```

The 393 historical/test artifact files stay on disk and must not be staged by a
future authorized packet. Any candidate path-set change invalidates this
manifest and requires a fresh zero-omission audit before a new permission is
requested or used.
