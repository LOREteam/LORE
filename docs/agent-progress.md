# Agent Progress

Compact handoff for active work only. Full history through 2026-08-09 is in
[`docs/archive/agent-progress-through-2026-08-09.md`](archive/agent-progress-through-2026-08-09.md).
Repository truth lives in [`docs/current_state.md`](current_state.md), and the
single active queue is [`docs/remaining-worklist.md`](remaining-worklist.md).

## Completed in the current run

- Cleanly reproduced exact baseline
  `46d3bc5072f07b4246ad1f7e516253aef5c8054b` with pinned dependencies/toolchain,
  tracked V10 provenance, two full checks, and prelaunch required-local proof.
- Scanned that exact baseline as `829f043d-0200-451f-b769-cd746800eb2a`:
  `4 High`, `13 Medium`, and `6 Low`.
- Added targeted fixes and regression tests for every permitted finding plus
  final-review bypasses. The protocol-randomness High remains open because its
  fix conflicts with the objective's ban on randomness/deployed-contract
  changes.
- Added compiler-derived V10 ABI snapshot/fragments/digest, an executable EVM
  property runner, wallet lifecycle hardening, atomic fork-aware indexer storage
  with a single-writer lease, black-box API/shared-admission tests, and bounded
  P1 orchestration.
- Replaced the remaining production `parseAbiItem` event fragments in
  `JackpotBanner` with named lookups in the compiler-derived `GAME_EVENTS_ABI`;
  its focused presentation test, typecheck, business logic, and V10 invariant
  summary all pass locally.
- Split thirty-four business-test domains out of the monolith, including the isolated
  API-recovery/storage, wallet-presentation, public API read-model,
  game-data/presentation, chat-polling, chat-content, jackpot/rebate-security,
  chat-client-safety, release-operations, runtime-metrics, error-boundary,
  wallet/route-safety, Sentry-sanitization, auth/canary-boundary, and
  client-identity/external-rate-limit, wallet-shell/mining-action, mining-runtime safety,
  explorer-link, utility-safety, wallet external-boundary, error-shell,
  dialog-accessibility, wallet-funding, jackpot-banner, wins-presentation,
  runtime-health-diagnostics, runtime-monitor alerts/config-artifact boundaries,
  public-metadata, Sidebar legal-navigation, tutorial/public-copy, HTTP/browser
  smoke-boundary, wallet-action, UI-motion/read-only, Hub read-only controls,
  and public-presentation assertions. The coordinator is now 6,210 lines;
  Pure game-data, runtime-metrics,
  canary-health, game-polling, and chat retry/polling bounds now use direct behavioral inputs
  instead of duplicated source-shape regexes; the wallet/route module keeps
  focused executable parsing, fee, monitor, and bounded-request inputs. CI was updated locally.
  for Windows, scheduled audits, indexer/P1 coverage, timeouts, concurrency, and
  compact artifacts.
- Follow-ups `e370e1ac`, `e1cff3ed`, `c7615a37`, `2ae84e04`, and `e36e9a2a`
  further extract UI/read-only, Hub, public-presentation, and strict-parser
  checks. Stored-number, summary-timeout, admin-proof, and bigint balance
  formatter guards now execute adversarial inputs directly; an isolated
  `test:logic:summary` passed in 98,834 ms with zero assertion failures and
  no timeout.
- Follow-up `f01aa22` extracts wallet-runtime state-machine coverage; direct
  logic, summary, typecheck, and lint pass for that test-only change.
- Follow-up `b8c7f669..51840d8b` adds eleven more executable domains. The first
  five direct modules and compact `test:logic:summary` integrations passed with
  unique temporary SQLite paths. Wins-presentation and runtime-health-diagnostics
  and the extracted runtime-monitor alert test pass direct/syntax/diff checks.
  The alert module now directly covers malformed/future audit metadata, backup
  metadata, canary revert/summary paths, and stale/overdue runtime snapshots;
  the duplicated coordinator regex guards were removed. Follow-up `0e60f265`
  moves the fixed-path HTTP smoke/load/browser-core assertions into their own
  imported executable module; direct module, syntax, lint, and diff checks pass.
  Follow-up `4c3b4558` moves wallet claim/receipt/repair/transfer boundary
  assertions into a dedicated imported module; direct, syntax, lint, full
  `test:logic`, and compact `test:logic:summary` pass.
  Follow-up `07c5211e` moves runtime-monitor config, artifact-reader, response,
  backup, origin, redaction, and missing-config assertions beside its direct
  alert behavior; direct, full `test:logic`, and compact summary pass.
  The exact-diff security scan `cbb0266b-4243-4fa1-a1df-7d054bddccae` accepted its canonical
  draft but completion still rejects a scanner-owned missing `snapshotDigest`;
  no canonical artifact is claimed.
- The refreshed 97-path partition is now committed locally in four logical
  commits: `69237438` runtime/data, `569e87f0` tooling, `6137dcde` tests/proof,
  and `80ce70b7` toolchain/line endings. This documentation commit completes
  the local partition before the exact-SHA scan.
