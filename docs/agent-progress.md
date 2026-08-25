# Agent Progress

Last updated: 2026-08-26.

Current truth is in [`current_state.md`](current_state.md). The active queue is
[`remaining-worklist.md`](remaining-worklist.md); long-running testnet work is
in [`testnet-hardening-plan.md`](testnet-hardening-plan.md).

## Continuation point

- The current tested code baseline and parent of this documentation-only packet
  is `c4f921db3`. Exact clean SHA `7918fba2a` reproduced the required
  `test:logic:summary` failure under its former `300000ms` prelaunch watchdog,
  while the identical suite passed with a diagnostic `600000ms` child limit in
  `387897ms`. The correction makes the standalone default `600000ms` and gives
  prelaunch a separate `630000ms` watchdog with `30000ms` headroom; configured
  values remain bounded by the existing `900000ms` summary maximum. The
  post-fix full coordinator passed in `382920ms` with all API/wallet proof groups
  true and zero failures. Focused timeout/prelaunch tests x2, syntax, focused
  ESLint, audit x2, self-test `17/17`, exact manifest/digests, and protected DB
  identity pass. Audit schema v2 is `5821/6345` behavioral (`91.74%`), `524`
  source operands, `113` modules, and `71/2/71` coordinator fan-out. A new
  detached final-SHA seal remains required.
- The prior independently reviewed P1.10 baseline
  is `8797e30d3e985a8307ad24c721258da7a86f341a`. Its exact two-file P1.10
  packet removes one `LogSourceSummary` source regex only after the existing
  fresh admin-session child executes the real authorized `/api/admin/ops` GET.
  The public payload must omit an own `file` property from every `logSources`
  entry and must not contain the exact cross-platform escaped absolute runtime
  root anywhere. Focused x2, audit x2, self-test `17/17`, syntax, ESLint, diff
  hygiene, the full isolated business gate, clean-HEAD focused/audit
  reproduction, protected DB identity, and cross-platform escaping probes pass
  on Node `24.5.0`. The audit is now `5820/6344` behavioral (`91.74%`) with
  `524` source operands across `113` modules; coordinator fan-out stays
  `71/2/71`. Independent review found no P0--P3 issue and confirmed the domain
  child is wired into Ubuntu `test:logic` and Windows `test:logic:summary`; only
  local Windows execution is fresh, so hosted parity remains open. Parent
  `7eee0cd9b` is the independently reviewed AdminOps bounded-JSON client seam;
  all deployed/provider/live boundaries remain open.
- Earlier security-reviewed baseline `3c8886acc1fa33045aa7bcc1d03bab9fa84fd09b` closes the
  final deposits-recovery transport bound found by targeted security review:
  recovery head/log reads use one `http(RPC_URL, { timeout: 20_000,
  retryCount: 1 })` client, so `41 * 2 * 20s = 1,640,000ms` remains below the
  `1,800,000ms` shared lock. Focused recovery safety, TypeScript, and focused
  ESLint passed in a detached clean checkout; targeted Standard scan
  `d7d531b4-3c25-4c98-a2a4-afc8c314bd92` found no remaining issue in those
  corrected paths or OG asset origin. Fresh `npm ci` passed and the local proof
  summary passed L1--L17. Do not call the full `check-local` green for this SHA:
  its full run was stopped during a long active ESLint stage and recorded exit
  `4294967295`. No external/wallet/RPC/Preview action occurred.
- A historical P1 fixture packet restored the API recovery matrix
  after that transport split by mocking `depositsRecoveryPublicClient` for its
  head/log seams. It leaves the production client and route untouched. Two
  focused matrices pass 9 routes, 85 black-box requests, five mutants, and the
  shared two-process limiter; TypeScript and two behavior audits recorded
  `5819/6345` behavioral, 526 source operands, and self-test `17/17`.

- Branch `codex/repo-cleanup`; immutable baseline `HEAD` is
  `63da5c4428d429ddda7e5d5a8fd7df56f01e5c73`. Its clean detached worktree
  completed fresh `npm ci`, typecheck, hermetic build, and CI policy review.
  This is not final hosted/external proof.
- The former authorized 74-path packet is committed. The new uncommitted
  candidate fixes two discovered release-gate root causes: trusted npm now
  verifies canonical `C:\\WINDOWS` for a D:-drive checkout, and direct
  `check-local` uses the mandatory isolated business runner. The Preview env
  boundary runner is green twice (`30/30`); dependency audits are green under
  their documented high-severity policy. A disposable full check exposed and
  corrected its P1-runner 30-second timeout for this known 93-second boundary
  runner; the new bound is 150 seconds. The following lease-contention failure
  was a test liveness defect: the established owner now heartbeats after each
  intentionally bounded blocked-start probe, with focused coverage green twice.
  Local robots/sitemap smoke was also aligned to the deliberate noindex generic
  jackpot policy, with focused coverage green twice.
  Recompute its manifest before any
  new commit request; no current staging, push, deployment, wallet/RPC, or
  chain authority exists.
- The current P1.10 audit is `5820/6344` behavioral (`91.74%`) with `524`
  source operands across `113` modules. Direct coordinator fan-out is `71`
  imports, `2` side-effect imports, and `71` calls; the audit self-test passes
  `17/17`.
- The current cleanup dry-run is green: `0` matched and `0` would-delete; all
  `4` configured whole targets were absent/skipped, while protected `.tmp`
  recovery-prefix children were excluded. Exact-path cleanup removed `2092` ignored
  cache/debug files (`286147895` bytes), then removed TypeScript's regenerated
  four `.next` copies (`12` files, `85692` bytes), five old `.serena` cache/log files
  (`73911` bytes), and six unreferenced old summary/console files (`10998`
  bytes); an empty `output/` directory was also removed. Total exact removal is
  `2115` files / `286318496` bytes. The exact runtime/dependencies, current
  test/release evidence, recovery assets, browser state, project data, and
  SQLite files were excluded.
- The local test commit `8797e30d3` occurred; no push, deploy, hosted change,
  wallet/RPC, signing, or chain action occurred, and no actual Preview was
  generated. The only external read was
  the guest HTTPS probe already recorded below; it stopped at the TLS error.
- The turn-start protected trio was exact (`258048`-byte base,
  `280192`-byte WAL, `32768`-byte SHM), but a diagnostic common-suite import was
  mistakenly run without an owned temporary `LORE_DB_PATH`. Import-time storage
  initialization opened the configured protected path.
- The current state is stable across two read-only checks but changed: base
  `319488` bytes / SHA-256 `4EA3ECB92D5EFD081030F1C10E84C444E75460E628BB216FD063E72941BF38F7`;
  WAL and SHM absent. This is consistent with a checkpoint, but exact equality
  with the lost turn-start logical state is not claimed.
- `.tmp/protected-db-recovery-exact-20260823/` remains untouched. Its base
  matches the turn-start base, but its older `90672`-byte WAL and SHM do not
  reproduce the turn-start sidecars. Do not restore or mutate protected/recovery
  files without a separately reviewed plan and new exact approval. Run no
  DB-adjacent gate or server against this path; use owned OS-temp SQLite only.
