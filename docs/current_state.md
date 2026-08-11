# Current State

Last updated: 2026-08-11.

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
- Live V10 provenance on the current tree passes with solc `0.8.36`, optimizer
  runs `200`, EVM `osaka`, runtime size `16488` bytes, manifest match, ABI
  snapshot match, and reviewed-fragment digest
  `69218b3a06dbe7faf71f17a33e6a4b21b2e033c6fdfa5f4ca2008dc7a2f1900c`.
- The final current-tree verification includes two consecutive
  `npm.cmd run check:summary` exits `0`, each ending with
  `Local check completed successfully`. After each, protected SQLite identity
  was unchanged, `.tmp/check-local-*` and system `lore-build-*` residues were
  `0`, and port `3101` had no listener.
- A fresh current-tree `npm.cmd ci` completed with `1195` packages from the
  lockfile. The direct `accounts` dependency is required by Wagmi's tempo
  connector and was retained after a build regression proved that dependency.
  Typecheck, hermetic production build, and the EVM-inclusive P1 runner pass
  against this lockfile.
- `npm ls --omit=dev --package-lock-only` is clean and the exact `nanoid`
  (`3.3.17`) and `js-yaml` (`4.3.1`) overrides resolve. Full
  `npm ls --all --package-lock-only` still reports six peer/resolution issues
  in the Privy/Wagmi/Sentry/toolchain graph; resolving those would require
  wallet/SDK dependency changes and remains explicit P0 work.
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
- `.gitattributes` now declares LF text checkout plus binary database/WASM
  exclusions while preserving the existing `.bat`/`.cmd` CRLF rules. The
  current checkout still has 219 CRLF/mixed tracked worktree files; mass
  normalization remains a separate reviewed commit, not a broad unreviewed
  rewrite.

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
  provenance drift checks. Repository non-test and test `parseAbi(` recounts
  are both zero.
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
  reward-scanner, live-state API, indexer-normalization, runtime-recovery, and
  cache/planner, and wallet-runtime modules. The coordinator is now 16,026
  lines; further
  source-string reduction remains open.
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
  Browser runtime now passes the mobile dock at `390x844` and `320x800` after
  the `HubContent` backdrop fix, plus sidebar Escape/focus return. The app Privy
  trigger also passes Escape/focus return.
- The Privy `3.27.2` embedded modal remains an upstream accessibility blocker:
  the email control's accessible name becomes `Submit` and the close target is
  `24x24`; no supported config/API fixes either issue. No DOM/CSS or
  `node_modules` hack was used, so full real-modal closure remains open.
- Current-tree bundle proof passes across `229` files: `8469574` total bytes,
  `7075415` JavaScript bytes, largest file `1002767`, below the `1250000`
  limit; CSS is `216635` and WASM is `1056860` bytes.
- A completed two-hour local performance run exists only for the old exact
  `46d3bc50` baseline: duration `7200035ms`, API writes `0`, external browser
  requests blocked, heap delta `-1099488`, peak `+10091819`, and DOM slope `0`.
  Native hidden-state throttling was not observed. It is useful baseline
  evidence, not evidence for the final committed candidate.
- The 2026-08-11 09:00Z prelaunch passes every required-local row: V9/V10
  compile/invariants, P1/EVM `36/36`, typecheck, 457-file lint, hermetic build,
  bundle baseline, SQLite operations, logic, security-followup, and dependency
  proofs. The all-deps proof retains `9` known development-toolchain High
  advisories.

## External and live blockers

- G1-G14 remain `0/14 Complete`. Canonical status lives in
  [`docs/mainnet-status-board.md`](mainnet-status-board.md) and
  [`docs/mainnet-proof-record.md`](mainnet-proof-record.md).
- No wallet signing, chain write, deployment, approval, bet, claim, nonce
  replacement, canary, or soak was performed during this work.
- A fresh Sepolia V10 Preview completed on 2026-08-11 with a read-only planner,
  pending-nonce dry run, and a six-round/12-planned-bet matrix; it recorded
  `transactionSent=false`, no signing material, no wallet client, and no
  contract write. It deliberately blocks G10/G11 and authorizes nothing.
  Before any write, obtain separate fresh exact consent.
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
- Residual local P2 engineering work remains for hermetic-wrapper timeout/
  process-tree ownership and same-output-directory concurrency locking.
