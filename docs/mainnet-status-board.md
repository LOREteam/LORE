# Mainnet status board

Snapshot date: 2026-04-09

## GREEN

- Production runtime validation is in place via [productionRuntime.ts](/C:/Users/bogda/linea-miner-main/config/productionRuntime.ts).
- Security headers and CSP hardening are in place via [middleware.ts](/C:/Users/bogda/linea-miner-main/app/middleware.ts).
- The checked-in process topology is split into `lore-site`, `lore-bot`, and `lore-indexer` in [ecosystem.config.cjs](/C:/Users/bogda/linea-miner-main/ecosystem.config.cjs).
- Browser smoke, build, and logic tests are currently green in local verification.
- Chunk-load recovery and route-level fallback logic are in place for known lazy-load failures.
- Production health probing exists via [check-production-health.mjs](/C:/Users/bogda/linea-miner-main/scripts/check-production-health.mjs).
- SQLite is explicitly treated as single-node only, with a persistent-path requirement in the docs and runtime validation.

## YELLOW

- Auto-mine duplicate-restore and stale-nonce fixes are implemented, but still need a real-wallet mainnet canary.
- Failure-state UX is improved, but still needs a dedicated pass over all disabled, pending, retry, and degraded states.
- User-facing audit visibility is decent but not complete; bet history and tx-level support surfaces can still be stronger.
- Observability exists at the app level, but host-side alerts and log aggregation are not verified from this repo alone.
- Visual consistency across hub, overlays, and right-column surfaces is much better, but still needs a final launch QA pass.
- First-time education exists, but mainnet-first wording and trust/risk messaging can still be tightened.

## RED

- No real mainnet canary run is confirmed yet for `AutoMine` over a long enough sample.
- No confirmed production host is green yet under `npm run health:prod`.
- No confirmed external monitoring/alerting deployment exists yet for `site / bot / indexer`.
- No confirmed backup-restore drill has been run yet for the SQLite file.

## Recommended next moves

1. Stand up the real host with persistent SQLite and split processes.
2. Make `npm run health:prod` green on that host.
3. Run a 50-100 round real-wallet canary for `AutoMine`.
4. Freeze layout changes and do one final UX pass for first-time and degraded flows.
5. Launch only after every `RED` item is cleared.
