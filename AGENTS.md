# AGENTS.md

General operating rules for this repository. Keep changes small, evidence-based, and verifiable.

## Core

- Read the relevant current code before changing it. Prefer source, logs, tests, rendered UI, and saved artifacts over memory.
- Use the smallest complete fix. Reuse existing helpers/patterns first; then standard library/platform features; then installed dependencies. Add new code only when needed.
- Fix root causes, not symptoms. When touching a function, hook, contract method, or script, grep its callers and patch the shared path when practical.
- No speculative abstractions, new dependencies, boilerplate, or broad refactors unless explicitly required.
- Touch only tightly related files. If more than 5 files are needed, update `docs/agent-progress.md` and split the work into smaller steps.
- Never revert unrelated worktree changes. Check `git status --short` when it helps.

## Context Hygiene

- Prefer `rg` / `rg --files`. Exclude `.next/`, `.tmp/`, `artifacts/`, `cache/`, `coverage/`, `dist/`, `logs/`, `node_modules/`, `out/`, `playwright-report/`, `test-results/`, `typechain-types/`, and build metadata such as `*.tsbuildinfo`.
- Keep `.codexignore` updated when new build/cache/generated/report/heavy artifact paths appear.
- Do not include `.env*` in broad recursive searches. Use env validators or presence-only checks unless the task explicitly requires inspecting an env template.
- Prefer targeted reads for large files: locate relevant symbols first, then read the complete function and enough surrounding flow to understand callers, state, and side effects. Read the whole file only when its structure is necessary.
- Do not read large `.json`, `.jsonl`, `.csv`, or `.log` files in full. Use bounded summaries: counts, selected keys, sample rows, or exact errors.
- For verbose commands, inspect bounded first/last lines or exact error lines. Do not dump full terminal buffers.
- Use `docs/current_state.md` for current repo truth. Use `docs/agent-progress.md` only for compact durable progress during long tasks.
- Read only the summary, blockers, and next-step sections of state/progress documents first; open linked evidence only when needed.

## Safety

- Never print or summarize secrets from `.env*`, private keys, mnemonics, API tokens, wallet files, cookies, Privy sessions, webhook URLs, Sentry DSNs, database URLs, or keyed RPC URLs. Report only present/missing/redacted.
- Treat smart contracts, Web3 transactions, wallets, indexers, persistence, auth, and operator scripts as high risk. Prefer explicit validation and narrow diffs.
- Do not change security-sensitive behavior, protocol assumptions, funds movement, or experimental flows without explicit approval.
- Do not optimize away intentionally frequent user-visible refreshes. Live game state and important real-time UI freshness are product behavior.
- Do not claim real-world behavior from simulations alone; use real runtime evidence when the task requires it.

## Web3 And Frontend

- For contract/Web3 changes, check reentrancy, replay, duplicate tx, nonce/pending behavior, late actions, epoch/block timing, overflow/large values, ABI compatibility, and frontend/indexer assumptions.
- For wallet flows, verify rejected, reverted, pending, success, failure, wrong network, reconnect/reload, mobile Web3 browser, clean-wallet first action, and explorer links when relevant.
- Preserve React hook order. Avoid render-time async side effects, duplicate sends, and stale local/session recovery.
- Keep action states clear: preparing, signing, pending, success, failed, rejected, degraded/stale.
- Avoid silent no-ops in wallet, mining, chat, profile, rewards, admin, and diagnostic flows.
- For UI work, check mobile layout, overlays, side panels, number typography, reward/jackpot visibility, and failure/recovery messages when relevant.

## Verification

- Run the smallest relevant check first. Broaden only for shared contracts, APIs, persistence, wallet behavior, operator scripts, or user-facing flows.
- Do not run full suites/builds automatically for minor non-breaking changes.
- If a check fails from unrelated env/network/sandbox issues, report it instead of starting long automated troubleshooting.
- After 2 unsuccessful fix/verify cycles on the same failure, stop repeating the same approach, reassess the root cause, gather new evidence, and report only if still blocked.
- Do not claim completion until relevant verification ran, or skipped verification is explicitly explained.
- Common checks: `npm.cmd run typecheck`, `npm.cmd run build`, `npm.cmd run smoke:browser`, `npm.cmd run load:http`, `npm.cmd run health:prod`.

## Browser And Communication

- Before browser/wallet/smoke/remote-site automation, read `docs/browser_automation.md`.
- Browser evidence must use the intended origin unless explicitly local-only. Save long console/network output to artifacts and report compact summaries.
- Update docs/tests when behavior, CLI flags, env vars, API fields, schemas, persistence format, or operator commands change.
- Ask only when ambiguity can materially affect security, funds, public behavior, or irreversible work. Otherwise proceed with the safest reversible assumption.
- Keep progress updates short: current action and relevant finding. Summarize command results by outcome and important failures, not full logs.
- A task is complete only when the requested behavior is done, checks pass or are explained, and no unrelated work was overwritten.
