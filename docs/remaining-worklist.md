# Remaining Worklist

Last updated: 2026-08-09. This is the single active local work queue.

## P0 release candidate and security

- [x] Pin fixed `nanoid`/`js-yaml` versions, Node 24, and npm 11.5.1.
- [x] Make `check-local` hermetic and prove protected SQLite hash/mtime
      invariance across two full gates.
- [x] Track V10 source, compiler config, manifest, line-ending policy, and
      compact documentation.
- [x] Reproduce and scan exact clean candidate
      `06d0fe710f5991bbd4348eeb226cacb97d5a995c`.
- [x] Implement targeted local fixes/tests for its 11 Medium and 7 Low findings.
- [ ] Resolve the protocol-randomness High scope conflict. Do not claim closure
      while randomness/deployed-contract changes remain forbidden.
- [x] Pass two consecutive integrated `check:summary` runs with protected
      DB/WAL/SHM identity preserved, zero temp check directories, and no port
      `3101` listener.
- [x] Partition the new candidate into functional, tests/proof, CI, and compact
      documentation commits.
- [ ] Reproduce the resulting exact HEAD from a clean detached checkout and
      freshly rescan it. No unscanned working-tree fix is scan closure by itself.

## P1 code hardening

### V10 executable properties and ABI

- [x] Add seeded executable EVM properties for accounting, exits, rebate/dust/
      fee flush, duplicate/replay/late calls, large values, bounded gas,
      reentrancy, and hostile ERC-20 behavior without changing tokenomics or
      contract behavior.
- [x] Generate a compiler-derived V10 ABI snapshot, reviewed fragments, and
      semantic digest; wire shared production consumers and drift checks.
- [x] Remove residual direct `parseAbi(` sites; repository non-test and test
      recounts are both zero.

### Wallet, indexer, and API

- [x] Cover wallet rejected/reverted/pending/ambiguous/success, pending nonce,
      actor/signer change, reload/reconnect, wrong-network, two-tab, and duplicate
      send paths in local executable tests.
- [x] Make indexer event/checkpoint/cursor writes atomic; add bounded fork
      rollback/replay, opaque single-writer lease, log-index identity, restart,
      and two-process WAL/busy contention coverage.
- [x] Add a black-box API route matrix and real two-process shared admission
      proof for the hardened jackpot/deposit/health surfaces.
- [ ] Collect real Privy/wallet/browser evidence and production two-replica
      limiter/indexer evidence; local process tests do not close external gates.

### Test architecture and CI

- [x] Keep `test:logic`/`test:logic:summary` stable while extracting wallet,
      read-model, runtime-recovery, and cache/planner domains.
- [x] Add the bounded `test:p1-hardening` runner; current all-mode result is
      `18/18` with the V10 EVM suite included.
- [x] Pass focused smoke with canonical `Login` aria-label and exact
      `Manual Bet` selectors; bind the extreme fixture to the authoritative
      chain epoch and keep huge-bigint coverage in a separate unit test.
- [x] Add local CI definitions for Linux/Windows, scheduled dependency audits,
      explicit indexer/P1 rows, concurrency, timeouts, and compact artifacts.
- [ ] Continue replacing source-string guards with imported behavior and reduce
      the remaining approximately 17.2k-line business-test coordinator.
- [ ] Obtain green hosted CI evidence for the final exact commit.

## UX, accessibility, and performance

- [x] Add one round/current-source presentation model for exact zero, resolving,
      keeper-delayed, stale RPC/indexer, active-empty, and resolved-next states.
- [x] Add the guarded 44px mobile mining dock with selected amount/total,
      Manual Bet/Auto-Miner actions, chat exclusion, safe-area, and visual
      viewport handling.
- [x] Add local Privy login-state/accessibility, dialog focus/Escape/return, and
      reduced-motion regression suites.
- [x] Verify the mobile dock at `390x844` and `320x800` after the `HubContent`
      backdrop fix, plus sidebar dialog Escape/focus return, in browser runtime.
- [x] Verify app-controlled Privy trigger Escape/focus return.
- [ ] Resolve or explicitly accept the upstream Privy `3.27.2` embedded-modal
      blockers: email accessible name `Submit` and `24x24` close target. There
      is no supported config/API fix; do not patch DOM/CSS or `node_modules`.
- [ ] Complete real-modal keyboard/mobile Web3-provider, safe-area, focus-trap,
      wallet, and recovery evidence after the upstream blocker is resolved.
- [x] Add a loopback-only bounded performance collector; self-test passes
      `10/10` and accepts up to two hours.
- [x] Capture bounded `30.021s` evidence for build `JhHgSzv-ZUdb4JBBsIwV7`:
      five routes `200`, missing assets/API writes/experiment long tasks `0`,
      and external requests blocked. First-load gzip bytes are `/` `992897`,
      `/admin` `862572`, `/jackpot` `848473`, `/privacy` `848475`, and `/terms`
      `848473`.
- [ ] Repeat route compression/chunk/polling/rerender/long-task evidence on the
      final exact candidate and prove native hidden-state behavior.
- [ ] Run the separate two-hour idle/simulated Auto-Miner heap-growth profile
      without changing intentional refresh cadence.

## Linea Sepolia live boundary

- [ ] Generate a new read-only dry-run Preview binding exact roles/wallets,
      calls, value/gas caps, maximum transactions, and stop conditions.
- [ ] Stop and request separate fresh exact bounded consent immediately after
      that Preview. Without it, do not load signing material or submit a write.
- [ ] Only after consent, run the authorized minimal tranche and reconcile
      receipt, chain, indexer, DB, and UI accounting.
- [ ] Treat a 50-epoch/24-48h Sepolia soak as testnet evidence. Resolve the
      Sepolia-versus-G10/G11 policy conflict before changing gate status.

## External G1-G14

G1-G14 remain `0/14 Complete`. Keep every gate Missing until its canonical
production evidence exists: domain/HTTPS, Privy origins, ownership/randomness
sign-off, supervised hosts, two replicas, fresh finality/indexer DB, real
backup/restore, monitoring/Resend/Sentry, wallet/mobile QA, live
canary/recovery, and final security/QA sign-off.
