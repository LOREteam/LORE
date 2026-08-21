# Remaining Worklist

Last updated: 2026-08-21. This is the active queue. Historical detail belongs
under [`docs/archive/`](archive/).

## P0: trustworthy local release candidate

- [x] Align the wallet-model contract with truthful unavailable balances:
      invalid cache is `null`, not a fabricated `0.00`; focused test and the
      isolated business runner passed.
- [ ] Preserve and hash-recheck the exact protected base/WAL/SHM before and
      after every DB gate. Do not delete or checkpoint any of them without new
      exact destructive approval.
- [ ] Capture a new immutable SHA and use a detached clean checkout with fresh
      `npm ci`; run dependency gates, full local/prelaunch gates, hermetic
      build, typecheck, supported browser/HTTP smoke, V10 properties, and DB
      invariants when disk permits.
- [ ] Run and seal the supported final security scan of that exact immutable
      SHA. Existing scans are historical patch evidence, not final-SHA proof.
- [ ] Obtain green hosted Linux/Windows CI for the exact final commit.
- [ ] Refresh the final path/commit partition map after the immutable-SHA cycle.

## P1: local engineering

### P1.10 behavioral extraction

- [x] Current audit: `4729/5423` behavioral assertions (`87.20%`).
- [ ] Continue replacing source operands only when a stable public behavior seam
      exists; preserve meaningful policy/source bindings.
- [ ] Keep new assertions in focused domain modules, not coordinator bloat.

### P1.17 sealed performance evidence

- [x] Dual canonical/profiling provenance mechanism is implemented.
- [ ] On the final SHA, seal canonical and isolated profiling outputs, run the
      60–90 second headed native-hidden preflight, then one two-hour read-only
      loopback collection and strict clean-checkout verification.

### Truthful public and wallet data

- [x] Global stats/leaderboards use atomic scoped materialization and revision
      invalidation with isolated scale/recovery regressions.
- [x] Global stats renders loading/ready/stale/unavailable honestly; failures
      are `503`/`no-store`, never zero financial data.
- [x] Wallet settings/Header/transfer history preserve unavailable data as
      unavailable and do not display unverified zero balances or totals.
- [ ] Add explicit Header `error`/`stale`/`last updated` provenance; do not
      infer offline from every RPC failure.
- [ ] Design a true durable unified activity ledger for bets, claims and wallet
      transfers. Current transfer history is browser-local (capped) while bets
      are indexer-backed.

### Long-run tooling and topology

- [x] Soak status/log parsing is incremental, bounded, rotated, run-bound, and
      strict-analyzer gated.
- [x] V10 canary actions are admission/run/wallet-set bound with exact caps and
      runtime preflight validation.
- [ ] Restart a new local SHA-bound campaign after adequate disk headroom;
      `local-20260821-final-r3` cycles 1–3 are historical and cycle 4 stopped
      on the now-fixed stale wallet-model expectation.
- [ ] Execute Redis/Valkey Lua behavior on a pinned real runtime.
- [ ] Exercise two web replicas, indexer/bot/monitor, shared limiter/lock,
      external persistent DB and backup/restore.

## Long-duration test campaigns

Detailed criteria are in [`testnet-hardening-plan.md`](testnet-hardening-plan.md).

- [ ] 2–4h read-only topology rehearsal.
- [ ] 6 unique-epoch signed canary after fresh Preview and separate bounded
      consent.
- [ ] 8–12h recovery campaign with controlled failures/reconciliation.
- [ ] 24–48h soak with at least 50 unique epochs and strict current-V10 proof.
- [ ] 2h P1.17 same-SHA native-hidden run.
- [ ] 6h HTTP load with exact latency/memory gates.
- [ ] Physical mobile/Privy HTTPS wallet matrix.
- [ ] 7-day staging observation with restore/reconciliation and alerts.

## V10/V9 and protocol policy

- [x] Routine local/prelaunch gates stay V10-oriented.
- [ ] Retain standalone V9 source/manifests/compatibility commands until
      independently evidenced canonical V10 cutover.
- [ ] Keep the known block-context randomness risk open; redesign is explicitly
      deferred.
- [ ] Require epoch-bound V10 mode in managed frontend/canary; legacy selectors
      remain compatibility-only.

## External and live blockers

- [ ] G1–G14 remain `0/14 Complete`.
- [ ] Keep all `25` external/status blockers and `41` recorded mainnet
      environment failures open until refreshed canonical evidence changes them.
- [ ] Complete hosted TLS/HTTPS, Privy origins, ownership/randomness sign-off,
      processes, replicas/Redis/DB restore, monitoring, mobile wallet QA, and
      final security/QA sign-off.
- [ ] Generate a fresh read-only current-V10 Preview only after runtime identity
      and configuration checks pass. A Preview authorizes nothing.
- [ ] Obtain separate exact consent bound to Preview, chain/address/SHA,
      wallets, caps, gas, transaction count, epochs, and stop conditions before
      any signing material is loaded or testnet write is sent.

## Non-negotiable safety rules

- Never print or persist secrets, private keys, mnemonics, sessions, wallet
  files, keyed RPC URLs, or private environment data.
- Local green checks and environment key presence never authorize deployment,
  approval, bet, claim, canary, soak, or any chain write.
- Do not call the project mainnet-ready while immutable-SHA evidence, P1.17,
  production-like topology, external gates, and final sign-off remain open.
