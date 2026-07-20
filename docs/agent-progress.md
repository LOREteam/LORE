# Agent Progress

Compact durable handoff for active work only. Full history through 2026-07-13 is
archived in
[`docs/archive/agent-progress-through-2026-07-13.md`](archive/agent-progress-through-2026-07-13.md).
Current repository truth lives in [`docs/current_state.md`](current_state.md).

## Active Handoff

- A funded managed three-role soak was stopped after six successful unique
  bets and three receipt timeouts from `AUTOMINER_A`. The timed-out sends were
  actually broadcast but the old evidence path mislabeled them as pre-send;
  there were no duplicate hashes/nonces or confirmed reverts.
- `AUTOMINER_A` currently has a pending nonce queue. The canary now preserves
  hash/nonce evidence after receipt timeout, refuses another send while pending
  exceeds latest nonce, and applies the same guard in transaction-free
  preflight. Do not restart until that preflight passes; keep `AUTOMINER_C`
  excluded.
- Browser-profiler hardening classifies only exact local
  Next RSC aborts and the Coinbase Wallet SDK COOP `HEAD` probe as expected;
  both remain separately counted and all other local failures still degrade the
  baseline.
- Route-cache writes now supersede older async builds without allowing stale
  watermark/snapshot commits. Direct epochs, rewards, and private data-sync
  builds release version metadata on both success and failure.
- A second claim/settlement/flush symmetry pass found no new contract change:
  all external money-moving paths remain non-reentrant, close liabilities before
  transfer, and preserve atomic rollback and duplicate-safe batch behavior.
- Focused typecheck, business logic, monitoring drill, contract invariants,
  dependency audit, production build, responsive browser smoke, HTTP smoke, and
  diff hygiene pass. The required MetaMask connector remains installed because
  wagmi/Privy resolves it during production compilation.
- The latest and fixed historical chain/indexer audit windows both pass after an
  integrity-checked backup and one bounded legacy fee-flush repair pass.
- Active objective: monitor the accepted Linea Sepolia testnet candidate and fix
  only evidence-backed regressions.
- Mainnet G1-G14 collection and transition work are paused.
- Existing authenticated wallet/mobile/Auto-Miner evidence was accepted; several
  reruns were explicitly waived and must not be described as fresh evidence.
- Browser-only work must use the UI-only runner. The composite development runner
  also starts operator workers and must not be used for passive UI inspection.
- Preserve visible live-state and pool-chart freshness.

## Latest Completed Work

## 2026-07-21 - Production dependency high-advisory closure

- A fresh production audit exposed four high advisories through Sentry's
  `glob -> minimatch -> brace-expansion` chain. Scoped nested overrides now
  resolve `brace-expansion` 5.0.7 without changing wallet dependency versions
  or forcing incompatible legacy minimatch trees.
- Updated the business-logic source guard after the mobile touch-target check
  moved into its shared flow helper; it now requires the shared 44px threshold
  and Hub/Safety Pool/Leaderboards call sites.
- Production audit has zero high/critical advisories. Business logic, V9
  invariants, focused ESLint, typecheck, wallet peer integrity, and production
  build pass; EIP-7702 remained disabled.

## 2026-07-21 - Mobile tab touch-target coverage

- Extracted the existing visible-control touch-target assertion and reused it
  across the mobile Hub, Analytics, Safety Pool, and Leaderboards screens.
- Safety Pool older-history and Leaderboards retry/refresh actions now keep a
  44px minimum height without changing global compact button sizing.
- Typecheck, focused ESLint, production build, and full responsive browser
  smoke pass, including the same-epoch pool-chart freshness scenario. EIP-7702
  remained disabled and the temporary production server was stopped.

## 2026-07-20 - Chat profile keyboard regression coverage

- Responsive browser smoke now verifies the profile dialog's initial focus,
  reverse-tab wrap, Escape close, and opener-focus restoration. The focused
  ESLint check and full desktop/tablet/mobile browser smoke pass; production UI
  code was unchanged and the temporary server was stopped.
- Profile, Close chat, and Close profile icon controls now use stable 44px touch
  targets. Smoke measures all three controls; typecheck, focused ESLint,
  production build, and responsive browser smoke pass.
