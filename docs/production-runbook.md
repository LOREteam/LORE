# Production Runbook

Use this runbook only after staging/canary checks are green. Draft files are not launch proof.

## 1. Prepare evidence drafts

```powershell
npm.cmd run proof:drafts:create -- --out-dir=docs/proof-drafts
npm.cmd run proof:launch-map
npm.cmd run proof:launch-docs
npm.cmd run proof:readiness
```

## 2. Contract and funds safety

Collect G1-G4 before host/indexer evidence. Final signoff must prove the exact contract/env, owner Safe or multisig path, randomness sign-off, and direct chain reconciliation for jackpot, Safety Pool, rewards, rebates, deposits, and resolve.
The final `docs/signoff-proof.json` must include concrete `contractEnv`, `ownership.directOwnerReadEvidence`, Safe/multisig governance evidence or proof tx, `randomness.decision` with operator/signer sign-off, and `chainComparison` evidence for `jackpot`, `safetyPool`, `deposits`, `rewards`, `rebates`, and `resolve`.

```powershell
npm.cmd run proof:mainnet -- --strict --out=docs/mainnet-env-proof.log
npm.cmd run proof:chain -- --strict --out=docs/chain-proof-snapshot.json
npm.cmd run proof:signoff:collect -- --epochs=<count> --user=<wallet> --env-log=docs/mainnet-env-proof.log --chain-log=docs/chain-proof-snapshot.json --out=docs/signoff-proof.draft.json
npm.cmd run proof:signoff -- --strict
```
## 3. Production host

Collectors write draft JSON. Do not rename a draft to final proof until the real external evidence is filled and the strict validator passes. Generic text such as `checked` is not proof; use concrete artifact paths, redacted external URLs, command output paths, screenshots, logs, reports, tx hashes, or direct-chain summaries.

Required runtime shape:
- `lore-site` serves the Next.js app.
- `lore-bot` runs auto resolve/mining support separately from the web process.
- `lore-indexer` runs separately from both.
- `LORE_DB_PATH` points to a persistent absolute path outside the repo.
- `health:prod` evidence must use a non-local HTTPS origin; `PROD_HEALTH_ALLOW_LOCAL=1` is only for local smoke and cannot satisfy G6.
- `load:http` evidence must use a staging/canary non-local HTTPS origin; `LOAD_ALLOW_LOCAL=1` is only for local smoke and cannot satisfy G6.
- Save redacted command outputs as `docs/host-health-prod.log` and `docs/host-load-http.log` for `proof:host:collect`; the load log must include `Load base URL:` matching the staging/canary `LOAD_BASE_URL`.

```powershell
$env:PROD_HEALTH_BASE_URL = "https://playlore.xyz"
npm.cmd run health:prod
$env:LOAD_BASE_URL = "https://canary.playlore.xyz"
npm.cmd run load:http
npm.cmd run proof:host:collect -- --origin=https://playlore.xyz --host-type=production --load-origin=https://canary.playlore.xyz --load-host-type=canary --health-log=docs/host-health-prod.log --load-log=docs/host-load-http.log --out=docs/host-proof.draft.json
npm.cmd run proof:host -- --strict
```

## 4. Indexer and DB

Indexer evidence must come from a fresh external DB at the final deploy block. Save the redacted `indexer:once` output as `docs/indexer-once.log` for the collector; the log must include `[indexer] SQLite path:` matching the external `LORE_DB_PATH`, matching `[indexer] Deploy block:` / `[indexer] Start block:` / `[indexer] Finality blocks:`, `[indexer] Finished runOnce`, and no `[indexer] Fatal:` line.
Restore evidence must be collected in order: run the restore drill, save `docs/restore-drill.log` with the successful restore summary, run restored `health:prod`, save `docs/restore-health-prod.log` with `[prod-health] OK`, `base=<restored-origin>`, and numeric `finalityLagBlocks`, then run `proof:restore:collect`.

```powershell
$env:LORE_DB_PATH = "C:\absolute\external\fresh-mainnet-indexer.sqlite"
$env:INDEXER_START_BLOCK = "<deploy-block>"
$env:NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK = "<deploy-block>"
$env:INDEXER_FINALITY_BLOCKS = "<finality-blocks>"
npm.cmd run indexer:once
npm.cmd run proof:chain -- --strict --out=docs/chain-proof-snapshot.json
npm.cmd run proof:indexer:collect -- --fresh-db=true --epochs=<count> --chain-id=59144 --deploy-block=<deploy-block> --finality-blocks=<finality-blocks> --indexer-log=docs/indexer-once.log --health-log=docs/indexer-health-prod.log --chain-snapshot=docs/chain-proof-snapshot.json --out=docs/indexer-proof.draft.json
npm.cmd run proof:indexer -- --strict
$env:LORE_BACKUP_DIR = "C:\absolute\external\lore-backups"
$env:LORE_RESTORE_DRILL_DIR = "C:\absolute\external\lore-restore-drill"
npm.cmd run proof:restore -- --source=<absolute-source-db-outside-repo> --backup-dir=<absolute-backup-dir-outside-repo> --restore-dir=<absolute-restore-dir-outside-repo>
$env:PROD_HEALTH_BASE_URL = "https://restore.playlore.xyz"
npm.cmd run health:prod
npm.cmd run proof:restore:collect -- --source=<absolute-source-db-outside-repo> --backup-dir=<absolute-backup-dir-outside-repo> --restore-dir=<absolute-restore-dir-outside-repo> --backup=<absolute-backup-file-inside-backup-dir> --restored-origin=https://restore.playlore.xyz --restored-host-type=restore --restore-log=docs/restore-drill.log --health-log=docs/restore-health-prod.log --out=docs/restore-proof.draft.json
npm.cmd run proof:restore -- --strict --source=<absolute-source-db-outside-repo> --backup-dir=<absolute-backup-dir-outside-repo> --restore-dir=<absolute-restore-dir-outside-repo> --backup=<absolute-backup-file-inside-backup-dir> --manifest=docs/restore-proof.json
```

