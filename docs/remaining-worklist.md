# Remaining Worklist

Last updated: 2026-08-26. This is the active queue. Historical detail belongs
under [`docs/archive/`](archive/).

## P0: trustworthy local release candidate

- [x] Align the wallet-model contract with truthful unavailable balances:
      invalid cache is `null`, not a fabricated `0.00`; focused test and the
      isolated business runner passed.
- [x] Run bounded cleanup: the final dry-run reports `0` matched and `0`
      would-delete; all `4` configured whole targets were absent/skipped, while
      protected `.tmp` recovery-prefix children were excluded. Exact-path cleanup
      removed `2092` ignored cache/debug files (`286147895` bytes) plus ordinary
      regenerated `.next` (`3` files, `21423` bytes) and five old `.serena`
      cache/log files (`73911` bytes), then six unreferenced old summary/console
      files (`10998` bytes), three more regenerated `.next` copies (`9` files,
      `64269` bytes), and an empty `output/`: `2115` files / `286318496` bytes total.
      Runtime dependencies, current test/release
      evidence, recovery assets, project data, and SQLite files were retained.
      A subsequent bounded apply removed `0 B`: the active
      `.tmp-npm-runtime-115` runtime, protected `.tmp` recovery children,
      historical artifacts, and unchanged protected SQLite base were retained.
- [ ] Resolve the protected DB incident before any DB-adjacent gate. The
      turn-start exact base/WAL/SHM became a `319488`-byte base with no sidecars
      after a diagnostic import opened the configured path. The staged recovery
      sidecars are older and do not reproduce the turn-start hashes. Copy-only
      forensics shows current is valid and a logical superset of that older
      recovery state, so blind rollback would lose newer state without restoring
      the missing WAL. Any snapshot, restore, or mutation requires a separately
      reviewed staged plan and new exact approval; SQLite work stays on clones.
- [ ] Capture a new immutable SHA and use a detached clean checkout with fresh
      `npm ci`; run dependency gates, full local/prelaunch gates, hermetic
      build, typecheck, supported browser/HTTP smoke, V10 properties, and DB
      invariants when disk permits.
- [x] Diagnose the trusted-npm release-operations failure from exact SHA
      `75881579d`: P1 hardening passed, while the later business row failed
      because its Windows campaign fixture invoked bare `git` and nested bare
      `powershell.exe` under the intentionally minimal trusted `PATH`. Commit
      `99666ae20` resolves the existing allowlisted absolute Git and fixed
      System32 PowerShell paths only for that test child; production trusted
      execution remains unchanged. Minimal-`PATH` focused runs x2 and the full
      business summary through trusted npm pass in `407004ms` with every proof
      true, zero failures, and no timeout. Syntax, ESLint, audit x2, self-test,
      protected DB identity, exact manifest/digests, and independent review
      with no P0--P3 finding pass. A new clean-SHA full prelaunch/local rerun is
      still required.
- [x] Diagnose the current final-SHA prelaunch failure. The full isolated
      business suite passed on exact clean SHA `7918fba2a` in `387897ms` when
      given a diagnostic `600000ms` child limit, proving the former equal
      `300000ms` inner/outer timeout race rather than a product assertion
      failure. Commit `c4f921db3` uses a `600000ms` standalone default and a
      distinct `630000ms` prelaunch watchdog. Its post-fix full coordinator
      passed in `382920ms`; focused timeout/prelaunch tests x2, syntax, ESLint,
      audit x2, self-test, manifest exactness, and protected DB identity pass.
      A new detached final-SHA full prelaunch run is still required.
- [x] Diagnose the next final-SHA prelaunch failure. Exact SHA `964284caa`
      killed P1 hardening at `300000ms`; the same runner passed standalone
      `42/42` in `296463ms`, demonstrating that a 3.5-second jitter margin is
      insufficient. Commit `20ae744f2` gives only this P1 row a `450000ms`
      minimum and preserves larger explicit prelaunch budgets. The timed-out
      report's later business row also failed transiently, while the same
      checkout passed standalone in `424388ms` after all report children exited.
      Focused policy x2, syntax, ESLint, audit x2, self-test, manifest exactness,
      and protected DB identity pass. A new clean-SHA full prelaunch rerun must
      prove both required rows together.
- [x] Diagnose the first final-SHA composite local-check failure: direct mode
      bypassed `business-logic-isolated-runner.mjs`. The current candidate uses
      the mandatory isolated runner; focused policy tests pass twice. It still
      needs a new immutable SHA and a full clean-checkout rerun.
