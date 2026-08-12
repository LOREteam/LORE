# Current State

Last updated: 2026-08-12.

Detailed history is preserved in:

- [`docs/archive/current-state-through-2026-08-09.md`](archive/current-state-through-2026-08-09.md)
- [`docs/archive/agent-progress-through-2026-08-09.md`](archive/agent-progress-through-2026-08-09.md)

Open archived evidence only when a task needs it. The single active queue is
[`docs/remaining-worklist.md`](remaining-worklist.md).

## Candidate and provenance

- The last exact clean baseline is
  `46d3bc5072f07b4246ad1f7e516253aef5c8054b`. Its detached reproduction used
  Node 24/npm 11.5.1 and clean `npm ci`; V10 provenance, two full
  `check:summary` passes, and prelaunch required-local rows passed.
- The verified hardening candidate is partitioned into local commits
  `69237438` (runtime/data boundaries), `569e87f0` (hermetic tooling),
  `6137dcde` (behavioral security/P1 gates), and `80ce70b7` (toolchain and
  line endings). Follow-up commit `f01aa22` extracts the wallet-runtime test
  domain and makes the soak-status fixture independent of host disk capacity.
  Its exact committed diff scan is sealed as
  `810da212-4774-48ae-a48f-9a5b702e8933`.
- The functional release-candidate head is
  `c53c0afcddae1f77b62ebebf5a041e5b9f27ec91`. It restores package-local
  Webpack resolution for nested `viem` dependencies and keeps Wagmi's unused
  optional Tempo `accounts` peer unavailable. Exact diff scan
  `b39bde24-6ba0-4e18-9c39-38b91766187e` sealed with no findings. The current
  functional candidate is `f8e93905d705b921334d2c5cea54eb680fece63d`, containing
  only later test-domain extractions and documentation.
- The current local test-architecture follow-up is `07c5211e`, following the
  prior eleven further isolated commits. It extracts wallet external boundaries,
  error-shell
  boundaries, dialog accessibility, wallet funding presentation, jackpot-banner
  presentation, wins presentation, runtime-health diagnostics, public metadata,
  runtime-monitor alerts/config-artifact boundaries, Sidebar legal navigation,
  tutorial/public copy, and HTTP/browser smoke and wallet-action boundaries
  from the coordinator. The first five direct modules and their compact
  `test:logic:summary` integrations pass. Wins-presentation, runtime-health
  diagnostics, and runtime-monitor alerts pass focused checks, syntax, and diff
  gates. The wallet-action and runtime-monitor boundary modules pass direct,
  syntax, lint, full coordinator, and compact-summary checks. The HTTP/browser
  smoke module passes direct, syntax, lint, and diff gates; the current shared
  compact-summary rerun also passes.
  Exact-diff scan
  `cbb0266b-4243-4fa1-a1df-7d054bddccae` accepted its semantic draft, but scanner
  completion still rejects the scanner-owned missing `snapshotDigest`; this
  test-only follow-up has no canonical scan bundle yet.
- Live V10 provenance on the current tree passes with solc `0.8.36`, optimizer
  runs `200`, EVM `osaka`, runtime size `16488` bytes, manifest match, ABI
  snapshot match, and reviewed-fragment digest
  `69218b3a06dbe7faf71f17a33e6a4b21b2e033c6fdfa5f4ca2008dc7a2f1900c`.
- The prior final current-tree verification includes two consecutive
  `npm.cmd run check:summary` exits `0`, each ending with
  `Local check completed successfully`. After each, protected SQLite identity
  was unchanged, `.tmp/check-local-*` and owned per-build `lore-build-<random>`
  residues were `0`, and port `3101` had no listener. The persistent empty
  `lore-build-output-locks` directory is the wrapper's lock-coordination root,
  not a one-shot build residue.
- A fresh current-tree `npm.cmd ci` completed after the final lockfile refresh.
  The unused root `accounts` package was removed so Wagmi can resolve its own
  compatible nested versions; `webpack@5.109.2` satisfies Sentry's declared
  build peer; the only `x402` override updates its nested
  `use-sync-external-store` to the React-19-compatible `1.6.0`. Typecheck,
  hermetic production build, and the EVM-inclusive P1 runner pass against this
  lockfile.
