# Current State

Last updated: 2026-08-28.

This file is the current repository truth. Historical detail is retained under
[`docs/archive/`](archive/). The active queue is
[`remaining-worklist.md`](remaining-worklist.md); testnet campaign exit criteria
are in [`testnet-hardening-plan.md`](testnet-hardening-plan.md).

## Release-candidate snapshot

- Exact detached SHA `c318f600cc51b05fe9916e16229b5476a5b0ee57` completed
  fresh npm `11.5.1 ci` (`1315` packages), both dependency policies with zero
  blocking, V9/V10 invariants, and the complete isolated `check-local` set:
  lint, hermetic build, business logic, P1 hardening, storage/SQLite/monitoring,
  production build, typecheck, and local HTTP/browser smoke. Its prelaunch
  report also passed every required local row. The report exposed a local
  argument defect in its optional P1 final-SHA verifier: it omitted the
  verifier's mandatory isolated profiling dist directory. Commit
  `92e703e96` supplies `.next-p1-profile` and updates the report's manifest
  guard; its manifest self-test passes. The verifier now fails closed for the
  real reason (no sealed clean profiling evidence), not an invalid command.
  `c318f600c` is therefore local diagnostic evidence, not the final SHA. The
  supported Standard scan `855dad81-e5f8-4790-9986-dc900feae619` was opened
  specifically for `c318f600c`, but its required capability preflight is
  blocked by the unavailable/hanging configured Python interpreter; no source
  audit or report was started. The protected SQLite base remains
  `data/lore-v10.sqlite` SHA-256
  `4EA3ECB92D5EFD081030F1C10E84C444E75460E628BB216FD063E72941BF38F7`
  with no WAL/SHM sidecars. A new manifest commit, detached reproduction, and
  scan preflight recovery are required. External gates remain open.

- Current immutable code SHA `c300f93ef6832784ad10d2b101149e06b5b15288`
  aligns the release-operations source guard with the already-committed V10
  fallback-resolver rotation. The preceding detached candidate
  `b1d58a69bc01c0f89fd69e1adda80e2b1d2afc33` stopped honestly in the isolated
  business row because that guard still required the obsolete unrotated
  `resolvers.entries()` loop. The narrow guard correction has no production
  behavior change: offline V10 enforcement passes `3/3`, the complete isolated
  business suite passes, and TypeScript passes. The protected base remains
  `data/lore-v10.sqlite` SHA-256
  `4EA3ECB92D5EFD081030F1C10E84C444E75460E628BB216FD063E72941BF38F7`
  with no WAL/SHM sidecars. This code SHA is not sealed: create and approve a
  new exact manifest, then reproduce fresh `npm ci`, complete local/prelaunch,
  V9/V10, HTTP/browser, and protected-DB gates in a detached checkout before
  running a supported exact-SHA security scan. Hosted CI and all external
  runtime, HTTPS, Redis/topology, mobile/Privy, and live-evidence gates remain
  open. No wallet, RPC, signing, Preview, or chain action occurred.

- Exact immutable SHA `cbf93b230476b8c823daebbc8e8f4707a53903e5`
  completed detached fresh `npm ci`, dependency, V9/V10, complete local and
  prelaunch, hermetic build, TypeScript, HTTP/browser, L1--L17, and protected-DB
  gates. Supported Standard Security Scan
  `81c3c75b-4553-4bf0-8096-06021e303cb7` completed for that exact SHA with
  `16` findings (`5 high`, `10 medium`, `1 low`). The current bounded wallet
  remediation carries the reserved actor through manual approval and bet silent
  sinks, binds the Auto-Miner direct fallback approval to that same actor, and
  makes actor-change terminal before the manual direct fallback. Focused suites
  pass twice, TypeScript passes, audit x2 remains `5845/6371` (`91.74%`),
  self-test is `17/17`, P1 hardening is `41/41` in `268789ms`, and independent
  review reports all three actor-binding rows fixed. The protected SQLite base
  remains exactly `319488` bytes with SHA-256
  `4EA3ECB92D5EFD081030F1C10E84C444E75460E628BB216FD063E72941BF38F7`
  and no WAL/SHM. These source changes postdate `cbf93b230`; a new immutable
  commit, detached reproduction, and exact-SHA scan are required. The five high
  protocol/tokenomics findings remain open and were not changed.