- [x] Restore the trusted npm dependency-audit gate for a D:-drive checkout:
      canonical `C:\\WINDOWS` is now accepted only after kernel/shell validation.
      The Preview boundary runner passes `30/30` twice; production audit has no
      high/critical findings and full audit has only 9 documented dev-toolchain
      high findings. It still needs a new immutable SHA and clean rerun.
- [x] Diagnose the next composite-check failure: P1 hardening allotted only 30
      seconds to the known 93-second Preview boundary runner. The candidate
      retains fail-closed timeout behavior but bounds this one runner at 150
      seconds; it needs a full clean rerun.
- [x] Diagnose the next P1 failure: a 4-second test lease expired while two
      deliberately bounded blocked-indexer probes ran. The holder now heartbeats
      after each probe; focused WAL contention/crash-expiry coverage passes
      twice. It needs a full clean rerun.
- [x] Diagnose the next local smoke failure: non-public robots intentionally
      omit a sitemap, and generic `/jackpot-win` is intentionally excluded from
      sitemap until it has canonical event identity. The smoke contract now
      verifies those states; focused boundary coverage passes twice.
- [x] Diagnose the next browser-smoke failure: its pending-bet fixture wrote an
      obsolete unauthenticated global `v1` key, but runtime recovery accepts
      only authenticated actor-scoped `v2` state. The focused browser boundary
      now reports that it cannot truthfully create this state and passes twice;
      isolated recovery tests retain actor-scoped coverage. A physical wallet
      recovery pass remains an external HTTPS/Privy gate.
- [x] Re-run the complete local composite gate on a disposable detached code
      mirror after the browser-fixture correction: it exited `0` through lint,
      isolated business, P1, performance self-test, V10/SQLite, hermetic build,
      TypeScript, HTTP, and browser smoke. It is not final-SHA evidence because
      it predates later commits and has not been repeated as the final seal.
- [x] Locate and verify the already-present isolated Node `24.5.0` + npm
      `11.5.1` toolchain under `.tmp-npm-runtime-115/`. It passed the Preview
      environment suite `30/30` and exact-runtime typecheck. No runtime was
      downloaded, installed, or overwritten in this packet; keep the resolver
      and version pin strict.
- [x] Pass the full isolated business suite on the current dirty worktree after
      the synchronous HTTP assertion and dotenv import-side-effect fixes. This
      remains mutable local evidence and does not close the immutable-SHA item.
- [x] Reconcile the historical `318`-path snapshot and already-committed
      `320`-path candidate with the current tree. The new HEAD-bound manifest
      contains exactly `74` release paths, excludes/preserves `31` generated
      evidence paths, and has `0` staged.
- [x] Obtain explicit permission for local staging and one local commit of
      exactly that current `74`-path manifest. It does not authorize push,
      deploy, signing, wallet, RPC, Preview generation, or transactions.
- [x] Run and seal a supported Standard security scan of exact immutable SHA
      `53846fe1635fea0e15c131afa5dc8020d48c0975`. Scan
      `dcc2a20f-4a50-4d89-9d40-82204b529ff3` reports `2 high`, `5 medium`, and
      `2 low` findings with honest partial coverage `96/787`; it was offline and
      read-only.
- [x] Fix the medium single-RPC pending-repair finding in local commit
      `33a090729`: exact two-origin nonce agreement and stable receipt quorum
      are required before repair can progress; divergent or duplicate origins
      fail before the wallet sink. Focused behavior x2 (`22` cases), intent,
      business boundary, TypeScript, diff, and protected-DB checks pass.
- [x] Fix the medium mining actor/nonce binding finding in local commit
      `6d70b0314`: direct approval and all direct Wagmi bet request builders now
      carry the exact reserved actor as `account` and the verified concrete
      nonce. Focused fee-policy and wallet-state behavior x2, TypeScript, full
      P1 hardening `41/41`, diff, and protected-DB checks pass.
- [x] Fix the medium chat identity impersonation finding in local commit
      `0c673336f`: message presentation is derived from the authenticated
      address's server profile, spoofed request-body identity is ignored, and
      named rows always show their wallet address. Route-matrix x2, rendered UI
      x2, TypeScript, audit x2/self-test, full P1 hardening `41/41`, diff, and
      protected-DB checks pass.
