# Current State

Last updated: 2026-08-25.

This file is the current repository truth. Historical detail is retained under
[`docs/archive/`](archive/). The active queue is
[`remaining-worklist.md`](remaining-worklist.md); testnet campaign exit criteria
are in [`testnet-hardening-plan.md`](testnet-hardening-plan.md).

## Release-candidate snapshot

- Branch: `codex/repo-cleanup`.
- The current tested code baseline and parent of this documentation-only commit
  is `cbf916739f6a55682da0af69e5463cec1fec3581`. It commits the exact five-path
  local HTTPS/REST Valkey rate-limit parity packet after
  the retained clean-HEAD run, direct Lua-engine regression, exact manifest,
  post-incident protected base/WAL/SHM invariants, and independent `CLEAN`
  review. Its `39f68888`
  parent commits mobile-mining Package B. These are immutable local baselines,
  not the final clean-SHA release seal.
- Latest fully detached broad local-gate baseline: `333d7a81bb8780c5fc631646492ece53bbfa3926`
  (`test: cover bounded deposits recovery transport`). Its `3c8886acc` parent
  provides bounded shared admission/lease hardening and one 20-second,
  one-retry recovery transport, so a configured fallback chain cannot outlive
  the cross-replica lease. The final fixture mocks that dedicated recovery
  client for head/log reads rather than the unrelated general public client;
  production route behavior did not change. Two focused matrices passed 9
  routes, 85 black-box requests, five fault mutants, and the two-process shared
  limiter. Schema-v2 behavior audits passed at `5819/6345` behavioral assertions
  with 526 source operands and a `17/17` self-test.
- A fresh detached checkout of exact SHA `333d7a81...` completed `npm ci`,
  TypeScript, P1 hardening (`41/41` in `302424ms`), hermetic build, ESLint
  (six warnings, zero errors), and full `check-local` including browser smoke.
  The exact local launch proof preflight passed L1--L17. Standard security scan
  `6ca5758f-a4a1-43db-b772-ba98486f1223` found zero findings in its five
  reviewed critical surfaces; its report explicitly records partial source
  coverage (5 of 785 tracked files) and excludes all live/hosted activity.
  No push, deployment, wallet, signing, RPC, Preview, or chain action occurred.
- The goal's `318` paths describe a historical snapshot at `281c5fd02`; that
  candidate later grew to `320` paths and was committed in eight local commits.
  It is not the current permission scope. The parent-bound permission manifest
  is [`docs/release-candidate-current.md`](release-candidate-current.md).
  The prior authorized 74-path packet and its later corrective packets are
  committed, including the seven-path P1.17 packet at `a5ff9f595`, both
  mobile-mining packages at `aaf515d20` and `39f68888`, and local HTTPS/REST
  Valkey parity at `cbf916739`. The current five-path expected staging packet is
  documentation-only: four current Valkey/worklist/state documents plus the
  self-excluded manifest. The manifest describes the proposed amended index
  relative to parent `cbf916739`; the user-granted local commit authority does
  not widen that exact boundary.
- A disposable detached checkout of the current code mirror completed fresh
  local composite gates with exit `0`: lint, isolated business, P1 hardening,
  performance self-test, V10 invariants, SQLite operations, hermetic build,
  typegen/TypeScript, HTTP smoke, and browser smoke. This is reproducible local
  candidate evidence only: the code mirror is dirty on top of the older
  detached baseline and therefore is not an immutable final-SHA seal.
- No push, deployment, hosting change, signing, approval, wallet/RPC, Preview,
  or chain action occurred in this cycle. The only external dependency read was
  npm's advisory audit; it passed production with no high/critical finding and
  all dependencies with nine documented dev-toolchain high findings only.
- The final cleanup dry-run passed with `0` matched targets and `0` would-delete
  targets; all `4` configured whole targets were absent/skipped, while protected
  `.tmp` recovery-prefix children were excluded from candidacy. Bounded exact-path cleanup
  removed `2092` ignored cache/debug files (`286147895` bytes) from
  `.tmp-npm-runtime-115/npm-cache`, `output/playwright`, and five old root debug
  files, plus an empty `logs/` directory. Four exact TypeScript runs each
  regenerated ordinary `.next` output (`3` files, `21423` bytes); all copies
  were removed. A final pass removed five old `.serena/cache` and `.serena/logs` files (`73911`
  bytes), six unreferenced 2026-08-04 ignored summary/console files (`10998`
  bytes), and an empty `output/` directory. Cumulative exact removal in this
  packet is `2115` files and `286318496` bytes. The exact runtime, its
  dependencies, current test/release evidence, project data, recovery assets,
  browser state, and SQLite files were retained.
