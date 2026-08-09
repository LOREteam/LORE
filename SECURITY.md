# Security Policy

## Private Reporting

Report suspected vulnerabilities privately to `playlore88@gmail.com` before
public disclosure. Include the affected component, realistic impact, minimal
reproduction steps, and any public testnet transaction identifiers that help
confirm the issue.

Never send private keys, seed phrases, session cookies, production credentials,
or other users' personal data. Redact RPC credentials and webhook secrets from
logs and screenshots.

## Current Scope

The current supported review target is the repository's Linea Sepolia V10
candidate, including its Solidity contract, transaction orchestration,
indexer/API accounting, wallet recovery behavior, and production runtime
configuration. Historical V9 code remains in the repository for compatibility
and comparison, but new deployment findings should identify the exact contract
version and network.

Mainnet deployment is not currently represented as complete or independently
audited. Internal invariants, simulations, canaries, and automated security
reviews are engineering evidence, not a substitute for an independent smart-
contract audit.

## Research Boundaries

- Use Linea Sepolia and accounts you control unless a separate written scope is
  provided.
- Do not test with real user funds or attempt social engineering, credential
  theft, denial of service, destructive data changes, or third-party service
  abuse.
- Prefer the smallest proof that demonstrates impact. Stop once the issue is
  confirmed and preserve enough evidence for reproduction.
- Coordinate public disclosure so a validated issue can be fixed and users can
  be protected first.

The V10 threat model, token assumptions, known residual risks, reproducible
compiler settings, and verification commands are maintained in
[`docs/v10-contract-design.md`](docs/v10-contract-design.md).

## Dependency Overrides

`package.json` intentionally pins `@typescript-eslint/typescript-estree` -> `minimatch` -> `brace-expansion` to `5.0.6`.

This override keeps the transitive `brace-expansion` dependency on a version that includes the fix for CVE-2026-45149 / GHSA-jxxr-4gwj-5jf2 and is also inside the fixed range for CVE-2026-33750 / GHSA-f886-m6hf-6m8v.