- Added round/current-source presentation, mobile dock/viewport handling, Privy
  login state/accessibility, dialog/motion coverage, and a bounded performance
  evidence collector. The round presentation model now has direct local cases
  for `00:00`, active-empty, settling, keeper-delayed, stale RPC, and stale
  indexer states.
- Captured browser runtime passes for the mobile dock at `390x844` and
  `320x800`, sidebar Escape/focus return, and app-controlled Privy trigger
  Escape/focus return. The Privy `3.27.2` embedded modal itself remains blocked
  upstream by an email accessible name of `Submit` and a `24x24` close target;
  no unsupported DOM/CSS or dependency patch was introduced.
- Performed no wallet signing or chain write. The removed wallet-delegation experiment remains disabled.

## Current verification

- Current local P0 rerun at test/documentation head `eb139994` passes
  `npm.cmd run check:summary`: lint, hermetic-build test, full business logic,
  security follow-up, P1, V9/V10 invariants, indexer/storage, DB/monitoring,
  production build, typecheck, HTTP smoke, and browser smoke all exit `0`.
- The newer exact test-proof head `825514da` repeats that complete local
  `check:summary` successfully: hermetic build, full logic, P1/EVM,
  indexer/DB/monitoring, production build/typecheck, and HTTP/browser smoke
  all pass. This is local evidence only and does not seal its running diff scan.
  The gate's isolated `.tmp/check-local-*` paths were cleaned; its one
  persistent empty `lore-build-output-locks` coordination root is not an owned
  per-build temp directory.
- Exact Corepack npm `11.5.1` clean install and the follow-up head's production
  dependency audit have no blocking High/Critical. All-deps has five explicitly
  allowed non-production ESLint/minimatch High advisories
  (`@eslint/config-array`, `@eslint/eslintrc`, `brace-expansion`, `eslint`, and
  `minimatch`); this supersedes the older count of nine. Prelaunch passes every
  required-local row, while 26 external/status commands remain blocked or
  incomplete; none authorizes a wallet or chain action.
- `npm.cmd run test:p1-hardening:all:summary` - pass, `36/36`, EVM included.
- Fresh isolated core P1 runner - pass, `35/35`, EVM intentionally skipped;
  includes the executable SQLite scope/backup/restore/WAL drill and cleans its
  unique temporary database directory.
- Fresh `npm.cmd ci` completed from the refreshed lockfile; its subsequent
  typecheck, hermetic production build, and EVM-inclusive P1 run passed. The
  unused root `accounts` package was removed, `webpack@5.109.2` satisfies the
  Sentry peer, and nested `x402` now uses React-19-compatible
  `use-sync-external-store@1.6.0`.
- Functional release-candidate head `c53c0afc` restores package-local Webpack resolution for nested
  `viem` dependencies and aliases Wagmi's unused optional Tempo `accounts`
  peer to unavailable. Its exact diff scan
  `b39bde24-6ba0-4e18-9c39-38b91766187e` sealed with no findings; a clean
  install followed by production build and bundle baseline passed.
- Functional candidate `f8e93905` contains the later test-domain extractions
  and compact documentation. Its exact local scan `fa83b0ff-3fc0-4338-817d-a78fb42bdd8a`
  covers `c53c0afc..f8e93905`, is canonically sealed, and has no local findings.
- Follow-up candidate `9ab501e6` adds compact proof-summary alignment. Its exact
  scan `dd26cfc2-595f-432d-b6c7-58b12f206cdf` covers `f8e93905..9ab501e6`; the
  tracked sealed bundle has complete 18-row coverage and no local findings. This
  remains local evidence only; protocol-randomness and external G1-G14 stay open.
- V10 compilation provenance - pass; manifest and ABI snapshot match; fragment
  digest `69218b3a...1900c`; runtime size `16488` bytes.
- Two final current-tree `check:summary` runs pass and end
  `Local check completed successfully`. Each preserves current DB/WAL/SHM
  length, mtime, and SHA-256, leaves zero check/build temp directories, and
  leaves no port `3101` listener.
- Forensics on preserved copies show the earlier direct-build WAL/SHM change
  added no business/event/user rows: only two snapshot meta values and one
  empty index changed. The base DB remains `D2CF3A...C0061ABC`; current WAL/SHM
  are `B6E249...A8DFB53` and `4A0365...7E73C5`.
- All build entry points now use the adversarially tested hermetic wrapper; raw
  `next build` without its marker fails closed.
- `.gitattributes` protects LF text and binary DB/WASM assets while keeping
  `.bat`/`.cmd` CRLF. The reviewed `80ce70b7` policy plus a controlled checkout
  pass leaves zero mixed/non-batch-CRLF tracked files and no semantic Git diff;
  the index was already canonical, so no synthetic EOL-only commit was needed.
- Focused smoke - pass after canonical `Login` aria-label and exact
  `Manual Bet` selector updates. The extreme fixture now respects the
  authoritative chain epoch, with huge-bigint behavior isolated in its own
  unit test.
- `npm.cmd run perf:p1:self-test` - pass, `10/10`; maximum accepted duration is
  two hours.
