# Security Review: linea-miner-main

## Scope

Exact release-candidate diff review from baseline 46d3bc5 to current committed RC 85840b5. Repository source was reviewed read-only; no wallet, chain, or live network execution.

- Scan mode: branch_diff
- Target kind: git_diff
- Target ID: target_sha256_908a147dd7e2bb281539a19d93c3def48ccab7950d49770aa8969ce57745331f
- Revision range: 46d3bc5072f07b4246ad1f7e516253aef5c8054b...85840b5b5f8de62e8c4abb5c8693f2910da722ce
- Snapshot digest: codex-security-snapshot/v1:sha256:1d74df0bc5da366ec7aad16a4841552de3d91d1cb5319d4e849096130ccb54eb
- Inventory strategy: diff
- Included paths: .
- Excluded paths: none
- Runtime or test status: not recorded
- Artifacts reviewed: artifacts/01_context/security_guidance.md, artifacts/01_context/threat_model.md, artifacts/02_discovery/deep_review_input.jsonl
- Scan context: Generated repository-wide threat model and diff-scoped review. Prior local findings are represented by their current remediations; external production gates and the separately scoped protocol-randomness concern are not claimed closed.

Limitations and exclusions:
- Excluded live operations: No live wallet, chain, production secret, or third-party operation was authorized or performed.

### Scan Summary

| Field | Value |
| --- | --- |
| Reportable findings | 0 |
| Severity mix | none |
| Confidence mix | none |
| Coverage | complete |
| Validation mode | source and focused local-test evidence |

Canonical artifacts: `scan-manifest.json`, `findings.json`, and `coverage.json`. This report is a deterministic projection of those files.

## Threat Model

Linea V10 application combining contracts, wallet orchestration, public APIs, privileged keeper/bootstrap operations, RPC-fed indexing, SQLite persistence, and operator tooling.

### Assets

- user stakes and rewards
- wallet and keeper authority
- admin/bootstrap authorization
- contract and ABI integrity
- indexed durable state
- operator secrets

### Trust Boundaries

- on-chain contract and token callbacks
- browser and wallet providers
- configured RPC providers
- public HTTP/API requests
- SQLite/WAL recovery
- operator configuration and scripts

### Attacker Capabilities

- public contract/API caller
- malicious or failing configured RPC
- malicious token callback
- stale or inconsistent wallet provider result
- malformed durable record

### Security Objectives

- prevent unauthorized or duplicate funds movement
- preserve canonical accounting and durable-state integrity
- protect privileged signing and secrets
- bound public/RPC-driven work

### Assumptions

- Live transactions require separate explicit consent.
- Configured RPC origins are external and untrusted; host diversity is not proof of independent operators.
- Local/testnet evidence does not close production sign-off.

## Findings

### No findings

No reportable findings survived the canonical discovery, validation, and reportability gates.

## Reviewed Surfaces

| Surface | Risk Area | Outcome | Notes |
| --- | --- | --- | --- |
| Public API and recovery paths | auth, untrusted RPC recovery, cache/persistence | Not applicable | Reviewed changed API/recovery files; finalized/checkpoint and cache-only controls preserved. |
| Wallet and Auto-Miner paths | fee, nonce, pending/reload, authorization | Not applicable | Reviewed changed wallet/runtime files; lease, reconciliation, fee and actor controls fail closed. |
| Privileged keeper/build/runtime tooling | signing, secrets, filesystem isolation, RPC quorum | Not applicable | Reviewed bot/config/build and operator scripts; changes strengthen guards. |
| Indexer and operational scripts | RPC bounds, canonicality, lease persistence | Not applicable | Reviewed bounded quorum, finality, response-work and lease controls. |
| Test/proof and scan artifacts | test isolation and regression coverage | Not applicable | Reviewed extracted and new test modules; fixtures use mock transports and owned temporary storage. |
| Server persistence and transaction safety | SQLite strict parsing, keeper budget, signed-envelope safety | Not applicable | Reviewed db/storage/keeper safety changes and direct callers. |

## Open Questions And Follow Up

- Protocol randomness/deployed-contract scope conflict remains an explicit release-goal follow-up and is not a no-findings conclusion for this diff scan.
