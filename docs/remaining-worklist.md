# Remaining Worklist

Last updated: 2026-08-16. This is the single active local work queue.

## Current release-blocking sequence

- [x] Commit the hermetic build/npm partition as `9e8c65d2` and the sealed-proof
      validator partition as `281c5fd0`.
- [x] Fix the repeat-run lock-root `ENOENT` with bounded root recreation and
      identity validation; pass its focused regression twice.
- [x] Pass two consecutive final `check-local` runs, including a final exact-tree
      pass after all review fixes. Both preserve `data/lore-v10.sqlite` SHA
      `C6EB88...EC2B482`, length
      `258048`, mtime `2026-08-13T12:18:50.8015294Z`, with WAL/SHM absent,
      owned temp paths `0`, and port `3101` listeners `0`.
- [x] Refresh final exact-tree gates on the latest fully gated `297`-path snapshot:
      full check-local business passes in `79.2s`, core P1 in `139.8s`, hermetic
      build in `68.0s`, typecheck in `11.0s`, HTTP/browser smoke in
      `1.3s`/`23.9s`, and the separate V10 EVM
      fuzz/property suite passes in `6.2s` with `8` seed epochs,
      `84` successful runtime transactions, `39` expected reverts, and `33`
      conservation checks.
- [x] Refresh dependency and prelaunch reports: production `25` advisories with
      `0` High/Critical; all dependencies `37` with `9` known dev-toolchain
      High and `0` blocking; every prelaunch required-local row passes.
- [ ] Keep exactly `25` prelaunch external/status blockers open across backup,
      canary, chain, contract, environment, host, indexer, launch, monitoring,
      QA, restore, and sign-off. Mainnet validation still has `41` failures,
      Preview consent was stale at `3256m` in the latest refresh, and G1-G14
      remain `0/14 Complete`.
- [x] Keep routine `check-local`, prelaunch, and Linux/Windows CI V10-only. They
      no longer compile V9, run its invariant suite, or publish its provenance
      artifact; the latest `64`-row prelaunch passed every required-local row.
- [ ] After canonical V10 deployment and cutover evidence is complete, remove
      the standalone V9 source, manifest, commands, compatibility tests, and
      historical fallback as a separately reviewed deletion.
- [x] Locally commit the mapped `320`-path security-sensitive release
      candidate in eight reviewed partitions. This authorization does not
      authorize push, deploy, signing, or any chain transaction.
- [x] Refresh the read-only commit map after the tree expanded from `162` to
      `292` paths (`209` tracked, `83` untracked, staged `0`). The eight
      partitions assign every path exactly once with no missing, extra, or
      duplicate rows. Creating those commits still requires explicit approval.
- [x] Refresh that map for the `313`-path snapshot (`223` tracked, `90`
      untracked, staged `0`) after the documentation archive was added;
      all paths are assigned exactly once with no missing, extra, or duplicates.
- [x] Compact current-state and agent handoff documentation, preserve detailed
      history under `docs/archive/`, and keep this file as the single active
      remaining-work queue.
- [x] Remediate both suppressed findings from working-tree security scan
      `1324c08f-9411-44ba-83ab-e3efd22218fc`: reject intermediate V10 source
      reparse escapes and execute the deposits global-bound proof before emitting
      its business marker. Focused checks, typecheck, ESLint, diff-check, and the
      full business summary (`108175ms`) pass.
- [x] Replace seven dialog-focus source-only assertions with the executable
      production runtime for candidate eligibility, initial/fallback focus,
      Tab wrapping, escaped-focus recovery, fresh Escape callbacks, nested body
      scroll locks, and safe focus restoration. Focused, typecheck, ESLint,
      diff-check, and full business (`104138ms`) pass.
- [x] Replace five reduced-motion source-only assertions with the executable
      storage/media preference runtime. Invalid persisted values are removed,
      system-media listeners clean up, PageBackdrop suppresses decorative motion,
      and MaintenanceOverlay suppresses animation classes. Focused, typecheck,
      ESLint, diff-check, and full business (`104772ms`) pass.
- [x] Extract the eight production-runtime network/finality/replica/backup
      scenarios from the coordinator into a dedicated executable module. The
      move preserves all `18` behavioral assertions and their order; focused,
      full business (`78.8s`), typecheck, ESLint, and diff checks pass.
- [x] Move the strict host-proof real-CLI matrix into its existing domain
      module at the same execution point. This removes `222` coordinator lines
      while preserving one source-binding and `29` behavioral assertions;
      focused, full business (`78.9s`), typecheck, ESLint, and diff checks pass.
- [x] Enforce `73` exact launch/operator npm commands through the real command-
      map checker. Hermetic live-command and missing-alias mutants fail closed;
      `74` duplicate coordinator source assertions are removed, while focused,
      full business (`78.6s`), typecheck, ESLint, and diff checks pass.