- Focused suites cover admin sessions, fee policy, deposits, jackpot admission,
  API routes, health/round evidence, bootstrap locking, wallet state, indexer
  fork/lease/identity, round/mobile/Privy/motion, process identity, and V10 EVM.
- Current-tree bundle baseline after clean install - `226` files, `7500007`
  total bytes, `7162708` JS bytes, largest `1043297`, under the `1250000` limit.
- Typecheck, `457`-file lint (`0` issues), logic, logic summary,
  security-followup `8/8`, production dependency proof, both full checks, and
  prelaunch required-local rows pass. The clean all-deps proof retains `9`
  known development-toolchain High advisories under the documented policy.
- Both `46d3bc50` and `d626a0f` have completed two-hour local performance
  profiles with zero API writes and negative net heap delta. A newer two-hour
  run on build `_nq8Gl2JBW5nUIFdEeXBn` also completed (`7200040ms`): zero API
  writes, `134` blocked external requests, `105ms` max initial-load long task,
  and heap delta `+1125244` (slope `267820` bytes/hour). It is observational,
  not an accepted leak verdict, and predates the current test-only commit; the
  final exact-SHA profile and native-hidden browser throttling remain open.
- The attempted standard scan `c7662d53-c089-436a-93fd-f9506f2279f0` is
  unsealed because its artifact directory disappeared and the scan service is
  account-limited. It is not a substitute for an exact-SHA scan.
- Sealed working-tree scan `ad1649f6-e2e4-448a-b199-687e77fa4c6d` reviewed
  56 paths in snapshot `89060390...2e8eacba1f58`. It found one Medium
  hashless-pending duplicate-stake path and one Low Auto-Miner actor-switch
  authorization path. Both are fixed afterward with focused recovery/controller
  regressions, typecheck, and targeted lint; a new scan of the updated diff is
  still required.
- The two post-scan wallet fixes are included in a subsequent clean
  `test:p1-hardening:all:summary` pass: `36/36` with EVM included.
- Closed the residual hermetic build-runner P2: output locks now carry an
  owner PID/start-time identity and reclaim only a proven dead or PID-reused
  owner. Malformed, uninspectable, live, and replaced locks remain fail-closed;
  focused adversarial tests and a real `build:summary` pass are green.
- Exact committed diff scan `810da212-4774-48ae-a48f-9a5b702e8933` seals the
  `fbec521..f01aa22` test-only follow-up with canonical artifacts and no
  findings. It is a narrow supplement to the earlier candidate scan, not a
  closure for the protocol-randomness High.
- Exact committed diff scan `b39bde24-6ba0-4e18-9c39-38b91766187e` seals the
  one-file `44765951..c53c0afc` build-resolution follow-up with no findings.
- Production `npm ls --omit=dev --package-lock-only` is clean and the direct
  security pins resolve; full `npm ls --all --package-lock-only` still has six
  upstream Privy/Wagmi/Sentry/toolchain peer/resolution issues.
- Latest 2026-08-12 Sepolia V10 Preview stays inside the read-only boundary:
  no signing material, wallet client, or contract write. Planner/matrix now
  fail closed until actual runtime configuration proves
  `NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS=1`; it does not authorize
  any action or change G10/G11. The rerun stopped before a matrix log was
  created, so it supplies no canary/soak evidence.

## Active handoff

1. Preserve the zero-manual-`parseAbi`/`parseAbiItem` production ABI result,
   the two green hermetic full checks, and stable logic interfaces while
   continuing only scoped extraction.
2. The exact `c53c0afc..9eefb9cd` test-extraction range now has a sealed
   canonical local scan bundle at
   [`artifacts/security/canonical-diff-c53c0afc-9eefb9cd`](../artifacts/security/canonical-diff-c53c0afc-9eefb9cd/).
   It records no local High/Medium; keep the Workbench range-digest omission
   explicit instead of substituting an unsealed endpoint response.
3. The succeeding `c53c0afc..f8e93905` follow-up also has a sealed canonical
   bundle at
   [`artifacts/security/canonical-diff-c53c0afc-f8e93905`](../artifacts/security/canonical-diff-c53c0afc-f8e93905/).
4. Repeat the two-hour performance run on the final exact SHA and prove native
   hidden-state behavior; retain the upstream Privy modal blocker honestly.
5. Keep all live Sepolia and external G1-G14 work behind the Preview/consent and
   canonical-evidence boundaries in
   [`docs/remaining-worklist.md`](remaining-worklist.md).

## Explicit blockers

- The protocol-randomness High cannot be closed without a scope decision that
  permits a randomness redesign and replacement deployment.
- G1-G14 remain `0/14 Complete`; final production evidence is absent.
- The existing Sepolia Preview is stale and is not transaction consent.
- Mainnet policy does not allow Sepolia evidence to close G10/G11.
- Deployed Sepolia V10 has a metadata-only exact-bytecode mismatch.
- Prelaunch passes every required-local row and still reports `24`
  external/status blockers, `41` mainnet env
  failures, no testnet soak, and G1-G14 at `0/14`.
