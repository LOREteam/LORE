# Mainnet Readiness Checklist

Do not mark a checkbox complete from memory or intent. A checked item must include a concrete evidence marker: proof JSON path, command output path, chain tx/hash, external URL, or recorded operator sign-off.

Primary command map: docs/launch-evidence-command-map.md
Status board: docs/mainnet-status-board.md
Proof record: docs/mainnet-proof-record.md
Runbook: docs/production-runbook.md
Final proof manifests: docs/signoff-proof.json, docs/host-proof.json, docs/indexer-proof.json, docs/restore-proof.json, docs/monitoring-proof.json, docs/qa-proof.json, docs/canary-proof.json

## Blockers

### 1. Contract / funds safety

- [ ] Final redacted env snapshot passes with `npm.cmd run proof:mainnet -- --strict --out=docs/mainnet-env-proof.log`.
- [ ] Final redacted `proof:mainnet` and `proof:chain` outputs are saved with `npm.cmd run proof:mainnet -- --strict --out=docs/mainnet-env-proof.log` and `npm.cmd run proof:chain -- --strict --out=docs/chain-proof-snapshot.json` for sign-off collection.
- [ ] Sign-off collector runs with `npm.cmd run proof:signoff:collect -- --epochs=<count> --user=<wallet> --env-log=docs/mainnet-env-proof.log --chain-log=docs/chain-proof-snapshot.json --out=docs/signoff-proof.draft.json`.
- [ ] Final strict signoff passes with `npm.cmd run proof:signoff -- --strict`; env, owner, randomness, and chain comparison evidence contains concrete paths, links, commands, artifacts, addresses, or tx hashes.
- [ ] Owner is verified as Safe/multisig or explicitly approved governance path.
- [ ] Randomness model has explicit operator sign-off.
- [ ] Jackpot, Safety Pool, rewards, rebates, deposits, and resolve are checked against direct chain reads.

### 2. Auto-mine runtime safety

- [ ] Real canary epochs are recorded on target RPC, not simulated tx counts; strict proof requires at least 50 successful auto-miner unique epochs.
- [ ] Auto-miner reload, reconnect, tab-close restore, pending tx recovery, and remount recovery are tested with concrete evidence paths, reports, tx hashes, or browser artifacts.
- [ ] Duplicate bet, duplicate tx hash, nonce loop, and stuck pending scans are clean.
- [ ] Canary proof draft is collected with `npm.cmd run proof:canary:draft -- --network=linea-mainnet --chain-id=59144 --contract=<contract> --rpc-label=<redacted-provider-rpc-label> --live-log=data/live-test-runs/live-canary-YYYY.jsonl --target-artifact=docs/canary-target-proof.log --recovery-artifact=docs/canary-recovery-proof.log --session-artifact=docs/canary-session-summary.log --tx-artifact=docs/canary-transaction-scan.log --out=docs/canary-proof.draft.json` after the real canary JSONL exists and recovery/session/transaction artifacts are available.
- [ ] Final canary proof passes with `npm.cmd run proof:canary -- data/live-test-runs/live-canary-YYYY.jsonl --strict`; target network, recovery, auto-miner session, and transaction health sections include concrete evidence.

### 3. Production health / supervision

- [ ] `lore-site`, `lore-bot`, and `lore-indexer` run as separate supervised processes.
- [ ] Persistent `LORE_DB_PATH` is outside the repo and survives restart/reboot.
- [ ] Host collector runs with `npm.cmd run proof:host:collect -- --origin=https://playlore.xyz --host-type=production --load-origin=https://canary.playlore.xyz --load-host-type=canary --db-path=<absolute-external-LORE_DB_PATH> --supervisor=<pm2-systemd-docker-compose> --process-evidence=docs/host-process-model.log --health-log=docs/host-health-prod.log --load-log=docs/host-load-http.log --out=docs/host-proof.draft.json`; missing process evidence, repo-local DB paths, and incomplete health or load logs are rejected before a draft is written.
- [ ] Host strict check passes with `npm.cmd run proof:host -- --strict`; supervisor, persistent DB, `health:prod`, and `load:http` sections include concrete evidence, health evidence includes numeric `finalityLagBlocks`, and `docs/host-load-http.log` includes `Load base URL:` matching the staging/canary load origin.
- [ ] Restore drill log is produced before collection with `npm.cmd run proof:restore -- --source=<absolute-source-db-outside-repo> --backup-dir=<absolute-backup-dir-outside-repo> --restore-dir=<absolute-restore-dir-outside-repo>` using external source, backup, and restore paths; save redacted output as `docs/restore-drill.log` with the successful restore summary.
- [ ] Restore collector runs with `npm.cmd run proof:restore:collect -- --source=<absolute-source-db-outside-repo> --backup-dir=<absolute-backup-dir-outside-repo> --restore-dir=<absolute-restore-dir-outside-repo> --backup=<absolute-backup-file-inside-backup-dir> --restored-origin=https://restore.playlore.xyz --restored-host-type=restore --restore-log=docs/restore-drill.log --health-log=docs/restore-health-prod.log --out=docs/restore-proof.draft.json`.
- [ ] Restored host `health:prod` is run against `https://restore.playlore.xyz` and saved as `docs/restore-health-prod.log` with `[prod-health] OK`, `base=https://restore.playlore.xyz`, and numeric `finalityLagBlocks` before `proof:restore:collect`.
- [ ] Restore strict check passes with `npm.cmd run proof:restore -- --strict --source=<absolute-source-db-outside-repo> --backup-dir=<absolute-backup-dir-outside-repo> --restore-dir=<absolute-restore-dir-outside-repo> --backup=<absolute-backup-file-inside-backup-dir> --manifest=docs/restore-proof.json`, including concrete backup schedule, restore drill, restored `health:prod` evidence with numeric `finalityLagBlocks`, and concrete indexer preservation evidence.