- [x] Replace the sign-off collector/draft distinct-artifact source checks with
      the real proof-draft CLI matrix. Both cases reject one reused evidence
      file, the exact receipt includes the draft case, and focused plus full
      business (`79.1s`), typecheck, ESLint, and diff checks pass.
- [x] Make the mainnet env collector enforce its canonical 12 security gates at
      runtime. Missing or duplicate rows append a failing coverage gate; eight
      executable policy/CLI assertions replace the coordinator source loop, and
      full business (`79.7s`), typecheck, ESLint, and diff checks pass.
- [x] Remove the redundant host-proof implementation-count assertion after the
      real strict CLI matrix proved summary mode, timestamp/future rejection,
      artifact files, missing-reference redaction, and G5/G6 output. Focused and
      full business (`78.8s`), typecheck, ESLint, and diff checks pass.
- [x] Exercise both launch-gate consumers with a complete G10/G11 board that
      references 20 canary logs while only the bounded first 16 exist. Both real
      CLIs pass, the unbounded extraction mutant fails, and the coordinator
      source binding is removed; full business passes in `92.6s`.
- [x] Add the real data-sync health route to the compact business matrix with
      canonical DB cursors/epoch and hostile status timestamps, counters, block
      strings and target epochs. Success/failure/finality plus fault mutants pass;
      25 response assertions replace two source import-list checks.
- [x] Refresh the complete hermetic gate on that `297`-path snapshot; the
      canonical build reproduced `Haab6QTxPILc2q6psqdxO`, protected DB identity
      stayed exact, WAL/SHM remained absent, and owned temp/port listeners were
      both `0`.
- [x] Reconstruct the full dirty candidate in a disposable checkout without
      touching the main index: canonical Git blobs match `297/297`, fresh
      `npm ci` resolves `nanoid@3.3.18`/`js-yaml@4.3.1`, both dependency gates
      pass, and an exposed checkout-folder-name assumption is fixed. The
      corrected clone passes full `check:summary` and every required-local
      prelaunch row.
- [ ] On the resulting clean immutable SHA, run fresh detached `npm ci`, both
      dependency gates, full local/prelaunch checks, protected DB invariants,
      and clean-checkout reproducibility.
- [ ] Run and seal the supported full Standard security scan of that exact SHA.
      Working-tree diff scan `1324c08f-9411-44ba-83ab-e3efd22218fc` sealed
      complete `287/287` source coverage with `0` reportable findings and two
      rejected candidates. It covers the `297`-path tree immediately before the
      test-only checkout-name portability fix, but neither it nor older
      range/working-tree scans cover the eventual final commit; the
      protocol-randomness High also remains open.

## P0 release candidate and security

- [x] Pin `nanoid@3.3.18`, `js-yaml@4.3.1`, Node 24, and npm 11.5.1; refresh
      the lockfile and complete a clean current-tree `npm ci`. The production
      audit reports `25` total with `0` High/Critical; the all-dependency audit
      reports `37` total with `9` documented development-toolchain High and `0`
      blocking findings.
- [x] Record npm 11.5.1's remaining `npm ls --all --package-lock-only`
      invalid markers after clean install. All 34 invalid edges across nine
      packages satisfy their semver ranges; Arborist flags only the differing
      nested-override context of a hoisted node. The minimal compatibility
      work remains sufficient: do not force a wider Privy/Wagmi upgrade merely
      to silence this npm presentation limitation.
- [x] Make `check-local` hermetic and prove protected SQLite hash/mtime
      invariance across two full gates.
- [x] Track V10 source, compiler config, manifest, `.gitattributes` line-ending
      policy, and compact documentation.
- [x] Normalize tracked checkout line endings under the separate reviewed
      `80ce70b7` line-ending policy. The Git index was already canonical, so no
      synthetic content commit was created: a controlled CRLF-to-LF checkout
      pass followed by `git add` leaves zero mixed/non-batch-CRLF tracked files
      and a clean semantic diff; `.bat`/`.cmd` retain their CRLF policy.
- [x] Reproduce and scan exact clean baseline
      `46d3bc5072f07b4246ad1f7e516253aef5c8054b`; scan
      `829f043d-0200-451f-b769-cd746800eb2a` reported `4 High`, `13 Medium`,
      and `6 Low`.
- [x] Implement targeted local fixes/tests for every permitted finding and the
      bypasses found during final combined review.
- [ ] Resolve the protocol-randomness High scope conflict. Do not claim closure
      while randomness/deployed-contract changes remain forbidden.
- [x] Pass two consecutive integrated `check:summary` runs with protected
      DB/WAL/SHM identity preserved, zero temp check directories, and no port
      `3101` listener.
- [x] Refresh the publication plan for all current `96` changed paths in
      [`release-candidate-partition.md`](release-candidate-partition.md), with
      no secrets, DB files, or generated artifacts.
