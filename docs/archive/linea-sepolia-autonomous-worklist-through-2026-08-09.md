# Linea Sepolia Autonomous Worklist

Last updated: 2026-07-31.

This backlog is for autonomous hardening of the LORE Linea Sepolia pre-mainnet
candidate. It is intentionally conservative: do not change randomness, winner
selection, tokenomics, distribution percentages, deployed contract identity,
legacy ABI, removed delegated-wallet experiment exclusion, secrets, private RPC
URLs, or transaction behavior without a separate fresh decision.

Real transactions, wallet signing, live bets, claims, fee flushes, canaries, and
soaks require a fresh dry-run Preview followed by exact bounded approval.

## Operating Loop

Run this loop while working autonomously:

1. Start each block with current status:
   - `npm.cmd run proof:remaining:summary`
   - `npm.cmd run proof:autonomous:summary`
2. After each narrow fix, run the smallest relevant check first.
3. Every 2-4 hours, run:
   - `npm.cmd run proof:autonomous:summary`
4. Every 6-8 hours, run:
   - `npm.cmd run check:summary`
5. Once per day, run:
   - `npm.cmd run proof:autonomous:daily:summary`
6. Before claiming readiness, run:
   - `npm.cmd run proof:prelaunch:summary`
   - `npm.cmd run proof:remaining:summary`
7. After two failed attempts on the same failure, stop repeating the same fix,
   capture the blocker precisely, and switch to another local task.

## 48+ Hour Autonomous Queue

This queue is the default order for a long unattended run. It is designed to
keep making useful local progress for more than two days without touching live
funds, secrets, deployments, randomness, tokenomics, or removed experimental
wallet flows.

### Day 1: Prove The Current Local Baseline

1. Run the compact state board:
   - `npm.cmd run proof:remaining:summary`
   - `npm.cmd run proof:autonomous:summary`
   - `npm.cmd run proof:prelaunch:summary`
2. Re-run the broad local gate if the machine is stable:
   - `npm.cmd run check:summary`
3. If the broad gate fails, split by row and fix only local root causes:
   - `npm.cmd run lint:summary`
   - `npm.cmd run test:logic:summary`
   - `npm.cmd run test:contract:v10:summary`
   - `npm.cmd run test:indexer-storage:summary`
   - `npm.cmd run test:db-operations:summary`
   - `npm.cmd run typecheck:summary`
   - `npm.cmd run build`
   - `npm.cmd run smoke:browser`
4. Record blockers in this document or `docs/agent-progress.md` only when they
   are durable and still actionable after context handoff.

### Day 1-2: Contract, ABI, And Accounting Hardening

Autonomous work:

- Add more V10 invariant model coverage for edge values that do not alter the
  contract: max packed values, zero amounts, exact deadline boundaries, batch
  duplicates, replayed claims, late claims, fee flush rollback, malicious token
  callbacks, CEI order, transient reentrancy assumptions, and gas-sensitive loop
  exits.
- Keep compact counters visible in `test:contract:v10:summary`,
  `proof:autonomous:summary`, and `proof:prelaunch:summary`.
- Strengthen ABI/indexer compatibility tests for every V10 event the frontend,
  API, or indexer consumes.
- Confirm no local test accepts a legacy event shape as V10 proof unless it is
  explicitly labeled legacy-read compatibility.

Do not do autonomously:

- Do not edit Solidity behavior, distribution math, winner selection, deployed
  address, deployment metadata, or ABI without a separate decision.

### Day 2: Wallet Runtime And Auto-Miner Recovery

Autonomous work:

- Add no-send tests for manual bet states: prepare, simulation failure,
  signing, user rejection, ambiguous pending, confirmed pending, reverted,
  timeout, reload recovery, reconnect, wrong network, explorer link, and
  duplicate-click suppression.
- Add no-send tests for Auto-Miner states: Web Lock acquired, Web Lock denied,
  no Web Locks support, orphan lock recovery, stale session cleanup, actor
  switch, tab contention, pending nonce, nonce gap, reverted receipt, RPC retry,
  stop, restart, and degraded telemetry.
- Ensure persisted recovery is always scoped by chain id, contract address,
  actor, role, run id, tx hash, and nonce where applicable.
