# Remaining Worklist

Last updated: 2026-08-11. This is the single active local work queue.

## P0 release candidate and security

- [x] Pin fixed `nanoid`/`js-yaml` versions, Node 24, and npm 11.5.1; refresh
      the lockfile and complete a clean current-tree `npm ci`. The production
      and all-dependency audit gates pass under their documented policy.
- [ ] Record or resolve npm 11's remaining `npm ls --all --package-lock-only`
      invalid markers after clean install. The minimal compatibility work has
      removed the unused root `accounts`, satisfied the Sentry webpack peer,
      and made the nested x402 React peer compatible; do not force a wider
      Privy/Wagmi upgrade merely to silence tooling output.
- [x] Make `check-local` hermetic and prove protected SQLite hash/mtime
      invariance across two full gates.
- [x] Track V10 source, compiler config, manifest, `.gitattributes` line-ending
      policy, and compact documentation.
- [x] Normalize tracked checkout line endings under the separate reviewed
      `80ce70b7` line-ending policy. The Git index was already canonical, so no
      synthetic content commit was created: a controlled CRLF-to-LF checkout
      pass followed by `git add` leaves zero mixed/non-batch-CRLF tracked files
      and a clean semantic diff; `.bat`/`.cmd` retain their CRLF policy.
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
- [x] Rebuild and re-baseline after clean `npm ci` on `c53c0afc`; production
      build and bundle baseline pass, and exact diff scan
      `b39bde24-6ba0-4e18-9c39-38b91766187e` reports no findings.
- [x] Seal the exact test-extraction follow-up range `c53c0afc..9eefb9cd`.
      The canonical bundle at
      [`artifacts/security/canonical-diff-c53c0afc-9eefb9cd`](../artifacts/security/canonical-diff-c53c0afc-9eefb9cd/)
      records deterministic digest `ca253f0c...dd09bb02` and no local
      High/Medium. The Workbench range-completion metadata omission is
      documented; it does not erase the sealed local contract evidence.
- [x] Seal the succeeding exact test/proof/documentation range
      `c53c0afc..f8e93905`. Scan `fa83b0ff-3fc0-4338-817d-a78fb42bdd8a` has a
      canonical bundle at
      [`artifacts/security/canonical-diff-c53c0afc-f8e93905`](../artifacts/security/canonical-diff-c53c0afc-f8e93905/)
      and no local findings across all 27 changed rows. It does not close the
      separate protocol-randomness High or external G1-G14.
- [x] Close P2 build-runner abandoned-lock recovery. Hermetic builds retain the
      bounded outer timeout and owned process-tree termination; the
      same-output-directory lock now records a PID/start-time identity and
      reclaims only a proven dead or PID-reused owner. Malformed, uninspectable,
      live, or replaced locks remain fail-closed. Focused adversarial lock tests
      and one real `build:summary` pass confirm the behavior.

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
      the remaining 7,809-line business-test coordinator. The client-identity/
      external-rate-limit behavior, wallet-shell/mining-action checks, and mining-runtime
      safety checks now run
      from their own imported modules; the
      API-recovery/storage,
      wallet-presentation, and public API read-model
      (rewards/recent-wins/leaderboards) assertions now run
      from imported modules, and the pending-nonce
      Preview network/credential boundary has executable CLI coverage instead
      of duplicate coordinator regex, and analytics history and game-data/
      presentation, runtime-metrics, error-boundary, runtime-polling, chat-polling, chat-content, release-operations, wallet/route-safety, Sentry-sanitization, and auth/canary-boundary tests now run from
      their own imported modules; pure game-data, runtime-metrics, canary-health, and chat retry bounds use
      direct behavioral inputs.
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
- [x] Capture current-tree bundle baseline after clean install: `226` files,
      `7500007` total bytes, `7162708` JS bytes, largest `1043297` under limit
      `1250000`.
- [x] Complete the two-hour local profile for the old exact `46d3bc50`
      baseline: API writes `0`, external browser requests blocked, net heap
      delta `-1099488`, peak `+10091819`, and DOM slope `0`.
- [ ] Repeat route compression/chunk/polling/rerender/long-task evidence on the
      final exact candidate and prove native hidden-state behavior. Exact
      `d626a0f` already has a complete two-hour profile: zero API writes, 134
      blocked external requests, `-702527` heap delta, `+2637951` peak, 3 DOM
      nodes, and 95ms max long task.
- [ ] Reconcile the newer complete local run on build `_nq8Gl2JBW5nUIFdEeXBn`:
      it had zero API writes and 134 blocked external requests, but a
      `+1125244` heap delta / `267820` bytes-hour sampled slope. Treat it as
      noisy partial evidence, not a leak conclusion or an exact-SHA profile.
- [ ] Repeat and evaluate the two-hour idle/simulated Auto-Miner profile on the
      final exact SHA without changing intentional refresh cadence.

## Linea Sepolia live boundary

- [ ] Validate the real Sepolia V10 runtime configuration, including
      `NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS=1`, then regenerate a
      passing fresh read-only Preview binding roles/wallets, calls, value/gas
      caps, maximum transactions, and stop conditions. The 2026-08-11 attempt
      had no signing material, wallet client, contract write, or sent
      transaction, but planner/matrix fail closed until that flag is present.
- [ ] Only after a passing fresh Preview, stop and request separate fresh exact
      bounded consent. Without it, do not load signing material or submit a write.
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