- A subsequent bounded cleanup apply removed `0 B`: the active
  `.tmp-npm-runtime-115` Node runtime was retained, protected `.tmp` recovery
  children and historical `artifacts/` evidence stayed in place, and the
  protected `data/lore-v10.sqlite` base remained unchanged with no WAL/SHM
  sidecars present.
- V9 remains a compatibility baseline. Routine gates are V10-oriented, but V9
  source/manifests/commands remain until independently evidenced V10 cutover.

## Protected database state

The turn began with an exact hash check of this protected trio:

- base: `258048` bytes, SHA-256
  `C6EB88E635C4B3A978AF77CE7B50736D6A6A92CC7A481E166118A66D0EC2B482`,
  mtime `2026-08-13T12:18:50.8015294Z`;
- WAL: `280192` bytes, SHA-256
  `5E841C8D75E63E3CC32087435DB3C31312D7919015A53FC0315DF08679CF015A`,
  mtime `2026-08-23T17:05:06.5621389Z`;
- SHM: `32768` bytes, SHA-256
  `D23741B73941D310CBB480BFC1DA78342414F458AF06DEDC6E5CC915451FF4A3`,
  mtime `2026-08-23T17:03:27.9843266Z`.

A diagnostic import of the common business suite was mistakenly run without an
explicit owned temporary `LORE_DB_PATH`. Import-time storage initialization
opened the configured protected path. The final read-only identity check was
stable across two samples but no longer matched the starting trio:

- current base: `319488` bytes, SHA-256
  `4EA3ECB92D5EFD081030F1C10E84C444E75460E628BB216FD063E72941BF38F7`,
  mtime `2026-08-23T22:25:17.0450020Z`;
- `data/lore-v10.sqlite-wal`: absent;
- `data/lore-v10.sqlite-shm`: absent.

This shape is consistent with a checkpoint, but no claim is made that the exact
turn-start logical state or identities were preserved. The later full business
suite used an owned OS-temp database and protected only this post-incident
snapshot; it does not prove that the starting trio remained unchanged.

The staged directory `.tmp/protected-db-recovery-exact-20260823/` was not
modified. Its base matches the starting base, but its WAL (`90672` bytes,
`F5E02ACCB60DDCFAFDE9E591E8A5F7934A198400DFB87163C461E65DDDE5B1F5`) and
SHM (`32768` bytes,
`00E17C02AE1597CBFF1CF1417BDD098D3AB3776A2DD9CFA9B9E8436D21981AEE`) are an
older pair and do not reproduce the turn-start WAL/SHM. Do not restore, delete,
checkpoint, replace, or vacuum any protected or recovery file without a new
exact approval and a separately reviewed recovery plan. Until then, run no
DB-adjacent gate and start no server against this path; every local runtime must
use an explicit owned OS-temp SQLite path.

A forensic comparison opened only exact-verified disposable copies in an owned
OS-temp directory; the originals remained byte-identical and the temp directory
was removed. Both copied logical states passed `quick_check` and
`integrity_check`. The current copy has `78` pages, schema version `72`, and
`37` rows; the staged base plus its older WAL has `74` pages, schema version
`66`, and `35` rows. All older `meta` rows are unchanged in current, which adds
two rows; shared data is otherwise identical. Current also adds an empty
`scoped_user_activity` table and newer empty `scoped_jackpots` columns. The
current base is therefore a logical superset of the available older recovery
state, so a blind rollback would discard newer state and schema. This comparison
still cannot reconstruct or prove equality with the lost `280192`-byte
turn-start WAL.

Existing backup tooling opens its SQLite source and no exact lost-WAL or safe
in-place protected-path recovery tool exists. The first safe recovery step is
permission-gated: prove quiescence, then make a raw no-overwrite byte snapshot
of the current base outside the repository with exact pre/post identity checks.
All SQLite validation must then use disposable clones. Any protected-path
replacement needs another separately reviewed plan and exact approval.

## Recent local progress

- `738b23617`: removed the demonstrably unused direct `autoprefixer`
  devDependency.
- `060bef83a` and `cec715a66`: converted MiningGrid presentation/loading
  checks into executable behavior.
