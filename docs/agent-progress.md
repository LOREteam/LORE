# Agent Progress

Last updated: 2026-08-16.

This is the compact continuation handoff. Current repository truth is in
[`current_state.md`](current_state.md), the only active queue is
[`remaining-worklist.md`](remaining-worklist.md), and detailed history is under
[`archive/`](archive/), including
[`release-hardening-2026-08-10-through-2026-08-14.md`](archive/release-hardening-2026-08-10-through-2026-08-14.md).

## Current continuation point

- Commit `1321c7ea` carries the wallet-security packet from the sealed
  `5cce4f92` scan: mining transaction-envelope verification and claim receipt
  quorum/finality. Its first clean-checkout cycle exposed only test-fixture and
  stale source-regex defects; the small follow-up is currently uncommitted and
  has passed focused tests, typecheck, and the full business coordinator. It
  still requires a separate commit approval and a new immutable-SHA cycle;
  neither packet authorizes push, deployment, signing, wallet action, or chain
  write.
- Branch `codex/repo-cleanup`; the `320`-path candidate is committed locally
  across the eight documented partitions, followed by one hermetic
  clean-checkout test correction. The documentation update is the current
  `HEAD`, with a clean worktree expected.
- The exact eight-partition map is retained as historical commit evidence in
  [`release-candidate-partition.md`](release-candidate-partition.md).
- Protected `data/lore-v10.sqlite` remains `258048` bytes with SHA-256
  `C6EB88E635C4B3A978AF77CE7B50736D6A6A92CC7A481E166118A66D0EC2B482`,
  mtime `2026-08-13T12:18:50.8015294Z`, and no WAL/SHM.
- Local wallet hardening continued autonomously: commits `9e136289` and `aa7c1c8b`
  route deep-reward receipt verification through the existing two-origin finality
  helper and hold a fail-closed chain-and-actor Web Lock through every reward,
  deep-reward, and Safety Pool claim flow. `test-wallet-two-context-nonce-lock`,
  the full business suite, and strict TypeScript passed. Push, deploy, signing,
  wallet, network, or chain actions still require their own authorization.

## Latest verified packets

- Chat profile: one-time legacy migration, wallet-scoped storage, corrupt-key
  cleanup, canonical remote requests, and bounded/redacted errors.
- Stable chat wallet identity: storage failures fail closed, candidates are
  canonical and deduplicated, stale keys are removed exactly, and unread/row
  ownership shares the same identity policy.
- Chat message sender canonicalization: the real Next route matrix proves a
  mixed-case sender is accepted only under its canonical session and persists
  as the lower-case address, while rejected writes remain non-persistent.
- Header wallet presentation: real SSR covers login/modal, connected,
  copy/copied, explorer, invalid address, syncing, and not-created states.
- Security-scan closure: V10 source-unit reads now reject intermediate
  symlink/junction escapes, and the business proof executes the deposits
  recovery global-bound control and its mutant before emitting the marker.
- Dialog accessibility: the real hook delegates to an executable focus runtime;
  behavior tests cover hidden/disabled/inert candidates, initial/fallback focus,
  Tab wrapping, escaped focus, fresh Escape handlers, nested scroll locks, and
  safe focus restoration.
- Reduced motion: the real hook delegates to an executable storage/media
  runtime; behavior tests cover explicit and system preferences, invalid-value
  cleanup, same-tab propagation, listener cleanup, PageBackdrop decoration gating, and
  MaintenanceOverlay animation suppression.

Focused packet tests, typecheck, targeted ESLint, and scoped diff-check pass.
The latest full business summary passes in `85501ms` with `childExitCode=0`,
`assertionFailures=0`, and `depositsRecoveryGlobalBound=true`.

## Objective evidence

- P0 dependency and hermetic local gates have strong local evidence. Production
  dependencies have `0` High/Critical findings; known dev-toolchain advisories
  remain non-blocking under the recorded policy.
- Two consecutive exact-tree local checks preserved the protected DB and cleaned
  owned temporary state. A disposable clean checkout with fresh `npm ci` passed
  for an earlier candidate snapshot; the final immutable SHA cycle is open.
- V10 EVM properties pass locally: `8` seed epochs, `84` successful runtime
  transactions, `39` expected reverts, and `33` conservation checks.
- Supported Standard scan `66766128-d908-490a-aa46-ac144a336b1c` sealed against
  immutable `4fdee212` and reported five source findings: V9 stale-epoch rollover,
  block-derived entropy, unlimited approval, deep-reward single-origin receipt
  confirmation, and cross-context claim submissions. The last two are remediated
  in subsequent local commits; therefore a fresh supported scan of final `HEAD`
  is still required. Contract/policy findings remain open.
- The reproducible current P1.10 AST audit is coordinator
  `18=11 source-operand + 7 behavioral`, `95` direct modules
  `5147=736 + 4411`, combined `5165=747 + 4418` (`85.54%` behavioral).
  `npm.cmd run audit:p1:behavior` classifies `assert` operands bound to
  `readFileSync`; P1.10 remains `PARTIAL` because this still leaves `747`
  source-operand assertions. Existing indexer finality/restart, strict
  epoch-parser, route-cache, and Auto-Miner retry public-function cases now
  replace sixteen redundant source checks. Release documentation and environment-template
  checks now run from a direct module, reducing the coordinator from 501 to 429
  lines. The chat route matrix replaces one former source-regex with an actual
  canonical-sender/session/persistence flow.
- P1.17 remains partial: no native hidden-tab evidence and no sealed two-hour
  memory run bound to the eventual final SHA.

## V10 and V9 boundary

- Routine `check-local`, Linux/Windows CI, and prelaunch are V10-only.
- Standalone V9 source, manifest, and compatibility commands remain only as a
  reviewed baseline until canonical V10 deployment and cutover are externally
  proven. Do not remove that baseline or silently relabel the current deployment
  before the cutover evidence exists.
- Sepolia V10 is executable but retains a metadata-only exact-bytecode mismatch.

## External blockers

- G1-G14 remain `0/14 Complete`.
- Prelaunch passes every required-local row but still reports exactly `25`
  external/status blockers and `41` mainnet environment failures.
- The last Preview was read-only, is stale, and proved no transaction consent or
  G10/G11 completion. It also failed closed on missing runtime proof for
  `NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS=1`.
- Domain/HTTPS, Privy origins, ownership/randomness sign-off, supervised
  processes, real two-replica rate limiting, fresh indexer DB, real
  backup/restore, monitoring, wallet/mobile QA, and final security sign-off need
  external evidence.
- The protocol-randomness High needs a scope decision permitting a redesign and
  replacement deployment; the active goal forbids changing randomness.

## Next safe sequence

1. Refresh the exact P1.10 audit and continue bounded behavioral extraction.
2. Complete P1.17 local evidence without changing intentional refresh behavior.
3. On the immutable SHA, run fresh `npm ci`, full local/prelaunch gates,
   protected-DB invariants, and the supported Standard security scan.
4. Resolve external G1-G14 prerequisites and validate canonical V10 cutover.
5. Only then create a fresh read-only Preview and request separate exact consent
   for any bounded live transaction sequence.

Local green checks do not authorize deployment, signing, wallet actions, bets,
claims, approvals, replacement transactions, canaries, soaks, or chain writes.