- [x] Commit the runtime/data, hermetic tooling, behavioral proof, and
      toolchain partitions locally. Commit the compact documentation partition
      next, then scan its exact SHA.
- [x] Record the later direct-build DB correction: unchanged main DB bytes,
      bootstrap-only WAL schema/index/meta changes, no user/runtime row
      insert/delete; subsequent checks use temp DBs and preserve the new state.
- [x] Record `c7662d53-c089-436a-93fd-f9506f2279f0` as unsealed and unusable;
  do not retry it as a substitute for a fresh exact-commit scan.
- [x] Run sealed working-tree scan
  `ad1649f6-e2e4-448a-b199-687e77fa4c6d` for the 56-path
  `89060390...2e8eacba1f58` snapshot; it found a Medium hashless-pending
  duplicate-stake path and a Low Auto-Miner actor-switch path, both fixed
  afterward with focused tests.
- [x] Seal the exact committed follow-up diff scan. Scan
  `810da212-4774-48ae-a48f-9a5b702e8933` covers
  `fbec521..f01aa22`, has canonical artifacts and clean-worktree digest
  `1d74df0b...ccb54eb`, and reported no findings in the three changed
  test-orchestration files. It supplements, rather than replaces, the earlier
  full candidate scan; the protocol-randomness High remains open.
- [x] Re-run the EVM-inclusive P1 runner after the post-scan wallet fixes:
  `36/36` passes with the final SQLite backup assertion and EVM included.
- [x] Route all build entry points through the adversarially tested hermetic
      wrapper and reject raw production builds without its marker.
- [x] Rebuild and re-baseline after clean `npm ci` on `c53c0afc`; production
      build and bundle baseline pass, and exact diff scan
      `b39bde24-6ba0-4e18-9c39-38b91766187e` reports no findings.
- [x] Seal the exact test-extraction follow-up range `c53c0afc..9eefb9cd`.
      The canonical bundle at
      [`artifacts/security/canonical-diff-c53c0afc-9eefb9cd`](../artifacts/security/canonical-diff-c53c0afc-9eefb9cd/)
      records deterministic digest `ca253f0c...dd09bb02` and no local
      High/Medium. The Workbench range-completion metadata omission is
      documented; it does not erase the sealed local contract evidence.
- [x] Seal the succeeding exact test/proof/documentation range
      `c53c0afc..f8e93905`. Scan `fa83b0ff-3fc0-4338-817d-a78fb42bdd8a` has a
      canonical bundle at
      [`artifacts/security/canonical-diff-c53c0afc-f8e93905`](../artifacts/security/canonical-diff-c53c0afc-f8e93905/)
      and no local findings across all 27 changed rows. It does not close the
      separate protocol-randomness High or external G1-G14.
- [x] Seal the succeeding test-domain extraction/proof-summary range
      `f8e93905..9ab501e6`. The canonical bundle at
      [`artifacts/security/canonical-diff-f8e93905-9ab501e6`](../artifacts/security/canonical-diff-f8e93905-9ab501e6/)
      records complete 18-row coverage and no local findings. It does not close
      the separate protocol-randomness High or external G1-G14.
- [x] Close P2 build-runner abandoned-lock recovery. Hermetic builds retain the
      bounded outer timeout and owned process-tree termination; the
      same-output-directory lock now records a PID/start-time identity and
      reclaims only a proven dead or PID-reused owner. Malformed, uninspectable,
      live, or replaced locks remain fail-closed. Focused adversarial lock tests
      and one real `build:summary` pass confirm the behavior.

## P1 code hardening

### V10 executable properties and ABI

- [x] Add seeded executable EVM properties for accounting, exits, rebate/dust/
      fee flush, duplicate/replay/late calls, large values, bounded gas,
      reentrancy, and hostile ERC-20 behavior without changing tokenomics or
      contract behavior.
- [x] Generate a compiler-derived V10 ABI snapshot, reviewed fragments, and
      semantic digest; wire shared production consumers and drift checks.
- [x] Remove residual production manual `parseAbi`/`parseAbiItem` sites,
      including `JackpotBanner`; generated ABI event lookups and drift checks
      are now the shared source of truth.

### Wallet, indexer, and API

- [x] Cover wallet rejected/reverted/pending/ambiguous/success, pending nonce,
      actor/signer change, reload/reconnect, wrong-network, two-tab, and duplicate
      send paths in local executable tests.
- [x] Make indexer event/checkpoint/cursor writes atomic; add bounded fork
      rollback/replay, opaque single-writer lease, log-index identity, restart,
      and two-process WAL/busy contention coverage. The compact summary now
      requires all 35 replay/scope/bounds/parity flags; a real temp-SQLite test
      kills each omission mutant, preserves protected DB/WAL/SHM identity and
      replaces 20 coordinator source checks.
