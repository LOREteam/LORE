# Security Review: linea-miner-main

## Scope

Exact committed diff review of f8e93905..9ab501e6. All 18 deterministic changed-file rows were deep-reviewed with full-file receipts in the scan work ledger; no live wallet, chain, or network actions were performed.

- Scan mode: diff
- Target kind: git_diff
- Target ID: target_sha256_908a147dd7e2bb281539a19d93c3def48ccab7950d49770aa8969ce57745331f
- Revision range: f8e93905d705b921334d2c5cea54eb680fece63d...9ab501e65ee1cddd815a1647ec01d205384fdd1b
- Snapshot digest: codex-security-snapshot/v1:sha256:1d74df0bc5da366ec7aad16a4841552de3d91d1cb5319d4e849096130ccb54eb
- Inventory strategy: diff
- Included paths: .
- Excluded paths: none
- Runtime or test status: local-only; no external launch evidence claimed
- Artifacts reviewed: artifacts/01_context/security_guidance.md, artifacts/01_context/threat_model.md, artifacts/02_discovery/deep_review_input.jsonl, artifacts/02_discovery/work_ledger.jsonl, artifacts/02_discovery/finding_discovery_report.md
- Scan context: The scan covers test-domain extractions, compact proof-summary wiring, hermetic-build lock recovery/tests, performance evidence documentation, and inert prior scan artifacts. No changed application wallet, contract, API, indexer, or production runtime behavior was introduced by this range.

Limitations and exclusions:
- The review is precise to the resolved committed range and does not close pre-existing protocol-randomness risk or external G1-G14 launch gates.
- Excluded protocol-randomness: Pre-existing High requires randomness/deployment scope beyond this test/docs/build diff.
- Excluded G1-G14: External deployment, ownership, browser-wallet, monitoring, backup, and soak evidence is not supplied by this local diff review.

### Scan Summary

| Field | Value |
| --- | --- |
| Reportable findings | 0 |
| Severity mix | none |
| Confidence mix | none |
| Coverage | complete |
| Validation mode | full-file diff review with direct supporting-path inspection and focused local checks reported in receipts |

Canonical artifacts: `scan-manifest.json`, `findings.json`, and `coverage.json`. This report is a deterministic projection of those files.

## Threat Model

The repository's Linea Sepolia V10 candidate protects wallet and signing authority, contract/accounting integrity, indexed/API state, privileged admin and operator controls, production configuration, and user/session data. Primary boundaries include untrusted browser/API input, wallet/provider and configured RPC behavior, SQLite/indexer persistence, external rate-limit and monitoring providers, and operator-only scripts. Local test evidence is not production launch approval.

### Assets

- wallet funds and signer authority
- contract accounting and epoch integrity
- API/indexer persistence and availability
- admin/operator credentials and production configuration
- user/session and monitoring data

### Trust Boundaries

- browser and public API requests
- wallet/Privy/provider interactions
- configured RPC and external rate-limit providers
- SQLite/indexer storage and process leases
- operator script/runtime environment

### Attacker Capabilities

- malformed public requests and hostile URLs/identifiers
- wallet/provider ambiguity and reload/reconnect timing
- malicious or unavailable configured external services
- local repository modification only where explicitly trusted

### Security Objectives

- fail closed at privileged, wallet, and production boundaries
- prevent duplicate or unintended transaction submission
- bound untrusted input and external response work
- preserve canonical chain/indexer/persistence integrity
- do not treat local evidence as external launch approval

### Assumptions

- no live wallet, chain, or network action is authorized for this scan
- existing protocol-randomness High and external G1-G14 evidence remain open and out of scope

## Findings

### No findings

No reportable findings survived the canonical discovery, validation, and reportability gates.

## Reviewed Surfaces

| Surface | Risk Area | Outcome | Notes |
| --- | --- | --- | --- |
| Prior canonical scan artifacts | artifact integrity and scope claims | Not applicable | Three inert historical JSON artifacts were added with matching declared hashes and bounded relative paths; no runtime consumer. |
| Compact business-proof summary and coordinator | test masking and proof false-green | Not applicable | Fixed no-shell child execution and static module paths; the changed auth/rate-limit modules are included and all local proof flags pass. |
| Hermetic build lock recovery | filesystem/process isolation and protected DB state | Not applicable | Strict owner identity, reparse rejection, bounded cleanup, and protected DB snapshot checks remain fail closed; focused build test passes. |
| Auth and external rate-limit test extractions | origin, replay, two-replica and response-boundary coverage | Not applicable | Test-only injected stubs and restored environment state; coordinator awaits both executable suites. |
| Runtime error, metrics, and Sentry test extractions | error redaction and test harness isolation | Not applicable | Synthetic inputs and scoped global restoration only; no production transport or privileged sink changed. |
| Explorer and utility behavior test extractions | untrusted identifiers, formatting, timeout, and redaction regression coverage | Not applicable | Direct pure helper assertions with fixed imports and no external sink. |
| Mining runtime and wallet-shell test extractions | authorization, duplicate-send, tab lock, persisted-session boundaries | Not applicable | Mandatory coordinator execution traces unchanged guarded runtime paths; local logic gate passes. |
| Release operations and wallet-route safety test extractions | operator-script and wallet-route regression coverage | Not applicable | Owned temporary fixtures and hard-coded child args only; no live wallet or transaction action. |