- Branch: `codex/repo-cleanup`.
- Exact candidate `107de3734d4702113646a764e354d4f5a005c05d` completed an
  empty detached checkout, fresh `npm ci`, both dependency policies with zero
  blocking, and direct V9/V10 invariants. Its full `check-local` passed lint,
  hermetic-boundary, the complete business suite, security follow-up,
  fetch-timeout, and stored-number parsing before P1 exposed two stale test
  contracts left by the topology and actor-sink remediations. The OG route
  fixture had deleted `WEB_REPLICA_COUNT` before intentionally switching to
  production, so the new fail-closed topology rule correctly returned `503`;
  it now declares the intended single replica. The wallet-transfer source proof
  expected the old mutable embedded address at the send sink; it now requires
  `assertEmbeddedWalletActorCurrent(expectedActor)` and `address: expectedActor`.
  API route matrix x2 (`85` requests), wallet-transfer intent x2, P1 hardening
  `41/41` in `293580ms`, behavior audit x2 (`5845/6371`, `91.74%`, `526`
  source operands), self-test `17/17`, TypeScript, diff hygiene, and exact
  protected-DB identity pass. Because both test corrections postdate the
  candidate, `107de3734` is diagnostic only; the exact `19`-path delta from
  `304d3a45c` requires a new local manifest commit and full detached restart.
- Exact immutable SHA `304d3a45c22b988622d929bdc5492ae1fc53d964`
  completed an empty detached checkout, fresh `npm ci` (`1315` packages),
  both dependency policies with `0` blocking, direct V9/V10 invariants, the
  complete `check-local` package, hermetic build, TypeScript, HTTP/browser
  smoke, full prelaunch report, L1--L17, and protected-DB identity. Supported
  Standard Security Scan `b128f3de-c9c3-4521-b42d-cd4c6f72b1a8` is sealed for
  that exact SHA with honest partial coverage and `9` reportable findings:
  `2 high`, `5 medium`, and `2 low`. Local commits `b7790aab8`, `a00b4ef08`,
  `66ed497ab`, and `430df4850` subsequently close four source-remediable rows:
  embedded-wallet actor TOCTOU, Auto-Miner exact-approval recovery, undeclared
  production replica topology, and production SQLite reparse identity. Their
  focused suites pass twice, TypeScript passes after every packet, diff hygiene
  passes, and protected `data/lore-v10.sqlite` remains exactly `319488` bytes
  with SHA-256
  `4EA3ECB92D5EFD081030F1C10E84C444E75460E628BB216FD063E72941BF38F7`
  and no WAL/SHM. The two high contract findings remain open by the explicit
  no-randomness-redesign boundary. Cross-host consent remains an unimplemented
  external architecture, while chat session revocation and Sybil-resistant
  profile admission require separate product/runtime policy. The remediation
  child is not sealed until a new docs commit receives detached fresh-`npm ci`,
  full local/prelaunch reproduction, and another supported exact-SHA scan.
- Diagnostic immutable SHA
  `849b97e8a08ad64e01c954bd4d451c7760243fbe` received an empty detached
  checkout and fresh `npm ci` (`1315` packages). Production dependency policy
  passed with `0` high/critical; the complete policy passed with `9` allowlisted
  dev-toolchain high advisories and `0` blocking. Direct V9/V10 invariants
  passed. Its full `check-local` then correctly stopped in the isolated business
  row: the nonce-normalization fixture built an approval state without the new
  required `amountRaw`, so the hardened sanitizer returned `null` as designed.
  The current one-line test correction supplies `amountRaw: "1"`; the focused
  wallet-model runner and the complete isolated business suite now pass with all
  proof fields true. Production recovery behavior did not change and legacy
  amount-less state remains fail-closed. Because the correction postdates
  `849b97e8…`, a new immutable SHA and detached full seal are required.
- Current mutable baseline is exact parent
  `949b639ff8a3a3934fd3b62b1b72558915a11015` plus a bounded `14`-path
  wallet-recovery remediation packet. It binds mining approval recovery to the
  exact persisted approval amount (standard exact allowance versus Auto-Miner
  maximum allowance), verifies pending-nonce repair through a durable exact
  self/zero/empty-calldata intent and two independent RPC observations, and
  reconciles hash-known Safety Pool claims before suppressing stale actor UI.
  Hashless repair state is abandoned only for the identity-checked actor-change
  sentinel thrown before the wallet sink, or for exact two-RPC proof that the
  reserved nonce advanced; provider/user/network/session errors after entering
  the sink retain the duplicate-send block. Focused wallet/mining/rebate suites
  passed twice, TypeScript passed, schema-v2 audit passed twice at `5839/6363`
  behavioral assertions (`91.76%`, `524` source operands) with self-test
  `17/17`, and the final-source P1 hardening coordinator passed `42/42` in
  `315622ms` including EVM fuzz. Independent post-correction review found no
  actionable issue. Diff hygiene passes and protected
  `data/lore-v10.sqlite` remains exactly `319488` bytes with SHA-256
  `4EA3ECB92D5EFD081030F1C10E84C444E75460E628BB216FD063E72941BF38F7`
  and no WAL/SHM. This is mutable-worktree evidence only: an exact manifest,
  local commit, detached fresh-`npm ci` full seal, hosted CI, and a fresh
  supported security scan of the resulting SHA remain open.