- Exact Corepack npm `11.5.1` clean install resolves lockfile v3's
  `nanoid@3.3.17` and `js-yaml@4.3.1`. Both dependency audit gates pass:
  production has no blocking High/Critical; the current clean all-deps result
  has `5` explicitly allowed non-production ESLint/minimatch High advisories.
  npm 11's full
  `npm ls --all --package-lock-only` still reports internal invalid markers
  after a clean install, so it is evidence to investigate, not a false claim
  that the peer graph is fully clean.
- Clean-checkout reproduction for `93b58a6e` is currently blocked by local disk
  capacity, not source failure: a detached `.tmp/p0-clean-checkout-93b58a6e`
  worktree reached `ENOSPC` during its second `npm ci` after allocating about
  `553 MB` of `node_modules`, when C: had `0` bytes free. The exact temporary
  worktree was removed and only about `0.62 GiB` is now free. Do not claim a
  fresh-clean-checkout proof until sufficient workspace capacity is available.
- The protected base DB remains byte-identical at SHA-256 `D2CF3A...C0061ABC`,
  length `221184`, and its original mtime. A prior direct non-hermetic build
  changed WAL/SHM only. Forensic analysis on preserved copies found no new
  business, event, or user rows: the delta was two snapshot meta values and one
  empty index. Current WAL/SHM are `B6E249...A8DFB53` and
  `4A0365...7E73C5`. They must not be restored, checkpointed, or deleted as a
  cleanup shortcut.
- All build entry points now use a unique system-temp SQLite path, snapshot the
  canonical DB/WAL/SHM, reject protected reparse paths, verify identity after
  the child exits, and clean only the unchanged lexical temp directory. Raw
  `next build` fails closed without the wrapper marker.
- `.gitattributes` declares LF text checkout plus binary database/WASM
  exclusions while preserving `.bat`/`.cmd` CRLF rules. The `80ce70b7`
  line-ending commit supplies the reviewed policy; a controlled checkout pass
  subsequently normalized the current tracked working tree to zero mixed or
  non-batch CRLF files with no semantic Git diff. No synthetic EOL-only commit
  was needed because the index was already canonical.

## Security scan and remediation

- Standard scan `829f043d-0200-451f-b769-cd746800eb2a` ran against exact
  baseline `46d3bc5072f07b4246ad1f7e516253aef5c8054b` and reported `4 High`,
  `13 Medium`, and `6 Low` findings.
- The current tree contains targeted fixes and executable regressions for every
  permitted finding plus the bypasses found during the final combined diff
  review. The resulting controls cover admin/auth, keeper/bootstrap signing,
  wallet nonce/receipt ambiguity and fee limits, Auto-Miner authorization,
  deposits and API recovery provenance, indexer quorum/budgets/leases/rollback,
  Preview credential isolation, health origins, and hermetic builds.
- The attempted standard working-tree scan
  `c7662d53-c089-436a-93fd-f9506f2279f0` is unsealed: its artifact directory
  disappeared before record and the scan service is account-limited. It is not
  exact-SHA closure; after Git publication, the unchanged final SHA still needs
  a fresh exact-revision scan.
- A later sealed working-tree scan
  `ad1649f6-e2e4-448a-b199-687e77fa4c6d` reviewed the 56-path snapshot
  `89060390...2e8eacba1f58`. It found one Medium hashless-pending duplicate
  stake path and one Low Auto-Miner actor-switch authorization path. Both have
  now been fixed with focused tests, but the scan predates those edits and is
  not final-SHA closure. Re-scan the eventual committed candidate.
