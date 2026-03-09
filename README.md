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

## Deploy

Recommended flow:

1. `npm run lint`
2. `npm run typecheck`
3. `npm run build`
4. deploy with your preferred platform (Vercel/Node host)