## 5. Monitoring

Monitoring evidence must prove one complete enabled monitor for every required kind: `health-prod`, `data-sync`, `stale-indexer-heartbeat`, `indexer-lag`, `bot-restart`, `indexer-restart`, and `reverted-tx`.
Collect distinct fired alert and recovery/resolution artifacts before creating the draft, and verify the recovery timestamp is not earlier than the fired alert timestamp: `docs/monitoring-alert-export.log`, `docs/monitoring-recovery-export.log`, `docs/monitoring-alert-target-test.log`, and `docs/error-tracking-test-event.log`.

```powershell
npm.cmd run proof:monitoring:plan -- --provider=<provider> --error-provider=<error-provider> --origin=https://playlore.xyz --out=docs/monitoring-alert-test-plan.draft.md
npm.cmd run proof:monitoring:draft -- --provider=<provider> --error-provider=<error-provider> --origin=https://playlore.xyz --monitor-artifact=docs/monitoring-alert-export.log --recovery-artifact=docs/monitoring-recovery-export.log --alert-target-artifact=docs/monitoring-alert-target-test.log --error-event-artifact=docs/error-tracking-test-event.log --out=docs/monitoring-proof.draft.json
npm.cmd run proof:monitoring -- --strict
```

## 6. Canary and final QA

Canary evidence must be a real target-RPC JSONL run with at least 50 successful auto-miner unique epochs, recovery checks for reload/reconnect/tab-close/pending tx/remount, and transaction scans proving no duplicate bets, nonce loops, or stuck pending. The canary draft command requires `--live-log` to point to the saved JSONL artifact.
QA evidence must include Privy allowed origins, connect/disconnect/reconnect, wrong network, mobile Web3 browser, clean-wallet first tx, slow auth, failure states, support/audit visibility, final browser/mobile layout, mainnet wording, and debug autominer smoke artifacts. Wallet browser checks must record the exact production origin.

```powershell
$env:CANARY_PROOF_PATH = "docs/canary-proof.json"
$env:LIVE_CANARY_MIN_EPOCHS = "50"
$env:LIVE_CANARY_RPC_LABEL = "<redacted-provider-rpc-label>"
npm.cmd run live:canary
npm.cmd run proof:qa:plan -- --origin=https://playlore.xyz --network=linea-mainnet --chain-id=59144 --out=docs/qa-canary-test-plan.draft.md
npm.cmd run proof:qa:draft -- --origin=https://playlore.xyz --network=linea-mainnet --chain-id=59144 --wallet-artifact=docs/qa-wallet-flow-report.md --failure-artifact=docs/qa-failure-state-report.md --support-artifact=docs/qa-support-audit-report.md --finalqa-artifact=docs/qa-final-browser-report.md --smoke-artifact=docs/qa-smoke-debug-autominer.log --clean-wallet-tx=<txHash> --out=docs/qa-proof.draft.json
npm.cmd run proof:qa -- --strict
npm.cmd run proof:canary:draft -- --network=linea-mainnet --chain-id=59144 --contract=<contract> --rpc-label=<redacted-provider-rpc-label> --live-log=data/live-test-runs/live-canary-YYYY.jsonl --target-artifact=docs/canary-target-proof.log --recovery-artifact=docs/canary-recovery-proof.log --session-artifact=docs/canary-session-summary.log --tx-artifact=docs/canary-transaction-scan.log --out=docs/canary-proof.draft.json
npm.cmd run proof:canary -- data/live-test-runs/live-canary-YYYY.jsonl --strict
npm.cmd run proof:files -- --canary-log=<canary-log-file>
npm.cmd run proof:launch -- --strict --canary-log=<canary-log-file>
```

## 7. Launch hold conditions

Stop launch if any of these remain true:
- Any G1-G14 gate is not Complete.
- Any strict proof command fails.
- Any proof JSON still contains TODO/template values.
- Canary evidence is simulated, too short, not run against the target RPC, or lacks concrete recovery/session/transaction artifacts.
- Monitoring lacks concrete fired alert and recovery evidence.