- Verify manual bet, repeat bet, Auto-Miner, reward claim, rebate claim,
  resolver claim, Wallet Settings repair, and fee-flush controls cannot overlap
  into duplicate sends.
- Improve user-facing failure messages when tests show raw provider, RPC,
  Privy, DB, or route details could surface.

Blocked without fresh approval:

- Real manual bets, Auto-Miner bets, claims, resolver claims, fee flushes, and
  repair transactions.

### Day 2-3: Indexer, API, DB, And Redaction

Autonomous work:

- Add or tighten tests for deploy-block scoping, finality lag, restart replay,
  duplicate logs, malformed logs, missing transaction hash/log index, partial
  logs, pagination, idempotent upserts, chain scope, contract scope, and
  category scope.
- Prove normalized storage for bets, resolves, reward claims, rebate claims,
  dust settlement, resolver rewards, protocol-fee flushes, and deposits.
- Verify every JSON API route remains no-store, uses scoped responses, rejects
  oversized or malformed bodies, times out safely, and redacts errors.
- Check that admin, chat, rewards, bootstrap resolve, deposits, status, and
  proof endpoints do not leak RPC URLs, DB paths, webhook URLs, bearer tokens,
  wallet keys, private keys, or exact private infrastructure paths.
- Check SQLite WAL growth and cleanup loops under repeated local runs.

External blockers to keep visible:

- Fresh production-like DB path, real finality proof, real deploy-block replay,
  real backup path, real restore drill, and real multi-replica rate-limit store.

### Day 3: UX, Accessibility, And Performance

Autonomous work:

- Run `npm.cmd run smoke:browser` after reading `docs/browser_automation.md`.
- Re-check desktop, tablet, narrow mobile, wallet selector modals, onboarding,
  Auto-Miner panel, Wallet Settings, chat drawer, profile modal, Safety Pool,
  rewards, bet history, jackpot visibility, and empty/degraded states.
- Verify focus trap, Escape behavior, tab order, non-submit buttons, touch
  targets, reduced motion, canvas accessibility, number typography, and
  transaction copy.
- Run bundle/browser baselines before optimizing:
  - `npm.cmd run baseline:bundle:summary`
  - `npm.cmd run baseline:browser:summary`
- Optimize only measured problems: heavy component loading, repeated renders,
  duplicate fetches, wasteful polling, oversized cached multicalls, avoidable
  animation work, and slow local API paths.
- Do not reduce intentional live-state freshness for charts, jackpot, mining,
  pending transaction state, or reward visibility.

### Day 3-4: Operations Proofs And Strict Gates

Autonomous work:

- Make every strict proof command fail closed when evidence is missing,
  placeholder, stale, draft-only, or unredacted.
- Re-check:
  - `npm.cmd run proof:mainnet:strict:compact`
  - `npm.cmd run proof:signoff:strict:summary`
  - `npm.cmd run proof:chain:strict:summary`
  - `npm.cmd run proof:host:summary`
  - `npm.cmd run proof:host:strict:summary`
  - `npm.cmd run proof:indexer:strict:summary`
  - `npm.cmd run db:backup:strict:summary`
  - `npm.cmd run proof:restore:strict:summary`
  - `npm.cmd run proof:monitoring:strict:summary`
  - `npm.cmd run proof:qa:strict:summary`
  - `npm.cmd run proof:testnet:canary:strict:summary`
  - `npm.cmd run proof:launch:strict:summary`
- For every blocker, keep command, proof file, marker tokens, next action, and
  safe owner visible.

### Day 4+: Security Scan And Final Local Stabilization

Autonomous work:

- Finish any active Codex Security scan only through the active scan workflow.
- Fix validated local High and Medium findings that can be corrected without
  changing protected product foundations.
- Re-run focused checks after each fix, then `check:summary` after grouped
  security changes.
- Run a final fresh security scan for the exact launch candidate after the
  local tree is stable.

Blocked without external conditions:

- GitHub/org policy changes, production host/domain settings, production Privy
  domain config, real alert sender, real backup storage, real indexer DB, and
  final mainnet signoff.

### Live Betting And Transaction Track

I can prepare everything for testnet bets autonomously, but I cannot send the
transactions during an unattended run unless there is a fresh Preview followed
by exact bounded approval.

Autonomous preparation:

