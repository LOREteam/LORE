# Current State

Last updated: 2026-08-16.

This file contains current repository truth only. Detailed history is archived
in [`docs/archive/`](archive/), including the post-2026-08-09 consolidation in
[`release-hardening-2026-08-10-through-2026-08-14.md`](archive/release-hardening-2026-08-10-through-2026-08-14.md).
The single active queue is [`remaining-worklist.md`](remaining-worklist.md).

## Release candidate snapshot

- Branch: `codex/repo-cleanup`; the `320`-path release candidate is committed
  locally in the eight documented partitions, followed by one hermetic
  clean-checkout test correction. The current `HEAD` is the documentation
  update and the worktree is expected to be clean.
- The historical one-to-one `320`-path partition map is retained in
  [`release-candidate-partition.md`](release-candidate-partition.md).
- Local commits are explicitly authorized; they do not authorize push,
  deployment, signing, wallet actions, network writes, or chain writes.
- Protected DB: `data/lore-v10.sqlite`, SHA-256
  `C6EB88E635C4B3A978AF77CE7B50736D6A6A92CC7A481E166118A66D0EC2B482`,
  `258048` bytes, mtime `2026-08-13T12:18:50.8015294Z`; WAL/SHM absent.

## Local verification

| Boundary | Current evidence | Status |
| --- | --- | --- |
| Dependency policy | Node `24.5.0`, npm `11.5.1`; `nanoid@3.3.18`, `js-yaml@4.3.1`; production `0` High/Critical; no blocking all-deps finding | Pass locally |
| Hermetic local gate | Owned temporary DB, protected DB hash/mtime/WAL/SHM invariant, bounded process cleanup, output lock/root identity | Pass on latest recorded exact-current run |
| Clean-checkout reproduction | Disposable 297-path candidate, fresh `npm ci`, full local gate and required-local prelaunch rows | Pass for that snapshot; final SHA still pending |
| V10 EVM properties | 8 seed epochs, 84 successful runtime transactions, 39 expected reverts, 33 conservation checks | Pass locally |
| Business proof | Latest full summary `85501ms`, `childExitCode=0`, `assertionFailures=0` | Pass |
| P1.10 extraction | Reproducible AST audit (`npm.cmd run audit:p1:behavior`): coordinator `18=11 source-operand + 7 behavioral`; 95 direct modules `5142=734 + 4408`; combined `5160=745 + 4415` (`85.56%` behavioral) | Partial; classifier is explicit, but source-operand assertions remain |
| Performance P1.17 | Collector/verifier self-tests, profiling and transaction-disabled simulations | Partial; no native-hidden and sealed two-hour final-SHA evidence |
| Working-tree security scan | Scan `1324c08f-9411-44ba-83ab-e3efd22218fc`: 287/287 reviews, 0 reportable findings, 2 suppressed candidates; both local defects were then remediated and regression-tested | Strong working-tree evidence; not final-SHA evidence |

The latest local packets added:

- one-time chat-profile legacy migration with cross-wallet isolation, scoped
  corrupt-key cleanup, canonical remote requests, and bounded/redacted errors;
- storage-failure-safe chat-wallet selection plus canonical unread/row ownership;
- a black-box chat route check that rejects non-persistent unauthorized writes
  and accepts a mixed-case sender only through its canonical lower-case session;
- real HeaderWalletCard SSR for login/modal, connected, copy/copied, explorer,
  invalid-address, syncing, and not-created states;
- canonical V10 source reads that reject intermediate symlink/junction escapes;
- an executable deposits recovery global-bound proof that now supplies the
  business summary marker instead of an unexecuted constant;
- an executable dialog focus runtime covering eligibility, initial/fallback
  focus, Tab wrapping, escaped-focus recovery, fresh Escape callbacks, nested
  scroll locks, and safe focus restoration.
- an executable reduced-motion runtime covering stored/system preferences,
  invalid-value cleanup, same-tab preference propagation, media-listener cleanup,
  backdrop decoration gating, and maintenance-overlay animation suppression.

Focused tests, typecheck, targeted ESLint, diff-check, documentation validation,
and the full business summary pass after these packets. The protected DB remains
unchanged and no WAL/SHM was created.

## Objective status

### P0

1. Dependency overrides, lockfile, clean-install evidence, and both audit gates:
   locally complete; hosted CI/final immutable SHA evidence remains external.
