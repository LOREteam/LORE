# Agent Progress

Compact durable handoff for active work only. Full history through 2026-07-13 is
archived in
[`docs/archive/agent-progress-through-2026-07-13.md`](archive/agent-progress-through-2026-07-13.md).
Current repository truth lives in [`docs/current_state.md`](current_state.md).

## Active Handoff

- A 1,440-round Linea Sepolia soak started at 2026-07-16T23:01:20Z with
  randomized 0.01-0.05 LINEA totals, 1-25 tiles, four wallet roles, and
  pre-dispatch RPC failover injection, but the managed execution session ended
  early. The retained diagnostic log contains 11 successful bets in 11 unique
  epochs, 10 successful resolves, all four bet modes, and zero failed bets,
  failed resolves, nonce gaps, or duplicate transaction evidence. It is not a
  completed soak proof. Evidence is in
  `data/live-test-runs/live-canary-2026-07-16T23-01-20-253Z.jsonl`.
- Active objective: monitor the accepted Linea Sepolia testnet candidate and fix
  only evidence-backed regressions.
- Mainnet G1-G14 collection and transition work are paused.
- Existing authenticated wallet/mobile/Auto-Miner evidence was accepted; several
  reruns were explicitly waived and must not be described as fresh evidence.
- Browser-only work must use the UI-only runner. The composite development runner
  also starts operator workers and must not be used for passive UI inspection.
- Preserve visible live-state and pool-chart freshness.

## Latest Completed Work

## 2026-07-18 - Clean-checkout CI and indexer recovery

- GitHub Actions run `29634688258` passed from clean checkout at `129314f`,
  including lockfile install, wallet peer integrity, dependency audit, lint,
  typecheck, logic and contract tests, compilation provenance, SQLite and
  monitoring drills, production build, and browser smoke.
- A fresh read-only 50-epoch chain/indexer audit detected an operationally stale
  local indexer: missing/mismatched bet and resolve rows plus absent resolver
  reward metadata. No transaction was sent.
- The normal one-shot indexer catch-up processed the missing finalized logs and
  reconciliation reported no missing epochs. Repeating the same audit over
  epochs 417-466 passed with 50 resolved epochs, 45 bets, 45 resolver rewards,
  and zero mismatches.
- A separate cold-start drill used a new isolated SQLite database and scanned
  131,125 blocks from the current deployment, indexing 1,386 logs. Reconciliation
  and the same 50-epoch chain audit passed. A second run on the same database
  processed only the new head range; the post-restart audit remained clean,
  proving restart/idempotent writes for this testnet snapshot.

- Fixed the strict testnet canary proof fixture to use the supported `single`
  mode. `proof:drafts` and the complete `proof:local` L1-L14 preflight pass.
- Added `lore-backup` and `lore-chain-audit` as non-restarting PM2 cron jobs,
  reusing the existing backup and bounded audit commands. Environment-backed
  backup invocation produced an integrity-valid copy; the scheduled audit path
  passed a fresh 50-epoch Sepolia comparison with zero mismatches. Strict
  process-model, logic, DB, monitoring, lint, and local proof checks pass.
- Added a stateful concurrent shared-limiter drill proving that separate web
  consumers use one external Redis bucket and cannot each spend the full local
  allowance. The logic test and focused lint pass; real credentials and two
  deployed replicas remain external evidence.
- Changed the scheduled chain/indexer artifact writer to temp-file plus atomic
  rename. This prevents a concurrent monitor poll from reporting a transient
  invalid-JSON incident. A fresh 50-epoch Sepolia audit, logic test, and focused
  lint pass after the change.
- Added opt-in backup retention with a 1-3650 day validation range and a
  non-recursive exact-filename guard. DB drills prove expired generated copies
  are removed while fresh and unrelated files remain; a full CLI smoke created
  an integrity-valid backup with retention enabled. Logic, DB, and lint pass.
- Extended runtime monitoring with bounded scheduled-backup freshness checks.
  It reads only regular-file metadata, uses `LORE_BACKUP_DIR` by default, and
  reports missing/stale/invalid/unavailable states plus recovery. Monitoring
  drill now passes 10 alert/recovery transitions without restart duplicates;
  logic and focused lint pass.
