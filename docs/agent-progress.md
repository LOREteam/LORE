# Agent Progress

Compact handoff for active work only. Full history through 2026-08-09 is in
[`docs/archive/agent-progress-through-2026-08-09.md`](archive/agent-progress-through-2026-08-09.md).
Repository truth lives in [`docs/current_state.md`](current_state.md), and the
single active queue is [`docs/remaining-worklist.md`](remaining-worklist.md).

## Completed in the current run

- Produced and cleanly reproduced exact candidate
  `06d0fe710f5991bbd4348eeb226cacb97d5a995c` with pinned dependencies/toolchain,
  tracked V10 provenance, hermetic SQLite gates, compact docs, and normalized
  line endings.
- Scanned that exact commit: `1 High`, `11 Medium`, and `7 Low`.
- Added targeted fixes and regression tests for all 11 Medium and 7 Low findings
  in the current working tree. The protocol-randomness High remains open because
  fixing it conflicts with the objective's ban on randomness/deployed-contract
  changes.
- Added compiler-derived V10 ABI snapshot/fragments/digest, an executable EVM
  property runner, wallet lifecycle hardening, atomic fork-aware indexer storage
  with a single-writer lease, black-box API/shared-admission tests, and bounded
  P1 orchestration.
- Split four business-test domains out of the monolith and updated CI locally
  for Windows, scheduled audits, indexer/P1 coverage, timeouts, concurrency, and
  compact artifacts.
- Partitioned the new candidate into functional `d97f4f80`, tests/proof
  `c40ca50d`, and CI `e3f37589` commits; this compact documentation update is
  the final local partition before detached reproduction.
- Added round/current-source presentation, mobile dock/viewport handling, Privy
  login state/accessibility, dialog/motion coverage, and a bounded performance
  evidence collector.
- Captured browser runtime passes for the mobile dock at `390x844` and
  `320x800`, sidebar Escape/focus return, and app-controlled Privy trigger
  Escape/focus return. The Privy `3.27.2` embedded modal itself remains blocked
  upstream by an email accessible name of `Submit` and a `24x24` close target;
  no unsupported DOM/CSS or dependency patch was introduced.
- Performed no wallet signing or chain write. The removed wallet-delegation experiment remains disabled.

## Current verification

- `npm.cmd run test:p1-hardening:all:summary` - pass, `18/18`, EVM included,
  duration `53423ms`.
- V10 compilation provenance - pass; manifest and ABI snapshot match; fragment
  digest `69218b3a...1900c`; runtime size `16488` bytes.
- Two sequential `npm.cmd run check:summary` runs - exit `0`, each ending
  `Local check completed successfully`. Protected DB/WAL/SHM length, UTC mtime,
  and SHA-256 stayed identical before/between/after (`D2CF3A...`, `9E5CA5...`,
  `E9C61E...`); temp check directories and port `3101` listeners both ended at
  zero.
- Focused smoke - pass after canonical `Login` aria-label and exact
  `Manual Bet` selector updates. The extreme fixture now respects the
  authoritative chain epoch, with huge-bigint behavior isolated in its own
  unit test.
- `npm.cmd run perf:p1:self-test` - pass, `10/10`; maximum accepted duration is
  two hours.
- Focused suites cover admin sessions, fee policy, deposits, jackpot admission,
  API routes, health/round evidence, bootstrap locking, wallet state, indexer
  fork/lease/identity, round/mobile/Privy/motion, process identity, and V10 EVM.
- Bounded performance build `JhHgSzv-ZUdb4JBBsIwV7` - `30.021s`, five routes
  `200`, missing assets `0`, API writes `0`, external requests blocked, and
  experiment long tasks `0`; first-load gzip was `/` `992897`, `/admin`
  `862572`, `/jackpot` `848473`, `/privacy` `848475`, and `/terms` `848473`.
- The new candidate has two green full build/check runs but does not yet have
  clean-checkout reproduction, a fresh exact-SHA security scan, full Privy modal
  accessibility closure, native hidden-state proof, or two-hour performance
  result.

## Active handoff

1. Preserve the zero-`parseAbi` canonical ABI result and stable `test:logic`
   interfaces while continuing only tightly scoped test extraction.
2. Preserve the two green hermetic full-check results; repeat affected focused
   or full gates if the integrated code changes again.
3. Freeze the resulting documentation commit as the new exact candidate,
   reproduce it from a clean detached checkout, and verify protected DB/hash
   invariance.
4. Freshly scan that unchanged candidate and attach the fix report. Any further
   remediation creates another candidate and requires reproduction plus rescan.
5. Preserve the bounded browser/performance artifacts, resolve or explicitly
   track the upstream Privy modal blocker, prove native hidden behavior, and run
   the separate two-hour performance profile.
6. Keep all live Sepolia and external G1-G14 work behind the Preview/consent and
   canonical-evidence boundaries in
   [`docs/remaining-worklist.md`](remaining-worklist.md).

## Explicit blockers

- The protocol-randomness High cannot be closed without a scope decision that
  permits a randomness redesign and replacement deployment.
- G1-G14 remain `0/14 Complete`; final production evidence is absent.
- The existing Sepolia Preview is stale and is not transaction consent.
- Mainnet policy does not allow Sepolia evidence to close G10/G11.
- Deployed Sepolia V10 has a metadata-only exact-bytecode mismatch.