- [x] Add a 9-route/85-request black-box API matrix and real two-process shared
      admission proof. Chat/auth/messages/profile and rewards now execute body,
      auth, method, no-store/Vary, and authenticated field-limit boundaries.
- [ ] Collect real Privy/wallet/browser evidence and production two-replica
      limiter/indexer evidence; local process tests do not close external gates.

### Test architecture and CI

- [x] Keep `test:logic`/`test:logic:summary` stable while extracting wallet,
      read-model, reward-scanner, live-state API, indexer-normalization,
      runtime-recovery, cache/planner, and wallet-runtime domains.
- [x] Add the bounded `test:p1-hardening` runner; the refreshed prelaunch all-mode
      result passes in approximately `152.1s` with the V10 EVM suite included; the core runner
      also executes the isolated SQLite scope/backup/restore/WAL drill.
- [x] Pass focused smoke with canonical `Login` aria-label and exact
      `Manual Bet` selectors; bind the extreme fixture to the authoritative
      chain epoch and keep huge-bigint coverage in a separate unit test.
- [x] Add local CI definitions for Linux/Windows, scheduled dependency audits,
      explicit indexer/P1 rows, concurrency, timeouts, and compact artifacts.
      The local checker confirms the exact npm `11.5.1` pin; hosted CI remains
      unrun for this candidate.
- [ ] Execute the production Redis shared-limit Lua under a pinned Redis or
      Valkey runtime. The current JavaScript model does not prove actual `EVAL`
      semantics, and no suitable runtime is presently available locally.
- [ ] Continue replacing source-string guards with imported behavior and reduce
      the remaining `1662`-physical-line business-test coordinator. Current
      P1.10 accounting is coordinator `178=124 source-shape + 54 behavioral`,
      `94` modules `4883=805 + 4078`, combined `5061=929 + 4132` (`81.64%`
      behavioral), so the verdict remains
      `PARTIAL`. Admin-ops integer/timestamp/progress parsing now contributes
      `22` executable assertions, removes seven route-source checks, and keeps
      unsafe live counters null through the authenticated route. UI error/
      metric/button presentation adds another `29` behavioral/SSR
      assertions, removes seven UI source checks, rejects negative ages, and
      forces non-submit action buttons. The existing fetch-timeout proof now
      runs import-safely in both business
      and standalone compact gates; 12 behavioral assertions replace seven
      source checks for strict timeout admission, abort/cleanup, and redaction.
      Shared proof-origin policy now serves 15 proof/evidence consumers; direct
      vectors and real CLI draft publication/rejection cases replace six more
      coordinator source assertions while all 308 proof-draft cases pass.
      A shared public-evidence URL helper now backs all seven launch-proof
      validators. Direct public-domain/IPv6 and private/reserved/credentialed
      vectors fixed a hostname-dot truncation defect and replaced five more
      coordinator source assertions without weakening the proof matrix.
      Sixteen exact Canary numeric, duplicate, preflight, irrelevant-artifact
      and strict-pass receipt rows plus removal mutants replace seven more
      validator-source checks. The actual analyzer now accepts epochs `10` and
      `2`, rejects malformed `3e0`, and must emit the canonical `2 / 10` order,
      replacing the final epoch-sort source guard.
      Monitoring proof now has a strict full-manifest case that rejects generic
      `monitor` notes without an artifact, public URL, or concrete identifier;
      its compact receipt replaces the neighboring source-shape assertion.
      The exported shared proof positive-integer parser now executes canonical,
      whitespace, exponent, leading-zero, decimal, and unsafe-range vectors in
      place of its coordinator source-pattern assertion.
      Restore proof now consumes shared SQLite count behavior. Fake DB
      canonical/malformed/unsafe/error rows and known-launch-row admission leave
      only one narrow production binding assertion in place of three source
      implementation checks.
      Both launch-gate consumers now call one bounded canary-log path extractor;
      Windows separators, extension rejection, the 16-path cap, and an
      unbounded-`matchAll` mutant replace their duplicated source guards.
      Wallet dependency validation now uses the trusted npm launcher and
      sanitized environment; executable command, missing/nonzero,
      malformed/startup, and redaction cases replace two source assertions.
      Shared rate-limit capacity, expiry, weak-identity ordering, no-store,
      Retry-After, and warning redaction now execute directly in the extracted
      client-identity/rate-limit module instead of twelve source checks. The
      production Redis/Valkey `EVAL` runtime evidence above remains open.
      Bundle-baseline summary/full publication, six budget failures, strict
      env/path/BUILD_ID admission, extension totals, and largest-JS ordering
      now execute through the import-safe production CLI instead of five source
      checks; the existing-build summary passes, but final-SHA measurement stays open.
      Dependency-audit orchestration adds 51 executable trusted-launch,
      counter, policy, malformed-report, redaction, and direct-run assertions
      in place of eleven coordinator source checks; both real summaries pass.
      Load-HTTP config/origin/endpoint/status/cold/global/per-endpoint policies
      now execute with 28 assertions and two explicit mutants in place of ten
      coordinator source checks; focused and full business proofs pass without
      network traffic.
      Browser smoke adds 24 executable isolated-context, bounded live-state,
      empty-pool, and terminal-redaction assertions in place of seven source
      checks. Two listener-binding counts remain until the real Playwright
      integration gate can run.
      Restore proof validation contributes
      a `308`-row
      subprocess matrix (`296` strict rejects, `7` strict passes); `32` source
      assertions were removed across validator/collector/draft coverage, with
      three narrow SQLite-count binding guards
      left for a later import-safe seam. The proof-file guard additionally
      replaces nine source checks with a 16-assertion hermetic CLI suite
      for bounded JSONL/BOM, diagnostic redaction, and file-shape/size gates.
      The 17-row local preflight likewise has 27 summary/full/adversarial
      assertions in place of 13 orchestration source checks.
      The security-follow-up gate is now import-safe and has 27 dedicated
      filesystem/summary/CLI/fault assertions in place of four coordinator
      checks of its implementation source; its real compact result passes 8/8.
      Autonomous cleanup plus the loop and manager add 91 executable in-memory
      assertions for dry-run/apply admission, canonical timeout/interval/PID
      parsing, bounded output and status/start/stop/spawn behavior in place of
      25 source checks, without creating a process or touching real cleanup state.
      Check-local import safety and executable V10-plan/isolated-DB/protected-
      hash/finalization policies plus the browser-smoke 12-step runtime manifest,
      login reload and unattended bootstrap policy replace 22 more source checks
      without starting a server or browser.
      The live-canary health boundary now executes strict length/body/UTF-8,
      status, cancellation, and whole-request deadline tests with injected fake
      fetch only; three source checks were removed and no live canary ran.
      Wallet playtest now uses an import-safe two-factor admission, bounded
      API/body deadline, and diagnostic-redaction policy. Fake-fetch tests
      replace nine detailed source checks while keeping one narrow production
      wiring guard; no wallet or network action ran.
      Hub mining guards now execute 13 read-only and exact-bigint threshold
      assertions in place of five source checks, including the required
      Auto-Miner-stop exception while new starts remain blocked.
      Hub fee estimation now executes canonical tile/range, V10 epoch-bound
      call-plan, legacy control, huge-bigint display, parallel gas/fee collection
      with a fixed debounce, calculating/unavailable labels, and shared read-only
      banner/control behavior; three narrow component wiring guards replace nine
      detailed source checks.
      Seeded visual-epoch synchronization now executes null/changed/stable/no-
      seed transitions, retaining only one narrow functional-effect binding in
      place of two detailed hook source checks.
      Nine redundant live-state timestamp/backoff/recovery, cache-TTL, and
      bigint-countdown implementation regexes are gone; direct boundary tests
      and the narrow fetch/grid/effect bindings remain.
      Global-stats cache/fetch behavior now has seventeen direct fake-storage
      and bounded-Response assertions plus two narrow hook bindings in place of
      nine detailed implementation regexes.
      Deposit/jackpot unsafe-epoch sort behavior and a broad-`Number` mutant now
      replace fifteen detailed mapper regexes; two narrow hook bindings and the
      stable-error/bounded-fetch guards remain.
      Recent-wins hidden-tab abort/admission plus tile `1..25` behavior replaces
      four source checks while preserving visible polling cadence.
