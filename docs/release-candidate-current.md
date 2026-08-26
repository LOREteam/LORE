# Current release-candidate permission manifest

Snapshot date: 2026-08-26. Base `HEAD`:
`b7a678970e90ecef8011926b255561f06d895e93` on `codex/repo-cleanup`.

Status: the user has granted authority for local commits. This manifest is the
exact staging boundary for the documentation packet that records the sealed
Standard Security Scan of `53846fe…` and the committed independent-RPC pending
repair fix at `33a090729`, plus the committed reserved-actor/nonce binding fix
at `6d70b0314`, authenticated chat identity fix at `0c673336f`, and bounded
chat-auth RPC admission fix at `697f03537`, plus bounded chat-profile storage at
`6d9f60411`, actor-scoped transfer-history rendering at `ff376d2fa`, and the
four-commit exact claim-lease remediation ending at `b7a678970`. All five
medium and both low scan findings now have local fixes; this documentation does
not substitute for the required detached post-fix seal and supported scan. That
authority does not authorize push, deployment, hosting changes, signing,
wallet/RPC use, Preview generation, approval, or a chain transaction.

## Exact current scope

The path set below is the exact proposed index relative to
`b7a678970e90ecef8011926b255561f06d895e93`. It contains only the durable
state/progress/worklist update and this self-excluded manifest.

- Proposed child: `3` other tracked paths plus this manifest.
- Excluded and retained generated evidence: `329` files in the three user-owned
  untracked directories `artifacts/final-sha-local-gates-12c4909c/`,
  `artifacts/test-campaign-2026-08-20/`, and `artifacts/valkey-runtime/`.
- Authorized/expected staging paths: `4` (the `3` candidates plus this
  self-excluded manifest).
- Exactness: `missing=0`, `extra=0`, `duplicates=0` under the exclusion above.
- Canonical path-set SHA-256 (UTF-8, sorted paths, LF after every path):
  `768f8c58400ab2977379de8611c7e91d064a5f561d5edbd4e274870f4c5376ad`.
- Canonical current content-set SHA-256 for the other `3` candidate files (this
  self-referential manifest excluded; sorted
  `path + NUL + file SHA-256 + LF`):
  `324d1e9c4c43498234f16d38fe50071134a90ebb17a881451a3b4ee4a329348d`.

```text
docs/agent-progress.md
docs/current_state.md
docs/release-candidate-current.md
docs/remaining-worklist.md
```

The retained artifact files stay on disk and must not be staged by this packet.
Any candidate path-set or candidate-content change invalidates this manifest and
requires fresh digests and a zero-omission audit before staging.