- [x] Fix the medium chat-auth outbound RPC exhaustion finding in local commit
      `697f03537`: EOA auth remains RPC-free; contract-wallet fallback has a
      shared `8/minute` cross-replica budget and `2` local concurrent slots.
      Budget/concurrency denial occurs before witness calls. Focused quorum and
      shared-limiter x2, TypeScript, audit x2/self-test, full P1 hardening
      `41/41`, diff, and protected-DB checks pass with mocked providers/Valkey.
- [x] Fix the medium durable chat-profile growth finding in local commit
      `6d9f60411`: the table is atomically capped at `2000`; existing wallets
      may update at capacity, while a new wallet gets no insert/revision bump
      and explicit `503`. Route-matrix x2 at exact capacity, isolated storage
      x2, TypeScript, audit x2/self-test, full P1 hardening `41/41`, diff, and
      protected-DB checks pass without deleting any profile.
- [x] Fix the low stale transfer-history paint finding in local commit
      `ff376d2fa`: render-time actor cache-key matching immediately hides the
      previous wallet pair's rows on switch/disconnect and blocks stale async or
      error fallback publication. Wallet-model x2, TypeScript, audit x2/self-test,
      full P1 hardening `41/41`, diff, and protected-DB checks pass.
- [x] Fix the low hashless non-transfer claim finding in bounded commits
      `0cb1381d2`, `862e5daa0`, `45a9063d3`, and `b7a678970`. Exact actor,
      nonce, contract, and calldata are reserved before every silent or Wagmi
      claim sink; late hashes persist, nonce equality cannot auto-retry a
      contract call after reload, and two exact terminal observations are
      required to release it. Focused behavior x2, wallet-actions `23` cases,
      TypeScript, audit x2 (`5836/6360`, `91.76%`), self-test `17/17`, P1
      hardening `41/41` in `273734ms`, syntax/diff, and protected-DB checks pass.
- [ ] Run and seal a new supported Standard scan on the eventual post-fix final
      SHA. The `53846fe…` scan does not prove later source revisions.
- [ ] Obtain green hosted Linux/Windows CI for the exact final commit.
- [x] Refresh the current pre-permission path manifest before any staging.
- [x] Receive user authority for local commits. Stage only the exact current
      manifest after a fresh zero-omission audit; this never authorizes push,
      deploy, signing, wallet/RPC, Preview, or transactions.
- [ ] Recompute it after any further path-set change and bind final commits/SHA.

## P1: local engineering

### P1.10 behavioral extraction

- [x] Committed audited baseline at `d3916c37d`: `5387/6166` behavioral assertions
      (`87.37%`) across `106` modules; the coordinator has `95` direct runner
      imports, `2` side-effect imports, and `95` direct runner calls.
- [x] Current committed schema-v2 packet reports `5821/6345` behavioral
      assertions (`91.74%`) with `524` source operands across `113` modules;
      the audit self-test passes `17/17`. The v2 denominator includes all
      Node 24 assert methods and the source count includes confirmed transparent
      transitive bindings, so it is not directly comparable to schema v1.
- [x] Remove one redundant standalone fee-policy source assertion only after
      existing direct-approval builder behavior covers the bounded legacy/EIP-1559
      request, fixed gas, legacy-field preservation, caller gas-override
      rejection, and invalid-fee failures. Focused x2, audit x2, and self-test
      `17/17` pass; the official coordinator audit remains unchanged.
- [x] Review the remaining `linea-fee-policy` source assertions: retain the
      pre-wallet/signer validation, guarded submission-sink, and live-write
      bindings because no equivalent safe public behavior seam exists without
      simulating risky signing paths. Focused x2, audit x2, self-test `17/17`,
      syntax, diff, and protected-DB checks pass.
- [x] Review the remaining `linea-fee-policy` source assertions: retain the
      pre-wallet/signer validation, guarded submission-sink, and live-write
      bindings because no equivalent safe public behavior seam exists without
      simulating risky signing paths. Focused x2, audit x2, self-test `17/17`,
      syntax, diff, and protected-DB checks pass.
- [x] Remove the redundant mobile-mining `walletSetup` source assertion only
      after its existing stale-settlement scenario proves reset invalidates an
      earlier rejected creation attempt without changing the new retry state.
      The standalone module is `68/20/48`; focused x2, audit x2, and self-test
      `17/17` pass. It remains outside the official coordinator audit.