The 308-row proof matrix's exact indexer case/status receipt replaces 19
      validator source checks and requires malformed/future/unsafe/artifact
      rejections plus a valid strict-pass control.
      The same exact receipt covers 20 signoff reject/pass cases and replaces
      14 source checks for distinct artifacts, timestamp/integer bounds,
      direct-chain plus app/indexer comparison and a valid strict proof.
      It also covers 28 host reject/pass cases and replaces 15 host-validator
      source checks for credentialed origins, artifact/process identity,
      finality bounds, repository DB exclusion, timestamps and strict pass.
      All 56 QA reject receipts replace nine summary plus seventeen validator/
      draft source checks and preserve fail-closed missing/shared/irrelevant
      artifacts, future/unsafe chain data, and stale, unsealed, tampered or
      self-authored security evidence. Eight wallet-specific cross-check
      rejects plus a 33-marker viewport-overflow reject now exercise the real
      validator; production-App-ID false and all six generated canary-plan UX
      rows are executable, while size/output and unrelated bindings stay
      explicit. Public HTTPS URL evidence remains accepted, while
      a private `.json` URL is now rejected instead of falling through as a path.
      Auto-Miner fields now execute through draft, strict rejection, canary-plan,
      and readiness-checklist mutation evidence.
      Mandatory wallet-artifact input no longer suppresses the Privy operator
      instruction; generated JSON contains and tests a redacted `notes` field.
      Compact/full launch proof has 18 more behavioral assertions in place of
      five source checks, including no-child summary and path redaction.
      The seven-manifest draft bundle now has executable compact-count,
      path-redaction, and temp-cleanup assertions in place of four source checks.
      The V10 summary wrapper has 31 executable command/timeout/buffer/JSON/
      counter/redaction/direct-run assertions in place of six source checks;
      its real V10 invariant run passes. The compact business-wrapper marker
      loss was fixed by preventing checkout-root executable lookup in both
      business package aliases; the npm summary now passes under pinned Node.
      The Solidity compiler-advisory domain now contributes 42 executable
      bounded-response, retry, fail-closed, import, self-test, and redaction
      assertions in place of six source checks; its compact path/SID/URL leak is
      fixed.
      The launch command-map domain contributes 14 real temp-checkout CLI
      assertions in place of eleven source checks and now keeps oversized or
      directory compact failures free of raw stacks and absolute paths.
      The readiness checklist contributes 15 CLI assertions in place of eight
      source checks and now rejects checked proof paths that escape their
      declared `docs/` or `data/` roots.
      Proof-collector redaction contributes 13 real CLI/filesystem assertions
      in place of five source checks, with exact temp cleanup and bounded
      non-destructive reject-artifact handling.
      Proof-template validation contributes seven CLI assertions in place of
      three source checks and now emits bounded path-free compact failures for
      missing, directory, oversized, absent-block, and invalid-JSON inputs.
      The existing 16-assertion proof-file CLI matrix now stands alone after
      removal of its final three redundant coordinator source checks.
      Process-model validation contributes nine temp-checkout CLI assertions
      in place of four source checks and covers malformed package/config/runtime
      mutations without starting PM2.
      Backup-summary validation contributes eleven isolated-copy assertions in
      place of two source checks and proves pre-import configuration failure plus
      bounded path-free runtime import failure.
      Mainnet-proof policy contributes 34 pure/CLI assertions in place of
      thirteen source checks, with canonical V10/deploy/replica policy and a fix
      for compact-mode proof-snapshot writes.
      Its strict-fail output guard now contributes five child-process assertions
      and exact temporary-workspace cleanup in place of the final cleanup-source
      assertion.
      Chain-proof G1, HTTPS RPC, canonical epoch and winning-tile policy adds 32
      behavioral assertions plus two narrow production bindings in place of
      seven detailed source checks; strict summary vectors prove zero RPC reads
      and redact configured endpoint values.
      Launch-doc verification adds seven real temp-file/CLI adversarial cases in
      place of seven source checks. Compact and prelaunch output now expose the
      bounded package-script reference overflow counter instead of returning a
      failing status with every diagnostic counter at zero.
      Remaining-launch reporting adds 31 real CLI/JSON/fault assertions in
      place of twelve source checks, preserves every G1-G14 action and the G14
      final-security blockers, keeps live work behind fresh Preview plus exact
      consent, and now rejects directory/oversized inputs with bounded path-free
      output.
      The compact
      summary now consumes an executed
      proof marker instead of scanning sources; prelaunch formatting,
      classification, redaction, row streaming, and manifest faults now run as
      26 hermetic summary vectors instead of 64 coordinator source assertions;
      bounded JSON/query parsing and
      signed admin-auth TTL/path/replay boundaries now run behaviorally. The client-identity/
      external-rate-limit behavior, wallet-shell/mining-action checks, and mining-runtime
      safety, explorer-link, and utility-safety checks now run
      from their own imported modules; the
      API-recovery/storage,
      wallet-presentation, and public API read-model
      (rewards/recent-wins/leaderboards) assertions now run
      from imported modules, and the pending-nonce
      Preview network/credential boundary has executable CLI coverage instead
      of duplicate coordinator regex, and analytics history and game-data/
      presentation, runtime-metrics, error-boundary, runtime-polling, chat-polling, chat-content, release-operations, wallet/route-safety, Sentry-sanitization, and auth/canary-boundary tests now run from
      their own imported modules; pure game-data, runtime-metrics, canary-health, and chat retry bounds use
      direct behavioral inputs. Wallet external-boundary, error-shell,
      dialog-accessibility, wallet-funding, jackpot-banner, wins-presentation,
      runtime-health-diagnostics, runtime-monitor alerts/config-artifact
      boundaries, public-metadata, Sidebar legal-navigation, tutorial/public-copy,
      HTTP/browser smoke-boundary, wallet-action, UI-motion/read-only, Hub
      read-only controls, and public-presentation assertions now also execute
      from isolated imported modules. Shared stored-number and summary-timeout
      parsers, admin-proof canonicalization, and bigint balance formatting now
      run direct adversarial behavioral inputs; the final exact-tree business
      proof passed in approximately `87.9s`. Security follow-up passes `8/8`.
      Rewards/public-read-model binding and the hermetic temp-cleanup leak were
      fixed before that run. The autonomous exact-manifest/false-green clamp fix
      and indexer normalization bindings were independently reviewed `CLEAN`.
      Chat-profile local/remote persistence now has executable one-time legacy
      migration, cross-wallet isolation, scoped corruption cleanup, canonical
      wallet/request binding, and bounded/redacted save-error evidence; the
      refreshed full business summary passed with zero assertion failures.
      Stable chat-wallet selection plus unread/row ownership now execute 23
      canonical-address, storage-failure, stale-cleanup, persistence, and
      malformed-sender assertions with three killed mutants. HeaderWalletCard
      then adds 25 executable state/a11y
      assertions and two rejected mutants replace three source regexes. The
      final business summary passes in `98352ms`. The reproducible current
      `npm.cmd run audit:p1:behavior` AST audit is
      `5160=745 source-operand + 4415 behavioral` (`85.56%` behavioral) across
      the 429-line coordinator and `95` direct modules; P1.10 remains `PARTIAL`;
      sixteen redundant indexer finality/restart, strict epoch-parser, route-cache,
      and Auto-Miner retry source checks were removed in favor of their existing
      executable public-function boundary cases. Release documentation and
      environment-template checks now run from a direct module.