- Added bounded continuous-indexer failure recovery. Transient watch errors are
  retained, but five consecutive failed full cycles now terminate the process
  for PM2 restart; success resets the counter. Typecheck, logic/integration
  guards, targeted lint, contract invariants, DB fault drill, and strict process
  model checks pass.
- Extended the browser profiler to support bounded observations up to 15 minutes
  and completed a ten-minute production-build run. DOM stayed at 635 nodes,
  heap fell by 9.5 MB, horizontal overflow remained zero, local responses had
  no failures, and visible `live-state` polling remained at 12 requests/minute.
  All five console error samples were external wallet/auth resources.
- Added a production mobile browser guard for enabled interactive targets. The
  current 390x844 hub exposes 40 visible controls and none are below 44x44 CSS
  pixels; focused logic, lint, and full browser smoke pass.
- Re-ran the current baseline after the interrupted soak: typecheck, logic,
  contract invariants, production build, focused desktop/tablet/mobile browser
  smoke, lint, monitoring, SQLite operations, exact contract compilation, full
  dependency audit, and local launch proof L1-L14 pass. The browser smoke again
  confirms matching numeric fonts and a mounted empty-pool chart.
- Re-ran production HTTP and local-only load checks: HTTP routes passed, and a
  10-second 50-client run handled 4,459 requests with zero unexpected failures;
  rate-limit 429 responses were classified separately. `live-state` p95 was
  110 ms and total p95 was 715 ms.
- A fresh two-minute production-tab profile showed DOM +1, heap -8.0 MB, zero
  horizontal overflow, 17 same-origin API requests/minute, and 12 visible
  `live-state` requests/minute. Four CSP console messages and one resource error
  were traced to external wallet/auth resources, not the LORE origin. Browser
  diagnostics now record only safe local/external source classification.
- Fixed bundle baseline provenance: `baseline:bundle` now measures the normal
  completed `.next` build by default, requires a non-empty `BUILD_ID`, and
  records its completion time. The previous default could silently measure an
  older `.next-isolated` output.
- Re-ran the focused production browser matrix with debug Auto-Miner scenarios:
  retry-wait, session-expired, pending bet reload/tab recovery, persistence,
  desktop/tablet/mobile layout, empty chart/history, and accessibility all pass.
- Connected the scheduled chain/indexer audit to runtime alerting. The monitor
  now checks a bounded persistent JSON artifact and emits deduplicated alerts
  for mismatch, stale, invalid, oversized, or unavailable output plus recovery
  when a fresh passing audit replaces it. The drill passes 9 alerts, no restart
  duplicates, 9 recoveries, and 18 deliveries.
- `npm ci --dry-run --no-audit --no-fund` completed from the current lockfile,
  including the EIP-7702-disabled postinstall path. It also confirms the current
  reused `node_modules` differs from a clean lockfile install, so only GitHub or
  another disk-backed clean install can close the clean-checkout gate.
- Live canary logs now end with a machine-readable summary event. Runtime
  monitoring distinguishes a completed zero-failure soak from an unfinished
  log that stopped receiving events, and alerts separately when a completed
  run contains failures. Typecheck, logic, monitoring, and targeted lint pass.
- A no-transaction dry-run preflight after the summary change found all four
  configured test roles ready; the temporary preflight log was removed.
- Hardened canary analysis so only `single`, `bitmap`, `sameAmount`, and
  `arrays` events count as bet transactions; preflight, resolve, wait, and the
  new summary event cannot inflate round metrics. The retained partial soak
  still reports the same 11 real bets after the change.
- A fresh read-only 50-epoch chain/indexer audit first detected the intentionally
  stale local indexer. One bounded `indexer:once` caught up 11 bets/11 epochs,
  completed repair/reconcile, and the identical audit then passed with zero
  bet, resolve, jackpot, or resolver-reward mismatches.
- Verified that a detached child process is terminated with the managed command
  session in this environment. A 24-48 hour funded soak must therefore run under
  the deployment supervisor or another durable external job runner.
- Added candidate fee-estimate UX with exact-path simulation and no fixed fallback.
- Unified wallet transfer failure classification and guarded account-switch races.
- Fixed the live-state RPC recovery deadlock and verified recovery with a focused
  browser drill while keeping the chart mounted.
