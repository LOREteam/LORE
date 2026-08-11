# Remaining Worklist

Last updated: 2026-08-11. This is the single active local work queue.

## P0 release candidate and security

- [x] Pin fixed `nanoid`/`js-yaml` versions, Node 24, and npm 11.5.1; a fresh
      current-tree `npm ci` completed from the lockfile before repeated gates.
- [ ] Resolve the six remaining full `npm ls --all --package-lock-only`
      peer/resolution issues. Production-only `npm ls --omit=dev` is clean;
      do not force wallet/Privy/Sentry upgrades without a scoped compatibility
      decision and regression evidence.
- [x] Make `check-local` hermetic and prove protected SQLite hash/mtime
      invariance across two full gates.
- [x] Track V10 source, compiler config, manifest, `.gitattributes` line-ending
      policy, and compact documentation.
- [ ] Normalize the remaining 219 CRLF/mixed tracked worktree files through a
      separate reviewed Git commit; do not make an unreviewed broad rewrite of
      the working tree.
- [x] Reproduce and scan exact clean baseline
      `46d3bc5072f07b4246ad1f7e516253aef5c8054b`; scan
      `829f043d-0200-451f-b769-cd746800eb2a` reported `4 High`, `13 Medium`,
      and `6 Low`.
- [x] Implement targeted local fixes/tests for every permitted finding and the
      bypasses found during final combined review.
- [ ] Resolve the protocol-randomness High scope conflict. Do not claim closure
      while randomness/deployed-contract changes remain forbidden.
- [x] Pass two consecutive integrated `check:summary` runs with protected
      DB/WAL/SHM identity preserved, zero temp check directories, and no port
      `3101` listener.
- [x] Refresh the publication plan for all current `96` changed paths in
      [`release-candidate-partition.md`](release-candidate-partition.md), with
      no secrets, DB files, or generated artifacts.
- [x] Commit the runtime/data, hermetic tooling, behavioral proof, and
      toolchain partitions locally. Commit the compact documentation partition
      next, then scan its exact SHA.
- [x] Record the later direct-build DB correction: unchanged main DB bytes,
      bootstrap-only WAL schema/index/meta changes, no user/runtime row
      insert/delete; subsequent checks use temp DBs and preserve the new state.
- [x] Record `c7662d53-c089-436a-93fd-f9506f2279f0` as unsealed and unusable;
  do not retry it as a substitute for a fresh exact-commit scan.
- [x] Run sealed working-tree scan
  `ad1649f6-e2e4-448a-b199-687e77fa4c6d` for the 56-path
  `89060390...2e8eacba1f58` snapshot; it found a Medium hashless-pending
  duplicate-stake path and a Low Auto-Miner actor-switch path, both fixed
  afterward with focused tests.
- [x] Seal the exact committed follow-up diff scan. Scan
  `810da212-4774-48ae-a48f-9a5b702e8933` covers
  `fbec521..f01aa22`, has canonical artifacts and clean-worktree digest
  `1d74df0b...ccb54eb`, and reported no findings in the three changed
  test-orchestration files. It supplements, rather than replaces, the earlier
  full candidate scan; the protocol-randomness High remains open.
- [x] Re-run the EVM-inclusive P1 runner after the post-scan wallet fixes:
  `36/36` passes with the final SQLite backup assertion and EVM included.
- [x] Route all build entry points through the adversarially tested hermetic
      wrapper and reject raw production builds without its marker.
- [ ] Address residual P2 build-runner work: outer timeout/process-tree
      ownership and same-output-directory concurrency locking.

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
      read-model, reward-scanner, live-state API, indexer-normalization,
      runtime-recovery, cache/planner, and wallet-runtime domains.
- [x] Add the bounded `test:p1-hardening` runner; current all-mode result is
      `36/36` with the V10 EVM suite included; the core runner also executes
      the isolated SQLite scope/backup/restore/WAL drill.
- [x] Pass focused smoke with canonical `Login` aria-label and exact
      `Manual Bet` selectors; bind the extreme fixture to the authoritative
      chain epoch and keep huge-bigint coverage in a separate unit test.
- [x] Add local CI definitions for Linux/Windows, scheduled dependency audits,
      explicit indexer/P1 rows, concurrency, timeouts, and compact artifacts.
- [ ] Continue replacing source-string guards with imported behavior and reduce
      the remaining 16,026-line business-test coordinator.
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
- [x] Capture current-tree bundle baseline: `229` files, `8469574` total bytes,
      `7075415` JS bytes, largest `1002767` under limit `1250000`.
- [x] Complete the two-hour local profile for the old exact `46d3bc50`
      baseline: API writes `0`, external browser requests blocked, net heap
      delta `-1099488`, peak `+10091819`, and DOM slope `0`.
- [ ] Repeat route compression/chunk/polling/rerender/long-task evidence on the
      final exact candidate and prove native hidden-state behavior.
- [ ] Repeat and evaluate the two-hour idle/simulated Auto-Miner profile on the
      final exact SHA without changing intentional refresh cadence.

## Linea Sepolia live boundary

- [x] Generate a fresh read-only V10 dry-run Preview binding roles/wallets,
      calls, value/gas caps, maximum transactions, and stop conditions. The
      2026-08-11 result has planner/pending/matrix exits `0`, 6 rounds, 12
      planned bet transactions, no signing material, no wallet client, no
      contract write, and explicitly blocks G10/G11.
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

Latest prelaunch evidence passes every required-local row but still reports
`24` external/status blockers and `41` mainnet environment failures. A fresh
Sepolia Preview exists but confers no authorization; the testnet soak has not
started.