- Run `npm.cmd run preview:canary:v10:dry-run`.
- Run `npm.cmd run plan:canary:v10:postdeploy:summary`.
- Run read-only nonce, balance, allowance, chain, contract, deploy-block, role,
  and stop-criteria checks.
- Produce a redacted Preview with:
  chain id, contract identity, role labels, planned action list, maximum
  transaction count, maximum stake, gas estimate, expected receipts, indexer
  checks, and stop criteria.

Allowed only after fresh exact approval:

- Manual bet.
- Auto-Miner bet matrix.
- Reward claim.
- Rebate claim.
- Resolver reward claim.
- Protocol-fee flush.
- Bounded V10 canary.
- 50 unique Auto-Miner epoch canary.
- 24-48 hour managed soak.

Approval must name:

- Chain: Linea Sepolia.
- Exact V10 contract address from the fresh Preview.
- Exact roles or wallet labels.
- Allowed action types.
- Maximum transaction count.
- Maximum total stake.
- Maximum gas or stop threshold.
- Whether claims and fee flushes are included.
- Stop criteria.

If this approval is absent, the autonomous run stops at Preview/handoff and
does not sign, create a wallet client, load private signing material, or submit
contract writes.

## Current Open Gates

`proof:remaining:summary` currently reports 0/14 launch gates complete. This is
expected until external evidence is collected. Keep these gates visible instead
of marking drafts or local simulations as production proof.

### G1: Final Contract Env And Funds Safety

Status: missing external proof.

Tasks:

- Re-run strict environment proof without printing secrets:
  `npm.cmd run proof:mainnet:strict:compact`.
- Verify chain id, deploy block, token target, finality setting, and protected
  V10 bet configuration are present and consistent.
- Keep current deployed identity boundary visible:
  `runtimeExecutable=true`, `metadataOnlyMismatch=true`, `runtimeBytecode=false`.
- Do not redeploy or change contract address.

Done when:

- `docs/signoff-proof.json` has real redacted evidence for the final selected
  Sepolia target.
- `npm.cmd run proof:mainnet:strict:compact` passes for the selected target.

### G2: Ownership And Operator Signoff

Status: missing external proof.

Tasks:

- Collect read-only owner evidence and Safe or multisig governance evidence.
- Confirm operator signer boundaries and proof transaction references.
- Confirm no owner-only action is needed before canary or soak.

Done when:

- `npm.cmd run proof:signoff:strict:summary` passes with real evidence.

### G3: Randomness Decision Signoff

Status: missing external decision.

Tasks:

- Preserve the current randomness and winner-selection model.
- Document explicit acceptance of the current randomness model for testnet
  canary and pre-mainnet review.
- Do not improve or replace randomness inside this autonomous track.

Done when:

- `docs/signoff-proof.json` includes the signed randomness decision evidence.
- `npm.cmd run proof:signoff:strict:summary` passes.

### G4: Chain Reconciliation

Status: missing external proof.

Tasks:

- Compare on-chain jackpot, safety pool, deposits, rewards, rebates, and resolve
  state against local/indexer projections.
- Add or improve local read-only reconciliation checks if any gap is found.
- Keep mismatches fail-closed and visible.

Done when:

- `npm.cmd run proof:chain:strict:summary` passes.

### G5: Host Process Model

Status: missing production-like host proof.

Tasks:

- Verify separate process evidence for site, bot, indexer, and supervisor.
- Confirm persistent DB path is external to ephemeral build/runtime storage.
- Make host proof scripts fail closed when process or DB evidence is missing.

Done when:

- `npm.cmd run proof:host:summary` passes with real host evidence.

### G6: Host Health, Load, And Rate Limit Boundary

Status: missing production-like host proof.

Tasks:

- Run production health against the intended origin:
  `npm.cmd run health:prod`.
- Run bounded HTTP load:
  `npm.cmd run load:http`.
- Confirm `no-store`, `Vary: Cookie`, external rate-limit store, base production
  origin, and finality-lag evidence.
- Ensure API errors remain redacted and do not leak RPC, DB, Privy, or webhook
  details.

Done when:

- `npm.cmd run proof:host:strict:summary` passes.

### G7: Fresh Indexer And DB Evidence

Status: missing external DB/indexer proof.

Tasks:

- Start from a fresh scoped V10 DB at the configured deploy block.
- Run indexer once and then restart/replay checks:
  `npm.cmd run indexer:once`.
