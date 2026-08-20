# Remaining Worklist

Last updated: 2026-08-17. This is the single active queue. Completed historical
detail belongs under [`docs/archive/`](archive/), not in this file.

## P0: restore a trustworthy local release candidate

- [ ] With explicit user approval, recheck exclusive access and the exact base
      SHA/size/mtime, then delete only `data/lore-v10.sqlite-wal` and
      `data/lore-v10.sqlite-shm`. This deliberately discards one uncheckpointed
      test-only recent-wins metadata row; never delete or replace the base DB.
- [ ] Run the real full business summary exclusively through
      `scripts/business-logic-isolated-runner.mjs`. Require child success and an
      unchanged protected main/WAL/SHM snapshot before accepting the result.
- [ ] Review and locally commit the current hardening packet in coherent small
      commits. Do not add `.tmp-final-sha-*` or `.tmp-npm-runtime-*`.
- [ ] Refresh the exact path/commit map and ensure every intended file is owned
      exactly once; staged/untracked state must be intentional.
- [ ] On the resulting immutable SHA, use a detached clean checkout with fresh
      `npm ci`; run dependency gates, full local/prelaunch gates, hermetic build,
      typecheck, browser/HTTP smoke where supported, V10 EVM properties and
      protected DB invariants.
- [ ] Run and seal the supported full security scan of that exact immutable SHA.
      The sealed diff scan `c611f992-3c4d-4ac6-8c9a-14033c6f7156` covered 22/22
      files with 0 reportable findings, but a narrow log-path fix and docs were
      added afterward, so it is not final-SHA evidence.
- [ ] Obtain green hosted Linux/Windows CI for the exact final commit.

## P1: local engineering still open

### P1.10 behavioral extraction

- [x] Re-run `audit:p1:behavior` after the current packet: `4588/5306`
      behavioral assertions (`86.47%`).
- [ ] Continue replacing source-operand assertions with imported public behavior
      only where a stable seam exists. Do not replace meaningful source-policy
      bindings with weaker smoke checks.
- [ ] Keep the business coordinator compact by placing new behavior in direct
      domain modules.

### P1.17 sealed performance evidence

- [x] Extend provenance to bind two outputs to the same clean SHA: canonical
      sealed `.next` plus an explicitly isolated profiling build. The local
      `0288ba5e` pair verifies the mechanism; recreate it on the final SHA.
- [ ] Run a 60-90 second headed smoke first. Require real native
      `document.hidden=true`, component duration fields, at least 60 seconds of
      read-only Auto-Miner UI simulation and zero wallet/API/chain writes.
- [ ] Collect one two-hour loopback run with samples no farther than 60 seconds
      apart, at least 80% finite heap coverage, native hidden >=60 seconds,
      route/chunk ownership, long tasks and component timings.
- [ ] Strictly verify both build identities and reparse the compact redacted
      evidence from a clean checkout. Old schema-1 P1 evidence is historical and
      cannot be upgraded into final proof.

### Public read model and scale

- [x] Replace request-time O(N) scans for global stats and leaderboards with an
      atomic, contract-scoped materialized read model.
- [x] Add a monotonic `publicReadModelRevision` for normal indexer commits,
      repair/reconcile, rollback/reorg and relevant public profile changes.
- [x] Compare materialized snapshots with independent reconciliation in isolated
      10k global-stats and 110k leaderboard fixtures, including fail-closed
      dirty/restart paths.
- [ ] Keep stale/degraded public data explicit and never use it as wallet or
      financial authorization.

### Long-run tooling

- [x] Make soak status parsing incremental and checkpointed. Add JSONL rotation,
      retention, disk caps and a bounded status-latency budget.
- [x] Ensure the supervisor's final success invokes the strict analyzer for the
      current run and cannot accept early child exit, stale logs, duplicate
      hashes, missing epochs or unresolved pending state.
- [x] Bind the supervisor to a current-run log and digest, manage analyzer
      timeout/shutdown, and redact its allowlisted environment.
- [x] Make `live-round-canary.ts` consume the supervisor's absolute
      `LIVE_TEST_LOG_PATH` through an ordinary-path policy.
- [x] Bound `load-http` latency/error memory while keeping the p95 pass/fail gate
      exact and redacting errors before retention.

### Runtime identity and topology

- [ ] Create a new strict V10 manifest for
      `0x985c71613bb73fac5653c253a8ba37cd0ec8ab9a` with chain, deploy block,
      ABI/runtime digest, epoch-bound selector, source SHA and build provenance.
      Keep the old `0x98ee...` evidence explicitly historical.
- [ ] Execute the production Redis/Valkey Lua `EVAL` behavior against a pinned
      real runtime; JavaScript models are not equivalent evidence.
- [ ] Exercise two web replicas plus separate indexer/bot/monitor, a shared
      external limiter/lock store and external persistent DB/backup restore.