- Added responsive HUD, touch-target, keyboard-focus, and reduced-motion guards.
- Recorded production desktop/mobile performance with no horizontal overflow and
  retained established lazy-loading boundaries.
- Unified browser/server/edge Sentry redaction.
- Completed a testnet SQLite backup, restore, catch-up, and restart/reconcile drill.
- Replaced oversized persistent agent instructions with compact repo rules and
  archived historical state/progress documents.
- Added trusted-proxy client identity and an external shared rate-limit backend,
  with fail-closed production validation for multi-replica deployments.
- Fixed deposit log scans to respect Linea's 10,000-block RPC range and verified
  a clean fresh catch-up plus idempotent restart.
- Added repeatable SQLite WAL/checkpoint/backup/corruption/disk-full drills and a
  full chain-to-indexer audit; both pass against isolated testnet evidence.
- Added pending-bet reload/tab recovery guards, support-log redaction, runtime
  alert deduplication/recovery tests, and compact browser leak/polling diagnostics.
- Production load sustained 23,073 requests in 30 seconds with zero unexpected
  failures; full responsive and debug Auto-Miner browser smoke passed.
- Expanded the contract gate with deterministic fee/rollover/reward/bitmap
  properties, including all 25 tiles, repeated claim/resolve guards, and
  SafeERC20-only transfer assertions.
- Pinned Solidity to the deployed candidate's exact 0.8.34 compiler and added a
  tracked optimizer-200/Osaka compilation manifest plus reproducibility check.
- Removed clean-checkout dependence on ignored root `.abi`/`.bin` files and
  expanded CI with logic, contract, DB, provenance, build, and browser gates.
- Added `db:backup` with a required explicit source/output, read-only online
  backup, source/backup integrity checks, and overwrite refusal.
- Added read-only `db:scope-audit` that reports foreign/legacy cleanup counts
  without exposing addresses or modifying the database.
- Reproduced corrupt-DB cold start (all routes returned 500) and added fail-fast
  SQLite prestart validation so supervised processes restart/alert instead of
  accepting traffic in a broken state.
- Persisted active runtime-monitor issues across restarts and added a local
  alert/deduplication/recovery delivery drill to CI.
- Re-ran production and full dependency audits with no high/critical findings;
  CI now blocks newly introduced high/critical production advisories.
- Added cold first-request load reporting and global-stats coverage; the focused
  production smoke passed with explicit per-route 429 accounting.
- Added an active-section accessible name to the main landmark and verified it
  with the complete focused desktop/tablet/mobile production browser smoke.
- Fixed pending-transaction recovery with actor-scoped v2 storage and stale UI
  reset on wallet switches; multi-actor preservation regression checks pass.
- Hardened trusted proxy identity validation and bounded persisted monitor-state
  input; targeted logic/monitoring tests, typecheck, lint, and build pass.
- Added private soak diagnostics for process memory/uptime and DB/WAL/SHM size
  growth with public redaction; production HTTP smoke and focused checks pass.
  The earlier local `health:prod` degradation correctly reflected a stale
  indexer; the subsequent bounded catch-up and audit now show a fresh local DB.
- Added opt-in RSS/WAL monitor thresholds and verified persisted alert/recovery
  behavior without changing default monitoring semantics.
- Added an opt-in bounded-tail canary JSONL monitor for recent reverted-transaction
  series; malformed/partial lines are ignored and alert/recovery deduplication passes.
- Rechecked the active DB scope read-only: no foreign/legacy rows or stale scoped
  keys exist; only the previous-scope marker differs. Created and integrity-checked
  a compact online backup under `.tmp/pre-mainnet/sqlite-backups`; no purge ran.

## 2026-07-17 - Support diagnostics export

- Exported support logs now include the safe persisted Auto-Miner state and stop reason, which survives reload and helps diagnose interrupted sessions.
- The field list is explicit; raw provider error text is excluded and export metadata is sanitized before serialization.
- Focused logic tests cover the whitelist and logger integration.
- The support export now also retains the latest confirmed Auto-Miner epoch and retry count, while every submitted standard bet records its public tx hash and known nonce without wallet identity. Focused logic, typecheck, ESLint, and redaction guards pass.
- Restored the support-log export action on mobile with an accessible icon-only presentation; desktop keeps the text label.
- Production build and the full desktop/tablet/mobile browser smoke pass, including touch targets and empty-chart guards. No local server remains running.