- A forensic comparison used exact-verified disposable OS-temp copies only;
  originals remained byte-identical and the temp directory was removed. Both
  copies passed `quick_check`/`integrity_check`. Current is a logical superset of
  the available older recovery state: its `78` pages / schema `72` / `37` rows
  include all older data plus two `meta` rows and empty schema additions, versus
  recovery's `74` pages / schema `66` / `35` rows. Blind rollback would lose
  newer state and still would not reconstruct the missing turn-start WAL.
- Existing backup tools open their SQLite source; there is no exact lost-WAL or
  safe in-place protected-path recovery tool. The permission-gated first step is
  a raw no-overwrite current-base snapshot outside the repository after proving
  quiescence and pinning pre/post identities. SQLite work must stay on clones;
  any protected-path replacement requires another exact approval.

## Current verified local work

1. Global stats returns a fail-closed `503`/`no-store` response instead of
   fabricated zeros. Cached global values are explicitly stale until a
   successful current-epoch read.
2. Wallet UI now distinguishes unknown balances from real zero: null/malformed
   cache is unavailable, Header renders `Unavailable`, wallet settings uses `Unavailable`,
   transfer RPC errors suppress totals and offer retry, and a literal zero stays
   visible.
3. The Header skeleton is now conditional on a genuinely pending empty read;
   it no longer persists after a completed RPC no-data/error result.
4. Manual bet storage now waits for browser restore before first persistence,
   preserving saved amounts instead of overwriting them with the default.
5. Local campaign child commands disable rebuildable `tsx` cache, restore the
   environment fail-closed, and fail closed on launch anomalies.
6. Direct wallet-model and presentation tests, Header unavailable SSR coverage,
   the focused wallet-funding test, full isolated business runner, TypeScript,
   ESLint, script parse, and diff checks passed at the relevant local commits;
   protected DB snapshots remained exact.
7. An earlier uncommitted P1.10 snapshot reported `5576/6285` behavioral
   assertions (`88.72%`) with `709` source operands across `109` modules;
   coordinator fan-out was `86/2/86` and the self-test passed `7` cases. This
   snapshot is superseded by item 26. Preview
   execution tests run through both standalone P1 and the business-suite export
   without registering tests on inert import; focused release operations pass.
8. Bounded cleanup removed about `1.00 GiB` of old Node/npm caches plus
   `.next`, `tsconfig.tsbuildinfo`, and `4.4 MiB` of eleven aged `.tmp` outputs.
   No project data, campaign record, browser profile, protected SQLite, staged
   recovery set, or active runtime was removed.
9. Hub CTA now separates guest login from authenticated embedded-wallet setup:
   users wait while wallet state syncs, then get `CREATE WALLET` without a
   duplicate login action. Desktop and mobile actions share the existing
   in-flight guard.

10. Deposit and blockchain-round histories now retain a last verified snapshot
    (or remain null) after an API/RPC error and render an explicit unavailable
    or stale state rather than a false empty history.

11. Jackpot-share now requires the canonical finalized event identity
    `event=<txHash>:<logIndex>`: indexer/storage retain the event key,
    block hash, and finalized target; page and OG content derive entirely from
    that stored event. A legacy `tx` link is accepted only when it resolves
    exactly one canonical event, otherwise it fails closed. Generic
    `/jackpot-win` was removed from sitemap/robots because it has no canonical
    event identity.
12. Direct public URLs now pass their server-selected tab into the first app-shell
    render, and FAQ, White Paper, and Leaderboards are statically imported so
    SSR returns their requested content rather than Hub or a loading fallback.
13. The Hub onboarding checklist now exposes only the next safe existing action:
    login or wallet creation, Wallet Settings for backup/funding, or scroll to
    bet preparation. Unknown ETH never counts as gas-ready, and first-bet
    browser markers are scoped to the wallet address.

14. A new `scoped_user_activity` ledger now stores canonical indexed bets and reward/rebate claim events with user/block/event indexes and reorg rollback. Its API and Analytics panel explicitly label coverage `partial`: rows are durable once indexed, but existing raw history is not silently backfilled. The panel preserves loading, unavailable, stale, empty, and Explorer-link states rather than implying an empty complete history.

15. The local V10 Preview/consent packet now uses one exact canonical envelope
    binding target, provenance, roles, wallet set, caps, UUID challenge, matrix
    admission, log, and authorization. For the plan with `rounds=6` it permits
    at most `3` approvals, `12` bets, and `5` resolves (`20` writes),
    `maxAffectedEpochs=11`, `34600000000000000` wei native gas, and
    `maxFailures=1`.
16. Preview publication is atomic and bounded, rereads the canonical log, and
    parses fence-aware exact Markdown. A repository-local one-shot tombstone
    and single-flight lease are created before RPC; provenance and a second
    strict checker run before the first write. A global transactional
    multi-clone/host ledger is still required, and coherent local artifact
    tampering is not cryptographically prevented.
17. Focused verification passed: Preview environment `30/30`, envelope `9/9`,
    analyzer `10/10`, one-shot store `10/10`, enforcement `2/2`, fee policy,
    focused release operations, TypeScript, `19` syntax checks, and diff
    hygiene. The full explicit public environment was not confirmed and the dirty tree
    keeps `authorizationReady=false`; this is not live campaign evidence.
18. Final review now rejects credential-like, multiline, arbitrary, or URL RPC
    labels before JSONL creation, rereads resolver nonce state immediately at
    the write sink, and keeps the V10-only Preview contract from disabling the
    separate managed-soak profile.
19. The Preview child-env inspector now exposes one fixed public-only schema
    with `null` for absent bindings. Local inspection proves the epoch-bound
    flag is exactly `1`, the redacted RPC label is valid, and all execute gates
    are `0`; explicit network/address/token/deploy/indexer bindings remain
    absent, while tracked defaults and the offline manifest remain canonical.
20. Seventeen focused P1.10 seams replaced `66` source-regex assertions with
    executed SSR, timestamp/grace/nonce, canary-profile/integer,
    rebate-normalization/cache, sanitized Preview-child, wallet-cache/address,
    FAQ/White Paper, manual/Auto-Miner form, runtime-health, reward-scanner,
    signoff finality, error-boundary SSR, hermetic-build CLI, wallet retry/config,
    and public read-model route boundaries. The exact audit/self-test, all
    latest focused runners, syntax checks, and TypeScript passed.
21. A cohesive wallet boundary wrapper now owns action/external wallet tests in
    their original order. Direct coordinator fan-out fell from `93/2/93` to
    `92/2/92` without changing the assertion totals or test semantics.
22. A public-experience wrapper now owns metadata, public presentation,
    direct-route SSR, and FAQ/public-copy tests in their exact synchronous order.
    Direct coordinator fan-out fell from `92/2/92` to `89/2/89` without changing
    leaf assertion semantics.
23. A production-runtime wrapper now owns env, config, strict, and network-matrix
    tests in their exact synchronous order. Direct coordinator fan-out fell from
    `89/2/89` to `86/2/86` without changing leaf assertion semantics.