- `19880845b`: added executable exact jackpot amount-format coverage.
- `3f79455a`: binds V10 canary proof actions to admission identity; this is not
  a signed canary or hosted proof.
- `d51b5bb02`: global-stats route now fails closed as `503`/`no-store`; the UI
  distinguishes loading, ready, stale, and unavailable instead of fabricating
  zero totals.
- `603c43b75`, `ef0359c95`, and `7a75f709f`: wallet balances preserve unknown
  as `null`/`—`, wallet settings render `Unavailable`, transfer-history errors
  hide unverified totals, verified zero remains `0.00`, and Header no longer
  masks a completed no-data read as perpetual loading.
- `2518babcf`: manual bet storage waits for browser restore before first persistence.
- `91f951731`, `c06a9bc9d`, and `e185c392e`: local campaign runner disables
  rebuildable `tsx` cache per child command and fail-closes launch/environment
  restore anomalies.
- `37bf7dbf8` through `7905dc764`: Hub CTA now routes an authenticated user
  without an embedded wallet into the existing wallet-creation flow; history,
  mobile rewards, canonical jackpot-share identity, direct public routes,
  indexing defaults, and opt-in Web Vitals received focused local hardening.
  The later `7905dc764` change is a recovery assertion only.
- Historical cleanup before the current packet removed only measured
  rebuildable artifacts: old Node/npm caches (about
  `1.00 GiB`), `.next`, `tsconfig.tsbuildinfo`, and eleven aged `.tmp` outputs
  (`4.4 MiB`). Dependencies, active runtime, campaign records, project data,
  browser/session data, the protected SQLite trio, and staged recovery assets were retained.
  Workspace cleanup now excludes recovery-prefix directories and fails closed on
  symlink/junction paths that resolve outside the repository.
- The current uncommitted P1.10 schema-v2 audit is `5819/6345` behavioral
  assertions (`91.71%`) with `526` source operands across `113` modules.
  Coordinator fan-out is `71` runner imports, `2` side-effect imports, and
  `71` direct calls; the audit self-test passes `17/17`. Schema v2 counts the
  full Node 24 assert surface, fails closed on unknown assert methods, resolves
  lexical bindings, and conservatively follows `readFileSync` data through
  transparent projections. It added `30` previously omitted assertions,
  removed one property-key false positive, and reclassified `31` confirmed
  transitive source-derived assertions; therefore its percentage is not
  directly comparable to the earlier schema-v1 `5775/6314` snapshot.
  Review of the `24` static release-operations source assertions found that
  they guard a Windows-only local-campaign fixture; Linux deliberately returns
  before that fixture, so no equivalent Linux behavior seam exists and the
  assertions remain fail-closed structural coverage.
  Extraction remains partial. The
  latest seams execute public deposits/rebates/jackpots failure responses,
  normal/exact rebate limiter responses, bounded all-or-fail rebate-history
  reads, rewards-route and reward-summary checksum-address normalization,
  deposits limiter/normalization/corrupt-storage behavior, public read-model
  revision/cache-key propagation, Wallet Settings focus-trap wiring, funded
  auto-resolve ordering, and wallet-transfer dedupe/address/precision/decode-failure behavior,
  SSR rebate freshness without network access, corrupt sound-storage cleanup,
  ErrorCatcher/global-error console sanitization, lazy tab fallback semantics, inert browser auto-resolve
  configuration, bounded retry parsing, Auto-Miner persistence, manual-bet notification phases,
  runtime-health route/auth wiring, BackupGate recovery copy, funding/bet panel
  SSR, Wallet Settings dialog/mobile/export/resolver presentation, truthful
  AdminOps read-only `on`/`off`/`unknown` state, sanitized wallet-signature
  fallback warnings, and all six current bounded AdminOps JSON-reading seams
  instead of source matching. The direct-route seam now executes real LorePage
  and LineaOreClient default/explicit tab propagation into runtime and renders a
  distinct runtime-returned tab, also without source matching. The Preview boundary
  fixtures now use uniquely named, extracted artifact-mutation callbacks, which
  removed `24` audit false positives without reclassifying the two intentional
  startup-order source assertions. Six fixture restoration/marker reads now remain
  behaviorally classified through a byte-identical helper rather than being
  mistaken for source inspection. Root metadata/indexing and canonical jackpot
  share/CTA behavior now run through isolated environment probes, exported policy,
  and SSR; wallet-scoped rebate/deposit/achievement/chat cache tests now exercise
  valid normalization plus malformed-address rejection. The health probe compares only boolean environment
  identity so assertion failures cannot dump `process.env`. Earlier seams cover the exact Share-on-X
  intent, client runtime/content order, Privy timeout
  suppression, chat/reduced-motion/resolver state,
  runtime-health redaction/SSR, and import-safe Preview environment behavior. The exact
  isolated Node `24.5.0` / npm `11.5.1` runtime passed the complete Preview
  environment suite, exact npm typecheck, the full release-operations runner,
  and the full isolated business suite. The latter two used owned OS-temp
  SQLite paths. The newest focused seams execute the real route error effect,
  wallet-transfer partial-coverage propagation, bigint-safe page/game balance
  formatting, and live-canary role/integer validation. The wallet-boundary
  wrapper now preserves action/external/error/dialog/funding order while
  reducing coordinator fan-out from `74/2/74` to `71/2/71`. No runtime was
  downloaded or installed in this packet. The newest exact probes add bigint-
  safe rebate route cache/watermark behavior and inspection-only release CLI
  range/canonical-integer validation.
