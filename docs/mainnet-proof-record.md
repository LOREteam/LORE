# Mainnet Proof Record

This record is the launch gate ledger. Do not change a gate to Complete without external evidence and a passing strict proof command.

| ID | Gate | Status | Evidence |
| --- | --- | --- | --- |
| G1 | Final contract env and funds safety | Missing | TBD docs/signoff-proof.json with contractEnv, deploy block, token, finality, and mainnet env evidence |
| G2 | Owner Safe or multisig | Missing | TBD docs/signoff-proof.json with ownership.directOwnerReadEvidence and Safe/multisig governance evidence or proof tx |
| G3 | Randomness model sign-off | Missing | TBD docs/signoff-proof.json with randomness.decision and operator/signer sign-off evidence |
| G4 | Chain reconciliation | Missing | TBD docs/signoff-proof.json with chainComparison evidence for jackpot, safetyPool, deposits, rewards, rebates, and resolve |
| G5 | Production process model | Missing | TBD docs/host-proof.json with lore-site, lore-bot, lore-indexer, supervisor evidence, and persistent DB evidence |
| G6 | Production health and load | Missing | TBD docs/host-proof.json with docs/host-health-prod.log health:prod base=<production origin> finalityLagBlocks and docs/host-load-http.log load:http Load base URL: evidence |
| G7 | Indexer fresh DB dry-run | Missing | TBD docs/indexer-proof.json with fresh external DB, deploy block, INDEXER_FINALITY_BLOCKS, docs/indexer-once.log, and chainComparison evidence |
| G8 | Backup and restore drill | Missing | TBD docs/restore-proof.json with backupSchedule, docs/restore-backup-schedule.log, docs/restore-drill.log, docs/restore-health-prod.log, docs/restore-indexer-preservation.log, and indexerPreservation evidence |
| G9 | Monitoring and error tracking | Missing | TBD docs/monitoring-proof.json with health-prod, data-sync, stale-indexer-heartbeat, indexer-lag, bot-restart, indexer-restart, reverted-tx, docs/monitoring-alert-export.log, docs/monitoring-recovery-export.log, docs/monitoring-alert-target-test.log, docs/error-tracking-test-event.log, fired/recovery alerts, alert target, and error event evidence |
| G10 | Real canary epochs | Missing | TBD docs/canary-proof.json and live canary log with target-RPC JSONL and 50 successful auto-miner unique epochs |
| G11 | Transaction recovery safety | Missing | TBD docs/canary-proof.json and live canary log with noDuplicateBets, noNonceLoops, noStuckPending, pendingRecoveryConverged, and recovery evidence |
| G12 | Wallet QA | Missing | TBD docs/qa-proof.json with Privy allowed origins, wrong network, mobile Web3 browser, clean-wallet first tx, and slow auth evidence |
| G13 | Failure UX and audit visibility | Missing | TBD docs/qa-proof.json with disabled reasons, pending states, degraded data, bet history, auto-miner logs, and diagnostics evidence |
| G14 | Final launch QA | Missing | TBD docs/qa-proof.json and live canary log with debug autominer smoke, mobile layout, overlays, chat geometry, and mainnet wording evidence |

## Required final command

```powershell
$env:CANARY_PROOF_PATH = "docs/canary-proof.json"
$env:LIVE_CANARY_MIN_EPOCHS = "50"
npm.cmd run proof:files -- --canary-log=<canary-log-file>
npm.cmd run proof:launch -- --strict --canary-log=<canary-log-file>
```