- Current code head `0d5fb026487064831eb1d8eba927248bbd132c98`
  fixes the route-module contract exposed by the next exact detached candidate.
  Exact SHA `91ec244f2c7b59fd591c2c61d20bd134d7a4e9f5` received an empty detached
  checkout and fresh `npm ci` (`1315` packages). Direct Node `24.5.0` / npm
  `11.5.1` dependency policy passed with `0` production high/critical and `5`
  allowlisted dev-toolchain high advisories (`0` blocking); direct V9/V10
  invariants passed. Its full `check-local` passed lint, hermetic-boundary,
  isolated business, security/fetch/number, P1 hardening, performance self-test,
  V10, storage, and monitor rows, then correctly failed the main hermetic build:
  Next route type generation rejected the two chat-auth policy constants
  exported from `app/api/chat/auth/route.ts`. Commit `0d5fb0264` moves those
  constants to `app/api/_lib/chatSignatureVerification.ts`, leaving the route
  with only `GET` and `POST` exports. Chat-auth quorum x2, API route matrix x2
  (`85` requests), TypeScript, targeted ESLint, audit x2 (`5836/6360`,
  `91.76%`), self-test `17/17`, and exact protected-DB identity pass. A separate
  hermetic build on the mutable root remained CPU-active until the existing
  strict 20-minute child timeout and was killed; it is diagnostic, not green
  build evidence. A new immutable documentation child and detached fresh-`npm
  ci` full seal are required; `91ec244f2` is not the final SHA.
- Current remediation head `b7a678970e90ecef8011926b255561f06d895e93`
  closes the scan's final low claim-lease finding in four bounded commits:
  durable exact contract intents (`0cb1381d2`), reward/deep-reward callers
  (`862e5daa0`), connected Safety Pool claims (`45a9063d3`), and connected plus
  embedded resolver lifecycle reconciliation (`b7a678970`). Zero-value claim
  calls now reserve the exact actor/nonce/calldata before every silent or Wagmi
  provider sink, retain late hashes, remain blocked across a real reload when
  no hash is known, and clear only after two exact terminal transaction/receipt
  observations. A wallet actor switch cannot strand an already-terminal intent.
  Focused claim/intent/reward/Safety-Pool/resolver behavior passed twice,
  wallet-actions behavior passes `23` cases, TypeScript passes, audit x2 remains
  `5836/6360` behavioral (`91.76%`) with self-test `17/17`, and P1 hardening
  passes `41/41` in `273734ms`. The hermetic two-context browser fixture was
  updated for the new `keccak256` module import and passes in `2764ms` inside
  that run. Protected SQLite identity remains exact. All five medium and both
  low findings now have local fixes; both high contract findings and a fresh
  detached post-fix seal/supported scan remain open.
- Exact candidate `37c6fa56a70eccb219eb60fdf7cf6ca8cc68d2d1`
  then completed a genuinely empty detached checkout and fresh `npm ci`.
  Direct exact-runtime dependency policy passed with `0` production
  high/critical and `5` allowlisted dev-toolchain high advisories (`0`
  blocking); direct V9 and V10 invariants passed. Its first `check-local` run
  correctly stopped in isolated business logic on three stale integration
  contracts left behind by the claim remediation: the old single-client nonce
  source shape, the old `22`-case wallet marker, and the old untracked Safety
  Pool receipt helper. Local commit `409402d39` updates only those three guards
  to the two-origin nonce evidence, `23`-case behavior suite, and tracked
  terminal receipt helper. Each focused guard passed twice; the complete
  isolated business suite then passed with every wallet/claim safety proof
  field true, followed by audit x2, self-test `17/17`, syntax/diff, and exact
  protected-DB identity. Because `409402d39` postdates the detached candidate,
  a new immutable docs child and fresh detached full gate remain required.
- Exact immutable SHA `53846fe1635fea0e15c131afa5dc8020d48c0975`
  passed fresh detached `npm ci`, dependency policy, the full local/prelaunch
  package, hermetic build, TypeScript, HTTP/browser smoke, V9/V10 invariants,
  L1--L17, and protected-DB identity. Supported Standard Security Scan
  `dcc2a20f-4a50-4d89-9d40-82204b529ff3` is sealed for that SHA with partial
  source coverage (`96/787` tracked files) and `9` reportable findings:
  `2 high`, `5 medium`, and `2 low`. The generated report is a static,
  offline, read-only result; no RPC, wallet, signing, Preview, deployment,
  push, or chain action occurred.
