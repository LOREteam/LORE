# Agent Progress

Last updated: 2026-08-20.

Current truth is in [`current_state.md`](current_state.md). The active queue is
[`remaining-worklist.md`](remaining-worklist.md); long-running testnet campaigns
are in [`testnet-hardening-plan.md`](testnet-hardening-plan.md).

## Continuation point

- Branch `codex/repo-cleanup`; `HEAD`
  `4c771971a806d7bfc84b6e1376a45473bda8a4d8`.
- Product, storage, testnet-proof, UX, P1 regression, local campaign and
  documentation packets are committed locally. A read-only Preview and
  generated `.tmp-*`/campaign outputs remain outside commits. On 2026-08-20,
  one explicitly authorized canonical V10 deployment was sent to Sepolia and
  strictly verified; no approval, bet, claim, mainnet action or push occurred.
- Protected base DB is still exact (`C6EB88...EC2B482`, `258048` bytes,
  original mtime), but `659232`-byte WAL and `32768`-byte SHM exist. Both are
  exclusively openable. A copied forensic view showed only a test-created empty
  recent-wins snapshot metadata row in the WAL.
- Do not run a command that can select the default protected DB. Explicitly
  isolated OS-temp SQLite fixtures are allowed; never delete or checkpoint the
  base DB or its auxiliary files without separate destructive approval.

## Current local session — 2026-08-20

- P0.3 global-stats and leaderboard materialization fixtures pass after the
  leaderboard dirty-trigger conflict fix. Both use explicit OS-temp SQLite;
  protected base/WAL/SHM hashes remain exact.
- Strict managed-soak proof validation now always requires one canonical canary
  admission; a missing declaration fails closed. This is not signed-canary
  evidence.
- Guest mining CTAs now open the Header-owned login flow rather than rendering
  inert login buttons. No signing occurs at this boundary.
- Wallet recovery copy is aligned across FAQ, tutorial, White Paper and backup
  gate. Jackpot share/OG fields derive from verified indexed transaction events.
- The UI now has direct public docs URLs, mobile rewards/onboarding/layer fixes,
  and persistent stale/partial/error-aware wallet transfer history.

## Implemented in the current packet

1. External-wallet provider context is fully validated immediately before the
   send sink; unknown/malformed state preserves the transfer intent lease.
2. Testnet canary approvals are exact-run-cap, with zero-spend and excess-
   allowance behavior explicit and checked after receipt.
3. Soak completion is bound to the current run/log/input digest and requires a
   managed, timed, redacted strict analyzer.
4. The canary now consumes supervisor `LIVE_TEST_LOG_PATH` through a pure strict
   path policy; focused behavior, syntax and `tsc --noEmit` pass.
5. `load-http` uses bounded approximate display samples, exact p95 gate counts
   and pre-storage error redaction.
6. Hermetic builds route DB imports to per-process/per-Worker files and strict
   runtime rejects leaked hermetic variables.
7. Both business-suite entrypoints use a shared OS-temp SQLite runner with
   protected main/WAL/SHM snapshots; its mocked regression passes.
8. Chat session parsing has additional imported behavior coverage; P1.10 remains
   partial.
9. A production-like testnet campaign plan was added and broad generated
   `.tmp-*` paths were added to `.codexignore`.

## Verification and review

- Focused wallet, admin session, load statistics, release operations, supervisor
  behavior and hermetic build tests passed during packet development.
- The full business logic coordinator reached green, but the old launch path
  opened the protected DB and created the WAL row. Treat that run as logic
  evidence only, not protected-DB-safe release evidence.
- The first iteration of the 12-hour local campaign passed its isolated full
  business runner, P1/EVM, V9/V10, materialization and hermetic steps. It does
  not replace the final immutable-SHA cycle.
- Sealed Codex Security diff scan
  `c611f992-3c4d-4ac6-8c9a-14033c6f7156` covered the frozen 22-file patch with
  22/22 review items and 0 reportable findings. Two local same-user reparse race
  candidates were validated `not_applicable` because the required actor already
  has equivalent host filesystem authority.
- The canary log-path integration fix and docs were added after that snapshot;
  final immutable-SHA scanning remains open.

## Important open local work

- Preserve and prove the protected DB invariant through the immutable-SHA
  cycle; WAL/SHM removal still needs separate destructive approval.
- P1.10 audit is refreshed to `4588/5307` behavioral (`86.45%`); continue
  bounded extraction.
- Same-SHA canonical and profiling provenance is implemented and the two build
  identities have been sealed. A 60-second headed preflight did not observe
  native hidden state, so it cannot justify the required two-hour evidence.
- Global stats and leaderboards now use atomic materialized scoped read models
  with a monotonic revision; their isolated 10k/110k-row regressions pass.
- Soak status/log processing is incremental, rotated and bounded; real
  multi-replica/Redis/DB campaign evidence remains external.
- Current canonical Sepolia V10 is `0x985c71613bb73fac5653c253a8ba37cd0ec8ab9a`
  (block `31678224`, strict post-deploy proof passes); do not reuse the
  historical `0x98ee...` proof.
- The detached clean checkout at `4c771971` completed fresh install, dependency,
  build, P1/EVM, V9/V10, materialization and business-runner checks. A new docs
  commit requires the same immutable-SHA cycle again. Real Redis/Valkey Lua,
  supported Standard scan and hosted CI remain external.

## External boundary

- V9 remains a compatibility baseline until independently evidenced V10 cutover.
- Randomness redesign is explicitly deferred and remains an open risk.
- G1-G14 remain `0/14`; the recorded `25` external/status blockers remain open.
- Production-like replicas, Redis, external persistence/restore, HTTPS/Privy,
  monitoring, physical mobile wallets, signed canary, recovery/soak campaigns
  and final sign-off all require external evidence.
- Any signed testnet operation requires a fresh exact Preview and separate
  bounded consent. Existing private keys in environment do not constitute that
  consent.

## Immediate next sequence

1. Ask once for the precise destructive permission to discard the two test-only
   auxiliary SQLite files.
2. Reverify exclusive access and base identity, delete only WAL/SHM if approved,
   then run the isolated full business summary and prove no protected change.
3. Commit the verified documentation/operations packet and refresh exact status.
4. Continue remaining local P1 work before the final immutable-SHA cycle.