## Open Follow-Ups

- Run the same shared limiter against real Upstash credentials and two replicas.
- Exercise HTTPS Privy/wallet flows on the final deployed origin and a true mobile
  Web3 browser, including signed pending/reject/revert recovery.
- Verify alert delivery/recovery through the real monitoring provider and install
  the backup/checkpoint drill in the deployment scheduler.
- Complete a 24-48 hour funded soak before mainnet signoff; clean-checkout CI is
  green for the published testnet baseline.
- Do not launch another long funded soak from a managed terminal session; use a
  durable supervisor and retain its PID/heartbeat plus the canary JSONL.
- Keep the expanded clean-checkout workflow required on subsequent published
  revisions; the current published baseline passed it.
- Start the targeted Codex Security diff scan from its app UI when interactive
  scan setup is available.

## 2026-07-17 - Canary soak telemetry

- Added optional, non-fatal health sampling to `live:canary` through the existing private runtime and data-sync endpoints.
- JSONL stores only numeric RSS, heap, DB, WAL, and uptime values; health URL and secret are not persisted.
- `proof:canary` reports first/max/delta trends and strict mode rejects incomplete enabled telemetry while remaining compatible with older logs.
- Focused logic tests, TypeScript, ESLint, and a synthetic analyzer smoke passed. The real 300-round/24-48h run remains an external-duration gate.

## 2026-07-17 - Scoped SQLite cleanup safety

- Read-only audit found 6,227 rows in two obsolete testnet contract scopes and 24 stale metadata keys; the active scope matched and legacy tables were empty.
- Created and integrity-checked a fresh backup before enabling the existing guarded cleanup. The post-cleanup read-only audit reports zero foreign scopes, foreign rows, stale keys, and legacy rows.
- The cleanup exposed a filename guard bug that attempted to remove the active database WAL/SHM files. Windows kept the open files intact; startup integrity passed. The shared helper now excludes the active DB plus its WAL and SHM artifacts, with a regression guard and direct runtime verification.
- Rebuilt the production app, then passed normal and debug browser smoke. Debug coverage includes retry-wait, session-expired, pending reload, and tab-reopen recovery without a duplicate send.
- Repeated the 60-second local production load after cleanup: 37,892 requests at 630.9 req/s, zero unexpected failures, p50 37 ms, p95 528 ms, p99 699 ms. Rate-limit responses were expected; live-state p95 remained 59 ms.

## 2026-07-17 - Focused accessibility hardening

- Added polite screen-reader status announcements for manual-bet and auto-miner phase transitions without announcing frequent progress counters.
- Mobile Wallet Settings section controls now expose selected state, a 44px minimum touch target, and an explicit keyboard focus ring.
- Typecheck, focused ESLint, and the business-logic regression suite passed.
- Contract invariants, production build/start, full responsive browser smoke,
  production dependency audit, local launch proof, and diff hygiene also pass;
  the temporary production server was stopped after smoke.
- Dependency inspection found an exact peer mismatch between the installed
  root `viem` and `@privy-io/wagmi@4.0.9`. `npm ci --dry-run` resolves the
  lockfile, but wallet packages must be aligned together and requalified in
  testnet rather than changed piecemeal.
- An isolated lockfile probe rejected the latest Privy/wagmi/viem matrix because
  `@privy-io/wagmi` pins `viem@2.52.0` while the latest wagmi dependency graph
  requires `viem>=2.54.0`. Conservative exact-version resolution then entered
  an npm peer-resolver CPU loop and was stopped by its exact PID. No working
  dependency files were changed and no `--force`/legacy-peer bypass was used.
- Hardened production-mode API rate limiting so missing trusted proxy identity
  returns 503 by default. The local/CI smoke bypass is explicit, documented, and
  rejected by mainnet runtime validation; typecheck, logic, and focused lint pass.
- Added a tested streaming JSON body cap and applied it to all six JSON
  write-routes. Content-Length and chunked overflow return 413; malformed JSON
  keeps the existing 400 behavior. Typecheck, logic, focused lint, and the
  production build pass.
