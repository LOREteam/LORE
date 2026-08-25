# Current release-candidate permission manifest

Snapshot date: 2026-08-26. Base `HEAD`:
`20ae744f2a08b4507b0a513feff687337b58a8e4` on `codex/repo-cleanup`.

Status: the user has granted authority for local commits. This manifest remains
the exact staging boundary for the current packet; that authority does not
authorize a push, deployment, hosting change, signing, wallet/RPC use, Preview
generation, approval, or a chain transaction.

## Exact current scope

The path set below is the exact proposed index relative to
`20ae744f2a08b4507b0a513feff687337b58a8e4`. It records the documentation-only
evidence update for the P1-hardening prelaunch watchdog correction, plus this
self-excluded manifest.
It does not authorize a push, deployment, hosting change, wallet/RPC action,
Preview, signing, or chain transaction.

- Proposed child: `3` other tracked paths plus this manifest.
- Excluded and retained generated evidence: `393` files in `7` top-level
  directories under `artifacts/`.
- Authorized/expected staging paths: `4` (the `3` candidates plus this
  self-excluded manifest).
- Exactness: `missing=0`, `extra=0`, `duplicates=0` under the exclusion above.
- Canonical path-set SHA-256 (UTF-8, sorted paths, LF after every path):
  `768f8c58400ab2977379de8611c7e91d064a5f561d5edbd4e274870f4c5376ad`.
- Canonical current content-set SHA-256 for the other `3` candidate files (this
  self-referential manifest excluded; sorted
  `path + NUL + file SHA-256 + LF`):
  `95f1a8ed9b83e59cbc64b1289e35474a0621a7f0770c5882b027a49bf13bbfd7`.

```text
docs/agent-progress.md
docs/current_state.md
docs/release-candidate-current.md
docs/remaining-worklist.md
```

The 393 historical/test artifact files stay on disk and must not be staged by a
future authorized packet. Any candidate path-set change invalidates this
manifest and requires a fresh zero-omission audit before a new permission is
requested or used.
