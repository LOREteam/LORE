# Autonomous Linea Sepolia Worklist

Last updated: 2026-07-30.

This is the long-running autonomous backlog for taking LORE on Linea Sepolia as
far as possible before mainnet without changing risky product foundations.

## Boundaries

- Do not change randomness, winner selection, tokenomics, distribution
  percentages, deployed contract address, or legacy ABI assumptions.
- Do not re-enable the removed experimental wallet path in ordinary wallet,
  mining, or betting flows.
- Do not read, print, rotate, or rewrite secrets, private RPC URLs, private
  keys, mnemonics, cookies, Privy sessions, database URLs, or webhook URLs.
- Do not send real transactions, sign messages, place bets, claim, flush,
  resolve, or run soak mutations without a fresh exact approval after a fresh
  dry-run Preview.
- Treat green local tests as local evidence only. External gates must stay
  visible until real host, Privy, DB, backup, monitoring, and canary evidence
  exists.

## Autonomous Cadence

- Every logical block: run the narrow relevant test first.
- Every 2-4 hours: run `npm.cmd run proof:autonomous:summary`.
- Every 6-8 hours: run `npm.cmd run check:summary`.
- Daily: run `npm.cmd run proof:autonomous:daily:summary`.
- After two failed fix/verify cycles on the same failure, stop repeating the
  same approach, inspect the root cause again, and record the blocker.

## P0 Local Gates

- Keep `npm.cmd run test:logic` green after API, wallet-state, proof-tooling, or
  doc-command changes.
- Keep `npm.cmd run typecheck:summary` green after TypeScript or React changes.
- Keep `npm.cmd run test:contract:v10` green after any V10 invariant/model
  coverage changes.
- Keep `npm.cmd run test:indexer-storage:summary` green after DB/indexer scope
  changes.
- Keep `npm.cmd run proof:autonomous:summary` green or expected-blocked with
  compact external blockers only.
- Run scoped `git diff --check` after each patch set and fix whitespace issues
  only in touched files.

## V10 Contract Coverage

- Add source guards that every fee-recipient transfer path applies matured
  pending fee-recipient changes before transferring to `feeRecipient`.
- Add/extend invariant coverage for duplicate batch entries in reward, rebate,
  dust, resolver, and fee-exit paths.
- Expand one-year and boundary tests for epoch timing, packed bounds, late
  actions, zero rounding, and max safe accounting values.
- Strengthen rollback models for false-return tokens, revert tokens, callback
  tokens, partial-transfer attempts, and transient reentrancy assumptions.
- Verify event ordering remains compatible with the indexer for bet, resolved,
  reward, rebate, dust, resolver claim, and protocol-fee flush events.
- Keep ABI compatibility checks pinned to the deployed V10 shape; do not make
  Solidity or deployment changes unless separately authorized.

## V10 Deployed Identity

- Run `npm.cmd run proof:contract-deployed:v10:offline:summary` locally.
- Run strict read-only identity verification only when public RPC is configured
  without exposing the URL.
- Keep the known metadata/source-layout mismatch explicit if executable
  bytecode length and manifest identity still match.
- Do not redeploy to "fix" metadata mismatch; redeploy is an external product
  decision.

## Wallet Runtime

- Cover manual bet states: preparing, signing, pending, confirmed, rejected,
  reverted, timeout/ambiguous, insufficient balance, wrong network, reload, and
  duplicate click.
- Cover repeat bet and Auto-Miner with the same transaction-state language and
  explorer-link behavior.
- Test pending nonce recovery for hash-known timeout, confirmed replacement,
  rejected replacement, account switch, wrong network, and stale local state.
- Verify Privy loading/recovery states: clean wallet first action, reconnect,
  reload, account mismatch, wallet unavailable, and unsupported chain.
- Ensure no ordinary wallet/mining path imports or calls removed experimental
  wallet helpers.
- Add source guards for no duplicate sends while a wallet action is signing or
  waiting for receipt.

## Auto-Miner

- Test single-tab start, stop, restart, stale session cleanup, and orphan
  recovery without sending transactions.
- Test two-tab contention with Web Locks available.
- Test fail-closed behavior when Web Locks are unavailable or lock acquisition
  is ambiguous.
- Verify pending nonce detection prevents repeat hash/nonce sends.
- Verify reverted receipt and ambiguous pending receipt are recoverable without
  hidden repeat sends.
- Keep MANUAL, AUTOMINER_A, and AUTOMINER_B actor accounting separate in
  local/session storage and proof output.

## Indexer, API, DB

- Build a fresh V10-scoped DB from deploy block in read-only/dry-run mode when
  configured.
- Verify deploy block, finality window, restart/replay, reorg-window behavior,
  and idempotent upserts.
- Compare normalized DB event storage against contract ABI for all V10 events
  used by frontend/API.
- Add malformed-log and foreign-contract tests for each normalized event table.
- Verify aggregate stats do not mix contract scopes, chain IDs, or stale DB
  files.
- Test pagination boundaries, WAL growth, cache/no-store boundaries, and API
  redaction on failures.
- Keep `proof:indexer:strict:summary` blocked until real DB/finality/manifest
  evidence exists.

## API And Redaction

- Continue replacing broad coercion with strict parsers for all numeric query,
  body, epoch, amount, cursor, limit, and chain parameters.
- Source-guard every JSON-writing route against unbounded `request.json()`.
- Verify no-store and `Vary: Cookie` on session-sensitive admin/chat/wallet
  routes.
- Verify public health/data routes redact origins, endpoints, DB paths,
  secrets, tokens, and provider URLs.
- Add timeout/cancellation tests for high-latency RPC/API helper paths.
- Keep multi-replica rate limiting fail-closed without real Upstash/Redis
  credentials.

