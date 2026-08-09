# Current State

Last updated: 2026-08-09.

Detailed history is preserved in:

- [`docs/archive/current-state-through-2026-08-09.md`](archive/current-state-through-2026-08-09.md)
- [`docs/archive/agent-progress-through-2026-08-09.md`](archive/agent-progress-through-2026-08-09.md)

Open archived evidence only when a task needs it. The active work queue is
[`docs/remaining-worklist.md`](remaining-worklist.md).

## Release candidate state

- Functional post-hardening state is committed at `b36b37ac`.
- Reproducible V10 proof, dependency/toolchain pins, CI, and local gates are
  committed at `caaeb9fe`.
- `contracts/LineaOreV10.sol`, its compiler config, and the canonical
  compilation manifest are now tracked together. The provenance check reports
  `manifestMatches=true`, solc `0.8.36`, optimizer runs `200`, EVM `osaka`, and
  V10 runtime size `16488` bytes.
- The exact release candidate is not frozen yet. Documentation, line-ending
  policy/normalization, clean-checkout reproduction, and the fresh security
  scan still have to land on one final unchanged commit.
- Node is constrained to major `24` through `engines` and `.nvmrc`; npm is
  pinned through `packageManager` to `11.5.1`.

## Fresh local evidence

- Dependency repair is complete locally: npm-generated lock entries resolve
  `nanoid 3.3.17` and `js-yaml 4.3.1`; a clean `npm ci` exited `0`.
- `proof:deps:summary` passed with `high=0`, `critical=0`, and
  `blockingHighCritical=0` for production dependencies.
- `proof:deps:all:summary` passed with nine explicitly known dev-toolchain
  highs and zero blocking high/critical findings. Neither `nanoid` nor
  `js-yaml` is an exception.
- `scripts/check-local.mjs` now gives every child and managed smoke server a
  unique `.tmp/check-local-*` SQLite database. It snapshots existence, size,
  SHA-256, and nanosecond mtime for `data/lore-v10.sqlite`, `-wal`, and `-shm`,
  always stops/cleans up through failure-safe finalization, and rejects any
  protected DB drift.
- Two separate `npm.cmd run check:summary` invocations passed end to end. Each
  independently reported `gateExit=0`, `dbUnchanged=true`, zero residual
  `check-local-*` directories, and zero listeners on port `3101`.
- `npm.cmd run proof:prelaunch:summary` exited `0` on 2026-08-09. Every required
  local row passed, including V9/V10 provenance and invariants, lint, typecheck,
  build, bundle budget, business logic, indexer/DB, monitoring, both dependency
  gates, proof redaction, launch-doc structure, and readiness structure.

This is local source/build/test/smoke evidence. It is not deployed-host,
wallet-signing, transaction, mainnet, canary, soak, or final-launch evidence.

## External and live blockers

- G1-G14 remain `0/14 Complete`. The canonical status is
  [`docs/mainnet-status-board.md`](mainnet-status-board.md) and
  [`docs/mainnet-proof-record.md`](mainnet-proof-record.md).
- The latest prelaunch run reported 25 external/status command blockers:
  deployed V10 metadata identity, stale Preview, mainnet env/signoff, chain,
  host, indexer, restore, backup, monitoring, QA, canary, and strict launch
  evidence.
- The deployed Sepolia V10 runtime remains executable but has an exact
  metadata-only bytecode mismatch. Do not bypass or silently relabel it.
- The previously generated V10 Preview is stale and authorizes nothing.
  Before any Linea Sepolia write, generate a new dry-run Preview that binds
  actors, calls, value/gas caps, maximum transactions, and stop conditions,
  then obtain separate fresh exact bounded consent.
- Current mainnet evidence rules require G10/G11 proof on Linea mainnet and
  state that Sepolia evidence closes no G1-G14 gate. The goal's requested
  Sepolia 50-epoch soak therefore remains testnet evidence unless that policy
  conflict is explicitly resolved; it must not silently complete G10/G11.

## P1 engineering gaps

- V10 has strong deterministic JS models and RPC state-override probes, but no
  independent local EVM seeded fuzz/property runner.
- Contract ABI consumers still contain 26 non-test handwritten `parseAbi`
  call sites rather than one generated canonical snapshot/digest consumer.
- Wallet tests do not yet drive rejected, reverted, pending, replaced,
  success, wrong-network, reload/reconnect, slow Privy, pending nonce, and
  two-tab states through one executable state machine.
- Indexer writes events and cursor separately; finalized block identity,
  fork rollback/replay, a single-indexer lease, and WAL/busy contention tests
  remain open.
- API helpers have focused coverage, but no complete black-box route matrix or
  real two-process shared-rate-limit proof exists.
- `scripts/test-business-logic.mjs` remains about 20k lines and relies heavily
  on source-string assertions. It still needs incremental domain extraction
  into executable behavioral suites while preserving the compact interface.
- CI still needs the requested Windows path, scheduled audit, explicit
  indexer-storage row, timeout/concurrency policy, and compact artifacts.
- Round-state UX, complete mobile action docking, Privy modal/browser proof,
  keyboard/safe-area geometry, and requested route/2-hour performance evidence
  remain partial.

## Safety boundaries

- The removed wallet-delegation experiment remains absent from the normal
  runtime. Do not restore or enable it without separate explicit approval.
- Preserve intentional user-visible refresh behavior until measured evidence
  supports a change.
- Do not read or print secrets, private RPC URLs, signing material, wallet
  files, or private environment values.
- Do not claim G1-G14 completion from local checks or Sepolia simulations.