### 4. Failure-state UX

- [ ] Disabled wallet/bet/chat/profile actions explain the reason.
- [ ] Pending states are visible for bet, resolve, chat auth, and profile save.
- [ ] Degraded or stale data is labelled clearly.
- [ ] No silent no-op remains in wallet, mining, chat, or profile flows.

### 5. Wallet / network correctness

- [ ] Privy allowed origins include exact production origin.
- [ ] Connect, disconnect, reconnect, wrong network, mobile Web3 browser, clean wallet first tx, and slow auth modal are tested on the exact production origin.
- [ ] QA plan is generated with `npm.cmd run proof:qa:plan -- --origin=https://playlore.xyz --network=linea-mainnet --chain-id=59144 --out=docs/qa-canary-test-plan.draft.md`.
- [ ] QA proof draft is collected with `npm.cmd run proof:qa:draft -- --origin=https://playlore.xyz --network=linea-mainnet --chain-id=59144 --wallet-artifact=docs/qa-wallet-flow-report.md --failure-artifact=docs/qa-failure-state-report.md --support-artifact=docs/qa-support-audit-report.md --finalqa-artifact=docs/qa-final-browser-report.md --smoke-artifact=docs/qa-smoke-debug-autominer.log --clean-wallet-tx=<txHash> --out=docs/qa-proof.draft.json` after wallet, failure-state, support/audit, final browser, smoke, and clean-wallet tx artifacts are available.
- [ ] QA strict proof passes with `npm.cmd run proof:qa -- --strict`; every completed item has concrete artifact-like evidence such as a real path, URL, screenshot, log, report, command output, or tx hash, not generic text like `checked`.

## Should-have

- [ ] Fresh indexer DB dry-run from deploy block is executed with `npm.cmd run indexer:once` using a fresh external `LORE_DB_PATH`; `docs/indexer-once.log` includes `[indexer] SQLite path:` matching that `LORE_DB_PATH`, matching `INDEXER_START_BLOCK` / `NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK`, positive `INDEXER_FINALITY_BLOCKS`, `[indexer] Finished runOnce`, and no `[indexer] Fatal:` line.
- [ ] Indexer proof draft is collected with `npm.cmd run proof:indexer:collect -- --fresh-db=true --epochs=<count> --chain-id=59144 --deploy-block=<deploy-block> --finality-blocks=<finality-blocks> --indexer-log=docs/indexer-once.log --health-log=docs/indexer-health-prod.log --chain-snapshot=docs/chain-proof-snapshot.json --out=docs/indexer-proof.draft.json` after direct chain snapshot/comparison evidence is available.
- [ ] Indexer strict check passes with `npm.cmd run proof:indexer -- --strict`; dry-run, finality, chain snapshot, and each chain comparison include concrete evidence paths, links, artifacts, command output, or direct-chain summaries.
- [ ] Monitoring plan is generated with `npm.cmd run proof:monitoring:plan -- --provider=<provider> --error-provider=<error-provider> --origin=https://playlore.xyz --out=docs/monitoring-alert-test-plan.draft.md`.
- [ ] Monitoring draft is collected with `npm.cmd run proof:monitoring:draft -- --provider=<provider> --error-provider=<error-provider> --origin=https://playlore.xyz --monitor-artifact=docs/monitoring-alert-export.log --recovery-artifact=docs/monitoring-recovery-export.log --alert-target-artifact=docs/monitoring-alert-target-test.log --error-event-artifact=docs/error-tracking-test-event.log --out=docs/monitoring-proof.draft.json` after fired/recovery alert, alert-target, and error-event artifacts are available.
- [ ] Monitoring strict check passes with `npm.cmd run proof:monitoring -- --strict`.
- [ ] External alerts include one complete enabled monitor entry per required kind, with distinct concrete fired and recovery/resolution evidence for health:prod, stale indexer, lag, bot/indexer restarts, and repeated reverted tx; recovery timestamps are not earlier than fired-alert timestamps.
- [ ] Centralized error tracking has a real test event with concrete event id/link/evidence and redaction proof.

## Polish

- [ ] Bet history exposes epoch, tile, amount, tx hash, and result.
- [ ] Auto-miner logs expose round, epoch, nonce, tx, retry, and stop reason.
- [ ] Diagnostics/admin view exposes indexer lag, heartbeat, and serving mode.
- [ ] Mobile layout, right panel, overlays, chat geometry, FAQ, Whitepaper, and onboarding have mainnet-first wording.

## Recommended launch order

1. Restore and review all draft proof files.
2. Collect G1-G9 external evidence on staging/canary/production targets.
3. Run real canary epochs and wallet QA for G10-G14.
4. Run `npm.cmd run proof:files -- --canary-log=<canary-log-file>`.
5. Run `npm.cmd run proof:launch -- --strict --canary-log=<canary-log-file>`.
6. Launch only when docs/mainnet-proof-record.md and docs/mainnet-status-board.md show G1-G14 Complete with concrete evidence.