- The jackpot result overlay close control also uses a 44px target; focused
  TypeScript, ESLint, and diff hygiene pass.
- Chat header icon controls are non-shrinking, closing a measured narrow-panel
  regression below 44px. Analytics deposit/jackpot refresh controls are 44px;
  mobile smoke measures the visible deposit refresh target. Typecheck, focused
  lint, production build, and responsive browser smoke pass.
- Mobile Analytics smoke now scans every visible interactive control instead of
  one known refresh button and preserves accessibility failures across
  navigation retries. It exposed and fixed a 30px `Load History` action; the
  strict scan, typecheck, lint, build, and responsive smoke pass.

## 2026-07-20 - Route-cache ownership race hardening

- Invalidated in-flight and background-refresh promises now release cache
  ownership only when they still own the registered entry. A superseded async
  completion can no longer delete the replacement promise and allow duplicate
  route builds.
- A behavior test reproduces invalidation followed by overlapping old/new
  builds. Business logic, TypeScript, focused ESLint, and diff hygiene pass.
- Epochs, rewards, rebate discovery, reward summaries, and data-sync health now
  pass their registered promise into cleanup as well, so legacy route paths use
  the same ownership guarantee as the shared versioned wrapper.
- The broadened production build, SQLite operational drill, monitoring
  alert/recovery drill, and responsive browser smoke pass. EIP-7702 remained
  disabled and the temporary production server was stopped.

## 2026-07-20 - Exact clean-checkout reproduction after hardening

- Detached commit `00ba0570` installed from the lockfile in an isolated
  worktree and passed wallet dependency-tree integrity, typecheck, business
  logic, V9 invariants, and production build without copying `.env`.
- Install initially hit Windows sandbox `EPERM` on the shared npm cache; the
  permitted retry succeeded. EIP-7702 stayed disabled and the temporary
  worktree was removed after verification.

## 2026-07-20 - Post-hardening production baseline

- Re-ran V9 contract invariants and the production build after the claim,
  resolver, console, storage, and secret hardening commits; both pass and the
  build confirms EIP-7702 remains disabled.
- Full local responsive browser smoke passes, including wallet selectors,
  number typography, empty/fresh pool chart, Safety Pool, mobile overflow, and
  accessible control names. HTTP smoke first failed closed at 503 without
  trusted proxy identity, then all checks passed with the documented local-only
  weak-identity fixture. The temporary production server was stopped.

## 2026-07-20 - SQLite operational error redaction

- All shared SQLite write, transaction rollback, and scoped-artifact cleanup
  errors now pass through the existing server sanitizer before console output.
  Operational error name/message remain available without exposing embedded
  wallet, RPC, URL, token, or secret-like fragments.
- Indexer storage, business logic, TypeScript, focused ESLint, and diff hygiene
  pass.

## 2026-07-20 - Claim and resolver duplicate-send guards

- Safety Pool batch claiming now exits immediately on wallet rejection and
  classifies every post-submit confirmation outage as ambiguous pending unless
  an on-chain revert is proven. It no longer splits or retries a submitted batch
  when receipt or claim-state RPC reads are unavailable.
- Bootstrap resolve now fails closed in production when its SQLite coordination
  lock is unavailable. The process-local throttle remains development-only, so
  multi-instance or restart scenarios cannot silently bypass the shared lock.
- Business logic, TypeScript, focused ESLint, and diff hygiene pass. No live
  transaction was sent.

## 2026-07-20 - Browser console fallback redaction

- The global render-error fallback and the browser `console.error` interceptor
  now pass normalized values through the existing support-log sanitizer before
  writing them to the console. This closes the path that previously preceded
  persisted-log and Sentry redaction.
- Business logic source guards, TypeScript, focused ESLint, and diff hygiene
  pass. No user-visible error recovery behavior changed.

## 2026-07-20 - Storage warning redaction and production secret floor

- Malformed SQLite/indexer values now emit fixed diagnostic labels instead of
  interpolating raw payloads or parser errors. A focused storage test injects a
  sensitive marker and proves that it does not reach `console.warn`.
- Mainnet validation now requires at least 32 characters for the effective
  diagnostics, chat-auth, admin-auth, and bootstrap-resolver secrets. Existing
  fallback relationships are preserved; only weak effective values fail.