- Verify finality, deploy block, chain id, contract address, normalized event
  ids, and idempotent upserts.
- Test malformed logs, partial logs, duplicate logs, late logs, and reorg-window
  behavior locally.
- Ensure DB scope prevents cross-contract and cross-chain contamination.

Done when:

- `npm.cmd run proof:indexer:strict:summary` passes.
- Indexer proof includes fresh external DB, deploy block, finality, chain
  snapshot, and redacted logs.

### G8: Backup And Restore

Status: missing real backup/restore proof.

Tasks:

- Validate strict backup configuration:
  `npm.cmd run db:backup:strict:summary`.
- Run restore drill against a safe restored copy:
  `npm.cmd run proof:restore:strict:summary`.
- Verify retention days, last successful backup time, restored health, and
  indexer preservation.
- Keep backup paths redacted.

Done when:

- `docs/restore-proof.json` includes schedule, restore drill, health, and
  indexer preservation evidence.

### G9: Monitoring And Alerts

Status: missing production-like monitoring proof.

Tasks:

- Run runtime monitor summary:
  `npm.cmd run monitor:runtime:summary`.
- Verify alert coverage for health, data sync, stale indexer heartbeat,
  finality/indexer lag, bot restart, indexer restart, reverted tx, disk, and
  canary supervisor failure.
- Confirm Resend or alert sender is configured without printing credentials.
- Add missing fail-closed checks if monitoring proof accepts placeholder data.

Done when:

- `npm.cmd run proof:monitoring:strict:summary` passes.

### G10: V10 Canary Transactions

Status: blocked until fresh Preview plus exact transaction approval.

Autonomous safe tasks:

- Regenerate no-send Preview:
  `npm.cmd run preview:canary:v10:dry-run`.
- Verify planner summary:
  `npm.cmd run plan:canary:v10:postdeploy:summary`.
- Check pending nonce dry-run, balances, allowances, role readiness, max planned
  stake, max transaction count, and stop criteria.
- Save only redacted Preview output.

Live tasks after fresh exact approval only:

- Execute bounded manual V10 bet test.
- Execute bounded Auto-Miner role matrix for `MANUAL`, `AUTOMINER_A`, and
  `AUTOMINER_B`.
- Require unique epochs, hashes, nonces, and role+epoch combinations.
- Stop immediately on duplicate send, unknown pending state, unexpected revert,
  indexer mismatch, nonce loop, RPC exhaustion, or insufficient balance.

Done when:

- `npm.cmd run proof:testnet:canary:strict:summary` passes with live successful
  testnet transactions.

### G11: Recovery And Soak Evidence

Status: blocked until live canary/soak authorization and infrastructure.

Autonomous safe tasks:

- Improve dry-run analyzers for duplicate bet, nonce loop, stuck pending,
  pending recovery, and recovery convergence evidence.
- Verify Auto-Miner two-tab Web Lock behavior without sending transactions.
- Verify no transaction path can auto-resolve or auto-bet from dormant browser
  cleanup code.

Live tasks after fresh exact approval only:

- Run bounded gas matrix first.
- Run at least 50 successful unique Auto-Miner epochs.
- Run managed 24-48 hour soak with one durable supervisor, health, disk,
  finality, RPC failover, and indexer heartbeat logs.

Done when:

- `npm.cmd run proof:testnet:canary:strict:summary` passes for no duplicate bets,
  no nonce loops, no stuck pending, and recovery convergence.

### G12: Privy And Wallet QA

Status: missing production/domain/mobile evidence.

Tasks:

- Verify Privy allowed origins and redacted production app id configuration.
- Test wrong network, clean wallet first transaction, slow auth, reconnect, and
  mobile Web3 browser.
- Confirm wallet settings and recovery copy clearly tell users what to do.
- Do not reintroduce the removed delegated-wallet experiment into standard
  wallet or mining flows.

Done when:

- `npm.cmd run proof:qa:summary` passes with real QA evidence.

### G13: Transaction UX And Diagnostics

Status: missing QA proof.

Tasks:

- Verify disabled reasons, pending states, degraded data states, bet history,
  Auto-Miner logs, diagnostics, explorer links, and failure copy.
- Cover rejected, reverted, pending, success, timeout, reload, reconnect,
  account switch, and wrong network states.