- Extended V9 model fuzz with 5,000 randomized Safety Pool distributions over
  1-25 losing participants plus winner exclusion and a `uint128` arithmetic
  edge. Aggregate rounded claims cannot exceed the rebate pool; `test:contract`
  passes without changing Solidity behavior.
- Upgraded the browser baseline tool with bounded 30-second heap/DOM samples and
  peak deltas, then completed a 15-minute production profile: 31 samples, zero
  DOM growth, negative heap delta, no local API failures, and no evidence-backed
  reason to reduce intentional live-state/chart polling.
- Re-ran SQLite and monitoring fault drills successfully, then completed a
  read-only chain/indexer audit over all 89 available resolved testnet epochs.
  Bets, resolves, jackpots, rewards, batch claims, resolver rewards, and rebates
  matched with zero mismatches; fee-flush live evidence awaits epoch 120.
- Synchronized the public testnet runbook and `.env.example` with the accepted
  V9 candidate. The old 50-epoch canary is now labeled historical rather than
  current-candidate evidence; `proof:drafts` still passes its expected-reject
  matrix.
- Ran a 60-second production HTTP load: 22,703 requests, 0 failures, 377.6
  requests/second, p95 814 ms, p99 1,174 ms. A fresh process confirmed
  fail-closed 503 behavior without trusted identity and passed all 23 cold HTTP
  checks with the explicit local-only bypass. A one-off 31-second deposits
  latency did not reproduce.
- Tested coordinated Privy/wagmi/viem alignment in isolation. The compatible
  fresh lock causes unacceptable broad churn, while the preserved-lock resolver
  stalled; both probes left working dependency files unchanged. Alignment and
  signed wallet regression remain pending.
- Re-ran the current baseline after the testnet documentation correction:
  `typecheck`, `test:logic`, `test:contract`, production `build`, and the full
  responsive browser smoke pass. Contract compilation provenance also matches
  Solidity 0.8.34, optimizer 200, Osaka, and the committed ABI/bytecode hashes;
  production dependency audit remains clear of high/critical advisories.
- The 1,440-round randomized soak dry-run passed preflight for all four roles
  with 1-25 tiles, bounded small bets, and RPC-failover injection. Actual soak
  remains intentionally unstarted until the production-like health base,
  diagnostics secret, and durable redacted RPC label are configured so the run
  captures RSS, heap, DB, and WAL evidence instead of only transaction counts.
- Final local proof preflight still passes L1-L14 after these changes. The
  expected strict launch failure correctly reports all 14 deployment-dependent
  mainnet evidence gates as remaining; no testnet evidence was promoted into a
  mainnet proof file.
- Re-audited proxy rate limiting against the explicit goal: untrusted/spoofed
  IP headers stay weak, the private proxy secret uses timing-safe comparison,
  IPv4/IPv6 inputs are validated, same-NAT fallback cannot rotate spoofed IPs,
  and concurrent replicas consume one external bucket. Mainnet validation
  requires a fail-closed external store for more than one replica; no code gap
  was found.
- Re-ran SQLite operations and monitoring drills: checkpoint, backup integrity,
  retention, read-only, disk-full, corrupt startup, stale-scope dry-run, alert
  dedupe, and recovery delivery all pass. Physical reboot and deployed-DB
  outage remain staging-only evidence.
- Confirmed support export retains safe epoch, nonce, transaction hash, retry
  count, and stop reason while removing raw errors and wallet identity. Contract
  token paths remain SafeERC20-only and nonReentrant; repeated claim/resolve,
  all-tile bitmap, large pool, and conservation checks remain covered.
- Retried the wallet dependency alignment with explicit package arguments and
  bounded npm fetch retries. It repeated the preserved-lock resolver stall and
  was stopped; this is the second failed resolver approach, so no further npm
  retry or working lockfile change is justified in this environment.
- Re-ran the default read-only chain/indexer audit on the current candidate:
  epochs 40-89, 46 bets, 50 resolves, 2 jackpots, and 46 resolver rewards match
  with zero mismatches. Rewards, rebates, batch claims, and fee flushes were
  absent in this bounded live window rather than inferred as passing activity.
