# Current release-candidate permission manifest

Snapshot date: 2026-08-26. Base `HEAD`:
`99666ae20712359251124198aa0e6f9cc46ac848` on `codex/repo-cleanup`.

Status: the user has granted authority for local commits. This manifest remains
the exact staging boundary for the current packet; that authority does not
authorize a push, deployment, hosting change, signing, wallet/RPC use, Preview
generation, approval, or a chain transaction.

## Exact current scope

The path set below is the exact proposed index relative to
`99666ae20712359251124198aa0e6f9cc46ac848`. It records only the durable
release/state documentation for the already committed P1.10 release-operations
trusted Git/PowerShell fixture correction and its minimal-`PATH` behavioral
proof, plus this self-excluded manifest.
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
  `3ffdeea8b370b5688446d16477fc8c1fb9c183d9ebf406f98f1556fc784ac68e`.

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