- Exact committed diff scan `810da212-4774-48ae-a48f-9a5b702e8933` covers
  `fbec5216440bd8411e7df8ca50b1f7af624e63de..f01aa22e9c40cbfda3967f21ea63f1507419e1a3`.
  It sealed canonical JSON/SARIF/Markdown artifacts with clean-worktree digest
  `codex-security-snapshot/v1:sha256:1d74df0bc5da366ec7aad16a4841552de3d91d1cb5319d4e849096130ccb54eb`
  and found no issue in its three test-orchestration surfaces. This narrow
  scan supplements the preceding candidate coverage; it does not close the
  protocol-randomness High.
- Exact committed diff scan `b39bde24-6ba0-4e18-9c39-38b91766187e` covers
  `44765951..c53c0afc`, sealed canonical JSON/SARIF/Markdown artifacts, and
  found no issue in the one build-resolution surface. It is local evidence
  only and does not close the protocol-randomness or external launch gates.
- Exact committed follow-up scan `fda49613-9367-46f1-84c7-6f82dc8ce611`
  covers `c53c0afc..9eefb9cd`. Its sealed canonical bundle is tracked at
  [`artifacts/security/canonical-diff-c53c0afc-9eefb9cd`](../artifacts/security/canonical-diff-c53c0afc-9eefb9cd/);
  it has deterministic snapshot digest `ca253f0c...dd09bb02` and no local
  High/Medium finding in the five test-extraction surfaces. The desktop
  Workbench completion endpoint omitted that required range digest, so this
  bundle was validated and sealed by the same local contract finalizer rather
  than treating the endpoint failure as a green scan.
- Exact committed follow-up scan `fa83b0ff-3fc0-4338-817d-a78fb42bdd8a`
  covers `c53c0afc..f8e93905`. Its canonical bundle is tracked at
  [`artifacts/security/canonical-diff-c53c0afc-f8e93905`](../artifacts/security/canonical-diff-c53c0afc-f8e93905/);
  all 27 changed test/proof/documentation rows were deep-reviewed and it has
  no local findings. Its scope does not close the protocol-randomness High or
  external G1-G14 evidence gates.
- Exact committed follow-up scan `dd26cfc2-595f-432d-b6c7-58b12f206cdf`
  covers `f8e93905..9ab501e6`. Its sealed canonical bundle is tracked at
  [`artifacts/security/canonical-diff-f8e93905-9ab501e6`](../artifacts/security/canonical-diff-f8e93905-9ab501e6/);
  all 18 changed rows have completion receipts and it has no local findings.
  The desktop completion endpoint failed after discovery because it omitted the
  range snapshot digest; the same plugin contract finalizer sealed the recorded
  draft after that tool-generated digest and the exact range binding were restored.
- The post-scan wallet follow-up is covered by the current integrated P1
  runner: all `36/36` bounded suites, including EVM fuzz, now pass under the
  same npm invocation used by prelaunch.
- The High protocol finding remains open: permissionless conditional-revert
  grinding can bias block-derived randomness during epoch resolution. A real
  fix requires changing the randomness design and deploying replacement
  contract behavior, while the objective explicitly forbids randomness and
  deployed-contract changes. Do not label this remediated or accepted.

## P1 local engineering state

- `test:p1-hardening:all:summary` currently passes `36/36` bounded suites with
  the EVM runner included. The EVM suite exercises eight seeded epochs,
  84 runtime transactions, 33 conservation checks, 39 expected reverts,
  duplicate/replay/late paths, large values, gas bounds, reentrancy, and hostile
  ERC-20 behavior. This is local VM evidence, not Linea sequencer evidence.
- A fresh isolated core P1 run also passed `35/35` with the EVM step skipped;
  it now includes the real SQLite scope/backup/restore/WAL drill rather than
  relying on three duplicate source-shape assertions. Its temporary DB and
  drill directory were removed by the runner.
- The compiler-derived V10 ABI snapshot, reviewed fragments, and semantic digest
  are wired into shared frontend, route, indexer, canary, and keeper paths with
  provenance drift checks. `JackpotBanner` now also resolves its three event
  definitions from `GAME_EVENTS_ABI`; no production manual `parseAbi` or
  `parseAbiItem` call remains. Tests retain only negative source assertions.