- Current code baseline `33a090729` closes the scan's single-RPC pending-repair
  finding. Repair now requires exact `latest`/`pending` nonce agreement from
  two configured clients carrying distinct canonical RPC hosts, rejects
  duplicate origins or divergent values before the wallet sink, and uses the
  same independent pair for stable receipt verification. Focused hook behavior
  passed twice (`22` cases), wallet-transfer intent and business wallet-boundary
  suites pass, exact Node `24.5.0` TypeScript passes, and protected SQLite
  base/WAL/SHM identity is unchanged. Because source changed after the sealed
  scan, `33a090729` is not yet the new final SHA and requires a fresh detached
  seal plus another supported scan.
- Current child `6d70b0314` closes the scan's mining actor/nonce TOCTOU
  finding. Both direct approval and direct Wagmi bet requests now carry the
  exact actor whose nonce and durable intent were reserved; the bet builder
  also requires the concretely verified reservation nonce at the type boundary.
  Pure request behavior, fee policy, wallet transaction state, and TypeScript
  pass, followed by full P1 hardening `41/41` in `272173ms`. Protected SQLite
  identity remains exact and no wallet/RPC action was executed. This commit also
  postdates the sealed scan and must be included in the next detached seal/scan.
- Current child `0c673336f` closes the scan's chat identity impersonation
  finding. Message writes now snapshot only the authenticated sender's
  server-side profile, so request-body name/avatar values cannot override the
  address-bound identity; named rows also always render the shortened wallet
  address and expose the full address in `title`. API route-matrix behavior
  passed twice (`85` black-box requests each), rendered chat-client safety
  passed twice, TypeScript passed, P1 audit x2 reports `5826/6350` behavioral
  assertions (`91.75%`) with self-test `17/17`, and exact final-source P1
  hardening passed `41/41` in `271792ms`. Protected SQLite identity remains
  exact; no network, wallet, provider, RPC, signature, or transaction was used.
  This commit postdates the sealed scan and requires the next detached seal/scan.
- Current child `697f03537` closes the scan's unbounded chat-auth EIP-1271 RPC
  admission finding. Locally recoverable EOA signatures stay RPC-free;
  contract-wallet fallback now consumes a shared cross-replica budget of `8`
  verifications per minute and holds one of only `2` process-local verification
  slots, bounding provider fan-out to `4` concurrent calls per web process.
  Admission denial and a third concurrent verification fail before any witness
  call. Chat quorum and shared-limiter behavior passed twice, TypeScript passed,
  P1 audit x2 reports `5832/6356` behavioral assertions (`91.76%`) with
  self-test `17/17`, and exact final-source P1 hardening passed `41/41` in
  `271199ms`. Protected SQLite identity is exact. Tests used only mocked RPC and
  Valkey responses; real deployed multi-replica runtime proof remains open.
- Current child `6d9f60411` closes the scan's unbounded durable chat-profile
  growth finding without deleting user data. `chat_profiles` is capped at
  `2000` rows inside the existing `BEGIN IMMEDIATE` storage transaction:
  authenticated updates to an existing wallet remain allowed at capacity,
  while a new wallet receives explicit `503` before insert or revision bump.
  Route-matrix behavior passed twice with a temporary DB filled exactly to the
  cap (`85` black-box requests each), isolated public read-model/storage behavior
  passed twice, TypeScript passed, audit x2 reports `5833/6357` behavioral
  assertions (`91.76%`) with self-test `17/17`, and exact final-source P1
  hardening passed `41/41` in `271848ms`. Protected SQLite identity is exact.
  All five medium scan findings now have local fixes, but a fresh detached seal
  and supported post-fix scan are still required before claiming remediation.
- Current child `ff376d2fa` closes the scan's low one-paint transfer-history
  disclosure. Transfer summaries now carry the exact normalized embedded/
  external actor cache key, and render-time selection returns data only when
  that key matches the current wallet pair; address switch, disconnect, invalid
  identity, stale async completion, and error fallback cannot render the prior
  actor's rows while waiting for effects. Wallet-model behavior passed twice,
  TypeScript passed, audit x2 reports `5836/6360` behavioral assertions
  (`91.76%`) with self-test `17/17`, and exact final-source P1 hardening passed
  `41/41` in `271410ms`. Protected SQLite identity is exact and no wallet,
  provider, RPC, signature, or transaction was used.
