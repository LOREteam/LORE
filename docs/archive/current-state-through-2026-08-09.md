# Current State

Last updated: 2026-08-04.

Detailed history through this date is archived in
[`docs/archive/current-state-through-2026-07-13.md`](archive/current-state-through-2026-07-13.md).
Open linked evidence only when a task needs it.

## Scope

- Fresh local production HTTP load probe on 2026-08-04 completed 5,993
  read-only GET requests in 15 seconds at concurrency 10, with zero failed
  requests and aggregate p95 latency of 132 ms. The expected local rate limiter
  returned 429 for 4,287 requests and the runner treats those admissions as
  successful bounded behavior; uncached home traffic was the slowest measured
  path at 254 ms p95. It used a zero-address query target and a shell-only
  localhost identity exception, then stopped the temporary server. This is a
  local capacity/rate-limit baseline, not public HTTPS or multi-replica proof.
- Fresh production-browser auto-resolve isolation smoke on 2026-08-04 passed.
  The standard client boot made zero `POST /api/bootstrap-resolve` requests;
  the temporary server used no wallet or keeper signing flow. Together with the
  immutable default-off public config and source guards that reject browser
  wallet/write primitives, this proves that normal browser loading cannot
  start an unattended client resolve. This does not alter the separately
  authenticated server keeper route or authorize an operator transaction.
- Fresh production-browser Auto-Miner lock smoke on 2026-08-04 verified native
  Web Locks across two real Chromium tabs. One tab acquired an exclusive lock,
  the second was rejected while it was held, and the second acquired it after
  release. The test uses an isolated smoke lock name and never opens a wallet
  or mining send path; it complements the existing fail-closed and orphan
  recovery logic tests rather than claiming a real Auto-Miner transaction.
  The same source guard and full business-logic summary passed with zero
  assertion failures.
- Fresh local production browser baseline on 2026-08-04 passed after the
  production API first failed closed without a trusted localhost identity. A
  separate shell-only localhost run then used the documented weak-identity
  measurement exception without changing an env file. The 30-second desktop
  run had `quality=pass`, no local HTTP/request failures, `CLS=0`, stable DOM
  and heap peaks, about 1.42 MB transferred resources, and same-origin API
  p95 values of 26 ms for chat/live-state, 21 ms for recent wins, and 7 ms for
  global stats. Three long tasks peaked at 146 ms; external CSP warnings were
  redacted and recorded. This is local production-build measurement only, not
  public-host proof; no wallet, signing, transaction, or polling change was
  made.
- Fresh full local gate on 2026-08-04 passed without a contract or wallet
  mutation: lint, business logic, security follow-up, timeout and stored-number
  parsing, V9/V10 invariants, indexer storage, DB operations, monitoring,
  production build, typecheck, HTTP smoke, and browser smoke all completed
  successfully. The gate started its own local smoke server and completed it;
  it is evidence for the current worktree only, not deployed-host, physical
  wallet, transaction, canary, or soak evidence.
- Fresh V10 authorization Preview verification on 2026-08-04T19:41:51Z passed
  in read-only mode. The refreshed plan has a seven-call transaction boundary,
  `566008` estimated gas, and 12 planned bet transactions; planner,
  pending-nonce, and bounded-matrix steps completed while
  `transactionSent=false`, `signingMaterialLoaded=false`,
  `walletClientCreated=false`, and `contractWriteSubmitted=false`. Its
  authorization-freshness check passed at age zero, but this records only a
  time-bounded Preview snapshot. No real action is authorized until a fresh,
  exact, bounded transaction consent immediately follows a then-current
  Preview.
- Fresh local browser baseline on 2026-08-04 now records bounded, address-free
  same-origin API response-header latency by route in addition to request
  frequency. A 30-second desktop run passed with no local request/response
  failures or horizontal overflow and preserved live-state polling. Observed
  local p95 latency was 35 ms for `/api/live-state` (six samples), 49 ms for
  `/api/global-stats` (three), 62 ms for `/api/recent-wins` (one), and 67 ms
  for `/api/chat/messages` (two). The run establishes a measurement baseline,
  not a production SLO; dev webpack still showed three long tasks (longest
  626 ms), so any lazy-loading or polling change needs production-build evidence.
  No wallet connect, signing, transaction, or runtime configuration changed.
- Read-only V10 behavior/gas regression on 2026-08-04 stopped fail-closed at
  its configured 90-second simulation limit with
  `reason=behavior-benchmark-timeout`. It used public RPC state overrides and
  a fixed simulation caller only; it created no wallet client, signing
  material, or transaction. This is a public-RPC/simulation capacity blocker
  for live-like behavior evidence, not a failed contract invariant and not a
  reason to relax the bounded timeout or send a transaction.
- Fresh read-only V10 post-deploy canary planning on 2026-08-04 inspected a
  Linea Sepolia snapshot at block `31326476` with two public RPCs. Canonical
  runtime, token, governance, accounting, and all 29 applicable negative
  simulations passed; the scan covered resolved epochs 1-7 completely. The
  current bounded claim/flush phase has seven simulated calls, estimated gas
  `566008`, planned transfers `0.793125` LINEA, and a `0.84` LINEA contract
  balance, with no funded current epoch to resolve. The planner recorded
  `transactionSent=false`, `signingMaterialLoaded=false`,
  `walletClientCreated=false`, `contractWriteSubmitted=false`, and address-free
  output. This is a fresh read-only planning snapshot, not authorization: each
  real call still requires a new dry-run Preview followed immediately by fresh,
  exact bounded consent.
- Fresh aggregate prelaunch verification on 2026-08-04T19:08:46Z passed every
  required local row after reconciling a local status-board validator drift.
  The board, structural gate, and business-logic regression now agree on 24
  external/status blockers rather than disagreeing between 23 and 24. The
  specific local checks `proof:gates:structure` and `test:logic:summary` pass
  again, and the full `proof:prelaunch:summary` exits zero. G1-G14 remain
  `0/14` Complete; all 24 remaining rows are explicit external/status evidence
  gaps, including deployed V10 metadata identity, strict chain RPC, host/indexer/
  restore/monitoring/QA manifests, live canary/soak, and backup. No transaction,
  signing, wallet client, deployment, ABI, randomness, tokenomics, secret, or
  private-RPC action occurred.
- Fresh direct chain/indexer audit preflight on 2026-08-04 correctly remained
  blocked before replay because the configured read-only indexer SQLite window
  is more than 250,000 blocks behind the finalized Linea Sepolia head. The
  audit now gives the actionable, accurate diagnostic: refresh the indexer DB
  to the finalized chain head or reduce the configured epoch window; it does
  not imply that reducing the window alone repairs a stale database. The check
  performed only public RPC reads and opened SQLite read-only. Node 24 also
  emits an experimental SQLite/async-handle assertion after this terminal
  stale-window failure; after two cleanup variants this was treated as runtime
  tooling noise, not hidden or retried. Direct chain/indexer parity remains an
  external fresh-DB/finality blocker and is not claimed as passed.
- Fresh local read-only browser performance baseline on 2026-08-04 passed
  against a temporary UI-only `localhost:3105` server with shell-only
  `NEXT_PUBLIC_LORE_READ_ONLY_MODE=1`. The 30-second desktop observation had
  zero failed local responses/requests, zero horizontal overflow, stable DOM
  node count, `CLS=0`, and 22 same-origin API requests per minute while keeping
  intended live-state/chart refreshes. The measurement now classifies the
  explicit `useRecentWins` cleanup abort for `GET /api/recent-wins` separately
  from failures, matching the existing chat-poll cleanup handling. This is
  local dev-server evidence, not field performance: webpack chunks totalled
  about 13.4 MB transferred and the run observed three long tasks (longest
  531 ms), which establishes a measured optimization candidate without
  changing polling or user-visible freshness. External CSP console errors are
  recorded and redacted. No wallet, signing, transaction, deployment, ABI,
  randomness, tokenomics, secret, or private-RPC action occurred.
- Fresh local operations evidence on 2026-08-04: `test:monitoring:summary`
  passed 11 alert/recovery cases and 22 deliveries with zero duplicate alerts
  after restart; malformed diagnostics/numeric config and unsafe local backup
  paths failed closed. `proof:process-model:summary` checked all declared
  site, bot, indexer, monitor, backup, and chain-audit processes without a
  local model issue. `proof:monitoring:summary` correctly keeps G9 blocked:
  the deployed-external monitoring proof manifest and real alert evidence are
  absent. Local simulation is not substituted for that evidence.
- Fresh read-only deployed V10 identity verification on 2026-08-04 compiled
  the canonical source and queried Linea Sepolia without a wallet client or
  transaction. The compiler provenance passed, and all deployed read checks
  except exact metadata matched: `runtimeExecutable=true`,
  `runtimeBytecode=false`, `metadataOnlyMismatch=true`, and
  `transactionSent=false`. This confirms the known source-layout/metadata
  identity boundary; no redeploy or contract/ABI change is authorized or
  implied. It remains a visible external deployment-evidence blocker.
- Fresh daily local hygiene evidence on 2026-08-04: `proof:deps:all:summary`
  passed with `blockingHighCritical=0` (the nine known dev-toolchain highs are
  explicitly non-blocking), `proof:wallet-deps:summary` found no missing Privy,
  wagmi, or viem dependencies, `baseline:bundle:summary` stayed within every
  static-output budget, and `cleanup:workspace:dry-run:summary` found no delete
  candidates. These are dependency/performance/cleanup checks only; they do
  not prove public runtime, chain, or wallet behavior.
- Fresh local read-only UX smoke on 2026-08-04 passed against a temporary
  UI-only server on `localhost:3105` with the shell-only
  `NEXT_PUBLIC_LORE_READ_ONLY_MODE=1` configuration. It proved the read-only
  banner and disabled Manual Bet/Auto-Miner actions, desktop/tablet/mobile
  layout, keyboard focus, accessible names, reduced motion, wallet-selector
  dialogs without signing, chat profile focus flow, tabs, 44px targets,
  long-value overflow, empty/degraded states, and pool-chart freshness. The
  initial `SMOKE_EXPECT_READ_ONLY=1` run correctly failed because that test
  flag alone does not configure the application; no product code change was
  needed. The UI server was stopped after the run. Localhost weak rate-limit
  identity is expected and is not production/HTTPS/physical-wallet evidence.
- Fresh business-logic summary runner hardening on 2026-08-04: the wrapper now
  invokes the underlying `tsx scripts/test-business-logic.mjs` directly instead
  of an `npm.cmd` shell tree, so its bounded timeout cannot leave a Windows
  child test process running. The compact result now includes `durationMs` and
  `childExitCode`; an intentional one-second timeout emitted
  `timedOut=true`, `durationMs=1021`, `childExitCode=null`, and left no new
  Node process after the check. A normal full run then passed with
  `durationMs=112560`, `childExitCode=0`, `assertionFailures=0`, and all
  wallet/API/claim recovery proof flags true. This is test-runner and local
  proof observability only; no wallet, transaction, chain, or contract action
  occurred.
- Fresh autonomous-summary wallet-runtime observability on 2026-08-04: the
  compact row now carries `durationMs` and nullable `childExitCode` in addition
  to `timedOut`, so a timeout cannot be confused with a completed child test.
  The full logic suite passed after the aggregate formatter change with
  `durationMs=105839`, `childExitCode=0`, `assertionFailures=0`, and all
  local wallet/API/claim proof flags true. The preceding normal aggregate
  refresh at 2026-08-04T18:20:54Z kept all required local rows passing and
  exposed external evidence blockers, including `G1-G14=0/14`; the V10 Preview
  was then 33 minutes old, so it was correctly not authorization-fresh.
- Fresh read-only hardening regression evidence on 2026-08-04: `npm.cmd run
  test:contract:v10:summary` passed 20,002 full-range accounting cases, 77
  packed-boundary cases, rollback/dust/fee-flush coverage, and zero assertion
  failures. `npm.cmd run test:indexer-storage:summary` passed scope isolation,
  idempotent upserts, malformed/partial log fallbacks, same-block ordering, and
  stale event/epoch/financial replay rejection. `npm.cmd run
  test:db-operations:summary` passed backup/restore integrity, retention,
  scope read-only behavior, corrupt-artifact, disk-full, and startup
  fail-closed cases. Follow-up checks also passed:
  `proof:security-followup:summary` (8/8 local remediations),
  `proof:contract-deployed:v10:offline:summary` (manifest/compiler/runtime
  identity only), `proof:ci-security:summary`, and
  `proof:collector-redaction:summary`. All were local and read-only;
  `transactionSent=false` for the V10 identity proof. This does not close the
  deployed metadata/source-layout discrepancy, public-chain verification, or
  G1-G14 evidence.
- Fresh V10 dry-run Preview and aggregate readiness refresh on
  2026-08-04T17:50:44Z passed in read-only mode. `npm.cmd run
  preview:canary:v10:dry-run` refreshed `docs/v10-canary-dry-run-preview.md`
  at 2026-08-04T17:47:34.174Z and wrote dry-run evidence to
  `data/live-test-runs/live-canary-2026-08-04T17-47-32-208Z.jsonl` with
  `transactionSent=false`, `signingMaterialLoaded=false`,
  `walletClientCreated=false`, `contractWriteSubmitted=false`,
  `dryRunProofBlocksG10G11=true`, `transactionLimit=7`,
  `estimatedGas=566008`, and `plannedBetTx=12`. The separate
  `preview:canary:v10:authorization-ready:summary` row passed while fresh
  (`ageMinutes=3-7`, `maxAgeMinutes=15`), but this is only a freshness proof
  for a future separately bounded consent; it does not authorize bets, claims,
  approvals, nonce replacement, resolver actions, or soak. `npm.cmd run
  proof:autonomous:summary` passed at 2026-08-04T17:50:44Z, and `npm.cmd run
  proof:prelaunch:summary` completed with required local checks passed and 23
  external/status blockers still visible. G1-G14 remain `0/14` Complete. No
  wallet signing, transaction, live canary/soak, cleanup apply, deploy, ABI,
  randomness, tokenomics, private RPC/env, or secret path changed.
- Fresh residual security follow-up boundary visibility on
  2026-08-04T17:38:33Z passed after making `proof:security-followup:summary`
  emit explicit booleans for all eight residual security checks:
  `hostAuth=true`, `webLocks=true`, `keeperNonce=true`,
  `keeperBotReceipts=true`, `depositLimiter=true`, `dryRunDefaults=true`,
  `ciSecurity=true`, `autoResolve=true`, plus `appResolveEpochFiles=0`.
  Autonomous and prelaunch summaries now surface the same fields instead of
  only showing `8/8`, so a future regression points at the exact security
  boundary. Verified with syntax checks, `npm.cmd run
  proof:security-followup:summary`, `npm.cmd run test:logic:summary`, `npm.cmd
  run proof:autonomous:summary` at 2026-08-04T17:38:33Z, and `npm.cmd run
  proof:prelaunch:summary` at 2026-08-04T17:36:21Z. No runtime behavior, wallet
  signing, transaction, live canary/soak, cleanup apply, deploy, ABI,
  randomness, tokenomics, private RPC/env, or secret path changed.
- Fresh browser bootstrap-resolve fail-closed precheck hardening on
  2026-08-04T17:28:42Z passed after isolating the client hook behind an
  executable `readEpochHasPool` read-only precheck. If the browser has no
  public client, the epoch read fails, or the pool is zero, the hook now stops
  before calling `/api/bootstrap-resolve`; only a successful read proving a
  funded pool can reach the protected server keeper trigger. The hook still has
  no wallet/write/send primitives, calldata encoding, request body, `resolveEpoch`
  call, or public sweep flag. `scripts/test-business-logic.mjs` covers no
  public client, zero-pool, funded-pool, and RPC-error cases, and
  `scripts/check-security-followup.mjs` now source-guards the fail-closed
  precheck as part of the existing `auto-resolve` residual security check.
  Verified with syntax checks, `npm.cmd run proof:security-followup:summary`
  (`checks=8`, `passed=8`, `appResolveEpochFiles=0`), `npm.cmd run
  test:logic:summary`, `npm.cmd run typecheck:summary`, and `npm.cmd run
  proof:autonomous:summary` at 2026-08-04T17:28:42Z. No wallet signing,
  transaction, live canary/soak, cleanup apply, deploy, ABI, randomness,
  tokenomics, private RPC/env, or secret path changed.
- Fresh scoped epoch/financial stale-replay hardening on
  2026-08-04T17:14:25Z passed after making resolved epoch rows ignore older or
  unresolved replays once a resolved block is stored, and after making
  current-scope bet, jackpot, reward-claim, and protocol-fee upserts ignore
  older block replays for the same `scope/id`. Newer replay metadata still
  updates normally, but stale replays can no longer downgrade resolved epoch
  winner/pool/jackpot metadata or financial amount, tx hash, and block
  metadata. `scripts/test-indexer-event-storage.ts` now proves this and emits
  `staleEpochReplayIgnored=true` plus `staleFinancialReplayIgnored=true`;
  autonomous and prelaunch summaries surface the same evidence. Verified with
  syntax checks, `npm.cmd run test:indexer-storage:summary`, `npm.cmd run
  test:logic:summary`, `npm.cmd run typecheck:summary`, `npm.cmd run
  proof:autonomous:summary` at 2026-08-04T17:14:25Z, and `npm.cmd run
  proof:prelaunch:summary` at 2026-08-04T17:11:59Z. No wallet signing,
  transaction, live canary/soak, cleanup apply, deploy, ABI, randomness,
  tokenomics, private RPC/env, or secret path changed.
- Fresh normalized indexer stale-replay hardening on 2026-08-04T16:42:13Z
  passed after making normalized `scoped_indexer_events` ignore older block
  replays for the same `scope/category/id` instead of letting a stale replay
  downgrade newer payload or block metadata. `scripts/test-indexer-event-storage.ts`
  now proves the stale replay keeps the newer payload readable and emits
  `staleEventReplayIgnored=true`; compact indexer storage summaries surface the
  same flag. Verified with syntax checks, `npm.cmd run
  test:indexer-storage:summary`, `npm.cmd run test:logic:summary`, `npm.cmd run
  typecheck:summary`, and `npm.cmd run proof:autonomous:summary` at
  2026-08-04T16:42:13Z. No wallet signing, transaction, live canary/soak,
  cleanup apply, deploy, ABI, randomness, tokenomics, private RPC/env, or secret
  path changed.
- Fresh Auto-Miner restore checkpoint hardening on 2026-08-04T16:30:28Z
  passed after making `createAutoMineRuntimeController` reject non-canonical
  persisted `lastPlacedEpoch` checkpoint values before saving and clear invalid
  restored checkpoint sessions as `cleared-invalid` instead of throwing during
  reload/reconnect recovery. `scripts/test-business-logic.mjs` now covers
  non-canonical epoch strings, negative epoch values, and malformed restored
  epoch checkpoints in the no-send Auto-Miner recovery model. Verified with
  `node --check app/lib/mining/autoMineRuntimeController.ts`, `node --check
  scripts/test-business-logic.mjs`, `npm.cmd run test:logic:summary`,
  `npm.cmd run typecheck:summary`, and `npm.cmd run
  proof:security-followup:summary`; the aggregate `npm.cmd run
  proof:autonomous:summary` passed at 2026-08-04T16:33:22Z in read-only mode.
  No wallet signing, transaction, live canary/soak, cleanup apply, deploy,
  ABI, randomness, tokenomics, private RPC/env, or secret path changed.
- Fresh autonomous stale-Preview summary cleanup on 2026-08-04T16:21:26Z
  passed after making `proof:autonomous:summary` summarize stale
  authorization-ready Preview failures as freshness blockers only. The
  `V10 authorization-ready preview` row now shows `status=fail`,
  `authFresh=true`, the real `ageMinutes`, `maxAgeMinutes=15`, and
  `v10-dry-run-preview-is-not-fresh-enough-for-authorization` without misleading
  zero transactionLimit/gas/log fields. Verified with
  `npm.cmd run preview:canary:v10:authorization-ready:summary`, `npm.cmd run
  proof:autonomous:summary`, `npm.cmd run proof:gates:structure`, `npm.cmd run
  test:logic:summary`, and scoped `git diff --check`. No wallet signing,
  transaction, live canary/soak, cleanup apply, deploy, ABI, randomness,
  tokenomics, private RPC/env, or secret path changed.
- Fresh stale authorization-ready age visibility verification on
  2026-08-04T16:09:20Z passed after fixing stale Preview failures to report the
  actual Preview age. `npm.cmd run preview:canary:v10:authorization-ready:summary`
  now fails with `authorizationFreshnessRequired=true`, `ageMinutes` populated,
  `maxPreviewAgeMinutes=15`, and
  `v10-dry-run-preview-is-not-fresh-enough-for-authorization` instead of letting
  dashboards show `ageMinutes=0`. `npm.cmd run proof:autonomous:summary` passed
  at 2026-08-04T16:00:24Z and `npm.cmd run proof:prelaunch:summary` passed at
  2026-08-04T16:09:20Z with all required local rows green, 24 external/status
  blockers, and G1-G14 still `0/14` Complete launch gates. No wallet signing,
  transaction, live canary/soak, cleanup apply, deploy, ABI, randomness,
  tokenomics, private RPC/env, or secret path changed.
- Fresh prelaunch/autonomous authorization-ready visibility verification on
  2026-08-04T15:40:55Z passed after adding a dedicated
  `V10 authorization-ready preview` row to the autonomous and prelaunch
  dashboards. `npm.cmd run proof:autonomous:summary` now shows
  `preview:canary:v10:authorization-ready:summary` as an expected blocker with
  `authFresh=true`, `maxAgeMinutes=15`, and no transaction/signing/wallet
  client facts. `npm.cmd run proof:prelaunch:summary` passed all required local
  rows and now reports 24 external/status blockers because the stale
  authorization-ready Preview is counted explicitly before any real transaction
  consent. No wallet signing, transaction, live canary/soak, cleanup apply,
  deploy, ABI, randomness, tokenomics, private RPC/env, or secret path changed.
- Fresh authorization-ready Preview boundary added and verified through
  `npm.cmd run proof:autonomous:summary` on 2026-08-04T15:32:36Z.
  `npm.cmd run preview:canary:v10:dry-run:summary` still passes for local
  dry-run evidence and now reports `authorizationFreshnessRequired=false` with
  `maxPreviewAgeMinutes=1440`. A separate
  `npm.cmd run preview:canary:v10:authorization-ready:summary` command now
  enforces the stricter fresh-consent window before any real bets, claims,
  resolver actions, approvals, nonce replacements, or soak starts; against the
  existing 2026-08-04T10:24:49Z Preview it correctly fails with
  `v10-dry-run-preview-is-not-fresh-enough-for-authorization`. `npm.cmd run
  proof:remaining:summary` now lists that authorization-ready command in the
  pre-transaction Preview checks and keeps G1-G14 at `0/14` Complete. No
  wallet signing, transaction, live canary/soak, cleanup apply, deploy, ABI,
  randomness, tokenomics, private RPC/env, or secret path changed. Fresh
  verification passed with `node --check scripts/check-v10-dry-run-preview.mjs`,
  `node --check scripts/report-launch-remaining.mjs`, `node --check
  scripts/test-business-logic.mjs`, `npm.cmd run proof:launch-map:summary`,
  `npm.cmd run proof:remaining -- --json`, `npm.cmd run test:logic:summary`,
  and `npm.cmd run proof:autonomous:summary`.
- Fresh machine-readable next-gate handoff verification on
  2026-08-04T15:00:34Z passed after adding pre-transaction consent fields to
  `proof:remaining -- --json` `nextGateAction`. The JSON now carries
  `transactionBoundary=fresh-preview-plus-explicit-consent`,
  `transactionPreviewChecks`, and `transactionConsentRequirement` directly on
  the next-gate action object as well as top-level summary fields. Verified
  with `node --check scripts/report-launch-remaining.mjs`, `node --check
  scripts/test-business-logic.mjs`, `npm.cmd run proof:remaining -- --json`,
  `npm.cmd run test:logic:summary` (`assertionFailures=0`), and `npm.cmd run
  proof:autonomous:summary`. This changed machine-readable proof handoff only;
  no wallet signing, transaction, live canary/soak, cleanup apply, deploy,
  ABI, randomness, tokenomics, private RPC/env, or secret path changed.
- Fresh compact consent-boundary verification on 2026-08-04T14:47:33Z passed
  after reordering remaining-gate compact fields so explicit consent is not
  hidden by summary truncation. `npm.cmd run test:logic:summary` passed with
  `businessLogic=true`, `localProof=true`, all wallet/API/claim/auth/
  rate-limit proof booleans true, `assertionFailures=0`, and
  `timedOut=false`. `npm.cmd run proof:autonomous:summary` passed and kept
  `txBoundary=fresh-preview-plus-explicit-consent; consent=present` visible
  before truncated Preview command tokens. `npm.cmd run proof:prelaunch:summary`
  passed every required local row and its remaining-gates row now shows
  `consent=present` before the truncated transaction boundary/Preview fields.
  External/status blockers remained 23 and G1-G14 remained `0/14` Complete.
  This changed compact proof/dashboard ordering and source guards only; no
  wallet signing, transaction, live canary/soak, cleanup apply, deploy, ABI,
  randomness, tokenomics, private RPC/env, or secret path changed.
- Fresh compact dashboard verification on 2026-08-04T14:25:04Z passed after
  the remaining-evidence transaction-boundary parser update. `npm.cmd run
  test:logic:summary` passed with `businessLogic=true`, `localProof=true`,
  wallet/API/claim/auth/rate-limit proofs true, `assertionFailures=0`, and
  `timedOut=false`. `npm.cmd run proof:autonomous:summary` then passed and
  now keeps `txBoundary=fresh-preview-plus-explicit-consent` visible in the
  remaining-gates row. `npm.cmd run proof:prelaunch:summary` passed every
  required local row and also surfaced `txBoundary` in its remaining-gates
  row; it still reported 23 external/status blockers and `Complete gates:
  0/14`. This changed proof/dashboard parsing and source guards only; no
  wallet signing, transaction, live canary/soak, cleanup apply, deploy, ABI,
  randomness, tokenomics, private RPC/env, or secret path changed.
- Fresh autonomous aggregate evidence on 2026-08-04T14:17:34Z completed in
  read-only mode after the remaining-evidence transaction-boundary update.
  `npm.cmd run proof:autonomous:summary` passed all expected local checks:
  remaining gates, security follow-up, proof collector redaction, wallet
  runtime logic, V10 invariants, ABI/indexer storage, testnet soak status,
  pending nonce dry-run, V10 dry-run Preview, and cleanup dry-run. Expected
  external/status rows remained visible and did not count as unexpected
  failures: metadata-only V10 deployed identity mismatch, missing signoff/
  host/QA/indexer/restore manifests, configured RPC requirement, missing live
  canary log, missing monitor config, missing backup source/path, and strict
  G1 env tokens. This was local proof evidence only; no wallet signing,
  transaction, live canary/soak, cleanup apply, deploy, ABI, randomness,
  tokenomics, private RPC/env, or secret path changed.
- Fresh remaining launch evidence on 2026-08-04T14:06:03Z from
  `npm.cmd run proof:remaining:summary` reports `Complete gates: 0/14`, all
  G1-G14 still Missing, remaining groups `canary=2`, `chain=1`, `env=1`,
  `host=2`, `indexer=1`, `monitoring=1`, `qa=3`, `restore=1`, and
  `signoff=2`. The summary shows no inconsistent rows, no complete-gate
  evidence issues, no required-proof issues, no proof-record-reference issues,
  and no first-check issues. The next gate is still `G1 Final contract env
  and funds safety`; autonomous work remains `local-hardening-only`. The
  remaining-evidence summary now prints the transaction boundary
  `fresh-preview-plus-explicit-consent`, the pre-transaction Preview commands,
  and the consent requirement before any real bets, claims, resolver actions,
  approvals, nonce replacements, or soak starts. This changed proof visibility
  only; no wallet signing, transaction, live canary/soak, cleanup apply,
  deploy, ABI, randomness, tokenomics, private RPC/env, or secret path changed.
- Fresh autonomous daily local evidence on 2026-08-04T13:42:58Z passed in
  read-only mode. `npm.cmd run proof:autonomous:daily:summary` reported
  production dependency audit `high=0`, `critical=0`, `blocking=0`; all-deps
  audit `high=9`, `knownDev=9`, `blocking=0`; wallet dependency integrity
  with Privy `3.27.2`, Privy Wagmi `4.0.9`, Wagmi `3.6.16`, Viem `2.50.4`,
  and `missing=none`; CI security `permissionsReadOnly=true`,
  `pullRequestTarget=false`, `usesPinned=true`,
  `checkoutPersistCredentialsFalse=true`, `issues=0`; bundle baseline within
  budget with `files=225`, `totalBytes=8423002`, `jsBytes=7029278`,
  `largestJsBytes=1040081`, `maxSingleJsBytes=1250000`, `cssBytes=216200`,
  `wasmBytes=1056860`, and `issues=0`; cleanup dry-run `matched=0`,
  `wouldDelete=0`, `skipped=4`, `bytes=0`. Direct scoped reruns of
  `proof:deps:summary`, `proof:wallet-deps:summary`,
  `cleanup:workspace:dry-run:summary`, `baseline:bundle:summary`, and
  `test:indexer-storage:summary` also passed in this pass. This is local
  dependency/performance/cleanup/indexer proof evidence only; no wallet
  signing, transaction, live canary/soak, cleanup apply, deploy, ABI,
  randomness, tokenomics, private RPC/env, or secret path changed.
- Fresh `npm.cmd run proof:autonomous:summary` on 2026-08-04T13:46:32Z
  completed in read-only mode with no transactions, no deploys, and no live
  soak start. Required local rows passed: security follow-up `checks=8`,
  `failed=0`; proof collector redaction `leaked=0`; wallet runtime logic
  `localProof=true`, `apiBoundaryProof=true`,
  `walletTxStateMachineProof=true`, `walletClaimStateMachineProof=true`;
  V10 invariants `runtimeBytes=16488`, `selectors=81`, `guarded=20`,
  `accountingCases=20002`, `proportionalCases=20000`,
  `assertionFailures=0`, `protocolFeeFlushCases=7`,
  `protocolFeeFlushEntrypointCases=4`; ABI/indexer storage passed with
  scoped/idempotent deposit, resolver reward, dust settlement, epoch, jackpot,
  reward claim, and protocol fee proof fields; pending nonce dry-run showed
  `pendingGap=0`, `wouldSend=false`, `signing=false`,
  `walletClient=false`, `contractWrite=false`, `txSent=false`; V10 dry-run
  Preview remained fresh with `ageMinutes=201`, `transactionLimit=7`,
  `estimatedGas=566008`, `txSent=false`, `signing=false`,
  `walletClient=false`, `contractWrite=false`, and
  `dryRunBlocksG10G11=true`. External/status launch gates remain
  `complete=0/14`: `canary=2`, `chain=1`, `env=1`, `host=2`, `indexer=1`,
  `monitoring=1`, `qa=3`, `restore=1`, `signoff=2`; the next explicit gate
  remains `G1`. The expected visible blockers are unchanged: V10 deployed
  identity is executable but metadata-only mismatched, strict signoff/host/QA
  manifests are missing, strict chain needs configured RPC evidence, V10
  canary/live launch proof needs a live canary log, runtime monitor config is
  missing base URL/diagnostics secret/alert channel, strict indexer/restore/
  backup need real DB/source/path evidence, and strict mainnet env still has
  41 failing redacted tokens. This is local proof evidence only; no wallet
  signing, transaction, live canary/soak, cleanup apply, deploy, ABI,
  randomness, tokenomics, private RPC/env, or secret path changed.
- Fresh full `npm.cmd run proof:prelaunch:summary` on
  2026-08-04T13:47:53Z passed every required local row. Green required-local
  evidence included V9/V10 compile, V10 compiler advisories and compiler
  matrix, V10 no-RPC diagnostics, V10 offline identity, V9 compatibility
  invariants, V10 invariants, ABI/indexer storage, fetch timeout, stored
  number parsing, TypeScript typecheck, ESLint, production build, bundle
  baseline, SQLite operations, runtime monitoring drill, process-model
  preflight, business logic and removed-wallet guard, security follow-up,
  production and all-dependency audits, wallet dependencies, cleanup dry-run
  and cleanup-loop status, launch docs, proof templates/drafts/files,
  collector redaction, launch command map, host load-target guard, launch gate
  structure, and readiness checklist. The production build row passed with
  `classifiedWarnings=11`, `unclassifiedWarnings=0`; bundle baseline stayed
  within budget with `files=225`, `totalBytes=8424641`, `jsBytes=7030917`,
  `largestJsBytes=1040081`, `maxSingleJsBytes=1250000`, `cssBytes=216200`,
  and `wasmBytes=1056860`; business logic passed with `localProof=true`,
  `apiBoundaryProof=true`, `walletTxStateMachineProof=true`, and
  `walletClaimStateMachineProof=true`. The summary still reports 23
  external/status command blockers with groups `backup=2`, `canary=3`,
  `chain=1`, `contract=1`, `env=2`, `host=2`, `indexer=2`, `launch=1`,
  `monitoring=3`, `qa=2`, `restore=2`, `signoff=2`; slowest checks were
  business logic `106046ms`, V9 invariants `81923ms`, production build
  `69290ms`, V10 compiler matrix `38224ms`, and proof drafts `15871ms`. This
  is local/prelaunch evidence only; no wallet signing, transaction, live
  canary/soak, cleanup apply, deploy, ABI, randomness, tokenomics, private
  RPC/env, or secret path changed.
- Fresh full `npm.cmd run check:summary` completed successfully on
  2026-08-04 after the fresh prelaunch run. The local check passed lint,
  `test:logic`, `proof:security-followup`, fetch-timeout and stored-number
  parsing tests, V9 and V10 contract tests, indexer storage, DB operations,
  runtime monitoring tests, production build, typecheck, HTTP smoke, and
  browser smoke. The local smoke server started on `http://127.0.0.1:3101`
  for the smoke pass and no listener remained on port 3101 after completion.
  This is local build/test/smoke evidence only; no wallet signing,
  transaction, live canary/soak, cleanup apply, deploy, ABI, randomness,
  tokenomics, private RPC/env, or secret path changed.
- Fresh V10 dry-run Preview evidence exists at
  `docs/v10-canary-dry-run-preview.md` from
  `npm.cmd run preview:canary:v10:dry-run` on 2026-08-04T10:24:49Z. The
  command completed with planner, pending-nonce dry-run, and V10 matrix
  dry-run exits at 0, generated dry-run log
  `data/live-test-runs/live-canary-2026-08-04T10-24-47-585Z.jsonl`, and kept
  `transactionSent=false`, `signingMaterialLoaded=false`,
  `walletClientCreated=false`, and `contractWriteSubmitted=false`. The
  read-only planner reported Linea Sepolia `chainId=59141`, complete scanned
  history from epochs 1-7, current epoch 8 not funded, no resolve phase needed,
  and a bounded next claim/flush phase of 7 simulated transactions,
  `estimatedGas=566008`, and `plannedTransfersLinea=0.793125`. The analyzer
  exit remained 1 by design because dry-run proof keeps G10/G11 blocked until
  live canary/soak evidence exists. This is not transaction authorization, not
  canary proof, and not launch evidence; no wallet signing, bets, claims,
  deploys, ABI, randomness, tokenomics, private RPC/env, or secrets changed.
  `npm.cmd run preview:canary:v10:dry-run:summary` now validates the existing
  Preview without rerunning dry-run canary commands, checks bounded markdown
  and JSONL artifact sizes, safe relative log path shape, 24-hour freshness by
  default, no-transaction/no-signing/no-wallet-client/no-contract-write
  fields, and the required G10/G11 dry-run blocker. `proof:autonomous:summary`
  now includes this validator as a compact `V10 dry-run preview` row so stale
  or missing pre-bet Preview evidence is visible before any live transaction
  consent. `proof:prelaunch:summary` also includes the same validator so the
  full prelaunch dashboard exposes Preview freshness and no-transaction
  boundaries alongside pending nonce, soak, canary, and launch blockers.
- V10 invariant summary now automatically proves that every locally declared
  state-changing V10 entrypoint is classified into the expected local mutation
  guard set: 20 guarded local mutation entrypoints are either `nonReentrant` or
  owner-only, while inherited/open public flows remain covered by the existing
  state-changing entrypoint and ABI/indexer compatibility checks. The compact
  V10 summary emits `guardedLocalMutationEntrypoints=20`, and both autonomous
  and prelaunch status summaries surface this as `guarded=20`. The same V10
  status rows now print `accountingCases=20002`,
  `proportionalCases=20000`, and `assertionFailures=0` before the long
  secondary case counters so rounding/proportional coverage remains visible in
  compact dashboards. Verified on 2026-08-04 with
  `npm.cmd run test:contract:v10:summary`,
  `npm.cmd run test:logic:summary`, `npm.cmd run typecheck:summary`,
  `npm.cmd run proof:autonomous:summary`, and
  `npm.cmd run proof:prelaunch:summary`. This changed only local proof
  tooling and source guards; no contract, ABI, randomness, winner selection,
  tokenomics, deployed address, wallet signing, transaction, private RPC/env,
  or secret path changed.
- A fresh full `npm.cmd run proof:prelaunch:summary` on 2026-08-04T12:19Z
  passed all required local rows after the V10 summary and shared API query
  parser changes. The V10 row
  showed `guarded=20`, `accountingCases=20002`, `proportionalCases=20000`,
  and `assertionFailures=0` before the compact row clamp. The final summary
  still reported 23 external/status blockers and the same blocker groups:
  `backup=2`, `canary=3`, `chain=1`, `contract=1`, `env=2`, `host=2`,
  `indexer=2`, `launch=1`, `monitoring=3`, `qa=2`, `restore=2`, `signoff=2`.
  No wallet signing, transaction, live soak, deploy, ABI, randomness,
  tokenomics, private RPC/env, or secret path changed.
- Deep reward single and claim-all recovery now treats unknown
  receipt-verification failures after a claim transaction hash is returned as
  pending/ambiguous. Single-claim UI keeps the reward visible and reports the
  transaction as pending with the explorer link, while claim-all stops sending
  further claim transactions. Definitive reverted receipts still remain
  split/skip evidence for unclaimable batch epochs, but RPC/receipt ambiguity
  after send no longer falls through into generic danger errors, batch
  splitting, or additional claim sends. Verified on 2026-08-04 with `node --check
  scripts/test-business-logic.mjs`, `npm.cmd run test:logic:summary`,
  `npm.cmd run typecheck:summary`, scoped `git diff --check`, and
  `npm.cmd run proof:autonomous:summary`. The autonomous summary stayed
  read-only with `complete=0/14` launch gates and `walletClaimStateMachineProof=true`.
  This is local wallet recovery hardening only; it did not sign wallet
  transactions, send bets/claims, deploy contracts, change ABI, randomness,
  tokenomics, private RPC/env, or secrets.
- Safety Pool ambiguous claim notifications now preserve the existing
  `lastClaimTxHash` explorer link when receipt or post-send claim-state
  verification is pending/unknown. The underlying claim flow already rethrows
  definitive reverted receipts and suppresses split fallback or additional
  sends for ambiguous submissions; the new guard keeps the user-facing
  pending state tied to the exact transaction hash when one exists. Verified
  on 2026-08-04 with `node --check scripts/run-business-logic-summary.mjs`,
  `npm.cmd run test:logic:summary`, `npm.cmd run typecheck:summary`, scoped
  `git diff --check`, and `npm.cmd run proof:autonomous:summary`. The
  autonomous summary stayed read-only with `safetyPoolClaimStateSafe=true` and
  `complete=0/14` launch gates. This is local wallet UX/recovery hardening
  only; it did not sign wallet transactions, send bets/claims, deploy
  contracts, change ABI, randomness, tokenomics, private RPC/env, or secrets.
- Resolver reward ambiguous claim notifications now preserve the submitted
  transaction hash for both connected-wallet and embedded-Privy claim paths.
  If receipt verification becomes pending/ambiguous after a hash exists, the
  same pending resolver claim copy is shown through the shared explorer-link
  formatter instead of a generic hashless warning. Definitive reverted
  receipts and wallet rejection handling are unchanged. Verified on
  2026-08-04 with `node --check scripts/test-business-logic.mjs`,
  `node --check scripts/run-business-logic-summary.mjs`, `npm.cmd run
  test:logic:summary`, `npm.cmd run typecheck:summary`, scoped `git diff
  --check`, and `npm.cmd run proof:autonomous:summary`. The autonomous
  summary stayed read-only with `resolverClaimStateSafe=true` and
  `complete=0/14` launch gates. This is local wallet UX/recovery hardening
  only; it did not sign wallet transactions, send bets/claims, deploy
  contracts, change ABI, randomness, tokenomics, private RPC/env, or secrets.
- Wallet ETH/LINEA transfer handlers now preserve explorer links for
  hash-known ambiguous receipt states across embedded-to-external withdraws
  and external-to-embedded deposits. If a transfer hash exists and receipt
  verification later classifies the state as ambiguous/pending, the UI shows
  the matching pending transfer copy through the shared transaction formatter
  instead of a hashless generic failure. Reverted receipt, rejection, wrong
  network, session, and provider-error classification remain unchanged.
  Verified on 2026-08-04 with `node --check scripts/test-business-logic.mjs`,
  `npm.cmd run test:logic:summary`, `npm.cmd run typecheck:summary`, scoped
  `git diff --check`, and `npm.cmd run proof:autonomous:summary`. The
  autonomous summary stayed read-only with `walletTxStateMachineProof=true`
  and `complete=0/14` launch gates. This is local wallet UX/recovery
  hardening only; it did not sign wallet transactions, send bets/claims,
  deploy contracts, change ABI, randomness, tokenomics, private RPC/env, or
  secrets.
- Pending transaction repair now preserves explorer links for hash-known
  ambiguous replacement receipt states. If a self-send replacement hash exists
  and receipt verification later becomes pending/ambiguous, the UI shows a
  pending repair message through the shared transaction formatter instead of a
  generic hashless repair failure. Duplicate repair suppression, actor binding,
  nonce refresh, reverted receipt handling, and wallet rejection handling are
  unchanged. Verified on 2026-08-04 with `node --check
  scripts/test-business-logic.mjs`, `npm.cmd run test:logic:summary`,
  `npm.cmd run typecheck:summary`, scoped `git diff --check`, and `npm.cmd run
  proof:autonomous:summary`. The autonomous summary stayed read-only with
  `walletTxStateMachineProof=true` and `complete=0/14` launch gates. This is
  local wallet recovery hardening only; it did not sign wallet transactions,
  send bets/claims, deploy contracts, change ABI, randomness, tokenomics,
  private RPC/env, or secrets.
- Auto-Miner tab-lock recovery hygiene now bounds the optional persisted lock
  `tx` marker to a trimmed 1..96 character safe token. Malformed values such
  as URLs, control-character strings, oversized strings, or non-strings are
  dropped while the otherwise valid lock record remains usable for orphan
  recovery and renewal. Verified with `node --check app/hooks/useMining.shared.ts`,
  `node --check scripts/test-business-logic.mjs`, `npm.cmd run
  test:logic:summary`, `npm.cmd run typecheck:summary`, and scoped
  `git diff --check`. This is local Auto-Miner storage/recovery hardening
  only; it did not change Web Locks acquisition, wallet signing, transactions,
  deploys, ABI, randomness, tokenomics, private RPC/env, or secret paths.
- Browser auto-resolve guard storage now bounds canonical epoch strings through
  `BigInt <= Number.MAX_SAFE_INTEGER` before accepting JSON guard records,
  migrating legacy `lore_resolve_epoch` values, or writing a new guard. This
  preserves the fetch-only bootstrap-resolve flow while rejecting impossible
  localStorage epochs that could otherwise keep stale client retry state alive.
  Verified with `node --check app/hooks/autoResolveStorage.ts`, `node --check
  scripts/test-business-logic.mjs`, `npm.cmd run test:logic:summary`,
  `npm.cmd run typecheck:summary`, and `npm.cmd run
  proof:security-followup:summary` on 2026-08-04. This is local browser
  recovery/storage hardening only; it did not introduce browser wallet resolve
  sends, transaction signing, deploys, ABI changes, randomness, tokenomics,
  private RPC/env, or secrets.
- Shared API query parsing now bounds canonical positive decimal strings as
  `BigInt` before narrowing to JavaScript numbers. Cursor, limit, epochs, OG
  jackpot, rewards, and data-bridge callers keep the same accepted range and
  fail-closed behavior, but attacker-controlled decimal query/body strings no
  longer pass through broad `Number(value)` before the safe-integer boundary.
  Verified with `node --check app/api/_lib/queryParams.ts`, `node --check
  scripts/test-business-logic.mjs`, `npm.cmd run test:logic:summary`,
  `npm.cmd run typecheck:summary`, and `npm.cmd run
  proof:autonomous:summary` on 2026-08-04T12:17Z. This is local API boundary
  hardening only; it did not change route limits, cache freshness, wallet
  signing, transactions, deploys, ABI, randomness, tokenomics, private RPC/env,
  or secret paths.
- App-shell hot-tile cache recovery now bounds canonical positive integer
  strings as `BigInt` before narrowing cached `tileId`/`wins` values to
  JavaScript numbers. Stale or malformed localStorage records with impossible
  tile ids, non-canonical decimals, exponent notation, leading whitespace, or
  values above `Number.MAX_SAFE_INTEGER` continue to be rejected before
  rendering restored sidebar/hot-tile UI. Verified with `node --check
  app/hooks/useAppShellState.ts`, `node --check scripts/test-business-logic.mjs`,
  `npm.cmd run test:logic:summary`, `npm.cmd run typecheck:summary`, and
  `npm.cmd run proof:autonomous:summary` on 2026-08-04T12:33Z. This is local
  UX/storage recovery hardening only; it did not change polling cadence,
  wallet signing, transactions, deploys, ABI, randomness, tokenomics, private
  RPC/env, or secret paths.
- Data-sync health/indexer evidence now shares a single
  `MAX_SAFE_INTEGER_BIGINT` boundary for chain `uint256` epoch narrowing,
  bigint block/disk byte saturation, and stored epoch key parsing. Stored
  epoch keys used for coverage and finality-aware health diagnostics are
  parsed as canonical decimal strings with `BigInt` bounds before returning
  display-safe JavaScript numbers, instead of narrowing through
  `Number(value)` first. Verified with `node --check
  app/api/health/data-sync/route.ts`, `node --check
  scripts/test-business-logic.mjs`, `npm.cmd run test:logic:summary`, and
  `npm.cmd run typecheck:summary` on 2026-08-04. This is local
  health/indexer observability hardening only; it did not read private RPC/env,
  start an indexer, sign wallet transactions, send bets/claims, deploy
  contracts, change ABI, randomness, or tokenomics.
- V10 batch-claim rollback coverage now includes the combined replay/rollback
  case where duplicate reward-claim epoch entries are closed before the single
  aggregate transfer, the transfer reverts, and all newly closed entries,
  aggregate claimed liability, per-epoch events, transfer evidence, and
  aggregate events roll back to zero. `npm.cmd run test:contract:v10:summary`
  passed with `batchTransferRollbackCases=5` and `assertionFailures=0`. This
  is local model coverage only; no contract, ABI, randomness, winner
  selection, tokenomics, deployed address, wallet signing, transaction,
  private RPC/env, or secret path changed.
- Workspace cleanup age and schedule env parsing now uses BigInt-scaled
  canonical decimal-hour handling before narrowing to millisecond values.
  `scripts/cleanup-workspace.mjs` and `scripts/cleanup-workspace-loop.mjs`
  keep the same allowlisted generated cache/report targets, aged `.tmp`
  child cleanup, dry-run/apply split, summary redaction, cooperative loop stop,
  typed PID record, and bounded loop status output, but no longer convert
  `CLEANUP_MIN_AGE_HOURS` or `CLEANUP_INTERVAL_HOURS` through broad
  `Number(value)`/`Number.isFinite(parsed)` coercion. `scripts/test-business-logic.mjs`
  source-guards the BigInt-scaled parser and no broad decimal-hour narrowing.
  `npm.cmd run cleanup:workspace:dry-run:summary` returned dry-run `status=ok`
  with `matchedTargets=0`, `skippedTargets=4`, and `bytes=0`; no files were
  deleted. This is local operations proof tooling hardening only; it did not
  start the cleanup loop, apply cleanup, sign wallet transactions, send
  bets/claims, deploy contracts, change ABI, randomness, tokenomics, private
  RPC/env, or secrets.
- Bundle baseline budget env parsing now uses BigInt-bounded canonical positive
  integer handling before narrowing budget overrides to JS numbers.
  `scripts/measure-build-output.mjs` keeps the same static production output
  measurement, largest-file reporting, conservative budget defaults, and
  summary-only no-write mode, but no longer converts `BUNDLE_BASELINE_MAX_*`
  values through broad `Number(raw)` or `Number.isSafeInteger(parsed)` checks.
  `scripts/test-business-logic.mjs` source-guards the BigInt boundary and no
  broad env coercion. `npm.cmd run baseline:bundle:summary` passed on the
  latest `.next` output with 225 files, 8,422,937 total bytes, 7,029,213 JS
  bytes, largest JS 1,040,081 bytes, 216,200 CSS bytes, 1,056,860 WASM bytes,
  and no budget issues; a negative `BUNDLE_BASELINE_MAX_TOTAL_BYTES=001`
  smoke failed at env parsing as expected. This is local performance proof
  tooling hardening only; it did not run a new production build, browser
  automation, wallet signing, transactions, deploys, ABI changes, randomness,
  tokenomics, private RPC/env, or secret handling.
- Direct chain/funds proof tile-id evidence now narrows on-chain `bigint`
  winning-tile values through an explicit display-safe integer helper.
  `scripts/collect-chain-proof.mjs` keeps the existing summary-only no-RPC
  mode, strict configured-RPC requirement, HTTPS/no-credential RPC validation,
  canonical epoch argument parsing, and redacted RPC source reporting, but
  `parseChainTileId()` no longer directly returns `Number(value)` without the
  shared `toSafeDisplayInteger()` bound check. `scripts/test-business-logic.mjs`
  source-guards the helper and rejects a return to direct winning-tile
  coercion or lossy epoch sorting. `npm.cmd run proof:chain:summary` passed in
  summary-only mode with `Would read RPC: false`; `npm.cmd run
  proof:chain:strict:summary` still fails closed as expected because no
  configured RPC env is present and the command must not use built-in fallback
  RPCs for strict G1 evidence. This is local chain proof tooling hardening
  only; it did not read private RPC URLs, perform live chain reads, sign wallet
  transactions, send bets/claims, deploy contracts, change ABI, randomness,
  tokenomics, private env, or secrets.
- Testnet soak supervisor env/PID/status-counter parsing now uses
  BigInt-bounded canonical integer handling before narrowing values for port,
  timeout, disk threshold, tracked supervisor PID, disk-free JSON evidence, and
  compact status counters. `scripts/run-testnet-soak-supervisor.mjs` keeps the
  existing dry-run-by-default live execution gate, ephemeral diagnostics
  secret, atomic status writes, bounded lock/status JSON reads, disk-capacity
  stop criteria, status-only inspection, and no transaction/deploy behavior,
  but no longer narrows soak env integers or lock/status counters through broad
  `Number(raw)`, `Number(count)`, or repeated `BigInt(Number.MAX_SAFE_INTEGER)`
  conversion. `scripts/test-business-logic.mjs` source-guards the BigInt-bound
  env parser, PID parser, disk evidence clamp, and compact status counter
  formatting. This is local canary/soak proof tooling hardening only; it did
  not start a soak supervisor, sign wallet transactions, send bets/claims,
  deploy contracts, change ABI, randomness, tokenomics, private RPC/env, or
  secrets.
- Browser performance baseline timing env parsing now uses BigInt-bounded
  canonical integer handling before returning timeout/sample durations.
  `scripts/measure-browser-baseline.mjs` keeps the existing Playwright
  baseline flow, viewport bounds, warmup, compact summary fields, redaction,
  long-task/runtime/request quality reporting, and no transaction/deploy
  behavior, but no longer converts `BASELINE_OBSERVE_MS` or
  `BASELINE_SAMPLE_MS` through `Number(value)` before checking safe-integer
  and configured range boundaries. `scripts/test-business-logic.mjs`
  source-guards the BigInt-bound timing parser and no broad env coercion
  boundary. This is local performance proof tooling hardening only; it did not
  start browser automation, poll production endpoints, sign wallet
  transactions, deploy contracts, change ABI, randomness, tokenomics, private
  RPC/env, or secrets.
- API chain bigint epoch/count parsing now uses shared BigInt safe-integer
  constants before returning display-safe numbers in deposits, epochs,
  rebates, and live-state paths. `app/api/deposits/route.ts`,
  `app/api/epochs/route.ts`, `app/api/rebates/route.ts`, and
  `app/api/live-state/shared.ts` keep the existing cache, background refresh,
  recovery, tile-id validation, no-store, and rate-limit behavior, but no
  longer repeat inline `BigInt(Number.MAX_SAFE_INTEGER)` checks in the chain
  epoch/count narrowing helpers. `scripts/test-business-logic.mjs`
  source-guards the shared `MAX_SAFE_INTEGER_BIGINT` boundary for deposit
  recovery/current epoch, epochs reconcile, rebate claimable counts/recent
  epochs, and live-state indexed storage lookups. This is local API/runtime
  robustness hardening only; it did not run live chain recovery, indexer
  reconciliation, browser automation, wallet signing, transactions, deploys,
  ABI changes, randomness, tokenomics, private RPC/env, or secret handling.
- V10 gas benchmark report-row gas limit parsing now uses BigInt-bounded
  display-safe narrowing before JSON/report output and regression delta
  comparison. `scripts/benchmark-v10-linea-gas.ts` keeps the existing
  transaction-free `linea_estimateGas` benchmark scenarios, compiler profile
  checks, RPC response bounds, deployment-only preflight, gas regression gate,
  and no deploy/send behavior, but no longer writes RPC gas limits or compares
  gas deltas through direct `Number(BigInt(...))`, `Number(row.gasLimit)`, or
  `Number(row.gasDeltaVsV9)` coercions. `scripts/test-business-logic.mjs`
  source-guards the typed benchmark rows, shared safe-display integer helper,
  deployment and runtime gas-limit use, and no broad gas-limit/delta coercion
  boundary. This is local gas proof reporting hardening only; it did not run
  live gas benchmark RPC calls, start soak/canary, sign wallet transactions,
  deploy contracts, change ABI, randomness, tokenomics, private RPC/env, or
  secrets.
- V10 gas/behavior benchmark timeout and optimizer-run parsing now uses
  BigInt-bounded canonical integer handling before returning display-safe
  numbers. `scripts/benchmark-v10-linea-gas.ts` keeps the existing compiler
  profile checks, bounded local source/config reads, RPC response body bounds,
  benchmark timeout guard, and no transaction/deploy behavior, but no longer
  converts `V10_BEHAVIOR_TIMEOUT_MS` or `--v10-runs` through `Number(raw)`
  before checking the safe-integer and configured range boundaries.
  `scripts/test-business-logic.mjs` source-guards the BigInt-bound benchmark
  env/CLI parser and the RPC content-length parser order after the shared
  constant move. This is local gas/performance proof tooling hardening only;
  it did not run live gas benchmark RPC calls, wallet signing, transactions,
  contract deployment, ABI changes, randomness, tokenomics, private RPC/env,
  or secret handling.
- Indexer reconcile stored-epoch parsing now uses BigInt-bounded canonical
  integer handling before returning display-safe numbers.
  `scripts/indexer.ts` keeps the existing deploy-block/finality/watch/reconcile
  behavior, topic filtering, normalized event storage, safe chain BigInt
  narrowing, and no live transaction boundary, but no longer converts indexed
  epoch storage keys through `Number(value)` before checking the safe-integer
  boundary. `scripts/test-business-logic.mjs` source-guards the shared
  `MAX_SAFE_INTEGER_BIGINT`, canonical stored-epoch parser, and no broad
  stored-key coercion boundary. This is local indexer/DB robustness hardening
  only; strict indexer proof still requires configured RPC, contract address,
  deploy block, finality, and a scoped SQLite DB. No live indexer run, endpoint
  polling, wallet signing, transaction, contract, ABI, randomness, tokenomics,
  deployment, private RPC/env, or secret path changed.
- Chain/indexer reconciliation audit integer parsing now uses BigInt-bounded
  canonical integer handling before returning display-safe numbers.
  `scripts/audit-chain-indexer-window.mjs` preserves the existing read-only
  DB/RPC reconciliation behavior, configured contract/DB-file requirements,
  finality/window limits, chain bigint tile validation, normalized event
  comparison, accounting replay, bounded mismatch reporting, and atomic output
  write, but no longer converts audit window, finality, DB epoch/block, or DB
  tile evidence through broad `Number(value/raw)` before the safe-integer
  boundary. `scripts/test-business-logic.mjs` source-guards the BigInt-bound
  audit and DB integer parsers. This is local indexer audit validation
  hardening only; a real chain/indexer audit still requires configured RPC,
  contract address, and an existing scoped indexer SQLite DB. No audit was run
  against live RPC/DB in this pass, no output artifact was written, and no
  wallet signing, transaction, endpoint polling, contract, ABI, randomness,
  tokenomics, deployment, private RPC/env, or secret path changed.
- Workspace cleanup loop and manager PID parsing now use BigInt-bounded
  canonical integer handling before returning process IDs for liveness checks
  or cooperative stop/status decisions. `scripts/cleanup-workspace-loop.mjs`
  and `scripts/manage-workspace-cleanup-loop.mjs` preserve the existing typed
  PID record, legacy PID reporting, cooperative stop marker, no blind
  `process.kill(pid)` manager behavior, bounded loop status output, and
  allowlisted cleanup script execution, but no longer convert tracked PID file
  values through broad `Number(raw)` before the max-PID boundary.
  `scripts/test-business-logic.mjs` source-guards the BigInt-bound PID parser
  in both loop paths. This is local operations safety hardening only; no loop
  was started or stopped, no process was killed, no cleanup apply was run, and
  no wallet signing, transaction, endpoint polling, contract, ABI, randomness,
  tokenomics, deployment, private RPC/env, or secret path changed.
- Daily autonomous status, autonomous cleanup, and shared summary timeout env
  parsing now use BigInt-bounded canonical integer handling before returning
  display-safe timeout values. `scripts/report-autonomous-daily-status.mjs`,
  `scripts/run-autonomous-cleanup.mjs`, and `scripts/summary-timeout.mjs`
  preserve the existing read-only daily command list, cleanup dry-run-first
  behavior, child output caps, summary wrapper timeout defaults, and no
  transaction/deploy/cleanup-apply-by-default boundaries, but no longer convert
  timeout env values through broad `Number(raw/value)` before the safe-integer
  boundary. `scripts/test-business-logic.mjs` source-guards the BigInt-bound
  timeout parsers. This is local proof/status wrapper hardening only; no
  cleanup apply was run, no dependency was changed, and no wallet signing,
  transaction, endpoint polling, contract, ABI, randomness, tokenomics,
  deployment, private RPC/env, or secret path changed.
- Autonomous and prelaunch status summary numeric parsing now uses
  BigInt-bounded canonical integer handling before returning display-safe
  numbers. `scripts/report-autonomous-status.mjs` and
  `scripts/report-prelaunch-status.mjs` preserve the existing read-only command
  lists, no-transaction/no-deploy/no-soak boundaries, child output caps,
  redacted compact summaries, explicit G1-G14 blocker visibility, and
  required-local failure behavior, but no longer convert timeout env values or
  line-derived gate counters through broad `Number(raw/text)` before the
  safe-integer boundary. `scripts/test-business-logic.mjs` source-guards the
  BigInt-bound timeout and line-counter parsers. This is local proof status
  robustness only; it does not close external G1-G14 evidence gates and does
  not change wallet signing, transactions, endpoint polling, contracts, ABI,
  randomness, tokenomics, deployment, private RPC/env, or secret paths.
- Mainnet/pre-mainnet env proof positive-integer parsing now uses
  BigInt-bounded canonical integer handling before returning display-safe
  numbers. `scripts/collect-mainnet-proof.mjs` preserves the existing strict
  and compact G1/G6 status commands, required env presence checks, protected
  bet flag gate, deploy/finality shape checks, final HTTPS origin rejection,
  DB/backup path isolation checks, redacted gate summaries, no-summary write
  boundary, and fail-closed missing evidence behavior, but no longer converts
  deploy block, finality block, or `WEB_REPLICA_COUNT` evidence through
  `Number(normalized)` before the safe-integer boundary. `scripts/test-business-logic.mjs`
  source-guards the BigInt-bound parser and no-broad-coercion boundary. This
  is local env proof validation hardening only; G1/G6 still require real
  configured network/RPC/contract/env/replica evidence before launch proof can
  pass. No env file was read for secrets or changed, and no wallet signing,
  transaction, endpoint polling, contract, ABI, randomness, tokenomics,
  deployment, private RPC/env, or secret path changed.
- Production dependency audit metadata counter parsing now uses BigInt-bounded
  canonical integer handling before returning display-safe numbers.
  `scripts/check-production-dependency-audit.mjs` preserves the existing
  production/all dependency audit modes, documented dev-toolchain exception
  path, redacted bounded startup/JSON parse failures, high/critical blocking
  policy, malformed-count fail-closed summary status, and compact risk
  counters, but no longer converts npm audit metadata count text through
  `Number(text)` before the safe-integer boundary. `scripts/test-business-logic.mjs`
  source-guards the BigInt-bound audit counter parser and no-broad-coercion
  boundary. This is local dependency proof validation hardening only; actual
  dependency readiness still depends on fresh `npm audit` evidence and any
  external registry/network availability. No dependency was installed,
  upgraded, removed, audited with credentials, wallet signing, transaction,
  endpoint polling, contract, ABI, randomness, tokenomics, deployment, private
  RPC/env, or secret path changed.
- V10 canary proof draft chain-id parsing now uses BigInt-bounded canonical
  integer handling before returning display-safe numbers.
  `scripts/create-canary-proof-draft.mjs` preserves the existing draft-only
  output guard, required side-artifact checks, distinct artifact validation,
  bounded JSONL reads, target metadata matching, required/successful role
  preservation, and strict no-final-proof behavior, but no longer converts
  `--chain-id`/env chain-id evidence through `Number(text)` before the
  safe-integer boundary. `scripts/test-business-logic.mjs` source-guards the
  BigInt-bound draft parser. This is local V10 canary proof tooling hardening
  only; G10/G11 still require a real live canary log, gas matrix, managed
  canary/soak evidence, and strict validation before launch proof can pass. No
  live canary, soak, wallet signing, transaction, endpoint polling, contract,
  ABI, randomness, tokenomics, deployment, private RPC/env, or secret path
  changed.
- SQLite backup retention proof parsing now uses BigInt-bounded canonical
  integer handling before returning display-safe numbers.
  `scripts/backup-sqlite.mjs` preserves the existing read-only summary exit,
  strict external source/output path checks, retention requirement, future
  source mtime rejection, compact redacted JSON failures, and late dynamic
  SQLite import boundary, but no longer converts `LORE_BACKUP_RETENTION_DAYS`
  through `Number(text)` before the safe-integer boundary. `scripts/test-business-logic.mjs`
  source-guards the BigInt-bound retention parser and no-broad-coercion
  boundary. This is local backup proof validation hardening only; backup launch
  proof still requires real external DB and backup paths, a retention schedule,
  restore evidence, and external monitoring before G8/G9 backup-related gates
  can pass. No backup file was written, no directory was created, and no wallet
  signing, transaction, endpoint polling, contract, ABI, randomness, tokenomics,
  deployment, private RPC/env, live canary/soak, or secret path changed.
- QA proof chain-id and viewport evidence parsing now uses BigInt-bounded
  canonical integer handling before returning display-safe numbers.
  `scripts/check-qa-proof.mjs`, `scripts/create-qa-proof-draft.mjs`, and
  `scripts/create-qa-canary-test-plan.mjs` preserve the existing G12-G14
  manifest checks, public HTTPS origin checks, Privy allowed-origin/app-id
  evidence requirements, wallet/failure UX/support/final QA coverage, mobile
  viewport marker cap, bounded artifact reads, secret redaction checks, and
  strict fail-closed behavior, but no longer convert QA chain IDs or viewport
  dimensions through `Number(text)` before the safe-integer boundary.
  `scripts/test-business-logic.mjs` source-guards the BigInt-bound QA
  validator, proof draft, and canary plan parsers. This is local QA proof
  validation hardening only; G12-G14 still require real wallet, mobile, Privy,
  browser smoke, failure UX, and final security-scan evidence before launch
  proof can pass. No browser automation, wallet signing, transaction, endpoint
  polling, contract, ABI, randomness, tokenomics, deployment, private RPC/env,
  live canary/soak, or secret path changed.
- Monitoring proof health cadence parsing now uses BigInt-bounded canonical
  integer handling before returning display-safe numbers.
  `scripts/check-monitoring-proof.mjs` keeps the existing G9 manifest checks,
  monitor kind coverage, fired-alert/recovery evidence requirements, verified
  email alert target proof, bounded artifact reads, future timestamp rejection,
  summary redaction, and strict fail-closed behavior, but no longer converts
  health-prod cadence evidence through `Number(text)` before the safe-integer
  boundary. `scripts/test-business-logic.mjs` source-guards the BigInt-bound
  cadence parser and the no-broad-coercion boundary. This is local monitoring
  proof validation hardening only; G9 still requires a real monitoring
  manifest, public HTTPS origin, diagnostics secret, alert channel, Resend/email
  evidence, and external provider artifacts before launch proof can pass. No
  endpoint polling, alert delivery, wallet signing, transaction, contract, ABI,
  randomness, tokenomics, deployment, private RPC/env, live canary/soak, or
  secret path changed.
- Autonomous proof child-check timeout now has enough headroom for the current
  `test:logic:summary` runtime.
  `scripts/report-autonomous-status.mjs` keeps the existing read-only command
  list, redaction, no-transaction/no-deploy/no-soak boundary, child output cap,
  JSON extraction, and explicit G1-G14 blocker visibility, but its default
  per-check timeout is now 180 seconds instead of 120 seconds. A fresh
  `proof:prelaunch:summary` showed the business-logic guard taking about
  110 seconds, so the old 120-second autonomous timeout could kill the child
  near completion and report `invalid-wallet-runtime-json` even when the direct
  summary passed. This is local proof tooling reliability only; no wallet flow,
  contract, ABI, randomness, tokenomics, deployment, private RPC/env,
  live canary/soak, or secret path changed.
- Autonomous proof status JSON extraction now tolerates bounded npm child
  output around compact JSON summaries.
  `scripts/report-autonomous-status.mjs` preserves the existing read-only
  command list, no-transaction/no-deploy/no-soak boundary, output redaction,
  child output cap, timeout handling, compact wallet/API/V10/indexer/backup/
  monitoring summaries, and explicit G1-G14 blocker visibility, but JSON
  summary rows are now parsed from the first complete JSON object instead of
  requiring the entire child stdout to be JSON. This prevents benign npm banner
  lines from turning a passing `test:logic:summary` into
  `invalid-wallet-runtime-json` inside `proof:autonomous:summary`. Verified
  with syntax checks, `test:logic:summary`, and `proof:autonomous:summary`;
  the proof remains read-only with `complete=0/14`, no transactions, no deploys,
  and no live soak. This is local proof status robustness only; no wallet flow,
  contract, ABI, randomness, tokenomics, deployment, private RPC/env,
  live canary/soak, or secret path changed.
- Signoff proof integer evidence parsing now uses BigInt-bounded canonical
  integer handling before returning display-safe numbers.
  `scripts/check-signoff-proof.mjs`, `scripts/collect-signoff-evidence.mjs`,
  `scripts/create-signoff-proof-draft.mjs`, and shared
  `scripts/collect-proof-common.mjs` preserve the existing contract/env,
  owner, randomness signoff, protected-bet flag, direct chain comparison,
  bounded artifact reads, distinct evidence file checks, and strict
  fail-closed launch proof behavior, but no longer convert signoff proof
  integer evidence through `Number(text)` before the safe-integer boundary.
  `scripts/test-business-logic.mjs` source-guards the BigInt-bound signoff
  validator, collector, draft, and shared positive-integer parser. Verified
  with syntax checks, `proof:signoff:summary`,
  `proof:signoff:strict:summary` (expected fail-closed missing signoff
  manifest), `proof:drafts:summary`, and `test:logic:summary`; no live chain
  read, owner check, randomness decision, wallet signing, RPC execution, live
  canary, soak, or transaction was run in this pass, and G1-G4 remain blocked
  until real signoff evidence exists. This is local signoff proof validation
  hardening only; no randomness model, tokenomics, protected-bet policy,
  contract, ABI, deployment, private RPC/env, live canary/soak, or secret path
  changed.
- Host proof integer evidence parsing now uses BigInt-bounded canonical integer
  handling before returning display-safe numbers.
  `scripts/check-host-proof.mjs`, `scripts/collect-host-evidence.mjs`, and
  `scripts/create-host-proof-draft.mjs` preserve the existing final public
  HTTPS origin checks, production/staging host separation, process evidence,
  external DB path isolation, bounded artifact reads, finality lag checks, load
  counter checks, two-replica external rate-limit evidence, decimal error-rate
  parsing, and strict fail-closed launch proof behavior, but no longer convert
  host proof integer evidence through `Number(text)` before the safe-integer
  boundary. Decimal rate parsing remains decimal-specific. `scripts/test-business-logic.mjs`
  source-guards the BigInt-bound host checker, collector, and draft integer
  parsers. Verified with syntax checks, `proof:host:summary`,
  `proof:host:strict:summary` (expected fail-closed missing host manifest),
  `proof:drafts:summary`, and `test:logic:summary`; no live host, load test,
  DB, wallet signing, RPC execution, live canary, soak, or transaction was run
  in this pass, and G5/G6 remain blocked until real host evidence exists. This
  is local host proof validation hardening only; no host URL, DB path, load
  threshold, replica count, contract, ABI, randomness, tokenomics, deployment,
  private RPC/env, live canary/soak, or secret path changed.
- Indexer proof numeric evidence parsing now uses BigInt-bounded canonical
  integer handling before returning display-safe numbers.
  `scripts/check-indexer-dry-run.mjs`, `scripts/collect-indexer-evidence.mjs`,
  and `scripts/create-indexer-proof-draft.mjs` preserve the existing canonical
  non-negative/positive decimal shape checks, fresh-DB proof requirements,
  start/deploy/finality checks, chain snapshot validation, bounded artifact
  reads, direct chain comparison boundaries, and strict fail-closed launch proof
  behavior, but no longer convert indexer proof integer evidence through
  `Number(text)` before the safe-integer boundary. `scripts/test-business-logic.mjs`
  source-guards the BigInt-bound indexer checker, collector, and draft parsers.
  Verified with syntax checks, `proof:indexer:summary`,
  `proof:indexer:strict:summary` (expected fail-closed missing DB/start/deploy/
  finality/manifest evidence), `proof:drafts:summary`, and
  `test:logic:summary`; no live indexer, DB, RPC, chain snapshot, wallet
  signing, live canary, soak, or transaction was run in this pass, and G7
  remains blocked until real indexer/finality evidence exists. This is local
  indexer proof validation hardening only; no deploy block, finality value,
  indexer DB/path, contract, ABI, randomness, tokenomics, deployment, private
  RPC/env, live canary/soak, or secret path changed.
- Restore proof numeric evidence parsing now uses BigInt-bounded canonical
  integer handling before returning display-safe numbers.
  `scripts/verify-db-restore.mjs`, `scripts/collect-restore-evidence.mjs`, and
  `scripts/create-restore-proof-draft.mjs` preserve the existing canonical
  non-negative decimal shape checks, restore/source/backup path isolation,
  bounded evidence reads, finality lag checks, retention checks, and strict
  fail-closed launch proof behavior, but no longer convert restore proof
  integer evidence through `Number(text)` before the safe-integer boundary.
  `scripts/test-business-logic.mjs` source-guards the BigInt-bound restore
  parsers. Verified with syntax checks, `proof:restore:summary`,
  `proof:restore:strict:summary` (expected fail-closed missing external
  restore evidence), `proof:drafts:summary`, and `test:logic:summary`; no live
  DB, backup path, restore drill, wallet signing, RPC execution, live canary,
  soak, or transaction was run in this pass, and G8 remains blocked until real
  restore evidence exists. This is local restore proof validation hardening
  only; no backup schedule, restore path, indexer DB, contract, ABI,
  randomness, tokenomics, deployment, private RPC/env, live canary/soak, or
  secret path changed.
- Live canary proof numeric evidence parsing now uses BigInt-bounded canonical
  integer handling before returning display-safe numbers.
  `scripts/analyze-live-canary-proof.mjs` preserves the existing canonical
  positive/non-negative decimal shape checks, string-based epoch sorting,
  duplicate nonce/role/epoch detection, malformed evidence rejection, V10 gas
  matrix validation, and compact summary output, but no longer converts proof
  integer evidence through `Number(text)` before the safe-integer boundary.
  `scripts/test-business-logic.mjs` source-guards the BigInt-bound parser and
  the no-broad-coercion proof boundaries. Verified with syntax checks,
  `proof:drafts:summary`, `typecheck:summary`, `test:logic:summary`, and
  `proof:autonomous:summary`; no live canary, soak, wallet signing, RPC
  execution, or transaction was run in this pass, and the autonomous proof is
  still read-only with `complete=0/14` external launch gates remaining. This is
  local canary proof validation hardening only; no canary roles, gas matrix,
  transaction path, contract, ABI, randomness, tokenomics, deployment, private
  RPC/env, live canary/soak, or secret path changed.
- Keeper Telegram alert failure response parsing now validates alert transport
  error `Content-Length` with canonical decimal text plus a BigInt safe-integer
  bound before returning a display-safe number, and decodes bounded response
  bodies with fatal UTF-8. `bot.ts` preserves the existing Telegram endpoint,
  alert payload, cooldown, retry, bounded response byte cap, and sanitized error
  logging behavior, but no longer broad-coerces `content-length` or
  replacement-decodes invalid alert response bytes before terminal output.
  `scripts/test-business-logic.mjs` source-guards the BigInt-bound parser,
  fatal decoder, bounded read cancellation, and no-`res.text()` behavior.
  Verified with syntax checks, `typecheck:summary`,
  `test:monitoring:summary`, `test:logic:summary`, and
  `proof:autonomous:summary`; no Telegram request, keeper transaction, live
  canary, or soak was run in this pass, and the autonomous proof is still
  read-only with `complete=0/14` external launch gates remaining. This is local
  keeper alert error-path hardening only; no alert destination, secrets,
  wallet flow, transaction path, contract, ABI, randomness, tokenomics,
  deployment, private RPC/env, live canary/soak, or secret path changed.
- Production health response parsing now uses fatal UTF-8 decoding after the
  existing BigInt-bound `Content-Length` preflight and byte cap.
  `scripts/check-production-health.mjs` preserves the existing production
  health threshold parsing, route set, response byte cap, no-raw-error
  reporting, and fail-closed self-test behavior, but invalid UTF-8 can no
  longer be replacement-decoded before JSON parsing or compact error reporting.
  `scripts/test-business-logic.mjs` source-guards the fatal decoder beside the
  BigInt-bound parser. Verified with syntax checks,
  `check-production-health --self-test --summary-only`, `typecheck:summary`,
  `test:logic:summary`, and `proof:autonomous:summary`; no production health
  target was fetched in this pass, and the autonomous proof is still read-only
  with `complete=0/14` external launch gates remaining. This is local
  production-health proof-tooling hardening only; no host URL, alert
  destination, backup path, wallet flow, transaction path, contract, ABI,
  randomness, tokenomics, deployment, private RPC/env, live canary/soak, or
  secret path changed.
- Wallet playtest API reads and V10 Linea gas benchmark RPC reads now validate
  response `Content-Length` with canonical decimal text plus a BigInt
  safe-integer bound before returning display-safe numbers. `scripts/playtest-wallet.ts`
  and `scripts/benchmark-v10-linea-gas.ts` preserve their existing response
  byte caps, request timeouts, JSON parsing paths, error redaction, execution
  gates, benchmark behavior, and no-unbounded-response policy, while using
  fatal UTF-8 decoding for bounded response reads. `scripts/test-business-logic.mjs`
  source-guards both BigInt-bound parsers and fatal decoders. Verified with
  `node --check scripts\test-business-logic.mjs`, `typecheck:summary`,
  `test:logic:summary`, and `proof:autonomous:summary`; neither wallet
  playtest execution nor benchmark RPC execution was run in this pass, and the
  autonomous proof is still read-only with `complete=0/14` external launch
  gates remaining. This is local wallet/benchmark proof-tooling hardening only;
  no wallet signing, transaction path, benchmark matrix, contract, ABI,
  randomness, tokenomics, deployment, private RPC/env, live canary/soak, or
  secret path changed.
- Live V10 canary health sampling now validates runtime/data-sync health
  response `Content-Length` with canonical decimal text plus a BigInt
  safe-integer bound before returning a display-safe number.
  `scripts/live-round-canary.ts` preserves the existing health URL gating,
  timeout, retry, sample cadence, byte cap, JSON parsing path, role defaults,
  and transaction/signing behavior, while using fatal UTF-8 decoding for
  bounded health sample reads. `scripts/test-business-logic.mjs` source-guards
  the BigInt-bound parser and fatal decoder. Verified with `typecheck:summary`,
  `test:logic:summary`, and `proof:autonomous:summary`; no live canary or
  browser flow was run in this pass, and the autonomous proof is still
  read-only with `complete=0/14` external launch gates remaining. This is local
  canary proof-tooling hardening only; no roles, bet amount, retry policy,
  wallet flow, transaction path, contract, ABI, randomness, tokenomics,
  deployment, private RPC/env, live canary/soak, or secret path changed.
- Browser smoke bounded response parsing now validates warmup and live-state
  JSON response `Content-Length` with canonical decimal text plus a BigInt
  safe-integer bound before returning display-safe numbers.
  `scripts/smoke-browser-lib/core.mjs` and `scripts/smoke-browser.mjs`
  preserve the existing warmup/live-state probe byte caps, route assertions,
  diagnostic redaction, browser-flow behavior, and no-broad-header-coercion
  policy, while using fatal UTF-8 decoding for bounded response reads.
  `scripts/test-business-logic.mjs` source-guards both BigInt-bound parsers and
  fatal decoders. Verified with syntax checks, `test:logic:summary`,
  `typecheck:summary`, and `proof:autonomous:summary`; no live browser smoke
  was run in this pass, and the autonomous proof is still read-only with
  `complete=0/14` external launch gates remaining. This is local browser smoke
  proof-tooling hardening only; no UI behavior, polling freshness, wallet flow,
  transaction path, contract, ABI, randomness, tokenomics, deployment, private
  RPC/env, live canary/soak, or secret path changed.
- HTTP smoke bounded response parsing now validates response `Content-Length`
  with canonical decimal text plus a BigInt safe-integer bound before returning
  a display-safe number. `scripts/smoke-http.mjs` preserves the existing base
  URL, timeout, retry, warmup, route assertion, response byte cap, and redacted
  failure behavior, while using fatal UTF-8 decoding for bounded smoke response
  reads. `scripts/test-business-logic.mjs` source-guards the BigInt-bound
  parser and fatal decoder. Verified with syntax checks, `test:logic:summary`,
  `typecheck:summary`, and `proof:autonomous:summary`; no live HTTP origin
  smoke was run in this pass, and the autonomous proof is still read-only with
  `complete=0/14` external launch gates remaining. This is local HTTP proof
  tooling hardening only; no polling freshness, wallet flow, transaction path,
  contract, ABI, randomness, tokenomics, deployment, private RPC/env,
  live canary/soak, or secret path changed.
- Runtime monitor bounded health response parsing now validates response
  `Content-Length` with canonical decimal text plus a BigInt safe-integer bound
  before returning a display-safe number. `scripts/monitor-runtime-health.mjs`
  preserves the existing production-like monitor config requirements, origin
  validation, alert-channel checks, response byte cap, no-raw-error redaction,
  and fail-closed summary behavior, while using fatal UTF-8 decoding for
  bounded health JSON reads. `scripts/test-business-logic.mjs` source-guards
  the BigInt-bound parser and fatal decoder. Verified with syntax checks,
  `monitor:runtime:summary` (expected fail-closed missing
  `base-url`, `health-diagnostics-secret`, and `alert-channel`, with
  `wouldPoll=false` and `wouldSendAlerts=false`), `test:logic:summary`,
  `typecheck:summary`, and `proof:autonomous:summary`; the autonomous proof is
  still read-only with `complete=0/14` external launch gates remaining. This is
  local runtime/operations monitor hardening only; no monitor endpoint,
  alert destination, backup path, wallet flow, transaction path, contract, ABI,
  randomness, tokenomics, deployment, private RPC/env, live canary/soak, or
  secret path changed.
- Solidity compiler advisory proof tooling now validates official bug database
  response `Content-Length` with canonical decimal text plus a BigInt
  safe-integer bound before returning a display-safe number. `scripts/check-solidity-compiler-advisories.mjs`
  preserves the pinned compiler version, release-date expectation, official bug
  database URL, retry count, response byte cap, and fail-closed advisory
  policy, while adding fatal UTF-8 decoding and self-test coverage for exact
  safe-max, max+1, malformed, oversized, and invalid-UTF-8 response
  boundaries. Verified with syntax checks, `node
  scripts/check-solidity-compiler-advisories.mjs --self-test --summary-only`,
  `test:logic:summary`, `typecheck:summary`, and
  `proof:autonomous:summary`; the external advisory fetch was not run in this
  pass, and the autonomous proof is still read-only with `complete=0/14`
  external launch gates remaining. This is local security proof-tooling
  hardening only; no compiler version, contract, ABI, randomness, tokenomics,
  deployment, wallet flow, transaction path, private RPC/env, live canary/soak,
  or secret path changed.
- Client bounded JSON response parsing now validates response `Content-Length`
  with canonical decimal text plus a BigInt safe-integer bound before returning
  a display-safe number. `app/lib/readJsonResponse.ts` preserves the existing
  2 MiB helper-wide cap, explicit non-JSON content-type rejection, fatal UTF-8
  decoding, oversized stream cancellation, and raw-body redaction behavior, but
  no longer accepts content lengths through broad `Number(value)` plus
  `Number.isSafeInteger(parsed)`. `scripts/test-business-logic.mjs` covers
  malformed leading-zero/exponent/float/negative content lengths, exact
  `Number.MAX_SAFE_INTEGER` as a pre-read too-large response, and exact max+1
  as invalid. Verified with `node --check scripts/test-business-logic.mjs`,
  `test:logic:summary`, `typecheck:summary`, and
  `proof:autonomous:summary`; direct `node --check app/lib/readJsonResponse.ts`
  is not applicable because Node does not parse TypeScript annotations in this
  client TS file. The autonomous proof is still read-only with `complete=0/14`
  external launch gates remaining. This is local client/API boundary hardening
  only; no polling freshness, wallet flow, transaction path, contract, ABI,
  randomness, tokenomics, deployment, private RPC/env, live canary/soak, or
  secret path changed.
- External rate-limit numeric parsing now uses BigInt-bounded canonical
  integer handling for production replica counts, Redis response counters, and
  response `Content-Length`. `app/api/_lib/externalRateLimit.ts` keeps the
  existing public-HTTPS endpoint policy, request bucket/key bounds, Redis
  command shape, fatal UTF-8 response parsing, and fail-closed external limiter
  behavior, but rejects broad string-to-number coercion before shared-lock or
  response acceptance. `scripts/test-business-logic.mjs` covers leading-zero
  and unsafe replica counts, malformed Redis counters, exact safe-max and
  max+1 content-length boundaries, and pre-read oversized/malformed response
  rejection. Verified with syntax checks, `test:logic:summary`,
  `typecheck:summary`, and `proof:autonomous:summary`; the autonomous proof is
  still read-only with `complete=0/14` external launch gates remaining. This is
  local two-replica/API boundary hardening only; no Redis credentials, endpoint
  values, env files, wallet flow, transaction path, contract, ABI, randomness,
  tokenomics, deployment, private RPC/env, live canary/soak, or secret path
  changed.
- Bounded JSON request body parsing now validates `Content-Length` with
  canonical decimal text plus a `BigInt` safe-integer bound before returning a
  display-safe number. `app/api/_lib/boundedJsonBody.ts` keeps the existing
  256 KiB route cap, explicit `application/json` / `application/*+json`
  content-type requirement, fatal UTF-8 decoding, and oversized stream
  cancellation, but no longer accepts the header through broad `Number(value)`
  plus `Number.isSafeInteger(parsed)`. `scripts/test-business-logic.mjs`
  covers malformed leading-zero/exponent/float/negative content lengths, exact
  `Number.MAX_SAFE_INTEGER` as a pre-read `too-large` response, and exact
  max+1 as invalid. Verified with syntax checks, `test:logic:summary`,
  `typecheck:summary`, and `proof:autonomous:summary`; the autonomous proof is
  still read-only with `complete=0/14` external launch gates remaining. This is
  local API boundary hardening only; no request-size policy, wallet flow,
  transaction path, contract, ABI, randomness, tokenomics, deployment, private
  RPC/env, live canary/soak, or secret path changed.
- Shared API/indexer and script positive-integer env parsing now uses
  BigInt-bounded canonical integer handling before returning display-safe
  numbers. `config/envParsing.ts` keeps BigInt env values as BigInt, but
  narrows optional non-negative number env values with `BigInt(trimmed)` and
  `MAX_SAFE_INTEGER_BIGINT` before returning `Number(parsed)` for API,
  data-sync, indexer, and wallet-playtest thresholds. `scripts/env-parsing.mjs`
  now parses positive integer CLI/proof/smoke/load env values with
  `POSITIVE_SAFE_INTEGER_RE`, `BigInt(trimmed)`, and
  `MAX_SAFE_INTEGER_BIGINT`, while preserving fractional non-negative number
  parsing for `LOAD_MAX_ERROR_RATE`. `scripts/test-business-logic.mjs` covers
  exponent, leading-zero, exact safe max, and exact max+1 boundaries. Verified
  with syntax checks, `test:logic:summary`, `typecheck:summary`,
  `check-production-health --self-test --summary-only`, and syntax checks for
  local/load/smoke wrappers. This is local env/proof/runtime hardening only; no
  env values, host URLs, alert destination, backup path, wallet flow,
  transaction path, contract, ABI, randomness, tokenomics, deployment, private
  RPC/env, live canary/soak, or secret path changed.
- Production health and runtime monitor numeric proof tooling now uses
  BigInt-bounded canonical integer parsing before accepting launch/monitoring
  thresholds or numeric health evidence. `scripts/monitor-runtime-health.mjs`
  parses runtime monitor interval, timeout, memory, disk, canary, chain-audit,
  and backup max-age env values with `DECIMAL_INTEGER_RE`, `BigInt(raw)`,
  `BigInt(min)`, `BigInt(max)`, and `MAX_SAFE_INTEGER_BIGINT` before polling or
  alert delivery can start. `scripts/check-production-health.mjs` parses
  production health threshold env values, configured Linea chain IDs, bounded
  API payload counters, and response `Content-Length` with BigInt bounds before
  health acceptance or response parsing. `scripts/test-business-logic.mjs`
  guards both proof tools, and `check-production-health --self-test
  --summary-only` proves malformed payload counters still fail closed. Verified
  with syntax checks, the production-health self-test, `test:logic:summary`,
  and `test:monitoring:summary`. This is local proof/operations hardening only;
  no host URL, alert destination, backup path, polling target, wallet flow,
  transaction path, contract, ABI, randomness, tokenomics, deployment, private
  RPC/env, live canary/soak, or secret path changed.
- Runtime health and runtime monitor readiness integer parsing now use
  canonical positive decimal text plus `BigInt` safe-integer bounds for
  production-like operations flags. `app/api/health/runtime/route.ts` parses
  `WEB_REPLICA_COUNT` and backup max-age readiness with
  `POSITIVE_SAFE_INTEGER_TEXT_RE`, `BigInt(trimmed)`, and
  `MAX_SAFE_INTEGER_BIGINT` before exposing `multiReplicaWeb` or
  `backupMonitorMaxAgeConfigured`. `scripts/monitor-runtime-health.mjs` uses
  the same BigInt-bound readiness check for
  `RUNTIME_MONITOR_BACKUP_MAX_AGE_MS` before production-like polling or alert
  delivery can start. `scripts/test-business-logic.mjs` source-guards both
  paths against broad `Number(trimmed)` / `Number.isSafeInteger(parsed)`
  parsing. Verified with syntax checks and `test:logic:summary`. This is local
  runtime/operations readiness hardening only; no alert destination, backup
  path, polling target, wallet flow, transaction path, contract, ABI,
  randomness, tokenomics, deployment, private RPC/env, live canary/soak, or
  secret path changed.
- Shared stored positive integer parsing now uses a `BigInt` safe-integer bound
  before returning display-safe numbers for API/storage consumers.
  `app/api/_lib/storedNumberParsing.ts` keeps canonical decimal text regexes
  for stored block and positive integer keys, parses positive keys with
  `BigInt(value)`, rejects values above `Number.MAX_SAFE_INTEGER`, and only then
  returns `Number(parsed)`. `scripts/test-stored-number-parsing.ts` covers the
  exact safe max and exact max+1 boundaries, and
  `scripts/test-business-logic.mjs` source-guards the shared helper against
  returning to broad `Number(value)` / `Number.isSafeInteger(parsed)` parsing.
  Verified with syntax checks, `test:stored-number-parsing:summary`, and
  `test:logic:summary`. This is local API/storage boundary hardening only; no
  storage schema, indexer runtime behavior, wallet flow, transaction path,
  contract, ABI, randomness, tokenomics, deployment, private RPC/env, live
  canary/soak, or secret path changed.
- Admin ops decimal parsing for stored epoch keys and live indexer log counters
  now validates canonical decimal text with `BigInt` bounds instead of
  `Number(value)` plus `Number.isSafeInteger(parsed)`. `app/api/admin/ops/route.ts`
  keeps the existing positive/zero decimal regexes, compares parsed values
  against `MAX_SAFE_INTEGER_BIGINT`, and only then returns a safe number for
  display sorting and compact progress counters. `scripts/test-business-logic.mjs`
  source-guards the BigInt path and rejects broad `Number(value)`,
  `Number.isSafeInteger(parsed)`, and direct regex-match counter coercion from
  returning. Verified with syntax checks, `test:logic:summary`,
  `typecheck:summary`, and `proof:autonomous:summary`. This is local admin
  operations/API boundary hardening only; no log source paths, process control
  policy, indexer runtime behavior, wallet flow, transaction path, contract,
  ABI, randomness, tokenomics, deployment, private RPC/env, live canary/soak,
  or secret path changed.
- Admin ops recent log timestamp sorting now fails closed on malformed or
  non-canonical log timestamps instead of sorting with raw
  `Date.parse(left.ts)` / `Date.parse(right.ts)`. `app/api/admin/ops/route.ts`
  extracts only `YYYY-MM-DDTHH:mm:ssZ` or `YYYY-MM-DDTHH:mm:ss.sssZ`
  timestamps, normalizes missing milliseconds to `.000Z`, verifies
  `new Date(parsed).toISOString() === canonical`, and sorts malformed values as
  absent. `scripts/test-business-logic.mjs` source-guards the canonical parser
  and rejects broad raw timestamp sorting or variable-length fractional
  timestamp extraction. Verified with syntax checks, `test:logic:summary`,
  `typecheck:summary`, and `proof:autonomous:summary`. This is local admin
  operations/API boundary hardening only; no log source paths, process control
  policy, wallet flow, transaction path, contract, ABI, randomness, tokenomics,
  deployment, private RPC/env, live canary/soak, or secret path changed.
- Admin process status PID parsing no longer uses broad `Number(raw)` coercion
  for tracked pid files. `app/api/admin/processes/route.ts` keeps the existing
  canonical positive decimal PID regex and max PID limit, then converts through
  `BigInt(raw)` and compares against `MAX_TRACKED_PID_BIGINT` before returning
  a safe number for `process.kill(pid, 0)`. `scripts/test-business-logic.mjs`
  source-guards the BigInt path and rejects `Number(raw)`,
  `Number.isInteger(pid)`, or `Number.isSafeInteger(pid)` PID parsing from
  returning. Verified with syntax checks, `test:logic:summary`,
  `typecheck:summary`, and `proof:autonomous:summary`. This is local admin
  operations/API boundary hardening only; no process start policy, wallet flow,
  transaction path, contract, ABI, randomness, tokenomics, deployment, private
  RPC/env, live canary/soak, or secret path changed.
- Admin and chat signed-message nonces now fail closed through canonical
  lowercase hex parsing before session issuance. `app/lib/adminAuth.ts` and
  `app/lib/chatAuth.ts` use `parseCanonicalNonce`, matching the lowercase
  32-byte hex nonce generated by `create*AuthNonce()` and rejecting uppercase,
  too-short, and non-hex nonce forms before canonical signed-message
  comparison. `scripts/test-business-logic.mjs` covers the malformed nonce
  cases for both auth surfaces and source-guards against returning to
  case-insensitive nonce regexes or default-empty `values.get("nonce") ?? ""`
  parsing. `scripts/run-business-logic-summary.mjs`,
  `scripts/report-autonomous-status.mjs`, and
  `scripts/report-prelaunch-status.mjs` expose
  `authCanonicalNonceBoundary=true` as part of `authBoundaryProof`. Verified
  with syntax checks, `test:logic:summary`, `typecheck:summary`,
  `proof:autonomous:summary`, and `proof:prelaunch:summary`; required local
  rows passed and 23 external/status blockers remain. This is local auth/API
  boundary hardening only; no wallet signing flow, transaction path, contract,
  ABI, randomness, tokenomics, deployment, private RPC/env, live canary/soak,
  or secret path changed.
- Admin and chat signed-message chain IDs now fail closed through canonical
  positive decimal parsing before session issuance. `app/lib/adminAuth.ts` and
  `app/lib/chatAuth.ts` use `parseCanonicalChainId` for the `Chain ID` field,
  rejecting leading-zero, float, exponent, hex, and unsafe integer forms before
  canonical signed-message comparison. `scripts/test-business-logic.mjs`
  covers those malformed chain IDs for both auth surfaces and source-guards
  against returning to broad `Number(values.get("chain id"))` parsing. Verified
  with syntax checks, `test:logic:summary`, `typecheck:summary`,
  `proof:autonomous:summary`, and `proof:prelaunch:summary`; required local
  rows passed and 23 external/status blockers remain. This is local auth/API
  boundary hardening only; no wallet signing flow, transaction path, contract,
  ABI, randomness, tokenomics, deployment, private RPC/env, live canary/soak,
  or secret path changed.
- Admin and chat auth replay-lock TTL now uses the same canonical `issuedAt`
  parser as signed-message validation. `app/lib/adminAuth.ts` and
  `app/lib/chatAuth.ts` export `get*AuthProofTtlMs` helpers that reject
  non-canonical timestamps, malformed clocks, invalid TTLs, future proofs, and
  expired proofs before returning a replay-lock TTL. `app/api/admin/auth/route.ts`
  and `app/api/chat/auth/route.ts` call those helpers before consuming local
  or external replay locks, and no longer recalculate TTL with route-level
  `Date.parse(fields.issuedAt)`. `scripts/test-business-logic.mjs` covers the
  helper behavior and source-guards both routes. Verified with syntax checks,
  `test:logic:summary`, `typecheck:summary`, `proof:prelaunch:summary`, and an
  isolated rerun of `proof:autonomous:summary`; required local rows passed and
  23 external/status blockers remain. This is local auth boundary hardening
  only; no wallet signing flow, transaction path, contract, ABI, randomness,
  tokenomics, deployment, private RPC/env, live canary/soak, or secret path
  changed.
- Jackpot OpenGraph tile/epoch query parsing now reuses the shared strict API
  integer boundary instead of a route-local regex/`Number(value)` path.
  `app/api/jackpots/og/route.tsx` imports
  `parseBoundedPositiveIntegerParam`, so tile and epoch chips reject
  non-canonical integer query values consistently with the JSON API routes.
  `scripts/test-business-logic.mjs` source-guards the shared parser use and
  prevents local trim-normalized `Number()` coercion from returning. Verified
  with `node --check scripts\test-business-logic.mjs`,
  `test:logic:summary`, `typecheck:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`; required local rows passed and 23 external/status
  blockers remain. This is local API boundary hardening only; no runtime
  wallet flow, transaction path, contract, ABI, randomness, tokenomics,
  deployment, private RPC/env, live canary/soak, or secret path changed.
- Production dependency audit is back to zero blocking high/critical issues
  after a narrow transitive override for `socket.io-parser`. `package.json`
  pins `socket.io-parser` to `4.2.7`, which is within
  `socket.io-client@4.8.3`'s `~4.2.4` dependency range and removes the
  `socket.io-parser@4.2.6` high advisory from the production
  `@privy-io/react-auth -> x402 -> wagmi -> @wagmi/connectors ->
  @metamask/sdk -> socket.io-client` path. `package-lock.json` now resolves
  `node_modules/socket.io-parser` to `4.2.7`, and `npm.cmd ls
  socket.io-parser socket.io-client @metamask/sdk` reports
  `socket.io-parser@4.2.7 overridden`. Verified with
  `proof:deps:summary` (`high=0`, `blocking=0`),
  `proof:deps:all:summary` (`knownDev=9`, `blocking=0`),
  `proof:wallet-deps:summary`, `test:logic:summary`,
  `proof:autonomous:summary`, and `proof:prelaunch:summary`. No wallet
  runtime code, connector selection, transaction path, contract, ABI,
  randomness, tokenomics, deployment, env/RPC, or secret path changed.
- Backup proof status rows now use the stable issue token
  `backup-paths-or-source-output-required` instead of a 64-character truncated
  slug ending in `pass-source-wit`. `scripts/report-autonomous-status.mjs`
  and `scripts/report-prelaunch-status.mjs` map the known fail-closed
  `LORE_DB_PATH`/`LORE_BACKUP_DIR` or `--source`/`--out` requirement to that
  compact token, and `scripts/test-business-logic.mjs` source-guards both
  formatters. Fresh autonomous and prelaunch summaries show the same token for
  `db:backup:summary` / `db:backup:strict:summary`, preserving the external
  backup blocker without hiding it.
- Chain strict proof status rows now use the stable issue token
  `strict-chain-proof-requires-configured-rpc-env` instead of truncating the
  built-in fallback RPC blocker. The underlying `proof:chain:strict:summary`
  remains read-only and still fails closed until configured RPC evidence is
  supplied; this only makes the external G1 blocker readable in autonomous and
  prelaunch tables.
- Shared proof-output redaction now covers whitespace-separated sensitive CLI
  arguments as well as `--flag=value`. `scripts/redact-proof-output.mjs` adds
  `ARG_VALUE_PATTERN` for flags such as `--private-key value`,
  `--rpc-url value`, `--database-url value`, and `--webhook-url value`, while
  refusing to consume the next option token when a value is missing.
  `scripts/check-proof-collector-redaction.mjs` now includes a synthetic
  split-argument fixture, and `scripts/test-business-logic.mjs` source-guards
  the shared redactor plus fixture. Verified with syntax checks,
  `proof:collector-redaction:summary` (`cases=6`, `leaked=0`, `issues=0`),
  `test:logic:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. The autonomous status table now includes
  `proof collector redaction` as its own row before the broad wallet-runtime
  proof row, and the prelaunch table parses the same child result before the
  generic summary fallback, so routine autonomous and prelaunch checks expose
  `status=pass`, `cases=6`, `redacted=5`, `leaked=0`, and `issues=0` as
  strict counters without the raw `Summary:` prose from the child command.
  This is local proof-tooling redaction hardening only; no secrets, private
  env/RPC, wallet signing, transaction path, contract, ABI, randomness,
  tokenomics, or deploy behavior was touched.
- Bundle performance proof now fails closed on the largest individual JS chunk,
  not only aggregate JS bytes. `scripts/measure-build-output.mjs` reads
  `BUNDLE_BASELINE_MAX_SINGLE_JS_BYTES` with the existing canonical positive
  integer budget parser, reports `largestJsBytes` plus `largestJsFile`, and
  exits non-zero when any JS chunk exceeds the configured default budget
  `1250000`. `scripts/report-prelaunch-status.mjs` and
  `scripts/report-autonomous-daily-status.mjs` surface `largestJsBytes`,
  `largestJsFile`, and `maxSingleJsBytes`; `.env.example` /
  `.env.local.example` document the override. Fresh
  `baseline:bundle:summary` passed against the existing `.next` output:
  `fileCount=225`, `totalBytes=8422245`, `jsBytes=7028521`,
  `largestJsBytes=1040081`,
  `largestJsFile=static/chunks/2098-d46557e0e0ad5f5e.js`,
  `maxSingleJsBytes=1250000`, `cssBytes=216200`, `wasmBytes=1056860`, no
  budget issues. Verified with syntax checks, `test:logic:summary`,
  `baseline:bundle:summary`, and `proof:autonomous:daily:summary`. This is
  local proof-tooling/performance visibility only; no runtime UI behavior,
  polling cadence, wallet flow, transaction path, contract, ABI, randomness,
  tokenomics, deployment, RPC/env, or secret path changed.
- Production build proof now classifies known warning output without replaying
  the raw Next build log and fails closed when any warning is not covered by a
  known warning kind. `scripts/run-build-summary.mjs` reports `warningKinds`,
  `warningKindCounts`, `classifiedWarnings`, and `unclassifiedWarnings`, and
  returns `issue=build-unclassified-warnings` if `unclassifiedWarnings > 0`;
  the current build has `warnings=11`,
  `warningKindCounts=sqlite-experimental:11`, `classifiedWarnings=11`, and
  `unclassifiedWarnings=0`, plus the separate
  `noticeKinds=edge-runtime-static-generation-disabled` notice. The prelaunch
  production-build row surfaces these safe tokens. Verified with
  `build:summary`, `test:logic:summary`, and `proof:prelaunch:summary`. This is
  proof visibility/gating only; no runtime UI behavior, wallet signing,
  transactions, deploys, ABI, randomness, tokenomics, private RPC/env, live
  canary/soak, or cleanup apply changed.
- Canary proof validation now fails closed on duplicate successful role/epoch
  evidence and duplicate successful nonce evidence, in addition to duplicate
  successful tx hashes and duplicate role/epoch/tile bets.
  `scripts/analyze-live-canary-proof.mjs` derives role/epoch keys from
  canonical `role`, `chainId`, `contractAddress`, and `epoch` fields while
  preserving the explicit `repeat=true` same-signature fee-measurement
  exception; it derives nonce keys from canonical `role`, `chainId`,
  `contractAddress`, `nonceLatest`, and `noncePending` fields on successful
  bet events. The strict analyzer also fails when any live
  `mode=preflight` readiness event reports `ok=false`, keeping
  balance/allowance/nonce preflight failures from being buried under later
  synthetic success evidence. Synthetic draft fixtures in
  `scripts/check-proof-drafts.mjs` prove the strict analyzer rejects
  `duplicate successful nonce keys 1`,
  `duplicate successful role/epoch keys 1`, and `failed preflight checks 1`.
  `scripts/test-business-logic.mjs` source-guards both analyzer paths.
  Verified with syntax checks, `proof:drafts:summary` (`total=258`,
  `rejected=245`), `test:logic:summary`, and the expected blocked
  `proof:testnet:canary:v10:summary` missing-log result. This is local
  canary-proof validation only; no live canary, wallet signing, transactions,
  deploys, ABI, randomness, tokenomics, private RPC/env, or cleanup apply
  changed.
- ABI/indexer storage local proof now explicitly covers plain
  `RewardClaimed` storage scope and replay behavior, not only batch
  claim/dust/protocol fee paths. `scripts/test-indexer-event-storage.ts`
  writes a current-scope reward claim, replays the same id with updated block,
  tx hash, reward amount, and normalized wallet case, then injects foreign
  contract and foreign-chain `scoped_reward_claims` rows and proves
  `getRecentRewardClaims` / `getAllRewardClaims` ignore them. The compact
  wrapper and autonomous/prelaunch formatters surface
  `rewardClaimScopeIsolation=true` and
  `idempotentRewardClaimUpsert=true` near the start of the
  ABI/indexer row. Verified with syntax checks,
  `test:indexer-storage:summary`, `test:logic:summary`, and
  `proof:autonomous:summary`. This is local SQLite/indexer proof coverage
  only; no live indexer RPC, wallet signing, transactions, deploys, ABI,
  randomness, tokenomics, private RPC/env, live canary/soak, or cleanup apply
  changed.
- ABI/indexer storage local proof now also explicitly covers jackpot storage
  scope and replay behavior. `scripts/test-indexer-event-storage.ts` writes a
  current-scope daily jackpot, replays the same jackpot id with updated block,
  tx hash, and amount metadata, then injects foreign contract and foreign-chain
  `scoped_jackpots` rows and proves `getJackpotsMap` /
  `getRecentJackpots` ignore them. The compact wrapper and
  autonomous/prelaunch formatters surface `jackpotScopeIsolation=true` and
  `idempotentJackpotUpsert=true` near the start of the ABI/indexer row.
  Verified with syntax checks, `test:indexer-storage:summary`,
  `test:logic:summary`, and `proof:autonomous:summary`. This is local
  SQLite/indexer proof coverage only; no live indexer RPC, wallet signing,
  transactions, deploys, ABI, randomness, tokenomics, private RPC/env, live
  canary/soak, or cleanup apply changed.
- ABI/indexer storage local proof now explicitly covers resolved epoch storage
  scope and replay behavior. `scripts/test-indexer-event-storage.ts` writes and
  replays epoch `42`, proves the replay updates block, winning-tile, and pool
  metadata without growing `scoped_epochs`, then injects foreign contract and
  foreign-chain epoch rows and proves `getEpochMap` plus
  `getGlobalStatsAggregate().resolvedEpochs` ignore them. The compact wrapper
  and autonomous/prelaunch formatters surface `epochScopeIsolation=true` and
  `idempotentEpochUpsert=true` near the start of the ABI/indexer row. Verified
  with syntax checks, `test:indexer-storage:summary`, `test:logic:summary`,
  `proof:autonomous:summary`, and `proof:prelaunch:summary`. This is local
  SQLite/indexer proof coverage only; no live indexer RPC, wallet signing,
  transactions, deploys, ABI, randomness, tokenomics, private RPC/env, live
  canary/soak, or cleanup apply changed.
- ABI/indexer storage local proof now explicitly covers single
  `RebateClaimed` normalized storage parity. `scripts/test-indexer-event-storage.ts`
  stores a synthetic single rebate claim beside batch reward/rebate and
  dust-settlement payloads, then proves the payload keeps `kind=rebate`,
  `eventName=RebateClaimed`, and `epochsClaimed=1` while sharing the
  `batch_claim` normalized category without collapsing event ids. The compact
  wrapper and autonomous/prelaunch formatters surface
  `singleRebateClaimParity=true` beside the existing batch-claim and
  dust-settlement parity markers. Verified with syntax checks,
  `test:indexer-storage:summary`, `test:logic:summary`,
  `proof:autonomous:summary`, and `proof:prelaunch:summary`. This is local
  SQLite/indexer proof coverage only; no live indexer RPC, wallet signing,
  transactions, deploys, ABI, randomness, tokenomics, private RPC/env, live
  canary/soak, or cleanup apply changed.
- ABI/indexer storage local proof now explicitly covers deposit/bet read scope
  and replay behavior for the `getUserBetsMap` path used by deposit history.
  `scripts/test-indexer-event-storage.ts` replays the same current-scope bet id
  with an updated block, injects foreign contract and foreign-chain
  `scoped_bets` rows, then proves deposit reads ignore those rows and prefer
  the latest current-scope replay metadata. The compact wrapper and
  autonomous/prelaunch formatters surface `depositScopeIsolation=true` and
  `idempotentDepositUpsert=true` near the start of the ABI/indexer row.
  Verified with syntax checks, `test:indexer-storage:summary`,
  `test:logic:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. This is local SQLite/indexer proof coverage only;
  no live indexer RPC, wallet signing, transactions, deploys, ABI, randomness,
  tokenomics, private RPC/env, live canary/soak, or cleanup apply changed.
- ABI/indexer storage local proof now explicitly surfaces resolver reward and
  dust settlement scope plus replay/idempotent behavior. `scripts/test-indexer-event-storage.ts`
  replays the same current-scope `resolver_reward` and `dust_settlement` ids
  with updated block metadata, proves normalized reads prefer the latest
  payload, then keeps the existing foreign contract and foreign-chain rows
  from overriding current-scope resolver reward or dust settlement payloads.
  The compact wrapper and autonomous/prelaunch formatters surface
  `resolverRewardScopeIsolation=true`,
  `idempotentResolverRewardUpsert=true`,
  `dustSettlementScopeIsolation=true`, and
  `idempotentDustSettlementUpsert=true` beside the deposit, epoch, jackpot,
  and reward-claim markers. Verified with syntax checks,
  `test:indexer-storage:summary`, `test:logic:summary`, and
  `proof:autonomous:summary`. This is local SQLite/indexer proof coverage only;
  no live indexer RPC, wallet signing, transactions, deploys, ABI, randomness,
  tokenomics, private RPC/env, live canary/soak, or cleanup apply changed.
- Wallet approval flows now fail closed before duplicate approval replacement
  sends while a pending approval is still inside the pending-timeout window.
  `app/hooks/useMiningAllowance.ts` and
  `app/lib/mining/autoMineBootstrap.ts` share the same pending-approval age
  gate: unsafe pending state still throws the existing nonce-recovery error,
  pending age at or below `APPROVE_PENDING_TIMEOUT_MS` throws a clear wait
  message for manual betting or Auto-Miner, and only older pending approval
  state can proceed to the existing replacement path. `scripts/test-business-logic.mjs`
  source-guards both manual and Auto-Miner paths, and
  `scripts/run-business-logic-summary.mjs`,
  `scripts/report-autonomous-status.mjs`, and
  `scripts/report-prelaunch-status.mjs` surface
  `approvalDuplicateSendSafe=true` as part of
  `walletTxStateMachineProof`. Verified with syntax checks,
  `test:logic:summary`, `typecheck:summary`, and
  `proof:autonomous:summary`. This changes approval duplicate-send behavior
  only; it did not submit approvals, bets, claims, wallet signatures,
  transactions, deploys, ABI, randomness, tokenomics, private RPC/env, live
  canary/soak, or cleanup apply.
- White Paper decorative hero particles now respect the same reduced-motion
  boundary as the page backdrop. `app/components/WhitePaper.tsx` imports
  `useReducedMotion`, waits for `motionReady`, skips `FloatingParticles` when
  `reducedMotion` is enabled, and marks the decorative particle layer
  `aria-hidden="true"`. `scripts/test-business-logic.mjs` source-guards both
  the reduced-motion render boundary and assistive-technology hiding. Verified
  with `node --check scripts/test-business-logic.mjs`,
  `test:logic:summary`, `typecheck:summary`, `lint:summary`, `build:summary`,
  and a fresh `baseline:bundle:summary`. This is local
  UX/accessibility/performance hardening only; no wallet runtime, transaction
  path, contract, ABI, randomness, tokenomics, deployment, RPC/env, or secret
  path changed.
- Dialog focus trapping is stricter for modal UX/accessibility without changing
  product flows. `app/hooks/useDialogFocusTrap.ts` now filters initial focus,
  tab-cycle candidates, and focus restoration through a shared rendered/enabled
  check that rejects `hidden`, `display:none`, `visibility:hidden`,
  `visibility:collapse`, disabled, `aria-disabled`, and disabled-fieldset
  controls before the existing `aria-hidden` and `inert` subtree checks.
  `scripts/test-business-logic.mjs` source-guards this behavior. Verified with
  `node --check scripts/test-business-logic.mjs`,
  `test:logic:summary`, `typecheck:summary`, and `lint:summary`. No wallet
  runtime behavior, transaction path, contract, ABI, randomness, tokenomics,
  deployment, RPC/env, or secret path changed.
- V10/indexer/DB local evidence was refreshed without live RPC writes,
  transaction signing, deploy, ABI changes, or contract/runtime behavior
  changes. `test:contract:v10:summary` passed with
  `assertionFailures=0`, `runtimeBytes=16488`, `stateChangingEntrypoints=22`,
  `protocolFeeFlushModelCases=7`, `protocolFeeFlushEntrypointCases=4`,
  `duplicateBatchModelCases=10`, `tokenTransferRollbackCases=4`,
  `batchTransferRollbackCases=4`, `dustTransferRollbackCases=5`,
  `timelockBoundaryCases=16`, `dustBoundaryCases=19`,
  `packedBoundaryCases=77`, `fullRangeAccountingCases=20002`, and
  `fullRangeProportionalCases=20000`. `bench:contract:v10:compiler-matrix:summary`
  passed 16/16 compiler profiles with canonical V10 runtime bytes 16488 and
  runtime headroom 8088. `proof:contract-deployed:v10:offline:summary` passed
  manifest/executable-runtime identity with `transactionSent=false`.
  `test:indexer-storage:summary` passed scope isolation, idempotent upsert,
  normalized event isolation, partial/malformed log fallback, limited event
  reads, and same-block ordering. `test:db-operations:summary` passed local
  backup integrity, retention, repo-local production backup rejection, supplied
  artifact restore, corrupt restore rejection, disk-full rejection, and corrupt
  startup rejection. This is local/test harness evidence only; external
  launch-gate blockers remain.
- Wallet claim state-machine proof is now visible in compact business-logic
  and aggregate summaries. `scripts/run-business-logic-summary.mjs` emits and
  requires `walletClaimStateMachineProof=true` from existing source guards for
  reward claim primary/late reverted receipt handling, reward claim explorer
  links and stale-actor/rejection handling, Safety Pool post-send confirmation
  and partial-success/pending/rejection handling, and connected/embedded
  resolver reward claim pending/ambiguous/rejected actor-scoped flows.
  `scripts/report-autonomous-status.mjs` and
  `scripts/report-prelaunch-status.mjs` surface the aggregate plus
  `rewardClaimStateSafe=true`, `safetyPoolClaimStateSafe=true`, and
  `resolverClaimStateSafe=true`; `scripts/test-business-logic.mjs`
  self-guards the summary contract. Verified with syntax checks,
  `test:logic:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`; required local rows passed and 23 external/status
  blockers remain. This changed proof visibility only; no wallet runtime
  behavior, transaction path, claim path, contract, ABI, randomness,
  tokenomics, deployment, RPC/env, or secret path changed.
- Production dependency audit is green again after the Sentry build-toolchain
  transitive `brace-expansion` advisory was patched through nested overrides,
  and the existing Hono override was advanced to the advisory-fixed patch.
  `package.json` now pins the `glob` and
  `@typescript-eslint/typescript-estree` `minimatch` subtrees to
  `brace-expansion@5.0.9` and `hono@4.12.27`; `package-lock.json` resolves the
  Sentry `glob -> minimatch -> brace-expansion` production path to `5.0.9` and
  the `accounts`/`porto` Hono path to `4.12.27`. Verified with
  `@metamask/connect-evm` is now locked to `1.4.0`, matching the installed
  `@wagmi/connectors` optional dependency range instead of leaving
  `npm ls --omit=dev` with an invalid `1.0.0` tree. Verified with
  `proof:deps:summary` (`total=26`, `high=0`, `moderate=22`, `blocking=0`),
  `proof:deps:all:summary` (`total=38`, `blocking=0`, known dev-toolchain highs
  remain documented), `proof:wallet-deps:summary`, `typecheck:summary`,
  `build:summary`, and `proof:prelaunch:summary`.
- Wallet transaction state-machine proof is now visible in compact
  business-logic and aggregate summaries. `scripts/run-business-logic-summary.mjs`
  emits and requires `walletTxStateMachineProof=true` from existing guards for
  chain+contract+actor scoped pending recovery, explicit reverted primary/late
  receipt handling, hashless nonce recovery that blocks duplicate sends while
  pending, manual pending/ambiguous send paths that do not finalize or retry
  blindly, Auto-Miner unsafe nonce rejection before replacement decisions, and
  RPC reconnect progress before retry. `scripts/report-autonomous-status.mjs`
  and `scripts/report-prelaunch-status.mjs` surface the aggregate before the
  clamped details, and `scripts/test-business-logic.mjs` self-guards the
  summary contract. Verified with syntax checks, `test:logic:summary`,
  `proof:autonomous:summary`, and `proof:prelaunch:summary`; required local
  rows passed and 23 external/status blockers remain. This changed proof
  visibility only; no wallet runtime behavior, transaction path, contract, ABI,
  randomness, tokenomics, deployment, RPC/env, or secret path changed.
- Wallet-runtime proof summaries now put aggregate local/API boundary tokens
  before verbose component fields, so clamped autonomous and prelaunch tables
  show the important launch-readiness signal first. `scripts/run-business-logic-summary.mjs`
  now emits `localProof=true` and `apiBoundaryProof=true`; `scripts/report-autonomous-status.mjs`
  and `scripts/report-prelaunch-status.mjs` surface `localProof=true`,
  `apiBoundaryProof=true`, `authBoundaryProof=true`,
  `replicaRateLimitBoundaryProof=true`, and
  `browserBaselineCompactPerformance=true` before detailed component booleans.
  `scripts/test-business-logic.mjs` self-guards that summary ordering. Verified
  with syntax checks, `test:logic:summary`, `proof:local:summary`,
  `proof:autonomous:summary`, and `proof:prelaunch:summary`; required local
  rows passed and 23 external/status blockers remain. This changed proof
  visibility only; no runtime, wallet, transaction, contract, ABI, randomness,
  tokenomics, deployment, RPC/env, or secret path changed.
- Replica rate-limit boundary proof is now visible in compact business-logic
  and aggregate summaries. `scripts/run-business-logic-summary.mjs` emits and
  requires `replicaRateLimitBoundaryProof=true` from existing source guards for
  bounded 429 `Retry-After`, public-HTTPS-only external rate-limit endpoints,
  fail-closed external limiter response parsing, canonical `WEB_REPLICA_COUNT`
  parsing for shared locks, and strict two-replica external rate-limit env
  documentation. `scripts/report-autonomous-status.mjs` and
  `scripts/report-prelaunch-status.mjs` surface
  `sharedRateLimitRetryAfterBound=true`,
  `externalRateLimitPublicEndpoint=true`, `externalRateLimitResponseBound=true`,
  `externalSharedLockCanonical=true`, and
  `replicaRateLimitStrictConfig=true`, and `scripts/test-business-logic.mjs`
  self-guards the summary contract. Verified with syntax checks,
  `test:logic:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`; required local rows passed and 23 external/status
  blockers remain. This changed proof visibility only; no Redis/Upstash env,
  API runtime behavior, wallet flow, transaction path, contract, ABI,
  randomness, tokenomics, deployment, RPC/env, or secret path changed.
- Auth boundary proof is now visible in compact business-logic and aggregate
  summaries. `scripts/run-business-logic-summary.mjs` emits and requires
  `authBoundaryProof=true` from existing source guards for production
  fail-closed signed-message origin selection, exact `/chat` and `/admin` URI
  binding, production multi-replica replay locks, and normalized session cookie
  wallet addresses. `scripts/report-autonomous-status.mjs` and
  `scripts/report-prelaunch-status.mjs` surface
  `authTrustedOriginFailClosed=true`, `authReplayNonceBoundary=true`, and
  `authSessionCookieBoundary=true`, and `scripts/test-business-logic.mjs`
  self-guards the summary contract. Verified with syntax checks,
  `test:logic:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`; required local rows passed and 23 external/status
  blockers remain. This changed proof visibility only; no auth runtime, wallet
  flow, transaction path, contract, ABI, randomness, tokenomics, deployment,
  RPC/env, or secret path changed.
- Browser performance baseline coverage is now visible in compact local
  summaries. `scripts/run-business-logic-summary.mjs` emits and requires
  `browserBaselineCompactPerformance=true` from source guards proving
  `baseline:browser:summary` exposes quality status, local HTTP/request failure
  counters, counted ignored RSC/wallet/chat cleanup aborts, runtime heap/DOM
  samples, and long-task metrics without writing the full artifact in summary
  mode. `scripts/report-autonomous-status.mjs` and
  `scripts/report-prelaunch-status.mjs` surface that field, and
  `scripts/test-business-logic.mjs` self-guards the summary contract. Verified
  with syntax checks, `test:logic:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`; required local rows passed and 23 external/status
  blockers remain. This is compact proof-tooling visibility, not a fresh
  browser run or public HTTPS launch evidence. No UI runtime, polling cadence,
  wallet flow, transaction path, contract, ABI, randomness, tokenomics,
  deployment, env/RPC, or secret path changed.
- Deposits recovery global-bound proof is now visible in compact summaries.
  `scripts/run-business-logic-summary.mjs` emits and requires
  `depositsRecoveryGlobalBound=true` from the existing source guards that prove
  distinct-address slow recovery scans are globally bounded, do not return
  another user's in-flight recovery task, keep slow chain recovery in the
  background path, and keep deposits rate-limit responses no-store before cache
  lookup or recovery. `scripts/report-autonomous-status.mjs` and
  `scripts/report-prelaunch-status.mjs` surface the field, and
  `scripts/test-business-logic.mjs` self-guards the summary contract. Verified
  with syntax checks, `test:logic:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`; required local rows passed and 23 external/status
  blockers remain. This changed proof visibility only; no deposits runtime,
  indexer, DB schema, RPC/env, wallet, transaction, contract, ABI, randomness,
  tokenomics, deployment, or secret path changed.
- API boundary proof is now visible in compact business-logic and aggregate
  summaries instead of being hidden inside the large guard suite. `scripts/run-business-logic-summary.mjs`
  emits and requires `jsonNoStoreRoutes=true`, `sessionVaryCookie=true`,
  `boundedJsonRoutes=true`, `rateLimitNoStore=true`, and
  `routeErrorRedaction=true`; `scripts/report-autonomous-status.mjs` and
  `scripts/report-prelaunch-status.mjs` surface those fields, and
  `scripts/test-business-logic.mjs` self-guards the summary contract. Verified
  with syntax checks for the touched scripts, `test:logic:summary`,
  `proof:autonomous:summary`, and `proof:prelaunch:summary`. The fresh
  prelaunch run passed all required local rows and still reports 23
  external/status blockers, so this improves local launch visibility only. No
  runtime API behavior, wallet flow, transaction path, contract, ABI,
  randomness, tokenomics, deployment, cleanup apply, or secret path changed.
- Daily autonomous hygiene evidence was refreshed in read-only mode.
  `proof:autonomous:daily:summary` passed dependency, wallet dependency, CI
  security, bundle, and cleanup dry-run rows with no transactions, no deploys,
  and no cleanup apply. Current compact evidence: production dependency audit
  `high=0`, `critical=0`, `blocking=0`; all-dependency audit `knownDev=9` and
  `blocking=0`; wallet dependencies present for Privy, Privy Wagmi, Wagmi, and
  Viem; CI security has read-only permissions, SHA-pinned actions, no
  `pull_request_target`, and no persisted checkout credentials; bundle baseline
  remains within budget with `files=225`, `totalBytes=8422245`,
  `jsBytes=7028521`, `largestJsBytes=1040081` under the
  `maxSingleJsBytes=1250000` guard, `cssBytes=216200`, and
  `wasmBytes=1056860`; cleanup dry-run matched `0` delete targets and skipped
  `4`. `docs/mainnet-status-board.md` records this as daily hygiene evidence
  without changing `0/14` launch gates.
- ABI/indexer aggregate summaries now surface deterministic same-block event
  ordering before the row is clamped. `scripts/report-autonomous-status.mjs`
  and `scripts/report-prelaunch-status.mjs` move
  `sameBlockEventOrdering=true` next to reward/rebate batch/dust parity and
  normalized event id requirements, and `scripts/test-business-logic.mjs`
  guards the compact fields. `docs/mainnet-status-board.md` records the
  latest `proof:prelaunch:summary` ABI/indexer row with
  `sameBlockEventOrdering=true` while preserving the 23 external/status
  blockers and `0/14` launch gates. Verified with syntax checks,
  `test:indexer-storage:summary`, `test:logic:summary`,
  `proof:autonomous:summary`, and `proof:prelaunch:summary`. This changed
  proof visibility only; no indexer runtime, storage schema, contract, ABI,
  deployment, randomness, tokenomics, wallet flow, transaction path, or secret
  handling changed.
- Residual security follow-up compact summaries now make the dormant browser
  resolve-sweep boundary visible instead of only reporting `8/8`. `scripts/check-security-followup.mjs`
  emits `appResolveEpochFiles: 0` in summary mode, and
  `scripts/report-autonomous-status.mjs`, `scripts/report-prelaunch-status.mjs`,
  and `scripts/run-local-proof-preflight.mjs` surface it as
  `appResolveEpochFiles=0`. `docs/mainnet-status-board.md` records the same
  value for local and aggregate verification while keeping `0/14` launch gates
  and 23 external/status blockers. Verified with syntax checks for the touched
  scripts, `proof:security-followup:summary`, `test:logic:summary`,
  `proof:local:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. This changed proof visibility only; no runtime,
  wallet, transaction, contract, ABI, randomness, tokenomics, deployment, or
  secret path changed.
- Wallet claim/transfer receipt proof now covers the non-mining helpers that can
  submit claims, repairs, withdrawals, and transfers without changing runtime
  behavior. `scripts/test-business-logic.mjs` source-guards
  `app/hooks/useRewardScanner.ts` and `app/hooks/useWalletActions.ts` so their
  receipt helpers reject both primary and late `status !== "success"` receipts,
  and source-guards `app/hooks/useRebate.ts` so Safety Pool confirmation
  rethrows reverted receipts instead of converting them to ambiguous pending.
  Verified with `node --check scripts\test-business-logic.mjs` and
  `test:logic:summary` (`assertionFailures=0`). A fresh
  `proof:autonomous:summary` passed afterward with `wallet runtime logic`
  `exit=0`, and `proof:local:summary` passed L1-L17; external launch evidence
  remains missing and visible. No transaction, deploy, randomness, tokenomics,
  ABI, removed wallet experiment, or secret path changed.
- Mainnet status-board proof counters are back in sync with the current
  residual security follow-up suite. `docs/mainnet-status-board.md` now records
  the 2026-08-03 `proof:local:summary` and `proof:prelaunch:summary` evidence
  with residual security follow-up `8/8`, while preserving `0/14` Complete
  launch gates and the 23 external/status blockers. `scripts/run-local-proof-preflight.mjs`
  now expects the compact `proof:security-followup:summary` `checks=8`,
  `passed=8`, and `scripts/check-launch-gates.mjs` requires the same `8/8`
  board snippet. Verified with `node --check scripts\run-local-proof-preflight.mjs`,
  `node --check scripts\check-launch-gates.mjs`, `node --check scripts\test-business-logic.mjs`,
  `proof:security-followup:summary`, `proof:gates:structure`, `proof:local:summary`,
  `test:logic:summary`, and `proof:prelaunch:summary`. The final prelaunch run
  passed all required local rows and still reported 23 external/status blockers.
- Autonomous status now surfaces wallet runtime logic explicitly.
  `scripts/report-autonomous-status.mjs` includes a read-only `wallet runtime
  logic` row backed by `test:logic:summary`, and summarizes only compact JSON
  counters: `businessLogic`, `expectedWarnings`, `assertionFailures`, and
  `timedOut`. `scripts/test-business-logic.mjs` source-guards the new row and
  parser so raw test output is not replayed in the autonomous report. Verified
  with `node --check scripts\report-autonomous-status.mjs`,
  `node --check scripts\test-business-logic.mjs`, `test:logic:summary`, and
  `proof:autonomous:summary`, which now reports `wallet runtime logic` as
  `status=pass`, `businessLogic=true`, and `assertionFailures=0`.
- Wallet/mining receipt recovery proof now explicitly covers reverted receipt
  handling without changing transaction behavior. `scripts/test-business-logic.mjs`
  source-guards `app/hooks/useMiningReceipt.ts` so both primary
  `waitForTransactionReceipt` and late `getTransactionReceipt` paths throw
  explicit reverted errors, and source-guards `app/lib/miningTxPath.ts` so a
  tracked pending mining transaction with a reverted receipt returns `clear`
  rather than `confirmed` or unresolved `pending`. Verified with
  `node --check scripts\test-business-logic.mjs`, `test:logic:summary`
  (`assertionFailures=0`), and read-only `proof:autonomous:summary`. This is
  local proof only; no real transaction, deploy, randomness, tokenomics, ABI,
  or removed wallet experiment path changed.
- Indexer normalized event storage coverage now includes deterministic
  same-block ordering. `scripts/test-indexer-event-storage.ts` adds two
  `batch_claim` records with the same `blockNumber` and different ids, then
  reads the last two normalized events and asserts the result uses the storage
  order `block_number ASC, id ASC` after the limited descending scan is
  reversed. `scripts/run-indexer-storage-summary.mjs` now surfaces
  `sameBlockEventOrdering`. Verified with
  `node --check scripts\test-indexer-event-storage.ts`,
  `node --check scripts\run-indexer-storage-summary.mjs`,
  `test:indexer-storage:summary` (`sameBlockEventOrdering=true`,
  assertions `0`), and `test:logic:summary`. A fresh read-only
  `proof:autonomous:summary` passed afterward with the ABI/indexer storage
  summary green. This is local storage/indexer compatibility evidence only; it
  does not close live DB/finality/reorg or deployed chain comparison gates.
- V10 invariant coverage now includes the schedule-time epoch-duration boundary
  in addition to timelock application. `scripts/test-contract-v10-invariants.mjs`
  source-guards `_scheduleEpochDuration` for the exact `15..3600` second range
  and adds model cases for `0`, `14`, `15`, `16`, `3599`, `3600`, and `3601`,
  proving invalid values fail closed with `InvalidEpochDuration` while the
  edge values remain accepted. Verified with
  `node --check scripts\test-contract-v10-invariants.mjs`,
  `test:contract:v10:summary` (`timelockBoundaryCases=16`, assertions `0`),
  and `test:logic:summary`. A fresh `proof:autonomous:summary` also reported
  V10 `timelockBoundaryCases=16`. This did not change V10 formulas,
  randomness, tokenomics, ABI, deployment, or any transaction path.
- Security follow-up proof now covers the legacy keeper bot receipt/nonce
  remediation as well as the bootstrap resolver path. `scripts/check-security-followup.mjs`
  reads `bot.ts` and source-guards that `PendingResolve` persists a bound
  nonce, unbound pending nonce gaps throw `keeper_pending_nonce_unbound`,
  direct `waitForTransactionReceipt` checks `receipt.status`, reverted receipts
  are deferred with `PENDING_RESOLVE_REVERT_RETRY_MS`, legacy pending markers
  without a nonce are discarded, and stale replacement uses only the marker's
  bound nonce. This closes a proof gap against the old Codex Security keeper
  findings without sending transactions or changing keeper transaction
  semantics. Verified with `node --check scripts\check-security-followup.mjs`,
  `proof:security-followup:summary` (`8/8` checks pass), and
  `test:logic:summary`. A fresh `proof:autonomous:summary` then completed in
  read-only mode and reported `security follow-up` as `checks=8`, `passed=8`,
  `failed=0`.
- Short local HTTP load smoke passed against the UI-only dev server on
  `http://localhost:3000`. An initial run with the default 10s timeout was
  invalid because cold dev compilation made every warm-up endpoint miss the
  timeout, so it was rerun with explicit local-only settings and preserved
  process exit code: `LOAD_ALLOW_LOCAL=1`, `LOAD_DURATION_MS=5000`,
  `LOAD_CONCURRENCY=4`, `LOAD_CLIENT_IPS=4`, `LOAD_TIMEOUT_MS=30000`, and
  `LOAD_MAX_P95_MS=30000`. The corrected run completed 285 requests in 5s
  after warm-up, with 0 failed requests, global p95 298ms, p99 324ms, and
  statuses `200:273` / `429:12`; the 429s are expected rate-limit responses
  accepted by `scripts/load-http.mjs`. The dev server was stopped afterward
  and port 3000 had no LISTENING entry. This is local API latency/error
  evidence only, not public HTTPS launch load proof.
- Fresh `proof:prelaunch:summary` passed after the wide local check. Required
  local checks passed, including contract compile/advisories/compiler matrix,
  V10 no-RPC diagnostics, V10 offline identity, V9/V10 invariants,
  ABI/indexer storage, fetch timeout, stored number parsing, typecheck, lint,
  production build, bundle baseline, SQLite operations, runtime monitoring
  drill, process model, business logic, security follow-up, dependency/toolchain
  audits, wallet dependencies, cleanup dry-run/loop status, launch docs,
  proof templates/drafts/files, collector redaction, launch command map, host
  guard, launch-gate structure, and readiness checklist. The summary still
  reports 23 external/status blockers: deployed V10 metadata/runtime identity,
  mainnet env strict, chain strict RPC env, signoff manifests, host manifests,
  indexer DB/finality evidence, restore source/backup evidence, runtime monitor
  config, monitoring manifest, QA manifest, testnet canary logs, backup env/path,
  launch strict canary proof, and related strict variants. Blocker groups remain
  `backup=2`, `canary=3`, `chain=1`, `contract=1`, `env=2`, `host=2`,
  `indexer=2`, `launch=1`, `monitoring=3`, `qa=2`, `restore=2`, `signoff=2`.
- Fresh `check:summary` passed after the browser baseline and hygiene updates.
  The wide local gate completed lint, `test:logic`,
  `proof:security-followup`, fetch-timeout, stored-number-parsing, V9/V10
  contract tests, indexer storage, DB operations, monitoring, build,
  typecheck, local `smoke:http`, and local `smoke:browser`. The temporary
  smoke server used `127.0.0.1:3101`; after the run, port 3101 had no
  LISTENING entry, only TIME_WAIT sockets. This remains local-only proof and
  does not close external RPC/env, host, Privy domain, wallet signing, canary,
  soak, backup/restore, indexer, monitoring, QA, or signoff gates.
- Daily local hygiene summaries passed after the browser baseline block.
  `proof:deps:summary` reported production dependency audit pass with
  `critical=0`, `high=0`, `moderate=28`, and `low=11`;
  `proof:wallet-deps:summary` reported Privy `3.27.2`, Privy Wagmi `4.0.9`,
  Wagmi `3.6.16`, Viem `2.50.4`, and no missing wallet dependencies;
  `baseline:bundle:summary` reported static production output within budget
  (`225` files, `8,422,086` bytes total, `7,028,362` JS bytes, `216,200` CSS
  bytes, `1,056,860` WASM bytes, no budget issues); and
  `cleanup:workspace:dry-run:summary` reported `matchedTargets=0` and
  `wouldDeleteTargets=0`. These are read-only/local checks only and do not
  close external launch gates.
- Local browser performance baseline now treats the exact dev cleanup abort for
  `GET /api/chat/messages` as a counted ignored cleanup event instead of a
  page-quality failure. The first baseline run produced `quality.status=degraded`
  solely from one local `net::ERR_ABORTED` chat poll sample; inspection showed
  `useChat` aborts stale polls through its cleanup `AbortController`, while the
  chat polling behavior itself remains unchanged to preserve unread/freshness
  behavior. `scripts/measure-browser-baseline.mjs` now exposes
  `ignoredLocalChatPollAbortCount` in full and summary reports, and
  `scripts/test-business-logic.mjs` source-guards the exact method/path/error
  classifier so unrelated local API failures still degrade the baseline.
  Verified with `node --check scripts\measure-browser-baseline.mjs`,
  `node --check scripts\test-business-logic.mjs`, `test:logic:summary`, and a
  fresh UI-only `baseline:browser:summary` against `localhost:3000`, which
  reported `quality.status=pass`, zero failed local responses/requests, one
  ignored chat cleanup abort, no local console errors, `CLS=0`, synthetic
  `INP=32ms`, and no horizontal overflow. Dev-mode LCP/TTFB/long-task numbers
  remain dominated by Next webpack compilation and are local performance
  evidence only; this does not close public HTTPS, Privy production-domain,
  wallet signing, canary, soak, host, backup, or indexer launch gates.
- Local browser smoke passed after the reduced-motion maintenance overlay
  change. Following `docs/browser_automation.md`, an initial smoke attempt
  failed because no local server was listening on `localhost:3000`; then the
  UI-only `dev:ui -- -p 3000` server was started without bot/indexer workers,
  `smoke:browser` passed desktop, tablet, mobile, wallet-selector modal,
  first-visit tutorial accessibility, chat drawer/profile modal, analytics,
  safety pool, leaderboards, white paper, FAQ, extreme-value overflow, empty
  states, and pool chart freshness checks. The dev server was stopped
  afterward and port 3000 had no LISTENING entry. This is local-only browser
  evidence and does not close public HTTPS, Privy production-domain, wallet
  signing, canary, soak, host, backup, or indexer launch gates.
- Maintenance overlay decorative motion now respects reduced-motion
  preferences. `app/components/MaintenanceOverlay.tsx` uses the shared
  `useReducedMotion` hook and keeps the overlay, logo, copy, divider, and
  status indicator visible while disabling orb drift, float, fade, gradient,
  and ping animations when reduced motion is enabled. `scripts/test-business-logic.mjs`
  source-guards the hook usage and the gated animation classes. Verified with
  `node --check scripts\test-business-logic.mjs`, `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `build:summary`,
  `proof:autonomous:summary`, and a fresh `proof:prelaunch:summary` full run.
  Required local checks passed; 23 external/status blockers remain and
  external launch gates remain `0/14`. This did not read private env/RPC
  values, send transactions, start live canary/soak, deploy, or change
  ABI/randomness/tokenomics/percentages.
- Operator health check scripts now reject malformed diagnostics secrets before
  polling health endpoints or attaching diagnostics headers. `scripts/monitor-runtime-health.mjs`
  and `scripts/check-production-health.mjs` require
  `HEALTH_DIAGNOSTICS_SECRET` to trim to 32..256 non-control characters;
  malformed values enter config/threshold issues, summary mode reports
  `wouldPoll=false` and `wouldSendAlerts=false`, and the secret text is not
  printed. `scripts/test-business-logic.mjs` source-guards both scripts and
  now spawns `scripts/check-production-health.mjs --summary-only` with a
  short synthetic secret to prove it fails before endpoint polling or endpoint
  disclosure. `scripts/test-runtime-monitor-drill.mjs` covers the runtime
  monitor short-secret failure path, and `scripts/run-monitoring-drill-summary.mjs` /
  `scripts/report-prelaunch-status.mjs` now preserve the
  `malformedDiagnosticsSecretRejected` evidence marker. Verified with
  `node --check scripts\monitor-runtime-health.mjs`,
  `node --check scripts\check-production-health.mjs`,
  `node --check scripts\test-business-logic.mjs`,
  `node --check scripts\test-runtime-monitor-drill.mjs`,
  `node --check scripts\run-monitoring-drill-summary.mjs`,
  `node --check scripts\report-prelaunch-status.mjs`,
  `test:logic:summary`, `test:monitoring:summary`, `typecheck:summary`,
  `lint:summary`, `proof:autonomous:summary`, and a fresh
  `proof:prelaunch:summary` full run. Required local checks passed; 23
  external/status blockers remain and external launch gates remain `0/14`.
  This did not read private env/RPC values, send transactions, start live
  canary/soak, deploy, or change ABI/randomness/tokenomics/percentages.
- Health diagnostics authorization now normalizes configured and provided
  secrets before Buffer allocation or timing-safe comparison.
  `app/api/health/_lib/diagnosticsAuth.ts` still allows a signed admin session,
  but header-based diagnostics auth now requires `HEALTH_DIAGNOSTICS_SECRET`
  and the selected diagnostics header to trim to 32..256 non-control
  characters. Missing, short, oversized, or malformed diagnostics secrets fail
  closed before private runtime/data-sync health payloads are exposed.
  `scripts/test-business-logic.mjs` source-guards the bounded normalizer, the
  provided-secret precheck, and the absence of the previous unbounded
  header-to-Buffer path. Verified with
  `node --check app\api\health\_lib\diagnosticsAuth.ts`,
  `node --check scripts\test-business-logic.mjs`, `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local checks passed; 23 external/status
  blockers remain and external launch gates remain `0/14`. This did not read
  private env/RPC values, send transactions, start live canary/soak, deploy,
  or change ABI/randomness/tokenomics/percentages.
- Bootstrap resolver keeper authorization now normalizes both configured and
  provided secrets before Buffer allocation or timing-safe comparison.
  `app/api/bootstrap-resolve/shared.ts` keeps the existing no-hostname-bypass
  rule, but now requires `BOOTSTRAP_RESOLVE_SECRET` and
  `x-bootstrap-resolve-secret` to trim to 32..256 non-control characters; with
  a keeper key configured, a missing, short, oversized, or malformed secret
  fails closed before resolver work. `scripts/test-business-logic.mjs`
  source-guards the bounded normalizer, the provided-secret precheck, and the
  absence of the previous unbounded header-to-Buffer path. Verified with
  `node --check app\api\bootstrap-resolve\shared.ts`,
  `node --check scripts\test-business-logic.mjs`, `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local checks passed; 23 external/status
  blockers remain and external launch gates remain `0/14`. This did not read
  private env/RPC values, send transactions, start live canary/soak, deploy,
  or change ABI/randomness/tokenomics/percentages.
- Runtime health trusted-proxy diagnostics now use the same bounded secret
  shape expected by the request identity guard before reporting
  `trustedProxyConfigured=true`. `app/api/health/runtime/route.ts` requires
  `TRUST_PROXY_HEADERS=1` plus a trimmed proxy secret with 32..256 characters
  and no ASCII control characters, so monitoring health cannot publish a false
  ready boolean for short, oversized, or malformed proxy trust material.
  `scripts/test-business-logic.mjs` source-guards the helper and rejects the
  old length-only `TRUST_PROXY_SECRET` readiness check. Verified with
  `node --check app\api\health\runtime\route.ts`,
  `node --check scripts\test-business-logic.mjs`, `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local checks passed; 23 external/status
  blockers remain and external launch gates remain `0/14`. This did not read
  private env/RPC values, send transactions, start live canary/soak, deploy,
  or change ABI/randomness/tokenomics/percentages.
- Runtime process health snapshots now normalize uptime and memory values
  before monitoring output. `app/api/_lib/runtimeMetrics.ts` keeps the route
  metric counter/status hardening and now also rejects malformed, negative, or
  fractional process metrics, saturates oversized memory values at
  `Number.MAX_SAFE_INTEGER`, and floors only uptime seconds. `scripts/test-business-logic.mjs`
  covers patched `process.uptime()` / `process.memoryUsage()` values for `NaN`,
  negative, fractional, oversized, and valid metrics, plus a source guard that
  prevents raw process evidence from being published directly. Verified with
  `node --check app\api\_lib\runtimeMetrics.ts`,
  `node --check scripts\test-business-logic.mjs`, `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local checks passed; 23 external/status
  blockers remain and external launch gates remain `0/14`. This did not read
  private env/RPC values, send transactions, start live canary/soak, deploy,
  or change ABI/randomness/tokenomics/percentages.
- Runtime route metrics now normalize published HTTP statuses and saturate
  counters before monitoring snapshots. `app/api/_lib/runtimeMetrics.ts` keeps
  the existing label redaction, entry cap, key clamp, and latency bounds, and
  now routes request, success, error, cache-hit, stale, inflight-join,
  background-refresh, and inflight increments through a safe-integer counter
  helper. `finishRouteMetric` and `failRouteMetric` also normalize malformed
  status values to safe 200/500 fallbacks so runtime health snapshots cannot
  publish `NaN`, fractional, or out-of-range statuses. `scripts/test-business-logic.mjs`
  covers malformed success/failure statuses and source-guards the bounded
  counter/status helpers. Verified with
  `node --check app\api\_lib\runtimeMetrics.ts`,
  `node --check scripts\test-business-logic.mjs`, `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local checks passed; 23 external/status
  blockers remain and external launch gates remain `0/14`. This did not read
  private env/RPC values, send transactions, start live canary/soak, deploy,
  or change ABI/randomness/tokenomics/percentages.
- External Redis/Upstash rate-limit responses now fail closed on malformed
  UTF-8 before JSON parsing. `app/api/_lib/externalRateLimit.ts` uses fatal
  UTF-8 decoding while preserving the existing strict Content-Length preflight,
  8 KiB response cap, public HTTPS endpoint guard, bounded Redis key inputs,
  and strict counter parsing. `scripts/test-business-logic.mjs` covers a
  syntactically JSON-shaped response with an invalid byte inside a string so
  the external limiter cannot accept replacement characters and continue as if
  the Redis response were clean. Verified with
  `node --check app\api\_lib\externalRateLimit.ts`,
  `node --check scripts\test-business-logic.mjs`, `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local checks passed; 23 external/status
  blockers remain and external launch gates remain `0/14`. This did not read
  private env/RPC values, send transactions, start live canary/soak, deploy,
  or change ABI/randomness/tokenomics/percentages.
- Shared API rate-limit options now fail closed on oversized per-route limits
  and windows before local fallback counters, weak-identity bucket counters, or
  external rate-limit calls can be reached. `app/api/_lib/sharedRateLimit.ts`
  keeps the existing strict bucket parser and now caps route `limit` at 10,000
  requests per window and `windowMs` at 86,400,000 ms, which covers all current
  route callers while preventing accidental multi-day fallback retention or
  impractically high route limits. `scripts/test-business-logic.mjs` covers
  over-cap `limit` and `windowMs` configs returning no-store 503 responses,
  keeps the 24h `Retry-After` boundary bounded, and source-guards the new caps
  before malformed config can reach fallback counters. Verified with
  `node --check app\api\_lib\sharedRateLimit.ts`,
  `node --check scripts\test-business-logic.mjs`, `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local checks passed; 23 external/status
  blockers remain and external launch gates remain `0/14`. This did not read
  private env/RPC values, send transactions, start live canary/soak, deploy,
  or change ABI/randomness/tokenomics/percentages.
- Trusted proxy client identity now bounds and sanitizes the proxy trust secret
  before constant-time comparison or trusted IP parsing. `app/api/_lib/clientIdentity.ts`
  requires both configured and request-provided `x-lore-proxy-secret` values
  to normalize to 32..256 non-control characters before `secretsMatch`; short,
  missing, wrong, oversized, or malformed values keep the request on the weak
  anonymous identity path and ignore spoofable `cf-connecting-ip`, `x-real-ip`,
  and `x-forwarded-for` values. `scripts/test-business-logic.mjs` covers
  short and oversized proxy secret failures, valid trusted forwarded IP
  parsing, invalid IP fail-closed behavior, wrong-secret fallback, and source
  guards that keep normalization before HMAC comparison. Verified with
  `node --check app\api\_lib\clientIdentity.ts`,
  `node --check scripts\test-business-logic.mjs`, `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local checks passed; 23 external/status
  blockers remain and external launch gates remain `0/14`. This did not read
  private env/RPC values, send transactions, start live canary/soak, deploy,
  or change ABI/randomness/tokenomics/percentages.
- Admin and chat session cookies now reject oversized, malformed, or suffixed
  signed-token strings before HMAC verification or production secret lookup.
  `app/api/_lib/adminSession.ts` and `app/api/_lib/chatSession.ts` bound raw
  session cookie values to 1024 characters, require exactly one `.` separator,
  and require both token parts to be base64url-shaped before decoding or
  signing. `scripts/test-business-logic.mjs` covers malformed chat cookies in
  production env with missing secrets, plus source guards that keep the bounded
  parser before signed-token verification for both server session helpers.
  Verified with `node --check app\api\_lib\adminSession.ts`,
  `node --check app\api\_lib\chatSession.ts`,
  `node --check scripts\test-business-logic.mjs`, `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local checks passed; 23 external/status
  blockers remain and external launch gates remain `0/14`. This did not read
  private env/RPC values, send transactions, start live canary/soak, deploy,
  or change ABI/randomness/tokenomics/percentages.
- Versioned route-cache builders now bypass async cache metadata on invalid
  cache keys. `app/api/_lib/versionedRouteCache.ts` validates write versions
  returned by the shared cache before starting background refresh work; invalid
  keys skip background build/metric/commit paths entirely. Foreground inflight
  builds with invalid keys still return a payload to the caller, but bypass
  cache retention, inflight metadata, and commit hooks. `scripts/test-business-logic.mjs`
  covers invalid-key background refresh skip behavior, invalid-key foreground
  payload return, no commit hooks, no retained inflight/refresh metadata, and
  source guards for the write-version gate. Verified with
  `node --check app\api\_lib\versionedRouteCache.ts`,
  `node --check scripts\test-business-logic.mjs`, `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local checks passed; 23 external/status
  blockers remain and external launch gates remain `0/14`. This did not read
  private env/RPC values, send transactions, start live canary/soak, deploy,
  or change ABI/randomness/tokenomics/percentages.
- In-memory route cache keys now fail closed on ASCII control characters before
  any cache, inflight, refresh, write-version, or pending-write map access.
  `app/api/_lib/routeCache.ts` keeps existing valid keys and the 4096-character
  limit, but `isUsableCacheKey` now also rejects null/newline/control-character
  keys so malformed request-derived cache keys cannot occupy cache capacity or
  retain async metadata. `scripts/test-business-logic.mjs` covers control-key
  behavior across fresh/stale reads, direct writes, latest writes, inflight,
  refresh, and write-version metadata, plus the source guard. Verified with
  `node --check scripts\test-business-logic.mjs`, `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local checks passed; 23 external/status
  blockers remain and external launch gates remain `0/14`. This did not read
  private env/RPC values, send transactions, start live canary/soak, deploy,
  or change ABI/randomness/tokenomics/percentages.
- No-store response header merging now validates existing `Vary` tokens before
  adding `Cookie`. `app/api/_lib/responseHeaders.ts` rejects malformed Vary
  entries through a strict HTTP header-token parser while preserving valid
  tokens, wildcard `Vary: *`, and case-insensitive Cookie de-duplication. This
  keeps session and auth-sensitive responses on a cleaner cache boundary even
  if a route starts from a malformed Vary value. `scripts/test-business-logic.mjs`
  covers invalid Vary-token filtering, valid token preservation, Cookie merge,
  wildcard preservation, no-store headers, and a source guard for token
  validation. Verified with `node --check app\api\_lib\responseHeaders.ts`,
  `node --check scripts\test-business-logic.mjs`, `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local checks passed; 23 external/status
  blockers remain and external launch gates remain `0/14`. This did not read
  private env/RPC values, send transactions, start live canary/soak, deploy,
  or change ABI/randomness/tokenomics/percentages.
- API route error logging now strips ASCII control characters from safe route
  messages, labels, extra keys, and extra string values before console output.
  `app/api/_lib/routeError.ts` normalizes control characters in the shared
  `clampOneLine` helper, preserving existing redaction/clamping while preventing
  null bytes, bell characters, newlines, and other controls from leaking into
  route logs. `scripts/test-business-logic.mjs` covers safe error messages and
  structured route log output with synthetic control characters in label,
  message, and extra fields. Verified with `node --check app\api\_lib\routeError.ts`,
  `node --check scripts\test-business-logic.mjs`, `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local checks passed; 23 external/status
  blockers remain and external launch gates remain `0/14`. This did not read
  private env/RPC values, send transactions, start live canary/soak, deploy,
  or change ABI/randomness/tokenomics/percentages.
- Shared UI/API fetch timeouts now reject oversized caller overrides before
  creating timers. `app/lib/fetchWithTimeout.ts` keeps the 12-second default
  and current callers valid, but caps explicit `timeoutMs` values at 120
  seconds instead of allowing raw platform timer delays. This prevents future
  UI/API fetches from accidentally creating effectively stuck multi-day
  requests while preserving caller abort propagation and listener cleanup.
  `scripts/test-fetch-with-timeout.ts` covers the exact cap, oversized values,
  invalid numeric values, timeout aborts, caller aborts, and listener cleanup.
  `scripts/test-business-logic.mjs` also has source guards for the shared cap
  and for avoiding broad numeric timeout coercion. Verified with
  `test:fetch-timeout:summary`, `node --check scripts\test-business-logic.mjs`,
  `test:logic:summary`, `typecheck:summary`, `lint:summary`,
  `proof:autonomous:summary`, and `proof:prelaunch:summary`. Required local
  checks passed; 23 external/status blockers remain and external launch gates
  remain `0/14`. This did not read private env/RPC values, send transactions,
  start live canary/soak, deploy, or change ABI/randomness/tokenomics/percentages.
- Shared JSON request/response decoding now fails closed on malformed UTF-8.
  `app/api/_lib/boundedJsonBody.ts` and `app/lib/readJsonResponse.ts` use
  fatal UTF-8 `TextDecoder` instances, so invalid byte sequences cannot be
  silently converted to replacement characters inside otherwise parseable JSON.
  `scripts/test-business-logic.mjs` covers malformed UTF-8 byte payloads for
  both inbound request bodies and client response parsing, plus source guards
  for fatal decoding in both helpers. Verified with
  `node --check app\api\_lib\boundedJsonBody.ts`,
  `node --check scripts\test-business-logic.mjs`, `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local checks passed; 23 external/status
  blockers remain and external launch gates remain `0/14`. This did not read
  private env/RPC values, send transactions, start live canary/soak, deploy,
  or change ABI/randomness/tokenomics/percentages.
- Client JSON response parsing now rejects caller byte-limit overrides above
  the helper-wide 2 MiB cap before reading response streams. `app/lib/readJsonResponse.ts`
  keeps the existing default and all current callers valid, but
  `normalizeJsonResponseMaxBytes` now requires `maxBytes <= MAX_JSON_RESPONSE_BYTES`,
  so a future UI/API reader cannot accidentally opt into unbounded client JSON
  parsing through the shared helper. `scripts/test-business-logic.mjs` covers
  oversized response max-byte configs failing before body reads and the exact
  cap staying valid, with a source guard for the helper-wide cap. Verified with
  `node --check scripts\test-business-logic.mjs`, `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local checks passed; 23 external/status
  blockers remain and external launch gates remain `0/14`. This did not read
  private env/RPC values, send transactions, start live canary/soak, deploy,
  or change ABI/randomness/tokenomics/percentages.
- Bounded JSON request parsing now rejects route byte-limit configs above the
  API-wide 256 KiB cap before touching request streams. `app/api/_lib/boundedJsonBody.ts`
  keeps existing route limits valid, but `normalizeJsonBodyMaxBytes` now
  requires `maxBytes <= MAX_JSON_BODY_BYTES`, so a future route cannot
  accidentally opt into oversized request bodies through the shared helper.
  `scripts/test-business-logic.mjs` covers oversized max-byte configs failing
  before body reads and the exact cap staying valid, with a source guard for
  the helper-wide cap. Verified with `node --check app\api\_lib\boundedJsonBody.ts`,
  `node --check scripts\test-business-logic.mjs`, `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local checks passed; 23 external/status
  blockers remain and external launch gates remain `0/14`. This did not read
  private env/RPC values, send transactions, start live canary/soak, deploy,
  or change ABI/randomness/tokenomics/percentages.
- Normalized indexer event storage now rejects oversized event IDs and
  oversized or unserializable payloads before writing to
  `scoped_indexer_events`. `server/storage.ts` bounds normalized event IDs to
  160 characters and serialized payloads to 16 KiB, skips circular payloads
  safely, keeps valid boundary-sized IDs readable, and honors opt-in
  `limitToLast` reads for normalized event categories without changing the
  default full-read path. `app/api/_lib/dataBridge.ts` also forwards the
  optional limit parameter to storage so API helpers do not bypass the bounded
  read hook, and API storage writes are now allow-listed to the existing
  recovery paths (`gamedata/epochs`, `gamedata/jackpots`, and canonical
  lowercase `gamedata/bets/<wallet>` paths) before calling storage.
  Unsupported API write paths fail closed without reaching `patchJsonPath`.
  `scripts/test-indexer-event-storage.ts` covers oversized IDs, oversized
  payloads, circular payloads, the 160-character boundary case, and limited
  recent-event reads that keep legacy metadata visible.
  `test:indexer-storage:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary` now surface `boundedEventStorage=true` and
  `limitedEventReads=true`. Verified with `node --check` for the touched
  scripts and API bridge, `test:indexer-storage:summary`, `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local checks passed; 23 external/status
  blockers remain and external launch gates remain `0/14`. This did not read
  private env/RPC values, send transactions, start live canary/soak, deploy,
  or change ABI/randomness/tokenomics/percentages.
- Auto-Miner persisted session recovery now rejects corrupted saved
  `lastPlacedEpoch` strings before resume parsing. `app/hooks/useMining.shared.ts`
  keeps the existing valid decimal epoch format, but bounds it to the
  canonical uint256-sized decimal shape (`0` or a non-zero value up to 78
  digits) so a corrupted localStorage session cannot feed an unbounded or
  non-canonical value into reload/reconnect recovery. `scripts/test-business-logic.mjs`
  covers leading-zero, scientific, negative, and oversized epoch strings plus
  a source guard against returning to unbounded `/^\d+$/` parsing. Verified
  with `node --check scripts/test-business-logic.mjs`, `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`,
  `proof:prelaunch:summary`, and `git diff --check` for the touched files.
  Required local checks passed; 23 external/status blockers remain and
  external launch gates remain `0/14`. This did not read private env/RPC
  values, send transactions, start live canary/soak, deploy, or change
  ABI/randomness/tokenomics/percentages.
- External rate-limit requests now validate exported limiter inputs before
  composing Redis keys. `app/api/_lib/externalRateLimit.ts` bounds bucket
  labels to 80 characters, identity keys to 128 characters, requires the
  existing safe rate-limit alphabet, and rejects invalid `limit`, `windowMs`,
  or `now` values before any fetch reaches the external store. This preserves
  existing valid route buckets and hashed identities while closing direct
  misuse of the exported helper. `scripts/test-business-logic.mjs` covers
  empty, URL-like, oversized, zero, and fractional malformed request
  parameters and verifies they fail before fetch/key composition. Verified
  with `node --check scripts/test-business-logic.mjs`, `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`,
  `proof:prelaunch:summary`, and `git diff --check` for the touched files.
  Required local checks passed; 23 external/status blockers remain and
  external launch gates remain `0/14`. This did not read private env/RPC
  values, send transactions, start live canary/soak, deploy, or change
  ABI/randomness/tokenomics/percentages.
- Shared rate-limit validation now rejects malformed bucket names before any
  fallback, SQLite, or external limiter state is touched, and weak-identity
  bucket fallback has an active-bucket cap. `app/api/_lib/sharedRateLimit.ts`
  requires bucket labels to match the existing safe bucket alphabet and max
  length, returns the shared no-store 503 configuration response on invalid
  bucket/limit/window options, and fails closed if weak-identity fallback would
  grow beyond 256 active buckets. `scripts/test-business-logic.mjs` covers
  invalid bucket strings, URL-like bucket strings, oversized bucket labels, and
  the source guards. Verified with `node --check scripts/test-business-logic.mjs`,
  `test:logic:summary`, `typecheck:summary`, `lint:summary`,
  `proof:autonomous:summary`, `proof:prelaunch:summary`, and
  `git diff --check` for the touched files. Required local checks passed; 23
  external/status blockers remain and external launch gates remain `0/14`.
  This did not read private env/RPC values, send transactions, start live
  canary/soak, deploy, or change ABI/randomness/tokenomics/percentages.
- Runtime metrics route labels now pass through redaction, character
  normalization, length bounding, and a global cardinality cap before writing
  to the shared process metrics map. `app/api/_lib/runtimeMetrics.ts` clamps
  labels to 120 characters, routes new labels beyond the cap into
  `__overflow__`, and uses the existing Sentry sanitizer so accidental
  provider URLs or secret-looking values do not become snapshot keys.
  `scripts/test-business-logic.mjs` covers the source guard and a synthetic
  unsafe route label. Verified with `node --check scripts/test-business-logic.mjs`,
  `test:logic:summary`, `typecheck:summary`, `lint:summary`,
  `proof:autonomous:summary`, `proof:prelaunch:summary`, and
  `git diff --check` for the touched files. Required local checks passed; 23
  external/status blockers remain and external launch gates remain `0/14`.
  This did not read private env/RPC values, send transactions, start live
  canary/soak, deploy, or change ABI/randomness/tokenomics/percentages.
- Production auth origin normalization now rejects documentation-only IPv6
  origins before signed admin/chat URI binding. `app/api/_lib/trustedAuthOrigin.ts`
  rejects `2001:db8::/32` alongside local, private, reserved, credentialed,
  path, query, and hash-bearing origins, and `scripts/test-business-logic.mjs`
  covers the production `NEXT_PUBLIC_SITE_URL` rejection. Verified with
  `node --check scripts/test-business-logic.mjs`, `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`,
  `proof:prelaunch:summary`, and `git diff --check` for the touched files.
  Required local checks passed; 23 external/status blockers remain and
  external launch gates remain `0/14`. This did not read private env/RPC
  values, send transactions, start live canary/soak, deploy, or change
  ABI/randomness/tokenomics/percentages.
- Shared API route cache now fails closed for oversized cache keys before any
  cache, inflight, refresh, or write-version map mutation.
  `app/api/_lib/routeCache.ts` rejects keys longer than 4096 characters and
  returns caller payloads without caching, preserving normal response building
  for bounded address and epoch-list keys. `scripts/test-business-logic.mjs`
  covers oversized key behavior across fresh/stale reads, direct writes,
  latest writes, inflight, refresh, metadata, and capacity. Verified with
  `node --check scripts/test-business-logic.mjs`, `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`,
  `proof:prelaunch:summary`, and `git diff --check` for the touched files.
  Required local checks passed; 23 external/status blockers remain and
  external launch gates remain `0/14`. This did not read private env/RPC
  values, send transactions, start live canary/soak, deploy, or change
  ABI/randomness/tokenomics/percentages.
- Canary proof draft generation now uses a regular-file stat boundary for
  side evidence artifacts before accepting redacted target, recovery, session,
  and transaction proof paths. `scripts/create-canary-proof-draft.mjs` routes
  side artifact checks through `regularFileStat()` while preserving bounded
  JSONL parsing, and `scripts/test-business-logic.mjs` guards the boundary and
  rejects raw `existsSync(resolved)` / `statSync(resolved).isFile()` checks in
  the draft generator. Verified with `node --check` for the canary draft
  generator and business test, `proof:testnet:canary:summary`,
  `proof:testnet:canary:v10:summary` (expected missing live-log blocker),
  `proof:drafts:summary`, `test:logic:summary`, `typecheck:summary`,
  `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local checks passed; 23 external/status
  blockers remain and external launch gates remain `0/14`. This did not run
  live canary/soak, send transactions, read private env/RPC values, deploy, or
  change ABI/randomness/tokenomics/percentages.
- Monitoring and QA proof draft generators now share regular-file stat
  boundaries for redacted evidence artifacts before accepting paths in draft
  manifests. `scripts/create-monitoring-proof-draft.mjs` and
  `scripts/create-qa-proof-draft.mjs` route artifact checks through
  `regularFileStat()`, while `scripts/test-business-logic.mjs` guards the
  boundary and rejects raw `existsSync(resolved)` /
  `statSync(resolved).isFile()` checks in those scripts. Verified with
  `node --check` for both draft generators and business test,
  `proof:monitoring:summary`, `proof:qa:summary`, `proof:drafts:summary`,
  `test:logic:summary`, `typecheck:summary`, `lint:summary`,
  `proof:autonomous:summary`, and `proof:prelaunch:summary`. Required local
  checks passed; 23 external/status blockers remain and external launch gates
  remain `0/14`. This did not read private env/RPC values, run production QA
  or monitoring collection, send transactions, start live canary/soak, deploy,
  or change ABI/randomness/tokenomics/percentages.
- Signoff evidence collector and draft generator now share a regular-file stat
  boundary for redacted env and direct-chain comparison artifacts before
  reading logs. `scripts/collect-signoff-evidence.mjs` and
  `scripts/create-signoff-proof-draft.mjs` route artifact checks through
  `regularFileStat()`, while `scripts/test-business-logic.mjs` guards the
  boundary and rejects raw `existsSync(resolved)` /
  `statSync(resolved).isFile()` checks in those scripts. Verified with
  `node --check` for both signoff evidence scripts and business test,
  `proof:signoff:summary`, `proof:signoff:strict:summary` (expected missing
  manifest blocker for G1-G4), `proof:drafts:summary`, `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local checks passed; 23 external/status
  blockers remain and external launch gates remain `0/14`. This did not read
  private env/RPC values, run chain comparison, send transactions, start live
  canary/soak, deploy, or change ABI/randomness/tokenomics/percentages.
- Indexer evidence collector and draft generator now share regular-file stat
  boundaries for redacted indexer logs, production health logs, and chain
  snapshot JSON artifacts before reading or parsing them.
  `scripts/collect-indexer-evidence.mjs` and
  `scripts/create-indexer-proof-draft.mjs` route log/JSON artifact checks
  through `regularFileStat()`, while `scripts/test-business-logic.mjs` guards
  the boundary and rejects raw `existsSync(resolved)` /
  `statSync(resolved).isFile()` checks in those scripts. Verified with
  `node --check` for both indexer evidence scripts and business test,
  `proof:indexer:summary`, `proof:indexer:strict:summary` (expected G7
  missing-input blocker), `proof:drafts:summary`, `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local checks passed; 23 external/status
  blockers remain and external launch gates remain `0/14`. This did not read
  private env/RPC values, run a live indexer/RPC comparison, send
  transactions, start live canary/soak, deploy, or change
  ABI/randomness/tokenomics/percentages.
- Restore evidence collector and draft generator now share regular-file and
  regular-directory stat boundaries for redacted restore logs, health logs,
  backup schedule artifacts, preservation artifacts, source DB files, backup
  files, and backup/restore directories. `scripts/collect-restore-evidence.mjs`
  and `scripts/create-restore-proof-draft.mjs` route local file and directory
  checks through `regularFileStat()` / `regularDirectoryStat()`, while
  `scripts/test-business-logic.mjs` guards the shared boundaries and rejects
  raw `existsSync(resolved)` / direct `statSync(resolved).isFile()` or
  `.isDirectory()` checks in those scripts. Verified with `node --check` for
  both restore evidence scripts and business test, `proof:restore:summary`,
  `proof:restore:strict:summary` (expected G8 missing-input blocker),
  `proof:drafts:summary`, `test:logic:summary`, `typecheck:summary`,
  `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local checks passed; 23 external/status
  blockers remain and external launch gates remain `0/14`. This did not read
  private env/RPC values, run a real restore drill, run production backup,
  send transactions, start live canary/soak, deploy, or change
  ABI/randomness/tokenomics/percentages.
- Host evidence collector and draft generator now share regular-file stat
  boundaries for redacted process, health, and load artifact inputs before
  reading logs or accepting proof paths. `scripts/collect-host-evidence.mjs`
  and `scripts/create-host-proof-draft.mjs` route artifact existence/type and
  size-gated log reads through `regularFileStat()`, and
  `scripts/test-business-logic.mjs` guards the boundary plus the ban on raw
  `existsSync(resolved)`/`statSync(resolved).isFile()` checks in those scripts.
  Verified with `node --check` for both host evidence scripts and business
  test, `proof:host:summary`, `proof:host-guard:summary`,
  `proof:drafts:summary`, `test:logic:summary`, `typecheck:summary`,
  `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local checks passed; 23 external/status
  blockers remain and external launch gates remain `0/14`. This did not read
  private env/RPC values, run production host/load collection, send
  transactions, start live canary/soak, deploy, or change
  ABI/randomness/tokenomics/percentages.
- Chain/indexer audit now uses a shared regular-file stat boundary for
  `LORE_DB_PATH` before opening the read-only SQLite audit DB.
  `scripts/audit-chain-indexer-window.mjs` routes the configured DB path
  through `regularFileStat()`, and `scripts/test-business-logic.mjs` guards
  the missing/directory DB boundary. Verified with `node --check` for the
  touched audit script and business test, `test:indexer-storage:summary`,
  `test:logic:summary`, `typecheck:summary`, `lint:summary`,
  `proof:autonomous:summary`, and `proof:prelaunch:summary`. Required local
  checks passed; 23 external/status blockers remain and external launch gates
  remain `0/14`. This did not read private env/RPC values, run the live
  chain/RPC audit, send transactions, start live canary/soak, deploy, or
  change ABI/randomness/tokenomics/percentages.
- SQLite backup and scope-audit libraries now share regular-file stat
  boundaries for source DB checks before opening SQLite handles.
  `scripts/sqlite-backup-lib.mjs` routes `createSqliteBackup()` source
  validation through `regularFileStat()`, and
  `scripts/sqlite-scope-audit-lib.mjs` applies the same boundary before
  read-only scope audits. `scripts/test-business-logic.mjs` guards both source
  boundaries. Verified with `node --check` for the SQLite libs and business
  test, `test:db-operations:summary`, `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local checks passed; 23 external/status
  blockers remain and external launch gates remain `0/14`. This did not read
  private env/RPC values, send transactions, start live canary/soak, deploy,
  run a production backup, or change ABI/randomness/tokenomics/percentages.
- Launch proof runner script-target checks now use a shared regular-file stat
  boundary before spawning child proof checks. `scripts/run-launch-proof.mjs`
  and `scripts/run-local-proof-preflight.mjs` route `scriptFileExists()`
  through `regularFileStat()`, preserving summary-only early exits and the
  expected strict launch blocker when the canary log is missing.
  `scripts/test-business-logic.mjs` guards both runner boundaries. Verified
  with `node --check` for the touched runners and business test,
  `proof:launch:summary`, `proof:launch:strict:summary` (expected missing
  canary-log blocker), `proof:local:summary`, `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local checks passed; 23 external/status
  blockers remain and external launch gates remain `0/14`. This did not read
  private env/RPC values, send transactions, start live canary/soak, deploy, or
  change ABI/randomness/tokenomics/percentages.
- Proof file guard now uses a shared regular-file stat boundary for proof JSON
  artifacts, final manifests, and canary JSONL checks before parsing or first
  record inspection. `scripts/check-proof-files.mjs` routes `fileExists()`,
  `readProofJsonFile()`, and canary log type/size checks through
  `regularFileStat()`, while preserving bounded first-line JSONL reads and
  redaction checks. `scripts/test-business-logic.mjs` guards the boundary.
  Verified with `node --check` for the proof file guard and business test,
  `proof:files:summary`, `test:logic:summary`, `typecheck:summary`,
  `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local checks passed; 23 external/status
  blockers remain and external launch gates remain `0/14`. This did not read
  private env/RPC values, send transactions, start live canary/soak, deploy, or
  change ABI/randomness/tokenomics/percentages.
- Launch gate and readiness summary verifiers now use shared regular-file stat
  boundaries for local proof artifact and checklist evidence path checks.
  `scripts/check-launch-gates.mjs`, `scripts/report-launch-remaining.mjs`, and
  `scripts/check-readiness-checklist.mjs` route manifest/readiness markdown
  reads plus local artifact presence checks through `regularFileStat()` before
  reading or accepting evidence. `scripts/test-business-logic.mjs` guards the
  new source boundary. Verified with `node --check` for the touched scripts,
  `proof:gates:structure`, `proof:remaining:summary`,
  `proof:readiness:summary`, `test:logic:summary`, `typecheck:summary`,
  `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local checks passed; 23 external/status
  blockers remain and external launch gates remain `0/14`. This did not read
  private env/RPC values, send transactions, start live canary/soak, deploy, or
  change ABI/randomness/tokenomics/percentages.
- Restore proof now uses a shared regular-file stat boundary for summary file
  presence, manifest size-gating, restore backup artifacts, and
  manifest-backed evidence artifacts. `scripts/verify-db-restore.mjs` backs
  `fmtSize()`, `fileExists()`, `localArtifactIsFile()`,
  `artifactBackedEvidenceText()`, `restoreDrill.backupArtifact`, and manifest
  JSON parsing with `regularFileStat()` before reading or copying local proof
  evidence. `scripts/test-business-logic.mjs` guards the boundary. Verified
  with `node --check` for restore proof and business test,
  `proof:restore:summary`, `proof:restore:strict:summary` (expected G8
  missing-input blocker), `test:logic:summary`, `typecheck:summary`,
  `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local checks passed; 23 external/status
  blockers remain and external launch gates remain `0/14`. This did not read
  private env/RPC values, send transactions, start live canary/soak, deploy, or
  change ABI/randomness/tokenomics/percentages.
- Live canary proof analysis now uses a shared regular-file stat boundary for
  manifest presence, manifest size-gating, and manifest-backed local artifacts.
  `scripts/analyze-live-canary-proof.mjs` keeps chunked JSONL parsing unchanged
  while `regularFileStat()` backs `isExistingFile()`,
  `findMissingLocalArtifactRefs()`, `artifactBackedEvidenceText()`, and
  `loadAndValidateManifest()` before reading local proof evidence.
  `scripts/test-business-logic.mjs` guards the boundary. Verified with
  `node --check` for the analyzer and business test,
  `proof:testnet:canary:summary`, `proof:testnet:canary:v10:summary`
  (expected strict missing-log blocker), `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local checks passed; 23 external/status
  blockers remain and external launch gates remain `0/14`. This did not read
  private env/RPC values, send transactions, start live canary/soak, deploy, or
  change ABI/randomness/tokenomics/percentages.
- Signoff, monitoring, QA, and indexer proof validators now share regular-file
  boundaries for compact manifest presence and local artifact references.
  `scripts/check-signoff-proof.mjs`, `scripts/check-monitoring-proof.mjs`, and
  `scripts/check-qa-proof.mjs` use `regularFileStat()` for
  `fileSummaryStatus()`, local artifact checks, and manifest size-gating before
  JSON parsing; `scripts/check-indexer-dry-run.mjs` now also uses the shared
  helper for local artifact references. `scripts/test-business-logic.mjs`
  guards these boundaries. Verified with `node --check` for the touched proof
  validators, `proof:signoff:summary`, `proof:monitoring:summary`,
  `proof:qa:summary`, `proof:indexer:summary`, `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local checks passed; 23 external/status
  blockers remain and external launch gates remain `0/14`. This did not read
  private env/RPC values, send transactions, start live canary/soak, deploy, or
  change ABI/randomness/tokenomics/percentages.
- Host proof summary and artifact validation now derive manifest presence and
  local artifact existence from a shared regular-file stat boundary.
  `scripts/check-host-proof.mjs` uses `regularFileStat()` for compact
  `fileSummaryStatus()`, local artifact references, and manifest size-gating,
  so directories or unreadable paths stay missing/not-a-file before JSON
  parsing. `scripts/test-business-logic.mjs` guards the boundary. Verified with
  `node --check` for the host proof and business test, `proof:host:summary`,
  `test:logic:summary`, `typecheck:summary`, `lint:summary`,
  `proof:autonomous:summary`, and `proof:prelaunch:summary`. Required local
  checks passed; 23 external/status blockers remain and external launch gates
  remain `0/14`. This did not read private env/RPC values, send transactions,
  start live canary/soak, deploy, or change ABI/randomness/tokenomics/
  percentages.
- Indexer dry-run proof now derives DB mtime and file presence from a shared
  regular-file stat boundary. `scripts/check-indexer-dry-run.mjs` uses
  `regularFileStat()` for both `fmtMtime()` and `fileExists()`, so summary
  presence checks and detailed mtime output only accept regular files and do
  not reuse a stale existence check. `scripts/test-business-logic.mjs` guards
  the boundary. Verified with `node --check` for the indexer proof and business
  test, `proof:indexer:summary`, `test:logic:summary`, `typecheck:summary`,
  `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local checks passed; 23 external/status
  blockers remain and external launch gates remain `0/14`. This did not read
  private env/RPC values, send transactions, start live canary/soak, deploy, or
  change ABI/randomness/tokenomics/percentages.
- V10 Linea gas/behavior benchmark now size-gates local compiler config,
  contract sources, Solidity imports, and the deployment-only prepared initcode
  before reading them. `scripts/benchmark-v10-linea-gas.ts` uses
  `readBoundedUtf8File()` with `MAX_BENCHMARK_SOURCE_BYTES`,
  `MAX_BENCHMARK_COMPILER_CONFIG_BYTES`, and `MAX_PREPARED_INITCODE_BYTES`,
  preserving existing bounded RPC response reads and read-only diagnostics.
  `scripts/test-business-logic.mjs` guards the benchmark boundary. Verified
  with `node --check` for the benchmark and business test,
  `bench:contract:v10:diagnostics:summary`, `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. External launch gates remain `0/14`; this did not
  read private env/RPC values, send transactions, start live canary/soak,
  deploy, or change ABI/randomness/tokenomics/percentages.
- V10 compiler-matrix benchmark now size-gates local contract sources and
  Solidity imports before reading them. `scripts/benchmark-contract-v10.mjs`
  uses `readBoundedUtf8File()` with
  `MAX_BENCHMARK_CONTRACT_SOURCE_BYTES`, preserving deterministic import lookup
  while failing closed on non-file or oversized local source inputs.
  `scripts/test-business-logic.mjs` guards the benchmark boundary. Verified
  with `node --check` for the benchmark and business test,
  `bench:contract:v10:compiler-matrix:summary`, `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. External launch gates remain `0/14`; this did not
  read private env/RPC values, send transactions, start live canary/soak,
  deploy, or change ABI/randomness/tokenomics/percentages.
- V10 deployed identity verifier now size-gates local source units, compiler
  config, generated Remix workspace sources, and the compilation manifest
  before reading them. `scripts/verify-v10-deployed.ts` uses
  `readBoundedUtf8File()` with `MAX_V10_SOURCE_UNIT_BYTES`,
  `MAX_V10_COMPILER_CONFIG_BYTES`, and
  `MAX_V10_COMPILATION_MANIFEST_BYTES`, preserving deterministic source-unit
  lookup while failing closed on non-file or oversized local inputs.
  `scripts/test-business-logic.mjs` guards the verifier boundary. Verified
  with `node --check` for the verifier and business test,
  `proof:contract-deployed:v10:offline:summary`,
  `proof:contract-deployed:v10:summary` (expected metadata-only mismatch
  external/status row), `test:logic:summary`, `typecheck:summary`,
  `lint:summary`, `proof:autonomous:summary`, and `proof:prelaunch:summary`.
  External launch gates remain `0/14`; this did not read private env/RPC
  values, send transactions, start live canary/soak, deploy, write verifier
  artifacts, or change ABI/randomness/tokenomics/percentages.
- V10 post-deploy canary planner now size-gates its local compilation manifest
  and optional public-address artifact before reading them. `scripts/plan-v10-
  postdeploy-canary.ts` uses `readBoundedUtf8File()` with
  `MAX_V10_COMPILATION_MANIFEST_BYTES` and
  `MAX_V10_PUBLIC_ADDRESS_FILE_BYTES`, preserving the read-only planner and
  summary output while rejecting directories or oversized local inputs before
  `readFileSync`. `scripts/test-business-logic.mjs` guards the boundary.
  Verified with `node --check` for the planner and business test,
  `plan:canary:v10:postdeploy:summary`, `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. External launch gates remain `0/14`; this did not
  read private env/RPC values, send transactions, start live canary/soak,
  deploy, or change ABI/randomness/tokenomics/percentages.
- Monitoring, QA, and canary proof draft generators now size-gate referenced
  side evidence artifacts before accepting them into draft manifests.
  `scripts/create-monitoring-proof-draft.mjs` uses
  `MAX_MONITORING_DRAFT_ARTIFACT_BYTES`, `scripts/create-qa-proof-draft.mjs`
  uses `MAX_QA_DRAFT_ARTIFACT_BYTES`, and
  `scripts/create-canary-proof-draft.mjs` uses
  `MAX_CANARY_DRAFT_SIDE_ARTIFACT_BYTES` for non-JSONL side artifacts. The
  canary live JSONL parser remains chunked and unchanged for long soak logs.
  `scripts/test-business-logic.mjs` guards these draft boundaries. Verified
  with `node --check` for the touched draft scripts and business test,
  `proof:drafts:summary`, `test:logic:summary`, `typecheck:summary`,
  `lint:summary`, and `proof:autonomous:summary`. External launch gates remain
  `0/14`; this did not read private env/RPC values, send transactions, start
  live canary/soak, deploy, or change ABI/randomness/tokenomics/percentages.
- Contract compilation provenance now size-gates local sources, compiler
  config, manifests, package lock, and Solidity imports before reading.
  `scripts/check-contract-compilation-provenance.mjs` uses
  `readBoundedUtf8File()` with limits for contract sources, compiler config,
  compilation manifests, and `package-lock.json`, preserving read-only summary
  mode and V9/V10 manifest comparison. `scripts/test-business-logic.mjs` guards
  the source boundary. Verified with
  `node --check scripts/check-contract-compilation-provenance.mjs`,
  `node --check scripts/test-business-logic.mjs`,
  `proof:contract-compile:summary`, `proof:contract-compile:v10:summary`,
  `test:logic:summary`, `typecheck:summary`, `lint:summary`, and
  `proof:autonomous:summary`. External launch gates remain `0/14`; this did
  not read private env/RPC values, send transactions, start live canary/soak,
  deploy, or change ABI/randomness/tokenomics/percentages.
- Security follow-up, CI security, and proof-template verifiers now size-gate
  their local inputs before reading. `scripts/check-security-followup.mjs` uses
  `MAX_SECURITY_FOLLOWUP_SOURCE_BYTES` for checked source/workflow files,
  `scripts/check-ci-security.mjs` uses `MAX_CI_WORKFLOW_BYTES` for the CI
  workflow, and `scripts/check-proof-templates.mjs` uses
  `MAX_PROOF_TEMPLATE_DOC_BYTES` for `docs/launch-proof-manifest-templates.md`.
  `scripts/test-business-logic.mjs` guards all three boundaries. Verified with
  `node --check` for the touched verifier scripts and business test,
  `proof:security-followup:summary`, `proof:ci-security:summary`,
  `proof:templates:summary`, `test:logic:summary`, `typecheck:summary`,
  `lint:summary`, and `proof:autonomous:summary`. External launch gates remain
  `0/14`; this did not read private env/RPC values, send transactions, start
  live canary/soak, deploy, or change ABI/randomness/tokenomics/percentages.
- Remaining-launch evidence summary now size-gates launch proof/status markdown
  before parsing. `scripts/report-launch-remaining.mjs` uses
  `MAX_REMAINING_LAUNCH_MARKDOWN_BYTES`, requires regular files for
  `docs/mainnet-proof-record.md` and `docs/mainnet-status-board.md`, and fails
  closed on oversized inputs before `readFileSync`. `scripts/test-business-
  logic.mjs` guards the boundary while preserving the compact next-gate
  worklist output. Verified with
  `node --check scripts/report-launch-remaining.mjs`,
  `node --check scripts/test-business-logic.mjs`,
  `proof:remaining:summary`, `test:logic:summary`, `typecheck:summary`,
  `lint:summary`, and `proof:autonomous:summary`. External launch gates remain
  `0/14`; this did not read private env/RPC values, send transactions, start
  live canary/soak, deploy, or change ABI/randomness/tokenomics/percentages.
- Readiness checklist and launch gate structure verifiers now size-gate their
  markdown inputs before parsing. `scripts/check-readiness-checklist.mjs` uses
  `MAX_READINESS_CHECKLIST_TEXT_BYTES` and requires the checklist path to be a
  small regular file, while `scripts/check-launch-gates.mjs` uses
  `MAX_LAUNCH_GATE_MARKDOWN_BYTES` for both `docs/mainnet-proof-record.md` and
  `docs/mainnet-status-board.md`. `scripts/test-business-logic.mjs` guards the
  updated directory rejection and size-gated markdown reads. Verified with
  `node --check scripts/check-readiness-checklist.mjs`,
  `node --check scripts/check-launch-gates.mjs`,
  `node --check scripts/test-business-logic.mjs`,
  `proof:readiness:summary`, `proof:gates:structure`,
  `test:logic:summary`, `typecheck:summary`, `lint:summary`, and
  `proof:autonomous:summary`. External launch gates remain `0/14`; this did
  not read private env/RPC values, send transactions, start live canary/soak,
  deploy, or change ABI/randomness/tokenomics/percentages.
- Launch documentation and evidence command-map verifiers now reject directory
  paths and oversized docs/package files before reading them. `scripts/check-
  launch-command-map.mjs` uses `MAX_LAUNCH_COMMAND_MAP_TEXT_BYTES` and
  `statSync(filePath)` to require small regular required files, while
  `scripts/check-launch-doc-command-syntax.mjs` uses
  `MAX_LAUNCH_DOC_TEXT_BYTES` for the same boundary across launch docs and
  `package.json`. `scripts/test-business-logic.mjs` guards both source
  boundaries, including the updated `const stats = statSync(filePath)` pattern.
  Verified with `node --check scripts/check-launch-command-map.mjs`,
  `node --check scripts/check-launch-doc-command-syntax.mjs`,
  `node --check scripts/test-business-logic.mjs`,
  `proof:launch-map:summary`, `proof:launch-docs:summary`,
  `test:logic:summary`, `typecheck:summary`, `lint:summary`, and
  `proof:autonomous:summary`. External launch gates remain `0/14`; this did
  not read private env/RPC values, send transactions, start live canary/soak,
  deploy, or change ABI/randomness/tokenomics/percentages.
- Runtime monitor bounded artifact readers now reject non-file paths before
  reading. `scripts/runtime-monitor-lib.mjs` requires regular files in
  `readBoundedTextTail()` and `readBoundedJsonFile()`, and
  `loadRuntimeIssueState()` ignores directory/non-file state paths the same way
  it ignores oversized or corrupt state. `scripts/test-runtime-monitor-
  drill.mjs` covers directory text/JSON/state inputs, and `scripts/test-
  business-logic.mjs` guards the source boundary. Verified with
  `node --check scripts/runtime-monitor-lib.mjs`,
  `node --check scripts/test-runtime-monitor-drill.mjs`,
  `node --check scripts/test-business-logic.mjs`, `test:monitoring:summary`,
  `test:logic:summary`, `typecheck:summary`, `lint:summary`, and
  `proof:autonomous:summary`. External launch gates remain `0/14`; this did
  not read private env/RPC values, send transactions, start live canary/soak,
  deploy, or change ABI/randomness/tokenomics/percentages.
- Process-model preflight now size-gates `package.json` before reading package
  scripts. `scripts/check-process-model.mjs` uses
  `MAX_PACKAGE_JSON_BYTES` and `statSync(packagePath)` to require a small
  regular package manifest before `readFileSync`/`JSON.parse`; unreadable,
  directory, or oversized package manifests fail closed into missing package
  script issues instead of trusting unbounded JSON. `scripts/test-business-
  logic.mjs` guards this source boundary. Verified with
  `node --check scripts/check-process-model.mjs`,
  `node --check scripts/test-business-logic.mjs`,
  `proof:process-model:summary`, `test:logic:summary`, `typecheck:summary`,
  `lint:summary`, and `proof:autonomous:summary`. External launch gates remain
  `0/14`; this did not read private env/RPC values, send transactions, start
  live canary/soak, deploy, or change ABI/randomness/tokenomics/percentages.
- Managed testnet soak status and lock JSON reads are now size-gated.
  `scripts/run-testnet-soak-supervisor.mjs` uses
  `MAX_SOAK_STATUS_JSON_BYTES`, `MAX_SOAK_LOCK_JSON_BYTES`, and bounded
  `readJson(path, maxBytes)` before parsing `status.json` or
  `supervisor.lock`. Status/stop paths treat oversized JSON as unreadable, and
  startup fails closed on an oversized lock before stale-lock cleanup, avoiding
  duplicate managed supervisors over suspicious lock state. `scripts/test-
  business-logic.mjs` guards the source boundary and covers oversized status
  and lock summary-mode fixtures. Verified with
  `node --check scripts/run-testnet-soak-supervisor.mjs`,
  `node --check scripts/test-business-logic.mjs`,
  `soak:testnet:status:compact`, `test:logic:summary`, `typecheck:summary`,
  `lint:summary`, and `proof:autonomous:summary`. External launch gates remain
  `0/14`; this did not read private env/RPC values, send transactions, start
  live canary/soak, deploy, or change ABI/randomness/tokenomics/percentages.
- Proof draft regression JSON self-test artifacts are now size-gated before
  parsing. `scripts/check-proof-drafts.mjs` uses
  `MAX_PROOF_DRAFT_JSON_BYTES` and `readProofDraftJson()` for generated
  sign-off, host, indexer, and collector draft JSON artifacts, rejecting
  oversized or non-file artifacts before `readFileSync`/`JSON.parse` and
  surfacing oversized collector output as its own issue. `scripts/test-business-
  logic.mjs` guards this source boundary. Verified with
  `node --check scripts/check-proof-drafts.mjs`,
  `node --check scripts/test-business-logic.mjs`, `proof:drafts:summary`,
  `test:logic:summary`, `typecheck:summary`, `lint:summary`, and
  `proof:autonomous:summary`. External launch gates remain `0/14`; this did
  not read private env/RPC values, send transactions, start live canary/soak,
  deploy, or change ABI/randomness/tokenomics/percentages.
- Proof collector redaction cleanup is now bounded before reading the synthetic
  final-reject output. `scripts/check-proof-collector-redaction.mjs` uses
  `MAX_REJECT_OUT_CLEANUP_BYTES` and `statSync(finalRejectOutPath)` so cleanup
  only reads and removes a small regular `docs/collector-redaction-proof.json`
  containing the expected synthetic host markers; oversized files and
  directories are left unread and untouched. `scripts/test-business-logic.mjs`
  guards this source boundary. Verified with
  `node --check scripts/check-proof-collector-redaction.mjs`,
  `node --check scripts/test-business-logic.mjs`,
  `proof:collector-redaction:summary`, `test:logic:summary`,
  `typecheck:summary`, and `proof:autonomous:summary`. External launch gates
  remain `0/14`; this did not read private env/RPC values, send transactions,
  start live canary/soak, deploy, or change ABI/randomness/tokenomics/
  percentages.
- Proof-file guard auxiliary and final JSON artifacts are now size-gated before
  parsing. `scripts/check-proof-files.mjs` uses
  `MAX_PROOF_FILE_JSON_BYTES` and `readProofJsonFile()` to reject oversized
  auxiliary proof artifacts and final proof manifests before
  `readFileSync`/`JSON.parse`, while preserving existing missing,
  directory, invalid-JSON, template, secret-like, unsafe diagnostic, and strict
  validator behavior. `scripts/test-business-logic.mjs` guards this source
  boundary. Verified with `node --check scripts/check-proof-files.mjs`,
  `node --check scripts/test-business-logic.mjs`, `proof:files:summary`,
  `test:logic:summary`, `typecheck:summary`, `lint:summary`,
  `proof:autonomous:summary`, `proof:prelaunch:summary`, and
  `git diff --check` for the touched scripts. Required local prelaunch checks
  passed; 23 external/status blockers and launch gates `0/14` remain explicit.
  This is local proof-file guard hardening only; it did not read private
  env/RPC values, send transactions, start live canary/soak, deploy, or change
  ABI/randomness/tokenomics/percentages.
- Sign-off, monitoring, QA, and canary proof manifests are now size-gated
  before JSON parsing. `scripts/check-signoff-proof.mjs`,
  `scripts/check-monitoring-proof.mjs`, `scripts/check-qa-proof.mjs`, and
  `scripts/analyze-live-canary-proof.mjs` reject oversized manifest JSON
  through `MAX_SIGNOFF_PROOF_MANIFEST_BYTES`,
  `MAX_MONITORING_PROOF_MANIFEST_BYTES`, `MAX_QA_PROOF_MANIFEST_BYTES`, and
  `MAX_CANARY_PROOF_MANIFEST_BYTES` before `readFileSync`/`JSON.parse`,
  preserving existing missing/directory/invalid-JSON blockers while preventing
  oversized proof manifests from being read wholesale. `scripts/test-business-
  logic.mjs` guards these source boundaries. Verified with `node --check` for
  the touched scripts, `proof:signoff:summary`,
  `proof:signoff:strict:summary`, `proof:monitoring:summary`,
  `proof:monitoring:strict:summary`, `proof:qa:summary`,
  `proof:qa:strict:summary`, `proof:testnet:canary:summary`,
  `proof:testnet:canary:v10:summary` (expected fail-closed blockers for
  missing sign-off, monitoring, and QA manifests plus missing live canary log),
  `test:logic:summary`, `typecheck:summary`, `lint:summary`,
  `proof:autonomous:summary`, and `proof:prelaunch:summary`. Required local
  prelaunch checks passed; 23 external/status blockers and launch gates `0/14`
  remain explicit. This is local sign-off/monitoring/QA/canary proof manifest
  hardening only; it did not read private env/RPC values, send transactions,
  start live canary/soak, deploy, or change ABI/randomness/tokenomics/
  percentages.
- Host, indexer, and restore proof manifests are now size-gated before JSON
  parsing. `scripts/check-host-proof.mjs`, `scripts/check-indexer-dry-run.mjs`,
  and `scripts/verify-db-restore.mjs` reject oversized manifest JSON through
  `MAX_HOST_PROOF_MANIFEST_BYTES`, `MAX_INDEXER_PROOF_MANIFEST_BYTES`, and
  `MAX_RESTORE_PROOF_MANIFEST_BYTES` before `readFileSync`/`JSON.parse`,
  preserving the existing missing/directory/invalid-JSON blockers while
  preventing oversized proof manifests from being read wholesale.
  `scripts/test-business-logic.mjs` guards these source boundaries. Verified
  with `node --check` for the touched scripts, `proof:host:summary`,
  `proof:host:strict:summary`, `proof:indexer:summary`,
  `proof:indexer:strict:summary`, `proof:restore:summary`,
  `proof:restore:strict:summary` (expected fail-closed blockers for missing
  host manifest, DB/env/indexer manifest, and restore source/backup/manifest),
  `test:logic:summary`, `typecheck:summary`, `lint:summary`,
  `proof:autonomous:summary`, and `proof:prelaunch:summary`. Required local
  prelaunch checks passed; 23 external/status blockers and launch gates `0/14`
  remain explicit. This is local host/indexer/restore proof manifest hardening
  only; it did not read private env/RPC values, send transactions, start live
  canary/soak, deploy, or change ABI/randomness/tokenomics/percentages.
- Host, indexer, and restore proof manifest-backed evidence snippets are now
  bounded before reading local artifacts. `scripts/check-host-proof.mjs`,
  `scripts/check-indexer-dry-run.mjs`, and `scripts/verify-db-restore.mjs`
  use `MAX_HOST_ARTIFACT_TEXT_BYTES`, `MAX_INDEXER_ARTIFACT_TEXT_BYTES`, and
  `MAX_RESTORE_ARTIFACT_TEXT_BYTES` with `readBoundedArtifactText()` helpers
  based on `openSync`/`readSync`/`closeSync`, preserving G5/G6 host, G7
  indexer, and G8 restore proof validation while avoiding
  `readFileSync(...).slice(...)` whole-file reads. `scripts/test-business-
  logic.mjs` guards these source boundaries. Verified with `node --check` for
  the touched scripts, `proof:host:summary`, `proof:host:strict:summary`,
  `proof:indexer:summary`, `proof:indexer:strict:summary`,
  `proof:restore:summary`, `proof:restore:strict:summary` (expected
  fail-closed blockers for missing host manifest, DB/env/indexer manifest, and
  restore source/backup/manifest), `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local prelaunch checks passed; 23
  external/status blockers and launch gates `0/14` remain explicit. This is
  local host/indexer/restore proof evidence tooling hardening only; it did not
  read private env/RPC values, send transactions, start live canary/soak,
  deploy, or change ABI/randomness/tokenomics/percentages.
- Sign-off proof manifest-backed evidence snippets are now bounded before
  reading local artifacts. `scripts/check-signoff-proof.mjs` uses
  `MAX_SIGNOFF_ARTIFACT_TEXT_BYTES` and `readBoundedArtifactText()` with
  `openSync`/`readSync`/`closeSync` for contract-env, ownership, randomness,
  and chain-comparison evidence files, preserving G1-G4 proof validation while
  avoiding `readFileSync(...).slice(...)` whole-file reads.
  `scripts/test-business-logic.mjs` guards this source boundary. Verified with
  `node --check` for the touched scripts, `proof:signoff:summary`,
  `proof:signoff:strict:summary` (expected fail-closed: missing sign-off
  manifest), `test:logic:summary`, `typecheck:summary`, `lint:summary`,
  `proof:autonomous:summary`, and `proof:prelaunch:summary`. Required local
  prelaunch checks passed; 23 external/status blockers and launch gates `0/14`
  remain explicit. This is local sign-off proof evidence tooling hardening
  only; it did not read private env/RPC values, send transactions, start live
  canary/soak, deploy, or change ABI/randomness/tokenomics/percentages.
- Canary proof manifest-backed evidence snippets are now bounded before reading
  local side artifacts. `scripts/analyze-live-canary-proof.mjs` uses
  `MAX_CANARY_ARTIFACT_TEXT_BYTES` and `readBoundedArtifactText()` with
  `openSync`/`readSync`/`closeSync` for target-network, recovery,
  Auto-Miner-session, and transaction-health evidence files, preserving
  G10/G11 proof validation while avoiding `readFileSync(...).slice(...)`
  whole-file reads. The live JSONL parser remains chunked and unchanged.
  `scripts/test-business-logic.mjs` guards this source boundary. Verified with
  `node --check` for the touched scripts, `proof:testnet:canary:summary`,
  `proof:testnet:canary:v10:summary` (expected fail-closed: missing live
  canary log), `test:logic:summary`, `typecheck:summary`, `lint:summary`,
  `proof:autonomous:summary`, and `proof:prelaunch:summary`. Required local
  prelaunch checks passed; 23 external/status blockers and launch gates `0/14`
  remain explicit. This is local canary proof evidence tooling hardening only;
  it did not read private env/RPC values, send transactions, start live
  canary/soak, deploy, or change ABI/randomness/tokenomics/percentages.
- QA proof artifact-backed evidence snippets are now bounded before reading
  local artifacts. `scripts/check-qa-proof.mjs` uses
  `MAX_QA_ARTIFACT_TEXT_BYTES` and `readBoundedArtifactText()` with
  `openSync`/`readSync`/`closeSync` for wallet, UX, browser, mobile, and
  clean-wallet receipt evidence files, preserving G12-G14 proof validation
  while avoiding `readFileSync(...).slice(...)` whole-file reads.
  `scripts/test-business-logic.mjs` guards this source boundary. Verified with
  `node --check` for the touched scripts, `proof:qa:summary`,
  `proof:qa:strict:summary` (expected fail-closed: missing QA manifest),
  `proof:drafts:summary`, `test:logic:summary`, `typecheck:summary`,
  `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local prelaunch checks passed; 23
  external/status blockers and launch gates `0/14` remain explicit. This is
  local QA proof evidence tooling hardening only; it did not read private
  env/RPC values, send transactions, start live canary/soak, deploy, or change
  ABI/randomness/tokenomics/percentages.
- Monitoring proof artifact-backed evidence snippets are now bounded before
  reading local artifacts. `scripts/check-monitoring-proof.mjs` uses
  `MAX_MONITORING_ARTIFACT_TEXT_BYTES` and `readBoundedArtifactText()` with
  `openSync`/`readSync`/`closeSync` for local monitoring evidence files,
  preserving alert/recovery/email/error-tracking proof validation while
  avoiding `readFileSync(...).slice(...)` whole-file reads. `scripts/test-
  business-logic.mjs` guards this source boundary. Verified with
  `node --check` for the touched scripts, `proof:monitoring:summary`,
  `proof:monitoring:strict:summary` (expected fail-closed: missing monitoring
  manifest), `proof:drafts:summary`, `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local prelaunch checks passed; 23
  external/status blockers and launch gates `0/14` remain explicit. This is
  local monitoring proof evidence tooling hardening only; it did not read
  private env/RPC values, send transactions, start live canary/soak, deploy,
  or change ABI/randomness/tokenomics/percentages.
- Host and restore collector/draft evidence log reads are now size-gated
  before loading local artifacts. `scripts/collect-host-evidence.mjs`,
  `scripts/create-host-proof-draft.mjs`, `scripts/collect-restore-evidence.mjs`,
  and `scripts/create-restore-proof-draft.mjs` reject missing, directory, and
  oversized health/load/restore log inputs through `MAX_HOST_EVIDENCE_BYTES`
  and `MAX_RESTORE_EVIDENCE_BYTES` before `readFileSync`, preserving host
  health/load and restore health validation while preventing oversized evidence
  logs from being accepted or read wholesale. `scripts/test-business-
  logic.mjs` guards host and restore collector/draft paths. Verified with
  `node --check` for the touched scripts, `proof:drafts:summary`,
  `proof:host:summary`, `proof:host:strict:summary` (expected fail-closed:
  missing host manifest), `proof:restore:summary`,
  `proof:restore:strict:summary` (expected fail-closed: missing source/backup/
  manifest), `test:logic:summary`, `typecheck:summary`, `lint:summary`,
  `proof:autonomous:summary`, and `proof:prelaunch:summary`. Required local
  prelaunch checks passed; 23 external/status blockers and launch gates
  `0/14` remain explicit. This is local host/restore proof evidence tooling
  hardening only; it did not read private env/RPC values, send transactions,
  start live canary/soak, deploy, or change ABI/randomness/tokenomics/
  percentages.
- Indexer collector/draft evidence artifact reads are now size-gated before
  loading local logs or JSON snapshots. `scripts/collect-indexer-evidence.mjs`
  and `scripts/create-indexer-proof-draft.mjs` reject missing, directory, and
  oversized `indexer-log`/`health-log`/`chain-snapshot` inputs through
  `MAX_INDEXER_EVIDENCE_BYTES` before `readFileSync` or `JSON.parse`,
  preserving fresh DB, finality, production health base, and direct chain
  comparison requirements while preventing oversized indexer evidence
  artifacts from being accepted or read wholesale. `scripts/test-business-
  logic.mjs` guards collector and draft paths. Verified with `node --check` for
  the touched scripts, `proof:drafts:summary`, `proof:indexer:summary`,
  `proof:indexer:strict:summary` (expected fail-closed: missing DB/env/
  manifest), `test:logic:summary`, `typecheck:summary`, `lint:summary`,
  `proof:autonomous:summary`, and `proof:prelaunch:summary`. Required local
  prelaunch checks passed; 23 external/status blockers and launch gates
  `0/14` remain explicit. This is local indexer-proof evidence tooling
  hardening only; it did not read private env/RPC values, send transactions,
  start live canary/soak, deploy, or change ABI/randomness/tokenomics/
  percentages.
- Sign-off collector/draft evidence log reads are now size-gated before
  loading local artifacts. `scripts/collect-signoff-evidence.mjs` and
  `scripts/create-signoff-proof-draft.mjs` reject missing, directory, and
  oversized `env-log`/`chain-log` inputs through `MAX_SIGNOFF_LOG_BYTES` before
  `readFileSync`, preserving successful `proof:mainnet` summary and direct
  chain-comparison requirements while preventing oversized sign-off evidence
  logs from being accepted or read wholesale. `scripts/test-business-
  logic.mjs` guards both paths. Verified with `node --check` for the touched
  scripts, `proof:drafts:summary`, `proof:signoff:summary`,
  `proof:signoff:strict:summary` (expected fail-closed: missing sign-off
  manifest), `test:logic:summary`, `typecheck:summary`, `lint:summary`,
  `proof:autonomous:summary`, and `proof:prelaunch:summary`. Required local
  prelaunch checks passed; 23 external/status blockers and launch gates
  `0/14` remain explicit. This is local sign-off proof evidence tooling
  hardening only; it did not read private env/RPC values, send transactions,
  start live canary/soak, deploy, or change ABI/randomness/tokenomics/
  percentages.
- Sign-off proof integer parsing now rejects oversized numeric strings before
  conversion. `scripts/check-signoff-proof.mjs` uses bounded canonical
  positive and non-negative integer regexes before `Number(...)` for
  deploy/finality block and checked-epoch evidence, keeping final sign-off
  manifests fail-closed on unsafe proof numbers. `scripts/test-business-
  logic.mjs` guards the bounded parser shape. Verified with `node --check` for
  the touched scripts, `proof:signoff:summary`,
  `proof:signoff:strict:summary` (expected fail-closed: missing sign-off
  manifest), `test:logic:summary`, `typecheck:summary`, `lint:summary`,
  `proof:autonomous:summary`, and `proof:prelaunch:summary`. Required local
  prelaunch checks passed; 23 external/status blockers and launch gates
  `0/14` remain explicit. This is local sign-off proof validation hardening
  only; it did not read private env/RPC values, send transactions, start live
  canary/soak, deploy, or change ABI/randomness/tokenomics/percentages.
- Indexer evidence collector/draft health key-value parsing is now capped
  before draft evidence can be written. `scripts/collect-indexer-evidence.mjs`
  and `scripts/create-indexer-proof-draft.mjs` route health summary parsing
  through `MAX_KEY_VALUE_MARKERS`, preserving canonical
  `base=... finalityLagBlocks=...` validation while failing closed on
  oversized key/value evidence instead of using `line.matchAll`.
  `scripts/test-business-logic.mjs` guards both indexer draft paths. Verified
  with `node --check` for the touched scripts, `proof:drafts:summary`,
  `proof:indexer:summary`, `proof:indexer:strict:summary` (expected
  fail-closed: missing DB/env/manifest), `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local prelaunch checks passed; 23
  external/status blockers and launch gates `0/14` remain explicit. This is
  local indexer-proof evidence tooling hardening only; it did not read private
  env/RPC values, send transactions, start live canary/soak, deploy, or change
  ABI/randomness/tokenomics/percentages.
- Host evidence collector/draft health key-value parsing is now capped before
  draft evidence can be written. `scripts/collect-host-evidence.mjs` and
  `scripts/create-host-proof-draft.mjs` route health summary parsing through
  `MAX_KEY_VALUE_MARKERS`, preserving canonical
  `base=... runtime=... dataSync=... finalityLagBlocks=...` validation while
  failing closed on oversized key/value evidence instead of using
  `line.matchAll`. `scripts/test-business-logic.mjs` guards both host draft
  paths. Verified with `node --check` for the touched scripts,
  `proof:drafts:summary`, `test:logic:summary`, `typecheck:summary`,
  `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local prelaunch checks passed; 23
  external/status blockers and launch gates `0/14` remain explicit. This is
  local host-proof evidence tooling hardening only; it did not read private
  env/RPC values, send transactions, start live canary/soak, deploy, or change
  ABI/randomness/tokenomics/percentages.
- Restore evidence collector/draft health key-value parsing is now capped
  before draft evidence can be written. `scripts/collect-restore-evidence.mjs`
  and `scripts/create-restore-proof-draft.mjs` route restored health summary
  parsing through `MAX_KEY_VALUE_MARKERS`, preserving canonical
  `base=... runtime=... dataSync=... finalityLagBlocks=...` validation while
  failing closed on oversized key/value evidence instead of using
  `line.matchAll`. `scripts/test-business-logic.mjs` guards both draft paths.
  Verified with `node --check` for the touched scripts,
  `proof:drafts:summary`, `test:logic:summary`, `typecheck:summary`,
  `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local prelaunch checks passed; 23
  external/status blockers and launch gates `0/14` remain explicit. This is
  local restore-proof evidence tooling hardening only; it did not read private
  env/RPC values, send transactions, start live canary/soak, deploy, or change
  ABI/randomness/tokenomics/percentages.
- Restore proof health-origin evidence scanning is now capped before accepting
  restored health proof. `scripts/verify-db-restore.mjs` routes
  `healthEvidenceBaseMatches` through a bounded `base=` marker scan with
  `MAX_HEALTH_BASE_MARKERS`, preserving exact restored-origin validation while
  avoiding `[...text.matchAll(...)]` allocation on oversized restore health
  evidence. `scripts/test-business-logic.mjs` guards this verifier boundary.
  Verified with `node --check` for the touched scripts,
  `proof:restore:summary`, `proof:restore:strict:summary` (expected
  fail-closed: missing source/backup/manifest), `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local prelaunch checks passed; 23
  external/status blockers and launch gates `0/14` remain explicit. This is
  local restore-proof verifier hardening only; it did not read private env/RPC
  values, send transactions, start live canary/soak, deploy, or change ABI/
  randomness/tokenomics/percentages.
- Launch-doc command verifier package-script reference scanning is now capped.
  `scripts/check-launch-doc-command-syntax.mjs` replaces `text.matchAll` for
  `npm.cmd run ...` references with `scanMissingPackageScripts` and
  `MAX_DOC_PACKAGE_SCRIPT_REFS`, preserving missing-script validation while
  failing closed when a launch doc contains too many package-script references
  to validate safely. `scripts/test-business-logic.mjs` guards this boundary.
  Verified with `node --check` for the touched scripts,
  `proof:launch-docs:summary`, `test:logic:summary`, `typecheck:summary`,
  `lint:summary`, `proof:autonomous:summary`, and `proof:prelaunch:summary`.
  Required local prelaunch checks passed; 23 external/status blockers and
  launch gates `0/14` remain explicit. This is local launch-document verifier
  hardening only; it did not read private env/RPC values, send transactions,
  start live canary/soak, deploy, or change ABI/randomness/tokenomics/
  percentages.
- Readiness checklist local evidence path scanning is now capped before checked
  items can satisfy launch-readiness proof. `scripts/check-readiness-
  checklist.mjs` routes `docs/` and `data/` evidence references through
  `localEvidencePathScan` with `MAX_LOCAL_EVIDENCE_PATHS`; oversized checked
  lines now fail closed with an explicit evidence issue instead of spreading an
  unbounded `matchAll` result into an array. `scripts/test-business-logic.mjs`
  guards this verifier boundary. Verified with `node --check` for the touched
  scripts, `proof:readiness:summary`, `test:logic:summary`, and
  `lint:summary`, plus `typecheck:summary`, `proof:prelaunch:summary`, and
  `proof:autonomous:summary`. Required local prelaunch checks passed; 23
  external/status blockers and launch gates `0/14` remain explicit. This is
  local readiness-proof verifier hardening only; it did not read private
  env/RPC values, send transactions, start live canary/soak, deploy, or change
  ABI/randomness/tokenomics/percentages.
- QA proof mobile viewport evidence scanning is now capped before accepting
  mobile-layout proof. `scripts/check-qa-proof.mjs` limits
  `hasMobileViewportProofText` to `MAX_VIEWPORT_MARKERS`, preserving the same
  canonical viewport dimension and mobile portrait/landscape requirements
  while preventing oversized QA evidence text from driving unbounded viewport
  marker scans. `scripts/test-business-logic.mjs` guards this verifier
  boundary. Verified with `node --check` for the touched scripts,
  `proof:qa:summary`, `proof:qa:strict:summary` (expected fail-closed:
  missing QA proof manifest), `test:logic:summary`, `typecheck:summary`, and
  `lint:summary`, and `proof:autonomous:summary`.
  This is local QA proof verifier hardening only; it did not read private
  env/RPC values, send transactions, start live canary/soak, deploy, or change
  ABI/randomness/tokenomics/percentages. External QA gates G12-G14 still
  require real wallet, UX, browser, and mobile QA evidence.
- Indexer proof verifier local health artifact scanning now avoids
  materializing match arrays from evidence text. `scripts/check-indexer-
  dry-run.mjs` scans `base=` markers in `textHasProductionBaseAndSafeFinality`
  with a bounded `exec` loop before canonical `finalityLagBlocks` parsing,
  preserving the same production-origin and finality requirements while
  avoiding `[...content.matchAll(...)]` allocation on local artifact snippets.
  `scripts/test-business-logic.mjs` guards the verifier against returning to
  `matchAll` array materialization for local health evidence. Verified with
  `node --check` for the touched scripts, `proof:indexer:summary`,
  `proof:indexer:strict:summary` (expected fail-closed: missing DB/env/
  manifest), `test:logic:summary`, `typecheck:summary`, `lint:summary`, and
  `proof:autonomous:summary`. This is local indexer-proof verifier hardening
  only; it did not read private env/RPC values, send transactions, start live
  canary/soak, deploy, or change ABI/randomness/tokenomics/percentages.
  External indexer gate G7 still requires real fresh DB, configured deploy
  block/finality, chain snapshot, and direct chain comparison evidence.
- Launch-gate canary log path extraction is now capped and avoids
  materializing match arrays from proof evidence text.
  `scripts/check-launch-gates.mjs` and `scripts/report-launch-remaining.mjs`
  route `data/live-test-runs/*.jsonl` extraction through
  `findLiveCanaryLogPaths` with `MAX_CANARY_LOG_PATHS`, preserving the same
  gate/reference checks while avoiding `[...matchAll(...)]` allocation on
  large proof-record evidence fields. `scripts/test-business-logic.mjs` guards
  both launch-gate scripts against returning to unbounded canary-log path
  extraction. Verified with `node --check` for the touched scripts,
  `proof:remaining:summary`, `proof:gates:structure`, `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, and `proof:autonomous:summary`. This is
  local launch-proof verifier hardening only; it did not read private env/RPC
  values, send transactions, start live canary/soak, deploy, or change ABI/
  randomness/tokenomics/percentages. External canary gates G10/G11 still
  require real live-canary JSONL evidence.
- Host proof verifier evidence scanning now avoids materializing match arrays
  from operator-provided host evidence text or local artifact snippets.
  `scripts/check-host-proof.mjs` scans health base URLs, load-test base URLs,
  and external rate-limit replica identity markers with bounded `exec` loops
  and early exits instead of `[...text.matchAll(...)]` arrays, preserving the
  same origin/finality/load/replica requirements while reducing proof verifier
  memory risk on large evidence artifacts. `scripts/test-business-logic.mjs`
  guards the host verifier against returning to `matchAll` array
  materialization for these evidence paths. Verified with `node --check` for
  the touched scripts, `proof:host:summary`, `proof:host:strict:summary`
  (expected fail-closed: host proof manifest is missing), `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, and `proof:autonomous:summary`. This is
  local host-proof verifier hardening only; it did not read private env/RPC
  values, send transactions, start live canary/soak, deploy, or change ABI/
  randomness/tokenomics/percentages. External host gates G5/G6 still require a
  real deployed HTTPS host/process/health/load/two-replica manifest.
- V10 identity summary numeric counters now reject negative safe integers before
  emitting operator proof JSON. `scripts/run-v10-offline-identity-summary.mjs`
  and `scripts/run-v10-deployed-summary.mjs` route runtime-byte,
  executable-runtime-byte, immutable-reference, and deployed chain/runtime
  counters through `nonNegativeInteger`, preserving the existing read-only
  identity checks while avoiding negative counter evidence in compact
  summaries. `scripts/test-business-logic.mjs` guards both wrappers against
  returning to raw `Number.isSafeInteger(value) ? value : 0` style proof
  counters. Verified with `node --check` for the touched scripts,
  `proof:contract-deployed:v10:offline:summary`,
  `proof:contract-deployed:v10:summary` (expected read-only fail:
  `metadataOnlyMismatch=true`, `transactionSent=false`), `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, and `proof:autonomous:summary`. This is
  local/read-only contract proof wrapper hardening only; it did not read
  private env/RPC values, send transactions, start live canary/soak, deploy,
  or change ABI/randomness/tokenomics/percentages.
- Contract identity summary assertion-failure counting is now bounded and does
  not materialize match arrays from redacted local/read-only contract proof
  output. `scripts/run-contract-v9-summary.mjs`,
  `scripts/run-v10-offline-identity-summary.mjs`, and
  `scripts/run-v10-deployed-summary.mjs` route `AssertionError` counting
  through capped `countAssertionFailures` helpers, preserving compact V9
  invariant, V10 offline identity, and V10 deployed read-only identity JSON
  summaries while avoiding `[...output.matchAll(...)]` allocation. `scripts/
  test-business-logic.mjs` guards these wrappers against returning to
  unbounded `matchAll` array materialization and keeps the V10 deployed wrapper
  out of `--fresh`, wallet, artifact-writing, or transaction paths. Verified
  with `node --check` for the touched scripts, `test:contract:summary`,
  `proof:contract-deployed:v10:offline:summary`,
  `proof:contract-deployed:v10:summary` (expected read-only fail:
  `metadataOnlyMismatch=true`, `transactionSent=false`), `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, and `proof:autonomous:summary`. This is
  local/read-only contract proof wrapper hardening only; it did not read
  private env/RPC values, send transactions, start live canary/soak, deploy,
  or change ABI/randomness/tokenomics/percentages.
- Typecheck summary TS error/code counting is now bounded and does not
  materialize match arrays from redacted TypeScript output.
  `scripts/run-typecheck-summary.mjs` routes `error TS####` scanning through
  `summarizeTypeScriptErrors`, capping total error count and collected code
  IDs while avoiding `[...output.matchAll(...)]` allocation. `scripts/test-
  business-logic.mjs` guards the wrapper against returning to unbounded
  `matchAll` array materialization. Verified with `node --check` for the
  touched scripts, `typecheck:summary`, `test:logic:summary`, `lint:summary`,
  and `proof:autonomous:summary`. This is local proof wrapper hardening only;
  it did not read private env/RPC values, send transactions, start live
  canary/soak, deploy, or change ABI/randomness/tokenomics/percentages.
- Monitoring/fetch/stored-number summary assertion-failure counting is now
  bounded and does not materialize match arrays from redacted local test
  output. `scripts/run-monitoring-drill-summary.mjs`,
  `scripts/run-fetch-timeout-summary.mjs`, and
  `scripts/run-stored-number-parsing-summary.mjs` route `AssertionError`
  counting through capped `countAssertionFailures` helpers, preserving compact
  JSON summaries while avoiding `[...output.matchAll(...)]` allocation.
  `scripts/test-business-logic.mjs` guards these wrappers against returning to
  unbounded `matchAll` array materialization. Verified with `node --check` for
  the touched scripts, `test:monitoring:summary`,
  `test:fetch-timeout:summary`, `test:stored-number-parsing:summary`,
  `test:logic:summary`, `typecheck:summary`, `lint:summary`, and
  `proof:autonomous:summary`. This is local proof wrapper hardening only; it
  did not read private env/RPC values, send transactions, start live
  canary/soak, deploy, or change ABI/randomness/tokenomics/percentages.
  External monitoring/QA gates still require real configured host, alert,
  backup, canary, and wallet/mobile evidence.
- DB operations summary assertion-failure counting is now bounded and does not
  materialize match arrays from redacted SQLite backup/restore drill output.
  `scripts/run-db-operations-summary.mjs` routes `AssertionError` counting
  through `countAssertionFailures` with `MAX_ASSERTION_FAILURE_COUNT`,
  preserving the existing compact backup, retention, scope-audit, restore, and
  fault counters while avoiding `[...output.matchAll(...)]` allocation.
  `scripts/test-business-logic.mjs` guards the wrapper against returning to
  unbounded `matchAll` array materialization. Verified with `node --check` for
  the touched scripts, `test:db-operations:summary`, `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, and `proof:autonomous:summary`. This
  is local SQLite backup/restore proof wrapper hardening only; it did not read
  private env/RPC values, send transactions, start live canary/soak, deploy,
  or change ABI/randomness/tokenomics/percentages. External backup/restore
  gates still require real configured source DB, backup path, schedule, and
  restore evidence.
- Indexer/storage summary assertion-failure counting is now bounded and does
  not materialize match arrays from redacted event-storage output.
  `scripts/run-indexer-storage-summary.mjs` routes `AssertionError` counting
  through `countAssertionFailures` with `MAX_ASSERTION_FAILURE_COUNT`,
  preserving the existing compact ABI/event/storage compatibility counters
  while avoiding `[...output.matchAll(...)]` allocation. `scripts/test-
  business-logic.mjs` guards the wrapper against returning to unbounded
  `matchAll` array materialization. Verified with `node --check` for the
  touched scripts, `test:indexer-storage:summary`, `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, and `proof:autonomous:summary`. This
  is local ABI/indexer/storage proof wrapper hardening only; it did not read
  private env/RPC values, send transactions, start live canary/soak, deploy,
  or change ABI/randomness/tokenomics/percentages. External indexer gate G7
  still requires real configured DB/finality evidence.
- V10 contract summary assertion-failure counting is now bounded and does not
  materialize match arrays from redacted invariant output. `scripts/run-
  contract-v10-summary.mjs` routes `AssertionError` counting through
  `countAssertionFailures` with `MAX_ASSERTION_FAILURE_COUNT`, preserving the
  existing compact V10 invariant counters while avoiding
  `[...output.matchAll(...)]` allocation. `scripts/test-business-logic.mjs`
  guards the wrapper against returning to unbounded `matchAll` array
  materialization. Verified with `node --check` for the touched scripts,
  `test:contract:v10:summary`, `test:logic:summary`, `typecheck:summary`,
  `lint:summary`, and `proof:autonomous:summary`. This is local V10
  test/proof wrapper hardening only; it did not read private env/RPC values,
  send transactions, start live canary/soak, deploy, or change ABI/randomness/
  tokenomics/percentages.
- Business-logic summary assertion-failure counting is now bounded and does not
  materialize match arrays from redacted test output. `scripts/run-business-
  logic-summary.mjs` routes `AssertionError` counting through
  `countAssertionFailures` with `MAX_ASSERTION_FAILURE_COUNT`, preserving the
  existing compact pass/warning/failure JSON while avoiding
  `[...output.matchAll(...)]` allocation. `scripts/test-business-logic.mjs`
  guards the wrapper against returning to unbounded `matchAll` array
  materialization. Verified with `node --check` for the touched scripts,
  `test:logic:summary`, `typecheck:summary`, `lint:summary`, and
  `proof:autonomous:summary`. This is local test/proof wrapper hardening only;
  it did not read private env/RPC values, send transactions, start live
  canary/soak, deploy, or change ABI/randomness/tokenomics/percentages.
- Build summary warning/error counting is now bounded and does not materialize
  match arrays from redacted build output. `scripts/run-build-summary.mjs`
  routes `countMatches` through a capped `exec` loop with
  `MAX_SUMMARY_MATCH_COUNT`, preserving compact build proof semantics while
  avoiding `[...text.matchAll(...)]` allocation. `scripts/test-business-
  logic.mjs` guards this wrapper against returning to unbounded `matchAll`
  array materialization. Verified with `node --check` for the touched scripts,
  `build:summary` (`compiled=true`, `proxy=true`, `warnings=11`, `errors=0`),
  `test:logic:summary`, `typecheck:summary`, `lint:summary`,
  `baseline:bundle:summary`, and `proof:autonomous:summary`. This is local
  build/proof hardening only; it did not read private env/RPC values, send
  transactions, start live canary/soak, deploy, or change ABI/randomness/
  tokenomics/percentages.
- Bundle baseline budget env parsing now rejects non-canonical positive integer
  values before measuring `.next` output or comparing budgets.
  `scripts/measure-build-output.mjs` uses `POSITIVE_INTEGER_ENV_RE`, `BigInt`,
  and `MAX_SAFE_INTEGER_BIGINT` for `BUNDLE_BASELINE_MAX_*` values before
  narrowing to JS numbers, so leading-zero, exponent, malformed, or oversized
  budget env strings fail closed instead of flowing through broad digit-string
  `Number()` coercion. `scripts/test-business-logic.mjs` guards this boundary
  against returning to `/^\d+$/` or `Number(raw)`.
  Verified with `node --check` for the touched scripts, a negative
  `BUNDLE_BASELINE_MAX_TOTAL_BYTES=001` `baseline:bundle:summary` smoke that
  failed at env parsing, `test:logic:summary`, `typecheck:summary`,
  `lint:summary`, `baseline:bundle:summary`, and `proof:autonomous:summary`.
  Current local bundle summary is pass: 225 files, 8,421,932 total bytes,
  7,028,208 JS bytes, 216,200 CSS bytes, 1,056,860 WASM bytes, and no budget
  issues. This is local build/proof hardening only; it did not read private
  env/RPC values, send transactions, start live canary/soak, deploy, or change
  ABI/randomness/tokenomics/percentages.
- V10 dry-run Preview compact bullet fields are now redacted, single-line, and
  bounded before being written to `docs/v10-canary-dry-run-preview.md`.
  `scripts/create-v10-canary-dry-run-preview.mjs` routes every parsed bullet
  value through `formatPreviewField`, which uses the shared proof redactor,
  collapses whitespace, and truncates oversized values with `<truncated>`.
  `scripts/test-business-logic.mjs` guards the Preview against returning to raw
  parsed child scalar output in operator-facing bullets. Verified with
  `node --check` for the Preview script and touched business-logic guard,
  `test:logic:summary`, `typecheck:summary`, `lint:summary`,
  `proof:autonomous:summary`, and scoped `git diff --check`. This is local
  Preview proof-output hardening only; the Preview runtime was not run, no RPC
  or public-address prerequisites were consumed, no private env/RPC values or
  signing material were read, and no transaction, live canary/soak, deploy,
  ABI, randomness, tokenomics, or percentage change was used.
- V10 dry-run Preview now validates the canary log path extracted from child
  output before passing it to the strict analyzer. `scripts/create-v10-canary-
  dry-run-preview.mjs` accepts only relative
  `data/live-test-runs/live-canary-*.jsonl` paths, rejects absolute paths,
  parent traversal, private directories, and arbitrary child `log=` values, and
  otherwise leaves the analyzer skipped so G10/G11 remain blocked instead of
  analyzing an unsafe artifact path. `scripts/test-business-logic.mjs` guards
  the Preview against returning to raw child log-path forwarding. Verified
  with `node --check` for the Preview script and touched business-logic guard,
  `test:logic:summary`, `typecheck:summary`, `lint:summary`,
  `proof:autonomous:summary`, and scoped `git diff --check`. This is local
  Preview proof-output hardening only; the Preview runtime was not run, no RPC
  or public-address prerequisites were consumed, no private env/RPC values or
  signing material were read, and no transaction, live canary/soak, deploy,
  ABI, randomness, tokenomics, or percentage change was used.
- V10 post-deploy canary planner transaction counters now use an explicit
  boolean-to-count helper instead of broad `Number(boolean)` coercion.
  `scripts/plan-v10-postdeploy-canary.ts` routes per-role claim/rebate/
  resolver planned transaction counts and the resolve-vs-claim simulation
  total through `plannedCallCount`, keeping the read-only authorization summary
  exact without changing phase gating, call selection, gas estimation, ABI,
  deploy, randomness, or tokenomics. `scripts/test-business-logic.mjs` guards
  the planner against returning to `Number(resolvePlanningReady)` or
  `Number(resolverReward > 0n)` style counters. Verified with `node --check`
  for the touched business-logic guard, `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`, and scoped
  `git diff --check`. This is local read-only planner proof-output hardening
  only; it did not run the planner against RPC, read signing material or
  private wallet env, send transactions, start live canary/soak, deploy, or
  change ABI/randomness/tokenomics/percentages.
- Host load-test status bucket output now canonicalizes HTTP status keys before
  sorting or printing summary evidence. `scripts/load-http.mjs` routes
  `formatStatuses` through a strict three-digit HTTP status normalizer and
  collapses malformed buckets to `invalid-status`, so synthetic or future
  malformed status keys cannot influence operator load evidence via
  `Number(a[0]) - Number(b[0])` or replay raw status text. `scripts/test-
  business-logic.mjs` guards the load summary against returning to broad
  status-key coercion. Verified with `node --check` for `scripts/load-
  http.mjs` and the touched business-logic guard, `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`, and scoped
  `git diff --check`. This is local host/load proof-output hardening only; it
  did not run production load traffic, read private env/RPC values, send
  transactions, start live canary/soak, deploy, or change ABI/randomness/
  tokenomics/percentages. External host/load proof remains blocked until real
  production-like HTTPS host evidence exists.
- Live V10 canary env integer parsing now rejects non-canonical values before
  dry-run or live setup can shape target rounds, tile counts, safe-window
  timers, retry cooldowns, health sampling, gas floors, or stress seeds.
  `scripts/live-round-canary.ts` requires canonical decimal safe integers
  through `CANONICAL_INTEGER_ENV_RE` before range checks, so exponent,
  fractional, leading-zero, oversized, or malformed env values fail closed
  instead of passing through broad `Number(raw)` coercion. `scripts/test-
  business-logic.mjs` guards the parser against regressing to the broad
  coercion path. Verified with a negative `LIVE_TEST_TARGET_ROUNDS=1e3`
  `live:canary` smoke that failed before wallet-key loading or send paths,
  `node --check` for the touched business-logic guard, `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`,
  `proof:prelaunch:summary`, and scoped `git diff --check`. This is local
  canary/dry-run proof-tooling hardening only; no live canary, soak, private
  wallet env, transaction, deploy, ABI, randomness, tokenomics, or percentage
  change was used. Required local prelaunch rows still pass while 23
  external/status blockers and launch gates `0/14` remain explicit.
- Pending-nonce recovery summaries now normalize nonce-gap and replacement
  counters before publishing operator JSON. `scripts/clear-live-test-pending-
  nonce.ts` routes `state.gap` and replacement counts through a non-negative
  safe-integer helper, so malformed or future nonce-state evidence cannot
  shape `soak:testnet:clear-pending:summary` via broad `Number(state.gap)`
  coercion. `scripts/test-business-logic.mjs` guards the script against
  returning to raw gap conversion. Verified with `node --check` for the touched
  test script, `typecheck:summary`, `soak:testnet:clear-pending:summary`,
  `lint:summary`, `test:logic:summary`, and `proof:autonomous:summary`. The
  dry-run summary reported `pendingNonceGap=0`, `wouldSendReplacement=false`,
  and no signing material, wallet client, contract write, or transaction. This
  is local pending-nonce proof-output hardening only; it did not execute
  recovery, send transactions, read private wallet env, deploy, or change
  ABI/randomness/tokenomics/percentages.
- Testnet soak disk-capacity evidence now caps filesystem free-space BigInt
  values before publishing JSON status numbers. `scripts/run-testnet-soak-
  supervisor.mjs` routes `statfsSync(..., { bigint: true })` free-byte output
  through a non-negative safe-integer helper before setting
  `diskFreeBytesNow`, while keeping the BigInt comparison for the actual
  low-disk stop decision. `scripts/test-business-logic.mjs` guards the
  supervisor against returning to raw `Number(freeBytes)` output. Verified
  with `node --check` for the touched scripts, `soak:testnet:status:compact`,
  `typecheck:summary`, `lint:summary`, `test:logic:summary`, and
  `proof:autonomous:summary`. This is local soak/status output hardening only;
  it did not start a soak, send transactions, read private env/RPC values,
  deploy, or change ABI/randomness/tokenomics/percentages.
- Testnet soak supervisor env integer parsing now rejects non-canonical values
  before any status, stop, or managed run setup path uses them. `scripts/run-
  testnet-soak-supervisor.mjs` requires canonical decimal text for soak port,
  server-ready timeout, disk-check interval, and disk-free threshold inputs
  before `Number` coercion, so values such as `1e3` fail closed instead of
  shaping soak/runtime evidence. `scripts/test-business-logic.mjs` guards the
  parser against returning to broad `Number(raw)` coercion. Verified with
  `node --check` for the touched scripts, `soak:testnet:status:compact`, a
  negative `SOAK_PORT=1e3` status smoke, `typecheck:summary`, `lint:summary`,
  `test:logic:summary`, and `proof:autonomous:summary`. This is local
  soak/proof-tooling hardening only; it did not start a soak, send
  transactions, read private env/RPC values, deploy, or change
  ABI/randomness/tokenomics/percentages.
- Testnet soak supervisor status/stop ownership now strictly parses recorded
  PIDs before liveness checks or stop signaling. `scripts/run-testnet-soak-
  supervisor.mjs` uses a bounded `parseTrackedPid` helper and a
  `matchingSupervisorPid` check for both `status.json` and `supervisor.lock`,
  so malformed PID strings such as `1e3`, stale lock records, or broad
  `Number(...)` coercion cannot make status report a live supervisor or let
  `--stop` signal an unrelated process. `scripts/test-business-logic.mjs` adds
  source guards and a synthetic malformed-PID status regression. Verified with
  `node --check` for the touched scripts, `soak:testnet:status:compact`,
  `typecheck:summary`, `lint:summary`, `test:logic:summary`, and
  `proof:autonomous:summary`. This is local soak/status hardening only; it did
  not start a soak, send transactions, read private env/RPC values, deploy, or
  change ABI/randomness/tokenomics/percentages.
- Workspace cleanup summary byte counts now normalize to non-negative safe
  integers before formatting or aggregation. `scripts/cleanup-workspace.mjs`
  routes recursive directory sizes, per-target bytes, and `bytesFormatted`
  through a shared byte-count normalizer, so malformed filesystem size
  evidence cannot publish negative, fractional, or non-finite cleanup totals.
  `scripts/test-business-logic.mjs` guards the cleanup script against
  returning to raw byte aggregation/formatting. Verified with `node --check`
  for the touched scripts, `cleanup:workspace:dry-run:summary`,
  `typecheck:summary`, `lint:summary`, `test:logic:summary`, and
  `proof:autonomous:summary`. This is local cleanup proof-output hardening
  only; dry-run summary deleted nothing, and no private env/RPC read,
  transaction, deploy, ABI, randomness, tokenomics, or percentage change was
  used.
- Recent-wins claim fallback rows now derive display `amount` from canonical raw
  reward text instead of formatting the stored numeric compatibility field.
  `app/api/recent-wins/data.ts` routes fallback claim rewards through
  `parseLineaAmountWei` and `formatLineaAmountFixed`, so corrupted or legacy
  `rewardNum` storage cannot shape the public reward display. `scripts/test-
  business-logic.mjs` guards the route against returning to direct
  `row.rewardNum.toFixed(2)` formatting. Verified with `node --check` for the
  touched test script, `typecheck:summary`, `lint:summary`,
  `test:logic:summary`, and `proof:autonomous:summary`. This is local
  API/output hardening only; it does not read private env/RPC values, send
  transactions, deploy, or change ABI/randomness/tokenomics/percentages.
- Runtime route metrics now normalize measured latency and published average
  latency before health/diagnostic snapshots. `app/api/_lib/runtimeMetrics.ts`
  clamps non-finite, negative, and oversized route latency values through a
  shared helper before storing `lastLatencyMs`/`maxLatencyMs` or formatting
  `avgLatencyMs`, so clock drift or malformed internal state cannot publish
  `NaN`, infinity, or negative latency evidence. `scripts/test-business-
  logic.mjs` guards the source against returning to raw `Date.now() -
  startedAt` and direct `metric.avgLatencyMs.toFixed(2)` snapshot formatting.
  Verified with `typecheck:summary`, `test:logic:summary`, `lint:summary`,
  and `proof:autonomous:summary`. This is local monitoring/health-output
  hardening only; it does not read private env/RPC values, send transactions,
  deploy, or change ABI/randomness/tokenomics/percentages.
- Leaderboard ROI output now keeps ROI evidence in bigint form for sorting and
  bounds the legacy numeric compatibility field before public API output.
  `app/api/leaderboards/route.ts` computes luckiest-player ROI in basis points
  with bigint arithmetic, formats the display percent without
  `Number(bigint).toFixed(1)`, caps `valueNum` to a safe numeric range, and
  sorts by exact bigint ROI before address tie-breaks. `scripts/test-business-
  logic.mjs` guards the route against returning to direct bigint-to-number ROI
  formatting. Verified with `node --check` for the touched route and test
  script, `test:logic:summary`, `typecheck:summary`, `lint:summary`, and
  `proof:autonomous:summary`. This is local API/output hardening only; it does
  not read private env/RPC values, send transactions, deploy, or change
  ABI/randomness/tokenomics/percentages.
- Safety Pool rebate API timing output now bounds slow-build timing metrics
  before publishing them in `Server-Timing` headers or route warning logs.
  `app/api/rebates/route.ts` normalizes non-finite, negative, and oversized
  timing values through a single rebate timing formatter before `.toFixed(1)`
  or numeric log conversion. `scripts/test-business-logic.mjs` guards the
  route against returning to direct raw `timings.*.toFixed(1)` formatting.
  Verified with `node --check` for the touched route and test script,
  `test:logic:summary`, `typecheck:summary`, `lint:summary`, and
  `proof:autonomous:summary`. This is local API/operations-output hardening
  only; it does not read private env/RPC values, send transactions, deploy, or
  change ABI/randomness/tokenomics/percentages.
- Bootstrap resolver body guard now rejects any non-canonical non-empty
  `Content-Length` before keeper/RPC work. `app/api/bootstrap-resolve/route.ts`
  accepts only an explicit `0` content length as empty and treats leading-zero,
  oversized, fractional, scientific, or positive body lengths as
  `bootstrap_body_not_supported`, without parsing attacker-controlled header
  text through `BigInt`. `scripts/test-business-logic.mjs` guards the route
  source against returning to broad digit parsing, `BigInt(contentLength)`, or
  unbounded body reads. Verified with `node --check` for the touched test
  script, `test:logic:summary`, `typecheck:summary`, `lint:summary`, and
  `proof:autonomous:summary`. This is local API-boundary hardening only; it
  does not call the resolver, read private env/RPC values, send transactions,
  deploy, or change ABI/randomness/tokenomics/percentages.
- Local launch proof preflight summary now sanitizes child JSON status,
  counters, and failed check identifiers before printing compact operator
  output. `scripts/run-local-proof-preflight.mjs` routes parsed `status`,
  `checks`, `passed`, `failed`, and `failedIds` through safe token and
  non-negative safe-integer helpers, so a child proof summary cannot replay raw
  identifiers or malformed counters into `proof:local:summary`.
  `scripts/test-business-logic.mjs` guards the source path against returning to
  raw child JSON interpolation. Verified with `node --check` for touched
  scripts, `proof:local:summary`, `test:logic:summary`, `typecheck:summary`,
  `lint:summary`, and `proof:autonomous:summary`. Local preflight still passes
  its expected 17 rows while launch gates remain `0/14`. This is local
  proof-output hardening only; it does not create external launch proof, read
  private env/RPC values, send transactions, deploy, or change
  ABI/randomness/tokenomics/percentages.
- V10 canary proof summaries now sanitize aggregate count keys before printing
  role, mode, or bet-error buckets from JSONL evidence. `scripts/analyze-live-
  canary-proof.mjs` routes `formatCounts` keys through `safeCountKey`, so a
  malformed future canary log cannot replay URL/token-like role or error text
  in routine G10/G11 summaries; unsafe count labels collapse to
  `unsafe-token` while strict validation still fails on malformed role
  evidence. `scripts/test-business-logic.mjs` adds a synthetic unsafe-role
  canary regression and source guard. Verified with `node --check` for touched
  scripts, `proof:testnet:canary:v10:summary`, `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, and `proof:autonomous:summary`. The V10
  canary summary still correctly fails closed with missing live canary log for
  G10/G11. This is local proof-output hardening only; it does not create live
  canary/soak proof, read private env/RPC values, send transactions, deploy,
  or change ABI/randomness/tokenomics/percentages.
- SQLite backup retention env parsing now rejects unsafe oversized decimal
  strings before backup strict paths can use them to compute retention windows.
  `scripts/backup-sqlite.mjs` bounds `LORE_BACKUP_RETENTION_DAYS` with a
  positive safe-integer text shape before `Number` coercion, so values such as
  `9999999999999999` fail closed instead of becoming retention proof inputs.
  `scripts/test-sqlite-operations.mjs` covers the unsafe retention rejection,
  `scripts/run-db-operations-summary.mjs` exposes
  `unsafeRetentionBackupSummaryRejected`, and `scripts/test-business-logic.mjs`
  guards the source parser plus regression fixture. Verified with `node
  --check` for touched scripts, `test:db-operations:summary`,
  `db:backup:strict:summary`, `test:logic:summary`, `typecheck:summary`,
  `lint:summary`, and `proof:autonomous:summary`. Backup strict still
  correctly fails closed with missing real source/backup configuration. This
  is local backup proof-tooling hardening only; it does not create real backup
  evidence, read private env/RPC values, send transactions, run an indexer,
  start live canary/soak, deploy, or change ABI/randomness/tokenomics/
  percentages.
- Signoff collector and draft positive-integer proof inputs now reject unsafe
  oversized decimal strings before they can shape G1-G4 signoff evidence.
  `scripts/collect-proof-common.mjs`, `scripts/collect-signoff-evidence.mjs`,
  and `scripts/create-signoff-proof-draft.mjs` bound positive integer input
  shape before `Number` coercion, so values such as `9999999999999999` cannot
  be accepted as requested epoch or finality proof inputs.
  `scripts/check-proof-drafts.mjs` adds an unsafe signoff collector
  `--epochs` regression, and `scripts/test-business-logic.mjs` guards the
  shared/signoff parsers and regression fixture. Verified with `node --check`
  for touched scripts, `proof:drafts:summary`, `proof:signoff:strict:summary`,
  `test:logic:summary`, `typecheck:summary`, `lint:summary`, and
  `proof:autonomous:summary`. Signoff strict still correctly fails closed with
  missing real G1-G4 operator signoff, chain/API comparison, env, owner, and
  randomness acceptance evidence. This is local proof-tooling hardening only;
  it does not create signoff proof, read private env/RPC values, send
  transactions, start live canary/soak, deploy, or change ABI/randomness/
  tokenomics/percentages.
- Monitoring strict proof validation now rejects unsafe health monitor cadence
  evidence before a monitoring manifest can cover G9. `scripts/check-
  monitoring-proof.mjs` bounds `asPositiveSafeInteger` input shape before
  `Number` coercion, so oversized decimal strings such as
  `9999999999999999` cannot pass as canonical cadence evidence.
  `scripts/check-proof-drafts.mjs` adds the unsafe health-cadence regression,
  and `scripts/test-business-logic.mjs` guards the bounded parser and
  regression fixture. Verified with `node --check` for touched scripts,
  `proof:drafts:summary`, `proof:monitoring:strict:summary`,
  `test:logic:summary`, `typecheck:summary`, `lint:summary`, and
  `proof:autonomous:summary`. Monitoring strict still correctly fails closed
  with missing real G9 external monitor, alert target, Resend sender, and
  alert-delivery evidence. This is local proof-validator hardening only; it
  does not create real monitoring proof, read private env/RPC values, send
  alerts or transactions, start live canary/soak, deploy, or change
  ABI/randomness/tokenomics/percentages.
- QA strict proof validation now rejects unsafe target chain-id evidence before
  a wallet/mobile/failure-UX QA manifest can cover G12-G14. `scripts/check-qa-
  proof.mjs` bounds `positiveInteger` input shape before `Number` coercion, so
  oversized decimal strings such as `9999999999999999` cannot pass as
  canonical chain IDs. `scripts/create-qa-proof-draft.mjs` and
  `scripts/create-qa-canary-test-plan.mjs` now use the same bounded safe
  integer parsing before generating QA evidence drafts or plans.
  `scripts/check-proof-drafts.mjs` adds unsafe target-chain regressions for
  strict QA proof, draft generation, and QA canary test-plan generation;
  `scripts/test-business-logic.mjs` guards the bounded validator/generators
  and regression fixtures. Verified with `node --check` for touched scripts,
  `proof:drafts:summary`, `proof:qa:strict:summary`, `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, and `proof:autonomous:summary`. QA
  strict still correctly fails closed with missing real wallet, UX, browser,
  and mobile QA manifest evidence for G12-G14. This is local proof-tooling
  hardening only; it does not create real QA/mobile/wallet proof, read private
  env/RPC values, send transactions, start live canary/soak, deploy, or change
  ABI/randomness/tokenomics/percentages.
- Restore strict proof validation now rejects unsafe indexer preservation
  epoch evidence before a restore manifest can cover G8. `scripts/verify-db-
  restore.mjs` now returns integer text from `integerString` only after
  canonical non-negative safe integer parsing, so
  `indexerPreservation.latestIndexedEpochBefore/After` cannot accept oversized
  decimal strings such as `9999999999999999`. `scripts/check-proof-
  drafts.mjs` adds the unsafe indexed-epoch regression, and
  `scripts/test-business-logic.mjs` guards the parser path and regression.
  Verified with `node --check` for touched scripts, `proof:drafts:summary`,
  `proof:restore:strict:summary`, `test:logic:summary`, `typecheck:summary`,
  `lint:summary`, and `proof:autonomous:summary`. Restore strict still
  correctly fails closed with missing real source DB, backup dir, restore dir,
  backup artifact, and G8 manifest evidence. This is local proof-validator
  hardening only; it does not create real backup/restore proof, read private
  env/RPC values, run an indexer, send transactions, start live soak, deploy,
  or change ABI/randomness/tokenomics/percentages.
- Indexer strict proof validation now rejects unsafe integer proof inputs
  before a dry-run manifest can cover G7. `scripts/check-indexer-dry-
  run.mjs` delegates manifest start/deploy/finality, chain snapshot chain IDs,
  SQLite meta checks, and `chainComparison.*.checkedEpochs` helpers to the
  canonical safe integer parsers instead of regex-only integer text checks.
  `scripts/check-proof-drafts.mjs` adds an unsafe `9999999999999999`
  checked-epoch regression for strict indexer proof, and
  `scripts/test-business-logic.mjs` guards the parser delegation and
  regression. Verified with `node --check` for touched scripts,
  `proof:drafts:summary`, `proof:indexer:strict:summary`,
  `test:logic:summary`, `typecheck:summary`, `lint:summary`, and
  `proof:autonomous:summary`. Indexer strict still correctly fails closed with
  missing external DB, deploy/start/finality env, and manifest evidence for
  G7. This is local proof-validator hardening only; it does not create real
  indexer DB/finality evidence, read private env/RPC values, run the indexer,
  send transactions, start live soak, deploy, or change ABI/randomness/
  tokenomics/percentages.
- Signoff proof validation now rejects unsafe integer proof inputs before a
  contract/funds signoff manifest can cover G1-G4. `scripts/check-signoff-
  proof.mjs` routes deploy, public deploy, indexer start, finality, and
  `chainComparison.*.checkedEpochs` through safe integer parsers instead of
  regex-only shape checks. `scripts/check-proof-drafts.mjs` adds an unsafe
  `9999999999999999` checked-epoch regression for strict signoff proof, and
  `scripts/test-business-logic.mjs` guards the safe parsing and regression.
  Verified with `node --check` for touched scripts, `proof:drafts:summary`,
  `proof:signoff:strict:summary`, `test:logic:summary`, `typecheck:summary`,
  `lint:summary`, and `proof:autonomous:summary`. Signoff strict still
  correctly fails closed with missing real G1-G4 signoff manifest evidence.
  This is local proof-validator hardening only; it does not create operator
  signoff, chain reconciliation evidence, live transactions, private env/RPC
  reads, deploys, or ABI/randomness/tokenomics/percentage changes.
- Live canary proof analysis now rejects unsafe canary numeric evidence before
  a JSONL canary log can satisfy G10/G11 proof checks. `scripts/analyze-live-
  canary-proof.mjs` routes positive and non-negative integer evidence through
  canonical safe-integer parsers, uses exact canonical integer text ordering
  for unique epoch summaries, and no longer treats regex-only integer shape as
  sufficient. `scripts/check-proof-drafts.mjs` adds unsafe
  `9999999999999999` regression rows for nonce, epoch, and tx metric evidence;
  `scripts/test-business-logic.mjs` guards the safe parsers, exact sorting,
  and regression rows. Verified with `node --check` for touched scripts,
  `proof:drafts:summary`, `test:logic:summary`,
  `proof:testnet:canary:v10:summary`, `typecheck:summary`, `lint:summary`, and
  `proof:autonomous:summary`. `proof:testnet:canary:v10:summary` still
  correctly fails closed with missing live canary log for G10/G11. This is
  local proof-validator hardening only; it does not create live canary/soak
  evidence, send transactions, read private wallet/RPC/env values, deploy, or
  change ABI, randomness, tokenomics, or percentages.
- Host proof collection and draft generation now reject noncanonical or unsafe
  `finalityLagBlocks` values before they can become host proof inputs.
  `scripts/collect-host-evidence.mjs` and `scripts/create-host-proof-
  draft.mjs` require canonical non-negative decimal finality evidence, and
  `scripts/check-proof-drafts.mjs` adds malformed `2e1` plus unsafe
  `9999999999999999` regressions for both collector and draft paths.
  `scripts/test-business-logic.mjs` guards the canonical wording and
  regression rows. Verified with `node --check` for touched scripts,
  `proof:drafts:summary`, `test:logic:summary`, `proof:host:strict:summary`,
  `proof:indexer:strict:summary`, `typecheck:summary`, `lint:summary`, and
  `proof:autonomous:summary`. Host/indexer strict checks still correctly fail
  closed on missing external G5/G6/G7 proof inputs. This is local proof-tooling
  hardening only; it does not create host/indexer launch evidence, read
  private env/RPC values, run an indexer, send transactions, start live soak,
  deploy, or change ABI, randomness, tokenomics, or percentages.
- Host and indexer strict proof artifact checks now require safe
  `finalityLagBlocks` inside the referenced local health artifact itself,
  instead of accepting any `\d+` in an artifact while a separate inline summary
  carries safe evidence. `scripts/check-host-proof.mjs` adds
  `localArtifactHealthEvidenceHasSafeFinality`; `scripts/check-indexer-
  dry-run.mjs` adds `localArtifactFinalityEvidenceHasSafeLag`. Both helpers
  require the expected production base and canonical non-negative safe integer
  finality evidence from artifact contents. `scripts/check-proof-drafts.mjs`
  adds an unsafe indexer finality artifact strict-regression case, and
  `scripts/test-business-logic.mjs` adds source/runtime guards, including a
  host manifest where inline health summary is safe but the referenced
  artifact has unsafe `9999999999999999`. Verified with `node --check`,
  `proof:drafts:summary`, `test:logic:summary`, `proof:host:strict:summary`,
  `proof:indexer:strict:summary`, `typecheck:summary`, `lint:summary`, and
  `proof:autonomous:summary`. Host and indexer strict summaries still
  correctly fail closed with missing G5/G6 and G7 external evidence. This is
  local proof-tooling hardening only; it does not create real host/indexer
  launch evidence, read private env/RPC values, run an indexer, send
  transactions, start live soak, deploy, change ABI, randomness, or tokenomics.
- Indexer evidence collection now safe-parses `finalityLagBlocks` before
  accepting health evidence in draft collection. `scripts/collect-indexer-
  evidence.mjs` has `isCanonicalNonNegativeInteger` delegate to the existing
  safe `parseInteger` helper instead of regex-only acceptance. `scripts/check-
  proof-drafts.mjs` adds unsafe `9999999999999999` finality-lag regression
  rows for both indexer evidence collection and draft generation, and
  `scripts/test-business-logic.mjs` guards the safe parser delegation and
  regression rows. Verified with `node --check` for touched scripts,
  `proof:drafts:summary`, `proof:indexer:strict:summary`,
  `test:logic:summary`, `typecheck:summary`, `lint:summary`, and
  `proof:autonomous:summary`. `proof:indexer:strict:summary` still correctly
  fails closed with missing DB, start/deploy/finality env, and indexer
  manifest evidence for G7. This is local proof-tooling hardening only; it
  does not create real indexer DB/finality evidence, read private env/RPC
  values, run an indexer, send transactions, start live soak, deploy, change
  ABI, randomness, or tokenomics.
- Restore health finality evidence now rejects unsafe decimal values in draft
  collection, draft generation, and strict validation. `scripts/collect-
  restore-evidence.mjs`, `scripts/create-restore-proof-draft.mjs`, and
  `scripts/verify-db-restore.mjs` route `finalityLagBlocks` evidence through
  `parseCanonicalNonNegativeInteger` and require `Number.isSafeInteger` in
  addition to canonical decimal text. `scripts/check-proof-drafts.mjs` adds
  permanent malformed and unsafe finality-lag regression rows for both draft
  generation and strict restore validation, and `scripts/test-business-
  logic.mjs` guards the safe parsing and regression cases. Verified with
  `node --check` for all touched scripts, `proof:drafts:summary`,
  `test:logic:summary`, `typecheck:summary`, `lint:summary`,
  `proof:restore:strict:summary`, and `proof:autonomous:summary`.
  `proof:restore:strict:summary` still correctly fails closed with missing
  real source, backup path, restore path, backup artifact, and restore
  manifest evidence for G8. This is local proof-tooling hardening only; it
  does not create real backup/restore evidence, read private env/RPC values,
  send transactions, run indexers, start live soak, deploy, change ABI,
  randomness, or tokenomics.
- SQLite backup retention pruning now fails closed on malformed retention
  clocks before deleting generated backup files. `scripts/sqlite-backup-
  lib.mjs` validates the optional `now` argument as a safe non-negative
  integer before computing the retention cutoff, and
  `scripts/test-sqlite-operations.mjs` covers `Number.NaN` clock rejection.
  Business-logic guards require the malformed-clock runtime regression and
  source-level guard. Verified with `node --check` for
  `scripts/sqlite-backup-lib.mjs`, `scripts/test-sqlite-operations.mjs`, and
  `scripts/test-business-logic.mjs`, plus `test:db-operations:summary`,
  `test:logic:summary`, `typecheck:summary`, `lint:summary`, and
  `proof:autonomous:summary`. This is local backup/retention safety
  hardening only; real backup schedule/path/restore evidence remains external
  for G8/G9. No private env, real backup path, transaction, indexer run, live
  soak, deploy, ABI, randomness, tokenomics, secret, or private RPC access was
  used.
- Chain/indexer audit reconciliation now range-checks BigInt block windows
  before binding them into SQLite queries. `scripts/audit-chain-indexer-
  window.mjs` adds `toSqlBlockNumber`, derives `sqlFromBlock` and
  `sqlToBlock` only after the finalized audit window is bounded, and uses
  those safe integers for scoped indexer-event and protocol-fee queries
  instead of direct `Number(fromBlock)` / `Number(toBlock)` conversion.
  Business-logic guards reject returning to broad block-window coercion.
  Verified with `node --check` for `scripts/audit-chain-indexer-window.mjs`
  and `scripts/test-business-logic.mjs`, plus `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, and `proof:autonomous:summary`.
  This is local source/proof hardening only; real chain/indexer strict
  evidence remains blocked on external DB/RPC/finality inputs for G7. No
  private RPC/env values, indexer run, wallet signing, transaction, live soak,
  deploy, ABI, randomness, tokenomics, secret, or private RPC access was used.
- Direct chain proof collection now canonical-parses requested `--epochs`
  evidence before any read path uses it. `scripts/collect-chain-proof.mjs`
  adds a canonical positive decimal epoch parser, rejects noncanonical values
  such as leading-zero or signed epoch text in summary mode, filters parsed
  epochs through the shared helper, and sorts BigInt epoch ids with an exact
  comparator instead of `Number(a - b)`. Non-summary collection also stops
  before viem/RPC setup when input validation issues already exist, writing
  only the local snapshot/summary boundary. Business-logic guards reject
  returning to raw `.map((value) => BigInt(value))` requested-epoch parsing,
  lossy BigInt sorting, or RPC setup after preflight issues. Verified with
  `node --check` for
  `scripts/collect-chain-proof.mjs` and `scripts/test-business-logic.mjs`,
  `proof:chain:summary`, `proof:chain:strict:summary`,
  malformed `--epochs=01,+2,3` summary and non-summary paths,
  `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, and `proof:autonomous:summary`.
  `proof:chain:strict:summary` still correctly fails closed on the built-in
  fallback RPC boundary for G1. This is local read-only proof tooling
  hardening only and does not read private RPC/env values, run indexers,
  perform wallet signing, transactions, live soak, deploy, ABI changes,
  randomness, tokenomics, secret, or private RPC access.
- Autonomous and prelaunch proof aggregators now canonical-parse
  text-derived child-summary counters before publishing compact readiness
  output. `scripts/report-autonomous-status.mjs` and
  `scripts/report-prelaunch-status.mjs` add `nonNegativeSafeIntegerText`
  helpers and use them for `Complete gates`, issue/failing counts, compact
  soak health counters, and remaining-gate progress. Business-logic guards
  reject returning to broad `nonNegativeSafeInteger(Number(...match...))`
  parsing for these summary paths. Verified with `node --check` for both
  reporters and `scripts/test-business-logic.mjs`, plus
  `test:logic:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. `proof:prelaunch:summary` passed all required
  local checks and still reports 23 external/status blockers across backup,
  canary, chain, contract, env, host, indexer, launch, monitoring, QA,
  restore, and signoff. This is local proof aggregation hardening only and
  does not create external launch evidence or perform wallet signing,
  transactions, RPC/private env reads, indexer runs, live soak, deploy, ABI,
  randomness, tokenomics, secret, or private RPC access.
- Restore proof validation now canonical-parses SQLite `COUNT(*)` evidence,
  backup retention days, and known launch row totals before using them for
  strict backup/restore readiness. `scripts/verify-db-restore.mjs` routes
  table counts through `parseCanonicalNonNegativeInteger`, rejects unsafe or
  uncanonical retention evidence through `parseCanonicalPositiveInteger`, and
  only sums safe non-negative launch row counts. Business-logic guards reject
  returning to broad `Number(row?.count ?? 0)`,
  `Number(positiveIntegerString(backupSchedule.retentionDays))`, or
  `typeof value === "number"` row-total filtering. Verified with `node
  --check` for `scripts/verify-db-restore.mjs` and
  `scripts/test-business-logic.mjs`, plus `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:restore:strict:summary`, and
  `proof:autonomous:summary`. `proof:restore:strict:summary` still correctly
  fails closed with missing real source, backup artifact, absolute
  backup/restore dirs, and manifest evidence for G8. This is local proof
  tooling hardening only and does not create real backup schedule, restore
  drill, staging health, wallet, transaction, RPC, indexer, live soak, deploy,
  ABI, randomness, tokenomics, secret, or private RPC evidence.
- QA proof draft and QA canary test-plan generation now reuse safe canonical
  positive-integer parsing for launch chain id evidence. `scripts/create-qa-
  proof-draft.mjs` and `scripts/create-qa-canary-test-plan.mjs` add
  `parsePositiveInteger`, have `isPositiveInteger` delegate to it, reject
  unsafe/uncanonical `--chain-id` evidence, and compare against Linea mainnet
  using the parsed value instead of `Number(chainId)`. The QA proof draft also
  writes `targetChainId`, `wallet.wrongNetwork.targetChainId`, and
  `wallet.cleanWalletFirstTx.chainId` from the parsed value; the QA canary
  plan prints and reuses the parsed chain id in its follow-up command.
  Business-logic guards reject returning to broad QA chain-id coercion while
  preserving distinct artifact and redacted evidence requirements. Verified
  with `node --check` for both QA generators and
  `scripts/test-business-logic.mjs`, plus `proof:drafts:summary`,
  `test:logic:summary`, `typecheck:summary`, `lint:summary`,
  `proof:qa:strict:summary`, and `proof:autonomous:summary`.
  `proof:qa:strict:summary` still correctly fails closed with a missing QA
  manifest for G12-G14, and `proof:drafts:summary` still confirms drafts are
  not accepted as strict proof. This is local proof tooling hardening only and
  does not create real wallet, mobile, browser, clean-wallet transaction, or
  Privy production-domain evidence. No wallet signing, transaction, RPC read,
  indexer run, live soak, deploy, ABI, randomness, tokenomics, secret access,
  or private RPC access was used.
- Canary proof draft generation now publishes target chain id evidence from
  the same safe canonical parser used for validation. `scripts/create-canary-
  proof-draft.mjs` adds `parsePositiveInteger`, has `isPositiveInteger`
  delegate to it, rejects unsafe/uncanonical `--chain-id` evidence, and writes
  `targetNetwork.chainId` from `parsedChainId` instead of separately coercing
  `Number(chainId)`. Business-logic guards reject returning to broad canary
  chain-id coercion while preserving bounded JSONL artifact parsing and
  distinct artifact requirements. Verified with `node --check` for
  `scripts/create-canary-proof-draft.mjs` and
  `scripts/test-business-logic.mjs`, plus `proof:drafts:summary`,
  `test:logic:summary`, `typecheck:summary`, `lint:summary`, and
  `proof:autonomous:summary`. `proof:drafts:summary` still confirms generated
  drafts are not accepted as strict proof. This is local proof tooling
  hardening only and does not create live canary, recovery, transaction,
  owner, host, QA, or monitoring evidence. No wallet signing, transaction,
  RPC read, indexer run, live soak, deploy, ABI, randomness, tokenomics,
  secret access, or private RPC access was used.
- Signoff evidence collection now reuses a shared canonical positive-integer
  parser for `--epochs` and publishes the same parsed `requestedEpochs` value
  into draft signoff manifests. `scripts/collect-proof-common.mjs` exports
  `parsePositiveInteger`, and `isPositiveInteger` delegates to it;
  `scripts/collect-signoff-evidence.mjs` rejects null parsed epochs before
  manifest construction instead of validating one path and then separately
  coercing `Number(epochs)`. Business-logic guards reject returning to broad
  requested-epoch coercion and preserve canonical finality-block parsing.
  Verified with `node --check` for `scripts/collect-proof-common.mjs`,
  `scripts/collect-signoff-evidence.mjs`, and
  `scripts/test-business-logic.mjs`, plus `test:logic:summary`,
  `typecheck:summary`, `lint:summary`,
  `proof:collector-redaction:summary`, `proof:signoff:strict:summary`, and
  `proof:autonomous:summary`. `proof:signoff:strict:summary` still correctly
  fails closed with a missing signoff manifest for G1-G4. This is local proof
  tooling hardening only and does not create owner/signoff/randomness/chain
  evidence. No wallet signing, transaction, RPC read, indexer run, live soak,
  deploy, ABI, randomness, tokenomics, secret access, or private RPC access
  was used.
- Reward summary API reward-read preparation now canonical-parses runtime
  epoch map keys before multicall construction and publishes winning tile ids
  from the already validated runtime row instead of re-coercing
  `entry.winningTile` through `Number(...)`. `app/api/_lib/rewardSummary.ts`
  routes epoch keys through `parseStoredPositiveIntegerOrZero` via
  `parseRewardEpochKey`, preserving the existing positive-safe epoch filter
  and 1..25 winning-tile boundary. Business-logic guards reject returning to
  broad `Number(epoch)` or `Number(entry.winningTile)` coercion. Verified with
  `node --check` for `app/api/_lib/rewardSummary.ts` and
  `scripts/test-business-logic.mjs`, plus `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, and `proof:autonomous:summary`.
  Before this patch, full local `check:summary` was also refreshed
  successfully, including lint, business logic, security follow-up,
  fetch-timeout, stored-number parsing, V9/V10 contract tests, indexer
  storage, DB operations, monitoring, build, typecheck, HTTP smoke, and
  browser smoke. This is local API/proof hardening only; autonomous status
  remains read-only with `complete=0/14` and external signoff, chain/env, host,
  QA, canary, monitoring, indexer, restore, backup, and strict G1 evidence
  blockers still explicit. No wallet signing, transaction, RPC read, indexer
  run, live soak, deploy, ABI, randomness, tokenomics, secret access, or
  private RPC access was used.
- Runtime health email-alert diagnostics now fail closed on malformed
  recipient parsing before publishing boolean monitoring readiness.
  `app/api/health/runtime/route.ts` caps alert recipients at 10 entries, caps
  each parsed entry at 254 characters, rejects empty/overlong recipient entries
  for the whole list instead of silently dropping them, rejects overlong sender
  entries before email matching, and still exposes only `emailAlertConfigured`
  rather than recipients, sender, or Resend key details. Business-logic guards
  reject unbounded parsing, silent malformed-recipient filtering, or public
  publication of alert identity fields. Verified with `node --check` for
  `app/api/health/runtime/route.ts` and `scripts/test-business-logic.mjs`,
  `test:monitoring:summary`, `typecheck:summary`, and `test:logic:summary`.
  This is local runtime-health hardening only and does not configure a real
  Resend sender or external alert channel. No browser run, indexer run, RPC
  read, wallet signing, transaction, live soak, deploy, ABI, randomness,
  tokenomics, secret access, or private RPC access was used.
- Data-sync health diagnostics now avoid broad numeric coercion for published
  env thresholds and validated timestamp age math. `app/api/health/data-
  sync/route.ts` only publishes non-negative safe integer threshold values via
  `toNum`, and `ageMs` uses the already-validated timestamp directly instead
  of re-coercing it through `Number(timestamp)`. Business-logic guards reject
  returning to broad health env/timestamp coercion. Verified with `node
  --check` for `app/api/health/data-sync/route.ts` and
  `scripts/test-business-logic.mjs`, `test:monitoring:summary`, and
  `test:logic:summary`. This is local health-route hardening only and does not
  configure real external monitoring/alerts. No browser run, indexer run, RPC
  read, wallet signing, transaction, live soak, deploy, ABI, randomness,
  tokenomics, secret access, or private RPC access was used.
- Daily local operational summaries were refreshed in read-only mode:
  `proof:deps:summary` passed with no high/critical production dependency
  blockers, `proof:wallet-deps:summary` passed with Privy/Wagmi/Viem present,
  `baseline:bundle:summary` passed against the static production-output budget,
  and `cleanup:workspace:dry-run:summary` found no deletion targets. This is
  local operational evidence only and does not satisfy external host, real
  monitoring, backup, restore, indexer DB/finality, canary, soak, QA, or
  signoff gates. No cleanup apply, dependency install/update, browser run,
  indexer run, RPC read, wallet signing, transaction, live soak, deploy, ABI,
  randomness, tokenomics, secret access, or private RPC access was used.
- SQLite scope-audit proof counters now validate `COUNT(*)` results before
  publishing DB-isolation evidence. `scripts/sqlite-scope-audit-lib.mjs`
  exports `normalizeSqliteCount`, accepts non-negative safe integer
  number/bigint/canonical string counts, rejects negative, fractional,
  exponent, leading-zero, and unsafe values, and routes foreign scoped rows,
  legacy table rows, and stale meta-key counts through the helper instead of
  broad `Number(...)` coercion. Business-logic guards cover malformed count
  values and reject returning to broad count coercion. Verified with `node
  --check` for `scripts/sqlite-scope-audit-lib.mjs` and
  `scripts/test-business-logic.mjs`, `test:db-operations:summary`, and
  `test:logic:summary`. This is local DB proof hardening only and does not
  create a real external indexer DB/finality proof. No indexer run, RPC read,
  wallet signing, transaction, live soak, deploy, ABI, randomness, tokenomics,
  secret access, or private RPC access was used.
- Indexer proof tooling now reuses the canonical parsed `--epochs` value for
  snapshot coverage checks and collector manifest output. `scripts/collect-
  indexer-evidence.mjs` adds a bounded `parseInteger` helper and both
  `scripts/collect-indexer-evidence.mjs` and
  `scripts/create-indexer-proof-draft.mjs` compare unique checked chain
  snapshot epochs against `requestedEpochs` instead of broadly coercing
  `Number(epochs)`. Business-logic guards reject returning to broad
  `--epochs` coercion in both proof tools. Verified with `node --check` for
  both scripts and `scripts/test-business-logic.mjs`, plus
  `test:logic:summary`. This is local proof-tool hardening only and does not
  create a real external indexer DB/finality proof. No indexer run, RPC read,
  wallet signing, transaction, live soak, deploy, ABI, randomness, tokenomics,
  secret access, or private RPC access was used.
- Jackpot fallback previous-grid epoch derivation now preserves exact epoch
  identity without broad numeric coercion. `app/lib/lineaOreClientViewProps.ts`
  exports `derivePreviousGridEpoch`, accepts only canonical non-negative epoch
  strings, computes the previous epoch with `BigInt`, rejects malformed
  fractional/exponent/leading-zero values, and avoids
  `Number(gridDisplayEpoch)` before matching daily/weekly jackpot history.
  Business-logic guards cover normal, zero, malformed, and
  greater-than-`Number.MAX_SAFE_INTEGER` epoch strings and reject returning to
  broad grid epoch coercion. Verified with `node --check` for
  `app/lib/lineaOreClientViewProps.ts` and
  `scripts/test-business-logic.mjs`, plus `test:logic:summary`. No browser
  run, endpoint polling beyond the test harness, wallet signing, transaction,
  RPC read, live soak, deploy, ABI, randomness, tokenomics, secret access, or
  private RPC access was used.
- Cached sidebar hot-tile restore now validates localStorage tile and win
  counters with canonical positive safe-integer parsing before rendering stale
  UI data. `app/hooks/useAppShellState.ts` adds `normalizeCachedHotTile`,
  preserves the existing `GRID_SIZE` tile boundary, rejects fractional,
  exponent, whitespace, zero, out-of-grid, and unsafe counters, and avoids
  broad `Number(value.tileId)`/`Number(value.wins)` coercion. Business-logic
  guards cover malformed cache entries and reject returning to broad hot-tile
  coercion. Verified with `node --check` for
  `app/hooks/useAppShellState.ts` and `scripts/test-business-logic.mjs`, plus
  `test:logic:summary`. No browser run, endpoint polling beyond the test
  harness, wallet signing, transaction, RPC read, live soak, deploy, ABI,
  randomness, tokenomics, secret access, or private RPC access was used.
- Game countdown epoch-end timing now safely narrows chain bigint timestamps
  before millisecond arithmetic. `app/hooks/useGameCountdown.ts` exports
  `normalizeEpochEndMs`, rejects zero, negative, and millisecond-unsafe epoch
  end values, and fails closed to `timeLeft=0`/`slow` without entering the
  zero-refetch branch when the timestamp is malformed. Normal safe countdown
  behavior and the existing polling phases are preserved. Business-logic
  guards cover safe, zero, negative, max-boundary, and overflow cases and
  reject returning to broad `Number(effectiveEpochEndTime) * 1000` coercion.
  Verified with `node --check` for `app/hooks/useGameCountdown.ts` and
  `scripts/test-business-logic.mjs`, plus `test:logic:summary`. No browser
  run, endpoint polling beyond the test harness, wallet signing, transaction,
  RPC read, live soak, deploy, ABI, randomness, tokenomics, secret access, or
  private RPC access was used.
- Global stats cache/API epoch counters now use canonical non-negative
  safe-integer parsing before UI publication. `app/hooks/useGlobalStats.ts`
  routes cached `resolvedEpochs`/`lastScannedEpoch` and API
  `resolvedEpochs` through a shared parser that accepts safe non-negative
  numbers or digit-only strings and rejects fractional, exponent, whitespace,
  negative, and unsafe values before updating accumulator state. Business-logic
  guards cover malformed cache counters and reject returning to broad
  `Number(obj...)`/`Number(payload...)` coercion for those counters. Verified
  with `node --check` for `app/hooks/useGlobalStats.ts` and
  `scripts/test-business-logic.mjs`, plus `test:logic:summary`. No browser
  run, endpoint polling beyond the test harness, wallet signing, transaction,
  RPC read, live soak, deploy, ABI, randomness, tokenomics, secret access, or
  private RPC access was used.
- Full local `check:summary` was refreshed after the latest game-data UI
  evidence hardening. The gate completed successfully: lint, business logic,
  security follow-up, fetch-timeout, stored-number parsing, V9/V10 contract
  tests, indexer storage, DB operations, monitoring drill, build, typecheck,
  HTTP smoke, and browser smoke all completed. This is local evidence only and
  does not satisfy external G1-G14 blockers or authorize live wallet actions.
  No wallet signing, transactions, live soak, deploy, ABI, randomness,
  tokenomics, secret access, or private RPC access was used.
- Current game-data tile user counts now safely narrow live chain user-count
  evidence before UI publication. `app/hooks/useGameData.helpers.ts` reuses
  `parseChainSafeInteger` for `buildTileViewData` live user counts instead of
  broad `Number(liveUsersArr?.[i] ?? 0n)` coercion, so unsafe bigint user
  counts fall back to the existing visible positive-pool minimum instead of
  entering `Math.max`. Business-logic guards cover safe counts, unsafe counts,
  and zero-display pools, and reject returning to broad live-user coercion.
  Verified with `node --check` for `app/hooks/useGameData.helpers.ts` and
  `scripts/test-business-logic.mjs`, plus `test:logic:summary`,
  `lint:summary`, `typecheck:summary`, and `proof:autonomous:summary`.
  Autonomous status remains read-only with `complete=0/14`; V10 deployed
  identity, signoff, chain/env, host, QA, canary, monitoring, indexer, restore,
  backup, and G1 strict env evidence blockers remain explicit. No browser run,
  endpoint polling beyond existing summary checks, wallet signing,
  transaction, RPC read, live soak, deploy, ABI, randomness, tokenomics, secret
  access, or private RPC access was used.
- Current game-data epoch-duration change UI helper now safely narrows chain
  timing evidence. `app/hooks/useGameData.helpers.ts` adds
  `parseChainSafeInteger` for `buildEpochDurationChange`, rejecting unsafe
  pending duration values and returning `null` for unsafe optional current/ETA
  fields instead of broadly coercing chain bigint evidence through
  `Number(...)`. Valid safe integer timing display behavior is preserved.
  Business-logic guards cover valid, zero, unsafe pending, and unsafe optional
  timing cases and reject returning to broad duration/ETA coercion. Verified
  with `node --check` for `app/hooks/useGameData.helpers.ts` and
  `scripts/test-business-logic.mjs`, plus `test:logic:summary`,
  `lint:summary`, `typecheck:summary`, and `proof:autonomous:summary`.
  Autonomous status remains read-only with `complete=0/14`; V10 deployed
  identity, signoff, chain/env, host, QA, canary, monitoring, indexer, restore,
  backup, and G1 strict env evidence blockers remain explicit. No browser run,
  endpoint polling beyond existing summary checks, wallet signing,
  transaction, RPC read, live soak, deploy, ABI, randomness, tokenomics, secret
  access, or private RPC access was used.
- Current game-data winner tile UI helper now rejects out-of-range resolved
  tile evidence before publishing a tile id. `app/hooks/useGameData.helpers.ts`
  adds `parseGridTileId` and routes `buildWinningTileId` through the canonical
  1..`GRID_SIZE` boundary instead of positive-only `Number(tuple[2])`
  coercion, so malformed live epoch tuples cannot display an impossible
  current winner tile. Business-logic guards cover valid, zero, out-of-range,
  and non-revealing cases and reject returning to positive-only tile parsing.
  Verified with `node --check` for `app/hooks/useGameData.helpers.ts` and
  `scripts/test-business-logic.mjs`, plus `test:logic:summary`,
  `lint:summary`, `typecheck:summary`, and `proof:autonomous:summary`.
  Autonomous status remains read-only with `complete=0/14`; V10 deployed
  identity, signoff, chain/env, host, QA, canary, monitoring, indexer, restore,
  backup, and G1 strict env evidence blockers remain explicit. No browser run,
  endpoint polling beyond existing summary checks, wallet signing,
  transaction, RPC read, live soak, deploy, ABI, randomness, tokenomics, secret
  access, or private RPC access was used.
- Safety Pool client exact claimable epoch recovery now safely narrows bigint
  epoch evidence before updating claim-plan state. `app/hooks/useRebate.ts`
  adds `parseClaimableEpoch` for exact claimable multicall and per-epoch
  fallback reads, rejects malformed/unsafe epochs before adding them to the
  claimable set, and avoids logging broad `Number(epoch)` values on per-epoch
  read failure. Business-logic guards reject returning to
  `claimable.add(Number(...))` or `epoch: Number(epoch)` in the Safety Pool
  client path. Verified with `node --check` for `app/hooks/useRebate.ts` and
  `scripts/test-business-logic.mjs`, plus `test:logic:summary`,
  `lint:summary`, `typecheck:summary`, and `proof:autonomous:summary`.
  Autonomous status remains read-only with `complete=0/14`; V10 deployed
  identity, signoff, chain/env, host, QA, canary, monitoring, indexer, restore,
  backup, and G1 strict env evidence blockers remain explicit. No claim,
  wallet signing, transaction, endpoint polling beyond existing summary checks,
  RPC read, live soak, deploy, ABI, randomness, tokenomics, secret access, or
  private RPC access was used.
- Rebates API exact claimable epoch publication now reuses bounded bigint epoch
  narrowing. `app/api/rebates/route.ts` routes both multicall and per-epoch
  fallback exact claimable rebate epochs through `parseRebateEpochNumber`
  before adding them to `claimableEpochList`, matching the existing recent
  epoch parser and avoiding broad `Number(...)` coercion for chain epoch
  evidence. Business-logic guards reject returning to broad exact/recent
  rebate epoch coercion. Verified with `node --check` for
  `app/api/rebates/route.ts` and `scripts/test-business-logic.mjs`, plus
  `test:logic:summary`, `lint:summary`, `typecheck:summary`, and
  `proof:autonomous:summary`. Autonomous status remains read-only with
  `complete=0/14`; V10 deployed identity, signoff, chain/env, host, QA,
  canary, monitoring, indexer, restore, backup, and G1 strict env evidence
  blockers remain explicit. No rebate claim, wallet signing, transaction,
  endpoint polling beyond existing summary checks, RPC read, live soak, deploy,
  ABI, randomness, tokenomics, secret access, or private RPC access was used.
- Direct chain proof user-reward estimates now validate chain `winningTile`
  evidence before indexing user-bet or tile-pool arrays.
  `scripts/collect-chain-proof.mjs` adds a bounded `parseChainTileId` helper,
  flags resolved epochs with invalid winning tiles as proof issues, and avoids
  broad `Number(epochData[2])` coercion in read-only user reward estimates.
  Business-logic guards reject returning to broad `winningTile` coercion in the
  direct chain proof path. Verified with `node --check` for
  `scripts/collect-chain-proof.mjs` and `scripts/test-business-logic.mjs`,
  `proof:chain:summary`, `test:logic:summary`, `lint:summary`,
  `typecheck:summary`, and `proof:autonomous:summary`. The summary chain proof
  remained read-only with `Would read RPC: false`; strict chain proof still
  fails closed on the external configured-RPC evidence blocker. No RPC read,
  chain reconciliation run, wallet signing, transactions, live soak, deploy,
  ABI, randomness, tokenomics, secret access, or private RPC access was used.
- Client hook numeric compatibility mirrors now share bounded raw-wei display
  formatting. `app/hooks/useDepositHistory.ts`,
  `app/hooks/useGameData.helpers.ts`, `app/hooks/useJackpotHistory.ts`, and
  `app/hooks/useWalletTransfers.ts` now derive `amountNum`, jackpot totals,
  game-data pool mirrors, and transfer numeric summary fields through
  `formatLineaWeiDisplayNumber` instead of parsing
  `formatLineaAmountFixed(value, 6)` strings through `Number(...)`. Exact
  display strings remain on the existing `formatLineaAmountFixed` paths.
  Business-logic guards reject returning to formatted-decimal parsing in these
  hook paths. Verified with `node --check` for the changed hooks and
  `scripts/test-business-logic.mjs`, plus `lint:summary`,
  `test:logic:summary`, `typecheck:summary`, and
  `proof:autonomous:summary`. Autonomous status remains read-only with
  `complete=0/14`; V10 deployed identity, signoff, chain/env, host, QA,
  canary, monitoring, indexer, restore, backup, and G1 strict env evidence
  blockers remain explicit. No browser run, endpoint polling beyond existing
  summary checks, indexer run, wallet signing, transactions, live soak, deploy,
  ABI, randomness, tokenomics, secret access, or private RPC access was used.
- API numeric compatibility mirrors now share bounded raw-wei display-number
  formatting. `app/lib/tokenAmountMath.ts` exports
  `formatLineaWeiDisplayNumber`, which rounds bigint wei values at 6 display
  decimals and caps unsafe large values without parsing formatted decimal
  strings. Deposits, leaderboards, recent-wins, and jackpot service
  `toDisplayNumberWei` helpers now delegate to the shared formatter while exact
  string amount fields remain unchanged. Business-logic guards reject returning
  to `Number(formatLineaAmountFixed(value, 6))` in those API paths. Verified
  with `node --check` for the changed API/helper files and
  `scripts/test-business-logic.mjs`, plus `typecheck:summary`,
  `lint:summary`, `test:logic:summary`, and `proof:autonomous:summary`.
  Autonomous status remains read-only with `complete=0/14`; V10 deployed
  identity, signoff, chain/env, host, QA, canary, monitoring, indexer, restore,
  backup, and G1 strict env evidence blockers remain explicit. No indexer run,
  onchain fetch/recovery run, wallet signing, transactions, live soak, endpoint
  polling, deploy, ABI, randomness, tokenomics, secret access, or private RPC
  access was used.
- Full local `check:summary` was refreshed after the latest indexer,
  chain/indexer audit, and UI history/tile hardening. The gate completed
  successfully: lint, business logic, security follow-up, fetch-timeout,
  stored-number parsing, V9/V10 contract tests, indexer storage, DB operations,
  monitoring drill, build, typecheck, HTTP smoke, and browser smoke all passed.
  `proof:autonomous:summary` was refreshed afterward and still reports
  read-only local mode with `complete=0/14`; V10 deployed identity, signoff,
  chain/env, host, QA, canary, monitoring, indexer, restore, backup, and G1
  strict env evidence blockers remain explicit. This is local evidence only.
  No wallet signing, transactions, live soak, endpoint polling, deploy, ABI,
  randomness, tokenomics, secret access, or private RPC access was used.
- Indexer display numeric amount mirrors now use bounded bigint math instead of
  `parseFloat(formatUnits(...))`. `scripts/indexer.ts` derives
  `totalAmountNum`, jackpot `amountNum`, and reward `rewardNum` through a
  helper that rounds at 6 display decimals and caps unsafe large values, while
  preserving exact string amount fields. Business-logic guards reject returning
  to `parseFloat(formatUnits(args.amount|totalAmount|reward, 18))` in indexer
  normalized event processing. Verified with `node --check` for
  `scripts/indexer.ts` and `scripts/test-business-logic.mjs`, plus
  `typecheck:summary`, `lint:summary`, `test:logic:summary`,
  `test:indexer-storage:summary`, and `proof:autonomous:summary`. Autonomous
  status remains read-only with `complete=0/14`; V10 deployed identity,
  signoff, chain/env, host, QA, canary, monitoring, indexer, restore, backup,
  and G1 strict env evidence blockers remain explicit. No indexer run, onchain
  fetch/recovery run, wallet signing, transactions, live soak, endpoint
  polling, deploy, ABI, randomness, tokenomics, secret access, or private RPC
  access was used.
- Chain/indexer audit proof tooling now safely narrows decoded chain `epoch`
  evidence before window comparisons. `scripts/audit-chain-indexer-window.mjs`
  routes event `args.epoch` through a bigint, positive, safe-integer parser
  before using it for audit-window inclusion, so malformed decoded epoch values
  cannot be broadly coerced into the proof window. Business-logic guards reject
  returning to `Number(args.epoch)` in the audit path. Verified with
  `node --check` for `scripts/audit-chain-indexer-window.mjs` and
  `scripts/test-business-logic.mjs`, plus `typecheck:summary`,
  `lint:summary`, `test:logic:summary`, and `proof:autonomous:summary`.
  Autonomous status remains read-only with `complete=0/14`; V10 deployed
  identity, signoff, chain/env, host, QA, canary, monitoring, indexer, restore,
  backup, and G1 strict env evidence blockers remain explicit. No chain/indexer
  audit run, onchain fetch/recovery run, wallet signing, transactions, live
  soak, endpoint polling, deploy, ABI, randomness, tokenomics, secret access,
  or private RPC access was used.
- Chain/indexer audit proof tooling now compares `winningTile` evidence through
  bounded parsers instead of broad `Number(...)` coercion.
  `scripts/audit-chain-indexer-window.mjs` validates DB `winning_tile` and
  decoded chain `winningTile` values against the canonical 1..25 range before
  comparing resolved epoch rows, making the audit stricter for malformed proof
  inputs. Business-logic guards reject returning to
  `Number(row.winning_tile)` or `Number(args.winningTile)` in the audit path.
  Verified with `node --check` for `scripts/audit-chain-indexer-window.mjs` and
  `scripts/test-business-logic.mjs`, plus `typecheck:summary`,
  `lint:summary`, `test:logic:summary`, and `proof:autonomous:summary`.
  Autonomous status remains read-only with `complete=0/14`; V10 deployed
  identity, signoff, chain/env, host, QA, canary, monitoring, indexer, restore,
  backup, and G1 strict env evidence blockers remain explicit. No chain/indexer
  audit run, onchain fetch/recovery run, wallet signing, transactions, live
  soak, endpoint polling, deploy, ABI, randomness, tokenomics, secret access,
  or private RPC access was used.
- Indexer batch-claim normalization now safely narrows `epochsClaimed` before
  normalized storage writes. `scripts/indexer.ts` rejects malformed or unsafe
  `RewardBatchClaimed` and `RebateBatchClaimed` `uint256` counts before writing
  `batchClaims`, while preserving single-epoch rebate claim handling.
  Business-logic guards reject returning to broad
  `epochsClaimed: Number(args.epochsClaimed)` coercion. Verified with
  `node --check` for `scripts/indexer.ts` and
  `scripts/test-business-logic.mjs`, plus `typecheck:summary`,
  `lint:summary`, `test:logic:summary`, `test:indexer-storage:summary`, and
  `proof:autonomous:summary`. Autonomous status remains read-only with
  `complete=0/14`; V10 deployed identity, signoff, chain/env, host, QA,
  canary, monitoring, indexer, restore, backup, and G1 strict env evidence
  blockers remain explicit. No indexer run, onchain fetch/recovery run, wallet
  signing, transactions, live soak, endpoint polling, deploy, ABI, randomness,
  tokenomics, secret access, or private RPC access was used.
- Analytics blockchain history display now rejects malformed `winningTile`
  values outside 1..`GRID_SIZE`. `app/components/analytics/AnalyticsBlockchainHistoryPanel.tsx`
  parses history rows through a canonical positive-decimal and safe integer
  grid-bound helper before rendering the winner cell, so invalid resolved
  history rows render as unresolved winner evidence instead of `Block #999` or
  user-win badges. Business-logic guards include both source checks and a
  render assertion. Verified with `node --check` for
  `scripts/test-business-logic.mjs`, plus `typecheck:summary`,
  `lint:summary`, `test:logic:summary`, and `proof:autonomous:summary`.
  Autonomous status remains read-only with `complete=0/14`; V10 deployed
  identity, signoff, chain/env, host, QA, canary, monitoring, indexer, restore,
  backup, and G1 strict env evidence blockers remain explicit. No browser run,
  wallet signing, transactions, live soak, endpoint polling, deploy, ABI,
  randomness, tokenomics, secret access, or private RPC access was used.
- Hot-tile UI statistics now reject malformed history `winningTile` values
  outside 1..`GRID_SIZE`. `app/hooks/usePageRuntimeEffects.ts` parses resolved
  history rows through a canonical positive-decimal and safe integer grid-bound
  helper before incrementing hot-tile counts, preventing stale or malformed
  history payloads from surfacing impossible tiles in UI state. Business-logic
  guards reject returning to `Number(round.winningTile)` plus positive-only
  checks. Verified with `node --check` for
  `app/hooks/usePageRuntimeEffects.ts` and `scripts/test-business-logic.mjs`,
  plus `typecheck:summary`, `lint:summary`, `test:logic:summary`, and
  `proof:autonomous:summary`. Autonomous status remains read-only with
  `complete=0/14`; V10 deployed identity, signoff, chain/env, host, QA,
  canary, monitoring, indexer, restore, backup, and G1 strict env evidence
  blockers remain explicit. No browser run, wallet signing, transactions, live
  soak, endpoint polling, deploy, ABI, randomness, tokenomics, secret access,
  or private RPC access was used.
- Hub fee-estimate tile-mask preparation now rejects malformed selected tile
  IDs outside 1..`GRID_SIZE`. `app/components/HubContent.tsx` uses safe integer
  and grid-bound checks before building the bitmap used for gas estimation, so
  stale or malformed selected-tile UI state cannot create an out-of-range
  estimate mask. Business-logic guards reject returning to positive-only tile
  checks. Verified with `node --check` for `scripts/test-business-logic.mjs`,
  plus `typecheck:summary`, `lint:summary`, `test:logic:summary`, and
  `proof:autonomous:summary`. Autonomous status remains read-only with
  `complete=0/14`; V10 deployed identity, signoff, chain/env, host, QA,
  canary, monitoring, indexer, restore, backup, and G1 strict env evidence
  blockers remain explicit. No browser run, wallet signing, transactions, live
  soak, endpoint polling, deploy, ABI, randomness, tokenomics, secret access,
  or private RPC access was used.
- Full local `check:summary` was refreshed after the recent-wins,
  live-state, indexer, and client-side tile-normalization hardening. The gate
  completed successfully: lint, business logic, security follow-up,
  fetch-timeout, stored-number parsing, V9/V10 contract tests, indexer storage,
  DB operations, monitoring drill, build, typecheck, HTTP smoke, and browser
  smoke all passed. `proof:autonomous:summary` was also refreshed afterward and
  still reports read-only local mode with `complete=0/14`; V10 deployed
  identity, signoff, chain/env, host, QA, canary, monitoring, indexer, restore,
  backup, and G1 strict env evidence blockers remain explicit. This is local
  evidence only. No wallet signing, transactions, live soak, endpoint polling,
  deploy, ABI, randomness, tokenomics, secret access, or private RPC access was
  used.
- Client-side tile ID normalization now rejects malformed out-of-range tile IDs
  before UI publication or delegated selection. `app/hooks/useRecentWins.ts`
  drops `tileId` values outside 1..`GRID_SIZE`, `app/hooks/useLeaderboards.ts`
  drops lucky-tile rows outside the same range, and
  `app/components/MiningGrid.tsx` rejects malformed delegated click tile IDs
  before invoking tile selection. Business-logic guards reject returning to
  positive-only tile checks. Verified with `node --check` for
  `app/hooks/useRecentWins.ts`, `app/hooks/useLeaderboards.ts`, and
  `scripts/test-business-logic.mjs`; `app/components/MiningGrid.tsx` is covered
  by `typecheck:summary`/`lint:summary` because `node --check` does not accept
  `.tsx` in this local Node configuration. Also verified with
  `test:logic:summary` and `proof:autonomous:summary`. Autonomous status
  remains read-only with `complete=0/14`; V10 deployed identity, signoff,
  chain/env, host, QA, canary, monitoring, indexer, restore, backup, and G1
  strict env evidence blockers remain explicit. No browser run, wallet signing,
  transactions, live soak, endpoint polling, deploy, ABI, randomness,
  tokenomics, secret access, or private RPC access was used.
- Indexer normalized storage now safely narrows event tile evidence before
  writes. `scripts/indexer.ts` rejects malformed `BetPlaced`,
  `BatchBetsPlaced`, and `BatchBetsSameAmountPlaced` tile IDs outside 1..25,
  rejects batch amount/tile length mismatches, and rejects malformed
  `EpochResolved` `winningTile` evidence in both normal processing and
  reconcile repair before writing `bets` or `epochs`. Business-logic guards
  reject returning to broad `Number(args.tileId)`, `args.tileIds.map(Number)`,
  or `Number(args.winningTile)` coercion. Verified with `node --check` for
  `scripts/indexer.ts` and `scripts/test-business-logic.mjs`, plus
  `typecheck:summary`, `lint:summary`, `test:logic:summary`,
  `test:indexer-storage:summary`, and `proof:autonomous:summary`. Autonomous
  status remains read-only with `complete=0/14`; V10 deployed identity,
  signoff, chain/env, host, QA, canary, monitoring, indexer, restore, backup,
  and G1 strict env evidence blockers remain explicit. No indexer run, onchain
  fetch/recovery run, wallet signing, transactions, live soak, endpoint
  polling, deploy, ABI, randomness, tokenomics, secret access, or private RPC
  access was used.
- Live-state event recovery now safely narrows chain event tile IDs before
  counting unique users per tile. `app/api/live-state/shared.ts` rejects
  `BetPlaced`, `BatchBetsPlaced`, and `BatchBetsSameAmountPlaced` tile IDs
  outside the current grid range before updating recovered tile-user counts,
  while preserving the existing bitmap path. Business-logic guards reject
  returning to broad `Number(args.tileId)` or `args.tileIds.map(Number)`
  coercion. Verified with `node --check` for
  `app/api/live-state/shared.ts` and `scripts/test-business-logic.mjs`, plus
  `typecheck:summary`, `lint:summary`, `test:logic:summary`, and
  `proof:autonomous:summary`. Autonomous status remains read-only with
  `complete=0/14`; V10 deployed identity, signoff, chain/env, host, QA,
  canary, monitoring, indexer, restore, backup, and G1 strict env evidence
  blockers remain explicit. No onchain fetch/recovery run, wallet signing,
  transactions, live soak, endpoint polling, deploy, ABI, randomness,
  tokenomics, secret access, or private RPC access was used.
- Recent-wins API now validates stored epoch `winningTile` evidence before
  publishing tile IDs. `app/api/recent-wins/data.ts` uses the canonical 1..25
  parser for synthetic resolved wins and claim-backed payload rows, so malformed
  epoch-map `winningTile` values cannot influence `computeWinningAmountWei` or
  API `tileId` output. Business-logic guards reject returning to positive-only
  `winningTile` checks. Verified with `node --check` for
  `app/api/recent-wins/data.ts` and `scripts/test-business-logic.mjs`, plus
  `test:logic:summary`, `typecheck:summary`, `lint:summary`, and
  `proof:autonomous:summary`. Autonomous status remains read-only with
  `complete=0/14`; V10 deployed identity, signoff, chain/env, host, QA,
  canary, monitoring, indexer, restore, backup, and G1 strict env evidence
  blockers remain explicit. No onchain fetch/recovery run, wallet signing,
  transactions, live soak, endpoint polling, deploy, ABI, randomness,
  tokenomics, secret access, or private RPC access was used.
- Epochs API chain fallback now validates recovered `winningTile` evidence
  before cache/storage publication. `app/api/epochs/route.ts` rejects resolved
  `epochs(uint256)` rows with winning tiles outside the canonical 1..25 range
  in both multicall and per-epoch fallback paths, preventing malformed chain
  evidence from entering `responseRows` or `resolvedPatch`. Business-logic
  guards reject returning to direct `winningTile: Number(row[2])` publishing.
  Verified with `node --check` for `app/api/epochs/route.ts` and
  `scripts/test-business-logic.mjs`, plus `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, and `proof:autonomous:summary`.
  Autonomous status remains read-only with `complete=0/14`; V10 deployed
  identity, signoff, chain/env, host, QA, canary, monitoring, indexer, restore,
  backup, and G1 strict env evidence blockers remain explicit. No chain
  reconcile run, wallet signing, transactions, live soak, endpoint polling,
  deploy, ABI, randomness, tokenomics, secret access, or private RPC access was
  used.
- Deposits chain recovery now validates event tile IDs before publishing or
  caching recovered rows. `app/api/deposits/route.ts` rejects single and batch
  bet logs with tile IDs outside the canonical 1..25 range, and rejects
  malformed batch amount/tile length mismatches before writing the recovery
  map. Indexed and merged recovered deposits are also filtered after
  normalization so rows with no valid tile evidence are not published. Bitmap
  recovery still uses the existing canonical `tileMaskToTileIds` path.
  Business-logic guards reject returning to broad `Number(args.tileId)`,
  `args.tileIds.map(Number)`, or publishing empty-tile deposit rows. Verified
  with `node --check` for
  `app/api/deposits/route.ts` and `scripts/test-business-logic.mjs`, plus
  `test:logic:summary`, `typecheck:summary`, `lint:summary`, and
  `proof:autonomous:summary`. Autonomous status remains read-only with
  `complete=0/14`; V10 deployed identity, signoff, chain/env, host, QA,
  canary, monitoring, indexer, restore, backup, and G1 strict env evidence
  blockers remain explicit. No chain recovery run, wallet signing,
  transactions, live soak, endpoint polling, deploy, ABI, randomness,
  tokenomics, secret access, or private RPC access was used.
- Daily autonomous maintenance summaries were refreshed in safe read-only/dry-run
  mode. `proof:deps:summary` passed for production dependencies with no
  blocking high/critical issues, `proof:wallet-deps:summary` passed for Privy,
  wagmi, and viem presence, `baseline:bundle:summary` passed current static
  production output budgets, and `cleanup:workspace:dry-run:summary` found no
  deletable cleanup targets. Bundle evidence is from the existing `.next`
  output timestamped `2026-08-01T07:47:36.910Z`; this is maintenance evidence,
  not a fresh production build or launch signoff. No cleanup apply, dependency
  install/update, browser run, wallet signing, transactions, live soak,
  endpoint polling, deploy, ABI, randomness, tokenomics, secret access, or
  private RPC access was used.
- Full local `check:summary` was refreshed after the latest API evidence
  hardening. The gate completed successfully: lint, business logic, security
  follow-up, fetch-timeout, stored-number parsing, V9/V10 contract tests,
  indexer storage, DB operations, monitoring drill, build, typecheck, HTTP
  smoke, and browser smoke all completed. This is local evidence only; it does
  not satisfy external G1-G14 production-like blockers or authorize real wallet
  transactions. No wallet signing, transactions, live soak, deploy, ABI,
  randomness, tokenomics, secret access, or private RPC access was used.
- Reward summary recovery now validates stored and chain-recovered winning tile
  evidence before cache writes and reward reads. `app/api/_lib/rewardSummary.ts`
  rejects winning tiles outside the canonical 1..25 range from both stored epoch
  rows and recovered `epochs(uint256)` tuples, so malformed chain/storage
  evidence cannot populate reward summary cache, `upsertEpochMap`, or
  downstream `userBets`/`tilePools` reads with invalid tile IDs. Business-logic
  guards reject returning to unchecked stored `winningTile > 0` or
  `Number(winningTile)` publishing. Verified with `node --check` for
  `app/api/_lib/rewardSummary.ts` and `scripts/test-business-logic.mjs`, plus
  `test:logic:summary`, `typecheck:summary`, `lint:summary`, and
  `proof:autonomous:summary`. Autonomous status remains read-only with
  `complete=0/14`; V10 deployed identity, signoff, chain/env, host, QA,
  canary, monitoring, indexer, restore, backup, and G1 strict env evidence
  blockers remain explicit. No reward claim, wallet signing, transactions,
  live soak, endpoint polling, deploy, ABI, randomness, tokenomics, secret
  access, or private RPC access was used.
- Rebates API summary evidence now bounds chain `uint256` claimable-count and
  recent-epoch values before publishing them as JS numbers. `app/api/rebates/route.ts`
  uses a saturating non-negative bigint helper for `getRebateSummary`
  claimable counts and an explicit safe-positive-integer helper for recent
  rebate epoch evidence, preventing unsafe chain values from corrupting
  `claimableEpochCount` or recent rebate rows. Business-logic guards reject
  returning to broad `Number(claimableCount)` or broad
  `Number(recentEpochBigInts[index])` coercion. Verified with `node --check`
  for `app/api/rebates/route.ts` and `scripts/test-business-logic.mjs`, plus
  `test:logic:summary`, `typecheck:summary`, `lint:summary`, and
  `proof:autonomous:summary`. Autonomous status remains read-only with
  `complete=0/14`; V10 deployed identity, signoff, chain/env, host, QA,
  canary, monitoring, indexer, restore, backup, and G1 strict env evidence
  blockers remain explicit. No rebate claim, wallet signing, transactions,
  live soak, endpoint polling, deploy, ABI, randomness, tokenomics, secret
  access, or private RPC access was used.
- Epochs API current-epoch cache/reconcile decisions now safely narrow chain
  `uint256` evidence before JS-number use. `app/api/epochs/route.ts` uses an
  explicit bigint safe-positive-integer helper for `currentEpoch()` reads, so
  unsafe chain epoch values cannot update the current-epoch cache or drive
  missing-epoch reconciliation. Business-logic guards reject returning to broad
  `Number(onChainCurrentEpoch)` coercion. Verified with `node --check` for
  `app/api/epochs/route.ts` and `scripts/test-business-logic.mjs`, plus
  `test:logic:summary`, `typecheck:summary`, `lint:summary`, and
  `proof:autonomous:summary`. Autonomous status remains read-only with
  `complete=0/14`; V10 deployed identity, signoff, chain/env, host, QA,
  canary, monitoring, indexer, restore, backup, and G1 strict env evidence
  blockers remain explicit. No chain reconcile run, wallet signing,
  transactions, live soak, endpoint polling, deploy, ABI, randomness,
  tokenomics, secret access, or private RPC access was used.
- Deposits recovery/current-epoch decisions now safely narrow chain `uint256`
  epoch evidence before using it as JS numbers. `app/api/deposits/route.ts`
  uses an explicit bigint safe-positive-integer helper for decoded bet event
  epochs and `currentEpoch()` reads, so malformed or unsafe chain epoch values
  cannot enter recovery filters, cache writes, or background refresh decisions.
  Business-logic guards reject returning to broad `Number(args.epoch)` or
  broad `Number(onChainCurrentEpoch)` coercion. Verified with `node --check`
  for `app/api/deposits/route.ts` and `scripts/test-business-logic.mjs`, plus
  `test:logic:summary`, `typecheck:summary`, `lint:summary`, and
  `proof:autonomous:summary`. Autonomous status remains read-only with
  `complete=0/14`; V10 deployed identity, signoff, chain/env, host, QA,
  canary, monitoring, indexer, restore, backup, and G1 strict env evidence
  blockers remain explicit. No chain recovery run, wallet signing,
  transactions, live soak, endpoint polling, deploy, ABI, randomness,
  tokenomics, secret access, or private RPC access was used.
- Live canary safe-window timing now bounds bigint epoch-window deltas before
  converting them to JS numbers. `scripts/live-round-canary.ts` uses a signed
  safe-integer clamp for `endTime - block.timestamp`, preserving expired-window
  and safe-window semantics while preventing unsafe timestamp deltas from
  corrupting `secondsLeft` evidence, wait timing, or timeout logs. Business-
  logic guards reject returning to direct `Number(endTime - block.timestamp)`.
  Verified with `node --check` for `scripts/live-round-canary.ts` and
  `scripts/test-business-logic.mjs`, plus `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, and `proof:autonomous:summary`.
  Autonomous status remains read-only with `complete=0/14`; V10 deployed
  identity, signoff, chain/env, host, QA, canary, monitoring, indexer, restore,
  backup, and G1 strict env evidence blockers remain explicit. No canary
  execution, wallet signing, transactions, live soak, endpoint polling, deploy,
  ABI, randomness, tokenomics, secret access, or private RPC access was used.
- Indexer current-epoch persistence and reconcile planning now safely narrow
  chain `currentEpoch()` before metadata writes, status payloads, and
  missing-epoch range construction. `scripts/indexer.ts` uses an explicit
  bigint-to-safe-positive-number guard; unsafe chain epoch evidence is skipped
  with a bounded warning and does not overwrite `gamedata/_meta/currentEpoch`
  or drive a huge/unsafe reconcile loop. Reconcile also canonical-parses stored
  epoch keys before `have`/`missing` checks instead of broad `Number(key)`.
  Business-logic guards reject returning to broad `Number(currentEpoch)` and
  broad stored-key coercion. Verified with `node --check` for
  `scripts/indexer.ts` and `scripts/test-business-logic.mjs`, plus
  `test:logic:summary`, `typecheck:summary`, `lint:summary`,
  `proof:autonomous:summary`, and scoped `git diff --check`. Autonomous status
  remains read-only with `complete=0/14`; V10 deployed identity, signoff,
  chain/env, host, QA, canary, monitoring, indexer, restore, backup, and G1
  strict env evidence blockers remain explicit. No indexer run, wallet
  signing, transactions, live soak, endpoint polling, cleanup apply, deploy,
  ABI, randomness, tokenomics, secret access, or private RPC access was used.
- Live-state API now safely narrows chain `currentEpoch()` before indexed
  storage lookups. `app/api/live-state/shared.ts` keeps the public
  `currentEpoch` payload as the raw bigint string, but uses an explicit
  bigint-to-safe-positive-number helper before reading indexed tile users,
  indexed tile pools, or tile-user sets. Unsafe chain epoch evidence now falls
  back to snapshot/indexed fallback data instead of direct `Number(currentEpoch)`
  coercion. Business-logic guards reject returning to broad chain currentEpoch
  coercion. Verified with `node --check` for `app/api/live-state/shared.ts`
  and `scripts/test-business-logic.mjs`, plus `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`, and scoped
  `git diff --check`. Autonomous status remains read-only with
  `complete=0/14`; V10 deployed identity, signoff, chain/env, host, QA,
  canary, monitoring, indexer, restore, backup, and G1 strict env evidence
  blockers remain explicit. No wallet signing, transactions, live soak,
  endpoint polling, cleanup apply, deploy, ABI, randomness, tokenomics, secret
  access, or private RPC access was used.
- Jackpot service recovery now safely narrows chain `uint256` jackpot epoch
  evidence from `getJackpotInfo` before event recovery lookups. `lastDailyEpoch`
  and `lastWeeklyEpoch` use an explicit bigint safe-integer guard instead of
  direct `Number(info[4/5])`, so malformed or unsafe epoch evidence cannot
  create false jackpot freshness/recovery rows. Jackpot block timestamps are
  also bounded before milliseconds conversion and degrade to `null` when unsafe.
  Business-logic guards reject returning to broad chain epoch coercion and
  require the timestamp guard. Verified with `node --check` for
  `app/api/_lib/jackpotsService.ts` and `scripts/test-business-logic.mjs`,
  plus `test:logic:summary`, `typecheck:summary`, `lint:summary`,
  `proof:autonomous:summary`, and scoped `git diff --check`. Autonomous status
  remains read-only with `complete=0/14`; V10 deployed identity, signoff,
  chain/env, host, QA, canary, monitoring, indexer, restore, backup, and G1
  strict env evidence blockers remain explicit. No wallet signing,
  transactions, live soak, endpoint polling, cleanup apply, deploy, ABI,
  randomness, tokenomics, secret access, or private RPC access was used.
- Data-sync health coverage now ignores corrupt or non-canonical stored epoch
  keys before deriving present/missing epoch coverage, and validates indexer
  status metadata before deriving or publishing diagnostics. `app/api/health/data-sync`
  uses a canonical safe decimal parser for `Object.keys(dbEpochs)` instead of
  broad `Number(key)` coercion, and parses `completedAt`/`lastHeartbeatAt` as
  safe non-negative numeric evidence before comparing them. Chain `uint256`
  epoch evidence from `currentEpoch` and jackpot info is narrowed through a
  safe bigint-to-number guard before coverage, jackpot freshness, or degraded
  status checks. Data-sync health and the shared finality helper now also
  saturate non-negative bigint block deltas before lag, progress, catch-up,
  and finality-lag evidence. A DB cursor ahead of the current chain head now
  degrades health and surfaces a scope-check hint instead of deriving a false
  zero/negative lag. The private health response now publishes sanitized
  run/repair/reconcile fields instead of raw `indexer*Status` JSON spreads.
  Business-logic guards reject returning to `Number(k)`,
  `isSafePositiveInteger(n)` post-coercion filtering, broad
  `Number(indexerRunStatus...)` timestamp comparison, broad chain `uint256`
  coercion, broad direct `Number(...)` block-delta coercion, or raw indexer
  metadata spreads. Verified with `node --check
  scripts/test-business-logic.mjs`, `test:logic:summary`, `typecheck:summary`,
  `lint:summary`, `proof:autonomous:summary`, and scoped `git diff --check`.
  Autonomous status remains read-only with `complete=0/14`; V10 deployed
  identity, signoff, chain/env, host, QA, canary, monitoring, indexer, restore,
  backup, and G1 strict env evidence blockers remain explicit. No wallet
  signing, transactions, live soak, endpoint polling, cleanup apply, deploy,
  ABI, randomness, tokenomics, secret access, or private RPC access was used.
- Jackpot OpenGraph preview query parsing now rejects non-canonical `tile` and
  `epoch` integers instead of silently normalizing leading-zero values before
  rendering public reward chips. `app/api/jackpots/og/route.tsx` uses a
  canonical positive decimal guard plus `Number.isSafeInteger`; business-logic
  guards reject returning to leading-zero or unsafe integer parsing. Verified
  with `node --check scripts/test-business-logic.mjs`, `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, and `proof:autonomous:summary`.
  Autonomous status remains read-only with `complete=0/14`; V10 deployed
  identity, signoff, chain/env, host, QA, canary, monitoring, indexer, restore,
  backup, and G1 strict env evidence blockers remain explicit. No wallet
  signing, transactions, live soak, endpoint polling, cleanup apply, deploy,
  ABI, randomness, tokenomics, secret access, or private RPC access was used.
- Chat write APIs now fail closed on over-limit authenticated text/name inputs
  instead of silently truncating them before storage. `app/api/chat/messages`
  rejects message text above `MAX_TEXT_LENGTH` and sender names above
  `MAX_NAME_LENGTH`; `app/api/chat/profile` rejects profile names above
  `MAX_NAME_LENGTH`. Normal UI input caps are unchanged. Verified with
  `node --check scripts/test-business-logic.mjs`, `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, and `proof:autonomous:summary`.
  Autonomous status remains read-only with `complete=0/14`; V10 deployed
  identity, signoff, chain/env, host, QA, canary, monitoring, indexer, restore,
  backup, and G1 strict env evidence blockers remain explicit. No wallet
  signing, transactions, live soak, endpoint polling, cleanup apply, deploy,
  ABI, randomness, tokenomics, secret access, or private RPC access was used.
- Fresh `proof:prelaunch:summary` passed every required local row after the
  full local gate. Current local evidence includes V9/V10 compile, V10 compiler
  advisories, V10 compiler matrix, no-RPC diagnostics, offline identity, V9/V10
  invariants, ABI/indexer storage, fetch timeout, stored-number parsing,
  typecheck, ESLint, production build, bundle baseline, SQLite operations,
  monitoring drill, process-model preflight, business logic, security
  follow-up, dependency audits, wallet dependency integrity, cleanup dry-run,
  launch docs, proof templates/drafts/files, collector redaction, launch map,
  host guard, gate structure, and readiness checklist. The same prelaunch run
  still reports 23 external/status blockers:
  `proof:contract-deployed:v10:summary`, `proof:mainnet:summary`,
  `proof:mainnet:strict:summary`, `proof:signoff:summary`,
  `proof:signoff:strict:summary`, `proof:host:summary`,
  `proof:host:strict:summary`, `proof:indexer:summary`,
  `proof:indexer:strict:summary`, `proof:restore:summary`,
  `proof:restore:strict:summary`, `monitor:runtime:summary`,
  `proof:monitoring:summary`, `proof:monitoring:strict:summary`,
  `proof:qa:summary`, `proof:qa:strict:summary`,
  `proof:testnet:canary:summary`, `proof:testnet:canary:strict:summary`,
  `proof:testnet:canary:v10:summary`, `db:backup:summary`,
  `db:backup:strict:summary`, `proof:launch:strict:summary`, and
  `proof:chain:strict:summary`. Blocker groups are
  `backup=2, canary=3, chain=1, contract=1, env=2, host=2, indexer=2,
  launch=1, monitoring=3, qa=2, restore=2, signoff=2`. No wallet signing,
  transactions, live soak, endpoint polling beyond local proof/smoke, cleanup
  apply, deploy, ABI, randomness, tokenomics, secret access, or private RPC
  access was used.
- Full local `check:summary` passed after the recent API parser hardening. The
  gate completed lint, business logic, security follow-up, fetch timeout,
  stored-number parsing, V9/V10 contract invariants, indexer storage, SQLite
  operations, monitoring drill, production build, typecheck, HTTP smoke, and
  browser smoke against its owned temporary local server. A fresh
  `proof:autonomous:summary` also passed in read-only mode and still reports
  `complete=0/14` with external blockers for V10 deployed identity, signoff,
  chain/env, host, QA, canary, monitoring, indexer, restore, backup, and G1
  strict env evidence. No wallet signing, transactions, live soak, endpoint
  polling outside the local smoke server, cleanup apply, deploy, ABI,
  randomness, tokenomics, secret access, or private RPC access was used.
- Daily autonomous read-only evidence was refreshed. `proof:deps:summary`
  passed for production dependencies with `high=0`, `critical=0`, and
  `blocking=0`; `proof:wallet-deps:summary` passed for Privy, Privy/Wagmi,
  Wagmi, and Viem; `baseline:bundle:summary` passed against the existing
  `.next` production output with `files=225`, `totalBytes=8420775`,
  `jsBytes=7027051`, `cssBytes=216200`, and no budget issues. The aggregate
  `proof:autonomous:daily:summary` also passed CI security, all-dependency
  known-dev-toolchain handling, and cleanup dry-run checks. This is local
  evidence only: no wallet signing, transactions, live soak, endpoint polling,
  cleanup apply, deploy, ABI, randomness, tokenomics, secret access, or private
  RPC access was used, and G1-G14 external launch blockers remain separate.
- Rewards API epoch POST bodies now reject malformed or over-limit epoch arrays
  before cache-key, storage, or reward multicall work. `app/api/rewards/route.ts`
  preserves the missing/non-array `epochs` empty-result behavior, but returns
  `400` with `Invalid epochs` for non-canonical/out-of-range array entries and
  `Too many epochs` when the submitted array exceeds `MAX_EPOCHS_PER_REQUEST`.
  Client deposit-history reward fetches already use 200-epoch chunks, so normal
  UI reward visibility is unchanged. Business-logic guards now require the
  shared strict parser, the 1,000,000 epoch ceiling, and explicit over-limit
  rejection instead of silent truncation. Verified with `node --check` for
  `app/api/rewards/route.ts` and `scripts/test-business-logic.mjs`, plus
  `test:logic:summary`, `typecheck:summary`, `lint:summary`, and
  `proof:autonomous:summary`. Autonomous status remains read-only with
  `complete=0/14`; V10 deployed identity, signoff, chain/env, host, QA, canary,
  monitoring, indexer, restore, and backup evidence blockers remain explicit.
  No wallet signing, transactions, live soak, endpoint polling, cleanup apply,
  deploy, ABI, randomness, tokenomics, secret access, or private RPC access was
  used.
- Epochs API list queries now reject malformed or over-limit `epochs` scopes
  before cache-key, storage, or chain-reconcile work. `app/api/epochs/route.ts`
  returns `400` with `Invalid epochs` for empty/non-canonical/out-of-range list
  items and `Too many epochs` when a request exceeds `MAX_REQUESTED_EPOCHS`;
  the default no-`epochs` route still serves the current cached/indexed epoch
  map. The business-logic guard rejects returning to
  `slice(0, MAX_REQUESTED_EPOCHS)` silent truncation. Verified with
  `node --check` for `app/api/epochs/route.ts` and
  `scripts/test-business-logic.mjs`, plus `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, and `proof:autonomous:summary`.
  Autonomous status remains read-only with `complete=0/14`; V10 deployed
  identity, signoff, chain/env, host, QA, canary, monitoring, indexer, restore,
  and backup evidence blockers remain explicit. No wallet signing,
  transactions, live soak, endpoint polling, cleanup apply, deploy, ABI,
  randomness, tokenomics, secret access, or private RPC access was used.
- Chat profile batch reads now reject over-limit `walletAddresses` requests
  instead of silently truncating the normalized profile list. The route still
  caps parsing at `MAX_REQUESTED_PROFILE_WALLETS + 1`, rejects empty batch
  scopes, normalizes every requested wallet through the chat auth EVM address
  parser, and preserves the single-wallet/profile cache behavior. The
  business-logic guard now requires an explicit `Too many walletAddresses`
  failure path and rejects returning to `slice(0, MAX_REQUESTED_PROFILE_WALLETS)`
  silent truncation. Verified with `node --check` for
  `app/api/chat/profile/route.ts` and `scripts/test-business-logic.mjs`, plus
  `test:logic:summary`, `typecheck:summary`, `lint:summary`, and
  `proof:autonomous:summary`. Autonomous status is still read-only and reports
  `complete=0/14`; external launch blockers remain for V10 deployed identity,
  signoff, chain/env, host, QA, canary, monitoring, indexer, restore, and
  backup evidence. No wallet signing, transactions, live soak, endpoint
  polling, cleanup apply, deploy, ABI, randomness, tokenomics, secret access,
  or private RPC access was used.
- Chat/admin server session cookie parsers now reject non-canonical signed
  token part counts. `app/api/_lib/chatSession.ts` and
  `app/api/_lib/adminSession.ts` require the cookie value to be exactly
  `payload.signature`; suffixed values such as `payload.signature.extra` no
  longer pass through by truncating at `split(".", 2)`. Existing HMAC
  verification, normalized wallet binding, expiry bounds, development
  ephemeral secret behavior, cookie paths, and SameSite/Secure settings are
  unchanged. `test:logic` source-guards both server session helpers against
  returning to two-part truncation. Verified with `node --check` for
  `app/api/_lib/chatSession.ts`, `app/api/_lib/adminSession.ts`, and
  `scripts/test-business-logic.mjs`, plus `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local prelaunch rows pass,
  `proof:prelaunch:summary` still preserves 23 external/status blockers, and
  `proof:autonomous:summary` still reports `complete=0/14`. No cleanup apply,
  live soak start, wallet signing, transactions, deploy, ABI, randomness,
  tokenomics, secret access, private RPC access, endpoint polling, or indexer
  run was used.
- Chat/admin signed auth routes now bind wallet signatures to exact canonical
  product paths. `app/api/_lib/trustedAuthOrigin.ts` exposes
  `isTrustedAuthUri`, and `app/api/chat/auth/route.ts` now requires signed
  messages to use exactly `<trusted-origin>/chat`; `app/api/admin/auth/route.ts`
  requires exactly `<trusted-origin>/admin`. The guard rejects path
  cross-use, query strings, fragments, and credentialed URLs instead of
  accepting any same-origin URI. Normal UI signing still uses
  `window.location.origin + /chat` and `/admin`, so wallet UX and
  `personal_sign` behavior are unchanged. `test:logic` covers the shared guard
  and source-guards both routes against returning to origin-only comparison.
  Verified with `node --check` for `app/api/_lib/trustedAuthOrigin.ts`,
  `app/api/chat/auth/route.ts`, `app/api/admin/auth/route.ts`, and
  `scripts/test-business-logic.mjs`, plus `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local prelaunch rows pass,
  `proof:prelaunch:summary` still preserves 23 external/status blockers, and
  `proof:autonomous:summary` still reports `complete=0/14`. No cleanup apply,
  live soak start, wallet signing, transactions, deploy, ABI, randomness,
  tokenomics, secret access, private RPC access, endpoint polling, or indexer
  run was used.
- Chat/admin signed auth messages now require canonical ISO UTC `issuedAt`
  values. `app/lib/chatAuth.ts` and `app/lib/adminAuth.ts` accept the normal UI
  `new Date().toISOString()` format, but reject broad `Date.parse` inputs such
  as locale/RFC-style date strings before parse/TTL validation. The same helper
  now fails closed when the local `now` clock input is malformed, preserving the
  existing 5-minute proof TTL and 60-second future-skew behavior. `test:logic`
  covers canonical proof acceptance, altered-proof rejection, non-canonical
  `issuedAt` rejection, malformed-clock rejection, and source guards for the
  `toISOString()` round-trip. Verified with `node --check` for
  `app/lib/chatAuth.ts`, `app/lib/adminAuth.ts`, and
  `scripts/test-business-logic.mjs`, plus `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local prelaunch rows pass,
  `proof:prelaunch:summary` still preserves 23 external/status blockers, and
  `proof:autonomous:summary` still reports `complete=0/14`. No cleanup apply,
  live soak start, wallet signing, transactions, deploy, ABI, randomness,
  tokenomics, secret access, private RPC access, endpoint polling, or indexer
  run was used.
- Shared Sentry/support-log sanitizer now redacts inline Basic authorization
  credentials in raw error strings, matching the existing inline Bearer-token
  redaction and object-key/header redaction behavior. `app/lib/sentrySanitize.ts`
  treats `Bearer ...` and `Basic ...` values as auth material before generic
  URL/hex/JWT scrubbing, and `test:logic` covers a raw string containing
  `authorization Basic ...` so encoded credentials cannot leak through API
  error/reporting paths. Support-log transaction-hash preservation remains
  scoped to explicit `txHash`/`transactionHash` keys only. Verified with
  `node --check` for `scripts/test-business-logic.mjs`,
  `test:logic:summary`, `typecheck:summary`, `lint:summary`,
  `proof:autonomous:summary`, and `proof:prelaunch:summary`. Required local
  prelaunch rows pass, `proof:prelaunch:summary` still preserves 23
  external/status blockers, and `proof:autonomous:summary` still reports
  `complete=0/14`. No cleanup apply, live soak start, wallet signing,
  transactions, deploy, ABI, randomness, tokenomics, secret access, private RPC
  access, endpoint polling, or indexer run was used.
- JSON request/response content-type parsing now accepts only
  `application/json` or `application/*+json` for explicit JSON media types.
  `app/api/_lib/boundedJsonBody.ts` rejects non-application suffix values such
  as `text/plain+json` with `unsupported-content-type`, while still accepting
  `application/vnd.lore+json`. `app/lib/readJsonResponse.ts` applies the same
  explicit response content-type policy, while preserving the existing
  missing-content-type fallback. Existing body-size limits, canonical
  `Content-Length` parsing, and raw-body redaction behavior are unchanged.
  `test:logic` covers request and response parser behavior plus source guards.
  Verified with `node --check` for `scripts/test-business-logic.mjs`,
  `test:logic:summary`, `typecheck:summary`, `lint:summary`,
  `proof:autonomous:summary`, and `proof:prelaunch:summary`. Required local
  prelaunch rows pass, `proof:prelaunch:summary` still preserves 23
  external/status blockers, and `proof:autonomous:summary` still reports
  `complete=0/14`. No cleanup apply, live soak start, wallet signing,
  transactions, deploy, ABI, randomness, tokenomics, secret access, private RPC
  access, endpoint polling, or indexer run was used.
- JSON request/response parsing now rejects non-canonical `Content-Length`
  values before body reads. `app/api/_lib/boundedJsonBody.ts` and
  `app/lib/readJsonResponse.ts` require `Content-Length` to be `0` or a
  non-leading-zero decimal safe integer, so leading-zero values like `0001` and
  `01` are rejected the same way as exponent, fractional, negative, or unsafe
  integer lengths. Existing body-size caps, explicit JSON content-type checks,
  oversize stream cancellation, and invalid JSON classification are unchanged.
  `test:logic` covers request and response parsers plus source guards against
  broad length coercion. Verified with `node --check` for
  `scripts/test-business-logic.mjs`, `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local prelaunch rows pass,
  `proof:prelaunch:summary` still preserves 23 external/status blockers, and
  `proof:autonomous:summary` still reports `complete=0/14`. No cleanup apply,
  live soak start, wallet signing, transactions, deploy, ABI, randomness,
  tokenomics, secret access, private RPC access, endpoint polling, or indexer
  run was used.
- Runtime monitor base URL validation now requires an origin-only URL in every
  mode. `scripts/monitor-runtime-health.mjs` rejects
  `RUNTIME_MONITOR_BASE_URL` / `NEXT_PUBLIC_SITE_URL` values with credentials,
  path, query, or hash before summary mode or polling setup can use them;
  `RUNTIME_MONITOR_ALLOW_LOCAL=1` now only relaxes the public HTTPS host
  requirement, not the origin-only shape. `scripts/test-runtime-monitor-drill.mjs`
  covers a local-mode path/query URL and verifies summary mode fails without
  polling, alert sending, endpoint disclosure, or query-material disclosure.
  `scripts/run-monitoring-drill-summary.mjs` now exposes
  `localPathBaseUrlRejected=true` when that regression guard passes.
  `scripts/report-prelaunch-status.mjs` also surfaces that flag in the
  `runtime monitoring drill` row, so the aggregate prelaunch table no longer
  hides this local guard.
  Verified with `node --check` for `scripts/monitor-runtime-health.mjs`,
  `scripts/test-runtime-monitor-drill.mjs`,
  `scripts/report-prelaunch-status.mjs`,
  `scripts/run-monitoring-drill-summary.mjs`, and
  `scripts/test-business-logic.mjs`, plus `test:monitoring:summary`,
  `test:logic:summary`, `typecheck:summary`, `lint:summary`,
  `proof:autonomous:summary`, and `proof:prelaunch:summary`. Required local
  prelaunch rows pass, `proof:prelaunch:summary` still preserves 23
  external/status blockers, and `proof:autonomous:summary` still reports
  `complete=0/14`. No cleanup apply, live soak start, wallet signing,
  transactions, deploy, ABI, randomness, tokenomics, secret access, private RPC
  access, endpoint polling, or indexer run was used.
- Canary health base URL parsing now requires an origin-only URL. `app/lib/canaryHealthTelemetry.ts`
  rejects `LIVE_TEST_HEALTH_BASE_URL` values with credentials, path, query, or
  hash material before any canary health polling configuration can use them.
  The existing HTTPS requirement and localhost HTTP exception are unchanged.
  `test:logic` covers valid localhost/HTTPS origins plus credential, path,
  query, and hash rejection, and source-guards the origin-only check. Verified
  with `node --check` for `scripts/test-business-logic.mjs`,
  `test:logic:summary`, `typecheck:summary`, `lint:summary`,
  `proof:autonomous:summary`, and `proof:prelaunch:summary`. Required local
  prelaunch rows pass, `proof:prelaunch:summary` still preserves 23
  external/status blockers, and `proof:autonomous:summary` still reports
  `complete=0/14`. No cleanup apply, live soak start, wallet signing,
  transactions, deploy, ABI, randomness, tokenomics, secret access, private RPC
  access, endpoint polling, or indexer run was used.
- Canary health telemetry metrics now reject coerced or malformed payload
  values. `app/lib/canaryHealthTelemetry.ts` requires runtime/storage health
  metrics to be non-negative safe integer numbers; `null`, empty strings,
  numeric strings, fractional values, NaN, unsafe integers, and negative values
  fail closed instead of being coerced through `Number(...)`. Localhost HTTP
  and production HTTPS base URL rules are unchanged, and no live canary or
  health endpoint polling was started. `test:logic` covers valid health samples
  plus malformed metrics and source-guards against broad metric coercion.
  Verified with `node --check` for `scripts/test-business-logic.mjs`,
  `test:logic:summary`, `typecheck:summary`, `lint:summary`,
  `proof:autonomous:summary`, and `proof:prelaunch:summary`. Required local
  prelaunch rows pass, `proof:prelaunch:summary` still preserves 23
  external/status blockers, and `proof:autonomous:summary` still reports
  `complete=0/14`. No cleanup apply, live soak start, wallet signing,
  transactions, deploy, ABI, randomness, tokenomics, secret access, private RPC
  access, endpoint polling, or indexer run was used.
- Indexer watchdog restart policy now normalizes malformed failure counters and
  limits before deciding whether to exit for supervisor restart.
  `app/lib/indexerWatchPolicy.ts` keeps the existing valid behavior
  (`recordIndexerWatchFailure(2, 3)` still restarts on the third failure), but
  fractional, NaN, infinite, unsafe, or negative counters are treated as `0`,
  and malformed limits fall back to the default limit of 5. The indexer watch
  loop, finality/reconcile behavior, supervisor exit path, and log output are
  unchanged. `test:logic` covers valid restart behavior plus malformed counters
  and limits, and source-guards against returning to
  `Math.trunc(consecutiveFailures)`. Verified with `node --check` for
  `scripts/test-business-logic.mjs`, `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local prelaunch rows pass,
  `proof:prelaunch:summary` still preserves 23 external/status blockers, and
  `proof:autonomous:summary` still reports `complete=0/14`. No cleanup apply,
  live soak start, wallet signing, transactions, deploy, ABI, randomness,
  tokenomics, secret access, private RPC access, or indexer run was used.
- Chat polling backoff now rejects malformed failure counters before exponential
  delay calculation. `app/lib/chatPollDelay.ts` keeps the existing valid
  cadence for open/hidden/closed chat states, including the 4x cap, but treats
  negative, fractional, NaN, infinite, or unsafe failure counts as `0`, so
  malformed state cannot produce fractional or oversized poll delays. Chat
  request behavior, visibility-specific base intervals, send cooldowns, retry
  parsing, and message normalization are unchanged. `test:logic` covers valid
  delays plus malformed counters and source-guards against direct
  `2 ** failureCount` exponentiation. Verified with `node --check` for
  `scripts/test-business-logic.mjs`, `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local prelaunch rows pass,
  `proof:prelaunch:summary` still preserves 23 external/status blockers, and
  `proof:autonomous:summary` still reports `complete=0/14`. No cleanup apply,
  live soak start, wallet signing, transactions, deploy, ABI, randomness,
  tokenomics, secret access, private RPC access, or indexer run was used.
- Client live-state recovery success counters now require safe integer values
  before disabling fallback live contract reads. `app/hooks/useGameLiveStateSnapshot.ts`
  still disables live reads after two valid consecutive API snapshot successes,
  and still preserves forced live reads, but fractional, NaN, infinite, or
  unsafe success counters no longer prematurely disable the recovery path.
  Fetch cadence, snapshot fallback, localStorage caching, and live-state
  freshness rules are unchanged. `test:logic` covers the valid recovery cases
  plus malformed counters and source-guards the `Number.isSafeInteger` check.
  Verified with `node --check` for `scripts/test-business-logic.mjs`,
  `test:logic:summary`, `typecheck:summary`, `lint:summary`,
  `proof:autonomous:summary`, and `proof:prelaunch:summary`. Required local
  prelaunch rows pass, `proof:prelaunch:summary` still preserves 23
  external/status blockers, and `proof:autonomous:summary` still reports
  `complete=0/14`. No cleanup apply, live soak start, wallet signing,
  transactions, deploy, ABI, randomness, tokenomics, secret access, private RPC
  access, or indexer run was used.
- Client live-state recovery backoff now rejects malformed failure counters
  before computing poll intervals. `app/hooks/useGameLiveStateSnapshot.ts`
  keeps the existing retry cadence for valid counts (`0..2 => 1`, `3 => 2`,
  `5+ => 4`) but treats negative, fractional, NaN, infinite, or unsafe values
  as `0`, so the helper always returns a finite safe interval count and cannot
  produce `NaN` in the polling loop. Live-state fetch timeout, fallback poll
  interval, visibility behavior, localStorage snapshot behavior, and live
  contract-read recovery semantics are unchanged. `test:logic` covers valid
  and malformed counters and source-guards against returning to
  `Math.trunc(consecutiveFailures)`. Verified with `node --check` for
  `scripts/test-business-logic.mjs`, `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local prelaunch rows pass,
  `proof:prelaunch:summary` still preserves 23 external/status blockers, and
  `proof:autonomous:summary` still reports `complete=0/14`. No cleanup apply,
  live soak start, wallet signing, transactions, deploy, ABI, randomness,
  tokenomics, secret access, private RPC access, or indexer run was used.
- Live-state SSR/API timeout helpers now reject invalid timer delays before
  installing timers. `app/api/live-state/shared.ts`,
  `app/api/live-state/route.ts`, and `app/page.tsx` require timeout values to
  be positive safe integers no larger than the JavaScript timer delay cap of
  2147483647ms; invalid values fail closed, and rejected promises are observed
  to avoid late unhandled rejections. Current live-state/request/render timeout
  constants, cache freshness, stale snapshot fallback, background refresh, and
  polling behavior are unchanged. `test:logic` source-guards the API shared,
  route, and homepage SSR timeout helpers. Verified with `node --check` for
  `scripts/test-business-logic.mjs`, `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local prelaunch rows pass,
  `proof:prelaunch:summary` still preserves 23 external/status blockers, and
  `proof:autonomous:summary` still reports `complete=0/14`. No cleanup apply,
  live soak start, wallet signing, transactions, deploy, ABI, randomness,
  tokenomics, secret access, private RPC access, or indexer run was used.
- Fetch, shared promise, and mining RPC timeout helpers now reject invalid timer
  delays before installing timers. `app/lib/fetchWithTimeout.ts`,
  `app/lib/utils.ts`, and `app/hooks/useMining.shared.ts` require `timeoutMs`
  to be a positive safe integer no larger than the JavaScript timer delay cap
  of 2147483647ms, so zero, negative, fractional, NaN, infinite, unsafe, and
  oversized values fail closed. Normal valid-timeout behavior, abort cleanup,
  caller-provided `AbortSignal`, late-rejection suppression, and response
  return behavior are unchanged. `scripts/test-fetch-with-timeout.ts` covers
  invalid fetch timeout values, and `test:logic` covers/source-guards shared
  `withTimeout` and `withMiningRpcTimeout` validation. Verified with
  `node --check` for `scripts/test-business-logic.mjs`,
  `test:fetch-timeout:summary`, `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local prelaunch rows pass,
  `proof:prelaunch:summary` still preserves 23 external/status blockers, and
  `proof:autonomous:summary` still reports `complete=0/14`. No cleanup apply,
  live soak start, wallet signing, transactions, deploy, ABI, randomness,
  tokenomics, secret access, private RPC access, or indexer run was used.
- Client JSON response parsing now rejects invalid byte limits before reading a
  response body. `app/lib/readJsonResponse.ts` normalizes `maxBytes` through
  `normalizeJsonResponseMaxBytes`, fails closed on zero, negative, fractional,
  unsafe, NaN, or infinite limits, and then uses the normalized `byteLimit` for
  both Content-Length and streamed body enforcement. Existing explicit JSON
  content-type checks, malformed Content-Length rejection, response-body
  redaction, and oversized stream cancellation remain unchanged. `test:logic`
  covers invalid `maxBytes` values with a body getter that would throw if read,
  and source-guards the normalization path. Verified with `node --check` for
  `scripts/test-business-logic.mjs`, plus `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local prelaunch rows pass,
  `proof:prelaunch:summary` still preserves 23 external/status blockers, and
  `proof:autonomous:summary` still reports `complete=0/14`. No cleanup apply,
  live soak start, wallet signing, transactions, deploy, ABI, randomness,
  tokenomics, secret access, private RPC access, or indexer run was used.
- Rewards API epoch normalization now stops at the bounded unique epoch limit
  instead of mapping/filtering a full submitted array before applying
  `MAX_EPOCHS_PER_REQUEST`. `app/api/rewards/route.ts` keeps the same strict
  `parsePositiveIntegerValue` parser, same first-unique ordering, same request
  body byte limit, and same cache key shape for valid requests, but it now
  breaks once 400 unique epoch IDs have been accepted. `test:logic` source-
  guards the bounded loop and rejects the old full-array `map(...).slice(...)`
  shape. Verified with `node --check` for `app/api/rewards/route.ts` and
  `scripts/test-business-logic.mjs`, plus `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local prelaunch rows pass,
  `proof:prelaunch:summary` still preserves 23 external/status blockers, and
  `proof:autonomous:summary` still reports `complete=0/14`. No cleanup apply,
  live soak start, wallet signing, transactions, deploy, ABI, randomness,
  tokenomics, secret access, private RPC access, or indexer run was used.
- Server chat/admin session cookies now strictly normalize signed `expiresAt`
  values before accepting a payload. `app/api/_lib/chatSession.ts` and
  `app/api/_lib/adminSession.ts` expose `normalizeChatSessionExpiresAt` /
  `normalizeAdminSessionExpiresAt`; signed cookies now require a finite safe
  integer timestamp, reject expired values, reject fractional/unsafe values, and
  reject far-future expiries beyond the configured session TTL plus a small
  skew window. Normal session issuance, HMAC signing, cookie scope, wallet
  normalization, and production secret requirements are unchanged.
  `test:logic` covers valid, string, fractional, unsafe, expired, and
  far-future expiries for both server session helpers and source-guards against
  returning to raw `parsed.expiresAt` acceptance. Verified with `node --check`
  for `app/api/_lib/chatSession.ts`, `app/api/_lib/adminSession.ts`, and
  `scripts/test-business-logic.mjs`, plus `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local prelaunch rows pass,
  `proof:prelaunch:summary` still preserves 23 external/status blockers, and
  `proof:autonomous:summary` still reports `complete=0/14`. No cleanup apply,
  live soak start, wallet signing, transactions, deploy, ABI, randomness,
  tokenomics, secret access, private RPC access, or indexer run was used.
- Admin auth replay-lock keys are now bounded and do not store raw URI-bearing
  proof strings. `app/api/admin/auth/route.ts` hashes
  `address:nonce:uri` with SHA-256 before using the key for local or external
  replay locks, matching the safer chat-auth boundary while preserving the same
  proof validation, wallet allowlist, TTL, and shared-lock behavior.
  `test:logic` source-guards the hashed proof key and rejects the old raw
  `address:nonce:uri` key shape. Verified with `node --check` for
  `app/api/admin/auth/route.ts` and `scripts/test-business-logic.mjs`, plus
  `test:logic:summary`, `typecheck:summary`, `lint:summary`,
  `proof:autonomous:summary`, and `proof:prelaunch:summary`. Required local
  prelaunch rows pass, `proof:prelaunch:summary` still preserves 23
  external/status blockers, and `proof:autonomous:summary` still reports
  `complete=0/14`. No cleanup apply, live soak start, wallet signing,
  transactions, deploy, ABI, randomness, tokenomics, secret access, private RPC
  access, or indexer run was used.
- Page wallet overview balance cache and active-wallet comparison now validate
  wallet addresses with EVM parsing instead of raw lowercasing. `app/hooks/usePageWalletOverview.ts`
  exposes `normalizePageWalletAddress` and `getPrivyBalanceCacheKey`; malformed
  cache-key addresses return `null`, and the active embedded-wallet comparison
  only succeeds after both addresses normalize through `viem.getAddress(...)`.
  Cached balance number normalization remains unchanged. `test:logic` covers
  checksummed, malformed, and null addresses, plus a cache-key regression and
  source guards against `address.toLowerCase()` / `normalizedEmbeddedAddress.toLowerCase()`
  comparisons. Verified with `node --check` for
  `app/hooks/usePageWalletOverview.ts` and `scripts/test-business-logic.mjs`,
  plus `test:logic:summary`, `typecheck:summary`, `lint:summary`,
  `proof:autonomous:summary`, and `proof:prelaunch:summary`. Required local
  prelaunch rows pass, `proof:prelaunch:summary` still preserves 23
  external/status blockers, and `proof:autonomous:summary` still reports
  `complete=0/14`. No cleanup apply, live soak start, wallet signing,
  transactions, deploy, ABI, randomness, tokenomics, secret access, private RPC
  access, or indexer run was used.
- Wallet transfer scan/filter addresses now fail closed through EVM address
  parsing before any token log query. `app/hooks/useWalletTransfers.ts` exposes
  `normalizeWalletTransferAddress`, lowercases `viem.getAddress(...)` output,
  uses the normalized embedded address for topic padding/cache keys, and
  returns an empty summary when a provided external wallet address is malformed
  instead of broadening the filter to `any`. Existing transaction-hash
  suppression remains in place for public transfer rows. `test:logic` covers a
  checksummed address, malformed address, null address, and source-guards
  against raw address lowercasing or `pad(embeddedAddress as Hex)`. Verified
  with `node --check` for `app/hooks/useWalletTransfers.ts` and
  `scripts/test-business-logic.mjs`, plus `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local prelaunch rows pass,
  `proof:prelaunch:summary` still preserves 23 external/status blockers, and
  `proof:autonomous:summary` still reports `complete=0/14`. No cleanup apply,
  live soak start, wallet signing, transactions, deploy, ABI, randomness,
  tokenomics, secret access, private RPC access, or indexer run was used.
- Wallet transfer history now suppresses malformed transaction hashes before
  they can become Lineascan links. `app/hooks/useWalletTransfers.ts` exposes
  `normalizeWalletTransferTxHash` and uses it for inbound and outbound public
  transfer rows; only full 32-byte hashes are preserved, lowercased. The
  fallback dedupe key still uses the raw event log identity plus block,
  transaction index, and log index, so distinct logs from one transaction remain
  separate while malformed tx hashes are not published to the UI. `test:logic`
  covers malformed and mixed-case full transfer hashes and source-guards against
  raw `log.transactionHash` publication. Verified with `node --check` for
  `app/hooks/useWalletTransfers.ts` and `scripts/test-business-logic.mjs`, plus
  `test:logic:summary`, `typecheck:summary`, `lint:summary`,
  `proof:autonomous:summary`, and `proof:prelaunch:summary`. Required local
  prelaunch rows pass, `proof:prelaunch:summary` still preserves 23
  external/status blockers, and `proof:autonomous:summary` still reports
  `complete=0/14`. No cleanup apply, live soak start, wallet signing,
  transactions, deploy, ABI, randomness, tokenomics, secret access, private RPC
  access, or indexer run was used.
- Deposits API public rows now use the same full 32-byte transaction-hash
  boundary as deposit storage identity and Analytics cache. `app/api/deposits/route.ts`
  uses `normalizeDepositTxHash` for indexed rows and all chain-recovery bet
  event shapes before rows are returned or persisted through recovery; malformed
  chain or stored tx hashes become `""` instead of public explorer-capable
  transaction identity. `test:logic` source-guards the route against raw
  `log.transactionHash`, `log.transactionHash ?? ""`, or stored `txHash`
  publication while preserving the existing `epoch_nohash_blockNumber` fallback
  for storage keys. Verified with `node --check` for
  `app/api/deposits/route.ts` and `scripts/test-business-logic.mjs`, plus
  `test:logic:summary`, `typecheck:summary`, `lint:summary`,
  `proof:autonomous:summary`, and `proof:prelaunch:summary`. Required local
  prelaunch rows pass, `proof:prelaunch:summary` still preserves 23
  external/status blockers, and `proof:autonomous:summary` still reports
  `complete=0/14`. No cleanup apply, live soak start, wallet signing,
  transactions, deploy, ABI, randomness, tokenomics, secret access, private RPC
  access, or indexer run was used.
- Deposit history API/cache mapping now only preserves full 32-byte
  transaction hashes for Lineascan links. `app/hooks/useDepositHistory.ts`
  shares `normalizeDepositTxHash` between cached deposit rows and API-mapped
  deposit rows; malformed API tx hashes become `""`, and mixed-case cached
  hashes are canonicalized to lowercase instead of being preserved verbatim.
  Runtime `test:logic` coverage proves malformed API hashes are suppressed and
  cached full hashes are lowercased, with source guards against raw
  `txHash: d.txHash` and the old case-preserving cache regex. Verified with
  `node --check` for `app/hooks/useDepositHistory.ts` and
  `scripts/test-business-logic.mjs`, plus `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local prelaunch rows pass,
  `proof:prelaunch:summary` still preserves 23 external/status blockers, and
  `proof:autonomous:summary` still reports `complete=0/14`. No cleanup apply,
  live soak start, wallet signing, transactions, deploy, ABI, randomness,
  tokenomics, secret access, private RPC access, or indexer run was used.
- Jackpot history now suppresses malformed transaction hashes before they can
  become explorer-capable API or cached UI data. `app/api/_lib/jackpotsService.ts`
  uses `normalizeJackpotTxHash` for jackpot logs, stored rows, and onchain
  recovery rows before public payloads or `patchStorage`; only full 32-byte
  hashes are preserved, lowercased. `app/hooks/useJackpotHistory.ts` applies the
  same full-hash rule when normalizing API/localStorage rows, so old cache data
  with short hashes such as `0xabc` becomes an empty tx hash instead of a
  Lineascan link candidate. `test:logic` covers malformed and valid full jackpot
  tx hashes and source-guards the API/hook against raw txHash publication.
  Verified with `node --check` for `app/api/_lib/jackpotsService.ts`,
  `app/hooks/useJackpotHistory.ts`, and `scripts/test-business-logic.mjs`, plus
  `test:logic:summary`, `typecheck:summary`, `lint:summary`,
  `proof:autonomous:summary`, and `proof:prelaunch:summary`. Required local
  prelaunch rows pass, `proof:prelaunch:summary` still preserves 23
  external/status blockers, and `proof:autonomous:summary` still reports
  `complete=0/14`. No cleanup apply, live soak start, wallet signing,
  transactions, deploy, ABI, randomness, tokenomics, secret access, private RPC
  access, or indexer run was used.
- Chain/indexer audit window derivation now strict-parses DB epoch and block
  rows before RPC/log reconciliation. `scripts/audit-chain-indexer-window.mjs`
  validates scoped epoch ids, resolved blocks, first bet block, and
  dust-settlement metadata epochs as canonical safe integers through
  `parseDbInteger`; corrupted DB values now fail the audit explicitly instead
  of flowing through broad `Number(...)` or `BigInt(...)` coercion. `test:logic`
  source-guards the audit script against broad env/end-epoch/DB epoch coercion
  and requires the DB parser to cover both audit-window derivation and row
  comparison. Verified with `node --check` for
  `scripts/audit-chain-indexer-window.mjs` and
  `scripts/test-business-logic.mjs`, plus `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local prelaunch rows pass,
  `proof:prelaunch:summary` still preserves 23 external/status blockers, and
  `proof:autonomous:summary` still reports `complete=0/14`. No cleanup apply,
  live soak start, wallet signing, transactions, deploy, ABI, randomness,
  tokenomics, secret access, private RPC access, or indexer run was used.
- Chain/indexer reconciliation tooling now uses the same full transaction
  identity boundary as normalized indexer storage. `scripts/audit-chain-indexer-window.mjs`
  requires a full 32-byte transaction hash and present log index before building
  normalized financial event ids, and bet reconciliation now builds seen keys
  only from full hashes. Malformed transaction identity in chain logs is treated
  as an audit mismatch instead of becoming a synthetic `nohash_0` id or a raw
  lowercase tx key that could hide DB/chain drift. `test:logic` source-guards
  the audit script against synthetic nohash event ids, raw lowercase bet keys,
  and raw rebate batch skip hashes. Verified with `node --check` for
  `scripts/audit-chain-indexer-window.mjs` and
  `scripts/test-business-logic.mjs`, plus `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local prelaunch rows pass,
  `proof:prelaunch:summary` still preserves 23 external/status blockers, and
  `proof:autonomous:summary` still reports `complete=0/14`. No cleanup apply,
  live soak start, wallet signing, transactions, deploy, ABI, randomness,
  tokenomics, secret access, private RPC access, or indexer run was used.
- Scoped participating-epoch pagination now rejects malformed DB epoch rows and
  invalid page limits at the storage boundary. `server/storage.ts` reuses
  `parseSafePositiveIntegerString` when reading distinct participation epochs
  for claim/rebate pagination, so fractional, exponent, negative, empty, or
  unsafe SQLite values cannot become claim-candidate or rebate-history cursors.
  `normalizePageLimit` also defaults invalid caller limits such as `NaN` before
  SQL `LIMIT` use. `scripts/test-indexer-event-storage.ts` inserts a corrupted
  current-scope bet row and proves pagination ignores it while recovering to
  the default limit for invalid callers; `test:logic` source-guards storage
  against raw `Number(row.epoch ?? ...)` pagination coercion. Verified with
  `node --check` for `server/storage.ts`, `scripts/test-business-logic.mjs`,
  and `scripts/test-indexer-event-storage.ts`, plus
  `test:indexer-storage:summary`, `test:logic:summary`, `typecheck:summary`,
  `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local prelaunch rows pass,
  `proof:prelaunch:summary` still preserves 23 external/status blockers, and
  `proof:autonomous:summary` still reports `complete=0/14`. No cleanup apply,
  live soak start, wallet signing, transactions, deploy, ABI, randomness,
  tokenomics, secret access, private RPC access, or indexer run was used.
- Indexer bet and normalized financial-event storage ids now use the same full
  32-byte transaction-hash identity rule as the deposits API and central scoped
  storage. `scripts/indexer.ts` no longer treats short or malformed hex strings
  as bet transaction identity in `buildBetKey`; malformed bet hashes fall back
  to `epoch_nohash_blockNumber`. `buildNormalizedEventId` now also validates a
  full transaction hash plus present `logIndex` before creating ids for
  reward/rebate claims, batch claims, dust settlements, resolver rewards, and
  protocol fee flushes. `test:logic` source-guards the indexer against
  returning to raw `transactionHash.toLowerCase()` event ids or the broad
  `0x[0-9a-f]+` matcher, and a repo search for that broad matcher in
  `app`, `scripts`, `server`, and `config` returns no matches. Verified with
  `node --check` for `scripts/indexer.ts` and
  `scripts/test-business-logic.mjs`, plus `test:logic:summary`,
  `test:indexer-storage:summary`, `typecheck:summary`, `lint:summary`,
  `proof:autonomous:summary`, and `proof:prelaunch:summary`. Required local
  prelaunch rows still pass, `proof:prelaunch:summary` still preserves 23
  external/status blockers, and `proof:autonomous:summary` still reports
  `complete=0/14`. No cleanup apply, live soak start, wallet signing,
  transactions, deploy, ABI, randomness, tokenomics, secret access, private RPC
  access, or indexer run was used.
- Central scoped bet storage now uses the same full 32-byte transaction-hash
  identity rule as the deposits API. `server/storage.ts` no longer treats short
  or malformed hex strings such as `0x01` as transaction identity in
  `buildDepositKey`; those rows fall back to the existing
  `epoch_nohash_blockNumber` key. `scripts/test-indexer-event-storage.ts`
  now uses full mock transaction hashes for the idempotent bet replay fixture,
  preserving legitimate uppercase/lowercase replay coverage under the stricter
  rule. `test:logic` source-guards `server/storage.ts` against returning to
  the broad `0x[0-9a-f]+` matcher. Verified with `node --check` for
  `server/storage.ts`, `scripts/test-business-logic.mjs`, and
  `scripts/test-indexer-event-storage.ts`, plus `test:indexer-storage:summary`,
  `test:db-operations:summary`, `test:logic:summary`, `typecheck:summary`,
  `lint:summary`, `proof:autonomous:summary`, and `proof:prelaunch:summary`.
  Required local prelaunch rows still pass, `proof:prelaunch:summary` still
  preserves 23 external/status blockers, and `proof:autonomous:summary` still
  reports `complete=0/14`. No cleanup apply, live soak start, wallet signing,
  transactions, deploy, ABI, randomness, tokenomics, secret access, private RPC
  access, or indexer run was used.
- Recent-wins reward-claim storage identity now trusts only full 32-byte
  transaction hashes. `normalizeClaimTxIdentity` lowercases full hashes, while
  missing, short, or malformed hashes fall back to
  `nohash_blockNumber_user_epoch` via `buildRewardClaimStorageIdentity` for
  both merge dedupe and storage upsert. Public recent-wins payloads and the
  snapshot watermark also suppress malformed tx hashes instead of exposing them
  as explorer-capable transaction identity. `test:logic` source-guards
  `app/api/recent-wins/data.ts` against returning to raw
  `row.txHash_user_epoch` or `row.txHash || "nohash"` keys. Verified with
  `node --check` for `app/api/recent-wins/data.ts` and
  `scripts/test-business-logic.mjs`, plus `test:logic:summary`,
  `typecheck:summary`, `lint:summary`, `proof:autonomous:summary`, and
  `proof:prelaunch:summary`. Required local prelaunch rows still pass,
  `proof:prelaunch:summary` still preserves 23 external/status blockers, and
  `proof:autonomous:summary` still reports `complete=0/14`. No cleanup apply,
  live soak start, wallet signing, transactions, deploy, ABI, randomness,
  tokenomics, secret access, private RPC access, or indexer run was used.
- Deposits API normalized event keys now treat only full 32-byte transaction
  hashes as transaction identity. `buildDepositKey` still lowercases valid tx
  hashes, but short or malformed hex strings such as partial `0x...` samples
  now fall back to the existing `epoch_nohash_blockNumber` key instead of
  becoming false tx-hash storage identity. `test:logic` source-guards
  `app/api/deposits/route.ts` against returning to the broad `0x[0-9a-f]+`
  matcher. Verified with `node --check` for `app/api/deposits/route.ts` and
  `scripts/test-business-logic.mjs`, plus `test:logic:summary`,
  `proof:autonomous:summary`, `proof:prelaunch:summary`,
  `typecheck:summary`, and `lint:summary`. Required local prelaunch rows still
  pass, `proof:prelaunch:summary` still preserves 23 external/status blockers,
  and `proof:autonomous:summary` still reports `complete=0/14`. No cleanup
  apply, live soak start, wallet signing, transactions, deploy, ABI,
  randomness, tokenomics, secret access, private RPC access, or indexer run was
  used.
- Deposit-history cache normalization now canonical-parses cached epoch,
  block-number, tile, amount, reward, and winning-tile evidence before
  publishing Analytics UI data. Legacy-compatible canonical strings such as
  `"2"` still normalize, while leading-zero integers, exponent notation,
  fractional tile ids, non-canonical block/epoch strings, negative values, and
  unsafe integers are rejected as skipped rows, empty fields, `0`, or `null`.
  `test:logic` covers malformed cached deposit entries and source-guards
  `app/hooks/useDepositHistory.ts` against broad `Number(...)` coercion in the
  cached amount/tile/reward path. Verified with `node --check` for
  `app/hooks/useDepositHistory.ts` and `scripts/test-business-logic.mjs`, plus
  `test:logic:summary`, `proof:autonomous:summary`, `proof:prelaunch:summary`,
  `typecheck:summary`, and `lint:summary`. Required local prelaunch rows still
  pass, `proof:prelaunch:summary` still preserves 23 external/status blockers,
  and `proof:autonomous:summary` still reports `complete=0/14`. No cleanup
  apply, live soak start, wallet signing, transactions, deploy, ABI,
  randomness, tokenomics, secret access, or private RPC access was used.
- Safety Pool rebate client normalization now canonical-parses API/cache epoch,
  count, and cursor evidence before using it in UI state. `claimableEpochCount`,
  `totalEpochs`, claimable/participating epoch arrays, recent-epoch rows, and
  history `nextCursor` accept safe non-negative integers or canonical decimal
  strings only; malformed values such as leading-zero strings, exponent
  notation, fractional numbers, negative values, and unsafe integers collapse
  to `0`, `null`, or skipped rows. `test:logic` covers malformed rebate
  payloads and source-guards `app/hooks/useRebate.ts` against broad
  `Number(...)` coercion in this path. Verified with `node --check` for
  `app/hooks/useRebate.ts` and `scripts/test-business-logic.mjs`, plus
  `test:logic:summary`, `proof:autonomous:summary`, `proof:prelaunch:summary`,
  `typecheck:summary`, and `lint:summary`. Required local prelaunch rows still
  pass, `proof:prelaunch:summary` still preserves 23 external/status blockers,
  and `proof:autonomous:summary` still reports `complete=0/14`. No cleanup
  apply, live soak start, wallet signing, transactions, deploy, ABI,
  randomness, tokenomics, secret access, or private RPC access was used.
- Standard wallet and Auto-Miner flows now have a focused source guard that
  keeps the removed delegated-wallet experiment out of ordinary mining,
  betting, wallet-action, wallet-transfer, manual-mine, and Auto-Miner
  runtime entrypoints. `test:logic` checks the curated standard-flow file list
  for removed delegated-wallet markers, `authorizationList`, removed
  diagnostics/deploy hooks, and delegated-wallet wording, complementing the
  broader active-source removal
  guard without changing runtime behavior. Verified with `node --check` for
  `scripts/test-business-logic.mjs`, plus `test:logic:summary`,
  `proof:autonomous:summary`, `proof:prelaunch:summary`, `typecheck:summary`,
  and `lint:summary`. Required local prelaunch rows still pass,
  `proof:prelaunch:summary` still preserves 23 external/status blockers, and
  `proof:autonomous:summary` still reports `complete=0/14`. No cleanup apply,
  live soak start, wallet signing, transactions, deploy, ABI, randomness,
  tokenomics, secret access, or private RPC access was used.
- Autonomous deployed V10 identity summaries now sanitize child JSON `status`
  before printing the operator row. `summarizeV10Deployed` uses a safe
  lowercase status token formatter instead of raw `parsed.status`, while still
  preserving the read-only deployed identity facts: network, chain id, bytecode
  sizes, runtime flags, metadata-only mismatch, transactionSent, and assertion
  failures. `test:logic` source-guards the row against returning to raw
  `status=${parsed.status}` interpolation. Verified with `node --check` for
  `scripts/report-autonomous-status.mjs` and
  `scripts/test-business-logic.mjs`, plus `test:logic:summary`,
  `proof:autonomous:summary`, `proof:prelaunch:summary`, `typecheck:summary`,
  and `lint:summary`. Required local prelaunch rows still pass,
  `proof:prelaunch:summary` still preserves 23 external/status blockers, and
  `proof:autonomous:summary` still reports `complete=0/14`. No cleanup apply,
  live soak start, wallet signing, transactions, deploy, ABI, randomness,
  tokenomics, secret access, or private RPC access was used.
- Prelaunch JSON summaries now sanitize routine child metadata before printing
  compact operator rows. Child `status` fields go through safe status tokens;
  compiler/source/target/role/mode/evm metadata go through bounded info tokens
  that reject address-like values; wallet dependency versions go through a
  semver-shaped formatter. `test:logic` source-guards the formatter against
  returning to raw `parsed.status`, compiler/source/target, role/mode, or
  wallet-version interpolation. Verified with `node --check` for
  `scripts/report-prelaunch-status.mjs` and
  `scripts/test-business-logic.mjs`, plus `test:logic:summary`,
  `proof:prelaunch:summary`, `proof:autonomous:summary`, `typecheck:summary`,
  and `lint:summary`. Required local prelaunch rows still pass,
  `proof:prelaunch:summary` still preserves 23 external/status blockers, and
  `proof:autonomous:summary` still reports `complete=0/14`. No cleanup apply,
  live soak start, wallet signing, transactions, deploy, ABI, randomness,
  tokenomics, secret access, or private RPC access was used.
- Prelaunch status summaries now convert generic child `Summary:` proof lines
  into structured operator tokens before printing them. Mainnet env rows emit
  `failing`, `groups`, and token samples; chain/signoff/host/indexer/restore,
  monitoring, QA, canary, and launch blockers emit bounded `issues`, `gates`,
  `groups`, and redacted `issue` tokens; ready local proof rows emit
  `status=ready` plus a short summary token. `test:logic` source-guards the
  formatter against returning to raw mainnet env summary interpolation or raw
  `if (summary) return summary` fallback replay. Verified with `node --check`
  for `scripts/report-prelaunch-status.mjs` and
  `scripts/test-business-logic.mjs`, plus `test:logic:summary` and
  `proof:prelaunch:summary`. Required local prelaunch rows still pass and
  `proof:prelaunch:summary` still preserves 23 external/status blockers. No
  cleanup apply, live soak start, wallet signing, transactions, deploy, ABI,
  randomness, tokenomics, secret access, or private RPC access was used.
- Autonomous testnet soak status aggregation now parses the compact
  `status=` row into explicit typed fields before printing operator evidence.
  The `soak:testnet:status:compact` row in `proof:autonomous:summary` is
  rebuilt from bounded status, boolean, non-negative integer, health, disk,
  role, preflight, and failure-group fields instead of replaying the raw compact
  line. Unsafe aggregate values, long values, and address-like tokens collapse
  to safe fallbacks. `test:logic` source-guards the parser and rejects returning
  to raw `status=` line replay in `summarizeSoak`. Verified with `node --check`
  for `scripts/report-autonomous-status.mjs` and
  `scripts/test-business-logic.mjs`, plus `test:logic:summary`,
  `proof:autonomous:summary`, `proof:prelaunch:summary`, `typecheck:summary`,
  and `lint:summary`. Required local prelaunch rows still pass,
  `proof:prelaunch:summary` still preserves 23 external/status blockers, and
  `proof:autonomous:summary` still reports `complete=0/14`. No cleanup apply,
  live soak start, wallet signing, transactions, deploy, ABI, randomness,
  tokenomics, secret access, or private RPC access was used.
- Autonomous and prelaunch status summaries now tokenize generic compact JSON
  `groups` and `issue` fields before printing operator evidence. Prelaunch
  also sanitizes line-derived mainnet and remaining-gate group summaries before
  reprinting them, and autonomous G1 env status now sanitizes line-derived
  group and token-sample rows. Backup, runtime-monitor, mainnet, and
  remaining-gate child summaries can still surface compact blocker context, but
  only as safe `group=count` tokens and redacted lowercase issue tokens;
  arbitrary raw child JSON or line-derived group text can no longer become
  visible `proof:autonomous:summary` or `proof:prelaunch:summary` issue/group
  output. Group lists are bounded at 16 safe entries so normal G1 domains such
  as `rpc-site=4` remain visible instead of being silently dropped.
  `proof:autonomous:summary` now also lifts sanitized `Remaining gate groups`
  ahead of the long remaining-gate summary text, so all current launch-gate
  domains stay visible before row clamping. The autonomous remaining-gate row
  now emits structured tokens for completion, next gate, next group, autonomous
  next command, and summary text instead of reprinting raw child lines.
  Autonomous line-based proof blockers for signoff, host, QA, canary, launch,
  chain, indexer, and restore now emit structured `manifest`, `issues`,
  `gates`, `groups`, and redacted `issue` tokens instead of replaying raw
  `Manifest:`, `Summary:`, `Network:`, `Canary log:`, or `Profile:` lines.
  `test:logic` source-guards both status aggregators against returning to raw
  `parsed.groups` / `parsed.issue` interpolation, raw G1 group/token lines, or
  raw remaining-gate and proof-blocker line fields.
  Verified with `node --check` for `scripts/report-autonomous-status.mjs`,
  `scripts/report-prelaunch-status.mjs`, and
  `scripts/test-business-logic.mjs`, plus `test:logic:summary`,
  `proof:autonomous:summary`, `proof:prelaunch:summary`, `typecheck:summary`,
  and `lint:summary`. Required local prelaunch rows still pass,
  `proof:prelaunch:summary` still preserves 23 external/status blockers, and
  `proof:autonomous:summary` still reports `complete=0/14`. No cleanup
  apply, endpoint polling beyond existing summary checks, wallet signing,
  transactions, deploy, ABI, randomness, tokenomics, secret access, or private
  RPC access was used.
- V10 invariant, ABI/indexer storage, SQLite operations, and runtime monitoring
  compact summary wrappers now canonicalize emitted proof counters with a local
  non-negative safe-integer helper. Negative safe integers from child JSON can
  no longer become valid wrapper evidence for invariant cases, category counts,
  backup/retention/foreign-row counts, or monitoring alert/recovery/delivery
  counts. `test:logic` source-guards each wrapper against returning to
  `Number.isSafeInteger(parsed?.x) ? parsed.x : 0` counter fallbacks. Verified
  with `node --check` for all four wrappers and the business-logic test script,
  `test:contract:v10:summary`, `test:indexer-storage:summary`,
  `test:db-operations:summary`, `test:monitoring:summary`,
  `test:logic:summary`, `proof:autonomous:summary`, `typecheck:summary`,
  `lint:summary`, and `proof:prelaunch:summary`. Required local prelaunch rows
  still pass, `proof:prelaunch:summary` still preserves 23 external/status
  blockers, and `proof:autonomous:summary` still reports `Complete gates:
  0/14`. No cleanup apply, endpoint polling beyond existing summary checks,
  wallet signing, transactions, deploy, ABI, randomness, tokenomics, secret
  access, or private RPC access was used.
- Prelaunch status summaries now also sanitize launch-doc, host-guard, ESLint,
  legacy ABI/indexer, and SQLite nested child counters through the shared
  non-negative safe-integer formatter before printing compact operator
  evidence. Malformed, negative, fractional, or unsafe child JSON counts can
  no longer appear as valid `proof:prelaunch:summary` counters for those rows.
  `test:logic` source-guards the formatter against returning to raw
  `${parsed...}` child counter interpolation and the previous inline
  `Number.isSafeInteger(parsed...)` counter checks. Verified with `node
  --check` for the prelaunch and business-logic scripts,
  `test:logic:summary`, `proof:autonomous:summary`, `typecheck:summary`,
  `lint:summary`, and `proof:prelaunch:summary`. Required local prelaunch rows
  still pass, `proof:prelaunch:summary` still preserves 23 external/status
  blockers, and `proof:autonomous:summary` still reports `Complete gates:
  0/14`. No cleanup apply, endpoint polling beyond existing summary checks,
  wallet signing, transactions, deploy, ABI, randomness, tokenomics, secret
  access, or private RPC access was used.
- Autonomous status summaries now format pending nonce, deployed V10 identity,
  security follow-up, V10 invariant, and ABI/indexer child counters only through
  the shared non-negative safe-integer helper. Negative child JSON counters can
  no longer appear as valid operator evidence in `proof:autonomous:summary`,
  matching the cleanup counter hardening already in place. `test:logic`
  source-guards the formatter against raw `Number.isSafeInteger(parsed...)`
  counter checks for those fields. `node --check` for the autonomous status
  script and business-logic tests passes; `test:logic:summary`,
  `proof:autonomous:daily:summary`, `proof:autonomous:summary`,
  `proof:prelaunch:summary`, `typecheck:summary`, and `lint:summary` pass after
  the change. Prelaunch still preserves 23 external/status blockers and
  autonomous status still reports `Complete gates: 0/14`. No cleanup apply,
  endpoint polling beyond existing summary checks, wallet signing,
  transactions, deploy, ABI, randomness, tokenomics, secret access, or private
  RPC access was used.
- Workspace cleanup loop manager status now exposes `lastRunAt` and `nextRunAt`
  only when the stored loop status contains canonical ISO-8601 UTC timestamps
  that round-trip through `Date.toISOString()`. Malformed arbitrary timestamp
  strings from `logs/workspace-cleanup-loop.status.json` are omitted instead of
  becoming operator-visible cleanup loop status evidence. `test:logic`
  source-guards the manager against returning raw `typeof parsed.lastRunAt ===
  "string"` / `typeof parsed.nextRunAt === "string"` fields. `node --check` for
  the manager and business-logic tests passes; `cleanup:workspace:loop:status`,
  `test:logic:summary`, `proof:autonomous:daily:summary`,
  `proof:autonomous:summary`, `proof:prelaunch:summary`, `typecheck:summary`,
  and `lint:summary` pass after the change. Prelaunch still preserves 23
  external/status blockers and autonomous status still reports
  `Complete gates: 0/14`. No cleanup apply, endpoint polling beyond existing
  summary checks, wallet signing, transactions, deploy, ABI, randomness,
  tokenomics, secret access, or private RPC access was used.
- Workspace cleanup loop manager status now sanitizes child cleanup aggregate
  counters with one non-negative safe-integer helper before exposing operator
  status. Negative counts and fractional or unsafe `bytes` values can no longer
  appear as valid cleanup loop evidence in prelaunch/autonomous status; invalid
  values collapse to zero. `test:logic` source-guards the manager against
  `Number.isFinite(parsed.cleanup.bytes)` and raw `Number.isSafeInteger(...)`
  fallbacks that accept negative counters. `node --check` for the manager and
  business-logic tests passes; `cleanup:workspace:loop:status`,
  `test:logic:summary`, `proof:autonomous:daily:summary`,
  `proof:autonomous:summary`, `proof:prelaunch:summary`, `typecheck:summary`,
  and `lint:summary` pass after the change. Prelaunch still preserves 23
  external/status blockers and autonomous status still reports
  `Complete gates: 0/14`. No cleanup apply, endpoint polling beyond existing
  summary checks, wallet signing, transactions, deploy, ABI, randomness,
  tokenomics, secret access, or private RPC access was used.
- Indexer dry-run/strict proof now canonical-parses SQLite `COUNT(*)` row
  evidence before using DB row totals. Malformed, fractional, exponential, or
  unsafe row-count evidence is treated as missing/invalid DB evidence instead
  of being broadly coerced into proof counters, and `test:logic` source-guards
  the verifier against reintroducing `Number(row?.count ?? 0)`. `node --check`
  for the indexer proof and business-logic tests passes; `proof:indexer:summary`
  remains compact and read-only; `proof:indexer:strict:summary` still fails
  closed on missing DB/env/manifest evidence; `test:logic:summary`,
  `proof:autonomous:summary`, `proof:prelaunch:summary`, `typecheck:summary`,
  and `lint:summary` pass after the change. Prelaunch still preserves 23
  external/status blockers and autonomous status still reports
  `Complete gates: 0/14`. No RPC polling beyond existing summary checks,
  indexer run, real DB proof, wallet signing, transactions, deploy, ABI,
  randomness, tokenomics, secret access, or private RPC access was used.
- Production/all dependency audit summaries now canonical-parse npm audit
  `metadata.vulnerabilities` counters before using them as proof evidence.
  Malformed, fractional, exponential, or unsafe vulnerability counts create an
  `audit-counts` failure instead of being broadly coerced into dependency
  proof status. Summary output now exposes `countIssues`, and `test:logic`
  source-guards the verifier against broad `Number(counts[name])` coercion.
  `proof:deps:summary`, `proof:deps:all:summary`,
  `proof:autonomous:daily:summary`, `proof:autonomous:summary`,
  `proof:prelaunch:summary`, `typecheck:summary`, and `lint:summary` pass after
  the change; prelaunch still preserves 23 external/status blockers and
  autonomous status still reports `Complete gates: 0/14`. No wallet signing,
  transactions, deploy, ABI, randomness, tokenomics, secret access, or private
  RPC access was used.
- Business-logic compact summary now canonical-parses the suppressed expected
  warning count with a safe non-negative decimal parser instead of partial
  `parseInt` coercion. Malformed or unsafe warning-count text can no longer
  become an operator-visible proof counter in `test:logic:summary`, and
  `test:logic` source-guards the wrapper against reintroducing `parseInt`.
  `test:logic:summary`, `proof:autonomous:summary`, `typecheck:summary`, and
  `lint:summary` pass after the change, while autonomous status still reports
  `Complete gates: 0/14` with the expected external blockers. No endpoint
  polling beyond existing summary checks, wallet signing, transactions, deploy,
  ABI, randomness, tokenomics, secret access, or private RPC access was used.
- Prelaunch status summaries now format launch/canary/bundle/dependency,
  pending-nonce, remaining-gate, and slow-check counters only through safe
  integer helpers before displaying them in compact operator output. Fractional
  or unsafe child JSON numbers no longer become prelaunch proof counters or
  byte/duration evidence, and `test:logic` source-guards the absence of broad
  `Number.isFinite` counter parsing in `report-prelaunch-status.mjs`.
  `proof:prelaunch:summary` passes all required local rows and preserves 23
  external/status blockers; `proof:autonomous:summary` still reports
  `Complete gates: 0/14`. No endpoint polling beyond existing summary checks,
  wallet signing, transactions, deploy, ABI, randomness, tokenomics, secret
  access, or private RPC access was used.
- Autonomous daily status summaries now require dependency, CI-security,
  bundle, and cleanup proof counters to be safe non-negative integers before
  displaying them in the operator-facing daily gate. Fractional, unsafe, or
  malformed counts fall back to zero instead of becoming dependency, bundle, or
  cleanup proof status. `test:logic` source-guards the daily summary parser.
  `proof:autonomous:daily:summary`, `proof:autonomous:summary`,
  `typecheck:summary`, and `lint:summary` pass after the change, while
  `proof:autonomous:summary` still reports `Complete gates: 0/14` with the
  expected external blockers. No cleanup apply, endpoint polling, wallet
  signing, transactions, deploy, ABI, randomness, tokenomics, secret access, or
  private RPC access was used.
- Autonomous status cleanup dry-run summaries now require `matchedTargets` and
  `bytes` to be safe non-negative integers before displaying them as cleanup
  counters. Fractional, unsafe, or malformed cleanup summary values fall back
  to zero instead of becoming operator-visible proof status. `test:logic`
  source-guards the integer-only summary parser. No cleanup deletion, endpoint
  polling, wallet signing, transactions, deploy, ABI, randomness, tokenomics,
  secret access, or private RPC access was used.
- Runtime monitoring ISO timestamp parsing now also requires canonical
  `Date.parse` round-trip output before accepting audit or canary evidence.
  Impossible calendar dates such as February 31 can no longer be normalized by
  JavaScript and treated as valid chain/indexer audit freshness, canary
  activity freshness, or reverted-canary-window evidence. `test:monitoring`
  covers impossible audit and canary dates, while `test:logic` source-guards
  the canonical round-trip. No audit generation, canary start, endpoint
  polling, alert delivery, wallet signing, transactions, deploy, ABI,
  randomness, tokenomics, secret access, or private RPC access was used.
- Runtime monitoring audit and canary timestamp parsing now requires ISO-8601
  UTC evidence before using `Date.parse`. Non-canonical but JavaScript-parseable
  strings such as space-separated dates no longer count as chain/indexer audit
  freshness, canary activity freshness, or reverted-canary-window evidence.
  `test:monitoring` covers non-ISO audit and canary timestamps, while
  `test:logic` source-guards the ISO parser and bans broad timestamp parsing.
  No audit generation, canary start, endpoint polling, alert delivery, wallet
  signing, transactions, deploy, ABI, randomness, tokenomics, secret access, or
  private RPC access was used.
- Runtime monitoring snapshot freshness now rejects live-state `fetchedAt`
  evidence that is too far in the future instead of treating future timestamps
  as fresh through negative-age arithmetic. The monitor allows only the
  existing bounded clock-skew window, and `test:monitoring` plus `test:logic`
  cover the future timestamp rejection. No endpoint polling, alert delivery,
  wallet signing, transactions, deploy, ABI, randomness, tokenomics, secret
  access, or private RPC access was used.
- Runtime monitoring snapshot evaluation now fails closed on malformed monitor
  clocks and falls back to safe default live-state freshness and stuck-epoch
  grace windows when caller-supplied runtime snapshot windows are malformed.
  Bad window evidence can no longer silently disable stuck non-empty epoch
  alerts or turn invalid clock arithmetic into healthy runtime proof.
  `test:monitoring` and `test:logic` cover malformed clock, live-state
  max-age, and stuck-grace behavior. No endpoint polling, alert delivery,
  wallet signing, transactions, deploy, ABI, randomness, tokenomics, secret
  access, or private RPC access was used.
- Runtime monitoring chain/indexer audit and backup freshness evaluation now
  fail closed on malformed monitor clocks and fall back to safe default
  stale-age windows when caller-supplied max-age values are malformed. Bad
  clock evidence can no longer make stale audit or backup artifacts look fresh
  through invalid timestamp arithmetic. `test:monitoring` covers malformed
  clock and max-age behavior for both paths, while `test:logic` source-guards
  the fail-closed and fallback paths. No audit generation, backup execution,
  endpoint polling, alert delivery, wallet signing, transactions, deploy, ABI,
  randomness, tokenomics, secret access, or private RPC access was used.
- Runtime monitoring canary activity evaluation now fails closed on a malformed
  monitor clock and falls back to the safe default stale-age window when a
  caller-supplied max-age value is malformed. Bad clock evidence can no longer
  make stale canary JSONL activity look healthy through invalid timestamp
  arithmetic. `test:monitoring` covers malformed clock and max-age behavior,
  while `test:logic` source-guards the fail-closed and fallback path. No canary
  start, endpoint polling, alert delivery, wallet signing, transactions,
  deploy, ABI, randomness, tokenomics, secret access, or private RPC access
  was used.
- Runtime monitoring canary revert-window evaluation now fails closed on a
  malformed monitor clock and falls back to safe default window/threshold
  values when caller-supplied canary revert settings are malformed. Bad
  threshold/window evidence can no longer silently disable reverted-transaction
  series alerts. `test:monitoring` covers malformed window, threshold, and
  clock behavior, while `test:logic` source-guards the fallback. No canary
  start, endpoint polling, alert delivery, wallet signing, transactions,
  deploy, ABI, randomness, tokenomics, secret access, or private RPC access
  was used.
- Runtime monitoring Telegram and Resend alert senders now normalize monitor
  timestamps and cooldown windows before delivery. Malformed monitor clocks
  fail closed without sending, and malformed cooldown values fall back to the
  safe default window instead of bypassing alert suppression. `test:monitoring`
  covers malformed clock/cooldown behavior, while `test:logic` source-guards
  both alert channels. No alert was sent to a real provider, and no endpoint
  polling, wallet signing, transactions, deploy, ABI, randomness, tokenomics,
  secret access, or private RPC access was used.
- Bounded API JSON body parsing now validates the caller-supplied `maxBytes`
  limit before reading `Content-Length`, `Content-Type`, or the request body.
  Invalid limits such as `0`, negative, fractional, `NaN`, `Infinity`, or
  unsafe integers fail closed as `invalid` and do not touch the body stream.
  `test:logic` covers the early no-body-read failure and source-guards the
  limit normalization. No endpoint polling, wallet signing, transactions,
  deploy, ABI, randomness, tokenomics, secret access, or private RPC access
  was used.
- Runtime monitoring canary activity evaluation now requires completed summary
  JSONL events to carry safe-integer `round`, `targetRounds`, and non-negative
  `failures` counters before treating a canary as completed. String or
  malformed summary counters no longer look like a successful canary
  completion, and malformed failure counts fail closed as invalid canary-log
  evidence. `test:monitoring` covers the malformed summary cases, while
  `test:logic` source-guards the parser. No canary start, wallet signing,
  transactions, endpoint polling, deploy, ABI, randomness, tokenomics, secret
  access, or private RPC access was used.
- Runtime monitoring backup freshness evaluation now canonical-parses backup
  `mtimeMs` and `bytes` metadata before freshness decisions. Malformed
  metadata strings such as `1e3`, `01`, `100.5`, or zero-byte evidence now
  fail closed as invalid backup metadata instead of becoming stale/fresh backup
  proof. `test:monitoring` covers canonical-string compatibility and malformed
  metadata rejection, while `test:logic` source-guards the parser. No real
  backup path, endpoint polling, alert sending, wallet signing, transactions,
  deploy, ABI, randomness, tokenomics, secret access, or private RPC access
  was used.
- Runtime monitoring snapshot evaluation now canonical-parses non-negative
  integer telemetry before threshold and freshness decisions. Malformed
  runtime/data-sync/live-state payload strings such as `1e3`, `04`, or `100.5`
  no longer become memory, WAL, disk, finality-lag, epoch-deadline, or
  live-state freshness evidence. `test:monitoring` exercises canonical-string
  compatibility and malformed telemetry fail-closed behavior, while
  `test:logic` source-guards the parser. No endpoint polling, alert sending,
  wallet signing, transactions, deploy, ABI, randomness, tokenomics, secret
  access, or private RPC access was used.
- Production external shared-lock detection now canonical-parses
  `WEB_REPLICA_COUNT` before deciding whether proof replay/rate-limit lock
  paths require the external store. Malformed production values such as `01`
  fail closed by requiring the shared lock instead of being treated as a valid
  single replica. `test:logic` exercises the boundary and source-guards the
  parser, without reading Redis credentials, touching wallet sends, contract
  code, ABI, deployed addresses, randomness, tokenomics, live RPC,
  transactions, or secrets.
- Shared API rate-limit 429 responses now clamp `Retry-After` and JSON
  `retryAfter` to a 24-hour maximum, even if a bad or huge rate-limit window is
  configured. `test:logic` exercises the second-hit 429 path and source-guards
  the clamp, without touching wallet sends, contract code, ABI, deployed
  addresses, randomness, tokenomics, external Redis credentials, live RPC,
  transactions, or secrets.
- ABI/indexer storage coverage now includes a partial-RPC-log fallback case:
  normalized financial event payloads with non-canonical block metadata are
  skipped before scoped storage and do not reach frontend/API event reads. The
  compact indexer summary, prelaunch summary, and autonomous heartbeat surface
  this as `partialRpcLogFallback=true`, without touching ABI, deployed
  contract, indexer deploy block, live DB, RPC, signing, transactions, secrets,
  or private endpoints.
- V10 one-year claim/dust deadline coverage now includes local transition
  cases for single reward claims, batch reward claims, single rebate claims,
  and batch rebate claims at `deadline - 1`, `deadline`, and `deadline + 1`.
  The model proves claim and dust windows do not overlap at the exact
  `resolvedAt + 365 days` boundary and that dust becomes available exactly
  when late claims close. Solidity, ABI, deploy, randomness, tokenomics, wallet
  client, signing, real transaction, RPC call, secret access, or private
  endpoint access was not used.
- V10 dust settlement aggregate-transfer rollback coverage now has local model
  cases for reward dust aggregate success, reward dust aggregate transfer
  failure, zero-only reward dust closure, rebate dust transfer failure with
  preclosed duplicate skips, and all-closed rebate dust inputs. The model proves
  reverted aggregate dust transfers cannot retain closed dust state, per-epoch
  event evidence, aggregate event evidence, or transfer evidence. Solidity,
  ABI, deploy, randomness, tokenomics, wallet client, signing, real
  transaction, RPC call, secret access, or private endpoint access was not
  used.
- V10 batch claim/rebate aggregate-transfer rollback coverage now has local
  model cases for successful batch claims, aggregate reward transfer failure,
  aggregate rebate transfer failure with preclaimed duplicate skips, and
  all-nonpayable batches. The model proves a reverted aggregate transfer cannot
  retain per-epoch close state, aggregate liability increments, per-epoch event
  evidence, aggregate event evidence, or transfer evidence. Solidity, ABI,
  deploy, randomness, tokenomics, wallet client, signing, real transaction, RPC
  call, secret access, or private endpoint access was not used.
- V10 claim/rebate transfer-failure rollback coverage now has local model cases
  for successful claims, single reward transfer failure, single rebate transfer
  failure, and already-claimed replay. The model proves reverted token-transfer
  paths do not retain claimed-state changes, aggregate liability changes,
  transfer evidence, or event evidence. Solidity, ABI, deploy, randomness,
  tokenomics, wallet client, signing, real transaction, RPC call, secret access,
  or private endpoint access was not used.
- V10 protocol-fee flush model coverage now separates the external
  `flushProtocolFees()` zero-liability guard from the internal atomic transfer
  model. Local invariants prove the external entrypoint rejects zero owner/burn
  liabilities before fee-recipient updates or internal transfers, while positive
  liability cases still delegate to the existing atomic flush model. Solidity,
  ABI, deploy, randomness, tokenomics, wallet client, signing, real
  transaction, RPC call, secret access, or private endpoint access was not
  used.
- V10 duplicate/replay dust model coverage now includes all-pre-settled
  reward-dust duplicate batch entries. The local invariant proves replayed
  reward-dust settlement inputs fail closed with zero transfer, zero newly
  closed epochs, and zero events while preserving the already-settled state.
  Solidity, ABI, deploy, randomness, tokenomics, wallet client, signing, real
  transaction, RPC call, secret access, or private endpoint access was not
  used.
- Wallet action and transfer failure copy now distinguishes wrong-network or
  chain-mismatch wallet errors from provider/RPC failures. Resolver reward
  claims, pending transaction repair, ETH/LINEA withdraws, and ETH/LINEA
  transfers now share the same switch-to-Linea-Sepolia instruction already used
  by manual bet and Auto-Miner paths, without changing wallet send behavior,
  nonce handling, ABI, contract code, randomness, tokenomics, signing, real
  transactions, RPC writes, deploy, secret access, or private endpoint access.
- Wallet Settings pending nonce status refresh now also distinguishes
  wrong-network/chain-mismatch read failures from generic inspection failures.
  The read-only recovery UI asks the user to switch to Linea Sepolia instead of
  showing a generic danger state, without changing nonce repair, wallet send
  behavior, ABI, contract code, randomness, tokenomics, signing, real
  transactions, RPC writes, deploy, secret access, or private endpoint access.
- Wallet action and transfer failure copy now also distinguishes expired wallet
  sessions and unavailable wallet state from raw provider/RPC failures. Resolver
  claims, pending transaction repair, ETH/LINEA withdraws, and ETH/LINEA
  transfers now use actionable login/reconnect copy instead of falling through
  to generic provider or fallback messages, without changing wallet send
  behavior, nonce handling, ABI, contract code, randomness, tokenomics,
  signing, real transactions, RPC writes, deploy, secret access, or private
  endpoint access.
- Hashless pending mining transaction recovery now normalizes latest and
  pending nonce evidence before clearing or confirming a stored pending tx.
  Malformed nonce values or inverted pending/latest evidence stay `pending`,
  even after the not-found grace window, so reload recovery cannot clear a
  transaction or permit a duplicate send from unsafe nonce evidence. Guarded in
  `test:logic`; no wallet client access, signing, real transactions, RPC
  writes, deploy, ABI, randomness, tokenomics, secret access, or private
  endpoint access was used.
- Auto-Miner failure copy and diagnostics now distinguish wrong-network/chain
  mismatch errors from RPC/network outages. The bot reports a specific
  switch-network stop message and persists `wrong-network` as a support-safe
  diagnostics kind instead of collapsing it into unknown or network retry
  states. Guarded in `test:logic`; no wallet client access, signing, real
  transactions, RPC writes, deploy, ABI, randomness, tokenomics, secret access,
  or private endpoint access was used.
- Manual bet failure copy now separates wrong-network/chain-mismatch errors
  from generic RPC failures. `getBetErrorMessage` returns a specific
  switch-network instruction for unsupported chain, wrong network, and chain
  mismatch signals while preserving the existing RPC-unavailable copy for
  provider outages. Guarded in `test:logic`; no wallet client access, signing,
  real transactions, RPC writes, deploy, ABI, randomness, tokenomics, secret
  access, or private endpoint access was used.
- Wallet rejection detection now treats explicit wallet-modal close text as a
  user rejection while still leaving generic RPC connection-closed failures out
  of the rejection path. This keeps manual bet, repeat bet, claim, transfer,
  and pending-repair UX on the non-danger rejected/cancelled copy path for
  user-closed wallet prompts without wallet client access, signing, real
  transactions, RPC writes, deploy, ABI, randomness, tokenomics, secret access,
  or private endpoint access.
- Auto-Miner tab-lock recovery coverage now includes a runtime setup regression
  for the orphan-recovery path. The test proves the first exclusive lock miss
  triggers exactly one orphan recovery attempt, the second lock acquisition must
  succeed before UI/run state is activated, and sufficient allowance after that
  recovered lock reads only local stubbed balance/allowance data without
  approval writes, silent transaction sends, wallet approval prompts, gas
  checks, endpoint polling, network calls, signing, real transactions, RPC
  writes, deploy, ABI, randomness, tokenomics, secret access, or private
  endpoint access.
- Wallet/explorer link coverage now rejects malformed transaction-hash inputs
  with query strings or injected newlines while still trimming whitespace around
  a valid hash. This keeps wallet notifications and claim/transfer explorer
  links on the canonical Lineascan transaction path without endpoint polling,
  network calls, wallet client access, signing, real transactions, RPC writes,
  deploy, ABI, randomness, tokenomics, secret access, or private endpoint
  access.
- Shared API rate-limit coverage now includes a runtime 429 regression for the
  local fallback limiter. The test proves a one-request window allows the first
  request, rejects the second with status `429`, returns no-store headers, and
  keeps the `Retry-After` header aligned with the JSON `retryAfter` body inside
  the bounded active window. Guarded in `test:logic`; no endpoint polling,
  external rate-limit store, network call, wallet client, signing, real
  transaction, RPC call, deploy, ABI, randomness, tokenomics, secret access, or
  private endpoint access was used.
- ABI/indexer storage coverage now preserves reward/rebate subtype parity
  inside the normalized financial event categories. Local storage regressions
  prove `RewardBatchClaimed` and `RebateBatchClaimed` payloads can share the
  `batch_claim` category without collapsing ids or losing `kind`/`eventName`,
  and `RewardDustSettled` and `RebateDustSettled` payloads can share the
  `dust_settlement` category with the same guarantees. Compact summaries now
  expose `batchClaimKindParity=true` and `dustSettlementKindParity=true`.
  Guarded in `test:logic`; no indexer RPC, real DB, endpoint polling, wallet
  client, signing, real transaction, deploy, ABI, randomness, tokenomics,
  secret access, or private endpoint access was used.
- V10 duplicate/replay batch model coverage now includes all-nonpayable reward
  and rebate claim batches plus all-closed rebate dust batches. These local
  invariant cases prove the modeled paths fail closed with zero transfer,
  zero payable-entry close, and zero events for nonpayable/all-closed inputs.
  The compact V10 summary now reports `duplicateBatchModelCases=9` with
  `assertionFailures=0`, and `proof:autonomous:summary` surfaces
  `duplicateBatchCases=9` in read-only mode. Verified with
  `node --check scripts\test-contract-v10-invariants.mjs`,
  `npm.cmd run test:contract:v10:summary`,
  `node --check scripts\test-business-logic.mjs`,
  `npm.cmd run test:logic:summary`, `npm.cmd run typecheck:summary`,
  `npm.cmd run lint:summary`, and `npm.cmd run proof:autonomous:summary`.
  Guarded in `test:logic`; no Solidity, ABI, deploy, randomness, tokenomics,
  wallet client, signing, real transaction, RPC call, secret access, or
  private endpoint access was used.
- Admin Ops percentage, duration, and disk-free display now uses the shared
  bounded `safeToFixed` helper and a dedicated `fmtGib` helper instead of raw
  `.toFixed(...)` calls in the operator UI. Health/proof decisions and API
  payload handling are unchanged; malformed display-only metrics render as
  `...` rather than `NaN`/`Infinity`. Guarded in `test:logic`; no endpoint
  polling, wallet client, signing, real transaction, RPC call, deploy, ABI,
  randomness, tokenomics, secret access, or private endpoint access was used.
- Auto-Miner retry/wait user-facing seconds now use the shared bounded
  `formatRetryWaitSeconds` helper in the loop, loop state reducer, round
  betting retry progress, and shared network retry reader instead of direct
  `(waitMs / 1000).toFixed(0)` formatting. Backoff timing and `delay(wait)`
  behavior are unchanged; only malformed retry wait display fails closed to
  `0s`. Guarded in `test:logic`; no endpoint polling, wallet client, signing,
  real transaction, RPC call, deploy, ABI, randomness, tokenomics, secret
  access, or private endpoint access was used.
- Leaderboards lucky-tile percentage display now uses the shared bounded
  `safeToFixed` helper instead of calling `pct.toFixed(1)` directly. Ranking,
  normalization, polling, and leaderboard data logic are unchanged; the change
  only prevents malformed display numbers from rendering as `NaN%`/throwing
  through a raw formatter. Guarded in `test:logic`; no endpoint polling, wallet
  client, signing, real transaction, RPC call, deploy, ABI, randomness,
  tokenomics, secret access, or private endpoint access was used.
- Shared wallet/UI decimal helpers now strict-parse normalized decimal text in
  `safeParseFloat` instead of accepting exponent or prefix strings through
  `parseFloat`, and `safeToFixed` now bounds fraction digits before calling
  `toFixed`. Manual bet and Auto-Miner form totals/balance checks still keep
  their existing number compatibility shape, but malformed text such as
  exponent or suffix input fails closed to `0`. Guarded in `test:logic`; no
  endpoint polling, wallet client, signing, real transaction, RPC call, deploy,
  ABI, randomness, tokenomics, secret access, or private endpoint access was
  used.
- Jackpot banner win amount recovery now keeps indexed/API and on-chain
  fallback values as canonical fixed decimal text through display/share copy.
  The banner no longer parses jackpot rows with `Number.parseFloat`, no longer
  converts on-chain jackpot wei through `formatUnits` + number coercion, and no
  longer formats the modal amount with `toLocaleString` on a JS number. Guarded
  in `test:logic`; no wallet client, signing, real transaction, RPC write,
  deploy, ABI, randomness, tokenomics, secret access, or private endpoint
  access was used.
- Jackpot history legacy `amountNum` fallback parsing now uses canonical
  decimal-text formatting instead of `Number.parseFloat`. Malformed or
  exponent-form legacy snapshot text fails closed to `0`, while normal decimal
  compatibility values keep the existing public field shape. Guarded in
  `test:logic`; no endpoint polling, wallet client, signing, real transaction,
  RPC call, deploy, ABI, randomness, tokenomics, secret access, or private
  endpoint access was used.
- Manual bet and Auto-Miner visible LINEA amount copy now render through
  canonical decimal display strings instead of direct `.toFixed()` calls.
  Manual display strings are prepared in `useManualBetForm` for both desktop
  and mobile bars; Auto-Miner totals use the same panel formatter. Existing
  numeric compatibility and disabled-state logic are unchanged. Guarded in
  `test:logic`; no endpoint polling, wallet client, signing, real transaction,
  RPC call, deploy, ABI, randomness, tokenomics, secret access, or private
  endpoint access was used.
- Wins ticker reward compaction now uses canonical decimal-text parsing and
  bigint scaling for K/M display instead of `parseFloat().toFixed()`. Full
  tooltip amounts remain unchanged, while compact visible chips avoid unsafe
  JS number precision loss for large reward strings. Guarded in `test:logic`;
  no endpoint polling, wallet client, signing, real transaction, RPC call,
  deploy, ABI, randomness, tokenomics, secret access, or private endpoint
  access was used.
- Hub manual-bet gas fee estimates now format the bigint wei estimate through
  the shared balance formatter instead of `Number(formatEther(...)).toFixed(6)`.
  The live gas/fee quote flow and unavailable state are unchanged; only unsafe
  display-number coercion was removed. Guarded in `test:logic`; no wallet
  client, signing, real transaction, RPC write, deploy, ABI, randomness,
  tokenomics, secret access, or private endpoint access was used.
- Mining grid tile amount compaction and visible-stake detection now use the
  shared canonical decimal-text formatter instead of `parseFloat().toFixed()`.
  This keeps display-zero pools hidden from player badges using the same
  rounded two-decimal value that the user sees on the tile. Guarded in
  `test:logic`; no endpoint polling, wallet client, signing, real transaction,
  RPC call, deploy, ABI, randomness, tokenomics, secret access, or private
  endpoint access was used.
- Safety Pool rebate amount display now uses the shared canonical
  decimal-text formatter instead of `Number.parseFloat(...).toFixed(4)`.
  Pending and recent epoch rebate strings keep the same four-decimal UI shape,
  but malformed or huge decimal text no longer flows through broad JS number
  rounding. Guarded in `test:logic`; no endpoint polling, wallet client,
  signing, real transaction, RPC call, deploy, ABI, randomness, tokenomics,
  secret access, or private endpoint access was used.
- Jackpot history entries now derive current jackpot `amountNum` compatibility
  values from bounded raw-wei formatting and build fallback display strings
  from canonical decimal parsing instead of `formatUnits(...)` or
  `amountNum.toFixed(2)`. Public `amount` and `amountNum` fields remain
  present. Guarded in `test:logic`; no endpoint polling, wallet client,
  signing, real transaction, RPC call, deploy, ABI, randomness, tokenomics,
  secret access, or private endpoint access was used.
- Live game data helpers now derive jackpot, rollover, total-staked, and tile
  pool display compatibility values from bounded raw-wei formatting instead of
  coercing `formatUnits(...)` strings through `Number(...)`. Tile
  `poolDisplay` now comes directly from raw wei fixed formatting while keeping
  display-zero tiles hidden from user counts. Guarded in `test:logic`; no
  endpoint polling, wallet client, signing, real transaction, RPC call, deploy,
  ABI, randomness, tokenomics, secret access, or private endpoint access was
  used.
- Active scope is completing bounded post-deployment verification of
  `LineaOreV10` on Linea Sepolia.
- Standard Privy and external-wallet transaction paths are the only supported
  wallet flows. The old experimental wallet path has been deleted from active
  source, contracts, docs, and scripts.
- The latest active-source search for the removed wallet experiment returned no
  old experiment markers, and `npm.cmd run typecheck` passes after the deletion.
- The configured frontend, keeper, indexer block, and fresh SQLite scope now
  point to V10. The prior soak is stopped; no long V10 soak is authorized yet.
- V10 invariant coverage now includes replayed preclaimed reward/rebate epochs
  inside duplicate batch claim arrays. The local summary reports
  `duplicateBatchModelCases=6`; all-unpayable replay batches revert, and
  replayed already-closed entries do not produce an extra transfer or event.
- Wallet pending-transaction recovery coverage now includes hashless nonce
  states. Local logic tests prove the recovery path stays pending while the
  pending nonce is ahead, confirms only after latest nonce advances, and clears
  only after the not-found grace window with no latest/pending nonce movement.
- API production auth-origin coverage now includes additional private/reserved
  launch origins. Local logic tests reject `10/8`, `172.16/12`, `100.64/10`,
  and `.local` `NEXT_PUBLIC_SITE_URL` values before production auth messages
  can derive signed origins from non-public infrastructure labels.
- ABI/indexer storage coverage now includes idempotent protocol-fee flush
  replay. Re-indexing the same current-scope fee-flush id updates block/tx
  metadata without growing rows, and global burn accounting uses the latest
  current-scope flush while ignoring foreign contract and foreign chain rows.
  Compact summaries surface `idempotentProtocolFeeUpsert=true`.
- Prelaunch aggregation now includes the bounded V10 mined-gas matrix proof as
  a separate fail-closed canary row. Without a live V10 matrix log it reports
  the missing-log blocker instead of letting the general testnet canary rows
  hide absent V10 gas/epoch-bound evidence.
- The lightweight autonomous status summary now also includes that V10 canary
  matrix row and treats the missing live matrix log as an expected external
  blocker, so long-running heartbeats can report it without starting a soak or
  printing raw logs.
- The same autonomous status summary now includes `monitor:runtime:summary` as
  an expected no-poll/no-alert blocker row, preserving safe missing-config
  tokens for email alerts, backup freshness, canary logs, and chain-audit setup
  without sending alerts or printing endpoints.
- Runtime monitoring drill coverage now also proves production-like
  `monitor:runtime:summary` rejects a backup directory inside the repo checkout
  before endpoint polling or alert delivery. `test:monitoring:summary` and
  `proof:prelaunch:summary` surface this as
  `repoLocalBackupRejected=true`, keeping the external backup boundary visible
  without printing local paths, endpoints, or alert configuration.
- Runtime monitor numeric env parsing now fails closed on malformed runtime
  monitor thresholds before endpoint polling or alert delivery. Canonical
  decimal parsing covers interval, timeout, stuck/live-state windows, RSS/WAL
  and disk thresholds, canary windows, chain-audit age, backup age, and
  protocol-fee accrual threshold inputs. `test:monitoring:summary` and
  `proof:prelaunch:summary` surface `malformedNumericEnvRejected=true`.
- Workspace cleanup loop status now sanitizes child cleanup summary counts and
  bytes to non-negative safe integers before writing
  `logs/workspace-cleanup-loop.status.json`. Malformed, negative, fractional,
  or unsafe child cleanup JSON cannot become aggregate ops evidence; cleanup
  targets, age gates, scheduling, and apply behavior are unchanged.
- Mainnet env proof now canonical-parses positive integer gate values before
  G1/G6 readiness decisions. Deploy/finality shape checks and
  `WEB_REPLICA_COUNT` reject malformed, leading-zero, fractional, or unsafe
  numeric text instead of relying on broad `Number(...)` coercion.
- SQLite backup summary now canonical-parses
  `LORE_BACKUP_RETENTION_DAYS` before backup validation. Fractional,
  leading-zero, malformed, unsafe, or out-of-range retention values fail closed
  before any output file is written; `test:db-operations:summary` exposes the
  malformed-retention rejection as local G8 backup evidence.
- Signoff evidence collector and draft generator now canonical-parse
  `INDEXER_FINALITY_BLOCKS` before setting `finalityBlocksPositive` in G1-G4
  signoff evidence. Fractional, leading-zero, malformed, or unsafe finality
  text no longer becomes a positive proof flag in generated draft evidence.
- The same autonomous status summary now includes
  `proof:indexer:strict:summary` as an expected blocker row, keeping G7 DB,
  deploy-block/finality, and manifest readiness visible without running the
  indexer or printing DB/RPC paths.
- Autonomous/prelaunch status wrapper timeouts now use canonical decimal env
  parsing with explicit ranges for `AUTONOMOUS_STATUS_TIMEOUT_MS`,
  `AUTONOMOUS_DAILY_STATUS_TIMEOUT_MS`, and `PRELAUNCH_CHECK_TIMEOUT_MS`.
  Malformed, partial, fractional, unsafe, or out-of-range timeout values fail
  closed before any child proof command is spawned instead of being accepted
  through `parseInt` prefix coercion. Guarded in `test:logic`; no wallet
  signing, real transactions, RPC writes, deploy, ABI, randomness, tokenomics,
  secret access, or private endpoint access was used.
- Compact local summary wrappers now share `scripts/summary-timeout.mjs` for
  canonical decimal timeout env parsing before child commands spawn. Build,
  business-logic, V9/V10 contract, DB operations, fetch-timeout,
  indexer-storage, monitoring-drill, stored-number, typecheck, deployed V10,
  and offline V10 identity summaries no longer accept partial `parseInt`
  timeout values or broad numeric fallback. Guarded in `test:logic`; no wallet
  signing, real transactions, RPC writes, deploy, ABI, randomness, tokenomics,
  secret access, or private endpoint access was used.
- V10 dry-run Preview and behavior benchmark timeout env parsing now fails
  closed on malformed, partial, fractional, unsafe, or out-of-range values.
  `V10_CANARY_DRY_RUN_PREVIEW_TIMEOUT_MS` uses the shared timeout parser before
  child planner/nonce/matrix/analyzer steps spawn, and
  `V10_BEHAVIOR_TIMEOUT_MS` is canonical decimal/range checked before the
  behavior benchmark timeout guard. Guarded in `test:logic`; no wallet signing,
  live canary execution, real transactions, RPC writes, deploy, ABI,
  randomness, tokenomics, secret access, or private endpoint access was used.
- Chain/indexer audit window inputs now fail closed before DB/RPC work.
  `CHAIN_INDEXER_AUDIT_EPOCHS`, `INDEXER_FINALITY_BLOCKS`, and `--end-epoch`
  are canonical decimal/range checked instead of being accepted through broad
  `Number(...)` or `BigInt(env)` coercion. Guarded in `test:logic`; no
  indexer run, chain audit execution, wallet signing, real transactions, RPC
  writes, deploy, ABI, randomness, tokenomics, secret access, or private
  endpoint access was used.
- Browser smoke chain scope and V10 gas benchmark optimizer inputs now fail
  closed on malformed, partial, fractional, unsafe, or out-of-range values.
  `NEXT_PUBLIC_LINEA_CHAIN_ID` is canonical decimal/range checked before
  browser smoke derives Auto-Miner storage keys or smoke options, and
  `--v10-runs` is canonical decimal/range checked before V10 gas benchmark
  compilation. Guarded in `test:logic`; no browser run, wallet signing, real
  transactions, RPC writes, deploy, ABI, randomness, tokenomics, secret access,
  or private endpoint access was used.
- Runtime health web-replica diagnostics now fail closed on malformed,
  partial, fractional, leading-zero, unsafe, or out-of-range
  `WEB_REPLICA_COUNT` values before exposing `multiReplicaWeb` in the safe
  public config object. Guarded in `test:logic`; no health endpoint request,
  wallet signing, real transactions, RPC writes, deploy, ABI, randomness,
  tokenomics, secret access, or private endpoint access was used.
- Production health threshold env parsing now fails closed before health
  endpoint fetches. `PROD_HEALTH_MAX_LAG_BLOCKS` and
  `PROD_HEALTH_MAX_INDEXER_STALE_MS` must be canonical non-negative decimal
  integers; malformed values emit compact redacted JSON failures instead of
  being accepted through broad numeric fallback. Guarded in `test:logic`; no
  real production health endpoint request, wallet signing, real transactions,
  RPC writes, deploy, ABI, randomness, tokenomics, secret access, or private
  endpoint access was used.
- Production health payload counters now also fail closed on malformed
  endpoint evidence. `health:prod` accepts non-negative safe integer JSON
  numbers or canonical decimal integer strings for lag, heartbeat age, missing
  epochs, runtime memory, and DB/WAL counters; fractional, exponent-form,
  leading-zero, unsafe, or non-integer payload values no longer satisfy launch
  health proof through broad `Number(...)` parsing. Guarded in `test:logic`
  and the checker `--self-test`; no endpoint polling, diagnostics secret,
  wallet signing, real transactions, RPC writes, deploy, ABI, randomness,
  tokenomics, secret access, or private endpoint access was used.
- Production health runtime chain-id evidence now also fails closed before
  launch health acceptance. `LINEA_CHAIN_ID` and `NEXT_PUBLIC_LINEA_CHAIN_ID`
  must be canonical positive decimal integers and must match when both are
  configured; `runtime.publicConfig.chainId` must be a safe positive integer
  and match the configured chain id. Guarded in `test:logic` and the checker
  `--self-test`; no endpoint polling, diagnostics secret, wallet signing, real
  transactions, RPC writes, deploy, ABI, randomness, tokenomics, secret access,
  or private endpoint access was used.
- HTTP smoke runtime chain-id validation now mirrors the production health
  boundary. When configured, `NEXT_PUBLIC_LINEA_CHAIN_ID` and `LINEA_CHAIN_ID`
  must be canonical positive decimal integers and agree, and
  `/api/health/runtime` `publicConfig.chainId` must be a safe positive integer
  matching that configured chain id. Guarded in `test:logic`; no local server,
  endpoint polling, wallet signing, real transactions, RPC writes, deploy, ABI,
  randomness, tokenomics, secret access, or private endpoint access was used.
- HTTP smoke health-sync validation now also requires public
  `/api/health/data-sync` `contract.currentEpoch`, `storage.lagBlocks`, and
  `storage.lagToFinalityTargetBlocks` values to be non-negative safe integers
  or null. Fractional, negative, unsafe, or non-integer lag evidence can no
  longer satisfy the local smoke validator through broad finite-number checks.
  Guarded in `test:logic`; no local server, endpoint polling, wallet signing,
  real transactions, RPC writes, deploy, ABI, randomness, tokenomics, secret
  access, or private endpoint access was used.
- HTTP smoke integer evidence validation now also covers public live/runtime
  timestamps, live-state tile-user counts, leaderboard ranks/win counts, and
  tile ids with safe-integer bounds. Unsafe, fractional, negative, or
  out-of-range integer evidence can no longer pass those local smoke assertions
  through broad `Number.isFinite` or `Number.isInteger` checks. Guarded in
  `test:logic`; no local server, endpoint polling, wallet signing, real
  transactions, RPC writes, deploy, ABI, randomness, tokenomics, secret access,
  or private endpoint access was used.
- HTTP smoke deposit/reward tile evidence now uses the same bounded tile-id
  assertion for deposit `tileIds` and reward `winningTile` values. Duplicate
  deposit tile checks now also reject malformed, unsafe, fractional, or
  out-of-range tile ids before the smoke validator accepts deposits/rewards API
  compatibility. Guarded in `test:logic`; no local server, endpoint polling,
  wallet signing, real transactions, RPC writes, deploy, ABI, randomness,
  tokenomics, secret access, or private endpoint access was used.
- Recent-wins route-local cache expiry now mirrors the shared fail-closed cache
  boundary. Cache writes compute `expiresAt` through a safe-integer TTL helper,
  fresh reads reject malformed caller times or malformed expiry values, and
  direct `Date.now() + ttlMs` expiry arithmetic is source-guarded against
  reintroduction. Normal 15s/60s freshness windows are unchanged. Guarded in
  `test:logic`; no endpoint polling, wallet signing, real transactions, RPC
  writes, deploy, ABI, randomness, tokenomics, secret access, or private
  endpoint access was used.
- Recent-wins persisted snapshot loading now rejects malformed, unsafe,
  negative, stale, or future `savedAt` metadata before using a stored snapshot
  as public recent-wins API fallback. Snapshot writes still use the current
  timestamp; only stale/future acceptance changed. Guarded in `test:logic`; no
  endpoint polling, wallet signing, real transactions, RPC writes, deploy, ABI,
  randomness, tokenomics, secret access, or private endpoint access was used.
- Leaderboards persisted snapshot loading now applies the same non-future
  safe-integer `savedAt` boundary before using stored leaderboard data as public
  API fallback. Malformed, unsafe, negative, stale, or future snapshot metadata
  fails closed instead of satisfying cache freshness through broad timestamp
  arithmetic. Guarded in `test:logic`; no endpoint polling, wallet signing,
  real transactions, RPC writes, deploy, ABI, randomness, tokenomics, secret
  access, or private endpoint access was used.
- Live-state server snapshot fallback now validates both persisted `savedAt`
  metadata and in-memory `loadedAt` cache timestamps with safe-integer,
  non-future freshness helpers. The intentional unbounded RPC-fallback read
  still skips max-age expiry, but malformed or future persisted timestamps fail
  closed; legacy payload snapshots without an envelope remain compatible. The
  live-state stale fast path now applies the same safe non-future boundary to
  `fetchedAt` before serving stale data immediately. Guarded in `test:logic`;
  no endpoint polling, wallet signing, real transactions, RPC writes, deploy,
  ABI, randomness, tokenomics, secret access, or private endpoint access was
  used.
- Shared client cache timestamp normalization now rejects malformed, fractional,
  unsafe, negative, or too-far-future values before localStorage caches use
  freshness metadata. Deposit history refresh scheduling now computes its
  cache delay through the shared strict helper instead of broad
  `Date.now() - savedAt` arithmetic. Jackpot history, recent wins,
  leaderboards, Safety Pool rebate refresh, and Safety Pool claim-plan cache
  TTL acceptance now use the same helper for initial refresh delay or freshness
  acceptance. Guarded in `test:logic`; no endpoint polling, wallet signing,
  real transactions, RPC writes, deploy, ABI, randomness, tokenomics, secret
  access, or private endpoint access was used.
- Host proof draft/collector numeric parsing now rejects malformed load
  evidence and threshold overrides instead of falling back through broad
  `Number(...)` parsing. Load counts, durations, p95, and finality-lag markers
  use canonical non-negative integer parsing; load error rates and
  `LOAD_MAX_ERROR_RATE` use canonical decimal parsing; `LOAD_MAX_P95_MS` must
  be a canonical positive integer. Guarded in `test:logic`; no host collector
  execution against real artifacts, wallet signing, real transactions, RPC
  writes, deploy, ABI, randomness, tokenomics, secret access, or private
  endpoint access was used.
- Host proof strict validation now also canonical-parses external rate-limit
  replica counts before G6 acceptance. Fractional, leading-zero, malformed, or
  unsafe `webReplicaCount` and `distinctReplicas` values cannot satisfy the
  two-replica shared rate-limit proof. Guarded in `test:logic`; no host
  collector execution against real artifacts, wallet signing, real
  transactions, RPC writes, deploy, ABI, randomness, tokenomics, secret access,
  or private endpoint access was used.
- Host proof strict validation now also canonical-parses `healthProd`
  `finalityLagBlocks=<number>` evidence markers before accepting production
  health proof. Fractional, leading-zero, malformed, or unsafe finality-lag
  text cannot satisfy G5-G6 host evidence through broad `Number(...)`
  fallback. Guarded in `test:logic`; no host collector execution, endpoint
  polling, wallet signing, real transactions, RPC writes, deploy, ABI,
  randomness, tokenomics, secret access, or private endpoint access was used.
- Host proof strict validation now also canonical-parses integer load evidence
  fields before accepting G6 load proof. `requestCount`, `p95Ms`, `maxP95Ms`,
  `durationMs`, and `concurrency` must be canonical safe integers; fractional,
  leading-zero, malformed, or unsafe values cannot satisfy host load proof
  through broad finite-number coercion. Decimal load error-rate fields remain
  decimal checks. Guarded in `test:logic`; no host collector execution,
  endpoint polling, wallet signing, real transactions, RPC writes, deploy, ABI,
  randomness, tokenomics, secret access, or private endpoint access was used.
- Host proof strict validation now also canonical-parses decimal load
  error-rate fields before accepting G6 load proof. `errorRate` and
  `maxErrorRate` must use the same bounded canonical decimal shape as the host
  collector/draft tooling, so exponent-form, over-precise, malformed, or unsafe
  values cannot satisfy strict host load proof through broad finite-number
  coercion. Guarded in `test:logic`; no host collector execution, endpoint
  polling, wallet signing, real transactions, RPC writes, deploy, ABI,
  randomness, tokenomics, secret access, or private endpoint access was used.
- Host proof strict section status output now mirrors accumulated strict issues
  instead of trusting only each section's coarse `status` field. A manifest
  section such as `loadHttp` can no longer display `checked` in the section
  table while strict field-level validation has already rejected that section.
  Guarded in `test:logic`; no host collector execution, endpoint polling,
  wallet signing, real transactions, RPC writes, deploy, ABI, randomness,
  tokenomics, secret access, or private endpoint access was used.
- Host proof strict validation no longer keeps the unused broad
  `asFiniteNumber` helper after all host numeric evidence moved to canonical
  integer or bounded decimal parsers. `test:logic` guards against reintroducing
  the generic helper in the strict host checker. No host collector execution,
  endpoint polling, wallet signing, real transactions, RPC writes, deploy, ABI,
  randomness, tokenomics, secret access, or private endpoint access was used.
- G9 monitoring strict proof now canonical-parses `health-prod` monitor
  cadence before accepting launch monitoring evidence. Fractional,
  exponent-form, malformed, leading-zero, or unsafe cadence values cannot
  satisfy the 60-second health monitor requirement through broad `Number(...)`
  coercion. Guarded in `test:logic` and `proof:drafts:summary`; no monitor
  polling, alert delivery, endpoint access, wallet signing, real transactions,
  RPC writes, deploy, ABI, randomness, tokenomics, secret access, or private
  endpoint access was used.
- G7 indexer dry-run proof scoped threshold inputs now reject malformed values
  before SQLite validation. `INDEXER_DRY_RUN_MIN_SCOPED_EPOCHS`,
  `INDEXER_DRY_RUN_MIN_SCOPED_BETS`, `--min-scoped-epochs`, and
  `--min-scoped-bets` must be canonical non-negative decimal integers, and
  `finalityLagBlocks=` evidence markers use the same parser instead of broad
  `Number(...)` fallback. Guarded in `test:logic`; no indexer run, real DB
  proof execution, RPC, wallet signing, real transactions, deploy, ABI,
  randomness, tokenomics, secret access, or private endpoint access was used.
- G7 indexer strict proof now also rejects malformed deploy/start/finality env
  values before DB validation. `INDEXER_START_BLOCK` and
  `NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK` must be canonical non-negative decimal
  integers, and `INDEXER_FINALITY_BLOCKS` must be a canonical positive decimal
  integer. A malformed summary-only run reports the G7 blocker without reading
  DB paths, RPC, or secrets.
- G7 indexer collector/draft chain snapshot evidence now rejects malformed
  numeric proof values before draft acceptance. `expectedChainId` and
  `rpcChainId` must be canonical positive decimal integers matching the launch
  chain id, and health `finalityLagBlocks=<number>` must be a canonical
  non-negative decimal value. `proof:drafts:summary` covers malformed
  collector and draft regressions for both chain ids and finality lag. Guarded
  in `test:logic`; no indexer run, chain snapshot collection, real DB proof
  execution, RPC, wallet signing, real transactions, deploy, ABI, randomness,
  tokenomics, secret access, or private endpoint access was used.
- G8 restore proof health evidence now rejects malformed `finalityLagBlocks`
  values before draft or strict proof acceptance. Restore collector, draft
  generator, and strict verifier require canonical non-negative decimal
  `finalityLagBlocks=<number>` evidence, and `proof:drafts:summary` covers both
  malformed draft input and malformed strict manifest regressions. Guarded in
  `test:logic`; no restore drill, backup write, real DB proof execution, RPC,
  wallet signing, real transactions, deploy, ABI, randomness, tokenomics,
  secret access, or private endpoint access was used.
- Launch proof origin validation now rejects credential-bearing HTTPS origins
  across host, monitoring, QA, restore, shared collector helpers, and runtime
  monitor proof tooling. Host, indexer, and restore collector/draft regressions
  now reject credentialed health/load evidence base URLs; host and monitoring
  proof regressions also cover credentialed collector/draft origins, strict
  manifest origins, and credentialed monitoring endpoint URLs. Real G5-G9
  readiness still requires external deployed host, health/load, fresh indexer
  DB/finality, monitor, and alert evidence.
- G7 indexer proof draft generation now rejects credentialed or
  path-sensitive `chainSnapshot.rpcSource` values before writing draft
  artifacts, matching the collector and strict checker. Real G7 readiness still
  requires external fresh DB, deploy-block/finality, manifest, and direct-chain
  comparison evidence.
- G1 mainnet/env strict proof now rejects credential-bearing HTTPS-style URLs
  in service endpoints, including keeper RPC, final site origin, and external
  rate-limit URL checks. Compact output keeps only safe failing gate tokens and
  never prints raw endpoint values; real env proof remains blocked until the
  external launch env is configured.
- The same autonomous status summary now breaks out
  `proof:restore:strict:summary` and `db:backup:strict:summary` as their own
  expected-blocker rows. Restore/backup proof can fail for missing configured
  DB, backup, restore, or manifest inputs without being hidden inside broad
  launch environment rows.
- G1 chain strict summary now rejects configured RPC endpoints that are not
  HTTPS or that embed URL credentials. Summary mode still reports only whether
  the RPC source is configured or built-in fallback, never the endpoint value,
  and still performs no RPC reads. Real chain reconciliation remains blocked
  until configured launch RPC evidence is available.
- G8 restore strict proof now rejects future-dated restore drill, restored
  staging health, and indexer-preservation timestamps. `proof:drafts:summary`
  has a `restore-future-timestamp` regression case, so future-dated restore
  evidence cannot satisfy strict proof by being merely well-formed ISO.
- G8 backup strict summary now rejects future-dated source DB modified times
  with a 5-minute clock-skew allowance before reporting readiness or importing
  the SQLite backup library. `test:db-operations:summary` has an executable
  future-source regression and exposes `futureSourceBackupSummaryRejected=true`;
  `proof:prelaunch:summary` surfaces the same local fact as
  `futureSourceBackupRejected=true` while backup and restore launch gates still
  require real external evidence.
- G1-G4 signoff strict proof now rejects future-dated contract environment,
  ownership, randomness signoff, and chain-comparison timestamps.
  `proof:drafts:summary` has a `signoff-future-timestamp` regression case, so
  future-dated signoff evidence cannot satisfy strict proof by being merely
  well-formed ISO.
- G5-G6 host strict proof now rejects future-dated process-model, persistent
  DB, production health, load-test, and external rate-limit timestamps.
  `proof:drafts:summary` has a `host-future-timestamp` regression case, so
  future-dated host evidence cannot satisfy strict proof by being merely
  well-formed ISO.
- G7 indexer strict proof now rejects future-dated dry-run, finality,
  chain-snapshot, and chain-comparison timestamps. `proof:drafts:summary` has
  an `indexer-future-timestamp` regression case, so future-dated indexer
  evidence cannot satisfy strict proof by being merely well-formed ISO.
- G10-G11 canary strict proof now rejects future-dated target-network,
  recovery, Auto-Miner session, and transaction-health manifest timestamps.
  `proof:drafts:summary` has a `canary-future-timestamp` regression case, so
  future-dated canary evidence cannot satisfy strict proof by being merely
  well-formed ISO.
- G10-G11 canary target-network proof now rejects malformed chain-id evidence
  before draft or strict proof acceptance. Canary manifest `targetNetwork.chainId`,
  configured analyzer chain ids, draft `--chain-id`, and successful live-log
  event `chainId` values must be canonical positive decimal integers matching
  the selected proof profile. `proof:drafts:summary` covers malformed canary
  manifest, live-log, and draft-generator regressions. Guarded in
  `test:logic`; no live canary run, wallet signing, real transactions, RPC
  writes, deploy, ABI, randomness, tokenomics, secret access, or private
  endpoint access was used.
- G10-G11 canary transaction-health analysis now rejects malformed nonce
  evidence in successful live-log bet events instead of silently treating it as
  no pending gap. `noncePending` and `nonceLatest` must be canonical
  non-negative decimal integers before nonce-gap comparison; malformed nonce
  evidence is reported as a separate strict proof issue. `proof:drafts:summary`
  covers a malformed live-log nonce regression. Guarded in `test:logic`; no
  live canary run, wallet signing, real transactions, RPC writes, deploy, ABI,
  randomness, tokenomics, secret access, or private endpoint access was used.
- G10-G11 V10 gas-matrix proof analysis now rejects malformed matrix evidence
  instead of silently dropping it as a missing case. Matrix `tiles`, `tileCount`,
  and `gasUsed` values must be canonical decimal integers in the expected
  bounds before they can satisfy a mined-gas case; malformed matrix evidence is
  reported as a separate strict proof issue. Guarded in `test:logic`; no live
  canary run, wallet signing, real transactions, RPC writes, deploy, ABI,
  randomness, tokenomics, secret access, or private endpoint access was used.
- G10-G11 canary duplicate-bet proof now rejects malformed successful-bet tile
  evidence before accepting absence of duplicate role/epoch/tile keys.
  Duplicate detection and repeat signatures use canonical parsed tile IDs
  instead of raw `event.tiles` or broad `tiles.map(Number)` fallback, and
  `proof:drafts:summary` covers a malformed live-log tile regression. Guarded
  in `test:logic`; no live canary run, wallet signing, real transactions, RPC
  writes, deploy, ABI, randomness, tokenomics, secret access, or private
  endpoint access was used.
- G10-G11 canary successful-bet epoch and transaction metric evidence now fails
  closed on malformed values before strict proof acceptance. Successful bet
  epochs must be canonical positive decimal integers for epoch coverage and
  duplicate-key analysis, and present `durationMs`, `gasUsed`,
  `effectiveGasPrice`, or `blockNumber` fields must be canonical non-negative
  decimal integers before stats/trends can use them. `proof:drafts:summary`
  covers malformed live-log epoch and tx-metric regressions. Guarded in
  `test:logic`; no live canary run, wallet signing, real transactions, RPC
  writes, deploy, ABI, randomness, tokenomics, secret access, or private
  endpoint access was used.
- G10-G11 canary manifest/live comparison now canonicalizes
  `autoMinerSession.rounds` and `autoMinerSession.uniqueEpochs` before
  comparing manifest counts to observed live-log counts. Malformed manifest
  counts are rejected by the strict validator and can no longer be silently
  skipped by broad `Number(...)` comparison fallback. `proof:drafts:summary`
  covers a malformed manifest session-count regression. Guarded in
  `test:logic`; no live canary run, wallet signing, real transactions, RPC
  writes, deploy, ABI, randomness, tokenomics, secret access, or private
  endpoint access was used.
- G10-G11 canary `transactionHealth.txHashes` manifest evidence now rejects
  malformed entries even when the same array also contains at least one valid
  transaction hash. The strict validator reports malformed tx-hash entry
  indexes instead of silently filtering them out through `txHashList`.
  `proof:drafts:summary` covers a mixed valid/malformed tx-hash manifest
  regression. Guarded in `test:logic`; no live canary run, wallet signing, real
  transactions, RPC writes, deploy, ABI, randomness, tokenomics, secret access,
  or private endpoint access was used.
- G10-G11 canary `transactionHealth.txHashes` manifest evidence now also
  rejects duplicate valid transaction hashes. The strict validator reports the
  duplicate tx-hash entry indexes after canonical normalization, so repeated
  manifest hashes cannot inflate transaction-health proof coverage.
  `proof:drafts:summary` covers a duplicate tx-hash manifest regression.
  Guarded in `test:logic`; no live canary run, wallet signing, real
  transactions, RPC writes, deploy, ABI, randomness, tokenomics, secret access,
  or private endpoint access was used.
- G10-G11 canary Auto-Miner role manifest evidence now rejects duplicate valid
  `requiredRoles` or `successfulRoles` entries after canonical role
  normalization. The strict validator reports duplicate role entry indexes, so
  repeated roles cannot inflate role-coverage proof. `proof:drafts:summary`
  covers a duplicate Auto-Miner session-role manifest regression. Guarded in
  `test:logic`; no live canary run, wallet signing, real transactions, RPC
  writes, deploy, ABI, randomness, tokenomics, secret access, or private
  endpoint access was used.
- G10-G11 canary compact manifest status now mirrors the same strict section
  predicates for Auto-Miner session and transaction-health evidence. The
  manifest summary reports `issue` instead of `checked` when Auto-Miner role
  duplicates, weak Auto-Miner evidence, malformed/duplicate transaction hashes,
  or weak transaction-health evidence are present. Guarded in `test:logic`; no
  live canary run, wallet signing, real transactions, RPC writes, deploy, ABI,
  randomness, tokenomics, secret access, or private endpoint access was used.
- G10-G11 canary compact `targetNetwork` manifest status now mirrors strict
  configured-target validation. The manifest summary reports `issue` instead
  of `checked` when the manifest target network, chain id, or contract address
  fails to match the active configured proof inputs. Guarded in `test:logic`;
  no live canary run, wallet signing, real transactions, RPC writes, deploy,
  ABI, randomness, tokenomics, secret access, or private endpoint access was
  used.
- G10-G11 canary elapsed-time proof now rejects malformed successful-bet
  timestamps instead of silently dropping them through `Date.parse` filtering.
  Successful bet timestamps must be canonical ISO-8601 UTC before strict
  canary evidence can use the run for duration/soak coverage, and elapsed-time
  calculation now uses the shared canonical ISO timestamp parser instead of
  broad `Date.parse`.
  `proof:drafts:summary` covers a malformed successful-bet timestamp
  regression. Guarded in `test:logic`; no live canary run, wallet signing, real
  transactions, RPC writes, deploy, ABI, randomness, tokenomics, secret access,
  or private endpoint access was used.
- G10-G11 canary successful-role evidence now rejects malformed role labels
  before strict proof accepts role coverage. Successful bet roles must
  canonicalize through the same role parser used for required-role matching,
  and malformed values are reported as their own strict issue instead of being
  silently folded into missing-role coverage. `proof:drafts:summary` covers a
  malformed successful-role live-log regression. Guarded in `test:logic`; no
  live canary run, wallet signing, real transactions, RPC writes, deploy, ABI,
  randomness, tokenomics, secret access, or private endpoint access was used.
- The managed workspace cleanup loop is running again with the 8-hour interval.
  Its first apply pass matched no delete targets and the next run is scheduled
  by the loop status file; only allowlisted generated/cache/report paths are
  age-gated for deletion.
- Launch command map and production runbook now document the compact V10 canary
  matrix summary command alongside the general/testnet canary checks, keeping
  operator evidence collection aligned with the prelaunch aggregator.
- The opt-in `linea_estimateGas` shadow adapter now also records live canary bet
  path comparisons after the existing baseline estimate and before fee clamping.
  It remains evidence-only: transaction gas limits still use the current
  estimator/fallback path.
- Live canary console output now keeps contract/token addresses behind
  `LIVE_TEST_VERBOSE_TARGETS=1`. Routine dry-runs print only configured target
  status plus aggregate role/readiness data, reducing accidental address
  leakage in autonomous status logs.
- Server-side bootstrap resolve keeps the empty-epoch no-op before keeper gas
  estimation or writes, so idle expired epochs do not burn resolver gas through
  the API path. `npm.cmd run test:logic` now guards this ordering.
- Keeper pending resolve recovery now only considers a bound-nonce replacement
  after receipt-not-found style evidence plus the existing age/nonce-gap
  checks. Network-like receipt failures and unknown provider/RPC receipt errors
  wait and retry instead of flowing into replacement, preserving fail-closed
  behavior around ambiguous keeper receipt status.
- The remaining dormant browser resolve cleanup artifact has been removed from
  `ErrorCatcher`. Client source now has a `test:logic` guard that permits
  `resolveEpoch` references only in ABI/docs/fetch-only bootstrap hook
  locations, so browser wallet code cannot retain a hidden unattended resolve
  sweep path.
- Auto-Miner start persistence now sits behind the exclusive tab-lock gate.
  The UI toggle no longer writes a restorable session before the runner owns
  the browser Web Lock, and the runner binds the preferred actor once before
  setup so a fast account switch cannot persist a session for a different
  actor than the prepared run. If lock acquisition fails, existing persisted
  recovery state is preserved instead of being cleared by the second tab.
  Verified with `npm.cmd run test:logic:summary`,
  `npm.cmd run typecheck:summary`,
  `npm.cmd run proof:security-followup:summary`, and
  `npm.cmd run proof:local:summary`.
- Auto-Miner tab-lock metadata sanitization now rejects malformed, fractional,
  unsafe, negative, or too-far-future lock timestamps before orphan recovery or
  ping/pong liveness checks use a stored lock. The native Web Locks-only start
  gate is unchanged; this only hardens recovery hygiene around stale
  localStorage lock records. Guarded in `test:logic`; no wallet signing, real
  transactions, RPC writes, deploy, ABI, randomness, tokenomics, secret access,
  or private endpoint access was used.
- Auto-Miner persisted session recovery now rejects fractional or unsafe
  `blocks`, `rounds`, and `nextRoundIndex` metadata before reload/reconnect
  resume decisions use a saved run. Existing bounds and run-id/actor checks are
  unchanged; this only closes broad integer acceptance in local recovery
  counters. Guarded in `test:logic`; no wallet signing, real transactions, RPC
  writes, deploy, ABI, randomness, tokenomics, secret access, or private
  endpoint access was used.
- Auto-Miner persisted recovery now carries a bounded local run id and actor
  inside the chain+contract-scoped session record. Checkpoints, stop/finalize,
  and inactive controllers must not overwrite or clear a different actor/run
  session, while actor-mismatched restore checks return no-resume without
  deleting the saved run. Verified with `npm.cmd run test:logic:summary`,
  `npm.cmd run typecheck:summary`, `npm.cmd run proof:autonomous:summary`, and
  scoped `git diff --check`. No wallet signing, transaction sending, RPC,
  deployment, ABI, randomness, tokenomics, or secret access was used.
- Pending mining transaction recovery now rejects persisted records with an
  explicitly malformed tx hash or nonce instead of silently downgrading to the
  remaining field. Chain+contract+actor-scoped recovery still supports
  hash-known and nonce-only pending states, but corrupted hash/nonce evidence
  fails closed and is cleared by the existing read path. Verified with
  `npm.cmd run test:logic:summary`, `npm.cmd run typecheck:summary`,
  `npm.cmd run proof:autonomous:summary`, and scoped `git diff --check`. No
  wallet signing, transaction sending, RPC, deployment, ABI, randomness,
  tokenomics, or secret access was used.
- Pending mining transaction scoped storage lookups now fail closed when the
  requested contract or actor scope is malformed. `readPendingMiningTxState`
  and `clearPendingMiningTxState` return without throwing instead of letting a
  cleanup path crash recovery UI or duplicate-send guards. Verified with
  `npm.cmd run test:logic:summary`, `npm.cmd run typecheck:summary`,
  `npm.cmd run proof:autonomous:summary`, and scoped `git diff --check`. No
  wallet signing, transaction sending, RPC, deployment, ABI, randomness,
  tokenomics, or secret access was used.
- Shared bounded JSON request parsing now rejects body-bearing API requests
  without an explicit JSON `Content-Type`. The parser still checks bounded
  `Content-Length` before reading the stream, preserves `application/json` and
  structured `+json` media types, and keeps route-level unsupported media type
  responses on the existing no-store `415` boundary. Client POST call sites
  already send `Content-Type: application/json`, and `test:logic` now scans app
  `POST`/`PUT`/`PATCH` JSON body fetches to keep that client boundary from
  regressing. Verified with `npm.cmd run test:logic:summary`,
  `npm.cmd run typecheck:summary`, `npm.cmd run proof:autonomous:summary`, and
  scoped `git diff --check`; no wallet signing, transaction sending, RPC,
  deployment, ABI, randomness, tokenomics, or secret access was used.
- Client JSON response parsing now rejects explicit non-JSON media types before
  body parsing. `readJsonResponse` still permits absent content type for
  synthetic/no-body responses, still enforces the response byte cap, and now
  rejects malformed `Content-Length` values instead of broad `Number(...)`
  coercion. HTML/text proxy failures and malformed length headers map to the
  redacted `Invalid JSON response` message instead of exposing raw response
  bodies. Covered by `test:logic`; no wallet signing, transaction sending, RPC,
  deployment, ABI, randomness, tokenomics, or secret access was used.
- Shared no-store response header merging now preserves an existing `Vary: *`
  wildcard when session responses request `Vary: Cookie`. Normal
  case-insensitive Cookie merging is unchanged, but the helper no longer emits
  mixed wildcard values such as `*, Cookie`. Covered by `test:logic`; no wallet
  signing, transaction sending, RPC, deployment, ABI, randomness, tokenomics,
  or secret access was used.
- API data bridge epoch filtering now reuses the shared strict positive integer
  parser for current-epoch values and stored row epoch keys. Scientific
  notation, whitespace, hex, fractional, zero, negative, and unsafe integer
  epoch values are rejected instead of being accepted through broad
  `Number(...)` coercion before current-epoch filtering. Covered by
  `test:logic` source guards and the shared parser's executable malformed-value
  coverage; no wallet signing, transaction sending, RPC, deployment, ABI,
  randomness, tokenomics, or secret access was used.
- Shared stored number parsing now rejects non-canonical, oversized, unsafe,
  scientific-notation, fractional, negative, and leading-zero stored decimal
  strings before numeric conversion. Deposits, recent wins, jackpot service,
  and the epochs API reuse that parser for stored block/epoch keys; the epochs
  route no longer uses broad `Number(key)` while filtering current epochs or
  reconciling missing rows. Covered by `test:stored-number-parsing` and
  `test:logic`; no wallet signing, transaction sending, RPC, deployment, ABI,
  randomness, tokenomics, or secret access was used.
- Shared API positive-integer query parsing now rejects leading-zero decimal
  strings in addition to scientific notation, whitespace, hex, fractional,
  zero, negative, and unsafe values. Cursor, limit, requested-epoch, and JSON
  epoch value parsing stay canonical decimal-only before cache-key,
  pagination, or storage work. Covered by `test:logic`; no wallet signing,
  transaction sending, RPC, deployment, ABI, randomness, tokenomics, or secret
  access was used.
- Production health and runtime monitor proof scripts now strictly parse
  response `Content-Length` headers before reading bounded bodies. Malformed,
  leading-zero, fractional, negative, scientific-notation, or unsafe lengths
  fail closed instead of being broadly coerced during host/monitoring evidence
  collection. Covered by `test:logic`; no wallet signing, transaction sending,
  RPC writes, deployment, ABI, randomness, tokenomics, or secret access was
  used.
- HTTP and browser smoke scripts now apply the same strict `Content-Length`
  parsing before local proof response reads, including the shared browser
  warmup reader. Malformed, leading-zero, fractional, negative,
  scientific-notation, or unsafe lengths fail closed before smoke assertions
  parse HTML/JSON bodies. Covered by `test:logic`; no wallet signing,
  transaction sending, RPC writes, deployment, ABI, randomness, tokenomics, or
  secret access was used.
- Solidity compiler advisory proof now strictly parses the official bug
  database response `Content-Length` before reading bounded JSON. Its self-test
  covers both oversized and malformed header rejection, keeping the required V10
  compiler advisory row fail-closed on malformed transport metadata. Covered by
  `test:logic`; no wallet signing, transaction sending, RPC writes, deployment,
  ABI, randomness, tokenomics, or secret access was used.
- V10 gas benchmark RPC reads, live canary health samples, and wallet playtest
  API probes now strictly parse response `Content-Length` headers before
  reading bounded JSON/text bodies. Malformed, leading-zero, fractional,
  negative, scientific-notation, or unsafe lengths fail closed instead of being
  broadly coerced in these operator paths. Covered by `test:logic`; no live
  canary, wallet playtest execution, wallet signing, transaction sending, RPC
  writes, deployment, ABI, randomness, tokenomics, or secret access was used.
- Browser performance baseline timing env now uses canonical decimal parsing
  for `BASELINE_OBSERVE_MS` and `BASELINE_SAMPLE_MS`. Malformed, partial,
  fractional, negative, unsafe, or out-of-range values fail closed instead of
  being accepted through `parseInt` prefix coercion. Covered by `test:logic`;
  no browser run, wallet signing, transaction sending, RPC writes, deployment,
  ABI, randomness, tokenomics, or secret access was used.
- Workspace cleanup age and loop interval env now use strict decimal-hour
  parsing for `CLEANUP_MIN_AGE_HOURS` and `CLEANUP_INTERVAL_HOURS`. Malformed,
  partial, negative, unsafe, or out-of-range values fail before deletion or
  scheduling instead of being accepted through `parseFloat` prefix coercion.
  The allowlisted cleanup targets and age gates are unchanged. Covered by
  `test:logic`; no cleanup apply, process control, wallet signing, transaction
  sending, RPC writes, deployment, ABI, randomness, tokenomics, or secret
  access was used.
- Workspace cleanup loop PID records now use the same canonical positive PID
  parsing boundary as admin process status before liveness checks. Typed JSON
  records and legacy raw PID files are parsed through a bounded decimal parser;
  malformed, partial, zero, negative, unsafe, or out-of-range values are ignored
  instead of reaching `process.kill(pid, 0)` or crashing the loop on raw legacy
  files. Covered by `test:logic`; no loop start/stop, process termination,
  cleanup apply, wallet signing, transaction sending, RPC writes, deployment,
  ABI, randomness, tokenomics, or secret access was used.
- Autonomous cleanup wrapper validation now strictly parses
  `CLEANUP_AUTONOMOUS_TIMEOUT_MS` and requires cleanup summary counts/bytes to
  be non-negative safe integers before any apply path can run. Fractional,
  unsafe, negative, or malformed child JSON summaries block instead of being
  treated as valid cleanup evidence. Covered by `test:logic`; no cleanup apply,
  loop start/stop, process termination, wallet signing, transaction sending,
  RPC writes, deployment, ABI, randomness, tokenomics, or secret access was
  used.
- Shared route cache writes now compute expiry through a fail-closed TTL helper.
  `NaN`, non-positive, fractional, infinite, and overflow-risk TTL values are
  stored only as stale fallback payloads and cannot remain fresh because of
  broad `Date.now() + ttlMs` arithmetic. The same helper now normalizes invalid
  cache capacities to zero and prunes using iterator `done`, so
  `NaN`/fractional/infinite capacities cannot disable eviction and an empty
  string cache key cannot stop the LRU loop. Fresh reads now also reject
  malformed caller-supplied `now` values instead of letting `NaN`/infinite
  comparisons keep an entry fresh. Covered by `test:logic` direct
  `set()`/`setIfLatest()`, invalid-`now`, invalid-capacity, empty-key LRU
  regressions, and source guards; no wallet signing, transaction sending, RPC,
  deployment, ABI, randomness, tokenomics, or secret access was used.
- Shared API rate-limit 429 responses now use one no-store response builder
  that sets both the JSON `retryAfter` field and the standard `Retry-After`
  header with a bounded positive integer. Local fallback, weak-identity
  fallback, external Redis limiter, and SQLite limiter paths all route through
  that builder, while existing 503 fail-closed paths remain unchanged. Verified
  with `npm.cmd run test:logic:summary`,
  `npm.cmd run typecheck:summary`,
  `npm.cmd run proof:local:summary`, and
  `npm.cmd run proof:autonomous:summary`.
- Shared API rate-limit configuration now fails closed before identity, local
  fallback, SQLite, or external Redis paths when `limit` or `windowMs` is not a
  positive safe integer. Malformed limiter options return a no-store redacted
  `503` instead of reaching `count >= NaN` or `now % NaN` math that could
  disable local throttling. Covered by executable invalid limit/window
  regressions and a source guard in `test:logic`; no wallet signing,
  transaction sending, RPC, deployment, ABI, randomness, tokenomics, or secret
  access was used.
- Admin process status now parses tracked PID files as canonical positive
  decimal values within a bounded PID range. Scientific notation,
  whitespace-only/coerced, zero, negative, fractional, unsafe, or out-of-range
  PID file contents are ignored instead of being accepted through broad
  `Number(raw)` parsing before `process.kill(pid, 0)`. Covered by `test:logic`
  source guards; no process start, process kill, wallet signing, transaction
  sending, RPC, deployment, ABI, randomness, tokenomics, or secret access was
  used.
- Admin ops stored epoch keys and live indexer log counters now parse through a
  bounded safe decimal helper before numeric conversion. Oversized,
  leading-zero, unsafe, zero-for-positive, scientific-notation, fractional, or
  malformed values fail closed to `0`/`null` instead of reaching dashboard
  progress math through broad `Number(...)` coercion. Covered by `test:logic`
  source guards; no process control, wallet signing, transaction sending, RPC,
  deployment, ABI, randomness, tokenomics, or secret access was used.
- V10 invariant coverage now includes exact timelock boundary models for
  pending fee-recipient and epoch-duration changes. The modeled cases require
  no apply before `eta`, apply exactly at `eta`, and for epoch duration also
  require the effective epoch. `test:contract:v10:summary` now exposes this as
  `timelockBoundaryCases=9`.
- Indexer normalized transaction-event ids now require both `transactionHash`
  and `logIndex`. Reward/rebate claim, dust, resolver reward, and protocol-fee
  rows from partial RPC logs are skipped instead of being collapsed into
  synthetic `nohash_0` ids. `test:indexer-storage:summary` now exposes
  `normalizedEventIdRequiresTxLog=true`.
- Prelaunch summary projection now also surfaces the latest V10 and indexer
  compact counters: `timelockBoundaryCases=9` in the V10 invariant row and
  `normalizedEventIdRequiresTxLog=true` in the ABI/indexer row. A fresh
  `npm.cmd run proof:prelaunch:summary` passed all required local rows and
  still reported the expected 23 external/status launch-evidence blockers.
- `proof:prelaunch:summary` now streams its table header and each completed
  status row as child checks finish, instead of staying silent until the full
  aggregate completes. This preserves every local/external gate row while
  making long prelaunch runs operationally visible.
- A fresh streaming `npm.cmd run proof:prelaunch:summary` completed end-to-end:
  every required local row passed, while 23 external/status rows still reported
  missing launch evidence across backup, canary, chain, contract, env, host,
  indexer, launch, monitoring, QA, restore, and signoff groups. The slowest
  local rows were production build, V9 invariants, business logic, V10 compiler
  matrix, and ESLint.
- The latest V10 pre-bet dry-run preview is reproducible with
  `npm.cmd run preview:canary:v10:dry-run` and captured in
  `docs/v10-canary-dry-run-preview.md`. The wrapper forces non-executing child
  env flags, runs the read-only planner, pending nonce dry-run, bounded V10
  matrix dry-run, and strict analyzer, then writes a redacted Preview. The
  current run reports a 7-transaction claim/flush phase, pending nonce gap `0`,
  `plannedBetTx=12`, `plannedStake=0.84` LINEA, wallet preflight `ready=3/3`,
  and no transaction/signing/wallet-client activity. Dry-run canary proof still
  correctly blocks G10/G11 because there are zero successful live bet
  transactions.
- Production runbook and launch evidence command map now document
  `npm.cmd run preview:canary:v10:dry-run` as the mandatory pre-bet dry-run
  Preview path before fresh consent. The launch map verifier and business-logic
  guards require the command, the `docs/v10-canary-dry-run-preview.md` artifact,
  and explicit language that the Preview does not satisfy G10/G11 without live
  successful canary transactions.
- `docs/v10-deployed-identity-boundary.md` now captures the fresh Linea Sepolia
  V10 identity boundary. Offline canonical identity passes, while the read-only
  deployed verifier still reports `runtimeExecutable=true`,
  `metadataOnlyMismatch=true`, `runtimeBytecode=false`, and
  `transactionSent=false`. This is documented as behavior/gas evidence only;
  redeploy and G1-G4 sign-off remain separate external decisions.
- `proof:remaining:summary` now prints a bounded `Remaining gate worklist` for
  every open G1-G14 row. Each line includes the gate group, current status,
  required proof file, compact status command, and sanitized marker tokens. The
  JSON output also includes `gateActions` for automation handoff, while the
  summary keeps the autonomous boundary as `local-hardening-only`.
- Final security scan evidence is now an explicit G14 blocker across the
  status board, proof record, readiness checklist, production runbook, launch
  evidence command map, and gate verifiers. The required marker is a fresh
  Codex Security scan report or sealed scan artifact for the exact launch
  candidate with no open High/Medium local findings; the local
  `proof:security-followup:summary` remains required regression evidence but
  does not replace that final scan. Verified with
  `npm.cmd run proof:gates:structure`, `npm.cmd run proof:readiness:summary`,
  `npm.cmd run proof:launch-map:summary`, `npm.cmd run test:logic:summary`,
  `npm.cmd run proof:remaining:summary`, and targeted `git diff --check`.
  The compact G14 worklist now prints both `final-security-scan` and
  `no-open-high-medium-local-findings` instead of hiding the second marker
  behind a `+1` suffix.
- A fresh daily autonomous read-only gate passed: production dependency
  high/critical counts remain `0`, all-scope high advisories remain the
  documented `knownDev=9` dev-toolchain set, wallet dependency integrity passed,
  bundle baseline stayed under budget, and cleanup dry-run would delete `0`
  targets.
- CI security follow-up now has a standalone compact proof command,
  `npm.cmd run proof:ci-security:summary`, and the daily autonomous summary
  includes it. The current check passes with read-only `contents` permissions,
  no `pull_request_target`, SHA-pinned third-party actions, checkout
  `persist-credentials: false`, and `issues=0`.
- Residual security-scan follow-up now also has a standalone compact proof
  command, `npm.cmd run proof:security-followup:summary`, and the lightweight
  autonomous status summary includes it. The current check passes 7/7 local
  residual classes: bootstrap host auth/shared lock, Auto-Miner Web Locks,
  keeper pending nonce/receipt ambiguity, deposits recovery limiter, live
  dry-run defaults, CI security, and browser auto-resolve wallet-send
  exclusion. This is local regression evidence only; signed wallet matrix,
  live V10 canary/soak, external DB/finality, and G1-G14 launch evidence
  remain separate blockers.
- `proof:prelaunch:summary` now includes the residual security follow-up as a
  required local row. A fresh run passed all required local rows, including
  `security follow-up | proof:security-followup:summary | yes | 0 |
  status=pass, checks=7, passed=7, failed=0, failedIds=none`, while still
  reporting the expected 23 external/status launch-evidence blockers.
- `proof:local` and `proof:local:summary` now also include the residual
  security follow-up as local check `L16`. Both full and compact modes pass and
  summarize the result as `status=pass, checks=7, passed=7, failed=0,
  failedIds=none`, so the local launch proof preflight cannot skip the
  security-scan regression classes while still treating strict launch proof as
  an expected external-evidence failure.
- The broad `check:summary` local gate now runs `proof:security-followup` after
  business logic and before the focused parsing/contract/indexer/build/browser
  checks. A fresh run completed successfully end-to-end, including lint,
  business logic, residual security follow-up, fetch-timeout, stored-number
  parsing, V9/V10 contract tests, indexer storage, DB operations, monitoring,
  production build, typecheck, HTTP smoke, and browser smoke.
- A fresh daily autonomous read-only summary passed after the latest local
  changes: production dependency high/critical counts remain `0`, all-scope
  high advisories remain the documented `knownDev=9` dev-toolchain exceptions,
  wallet dependency integrity passed, bundle baseline stayed under budget, and
  cleanup dry-run matched `0` delete targets.
- The remaining local ESLint warning in the V10 invariant test was removed.
  `npm.cmd run lint:summary` now reports `warnings=0` and
  `npm.cmd run test:contract:v10:summary` still passes with the same V10 model
  counters.
- V10 contract invariants now also pin aggregate financial exits
  (`claimRewards`, rebate batch claim, reward/rebate dust batches) to finish
  their calldata loops and empty-result guards before the single token transfer,
  protecting both gas profile and CEI/reentrancy assumptions.
- V10 invariant coverage also requires every classified external token-moving
  entrypoint to remain `external nonReentrant` alongside the exact SafeERC20
  call-count checks, strengthening the local malicious-callback and transient
  reentrancy proof without modifying the contract.
- V10 invariant coverage also pins single financial claim exits
  (`claimResolverRewards`, `claimEpochRebate`, and `claimReward`) to close
  accounting liability before the token transfer and emit the claim event only
  after that transfer path. This keeps single-exit receipt evidence aligned
  with the existing aggregate claim/event-order guards.
- V10 rebate invariant coverage now pins the remaining-liability cap in
  `_previewRebateFromData` and the `_consumeRebate` order: compute the capped
  amount, skip zero claims, close the per-user claim flag, then close the
  aggregate claimed liability before any caller path can transfer tokens. A
  full-range sequential rebate model also checks that rounded claims cannot
  overdraw the rebate pool.
- V10 invariant coverage now includes a protocol-fee flush success/revert
  model. Successful flushes close exactly the positive owner/burn liabilities
  and emit pre-close amounts; simulated owner or burn transfer failure restores
  both liabilities and emits no flushed evidence, matching EVM atomic rollback
  expectations around the existing CEI source guard.
- V10 invariant coverage now pins fee-recipient timelock application before
  every current `feeRecipient` token transfer path. Dust settlement paths must
  call `_applyPendingFeeRecipientIfReady()` before transfer, and
  `flushProtocolFees` must apply the matured recipient before entering the
  internal protocol-fee transfer helper.
- V10 invariant coverage now includes duplicate/replay batch models for reward
  claims, rebate claims, reward dust settlement, and rebate dust settlement.
  Duplicate calldata entries must close or count an epoch at most once, while a
  resolver reward replay model preserves a single transfer from the pending
  amount.
- The compact V10 invariant summary and prelaunch aggregator now surface the
  same model evidence as `protocolFeeFlushCases=7` and
  `duplicateBatchCases=4`, so autonomous/prelaunch proof output no longer drops
  those coverage counters.
- The compact V10 invariant summary and prelaunch aggregator now also surface
  the one-year reward/rebate claim-to-dust boundary as `dustBoundaryCases=19`.
  The cases cover `deadline - 1`, exact deadline, and `deadline + 1` across
  single/batch reward and rebate claims, plus repeated rebate-dust closure
  models, keeping the local dust-window proof visible without changing
  contract code.
- A fresh periodic `npm.cmd run check:summary` passed after the latest V10,
  indexer, wallet, API, and performance evidence updates. The summary completed
  lint, business logic, fetch-timeout, stored-number parsing, V9/V10 contract
  tests, indexer storage, DB operations, monitoring, production build,
  typecheck, HTTP smoke, and browser smoke; the smoke server on port 3101
  exited. This is local evidence only and does not close external launch,
  canary, deployed-identity, wallet-signing, backup/restore, host, monitoring,
  or sign-off blockers.
- Production-like runtime validation now rejects placeholder or too-short
  `UPSTASH_REDIS_REST_TOKEN` values when multiple web replicas require shared
  external rate limiting, instead of accepting mere token presence.
- External rate-limit store counters now use strict integer parsing for the
  Redis `count` and `ttl` response values. Safe integer numbers and decimal
  strings are accepted; scientific, fractional, negative, unsafe, or malformed
  values fail closed as invalid counters instead of being broadly coerced.
- External rate-limit store responses now also preflight strict
  `Content-Length` before streaming the body. Malformed or oversized response
  lengths fail closed as invalid store responses without reading the body.
- Monitoring strict proof now requires the verified Resend email sender or
  sender domain to match the proof origin, in addition to recipient and delivery
  evidence. The draft generator writes sender/senderDomain TODO fields derived
  from the origin, so G9 cannot pass with a generic email alert target.
- The production runbook now documents the same non-placeholder Redis token
  requirement for `WEB_REPLICA_COUNT=2+`, with a business-logic guard so operator
  docs cannot drift from the runtime validator.
- Env templates now document the same strict pre-mainnet production-like shape:
  `WEB_REPLICA_COUNT=2`, public HTTPS Upstash REST URL, non-placeholder Redis
  token, `RATE_LIMIT_EXTERNAL_FAIL_CLOSED=1`, Resend sender/recipient settings,
  and backup freshness settings. `.env.example` no longer suggests a
  one-replica pre-mainnet strict setup, and `.env.local.example` now shows the
  strict staging/canary placeholders without exposing secrets.
- Business-logic checks now enumerate every `app/api/**/route.ts(x)` JSON route
  and require a no-store response boundary, preventing future wallet/live/admin
  API additions from accidentally becoming cacheable while leaving OG image
  routes cache-policy independent.
- Bounded JSON body coverage now directly exercises oversized streaming request
  bodies whose `reader.cancel()` path throws. The parser must still return
  `too-large`, keeping rate-limit/auth/API payload failures classified by size
  instead of masking them as malformed JSON.
- Bounded JSON body parsing now rejects malformed or unsafe `Content-Length`
  values instead of broadly coercing scientific, fractional, negative, or
  unsafe integer header values. Valid oversized decimal lengths still fail as
  `too-large`, while absent lengths continue through the streaming byte cap.
- The same API source guard now requires session-cookie routes to keep
  `Vary: Cookie` coverage through `varyCookie: true`, protecting admin/chat
  responses from shared proxy cache mixing if future route code changes.
- The shared no-store response helper now merges `Vary: Cookie`
  case-insensitively and canonicalizes duplicate cookie entries. `test:logic`
  exercises the real helper so repeated session-sensitive wrappers cannot drift
  into `cookie, Cookie` style duplicated cache metadata.
- Deep claim/rebate history pagination now uses a shared strict decimal integer
  query parser for `cursor` and `limit`, rejecting scientific notation,
  fractional, signed, whitespace-padded, zero, and unsafe values before storage
  lookups or contract multicalls. `test:logic` guards both routes.
- Deep claim/rebate history pagination now also rejects `limit` values above
  each route's documented maximum instead of silently clamping them. The normal
  frontend page sizes remain within the max, while oversized direct API probes
  fail with the existing invalid-limit boundary before storage or multicall
  work.
- The same strict parser now covers public `epochs` query IDs and rewards body
  epoch arrays. Non-decimal string IDs such as scientific notation, fractional
  values, whitespace-padded values, and unsafe integers are ignored before
  cache-key, storage, or reward summary work while existing request caps remain
  unchanged.
- Rewards POST now preserves the bounded body parser's unsupported media type
  classification: explicit non-JSON payloads return a no-store `415` with a
  JSON-specific message instead of being collapsed into a generic malformed
  payload `400`.
- Chat message/profile POST routes now preserve the same unsupported media type
  classification: explicit non-JSON payloads return no-store, `Vary: Cookie`
  `415` responses before session comparison or chat storage writes.
- Admin process-control POST now preserves that unsupported media type
  classification as a no-store, `Vary: Cookie` `415` before target validation
  or any local process start branch. The route remains disabled in production
  unless explicitly enabled for local admin operations.
- `test:logic` now has a shared guard for every API route that uses
  `readBoundedJsonBody`: each listed bounded-body route must keep an explicit
  unsupported media type `415` branch and must not use unbounded
  `request.json()`.
- Bootstrap resolver POST body rejection now fails closed for malformed or
  non-zero `Content-Length` and for request body streams without relying on
  bounded body parsing. This keeps the route a header-only trigger and rejects
  unsupported bodies before rate-limit, RPC, gas estimation, or keeper writes.
- `npm.cmd run baseline:bundle:summary` now includes the top five largest
  static files in its compact JSON, so performance regressions are actionable
  without reading the full build-output artifact.
- Decorative canvas effects for background particles and win confetti are now
  explicitly `aria-hidden`, with source guards to keep the accessibility tree
  focused on game state rather than purely visual animation layers.
- The shared dialog focus trap now keeps Escape handlers fresh through a ref
  without remounting the trap on callback identity changes, reducing mobile
  modal focus/scroll jumps during ordinary React renders.
- A transaction-free local production browser baseline passed at both desktop
  and mobile viewports with zero unexpected request failures, console errors,
  or horizontal overflow. It uses an isolated weak-identity test setting only
  because production correctly fails closed without trusted proxy identity;
  this validates UI behavior but does not satisfy host or external rate-limit
  configuration gates.
- Manual bet primary actions now link their assistive description to the
  currently visible pause, insufficient-balance, input-error, live-sync, or
  fallback disabled reason instead of referencing a hidden reason node.
- Manual and repeat bet handlers now surface an explicit warning when a
  submission comes back as still `pending`, so an ambiguous wallet/RPC send does
  not merely clear the pending spinner. This is UX/runtime state handling only:
  pending tx persistence, duplicate-send suppression, retry rules, and
  finalize-on-confirmed behavior are unchanged.
- Wallet Settings pending-nonce repair now uses the shared receipt classifier
  after the replacement hash is known. Hash-known receipt timeouts surface as
  still-pending with an explorer link, and confirmed repair outcomes include
  the same tx link instead of silently swallowing receipt lag and reporting an
  unlinked clear/replacement result.
- Normal and deep reward claim failure copy now classifies wallet timeout,
  confirmed revert, insufficient gas/balance, and wallet/RPC provider failures
  through the shared reward claim formatter, matching the duplicate-safe
  transaction-state language used by other wallet actions without changing
  claim submission, gas estimation, receipt handling, explorer links, or actor
  guards.
- Wallet Settings pending-nonce repair now binds the repair flow to the
  starting Privy wallet actor. If the embedded wallet changes after nonce
  refresh, nonce-too-low refresh, receipt classification, or final refresh, the
  repair stops before stale status notifications or follow-up actions.
- Deep reward single and batch claim flows now surface wallet rejection instead
  of silently returning after a rejected wallet prompt. Batch deep claims only
  show the rejection message when no prior claim succeeded and no transaction is
  still pending, preserving the existing partial-success and ambiguous-pending
  UX.
- Safety Pool split claims now update their confirmed epoch count immediately
  after every successful batch or single-epoch fallback, so a later rejected
  wallet prompt keeps the partial-success warning accurate instead of reporting
  the whole flow as a plain rejection. This is a client accounting/UX guard
  only; claim calldata, gas estimation, receipt confirmation, and contract
  assumptions are unchanged.
- Runtime and data-sync health routes now use the shared no-store response
  helper instead of duplicating cache headers inline, reducing drift risk while
  preserving existing public/private redaction behavior.
- Fetch timeout coverage now checks that `fetchWithTimeout` removes caller
  abort listeners after successful requests. This keeps repeated API/client
  probes from retaining stale cancellation hooks after the timeout wrapper
  completes.
- Client auto-resolve remains browser fetch/keeper API-only with no wallet
  resolve transaction path, and its `retryAfter` clamping now has direct unit
  coverage for invalid, negative, small, string, and oversized values. The
  retry window remains bounded to the existing 30s..300s range.
- The same client auto-resolve guard now explicitly requires the hook to remain
  a read-only `epochs` precheck followed by `/api/bootstrap-resolve` and rejects
  wallet/write/send primitives, encoded calldata, simulated mutations, or any
  request body payload in the browser hook source.
- Auto-Miner Web Lock coverage now includes an executable setup regression:
  when native lock acquisition fails and orphan recovery cannot recover a lock,
  setup returns `null`, resets UI state, and does not mark a run started, read
  wallet send functions, ensure wallet readiness, approve, or perform gas
  checks before the exclusive tab lock.
- Route error redaction coverage now includes executable checks for
  `describeSafeRouteError` and `logRouteError`: provider URLs, bearer tokens,
  hex/private-key-like values, wallet addresses, route labels, messages, and
  structured extras must be redacted before public console output while safe
  status fields remain visible.
- Bounded JSON body coverage now dynamically discovers every
  `app/api/**/route.ts(x)` file using `readBoundedJsonBody` and requires each
  route to keep an explicit unsupported-media `415` branch and avoid
  unbounded `request.json()`, so future JSON-writing API routes cannot fall
  outside the local gate.
- Live canary dry-run safety now source-guards the optional resolver private-key
  parsing behind the post-preflight `if (DRY_RUN) return` boundary. Routine
  dry-runs continue to use only public role addresses, while resolver signing
  material remains restricted to explicit live execution.
- Auto-resolve localStorage guard entries now reject invalid JSON timestamps
  instead of treating them as `ts: 0`; only legacy raw epoch strings migrate to
  a fresh timestamped JSON envelope. Corrupt guard entries are cleared on read,
  keeping client-side keeper throttling bounded and recoverable.
- Deposits API slow recovery now has an explicit source guard that the global
  in-flight limiter must return `null` for concurrent/cooldown-bound recovery
  instead of returning another user's active chain-scan Promise. This preserves
  the existing global RPC-load bound while making cross-user deposit payload
  isolation a local regression check.
- `health:prod:summary` now provides a compact production-health entrypoint.
  It reuses the same checks as `health:prod`, emits bounded JSON for failure
  cases, omits the raw base origin from successful summary output, and stays
  fail-closed before network polling when the production origin or diagnostics
  secret is not configured.
- Dependency audit now has compact aliases `proof:deps:summary` and
  `proof:deps:all:summary`, and the aggregate prelaunch status uses them
  instead of printing audit tables. The latest aggregate row preserves
  production audit counters as `total=39`, `high=0`, `critical=0`,
  `blocking=0`, and all-dependency counters as `total=51`, `high=9`,
  `critical=0`, `blocking=0`, `knownDev=9`.
- Wallet dependency integrity now has `proof:wallet-deps:summary`, and the
  aggregate prelaunch status uses it instead of the `npm ls` dependency tree.
  The latest row reports Privy `3.27.2`, Privy wagmi `4.0.9`, wagmi `3.6.16`,
  viem `2.50.4`, and `missing=none`.
- Wallet mining, bootstrap keeper resolve, and live-canary resolver paths now
  have opt-in read-only `linea_estimateGas` shadow A/B probes. Browser wallet
  collection uses `NEXT_PUBLIC_LINEA_ESTIMATE_GAS_SHADOW=1`; server/script
  collection can use `LINEA_ESTIMATE_GAS_SHADOW=1`. All paths log redacted
  comparison evidence through the existing support logger and keep the current
  estimator/floor for actual transaction gas limits. Shadow failures now log
  only bounded reason tokens instead of raw provider messages.
- Indexer storage compatibility now tests foreign-contract scope isolation for
  all normalized metadata-only categories: batch claims, resolver rewards, and
  dust settlements. The same drill keeps malformed normalized payload warnings
  tied to the current contract scope after same-id foreign rows are inserted.
- Indexer/storage compatibility also now checks protocol fee flush scope
  isolation in global stats: current-scope burn accounting is included while a
  foreign-contract `scoped_protocol_fee_flushes` row is ignored. This closes the
  same contract-scope boundary for V10 fee/burn accounting that was already
  covered for bets and normalized event metadata. The compact indexer summary
  and prelaunch summarizer both surface `protocolFeeScopeIsolation`.
- Workspace cleanup now has `cleanup:workspace:dry-run` and
  `cleanup:workspace`. The cleaner is limited to `.next/cache`,
  `playwright-report`, `test-results`, `coverage`, and `.tmp` children older
  than the configured age threshold, so it does not target env files,
  dependencies, contracts, database files, proof docs, or lockfiles.
- Whole cache/report targets are age-gated by the newest nested file before
  deletion, so recently active `.next/cache`, report, coverage, or test-output
  directories are treated as still needed even when their top-level directory
  mtime is stale.
- The cleanup helper now also removes existing empty allowlisted cache/report
  directories instead of leaving stale empty folders behind. Missing paths are
  still skipped, and the allowlist/age boundaries are unchanged.
- The autonomous cleanup loop now writes
  `logs/workspace-cleanup-loop.status.json` with only bounded aggregate fields
  (`lastRunAt`, `nextRunAt`, target counts, bytes, status). It does not preserve
  raw cleanup logs or target path lists, so routine status checks stay safe and
  compact while the deletion scope remains unchanged.
- New cleanup-loop starts now write a typed PID record and stop cooperatively
  through `logs/workspace-cleanup-loop.stop`; the manager no longer blindly
  terminates arbitrary processes from a stale PID file. An already-running
  legacy loop remains visible through `cleanup:workspace:loop:status` with
  `issue=legacy-pid-record` until it is restarted or the session exits. The
  `start` command reports the same safe issue token instead of pretending a new
  typed loop was started. `proof:prelaunch:summary` preserves that token while
  still reporting the local process id only as `pid=present`.
- Legacy cleanup-loop stop is cooperative only: the manager writes
  `logs/workspace-cleanup-loop.stop` and reports `stopRequested=true` instead of
  killing the PID. The current legacy PID did not exit after the marker, so
  `start` still refuses to create a duplicate loop and surfaces the pending stop
  state for operator visibility.
- A Codex heartbeat automation named `LORE safe cleanup heartbeat` now runs the
  same repository-local cleaner every 8 hours. It must dry-run first and apply
  only the existing allowlist/age-gated generated targets, so autonomous cleanup
  does not depend on starting a second repo cleanup supervisor while the legacy
  PID is still visible.
- The heartbeat now calls `cleanup:workspace:autonomous`, a fail-closed wrapper
  that validates the target-redacted dry-run summary before applying cleanup and
  reports only aggregate counts/bytes.
- The cleanup helper now also exposes `cleanup:workspace:dry-run:summary` and
  `cleanup:workspace:summary`, which omit raw target path lists and report only
  aggregate counts/bytes. The heartbeat uses these target-redacted commands for
  routine autonomous cleanup.
- `proof:prelaunch:summary` now includes the cleanup summary dry-run as a
  required local row, so the autonomous cleanup command surface is checked with
  the rest of the local prelaunch gates. The latest aggregate at
  2026-07-29T15:47:15.965Z passed all required local rows and still reports the
  expected 21 external/status evidence blockers on the status board plus 22
  external/status command rows in the aggregate summary, because strict and
  non-strict proof variants are counted as separate command rows. The cleanup dry-run row is OK,
  and the legacy local loop remains visible as `issue=legacy-pid-record` with
  `stopRequested=true`; autonomous cleanup is handled by the 8-hour Codex
  heartbeat instead of force-killing or duplicating that process.
- The mainnet status board now has an explicit Autonomous Work Boundary:
  local/off-chain hardening may continue, but no G1-G14 row can be marked
  Complete without external production/canary evidence. The launch gate
  structure guard requires this boundary so it cannot be removed silently.
- The mainnet status board now also shows the latest aggregate local
  verification from `proof:prelaunch:summary`: all required local rows passed,
  while 21 external/status evidence blockers and 0/14 Complete launch gates
  remain. Both the launch-gate structure check and business-logic guard require
  this wording.
- Local UI-only browser smoke at 2026-07-29T15:04Z passed on
  `http://localhost:3000` after starting only `npm.cmd run dev:ui -- -p 3000`
  and then stopping the `next dev` PID. The smoke covered desktop/mobile shell,
  wallet selector modal, first-visit dialog, focus/accessibility, reduced
  motion, chat/profile modal, tab navigation, empty states, extreme-value
  overflow, and same-epoch pool chart freshness; it did not perform real wallet
  transactions or live canary actions.
- `proof:remaining:summary` now prints an explicit autonomous boundary and safe
  next local command alongside the blocked external gate. The aggregate
  `proof:prelaunch:summary` row preserves that as
  `autonomousNext=npm-cmd-run-proof-autonomous-summary`, so automation can keep
  improving local proof/runtime/UX hardening without pretending G1 is complete.
- `proof:autonomous:summary` now provides the lightweight read-only autonomous
  status loop across residual security follow-up and all G1-G14 evidence
  domains: remaining gates; strict sign-off, chain, and host proof; compact
  soak status; cleanup dry-run; wallet/UX QA; V10 canary matrix;
  full-launch canary-log proof; runtime monitoring; indexer; restore; backup;
  and compact G1 env status. It is explicitly transaction-free, bounded,
  redacted, and lets the 8-hour cleanup heartbeat avoid rerunning the heavier
  aggregate prelaunch summary for routine checks.
- The autonomous status output now includes a separate `wallet / UX QA strict`
  row backed by `proof:qa:strict:summary`, so missing wallet/UX proof manifests
  remain visible during local hardening loops instead of being hidden inside the
  broader remaining-gates row. Its blocked-gate summary now correctly maps that
  shared manifest to G12 Wallet QA, G13 Failure UX and audit visibility, and G14
  Final launch QA; G10-G11 remain exclusive to canary and recovery evidence.
- TypeScript now has `typecheck:summary` for aggregate prelaunch status. The
  original `typecheck` command is unchanged; the summary wrapper reports only
  `nextTypegen`, `tsc`, TS error count, and safe TS codes.
- Production build now has `build:summary` for aggregate prelaunch status. The
  original `build` command is unchanged; the summary wrapper reports only
  compiled/proxy status plus warning/error counts.
- V9 compatibility invariants now have `test:contract:summary` for aggregate
  prelaunch status. The original `test:contract` command is unchanged; the
  summary wrapper reports only suite status and assertion-failure count.
- V10 invariants now have `test:contract:v10:summary` for aggregate prelaunch
  status. The original `test:contract:v10` command is unchanged; the summary
  wrapper reports only compact bytecode/selector/full-range case counters and
  assertion-failure count.
- V10 offline identity now has `proof:contract-deployed:v10:offline:summary`
  for aggregate prelaunch status. The original offline verifier is unchanged;
  the summary wrapper runs compact compile proof plus the same offline verifier
  and reports only compiler profile, byte sizes, manifest match, transaction
  flag, and assertion-failure counters.
- Business logic now has `test:logic:summary` for aggregate prelaunch status.
  The original `test:logic` command is unchanged; the summary wrapper reports
  only pass status, expected warning count, and assertion-failure count.
- ABI/indexer storage now has `test:indexer-storage:summary` for aggregate
  prelaunch status. The original `test:indexer-storage` command is unchanged;
  the summary wrapper reports only normalized-event, scope-isolation, pagination,
  idempotency, malformed-payload fallback, and assertion-failure counters.
- SQLite operations now have `test:db-operations:summary` for aggregate
  prelaunch status. The original `test:db-operations` command is unchanged; the
  summary wrapper reports only backup, retention, scope-read, fault-injection,
  and assertion-failure counters.
- Runtime monitoring drills now have `test:monitoring:summary` for aggregate
  prelaunch status. The original `test:monitoring` command is unchanged; the
  summary wrapper reports only alert, recovery, restart-deduplication, delivery,
  state-clear, and assertion-failure counters.
- Fetch-timeout and stored-number parsing checks now have compact summary
  aliases for aggregate prelaunch status. The original tests are unchanged; the
  summary wrappers report only pass, timeout, and assertion-failure counters.
- The first cleanup apply removed 1.78 GiB of generated cache/temp files. Windows
  Task Scheduler registration was blocked by local permissions, so the
  repository now has Node-managed fallback controls:
  `cleanup:workspace:loop:start`, `cleanup:workspace:loop:status`, and
  `cleanup:workspace:loop:stop`. The loop records its PID in
  `logs/workspace-cleanup-loop.pid` and runs every 8 hours until logout/reboot.
  `proof:prelaunch:summary` now includes the cleanup-loop status as a required
  local row, reporting only whether a PID is present.
- Mainnet env proof now also has `proof:mainnet:strict:compact` for routine G1
  status checks. It keeps strict exit-code behavior but clamps the failing-gate
  token list, while `proof:mainnet:strict:summary` remains available for the
  fuller safe summary.
- Managed testnet soak now also has `soak:testnet:status:compact` for
  autonomous read-only monitoring. It prints one redacted aggregate line and
  keeps the same disk-capacity fail-closed exit behavior as the JSON summary.
- Testnet/launch canary strict proof now treats the profile required role set as
  exact. The active Linea Sepolia canary evidence must include successful
  `MANUAL`, `AUTOMINER_A`, and `AUTOMINER_B` roles and must not include extra
  successful roles such as `AUTOMINER_C`.
- V10 invariant coverage now pins single-epoch reward/rebate dust settlement to
  close accounting before any external token transfer, matching the existing
  batch aggregate guards and preventing future claim/settlement asymmetry.
- Strict/production SQLite backup preflight now requires an explicit
  `LORE_BACKUP_RETENTION_DAYS` policy in addition to absolute external source
  and output paths, so launch evidence cannot pass with unbounded backups.
- The SQLite operations drill supplies a bounded test retention value when it
  intentionally exercises the production external-path guard, keeping the local
  prelaunch row focused on repo-local path rejection without weakening the
  production retention requirement.
- Pre-mainnet runtime validation now has a regression guard proving two-replica
  web mode rejects local/private external rate-limit endpoints even when token
  and fail-closed flags are present.
- Runtime monitor alert fanout now uses all-settled delivery results, so one
  failing alert transport cannot abort another configured channel or skip issue
  state reconciliation.
- `monitor:runtime:summary` now emits safe `missingConfig` tokens and the
  aggregate prelaunch row preserves them as `missing=...`, making monitoring
  blockers actionable without printing URLs, secrets, polling endpoints, or
  sending alerts.
- `proof:mainnet:summary` now also emits safe failing gate tokens and the
  aggregate prelaunch `mainnet env` row preserves them as bounded `tokens=...`,
  making G1 environment blockers copyable as operator tasks without printing
  env values or writing proof snapshots.
- `AGENTS.md` now explicitly keeps broad searches out of `.env*` and build
  metadata such as `*.tsbuildinfo`, matching the existing `.codexignore` intent
  and reducing accidental context/secret exposure during autonomous audits.
- First-visit tutorial dialogs now expose a stable accessible name,
  `First visit tutorial`, while keeping the active step title/body in the dialog
  description. This fixes the onboarding accessibility smoke path without
  changing tutorial dismissal or content.
- Chat profile modal close buttons now use the standard accessible and hover
  label `Close`, matching the browser smoke expectation and keeping the existing
  focus-ring/touch-target styling.
- `proof:remaining:summary` now prints the next gate group, required proof
  files, and safe marker tokens for the next blocked launch gate. Operators can
  turn the next gate into a concrete task list without opening the full launch
  proof tables or exposing env values.
- The aggregate `proof:prelaunch:summary` remaining-gates row now preserves that
  next-gate action as bounded `next=...`, `nextGroup=...`, and `nextTokens=...`
  summary text.
- That aggregate remaining-gates row is now compact enough to show
  `next=G1`, `nextGroup=env`, `nextProof=signoff-proof-json`, and bounded
  `nextTokens=...` before the table clamp.
- Managed soak status summary now includes a read-only disk-capacity snapshot
  even when no health-growth samples exist, keeping the 1 GiB safety floor
  visible before any live supervisor restart. The status command now also exits
  non-zero if disk capacity cannot be confirmed or is below the configured
  `SOAK_MIN_DISK_FREE_BYTES` floor.
- The managed soak supervisor now also re-checks disk capacity while its owned
  canary process is running and stops that canary with a normalized
  disk-capacity reason if the artifact volume becomes unavailable or drops below
  the configured floor.
- The aggregate prelaunch summary now preserves that soak disk-capacity signal
  as `disk=now:<bytes>,min:<bytes>,below:<bool>` in the `testnet soak` row, so
  the one-command launch table no longer hides disk safety when no health samples
  exist.
- The latest `npm.cmd run check:summary` completed successfully after fixing the
  tutorial and chat-profile accessibility smoke regressions: lint,
  business-logic, fetch-timeout, stored-number parsing, V9/V10 contract
  invariants, indexer storage, SQLite operations, monitoring drill, production
  build, typecheck, HTTP smoke, and browser smoke all passed.
- The latest filtered `npm.cmd run proof:prelaunch:summary` row check at
  2026-07-29T09:55:17+03:00 still reports the remaining launch evidence row as
  blocked with 14/14 gates incomplete. It preserves `next=G1`,
  `nextGroup=env`, `nextProof=signoff-proof-json`, and
  `nextTokens=contractenv,chain-id,deploy-block,token,finality,v10-protected-bets`.
  The row also preserves `nextStatus=npm-cmd-run-proof-mainnet-strict-summary`
  before the longer marker/group counts, so the next external status action
  stays fully visible before the table clamp.
- The latest `npm.cmd run proof:remaining:summary` at 2026-07-29T06:13:19.794Z
  still reports 0/14 launch gates complete; remaining groups are canary=2,
  chain=1, env=1, host=2, indexer=1, monitoring=1, qa=3, restore=1,
  signoff=2, and the next G1 marker tokens are `contractenv`, `chain-id`,
  `deploy-block`, `token`, `finality`, and `v10-protected-bets`. The aggregate
  prelaunch remaining-gates row also preserves `nextGroup=env` and
  `nextProof=signoff-proof-json`. The latest full
  `npm.cmd run proof:prelaunch:summary` at 2026-07-29T05:15:57.235Z reports all required local
  rows green, including V9/V10 compile, Solidity compiler advisories, V10
  diagnostics, V9/V10 invariants, ABI/indexer storage, TypeScript, ESLint,
  production build, business logic, dependency, wallet-dependency, launch-doc,
  compact proof redaction, compact readiness, compact process-model/
  proof-template/proof-file, and runtime-monitoring checks. External/status
  rows still report 22 missing or blocking launch-evidence items, including
  the no-poll/no-alert runtime monitor config preflight. The testnet-soak row
  now preserves the read-only disk safety snapshot, and the proof-drafts row now
  covers 189 cases.
- `proof:remaining:summary` now also prints a compact `Next status check`
  before the proof-producing `Next first check`, so operators can re-check the
  current blocker with `*:summary` commands without accidentally writing proof
  artifacts.
- The latest pending-nonce dry-run inside the same prelaunch summary reports
  `pendingGap=0`, `replacementCap=1`, and `wouldSend=false`, so no
  replacement transaction is needed or authorized.
- A fresh `npm.cmd run soak:testnet:dry-run` at 2026-07-29T08:29:10.316Z
  completed transaction-free with `stopReason=dry-run-complete`, zero bets,
  zero tx/nonces/reverts, no preflight failures, and three expected RPC failover
  injection events. This refreshes preflight readiness but is not a live soak.
- Shared dialog focus trapping now also locks and restores body scrolling while
  overlays are active, reducing mobile background-scroll/jump risk across
  wallet settings, backup, tutorial, jackpot, and chat profile dialogs. Focused
  ESLint and `npm.cmd run test:logic` pass for the guard.
- Wallet login recovery now keeps the stuck-loading reload action accessible and
  keyboard-visible with explicit label/title/focus styling. Focused ESLint and
  `npm.cmd run test:logic` pass.
- Backup-confirmation and legacy chat-profile localStorage reads now clear
  invalid stored values instead of repeatedly retrying stale recovery state.
  Focused ESLint, `npm.cmd run test:logic`, and `npm.cmd run typecheck` pass.
- First-visit tutorial dismissal now accepts the canonical `"1"` value, migrates
  legacy `"true"` to `"1"`, and clears other stale values so onboarding cannot be
  hidden forever by corrupt localStorage. Focused ESLint, `npm.cmd run
  test:logic`, and `npm.cmd run typecheck` pass.
- Shared API route error logging now redacts suspicious object keys in extra
  context, not only extra values, so user-controlled URL/address-like keys cannot
  leak through server logs. Focused ESLint, `npm.cmd run test:logic`, and
  `npm.cmd run typecheck` pass.
- Mobile bottom-tab navigation buttons now explicitly stay non-submit controls
  while preserving `aria-current` page semantics. Focused ESLint, `npm.cmd run
  test:logic`, and `npm.cmd run typecheck` pass.
- Production chat/admin auth origin selection now rejects localhost, private,
  local, reserved documentation IP ranges, IPv6 local ranges, example, test, and
  invalid site URLs in the shared helper, so signed auth proofs fail closed even
  if runtime env validation was skipped. Focused ESLint, `npm.cmd run
  test:logic`, and `npm.cmd run typecheck` pass.
- Backup summary fail output now uses the same compact redaction path as runtime
  backup failures, so missing-configuration JSON stays stackless and path/URL
  safe. Focused ESLint and `npm.cmd run test:logic` pass.
- Legacy scalar auto-resolve localStorage guards now migrate to the current JSON
  envelope with a fresh timestamp on read, avoiding stale retry metadata while
  preserving backward compatibility. Focused ESLint and `npm.cmd run test:logic`
  pass.
- Live-state snapshot fallbacks now reject malformed non-grid tile arrays before
  rendering cached/API tile data, preventing partial grid/chart recovery states
  from a corrupt snapshot. Focused ESLint and `npm.cmd run test:logic` pass.
- Wallet transfer history fallback dedupe now keys by event-log identity instead
  of whole transaction hash, so multiple relevant LINEA transfers in one
  transaction are not collapsed. Focused ESLint and `npm.cmd run test:logic`
  pass.
- App mount support diagnostics now log only the pathname and normalized tab,
  not full `window.location.href`, so query strings and arbitrary hash payloads
  cannot be captured in support logs. Focused ESLint and `npm.cmd run
  test:logic` pass.
- Shared unknown-error formatting now preserves useful name/code/status fields
  first, then redacts provider URLs, wallet addresses, token-like data, nested
  `data` payloads, and long raw strings before clamping to one line. Focused
  ESLint, `npm.cmd run test:logic`, and `npm.cmd run typecheck` pass.
- Floating chat controls now expose non-submit button semantics, explicit
  `aria-expanded`, and stable `aria-controls` wiring to the chat panel root.
  Focused ESLint, `npm.cmd run test:logic`, and `npm.cmd run typecheck` pass.
- Analytics deposit and jackpot transaction links now expose transaction-specific
  Lineascan `aria-label` and `title` text instead of relying only on truncated
  hashes. Focused ESLint, `npm.cmd run test:logic`, and `npm.cmd run typecheck`
  pass.
- V10 claim/settlement invariants now explicitly guard the intended dust
  asymmetry: reward dust settlement may close an expired epoch with zero
  remainder, while rebate dust settlement requires a positive expired rebate
  remainder. `npm.cmd run test:contract:v10` and focused ESLint pass.
- The latest `npm.cmd run proof:local:summary` at 2026-07-28T23:48:54.800Z
  passes L1-L16 with the expected strict-launch canary-log fail-closed row.
  It still reports 14 external evidence gates remaining, grouped as canary=2,
  chain=1, env=1, host=2, indexer=1, monitoring=1, qa=3, restore=1,
  signoff=2.
- `npm.cmd run baseline:bundle:summary` now fails closed on configurable static
  output budgets, and `.env.example` / `.env.local.example` document the
  optional `BUNDLE_BASELINE_MAX_*` overrides for operators.
- `npm.cmd run monitor:runtime:summary` now performs a no-poll/no-alert runtime
  monitor config preflight. It reports only sanitized booleans for Resend,
  backup freshness, optional canary/audit inputs, and timing settings.
- G1 strict env status now has compact `npm.cmd run proof:mainnet:strict:summary`
  output and appears in `proof:prelaunch:summary` as an external/status blocker.
- `npm.cmd run proof:mainnet:summary` at 2026-07-28T20:24:59.646Z still reports
  41 failing env gates, but summary mode now groups them without printing env
  values: admin=1, backup=1, contract=9, credentials=7, indexer=7, network=7,
  privy=2, proxy=3, rpc-site=4.
- The aggregate `proof:prelaunch:summary` mainnet env rows now preserve those
  grouped env blockers, so operators can see the highest-pressure production
  config domains from the one-command status table.
- `npm.cmd run proof:remaining:summary` now groups the remaining G1-G14 launch
  evidence gates by domain without opening long proof tables: canary=2,
  chain=1, env=1, host=2, indexer=1, monitoring=1, qa=3, restore=1,
  signoff=2. The aggregate `proof:prelaunch:summary` preserves the same groups
  in the remaining-gates row.
- Direct chain proof status now has compact `npm.cmd run proof:chain:summary`
  and `npm.cmd run proof:chain:strict:summary` output. Summary mode validates
  configured inputs without RPC reads or snapshot writes; strict status appears
  in `proof:prelaunch:summary` as an external/status blocker until configured
  RPC evidence is present.
- `npm.cmd run proof:chain:summary` now identifies the affected launch gate
  directly in compact output. Strict fallback-RPC status blocks G1 grouped as
  chain=1; non-strict summary mode marks the same gate covered for input
  readiness without performing RPC reads.
- G2-G4 strict signoff status now has compact
  `npm.cmd run proof:signoff:strict:summary` output and appears in
  `proof:prelaunch:summary` as an external/status blocker.
- `npm.cmd run proof:signoff:summary` now identifies the affected launch gates
  directly in compact output. With the manifest missing, the aggregate rows show
  blocked gates G1, G2, G3, G4 grouped as chain=1, env=1, signoff=2.
- G5-G6 strict host status now has compact
  `npm.cmd run proof:host:strict:summary` output and appears in
  `proof:prelaunch:summary` as an external/status blocker.
- `npm.cmd run proof:host:summary` now identifies the affected launch gates
  directly in compact output. With the manifest missing, the aggregate rows show
  blocked gates G5 and G6 grouped as host=2.
- `npm.cmd run proof:indexer:summary` now identifies the affected launch gate
  directly in compact output. With DB/finality/manifest evidence missing, the
  aggregate rows show blocked gate G7 grouped as indexer=1.
- Host proof draft/collector entrypoints now reject identical
  `--process-evidence`, `--health-log`, and `--load-log` inputs before writing
  drafts. Strict host proof validation also rejects one local artifact reused
  across independent process-model, persistent DB, production-health,
  load-test, and external-rate-limit evidence groups, while still allowing one
  supervisor export inside the `processModel` group.
- G8 strict restore status now has compact
  `npm.cmd run proof:restore:strict:summary` output and appears in
  `proof:prelaunch:summary` as an external/status blocker.
- `npm.cmd run proof:restore:summary` now identifies the affected launch gate
  directly in compact output. With source/backup/manifest evidence missing, the
  aggregate rows show blocked gate G8 grouped as restore=1.
- G9-G11 strict monitoring, QA, and testnet canary status now have compact
  `npm.cmd run proof:monitoring:strict:summary`,
  `npm.cmd run proof:qa:strict:summary`, and
  `npm.cmd run proof:testnet:canary:strict:summary` output and appear in
  `proof:prelaunch:summary` as external/status blockers.
- `npm.cmd run proof:monitoring:summary` now identifies the affected launch
  gate directly in compact output. With the manifest missing, the aggregate
  rows show blocked gate G9 grouped as monitoring=1.
- `npm.cmd run proof:qa:summary` now identifies the affected launch gate
  directly in compact output. With the manifest missing, the aggregate rows
  show blocked gate G10 grouped as qa=1.
- `npm.cmd run proof:testnet:canary:summary` now identifies the affected launch
  gate directly in compact output. With the live canary log missing, the
  aggregate rows show blocked gate G11 grouped as canary=1.
- Managed soak compact status now includes sanitized successful/failed bet role
  counters, so operators can confirm MANUAL/AUTOMINER_A/AUTOMINER_B coverage
  or detect an accidental extra role without opening raw live logs.
- The aggregate `proof:prelaunch:summary` testnet-soak row now preserves those
  role counters as `successRoles` and `failedRoles`, keeping coverage visible in
  the one-command prelaunch table.
- The same aggregate row now also preserves sanitized soak preflight blockers
  as `preflight=ROLE:reason` entries, so pending-nonce or funding blockers stay
  visible without opening live logs.
- The aggregate soak row also preserves compact health/retry/latency/disk/growth
  counters as `health`, `rpc`, `gas`, `slow`, `p95`, `freeMin`, and `growth`,
  so long-run symptoms and the disk safety floor stay visible without opening
  raw soak artifacts.
- `soak:testnet:status:summary` now preserves sanitized failure classification
  counters. The aggregate soak row prints the same data in a compact unclipped
  form as `fk`, `ff`, `fm`, `fs`, and `streak`, while keeping health, latency,
  and disk-growth fields visible.
- The standalone `soak:testnet:status:summary` JSON now omits empty
  latency/growth sample blocks when no samples exist, reducing heartbeat noise
  while preserving parseable counters and prelaunch compatibility.
- The same prelaunch summary now prints a compact `Slowest checks` line. The
  latest pass identified production build, V9 compatibility invariants,
  business logic and removed-wallet guard, V10 compiler matrix, and ESLint as
  the slowest local rows.
- The prelaunch summary now also prints compact `Blocker groups`, grouping the
  22 external/status blockers by evidence domain without reading raw child
  logs.
- Fresh compact external status at 2026-07-29T03:00:56.597Z still reports
  `proof:remaining:summary` as 0/14 complete launch gates, with next gate `G1
  Final contract env and funds safety`, and no inconsistent rows or proof record
  reference issues. `proof:mainnet:summary` checks 43 env gates and reports 41
  failing or missing, so this is an external configuration and evidence blocker
  rather than a local-code blocker.
- Repo-local npm config now disables update-notifier and funding prompts. Direct
  compact evidence commands such as `soak:testnet:clear-pending:summary` no
  longer append unrelated npm notices to operator output.
- Bundle baseline summary now enforces conservative static-output budgets
  instead of always passing as a measurement-only row. The current production
  build remains under the default caps; an over-budget run exits nonzero with
  compact `budgetIssues` JSON.
- Contract compilation provenance summary mode is now read-only too. V9 and V10
  summary commands still compile and compare against canonical manifests, but
  report `wouldWrite=false` and skip `.tmp` provenance output writes. Manual
  `--summary-only --write-manifest` also stays read-only. The aggregate
  prelaunch table now preserves the same `wouldWrite=false` fact on V9/V10
  compile rows and reports creation/runtime byte sizes separately.
- ABI/indexer storage coverage now proves identical normalized event ids remain
  isolated across batch-claim, resolver-reward, and dust-settlement categories.
  The compact prelaunch row reports this as `categoryIdIsolation=true` and now
  also carries `pagination=true` plus `tileUserCounts=true`.
- Indexer storage malformed-payload fallback is now tested across all normalized
  event categories: batch claims, resolver rewards, and dust settlements. A bad
  payload in any one category must be skipped without hiding valid normalized
  events or echoing payload text into warnings.
- V10 invariant coverage now reports the event-surface split as
  `events=24/16/8`: 24 frontend-visible events, 16 indexed accounting events,
  and 8 frontend-only events. Batch dust aggregate events are explicitly kept
  frontend-only while per-epoch dust events remain indexed. The eight
  frontend-only events are now allowlisted by name and reported as
  `frontendOnlyReviewed=true`.
- V10 dust-settlement invariants now also pin the internal closure order: reward
  dust must set the packed settled flag before settlement evidence is emitted,
  and rebate dust must close `epochRebateClaimed` to the pool before settlement
  evidence is emitted. External settlement paths already require those helpers
  before token transfer, so this guards duplicate-settlement/reentrancy ordering
  without changing contract behavior.
- V10 rebate-consumption invariants now pin the shared helper order too:
  `_consumeRebate` must compute the payable amount, then close the per-user
  claimed flag, then update aggregate claimed accounting. This keeps single and
  batch rebate paths aligned without changing contract behavior.
- Manual bet UX regression coverage now explicitly rejects the removed
  `Preparing bet in your Privy wallet` copy in addition to the older ambiguous
  preparing phrase, while preserving clear signing, pending, and confirmed
  states.
- Mobile compact manual betting now uses the shared `lore-nums` tabular numeric
  class for both amount input and total readout, with a source guard matching
  the desktop manual bet and Auto-Miner numeric typography checks.
- Header pool chart empty epochs now expose a stable
  `data-testid="header-pool-chart-visual"` plus `data-empty-pool` state and an
  accessible empty/activity label, and browser smoke now asserts the empty
  chart container state in addition to the SVG line so no-bet chart regressions
  are caught without pixel parsing or hiding the visual.
- `npm.cmd run proof:local:summary` now treats the compact strict launch
  `groups: launch=1` canary-log blocker as the expected L16 fail-closed status.
  The latest local summary at 2026-07-28T22:40:46.233Z passes all L1-L16 rows
  while still requiring real full-launch canary evidence before launch proof.
- Canary proof draft generation now rejects identical target, recovery,
  session, and transaction-health artifact inputs before writing drafts. Strict
  canary proof validation also rejects one local artifact reused across
  independent target-network, recovery, auto-miner-session, and
  transaction-health evidence groups, while still allowing one recovery artifact
  to cover multiple recovery checks inside the recovery group.
- Strict backup status now has compact `npm.cmd run db:backup:strict:summary`
  output and appears in `proof:prelaunch:summary` as an external/status blocker.
  `db:backup:summary` is now read-only: it validates source/output readiness and
  exits with `wouldWrite=false` before creating directories or backup files.
- `npm.cmd run db:backup:summary` now includes compact `groups=backup=1` JSON
  in ready/fail/pass status output, and `proof:prelaunch:summary` preserves
  that group in backup blocker rows without printing local paths.
- Restore proof summary mode is also strictly read-only now. It validates
  source/backup/restore paths and any manifest, prints `Would write: false`, and
  exits before any backup/restore copy or directory creation path.
- Full restore drill execution now restores from the supplied `--backup`
  artifact when one is provided, and pre-checks that artifact before writing
  restore output. A corrupt supplied backup fails without leaving a restored DB
  file, so G8 proof cannot be satisfied by restoring a fresh source-copy while
  merely referencing a separate backup artifact. The compact DB operations
  summary and aggregate prelaunch SQLite row surface both guard booleans.
- Strict full-launch status now has compact
  `npm.cmd run proof:launch:strict:summary` output and appears in
  `proof:prelaunch:summary` as an external/status blocker until a live canary
  log is supplied. `proof:launch:summary` is read-only and exits before spawning
  child proof checks; summary output reports canary-log presence only, not the
  local path. The strict summary row now carries `groups: launch=1`, so the
  aggregate blocker table keeps the full-launch canary input visible without
  running the child proof suite.
- Local launch preflight now has compact `npm.cmd run proof:local:summary`
  output. It runs the L1-L16 local launch guard checks but skips temporary
  proof/canary regression artifact writes and uses the compact strict launch
  status path for L16. The latest summary pass reports
  `Regression artifact writes: false` and all L1-L16 rows green.
- Full local checks now also expose `npm.cmd run check:summary`. The flag keeps
  successful child output suppressed, prints only bounded redacted failure tails,
  and leaves the existing verbose `npm.cmd run check` behavior available for
  local debugging.
- Browser smoke and browser-baseline diagnostics now use the shared proof
  redactor and fixed-size diagnostic clamps before storing console/page-error
  samples in thrown errors, logs, or JSON reports. Raw Playwright console text is
  still used only for local classification/ignore checks.
- Strict live-canary proof validation now rejects raw URLs, wallet addresses,
  and long hex values in diagnostic/error/message/reason/cause/stack-style
  fields, so launch canary evidence cannot smuggle unredacted RPC or wallet
  details through non-`error` diagnostics.
- The general proof-file guard now applies the same unsafe-diagnostic check to
  bounded canary JSONL first-record inspection, auxiliary snapshots, and final
  proof manifests. Its summary table exposes `Unsafe Diagnostics` as a separate
  status column and, when `--canary-log` is supplied, reports the canary log as
  its own row. Local launch preflight has a regression fixture for this
  `diagnostic` path. Bounded canary JSONL first-record reading now tolerates a
  UTF-8 BOM, so Windows-created evidence files are not misclassified as invalid
  JSON.
- Live canary proof analysis and canary proof draft generation also tolerate a
  UTF-8 BOM on the first JSONL record, with `proof:drafts` regressions covering
  both paths.
- V10 contract invariants now explicitly pin duplicate-safe reward and rebate
  dust settlement helpers: already-settled/exhausted epochs must return before
  closing state again, preserving single and batch settlement symmetry.
- V10 ABI invariants now also bind the realtime `/api/live-state` read ABI and
  bet-placement event ABI to the compiled contract, and keep the live-state
  recovery event set limited to the four bet-placement events needed for
  tile-user reconstruction.
- Browser performance baseline now has `npm.cmd run baseline:browser:summary`.
  It runs the same browser measurement but prints compact aggregate metrics and
  does not write the full performance JSON artifact.
- A fresh local browser baseline on `http://localhost:3000` first confirmed the
  production-mode weak-identity boundary by degrading on four local 503
  responses without the local fixture. Re-running the same built app with
  `ALLOW_WEAK_RATE_LIMIT_IDENTITY=1` as local-only lab setup passed with zero
  failed local/external responses, CLS `0`, stable DOM nodes, and no local
  console errors; external CSP inline-style warnings remain separate from local
  performance evidence.
- Chat profile settings now expose a hidden `aria-describedby` description on
  the focus-trapped dialog. This improves assistive-technology context without
  adding visible UI copy or changing chat/profile behavior.
- Mobile sidebar navigation now exposes stable drawer/nav labels and connects
  the close backdrop to the drawer with `aria-controls`, without changing layout
  or drawer behavior.
- Maintenance mode overlay now announces itself as a polite busy status with
  stable title/description wiring, and decorative animation layers are hidden
  from assistive technology. Visual maintenance mode behavior is unchanged.
- Lazy-loaded non-hub tab fallback now announces panel loading as a polite busy
  status. This keeps analytics, safety pool, leaderboard, whitepaper, and FAQ
  chunk loading visible to assistive technology without changing lazy loading or
  tab behavior.
- Safety Pool initial ledger loading and background refresh messages now use
  polite status semantics, so rebate/reward loading progress is announced
  without changing claim, refresh, or pagination behavior.
- Analytics blockchain-history initial loading and refresh/ready chips now use
  polite status semantics, with decorative pulse dots hidden from assistive
  technology. Empty-state and history rendering behavior are unchanged.
- Analytics deposit-history refresh/sync, initial deposit loading, and jackpot
  history loading now use polite status semantics. Refresh buttons, API reads,
  cache behavior, and visible loading copy are unchanged.
- Leaderboards loading state now uses a polite busy status with a decorative
  spinner, and the error panel is announced as an alert while preserving retry.
  Leaderboard data loading, caching, and visible copy are unchanged.
- Reward scanner normal-scan and deep-scan progress now use polite status
  semantics, with decorative scan icons hidden from assistive technology.
  Reward scan depth, claim locks, wallet actor selection, and transaction
  behavior are unchanged.
- Confetti now reuses the shared reduced-motion preference and skips both
  canvas rendering and requestAnimationFrame animation when reduced motion is
  enabled. Win detection, reward state, and visible non-motion UI are unchanged.
- Wallet Settings recovery reward scan progress now announces as a polite busy
  status, and the completed-empty state is announced as a polite status.
  Recovery scan batching, Stop Scan, Claim, and Scan Again behavior are
  unchanged.
- Wallet Settings resolver reward claim buttons now expose state-aware
  accessible labels/titles for ready, disabled, and claiming states. Active
  resolver reward claims are also announced as a hidden polite status without
  changing claim handlers or visible copy.
- Wallet Settings ETH/LINEA top-up transfer rows now expose explicit amount
  input labels, state-aware action labels/titles, and hidden polite sending
  status. Submit handlers, disabled gates, amount clamping, and transaction
  behavior are unchanged.
- Wallet Settings pending-nonce Check and Clear Stuck Tx actions now expose
  state-aware accessible labels/titles for idle, checking, disabled, and
  clearing states. The confirmed 0 ETH self-transaction repair handler and
  pending-nonce detection logic are unchanged.
- Wallet Settings pending-nonce Check and Clear Stuck Tx actions now share the
  same refresh/clear busy guard, so operators cannot overlap a fresh nonce
  check with the zero-value self-replacement repair action. The repair handler,
  transaction path, nonce detection, and copy are unchanged.
- Wallet Settings pending-transaction repair now also shows an explicit wallet
  rejection state if the user rejects the repair prompt, instead of silently
  clearing the in-flight UI state. The zero-value self-replacement transaction
  path, nonce refresh, fee overrides, duplicate lock, and receipt follow-up are
  unchanged.
- Wallet Settings LINEA transfer history loading now exposes a state-aware load
  label/title and hidden polite status. Loaded transfer rows use list/listitem
  semantics, empty history is announced as a polite status, and Lineascan links
  have clear action labels instead of relying on shortened hashes.
- Support-log and route-error sanitization now also redacts bare prefixed API
  tokens such as OpenAI-style, GitHub-style, Slack-style, and Resend-style keys,
  even when they appear outside `key=value` fields.
- Route error logging now clamps sanitized `extra` payloads by string length,
  array length, object key count, and nesting depth before printing. API
  responses and existing redaction semantics are unchanged, but production
  route logs cannot grow from large structured context.
- Route error redaction now has a regression guard for query-style RPC URLs,
  inline keys, wallet/address values, and bearer tokens inside route error
  messages. `npm.cmd run test:logic` and focused ESLint for the guard pass.
- Mainnet and strict pre-mainnet runtime validation now reject configured
  `RESEND_API_KEY` values that do not look like Resend API keys, in addition to
  the existing missing-key, sender, and recipient checks. `npm.cmd run
  test:logic` and focused ESLint for the validator guard pass.
- Shared dialog focus trapping now skips custom/tabindex controls with a
  `disabled` attribute and avoids restoring focus to a disabled previous
  target. This hardens Wallet Settings, backup, tutorial, jackpot, and chat
  modals through the shared hook without changing their visible UI.
- Mobile sidebar backdrop now honors button keyboard semantics: Escape, Enter,
  and Space all close the drawer, with a business-logic source guard covering
  the behavior.
- Host, indexer, signoff, restore, monitoring, and QA proof summaries now avoid
  printing raw local missing-artifact paths. Summary mode reports the affected
  manifest fields/counts, while full validator output remains useful for local
  debugging.
- Wallet login timeout copy now shows the same explicit Reload recovery action
  as slow Privy readiness, so a timed-out connect attempt no longer leaves only
  passive text.
- Admin Ops client error banners, including owner-signature verification
  failures, now redact and clamp client-side runtime/API errors before display,
  reducing accidental URL/path/provider leakage in the ops UI while preserving
  actionable failure copy.
- Global reduced-motion CSS suppression now has a business-logic regression
  guard covering both animations and transitions. The audit found existing
  visibility guards on analytics, pool chart, and auto-resolve polling, so no
  user-visible freshness behavior was changed.
- Runtime health now exposes safe boolean backup-monitoring diagnostics without
  paths. HTTP smoke and production health checks require those fields, and
  production-like runtime health fails when backup monitoring is not configured.
- Runtime health now also exposes a safe boolean Resend email-alert diagnostic.
  HTTP smoke requires the field, and production health fails production-like
  runtime when Resend email alerts are not configured.
- Runtime health now exposes safe multi-replica/external-rate-limit booleans.
  HTTP smoke requires them, and production health fails a multi-replica runtime
  without external shared rate-limit configuration.
- The external-rate-limit runtime health boolean now requires the configured
  store URL to pass the same public HTTPS endpoint validation used by the
  limiter client. A present token plus unsafe/local endpoint no longer creates a
  false green multi-replica health signal.
- Production-origin validators in shared proof collectors, production health,
  load testing, runtime monitoring, host/monitoring/QA/restore proof validators,
  mainnet proof collection, and proof/test-plan draft generators now also reject
  CGNAT, link-local, documentation, IPv4-mapped IPv6, private IPv6, and IPv6
  documentation ranges. These checks harden launch evidence only; no gameplay
  polling or wallet flow changed.
- Runtime health now exposes safe trusted-proxy and weak-identity diagnostics.
  HTTP smoke requires both fields, and production health fails non-local
  production-like runtime without trusted proxy identity or with weak identity
  enabled.
- `.env.local.example` now documents the same trusted-proxy secret and
  weak-identity default as `.env.example`, keeping local/staging setup hints
  aligned with the production runtime guard.
- Strict monitoring proof now rejects monitor entries that reuse the same local
  artifact file for fired-alert and recovery/resolution evidence, so G9 requires
  distinct concrete alert and recovery proof.
- The monitoring proof draft generator now also refuses the same file for
  `--monitor-artifact` and `--recovery-artifact`, so invalid G9 evidence is
  stopped before an incomplete draft is written.
- Strict monitoring proof now also rejects one local artifact reused across
  independent monitors, alert-target, and error-tracking evidence sections.
  `proof:monitoring:draft` rejects the same cross-section reuse before writing
  incomplete drafts. Focused proof-draft, logic, ESLint, diff-check,
  monitoring-summary, and aggregate prelaunch verification passed.
- The QA proof draft generator now refuses one local artifact reused across
  wallet, failure-state, support-audit, final-browser, and smoke evidence
  groups, so a single generic report cannot prefill multiple G12-G14 draft
  sections.
- Strict QA proof validation now applies the same distinct-artifact rule across
  QA evidence groups, while still allowing one focused report to back multiple
  checks inside the same group.
- Strict restore proof validation now rejects one local artifact reused across
  backup schedule, restore drill, restored staging health, and indexer
  preservation sections, so G8 requires separate concrete evidence for each
  restore concern.
- Restore proof draft and collector entrypoints now fail before writing drafts
  when `--restore-log`, `--health-log`, `--backup-schedule-artifact`, or
  `--preservation-artifact` reuse the same local evidence file.
- The Solidity compiler advisory check now retries one transient official bug
  database fetch failure and the prelaunch summary no longer mislabels non-JSON
  stack traces as invalid JSON summaries. The check still fails closed if the
  official 0.8.36 entry is unavailable, has the wrong release date, or lists a
  known compiler bug.
- V10 compiler advisory proof now also has
  `proof:contract-compiler-advisories:v10:summary`, and the aggregate
  prelaunch status uses that compact alias. Summary failures emit bounded
  redacted JSON instead of a raw Node stack, while the full proof remains
  fail-closed.
- Launch documentation command-syntax proof now also has
  `proof:launch-docs:summary`, and the aggregate prelaunch status uses that
  compact alias. The summary reports only document count, inline-env syntax
  issues, missing package-script references, read issues, and missing
  PowerShell examples instead of printing the full launch-doc table.
- Host proof load-target guard now also has `proof:host-guard:summary`, and the
  aggregate prelaunch status uses that compact alias. The summary preserves
  only fixture and issue counts plus the host gate token, while the full guard
  remains available for manual failure diagnostics.
- V10 no-RPC diagnostics now also have
  `bench:contract:v10:diagnostics:summary`, and the aggregate prelaunch status
  uses that explicit compact alias. The row preserves the no-RPC/no-transaction
  facts plus probe count without relying on the non-summary script name.
- ESLint now also has `lint:summary`, and the aggregate prelaunch status uses
  that compact wrapper instead of raw `eslint .`. The wrapper runs the same
  project lint rules but reports only checked-file count, issue-file count,
  error/warning totals, and safe rule-id counts.
- HTTP smoke and load-test terminal failures now print shared-redacted,
  fixed-size error messages instead of raw Error objects or stacks. Response body
  checks remain unchanged.
- Local `npm.cmd run check` spawn failures now print shared-redacted, fixed-size
  error messages instead of raw spawn Error objects.
- SQLite startup, live-state recovery smoke, and production health terminal
  failures now also print shared-redacted, fixed-size error messages instead of
  raw provider/path/stack text.
- Browser smoke final failures, runtime-monitor fatal errors, and dependency
  audit startup failures now also use shared-redacted, fixed-size terminal
  messages instead of raw Error objects or stacks. Dependency audit parse
  failures also print only a compact redacted output sample instead of raw
  `npm audit` stdout/stderr lines.
- Managed testnet-soak supervisor status, stop, and fatal terminal failures now
  use the shared proof redactor and fixed-size clamps before printing messages.
- Signed testnet revert-check fatal failures now use the shared proof redactor
  and fixed-size clamps before printing terminal messages. The explicit
  `--confirm`, simulation-first, and reverted-receipt requirements are
  unchanged.
- Wallet playtest fallback and fatal terminal diagnostics now use the shared
  proof redactor and fixed-size clamps. Dry-run default behavior and explicit
  `--execute` signing boundary are unchanged.
- Live-state recovery browser smoke now counts page errors without storing raw
  page-error messages; terminal failures remain shared-redacted and bounded.
- Prelaunch summary tool-failure reporting now redacts and clamps child spawn
  errors before printing compact status summaries.
- Keeper Telegram alert failures now read bounded response bodies before
  logging redacted transport errors; alert semantics and cooldown behavior are
  unchanged.
- The required local fetch-timeout proof test now redacts and bounds fatal
  failure output instead of printing raw Error objects.
- Auto-Miner diagnostics now redact and clamp `lastErrorRawMessage` at the
  localStorage boundary. Support diagnostics already omit that raw field; this
  additionally protects stored local recovery/debug state.
- Support logger now clamps messages and structured log data after support
  redaction before localStorage persistence, export rendering, and console
  mirroring.
- Mainnet `server` runtime config now requires configured Resend email alerting
  instead of accepting a server-side production runtime with no alert channel.
  Frontend, keeper, indexer, transactions, contracts, randomness, and tokenomics
  are unchanged.
- The actual `monitor:runtime` startup path now also requires Resend email in
  mainnet or strict pre-mainnet mode, even when another alert channel is
  configured. Network aliases such as `production`, `prod`, `linea`, and `main`
  are normalized as mainnet for this guard, and `NODE_ENV=production` also
  enables it. Synthetic production/mainnet/strict-testnet Telegram-only startup
  checks fail before any network polling.
- Production-like `monitor:runtime` startup now also requires
  `RUNTIME_MONITOR_BACKUP_DIR` or `LORE_BACKUP_DIR` outside explicit local mode,
  so backup freshness monitoring cannot be silently skipped.
- Mainnet and strict pre-mainnet `server` runtime config now also fail closed
  without `RUNTIME_MONITOR_BACKUP_DIR` or `LORE_BACKUP_DIR`, so the env gate and
  actual runtime monitor agree before launch.
- Wallet transfer and resolver/pending-transaction action failure copy now
  treats replacement, already-known, and nonce provider errors as ambiguous
  pending submissions. Users are told to check wallet activity before retrying
  instead of seeing raw provider text; wallet execution behavior is unchanged.
- Chain/indexer audit source guards now explicitly keep dust settlement
  comparison on per-epoch `RewardDustSettled`/`RebateDustSettled` events and
  prevent aggregate batch dust events from being double-counted as per-epoch
  evidence. Contract and indexer runtime behavior are unchanged.
- The latest transaction-free pending-nonce recovery check reports a zero
  pending gap for the scoped Auto-Miner recovery role, so no replacement
  transaction is needed. The previous managed testnet soak dry-run completed
  with no preflight failures, no bets, no transactions, no nonce events, and
  four RPC failover-injection events. A follow-up dry-run after the three-role canary
  default change also completed cleanly with no bets, no transactions, no nonce
  events, no reverts, and three RPC failover-injection events.
- The pending-nonce recovery runbook is now explicit: start with
  `npm.cmd run soak:testnet:clear-pending:summary`; if it reports `pendingGap=0`,
  and `wouldSend=false`, do not execute anything. A nonzero gap requires fresh
  explicit approval for one Linea Sepolia zero-value self-transfer replacement,
  both execution switches, and a post-execution dry-run showing a zero gap
  before any soak restart. The helper stdout is quiet JSON for compact
  aggregation.
- Pending-nonce recovery dry-run now loads only the public
  `.env.live-test-addresses` fallback before reading nonce state. The
  secret-bearing `.env.live-test-wallets` fallback is loaded only on the
  execution signer path after an explicit nonzero pending gap. Both fallback
  paths must be regular files. The latest read-only summary in this session
  still reports `pendingGap=0` with `wouldSend=false`, so no replacement
  transaction is needed.
- The same dry-run missing-address error now points operators at the public
  `.env.live-test-addresses` file, not the secret-bearing wallet file. Recovery
  behavior, signing boundary, and transaction rules are unchanged.
- Managed soak/canary defaults now use only `MANUAL`, `AUTOMINER_A`, and
  `AUTOMINER_B`. `AUTOMINER_C` remains possible only through an explicit
  `LIVE_TEST_ROLES` override, not by default.
- Live canary now validates any `LIVE_TEST_ROLES` override against the supported
  test role allowlist before looking up wallet private-key environment names,
  so empty lists, duplicates, and role typos fail before wallet loading.
- Live canary now also requires the secret-bearing `.env.live-test-wallets`
  fallback path to be a regular file before invoking dotenv loading.
- Managed soak supervisor lock cleanup now removes only regular lock files and
  fails closed if the lock path exists as a non-file, avoiding ambiguous stale
  lock recovery.
- V10 post-deploy canary planning now rejects a directory at the public address
  file path before reading `.env.live-test-addresses`.
- Host proof now has `npm.cmd run proof:host:summary` for compact routine
  production-like host checks. The summary path reports manifest presence
  instead of printing the absolute proof path.
- Mainnet env proof now has `npm.cmd run proof:mainnet:summary` for compact G1
  environment checks. It keeps validation unchanged while printing only gate
  counts and failing gate names, without env values or proof snapshot writes.
- Mainnet env proof now includes a compact server backup monitoring directory
  gate, so backup freshness prerequisites are visible before monitor startup.
- Remaining launch evidence now has `npm.cmd run proof:remaining:summary` for
  compact G1-G14 status checks. It keeps validation unchanged while printing
  only gate counts, remaining IDs, issue counts, and the next actionable gate.
- Launch-gate trackers now count referenced local proof artifacts as present
  only when the path is a regular file, so directories cannot satisfy
  `docs/*-proof.json` or live-canary JSONL evidence references.
- Readiness checklist validation now applies the same regular-file rule to
  checked local evidence references and to the checklist file itself.
- Proof file guard now rejects directory paths for auxiliary and final proof
  JSON artifacts before JSON parsing, reporting them as `not a file`.
- Launch command-map and launch-doc syntax verifiers now reject directory paths
  before reading package or documentation files.
- Launch proof runners now require configured checker script paths to be
  regular files before spawning child Node checks, so a directory cannot satisfy
  a proof/preflight script path.
- Prelaunch status now has `npm.cmd run proof:prelaunch:summary`, a single
  read-only aggregate view over local V9/V10 compile, Solidity advisory, compiler
  matrix, no-RPC diagnostics, offline deployment identity, V9 compatibility invariant, active V10 invariant,
  indexer, fetch-timeout, stored-number parsing, TypeScript typecheck, ESLint,
  production build, bundle baseline,
  business-logic/removed-wallet, production and full dependency/toolchain,
  wallet dependency, process-model, and host
  load-target guard checks, launch-doc command validation, SQLite operation drills,
  proof template/draft/file/redaction/map/readiness meta-guards, launch-gate
  structure validation, and runtime monitoring drills plus the
  compact launch, soak, pending-nonce dry-run, canary, monitoring, QA,
  indexer, restore, host, signoff, mainnet env, and backup checks. It exits
  non-zero for local
  V10/ABI/indexer/dependency/ops regressions, while external Missing evidence
  remains a visible status line and is counted in the final external blocker
  summary even when the individual compact proof command exits zero. Child
  command output is passed through the shared proof redactor before JSON or
  summary extraction, so a bad downstream issue string cannot leak secrets
  through the aggregate status table. Child `npm` checks run with update
  notifier and funding prompts disabled so compact evidence stays focused on
  status rows instead of package-manager noise. Each child check now also has a
  bounded timeout so a hung status command reports `status=timeout` instead of
  blocking the whole prelaunch summary indefinitely.
- Chain/indexer comparison now also rejects stale normalized metadata rows for
  batch claims, resolver rewards, and dust settlements in the audited block
  window. Legacy JSON metadata remains readable, but normalized
  `scoped_indexer_events` rows for those categories must have matching chain
  events just like bets, resolves, jackpots, rewards, and fee flushes.
- Chain/indexer comparison now also rejects directory paths in `LORE_DB_PATH`
  before opening SQLite, keeping audit failures early and explicit.
- Admin ops/process diagnostics now treat non-file log or pid artifacts as
  missing before reading them, so a directory at an artifact path cannot crash
  the admin status endpoints.
- `npm.cmd run db:backup:summary` now fail-closes missing/invalid backup
  configuration with compact JSON instead of a stack trace.
- `npm.cmd run db:backup:summary` also keeps runtime backup failures compact:
  missing/corrupt source DBs and backup library errors return bounded JSON
  failure records instead of Node stack traces in routine status output. The
  compact issue text uses the shared proof redactor and collapses generic URLs
  plus Windows/POSIX absolute paths before printing summary JSON.
- Restore proof draft generation now requires DB source and backup artifact
  inputs to be regular files and backup/restore roots to be directories before
  writing incomplete evidence drafts.
- Launch-doc verification now also checks that every documented
  `npm.cmd run <script>` command in the launch/runbook docs exists in
  `package.json`, so operator docs cannot silently drift to missing scripts.
- Signoff proof now has `npm.cmd run proof:signoff:summary` for compact
  contract/funds/operator sign-off checks. It keeps validation unchanged while
  reporting manifest presence instead of the absolute proof path.
- Canary proof now has `npm.cmd run proof:canary:summary` and
  `npm.cmd run proof:testnet:canary:summary` for compact live-log evidence
  checks. Missing logs are reported as safe summaries, and compact output hides
  absolute manifest paths plus tx-hash/duplicate-key sample sections.
- Canary proof summary output also treats malformed JSONL as a compact proof
  issue with only the line number and error class, avoiding absolute paths and
  raw malformed log snippets in routine status output.
- Canary proof draft generation also reports malformed JSONL with only the
  artifact basename, line number, and error class, so draft checks do not echo
  local paths or raw malformed rows.
- Canary proof draft/analyzer now require CLI-supplied and manifest-backed
  evidence artifacts to be regular files before reading, so directory
  references fail as local artifact issues instead of low-level filesystem
  errors.
- Strict signoff, host, indexer, restore, monitoring, and QA proof validators
  now also require local manifest artifact references to be regular files, so
  directories cannot satisfy launch evidence checks.
- Those same strict validators reject directory paths passed as proof manifests
  before JSON parsing, keeping launch-proof failures explicit and bounded.
- Indexer proof now has `npm.cmd run proof:indexer:summary` for compact
  dry-run evidence checks. It keeps validation unchanged while hiding absolute
  DB/manifest paths and detailed row/meta tables in routine status output.
- Indexer evidence collection now reports missing/invalid log and chain-snapshot
  artifacts by argument name instead of echoing supplied local paths or raw JSON
  parse details.
- Indexer proof draft generation uses the same chain-snapshot error hygiene:
  missing JSON artifacts, malformed JSON, and non-object snapshots are reported
  by flag name without local paths or parser details.
- Indexer proof draft/collector generation also requires redacted indexer logs
  and chain-snapshot JSON inputs to be regular files before reading/parsing, so
  directory inputs fail closed with flag-level errors.
- Indexer proof draft/collector generation now rejects reusing one local file
  across indexer dry-run, health/finality, and chain-snapshot evidence inputs.
  Strict indexer proof validation applies the same rule across `dryRun`,
  `finality`, and `chainSnapshot` manifest sections, so one combined artifact
  cannot falsely satisfy independent G7 launch-evidence checks.
- Restore evidence collection now reports missing restore/health log artifacts
  by flag name instead of echoing supplied local paths during backup/restore
  proof collection.
- Host evidence collection now reports missing health/load log artifacts by
  flag name instead of echoing supplied local paths during production host proof
  collection.
- Monitoring and QA proof draft generation now require supplied evidence
  artifacts to be regular files, so directories cannot be accepted as launch
  evidence placeholders.
- Signoff proof draft/collector and host proof draft/collector generation now
  also require supplied redacted evidence inputs to be regular files; directory
  inputs fail closed with flag-level errors instead of low-level filesystem
  output.
- Signoff proof draft/collector generation now also rejects reusing the same
  local file for `--env-log` and `--chain-log`. Strict signoff validation
  rejects one local artifact reused across the top-level `contractEnv`,
  `ownership`, `randomness`, and `chainComparison` evidence groups.
- QA proof now has `npm.cmd run proof:qa:summary` for compact wallet/UX launch
  evidence checks. It keeps validation unchanged while avoiding the absolute
  manifest path and detailed per-check table in routine status output.
- The latest read-only V10 post-deploy planner snapshot is at Linea Sepolia
  block 31,148,995. It scanned epochs 1-7 completely, found the current epoch 8
  expired but unfunded, and reports the next bounded phase as seven
  claim/resolver/fee-flush calls with 566,008 estimated gas and 0.793125 LINEA
  planned transfers covered by the contract balance. This is planning evidence
  only; no transaction authorization was implied or used.
- Local SQLite operations and runtime-monitor drills currently pass. Compact
  restore and monitoring proof summaries still fail closed because the external
  production/canary DB restore manifest and deployed-monitor manifest are
  missing; this is expected until those external artifacts exist.
- Pre-mainnet hardening is resumed for local/off-chain work. Randomness stays
  unchanged for launch; do not redesign it in this objective. G1-G14 still need
  real production/mainnet evidence before public launch.
- Local pre-mainnet guardrails now require
  `NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS=1` for V10 mainnet runtime,
  and the sign-off collector can record explicit accepted-risk randomness
  evidence without changing the randomness model.
- Mainnet runtime validation now also rejects local, private, example, test, and
  single-label keeper RPC endpoints, and applies the same public HTTPS endpoint
  guard to the shared external rate-limit store URL for multi-replica web
  runtime. Credentialed endpoint URLs are rejected too, so secrets are not hidden
  in public RPC or rate-limit URLs.
- Public Sepolia staging/canary hosts can now opt into
  `LORE_PREMAINNET_RUNTIME_STRICT=1`, which applies production-like checks for
  public HTTPS site/RPC URLs, non-development Privy App ID, alert email config,
  trusted proxy identity, two-replica external rate limiting, server secrets,
  V10 protected-bet config, matching deploy/indexer blocks, indexer finality,
  and external DB paths without changing ordinary local/testnet development
  defaults.
- Strict Sepolia production-like runtime validation now requires
  `WEB_REPLICA_COUNT >= 2`. A strict pre-mainnet web gate can no longer pass in
  single-replica mode while claiming the shared external rate-limit store has
  been exercised.
- Mainnet and strict Sepolia `server` runtime validation now also require
  `RUNTIME_MONITOR_BACKUP_MAX_AGE_MS` as a positive safe integer. The runtime
  monitor startup has the same production-like guard, so backup freshness cannot
  silently fall back to a default window when the external backup schedule is
  missing or mistyped.
- Runtime health now exposes a safe `backupMonitorMaxAgeConfigured` boolean, and
  `health:prod` fails production-like runtime when the backup freshness window
  is absent. The health output reports only the boolean, not backup paths or
  schedule values.
- HTTP smoke now also requires the `backupMonitorMaxAgeConfigured` runtime
  diagnostic, so stale production builds or incomplete health payloads are
  caught before external launch proof collection.
- `.env.local.example` now documents the backup directory and backup freshness
  window next to the opt-in strict Sepolia runtime monitor settings, matching
  the production `.env.example` template without changing local defaults.
- API route error logging now redacts and bounds the route label itself, not
  only the error and extra payload, so future dynamic route labels cannot leak
  provider URLs, wallet identifiers, or multi-line log data.
- The bootstrap resolver POST route is now explicitly header-only: non-empty
  request bodies are rejected before keeper/RPC work, and the route remains
  guarded against unbounded JSON parsing.
- Production shared replay-lock detection now fails closed on an invalid
  `WEB_REPLICA_COUNT` value instead of treating the runtime as single-replica,
  so config typos cannot silently disable cross-replica auth/resolve locks.
- Restore proof regressions now cover both sides of the gate: incomplete drafts
  and collector outputs still fail closed, while a concrete non-draft manifest
  with a real temporary SQLite restore, backup schedule, latest successful
  backup, retention, restored health, and indexer preservation evidence passes
  strict validation.
- Host proof regressions now also cover the valid strict path: incomplete host
  drafts and collectors still fail closed, while a concrete non-draft manifest
  with process supervision, persistent DB, production health, canary load, and
  two-distinct-replica shared rate-limit evidence passes strict validation.
- Monitoring proof regressions now cover the valid strict path too: incomplete
  monitoring drafts and collectors still fail closed, while a concrete non-draft
  manifest with every required monitor kind, fired/recovery evidence, a verified
  Resend email target, and an error-tracking test event passes strict
  validation.
- Indexer proof regressions now cover the valid strict path too: incomplete
  indexer drafts and collectors still fail closed, while a concrete non-draft
  manifest with a fresh external SQLite DB, finality-aware health evidence,
  chain snapshot, and jackpot/deposit/reward/rebate/latest-epoch direct-chain
  comparison evidence passes strict validation.
- Local indexer storage regressions now also prove normalized event idempotency:
  re-indexing the same `(scope, category, id)` event updates payload/block
  metadata without growing duplicate rows, preserving rerun/dedup safety.
- QA proof regressions now cover the valid strict path too: incomplete QA drafts
  and collectors still fail closed, while a concrete non-draft manifest with
  Privy allowed-origin/app-id proof, wallet recovery/wrong-network evidence,
  failure-state UX, support/audit visibility, mobile/final browser QA, and
  debug auto-miner browser smoke evidence passes strict validation.
- Sign-off proof regressions now cover the valid strict path too: incomplete
  sign-off drafts and collectors still fail closed, while a concrete non-draft
  manifest with contract/env parity, the V10 protected-bets flag, Safe/multisig
  owner proof, explicit accepted-risk randomness sign-off, and direct-chain/app
  comparison evidence passes strict validation.
- Sign-off chain comparison evidence is now side-specific: each checked section
  must have direct-chain/on-chain proof and app/indexer proof for that section,
  so a generic launch note cannot satisfy both sides of the comparison.
- Sign-off draft/collector inputs now also reject weak chain logs that do not
  contain direct-chain comparison coverage for jackpot, Safety Pool, deposits,
  rewards, rebates, and resolve.
- Jackpot win modal focus handling now reuses the shared dialog focus trap
  instead of maintaining a second keyboard implementation, while preserving the
  existing inert/aria-hidden background shielding and opener-focus restoration.
- Jackpot win decorative sparkle/coin overlays now use deterministic preset
  positions instead of render-time `Math.random()`, avoiding hydration drift and
  reducing visual-smoke noise while preserving the animation.
- Auto-Miner tab-lock random markers now normalize their requested bound and
  use unbiased native-crypto rejection sampling when available, keeping
  multi-tab lock identity less collision-prone without changing bets, game
  randomness, polling, or transaction behavior.
- Chat optimistic local message IDs now use native `crypto.randomUUID()` or
  `crypto.getRandomValues()` before the legacy fallback, reducing local pending
  message collisions without changing chat API payloads or wallet auth.
- Chat profile modal close control now keeps the shared visible keyboard focus
  ring, matching the rest of the modal/action surface.
- BackupGate export/continue actions now also use the shared visible keyboard
  focus ring, so the wallet-backup blocker remains keyboard-visible across its
  primary actions.
- BackupGate now also has a business-logic guard that its dialog root remains
  labeled, described, modal, and programmatically focusable for the shared focus
  trap fallback.
- Embedded reward, resolver-reward, and ETH-withdraw preparation toasts now use
  shorter action-focused copy instead of restating that the action uses the
  Privy wallet. External wallet deposit prompts still explicitly mention the
  wallet prompt because those require user confirmation.
- QA launch proof now requires check-specific wallet evidence for desktop
  connect/disconnect/reconnect, wrong-network recovery, mobile Web3 browser,
  clean-wallet first transaction, slow Privy auth, and slow chat auth. Generic
  wallet wording is no longer enough for those wallet QA gates.
- Mainnet web runtime validation also rejects the known development Privy App ID
  if it is supplied explicitly, so production cannot silently use the local
  fallback project.
- `.env.example` no longer shows the known development Privy App ID as a
  copyable value; it points operators to a real production Privy App ID for
  mainnet, while local development can rely on the built-in fallback.
- `.env.example` now also shows a mainnet-valid keeper RPC URL shape and warns
  that localhost/private/example/test RPC endpoints fail the runtime guard.
- `.env.example` and `.env.local.example` no longer show `.example` backup RPC
  endpoints in `NEXT_PUBLIC_LINEA_RPCS`; the logic guard rejects that regression.
- Production chat and admin signed-auth proofs bind to the configured canonical
  HTTPS site origin rather than the inbound request Host, while development
  retains local-origin support.
- Manual/direct betting now treats an ambiguous silent submission or receipt as
  pending and never falls through to a duplicate wallet-write transaction.
- Chat custom avatars are validated against a 512x512 decoded-image budget in
  addition to their existing encoded data-URL limit.
- The health diagnostics secret no longer authorizes admin diagnostics or
  development process controls; those routes require a signed admin session.
- Fresh local verification on 2026-07-27 passes `npm.cmd run check`, including
  lint, V9/V10 contract invariants, indexer/SQLite/monitoring drills, build,
  typecheck, HTTP smoke, and responsive browser smoke. This is local evidence,
  not a signed wallet or host-production receipt.
- The bounded pending-nonce recovery dry-run currently reports no queue gap for
  its one approved test role. It sends no transaction unless separately invoked
  with the guarded execution flag and fresh authorization.
- The current V10 read-only behavioral matrix passes 95 simulated transitions
  and 88 expected boundary reverts without signing or transaction submission.
- Fresh ABI/indexer compatibility verification on 2026-07-27 passes
  `test:contract:v10` and `test:indexer-storage`: the contract gate confirms
  the canonical V10 compiler settings, 138 preserved V9 ABI items, 81 function
  selectors, 22 documented state-changing entrypoints, 24 locally declared
  events, exact frontend/resolver/indexer ABI boundaries, and selector/topic
  checks; the storage gate confirms normalized indexer event storage,
  pagination, tile-user counts, and contract-scope isolation.
- Shared Linea RPC helpers now split comma-separated configured RPC lists before
  de-duplication, so CLI/read-only tools do not accidentally treat
  `url1,url2` as one invalid endpoint.
- Mainnet runtime validation now rejects configured `NEXT_PUBLIC_LINEA_RPCS`
  entries that are not public HTTPS endpoints, preventing launch with a broken
  frontend read/broadcast RPC list.
- Mainnet runtime validation also rejects `NEXT_PUBLIC_LINEA_SEPOLIA_RPCS`, so a
  stale testnet RPC override cannot silently drive the production wallet/client
  provider.
- Mainnet runtime validation now rejects `RUNTIME_MONITOR_ALLOW_NO_ALERTS=1`
  and validates partial Resend email alert config: sender and recipients must be
  syntactically valid, with comma-separated recipients supported.
- Strict monitoring proof now requires a verified email alert target with an ISO
  test timestamp and concrete email-specific fired-alert evidence, so
  Telegram/Slack-style or generic notification targets cannot satisfy the
  email-alerting launch gate by themselves.
- Strict monitoring proof now also requires the email alert target to record an
  explicit recipient address or recipient evidence, so a generic Resend/email
  delivery marker cannot satisfy the launch gate without proving where the test
  alert was sent.
- Strict monitoring proof treats explicit alert-target and error-event artifact
  fields as semantic evidence, not only as file-existence references. Draft
  generation preserves those fields for real deployed monitoring proof.
- Mainnet/server and standalone runtime-monitor validation now reject relative
  or repo-local backup directories outside explicit local monitor mode. Routine
  backup checks can use compact `npm.cmd run db:backup:summary`, which preserves
  integrity/retention behavior while avoiding full path output.
- The SQLite backup command now also enforces absolute external source/output
  paths when running under production/mainnet or
  `LORE_BACKUP_REQUIRE_EXTERNAL=1`, while local `.tmp` backup drills remain
  supported.
- FAQ and White Paper jackpot wording now describes daily/weekly windows as
  eligible trigger windows instead of implying a guaranteed fixed daily/weekly
  jackpot award.
- `docs/testnet-deep-audit-2026-07-19.md` now reflects current V10 fee delivery
  and discovery state: resolve accrues protocol fees without transfer-side fee
  flushing, and Safety Pool older history uses bounded on-demand pagination.
- `proof:mainnet`, G1 remaining-gate reporting, launch docs, and sign-off
  draft/collector tooling now all include the V10 protected-bet requirement.
- Strict `proof:signoff` now also rejects final manifests unless
  `contractEnv.protectedBetsRequired=true`, so the G1 V10 flag cannot be lost
  between the env proof and final operator sign-off.
- Shared proof collectors now reject unsafe positive integers before Number
  conversion, preventing oversized epoch/count inputs from passing by JS
  rounding.
- Launch gate structure now requires the G1 `V10 protected bets flag` marker in
  both proof record and status board evidence text.
- Signoff, indexer, canary, and restore proof URL evidence must now be public
  HTTPS without credentials and cannot point at localhost, private-network,
  example, test, or invalid hosts. Local evidence remains supported through
  explicit artifact paths, and the business-logic guard keeps this URL boundary
  aligned across signoff, host, indexer, monitoring, QA, canary, and restore
  proof validators. Canary proof also no longer treats generic recovery/nonce
  words as concrete evidence by themselves; real tx hashes, public HTTPS links,
  saved artifacts, and artifact-backed content checks remain valid.
- V10 ABI/indexer invariants require every indexed `EVENTS_ABI` event to have
  both a topic signature and a decode/handler guard, preventing subscribed
  events from being silently unprocessed.
- Long canary/proof artifacts are handled more defensively: proof file checks,
  canary proof analysis, canary proof draft generation, and soak status marker
  recovery now read bounded chunks instead of loading full JSONL/log artifacts
  when only line-level evidence is required.
- Canary proof summary now requires live-log and manifest inputs to be regular
  files, so directories cannot appear as present canary evidence.
- Managed testnet soak status also requires the recovered live-log path to be a
  regular file before streaming it, so directory paths cannot appear as valid
  live soak evidence.
- Host, signoff, monitoring, QA, indexer, and restore proof summaries now use
  regular-file checks for manifest/DB evidence status, keeping directory paths
  from appearing as present launch proof.
- The retired wallet experiment has been removed from active source, contracts,
  scripts, package metadata, and operator docs. A business-logic guard scans
  active paths so it is not reintroduced accidentally.
- Local UI/runtime hardening now includes 48px chat drawer header touch targets,
  a 48px jackpot modal close target, scoped Auto-Miner storage recovery with
  the same 5,000-cycle bound as the visible form, stale global-stats cache
  rejection, and a full browser smoke pass with debug Auto-Miner failure
  scenarios enabled.
- Local V10 contract readiness is green for compile provenance, invariants,
  compiler matrix summary, diagnostics/offline deployment proof, V9 compatibility,
  indexer storage, logic, typecheck, eslint, build, and Solidity compiler
  advisory checks. Live gas summary remains blocked until a public test role has
  sufficient allowance for transaction-free estimates.
- V10 invariant coverage now binds indexer topic signatures to `EVENTS_ABI`
  one-for-one, preventing stale event queries or unqueried reviewed event ABI
  items from passing the local gate.
- Indexer storage coverage also proves normalized metadata-only events are
  isolated by contract scope, so batch-claim, resolver-reward, and dust
  settlement rows from an old deployment cannot override the active deployment's
  reads.
- The V10 post-deploy planner now has compact `--summary-only` output for long
  evidence runs, plus `npm.cmd run plan:canary:v10:postdeploy:summary` as the
  provenance-first operator command. Full provenance is still written to `.tmp`,
  while stdout stays bounded. A fresh read-only 5000-epoch scan completed
  through epoch 7, found current epoch 8 expired but unfunded and not
  resolve-ready, confirmed clean admin state, covered accounting, 29 applicable
  negative checks, and the same seven-call claim/flush phase with 566,008
  estimated gas and 0.793125 LINEA planned transfers. It used no transaction,
  signature, or deployment.
- The production runbook and V10 design doc now direct routine post-deploy
  planning to that compact command, and the logic suite guards the docs so
  operator instructions do not drift back to verbose output.
- Additional local runtime/ops guards are green: wallet peer dependency tree,
  fetch timeout, stored-number parsing, monitoring drill, read-only SQLite scope
  audit, production dependency audit, and all-dependency audit with only the
  documented dev-toolchain exception. SQLite backup/restore operations, proof
  collector redaction, and host load-target guard also pass locally.
- Multi-replica production chat/admin authentication and bootstrap resolution
  now use the required Upstash-compatible store as atomic shared locks.
  Single-replica deployments retain SQLite locking; scaling without the shared
  store remains fail-closed before any duplicate keeper dispatch.
- Strict host proof now also requires concrete two-replica shared rate-limit
  evidence: at least two web replicas, at least two distinct replica identities,
  fail-closed external store behavior, proof that both replicas consume one
  shared rate-limit bucket, and evidence text or fields that identify the two
  replica identities.
- Host and monitoring proof URL evidence must now be public HTTPS without
  credentials and cannot point at localhost, private-network, example, test, or
  invalid hosts. Monitoring proof also no longer treats generic provider/channel
  words as concrete evidence by themselves; real provider event IDs, incident
  IDs, hashes, public HTTPS links, or saved artifacts remain valid.
- Strict QA proof now requires `wallet.privyAllowedOrigins` evidence to mention
  Privy allowed-origin/dashboard plus production App ID proof. The manifest
  stores only `productionAppIdConfigured: true`, not the App ID value.
- Mainnet QA and monitoring draft plans exist as TODO-bearing plans only; they do
  not satisfy G1-G14 without real production, wallet, canary, monitoring, and
  sign-off artifacts.
- Mainnet QA proof fields are aligned across the readiness checklist, QA plan
  generator, QA draft generator, strict QA proof validator, and proof-draft
  self-tests. Auto-Miner support evidence must include round, epoch, nonce,
  txHash, retryCount, and stopReason.
- Strict QA proof now only treats public HTTPS URLs, local artifact paths, or
  real non-zero transaction hashes as concrete evidence. URL evidence cannot use
  credentials or point at localhost, private-network, example, test, or invalid
  hosts. Keyword-only text can still help prove artifact relevance after a
  concrete artifact/link exists, but it cannot satisfy wallet, failure-state,
  support, or final QA launch evidence by itself.
- `wallet.cleanWalletFirstTx` also needs receipt/explorer confirmation evidence;
  a bare non-zero tx hash plus generic clean-wallet wording is not enough for
  launch QA proof.
- `wallet.mobileWeb3Browser` also needs mobile device, wallet-app, or viewport
  evidence; generic mobile/Web3 wording alone is not accepted as launch QA
  proof.
- The QA canary plan now explicitly covers wallet loading recovery, ETH/LINEA
  top-up and withdrawal error states, signed revert copy, empty pool chart
  visibility, consistent number typography, mobile jackpot ticker/right-panel
  geometry, and jackpot/reward visibility states.
- The wallet settings deep reward panel now frames full-history lookup as a
  stoppable recovery scan in bounded batches, not a routine all-epoch action.
- Safety Pool claim-minimum parsing now rejects zero/negative configured values
  and falls back to the default, so the low-value claim warning cannot be
  disabled by a bad public env value.
- Support/API redaction now covers long `0x` calldata-like payloads in addition
  to addresses, tx-hash-sized hex values, assigned secrets, JWTs, bearer tokens,
  and URLs.
- Route/global error boundaries, bot supervisor errors, and support-log exports
  now sanitize local runtime crash/error details before terminal or support-log
  output.
- Proof collector/status redaction now also covers bare wallet-address and
  tx-hash-sized hex values, long calldata-like payloads, bare 64-hex secrets,
  JWTs, and RPC-like URLs in addition to assignment-style credentials, CLI
  secret args, query secrets, bearer tokens, and URL credentials.
- `npm.cmd run proof:drafts` now applies the shared proof redactor and absolute
  path compaction before printing compact validator/collector evidence rows,
  so draft-regression summaries do not leak child output secrets or local temp
  paths.
- Production dependency audit now passes with zero high or critical advisories
  after updating Next/Sentry/PostCSS/Sharp and the related overrides. Full
  dev-scope audit now passes only with an explicit known ESLint/minimatch
  toolchain exception; an attempted ESLint 10 bump was not retained because the
  current Next ESLint plugin chain does not support it cleanly.
- `npm.cmd run proof:local` passes after the guard changes: L1-L16 are green,
  while strict launch remains an expected failure until real G1-G14 external
  evidence exists.
- `useGameEpochUiState` no longer suppresses `react-hooks/exhaustive-deps`; seeded
  epoch bootstrap sync uses a functional state update, and the logic suite guards
  that hook-dependency boundary.
- `useAutoMinerForm` and `useMiningGuards` no longer need unused-argument ESLint
  suppressions; their public options stay compatible, focused ESLint passes, and
  `npm.cmd run typecheck` remains green.
- Test regex guards no longer contain mojibake; a targeted source search found no
  remaining `вЂ`/replacement-character markers in `app`, `config`, `scripts`, or
  `contracts`.
- The external rate-limit store client now fail-closes on non-public endpoints
  before making a fetch, so a misconfigured `UPSTASH_REDIS_REST_URL` cannot send
  the bearer token to local, private, example, test, invalid, credentialed, or
  non-HTTPS destinations. Focused ESLint, logic tests, and typecheck pass.
- Wallet-header Privy loading/recovery text is now exposed as a polite live
  status, so slow auth and reload guidance are announced instead of being only
  visual text.
- Latest local verification after the autonomous server/UI patches: typecheck,
  proof:local, and production build pass; only the known Node SQLite
  experimental warnings and Next edge-runtime warning appeared.
- Launch proof meta-guards also pass locally: empty proof templates and final
  draft misuse are rejected by strict validators, readiness checklist structure
  is consistent, and the gate map reports 14/14 gates still incomplete with no
  structural issues.
- Local UI-only browser smoke now passes after removing CSP nonce hydration
  noise from the early runtime script. The smoke covers desktop, tablet, mobile,
  wallet selector, number typography, empty pool chart visibility, explicit
  empty states, and same-epoch pool chart freshness without live transactions.
- Public FAQ copy now states that LORE is an on-chain entertainment game, not an
  investment product or profit promise, while still disclosing probabilistic
  outcomes, transaction fees, visible rules/pools/rewards, Safety Pool, and
  one-year unclaimed handling.
- The Privacy Policy is now discoverable from the main application shell via a
  compact sidebar link in addition to the White Paper footer, robots.txt, and
  sitemap.
- Public metadata, White Paper hero, and Leaderboards wording avoid
  investment-style promises: rewards are framed as trackable game outcomes, and
  the luck metric is described as win-to-wager ratio rather than return on
  investment. The default OpenGraph image now uses neutral play/claim copy
  instead of earn-style language.
- Analytics achievement copy now uses game outcome wording (`Win ...`) instead
  of earn-style jackpot text, and a logic guard covers achievement definitions
  alongside metadata, White Paper, Leaderboards, tutorial, and OpenGraph copy.
- Linea chain config labels both mainnet and Sepolia explorers as `Lineascan`,
  matching the actual explorer URLs used for transaction/address links.
- Jackpot share preview metadata now rejects non-final origins from
  `NEXT_PUBLIC_SITE_URL` (HTTP, path/query/hash, localhost, private, example,
  test, or invalid hosts) and falls back to `https://playlore.xyz`, so social
  previews do not accidentally publish staging or malformed URLs.
- Default and jackpot OpenGraph images no longer use negative letter spacing,
  and the logic guard prevents this readability regression from returning.
- Support/Sentry sanitization redacts additional production secret key names,
  including API keys, client secrets, webhook URLs, DSNs, session tokens,
  credentials, passphrases, mnemonics, and RPC endpoints.
- Admin ops log-source responses expose only safe file names and summary
  status, not absolute server log paths.
- Proof/operator-output sanitization now also redacts password/passphrase-shaped
  assignments and CLI args plus generic URL credentials such as
  `scheme://user:password@host`. The collector redaction guard covers those
  cases before launch evidence can be trusted.
- Auto-Miner insufficient-balance UX now mirrors Manual Bet by showing the
  exact LINEA top-up deficit and exposing the disabled reason to assistive
  technology through `aria-describedby`.
- Reward Scanner and Safety Pool claim actions now expose accessible labels,
  hover titles, and disabled-claim reasons instead of relying on terse button
  text alone.
- Route and global error fallback actions now keep 44px touch targets for
  mobile recovery flows.
- BackupGate links the wallet recovery warning into the dialog description and
  uses ASCII-safe pending text for export-key state.
- Mainnet production runtime validation now rejects example/placeholder
  `NEXT_PUBLIC_PRIVY_APP_ID` values instead of only checking that the variable
  is non-empty.
- Mainnet production runtime validation now also requires
  `NEXT_PUBLIC_SITE_URL` to be an exact public HTTPS origin, rejecting paths,
  query strings, hashes, and single-label hosts before Privy/metadata launch
  evidence can be collected from the wrong origin.
- Mainnet production runtime validation now also rejects invalid or zero
  contract, LINEA token, and admin wallet addresses, and compares keeper/public
  contract addresses after EVM address normalization.
- Mainnet production runtime validation now requires both
  `INDEXER_START_BLOCK` and `NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK` explicitly and
  still requires them to match, preventing frontend/indexer launch with only one
  implicit deploy-block value.
- The root Next.js proxy security header set now also sends
  `X-Permitted-Cross-Domain-Policies: none`; COOP remains intentionally omitted
  because wallet/Privy popup flows can depend on opener behavior. HTTP smoke
  now checks the header on the homepage response.
- Bootstrap resolve API responses now share the no-store response boundary,
  including unauthorized, noop, failure, sent/cancelled, and rate-limit paths.
  A fresh `npm.cmd run proof:local` pass after the API/header hardening keeps
  L1-L16 green and G1-G14 correctly external-evidence-only.
- Mainnet production runtime validation also requires explicit
  `LINEA_CHAIN_ID=59144` and `NEXT_PUBLIC_LINEA_CHAIN_ID=59144`, with both
  values matching before launch.
- Mainnet production runtime validation now also rejects absolute
  `LORE_DB_PATH` values inside the repo checkout, matching the host/indexer proof
  requirement for a persistent external SQLite path.
- Mainnet production runtime and env proof now validate keeper private key
  values by 64-hex shape while keeping key material redacted.
- Runtime monitoring now rejects localhost/private/example/single-label base
  origins unless `RUNTIME_MONITOR_ALLOW_LOCAL=1` is explicitly set for local
  smoke, preventing false production monitoring before launch.
- Admin ops now reads bounded 256 KiB log tails instead of whole process log
  files, keeping diagnostics responsive and reducing accidental heavy output.
- Admin ops now also redacts secret-like assignments, URLs, calldata, and wallet
  addresses from log summaries before returning authenticated JSON.
- Admin process status now exposes only log file names, not absolute server log
  paths, in authenticated diagnostics responses.
- Wallet transfer failure copy no longer falls back to raw provider/RPC errors;
  shared ETH and LINEA transfer UX now classifies timeouts, reverts, gas-cap
  rejects, insufficient funds, and provider failures into safe actionable text.
- Privy wallet and chat network warnings now use the shared support logger
  instead of direct `console.warn`, so exported support logs keep the existing
  redaction boundary.
- Wallet Settings animation switch now has a state-aware accessible label, and
  cached Hot Tiles reject impossible tile IDs above `GRID_SIZE` before rendering
  stale localStorage data.
- FAQ and White Paper copy now avoids unverified security integrations and
  fixed gas-savings promises; fee language points users back to the wallet quote.
- Admin wallet verification, signed auth message parsing, admin session cookies,
  and admin UI wallet matching now share the same EVM address normalizer instead
  of separate lowercase/regex checks.
- Chat auth, chat sessions, message sends, and profile read/write cache keys now
  share the same EVM address normalizer before signature/session comparisons.
- The stable chat wallet hook now normalizes connected/localStorage wallet
  candidates with the EVM address parser instead of a hand-written regex.
- Client chat session storage, chat auth wallet selection, BackupGate backup
  confirmations, and admin owner checks now reject malformed wallet addresses
  through EVM parser normalization before storage keys or comparisons are used.
- Deposits API query handling and chain-recovery topic construction now also
  normalize user addresses with the EVM parser instead of regex/lowercase.
- Chat profile batch reads now reject an empty `walletAddresses` query instead
  of falling through to the public list-all path.
- API route error logging now redacts and clamps safe error names/messages to
  bounded one-line diagnostics before writing server logs.
- First-visit tutorial and White Paper strategy copy avoid `ROI` and
  "play consistently" phrasing; jackpot exposure is framed as probabilistic,
  not guaranteed.
- The testnet pending-nonce recovery helper keeps dry-run public-address-only;
  signing material is loaded only after explicit `--execute`.
- The V10 post-deploy read-only planner now parses the public-only
  `.env.live-test-addresses` file with normal dotenv formatting: optional BOM,
  `export`, whitespace, quotes, and inline comments. It still never reads the
  secret wallet env file or signs transactions.
- The latest local production build passes after these changes. It emits only
  the known Node SQLite experimental and Next edge/static generation warnings.
  Local UI-only browser smoke passes on `http://localhost:3101`, covering
  desktop/mobile hub, wallet selector, touch targets, chat viewport, Safety
  Pool, Leaderboards, empty states, and same-epoch pool chart freshness. The
  temporary server was stopped.

## Confirmed State

- The deployed executable runtime matches the canonical V10 executable bytes,
  constructor values and initial state. The strict full-bytecode verifier still
  fails closed on a metadata-only creation/runtime mismatch caused by the Remix
  source-unit layout. This deployment is valid for bounded testnet behavior and
  gas evidence, but it is not the final reproducible deployment candidate. The
  fresh verifier now reads constructor-era owner, fee recipient, epoch clock,
  pending administration, pools, claims, and token balance at the deployment
  block, so later bets and resolves cannot create false initial-state failures.
  A repeated strict read-only check leaves only `runtimeBytecode` and the linked
  exact `deploymentTransaction` input red; block, receipt, executable runtime,
  constructor state, and current health pass.
- `npm.cmd run prepare:contract:v10:deployment` now verifies the canonical
  compiler manifest, recompiles a full 15-source Standard JSON, and writes the
  exact constructor-bound initcode to the ignored
  `.tmp/v10-canonical-initcode.hex`. The generated initcode is 17,374 bytes,
  independently matches its reported keccak, and the preparation path has no
  network, wallet, signer, deployment, or transaction capability. The separate
  `npm.cmd run prepare:contract:v10:standard-json` command needs no constructor
  values; it writes `.tmp/v10-canonical-standard-json-input.json` only after all
  source-unit hashes and exact creation/runtime bytecode match the manifest.
  This provides a canonical compiler/explorer/reviewer input and detects the
  root-level copy/path drift that changed metadata.
  `npm.cmd run prepare:contract:v10:remix-workspace` now writes those same 15
  verified source units plus the tracked compiler configuration under their
  exact paths in `.tmp/v10-canonical-remix-workspace`. It rejects path
   traversal, then verifies both a complete 15-source compile and a root-only
   filesystem-import compile before publishing it. Both paths reproduce exact
   canonical creation/runtime bytecode. A generated root `README.md` pins the
   verified source/creation/runtime fingerprints, exact compiler controls,
   constructor argument order, and strict post-deploy verifier without storing
   addresses or secrets. The successful proof is local-only and
   constructor-independent, with no RPC, wallet, signing, or transaction.
  Both source-only generators now return before deployment network/token
  configuration is loaded and skip `.env.local`/`.env` entirely. A clean-
  boundary regression with mainnet selected, no token configured, and invalid
  constructor inputs reproduced the exact Standard JSON and Remix workspace;
  constructor-bound initcode and fresh verification remain fail-closed behind
  their independent inputs.
- A dedicated transaction-free Linea deployment preflight regenerates and
  byte-compares that artifact before estimating it. Six invalid constructor
  cases reverted as expected; the canonical V10 deployment estimate was
  3,730,924 gas, 6.36% above V9, with a snapshot fee projection of about
  0.00012533 ETH. It used only public addresses and sent no transaction.
- The explicitly authorized bounded live matrix used exactly 21 transactions:
  four approvals, 12/12 protected epoch-bound bets over six epochs, and 5/5
  resolves. It covered first and repeat writes for 1, contiguous/sparse 3,
  contiguous/sparse 5, and 25 tiles with zero reverts, duplicate hashes,
  nonce gaps, ambiguous sends, or epoch-unbound successes. That authorization
  capped resolves at five. A later separately authorized sixth resolve closed
  the final funded epoch successfully without a retry or follow-up write.
- Mined V10 bet gas is lower than the prior V9 receipts on every comparable
  path: about 27.7% for a first single-tile write, 10.5% for its repeat, 26.2%
  for three tiles, 29.2% for five tiles, and 33.3% for 25 tiles. The strict V10
  proof passes. A fresh V10 indexer replay found 12 bets over six indexed
  epochs, and chain/indexer accounting reconciles with zero mismatches through
  the latest resolved epoch. Production build, HTTP smoke, and full responsive
  browser smoke pass against the V10 runtime.
- The remaining post-deploy planner is transaction-free: it reads only public
  role addresses from process env or the ignored public-only
  `.env.live-test-addresses`; it never opens the secret-bearing live wallet
  file. It validates the V10 selector, simulates and estimates current
  resolve/claim/fee calls, and contains no private-key, wallet-client, signing,
  or write API. Its one-shot RPC fallback no longer starts ranking timers, so a
  successful run exits cleanly after emitting the plan. Truncated history is
  explicit and blocks claim/fee-flush authorization until a complete bounded
  scan is rerun; a ready current resolve remains an independent phase. The
  official command reruns compilation provenance first, then requires the
  deployed 16,435-byte executable runtime to match the manifest after
  normalizing exactly 16 pinned token-immutable ranges. It separately checks
  `token()`, requires bytecode at that token address, and requires the app's
  18-decimal boundary, so metadata-only drift is diagnostic while executable,
  immutable-token, token-runtime, or decimal drift fails before mutation
  planning. An independent invariant proves that a
  one-byte executable change fails identity. The planner then decides the phase
  barrier before role-claim discovery and skips
  all stale claim/fee-flush reads and simulations while resolve is ready. It
  also fails closed when owner acceptance, epoch-duration activation, or fee-
  recipient activation is pending: positive resolve/claim/flush simulations
  are skipped and `nextAuthorization.transactionLimit` is zero until explicit
  governance review. The same pinned snapshot now compares current `owner()`,
  `feeRecipient()`, and `epochDuration()` with tracked testnet expectations; an
  already completed unexpected change also produces a zero transaction limit
  without printing either address. Optional expected-current env overrides
  support reviewed governance rotations. A controlled read-only wrong-owner override preserved
  runtime and 21/21 negative diagnostics but ran zero positive simulations and
  returned `transactionLimit: 0`. Epoch and per-role discovery reads now run in bounded
  batches of four; mutation simulations and exact-revert checks remain
  sequential. Bytecode, balance, every contract read, positive simulation, gas
  estimate, and exact negative check are pinned to one reported Linea block, so
  a concurrent resolve or claim cannot mix state from adjacent blocks. The fresh
  complete six-epoch run found both governance identities matched and no
  pending change, exercised two read batches,
  passed 21/21 exact negative checks, exposed one resolve simulation, and
  emitted zero claim/flush transactions.
- The separately confirmed first V10 live tranche resolved funded epoch 7 in
  block 31042971. Receipt status was successful, `currentEpoch` advanced to 8,
  and actual resolve usage was 165,715 gas under the fixed 500,000 cap. The
  transaction hash is
  `0x8384c79be9815cba8ccd41ecc16c2e248e3af40535223d5aa4f7eaff31dc842b`.
  No second transaction was sent.
- The mandatory post-receipt planner exposed and then closed a diagnostic phase
  bug: it had unconditionally expected `EpochClosing` from a protected bet even
  after resolve created an empty current epoch. That check now runs only when
  `resolveReady`; that first seven-epoch snapshot passed its then-applicable 20
  exact negatives, matched owner/fee recipient/60-second duration, and retained
  full liability coverage. A controlled duration mismatch ran zero positive
  simulations and returned `transactionLimit: 0`.
  The same run now reconciles a fail-closed observable-liability lower bound:
  current stake, rollover, jackpot reserves, fee buckets, unsettled reward and
  rebate pools, plus pending rewards for every configured test role. That bound
  equals the deployed token balance exactly, with zero deficit and zero
  unexplained residual. Unknown third-party resolver addresses and direct token
  transfers remain explicitly outside the claimed scope rather than being
  mislabeled as surplus.
  The post-resolve call manifest now contains exactly one address-free record
  per permitted mutation: role, function, epoch list, estimate, conservative gas
  limit, and expected transfer. The latest seven-call manifest length equals
  its transaction limit, its per-call gas sums to the reported 564,999 total,
  its transfers sum to 0.793125 LINEA, and every gas limit exceeds its pinned
  estimate. A controlled duration mismatch emits zero calls and zero positive
  simulations. These seven calls remain unapproved.
- A fresh complete transaction-free scan covered all seven resolved epochs,
  retained the same seven-call, 564,999-gas claim/flush plan, and passed 29/29 applicable exact
  deployed reverts. The added coverage includes invalid single tiles, mismatched
  arrays, both epoch-duration bounds, invalid fee recipients, ownership
  renunciation, and both no-pending timelock activations. The planner uses an
  audit-only ABI extension for `renounceOwnership()`; every positive mutation
  simulation remains bound to the shared frontend `GAME_ABI`. No transaction,
  signature, or wallet client was used.
- The manual-bet fee preview now estimates the same
  `placeBatchBetsBitmapForEpoch` calldata used by protected V10 sends, including
  single-tile bets. It reuses the already displayed current epoch and does not
  add another polling/read loop; legacy selectors remain only for explicitly
  non-V10 runtime mode.
- The deployed negative matrix is lifecycle-aware rather than count-only.
  Twenty-nine checks apply on the current empty-epoch/open-claim-window
  snapshot; the funded-expired bet check is added only when resolve is ready.
  Single reward rejection switches from `NoWinningBet` to
  `RewardClaimWindowExpired` after one year, while premature dust checks run
  only before settlement eligibility. Transport failures and unknown reverts
  are never accepted as contract evidence.
- Legacy `playtest:wallet` no longer defaults to writes. It discovers the
  protected selector from deployed bytecode, keeps both single and batch V10
  actions on `placeBatchBetsBitmapForEpoch`, defaults to dry-run, and does not
  load signing material unless both `TEST_WALLET_EXECUTE=1` and `--execute` are
  explicitly supplied. `--execute` alone now fails closed before private-key
  loading or wallet-client creation.
- Reward, Safety Pool, and resolver claims now fail closed before submission.
  Safety Pool and resolver paths simulate from the exact sender before using a
  gas fallback, and all three claim surfaces use synchronous in-flight locks so
  rapid clicks cannot start overlapping single/batch or connected/embedded
  submissions. The Hub reward scanner now reads, caches, simulates, and claims
  for the same embedded Privy address; a temporarily active external wallet can
  no longer substitute a different reward owner. Reward, deep-reward, Safety
  Pool split batches, and connected/embedded resolver claims also pin the actor
  for the lifetime of each async flow. Switching wallets stops subsequent sends
  and prevents the old receipt from mutating the new wallet's cache or UI.
- The first five mined resolves consumed 0.00053779027996293 ETH in aggregate
  while accruing 0.00017 LINEA to the resolver. The separately authorized sixth
  resolve used 165,715 gas and closed funded epoch 7. These deliberately tiny
  test pools are not self-funding at observed fees. Fresh resolve planning
  exposes the dynamic break-even ETH-per-LINEA ratio without assuming a token
  price; operate/fund the resolver below the measured break-even pool threshold.
- The current exact transaction-free Linea gate uses the manifest-pinned V9 and
  V10 bytecode, calldata, and public simulation addresses through read-only
  state overrides. It sends no transaction or signature. The canonical V10
  candidate passes exact compilation provenance, all 138 V9 ABI items, six
  invalid-constructor reverts, 95 successful state transitions, 88 expected
  boundary/duplicate/admin reverts, 35 atomic rollback paths, complete-pool
  accounting conservation, ownership/timelock controls, inbound and outbound
  malicious-token reentry blocking, and all 28 exact-compiler gas comparisons.
  The added selector matrix proves exact tile-pool, user-bet, and user-volume
  state for all five V10 bet entrypoints and all four V9 entrypoints. Its 14
  false-return probes also prove full rollback for every bet selector and for
  V10 expired-empty automatic epoch advancement.
  Every compared V10 runtime path is cheaper than V9. Negative assertions
  accept only EVM execution reverts, never transport failures. Indexer
  isolation, business logic, typecheck, focused lint, production build, and
  diff hygiene also pass. Deployment-dependent results and remaining proof
  boundaries are recorded in `docs/v10-contract-design.md`.
- The predeploy gate now checks Solidity's official version-indexed compiler
  bug database online and fails closed if 0.8.36 acquires a known advisory or
  if the release entry cannot be validated. A fresh 2026-07-23 query reports
  zero known bugs; exact local source/import/bytecode provenance remains a
  separate offline proof.
- The local compiler-size matrix pins V9 to Solidity 0.8.34 and V10 to 0.8.36
  across four optimizer-run counts with and without IR. All 16 profiles remain
  below EIP-170. The canonical V10 profile is 17,278 creation bytes and 16,488
  runtime bytes with 8,088 bytes of runtime headroom. This is size evidence,
  not a substitute for paired Linea runtime-gas simulation. The matrix now
  fails on any missing or failed profile and emits a bounded canonical summary.
- Fresh Linea state-override behavior/gas runs compared adjacent compiler
  profiles against the canonical bytecode. `runs=1` made frequent protected
  bets about 1.5k gas more expensive; `runs=10000` added 2,908 runtime bytes and
  about 603k deployment gas for negligible small-bet savings; `viaIR` reduced
  size/deployment but added 147-327 gas to protected 1/3-tile bets and made
  small claim/flush paths more expensive. All profiles passed behavior and
  rollback checks. The canonical `runs=200`, no-IR choice is therefore retained
  for the frequent small protected-bet/single-claim surface, not merely because
  it was the prior default.
- Canonical V10 source/creation/runtime SHA-256 are
  `41d07b684cfeb1fd6cd97ec8a93b57096bcf391482b1b15dee2e468c61a6e3df`,
  `10ac4550a3712e55ffcf71619025ee14001785526e3b415e8694546c36c1d8c4`,
  and `aac4663525ab2b738bfd62fc419aeb09a2daeb69448ec67305851ef73557e75e`;
  the preserved ABI hash is
  `96bddbce113f0c1ef7903434a1262492302a8baa0c756ca7a896240084f7aed8`.
- All 22 state-changing ABI entrypoints now have compiler-visible NatSpec, and
  all 22 parameters declared by the contract's own mutating entrypoints are
  documented. The same gate requires all 24 locally declared events to be
  emitted and represented exactly in the frontend event ABI, while the 16-event
  accounting surface consumed by the indexer is explicitly allowlisted. The
  documentation-only change left the 16,435-byte executable runtime and its
  keccak unchanged; only Solidity metadata and the corresponding full-bytecode
  manifest hashes changed. The pinned compiler emits exactly one reviewed
  warning (`2394`) from OpenZeppelin `TransientSlot.sol`; the gate accepts only
  that end-of-call transient-lock warning and rejects every other warning.
- The invariant gate now closes the complete financial-exit review gap: all ten
  external claim, settlement, resolver, and fee-flush exits must remain
  `nonReentrant`. Every direct exit must close its exact liability before the
  token transfer; explicit fee flush must clear owner and burn buckets before
  their transfers and emit only after both. The complete local V10 gate passes
  with no RPC access, signature, deployment, or transaction.
- `gate:contract:v10:local` provides one allowlisted no-Linea-RPC gate and has
  passed provenance, V10/V9 invariants, compiler matrix, adversarial diagnostic
  compilation, offline runtime reconstruction, indexer/business tests,
  TypeScript, focused lint, and production build. Its command composition is
  itself pinned by the V10 invariant suite. Approved financial constants and an
  exact 100-LINEA ledger are pinned independently of V9 equality; resolver
  break-even remains a required mined-gas/value-ratio check after deployment.
- No-RPC diagnostics compile an automatic-flush regression variant and prove
  exact ABI plus semantic storage-layout equality. Canonical V10 keeps fee
  delivery permissionless and outside resolve, reducing creation/runtime by 28
  bytes versus that variant. The same gate
  reintroduces the removed duplicate public resolution guard as a regression
  variant and proves that it adds 47 bytes without changing ABI or storage.
- The current V10 resolve path caches fresh/daily/weekly pool storage across
  entropy and fee allocation. Reward, rebate, and expired-dust paths similarly
  reuse packed epoch/user words. `previewRebate` now returns zero after a claim,
  matching the mutating claim paths. Source invariants preserve V9 entropy and
  accounting formulas; fresh read-only Linea execution confirms all 28
  compared runtime paths are cheaper than V9.
- Daily and weekly jackpot award metadata now use two packed words instead of
  four standalone slots while preserving the four V9 getters. This removes one
  metadata `SSTORE` from each actual award and reduces `getJackpotInfo` metadata
  reads from four slots to two. It adds 94 creation/runtime bytes over the
  cache-only predecessor; the packed-jackpot candidate was 59 bytes larger than the
  17,229/16,439 candidate at the start of this review. Exact Linea receipt gas
  remains pending.
- Reward claimed state now shares the packed user-epoch word with volume and
  rebate state rather than allocating a separate boolean mapping slot. The
  `hasClaimed` selector and values remain compatible; each successful reward
  claim updates an existing nonzero slot. The 254-bit volume bound remains far
  above possible token balances. This adds 18 creation/runtime bytes over the
  packed-jackpot predecessor; exact Linea claim gas remains pending.
- The V10 diagnostic harness now compiles locally without loading env files.
  RPC benchmark mode has no private-key, signer, wallet-client, or transaction
  dependency, selects only public role addresses, and separates callback-free
  gas stubs from reentrancy/rollback probes. The invariant gate rejects any
  future wallet/write API reference in this read-only benchmark.
- `bench:contract:v10:behavior` runs the complete state-override behavior gate
  with a fixed synthetic caller, before funded-account selection. The fresh
  run passed 95 state transitions, 88 expected reverts, and 35 rollback paths
  without a signature or transaction. Six direct production-ABI view cases
  also prove V9/V10 compatibility for epoch-end, packed jackpot aggregation,
  rebate preview/info/summary, the documented duplicate-preview precondition,
  and exact one-year expiry. The broader gas summary still requires
  a public account with sufficient balance and allowance and currently stops
  safely when none is available. Its blocked result now reports only role-level
  `configured`, `tokenBalanceReady`, `allowanceReady`, and `eligible` booleans
  for all four test roles. A fresh
  negative run showed sufficient token balance but missing allowance for all
  four configured test roles, without exposing addresses, amounts, or RPC URLs.
- Packaged deployed-verifier commands require provenance first, validate the
  single immutable token's 16 non-overlapping in-runtime references, and redact
  RPC URLs and long hex identifiers on failures. Fresh verification also
  requires an independently entered expected token address and fails before RPC
  access unless it matches `NEXT_PUBLIC_LINEA_TOKEN_ADDRESS`; this prevents one
  mistaken immutable-token value from silently becoming both deployment and
  configuration truth. It also fails if the token does not expose the app's
  required 18-decimal unit boundary; the configured Sepolia token passes that
  read-only check. The offline verifier passes against the refreshed canonical
  manifest.
- Fixed-seed local properties cover 20,002 full-range fee/accounting states and
  20,000 full-range proportional reward/rebate states, including both
  `uint256.max` pool edges and 3,995 V9-safe-domain equivalence points.
- The benchmark also executes the exact V10 init code through an ephemeral
  `CREATE` and verifies the resulting runtime hash, immutable token, owner, fee
  recipient, epoch clock, and zero initial accounting/admin state.
- V10 adds an epoch-bound bitmap entrypoint without removing any V9 selector.
  It places active observed-epoch bets directly and atomically advances exactly
  one expired empty epoch for the first returning player. Stale, closing, and
  expired funded intent reject before stake transfer. Standard frontend
  wallet-write and Privy silent paths prefer it for every tile count; auto-miner
  carries its planned epoch, while manual betting reads immediately before
  simulation. A cached on-chain bytecode check is the only condition that may
  select V9. `UnexpectedEpoch` is deterministic end-of-round UX and cannot
  trigger a second send through a legacy path.
- The transaction-free epoch-120 test proves resolve accrues fees and advances
  even when token `transfer` returns false. Permissionless
  `flushProtocolFees()` separately proves standard-token success and atomic
  rollback with a rejecting token.
- V10 now uses full-precision `Math.mulDiv` for every proportional accounting
  path. Three EVM boundary states prove V9 overflow and V10 success. The source
  pins solc 0.8.36, validates constructor addresses, rejects token addresses
  without code, and fails malformed bets before epoch/token work. The strict
  verifier binds one frontend/keeper address and one deploy/indexer block to the
  exact runtime and constructor timestamp. Fresh verification also binds the
  exact canonical creation input and constructor values to a successful
  deployment receipt, checks token runtime, and proves clean epoch-1,
  token-balance, fee, claim, pool, and pending-admin state.
- V10 rejects the deployed contract itself as initial owner, initial fee
  recipient, or a scheduled fee recipient. This prevents an irrecoverable
  self-owned deployment and prevents owner fees or expired dust from being
  cleared into an untracked token self-transfer. The checks add 21 runtime
  bytes and 5,700 one-time deployment gas; all 25 measured runtime paths,
  including every user bet path, are unchanged from the prior candidate.
- Daily and weekly jackpot check timestamps now share one storage word while
  retaining the two V9-compatible `uint256` getters. The behavior matrix proves
  identical non-award and award outcomes/check timestamps, and the gas matrix
  covers all three jackpot-check branches. The canonical candidate is 16,488
  runtime bytes with 8,088 bytes of EIP-170 headroom. The fresh exact-bytecode
  deployment estimate is 3,730,924 gas; all 28 compared runtime paths remain
  cheaper than V9.
- The V10 invariant gate now checks the frontend boundary directly: all
  compiled custom errors must exist in `GAME_ABI`, and the capability detector
  must use the exact compiled epoch-bound selector signature. This prevents a
  valid contract revert from degrading into an undecodable generic wallet error.
- V10 cutover now has a compiled-runtime guard rather than relying on operator
  memory. With `NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS=1`, manual and
  auto-miner paths fail before signing if deployed bytecode lacks the protected
  selector. Runtime health exposes the compiled mode, and HTTP/production smoke
  reject a stale build that reports it disabled. The configured V10 testnet
  release sets the flag explicitly; the code default remains false only for an
  intentional V9 compatibility deployment. The production build and normal
  HTTP smoke pass, and a transaction-free negative drill proves an
  expected-V10/stale-build mismatch is rejected.
- Manual and repeat-bet actions now snapshot the already loaded current epoch
  when the user submits. The initial send and any fee-bumped retry reuse that
  same `expectedEpoch`, so a delayed retry cannot silently move the stake into
  the next round. A single bounded read-only snapshot records the selected
  tile amounts before the send; ambiguous post-error recovery succeeds only
  when every tile in that exact epoch increased by at least the attempted
  amount. This prevents both future-epoch and pre-existing-bet false success
  without adding polling, gas, or transactions. Focused regressions,
  TypeScript, ESLint, and diff hygiene pass.
- A timed-out Privy silent submission is now classified as ambiguous pending
  before any wallet-write fallback or fee-bumped retry. Manual and direct bet
  attempts return `pending` without allowance work, confirmation probing, or a
  second send when `WalletSendTimeoutError` (or its normalized Privy timeout
  message) is observed. The shared classifier also protects reward, rebate,
  resolver, wallet-transfer, and auto-miner recovery paths that already consume
  it.
- The external-review section now carries an exact packed-bit map and explicit
  epoch state machine. It distinguishes protected bets from the retained legacy
  behavior where a caller may resolve a funded expired epoch, accrue its
  resolver reward, and place the next-epoch bet in one transaction. It also
  documents the sole ABI-only `EpochEnded` error and irrecoverable direct-token
  or forced-native transfers. Contract source and bytecode were not changed.
  The V10 invariant gate binds these disclosures to the canonical build,
  manifest sizes, and current 29-check deployed matrix.
- `gate:contract:v10:review` now provides one external-review command that runs
  the fresh official compiler advisory check, complete deterministic local gate,
  and fixed-synthetic-caller Linea state-override behavior matrix without a
  funded account, allowance, key, signature, or transaction. Its first complete
  run passed 95 state transitions, 88 expected boundary/admin reverts, and 35
  atomic rollback paths. The stricter `predeploy` gate remains intentionally
  red at its final real-token gas refresh because no configured public test
  account currently has enough existing allowance; it does not substitute a
  synthetic-token gas claim.
- The fresh final local V10 gate passes exact compiler/OZ provenance, all 16
  compiler profiles, V10 and V9 invariants, transient reentrancy and rollback
  probes, offline deployment identity, indexer scope isolation, full business
  logic, TypeScript, lint, production build, SQLite fault injection, monitoring,
  timeout/number parsing, all 23 HTTP checks, and desktop/mobile browser smoke.
  The first no-fixture HTTP run correctly failed closed at 503; the documented
  localhost-only weak-identity fixture passed without changing production
  configuration. The temporary server stopped and port 3101 is closed.
- Managed V10 canary evidence is fail-closed around the same selector. The
  canary verifies deployed bytecode before wallet preflight, then uses only the
  epoch-bound bitmap call. Its dedicated strict analyzer rejects any successful
  unbound or unmarked bet. The first six planned rounds deterministically cover
  1 tile, contiguous and sparse 3/5-tile sets, and the full 25-tile grid; strict
  proof rejects missing cases and reports mined gas per case. Compact soak
  status reports protected and unprotected successful counts separately. The
  proof accepts only exact successful receipts; pending, unknown, missing, or
  reverted bet/resolve statuses fail closed.
- The same gate now compares every frontend game function, frontend event,
  shared resolver ABI item, and indexer event item against the exact compiled
  V10 ABI. Indexer storage tests inject a previous-contract scope and prove it
  cannot affect current tile counts, reward-candidate pagination, or global
  statistics. The V10 cutover checklist requires a stopped process set, one
  address/block pair, a fresh DB path, strict receipt verification, a fresh
  Next.js build, and indexer catch-up before restart.
- The invariant gate also fail-closes the complete mutating ABI: all 22
  state-changing entrypoints must match the reviewed allowlist, every financial
  path must remain `nonReentrant`, and every local configuration mutation must
  remain `onlyOwner`.
- Compilation provenance now includes SHA-256 for all 15 Solidity source units
  actually consumed by solc: the V10 source plus every transitive OpenZeppelin
  import. The invariant gate separately classifies all 16 token interactions
  by function, recipient, and amount expression and rejects unreviewed token
  calls, low-level calls, inline assembly, or runtime contract creation. These
  tooling gates leave the canonical V10 source and bytecode hashes unchanged.
- The fee-delivery decision is resolved: V10 no longer couples every 120th
  resolve to owner and burn token transfers. Permissionless explicit flush
  preserves allocations and tokenomics while removing that liveness dependency.
  Exact read-only Linea A/B measures 6,118 less deployment gas and 88 less gas
  per ordinary resolve, with bet/claim/manual-flush paths unchanged.
- The scheduled chain/indexer audit already records both accrued fee buckets.
  Runtime monitoring can now apply an optional uint256 base-unit threshold to
  their sum and emit a deduplicated alert. It never sends a transaction or
  invokes the permissionless flush, so settlement remains an explicitly
  simulated and reconciled operator action.
- The external contract is now documented against explicit bettor, resolver,
  sequencer, owner, fee-recipient, token, indexer, and sybil trust boundaries.
  `tileUserCounts/getTileData.users` is identified as an ABI-preserving but
  semantic compatibility exception rather than being presented as canonical
  on-chain player-count data.
- The final V9 soak was intentionally stopped after 38 successful unique bets
  with no failed bet, revert, duplicate hash, or duplicate nonce. It is V9
  regression evidence only, not evidence for the current V10 deployment.

- Managed testnet soak status now has a compact aggregate-only view, and the
  pending-nonce helper is testnet-only and dry-run-by-default. One explicitly
  authorized bounded replacement cleared the affected testnet queue; the
  initial transaction-free preflight passed for MANUAL, AUTOMINER_A, and
  AUTOMINER_B with no preflight failures.
- An earlier bounded three-role soak reached 294 successful unique bets before
  its 20-failure guard stopped it: 19 failures were pre-send safe-window
  timeouts and one was a confirmed revert. No duplicate transaction or nonce
  was recorded. The canary now permits the next bet to atomically advance the
  same expired empty epoch after a revert, without enabling paid empty resolves.
  Confirmed receipt reverts are now also recorded as `contract-revert` rather
  than `unknown`. Logic and TypeScript checks pass.
- The runtime monitor supports Telegram and an optional Resend email channel.
  The local monitor drill proves alert/recovery delivery and retry behavior
  without a provider request. White Paper contract cards use the active public
  configuration instead of stale literals; logic, typecheck, and local
  responsive smoke pass.
- A public HTTPS probe of both `playlore.xyz` and `www.playlore.xyz` currently
  fails certificate/SNI validation. This is a DNS/CDN/certificate blocker for
  final-origin Privy and true-device mobile validation, not an application
  runtime failure.
- Leaderboards now disables its native cache-refresh timer while the document
  is hidden and resumes through its existing TTL-aware hook when visible. Its
  visible behavior is unchanged. Focused lint, business logic, typecheck, and
  production build pass.
- The recent-wins ticker no longer keeps a three-minute native polling loop in
  hidden tabs. Hiding the page cancels its timer and in-flight request; returning
  resumes the existing cache-aware 45-second visible cadence. Pool-chart and
  live game-state polling are unchanged. Focused lint, business logic,
  typecheck, and production build pass.
- Chat Profile now uses the shared dialog focus trap instead of maintaining a
  second keyboard implementation. The shared hook supports an explicit initial
  focus target, preserving focus on the profile-name field as well as Tab
  wrapping, Escape dismissal, and opener-focus restoration. Focused lint,
  business logic, typecheck, production build, and responsive browser smoke
  pass.
- Analytics deposit and jackpot-history refreshes now stop completely while
  the browser tab is hidden and resume through their existing cache-aware
  hooks when it becomes visible. The visible 30-second deposit cadence and the
  live pool-chart cadence are unchanged. Focused lint, business logic,
  typecheck, and production build pass.
- The first-visit tutorial now keeps every visible action at a 44px minimum
  touch height. Responsive browser smoke opens it in a clean 390px mobile
  context, checks all visible touch targets, and verifies Escape dismissal.
  Business logic, focused lint, typecheck, production build, and the full
  responsive browser smoke pass.
- Notifications use one live region per message: danger notices are assertive
  alerts, while informational, success, and warning notices remain polite
  statuses. Adding a notice no longer re-announces the entire stack, and every
  dismiss action has a stable 44px target. Business logic, focused lint,
  typecheck, and production build pass.
- Exact commit `963b6c90` passes a detached clean-checkout reproduction without
  a copied `.env`: `npm ci`, production dependency audit, wallet peer
  integrity, business logic, V9 invariants, optimizer/Osaka compilation
  provenance, typecheck, production build, and the full responsive browser
  smoke. The temporary server stopped, and the isolated worktree was removed
  after verification.
- Production dependency audit again reports zero high or critical advisories.
  The only required package change is a scoped `brace-expansion` 5.0.7
  override beneath the Sentry `glob` chain and the existing TypeScript parser
  chain; Privy/wagmi/viem versions and peer resolution are unchanged. Business
  logic, V9 invariants, focused lint, typecheck, wallet peer integrity, and the
  production build pass.
- Responsive smoke now scans every visible mobile control on the Hub,
  Analytics, Safety Pool, and Leaderboards against the 44px touch-target floor.
  The expanded coverage fixed the conditional older-epoch Safety Pool action
  and the Leaderboards retry/refresh actions. Typecheck, focused lint,
  production build, and the complete browser smoke pass; pool-chart freshness
  remains covered and the temporary server was stopped.
- Chat profile accessibility smoke now exercises initial field focus,
  reverse-tab containment, Escape close, and focus restoration to the opener.
  The profile and chat close icon controls are also measured at a minimum 44px
  touch target. Typecheck, focused lint, production build, and the full
  responsive browser smoke pass.
- The jackpot result overlay close control also meets the 44px touch-target
  floor; focused type and lint checks pass.
- Chat header controls cannot flex-shrink below their measured 44px target, and
  Analytics refresh controls use the same floor. Mobile Analytics measurement,
  typecheck, production build, and responsive browser smoke pass.
- Mobile Analytics now has a complete visible-control 44px scan. The scan found
  and fixed the undersized history-load action and no longer retries away an
  accessibility assertion failure.

- Versioned route-cache cleanup is ownership-aware for both request builds and
  background refreshes. An invalidated older promise cannot remove a newer
  registered promise; the overlapping-build regression test, business logic,
  TypeScript, and focused ESLint pass.
- All direct shared-cache callers in epochs, rewards, rebate discovery, reward
  summaries, and data-sync health also release only their own registered
  request or refresh promise.
- Post-change production build, SQLite operations, monitoring alert/recovery,
  and responsive browser smoke pass; no test server was left running.

- Exact commit `00ba0570` passes a detached clean-checkout reproduction:
  lockfile install, wallet dependency-tree integrity, typecheck, business
  logic, V9 invariants, and production build without a copied `.env`. The
  temporary worktree was removed.
- The latest local hardening candidate passes V9 invariants, production build,
  full responsive browser smoke, and all HTTP checks with the documented
  local-only identity fixture. A preceding no-fixture HTTP run correctly failed
  closed at 503 and the temporary server was stopped.
- Exact commit `3bc812e` passes a detached clean-checkout reproduction: `npm ci`,
  wallet peer integrity, full lint, typecheck, business logic, V9 invariants,
  optimizer/Osaka compilation provenance, SQLite operations, monitoring alert
  and recovery drills, production build, and responsive empty-DB browser smoke.
  The temporary server and detached worktree were removed afterward.
- Exact commit `23e611f` passes an isolated clean-checkout reproduction:
  lockfile install, wallet peer integrity, typecheck, logic, contract invariants,
  compile provenance, production build, all 23 HTTP checks, and responsive
  browser smoke. The local-only weak-identity fixture was required for smoke;
  without it the production limiter correctly failed closed. Temporary runtime
  files and the copied `.env` were removed after verification.
- The Next.js 16 security boundary now uses root `proxy.ts`. The prior nested
  `app/middleware.ts` was not part of the production request pipeline, so its CSP
  and hardening headers were absent. Production build now lists Proxy, HTTP smoke
  requires the CSP/clickjacking/MIME/referrer/permissions headers, and full
  browser smoke passes with the policy enforced.
- Wallet Settings uses the shared hardened dialog focus trap, including hidden
  control filtering, escaped-focus recovery, Escape handling, and opener focus
  restoration. The focused lint, business-logic, typecheck, and diff gates pass.
- Safety Pool history can load older indexed participation in explicit bounded
  pages. Routine refresh remains capped, each page is one atomic multicall, and
  discovered overflow epochs join visible balances and claim planning without
  duplicate accounting. Full lint, logic, typecheck, contract invariants,
  production build, HTTP smoke, and responsive browser smoke pass on the local
  snapshot; the no-identity HTTP run separately remained fail-closed at 503.
- A funded managed soak exposed three receipt timeouts from one role. Those
  transactions were broadcast even though the old evidence path labeled them
  pre-send, so the supervisor was stopped with six successful unique bets and
  no duplicate hashes/nonces or confirmed reverts. The canary now preserves
  post-send hash/nonce evidence and blocks new sends whenever pending nonce is
  ahead of latest nonce. Transaction-free preflight enforces the same guard.
  Logic, TypeScript, focused ESLint, and a real zero-transaction dry-run pass;
  the dry-run correctly reports the remaining pending nonce queue.
- Malformed SQLite/indexer values use bounded fixed warnings and no longer
  interpolate the rejected payload or parser error. A focused regression test
  proves that an injected sensitive marker is absent from `console.warn`.
  Mainnet runtime validation also requires the effective diagnostics, chat,
  admin, and bootstrap-resolver secrets to contain at least 32 characters.
  Storage, logic, TypeScript, focused ESLint, and diff hygiene checks pass.
- Global render-error fallback logging and the browser `console.error`
  interceptor sanitize normalized values before direct console output. This
  uses the existing support-log redaction rules and leaves chunk/session
  recovery behavior unchanged. Logic, TypeScript, and focused ESLint pass.
- Safety Pool claims suppress split/single fallback after user rejection or any
  post-submit confirmation uncertainty; only a proven revert can enter the
  salvage path. Bootstrap resolve also denies production sends when its SQLite
  coordination lock is unavailable, while retaining the memory throttle only
  for development. Logic, TypeScript, and focused ESLint pass.
- Shared SQLite write, rollback, and cleanup errors sanitize their operational
  name/message before console output. Indexer storage, logic, TypeScript, and
  focused ESLint pass.
- Exact commit `02e3660` passed a detached clean-checkout reproduction: lockfile
  install, wallet dependency integrity, production audit, lint, typecheck,
  business logic, contract invariants, compile provenance, SQLite operations,
  monitoring drill, production build, and full responsive browser smoke. The
  temporary server and worktree were removed after verification.
- Browser baseline reports now expose an explicit `quality` verdict. Failed
  local HTTP responses, local network failures, or local console errors mark a
  run `degraded`, while third-party-only failures remain separately visible.
  Focused 10-second drills reproduced both `pass` and `degraded` outcomes.
- A five-minute local production-browser profile completed with zero failed
  local responses, no local console errors, a negative final JS heap delta, and
  one additional DOM node. Same-origin polling averaged 16.6 requests/minute;
  the intentionally fresh `/api/live-state` path accounted for 12/minute while
  chat, recent wins, and global stats remained bounded. See
  `docs/testnet-browser-profile-2026-07-18.md`.
- A fresh 2026-07-17 baseline passed typecheck, logic, contract invariants,
  production build/start, focused desktop/tablet/mobile browser smoke, lint,
  monitoring, SQLite operations, exact contract compilation, dependency audit,
  and local launch proof L1-L14.
- The local proof fixture now emits the supported `single` bet mode instead of
  the obsolete generic `bet` label; strict testnet canary validation and the
  complete local launch preflight pass again.
- The PM2 process model now includes non-looping scheduled jobs for the existing
  integrity-checked SQLite backup command and bounded chain/indexer audit. A
  scheduler-style backup passed integrity checking, and a fresh 50-epoch
  read-only audit completed with zero mismatches.
- Scheduled chain/indexer output is replaced atomically through a PID-scoped
  temporary file, preventing the monitor from reading truncated JSON during a
  cron run. The post-fix 50-epoch audit and regression guard pass.
- The audit also accepts a validated `--end-epoch` bound for reproducible
  historical checks. After indexer repair catch-up, both the exact prior
  50-epoch window and the latest 50 resolved epochs pass with zero mismatches.
- Current SQLite operations and monitoring drills pass, including backup/restore
  integrity, WAL/read-only/corrupt/disk-full cases, alert recovery, and restart
  deduplication. Production dependency audit has zero high or critical findings,
  and local launch proof preflight L1-L14 passes.
- Scheduled backups support an explicit bounded retention window. It is off
  unless `LORE_BACKUP_RETENTION_DAYS` is set and then removes only old regular
  files matching the generated backup filename in the selected directory. The
  fault drill preserves recent, excluded, unrelated, and non-matching files.
- Runtime monitoring now checks bounded backup-directory metadata using
  `LORE_BACKUP_DIR` by default. Missing, stale, invalid, and unavailable backup
  states alert; a fresh backup produces a deduplicated recovery. The expanded
  restart drill passes 10 alerts and 10 recoveries with no duplicate delivery.
- Final restore proof now rejects backup schedule evidence that only proves a
  scheduler exists. It also requires a positive retention window, an ISO
  `lastSuccessfulBackupAt`, and artifact-backed evidence that mentions the
  latest successful backup plus retention/pruning policy. Future-dated or
  retention-expired latest backup timestamps are rejected.
- Final restore proof also requires restore-drill evidence to include restored
  SQLite `integrity_check` proof; a generic successful restore summary is not
  enough for launch evidence.
- Launch/testnet canary proof now requires successful role coverage for
  `MANUAL`, `AUTOMINER_A`, and `AUTOMINER_B` in addition to aggregate
  auto-miner epoch counts. The bounded V10 gas matrix profile remains exempt so
  it can stay a focused compiler/selector gas harness.
- A fresh 50-epoch read-only audit correctly failed while the local indexer was
  stale, then passed with zero mismatches after one bounded catch-up plus
  repair/reconcile run. This verifies both alert value and operational recovery.
- During the active soak, a fresh one-shot indexer catch-up ingested 25 live
  bets/epochs while the production server remained healthy. The following
  50-epoch chain-to-indexer audit passed with zero mismatches across bets,
  resolves, jackpots, resolver rewards, rewards, claims, fees, and rebates.
- A later live catch-up exposed and fixed an auditor-only epoch-boundary bug:
  `ResolverRewardAccrued` is now constrained to the selected epoch window while
  epochless resolver claims remain block-scoped. The reproduced 50-epoch window
  now has exactly 50 resolver accruals and zero mismatches.
- A fresh local-only production load handled 4,459 requests in 10 seconds with
  zero unexpected failures; expected rate-limit responses remained separated
  from errors, `live-state` p95 was 110 ms, and total p95 was 715 ms.
- Contract, logic, TypeScript, production build, HTTP, desktop/mobile browser, and focused RPC-recovery checks have passed on the recorded candidate state.
- Manual betting through the active Privy embedded wallet has been observed on-chain without a MetaMask confirmation for the bet itself.
- The 50-epoch Sepolia canary completed with unique epochs, varied wallets/methods/amounts/tile counts, successful resolves, and no failed bets, nonce gaps, duplicate sends, or gas-estimate fallbacks.
- Selected direct chain-to-indexer comparisons matched, indexer restart/reconcile found no missing epochs, and public runtime/data-sync health was healthy in the recorded checks.
- Empty epochs intentionally do not require keeper spending; the next bet can atomically advance an expired empty epoch. Non-empty expired epochs still require the monitored keeper.
- Pool-chart freshness is preserved. Hidden or inactive work is reduced without slowing the visible live-state behavior.
- Browser, server, and edge Sentry paths share recursive redaction for wallet, RPC, auth, URL, and transaction-like data.
- `@sentry/nextjs` is updated from 10.56.0 to 10.66.0 without changing the
  Privy/wagmi/viem versions. Its OpenTelemetry core moved from 2.7.1 to 2.9.0,
  removing the W3C baggage memory-allocation advisory. Wallet dependency
  integrity, typecheck, logic tests, production build, and all 23 HTTP smoke
  checks pass on the updated lockfile.
- A post-update 30-second production browser profile with the documented
  local-only rate-limit identity reported zero failed local responses, zero DOM
  growth, a negative final heap delta, CLS 0, horizontal overflow 0, and a 24 ms
  synthetic interaction. The remaining CSP console messages came from the
  external Privy origin rather than the application response.
- Browser baseline reports now split console errors by local, external, and
  unknown target while preserving the total and kind counts. A focused 10-second
  production run verified the new field with zero console errors and zero failed
  local or external responses.
- Exact commit `82d8d4a` passed a separate local clean-checkout CI reproduction:
  `npm ci`, wallet peer integrity, production dependency audit, lint, typecheck,
  logic and contract tests, compilation provenance, SQLite and monitoring
  drills, production build, and the full responsive browser smoke. The first
  install attempt hit a transient `ECONNRESET`; one clean retry succeeded. The
  temporary worktree and production server were removed afterward.
- A subsequent fresh read-only chain/indexer audit over epochs 417-466 matched
  50 resolves, 45 bets, and 45 resolver reward accruals with zero mismatches.
  No transaction was sent.
- Testnet SQLite backup, integrity, restore, catch-up, and restart/reconcile drills passed without modifying the active database.
- The current production bundle retains lazy boundaries for non-critical views; the wallet/session code remains eager for reliable recovery.
- Bundle measurement now targets the current completed `.next` output by
  default and records `BUILD_ID` completion time instead of silently reading a
  potentially stale isolated build.
- Pending manual bets survive reload/tab recovery without duplicate sends, and
  the focused browser guard passes.
- Pending recovery uses independent actor+chain+contract storage keys, so account
  switches neither inherit nor overwrite another wallet's pending recovery;
  typecheck, logic tests, production build, and focused browser smoke pass.
- Trusted proxy identity, optional shared external rate limiting, support-log
  redaction, and persisted runtime alert deduplication/recovery are covered by
  logic tests and a local delivery drill.
- Central server/Sentry/support redaction also removes bare 64-hex secrets,
  assignment-style credentials, and JWT values embedded inside error text;
  explicitly allowlisted public transaction hashes remain available in support
  exports.
- Production-mode API rate limits now fail closed when trusted proxy identity is
  unavailable. A clearly named weak-identity bypass exists only for local/CI
  production smoke and the mainnet runtime validator rejects it.
- Every JSON write-route now uses a shared streaming byte cap before parsing.
  Oversized chat, auth, admin-control, and rewards requests return 413 instead
  of allowing one request to consume unbounded server memory.
- Contract model fuzz now also covers 5,000 Safety Pool distributions across
  1-25 losing participants, verifies aggregate rebate conservation, excludes
  winning-tile participants, and exercises a safe `uint128` arithmetic edge.
- A 15-minute production long-tab profile collected 31 heap/DOM samples. DOM
  stayed at 482 nodes, heap fell from 36.3 MB to 19.2 MB with no higher sampled
  peak, and no local API response failed. Live-state remained at 12 requests per
  minute so the pool chart freshness was preserved; no polling reduction was made.
- A fresh read-only chain-to-indexer audit matched all 89 available resolved
  testnet epochs with zero mismatches, including bets, jackpots, rewards, batch
  claims, resolver rewards, and rebates. No fee flush exists before epoch 120.
- The shared external limiter test now exercises concurrent consumers against
  one stateful bucket: two requests pass a limit of two and the third is
  rejected. Real two-replica Upstash/proxy evidence remains a staging check.
- Trusted proxy identities now accept only bounded valid IPv4/IPv6 values;
  malformed authenticated headers fall back to the existing production
  fail-closed path. Persisted monitor state also rejects oversized files,
  keys, and messages. Logic, monitoring, typecheck, lint, and build pass.
- Support-log export now includes a whitelisted persisted Auto-Miner snapshot
  (phase, progress, run parameters, error kind, stop reason, latest confirmed
  epoch, retry count, and timestamp). Submitted standard bets add a sanitized
  public tx hash and known nonce to the support log without wallet identity.
  Raw provider errors remain excluded and the complete metadata object is
  passed through the existing secret/address/URL sanitizer before download.
- Wallet Settings keeps support-log export available on mobile as an accessible
  icon button instead of hiding the action below the `sm` breakpoint. Focused
  logic/lint, production build, and the full responsive browser smoke pass.
- A fresh full-history chain-to-indexer audit matched bets, epochs, jackpots,
  rewards, batch claims, resolver rewards, fees, and rebates with no mismatch.
- Isolated SQLite WAL/checkpoint/backup/read-only/corruption/disk-full drills pass.
- The active testnet SQLite database was backed up and its obsolete contract scopes were removed after a read-only audit. A cleanup guard now preserves the active DB, WAL, and SHM artifacts; the final audit has no foreign scopes, stale metadata, or legacy rows.
- The post-cleanup production build, HTTP smoke, responsive/debug browser smoke, and 60-second local load pass. The load produced zero unexpected failures at 630.9 requests/second; live-state p95 was 59 ms while bounded APIs returned expected 429 responses under saturation.
- A 30-second production load handled 23,073 requests with no unexpected
  failures; a ten-minute browser observation showed no DOM or heap growth signal.
- The fresh ten-minute profile retained zero horizontal overflow, stable DOM,
  heap -9.5 MB, 16.5 same-origin API requests/minute, and 12 visible `live-state`
  requests/minute. Its CSP/resource console samples were all classified as
  external wallet/auth sources, so the application CSP was not weakened.
- The load runner now reports cold first-request latency separately and covers
  global stats, fails on any cold-route error, and enforces per-route thresholds;
  a local production smoke handled 2,236 warmed requests in five seconds with
  zero unexpected failures and 117 ms total p95.
- Full desktop/tablet/mobile smoke and debug Auto-Miner failure-state scenarios pass.
- Browser smoke now also proves that the pool chart changes after a fresh
  same-epoch live-state snapshot; empty-pool mounting and intentional polling
  frequency remain unchanged.
- The main content landmark now follows the active section for screen readers;
  focused production browser smoke passed keyboard focus, accessible names,
  reduced motion, mobile geometry, wallet selector, chart, and empty-state guards.
  It also rejects visible enabled mobile controls smaller than 44 by 44 CSS pixels.
- Manual-bet and auto-miner phase transitions now have polite screen-reader
  status announcements without announcing frequent progress counters. Mobile
  Wallet Settings section controls expose selected state, a 44px touch target,
  and visible keyboard focus; typecheck, logic, contract, production build, and
  the full responsive browser smoke pass on this state.
- Contract properties now cover 10,000 randomized fee/rollover cases, 10,000
  bitmap cases, 2,000 reward distributions, all 25 tiles, and claim/resolve guards.
- Solidity compilation keeps historical V9 pinned to 0.8.34 and active V10
  pinned to 0.8.36, both with optimizer 200 and Osaka; each tracked
  source/ABI/bytecode manifest reproduces exactly in the local gate.
- CI now runs logic, V9 and active-V10 contract invariants, both canonical
  compilation provenance checks, SQLite, monitoring, build, production browser,
  and high/critical dependency checks from the lockfile instead of relying on
  ignored local ABI/BIN artifacts. Both provenance JSON files are retained as
  workflow artifacts.
- Published commit `e7a75b4` reproduced those gates from a detached clean
  checkout after `npm ci`. Its isolated empty-DB production runtime also passed
  all 23 HTTP checks and the responsive browser smoke; the first jackpot read
  completed in 340 ms and `fresh=1` in 15 ms.
- A subsequent 30-second weighted production load completed 11,385 requests at
  378.4 requests/second with zero unexpected failures. Aggregate p95/p99 were
  816/1,092 ms, live-state p95 was 114 ms, and jackpot p95 was 121 ms. Expected
  429 responses remained separated from errors and did not throttle homepage or
  live-state freshness.
- Clean-checkout GitHub Actions run `29634688258` passed all of those gates on
  published commit `129314f`, including wallet dependency peer integrity and
  production browser smoke.
- Online SQLite backup and stale-scope dry-run are now explicit operator commands;
  both require a caller-selected source and the dry-run is strictly read-only.
- A corrupt SQLite cold start now fails before Next.js opens its listener, while
  a missing/empty new DB path remains allowed for normal initialization.
- Continuous indexer mode now exits after a bounded number of consecutive full
  watch-cycle failures so PM2 can restart a persistently degraded process. A
  successful cycle resets the counter; the default threshold is five.
- Authorized runtime health now exposes process memory/uptime and private
  data-sync health exposes SQLite/WAL/SHM sizes for soak trend collection;
  public responses redact all new fields. Typecheck, logic, lint, build, HTTP
  smoke, and focused authorization/redaction checks pass. The earlier stale
  local indexer was caught up and its repeated 50-epoch audit now passes.
- Runtime monitoring can optionally alert on RSS and SQLite WAL byte thresholds;
  both remain disabled unless explicitly configured. The persisted restart drill
  passes threshold and bounded-canary-log reverted-series alerts with zero
  duplicates after restart and matching recovery notifications.
- Runtime monitoring can also consume the bounded output of a separately
  scheduled chain/indexer audit. Mismatch, stale, invalid, oversized, and
  unavailable artifacts alert without putting chain scans in the 30-second
  health loop; fresh pass output produces a deduplicated recovery.
- On 2026-07-18 that audit detected a stale local indexer in a real 50-epoch
  window. The normal one-shot catch-up restored the missing rows, and the repeat
  audit passed over epochs 417-466 with 50 resolves, 45 bets, 45 resolver
  rewards, and zero mismatches.
- A fresh isolated SQLite cold start then indexed 1,386 logs across 131,125
  blocks from the current deployment. Reconciliation and the 50-epoch audit
  passed before and after an immediate restart, with no duplicate or mismatched
  indexed records.
- A clean production-site cold start with a new SQLite path passed all 23 HTTP
  checks. An invalid DB path failed before the listener opened. With an
  unreachable primary RPC, configured fallback recovered and homepage,
  live-state, health, leaderboards, chat, and global stats all returned 200;
  live-state completed in 26 ms and data-sync in 366 ms.
- Empty jackpot storage no longer blocks `/api/jackpots` on a synchronous
  historical RPC scan. It returns an explicit empty/stale payload and starts the
  existing deduplicated background recovery. A fresh isolated-DB production run
  returned 200 in 231 ms for the initial request and 15 ms for `fresh=1`, then
  passed all HTTP and responsive browser checks without weakening pool-chart
  freshness.
- Non-empty `fresh=1` recovery is also bounded: the route waits at most two
  seconds, then returns stored/cache data while the existing deduplicated RPC
  promise continues. A never-resolving RPC failure injection proved the stale
  fallback, while the healthy production request returned 200 in 375 ms.
- Published commit `188fea1` reproduced the full lockfile/dependency, lint/type,
  logic/contract/provenance, SQLite, monitoring, production build, HTTP, and
  responsive browser gates from a detached clean checkout. The checkout stayed
  clean and its temporary runtime was stopped.
- Production proxy identity fails closed for missing/wrong proxy secrets and
  malformed forwarded IPs. The local drill enforced the configured 30-request
  limit per trusted IP, kept a second IP independent, and grouped different
  User-Agent values behind the same NAT/IP into one bucket.
- Empty-DB health semantics are explicit: runtime remains available, while the
  public redacted data-sync response reports `degraded`, no last indexed block,
  and the missing-epoch count.
- A real online backup of the current testnet DB was restored from the generated
  backup artifact into a separate external path. Both copies passed integrity,
  and their 15-table schema, 963 row counts, and hashed indexer metadata matched.
- Live canary output now records a final summary event. Optional monitor stale
  detection alerts when an unfinished soak stops producing events without
  treating an intentionally completed zero-failure log as stale.
- `next` and `eslint-config-next` are now pinned to 16.2.12 instead of 16.2.6.
  The later dependency refresh keeps the production audit clear of high/critical
  advisories while the full dev-scope audit uses the documented ESLint/minimatch
  exception.
  The full local `npm run check` passed on the upgraded production runtime,
  including all HTTP checks and responsive desktop/mobile browser smoke. Its
  managed server stopped and port 3101 was closed.
- The local check harness opts into weak rate-limit identity only in the
  environment of its managed build/server child processes. Production
  validation still rejects that flag, and the harness now refuses to start if
  its smoke origin is already served by a stale process.

## Accepted Limitations

- The public testnet runbook and `.env.example` now describe the V10 cutover
  requirements, while `.env.local.example` carries the current Sepolia V10
  address/block pair. Previous V9 canaries remain explicitly historical and
  are not presented as proof for the current V10 candidate.
- A fresh 60-second local production-build HTTP load run completed 38,558
  requests at 642.2 requests/second with zero failures, p95 520 ms, and p99
  708 ms. This is local evidence only, not the required HTTPS canary proof.
  Rate-limited endpoints returned expected 429 responses while `live-state`
  remained unthrottled and responsive.
- A fresh production process correctly returned 503 for protected endpoints
  without trusted client identity. With the documented local-only weak-identity
  bypass, all 23 cold HTTP smoke checks passed. A prior 31-second `deposits`
  response did not reproduce and therefore was not patched speculatively.
- The earlier wallet/mobile and Auto-Miner rerun waiver applies only to the
  historical V9 candidate. Current V10 has responsive and browser-smoke
  evidence; true-device HTTPS signed-wallet coverage remains open.
- Existing evidence must not be presented as a fresh rerun.
- Responsive mobile coverage is recorded; true-device HTTPS wallet coverage remains a deployment-stage check.
- Local proof tooling passing does not satisfy mainnet G1-G14 evidence.
- The repository workflow runs on every branch push, but the available GitHub
  connector exposes only pull-request-triggered runs. The current commit therefore
  has complete local clean-checkout evidence but no connector-readable remote run.
- The current registry-backed production dependency audit reports zero
  high/critical advisories. The all-dependency audit permits only the documented
  known dev-only ESLint/minimatch high advisory exception and still blocks any
  unexpected high/critical advisory. Keep the pinned Privy/wagmi/viem peer set
  until a separately tested compatible release is proven by `proof:wallet-deps`,
  typecheck, logic, contract gates, build, and browser smoke.
- CI now runs production-only and all-dependency audits after clean install and
  wallet peer validation. Production high/critical findings remain hard
  blockers; the dev-toolchain exception is tracked separately until the Next
  ESLint plugin chain supports a patched path.
- A production-build axe pass now covers desktop Hub, Analytics, Safety Pool,
  Leaderboards, White Paper, FAQ, and mobile Hub. Confirmed Analytics contrast
  and keyboard-scroll violations were fixed; the repeated seven-view audit has
  zero violations, and the full responsive browser smoke still passes.

## Follow-Ups

- Monitor the shared testnet runtime and investigate only new regressions.
- Validate the shared limiter with real external-store credentials across two replicas.
- Configure an explicit stable RPC environment value before the final strict
  chain proof. A fresh fallback-only read completed without detected issues,
  but `proof:chain -- --strict` correctly rejects built-in public RPCs and must
  not be promoted as strict evidence.
- Validate HTTPS Privy and true-device mobile Web3 flows on the final origin.
- Validate real monitoring delivery/recovery and schedule operational backups.
- Configure a Resend API key and verified sender before treating
  `playlore88@gmail.com` email alerting as live.
- Keep the prior soak stopped. Complete the remaining bounded V10 live claims,
  explicit fee flush, and signed failure-path receipts before authorizing a new
  managed soak. Local and read-only admin simulation already passes.
- Restore a bounded test-account allowance only immediately before the final
  transaction-free `gate:contract:v10:predeploy` gas refresh. Until then, use
  the green external-review gate for semantics and retain the existing mined
  V9/V10 receipts as historical gas evidence; do not call the blocked gas gate
  green. The benchmark's redacted role-level readiness output now identifies
  the missing prerequisite without weakening this fail-closed boundary.
- The Privy/wagmi peer mismatch is resolved by pinning the root `viem` to the
  exact `2.50.4` required by `@privy-io/wagmi@4.0.9`. A clean `npm ci`, clean
  `npm ls`, typecheck, logic tests, contract invariants, compilation provenance,
  production build, and responsive browser smoke pass. CI now runs the same
  wallet dependency peer-integrity check immediately after `npm ci`. Real signed
  Privy wallet connect/rejection/pending recovery still requires the HTTPS
  testnet flow.
- Run the soak only through the existing durable supervisor and retain its
  compact status and canary evidence; never start a second supervisor.
- Keep stale contract-scope cleanup tied to the verified SQLite backup/restore runbook.
- Require an explicit product decision before changing idle-epoch economics or keeper behavior.

## Evidence Index

- Testnet readiness: [`docs/testnet-readiness.md`](testnet-readiness.md)
- Direct chain/indexer comparison: [`docs/testnet-indexer-chain-comparison-2026-07-10.json`](testnet-indexer-chain-comparison-2026-07-10.json)
- Signed revert evidence: [`docs/testnet-signed-revert.json`](testnet-signed-revert.json)
- Mainnet status board: [`docs/mainnet-status-board.md`](mainnet-status-board.md)
- Durable work log: [`docs/agent-progress.md`](agent-progress.md)

## Next Best Step

Finish the remaining bounded V10 post-deployment matrix before any soak. The
first live `resolveEpoch(7)` tranche is complete. The fresh summary-only
post-receipt planner identifies a separate seven-transaction upper bound:
batched eligible claims for configured roles, one eligible resolver claim, and
one explicit fee flush, with 566,008 total estimated gas and 0.793125 LINEA
planned transfers. The latest compact read-only planner check passed after the
public-address parser hardening and reported the same bounded claim/flush
phase. None of those calls is authorized yet; rerun the planner
immediately before any separately approved tranche and execute at most its exact
per-call limits. Keep
stale/closing/expired-funded and admin/timelock checks read-only until separately
authorized. The current Remix deployment has an executable
runtime match but a metadata-only provenance mismatch; the eventual canonical
candidate must be redeployed from the exact manifest source-unit layout and
pass the strict full-bytecode/deployment-input verifier. After that, run the
durable 24-48 hour V10 soak. Keep mainnet work paused.

The current production dependency audit is green with zero high/critical
advisories. The full dev-scope audit passes only with the documented known
ESLint/minimatch toolchain exception; production high/critical findings remain
hard blockers. Remaining deployment-dependent checks include HTTPS Privy/true-mobile
recovery, real alert delivery, shared limiter validation, scheduled backup
execution, and final G1-G14 evidence collection.

## 2026-07-26 Local Hardening Update

- Chat profile/send, rebate cache, reward scan cache, and deposit history cache
  now normalize wallet addresses through the EVM address parser before local
  cache/API use.
- Chat unread counters and ownership styling also use the shared address
  normalizer before comparing message senders.
- Analytics achievement cache keys now use the same parser and ignore malformed
  local wallet input.
- `/api/rewards` and reward summary cache/chain reads now normalize user
  addresses with `getAddress`, aligned with the other reward/rebate endpoints.
- Header wallet copy/explorer controls now have explicit accessible names.
- Pending mining tx reload recovery canonicalizes contract/actor addresses
  before storage-key comparison.
- Privy embedded/external wallet selection canonicalizes addresses before
  signer comparison and fallback display.
- Chat auth refresh, deposit history request/cache state, and Wallet Settings
  resolver reward row comparisons now use canonical EVM addresses.
- Recent wins and leaderboards now skip malformed stored/logged user addresses
  after EVM parser validation.

## 2026-07-28 Local Hardening Update

- The legacy sound-muted preference now removes invalid localStorage values
  instead of preserving stale bad UI state across reloads.
- Chat auth session restore now removes cached entries whose embedded wallet
  address does not match the requested wallet storage key.
- Wins ticker hover text now uses the same shortened wallet label as the
  visible chip, avoiding unnecessary full-address exposure in UI tooltips.
- Leaderboard row hover text also uses shortened wallet labels instead of full
  addresses.
- Mainnet production runtime validation now rejects malformed/zero block
  numbers for indexer/deploy block config and validates the keeper RPC as a
  real HTTPS URL.
- Mainnet production runtime validation now also rejects local/private,
  reserved, example, and test `NEXT_PUBLIC_SITE_URL` origins; mainnet must use
  a public HTTPS origin such as `https://playlore.xyz`.
- Mainnet env proof collection now matches that public-origin policy and
  rejects zero deploy blocks, so weak synthetic env values cannot become launch
  proof.
- Mainnet env proof collection now also checks runtime-critical secret lengths,
  admin wallet shape, keeper key 64-hex shape, web replica count, and external
  fail-closed rate limiting for multi-replica web deployments without printing
  secret values.
- Launch evidence validators and draft/plan generators for host, monitoring,
  and QA now use the same public-origin policy, so localhost/private/example
  origins are rejected before proof promotion.
- The shared proof collector helper and restore proof draft/validator also use
  that policy, keeping backup/restore launch evidence aligned with the same
  public-origin requirement.
- Runtime and proof origin validators now also reject single-label hosts such as
  `https://playlore`, keeping Privy and launch evidence tied to an exact public
  HTTPS origin.
- Production health/load and restore verification helpers now use the same
  exact-origin policy; restore verification rejects path/query/hash URLs instead
  of accepting any HTTPS URL on a public-looking host.
- `health:prod` and `load:http` now apply that same origin rejection before
  launch evidence collection; local smoke remains available only through the
  explicit `*_ALLOW_LOCAL=1` opt-in.
- Operator-facing proof, health, load, host, monitoring, QA, and restore CLI
  messages now describe the stricter requirement as a `public HTTPS origin`,
  matching the actual localhost/private/reserved/example/test rejection policy.
- Browser smoke now fails closed on generic JavaScript syntax errors instead
  of ignoring `Invalid or unexpected token`. The latest local UI-only browser
  smoke passes without ignored page errors.
- Wallet repair, resolver reward claim, Safety Pool claim, deposit history,
  jackpot history, leaderboard, and chat verification failure states now use
  classified safe user copy instead of raw provider/RPC/API error text.
- Header login failures now also classify timeout/cancel/generic wallet errors
  locally instead of surfacing diagnostic error details from `formatUnknownError`.
- Shared client JSON parsing now reports malformed API JSON with a fixed
  `"Invalid JSON response"` error instead of including a raw response-body
  prefix that could leak backend text into UI/log paths.
- Privacy Policy now accurately describes wallet-first sign-in plus optional
  Privy email/embedded-wallet flows, updates the policy date to July 2026, and
  uses the public support email instead of a vague contact channel.
- `/terms` now provides a public Terms of Play page with concise entertainment
  game, probabilistic risk, wallet responsibility, fees, availability, and
  contract-controlled unclaimed-settlement disclosures. It is linked from the
  main app shell and White Paper footer, and included in robots/sitemap
  coverage.
- `app/sitemap.ts` now provides a real `/sitemap.xml` for the sitemap already
  advertised by `robots.txt`, covering `/`, `/jackpot-win`, `/privacy`, and
  `/terms`.
  Root metadata, robots, and sitemap canonical origins trim surrounding
  whitespace and strip trailing slashes from `NEXT_PUBLIC_SITE_URL`. Root
  metadata also publishes canonical home and OpenGraph URLs.
- Regression guards cover those safe-copy boundaries so future hook changes do
  not accidentally reintroduce raw wallet/provider messages.
- Manual Bet and Auto-Miner form persistence now clears invalid in-progress
  amount values instead of restoring stale bad localStorage input after reload;
  valid cached values remain chain/contract scoped.
- White Paper Auto-Miner copy now matches the runtime cycle cap (`1-5000`)
  instead of implying unlimited cycles.
- FAQ and White Paper now consistently name the current test network as
  Linea Sepolia instead of generic Sepolia in player-facing copy.
- Sidebar reward claim buttons now keep explicit accessible labels/titles for
  ready and pending states, so compact `Wait...` / `...` UI does not become
  ambiguous to assistive tech.
- Safety Pool rebate claim button now also keeps an explicit accessible action
  label across disabled, pending, normal, and small-claim confirmation states.
- Automatic reward scans now honor the configured bounded 5000-epoch depth
  instead of silently stopping after a small run of empty resolved chunks; stale
  old wins inside the configured window are less likely to be missed.
- Privacy and Terms back-link icons are marked decorative so the accessible
  link name remains clean.
- Privacy and Terms back links now keep 44px mobile touch targets and visible
  focus rings.
- Sidebar Privacy/Terms footer links now also keep 44px mobile touch targets
  with visible focus rings.
- Shared modal focus trapping now skips `aria-disabled` controls and restores
  focus only to an attached, visible, enabled previous element. This covers the
  Wallet Settings, backup gate, first-visit tutorial, chat profile, and jackpot
  modal surfaces without changing wallet/protocol behavior.
- Auto-Miner orphaned tab-lock recovery now clears its ping timeout immediately
  when the owning tab answers, avoiding stale callbacks during repeated
  recovery checks without changing lock ownership, wallet sends, or polling.
- Monitoring proof validation now recognizes `artifact: <file>` references in
  ordinary evidence fields, matching the other launch validators and preventing
  missing alert/monitor artifacts from slipping through a differently named
  field.
- This is local runtime hardening only: it does not change randomness,
  tokenomics, deployed contracts, wallet transaction behavior, or live refresh
  cadence.
- Latest checks: `npm.cmd run check` and `npm.cmd run proof:local` pass after
  the compact V10 planner output, sanitizer hardening, sidebar privacy link,
  and metadata/robots/sitemap normalization changes. The check includes lint,
  logic, fetch-timeout and stored-number parsing tests, both V9 compatibility
  and active V10 contract invariants, indexer storage, SQLite operations,
  runtime monitoring drill, production build, typecheck, HTTP smoke, and
  browser smoke with Auto-Miner retry-wait, session-expired, and pending-bet
  reload/reopen recovery scenarios enabled. After the latest root canonical URL
  jackpot share origin guards, and OpenGraph copy guard, focused ESLint and
  `npm.cmd run test:logic` pass. A later focused pass also covers OpenGraph
  typography and error fallback touch targets. `npm.cmd run typecheck` and
  `npm.cmd run proof:local` pass after the accumulated metadata, share,
  OpenGraph, error-fallback, and Terms of Play changes; strict launch still
  correctly remains blocked on external G1-G14 evidence. `npm.cmd run build`
  also passes for the updated Next metadata, OpenGraph, sitemap, robots,
  privacy, terms, reward-scanner, and error routes,
  with only the known Node SQLite experimental and edge-runtime static
  generation warnings.
  Browser smoke also now verifies the White Paper `Transparent Play` risk
  disclosure so the player-facing risk copy cannot disappear silently.
- Fresh `npm.cmd run gate:contract:v10:local` also passes: compiler provenance,
  active V10 invariants, compiler matrix summary, diagnostics without RPC or
  transactions, offline deployment verifier, V9 invariants, indexer storage,
  logic, typecheck, focused ESLint, and build.
- Fresh read-only `npm.cmd run bench:contract:v10:behavior` also passes when
  run with `V10_BEHAVIOR_TIMEOUT_MS=240000`: no signing or transaction sending,
  95 successful simulated state transitions, 88 expected boundary reverts,
  rollback/reentrancy/admin/fee-flush/epoch-bound checks covered. The default
  90s attempt timed out on RPC latency, so use the explicit bounded timeout for
  this heavier read-only check.
- Fresh `npm.cmd run proof:contract-compiler-advisories:v10` passes for Solidity
  `0.8.36` with zero known compiler bugs in the official Solidity bug database.
- `npm.cmd run proof:wallet-deps` passes for Privy, wagmi, and viem dependency
  resolution. `npm.cmd run proof:deps` passes with zero high/critical
  production advisories.
- Fresh `npm.cmd run proof:wallet-deps` still resolves Privy, wagmi, and viem
  consistently. Fresh `npm.cmd run proof:contract-compiler-advisories:v10`
  reports Solidity `0.8.36` with zero known compiler bugs in the official
  Solidity bug database.
- Fresh `npm.cmd run proof:contract-deployed:v10:offline` passes with no
  transaction sending, confirming local V10 provenance is ready,
  manifest-matched, optimizer 200, no IR, and Osaka. This is still separate
  from external deployed-bytecode/mainnet launch evidence.
- `docs/v10-contract-design.md` now labels production-build API/UI smoke as
  local evidence and keeps fresh external deployed-bytecode, wallet, host,
  monitoring, canary, and long-soak evidence open.
- Focused ESLint and `npm.cmd run test:logic` pass after the shared
  `readJsonResponse` raw-body redaction fix.
- `proof:process-model:summary` now runs the PM2/ecosystem preflight without
  printing the local ecosystem config path or raw config loader errors, and
  `proof:prelaunch:summary` uses that compact command. Focused ESLint,
  `npm.cmd run test:logic`,
  `npm.cmd run proof:process-model:summary`, `git diff --check`, and the full
  compact prelaunch summary pass after the change.
- `proof:files:summary` now runs the proof manifest guard with aggregate
  status/count output only, avoiding proof/canary artifact path details in the
  routine prelaunch loop. Focused ESLint, `npm.cmd run test:logic`,
  `npm.cmd run proof:files:summary`, and the full compact prelaunch summary
  pass after the change.
- `proof:templates:summary` now runs the proof-template rejection guard with
  aggregate template/rejection/issue counts, and `proof:prelaunch:summary` uses
  it for the routine local row.
- `proof:collector-redaction:summary` now runs the collector redaction guard
  with aggregate case/redaction/leak/issue counts, and `proof:prelaunch:summary`
  uses it for the routine local row.
- The compact status sections in `docs/launch-evidence-command-map.md` and
  `docs/production-runbook.md` now list the process-model, proof-template,
  proof-file, and collector-redaction summary commands before the longer proof
  checks.
- `proof:readiness:summary` now runs the readiness checklist guard with
  aggregate check/checked-item/evidence issue counts, hides local path details
  in read failures, and is used by `proof:prelaunch:summary`.
- `proof:launch-map:summary` now runs the launch command map guard with
  aggregate script/doc/proof-file/issue counts, and `proof:prelaunch:summary`
  uses it instead of the long coverage table.
- Full `npm.cmd run check` passes after adding fetch-timeout/stored-number tests
  to the gate and adding the White Paper risk-disclosure smoke assertion.
- Full `npm.cmd run check` also passes after adding `/privacy` to HTTP smoke;
  the route returns the updated privacy disclosure and rejects the stale
  "do not ask for your email" copy.
- Full `npm.cmd run check` also passes after adding `/robots.txt` and
  `/sitemap.xml` HTTP smoke coverage. The latest browser smoke needed one
  built-in reload retry for the isolated mobile Privy selector and then passed;
  keep watching this as a Privy init latency/flakiness signal.
- Fresh full `npm.cmd run check` also passes after the Terms, Linea Sepolia
  copy, form-cache, reward-scan, and legal/rebate/sidebar accessibility
  hardening. The browser smoke covers manual/auto number typography, mounted
  empty pool chart, mobile touch targets, empty states, and pool-chart
  freshness.
- Mainnet launch docs now clarify that G3 is explicit acceptance/sign-off of
  the current non-VRF randomness model for launch, not a requirement to
  redesign randomness before mainnet.
- White Paper now mirrors that boundary: operator acceptance is a launch item,
  while VRF or commit-reveal remains a separate future protocol upgrade
  decision.
- `proof:host-guard` now removes its temporary host-proof fixture manifests
  after validation, so repeated local prelaunch checks do not leave temp
  artifacts behind. The logic guard asserts the cleanup call remains present.
- The mainnet proof strict-fail output guard now also removes its temporary
  workspace after validation, preserving the fail-closed "do not write final
  proof on failed strict env" behavior without accumulating temp directories.
- `proof:collector-redaction:summary` now also cleans up its temporary
  synthetic evidence directories after validation, while preserving the same
  redaction/rejection checks and compact counts.
- `proof:drafts:summary` now tracks and removes its temporary proof draft,
  QA, indexer, monitoring, and restore fixture directories after validation.
  The regression guard still covers 189 draft/strict cases and preserves the
  same compact counts.
- `test:logic` now also removes the temporary host proof fixture directory used
  by its embedded strict host proof regression block after that block completes.
- `proof:drafts:create` now removes the temporary synthetic restore root it
  creates for draft-bundle generation after writing the non-proof draft files.
  Draft generation behavior is unchanged: generated drafts still require real
  external evidence and strict validation before promotion.
- `proof:drafts:create:summary` now generates the same non-proof draft bundle
  while printing only compact draft/written/failed counts instead of local
  output paths. The launch command map and production runbook list it beside
  the full draft command for routine low-noise operator use.
- `audit:chain-indexer:summary` now runs the same read-only chain/indexer
  reconciliation and writes the same configured JSON artifact, but stdout is
  limited to status, network, window, and mismatch counts instead of the full
  proof payload.
- Deposit history localStorage restore now normalizes both legacy array and
  envelope cache payloads before publishing UI data, clears fully invalid
  cache entries, drops malformed rows, and caps restored entries. Verified with
  focused ESLint, `npm.cmd run test:logic`, `npm.cmd run typecheck`, and scoped
  `git diff --check`.
- FAQ accordion, reward scanner, and sidebar navigation buttons now explicitly
  use non-submit button semantics. Focused ESLint, `npm.cmd run test:logic`,
  `npm.cmd run typecheck`, and scoped `git diff --check` pass.
- App shell active-tab restore now clears invalid `localStorage` values before
  falling back to the default tab, preventing stale bad navigation state from
  surviving reloads. Verified with focused ESLint, `npm.cmd run test:logic`,
  `npm.cmd run typecheck`, and scoped `git diff --check`.
- Auto-Miner stable tab id restore now accepts only generated UUID/fallback tab
  ids and removes invalid `sessionStorage` entries before creating a fresh id.
  Focused ESLint, `npm.cmd run test:logic`, `npm.cmd run typecheck`, and scoped
  `git diff --check` pass.
- Safety Pool rebate UI normalization now caps display-only recent/history rows
  before publishing restored cache/API payloads to React state. Claimable epoch
  lists and participating epoch lists are intentionally unchanged. Focused
  ESLint, `npm.cmd run test:logic`, `npm.cmd run typecheck`, and scoped
  `git diff --check` pass.
- Admin ops action buttons now explicitly use non-submit button semantics,
  including refresh/login/verify/logout/process-start/copy-snapshot controls.
  Focused ESLint, `npm.cmd run test:logic`, `npm.cmd run typecheck`, and scoped
  `git diff --check` pass.
- Reward scanner incremental cache revalidation now processes cached wins in
  bounded chunks and honors scan abort/request staleness between chunks. This
  preserves reward results while avoiding one oversized cached-win multicall.
  Focused ESLint, `npm.cmd run test:logic`, `npm.cmd run typecheck`, and scoped
  `git diff --check` pass.
- ABI/indexer compatibility now has a business-logic source guard ensuring
  every financial event explicitly handled by the indexer remains present in
  the shared game events ABI. Verified with focused ESLint,
  `npm.cmd run test:logic`, `npm.cmd run test:indexer-storage`, and scoped
  `git diff --check`.
- `proof:prelaunch:summary` currently reports required local checks passing,
  while 14 launch gates still require external/status evidence across canary,
  chain, env, host, indexer, monitoring, QA, restore, and sign-off groups.
- Added `prelaunch:status:summary` as an operator-facing alias for the same
  compact prelaunch report to avoid command-name misses during readiness runs.
  Verified with focused ESLint, `npm.cmd run test:logic`, and scoped
  `git diff --check`.
- Shared `UiButton` now has a business-logic source guard that its default
  remains `type="button"`, protecting reusable wallet/chat/admin actions from
  accidental form-submit semantics. Focused ESLint and `npm.cmd run test:logic`
  pass.
- Bootstrap resolver keeper-key misconfiguration logging now uses the shared
  redacted route logger instead of direct `console.error`, and `test:logic`
  source-guards that the route does not bypass the route logging boundary. The
  autonomous worklist also avoids active-doc markers for the removed delegated
  wallet experiment while preserving the exclusion boundary. Verified with
  `npm.cmd run test:logic:summary` and `npm.cmd run typecheck:summary`.
- ABI/indexer compact proof output now exposes the exact normalized financial
  event categories checked by storage compatibility:
  `batch_claim`, `dust_settlement`, and `resolver_reward`. The prelaunch
  projection carries the same category list alongside scope isolation,
  idempotency, tx/log-id, and malformed-payload counters. Verified with
  `npm.cmd run test:indexer-storage:summary`,
  `npm.cmd run test:logic:summary`, `npm.cmd run typecheck:summary`, and a
  fresh `npm.cmd run proof:prelaunch:summary` that passed all required local
  rows while preserving 23 external/status blockers.
- A fresh V10 dry-run Preview was regenerated with
  `npm.cmd run preview:canary:v10:dry-run`. The current read-only planner
  reports 7 simulated claim/flush transactions, estimated gas `566008`,
  planned transfers `0.793125` LINEA, pending nonce gap `0`, V10 matrix
  dry-run `plannedBetTx=12`, `plannedStake=0.84` LINEA, and wallet preflight
  `ready=3/3`. The wrapper reports `transactionSent=false`,
  `signingMaterialLoaded=false`, `walletClientCreated=false`, and
  `contractWriteSubmitted=false`; the strict analyzer still blocks G10/G11
  because the dry-run log has zero successful live bet transactions. Cleanup
  autonomous wrapper also removed one allowlisted aged `.tmp` artifact after a
  target-redacted safe dry-run, and the next cleanup dry-run matched `0`
  targets.
- Local production browser performance/UX evidence was refreshed against
  `next start` on `http://localhost:3000`. A first production baseline without
  trusted proxy identity correctly degraded on 503 responses with
  `Trusted proxy identity unavailable`, proving the fail-closed rate-limit
  boundary is active. Re-running the same local-only baseline with temporary
  `ALLOW_WEAK_RATE_LIMIT_IDENTITY=1` produced `quality.status=pass`, no failed
  local responses, no local request failures, no local console errors, FCP/LCP
  `1212ms`, CLS `0`, synthetic INP `24ms`, same-origin API rate `30/min`,
  heap delta `-382970` bytes, and longest task `134ms`. `npm.cmd run
  smoke:browser` then passed desktop/tablet/mobile layout, wallet selector
  modals, first-visit tutorial accessibility, Auto-Miner persistence, chat
  drawer/profile modal, mobile touch targets, 360px overflow, empty states, and
  pool chart freshness. The local server was stopped after the run.
- `docs/browser_automation.md` now documents the exact local production
  browser baseline precondition: first confirm APIs fail closed without trusted
  proxy identity, then use temporary shell-only
  `ALLOW_WEAK_RATE_LIMIT_IDENTITY=1` only for localhost baseline/smoke
  measurement, never as a committed production default or public launch proof.
  `test:logic` source-guards that wording.
- V10 packed accounting and metadata boundary coverage is now visible in the
  compact contract and prelaunch summaries as `packedBoundaryCases=77`. The
  counter covers packed rebate volume/flag round-trips and updates, packed
  epoch clock words, packed jackpot check timestamps, and packed resolution
  timestamp/winning-tile/flag combinations. Verified with
  `npm.cmd run test:contract:v10:summary`,
  `npm.cmd run test:logic:summary`, `npm.cmd run proof:prelaunch:summary`, and
  scoped `git diff --check`. The fresh prelaunch run passed all required local
  rows and preserved 23 external/status blockers; no Solidity source, ABI,
  deployment, randomness, tokenomics, wallet signing, real transactions,
  secret access, or private RPC access was used.
- The lightweight autonomous heartbeat now includes the compact V10 invariant
  row directly. `npm.cmd run proof:autonomous:summary` reports
  `test:contract:v10:summary` as expected-local evidence with
  `protocolFeeFlushCases=7`, `duplicateBatchCases=4`,
  `timelockBoundaryCases=9`, `dustBoundaryCases=19`,
  `packedBoundaryCases=77`, and `accountingCases=20002`, while still keeping
  the deployed-identity mismatch and G1-G14 external blockers visible. Verified
  with `npm.cmd run proof:autonomous:summary` and
  `npm.cmd run test:logic:summary`.
- The same lightweight autonomous heartbeat now also includes
  `test:indexer-storage:summary` as the local ABI/indexer compatibility row.
  Routine `npm.cmd run proof:autonomous:summary` output shows the normalized
  financial event categories `batch_claim`, `dust_settlement`, and
  `resolver_reward`, plus legacy read, pagination, tile-user reconstruction,
  contract/category scope isolation, normalized event scope isolation,
  protocol-fee scope isolation, idempotent event/bet upserts, tx/log-id
  requirements, and malformed-payload fallback. Verified with
  `npm.cmd run test:indexer-storage:summary`,
  `npm.cmd run proof:autonomous:summary`, and
  `npm.cmd run test:logic:summary`.
- Manual bet no-duplicate coverage now includes an executable fail-closed case
  for retryable gas/RPC send errors when the public confirmation baseline is
  unavailable. `runManualMineAttempt` must surface
  `Bet status could not be verified after an RPC error. Wait a moment before
  retrying.`, must not finalize, must not request allowance, must not compute
  bumped replacement fees, and must not call the send path a second time.
  Verified with `npm.cmd run test:logic:summary` (`expectedWarnings=26`,
  `assertionFailures=0`). No wallet path, signing, transaction, RPC, Solidity,
  ABI, deployment, randomness, tokenomics, secret access, or private RPC access
  was used.
- Wallet rejection classification coverage now includes nested viem/Privy-style
  `shortMessage`, `details`, and `cause` shapes, while preserving the negative
  case that nonce/underpriced errors are not user rejections. This keeps
  manual/repeat bet rejection handling on the explicit info-copy path instead
  of generic failure copy. Verified with `npm.cmd run test:logic:summary`
  (`expectedWarnings=26`, `assertionFailures=0`).
- Manual bet wallet failure-copy coverage now directly pins the safe
  user-facing messages for Privy send timeouts, missing receipts, expired
  Privy sessions, unavailable embedded wallets, insufficient ETH gas, low token
  allowance, and insufficient LINEA balance. The same local guard requires
  manual and repeat wallet rejection branches to keep pending transaction
  recovery state instead of calling `clearMiningTxPathState()`, while still
  using explicit info copy. Verified with `npm.cmd run test:logic:summary`
  (`status=pass`, `expectedWarnings=26`, `assertionFailures=0`). No wallet
  path, signing, transaction, RPC, Solidity, ABI, deployment, randomness,
  tokenomics, secret access, or private RPC access was used.
- Auto-Miner failure diagnostics coverage now pins exact local messages for
  unavailable Privy wallet, stuck pending nonce, insufficient ETH gas,
  epoch-closing skip, on-chain revert, contract token mismatch, and RPC/network
  failure. The existing source guard still requires pending-nonce pauses to
  preserve the persisted session for manual recovery instead of clearing it as
  a generic error. Verified with `npm.cmd run test:logic:summary`
  (`status=pass`, `expectedWarnings=26`, `assertionFailures=0`). No wallet
  path, signing, transaction, RPC, Solidity, ABI, deployment, randomness,
  tokenomics, secret access, or private RPC access was used.
- Resolver reward claim UX coverage now pins connected-wallet and embedded
  Privy-wallet claim branches to surface submitted-still-pending receipts,
  ambiguous pending submissions, and wallet rejection with explicit copy while
  retaining the shared synchronous resolver-claim submission lock and
  actor-switch guards. Verified with `npm.cmd run test:logic:summary`
  (`status=pass`, `expectedWarnings=26`, `assertionFailures=0`). No wallet
  path, signing, transaction, RPC, Solidity, ABI, deployment, randomness,
  tokenomics, secret access, or private RPC access was used.
- Safety Pool claim UX coverage now pins ambiguous pending claim submissions,
  plain wallet rejection, partial-success cancellation, and partial-success
  failure copy. The existing guards still require synchronous duplicate-start
  rejection, simulation before wallet submission, ambiguous post-send state
  classification, and actor-switch cancellation. Verified with
  `npm.cmd run test:logic:summary` (`status=pass`, `expectedWarnings=26`,
  `assertionFailures=0`). No wallet path, signing, transaction, RPC, Solidity,
  ABI, deployment, randomness, tokenomics, secret access, or private RPC access
  was used.
- ABI/indexer storage coverage now explicitly proves chain-scope isolation in
  addition to contract/category scope isolation. The local storage regression
  inserts foreign-chain normalized events, bets, and protocol-fee flush rows,
  then requires current-scope reads and global aggregates to ignore them.
  Compact indexer, autonomous, and prelaunch summaries now expose
  `chainScopeIsolation=true`. Verified with
  `npm.cmd run test:indexer-storage:summary`,
  `npm.cmd run test:logic:summary`,
  `npm.cmd run proof:autonomous:summary`,
  `npm.cmd run proof:prelaunch:summary`, and targeted `git diff --check`.
  The prelaunch run passed all required local rows and preserved 23
  external/status blockers. No network, real DB, indexer RPC, wallet signing,
  transaction, Solidity, ABI, deployment, randomness, tokenomics, secret access,
  or private RPC access was used.
- Monitoring strict proof now rejects future-dated alert, recovery,
  alert-target, and error-tracking timestamps instead of accepting ISO format
  alone. `proof:drafts:summary` includes a synthetic future-timestamp manifest
  rejection, while the current strict monitoring summary still fails closed on
  the real G9 external blocker: missing monitoring proof manifest. Verified
  with `npm.cmd run proof:drafts:summary`,
  `npm.cmd run proof:monitoring:strict:summary`,
  `npm.cmd run test:logic:summary`,
  `npm.cmd run proof:autonomous:summary`, and targeted `git diff --check`.
  No monitoring credentials, alert sends, network calls, wallet signing,
  transactions, Solidity, ABI, deployment, randomness, tokenomics, secret
  access, or private RPC access was used.
- QA strict proof now rejects future-dated wallet, failure-state, support,
  final browser QA, and Privy allowed-origin timestamps instead of accepting
  ISO format alone. `proof:drafts:summary` includes a synthetic
  `qa-future-timestamp` strict rejection, while the current QA strict summary
  still fails closed on the real G12-G14 external blocker: missing QA proof
  manifest. Verified with `npm.cmd run proof:drafts:summary`,
  `npm.cmd run proof:qa:strict:summary`,
  `npm.cmd run test:logic:summary`,
  `npm.cmd run proof:autonomous:summary`, and targeted `git diff --check`.
  No wallet signing, transactions, network calls, QA browser automation,
  Solidity, ABI, deployment, randomness, tokenomics, secret access, or private
  RPC access was used.
- QA strict proof now requires `wallet.mobileWeb3Browser` evidence to include
  a concrete mobile device, mobile wallet app, or canonical mobile viewport
  dimensions. Generic `mobile Web3 browser touch` wording no longer satisfies
  the G12-G14 QA proof without device/app/viewport evidence. Guarded in
  `test:logic` and `proof:drafts:summary`; no wallet signing, transactions,
  network calls, QA browser automation, Solidity, ABI, deployment, randomness,
  tokenomics, secret access, or private RPC access was used.
- Mining tx path and pending mining tx recovery now validate persisted `ts` and
  caller `now` values with safe-integer, non-future helpers before restoring
  wallet-path state or clearing dropped pending transactions after the not-found
  grace window. Future-dated or malformed recovery clocks keep the state
  pending instead of clearing it and enabling a duplicate wallet send. Guarded
  in `test:logic`; no wallet signing, real transactions, RPC writes, deploy,
  ABI, randomness, tokenomics, secret access, or private RPC access was used.
- Client bootstrap auto-resolve backoff now canonical-parses `retryAfter`
  seconds before applying the existing 30s/300s clamp, and auto-resolve
  localStorage guard timestamps now use safe-integer, non-future normalization.
  Malformed retry hints fall back to the default delay, and malformed/future
  guard timestamps are cleared instead of creating stale retry suppression.
  The browser hook remains fetch-only and wallet-send-free. Guarded in
  `test:logic`; no wallet signing, real transactions, RPC writes, deploy, ABI,
  randomness, tokenomics, secret access, or private RPC access was used.
- Auto-resolve localStorage guard epochs now share canonical epoch string
  normalization for JSON envelopes, legacy scalar guard values, and guard
  writes. Leading-zero, malformed, or oversized epoch strings are cleared or
  ignored instead of suppressing retries under a key that cannot match
  `actualCurrentEpoch`.
  Guarded in `test:logic`; no wallet signing, real transactions, RPC writes,
  deploy, ABI, randomness, tokenomics, secret access, or private RPC access was
  used.
- Client live-state recovery snapshots now validate `fetchedAt` and caller
  `now` with safe-integer, non-future timestamp normalization before accepting
  a localStorage fallback as fresh. The 12-hour max age, 5-second future skew,
  and visible live-state polling cadence are unchanged; malformed or unsafe
  snapshot timestamps fail closed to live recovery. Guarded in `test:logic`; no
  endpoint polling, wallet signing, real transactions, RPC writes, deploy, ABI,
  randomness, tokenomics, secret access, or private RPC access was used.
- Client chat auth sessions now normalize API expiry headers and persisted
  `expiresAt` values with canonical safe-integer, non-expired, bounded-future
  parsing before save/restore. Malformed, fractional, unsafe, expired, or
  implausibly far-future expiry evidence falls back during auth creation or
  clears stored sessions during restore. Guarded in `test:logic`; no endpoint
  polling, wallet signing, real transactions, RPC writes, deploy, ABI,
  randomness, tokenomics, secret access, or private RPC access was used.
- Chat send cooldown parsing now canonical-parses `retryAfter` seconds and
  fallback milliseconds before applying the existing 1.5s/120s clamp.
  Exponent-form, leading-zero, fractional, unsafe, non-positive, or malformed
  retry evidence can no longer drive chat send cooldowns through broad
  `Number(...)` coercion. Guarded in `test:logic`; no endpoint polling, wallet
  signing, real transactions, RPC writes, deploy, ABI, randomness, tokenomics,
  secret access, or private RPC access was used.
- Chunk-load recovery now canonical-parses its one-shot retry timestamp before
  deciding whether a reload was already attempted. Malformed, leading-zero,
  exponent-form, fractional, unsafe, future, or invalid caller-clock evidence
  no longer suppresses recovery through broad localStorage timestamp coercion;
  cache-bust reload URLs fall back to a valid current timestamp. Guarded in
  `test:logic`; no endpoint polling, wallet signing, real transactions, RPC
  writes, deploy, ABI, randomness, tokenomics, secret access, or private RPC
  access was used.
- Auto-Miner restore dedupe now suppresses duplicate recovery only when the
  previous restore timestamp, current clock, and cooldown are safe integers,
  non-negative, non-future, and inside the valid cooldown window. Malformed,
  fractional, unsafe, negative, future, or invalid-cooldown evidence can no
  longer block a legitimate restore through broad timestamp coercion. Guarded
  in `test:logic`; no endpoint polling, wallet signing, real transactions, RPC
  writes, deploy, ABI, randomness, tokenomics, secret access, or private RPC
  access was used.
- Auto-Miner diagnostics and debug override snapshots now normalize retry
  counters and `updatedAt` values as safe non-negative integers before storage
  restore, support export, or synthetic debug display. Fractional, unsafe,
  negative, infinite, or malformed values fall back to `0` instead of becoming
  misleading recovery/support evidence. Guarded in `test:logic`; no endpoint
  polling, wallet signing, real transactions, RPC writes, deploy, ABI,
  randomness, tokenomics, secret access, or private RPC access was used.
- Auto-Miner network retry planning now validates retry counts, retry limits,
  retry delays, and optional backoff exponent as safe integers before
  scheduling another retry. Malformed, fractional, unsafe, negative, zero-delay,
  or inverted timing evidence fails closed to `give-up` instead of producing a
  NaN/Infinity/odd wait loop. Guarded in `test:logic`; no endpoint polling,
  wallet signing, real transactions, RPC writes, deploy, ABI, randomness,
  tokenomics, secret access, or private RPC access was used.
- Shared Auto-Miner network retry delays now validate attempt, initial delay,
  max delay, optional max exponent, and maxAttempts as safe integers before
  sleeping or retrying. Malformed, fractional, unsafe, negative, zero-delay, or
  inverted timing evidence fails closed to zero wait or immediate exhausted
  retry instead of producing NaN/Infinity waits or unbounded retry loops.
  Guarded in `test:logic`; no endpoint polling, wallet signing, real
  transactions, RPC writes, deploy, ABI, randomness, tokenomics, secret access,
  or private RPC access was used.
- Auto-Miner round-planning insufficient-LINEA stop messages now carry exact
  bigint-formatted one-decimal display strings through plan, command, and loop
  reducer state instead of converting token wei values through `Number(...)`
  and formatting with `.toFixed(1)`. Large token balances or round costs can no
  longer lose precision in the stop progress message. Guarded in `test:logic`;
  no endpoint polling, wallet signing, real transactions, RPC writes, deploy,
  ABI, randomness, tokenomics, secret access, or private RPC access was used.
- Wallet mining native-gas failure copy now formats ETH wei values with
  bigint-only six-decimal formatting instead of converting required gas costs
  and balances through `Number(...)`. Large gas balances or required costs can
  no longer lose precision in the "Not enough ETH for gas" message. Guarded in
  `test:logic`; no endpoint polling, wallet signing, real transactions, RPC
  writes, deploy, ABI, randomness, tokenomics, secret access, or private RPC
  access was used.
- Auto-Miner bootstrap insufficient-balance copy now formats LINEA balances
  with bigint-only one-decimal formatting instead of converting wei balances
  through `Number(...)`. Very large balances or round costs can no longer lose
  precision in the cannot-start message. Guarded in `test:logic`; no endpoint
  polling, wallet signing, real transactions, RPC writes, deploy, ABI,
  randomness, tokenomics, secret access, or private RPC access was used.
- Manual approve and Auto-Miner bootstrap approve recovery now validate
  pending approval timestamps before pending/underpriced retry messaging, and
  manual and Auto-Miner bootstrap approval nonce selection now share safe
  non-negative integer normalization for untrusted runtime evidence.
  Auto-Miner bootstrap allowance polling now also computes its deadline through
  safe integer timeout normalization. Malformed, unsafe, negative,
  overflowing, future, or internally inconsistent approval nonce/timestamp/
  timeout evidence fails closed to an explicit recovery error or no-poll result
  instead of broad `Number(...)` coercion, raw pending-age arithmetic, or raw
  elapsed-time polling. Guarded in `test:logic`; no endpoint polling, wallet
  signing, real transactions, RPC writes, deploy, ABI, randomness, tokenomics,
  secret access, or private RPC access was used.
- Auto-Miner bet loop and Wallet Settings pending-transaction recovery now
  normalize latest/pending nonce evidence as safe non-negative integers before
  comparing nonce gaps, replacement eligibility, or blocked nonce status.
  The Auto-Miner loop also validates tracked pending-bet nonce and submitted-at
  state before age/replacement decisions. Malformed, unsafe, negative,
  overflowing, future, or internally inconsistent nonce evidence fails closed
  to an explicit recovery warning/error instead of broad `Number(...)`
  coercion or raw pending-state arithmetic. Guarded in `test:logic`; no
  endpoint polling, wallet signing, real transactions, RPC writes, deploy, ABI,
  randomness, tokenomics, secret access, or private RPC access was used.
- Approve/allowance wallet runtime now computes allowance polling deadlines via
  safe integer timeout normalization and normalizes approval nonces from
  pending state or RPC before wallet submission. Malformed, unsafe, negative,
  overflowing, or future-impossible timeout/nonce evidence fails closed before
  approve send logic instead of using broad `Date.now() + timeoutMs` or
  `Number(...)` coercion. Guarded in `test:logic`; no endpoint polling, wallet
  signing, real transactions, RPC writes, deploy, ABI, randomness, tokenomics,
  secret access, or private RPC access was used.
- Wallet mining low-balance guards now compare raw bigint balance units against
  exact ETH/token thresholds instead of converting formatted balance strings
  through `Number(...)`. Malformed runtime balance decimals or threshold
  evidence fails closed for existing balance objects, while missing balance
  evidence keeps the previous no-warning behavior. Guarded in `test:logic`; no
  endpoint polling, wallet signing, real transactions, RPC writes, deploy, ABI,
  randomness, tokenomics, secret access, or private RPC access was used.
- Wallet Overview Privy LINEA/ETH display and local balance-cache writes now
  format raw bigint balance units directly to the existing two/four decimal UI
  strings instead of passing formatted balance strings through `Number(...)`.
  Cached decimal text normalization also rounds without unsafe-number precision
  loss, preventing large balances from being displayed or persisted with
  misleading rounded values. Guarded in `test:logic`; no endpoint polling,
  wallet signing, real transactions, RPC writes, deploy, ABI, randomness,
  tokenomics, secret access, or private RPC access was used.
- Active wallet LINEA balance display now uses the shared decimal-text balance
  formatter instead of `Number(tokenBalanceFormatted).toFixed(2)`. The Wallet
  Overview bigint formatter is shared from `app/lib/balanceFormatting.ts` for
  cached decimal text, raw bigint balance display, and the active wallet header
  balance path. Guarded in `test:logic`; no endpoint polling, wallet signing,
  real transactions, RPC writes, deploy, ABI, randomness, tokenomics, secret
  access, or private RPC access was used.
- Wallet Settings resolver reward display now formats pending resolver reward
  wei with the shared bigint balance formatter instead of converting
  `formatUnits(value, 18)` through `Number(...)`. The existing two/four decimal
  display rule is preserved by a raw wei threshold, and claim/simulation/send
  logic is unchanged. Guarded in `test:logic`; no endpoint polling, wallet
  signing, real transactions, RPC writes, deploy, ABI, randomness, tokenomics,
  secret access, or private RPC access was used.
- Wallet transfer history summary totals now expose bigint-safe
  `totalInDisplay` and `totalOutDisplay` strings and render those in Wallet
  Settings instead of calling `.toFixed(2)` on numeric compatibility totals.
  Legacy numeric totals remain present for compatibility, but displayed totals
  come from raw wei formatting. Guarded in `test:logic`; no endpoint polling,
  wallet signing, real transactions, RPC writes, deploy, ABI, randomness,
  tokenomics, secret access, or private RPC access was used.
- Deposit history mapping now derives `amounts`, `amountNum`, and win `reward`
  numeric compatibility values from bounded raw-wei formatting instead of
  converting `formatUnits(...)` output through `Number(...)`. Existing deposit
  display strings and analytics fields remain present, but malformed or huge
  wei evidence no longer enters the hook through direct formatted-string number
  coercion. Guarded in `test:logic`; no endpoint polling, wallet signing, real
  transactions, RPC writes, deploy, ABI, randomness, tokenomics, secret access,
  or private RPC access was used.
- Shared LINEA wei display formatting now formats raw bigint decimal text
  directly and applies comma grouping without `Number(formatUnits(...))`.
  Reward Scanner and Sidebar reward displays keep the same public helper, but
  very large wei values no longer pass through unsafe JS number conversion
  before display. Guarded in `test:logic`; no endpoint polling, wallet signing,
  real transactions, RPC writes, deploy, ABI, randomness, tokenomics, secret
  access, or private RPC access was used.
- `/api/deposits` chain-recovery rows now derive `totalAmountNum`
  compatibility fields from bounded raw-wei formatting instead of parsing
  `formatUnits(...)` decimal strings. The API still returns the same
  `totalAmount` string and `totalAmountNum` number fields, but huge recovered
  bet amounts no longer use direct formatted-string number coercion. Guarded in
  `test:logic`; no endpoint polling, wallet signing, real transactions, RPC
  writes, deploy, ABI, randomness, tokenomics, secret access, or private RPC
  access was used.
- `/api/leaderboards` now derives `valueNum` compatibility fields for biggest
  wins, whales, underdog wins, and one-tile wins from bounded raw-wei
  formatting instead of `Number(formatUnits(...))`. Ranking and public string
  `value` fields are unchanged; only unsafe number coercion for compatibility
  fields was removed. Guarded in `test:logic`; no endpoint polling, wallet
  signing, real transactions, RPC writes, deploy, ABI, randomness, tokenomics,
  secret access, or private RPC access was used.
- Recent-wins reward mapping now formats resolved win display amounts from raw
  wei, sorts resolved winners by bigint reward, and derives recovered
  `rewardNum` compatibility fields from bounded raw-wei formatting instead of
  `parseFloat(formatUnits(...))`. Public `amount` and `amountRaw` fields remain
  present; unsafe number coercion no longer drives reward display or sorting.
  Guarded in `test:logic`; no endpoint polling, wallet signing, real
  transactions, RPC writes, deploy, ABI, randomness, tokenomics, secret access,
  or private RPC access was used.
- Jackpot service recovery and on-chain reconciliation now derive `amountNum`
  compatibility fields from bounded raw-wei formatting instead of
  `parseFloat(formatUnits(...))`. Public `amount` strings remain unchanged;
  only unsafe numeric compatibility coercion was removed. Guarded in
  `test:logic`; no endpoint polling, wallet signing, real transactions, RPC
  writes, deploy, ABI, randomness, tokenomics, secret access, or private RPC
  access was used.
