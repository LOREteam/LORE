# Agent Progress

Last updated: 2026-08-23.

Current truth is in [`current_state.md`](current_state.md). The active queue is
[`remaining-worklist.md`](remaining-worklist.md); long-running testnet work is
in [`testnet-hardening-plan.md`](testnet-hardening-plan.md).

## Continuation point

- Branch `codex/repo-cleanup`; latest code/test source commit is `5fb4605b3`
  (`fix(rewards): test cache restore behavior`). It is local mutable-lineage
  evidence, not final immutable-SHA, sealed-provenance, clean-checkout,
  deployment, or hosted proof.
- The reward-cache P1.10 packet replaced five source-regex assertions with
  executable key, version precedence, malformed-envelope, stale, invalidated,
  legacy, and rescan-delay behavior. Focused reward/chat tests and direct
  TypeScript passed; the audit is `5179/5943` behavioral (`87.14%`).
- Bounded cleanup removed only rebuildable `.next` and
  `tsconfig.tsbuildinfo`; the post-smoke `.next` regeneration was removed
  again. QA artifacts, dependencies, source, and browser/session data remain.
- No remote, hosted, wallet, signing, or chain action occurred.
- A local UI-only smoke opened the configured protected SQLite path before the
  hazard was detected. The base remains exact, but WAL/SHM at `data/` no
  longer match the protected sidecar identities. The server is stopped and no
  destructive recovery was attempted.
- A coherent exact base/WAL/SHM recovery trio is staged at
  `.tmp/protected-db-recovery-exact-20260823/`. Restoring it requires a new
  exact destructive approval. Until then, run no DB-adjacent gate and start no
  server against the configured protected path; use an owned OS-temp
  `LORE_DB_PATH`.

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
7. The P1.10 audit at `5fb4605b3` reports `5179/5943` behavioral assertions
   (`87.14%`).
8. Bounded cleanup removed about `1.00 GiB` of old Node/npm caches only. No
   project data, campaign record, browser profile, protected SQLite, or active
   runtime was removed.
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
- P1.17 self-tests passed at `7905dc764`: collector `85` cases (schema `3`) and
  verifier `55` cases (schema `3`). They do not replace the final immutable
  clean-SHA seal pair, headed native-hidden two-hour run, or strict verification.

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
- Header balance provenance now carries wagmi fetching/error/stale/updated-at metadata:
  a known balance remains visible on refresh, stale data, or RPC error, and the card
  exposes an explicit state plus any trusted last-updated timestamp. It does not infer
  offline status from an arbitrary RPC error.
- Final immutable-SHA detached install/build/prelaunch cycle is open; recent
  code commits invalidate older final-SHA/sealed claims.
- P1.17 needs a final canonical/profile sealed pair and a real physical
  native-hidden two-hour loopback run.
- A new local campaign and supported security scan are blocked by disk and/or
  entitlement, not by a false green claim.

## External boundary

- V9 remains a compatibility baseline until independently evidenced V10
  cutover. Randomness redesign remains deliberately deferred.
- The current Sepolia V10 target is
  `0x985c71613bb73fac5653c253a8ba37cd0ec8ab9a` at block `31678224`.
  Runtime/canary use requires `NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS=1`
  and the epoch-bound selector; the `7905dc764` manifest/provenance check is
  offline local evidence only.
- G1–G14 remain `0/14`; `25` external/status blockers and `41` recorded
  mainnet-environment failures remain open.
- Hosted TLS/HTTPS, Privy origins, real replicas/Redis/DB restore, monitoring,
  physical mobile wallets, signed canary, recovery/soak campaigns, and final
  sign-off require external evidence.
- A fresh exact Preview plus separate bounded consent is mandatory for every
  future chain write.
