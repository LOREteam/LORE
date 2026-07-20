# Current State

Last updated: 2026-07-18.

Detailed history through this date is archived in
[`docs/archive/current-state-through-2026-07-13.md`](archive/current-state-through-2026-07-13.md).
Open linked evidence only when a task needs it.

## Scope

- Active scope is Linea Sepolia testnet readiness and regression monitoring.
- The configured V9 candidate is the accepted testnet contract for current runtime checks.
- Mainnet transition and G1-G14 production evidence are paused until explicitly resumed.
- EIP-7702 remains disabled in normal runtime flows.

## Confirmed State

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
  removing the W3C baggage memory-allocation advisory. The current production
  audit has 29 findings after the advisory database refresh, with zero high or
  critical findings;
  wallet dependency integrity, typecheck, logic tests, production build, and all
  23 HTTP smoke checks pass on the updated lockfile.
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
- Solidity compilation is pinned to 0.8.34 with optimizer 200 and Osaka; the
  tracked source/ABI/bytecode manifest reproduces exactly in the local gate.
- CI now runs logic, contract, SQLite, monitoring, provenance, build, production
  browser, and high/critical dependency checks from the lockfile instead of
  relying on ignored local ABI/BIN artifacts.
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

## Accepted Limitations

- The public testnet runbook and `.env.example` now match the accepted V9
  candidate used by the private runtime environment. The previous 50-epoch
  canary is explicitly historical evidence; it is not presented as proof for
  the current candidate.
- A fresh 60-second local production-build HTTP load run completed 38,558
  requests at 642.2 requests/second with zero failures, p95 520 ms, and p99
  708 ms. This is local evidence only, not the required HTTPS canary proof.
  Rate-limited endpoints returned expected 429 responses while `live-state`
  remained unthrottled and responsive.
- A fresh production process correctly returned 503 for protected endpoints
  without trusted client identity. With the documented local-only weak-identity
  bypass, all 23 cold HTTP smoke checks passed. A prior 31-second `deposits`
  response did not reproduce and therefore was not patched speculatively.
- The user accepted existing wallet/mobile and Auto-Miner evidence and waived another authenticated fee-quote, Rabby, true-device mobile-wallet, and Auto-Miner rerun for this testnet candidate.
- Existing evidence must not be presented as a fresh rerun.
- Responsive mobile coverage is recorded; true-device HTTPS wallet coverage remains a deployment-stage check.
- Local proof tooling passing does not satisfy mainnet G1-G14 evidence.
- The repository workflow runs on every branch push, but the available GitHub
  connector exposes only pull-request-triggered runs. The current commit therefore
  has complete local clean-checkout evidence but no connector-readable remote run.
- The remaining production dependency advisories are concentrated in the wallet
  dependency graph, including `uuid`. Their available automated fixes require
  coordinated breaking Privy/wagmi changes, so they are deferred rather than
  force-upgraded.

## Follow-Ups

- Monitor the shared testnet runtime and investigate only new regressions.
- Validate the shared limiter with real external-store credentials across two replicas.
- Validate HTTPS Privy and true-device mobile Web3 flows on the final origin.
- Validate real monitoring delivery/recovery and schedule operational backups.
- Complete the funded 24-48 hour soak after `AUTOMINER_A` and `AUTOMINER_B` both
  pass the unchanged native-gas preflight. Keep `AUTOMINER_C` excluded.
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

The current uncommitted candidate passes typecheck, business logic, contract
invariants, compilation provenance, production build, HTTP smoke, responsive
browser smoke, dependency high/critical audit, monitoring drill, and diff
hygiene. Both the latest and the original fixed historical chain/indexer audit
windows pass after an integrity-checked backup and one bounded indexer repair.

The latest managed three-role soak stopped safely after 384 successful unique
bets/epochs/transactions/nonces and 20 pre-send failures from `AUTOMINER_A`.
It recorded zero duplicate transactions/nonces, zero on-chain reverts, zero
health failures, and stable RSS/DB/WAL telemetry. The required transaction-free
preflight then failed closed because `AUTOMINER_A` and `AUTOMINER_B` lack the
configured native gas reserve; no transaction was sent. Do not restart until
both roles pass the unchanged preflight, and keep `AUTOMINER_C` excluded.

After that blocker is cleared, continue the same durable soak toward the 24-48
hour gate. Remaining deployment-dependent checks are the real shared limiter
across two replicas, HTTPS Privy/true-mobile wallet recovery, real alert
delivery/recovery, and scheduled backup execution. Keep mainnet work paused.