- [x] Expand the black-box API matrix to 9 routes/85 real Next dispatch
      requests, including 41 supported mutating/auth boundaries, temp-DB
      side-effect checks, and network-disabled mocks; add 96 deterministic
      seeded redaction-fuzz cases.
- [ ] Run and seal a full Standard security scan of the final clean immutable
      SHA. Range scan `59fa2d72-fff1-4d46-bb7d-5b94d507ac80` completed all
      `34/34` reviews with no candidate but failed canonical completion because
      Codex Security `0.1.18` cannot persist the `snapshotDigest` its
      `git_diff` schema requires for commit/range targets. Do not retry or call
      that failed scan canonical; the supported Standard path uses
      `target.kind=git_revision` and binds the exact final `revision`.
- [x] Re-run the full local `check:summary` at exact test-proof head `825514da`:
      lint, hermetic build, logic, P1/EVM, indexer/DB/monitoring, build/typecheck,
      and HTTP/browser smoke pass. This does not seal the running exact-diff scan
      or close any external G1-G14 gate.
- [x] Preserve the older local P0 evidence at exact `8d42cdb3`: Corepack/npm
      `11.5.1` clean install, both dependency audits, and every prelaunch
      required-local row pass. Production has `0` High/Critical and all-deps
      has `1` allowed dev High with `0` blocking. Keep all `25` external/status
      blockers and the optional deployed-identity metadata mismatch open; no
      wallet or chain action is authorized by these local gates.