- Indexer storage, business logic, TypeScript, focused ESLint, and diff hygiene
  pass. No runtime transaction, contract, or testnet configuration was changed.

## 2026-07-20 - Pending receipt and nonce-queue fail-closed guard

- Reproduced three receipt timeouts from one soak role and confirmed a pending
  nonce queue. The managed supervisor was stopped before more sends accumulated.
- Timed-out sends now retain hash, nonce, phase timing, and `pending` status;
  supervisor summaries classify them as post-send `receipt-timeout` evidence.
  A wallet with `pending > latest` is blocked both immediately before dispatch
  and during transaction-free preflight.
- Business logic, TypeScript, focused ESLint, and diff hygiene pass. A real
  dry-run now fails closed with `pending-nonce-blocked` and zero transactions.
  No automatic nonce clearing or replacement transaction was attempted.

## 2026-07-20 - Paginated Safety Pool history

- Added a rate-limited, no-store Safety Pool history page over indexed wallet
  participation. Each explicit request reads at most 32 epochs in one atomic
  multicall; partial RPC results fail the page without advancing its cursor.
- The Safety Pool tab can load older epochs on demand. Pages are deduplicated,
  overflow balances join the visible total and claim plan, refresh cannot erase
  loaded pages, and claim completion clears stale older rows before reloading.
- Normalization, merge, bounded-route, and explicit-load guards pass with
  focused ESLint, business logic, TypeScript, diff hygiene, and a production
  build that registers `/api/rebate-history`. A first local HTTP run without
  proxy identity failed closed at 503; the documented localhost-only identity
  fixture then passed all HTTP checks, including the new page shape.

## 2026-07-20 - Wallet Settings focus-trap reuse

- Wallet Settings now uses the shared dialog focus trap instead of maintaining
  a weaker duplicate. Hidden controls are excluded, escaped focus is recovered,
  Escape closes the dialog, and focus returns to the opener.
- Focused ESLint, business logic, typecheck, and diff hygiene pass. The managed
  soak remains stopped at transaction-free preflight because two allowed roles
  lack native gas; no transaction was sent and `AUTOMINER_C` stays excluded.

## 2026-07-20 - Inline credential redaction

- Closed a shared logging boundary gap: server, Sentry, and support sanitization
  now removes bare 64-hex secrets, assignment-style credentials, and JWT values
  embedded in error strings. Public transaction hashes remain preserved only in
  their allowlisted support-log fields.
- Scoped lint, business logic, and diff hygiene pass. Codex Security diff-scan
  remains unstarted because its mandatory capability preflight produced no
  result in both worker and direct execution; no scan result is being claimed.

## 2026-07-20 - Two-minute production browser attribution

- Traced the reproducible local `HEAD /` abort to the Coinbase Wallet SDK COOP
  header probe rather than application polling or an API timeout. A direct
  `HEAD /` returns `200`; the profiler now ignores only that exact current-path
  `HEAD` fetch abort and reports its count separately.
- The repeated 120-second profile passes with zero failed local responses,
  requests, or console errors; 17 same-origin API requests/minute; zero DOM
  growth; heap ending below its initial sample after GC; CLS 0; local lab LCP
  1,204 ms and synthetic INP 24 ms. One external provider failure remains
  visible but does not misclassify site runtime health.
- Scoped lint, business logic, and diff hygiene pass. The soak remains stopped
  because the unchanged transaction-free preflight reports insufficient native
  gas for `AUTOMINER_A` and `AUTOMINER_B`; no transaction was sent.

## 2026-07-20 - Exact clean-checkout baseline

- Created local baseline commit `3bc812e` and reproduced it in a detached clean
  checkout. Lockfile install, wallet peer integrity, lint, typecheck, logic,
  contract invariants, compile provenance, SQLite drills, monitoring recovery,
  production build, and responsive empty-DB browser smoke all passed. EIP-7702
  stayed disabled; the temporary server/worktree were removed. Push remains
  intentionally pending a fresh explicit request.

## 2026-07-20 - Trusted proxy deployment contract

