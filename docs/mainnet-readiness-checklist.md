# Mainnet readiness checklist

Use this as the final pre-launch gate. A launch is considered ready only when every `Blocker` is complete and signed off.

## Blockers

### 1. Contract / funds safety

- [ ] Final mainnet contract addresses are set in both `KEEPER_CONTRACT_ADDRESS` and `NEXT_PUBLIC_CONTRACT_ADDRESS`.
- [ ] `INDEXER_START_BLOCK` and `NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK` match the real deploy block.
- [ ] Ownership is transferred to a Safe multisig or equivalent governance-safe setup.
- [ ] A manual verify pass confirms jackpot, rebate, deposit, reward, and resolve reads against chain.

Ready when:
- mainnet env boots without fail-fast config errors
- web values and keeper values point at the same contract
- no privileged EOA remains as the long-term owner

### 2. Auto-mine runtime safety

- [ ] Run a canary session of at least 50 real rounds on the target network/RPC.
- [ ] Verify there are no duplicate round starts after refresh, remount, route switch, or reconnect.
- [ ] Verify there are no repeated `replacement transaction underpriced` or `nonce too low` loops.
- [ ] Verify a pending tx survives reload and recovers to the correct next state.
- [ ] Verify tab-close and restore behavior does not create duplicate bets.

Ready when:
- each round produces at most one effective bet action
- pending bet recovery converges without duplicate broadcast
- restore logic does not start a second runtime in the same tab

### 3. Production health / supervision

- [ ] `lore-site`, `lore-bot`, and `lore-indexer` run as separate supervised processes.
- [ ] `LORE_DB_PATH` points to a persistent absolute SQLite path outside the repo.
- [ ] `npm run health:prod` is wired into external monitoring or cron.
- [ ] `/api/health/runtime` and `/api/health/data-sync` are tested with the diagnostics secret.
- [ ] Backups for SQLite are scheduled and a restore test has been done once.

Ready when:
- `health:prod` stays green on the real host
- PM2 or equivalent restarts failed processes automatically
- DB survives process restarts and host reboot

### 4. Failure-state UX

- [ ] Every disabled action in the hub explains why it is disabled.
- [ ] Pending states are explicit for bet submit, resolve, chat auth, and profile save.
- [ ] Degraded backend states show a visible hint instead of silently serving stale data.
- [ ] Error recovery paths exist for route chunk issues and failed lazy loads.
- [ ] Maintenance/read-only mode can be enabled without code changes.

Ready when:
- there is no silent no-op button in the main user flows
- users can tell whether data is fresh, pending, or degraded

### 5. Wallet / network correctness

- [ ] Connect, disconnect, reconnect, and wrong-network flows are tested on desktop and mobile.
- [ ] Gas guidance is visible enough for first-time users.
- [ ] First real transaction flow is tested with a clean wallet.
- [ ] Auth modal, Privy, and chat auth are tested under slow network conditions.

Ready when:
- a first-time user can connect, place one bet, and understand what happened without guessing

## Should-have

### 6. Support / audit visibility

- [ ] User-facing bet history includes epoch, tile, amount, tx hash, and result state.
- [ ] Auto-mine logs include stable fields for round, epoch, nonce, tx hash, and retry count.
- [ ] Admin or diagnostics view exposes indexer lag, last heartbeat, and serving mode clearly.

### 7. Observability

- [ ] Errors are centralized in Sentry or equivalent.
- [ ] Alerts exist for stale indexer heartbeat, large lag, repeated bot restarts, and repeated chunk failures.
- [ ] Log format is consistent enough to grep by scope, epoch, tx hash, and wallet.

### 8. Browser reliability

- [ ] Critical UI elements expose stable `data-*` selectors for smoke tests.
- [ ] Known environment-only browser noise is isolated from real regressions.
- [ ] Cold-load performance of hub, analytics, whitepaper, and FAQ is checked on a clean browser profile.

## Polish

### 9. UX / onboarding

- [ ] First-visit tutorial is short and accurate for mainnet behavior.
- [ ] FAQ answers mainnet questions first: gas, irreversible bets, jackpots, rebates, delays, wallet support.
- [ ] Analytics labels and freshness hints are easy to read.
- [ ] White Paper and FAQ navigation are usable on mobile.

### 10. Chat / community

- [ ] Chat rate-limit feedback remains visible and non-jittery.
- [ ] Chat moderation policy exists before launch.
- [ ] Profile modal works reliably on desktop and mobile with long avatar lists.

### 11. Visual consistency

- [ ] Right-side layouts behave consistently across Hub and non-Hub tabs.
- [ ] Chat geometry is locked and visually consistent across pages.
- [ ] Dock, floating actions, and overlays do not overlap on common desktop/mobile breakpoints.

## Recommended launch order

1. Complete every `Blocker`.
2. Run `npm run build`.
3. Run `npm run smoke:browser`.
4. Run `npm run health:prod` against the production origin.
5. Run the real-wallet mainnet canary.
6. Freeze UI/layout changes.
7. Launch.