- [x] Re-run clean-checkout reproducibility at exact `8d42cdb3`: fresh detached
      checkout, Node `24.5.0`, npm `11.5.1`, `npm ci`, pinned dependency proof,
      and full `check:summary` all pass. The canonical DB/WAL/SHM identity is
      unchanged, owned temp directories are cleaned, and port `3101` is closed.
- [ ] Repeat clean-checkout reproducibility for the eventual commit containing
      `9e8c65d2`, `281c5fd0`, and the approved current production/test/docs
      partitions. The older `8d42cdb3` result is not final-candidate proof.
- [ ] Obtain green hosted CI evidence for the final exact commit.

## UX, accessibility, and performance

- [x] Add one round/current-source presentation model for exact zero, resolving,
      keeper-delayed, stale RPC/indexer, active-empty, and resolved-next states;
      direct local tests cover the first six presentation branches.
- [x] Add the guarded 44px mobile mining dock with selected amount/total,
      Manual Bet/Auto-Miner actions, chat exclusion, safe-area, and visual
      viewport handling.
- [x] Add local Privy login-state/accessibility, dialog focus/Escape/return, and
      reduced-motion regression suites.
- [x] Verify the mobile dock at `390x844` and `320x800` after the `HubContent`
      backdrop fix, plus sidebar dialog Escape/focus return, in browser runtime.
- [x] Verify app-controlled Privy trigger Escape/focus return.
- [ ] Resolve or explicitly accept the upstream Privy `3.27.2` embedded-modal
      blockers: email accessible name `Submit` and `24x24` close target. There
      is no supported config/API fix; do not patch DOM/CSS or `node_modules`.
- [ ] Complete real-modal keyboard/mobile Web3-provider, safe-area, focus-trap,
      wallet, and recovery evidence after the upstream blocker is resolved.
- [x] Add a loopback-only bounded performance collector; schema 2 self-test
      passes `80` cases and accepts up to two hours. It records before/after
      HEAD, dirty-state digest, and production-build byte identity, while
      refusing RC eligibility for dirty or unsealed provenance.
- [x] Add a strict performance-evidence verifier; its self-test passes `44`
      cases, rejects incomplete or unsealed candidate evidence, and redacts
      paths, Windows identities/SIDs, and URLs from compact fatal errors.