- [x] Complete mobile-mining Package A by replacing two static dock-wiring
      assertions with executable React SSR checks against both rendered
      in-panel action tags. Each must carry `max-[899px]:hidden` while the
      separate mobile dock owns the primary CTA. Standalone classification is
      `68/18/50`; focused x2, audit x2 (`5820/6346`, `526` source), self-test
      `17/17`, targeted ESLint, diff, protected-DB identity, and independent
      review pass. This standalone delta does not change coordinator totals.
- [x] Complete separately reviewed mobile-mining Package B with a denied-RPC
      SSR of the real `HubContent` path. Final markup proves responsive desktop
      blur is scoped, unscoped mobile blur is absent, and exactly one
      `mobile-mine-action` dock renders. Standalone classification is
      `68/15/53`; focused x2, audit x2, self-test `17/17`, exact-runtime
      TypeScript, targeted ESLint, diff, protected-DB identity, and independent
      review pass. The official aggregate remains `5820/6346` with `526` source
      operands because this runner is outside the coordinator graph.
- [x] Retain the remaining 15 mobile source guards: hook ownership, callback/ref
      identity, click dispatch, runtime reset wiring, async prop shape, and
      `visualViewport`/safe-area effects are not equivalently observable in the
      current SSR/public seam.
- [x] Move the awaited Preview runner under the existing release-evidence
      wrapper while preserving order and inert import; that step reduced direct
      coordinator fan-out to `93/2/93`.
- [x] Move the cohesive wallet action/external boundary pair under a dedicated
      wrapper without changing order or await semantics; direct coordinator
      fan-out became `92` imports, `2` side-effect imports, and `92` calls.
- [x] Move metadata, public presentation, direct-route SSR, and FAQ/public copy
      under a synchronous public-experience wrapper in their exact order;
      direct coordinator fan-out became `89/2/89`.
- [x] Move production runtime env/config/strict/network-matrix tests under one
      synchronous domain wrapper in their exact order; direct coordinator
      fan-out became `86/2/86`.
- [x] Move release documentation, mainnet proof policy/output, and chain-proof
      policy under one synchronous wrapper in exact order; direct coordinator
      fan-out is now `83/2/83`.
- [x] Move launch command-map, readiness, proof redaction/templates, and process
      model under one exact-order wrapper; direct coordinator fan-out is now
      `79/2/79`.
- [x] Move client runtime polling, chat polling/content, and game-data
      presentation under one exact-order synchronous wrapper; direct coordinator
      fan-out is now `76/2/76` without changing leaf order or assertions.
- [x] Move data-sync health, admin policy, and admin presentation under one
      exact-order synchronous wrapper; fan-out is now `74/2/74`.
- [x] Extend the existing wallet-boundary wrapper with error-shell, dialog, and
      funding runners in their original action/external/error/dialog/funding
      order; direct coordinator fan-out is now `71/2/71`.
- [x] Replace four route-error source checks with execution of the real effect,
      eight wallet transfer/precision source checks with real hook outputs, and
      four live-canary role/integer source checks with real inspection-mode CLI
      children. All supported roles are exercised explicitly after independent
      review closed the initial A/B coverage gap.
- [x] Execute the real rebate route in fresh children for bigint-safe cached
      epochs, claimable/recent filtering, and exact-multicall fallback. The
      frozen exact5 packet (`9CA4F5...`) is `102/15/87`; independent review
      found no P0/P1/P2 issue.
- [x] Execute real inspection-only release CLI validation for Sepolia-only
      canary admission and canonical bounded diagnostics values. The frozen
      exact4 packet (`DA09766...`) is `794/306/488`; independent review found
      no P0/P1/P2 issue.
- [x] Replace eight reward-scanner source checks with isolated executions of the
      real `useRewardScanner` hook. Exact intent/timeout, latest batch hash,
      synchronous claim locking, wallet switching, and cache invalidation before
      and after receipt certainty pass focused x2; the frozen test SHA is
      `C45433A8...`, module `118/17/101`, with no independent P0/P1 issue. The
      synthetic synchronous React primitive runtime is not browser lifecycle evidence.
- [x] Upgrade the audit to schema v2: count direct and named Node assert APIs,
      fail closed on unknown dot/computed/named forms, resolve lexical symbols,
      follow only transparent source projections, and preserve effectful
      Preview/campaign/spawn/CLI return barriers.
- [x] Extract and cover manual bet storage restore/persist behavior, including
      restore-before-persist on browser mount, plus Auto-Miner scoped
      read/write/removal and denied-localStorage behavior.