2. Hermetic `check-local` and protected DB invariants: locally complete.
3. Exact release candidate: the mapped local commits exist and a clean-checkout
   reproduction exists for an earlier snapshot; final immutable-SHA
   reproduction remains open.
4. Security scan: working-tree scan is clean, but the required supported scan of
   the eventual clean immutable commit remains open.

### P1

- V10 EVM properties, compiler-derived ABI/provenance, wallet state machines,
  indexer/DB recovery, API route matrix, and CI hardening have strong local
  executable evidence. They are not production evidence.
- The reproducible current P1.10 AST audit is `PARTIAL` at `85.56%`
  behavioral: `745` source-operand assertions remain across the coordinator and
  its `95` direct test modules. It classifies operands bound to `readFileSync`;
  it does not convert source-binding checks into behavioral proof. Sixteen
  redundant indexer finality/restart-policy, strict epoch-parser, route-cache,
  and Auto-Miner retry source checks were removed because existing public-function
  boundary cases already kill their unsafe mutants. The 501-line coordinator is
  now 429 lines: release documentation and environment-template checks run from
  a direct module.
- Documentation is now compacted: this file is current truth,
  [`agent-progress.md`](agent-progress.md) is the short handoff, historical detail
  is under [`archive/`](archive/), and
  [`remaining-worklist.md`](remaining-worklist.md) is the only active queue.
- Actual Redis/Valkey Lua `EVAL` semantics are still unproven locally; the
  JavaScript model must not be represented as equivalent production evidence.

### UX and performance

- Runtime-state, sticky mobile controls, Privy/login accessibility, chat/safe-area,
  reduced-motion, dialog, and read-only UI packets have executable local tests.
- P1.17 remains open: native hidden-tab behavior and a sealed clean-final-SHA
  two-hour memory run have not been produced.
- Intentional user-visible refresh behavior remains unchanged unless measured
  evidence supports a change.

## V10 and V9 policy

- Routine `check-local`, Linux/Windows CI, and the prelaunch manifest are V10-only;
  they no longer compile V9, run V9 invariants, or upload V9 provenance.
- Standalone V9 source/manifest commands remain an explicit compatibility
  baseline until V10 deployment and cutover are externally proven. Removing that
  baseline is a separately reviewed post-cutover action.
- Deployed Sepolia V10 remains executable but has a metadata-only exact-bytecode
  mismatch. Do not bypass or silently relabel it.

## External and live blockers

- G1-G14 remain `0/14 Complete`. Canonical status is in
  [`mainnet-status-board.md`](mainnet-status-board.md) and
  [`mainnet-proof-record.md`](mainnet-proof-record.md).
- Current prelaunch passes every required-local row but retains exactly `25`
  external/status blockers. Mainnet environment validation has `41` failures.
- The latest Sepolia Preview was read-only and authorized nothing. It failed
  closed because the actual runtime did not prove
  `NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS=1`; it was stale at the latest
  refresh and supplies no G10/G11 evidence.
- Mainnet policy does not allow Sepolia evidence to close G10/G11 without an
  explicit policy decision.
- Domain/HTTPS, Privy origins, ownership/randomness sign-off, supervised
  processes, real two-replica limiting, fresh indexer DB, real backup/restore,
  monitoring/Resend/Sentry, wallet/mobile QA, and final security sign-off remain
  external requirements.
- The protocol-randomness High cannot be closed without a scope decision that
  permits a randomness redesign and replacement deployment; the current goal
  explicitly forbids changing randomness.

## Next authorized steps

1. Continue bounded P1.10 behavioral extraction and finish P1.17 local evidence.
2. On the resulting immutable SHA, run fresh `npm ci`, complete local gates,
   protected DB invariants, and the supported full Standard security scan.
3. Resolve external G1-G14 prerequisites and validate deployed V10 runtime.
4. Generate a fresh read-only Preview. Request separate exact consent only after
   that Preview; without it, perform no transaction, signing, wallet, or chain
   action.

## Safety boundaries

- Never print secrets, keyed RPC URLs, signing material, wallet files, or private
  environment values.
- No deployment, wallet signing, bet, claim, approval, replacement, canary, or
  soak has been authorized by local green checks.
- Do not claim mainnet, G1-G14, browser, native-hidden, long-soak, or production
  readiness from local tests alone.
