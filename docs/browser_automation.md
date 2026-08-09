# Browser Automation Rules

Read this before browser automation, live wallet QA, or smoke tests.

- Prefer the configured browser automation tool when available; otherwise use existing project smoke scripts.
- Use the dedicated test profile only. Do not use a personal Chrome profile for wallet or production QA.
- Keep output compact: save verbose console/network logs to files and report only summaries plus actionable errors.
- Never expose private keys, seed phrases, cookies, Privy session values, bearer tokens, RPC URLs with keys, or full wallet inventory.
- For long live tests, write a summary artifact with counts, failures, tx hashes, epochs, timings, and top blockers.
- Browser evidence for launch must use a public HTTPS origin, not localhost/private/reserved/example/test origins, unless the test is explicitly local-only.
- Never use `npm run dev` for browser-only work: this repository's composite dev runner starts operator bot/indexer workers. Use `npm run dev:ui -- -p <port>` for a local UI-only runtime, or an already-running safe origin.
- For local production browser baselines with `npm run start:3000`, first confirm APIs fail closed without trusted proxy identity, then use a temporary shell-only `ALLOW_WEAK_RATE_LIMIT_IDENTITY=1` only for localhost baseline/smoke measurement. Do not commit this as a production default or count localhost evidence as public launch proof.
- When checking UI, capture wallet connect/reconnect, wrong network, pending states, degraded data labels, mobile layout, overlays, and chat geometry.
- Do not claim a multi-epoch canary completed unless elapsed wall-clock time and unique epoch counts prove it.