- Wallet hardening now blocks hashless ambiguous broadcasts until manual
  reconciliation and binds Auto-Miner send-time authorization to the live
  preferred actor. It also covers tracked pending approval nonces, actor/signer
  changes, retries, reload/reconnect, wrong
  network, two-tab duplication, and terminal transaction states in executable
  local tests. Real Privy/wallet signing proof remains external.
- Indexer storage now couples events/checkpoints/cursor atomically, supports
  bounded fork rollback/replay, uses an opaque single-writer lease, preserves
  log-index bet identity, and has restart/two-process WAL/busy contention tests.
- API work adds a black-box route matrix plus real two-process shared admission
  proof for jackpots/OG, deposits, and health behavior. Production two-replica
  evidence remains a G1-G14 requirement.
- Business tests have begun domain extraction into wallet, read-model,
  reward-scanner, live-state API, indexer-normalization, runtime-recovery,
  cache/planner, wallet-runtime, history-presentation, game-data/presentation,
  runtime-polling, chat-polling, chat-content, jackpot/rebate-security, and
  chat-client-safety, release-operations, runtime-metrics, error-boundary,
  wallet/route-safety, Sentry-sanitization, and auth/canary-boundary modules.
  The client-identity/external-rate-limit behavioral module now owns proxy-trust,
  shared-bucket, bounded-response, and unsafe-endpoint cases. The wallet-shell/
  mining-action module now owns the async auto-resolve and wallet-shell checks. The
  mining-runtime-safety module owns persisted-session/tab-lock/run-setup checks.
  Explorer-link normalization and hostile-input cases run through their own direct
  module. Utility-safety now executes decimal, rejection, timeout, and redact/
  bounded-error behavior directly rather than inspecting source shape. Wallet
  external-boundary, error-shell, dialog-accessibility, wallet-funding, and
  jackpot-banner, wins-presentation, runtime-health-diagnostics, runtime-monitor
  alerts/config-artifact boundaries, public-metadata, Sidebar legal-navigation,
  tutorial/public-copy, HTTP/browser smoke-boundary, wallet-action, UI-motion/
  read-only, Hub read-only, and public-presentation domains now execute from
  dedicated imported modules. The coordinator is now 6,210 lines; stored-number,
  summary-timeout, admin-proof parsing, and bigint balance formatting have
  direct adversarial behavioral inputs, and an isolated compact logic run
  passed in 98,834 ms with zero assertion failures and no timeout. The
  pending-nonce Preview network/credential
  boundary has an executable CLI regression instead of duplicate source regex;
  game-data helper bounds now run through direct behavioral inputs rather than
  duplicate source-shape checks, as do runtime-metrics, canary-health, game
  and chat polling, chat-content validation state transitions, and bounded
  wallet/route safety inputs.
  Further source-string reduction remains open.
- CI is committed with Linux and Windows rows, scheduled dependency
  audits, explicit indexer-storage/P1 gates, concurrency, timeouts, and bounded
  artifacts. No hosted run for the new candidate has completed yet.
- Focused smoke checks pass after adapting selectors to the canonical `Login`
  aria-label and exact `Manual Bet` text. The extreme fixture now follows the
  authoritative chain epoch; huge-bigint behavior remains covered separately
  by a dedicated unit test.
- Round-state/current-source evidence, a 44px mobile mining dock, safe-area and
  visual-viewport handling, Privy login state/accessibility, dialog focus
  semantics, and reduced-motion behavior have dedicated passing local suites.
  The round model executes direct `00:00`, active-empty, settling,
  keeper-delayed, stale-RPC, and stale-indexer cases locally.
  Browser runtime now passes the mobile dock at `390x844` and `320x800` after
  the `HubContent` backdrop fix, plus sidebar Escape/focus return. The app Privy
  trigger also passes Escape/focus return.
- The Privy `3.27.2` embedded modal remains an upstream accessibility blocker:
  the email control's accessible name becomes `Submit` and the close target is
  `24x24`; no supported config/API fixes either issue. No DOM/CSS or
  `node_modules` hack was used, so full real-modal closure remains open.