- Closed an operational spoofing ambiguity in the production runbook: the edge
  must strip all client-supplied trust/IP headers, inject its protected secret,
  overwrite one verified client-IP header, and block direct public access to
  the app origin. Business-logic guards preserve these requirements. Real
  proxy/two-replica evidence remains an external staging check.

## 2026-07-20 - Dialog focus recovery hardening

- Hardened the shared dialog focus trap used by the backup gate and first-visit
  tutorial: hidden and `aria-hidden` controls are excluded, initial focus falls
  back to the dialog container, and Tab/Shift+Tab recover focus if it escapes
  the active dialog. Focused ESLint, business-logic guards, typecheck,
  production build, and full responsive browser smoke pass; the temporary
  local server was stopped afterward.

## 2026-07-20 - Indexed claim candidate pagination

- Added a bounded cursor-based API over indexed wallet participation. Pages are
  deduplicated by epoch, capped at 400 rows, rate limited, and never trigger
  browser-wide historical RPC polling.
- Deep Reward Scan now checks only indexed epochs where the embedded Privy
  wallet actually participated. It no longer scans every protocol epoch and no
  longer falls back to the external wagmi address when a Privy address exists.
- SQLite pagination/duplicate tests, scoped ESLint, typecheck, contract
  invariants, and business-logic tests pass. Dependency audit remains at zero
  critical/high advisories; moderate/low wallet-tree upgrades remain separate
  compatibility work.
- Full indexed Safety Pool history is available through bounded on-demand pages;
  the normal background rebate summary remains capped at 5,000 participating
  epochs so routine refresh does not become an unbounded RPC scan.
- Codex Security scan `7c15831c-78e4-4e9c-9ae2-b1b6a6932abc` has complete
  2/2 coverage artifacts and zero findings for its old snapshot, but finalization
  now rejects it because repository HEAD changed. Do not treat it as coverage of
  the current worktree; start a fresh diff scan after the changes are frozen.

## 2026-07-19 - One-year unclaimed rebate settlement candidate

- The V9 source candidate tracks aggregate rebate claims and lets any caller
  settle the unclaimed remainder to the timelocked `feeRecipient` after the
  existing 365-day claim window. Bet and resolve paths are unchanged; rebate
  claims add one accounting write so settlement cannot overdraw shared funds.
- A batch entrypoint closes multiple mature epochs in one transaction and makes
  one aggregate token transfer. Unresolved, immature, duplicate, and already
  settled epoch entries are safely skipped; a batch with no recoverable dust
  reverts without moving funds.
- The existing winning-reward dust path now has the same batch capability, so
  mature unclaimed winnings and mature unclaimed rebates can both be settled
  without one token transfer transaction per epoch.
- The client ABI and contract invariants cover the new getter, settlement call,
  batch call, and events. The current deployed testnet contract is unchanged;
  this behavior requires a future redeploy.
- Contract invariants, business logic, focused lint, typecheck, exact Solidity
  compilation provenance, and `git diff --check` pass. Optimized bytecode grew
  by 1,457 bytes to 15,723 bytes; normal bet and resolve code paths are
  unchanged.
- White Paper now includes concise player terms and risk disclosure. The
  Scheduled Mining Sessions launch experiment is parked in
  `docs/product-backlog.md` and is not active runtime behavior.

## 2026-07-19 - Current-commit clean-checkout reproduction

- Exact commit `23e611f` was exported into an isolated checkout and installed
  1,167 lockfile packages. EIP-7702 remained disabled during install, build,
  and start; wallet dependencies retained one deduplicated `viem@2.50.4`.
- Typecheck, logic, contract invariants, Solidity compilation provenance, and
  production build passed. With the existing redacted runtime fixture and the
  documented local-only weak-identity override, all 23 HTTP checks and the full
  responsive browser smoke passed.
- The first HTTP attempt without the local override correctly failed closed with
  `Trusted proxy identity unavailable`; no production limiter behavior changed.
  The temporary checkout, copied `.env`, server, build output, and dependencies
  were removed after verification.

## 2026-07-19 - Bounded estimate-gas recovery

- Added two bounded retries only around pre-send gas estimation when the exact
  RPC failure is `eth_estimateGas` method unavailable. Reverts and transaction
  sends are never retried by this helper.
