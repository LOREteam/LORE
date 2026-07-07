# Browser Automation Rules

Read this before browser automation, live wallet QA, or smoke tests.

- Prefer the configured browser automation tool when available; otherwise use existing project smoke scripts.
- Use the dedicated test profile only. Do not use a personal Chrome profile for wallet or production QA.
- Keep output compact: save verbose console/network logs to files and report only summaries plus actionable errors.
- Never expose private keys, seed phrases, cookies, Privy session values, bearer tokens, RPC URLs with keys, or full wallet inventory.
- For long live tests, write a summary artifact with counts, failures, tx hashes, epochs, timings, and top blockers.
- Browser evidence for launch must use the final HTTPS origin, not localhost, unless the test is explicitly local-only.
- When checking UI, capture wallet connect/reconnect, wrong network, pending states, degraded data labels, mobile layout, overlays, and chat geometry.
- Do not claim a multi-epoch canary completed unless elapsed wall-clock time and unique epoch counts prove it.