- Three CLI modules (`monitor-runtime-health.mjs`, `smoke-browser.mjs`, and
  `check-sqlite-startup.mjs`) now load combined dotenv only on direct execution,
  so ordinary read-only imports no longer inject signing variables. A synthetic
  dotenv regression and the full isolated suite pass.
- The local V10 Preview/consent implementation is complete. Its exact canonical
  envelope binds the Sepolia target, provenance, role set, wallet set, caps,
  UUID challenge, matrix admission, canonical log, and one-shot authorization.
  The current plan with `rounds=6` caps `3` approvals, `12` bets, and `5`
  resolves (`20` writes total), `maxAffectedEpochs=11`,
  `34600000000000000` wei maximum native gas, and `maxFailures=1`.
- Preview publication is atomic and bounded; it stably rereads the canonical
  log and uses fence-aware exact Markdown parsing. A repository-local one-shot
  tombstone and single-flight
  lease are acquired before RPC; provenance and a second strict checker run
  before the first write. These local controls do not replace a transactional
  cross-host ledger, and a coherent local attacker can still rewrite local
  artifacts; this is not a cryptographic authorization boundary.
- Final review also made RPC labels short, context-bearing, and
  credential-hostile before any JSONL write; resolver nonce state is reread at
  the write sink, and the V10-only consent path no longer disables the separate
  managed-soak profile.
- The read-only Preview environment inspector now returns a fixed public schema,
  including both network names, contract/token, deploy/indexer blocks, and the
  epoch-bound flag, while omitting RPC URLs and credentials. The local public
  file proves `NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS=1`, a valid
  `linea-sepolia-public-fallback` label, and disabled execute gates. Explicit
  network/address/token/block bindings are absent, so only the canonical source
  defaults plus offline manifest are confirmed; strict runtime configuration is
  still open.

## Verification state