- Canary evidence records recovered estimate retries and compact soak status
  aggregates them. The default role set is now exactly MANUAL, AUTOMINER_A, and
  AUTOMINER_B.
- Two configured read endpoints passed repeated transaction-free estimate
  probes. Typecheck, logic tests, and dry-run pass; live execution remains
  blocked by AUTOMINER_B native gas, with zero transactions sent in that start.
- Browser smoke exposed and verified two chart guards: the empty pool trace now
  has non-zero SVG geometry, and the same-epoch freshness fixture now follows
  the current chain epoch instead of stale hard-coded epoch 500. Full responsive
  smoke passes with the existing five-second live-state polling unchanged.
- Added a bounded `--end-epoch` selector to the read-only chain/indexer audit.
  After repair catch-up, the exact historical 50-epoch window and the latest
  window both passed with zero mismatches; logic tests now guard the bounded SQL.
- SQLite fault/backup operations, alert fire/recovery drills, production and
  full dependency audits, wallet dependency integrity, compile provenance, and
  local launch preflight all pass. Production dependencies have zero high or
  critical advisories; coordinated wallet upgrades remain separate work.
- Focused security review found no new send/retry path: only pre-send gas
  estimation retries, while contract reverts and transaction sends fail closed.
  Typecheck, logic, contract invariants, and `git diff --check` pass.

## 2026-07-18 - Clean-checkout proof for soak diagnostics

- Detached commit `bbe02a7` installed 1,167 lockfile packages; EIP-7702 stayed
  disabled and wallet peer integrity remained clean.
- Production audit passed with zero critical/high advisories; full lint,
  typecheck, logic, contract, provenance, SQLite, monitoring, and build gates
  passed. Compilation remained Solidity 0.8.34, optimizer 200, EVM Osaka.
- A fresh empty SQLite runtime passed all 23 HTTP checks and the complete
  responsive browser smoke, including wallet selector, pending reload recovery,
  number fonts, mobile overflow, empty chart/history states, and pool freshness.

## 2026-07-18 - Redacted soak preflight diagnostics

- A fresh transaction-free soak preflight stopped before any bet because
  `AUTOMINER_C` lacks native gas; the other three configured roles passed.
- `soak:testnet:status` now reports only allowlisted preflight role/reason pairs
  and does not surface raw error, address, RPC, or secret fields.
- A synthetic CLI status check, the real failed preflight artifact, focused
  ESLint, and `test:logic` all verify the behavior.

## 2026-07-18 - Clean-checkout proof for forced-refresh bound

- Created a detached checkout at exact published commit `188fea1`; `npm ci`
  installed 1,167 packages and kept EIP-7702 disabled.
- Wallet dependency integrity, production audit (0 high/critical), full lint,
  typecheck, logic, contract invariants, compilation provenance, SQLite fault
  drills, monitoring recovery, and production build passed.
- A new empty SQLite production runtime passed all 23 HTTP checks and the full
  responsive browser smoke, including numeric fonts, empty jackpot state, and
  same-epoch pool-chart freshness. Privy's wallet selector needed its existing
  bounded first-attempt retry once and then loaded MetaMask/Coinbase normally.
  The runtime was stopped and the detached checkout remained clean.

## 2026-07-18 - Bounded forced jackpot refresh

- A deterministic failure injection seeded an isolated SQLite with a valid
  post-deploy jackpot row and replaced `getBlockNumber` with a never-resolving
  RPC promise. `fresh=1` reproduced an unbounded server wait.
- Forced refresh now waits at most two seconds. Fast recovery still returns the
  rebuilt payload; slow recovery remains one deduplicated in-flight promise and
  the request returns stored/cache data instead of hanging.
- The same injection completed through the bounded stale path. Focused logic,
  ESLint, typecheck, production build, all 23 HTTP checks, and responsive browser
  smoke passed. A healthy `fresh=1` request returned 200 in 375 ms, and the pool
  chart freshness guard remained green.

## 2026-07-18 - Post-fix production load profile

- Ran the weighted homepage/API harness for 30 seconds at concurrency 50 against
  a production build with a new SQLite path.
