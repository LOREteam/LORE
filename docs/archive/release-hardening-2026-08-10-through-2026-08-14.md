# Release Hardening Archive: 2026-08-10 Through 2026-08-14

This file preserves the milestone-level history removed from the active
`current_state.md` and `agent-progress.md` on 2026-08-14. It is historical
evidence, not the current launch decision. Current truth lives in
[`../current_state.md`](../current_state.md), and the only active queue is
[`../remaining-worklist.md`](../remaining-worklist.md).

## Baseline and dependency hardening

- Commits `9e8c65d2` and `281c5fd0` established the hermetic build/npm boundary
  and fail-closed proof validation baseline.
- The lock resolved `nanoid@3.3.18` and `js-yaml@4.3.1`; Node `24.5.0` and npm
  `11.5.1` were used for the clean-install evidence.
- Production dependency policy reported `0` High/Critical findings. The full
  dependency view retained known development-toolchain High findings but no
  policy-blocking advisory.
- A disposable checkout reconstructed from the base plus the candidate patch,
  ran fresh `npm ci`, and passed the local gate after a test-only repository-name
  portability defect was corrected.

## Hermetic build and protected DB

- `check-local` moved runtime SQLite work to an owned `.tmp` path and verifies
  the protected `data/lore-v10.sqlite` SHA-256, length, mtime, WAL, and SHM state
  before and after the run.
- The build wrapper gained exact output locking, stale-owner validation,
  reparse/junction checks, clean Git provenance, canonical `.next` replacement,
  atomic marker publication, and non-sealed marker invalidation.
- A repeated-run `ENOENT` in the shared lock root was reproduced and fixed with
  bounded root recreation plus identity validation. The focused regression and
  two consecutive baseline runs passed.
- The protected DB identity at the end of this period was SHA-256
  `C6EB88E635C4B3A978AF77CE7B50736D6A6A92CC7A481E166118A66D0EC2B482`,
  length `258048`, mtime `2026-08-13T12:18:50.8015294Z`; WAL/SHM were absent.

## Contract, ABI, wallet, indexer, and API evidence

- V10 EVM fuzz/property coverage exercised accounting, exits, rebate/dust/fee
  paths, duplicate/replay/late calls, large values, gas bounds, reentrancy, and
  hostile ERC-20 behavior without changing randomness or tokenomics.
- Compiler-derived ABI fragments and snapshot digests replaced duplicated ABI
  parsing across contract/frontend/indexer/canary consumers, with drift checks
  tied to the compilation manifest.
- Wallet/mining tests expanded across rejected, reverted, pending, ambiguous,
  replaced, success, wrong-network, reload/reconnect, slow Privy, nonce, Web
  Locks, two-tab, and duplicate-send boundaries.
- Indexer/SQLite evidence covered normalized event IDs, fork/reorg recovery,
  atomic cursor/state persistence, finality, restart, lease contention, WAL/busy,
  scoped storage, backup no-clobber publication, and immutable restore checks.
- API coverage grew to a 9-route/85-request Next-handler matrix plus deterministic
  redaction fuzz, bounded bodies, auth/origin/method/cache/no-store/status/error
  behavior, temp SQLite side-effect checks, and shared-rate-limit models.

## P1.10 behavioral extraction

- The monolithic business coordinator was reduced to a compact orchestrator and
  domain modules. Repeated source-shape assertions were progressively replaced
  with executable pure policies, real route handlers, React SSR, temp SQLite,
  child-process CLI probes, and explicit fault mutants.
- Major extracted domains included release/proof tooling, prelaunch/health,
  autonomous status, browser/HTTP smoke, wallet/mining state machines, deposits,
  public read models, jackpots/rebates/reward scanning, chat session/auth/profile,
  runtime diagnostics, backup/restore, and operator nonce/soak controls.
- The last three packets in this archive added one-time chat-profile migration
  with cross-wallet isolation, stable chat-wallet/unread ownership behavior, and
  HeaderWalletCard SSR coverage.
- The ending accounting was `5178` assertions: `790` source-shape and `4388`
  behavioral (`84.74%`). This remained `PARTIAL`, not completion.

## Performance and browser evidence

- P1 performance schema/verifier self-tests, build-output identity, raw marker
  digest checks, atomic artifact publication, loopback-only browser collection,
  blocked external requests, and write/transaction counters were added.
- A profiling build measured real React component events without changing the
  canonical release output. Auto-Miner simulation remained transaction-disabled.
- Native-hidden timing and a clean sealed final-SHA two-hour memory run were not
  completed; diagnostic profiling was never promoted to release proof.

## Security review history

- Working-tree scan `1324c08f-9411-44ba-83ab-e3efd22218fc`, snapshot
  `codex-security-snapshot/v1:sha256:7781f9d152b05d3c3a7f3edd4e84f4c4d14c30a68b015b95a080258105b405e6`,
  completed `287/287` authoritative reviews with `0` reportable findings. Two
  discovery candidates were validated and rejected.
- Earlier working-tree and narrow committed scans remained useful historical
  evidence only. None replaced the required supported scan of the eventual
  clean immutable release SHA.

## V10, V9, and launch boundary

- Routine `check-local`, CI, and prelaunch became V10-only. Standalone V9
  source/manifest commands remained a compatibility baseline pending externally
  proven V10 deployment and cutover.
- The latest Sepolia V10 Preview remained read-only and failed closed because
  the deployed runtime did not prove the epoch-bound-bets flag. It authorized no
  transaction.
- G1-G14 remained `0/14 Complete`; external production, ownership/randomness,
  infrastructure, backup/restore, monitoring, mobile-wallet, and final-security
  evidence remained open.

## Historical references

- [`current-state-through-2026-08-09.md`](current-state-through-2026-08-09.md)
- [`agent-progress-through-2026-08-09.md`](agent-progress-through-2026-08-09.md)
- [`../release-candidate-partition.md`](../release-candidate-partition.md)
- [`../mainnet-status-board.md`](../mainnet-status-board.md)
- [`../mainnet-proof-record.md`](../mainnet-proof-record.md)
