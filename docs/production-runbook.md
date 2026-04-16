# Production runbook

## Process model

- Run three separate long-lived processes:
- `lore-site`
- `lore-bot`
- `lore-indexer`
- The checked-in PM2 template in [ecosystem.config.cjs](/C:/Users/bogda/linea-miner-main/ecosystem.config.cjs) already reflects this split.

## Persistent SQLite

- SQLite stays acceptable for a single-node deployment.
- Put `LORE_DB_PATH` on a persistent absolute path outside the repo checkout.
- Back up that file on a schedule; do not rely on ephemeral host storage.

## Required mainnet runtime

- Set both `LINEA_NETWORK=mainnet` and `NEXT_PUBLIC_LINEA_NETWORK=mainnet`.
- Keep `KEEPER_CONTRACT_ADDRESS` and `NEXT_PUBLIC_CONTRACT_ADDRESS` identical.
- Set `INDEXER_START_BLOCK` and `NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK` to the same deploy block.
- Use a private `KEEPER_RPC_URL`.
- Set `NEXT_PUBLIC_SITE_URL` to the final HTTPS origin.
- Set `HEALTH_DIAGNOSTICS_SECRET`.

## Deploy order

1. Update env on the host.
2. Run `npm ci`.
3. Run `npm run build`.
4. Reload PM2 with `ecosystem.config.cjs`.
5. Run `npm run health:prod` against the live origin.

## Monitoring

- Use `npm run health:prod` from an external monitor or cron.
- Default behavior fails on:
- non-OK runtime health
- degraded or broken data-sync health
- stale indexer heartbeat
- lag above the server-advertised warning threshold
- missing latest jackpot rows
- Recommended cadence: every 1 minute.
- Recommended alert targets:
- repeated `health:prod` failures
- PM2 process restarts for `lore-bot` or `lore-indexer`
- stale `/api/health/data-sync`

## Example health check

```bash
PROD_HEALTH_BASE_URL=https://playlore.xyz \
HEALTH_DIAGNOSTICS_SECRET=replace-me \
npm run health:prod
```

If you intentionally want warnings without paging during catch-up, set `PROD_HEALTH_ALLOW_DEGRADED=1`.