- Added `soak:testnet` supervisor for the actual 24-hour testnet run. It creates
  an in-memory diagnostics secret, starts and health-checks an isolated
  production server, runs 1,440 randomized 1-25-tile rounds with small bounded
  bets and RPC-failover injection, atomically records status/evidence paths, and
  cleans up children. Two transaction-free dry-runs pass; logic and focused
  lint guards cover secret handling, dry-run, atomic status, and cleanup.
- The real soak did not start: this Codex runner terminates detached children,
  Windows `Start-Process` fails on the host's duplicate `Path/PATH`, and Task
  Scheduler is unavailable. No task or live process remains. Run the documented
  command in a durable user terminal or external process manager.
- Added compact `soak:testnet:status` and lock-verified `soak:testnet:stop`
  operator commands. Status exposes no raw logs, wallet identity, RPC URL, or
  secret; it streams the JSONL evidence into bounded progress counters instead
  of loading or printing the artifact. Stop signals only the supervisor matching
  the durable lock.
- Resolved the exact Privy/wagmi peer mismatch with the smallest compatible
  change: root `viem` is pinned to `2.50.4`, matching
  `@privy-io/wagmi@4.0.9`. A clean `npm ci` and `npm ls` pass without
  `--force` or legacy-peer bypass. After the clean install, EIP-7702 remains
  disabled and typecheck, logic, contract invariants, compilation provenance,
  production build, and full responsive/debug browser smoke pass. Signed HTTPS
  Privy wallet regression remains external evidence, not inferred from smoke.
- Added `proof:wallet-deps` to clean-checkout CI immediately after `npm ci`, so
  a future invalid Privy/wagmi/viem peer tree fails before compilation.
- Started the real 1,440-round testnet soak at `2026-07-17T16:22:46.244Z` after
  the clean-checkout regression pass. Early evidence has successful unique
  epochs/transactions/nonces, successful health telemetry, and no failed,
  reverted, duplicate, or malformed events. Keep the managed foreground
  session alive until the final analyzer result is available.
- While the soak remained active, a one-shot indexer catch-up ingested 25 new
  bets/epochs and completed repair/reconcile without missing epochs. The next
  50-epoch chain-to-indexer audit passed with zero mismatches. This directly
  exercises live SQLite/indexer contention instead of relying on a static DB.
- The first live run reached 44 successful unique epoch/tx/nonce events with no
  transaction failures, reverts, duplicates, or malformed lines. One health
  attempt hit a transient 10-second telemetry timeout and the next sample
  recovered. The sampler now retries once with a fresh abort deadline and
  records `healthRetryCount`, preserving recovery evidence without hiding a
  final second-attempt failure.
- The operator stop exposed Windows terminating the supervisor before its signal
  handler persisted final state. `soak:testnet:stop` now verifies process exit,
  atomically records `stopped/operator-stop`, and repairs a matching stale lock;
  no server or canary child remained. A fresh 1,440-round run started at
  `2026-07-17T17:20:45.310Z` with the corrected sampler.
- A second live indexer catch-up ingested 70 bets and 71 epochs during the new
  soak. The first 50-epoch audit reported 51 resolver accruals because its
  chain block range included the next epoch while resolver accruals alone were
  not epoch-filtered. The auditor now applies `inEpochWindow` to
  `ResolverRewardAccrued` while keeping epochless claims block-scoped; the same
  window passes with 50 accruals and zero mismatches. Logic and focused lint
  guards pass.
- The corrected second run reached 226 successful unique bets with no failed,
  reverted, duplicate, or malformed events; four health timeouts recovered on
  their bounded retry. Two successful batch bets were latency outliers at about
  38 and 100 seconds, but the original event schema could not locate the phase.
  Canary evidence now records prepare, gas-estimate, nonce-read, send, and
  receipt milliseconds, and compact status reports phase percentiles. The
  instrumentation run started at `2026-07-17T21:56:29.625Z`; its first events
  confirm phase metrics are populated without exposing identities or tx hashes.
- The instrumentation run then stopped after the dedicated resolver exhausted
  native gas: 30 successful bets were followed by 20 safe-window failures and
  177 pre-send `insufficient-native-gas` resolve checks. The four funded test
  wallets now act as ordered canary-only resolver fallbacks. Fallback occurs
  only for proven pre-dispatch insufficient gas or pending nonce; any uncertain
  post-send error stops wallet switching to avoid duplicate resolve. Candidate
  skips have their own event mode, so strict analysis counts only actual resolve
  transactions. The fresh run started at `2026-07-17T23:51:19.638Z`; early
  evidence shows successful MANUAL fallback resolves and zero failed resolves.
