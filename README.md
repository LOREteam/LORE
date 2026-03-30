# LORE / Linea Miner



## Stack

- Next.js 16 (App Router), React 19, TypeScript
- wagmi + viem + Privy
- local SQLite on the same server for chat + indexed game data
- Optional Telegram alerts for keeper/supervisor

## Requirements

- Node.js 20+
- npm 10+

## Quick start

```bash
npm install
cp .env.example .env
```

Then set at least:

- `KEEPER_PRIVATE_KEY` for bot transactions
- `LORE_DB_PATH` if you want the SQLite file outside the default `data/lore.sqlite`

Useful optional vars are documented in `.env.example` and `.env.local.example`.

Important for future contract deployments:

- Set `LINEA_NETWORK` and `NEXT_PUBLIC_LINEA_NETWORK` to `mainnet` for production.
- Set `KEEPER_CONTRACT_ADDRESS` for server routes and keeper bot.
- Set `NEXT_PUBLIC_CONTRACT_ADDRESS` for the frontend.
- Set `NEXT_PUBLIC_LINEA_TOKEN_ADDRESS` if the token address changes.
- Set `INDEXER_START_BLOCK` and `NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK` to the new deployment block.
- Set `NEXT_PUBLIC_LINEA_RPCS` if you need to pin reliable production RPCs for wallet broadcast.
- Set `NEXT_PUBLIC_CONTRACT_HAS_TOKEN_GETTER=1` for V6/mainnet-style deployments.
- Set `NEXT_PUBLIC_CONTRACT_HAS_REBATE_API=1` if the deployed contract supports rebate methods.
- Keep `NEXT_PUBLIC_CONTRACT_HAS_TOKEN_GETTER=0` only if you intentionally point the app at the old legacy Sepolia contract that does not expose `token()`.

## Scripts

- `npm run dev:ui` - run frontend in dev mode
- `npm run indexer` - run the history/indexer watcher that fills SQLite from the deploy block
- `npm run bot` - run keeper bot once (auto-loop inside bot)
- `npm run bot:supervisor` - restart bot on crashes with backoff
- `npm run dev` - run UI + supervisor in parallel (`bot:supervisor` also starts the indexer)
- `npm run build` - production build
- `npm run start` - run production server on port `3001`
- `npm run typecheck` - TypeScript checks
- `npm run lint` - ESLint checks
- `npm run smoke:http` - smoke-check the local app/API on `http://localhost:3000` (override with `SMOKE_BASE_URL`); validates homepage markers plus core JSON routes
- `npm run smoke:browser` - click through the main UI in a real browser (Hub, Chat, Analytics, Rebate, Leaderboards, White Paper, FAQ) using local Chrome/Edge
- `npm run check` - run `lint -> build -> typecheck -> smoke:http -> smoke:browser` in the safe order required by `.next/types`

## Environment notes

- Never commit real secrets (`.env` is ignored by git).
- Keep only templates in repo (`.env.example`, `.env.local.example`).
- Any variable prefixed with `NEXT_PUBLIC_` is exposed to the client bundle.
- Chat keeps only the latest 100 messages in SQLite; indexed game history is stored in full from the configured deploy/start block.
- If you run only `npm run dev:ui`, gameplay works but indexed history/analytics storage will stay empty until `npm run indexer` (or `npm run dev`) is running against the same `LORE_DB_PATH`.

## Health / Admin

- `/api/health/data-sync` shows whether indexed epochs/jackpots are actually being written to SQLite, plus the live `dbPath` and deploy block the server is using.
- `/api/health/runtime` shows lightweight in-process hot-API metrics (cache hits, stale serves, background refreshes, latency).
- `/admin` now surfaces both of those health views so you can quickly see whether the indexer/storage layer is healthy or the app is still relying on request-time fallbacks.

## Security notes

- Frontend CSP/security headers are configured in `next.config.ts`.
- Governance migration guidance for the next contract deployment is in `docs/governance-migration.md`.

## Deploy

Recommended flow:

1. `npm run lint`
2. `npm run build`
3. `npm run typecheck`
4. `npm run smoke:http` against your local/prod-like server when applicable
5. deploy with your preferred platform (Vercel/Node host)

`typecheck` intentionally runs after `build` in the local check flow because this repo includes generated `.next/types/**/*.ts` in `tsconfig.json`.

For contract deployments, do not keep a single EOA as live owner. Prefer a Safe multisig, or a timelock controlled by a Safe multisig.