## Proof Tooling And Operations

- Keep `proof:prelaunch:summary` compact and fail-closed for missing G1-G14
  evidence.
- Keep `proof:autonomous:summary` showing exact blockers instead of hiding them
  under broad launch rows.
- Verify `proof:restore:strict:summary`, `db:backup:strict:summary`,
  `proof:monitoring:strict:summary`, `proof:host:strict:summary`,
  `proof:qa:strict:summary`, and `proof:indexer:strict:summary` all fail with
  actionable missing-input messages when external evidence is absent.
- Run cleanup dry-runs and ensure only allowlisted generated/cache/report paths
  are candidates.
- Verify process model separation for site, bot, indexer, monitor, backup, and
  cleanup loops.
- Keep backup/restore proof blocked until a real external backup path, schedule,
  retention, fresh DB, restore target, and restored health proof exist.

## UX And Accessibility

- Run browser smoke/baseline after UI changes on desktop and mobile viewports.
- Check mobile layout for wallet panels, manual bet controls, jackpot/reward
  visibility, dialogs, side panels, and bottom safe-area behavior.
- Verify modal focus trap, Escape handling, background inertness, scroll lock,
  and restored focus.
- Verify reduced motion, decorative canvas `aria-hidden`, and meaningful live
  state text for screen readers.
- Improve wallet failure copy where it is still generic: rejected, reverted,
  pending, timeout, wrong network, insufficient balance, and unavailable
  provider.
- Keep number typography stable for jackpot, balances, rewards, rebates, gas,
  and epoch counters.

## Performance

- Run `npm.cmd run baseline:bundle:summary` and record top static files before
  changing lazy-loading or imports.
- Run `npm.cmd run baseline:browser:summary` after frontend changes.
- Inspect unnecessary rerenders in heavy wallet, analytics, admin, charts, and
  mining panels before optimizing.
- Reduce duplicate fetches and polling waste only where measured; do not remove
  intentional live-state refreshes.
- Check long tasks, memory growth, chart freshness, RPC batching, and API
  latency under local load.
- Run `npm.cmd run load:http` only when the local server and DB state are
  intentionally prepared for it.

## Security Scan Follow-Up

- Finish regression for patched scan findings: host auth, Web Locks, keeper
  receipt status/backoff, nonce ownership, deposit recovery limiter, dry-run
  defaults, CI permissions, and SHA pins.
- Verify the dormant client auto-resolve sweep is deleted or fully isolated so
  browser wallets cannot send unattended resolve transactions.
- Run a fresh security diff/full scan after local stabilization.
- Do not treat an old sealed scan as proof that new patches are fixed.
- Keep any GitHub fork/token policy issue as an external blocker if it cannot
  be fixed locally.

## Real Transaction And Bet Tasks

These tasks are not autonomous until there is fresh exact approval after a
fresh dry-run Preview.

- Prepare Preview with `npm.cmd run plan:canary:v10:postdeploy:summary`.
- Include chain ID, V10 contract identity, actors, exact transaction count,
  max stake, max gas, balances/allowances, nonce state, and stop criteria.
- After approval, execute only the approved tranche. Do not repeat prior
  successful transactions.
- Manual bet matrix: success, rejection, pending, confirmed, reverted negative
  case, reload/reconnect, wrong network, duplicate click, and explorer link.
- Auto-Miner matrix: MANUAL, AUTOMINER_A, AUTOMINER_B, unique epochs,
  unique hashes/nonces, tab contention, stop/restart, and recovery.
- Claim matrix: single reward, batch reward, single rebate, batch rebate,
  resolver claim, protocol fee flush if eligible, wallet rejection, revert,
  pending timeout, reload, and duplicate guard.
- After each transaction, verify receipt, token movement, contract accounting,
  frontend state, indexer event, API storage, and proof output.
- Stop immediately on duplicate hash/nonce, unknown transaction state,
  unexpected revert, pending gap, indexer mismatch, health failure, RPC
  exhaustion, insufficient balance/allowance, supervisor exit, or disk alarm.

## Canary And Soak

- Start with dry-run status: `npm.cmd run soak:testnet:dry-run` and
  `npm.cmd run soak:testnet:status:summary`.
- After approval and Preview, run bounded V10 canary matrix before any long
  soak.
- Require at least 50 successful unique Auto-Miner epochs before considering a
  longer soak useful.
- Run a 24-48 hour managed soak only with one durable supervisor and explicit
  stop criteria.
- Preserve JSONL logs, compact summaries, health snapshots, finality status,
  RPC retry/failover evidence, indexer heartbeat, disk checks, and recovery
  notes.
- Keep `proof:testnet:canary:v10:summary` blocked until live V10 matrix evidence
  exists.

## External Blockers To Keep Visible

- Domain and HTTPS host proof.
- Privy production/domain configuration and physical/mobile wallet QA.
- Resend sender/domain verification and delivery proof.
- External rate-limit store for two web replicas.
- Real backup path, schedule, retention, restore drill, and restored health.
- Real V10 indexer DB from deploy block with finality proof.
- Live V10 canary matrix and 24-48 hour soak evidence.
- Monitoring alerts, heartbeat, disk thresholds, and chain-indexer audit.
- Final security scan after stabilization.
- Mainnet signoff, owner acceptance, and any redeploy decision.

## Completion Definition

- Required local checks pass.
- V10 contract/frontend/indexer compatibility is locally proved.
- Wallet flows are tested locally or blocked by explicit external requirements.
- Real transaction matrices and soak are either completed with fresh approval
  and evidence, or clearly blocked.
- Backup, restore, monitoring, indexer, host, and proof paths are ready and
  fail closed.
- No critical local task remains that can be completed without secrets,
  infrastructure, deployment, or transaction authorization.
