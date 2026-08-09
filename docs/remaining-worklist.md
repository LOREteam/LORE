# Remaining Worklist

Last updated: 2026-08-09. This is the single active local work queue.

## P0 release candidate

- [x] Pin fixed `nanoid` and `js-yaml` versions and regenerate the lockfile.
- [x] Prove clean `npm ci` and both repository dependency gates.
- [x] Make `check-local` use a unique temporary SQLite database.
- [x] Prove protected V10 DB hash/mtime invariance across two full gates.
- [x] Track V10 source, compiler config, and compilation manifest.
- [x] Declare Node 24 and npm 11.5.1.
- [x] Split functional and tests/proof/tooling changes into separate commits.
- [ ] Commit the concise documentation/archive change separately.
- [ ] Add `.gitattributes` and isolate mechanical normalization.
- [ ] Reproduce the exact candidate from a clean detached checkout and prove
      it remains clean after install/gates.
- [ ] Run a fresh standard security scan against that exact commit; require
      canonical artifacts and no open local High/Medium findings.

## P1 code hardening

### V10 executable properties

- Add an independent local EVM runner with seeded, replayable fuzz/property
  sequences for accounting, exits, rebate/dust/fee flush, duplicate/replay/
  late calls, large values, bounded gas, reentrancy, and malicious ERC-20s.
- Reuse the existing JS accounting models as an oracle. Do not alter
  randomness, tokenomics, public selectors, or deployed contract behavior.

### Canonical ABI

- Generate one canonical ABI snapshot/fragments plus digest from the
  compilation manifest.
- Migrate the 26 non-test handwritten contract `parseAbi` consumers in small
  batches across frontend, routes, indexer, benchmark, and canary tooling.
- Make CI reject any contract/frontend/indexer/canary drift while preserving
  all required legacy selectors.

### Wallet runtime

- Add a table-driven executable lifecycle reducer/test suite for rejected,
  reverted, pending, replaced/repriced/cancelled, success, wrong network,
  reload/reconnect, slow Privy recovery, pending nonce, two tabs, and duplicate
  send prevention.
- Integrate the reducer with existing pending recovery without broad hook
  rewrites.

### Indexer and DB

- Commit parsed events and cursor atomically.
- Persist finalized block identity and implement bounded fork rollback/replay.
- Add a single-indexer lease and crash/restart/two-writer tests.
- Exercise WAL/busy contention and canonical chain-to-normalized-storage parity.

### API

- Define one route manifest covering every exported handler.
- Add a black-box matrix for method, auth, trusted origin, body/content limits,
  cache/no-store, status, and public error schema.
- Add malformed/oversized and nested redaction fuzz cases.
- Prove shared rate limiting using two isolated server processes and one
  external store stub.

### Test architecture and CI

- Keep `test:logic` and `test:logic:summary` stable, but extract one domain at
  a time: API boundaries, wallet runtime, then ops/proof.
- Replace source-string guards with imported pure logic or black-box behavior.
- Add indexer-storage explicitly to CI, a Windows core-gates job, scheduled
  dependency audit, workflow concurrency, job timeouts, and compact artifacts.

## UX, accessibility, and performance

- Derive one round-state model that distinguishes exact zero, resolving,
  keeper delayed, stale RPC/indexer, normal empty, and active states.
- Complete the mobile sticky mining bar with selected tiles, amount, total,
  Manual Bet and guarded Auto-Miner actions using 44px targets.
- Add executable Privy modal checks for email accessible name, close target,
  focus trap/return, keyboard, and mobile Web3-provider emulation.
- Coordinate chat, bottom navigation, safe-area, visual viewport/keyboard, and
  mobile sidebar dialog semantics; keep reduced-motion canvas alternatives.
- Measure compressed first-load per route, chunk ownership, rerenders,
  visible/hidden polling, long tasks, and separate two-hour idle/simulated
  Auto-Miner heap growth. Preserve intentional live refreshes.

## Linea Sepolia live boundary

- First generate a new read-only dry-run Preview binding exact roles/wallets,
  calls, value and gas caps, maximum transactions, and stop conditions.
- Stop and request separate fresh exact bounded consent immediately after that
  Preview. Without it, do not load signing material or submit any transaction.
- Only after consent, run the authorized minimal tranche and reconcile receipt,
  chain, indexer, DB, and UI accounting.
- Treat a 50-epoch/24-48h Sepolia soak as testnet evidence. Current mainnet
  policy says Sepolia closes no G1-G14 gate; resolve that policy conflict before
  changing G10/G11 status.

## External G1-G14

Keep all gates Missing until their canonical evidence exists: domain/HTTPS,
Privy production origins, ownership/randomness sign-off, supervised host
processes, two-replica limiter, fresh indexer DB/finality, real backup/restore,
monitoring/Resend/Sentry, wallet/mobile QA, live canary/recovery, and final
security/QA sign-off.
