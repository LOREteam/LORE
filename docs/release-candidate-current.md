# Current release-candidate permission manifest

Snapshot date: 2026-08-27. Base immutable SHA:
`4b632bef3ee9e1b2eef2d10a2cd7ea09843406a4` on `codex/repo-cleanup`.

Status: the user has granted standing authority for local commits. This
manifest binds the regression correction for the project-native V10 canary
nonce-settlement proof. It does not authorize push, deployment, hosting
changes, Preview generation, signing, wallet use, approval, or any chain
transaction beyond separately granted bounded testnet work.

## Exact current scope

The path set below is the exact proposed index relative to
`4b632bef3ee9e1b2eef2d10a2cd7ea09843406a4`.

- Production paths: `0`.
- Test and test-runner paths: `1`.
- Current status/worklist/manifest paths: `1`.
- Excluded and retained generated evidence: the three user-owned untracked
  directories `artifacts/final-sha-local-gates-12c4909c/`,
  `artifacts/test-campaign-2026-08-20/`, and `artifacts/valkey-runtime/`.
- Authorized/expected staging paths: `2`.
- Exactness: `missing=0`, `extra=0`, `duplicates=0` under the exclusion above.
- Canonical path-set SHA-256 (UTF-8, ordinal-sorted paths, LF after every path):
  `51dca8d49f18f14a55fe604c84f154d693da7316703e6952dbbbfb05d331859a`.
- Canonical candidate file-content-set SHA-256 for the other `1` candidate
  files (this self-referential manifest excluded; ordinal-sorted
  `path + NUL + lowercase file-content SHA-256 + LF`):
  `631fb20f88784a612b044cbef598085552a379a242eb397bc6fc0b0493198f92`.

```text
docs/release-candidate-current.md
scripts/test-business-release-operations.mjs
```

The retained artifact directories stay on disk and must not be staged. Any
candidate path-set or candidate-content change invalidates this manifest and
requires fresh digests and a zero-omission audit before staging.
