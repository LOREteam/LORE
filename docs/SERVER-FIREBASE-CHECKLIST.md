# Server checklist: Firebase + Indexer (My Deposits)

Use this to verify that **My Deposits** and game data work on production.

---

## 1. Environment variables

| Variable | Where used | Required on server |
|----------|-------------|---------------------|
| `NEXT_PUBLIC_FIREBASE_DATABASE_URL` | Next.js API routes (`/api/deposits`, `/api/epochs`, `/api/jackpots`) and indexer | **Optional.** If not set, default `https://lore-78751-default-rtdb.europe-west1.firebasedatabase.app` is used. Set it if you use a different Firebase project. |
| `FIREBASE_DB_AUTH` | Indexer only (writes to RTDB) | **Optional.** Needed only if Firebase Realtime Database rules require auth for `.write`. If rules allow `.write: true` for `gamedata`, leave empty. |

**Check on server:**
```bash
# If you use .env, ensure it's in project root and loaded when starting the app.
grep -E "NEXT_PUBLIC_FIREBASE_DATABASE_URL|FIREBASE_DB_AUTH" .env
```

- Next.js reads env at runtime for API routes; the indexer loads `.env` via `dotenv/config` when started by `npm run indexer` (or supervisor). Same `.env` in project root is enough.

---

## 2. Indexer running

The indexer fills `gamedata/bets`, `gamedata/epochs`, `gamedata/jackpots` in Firebase. If it is not running, **My Deposits** will stay empty (API returns data from Firebase).

**How it’s started:**
- `npm run bot:supervisor` (or `dev` / `start:all`) starts both **bot** and **indexer**.
- Indexer command: `npm run indexer` → `tsx scripts/indexer.ts --watch`.

**Check on server:**
```bash
# If you use bot:supervisor, you should see two processes (bot + indexer).
ps aux | grep -E "bot|indexer"
# Or check supervisor logs for "[bot-supervisor] Starting indexer at ..."
```

**Quick test (one-shot):**
```bash
npm run indexer:once
# Expect: "[indexer] Scanning blocks ...", "[indexer] Written to Firebase"
```

If the indexer crashes (e.g. 401 from Firebase), supervisor will restart it; after 3 fast crashes the indexer is disabled but the bot keeps running. Check logs for `[indexer]` and `401`/`403`.

---

## 3. Firebase Realtime Database rules

The repo’s `firebase-rules.json` already has:

```json
"gamedata": { ".read": true, ".write": true }
```

So **read** for `gamedata` (and thus for deposits/epochs/jackpots) is allowed. You must **publish** these rules in Firebase.

**Check in Firebase Console:**
1. Open [Firebase Console](https://console.firebase.google.com) → your project → **Realtime Database** → **Rules**.
2. Ensure there is a `gamedata` key with `.read: true` (and `.write: true` if the indexer writes without auth).

**Deploy from repo (if you use Firebase CLI):**
```bash
firebase deploy --only database
```

If rules are missing or too strict, the API will get 401/403 and return empty data; the indexer will fail on write with 401.

---

## Summary

| Item | Status |
|------|--------|
| `NEXT_PUBLIC_FIREBASE_DATABASE_URL` (or default) | Set or using default |
| `FIREBASE_DB_AUTH` (if rules need auth) | Set or empty |
| Indexer process running (e.g. via bot:supervisor) | Running |
| Firebase rules: `gamedata` readable (and writable if indexer writes) | Published in Console |

After fixing, use **Refresh** in the My Deposits block to reload data.