- Confirm duplicate-click guards for manual bet, Auto-Miner start, reward claim,
  rebate claim, resolver claim, and fee flush.

Done when:

- `npm.cmd run proof:qa:strict:summary` passes.

### G14: Final UX, Mobile, And Security Scan

Status: missing final QA and fresh security scan evidence.

Tasks:

- Run browser smoke and targeted UI checks:
  `npm.cmd run smoke:browser`.
- Verify mobile layout, overlays, modals, focus trap, chat geometry, canvas
  accessibility, reduced motion, number typography, jackpot/reward visibility,
  and mainnet wording.
- Run final Codex Security scan for the exact launch candidate.
- Ensure no open High or Medium local findings remain.

Done when:

- `npm.cmd run proof:files:summary` passes.
- Fresh sealed final security scan exists for the exact launch candidate.

## Local Hardening Backlog

These tasks can be done without live transactions.

### Smart Contract V10

- Expand V10 invariant coverage for packed bounds, overflows, one-year
  boundaries, zero rounding, duplicate batch entries, fee/reward/rebate
  conservation, claim windows, rebate dust, protocol-fee flush, false-return
  tokens, revert rollback, malicious callback tokens, transient reentrancy, and
  fee-flush failure.
- Re-run:
  `npm.cmd run test:contract:v10:summary`.
- Re-run compiler/provenance checks:
  `npm.cmd run proof:contract-compile:v10:summary`.
- Re-run advisory checks:
  `npm.cmd run proof:contract-compiler-advisories:v10:summary`.
- Keep ABI compatibility and event compatibility stable for frontend and
  indexer.

### Wallet Runtime

- Add or tighten local tests for manual bet and Auto-Miner states:
  preparing, signing, pending, success, failed, reverted, rejected, timeout,
  reload, reconnect, account switch, wrong network, and explorer link.
- Verify pending nonce recovery cannot resend the same action without explicit
  safe state.
- Verify transaction buttons cannot double-send during render, pending,
  recovery, or tab contention.
- Verify Privy loading and recovery states are visible and do not silently no-op.
- Keep the removed delegated-wallet experiment excluded from ordinary wallet
  and mining flows.

### Auto-Miner

- Test two-tab contention with native Web Locks.
- Test no Web Locks support and require fail-closed behavior.
- Test orphan recovery, stale session cleanup, stop/restart, RPC retry, pending
  nonce, reverted receipt, and hashless timeout.
- Confirm persisted recovery is scoped by chain, contract, actor, role, and run
  id.

### Indexer, API, And DB

- Add focused tests for deploy-block scoping, finality, replay, duplicate logs,
  malformed logs, partial logs, log order, pagination, restart, and idempotent
  upsert behavior.
- Verify normalized storage for reward claims, rebates, dust, resolver rewards,
  fee flushes, deposits, bets, and resolves.
- Verify API cache boundaries: `no-store`, `Vary: Cookie`, scoped responses,
  bounded body parsing, timeout/cancellation, and redacted errors.
- Verify local SQLite WAL growth and cleanup under repeated indexer/API runs.

### Operations Tooling

- Keep `proof:autonomous:summary`, `proof:prelaunch:summary`,
  `proof:remaining:summary`, and `proof:launch:strict:summary` compact and
  machine-readable.
- Ensure every blocker has:
  proof file, status command, marker tokens, next action, and safe failure
  message.
- Ensure draft proofs cannot satisfy strict launch gates.
- Keep cleanup loop allowlist-only and dry-run visible.

### UX And Accessibility

- Verify mobile layout at narrow and desktop widths.
- Verify modals, overlays, focus trap, keyboard escape, and tab order.
- Verify transaction state copy for rejected, reverted, pending, timeout,
  success, degraded/stale, and wrong-network cases.
- Verify number typography for jackpot, rewards, rebates, stake, odds, gas, and
  balances.
- Verify canvas/animation accessibility and reduced-motion behavior.

### Performance

- Capture browser and bundle baselines:
  `npm.cmd run baseline:browser:summary`
  `npm.cmd run baseline:bundle:summary`.
- Inspect heavy components before optimizing.
- Reduce unnecessary rerenders, duplicate fetches, polling waste, and avoidable
  bundle weight only when measured.
- Do not weaken intentional live refreshes for charts, jackpot, mining, or
  transaction state.
