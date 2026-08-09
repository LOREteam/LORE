# V10 Deployed Identity Boundary

Last updated: 2026-07-30T19:42:00Z.

Scope: Linea Sepolia `LineaOreV10` deployed identity verification. This is
read-only evidence only. It is not a redeploy request, mainnet sign-off, or
permission to change the deployed contract.

## Fresh Read-Only Verifier

Command:

```powershell
npm.cmd run proof:contract-deployed:v10:summary
```

Observed result:

- status: fail
- v10DeployedReadOnly: true
- network: sepolia
- chainId: 59141
- manifestMatches: true
- runtimeBytes: 16488
- expectedRuntimeBytes: 16488
- expectedExecutableRuntimeBytes: 16435
- immutableReferences: 16
- runtimeBytecode: false
- runtimeExecutable: true
- metadataOnlyMismatch: true
- token: true
- ownerNonZero: true
- feeRecipientNonZero: true
- transactionSent: false
- assertionFailures: 0

Interpretation: the deployed contract executable runtime matches the reviewed
V10 executable boundary after immutable handling, but full runtime bytecode does
not match exactly because metadata/source-layout differs. Keep this as an
explicit Sepolia behavior/gas-evidence boundary; do not treat it as a clean
canonical deployment identity proof.

## Offline Canonical Identity

Command:

```powershell
npm.cmd run proof:contract-deployed:v10:offline:summary
```

Observed result:

- status: pass
- v10OfflineIdentity: true
- compilerVersion: 0.8.36+commit.8a079791.Emscripten.clang
- compilerProfile: osaka-optimizer-200
- manifestMatches: true
- runtimeBytes: 16488
- executableRuntimeBytes: 16435
- immutableReferences: 16
- transactionSent: false
- assertionFailures: 0

## Operational Boundary

- Do not redeploy V10 as part of local hardening.
- Do not hide `metadataOnlyMismatch=true` behind passing local/offline checks.
- Use the current Linea Sepolia deployment only for bounded behavior and gas
  evidence until a separate deployment/sign-off decision exists.
- Mainnet readiness still requires the external G1-G4 contract/env/sign-off
  proof path.