- Current tested code baseline `99666ae20` closes the trusted-npm
  release-operations fixture failure exposed by the full prelaunch run at exact
  SHA `75881579d`. P1 hardening passed in that report, but the business row
  failed because the hardened minimal `PATH` correctly could not resolve bare
  `git` and then bare `powershell.exe` inside the Windows campaign fixture. The
  test-only fixture now resolves the existing allowlisted absolute Git and
  fixed System32 PowerShell paths before launching its nested child; production
  trusted-tool boundaries are unchanged. Minimal-`PATH` focused execution
  passed twice, and the actual trusted-npm full business summary passed in
  `407004ms` with every proof group true, zero assertion failures, and no
  timeout. Syntax, focused ESLint, audit x2, self-test `17/17`, diff hygiene,
  exact manifest/digests, protected DB identity, and independent review with no
  P0--P3 finding pass. A new detached clean-SHA full prelaunch/local seal is
  still required; this commit is not final-SHA evidence.
- Parent tested code baseline `20ae744f2` extends the bounded prelaunch policy
  after exact SHA `964284caa` exposed a second real watchdog defect. Its full
  report killed `test:p1-hardening:all:summary` at exactly `300000ms`; the same
  runner then passed standalone `42/42` in `296463ms`, proving that the generic
  budget had only `3537ms` of jitter headroom. P1 hardening now receives a
  `450000ms` minimum while larger explicit prelaunch budgets remain honored.
  Focused policy tests x2, syntax, focused ESLint, audit x2, self-test `17/17`,
  exact manifest/digests, and protected DB identity pass. The timed-out report's
  later business row failed transiently in `253489ms`; after all report children
  exited, the same checkout passed standalone business summary in `424388ms`
  with every proof group true and zero failures. A new clean-SHA full prelaunch
  rerun is required before either row is sealed.
- Parent code baseline `c4f921db3` fixes the required prelaunch
  `test:logic:summary` false failure. Exact clean SHA `7918fba2a` first proved
  the suite needs `387897ms`, beyond both the former `180000ms` summary default
  and `300000ms` prelaunch watchdog. The runner now defaults to `600000ms`; the
  prelaunch policy gives it `600000ms` internally and a distinct `630000ms`
  outer watchdog, preserving at least `30000ms` headroom and the existing
  `900000ms` summary parser maximum. The post-fix full isolated coordinator
  passed in `382920ms` with every API/wallet proof group true, zero assertion
  failures, and no timeout. Focused timeout/prelaunch tests passed twice,
  syntax, focused ESLint, audit x2, audit self-test `17/17`, diff hygiene, and
  protected DB identity pass. The audit is `5821/6345` behavioral (`91.74%`),
  `524` source operands, `113` modules, and `71/2/71` coordinator fan-out. This
  is local harness reliability evidence; detached final-SHA prelaunch sealing,
  hosted CI, and final supported security scan remain open.