| Boundary | Current evidence | Status |
| --- | --- | --- |
| Wallet unavailable/error UI | Focused SSR/pure tests, TypeScript, and diff hygiene passed for `603`, `7a`, and `466`; Header now renders unavailable balances explicitly; protected DB snapshot unchanged | Pass locally |
| Wallet-model regression | Direct targeted test and full isolated business runner passed after `ef0359c95`; protected DB snapshot unchanged | Pass locally for that pre-`7a` lineage |
| Bet input persistence | Focused wallet-funding presentation tests prove manual restore-before-persist plus Auto-Miner scoped read/write/removal and denied-storage behavior; TypeScript passed | Pass locally |
| Campaign runner hardening | PowerShell script parses, diff hygiene passed, child commands run with `TSX_DISABLE_CACHE=1`, environment restoration is fail-closed, and launch anomalies fail closed | Pass locally without rerunning full campaign |
| Local campaign | Iterations 1–3 completed all seven isolated gates. Iteration 4 stopped at `business-logic-isolated` because its old model assertion expected fake zero strings while code correctly returned `null`. The protected snapshot did not change and the campaign process exited. | Historical regression evidence only; not current-SHA/final evidence |
| Current local business suite | The full isolated suite passed on the current dirty worktree after correcting a synchronous negative assertion and removing three dotenv import-time signing-environment side effects. It used an owned OS-temp SQLite path; it does not repair or validate the pre-run protected DB trio. | Pass locally; mutable worktree evidence only |
| Pre-doc local gate packet | At `7905dc764`: P1 hardening `42/42` in `139491ms`; TypeScript `typegen` plus `tsc`, standalone V10 and V9 local invariants, global-stats `10000+`, leaderboard `110003`, and the hermetic wrapper passed. | Pass locally only; not final immutable-SHA evidence |
| Read-only browser smoke | Local read-only Playwright smoke passed; screenshot: `artifacts/smoke-browser/sha7905-current-readonly.png`. It did not sign, create a wallet, approve, bet, claim, or send a transaction. | Local UI evidence only, not launch, hosted, or live-wallet proof |
| P1.10 audit | On the uncommitted working tree, schema v2 reports `5820/6346` behavioral assertions (`91.71%`) and `526` source operands across `113` modules; coordinator fan-out is `71/2/71`, and the self-test passes `17/17`. Focused same-parent x2 passed for error-boundary, wallet-model, wallet-boundary, jackpot/rebate, release-CLI configuration, reward-scanner, and mobile-mining runners; audit x2, syntax, diff hygiene, temp/poison checks, and an isolated full business summary also passed. The new probes execute real production components/hooks/CLI validation in fresh children with fetch poison, owned or deliberately absent DB paths, and no wallet, signing, RPC, network, or chain action. The reward-scanner hook probe uses a synthetic synchronous React primitive runtime, so it does not prove browser scheduler/lifecycle behavior. | Pass locally; partial objective and not committed |
| P1 hardening timeout boundary | A direct isolated `preview-env-boundary` run completed all `30/30` cases in `150472ms`, narrowly exceeding its former `150000ms` parent budget. The runner now retains a bounded `210000ms` limit. Two clean focused P1 runs then passed `41/41` in `270912ms` and `263360ms`; their preview steps took `99120ms` and `98406ms`. Audit schema v2 remained `5819/6345` behavioral assertions (`91.71%`), and its self-test passed `17/17`. | Local test-harness reliability only; P1.10 remains partial and no live behavior is implied |
| Latest P1.10 fee-policy seam | The standalone runner removes one redundant direct-approval source assertion only after existing builder behavior covers bounded legacy/EIP-1559 requests, fixed gas, legacy-field preservation, ignored caller gas override, and invalid-fee rejection. Focused x2, audit x2, and self-test `17/17` pass; the current official coordinator audit is `5820/6346` with `526` source operands. | Local test-only progress; partial objective |
| Latest P1.10 fee-policy review | The remaining source assertions bind pre-wallet/signer fee validation, guarded submission sinks, or live-write helpers. No equivalent safe public behavior seam exists without simulating risky signing paths, so they remain fail-closed structural coverage. Focused x2, audit x2, self-test `17/17`, syntax, diff, and protected-DB checks pass. | Reviewed; no removal justified |
| Latest P1.10 fee-policy review | The remaining source assertions bind pre-wallet/signer fee validation, guarded submission sinks, or live-write helpers. No equivalent safe public behavior seam exists without simulating risky signing paths, so they remain fail-closed structural coverage. Focused x2, audit x2, self-test `17/17`, syntax, diff, and protected-DB checks pass. | Reviewed; no removal justified |
| Latest P1.10 mobile-mining seam | The standalone mobile-mining runner removes one redundant `walletSetup` source assertion only after its stale-settlement behavior scenario proves reset invalidates the old rejected attempt without unlocking or overwriting the new retry. Module `69/21/48 -> 68/20/48`; focused x2, audit x2, and self-test `17/17` pass. It is outside the coordinator graph, so the current official totals are `5820/6346` with `526` source operands. | Local test-only progress; partial objective |
| Latest P1.10 docked mobile-action seam | Package A replaces two static dock-wiring assertions with real React SSR checks against the rendered manual and Auto-Miner opening tags. Both in-panel actions must carry `max-[899px]:hidden` while the separate mobile dock owns the primary CTA. Standalone classification is `68/20/48 -> 68/18/50`; focused x2, audit x2 (`5820/6346`, `526` source), self-test `17/17`, targeted ESLint, diff hygiene, protected-DB identity, and independent review pass. The runner remains outside the coordinator graph, so this module delta is not an aggregate delta. | Committed locally at `aaf515d20`; no production change |
| Latest P1.10 full-Hub mobile seam | Package B renders the real `WagmiProvider -> HubContent -> HubSidePanel` path under a denied custom transport and records zero RPC calls. It replaces two gameplay-stage source assertions and one obsolete-component literal guard with final-markup checks: responsive desktop blur is scoped, unscoped mobile blur is absent, and exactly one `mobile-mine-action` dock renders. Standalone classification is `68/18/50 -> 68/15/53`; focused x2, audit x2, self-test `17/17`, exact-runtime TypeScript, targeted ESLint, diff hygiene, protected-DB identity, and independent review pass. The direct SSR Next Image warning is non-blocking because production `next.config.mjs` already configures qualities `75` and `85`. | Committed locally at `39f68888`; no production change |
| Latest P1.10 rebate-history seam | The request-boundary runner removes two static pagination assertions only after the existing isolated child executes the real route: `limit=65` returns `400` before any DB read, while `limit=64` reaches the page read with exact `{ beforeEpoch: null, limit: 64 }` and fails closed on its mocked multicall. Focused API and route-child runners passed x2; audit x2 and self-test `17/17` pass. | Local test-only progress; partial and uncommitted |
| Latest P1.10 claim-candidates seam | The integer-query runner replaces two static pagination assertions with a fresh child that executes the real handler: `limit=401` returns `400` without opening its poisoned DB path, while `limit=400` reaches the page read with exact `{ beforeEpoch: null, limit: 400 }`. Focused x2, audit x2, and self-test `17/17` pass. | Local test-only progress; partial and uncommitted |
| Latest P1.10 auth-content-type seam | The request-boundary runner removes two redundant admin/chat auth source assertions because the independent API matrix executes both real routes with `text/plain` and proves exact JSON `415`, `no-store`, and `Vary: Cookie` handling. Focused domain and matrix runners x2, audit x2, self-test `17/17`, syntax, diff, and protected-DB checks pass. | Local test-only progress; partial and uncommitted |
| Latest P1.10 process-content-type seam | A dedicated fresh child in the request-boundary runner mocks only a valid admin session, executes the real process route with `text/plain`, and proves the exact JSON `415`, `no-store`, and `Vary: Cookie` refusal. The redundant source assertion is removed. Focused x2, audit x2, self-test `17/17`, syntax, diff, and protected-DB checks pass. | Local test-only progress; partial and uncommitted |
| Latest P1.10 Vary-normalization seam | Existing direct response-header behavior covers case-insensitive Cookie dedupe, wildcard preservation, and rejection of an invalid `Vary` token while preserving valid tokens. The redundant internal-regex assertion is removed. Focused x2, audit x2, self-test `17/17`, syntax, diff, and protected-DB checks pass. | Local test-only progress; partial and uncommitted |
| Latest P1.10 Retry-After seam | The existing rate-limit boundary now directly proves zero clamps to one second, fractional values round up, and values above a day clamp to `86400`; the redundant implementation-regex assertion is removed. Focused x2, audit x2, self-test `17/17`, syntax, diff, and protected-DB checks pass. | Local test-only progress; partial and uncommitted |
| Latest P1.10 OpenGraph query seam | The real API matrix renders the same canonical jackpot event with malicious `amount`, `kind`, `tile`, and `epoch` inputs and proves an identical PNG. The redundant static URL-parameter assertion is removed. Public-presentation and API-matrix runners x2, audit x2, self-test `17/17`, syntax, diff, and protected-DB checks pass. | Local test-only progress; partial and uncommitted |
| Transactional-ledger design | [`transactional-ledgers-design.md`](transactional-ledgers-design.md) specifies the external transactional consent state machine, idempotent intent/outbox/reconciliation protocol, immutable audit chain, and canonical activity/reorg model. It is an unimplemented design: no external PostgreSQL-compatible store, cross-host writer, migration, or restore evidence exists. | Design complete; implementation and external verification remain open |
| Valkey Lua-engine check | [`valkey-upstash-parity-plan.md`](valkey-upstash-parity-plan.md) records direct Valkey `8.1.9` `linux/amd64` execution against the pinned OCI-index digest. The isolated, no-network, no-host-port, read-only, non-persistent container passed the exact rate-limit, keeper-budget, and session-rotation scripts; the redacted artifact records script hashes only. | Partial engine evidence; rate-limit is clean-HEAD HTTPS-covered and keeper is dirty-tree HTTPS-covered, while session HTTPS, durable external DB, and restore remain open |
| Valkey HTTPS rate-limit/keeper parity | The self-spawning harness executes the real `consumeExternalRateLimit` and `reserveExternalKeeperDailyBudget` from two independent Node processes through verified Caddy TLS/SNI, a digest-pinned SRH image selected from tag `0.0.10` (no self-reported runtime version), and pinned Valkey `8.1.9`. Rate limiting passes `allowed, allowed, blocked`. Keeper passes shared reservation totals, cross-process replay, conflict without mutation, atomic cost/signature caps, tightened-policy refusal, server `TIME` plus absolute `PEXPIRETIME` at the next UTC midnight, replay/error deadline preservation, prior-day state reset, malformed-state refusal without mutation, and wrong-Bearer fail-closed without state. Valkey/SRH publish no host ports; exact owned cleanup and post-incident protected base/WAL/SHM identity pass. The prior rate-limit-only retained run binds to `cbf916739f6a55682da0af69e5463cec1fec3581`; the expanded keeper artifact is still honestly dirty-tree/unbound until its candidate commit and clean-HEAD rerun. | Honest local partial proof; session HTTPS, deployed replicas/provider, persistence, and restore remain open |
| V10 Preview/consent | Preview environment `30/30`, canonical envelope `9/9`, analyzer `10/10`, one-shot store `10/10`, runtime enforcement `2/2`, fee policy, the full release-operations runner, TypeScript, targeted syntax checks, and diff hygiene passed on the verified isolated Node `24.5.0` / npm `11.5.1` runtime. No actual Preview was generated because the tree is dirty and exact public runtime configuration was not confirmed; `authorizationReady` and all live actions remain false. | Local implementation pass only; no live authorization or campaign evidence |
| P1.17 mechanism | Self-tests pass on the current working tree: collector `158/158` (schema `4`, maximum duration `7200000`) and verifier `119/119` (schema `4`). The headed path controls the measured top-level window through page-scoped CDP, rejects unknown/minimized initial state before mutation, arms restore before the mutating command, verifies `minimized` and exact original-state readback, and restores before detach even after action/readback failure. Every routed API request is registered before fulfillment, but its epoch start is accepted only from the later BrowserContext `response` event; pre-response `0`, failure, unresolved terminal state, overflow, or drain timeout fails closed. The bounded raw cohort includes visible-control and hidden candidates. Strict verification independently recomputes the exact half-open hidden subset, path totals, rate, and cap/count parity, and validates the declared response lifecycle, terminal outcomes, and zero-pending drain. It cannot independently detect a coherent rewrite of an unsigned producer artifact, so claims are limited to internal consistency plus exact clean-SHA provenance. Raw state polling is bounded to three seconds. Actuation fields are diagnostic telemetry, while the existing strict raw `setInterval(100)` chain, trusted transition, witness, Long Task, polling, cadence, and internal-consistency checks remain authoritative. No synthetic visibility event can satisfy the native gate. | Local harness correction only; final clean-SHA native-hidden/timer evidence and the two-hour strict run remain open |
| P1.17 native witness | The latest 60-second loopback diagnostic accepted CDP `minimized`, waited `3019ms` without raw hidden, restored the exact original `normal` state, and re-observed raw visible after `5ms`. Its full raw request cohort was `8/8`, with positive response-captured epoch starts, eight `requestfinished` terminals, zero pending drain, and no missing/failed/unresolved/truncated entry. Native hidden remained `false`, so request accounting and timer status correctly stayed `not-measured`; report/runtime remained `partial`/`measured-partial`, and no hidden polling count is claimed. The separate temporary witness stayed a control rather than the actuator. The two-hour run was not started. | Current host/session cannot provide qualifying native-hidden evidence; repeat only on an interactive browser session that produces raw trusted transitions |
| P1.17 artifact separation | `collect-p1-performance-evidence.mjs` writes a full runtime collection to `artifacts/performance/p1-evidence.json` and an `--artifacts-only` diagnostic to `artifacts/performance/p1-artifacts-only-evidence.json`. Its isolated publication test proves the diagnostic file cannot overwrite the runtime evidence file. | Local collector integrity improvement only; a qualifying native-hidden JSON artifact and strict two-hour verification remain open |
| Sepolia V10 target | Canonical target is `0x985c71613bb73fac5653c253a8ba37cd0ec8ab9a` at block `31678224`; managed runtime must set `NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS=1` and require the epoch-bound selector. The offline manifest/provenance verifier passed at local `HEAD` `13522de026b1d73bdd0cb0ded7c1348f2e6ff7a2`; no network or wallet was used. | Deployed-bytecode, hosted frontend/indexer, and independent external evidence remain open |
| Production HTTPS | A fresh guest in-app browser navigation on 2026-08-23 failed at TLS with `ERR_CERT_COMMON_NAME_INVALID`; the safety interstitial was not bypassed. | External hosting/domain remediation; Privy/modal QA remains blocked |
| Privy embedded modal | `@privy-io/react-auth` remains locked/installed at `3.27.2`; the `Submit` accessible name and 24x24 provider close target are formally accepted only as the upstream exception recorded in [`docs/privy-upstream-accessibility-boundary.md`](privy-upstream-accessibility-boundary.md). The focused app-owned boundary test passes `17` cases without DOM/CSS or `node_modules` overrides. | Upstream exception accepted; real public-HTTPS keyboard/mobile/connect/recovery QA remains open |
| Supported Standard security scan | Supported entitlement remains unavailable locally | External entitlement blocker |