- Completed 11,385 requests at 378.4 requests/second with zero unexpected
  failures. Aggregate p50/p95/p99 were 68/816/1,092 ms; live-state p95 was
  114 ms and jackpots p95 was 121 ms.
- The 4,854 HTTP 429 responses came only from intentionally bounded APIs and
  were classified separately from failures. Homepage and live-state remained
  unthrottled, and the preceding browser smoke retained the pool-chart freshness
  guard. The temporary runtime was stopped.

## 2026-07-18 - Clean-checkout proof for bounded jackpot recovery

- Created a detached checkout at exact published commit `e7a75b4` and installed
  1,167 packages with `npm ci`; postinstall kept EIP-7702 disabled.
- Wallet dependency integrity, production dependency audit (0 high/critical),
  full lint, typecheck, logic, contract invariants, compilation provenance,
  SQLite fault drills, monitoring recovery, and production build passed.
- On a new empty SQLite path, the first `/api/jackpots` returned 200 in 340 ms,
  `fresh=1` returned 200 in 15 ms, all 23 HTTP checks passed, and the full
  responsive browser smoke preserved number fonts, empty states, and pool-chart
  freshness. The temporary runtime was stopped and the checkout remained clean.

## 2026-07-18 - Bounded empty-DB jackpot cold start

- Reproduced `/api/jackpots` blocking for three 60-second smoke timeouts when a
  new SQLite database had no indexed jackpot rows and the route synchronously
  scanned chain history.
- Empty storage now returns an explicit empty/stale payload immediately and uses
  the existing deduplicated background recovery. The same bounded path covers
  `fresh=1` without reducing client refresh frequency.
- On a new isolated SQLite path, the first normal request returned 200 in 231 ms
  and `fresh=1` returned 200 in 15 ms. Logic, focused ESLint, typecheck,
  production build, all 23 HTTP checks, and responsive browser smoke passed;
  pool-chart freshness and empty jackpot history remained covered.

## 2026-07-18 - Activated Next.js 16 security Proxy

- A direct production response check proved that `app/middleware.ts` was not
  active: CSP and the related hardening headers were absent. Next.js 16 requires
  root `proxy.ts` at the same level as `app`.
- Moved the existing policy without weakening it and renamed the handler to the
  Next.js 16 `proxy` export. Build now reports `Proxy (Middleware)`.
- HTTP smoke now rejects missing CSP, clickjacking, MIME-sniffing, referrer, or
  permissions protections. Focused lint, typecheck, logic, production build,
  HTTP smoke, and full responsive browser smoke pass with headers enforced.

## 2026-07-18 - Clean-checkout proof for profiler quality patch

- Created a detached temporary worktree at exact commit `02e3660`. The first
  `npm ci` could not access the sandboxed npm cache; after removing only that
  partial temporary install, one cache-enabled retry installed 1,167 packages
  from the lockfile with EIP-7702 still disabled.
- Wallet dependency integrity, production audit, lint, typecheck, business
  logic, contract invariants, exact compilation provenance, SQLite operations,
  monitoring alert/recovery, production build, and full responsive browser smoke
  passed. The smoke retained pool-chart freshness and covered desktop, tablet,
  mobile, wallet selectors, numeric typography, Auto-Miner persistence,
  accessibility, and empty-state guards.
- The temporary server stopped, the worktree had no tracked changes, and the
  isolated checkout was removed.

## 2026-07-18 - Browser-profile quality verdict

- Browser profiling now counts local and external network failures separately
  and marks reports with local HTTP, request, or console failures as degraded.
- A 10-second valid local production run reported `quality=pass`; the same run
  without the documented local identity bypass reproduced two protected API
  failures and reported `quality=degraded` with both reasons.
- Business logic tests pass, and no application polling cadence was changed.

## 2026-07-18 - Five-minute production-browser profile

- Ran a transaction-free desktop profile against the local production build
  with the documented local-only rate-limit identity bypass.
- Zero local response or console failures occurred. JS heap finished 239,518
  bytes below its initial sample, DOM grew by one node, and API polling averaged
  16.6 requests/minute. The intentionally fresh live-state path accounted for
  12/minute; no polling or memory defect was reproduced.
- Compact evidence is in `docs/testnet-browser-profile-2026-07-18.md`; the raw
  profiler JSON remains an ignored local artifact.

