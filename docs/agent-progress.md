# Agent Progress

Last updated: 2026-08-21.

Current truth is in [`current_state.md`](current_state.md). The active queue is
[`remaining-worklist.md`](remaining-worklist.md); long-running testnet work is
in [`testnet-hardening-plan.md`](testnet-hardening-plan.md).

## Continuation point

- Branch `codex/repo-cleanup`; latest code/test source commit before this
  progress refresh: `7905dc764` (`test(recovery): cover canonical jackpot event
  identity`). It is pre-document local-verification lineage, not final
  immutable-SHA, sealed-provenance, clean-checkout, deployment, or hosted proof.
- Recent local sequence: `d51b5bb02` honest global-data state,
  `603c43b75` honest wallet unavailable state, `ef0359c95` model-contract
  regression, `7a75f709f` completed Header loading truthfulness, `2518babcf` fixed
  manual bet restore-before-persist, `e185c392e` hardened local campaign
  cache/env handling, and `466de05d` renders Header unavailable balances.
- No remote, hosted, wallet, signing, or chain actions occurred in this local
  sequence.
- The protected base, WAL, and SHM are all present and exact. Preserve their
  hashes/sizes/mtimes from `current_state.md`; no deletion or checkpoint is
  authorized.

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
7. The P1.10 audit currently reports `4796/5509` behavioral assertions
   (`87.06%`) at `7905dc764`.
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
- Explicit Header `error`/`stale`/`last updated` state needs a separate small
  data-provenance packet; do not guess offline from arbitrary RPC errors.
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
