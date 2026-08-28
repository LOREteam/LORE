# Current release-candidate permission manifest

Snapshot date: 2026-08-28. Base immutable SHA:
`dcafd2668e2804261c948b57a4ad849fc6e88df6` on `codex/repo-cleanup`.

Status: this is a proposed exact documentation-only index. It records the
completed bounded canary diagnosis and its already-committed runner fix. It
does not authorize staging or committing this manifest, push, deployment,
hosting changes, Preview generation, signing, wallet funding, or any chain
transaction.

## Exact current scope

The path set below is the exact proposed index relative to
`dcafd2668e2804261c948b57a4ad849fc6e88df6`.

- Production paths: `0`.
- Test and runner paths: `0`.
- Current state/worklist/manifest paths: `3`.
- Excluded and retained generated evidence: the three user-owned untracked
  directories `artifacts/final-sha-local-gates-12c4909c/`,
  `artifacts/test-campaign-2026-08-20/`, and `artifacts/valkey-runtime/`.
- Authorized/expected staging paths: `3`.
- Exactness: `missing=0`, `extra=0`, `duplicates=0` under the exclusion above.
- Canonical path-set SHA-256 (UTF-8, ordinal-sorted paths, LF after every path):
  `39dc14a00c8f804d02c74fd1309f88fa28bd97f7aaea7f74cdf29d9ad89b4751`.
- Canonical candidate file-content-set SHA-256 for the other `2` candidate
  files (this self-referential manifest excluded; ordinal-sorted
  `path + NUL + lowercase file-content SHA-256 + LF`):
  `60e25109d1e98f92d3599f7570b020287ed79c1699fbfb16e2235f8503c57e85`.

```text
docs/agent-progress.md
docs/current_state.md
docs/release-candidate-current.md
```

The retained artifact directories stay on disk and must not be staged. Any
candidate path-set or candidate-content change invalidates this manifest and
requires fresh digests, a zero-omission audit, and explicit approval before
staging or committing.
