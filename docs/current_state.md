# Current State

Last updated: 2026-08-21.

This file is current repository truth. Detailed history is under
[`docs/archive/`](archive/). The only active queue is
[`remaining-worklist.md`](remaining-worklist.md), and the long-running testnet
campaign design is [`testnet-hardening-plan.md`](testnet-hardening-plan.md).

## Release candidate snapshot

- Branch: `codex/repo-cleanup`.
- Latest verified local code commit before this state refresh: `78df8c76`.
- The product, storage, testnet-proof, UX, P1 regression, local campaign and
  documentation packets are committed locally. The current immutable-checkout
  reproduction is clean for tracked files; `.tmp-*` and campaign reports are
  intentionally untracked generated artifacts. Nothing was pushed, signed or
  submitted to a chain during this final local cycle.
- The historical eight-partition map remains in
  [`release-candidate-partition.md`](release-candidate-partition.md).
- Local commits are authorized. The 2026-08-20 Sepolia V10 deployment was
  explicitly authorized and verified; no approval, bet, claim, mainnet action,
  push, or hosted frontend deployment follows from that authorization.

## Protected database state

The protected base file remains exact:

- path: `data/lore-v10.sqlite`;
- SHA-256: `C6EB88E635C4B3A978AF77CE7B50736D6A6A92CC7A481E166118A66D0EC2B482`;
- bytes: `258048`;
- mtime: `2026-08-13T12:18:50.8015294Z`;
- exclusive open check: pass at the latest inspection.

Earlier test-created sidecars were removed after an explicit approval and base
hash recheck. A later accidental direct invocation of the business coordinator
created a new `90672`-byte WAL and `32768`-byte SHM; its process was stopped and
the base hash/size/mtime remain exact. The sidecars are not release evidence and
must not be deleted or checkpointed without a fresh explicit approval. Explicit
OS-temp SQLite fixtures remain the only permitted DB target for local test code.

## 2026-08-20 local progress

- V10 global-stats and leaderboard materialization fixtures pass after the
  dirty-trigger conflict fix. Their database paths are explicit OS-temp paths;
  protected base/WAL/SHM hashes remain exact at the latest recheck.
- Testnet proof completion now fails closed unless one canonical canary
  admission binds exactly one runtime-identity preflight and one wallet
  preflight per admitted role. A declared approval also requires one successful
  receipt whose exact allowance equals the admitted cap. The managed supervisor
  passes its fresh run id to the strict analyzer, so replayed evidence from a
  different run also fails. This does not constitute a signed canary or hosted
  topology campaign.
- Site hardening includes a real guest login CTA bridge, recovery-copy
  consistency, transaction-bound jackpot sharing, persistent/error-aware wallet
  transfer history, mobile rewards/onboarding/layer fixes, and dedicated public
  FAQ/White Paper/Leaderboards metadata.
- `https://playlore.xyz/` fails browser navigation with
  `ERR_CERT_COMMON_NAME_INVALID`. No DNS/hosting certificate configuration is in
  this repository; remediation remains an external domain/hosting operation.

## Current local hardening packet

- Wallet sink: external EIP-1193 `chainId` and the complete accounts array are
  revalidated immediately before send. Only fully valid wrong-chain, empty-
  account, or different-account states may safely abandon a transfer lease;
  malformed/unknown provider state keeps it fail closed.
- Canary allowance: the old large default approval is removed. Each role is
  capped to exact planned spend, zero-spend roles do not approve, excessive
  pre-existing allowance fails preflight, and the post-receipt allowance is
  checked.
- Soak completion: the supervisor binds proof to a run id, current-run log and
  SHA-256 digest; the analyzer is allowlisted, redacted, timed out, tracked and
  required for success.
- Canary log integration: `LIVE_TEST_LOG_PATH` is now consumed through a pure
  absolute-path policy with ordinary-file/directory checks, so the supervisor's
  strict current-run containment can receive the actual JSONL.
- Load tool: memory is bounded; displayed quantiles are labeled approximate,
  while the p95 gate uses an exact above-threshold count. Error samples are
  capped and redacted before storage/output.
- Hermetic build DB: each process/thread receives its own SQLite file under a
  validated owned root; strict runtime rejects leaked hermetic-build variables.
- Business suite: `test:logic` and its summary now delegate to one isolated
  runner with an OS-temp DB and protected main/WAL/SHM before/after snapshots.
- The business coordinator now rejects a direct process before importing its
  suite unless the isolated runner supplies an absolute non-protected DB path
  and its one-shot admission marker.
- P1.10: additional wallet, reward, history, wins and leaderboard presentation
  seams are now executable. The refreshed AST audit reports `4660/5369`
  behavioral assertions (`86.79%`); the overall extraction remains partial.
- The corrected managed local campaign started a fresh iteration at this SHA
  lineage and completed all seven first-cycle steps. A previous second-cycle
  failure exposed an undefined analyzer helper in the exact-cap approval
  receipt branch; `d8774f69` corrects it to the shared transaction-hash
  validator and its focused release-operations test passes.
- Testnet plan: production-like topology, read model, long campaigns, mobile QA,
  profiling and final evidence criteria are recorded in
  [`testnet-hardening-plan.md`](testnet-hardening-plan.md).
- `.codexignore` now excludes generated `.tmp-*` trees from broad context scans.

## Verification state

