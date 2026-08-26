# Current release-candidate permission manifest

Snapshot date: 2026-08-26. Base `HEAD`:
`75881579d8e6b00221d4e5577862fe1d223256cd` on `codex/repo-cleanup`.

Status: the user has granted authority for local commits. This manifest remains
the exact staging boundary for the current packet; that authority does not
authorize a push, deployment, hosting change, signing, wallet/RPC use, Preview
generation, approval, or a chain transaction.

## Exact current scope

The path set below is the exact proposed index relative to
`75881579d8e6b00221d4e5577862fe1d223256cd`. It records the P1.10
release-operations trusted Git/PowerShell fixture-path correction and its
minimal-PATH behavioral proof, plus this self-excluded manifest.
It does not authorize a push, deployment, hosting change, wallet/RPC action,
Preview, signing, or chain transaction.

- Proposed child: `1` other tracked path plus this manifest.
- Excluded and retained generated evidence: `393` files in `7` top-level
  directories under `artifacts/`.
- Authorized/expected staging paths: `2` (the `1` candidate plus this
  self-excluded manifest).
- Exactness: `missing=0`, `extra=0`, `duplicates=0` under the exclusion above.
- Canonical path-set SHA-256 (UTF-8, sorted paths, LF after every path):
  `51dca8d49f18f14a55fe604c84f154d693da7316703e6952dbbbfb05d331859a`.
- Canonical current content-set SHA-256 for the other `1` candidate file (this
  self-referential manifest excluded; sorted
  `path + NUL + file SHA-256 + LF`):
  `2f5e9dbfe704df0dc162ef31fac2c2f2f105bd1518cc8a54a9f6c0c3f92328c7`.

```text
docs/release-candidate-current.md
scripts/test-business-release-operations.mjs
```

The 393 historical/test artifact files stay on disk and must not be staged by a
future authorized packet. Any candidate path-set change invalidates this
manifest and requires a fresh zero-omission audit before a new permission is
requested or used.