24. The earlier read-only trusted-toolchain search found no exact npm `11.5.1`
    in NVM, `D:\`, workspace-adjacent, resolver fallback, or cache locations.
    A separate existing isolated runtime was later identified under
    `.tmp-npm-runtime-115/` and verified as Node `24.5.0` with npm `11.5.1`.
    Nothing was downloaded or installed in this packet, and the resolver/version
    pin was not weakened.
25. A synchronous release-proof wrapper now owns release documentation, mainnet
    proof policy/output, and chain-proof policy in their exact order. Direct
    coordinator fan-out fell from `86/2/86` to `83/2/83` without changing leaf
    assertions.
26. An earlier P1.10 packet moved the official audit from `5576/6285` with `709`
    source operands to `5638/6303` with `665`: net `-44` source operands and
    `+62` behavioral assertions. Focused hermetic/SSR/runtime tests passed for
    release-artifact boundaries, wallet presentation, rebate freshness, runtime
    recovery, mobile mining actions, public metadata, and Preview child-env.
    The standalone fee-policy test also replaced two source assertions with
    executed hook behavior; it is outside the official coordinator totals.
27. The exact isolated runtime passed the complete Preview environment suite
    `30/30`, `npm 11.5.1` typecheck, and the full release-operations runner with
    an owned OS-temp `LORE_DB_PATH`. The ordinary system Node correctly failed
    the trusted-runtime gate and is not counted as a pass.
28. A launch-proof guard wrapper preserves the exact command-map, readiness,
    redaction, template, and process-model order while reducing coordinator
    fan-out to `79/2/79`. A later exact-order client runtime/content wrapper
    reduced it to `76/2/76`; the operations-health wrapper reduces it to
    `74/2/74`. Chat/client and runtime-health seams now execute
    behavior instead of four structural operands.
29. The full isolated business suite passed on the current dirty worktree after
    correcting the synchronous HTTP negative assertion and making three CLI
    dotenv loads direct-execution-only. A synthetic dotenv regression proves
    ordinary imports do not inject signing variables. This is mutable local
    evidence, not immutable-SHA proof.
30. Bounded cleanup removed `286318496` bytes total across ignored cache/debug
    files, regenerated `.next`, old `.serena` cache/log files, and six
    unreferenced old summaries/logs; recovery assets, current test/release
    evidence, and the exact runtime itself were retained.
31. The protected DB incident described above remains unresolved. The later
    isolated suite protected only the post-incident snapshot and cannot be used
    as evidence that the starting trio remained unchanged.
32. `ErrorCatcher` now exposes pure Privy timeout classification and event
    suppression helpers. Focused executed tests replace four structural
    operands (one duplicated elsewhere) while preserving listener semantics;
    two real dynamic-import wiring contracts remain source-based.
33. Copy-only SQLite forensics established that current is valid and newer than
    the available recovery state, but cannot prove or reconstruct the lost
    turn-start WAL. No original or recovery SQLite file was opened by SQLite.
34. The jackpot Share-on-X URL/text is now built by an exported pure helper;
    four source assertions became exact executable endpoint/query/text tests.
35. P1.17 now uses schema `4`: one raw `setInterval(100)` chain spans 15s
    visible, 90s native-hidden, and 15s visible recovery with trusted transition
    history, a foreground witness, and normalized Chromium switch evidence.
    Collector passes `87/87`; verifier passes `85/85` and rejects broken
    continuity, weak controls, hidden Long Task saturation,
    unthrottled/frozen cadence, truncation, API request-count mismatches, and
    internally inconsistent summary changes. Zero requests remain a truthful count rather than an
    observed-polling claim. These are mechanism self-tests, not browser evidence.
36. Privy `3.27.2`'s `Submit` and 24x24 controls are already formally accepted
    as an upstream-only exception. The focused app-owned accessibility boundary
    passes `17` cases; public-HTTPS embedded-modal QA remains open.
37. The latest P1.10 packet moved the audit from `5638/6303` behavioral with
    `665` source operands to `5668/6314` with `646`: net `-19` source operands
    and `+30` behavioral assertions. Exact runtime calls or SSR now cover
    Auto-Miner storage failure/cleanup, manual-bet signing/pending/confirmed
    notices, runtime-health route/auth wiring, BackupGate recovery copy, funding
    addresses/copy states, manual/Auto-Miner presentation, and truthful
    AdminOps read-only `on`/`off`/`unknown` state. Health-probe identity failures
    now compare only a boolean and cannot dump `process.env`. Focused runners,
    audit self-test `7/7`, exact Node `24.5.0` / npm `11.5.1` TypeScript, and
    diff hygiene pass; no browser, network, wallet, or DB gate is represented.
38. A follow-up Wallet Settings packet replaced seven component-source operands
    with seven assertions over the existing modal's server-rendered output. The
    audit moved from `5668/6314` behavioral with `646` source operands to
    `5675/6314` with `639` (`89.88%`). The executed checks cover complete dialog
    semantics, dynamic-viewport and scroll containment, the support-log action,
    all five mobile section tabs with one selected and 44px/focus treatment, and
    normalized-address resolver-row deduplication. Production code and the
    66-path manifest set were unchanged; four focused wallet runners and the
    audit self-test `7/7` pass without browser, network, wallet, or DB use.
39. The V10 Preview environment test retained its two intentional startup-order
    source assertions while removing `24` classifier false positives. A fixture
    module variable now has a non-colliding name, and two inline Preview artifact
    mutation callbacks were extracted without changing their reads, writes, or
    failure expectations. The audit moved from `5675/6314` behavioral with `639`
    source operands to `5699/6314` with `615` (`90.26%`). The complete hermetic
    Preview environment runner passed `30/30` on exact Node `24.5.0`; it used
    temporary fixture clones and no repository DB, network, wallet, or signing.
40. A test-only metadata/cache packet replaced ten remaining source operands
    one-for-one with executable behavior. Root layout metadata now runs in
    isolated admission environments; canonical jackpot selection uses the real
    exported verifier; the public CTA is checked through SSR. Deposit,
    achievements, and chat-session caches now prove canonical uppercase-address
    handling, while rebate, claim-plan, deposit, and achievements paths also
    reject malformed addresses before accepting or reading scoped state. The
    audit moved from `5699/6314` behavioral with `615` source operands to
    `5709/6314` with `605` (`90.42%`). Focused metadata and chat/cache runners,
    audit self-test `7/7`, and independent reviews pass without production-code,
    network, DB, wallet, or signing changes.
41. A test-only wallet-model packet replaced four source operands with direct
    behavior checks for unsafe hashless nonce/time evidence, canonical pending
    storage keys across write/read/clear, malformed scoped cleanup, and required
    transfer-cache provenance. The malformed-scope case uses a sentinel latch to
    prove both false returns preserve the same actor's in-memory latch and exact
    storage/readback, then clears the sentinel through its valid key. The audit
    is now `5713/6314` behavioral
    with `601` source operands (`90.48%`); the focused wallet-model runner and
    audit self-test `7/7` pass without production-code, network, DB, wallet, or
    signing changes.
42. A test-only direct-route/chat-auth packet replaced four source operands
    one-for-one. The `/faq`, `/whitepaper`, and `/leaderboards` entrypoints now
    execute in an isolated SSR child with a mocked shared page and a hard network
    ban; `useAppShellState` proves the server-selected first tab directly. Chat
    auth now executes strict timestamp and exact `/chat` URI rejection matrices
    while retaining the route-to-helper wiring assertions. The audit is now
    `5717/6314` behavioral with `597` source operands (`90.54%`); both focused
    runners and the audit self-test `7/7` pass without production-code, network,
    DB, browser, wallet, or signing changes. Because the direct-route test was
    previously clean, the exact manifest expands from `66` to `67` paths with
    `0` staged; its generated-evidence exclusion remains unchanged.
43. After rebuilding the exact `113`-module audit graph, a wallet-model packet
    replaced two more source operands one-for-one. The real mining execution
    hook now proves an ambiguous silent-send error is rethrown before a duplicate
    wallet fallback; the real achievements hook removes corrupt and structurally
    invalid scoped cache entries during synchronous initialization and restores
    the prior global storage descriptor. The audit is now `5719/6314` behavioral
    with `595` source operands (`90.58%`); the focused wallet-model runner and
    audit self-test `7/7` pass without production-code, network, DB, browser,
    wallet, or signing changes.
44. A test-only JackpotBanner packet replaced its five remaining source
    operands one-for-one with an isolated child probe of the real component.
    It proves the on-chain fallback passes the canonical generated daily,
    weekly, and resolved event objects and formats the resolved amount exactly;
    two open-state renders make zero `Math.random` calls and match exactly; the
    rendered close control keeps `h-12`/`w-12`, and the dialog description is
    linked to the exact won amount, epoch, and tile text. The audit is now
    `5724/6314` behavioral with `590` source operands (`90.66%`); the focused
    runner and audit self-test `7/7` pass without production-code, network, DB,
    browser, wallet, or signing changes.
45. A two-file test-only packet moved the audit from `5724/6314` behavioral
    with `590` source operands to `5733/6314` with `581` (`90.80%`). The
    wallet-shell runner now executes lazy tab fallback semantics in a fresh
    child process, proves legacy public auto-resolve environment flags stay
    inert, and rejects coercible or unbounded retry values. The isolated panel
    probe avoids resolved-dynamic-import state leaking between runner calls;
    two calls separated by `100ms` pass in one process. Six release-operations
    restoration/marker comparisons now read through a byte-identical helper so
    the audit no longer mistakes fixture behavior for source inspection. Syntax,
    diff hygiene, the audit, and audit self-test `7/7` pass; no production code,
    DB, network, browser, wallet, signing, or chain action was used. The full
    release-operations runner was not repeated for the classification-only
    helper substitution.
46. A test-only error-boundary packet replaced six more source operands
    one-for-one with executable isolated probes. The real sound hook removes
    corrupt settings and invalid muted state; the real ErrorCatcher forwards
    normalized, bounded, redacted arguments; and the real global error effect
    emits only sanitized name, message, and digest. Five architectural source
    guards remain. The audit is now `5739/6314` behavioral with `575` source
    operands (`90.89%`). The focused runner passes twice consecutively, syntax
    and diff hygiene pass, and the audit self-test remains `7/7`; no product,
    DB, network, browser, wallet, signing, or chain path was used.
47. A test-only jackpot/rebate packet replaced four source operands one-for-one
    with executable behavior. The real disabled `useRebate` hook SSR exposes
    `fresh` while an instrumented transport records zero network access; real
    deposits, rebates, and jackpots GET failure paths return exact sanitized
    `500`/`no-store` payloads and call their limiter/logger boundaries. The
    route child mocks storage and dataBridge, poisons the public client, and
    binds `LORE_DB_PATH` to a unique absent temp parent so a mock regression
    cannot open the protected DB. The audit is now `5743/6314` behavioral with
    `571` source operands (`90.96%`). The focused runner passes twice, syntax,
    diff hygiene, audit self-test `7/7`, protected DB, and temp-path absence
    checks pass; no production, network, browser, wallet, signing, or chain
    action occurred.
48. A test-only runtime-health/AdminOps packet replaced two source operands
    one-for-one with executable behavior. An isolated child invokes all nine
    current AdminOps callbacks, proves the six JSON-reading method/route seams
    use the bounded response helper, and records zero direct `.json()` or
    global-network calls. Its fake provider makes `personal_sign` fail and
    `eth_sign` succeed, proving the warning receives only the mocked sanitizer
    result; no real wallet or signature is used. The broad architectural
    `.json()` source guard remains. The audit is now `5745/6314` behavioral
    with `569` source operands (`90.99%`). The focused runner passes twice,
    syntax, diff hygiene, audit self-test `7/7`, independent P0/P1/P2 review,
    and protected DB checks pass; no production code, DB, network, browser,
    wallet, signing, or chain action occurred.
49. A one-file direct-route SSR packet replaced the remaining three source
    operands in that module one-for-one with executable behavior. A fresh child
    imports real LorePage and LineaOreClient while mocking only server data,
    presentation children, and the runtime hook. It proves the real `hub`
    defaults, explicit `faq`/`whitepaper` propagation, exact runtime inputs, and
    rendering from a distinct `analytics` runtime sentinel rather than directly
    from the input prop. The module is now `8/8` behavioral with zero source
    operands; the global audit is `5748/6314` behavioral with `566` source
    operands (`91.04%`). Focused x2, syntax, diff hygiene, audit self-test
    `7/7`, and independent P0/P1/P2 review pass with zero child network calls;
    production code, DB, browser, wallet, signing, and chain state were not used.
50. The existing isolated jackpot/rebate route harness replaced three more
    source operands one-for-one with executable behavior. Real route handlers
    now prove the normal `api-rebates` `20/60s` limiter, the additional exact
    `api-rebates-exact` `6/60s` limiter, and no-store `429` responses on both
    branches. Rebate history rejects `limit=65`, passes exact
    `{ beforeEpoch: null, limit: 64 }` page options, and performs one mocked
    `multicall` with `allowFailure:false`; its private failure becomes the
    generic no-store `503`. The audit is now `5751/6314` behavioral with `563`
    source operands (`91.08%`). Focused x2, syntax, diff hygiene, audit
    self-test `7/7`, protected DB/poison-path checks, and independent P0/P1/P2
    review pass. Production code, real DB/RPC/network, browser, wallet, signing,
    and chain state were not used.
51. The existing chat/client runner replaced two rewards address-normalization
    source operands one-for-one with executable behavior. A fresh child imports
    the real reward summary before substituting the route loader, so the summary
    proves checksum-to-lowercase normalization before one mocked storage read
    and two mocked multicalls, while the real rewards route passes lowercase to
    its mocked loader exactly once. Malformed users are rejected before further
    reads; recovery and fetch calls remain zero. A unique missing-parent
    `LORE_DB_PATH` plus `TSX_DISABLE_CACHE=1` fails closed against storage-import
    drift and remains absent before/after every child. The audit is now
    `5753/6314` behavioral with `561` source operands (`91.11%`). Focused x2,
    syntax, diff hygiene, audit self-test `7/7`, protected DB/poison-path checks,
    and independent P0/P1/P2 review pass without production, real DB/provider,
    browser, wallet, signing, or chain activity.
52. The existing API recovery/storage runner replaced six deposits source
    operands one-for-one with a fresh executable child over the real route. It
    proves exact `GET`/`api-deposits`/`20`/`60000` limiter inputs, no-store
    short-circuiting before downstream effects, checksum-to-lowercase bounded
    storage access, safe reward-epoch narrowing, and corrupt block-number
    tolerance without recovery, RPC, fetch, or protected-DB access. The module
    is `32/6/26`; the global audit moved to `5759/6314` behavioral with `555`
    source operands (`91.21%`). Focused x2, persistence x2, syntax, diff hygiene,
    audit self-test `7/7`, poison-path checks, and independent review pass.
53. The wallet-shell-actions runner replaced five source operands with real
    Wallet Settings SSR/focus-trap wiring and an isolated `useAutoResolve`
    execution. A zero pool stops before fetch; a funded pool performs the exact
    precheck, guard, no-store POST, bounded `readJsonResponse`, pending log,
    guard refresh, and `90000ms` backoff sequence without direct
    `response.json()` or wallet writes. The module is `103/4/99`; the global
    audit moved to `5764/6314` behavioral with `550` source operands (`91.29%`).
    Focused x2 and the standard safety gates pass with no real network, DB,
    browser, wallet, signing, or chain activity.
54. The wallet-model runner replaced six transfer source operands with a fresh
    child executing the real `useWalletTransfers.fetch` hook. One self-transfer
    event is duplicated across outgoing/incoming scans while a second event
    sharing its transaction hash appears only in the incoming scan; both remain
    exactly two event-keyed rows. Real viem
    topics bind the checksum address, malformed addresses perform no
    RPC/storage work, and a
    value above the safe-integer boundary preserves exact display text while
    clamping compatibility numbers. A test-only finally cleanup now releases
    both pending-actor latches created by the pre-existing mining-path fixture,
    so the complete runner is reentrant without adding a production reset. The
    module is `185/14/171`; the global audit moved to `5770/6314` behavioral
    with `544` source operands (`91.38%`). Focused same-parent x2, syntax, diff
    hygiene, audit self-test, globals/env, protected DB, and poison checks pass.
    Separate fulfilled-query malformed outgoing/incoming scenarios now prove
    both decode skips persist partial zero-row coverage. This removes a
    transitive source-derived matcher the shallow classifier previously missed,
    so semantic coverage improves while the official count remains unchanged.
55. The public-api-read-model runner replaced its final five source operands.
    The isolated SQLite child proves persisted meta/getter revision `9`; the
    real leaderboard route and forwarding policy spy prove revision reads and
    cache-key inputs for `300`, `400`, `401`, and `402`. The module is now
    `121/121` behavioral with zero source operands; the global audit is
    `5775/6314` behavioral with `539` source operands (`91.46%`). Focused x2,
    syntax, diff hygiene, audit self-test, protected DB/temp/poison checks, and
    zero-network assertions pass; no production or live path was changed.
56. The error-boundary runner replaced four `app/error.tsx` source assertions
    with a fresh child that invokes the real `ErrorPage` effect for ordinary and
    chunk-load failures. It proves exact Sentry/logger calls, bounded/redacted
    payloads, one guarded reload, and zero network calls. The module is
    `89/1/88`; focused same-parent x2, syntax, isolation, DB, and independent
    P0/P1/P2 review pass.
57. The wallet-model runner replaced eight source assertions with real
    `useWalletTransfers`, `usePageWalletOverview`, and `useGameDerivedState`
    outputs. Outgoing failure, shortened fallback range, and failed fallback
    chunk all publish `partial/partial`, while the full scan publishes
    `live/full`; raw bigint values above the safe-integer boundary retain exact
    token, ETH, header, and game display strings. Under schema v1 the exact
    module delta was `185/14/171 -> 185/6/179`; schema v2 counts one additional
    behavioral assert and reports `186/6/180`. Focused fresh-process and
    same-parent x2 plus two independent reviews pass without network, wallet,
    browser, RPC, or protected-DB access.
58. The release-operations runner replaced four live-canary source guards with
    inspection-mode executions of the real `live-round-canary.ts`. Separate
    children accept `MANUAL`, `AUTOMINER_A`, `AUTOMINER_B`, and `AUTOMINER_C`,
    reject an unknown/empty/duplicate role set, enforce inclusive integer
    bounds, and reject non-canonical or unsafe integers before any operational
    effect. Independent review found and the corrective packet closed an
    initial A/B coverage gap. The schema-v1 exact delta was
    `794/296/498 -> 794/292/502`; schema v2 reports `794/310/484` because it now
    identifies `18` pre-existing transitive source-derived assertions. Focused
    x2, the all-role corrective probe, syntax, isolation, and review pass with
    exact zero/false wallet/network/write receipts.
59. The existing wallet-boundary wrapper now owns the error-shell, dialog, and
    wallet-funding runners after action/external in their original order. The
    main coordinator removes exactly the matching three imports and calls, so
    fan-out falls from `74/2/74` to `71/2/71` without changing leaf assertions
    or execution order. Focused x2 passed with fetch poison, and the isolated
    business summary completed with `childExitCode=0` and zero assertion
    failures.
60. `audit-p1-behavior.mjs` now emits schema v2. It covers the full Node 24
    assert surface, direct/named/aliased APIs, and fails closed on unknown
    dot/computed/named forms. Scope-aware taint preserves all `522` valid v1
    direct-source cases, removes one property-key false positive, adds `31`
    confirmed transparent transitive cases, and does not cross imported,
    Preview, campaign, spawn, CLI, or other effectful return boundaries. The
    exact current audit is `5811/6343` behavioral, `532` source (`91.61%`),
    `113` modules, coordinator `71/2/71`; audit x2 and self-test x2 (`17/17`)
    pass. Independent corrective review found no remaining P0/P1/P2.
61. The frozen jackpot/rebate exact5 packet (`9CA4F5...`) exercises the real
    rebates route in fresh children: safe cache-key/watermark handling,
    bigint-safe claimable/recent filtering, exact-multicall fallback, and no
    parent DB/fetch leakage. Schema v2 reports `102/15/87`; independent review
    found no P0/P1/P2 issue.
62. The frozen release CLI configuration exact4 packet (`DA09766...`) executes
    real inspection-only CLI children for Sepolia-only canary admission plus
    bounded canonical diagnostics values. Schema v2 reports `794/306/488`;
    focused x2 passed with no wallet, RPC, network, or write effect. Independent
    review found no P0/P1/P2 issue.
63. A bounded cleanup apply removed `0 B`: `.tmp-npm-runtime-115` was active
    and retained, protected `.tmp` recovery children and historical artifacts
    stayed retained, and the protected SQLite base was unchanged.
64. The reward-scanner exact8 packet (`C45433A8...`) replaces eight source
    checks with fresh-child execution of the real `useRewardScanner` hook. It
    proves explorer-linked confirmation, exact receipt intent/timeout, short
    preparation copy, the latest hash after two batch transactions, synchronous
    claim locking, wallet-switch cancellation, and invalidated cache state both
    before and after receipt certainty. Module `118/17/101`, focused x2, audit
    `5808/6344` with `536` source operands (`91.55%`), self-test `17/17`, syntax,
    diff hygiene, isolation, protected DB, and independent P0/P1 review pass.
    The synthetic synchronous React primitive runtime is not browser scheduler
    or lifecycle evidence.
65. The standalone fee-policy runner removes one redundant direct-approval
    source regex only after its existing executable builder coverage proves the
    corresponding bounded legacy/EIP-1559 request shape, fixed gas, preserved
    legacy fee field, ignored caller gas override, and fail-closed invalid-fee
    cases. Focused x2, audit x2, and the schema-v2 self-test (`17/17`) pass;
    its removal does not change the coordinator audit totals. No production
    code, network, wallet, signing, or protected DB path was used.
66. The first mobile-mining packet removes the redundant `walletSetup` source
    regex because the existing executable scenario already proves that reset
    invalidates a stale wallet-creation rejection without unlocking or
    overwriting the newer retry. The standalone module moves from `69/21/48`
    to `68/20/48`; focused x2, audit x2, and self-test `17/17` pass. The
    coordinator excludes this standalone runner, so its global totals remain
    `5811/6343` with `532` source operands. No production, network, wallet,
    signing, or protected-DB path was used.
67. [`transactional-ledgers-design.md`](transactional-ledgers-design.md)
    specifies the unimplemented external transactional consent and unified
    activity-ledger target: exact consent binding/state transitions, shared
    serializable claims, persisted idempotent intents, ambiguous-write
    reconciliation, hash-linked audit entries, canonical event identities, and
    reorg/finality-aware projections. It neither selects/deploys a provider nor
    creates an external database, a migration, consent, Preview, or chain
    action; those remain required before any multi-host or live claim.
68. [`valkey-upstash-parity-plan.md`](valkey-upstash-parity-plan.md) selects
    Valkey `8.1.9` and records the observed immutable official image manifest
    plus the mandatory Upstash-style HTTPS REST façade. Direct local execution
    now covers all three real Lua programs, and commit `cbf916739` covers the
    HTTPS rate-limit application path from two Node processes. The current
    candidate adds keeper HTTPS behavior on the same local topology; it is not
    yet clean-HEAD evidence. A deployed provider, deployed web replicas,
    session HTTPS, persistence, and restore evidence remain open.
69. The `24` source assertions in `test-business-release-operations.mjs` were
    reviewed rather than removed. They protect the Windows-only local-campaign
    fixture; Linux intentionally returns before that executable fixture, so
    there is no equivalent Linux public-behavior coverage. Retaining them is
    the fail-closed P1.10 result and adds no coordinator assertion.
70. Two redundant `rebate-history` pagination source assertions were removed
    from the API request-boundary runner. An existing isolated child executes
    the real route: `limit=65` returns `400` without opening its poisoned DB
    path, while `limit=64` reaches the page read with exact bounded options and
    then fails closed on the mocked multicall. The focused API and route-child
    runners passed x2; audit is `5811/6343` with `532` source operands and the
    self-test passes `17/17`.
71. Two `claim-candidates` pagination source assertions were replaced with a
    fresh-child execution of the real handler. `limit=401` returns `400` before
    the poisoned DB path is opened, while `limit=400` records the exact page
    options `{ beforeEpoch: null, limit: 400 }`. Focused x2, audit x2,
    self-test `17/17`, syntax, diff, and protected-DB checks pass.
72. Two redundant admin/chat auth content-type source assertions were removed
    from the request-boundary runner only after the independent API matrix
    executed both real routes with `text/plain` and proved exact JSON `415`,
    `no-store`, and `Vary: Cookie` handling. Focused domain and matrix runners
    passed x2; the audit is `5811/6341` with `530` source operands and the
    self-test, syntax, diff, and protected-DB checks pass.
73. The redundant admin-process content-type source assertion was removed only
    after a dedicated fresh child mocked a valid admin session and executed the
    real route with `text/plain`, proving exact JSON `415`, `no-store`, and
    `Vary: Cookie` handling. Focused x2, audit x2,
    self-test, syntax, diff, and protected-DB checks pass; the current audit is
    `5816/6345` with `529` source operands.
74. The redundant `Vary` normalizer source assertion was removed only after
    direct response-header behavior proved case-insensitive Cookie dedupe,
    wildcard preservation, and invalid-token rejection while preserving valid
    values. Focused x2, audit x2, self-test, syntax, diff, and protected-DB
    checks pass; the current audit is `5816/6344` with `528` source operands.
75. The redundant `Retry-After` implementation assertion was removed only
    after direct normalizer behavior proved zero-to-one clamping, fractional
    upward rounding, and the `86400` upper bound. Focused x2, audit x2,
    self-test, syntax, diff, and protected-DB checks pass; the current audit is
    `5819/6346` with `527` source operands.
76. The redundant OpenGraph URL-parameter source assertion was removed only
    after the real API matrix rendered a canonical event with hostile `amount`,
    `kind`, `tile`, and `epoch` values and proved an identical PNG. Public
    presentation/matrix runners passed x2; audit, self-test, syntax, diff, and
    protected-DB checks pass. The current audit is `5819/6345` with `526`
    source operands.
77. The remaining `linea-fee-policy` source assertions were re-reviewed and
    retained: they bind pre-wallet/signer fee validation, guarded submission
    sinks, or live-write helpers, with no equivalent safe public behavior seam
    that avoids simulating risky signing. Focused fee-policy x2, audit x2,
    self-test, syntax, diff, and protected-DB checks pass.
78. The P1.17 headed harness now minimizes and restores the measured top-level
    Chromium window through a page-scoped CDP session, verifies the reported
    window state, polls only raw native visibility, records bounded diagnostic
    actuation telemetry, and restores the original window state before detach.
    Mutation-success/readback-failure, action-failure, `maximized`/`fullscreen`
    restore, controller-detach, and exact request-start window paths are covered.
    Collector self-test `158/158`, verifier self-test `119/119`, syntax, and
    diff hygiene pass. API requests are registered before fulfillment, but
    their start time is accepted only after BrowserContext `response`; the
    bounded raw cohort retains terminal outcome and is drained before sealing.
    Strict validation independently recomputes the exact half-open hidden
    subset and rejects pre-response zero, missing, failed, unresolved,
    wrong-clock, shifted-window, overflow, truncation, or internally
    inconsistent accounting. It validates the recorded drain and terminal
    state; an unsigned artifact cannot independently prove that a coherent
    producer-side rewrite never occurred. The latest 60-second loopback
    diagnostic confirmed `minimized`, waited `3019ms`
    without raw hidden, restored the original `normal` state, and re-observed
    raw visible after `5ms`. Its raw request cohort was exact `8/8`: every
    timestamp was positive and response-captured, every terminal event was
    `requestfinished`, and the drain ended at zero with no missing, unresolved,
    failed, or truncated entry. Because no hidden window existed, accounting
    correctly stayed `not-measured` and no qualifying polling count is claimed. Thus
    no native-hidden, throttling, two-hour, or final-SHA claim is made.
79. Mobile-mining Package A replaces two source-derived dock assertions with
    executable React SSR checks against both actual in-panel action tags. The
    rendered manual and Auto-Miner buttons must each carry
    `max-[899px]:hidden` while the separate mobile dock owns the primary CTA.
    Standalone classification moves `68/20/48 -> 68/18/50`; focused x2, audit
    x2 (`5820/6346`, `526` source), self-test `17/17`, targeted ESLint, diff,
    protected-DB identity, and independent review pass. Only the test runner
    changed; there was no production, wallet, RPC, network, or DB mutation.
80. Mobile-mining Package B renders the real
    `WagmiProvider -> HubContent -> HubSidePanel` path with a denied custom
    transport and records zero RPC calls. It replaces two source-derived stage
    class assertions and one obsolete-component literal guard with final-markup
    checks for scoped responsive blur, no unscoped mobile blur, and exactly one
    `mobile-mine-action` dock. Standalone classification moves
    `68/18/50 -> 68/15/53`; focused x2, audit x2 (`5820/6346`, `526` source),
    self-test `17/17`, exact-runtime TypeScript, targeted ESLint, diff,
    protected-DB identity, and independent review pass. The remaining 15
    structural source guards have no equivalent current SSR/public seam and
    remain intentionally fail-closed.
81. Commit `b53489ededdcfdda694ccb6f5a64655d7d9a5ca2` executes the exported
    `reserveExternalKeeperDailyBudget` through two distinct Node processes,
    verified Caddy TLS/SNI, the pinned SRH manifest, and real Valkey `8.1.9`.
    Real Lua behavior proves shared reservations, cross-replica replay,
    conflict without mutation, atomic cost and signature caps, tightened-policy
    refusal, server `TIME` plus absolute `PEXPIRETIME` at the next UTC
    midnight, replay/error deadline preservation, prior-day reset,
    malformed-state refusal without mutation, and wrong-Bearer fail-closed
    with no created state. Final focused
    x2, the exact npm entry, direct three-script Lua-engine regression, the TSX
    keeper test, syntax, targeted ESLint, diff hygiene, exact owned cleanup,
    and post-incident protected base/WAL/SHM identity all pass. The retained
    artifact remains honest `partial`, but the post-commit npm rerun now reports
    `allRelevantFilesBoundToRevision=true`, `trackedWorktreeClean=true`, stable
    startup-to-finish provenance, and exact source revision `b53489ed...`.
    Session HTTPS, deployed/provider topology, persistence, and restore remain
    open.
82. Commit `9ce4e5ca9809cda7b856603e2f51e1200b0f7735` extends that same topology
    through public `issueAdminSession`, `readAdminSession`, and
    `rotateAdminSession` seams. Two Windows Node `24.5.0` processes share one
    digest-pinned Valkey `8.1.9` keyspace behind verified Caddy TLS/SNI and SRH.
    Concurrent rotation yields exactly one CAS winner; both replicas accept the
    new cookie and reject the old one for authenticated reads; an explicit stale
    rotation and wrong-Bearer rotation preserve the exact active record and
    absolute deadline. The final code has syntax, targeted ESLint, two exact-Node
    focused passes, the existing admin-session security test, direct three-script
    Lua regression, diff hygiene, exact Docker/temp cleanup, and protected-DB
    invariants. Independent review narrowed claims to rotation CAS and required
    seven source bindings, host/container platform separation, post-cleanup
    provenance, explicit hosted/browser exclusions, and graceful DB-close ack;
    each correction is present in the retained clean-HEAD artifact. Hosted route
    and browser cookie enforcement, deployed/provider topology, persistence,
    restore, indexer/bot/monitor, and cross-host behavior remain open.
83. Commit `154b29b592182600d118736f1c2d312d92fcc9a3` upgrades the direct
    Valkey `8.1.9` runner from an ephemeral Lua check to a bounded local
    persistence/restore drill. The unprivileged digest-pinned container runs
    with `appendonly=yes` and `appendfsync=always`; a real process restart
    preserves rate, keeper, and session values plus their exact absolute
    expiries. `SAVE` then produces a byte-exact RDB backup. After intentional
    post-snapshot mutation, the original container is removed and a distinct
    restore container recovers the pre-mutation values and deadlines from that
    RDB. Two final exact-Node focused runs, syntax, targeted ESLint, diff hygiene,
    exact full-ID/ownership-label cleanup, OS-temp removal, and protected-DB
    invariants pass. The retained clean-HEAD artifact binds four paths to this
    SHA with `trackedWorktreeClean=true` and `stableThroughCleanup=true`. This is
    local engine semantics only: provider-managed durability, externally retained
    backup, deployed process rehearsal, and external relational DB restore remain
    open.

## Pre-document verification snapshot

- The isolated business suite passed at `786b8692b` after stale-fixture fixes.
  `7905dc764` adds a later recovery-identity assertion only; it does not turn
  the earlier business-suite result into final current-SHA evidence.
- At pre-document source `7905dc764`, P1 hardening passed `42/42` in
  `139491ms`; `typegen` plus `tsc`, standalone V10 and V9 local invariants,
  global-stats `10000+`, leaderboard `110003`, and the hermetic wrapper passed.
  These are local mutable-lineage results only.
- Local read-only Playwright smoke passed with screenshot
  `artifacts/smoke-browser/sha7905-current-readonly.png`; it did not create a
  wallet, sign, approve, bet, claim, or send a transaction. It is not launch,
  hosted, or live-wallet proof.
- P1.17 self-tests passed again on the current working tree: collector `158/158`
  (schema `4`, maximum duration `7200000`) and verifier `119/119` (schema `4`).
  They do not replace the final immutable clean-SHA seal pair, headed
  native-hidden two-hour run, browser evidence, or strict verification.

## Latest local corrective work

- Reward scanning now fails closed on incomplete or untrusted data: the P0 path
  records strict/full verification and cache provenance rather than presenting a
  partial cache as a complete reward result. Desktop and mobile status UI expose
  the resulting loading/stale/error/partial state, and the mobile P1 review
  received its corrective follow-up.
- Deposit history now preserves canonical indexed-block provenance end-to-end: successful reads are explicitly `partial`, the v3 cache validates it, and Analytics distinguishes loading, partial, stale, and unavailable snapshots. A partial empty index is not presented as a complete empty history; focused route, read-model, and presentation checks cover the contract.
- The local accessibility pass includes the `d042` corrective work. A local,
  read-only Playwright activity check also passed for the available flow; its
  external bootstrap stayed intentionally read-only and limited by the absence
  of an external authenticated/runtime fixture. It is neither production nor
  browser-launch proof.
- Dependencies were restored with `npm ci` for the local verification path. No
  wallet, signing, approval, bet, claim, deployment, or other chain write
  occurred. The protected SQLite base, WAL, and SHM remained unchanged.
- This is local mutable-worktree evidence only. It does not establish a full
  campaign pass, immutable-SHA seal, hosted readiness, or real wallet flow.
- Transfer history now records explicit full/partial scan coverage and saved-list
  truncation in a v2 cache; v1 is ignored rather than upgraded. A fallback window
  gap, failed log chunk, or decode skip yields observed lower-bound totals, while a
  real zero over the full range remains full. Cached capped lists disclose that
  totals came from the full last check and the UI says `Last checked` rather than
  implying current or complete rows. Focused model/SSR checks are local only; no
  network, wallet, or database action occurred.

- Wallet setup is runtime-owned across Hub, Sidebar, and Wallet Settings: one safe shared attempt lock exposes creating/error state, prevents duplicate creation requests across surfaces, retains retry after a rejected attempt, and releases only after wallet sync/connection. A generation token invalidates stale Promise settlement after reset, so it cannot overwrite a newer attempt. Local presentation and TypeScript checks passed; no wallet or chain action was performed.
- Current local canary-proof P1 hardening passed the focused release-operations
  suite (with an isolated temporary `LORE_DB_PATH`) and `npm.cmd run typecheck`:
  `live-round-canary.ts` now records the
  approval receipt `txStatus`; strict V10 proof accepts an approval only with
  `txStatus: "success"`, a real hash, and `round: -1`. Bound JSONL evidence
  also requires admission-first ordering, the exact role/mode control plane,
  phase-ordered runtime/wallet-preflight/approval/bet records, a single terminal
  SYSTEM summary reconciled to observed bets, and one exact primary/repeat
  receipt pair per V10 round. This is local source/test work only: it neither
  proves on-chain resolve calldata/from/receipt provenance nor invents a
  resolver-state-change budget outside the admitted ERC20 role caps.

## Campaign status

- `local-20260821-final-r3` iterations 1–3 completed all seven isolated gates.
- Iteration 4 stopped on the stale test expectation in
  `test-business-wallet-models.mjs`: old expected fake zero strings, actual
  correct unavailable `null` values. This was repaired in `ef0359c95`; a direct
  isolated business rerun passed afterwards.
- The campaign process has exited. Its first three iterations are historical
  regression evidence for mutable earlier code, not current/final-SHA proof.
- Before a new campaign, capture its exact starting SHA, preserve the DB
  snapshot, and ensure disk headroom; do not start it merely to replace a failed
  log. The runner now disables `tsx` cache per child command and fail-closes
  launch anomalies/environment-restore failures, but the stopped campaign is still not final evidence.

## Open local work

- P1.10 behavior extraction remains partial.
- A disposable detached code mirror completed `check-local --summary-only`
  with exit `0` after fresh dependencies: lint, isolated business, P1,
  performance self-test, V10/SQLite, hermetic build, TypeScript, HTTP, and
  browser smoke. This remains local candidate evidence, not a final immutable
  SHA, hosted CI, security scan, or authenticated-wallet result.
- The unauthenticated local browser smoke no longer pretends to exercise
  pending-bet recovery by writing the obsolete global `v1` storage key. Its
  focused local browser boundary passed twice after the fixture began reporting
  the authenticated-wallet requirement explicitly. Actor-scoped `v2` recovery
  remains in isolated wallet/recovery tests; physical wallet recovery is still
  an external HTTPS/Privy gate.
- The current Preview/consent implementation packet is locally complete; only
  its live campaign, external topology, and authorization evidence remain open.
- Direct execution now covers all three exact production Lua programs on
  pinned Valkey `8.1.9`. The local parity harness also executes the real
  `consumeExternalRateLimit`, `reserveExternalKeeperDailyBudget`, and public
  admin-session issue/read/rotation seams from two independent Node processes through
  verified Caddy TLS/SNI and a digest-pinned SRH image selected from tag
  `0.0.10` into the same Valkey keyspace. The latest retained clean-HEAD run at
  `9ce4e5ca9809cda7b856603e2f51e1200b0f7735` passes rate limiting plus keeper
  replay/conflict, atomic cost/signature caps,
  server-time TTL/day-reset, malformed-state and wrong-Bearer refusal, exact
  cleanup, and post-incident base/WAL/SHM pre/post identity. It reports
  `allRelevantFilesBoundToRevision=true`, `trackedWorktreeClean=true`, stable
  provenance through cleanup, exact source-SHA binding, and graceful replica DB
  close/exit. Hosted route/browser cookie enforcement, deployed replicas/provider,
  persistent external DB, and restore remain open.
- Header balance provenance now carries wagmi fetching/error/stale/updated-at metadata:
  a known balance remains visible on refresh, stale data, or RPC error, and the card
  exposes an explicit state plus any trusted last-updated timestamp. It does not infer
  offline status from an arbitrary RPC error.
- Final immutable-SHA detached `npm ci`, build/prelaunch, supported security
  scan, and hosted CI cycle is open; the dirty working tree invalidates older
  final-SHA/sealed claims.
- The user has granted local-commit authority. Stage only the exact current
  five-path documentation packet after its zero-omission audit; historical
  7/74/318/320 scopes
  do not widen that staging boundary or authorize external actions.
- P1.17 needs a final canonical/profile sealed pair and a real physical
  native-hidden two-hour loopback run.
- A new local campaign and supported security scan are blocked by disk and/or
  entitlement, not by a false green claim.

- P1.17's separate temporary Chromium witness remains a visible control. The
  measured top-level window is now explicitly minimized/restored through CDP,
  with a three-second raw-state transition bound, exact original-state restore,
  fail-closed readback, and request-start timestamps bounded to the exact raw
  hidden snapshot window. Transition labels cannot exclude or admit a request
  outside that window. On this Windows
  session CDP reported `minimized`, timed out after `3019ms` without raw hidden,
  restored the original `normal` state, and re-observed raw visible after `5ms`;
  collector self-test `158/158`, syntax, and diff hygiene pass. API request
  timestamps are hydrated only on BrowserContext `response`, then the full
  bounded cohort is terminal-drained and independently reclassified by its
  exact start time. Actuation fields
  are diagnostic telemetry rather than independently strict-attested evidence. No native-hidden,
  timer-throttling, two-hour, or final-SHA claim follows from this diagnostic.

- Exact SHA `333d7a81bb8780c5fc631646492ece53bbfa3926` now has a fresh detached
  `npm ci` evidence packet: TypeScript, P1 hardening `41/41` in `302424ms`,
  hermetic build, ESLint (six warnings and zero errors), full `check-local`
  including browser smoke, and summary-only local launch proof L1--L17 all
  passed. The final API-matrix fixture uses `depositsRecoveryPublicClient` for
  recovery head/log mocks, matching production's bounded single-transport path.
  Supported Standard scan `6ca5758f-a4a1-43db-b772-ba98486f1223` found zero
  findings in five critical source surfaces and expressly retained partial
  5-of-785 source coverage plus all live/hosted exclusions. This is local,
  source-only evidence; deployed provider-managed Valkey topology, hosted CI,
  TLS, mobile Privy, and every wallet/chain/Preview action remain open gates.

## External boundary

- V9 remains a compatibility baseline until independently evidenced V10
  cutover. Randomness redesign remains deliberately deferred.
- The current Sepolia V10 target is
  `0x985c71613bb73fac5653c253a8ba37cd0ec8ab9a` at block `31678224`.
  Runtime/canary use requires `NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS=1`
  and the epoch-bound selector. The offline manifest/provenance verifier passed
  at local `HEAD` `13522de026b1d73bdd0cb0ded7c1348f2e6ff7a2`; this used no
  network or wallet and remains local evidence only.
- G1–G14 remain `0/14`; `25` external/status blockers and `41` recorded
  mainnet-environment failures remain open.
- Hosted TLS/HTTPS, Privy origins, deployed web replicas with provider-managed
  Redis/Valkey and DB restore, a shared transactional cross-host consent ledger,
  monitoring, physical mobile
  wallets, signed canary, recovery/soak campaigns, and final sign-off require
  external evidence.
- A fresh guest browser probe on 2026-08-23 still failed at
  `ERR_CERT_COMMON_NAME_INVALID`; no safety interstitial was bypassed, so this
  does not provide production or Privy QA evidence.
- No actual Preview or `authorizationReady` result exists. A clean immutable
  SHA, exact public configuration, fresh exact Preview, and separately bound
  consent are mandatory before any future chain write.