## Objective status

### P0

1. Resolve the protected DB incident under separately reviewed, permission-gated
   stages before every DB-adjacent gate. The current base is a valid logical
   superset of the available older recovery state, while no exact turn-start WAL
   remains; do not treat a blind copy as restoration. First preserve a raw
   no-overwrite current-base snapshot after proving quiescence, then validate
   only disposable clones. Any in-place replacement needs separate approval.
2. Use the user's local-commit authority only after a fresh zero-omission audit
   of the exact current manifest. It does not authorize push, deploy, signing,
   wallet, RPC, or chain actions.
3. On a new immutable SHA, run a detached fresh `npm ci`, dependency/local
   prelaunch gates, clean-checkout reproduction, and the supported final
   security scan when disk and entitlement permit.
4. Obtain green hosted Linux/Windows CI and real public HTTPS/Privy evidence.
5. Keep the known block-context randomness risk open; the user explicitly
   deferred the redesign.

### P1

- Continue P1.10 only at real public behavior seams.
- Treat the current Preview/consent implementation packet as locally complete;
  do not promote it to an authorization or checked live campaign.
- Collect and strictly verify the final two-hour P1.17 native-hidden evidence.
  Schema `4` is headed/raw-native and cadence fail-closed, but the actual
  browser timer distribution still requires a real final-SHA collection.
