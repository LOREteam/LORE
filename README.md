# LORE / Linea Miner



## Stack

- Next.js 16 (App Router), React 19, TypeScript
- wagmi + viem + Privy
- Firebase Realtime Database (chat)
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
- `NEXT_PUBLIC_FIREBASE_DATABASE_URL` for chat
- `FIREBASE_DB_AUTH` for protected server-side Firebase writes and rate limiting

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
- `npm run bot` - run keeper bot once (auto-loop inside bot)
- `npm run bot:supervisor` - restart bot on crashes with backoff
- `npm run dev` - run UI + supervisor in parallel
- `npm run build` - production build
- `npm run start` - run production server on port `3001`
- `npm run typecheck` - TypeScript checks
- `npm run lint` - ESLint checks

## Environment notes

- Never commit real secrets (`.env` is ignored by git).
- Keep only templates in repo (`.env.example`, `.env.local.example`).
- Any variable prefixed with `NEXT_PUBLIC_` is exposed to the client bundle.

## Security notes

- Frontend CSP/security headers are configured in `next.config.ts`.
- Firebase rules are in `firebase-rules.json`; review before production rollout.
- Governance migration guidance for the next contract deployment is in `docs/governance-migration.md`.

## Deploy

Recommended flow:

1. `npm run lint`
2. `npm run typecheck`
3. `npm run build`
4. deploy with your preferred platform (Vercel/Node host)

For contract deployments, do not keep a single EOA as live owner. Prefer a Safe multisig, or a timelock controlled by a Safe multisig.