- [x] Replace `85` source-regex assertions across wallet presentation/models,
      release helpers, rebate normalization/cache, sanitized Preview children,
      FAQ/White Paper, runtime health, reward scanning, signoff finality,
      error-boundary SSR, hermetic CLI, wallet retry/config, and public
      read-model routes, runtime-health route/auth, BackupGate, funding UI, and
      manual-bet notification phases with executed behavior checks; AdminOps also
      distinguishes read-only `on`, `off`, and unavailable state. Focused runners,
      TypeScript, and the exact audit/self-test pass.
- [x] Relative to the `5576/6285` working-tree snapshot, reduce the official
      source-operand count by `63` while adding `92` behavioral assertions for release-artifact bounds,
      wallet/manual/Auto-Miner SSR, rebate freshness, runtime recovery, mobile
      mining, public metadata, Preview child-env behavior, Privy timeout
      suppression, and the Share-on-X intent. Preserve remaining structural contracts.
- [x] Review the `24` static source assertions in
      `test-business-release-operations.mjs` without removing them: they guard
      the Windows-only local-campaign fixture, while Linux takes the explicit
      early return before that executable fixture. No equivalent Linux public
      behavior seam exists, so retaining the assertions is the required
      fail-closed outcome rather than a P1.10 conversion opportunity.
- [x] Remove two redundant `rebate-history` pagination source assertions only
      after the existing isolated route child proves `limit=65` returns `400`
      before DB access and `limit=64` passes exactly `{ beforeEpoch: null,
      limit: 64 }` to the page read before its fail-closed multicall error.
      Focused API/route-child runners x2, audit x2, and self-test `17/17` pass.
- [x] Replace two `claim-candidates` pagination source assertions with a fresh
      child that executes the real handler: `limit=401` returns `400` before its
      poisoned DB path is opened, while `limit=400` reaches the page read with
      exact `{ beforeEpoch: null, limit: 400 }`. Focused x2, audit x2, and
      self-test `17/17` pass.
- [x] Remove two redundant admin/chat auth content-type source assertions only
      after the independent API matrix executes both real routes with
      `text/plain` and proves exact JSON `415`, `no-store`, and `Vary: Cookie`
      handling. Focused domain/matrix runners x2, audit x2, self-test `17/17`,
      syntax, diff, and protected-DB checks pass.
- [x] Remove the redundant admin-process content-type source assertion only
      after a dedicated fresh child mocks a valid session and executes the real
      route with `text/plain`, proving exact JSON `415`, `no-store`, and
      `Vary: Cookie` handling. Focused x2, audit x2,
      self-test `17/17`, syntax, diff, and protected-DB checks pass.
- [x] Remove the redundant `Vary` normalizer source assertion only after direct
      behavior proves case-insensitive Cookie dedupe, wildcard preservation, and
      invalid-token rejection while preserving valid values. Focused x2, audit
      x2, self-test `17/17`, syntax, diff, and protected-DB checks pass.
- [x] Remove the redundant `Retry-After` implementation assertion only after
      direct normalizer behavior proves zero-to-one clamping, fractional upward
      rounding, and the `86400` upper bound. Focused x2, audit x2, self-test
      `17/17`, syntax, diff, and protected-DB checks pass.
- [x] Remove the redundant OpenGraph URL-parameter source assertion only after
      the real API matrix renders one canonical event with hostile `amount`,
      `kind`, `tile`, and `epoch` values and proves an identical PNG. Public
      presentation/matrix runners x2, audit x2, self-test `17/17`, syntax,
      diff, and protected-DB checks pass.
- [x] Remove the redundant AdminOps direct-JSON source regex only after the
      existing fresh handler child imports the real client, executes all `9`
      current callbacks, makes direct `response.json()` fail, and proves exact
      bounded-reader method/route IDs with zero network calls. Exact commit
      `7eee0cd9b` passed focused x2, audit x2 (`5820/6345`, `525` source),
      self-test `17/17`, syntax, ESLint, full isolated business, clean-HEAD
      reproduction, protected-DB identity, and independent review. No P0--P2;
      reviewer P3 notes this is current-callback coverage, not a blanket future
      guard for a new unexecuted effect/error-only path. Fresh hosted Linux
      execution remains open.