## 2026-07-18 - Fresh post-CI chain/indexer audit

- A read-only 50-epoch audit over epochs 417-466 compared finalized chain logs
  with the current scoped SQLite index. It matched 50 resolves, 45 bets, and 45
  resolver reward accruals with zero missing, duplicate, or mismatched rows.
- The audit sent no transaction and wrote only its ignored compact JSON result.

## 2026-07-18 - Current-commit clean-checkout reproduction

- Created a detached temporary worktree at exact commit `82d8d4a`. The first
  `npm ci` ended on a transient network `ECONNRESET`; after removing only that
  partial install, the single retry installed 1,167 packages from the lockfile.
- Wallet peer integrity, production audit, lint, typecheck, business logic,
  contract invariants, exact compilation provenance, SQLite operations,
  monitoring alert/recovery, production build, and full responsive browser smoke
  passed in the isolated checkout. Browser smoke covered numeric typography,
  persistent and failure-state Auto-Miner UI, pending reload/reopen recovery,
  mobile layouts, empty states, and live pool-chart freshness.
- The temporary server was stopped and the isolated worktree was removed. The
  push workflow is configured for all branches, but the available connector
  cannot read push-triggered runs, so this is local clean-checkout evidence rather
  than a claim about the current remote Actions run.

## 2026-07-18 - Targeted Sentry dependency hardening

- Updated only `@sentry/nextjs` from 10.56.0 to 10.66.0. The resulting
  OpenTelemetry 2.9.0 tree removes the unbounded W3C baggage advisory while
  leaving Privy, wagmi, and viem versions unchanged.
- The refreshed production audit reports 29 findings, with zero high or critical
  findings. Remaining wallet advisories, including `uuid`, require a coordinated
  breaking dependency upgrade and were not force-fixed.
- Wallet peer-integrity proof, typecheck, logic tests, production build, and all
  23 production HTTP smoke checks pass. The temporary server was stopped and
  port 3001 is free.
- A fresh 30-second production browser baseline on the same bundle completed
  with zero failed local responses, zero DOM growth, a -822,313 byte final heap
  delta, CLS 0, no horizontal overflow, and 24 ms synthetic INP. Four CSP
  messages were external Privy-origin diagnostics; no local CSP violation was
  observed. The profiling server was stopped.
- Browser baseline diagnostics now retain `consoleErrorsByTarget`, separating
  local application errors from external wallet/provider errors without hiding
  either. The focused logic guard and a 10-second production runtime check pass;
  the runtime check had zero console errors and zero failed responses.

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
- A clean production site cold start with a new SQLite path passed all 23 HTTP
  smoke checks. Initial RPC ranking made the first data-sync/jackpot reads slow,
  but subsequent expired-cache data-sync refresh completed in 371 ms and the
  timeout did not reproduce.
- An unavailable DB path failed before opening a listener. A separate process
  with an unreachable primary RPC recovered through the configured fallback:
  homepage, live-state, runtime/data-sync health, leaderboards, chat, and global
  stats all returned 200; live-state was 26 ms and data-sync was 366 ms.
- A production proxy-identity drill rejected missing secret, wrong secret, and
  malformed forwarded IP with 503. A trusted IP received exactly the configured
  30 runtime-health requests before 429 responses; a second IP had an independent
  bucket, while alternating User-Agent values behind one NAT/IP shared the same
  limit. External-store behavior across two replicas still needs deployed proof.
- On a separate empty-DB process, public runtime health remained `ok` while
  data-sync correctly returned `degraded`, redacted diagnostics, no indexed
  block, and the missing-epoch count instead of presenting a false healthy state.
- A real online backup of the current testnet SQLite was written outside the
  repository and restored from that exact backup into a distinct external path.
  Source and restored copies both returned `integrity_check=ok`; all 15 tables,
  963 rows, and the hashed last-indexed metadata matched. The configured daily
  PM2 backup schedule remains covered by the process-model preflight.

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
- Start a fresh targeted Codex Security diff scan for the current snapshot. The
  prior two-file scan closed coverage 2/2 with no reportable findings, but its
  finalizer correctly refused sealing after repository HEAD advanced.

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
## 2026-07-19 - Mutation-path and ambiguous-send hardening

