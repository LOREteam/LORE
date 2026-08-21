# Agent Progress

Last updated: 2026-08-21.

Current truth is in [`current_state.md`](current_state.md). The active queue is
[`remaining-worklist.md`](remaining-worklist.md); long-running testnet work is
in [`testnet-hardening-plan.md`](testnet-hardening-plan.md).

## Continuation point

- Branch `codex/repo-cleanup`; latest code commit before this progress refresh:
  `7a75f709f4412f4880dd5659cee4f7c607302996`.
- Recent local sequence: `d51b5bb02` honest global-data state,
  `603c43b75` honest wallet unavailable state, `ef0359c95` model-contract
  regression, and `7a75f709f` completed Header loading truthfulness.
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
   cache is unavailable, Header uses `—`, wallet settings uses `Unavailable`,
   transfer RPC errors suppress totals and offer retry, and a literal zero stays
   visible.
3. The Header skeleton is now conditional on a genuinely pending empty read;
   it no longer persists after a completed RPC no-data/error result.
4. Direct wallet-model and presentation tests, full isolated business runner,
   TypeScript, ESLint, and diff checks passed at the relevant local commits;
   protected DB snapshots remained exact.
5. The P1.10 audit currently reports `4729/5423` behavioral assertions
   (`87.20%`).
6. Bounded cleanup removed about `1.00 GiB` of old Node/npm caches only. No
   project data, campaign record, browser profile, protected SQLite, or active
   runtime was removed.

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
  log.

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
- G1–G14 remain `0/14`; `25` external/status blockers and `41` recorded
  mainnet-environment failures remain open.
- Hosted TLS/HTTPS, Privy origins, real replicas/Redis/DB restore, monitoring,
  physical mobile wallets, signed canary, recovery/soak campaigns, and final
  sign-off require external evidence.
- A fresh exact Preview plus separate bounded consent is mandatory for every
  future chain write.