- [x] Remove the redundant AdminOps log-summary source regex only after the
      existing fresh admin-session child executes the real authorized
      `/api/admin/ops` GET from an owned absolute temporary root. Every returned
      `logSources` entry omits an own `file` property and the complete serialized
      payload omits the exact escaped root. Exact commit `8797e30d3` passed
      focused x2, audit x2 (`5820/6344`, `524` source), self-test `17/17`,
      syntax, ESLint, diff, full isolated business, clean-HEAD reproduction,
      cross-platform escaping probes, protected-DB identity, and independent
      review with no P0--P3. Ubuntu/Windows CI wiring is present; fresh hosted
      execution remains open.
- [ ] Continue replacing source operands only when a stable public behavior seam
      exists; preserve meaningful policy/source bindings.
- [ ] Keep new assertions in focused domain modules, not coordinator bloat.

### P1.17 sealed performance evidence

- [x] Dual canonical/profiling provenance mechanism is implemented; current
      working-tree self-tests pass collector `158/158` (schema `4`, maximum
      duration `7200000`) and verifier `119/119` (schema `4`). A single raw
      page-timer chain now spans visible control, 90s native-hidden, and visible
      recovery phases; strict verification independently rejects broken hidden
      continuity, unhealthy controls, missing/forbidden Chromium switch
      evidence, hidden Long Task saturation, unthrottled/frozen cadence,
      truncation, API request-count mismatch, and internally inconsistent
      summary changes. A measured
      zero hidden request count is kept distinct from observed polling.
- [x] Keep the headed native-visibility witness in its own temporary Chromium
      process, and actuate the measured top-level window through page-scoped
      CDP `minimized` plus exact original-state commands with readback, three-
      second raw-state polling, and fail-closed restore/detach. Qualifying hidden
      polling is counted by exact request-start timestamps hydrated only after
      BrowserContext `response`. The full bounded raw cohort is terminal-drained
      before sealing; strict verification recomputes the half-open subset and
      rejects pre-response zero, failed/unresolved lifecycle, wrong bounds,
      overflow, truncation, or internally inconsistent accounting. It validates
      recorded drain/terminal fields but cannot prove absence of a coherent
      rewrite of an unsigned producer artifact. Actuation fields remain
      diagnostic-only telemetry. Collector self-test `158/158` passes. The
      latest 60-second diagnostic received `minimized`, timed out after `3019ms`
      without raw hidden, restored the original `normal` state, and re-observed
      raw visible after `5ms`. Its raw request cohort was exact `8/8`, with
      positive response timestamps, finished terminals, a zero pending drain,
      and no invalid/truncated entry. Hidden accounting stayed `not-measured`;
      this is host/session capability evidence, not native-hidden or timer-
      throttling proof.
- [ ] On the final immutable clean SHA, seal the canonical/profile pair, run
      the 60–90 second headed native-hidden preflight, then one two-hour
      read-only loopback collection and strict verification. No current
      build/browser/DB/two-hour or real timer-throttling evidence is claimed by
      the self-tests.

### Privy embedded-modal boundary

- [x] Formally accept only the pinned Privy `3.27.2` upstream exception for the
      provider-owned `Submit` accessible name and 24x24 close target, as recorded
      in [`privy-upstream-accessibility-boundary.md`](privy-upstream-accessibility-boundary.md).
      The app-owned boundary test passes `17` cases and confirms no internal
      DOM/CSS or `node_modules` override.
- [ ] After public HTTPS is valid, run the real embedded-modal keyboard, focus,
      dismissal, mobile Web3 provider, safe-area, connect/reconnect,
      clean-wallet, rejection/pending/revert, and recovery matrix. The accepted
      upstream exception does not close this QA.

### V10 Preview and consent boundary

- [x] Implement the exact canonical envelope binding target, provenance, roles,
      wallet set, caps, UUID challenge, matrix admission, canonical log, and
      one-shot authorization. The plan with `rounds=6` caps `3` approvals,
      `12` bets, and `5` resolves (`20` writes),
      `maxAffectedEpochs=11`, `34600000000000000` wei native gas, and
      `maxFailures=1`.
- [x] Make Preview publication atomic and bounded with stable log reread and
      fence-aware exact Markdown; acquire a repository-local one-shot tombstone
      and single-flight lease before RPC, then recheck provenance and consent
      immediately before the first write.
- [x] Pass the local packet: Preview environment `30/30` on the verified isolated
      Node `24.5.0` / npm `11.5.1` runtime, envelope `9/9`,
      analyzer `10/10`, store `10/10`, enforcement `2/2`, fee policy, focused
      release operations, exact-runtime TypeScript, targeted syntax checks, and
      diff hygiene. The full release-operations runner also passed with an owned
      OS-temp `LORE_DB_PATH`.