- Audited every V9 claim, settlement, resolver-liability, fee-flush, and bet transfer path for replay, zero rounding, state-before-transfer ordering, and operational evidence.
- Mixed batch reward claims now skip zero-rounded payouts before closing state. Annual reward/rebate dust settlements are persisted by the indexer and compared against chain events.
- Ambiguous Privy silent-send timeouts now persist a nonce-only pending guard, preventing a manual repeat click from creating a second bet while the first send outcome is unknown.
- Batch bets now update epoch/user aggregate volume once per transaction instead of once per tile, avoiding up to 48 redundant aggregate storage rewrites for a 25-tile bet without changing accounting or ABI.
- Claim/indexer mutation audit: normalized batch-claim, resolver-reward, and dust-settlement evidence into scoped O(1) SQLite upserts; preserved legacy reads; fixed jackpot flags when award logs precede resolve; suppressed reward/rebate fallback resends after ambiguous wallet submission timeouts. Open launch gap: one-year claim window still exceeds the 5,000-epoch automatic discovery horizon.
- Contract/model logic, exact optimizer/Osaka compilation provenance, TypeScript, full lint, production HTTP smoke, and diff hygiene pass. Open product/protocol decisions remain documented in `docs/testnet-deep-audit-2026-07-19.md`.

## 2026-07-20 - Indexed claims and funded soak baseline

- Reward/rebate discovery now pages only indexed participating epochs and prefers the embedded Privy address; storage pagination and duplicate-boundary coverage pass.
- Fixed two browser-smoke races: empty-state coverage now uses a valid positive epoch, and same-epoch chart freshness waits for a request made after the pool mutation. Scoped ESLint, production HTTP smoke, and the full responsive browser smoke pass.
- A funded three-role testnet soak is running under the managed supervisor with `AUTOMINER_C` excluded. Preserve this worktree snapshot and monitor it through `soak:testnet:status`; do not start a second supervisor.

## 2026-07-20 - Soak safety stop and final local baseline

- The managed run produced 384 successful unique bets across the three funded
  roles with no duplicate tx/nonces, no on-chain revert, and healthy runtime,
  DB, WAL, and disk telemetry. It stopped at the configured 20-failure gate
  after only `AUTOMINER_A` began failing before send.
- The required transaction-free rerun failed closed before any transaction and
  identified insufficient native gas for `AUTOMINER_A` and `AUTOMINER_B`.
- Added bounded nested Viem custom-error decoding and the missing
  `ERC20InsufficientBalance` ABI declaration so future status can distinguish
  funding, epoch-state, nonce-state, and contract-call failures without raw
  provider errors.
- Restored `@metamask/connect-evm`: wagmi/Privy requires it during production
  compilation. Typecheck, business logic, V9 invariants, production build,
  responsive browser smoke, HTTP smoke, and diff hygiene pass.
- Fixed the historical chain/indexer accounting audit so it does not require a
  configured multicall contract. The first real run exposed four legacy missing
  fee-flush rows; after an integrity-checked SQLite backup and one bounded
  indexer repair pass, both the latest 50-epoch window and the original fixed
  historical window pass with zero accounting or event mismatches.
- The homepage now loads independent live-state and recent-wins SSR bootstrap
  data concurrently instead of adding their cold waits. On the same local
  production profile, homepage p95 improved from 1,545 ms to 1,279 ms, total p95
  from 994 ms to 854 ms, and throughput from about 322 to 390 req/s. The new run
  completed 23,437 requests with zero unexpected failures; it is local evidence,
  not a substitute for final HTTPS canary load proof.
- Corrected the remaining White Paper sentence that described the protocol fee
  as an exact half split before the resolver reward. Public copy now consistently
  states 0.05% resolver reward followed by an approximately equal split of the
  remaining 1.95%; the source guard and business-logic suite pass.
- Safety Pool state now resets its loaded/cache timing when the active Privy
  address changes and invalidates the previous wallet's in-flight response. This
  prevents stale balance/history display and a delayed cross-wallet overwrite;
  scoped lint, logic, typecheck, production build, and responsive browser smoke
  pass.