- Compact soak status now includes the last valid event timestamp and event age,
  allowing stall diagnosis without reading raw JSONL. The live run reached 9
  successful unique bets with zero failures, reverts, or duplicate tx/nonces;
  focused syntax, lint, and logic checks pass. Isolated SQLite and monitoring
  drills also pass, including read-only/corrupt/disk-full rejection and 10
  alert/recovery pairs with no duplicate alerts after restart.
- At 52 successful epochs, a live-contended one-shot indexer catch-up ingested
  the new range without missing epochs. The following read-only 50-epoch
  chain/indexer audit passed with zero missing, duplicate, or mismatched records.
  Soak status no longer calls every event written while RPC injection is enabled
  a failover event: it labels those as injection-tagged events and separately
  counts send phases crossing the 20-second transport timeout. At 55 successful
  bets there were 3 such slow sends, with no failed, reverted, or duplicate tx.
- The run stopped at 64 successful unique bets because the host volume reached
  `ENOSPC`. There were zero reverted or duplicate transactions; the final
  application failure was a safe epoch-window miss after health telemetry had
  already exposed storage pressure. Generated `.next-*` directories are the
  dominant removable workspace usage, but recursive cleanup requires explicit
  user approval and was not bypassed. Data-sync health now reports private
  `diskFreeBytes`; soak summaries retain its minimum/delta, and runtime monitor
  emits and recovers a `disk-free-space` alert below a 1 GiB default. Typecheck,
  focused lint, logic, and the 11-alert monitoring drill pass.
- Added a separate `SOAK_MIN_DISK_FREE_BYTES` preflight with a 1 GiB default.
  It runs before starting the server or canary; the current low-disk host
  correctly fails the transaction-free dry-run before any runtime child starts.
- Preflight and lock-acquisition failures no longer run the managed shutdown
  writer, so they preserve the previous `status.json` and evidence pointers.
  A repeated low-disk dry-run exited 1 while the status-file SHA-256 remained
  unchanged.
- Targeted security/regression review of the disk-pressure patch found and fixed
  a clean-checkout edge case: capacity checks now walk to the nearest existing
  parent of an external/nonexistent soak output directory while staying on its
  volume. The private Admin Ops storage panel shows free GiB, while public
  data-sync health explicitly redacts the field. Fresh-directory preflight,
  typecheck, focused lint, and logic redaction guards pass.
- Added an allowlisted generated-build cleanup command. It defaults to dry-run,
  accepts only root-level `.next-candidate*` directory names, and performs
  recursive removal only through the separate `cleanup:next-candidates:apply`
  script. Dry-run found 11 candidates; no directory was removed.
- After external disk space recovered to more than 2.5 GiB, the full local
  baseline passed: typecheck, logic, V9 invariants, compilation provenance,
  production build, responsive browser smoke, and HTTP smoke with the documented
  local-only weak-identity bypass. A new soak then failed before its first bet.
  Safe preflight classification now records only `enoughEth`/`enoughToken` and
  a bounded error kind; transaction-free rerun identified insufficient native
  gas for `AUTOMINER_C` with token sufficiency intact. No automatic transfer or
  reduced-wallet run was attempted.
- Rechecked production dependencies after the latest patches: npm production
  audit reports zero high/critical advisories, and Privy/wagmi share the pinned
  viem peer. A fresh local-only 60-second production load completed 38,558
  requests at 642.2 req/s with zero failures, aggregate p95 520 ms and p99
  708 ms; expected 429 responses were counted as successful rate-limit behavior.
- Added a browser regression scenario that keeps the epoch fixed, changes the
  live pool snapshot, and requires the rendered pool-chart SVG path to update.
  Targeted ESLint and the full production desktop/tablet/mobile browser smoke
  pass; the local server was stopped afterward.

## Update Rule

Append only short entries that materially change current state, verification,
blockers, or the next step. Move completed history to a dated archive before this
file grows beyond a compact handoff.