- [x] Make read-only public-environment inspection fixed-schema and secret-free.
      It now proves the local epoch-bound flag is `1`, the redacted RPC label is
      valid, and all execute gates are `0`; absent explicit network/address/token/
      deploy/indexer bindings remain visible as `null`.
- [x] Specify the transactional cross-clone/host consent ledger in
      [`transactional-ledgers-design.md`](transactional-ledgers-design.md):
      exact binding, serializable one-writer claim, idempotent persisted intent,
      ambiguity reconciliation, and tamper-evident audit chain. It is not
      implemented or externally provisioned; the local tombstone/lease still
      cannot coordinate hosts or withstand a coherent local attacker.
- [ ] Generate and review an actual Preview only on a clean immutable SHA with
      confirmed exact public configuration. The current dirty tree has no
      `authorizationReady` result and no live campaign was run.

### Truthful public and wallet data

- [x] Global stats/leaderboards use atomic scoped materialization and revision
      invalidation with isolated scale/recovery regressions.
- [x] Global stats renders loading/ready/stale/unavailable honestly; failures
      are `503`/`no-store`, never zero financial data.
- [x] Wallet settings/Header/transfer history preserve unavailable data as
      unavailable and do not display unverified zero balances or totals.
- [x] Add explicit Header `error`/`stale`/`last updated` provenance without
      inferring offline from every RPC failure; focused wallet presentation
      coverage passes locally.
- [x] Design the durable unified activity ledger for bets, claims, and wallet
      transfers in [`transactional-ledgers-design.md`](transactional-ledgers-design.md),
      including canonical event identity, reorg/finality handling, partial
      coverage, and browser-cache exclusion. Implementation, backfill, and
      external restore/reconciliation evidence remain open.

### Long-run tooling and topology

- [x] Soak status/log parsing is incremental, bounded, rotated, run-bound, and
      strict-analyzer gated.
- [x] V10 canary actions are admission/run/wallet-set bound with exact caps and
      runtime preflight validation.
- [x] Harden the local campaign runner to disable rebuildable `tsx` cache per
      child command, restore the environment fail-closed, and fail closed on
      child launch anomalies.
- [ ] Restart a new local SHA-bound campaign after adequate disk headroom;
      `local-20260821-final-r3` cycles 1–3 are historical and cycle 4 stopped
      on the now-fixed stale wallet-model expectation.
- [x] Select and document the Valkey `8.1.9` parity-runtime candidate, official
      immutable manifest digest, and mandatory Upstash-compatible HTTPS REST
      façade in [`valkey-upstash-parity-plan.md`](valkey-upstash-parity-plan.md).
      This is not a deployed-provider selection or production proof.
- [x] Execute the real `RATE_LIMIT_SCRIPT` application path through verified
      local HTTPS REST from two independent Node processes. Exact commit
      `cbf916739` has a retained clean-HEAD run covering wrong-Bearer fail-closed,
      result/error envelopes, shared count/TTL, source/SHA binding, exact Docker
      cleanup, and post-incident protected base/WAL/SHM invariants. This is
      hermetic local evidence only.
- [x] Execute the real `KEEPER_DAILY_BUDGET_SCRIPT` application path through
      the same verified local HTTPS REST topology from two independent Node
      processes. Exact commit `b53489ed` has a retained clean-HEAD run covering
      cross-replica reservation/replay/conflict, atomic cost/signature caps,
      server `TIME`/absolute-midnight `PEXPIRETIME`, prior-day reset,
      malformed-state and wrong-Bearer fail-closed, exact cleanup, protected-DB
      invariants, and source/SHA binding. This remains hermetic local evidence.
- [x] Execute `ROTATE_SESSION_SCRIPT` through the public admin-session
      application seam on the same local HTTPS REST topology. Exact commit
      `9ce4e5ca9` has a retained clean-HEAD Node `24.5.0` run covering one-winner
      two-replica CAS, cross-replica old/new cookie reads, stale-rotation and
      wrong-Bearer state/deadline preservation, exact script/key/TTL transport,
      seven-path source binding, post-cleanup provenance, graceful SQLite close,
      exact cleanup, and protected-DB identity. This is not hosted route/browser,
      provider, persistence, restore, or broad session-replay evidence.