- The prior P1.10 tested baseline is
  `8797e30d3e985a8307ad24c721258da7a86f341a`. Its exact two-file P1.10
  commit removes one `LogSourceSummary` source regex only after the existing
  fresh admin-session child executes the real authorized `/api/admin/ops` GET.
  Every returned `logSources` entry must omit an own `file` property, and the
  entire serialized payload must omit the exact escaped absolute runtime root.
  Focused x2, audit x2, self-test `17/17`, syntax, ESLint, diff hygiene, the
  complete isolated business gate, clean-HEAD focused/audit reproduction,
  cross-platform escaping probes, and protected DB identity pass on exact Node
  `24.5.0`. The current audit is `5820/6344` behavioral (`91.74%`) with `524`
  source operands across `113` modules and unchanged `71/2/71` coordinator
  fan-out. Independent review found no P0--P3 issue and confirmed Ubuntu/Windows
  CI wiring; fresh execution is local Windows only, so hosted parity remains
  open. Parent `7eee0cd9b` is the AdminOps bounded-JSON client seam, and parent
  `cc0d58911` is the local runtime-role partial baseline.
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
  Valkey parity through local persistence/restore at `154b29b59`, and local
  runtime-role wiring at `cc0d58911`, the AdminOps bounded-JSON behavioral
  replacement at `7eee0cd9b`, and the real admin-ops path-redaction behavior at
  `8797e30d3`. The current four-path expected staging packet is
  documentation-only: three current progress/worklist/state documents plus the
  self-excluded manifest. The manifest describes the proposed amended index
  relative to parent `c4f921db3`; the user-granted local commit authority does
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
- The current committed P1.10 schema-v2 audit is `5820/6344` behavioral
  assertions (`91.74%`) with `524` source operands across `113` modules.
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
  The latest domain child executes the real authorized `/api/admin/ops` route
  from an owned absolute temporary root and proves all returned log-source
  metadata omits the internal `file` property and the whole public JSON omits
  that escaped root. The child stays outside the official audit module set, so
  its two assertions do not inflate the behavioral numerator; removing the one
  redundant source guard changes only the aggregate denominator/source count.
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
| Prior P1.10 AdminOps client seam | At clean code SHA `7eee0cd9b`, schema v2 reports `5820/6345` behavioral assertions (`91.73%`) and `525` source operands across `113` modules; coordinator fan-out is `71/2/71`, and self-test passes `17/17`. The AdminOps packet runs the real client in a fresh child, invokes all nine current callbacks, forbids direct response JSON, and proves exact bounded-reader IDs with zero network calls. Focused x2, audit x2, syntax, ESLint, diff hygiene, full isolated business, clean-HEAD reproduction, protected-DB identity, and independent review pass. Reviewer P3: this current-callback proof is not a blanket guard for a future unexecuted effect/error-only path. | Committed local test-only progress; parent evidence for current P1.10 packet |
| Current P1.10 AdminOps path seam | At clean code SHA `8797e30d3`, schema v2 reports `5820/6344` behavioral assertions (`91.74%`) and `524` source operands across `113` modules; coordinator fan-out remains `71/2/71`. The real authorized ops route omits own `file` properties from every source and its exact escaped runtime root from the full public payload. Focused x2, audit x2, self-test `17/17`, syntax, ESLint, diff hygiene, full isolated business, clean-HEAD reproduction, escaping probes, protected-DB identity, and independent review pass with no P0--P3. | Committed local test-only progress; P1.10 remains partial and hosted CI parity remains open |
| P1 hardening timeout boundary | A direct isolated `preview-env-boundary` run completed all `30/30` cases in `150472ms`, narrowly exceeding its former `150000ms` parent budget. The runner now retains a bounded `210000ms` limit. Two clean focused P1 runs then passed `41/41` in `270912ms` and `263360ms`; their preview steps took `99120ms` and `98406ms`. Audit schema v2 remained `5819/6345` behavioral assertions (`91.71%`), and its self-test passed `17/17`. | Local test-harness reliability only; P1.10 remains partial and no live behavior is implied |
| Latest P1.10 fee-policy seam | The standalone runner removes one redundant direct-approval source assertion only after existing builder behavior covers bounded legacy/EIP-1559 requests, fixed gas, legacy-field preservation, ignored caller gas override, and invalid-fee rejection. Focused x2, audit x2, and self-test `17/17` pass; the current official coordinator audit is `5820/6345` with `525` source operands. | Local test-only progress; partial objective |
| Latest P1.10 fee-policy review | The remaining source assertions bind pre-wallet/signer fee validation, guarded submission sinks, or live-write helpers. No equivalent safe public behavior seam exists without simulating risky signing paths, so they remain fail-closed structural coverage. Focused x2, audit x2, self-test `17/17`, syntax, diff, and protected-DB checks pass. | Reviewed; no removal justified |
| Latest P1.10 fee-policy review | The remaining source assertions bind pre-wallet/signer fee validation, guarded submission sinks, or live-write helpers. No equivalent safe public behavior seam exists without simulating risky signing paths, so they remain fail-closed structural coverage. Focused x2, audit x2, self-test `17/17`, syntax, diff, and protected-DB checks pass. | Reviewed; no removal justified |
| Latest P1.10 mobile-mining seam | The standalone mobile-mining runner removes one redundant `walletSetup` source assertion only after its stale-settlement behavior scenario proves reset invalidates the old rejected attempt without unlocking or overwriting the new retry. Module `69/21/48 -> 68/20/48`; focused x2, audit x2, and self-test `17/17` pass. It is outside the coordinator graph, so the current official totals are `5820/6345` with `525` source operands. | Local test-only progress; partial objective |
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
| Valkey Lua-engine persistence/restore | [`valkey-upstash-parity-plan.md`](valkey-upstash-parity-plan.md) records direct Valkey `8.1.9` `linux/amd64` execution against the pinned OCI-index digest. The unprivileged, networkless, no-host-port container executes all three exact scripts with `appendonly=yes` and `appendfsync=always`; restart preserves values and absolute expiries. A byte-exact RDB is copied before deliberate state mutation, the original container is removed, and a distinct restore container recovers the pre-mutation snapshot and deadlines. The retained artifact SHA-256 is `4E96A817F1CE5C9DFBE80AA2AF24D2D5D41561C9E7617BF36288442EAAE682A5`; it binds four paths to exact SHA `154b29b592182600d118736f1c2d312d92fcc9a3`, reports clean tracked state and stable cleanup, and leaves no temp/container or protected-DB change. | Partial local engine persistence proof; provider durability, externally retained backup, deployed process rehearsal, and external relational DB restore remain open |
| Valkey HTTPS rate-limit/keeper/session parity | The self-spawning harness executes the real `consumeExternalRateLimit`, `reserveExternalKeeperDailyBudget`, `issueAdminSession`, `readAdminSession`, and `rotateAdminSession` seams from two independent Windows Node `24.5.0` processes through verified Caddy TLS/SNI, a digest-pinned SRH image selected from tag `0.0.10` (no self-reported runtime version), and pinned Valkey `8.1.9`. In addition to the rate-limit and keeper matrix, concurrent session rotation has exactly one CAS winner, both replicas read one shared active identity, the old cookie is rejected for authenticated reads, stale rotation preserves the exact record/deadline, and wrong Bearer fails without state mutation. The claim is intentionally limited to rotation CAS; it is not broad session-replay or hosted-route/browser proof. Valkey/SRH publish no host ports. The retained artifact SHA-256 is `5A6326429ECD7DE768837A9B9AF4AFAE2EEF53745DA4FAE91223301193972BDE` and reports seven relevant blobs bound to exact SHA `9ce4e5ca9809cda7b856603e2f51e1200b0f7735`, clean tracked state, stable provenance through cleanup, graceful replica DB close/exit, exact owned cleanup, and unchanged protected base/WAL/SHM identity. | Committed honest local partial proof; hosted route/browser cookie behavior, deployed replicas/provider durability/restore, and cross-host rehearsal remain open |
| Local indexer/keeper/monitor process wiring | `scripts/test-runtime-role-topology.mjs` starts four isolated child checks on exact Node `24.5.0`: actual indexer run/watch processes lose to an active two-process SQLite lease before RPC; actual indexer crash/restart resumes only finalized canonical rows through two loopback fixtures; two keeper workers share the production SQLite budget seam that `bot.ts` calls before signing; and the actual monitor summary/drill preserves alert state across restart with zero duplicate alerts. The bot signer and monitor live loop are intentionally not started. The retained artifact SHA-256 is `F6949B9AB379C3350A5918CC20CC6D9BB8134E7E9DAEB3F074936D47419C0FE7`; all 12 sources bind to exact SHA `cc0d5891159065eaa51d59607b250eda1aee3014`, tracked state is clean, owned OS-temp cleanup passes, and protected DB identity is unchanged. | Honest local role-wiring partial proof; no deployed processes, unified external store, cross-host behavior, provider restore, signing, RPC, wallet, or live monitoring proof |
| V10 Preview/consent | Preview environment `30/30`, canonical envelope `9/9`, analyzer `10/10`, one-shot store `10/10`, runtime enforcement `2/2`, fee policy, the full release-operations runner, TypeScript, targeted syntax checks, and diff hygiene passed on the verified isolated Node `24.5.0` / npm `11.5.1` runtime. No actual Preview was generated because the tree is dirty and exact public runtime configuration was not confirmed; `authorizationReady` and all live actions remain false. | Local implementation pass only; no live authorization or campaign evidence |
| P1.17 mechanism | Self-tests pass on the current working tree: collector `159/159` (schema `4`, maximum duration `7200000`) and verifier `119/119` (schema `4`). The headed path controls the measured top-level window through page-scoped CDP, rejects unknown/minimized initial state before mutation, arms restore before the mutating command, verifies `minimized` and exact original-state readback, and restores before detach even after action/readback failure. Every routed API request is registered before fulfillment, but its epoch start is accepted only from the later BrowserContext `response` event; pre-response `0`, failure, unresolved terminal state, overflow, or drain timeout fails closed. The bounded raw cohort includes visible-control and hidden candidates. Strict verification independently recomputes the exact half-open hidden subset, path totals, rate, and cap/count parity, and validates the declared response lifecycle, terminal outcomes, and zero-pending drain. It cannot independently detect a coherent rewrite of an unsigned producer artifact, so claims are limited to internal consistency plus exact clean-SHA provenance. Raw state polling is bounded to three seconds. Actuation fields are diagnostic telemetry, while the existing strict raw `setInterval(100)` chain, trusted transition, witness, Long Task, polling, cadence, and internal-consistency checks remain authoritative. `--summary-only` now reports only native-audit aggregates; the full artifact retains bounded raw observations. No synthetic visibility event can satisfy the native gate. | Local harness correction only; final clean-SHA native-hidden/timer evidence and the two-hour strict run remain open |
| P1.17 native witness | The latest 60-second loopback diagnostic accepted CDP `minimized`, waited `3019ms` without raw hidden, restored the exact original `normal` state, and re-observed raw visible after `5ms`. Its full raw request cohort was `8/8`, with positive response-captured epoch starts, eight `requestfinished` terminals, zero pending drain, and no missing/failed/unresolved/truncated entry. Native hidden remained `false`, so request accounting and timer status correctly stayed `not-measured`; report/runtime remained `partial`/`measured-partial`, and no hidden polling count is claimed. The separate temporary witness stayed a control rather than the actuator. The two-hour run was not started. | Current host/session cannot provide qualifying native-hidden evidence; repeat only on an interactive browser session that produces raw trusted transitions |
| P1.17 artifact separation | `collect-p1-performance-evidence.mjs` writes a full runtime collection to `artifacts/performance/p1-evidence.json` and an `--artifacts-only` diagnostic to `artifacts/performance/p1-artifacts-only-evidence.json`. Its isolated publication test proves the diagnostic file cannot overwrite the runtime evidence file. | Local collector integrity improvement only; a qualifying native-hidden JSON artifact and strict two-hour verification remain open |
| Sepolia V10 target | Canonical target is `0x985c71613bb73fac5653c253a8ba37cd0ec8ab9a` at block `31678224`; managed runtime must set `NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS=1` and require the epoch-bound selector. The offline manifest/provenance verifier passed at local `HEAD` `13522de026b1d73bdd0cb0ded7c1348f2e6ff7a2`; no network or wallet was used. | Deployed-bytecode, hosted frontend/indexer, and independent external evidence remain open |
| Production HTTPS | A fresh guest in-app browser navigation on 2026-08-23 failed at TLS with `ERR_CERT_COMMON_NAME_INVALID`; the safety interstitial was not bypassed. | External hosting/domain remediation; Privy/modal QA remains blocked |
| Privy embedded modal | `@privy-io/react-auth` remains locked/installed at `3.27.2`; the `Submit` accessible name and 24x24 provider close target are formally accepted only as the upstream exception recorded in [`docs/privy-upstream-accessibility-boundary.md`](privy-upstream-accessibility-boundary.md). The focused app-owned boundary test passes `17` cases without DOM/CSS or `node_modules` overrides. | Upstream exception accepted; real public-HTTPS keyboard/mobile/connect/recovery QA remains open |
| Supported Standard security scan | Scan `dcc2a20f-4a50-4d89-9d40-82204b529ff3` completed and sealed exact SHA `53846fe1635fea0e15c131afa5dc8020d48c0975`; report summary is `9` reportable findings (`2 high`, `5 medium`, `2 low`) with honest partial coverage `96/787`. Current commit `33a090729` fixes the independent-RPC pending-repair finding locally. | The scan gate is proven for `53846fe…`, not the post-fix SHA; remaining findings and a fresh exact-SHA scan stay open |

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
3. On a new immutable post-remediation SHA, repeat detached fresh `npm ci`,
   dependency/local prelaunch gates, clean-checkout reproduction, and the
   supported Standard security scan. The sealed `53846fe…` result is valid
   historical exact-SHA evidence but cannot seal `33a090729` or later source.