- After clean `npm ci`, current-tree bundle proof passes across `226` files:
  `7500007` total bytes, `7162708` JavaScript bytes, largest file `1043297`, below the `1250000`
  limit; CSS is `216635` and WASM is `1056860` bytes.
- The old exact `46d3bc50` baseline completed its two-hour local profile with
  API writes `0`, external browser requests blocked, heap delta `-1099488`,
  peak `+10091819`, and DOM slope `0`. The later exact `d626a0f` profile also
  completed its requested `7200036ms`: API writes `0`, blocked external
  requests `134`, heap delta `-702527`, peak `+2637951`, DOM delta `3`, and
  long-task maximum `95ms`. Native hidden-state throttling was not observed;
  only synthetic visibility was measured, so it remains open final-candidate
  browser evidence.
- A later two-hour run against build `_nq8Gl2JBW5nUIFdEeXBn` completed its
  requested `7200000ms` (`7200040ms` actual) with API writes `0`, external
  browser requests blocked `134`, initial-load long-task maximum `105ms`, heap
  delta `+1125244`, and sampled slope `267820` bytes/hour. That single run is
  partial—not a leak finding—because garbage collection is noisy and native
  hidden-state throttling again could not be observed; it predates the current
  test-only commit and cannot serve as final exact-SHA evidence.
- On exact package-manager audit head `b625581e`, the current-candidate prelaunch passes
  every required-local row: V9/V10
  compile/invariants, P1/EVM `36/36`, typecheck, 457-file lint, hermetic build,
  bundle baseline, SQLite operations, logic, security-followup, and dependency
  proofs. A subsequent clean `npm ci`, hermetic build, and bundle baseline
  reproduced the local build result. The current all-deps proof retains `5`
  named non-production dev-toolchain High advisories under the documented policy.
  It also reports 26 external/status commands missing or blocking evidence;
  these remain outside local completion.

## External and live blockers

- G1-G14 remain `0/14 Complete`. Canonical status lives in
  [`docs/mainnet-status-board.md`](mainnet-status-board.md) and
  [`docs/mainnet-proof-record.md`](mainnet-proof-record.md).
- No wallet signing, chain write, deployment, approval, bet, claim, nonce
  replacement, canary, or soak was performed during this work.
- The latest Sepolia V10 Preview attempt on 2026-08-12 remained fully read-only
  (`transactionSent=false`, no signing material, no wallet client, no contract
  write), but planner and matrix stopped because the current runtime omits
  `NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS=1`. Do not inject that flag
  ad hoc: validate the actual deployed V10 runtime configuration first, then
  regenerate a passing Preview. The 2026-08-12 rerun failed at those local
  preconditions before a matrix log was created; it blocks G10/G11 and
  authorizes nothing.
- Current policy requires G10/G11 evidence on Linea mainnet and says Sepolia
  closes no G1-G14 gate. The requested Sepolia soak therefore remains testnet
  evidence unless that conflict is explicitly resolved.
- Deployed Sepolia V10 remains executable but has an exact metadata-only
  bytecode mismatch. Do not bypass or silently relabel it.
- The latest prelaunch report has `24` external/status command blockers across
  backup, canary, chain, contract, environment, host, indexer, launch,
  monitoring, QA, restore, and sign-off groups. Mainnet environment validation
  has `41` failures; the testnet soak has not started.

## Safety boundaries

- The removed wallet-delegation experiment remains disabled.
- Preserve intentional user-visible refresh behavior until measured evidence
  supports a change.
- Do not read or print secrets, private RPC URLs, signing material, wallet
  files, or private environment values.
- Do not claim production, mainnet, G1-G14, browser, or long-soak readiness from
  local checks alone.
- Hermetic builds use a bounded timeout, owned process-tree termination, and a
  same-output lock that reclaims only a lock whose PID/start-time owner is
  proven gone or PID-reused. Any malformed, uninspectable, live, or replaced
  lock stays fail-closed; the focused adversarial suite and a real
  `build:summary` pass cover this local boundary.