- [x] Prove pinned Valkey engine persistence and restore semantics locally.
      Exact commit `154b29b59` runs all three scripts with unprivileged
      `appendonly=yes` / `appendfsync=always`, verifies a real restart preserves
      values and absolute expiries, copies a byte-exact RDB, deliberately mutates
      the original, removes it, and restores the pre-mutation snapshot in a
      distinct container. Clean-HEAD source binding, exact owned cleanup, OS-temp
      removal, and protected-DB invariants pass. This does not close provider
      durability, externally retained backup, deployed process rehearsal, or
      external relational DB restore.
- [x] Bind the existing local indexer/keeper/monitor process seams into one
      clean-HEAD orchestrator. Exact commit `cc0d58911` runs actual indexer
      lease-contention and crash/restart entrypoints, two production SQLite
      keeper-budget workers, and the actual monitor summary/restart drill on
      Node `24.5.0`. The signer and monitor live loop are intentionally not
      started; only loopback RPC fixtures are used. All 12 sources bind to the
      commit, owned OS-temp cleanup and protected-DB invariants pass, and the
      retained artifact SHA-256 is
      `F6949B9AB379C3350A5918CC20CC6D9BB8134E7E9DAEB3F074936D47419C0FE7`.
      This does not close deployed/provider/cross-host/external-restore work.
- [ ] Provision the reviewed deployed shared runtime and repeat all three
      application paths against that provider-managed HTTPS REST contract.
- [ ] Exercise deployed web replicas, indexer/bot/monitor, shared limiter/lock,
      cross-host consent ledger, external persistent DB, and backup/restore.

## Long-duration test campaigns

Detailed criteria are in [`testnet-hardening-plan.md`](testnet-hardening-plan.md).

- [ ] 2–4h read-only topology rehearsal.
- [ ] 6 unique-epoch signed canary after fresh Preview and separate bounded
      consent.
- [ ] After the consent-bound 6-epoch canary, run the 8–12h recovery campaign
      with controlled failures/reconciliation.
- [ ] Only after that recovery evidence, run the 24–48h soak with at least 50
      unique epochs and strict current-V10 proof.
- [ ] 2h P1.17 same-SHA native-hidden run.
- [ ] 6h HTTP load with exact latency/memory gates.
- [ ] Physical mobile/Privy HTTPS wallet matrix.
- [ ] 7-day staging observation with restore/reconciliation and alerts.

## V10/V9 and protocol policy

- [x] Routine local/prelaunch gates stay V10-oriented.
- [ ] Retain standalone V9 source/manifests/compatibility commands until
      independently evidenced canonical V10 cutover.
- [ ] Keep the known block-context randomness risk open; redesign is explicitly
      deferred.
- [ ] Require epoch-bound V10 mode in managed frontend/canary; legacy selectors
      remain compatibility-only.
- [ ] Bind the next testnet verification to canonical target
      `0x985c71613bb73fac5653c253a8ba37cd0ec8ab9a` at block `31678224`, with
      `NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS=1` and the epoch-bound
      selector required. The offline verifier passed at local `HEAD`
      `13522de026b1d73bdd0cb0ded7c1348f2e6ff7a2`; it used no network or wallet
      and does not close a live gate.

## External and live blockers

- [ ] G1–G14 remain `0/14 Complete`.
- [ ] Keep all `25` external/status blockers and `41` recorded mainnet
      environment failures open until refreshed canonical evidence changes them.
- [ ] Complete hosted TLS/HTTPS, Privy origins, ownership/randomness sign-off,
      processes, deployed web replicas with provider-managed Redis/Valkey, DB restore, shared
      cross-host consent ledger, monitoring, P1.17 two-hour/mobile wallet QA,
      and final security/QA sign-off. Production HTTPS currently fails with
      `ERR_CERT_COMMON_NAME_INVALID`.
- [ ] Generate a fresh read-only current-V10 Preview only after a clean
      immutable SHA, detached `npm ci`, supported security scan/CI, runtime
      identity, and exact public configuration checks pass. A Preview
      authorizes nothing.
- [ ] Obtain separate exact consent bound to Preview, chain/address/SHA,
      wallets, caps, gas, transaction count, epochs, and stop conditions before
      any signing material is loaded or testnet write is sent.

## Non-negotiable safety rules

- Never print or persist secrets, private keys, mnemonics, sessions, wallet
  files, keyed RPC URLs, or private environment data.
- Local green checks and environment key presence never authorize deployment,
  approval, bet, claim, canary, soak, or any chain write.
- Do not call the project mainnet-ready while immutable-SHA evidence, P1.17,
  production-like topology, external gates, and final sign-off remain open.