4. Obtain green hosted Linux/Windows CI and real public HTTPS/Privy evidence.
5. Keep the known block-context randomness risk open; the user explicitly
   deferred the redesign.

### P1

- Continue P1.10 only at real public behavior seams.
- The fresh schema-v2 audit at `dcafd2668e…` reports `5848/6374`
  behavioral assertions (`91.75%`), `526` source operands, and `113` modules.
  The `24` structural checks in `test-business-release-operations.mjs` remain:
  its executable fixture is Windows-only after the structural checks, so there
  is no equivalent Linux behavior seam yet.
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
- The separately authorized project-native V10 testnet campaign stopped at
  `589/1000` before submitting round `589`: `estimateGas` returned `gas
  required exceeds allowance (723160)`. The log shows deterministic fallback
  selection had assigned `586` resolve writes to `MANUAL`, while
  `AUTOMINER_A` had `3` and `AUTOMINER_B` had none. Commit
  `dcafd2668e2804261c948b57a4ad849fc6e88df6` rotates fallback candidates by
  epoch and proves the rotation offline. This is a runner reliability fix,
  not a completed testnet campaign or a contract conclusion.
- Direct engine execution covers all three production Lua programs on pinned
  Valkey `8.1.9` / Linux AMD64. A separate local harness now covers the real
  rate-limit, keeper daily-budget, and atomic admin-session rotation application
  requests through authenticated HTTPS REST and two independent Windows Node
  `24.5.0` processes at exact clean SHA `9ce4e5ca9`. This is not a hosted route,
  browser cookie, deployed-provider, or deployed-replica claim. Persistent external DB/restore,
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
- The earlier bounded no-Preview V10 authorization was consumed by the
  stopped `589/1000` campaign. Do not resume or replace it, fund wallets, or
  send any further testnet transaction without a new exact consent that binds
  the candidate SHA, roles, native-gas source, transaction/epoch limits, and
  stop conditions.
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