- Keep global-stat, leaderboard, and wallet data states truthful. Header
  error/stale/last-updated provenance is implemented and its focused wallet
  presentation test passes locally; hosted/browser evidence remains open.
- Restart a new SHA-bound local campaign only after its starting commit is
  captured and sufficient free disk is available. Do not reuse the stopped
  campaign as final evidence.
- Direct engine execution covers all three production Lua programs on pinned
  Valkey `8.1.9` / Linux AMD64. A separate local harness now covers the real
  rate-limit and keeper daily-budget application requests through authenticated
  HTTPS REST and two independent Node processes. The expanded keeper run still
  needs its clean-HEAD source binding. This is not a deployed-provider or
  deployed-replica claim: session HTTPS, persistent external DB/restore,
  transactional cross-host consent, hosted HTTPS/Privy, physical mobile
  wallets, signed canary, and 24–48 hour topology evidence remain open.

## External and live blockers

- G1–G14 remain `0/14 Complete`.
- The release record still has `25` external/status blockers; mainnet
  environment validation still has `41` recorded failures until refreshed
  evidence says otherwise.
- No current Preview exists or authorizes a transaction. A clean immutable SHA,
  detached fresh `npm ci`, supported security scan/CI, confirmed exact public
  configuration, and a fresh exact consent are still required. Any signing,
  approval, bet, claim, canary, soak, deployment, push, or hosted rollout needs
  its own fresh explicit authority and, for chain writes, bounded consent.
- Production HTTPS still fails with `ERR_CERT_COMMON_NAME_INVALID`; deployed
  provider-managed Redis/Valkey and web-replica topology, the P1.17 headed
  two-hour/mobile/Privy run, and a shared transactional cross-host consent
  ledger remain unchecked.

## Safety boundaries

- Never print or persist private keys, mnemonics, sessions, wallet files, keyed
  RPC URLs, or private environment values.
- Local tests and generated artifacts never prove hosted or mainnet behavior.
- Do not call the project mainnet-ready while immutable-SHA evidence, P1.17,
  topology, external gates, and final sign-off remain open.