- [x] Capture current-tree bundle baseline after clean install: `226` files,
      `7500007` total bytes, `7162708` JS bytes, largest `1043297` under limit
      `1250000`.
- [x] Complete the two-hour local profile for the old exact `46d3bc50`
      baseline: API writes `0`, external browser requests blocked, net heap
      delta `-1099488`, peak `+10091819`, and DOM slope `0`.
- [x] Capture a complete two-hour loopback measurement on existing build
      `KtgFoXuIosh-DwRAGcr24`: no fulfilled API writes, `134` blocked external
      requests, polling `16.32 -> 1.00 -> 16.40/min`, zero experiment long
      tasks, `243` memory samples with `+10609389` endpoint delta /
      `+262298` bytes-hour fitted slope, and DOM slope `0/hour`. Treat the
      positive heap result as noisy observational evidence, not a leak verdict.
- [ ] Rebuild and repeat or exact-SHA-associate route compression, chunk-owner,
      polling, long-task, and two-hour memory evidence on the final candidate;
      the old artifact reused a build and records no Git SHA. The new collector
      records HEAD/build identity but correctly marks derivation unsealed until
      a build-time revision marker exists. Current strict verification still
      lacks native hidden timing and a clean sealed final-SHA two-hour run.
- [x] Make current-tree provenance observable under the managed Windows sandbox
      without changing global Git config. A bounded artifact-only run records
      the exact dirty tree as `head-plus-dirty-worktree`, `292` status entries,
      and stable build bytes instead of failing on Git dubious ownership.
- [x] Install a read-only React root-commit observer before application load. A
      9-second loopback probe registered `1` renderer and measured `47`
      experiment root commits with API writes `0` and `22` external requests
      blocked. This is root-level rerender evidence only, not component Profiler
      timing or attribution.
- [x] Add an isolated, hermetic Next production-profiling build and bind the
      collector to its exact output directory. The combined `60009ms` read-only
      Auto-Miner run measured `593` root commits, `33565` component render
      events, `692.9ms` exclusive component render time, and `0` long tasks or
      API-write/transaction attempts. Canonical `.next` remains non-profiling
      and a control run fails closed on absent duration fields. This diagnostic
      output is unsealed and does not substitute for final-candidate proof.
- [x] Exercise the real local Auto-Miner presentation seam for at least 60
      seconds without entering the mining runner. The measured `60012ms` phase
      completed `60` progress ticks, observed the production `STOP BOT` UI,
      recorded API-write/transaction attempts `0`, polling `16.00/min`, long
      tasks `0`, and `594` experiment root commits. This does not substitute for
      real wallet Auto-Miner or the final-SHA two-hour memory run.
- [ ] Prove native hidden-tab behavior and browser timer throttling; the current
      headed 60-second probe still reported native `visible` for both tabs in the
      managed Windows session. Playwright's background-disable defaults are now
      removed for future interactive runs, but this probe remains synthetic-only
      and does not close the native-hidden requirement.
- [ ] Repeat the profiling/Auto-Miner observation against the final exact SHA or
      explicitly bind the diagnostic profiling output to that SHA without
      changing intentional refresh cadence; do not treat the current dirty,
      unsealed profiling build as release-candidate evidence.

## Linea Sepolia live boundary

- [ ] Validate the real Sepolia V10 runtime configuration, including
      `NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS=1`, then regenerate a
      passing fresh read-only Preview binding roles/wallets, calls, value/gas
      caps, maximum transactions, and stop conditions. The 2026-08-12 attempt
      had no signing material, wallet client, contract write, or sent
      transaction; planner/matrix fail closed before a matrix log until that
      flag is present.
- [ ] Only after a passing fresh Preview, stop and request separate fresh exact
      bounded consent. Without it, do not load signing material or submit a write.
- [ ] Only after consent, run the authorized minimal tranche and reconcile
      receipt, chain, indexer, DB, and UI accounting.
- [ ] Treat a 50-epoch/24-48h Sepolia soak as testnet evidence. Resolve the
      Sepolia-versus-G10/G11 policy conflict before changing gate status.

## External G1-G14

G1-G14 remain `0/14 Complete`. Keep every gate Missing until its canonical
production evidence exists: domain/HTTPS, Privy origins, ownership/randomness
sign-off, supervised hosts, two replicas, fresh finality/indexer DB, real
backup/restore, monitoring/Resend/Sentry, wallet/mobile QA, live
canary/recovery, and final security/QA sign-off.

Current prelaunch passes every required-local row and reports exactly `25`
external/status blockers plus `41` mainnet environment failures. The latest
Sepolia Preview attempt failed closed before a matrix log and was stale at `3256m` in the latest refresh,
and confers no authorization; there was no live, wallet, network-write, or chain action,
and the testnet soak has not started.