| Boundary | Current evidence | Status |
| --- | --- | --- |
| Focused wallet/admin/load/canary/supervisor tests | Relevant behavioral packets passed | Pass locally |
| TypeScript | `tsc --noEmit` passed after the canary log-path fix | Pass locally |
| Hermetic build wrapper | Full focused hermetic test passed outside the managed sandbox; Worker-thread DB isolation is executable | Pass locally |
| Business-suite isolation runner | Two completed local-campaign iterations passed with the isolated runner; protected paths were rechecked unchanged | Pass locally |
| Full business logic | Logic reached `childExitCode=0` and `assertionFailures=0`, but that pre-isolation run created the protected WAL row | Not acceptable as DB-safe final evidence |
| Diff hygiene | `git diff --check` passes; one CRLF-to-LF warning remains informational | Pass |
| Security diff scan | Sealed scan `c611f992-3c4d-4ac6-8c9a-14033c6f7156`, snapshot digest `935fed40...3298e`, reviewed 22/22 files, 0 reportable findings; two same-user reparse candidates were validated not applicable | Pass for the frozen pre-log-fix patch only |
| P1.17 | Same-SHA canonical and isolated profiling build markers sealed locally at `81a5006f`; collector/verifier schema-3 self-tests passed | Open: physical native-hidden two-hour evidence and strict verification of the resulting report required |
| Local Playwright smoke | Desktop wallet selector, chat, navigation, accessibility, reduced motion and 390/430px shell checks passed; localhost mobile Privy login remained unavailable after one bounded reload | Partial local evidence only; public HTTPS and physical mobile proof remain external |
| Privy embedded modal | The pinned 3.27.2 provider's `Submit` email name and 24x24 close target are documented as upstream-owned; no DOM/CSS/node_modules workaround is allowed | External HTTPS/mobile QA open |
| Final clean checkout | Detached fresh `npm ci`, dependency/CI-security proofs, isolated business runner, P1/EVM, V9/V10 invariants, materialization tests, full local proof/prelaunch, and protected-DB recheck passed at `81a5006f`; canonical and isolated profiling provenance were sealed at the same SHA | Pass locally; the physical two-hour P1.17 evidence remains open |
| Sepolia V10 cutover | Canonical V10 deployed at `0x985c71613bb73fac5653c253a8ba37cd0ec8ab9a` in block `31678224`; strict constructor/receipt/runtime and chain proof checks pass with epoch-bound bets enabled | Pass for local Sepolia runtime; hosted frontend/indexer rollout remains external |
| Supported Standard security scan | The local supported-scan entitlement is `not_granted`; no substitute scan was represented as Standard evidence | External entitlement blocker |

The narrow canary log-path fix and documentation changes were made after the
sealed diff snapshot, so a final immutable-SHA supported scan remains required.

## Objective status

### P0

1. On the resulting immutable SHA, run a fresh detached `npm ci`, dependency
   gates, complete local/prelaunch checks, clean-checkout reproduction and the
   supported final security scan.
2. Keep the known block-context randomness risk open. The user explicitly
   deferred redesign; no contract randomness changes are in scope.

### P1

- P1.10 remains partial. Continue replacing source-operand assertions only
  where a real public behavior seam exists.
- P1.17 dual-build provenance is implemented; retain the strict verifier and
  collect the two-hour physical native-hidden evidence on the final SHA.
- Global stats and leaderboards use atomic scoped materialized read models;
  retain their dirty/restart and scale regressions in routine local gates.
- Soak status and JSONL processing are incremental and bounded; the real
  24-48 hour topology campaign remains external evidence.
- Canonical Sepolia V10 is `0x985c71613bb73fac5653c253a8ba37cd0ec8ab9a`
  (deployment tx `0x9ecd67de4de27efa42b174b2de1e3542dde74ac6d1450b1ac425b850303d58b1`).
  Its strict local post-deploy proof passes; the old `0x98ee...` 50-epoch proof
  remains historical and cannot satisfy the current target.
- Real Redis/Valkey Lua behavior, production-like replicas, external DB restore,
  public HTTPS/Privy and physical mobile-wallet evidence remain unproven.

## V10 and V9 policy

- Routine gates remain V10-only.
- Standalone V9 source, manifests and compatibility commands remain until
  canonical V10 deployment/cutover has external evidence.
- Do not silently remove V9, relabel historical evidence or treat local selector
  checks as deployed-bytecode proof.

## External and live blockers

- G1-G14 remain `0/14 Complete`.
- Prelaunch still has exactly `25` external/status blockers; mainnet environment
  validation still has `41` failures until refreshed evidence proves otherwise.
- Domain/HTTPS, Privy origins, ownership/randomness sign-off, supervised
  processes, two replicas with real shared limiting, fresh indexer DB,
  backup/restore, monitoring/alerts, wallet/mobile QA and final sign-off remain
  external.
- No current Preview authorizes a transaction. Any signed canary requires a new
  exact read-only Preview followed by separate bounded consent.

## Next safe sequence

1. Obtain explicit approval to delete only
   `data/lore-v10.sqlite-wal` and `data/lore-v10.sqlite-shm` after one final
   exclusive-access/base-hash check.
2. Run the isolated full business summary and recheck the protected DB invariant.
3. Commit the verified local packets, refresh P1.10 accounting and update the
   release map/state.
4. Implement the remaining local P1 work, then perform the immutable-SHA cycle.
5. Run the staged campaigns in
   [`testnet-hardening-plan.md`](testnet-hardening-plan.md) only when each
   external prerequisite and any required live consent exists.

## Safety boundaries

- Never print secrets, private keys, mnemonics, wallet files, sessions, keyed
  RPC URLs or private environment values.
- No deploy, approval, bet, claim, canary, soak, signing or chain write follows
  from a local green test.
- Do not call the project mainnet-ready while P1.17, immutable-SHA evidence,
  external gates and the current protected-DB invariant remain open.