- Re-run build, browser smoke, and affected baseline after any optimization.

## Live Bet And Transaction Plan

This section is intentionally blocked by default.

What can be done autonomously before approval:

- `npm.cmd run preview:canary:v10:dry-run`
- `npm.cmd run plan:canary:v10:postdeploy:summary`
- `npm.cmd run proof:testnet:canary:strict:summary`
- Read-only nonce, balance, allowance, chain, contract, and role checks.
- Redacted Preview with exact planned transaction count, max stake, max gas,
  roles, chain id, contract identity, and stop criteria.

What requires fresh exact approval:

- Manual bet.
- Auto-Miner bet.
- Reward claim.
- Rebate claim.
- Resolver claim.
- Protocol-fee flush.
- Bounded V10 matrix.
- 50-epoch Auto-Miner canary.
- 24-48 hour managed soak.

Minimum approval text needed before live actions:

- Chain: Linea Sepolia.
- Contract: exact V10 address from the fresh Preview.
- Roles: exact wallets or role labels allowed.
- Maximum transaction count.
- Maximum total stake.
- Maximum gas budget or stop threshold.
- Allowed actions: manual bet, Auto-Miner, claim, rebate, resolver claim, fee
  flush, canary, or soak.
- Stop criteria accepted.

Live stop criteria:

- Duplicate transaction hash, nonce, role+epoch, or bet.
- Unknown transaction state.
- Unexpected revert.
- Pending state beyond planned timeout.
- Indexer/on-chain mismatch.
- Health check failure.
- Supervisor exit.
- RPC exhaustion or unsafe fallback.
- Insufficient balance or allowance.
- Disk below threshold.
- Any unredacted secret in logs.

## Two-Day Autonomous Execution Order

### Block 1: Fresh Baseline

- Run `proof:remaining:summary`.
- Run `proof:autonomous:summary`.
- Run `proof:autonomous:daily:summary` if not already fresh.
- Run `proof:prelaunch:summary`.
- Record only compact blockers and failed rows.

### Block 2: Local Contract And ABI

- Expand or verify V10 invariants.
- Verify event ABI compatibility with indexer storage tests.
- Run `test:contract:v10:summary`, `test:indexer-storage:summary`, and
  `test:logic:summary`.

### Block 3: Wallet And Auto-Miner Runtime

- Add no-send tests around manual bet, Auto-Miner, pending nonce, duplicate
  send, wrong network, reload, reconnect, rejection, revert, and timeout.
- Run `test:logic:summary`, `typecheck:summary`, and targeted browser smoke if
  UI state changed.

### Block 4: API, DB, And Indexer Isolation

- Add focused tests for API cache/redaction, DB scope, idempotent upserts, and
  malformed event handling.
- Run `test:indexer-storage:summary`, `test:db-operations:summary`,
  `test:logic:summary`, and `proof:indexer:strict:summary`.

### Block 5: UX And Performance

- Run browser smoke and baselines.
- Fix measured layout, accessibility, modal, copy, or performance defects.
- Run `smoke:browser`, `baseline:browser:summary`,
  `baseline:bundle:summary`, `typecheck:summary`, and `build`.

### Block 6: Operations Proofs

- Verify proof drafts, command map, remaining gates, restore strict, backup
  strict, monitoring strict, host strict, and launch strict summaries.
- Add missing proof-tooling guards where a placeholder could accidentally pass.

### Block 7: Final Security Scan

- Run the Codex Security workflow only through the active scan tooling.
- Fix validated local High/Medium findings.
- Re-run local checks and final scan until no open High/Medium local findings
  remain, or document exact external blocker.

### Block 8: Live Preview And Handoff

- Regenerate V10 dry-run Preview.
- Do not transact unless fresh exact approval is present after that Preview.
- If approval is missing, hand off exact Preview, intended transaction matrix,
  stop criteria, and remaining external blockers.

## Completion Rule

This worklist is complete only when:

- Required local checks pass.
- V10 contract/frontend/indexer compatibility is proven.
- Wallet flows are tested or blocked with exact external reasons.
- Managed canary/soak is completed or honestly blocked.
- Backup, restore, monitoring, indexer, and host proof paths are strict.
- Every external blocker is listed by command.
- No critical local task remains that can be completed without changing the
  protected product foundations.
