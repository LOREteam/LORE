# Current release-candidate permission manifest

Snapshot date: 2026-08-25. Base `HEAD`:
`a65ae8cc2a03af3438e55e671a98cb9b7b3d471e` on `codex/repo-cleanup`.

Status: the user has granted authority for local commits. This manifest remains
the exact staging boundary for the current packet; that authority does not
authorize a push, deployment, hosting change, signing, wallet/RPC use, Preview
generation, approval, or a chain transaction.

## Exact current scope

The path set below is taken from NUL-delimited
`git status --porcelain=v1 -z --untracked-files=all` and is bound to the base
`HEAD` above. It corrects the Valkey platform digest from an ARM-only manifest
to the official Valkey `8.1.9` OCI index and its Linux AMD64 child manifest,
then records the corresponding current-state boundary.

- Candidate: `3` tracked paths; `0` untracked paths.
- Excluded and retained generated evidence: `31` paths under `artifacts/`.
- Staged paths: `3`.
- Exactness: `missing=0`, `extra=0`, `duplicates=0` under the exclusion above.
- Canonical path-set SHA-256 (UTF-8, sorted paths, LF after every path):
  `dcc447ae502c0806169fa25d0df45b4a597755268e8964cb8a61e9ea9bd2887f`.
- Canonical content-set SHA-256 for the other `2` candidate files (this
  self-referential manifest excluded; sorted `path + NUL + file SHA-256 + LF`):
  `937b7798d2c29a2283cff10fe526c5348c8b0183b79bff5f13d7781ceefd3757`.

```text
docs/current_state.md
docs/release-candidate-current.md
docs/valkey-upstash-parity-plan.md
```

The 31 historical campaign artifacts stay on disk and must not be staged by a
future authorized packet. Any candidate path-set change invalidates this
manifest and requires a fresh zero-omission audit before a new permission is
requested or used.