- [ ] Add a strict current-V10 runtime-identity preflight to canary JSONL and the
      analyzer before any signed campaign.

### Optional defense in depth

- [ ] Consider physical identity/reparse checks for the business-suite temp root
      and an open-by-handle design for build SQLite. The current security scan
      classified these same-user TOCTOU ideas as non-reportable because such an
      actor already has direct host filesystem authority; do not let them delay
      higher-value P0/P1 work.

## Long-duration test campaigns

Detailed exit criteria are in
[`testnet-hardening-plan.md`](testnet-hardening-plan.md).

- [ ] **2-4h read-only rehearsal:** production-like topology, replica/worker
      restart and RPC failover; zero signatures, approvals or chain writes.
- [ ] **6 unique-epoch signed canary:** only after a fresh exact Preview and
      separate bounded consent; exact allowance cap, epoch-bound selector,
      no duplicate hash/nonce/unbound intent and strict proof pass.
- [ ] **8-12h recovery campaign:** controlled web/indexer/bot/Redis/DB/RPC
      failures, pending-broadcast recovery, restore/reconcile and bounded RTO/RPO.
- [ ] **24-48h soak / >=50 unique epochs:** zero unexpected failures, bounded
      artifacts, latency/lag/memory/DB/disk budgets and strict current-V10 proof.
- [ ] **2h P1.17 same-SHA run:** canonical seal plus profiling provenance,
      native hidden behavior and zero write attempts.
- [ ] **6h HTTP load:** realistic public endpoints, bounded generator memory,
      exact latency gates and no O(N) request-path regression.
- [ ] **Physical mobile/Privy HTTPS:** MetaMask mobile browser, at least one
      alternative wallet and real public HTTPS Privy flow across wrong-network,
      reject, pending, revert, reload and account-change states.
- [ ] **7-day staging observation:** daily reconciliation and restore checks,
      alert delivery and bounded retention with every incident owned/resolved.

## V10/V9 and protocol policy

- [x] Keep routine local/CI/prelaunch gates V10-only.
- [ ] Keep standalone V9 source/manifests/compatibility commands until canonical
      V10 deployment and cutover evidence exists. Remove them only in a separate
      post-cutover review.
- [ ] Keep the known block-context randomness risk open. The user explicitly
      deferred redesign; do not mark it fixed or silently change tokenomics.
- [ ] Require canonical V10 epoch-bound mode in the managed frontend/canary.
      Legacy selectors remain callable for compatibility and are not equivalent.

## External and live blockers

- [ ] G1-G14 remain `0/14 Complete` until canonical production evidence exists.
- [ ] Keep exactly `25` recorded external/status blockers open until refreshed
      prelaunch evidence proves a real change. Mainnet environment validation has
      `41` recorded failures.
- [ ] Complete domain/HTTPS, Privy origins, ownership/randomness sign-off,
      supervised host/process evidence, real two-replica limiting, fresh finality
      indexer DB, backup/restore, monitoring/Resend/Sentry, wallet/mobile QA and
      final security/QA sign-off.
- [ ] Generate a fresh read-only current-V10 Preview only after the runtime
      identity/configuration passes. A Preview authorizes nothing.
- [ ] Before any signing material is loaded or any testnet write is sent, obtain
      separate exact consent bound to that Preview, chain/address/SHA, wallets,
      amounts, allowance, gas, transaction count, epochs and stop conditions.
- [ ] Treat Sepolia campaigns as testnet evidence only. Resolve the existing
      Sepolia-versus-G10/G11 policy question before changing mainnet gate status.

## Completed current-packet controls

- [x] External-wallet account/chain context revalidation at the final send sink.
- [x] Two-origin finalized exact-intent confirmation and shared actor nonce/claim
      locking from the preceding wallet-security commits.
- [x] Exact per-role canary allowance cap and post-receipt invariant.
- [x] Strict run-bound soak proof validation and managed analyzer lifecycle.
- [x] Per-process/per-Worker hermetic build SQLite and strict-runtime env guard.
- [x] Shared isolated business-suite runner with protected DB snapshots; real
      full rerun remains pending restoration of the pre-existing WAL/SHM.
- [x] Bounded load statistics/error retention and safe redaction.
- [x] Reduced-motion, dialog focus, wallet states and other prior UX packets have
      focused local evidence. External mobile/native-hidden evidence remains open.

## Non-negotiable safety rules

- Never print or persist private keys, mnemonics, sessions, wallet files, keyed
  RPC URLs, credentials or private environment contents.
- Do not delete the protected base DB or checkpoint the test WAL into it.
- Local green checks and environment key presence do not authorize deployment,
  wallet signing, approval, bet, claim, canary, soak or any chain write.
- Do not call the project mainnet-ready until immutable-SHA evidence, P1.17,
  production-like topology, external gates and final sign-off are complete.
