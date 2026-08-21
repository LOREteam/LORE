# Production Runbook

Use this runbook only after staging/canary checks are green. Draft files are not launch proof.

## 1. Prepare evidence drafts

```powershell
npm.cmd run proof:drafts:create -- --out-dir=docs/proof-drafts
npm.cmd run proof:drafts:create:summary -- --out-dir=docs/proof-drafts
npm.cmd run proof:launch-map
npm.cmd run proof:launch-docs
npm.cmd run proof:readiness
```

## 2. Contract and funds safety

Collect G1-G4 before host/indexer evidence. Final signoff must prove the exact contract/env, owner Safe or multisig path, explicit acceptance of the current non-VRF randomness model, and direct chain reconciliation for jackpot, Safety Pool, rewards, rebates, deposits, and resolve.

Run this section only in the intended production or controlled canary shell after the deployment secret manager has supplied the reviewed environment. Never paste private keys, keyed RPC URLs, Privy secrets, or diagnostics secrets into proof artifacts; the collectors record only redacted status/evidence.
The final `docs/signoff-proof.json` must include concrete `contractEnv`, `contractEnv.protectedBetsRequired=true` with V10 protected bets flag evidence, `ownership.directOwnerReadEvidence`, Safe/multisig governance evidence or proof tx, `randomness.decision=accepted-risk` with operator/signer sign-off for the current non-VRF model, `chainComparison` evidence for `jackpot`, `safetyPool`, `deposits`, `rewards`, `rebates`, and `resolve`, and existing saved artifacts for every local artifact reference.

```powershell
npm.cmd run proof:mainnet -- --strict --out=docs/mainnet-env-proof.log
npm.cmd run proof:chain -- --strict --out=docs/chain-proof-snapshot.json
npm.cmd run proof:signoff:collect -- --epochs=<count> --user=<wallet> --env-log=docs/mainnet-env-proof.log --chain-log=docs/chain-proof-snapshot.json --randomness-decision=accepted-risk --randomness-risk-accepted=true --randomness-operator=<operator-or-signer> --randomness-signed-at=<ISO-UTC> --randomness-evidence=<artifact-or-link> --out=docs/signoff-proof.draft.json
npm.cmd run proof:signoff -- --strict
```

### V10 protocol-fee delivery

V10 accrues owner and burn fees during resolve but does not transfer them from
the resolve path. Monitor the read-only `accruedOwnerFees()` and
`accruedBurnFees()` getters. There is no mandatory 120-epoch cadence: flush when
the accrued value justifies one standalone transaction or before an accounting
checkpoint. The separate call pays its own base transaction cost, so copying the
old 120-epoch cadence is not automatically a total-gas saving.

Before calling the permissionless `flushProtocolFees()` entrypoint, require a
successful read-only simulation against the intended contract and confirm that
at least one accrued bucket is non-zero. After the receipt, reconcile the two
recipient transfers and require both accrued getters to be zero. Do not place
this call in the resolver's critical loop and do not retry it in a tight loop.
If a token transfer fails, the flush rolls back, accrued liabilities remain in
the contract, and epoch resolution remains available; investigate the token and
fee-recipient state before retrying.

## 3. Production host

Collectors write draft JSON. Do not rename a draft to final proof until the real external evidence is filled and the strict validator passes. Generic text such as `checked` is not proof; use concrete artifact paths, redacted external URLs, command output paths, screenshots, logs, reports, tx hashes, or direct-chain summaries.

Required runtime shape:
- `lore-site` serves the Next.js app.
- `lore-bot` runs auto resolve/mining support separately from the web process.
- `lore-indexer` runs separately from both.
- `lore-monitor` polls private runtime/data-sync diagnostics and live state, then alerts on API failure, stale indexer heartbeat, excessive lag, stale snapshots, and overdue non-empty epochs.
- `LORE_DB_PATH` points to a persistent absolute path outside the repo.
- Crawlers remain denied by default. Set `LORE_ALLOW_PUBLIC_INDEXING=1` only on
  the canonical `https://playlore.xyz` production deployment after its real
  TLS/HTTPS and metadata checks pass. Leave it unset on local, preview,
  staging, custom-origin, and maintenance deployments; the application still
  fails closed for those origins even if the variable is accidentally set.
- Production Web Vitals are opt-in. If `NEXT_PUBLIC_WEB_VITALS_ENABLED=1`, set
  `NEXT_PUBLIC_SENTRY_RELEASE` to the exact lowercase 40-hex Git SHA used for
  that immutable deployment. The browser rejects abbreviated SHAs, branches,
  tags, and host deployment labels, so confirm the value against the deploy
  revision before release. This telemetry is operational evidence only and
  does not replace hosted browser or release-gate proof.
- `health:prod` evidence must use a public HTTPS origin; localhost/private/reserved/example/test origins are launch-proof invalid. `PROD_HEALTH_ALLOW_LOCAL=1` is only for local smoke and cannot satisfy G6. Use `health:prod:summary` for low-noise preflight only; saved launch evidence must still come from full `health:prod` output.
- `load:http` evidence must use a staging/canary public HTTPS origin; localhost/private/reserved/example/test origins are launch-proof invalid. `LOAD_ALLOW_LOCAL=1` is only for local smoke and cannot satisfy G6.
- Deployed testnet, staging, and mainnet hosts must provide trusted proxy identity. `ALLOW_WEAK_RATE_LIMIT_IDENTITY=1` is only for local/CI production smoke and is rejected by the mainnet runtime validator.
- Public Sepolia staging/canary hosts can opt into `LORE_PREMAINNET_RUNTIME_STRICT=1` to run the same production-like public HTTPS, Privy App ID, alert email, replica limiter, proxy, secret, indexer finality, and external DB checks before mainnet. This is staging hardening only; it does not satisfy final G1-G14 evidence.
- `WEB_REPLICA_COUNT=2+` requires the configured Upstash-compatible store with
  a real non-placeholder `UPSTASH_REDIS_REST_TOKEN` and
  `RATE_LIMIT_EXTERNAL_FAIL_CLOSED=1`. The same store atomically consumes
  chat/admin signed-proof nonces and the bootstrap-resolver epoch lock, so
  replay protection and keeper dispatch remain shared across replicas; do not
  scale web processes without that store.
- The edge proxy must remove client-supplied `x-lore-proxy-secret`,
  `cf-connecting-ip`, `x-real-ip`, and `x-forwarded-for` headers, then inject the
  proxy secret from protected configuration and overwrite exactly one supported
  client-IP header with its verified remote address. App origins must reject
  direct public traffic; appending to an untrusted forwarded chain is not
  sufficient and allows identity spoofing behind the trusted secret.
- Save redacted supervisor output as `docs/host-process-model.log`, use an absolute external `--db-path`, and save redacted command outputs as `docs/host-health-prod.log` and `docs/host-load-http.log` before `proof:host:collect`; the collector refuses missing process evidence, repo-local DB paths, missing logs, health logs without `[prod-health] OK` / matching `base=` / numeric `finalityLagBlocks`, and load logs without `Load base URL:` matching the staging/canary `LOAD_BASE_URL` or successful latency/error evidence.
- The supervisor artifact must show concrete entries for `lore-site`, `lore-bot`, `lore-indexer`, and `lore-monitor`; strict host proof rejects process evidence that points to a generic or unrelated supervisor log.
- The host proof must also include `externalRateLimit` evidence with `webReplicaCount >= 2`, `distinctReplicas >= 2`, `sharedBucketVerified=true`, and `failClosed=true`, proving both replicas consume one shared external rate-limit bucket/store.

```powershell
$env:PROD_HEALTH_BASE_URL = "https://playlore.xyz"
npm.cmd run health:prod
$env:LOAD_BASE_URL = "https://canary.playlore.xyz"
npm.cmd run load:http
npm.cmd run proof:host:collect -- --origin=https://playlore.xyz --host-type=production --load-origin=https://canary.playlore.xyz --load-host-type=canary --db-path=<absolute-external-LORE_DB_PATH> --supervisor=<pm2-systemd-docker-compose> --process-evidence=docs/host-process-model.log --health-log=docs/host-health-prod.log --load-log=docs/host-load-http.log --out=docs/host-proof.draft.json
npm.cmd run proof:host -- --strict
```

## 4. Indexer and DB

Indexer evidence must come from a fresh external DB at the final deploy block. Save the redacted `indexer:once` output as `docs/indexer-once.log` for the collector; the log must include `[indexer] SQLite path:` matching the external `LORE_DB_PATH`, `[indexer] Contract:` matching `docs/chain-proof-snapshot.json`, matching `[indexer] Deploy block:` / `[indexer] Start block:` / `[indexer] Finality blocks:`, `[indexer] Finished runOnce`, and no `[indexer] Fatal:` line. The `health:prod` evidence for G7 must include `base=<production origin>` plus numeric `finalityLagBlocks`. The `chainSnapshot` must include ISO `generatedAt`, `rpcChainId`, `contractAddress`, and at least the requested `--epochs` unique checked epochs.
Continuous indexer mode tolerates transient failures, then exits after `INDEXER_WATCH_FAILURE_LIMIT` consecutive failed cycles (default `5`) so PM2 can restart it. Verify the restart alert and recovery notification on the deployed testnet host.
Restore evidence must be collected in order: export backup schedule proof to `docs/restore-backup-schedule.log` with `retentionDays`, `lastSuccessfulBackupAt`, and retention/pruning policy evidence, run the restore drill, save `docs/restore-drill.log` with the successful restore summary, run restored `health:prod`, save `docs/restore-health-prod.log` with `[prod-health] OK`, `base=<restored-origin>`, and numeric `finalityLagBlocks`, export heartbeat/latest-indexed-epoch preservation proof to `docs/restore-indexer-preservation.log`, then run `proof:restore:collect`; the final `docs/restore-proof.json` must keep existing saved artifacts for every local artifact reference.

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
$env:LORE_BACKUP_CRON = "0 3 * * *" # PM2 host timezone; default is daily at 03:00
$env:LORE_BACKUP_RETENTION_DAYS = "14" # opt-in; only timestamped lore-backup files are pruned
npm.cmd run db:backup # same command used by the lore-backup PM2 scheduled job
$env:LORE_RESTORE_DRILL_DIR = "C:\absolute\external\lore-restore-drill"
npm.cmd run proof:restore -- --source=<absolute-source-db-outside-repo> --backup-dir=<absolute-backup-dir-outside-repo> --restore-dir=<absolute-restore-dir-outside-repo>
$env:PROD_HEALTH_BASE_URL = "https://restore.playlore.xyz"
npm.cmd run health:prod
npm.cmd run proof:restore:collect -- --source=<absolute-source-db-outside-repo> --backup-dir=<absolute-backup-dir-outside-repo> --restore-dir=<absolute-restore-dir-outside-repo> --backup=<absolute-backup-file-inside-backup-dir> --restored-origin=https://restore.playlore.xyz --restored-host-type=restore --restore-log=docs/restore-drill.log --health-log=docs/restore-health-prod.log --backup-schedule-artifact=docs/restore-backup-schedule.log --preservation-artifact=docs/restore-indexer-preservation.log --out=docs/restore-proof.draft.json
npm.cmd run proof:restore -- --strict --source=<absolute-source-db-outside-repo> --backup-dir=<absolute-backup-dir-outside-repo> --restore-dir=<absolute-restore-dir-outside-repo> --backup=<absolute-backup-file-inside-backup-dir> --manifest=docs/restore-proof.json
```

## 5. Monitoring

Monitoring evidence must prove one complete enabled monitor for every required kind: `health-prod`, `data-sync`, `stale-indexer-heartbeat`, `indexer-lag`, `bot-restart`, `indexer-restart`, and `reverted-tx`.
Collect distinct fired alert and recovery/resolution artifacts before creating the draft, and verify the recovery timestamp is not earlier than the fired alert timestamp. G9 also requires a verified email alert target, not only a generic notification channel: `docs/monitoring-alert-export.log`, `docs/monitoring-recovery-export.log`, `docs/monitoring-alert-target-test.log`, and `docs/error-tracking-test-event.log`.
The host-local `lore-monitor` is the fast operational fallback and requires `RUNTIME_MONITOR_BASE_URL`, `HEALTH_DIAGNOSTICS_SECRET`, and at least one alert channel. Telegram uses its bot credentials; email uses a Resend API key plus a Resend-verified sender, `RUNTIME_MONITOR_EMAIL_FROM`, and `RUNTIME_MONITOR_EMAIL_TO`. Configure the recipient as `playlore88@gmail.com` on the host. It never sends transactions. Keep an external uptime/error provider enabled as well: a monitor on the same host cannot report a full host or network outage.
It alerts when free space on the SQLite volume falls below 1 GiB by default;
override `RUNTIME_MONITOR_MIN_DISK_FREE_BYTES` only for a documented host-specific
capacity policy.
When monitoring an active soak, set `RUNTIME_MONITOR_CANARY_LOG_PATH` and
`RUNTIME_MONITOR_CANARY_MAX_STALE_MS`. The canary writes a final summary event;
an unfinished log that stops receiving events alerts, while a completed
zero-failure summary remains healthy.
The `lore-chain-audit` PM2 job runs `npm.cmd run audit:chain-indexer` every 30
minutes by default. Use `npm.cmd run audit:chain-indexer:summary` for manual
low-noise status checks that still write the configured audit JSON artifact.
Set `CHAIN_INDEXER_AUDIT_CRON` to override that schedule and write
`CHAIN_INDEXER_AUDIT_OUT` to persistent storage. Set
`RUNTIME_MONITOR_CHAIN_AUDIT_PATH` to that file and choose
`RUNTIME_MONITOR_CHAIN_AUDIT_MAX_AGE_MS` longer than the scheduler interval.
The monitor reads at most 128 KiB and alerts on mismatched, stale, invalid, or
unavailable audit output; it does not perform the chain scan on every health poll.
Workspace cleanup is deliberately repo-local and allowlisted. Use dry-run first,
then schedule the apply command only on hosts where generated artifacts are
allowed to be pruned automatically.

```powershell
npm.cmd run cleanup:workspace:dry-run
npm.cmd run cleanup:workspace
```

It removes only `.next/cache`, `playwright-report`, `test-results`, `coverage`,
and `.tmp` children older than `CLEANUP_MIN_AGE_HOURS` (default `8`). It does
not target env files, dependencies, contracts, database/WAL files, proof docs,
lockfiles, or arbitrary repo paths.
If Windows Task Scheduler access is unavailable in Codex, run the repository
fallback loop as a detached local process. It writes its PID to
`logs/workspace-cleanup-loop.pid` and exits immediately on duplicate starts with
the same live PID. This fallback does not survive logout or reboot.

```powershell
npm.cmd run cleanup:workspace:loop:start
npm.cmd run cleanup:workspace:loop:status
npm.cmd run cleanup:workspace:loop:stop
```
For V10, set `RUNTIME_MONITOR_MAX_ACCRUED_PROTOCOL_FEES_WEI` to the maximum
accepted combined owner/burn accrual in token base units. Exceeding it emits an
alert only: the monitor never calls `flushProtocolFees()` or sends a transaction.
The monitor uses `LORE_BACKUP_DIR` by default; set `RUNTIME_MONITOR_BACKUP_DIR`
only to override it. Keep
`RUNTIME_MONITOR_BACKUP_MAX_AGE_MS` longer than the daily backup interval. The
monitor checks only bounded directory metadata and alerts when backups are
missing, stale, invalid, or unavailable.

```powershell
$env:RUNTIME_MONITOR_BASE_URL = "https://playlore.xyz"
$env:RUNTIME_MONITOR_CANARY_LOG_PATH = "<absolute-live-canary-jsonl-path>"
$env:RUNTIME_MONITOR_CANARY_MAX_STALE_MS = "300000"
$env:RUNTIME_MONITOR_CHAIN_AUDIT_PATH = "<absolute-persistent-chain-audit-path>"
$env:RUNTIME_MONITOR_CHAIN_AUDIT_MAX_AGE_MS = "3600000"
$env:RUNTIME_MONITOR_BACKUP_DIR = $env:LORE_BACKUP_DIR
$env:RUNTIME_MONITOR_BACKUP_MAX_AGE_MS = "129600000"
npm.cmd run monitor:runtime:summary
npm.cmd run monitor:runtime
npm.cmd run proof:monitoring:plan -- --provider=<provider> --error-provider=<error-provider> --origin=https://playlore.xyz --out=docs/monitoring-alert-test-plan.draft.md
npm.cmd run proof:monitoring:draft -- --provider=<provider> --error-provider=<error-provider> --origin=https://playlore.xyz --monitor-artifact=docs/monitoring-alert-export.log --recovery-artifact=docs/monitoring-recovery-export.log --alert-target-artifact=docs/monitoring-alert-target-test.log --error-event-artifact=docs/error-tracking-test-event.log --out=docs/monitoring-proof.draft.json
npm.cmd run proof:monitoring -- --strict
```

## 6. Canary and final QA

For V10, regenerate the full dry-run Preview before any signed action:

```powershell
npm.cmd run preview:canary:v10:dry-run
npm.cmd run preview:canary:v10:dry-run:summary
npm.cmd run preview:canary:v10:authorization-ready:summary
```

The Preview writes `docs/v10-canary-dry-run-preview.md`, forces non-executing
child commands, runs the V10 read-only planner, pending nonce dry-run, bounded
V10 matrix dry-run, and strict analyzer, then leaves G10/G11 blocked until real
successful canary transactions exist. Treat it as the fresh consent input, not
as canary proof. The regular summary command validates the existing Preview
freshness within the local proof window, bounded markdown/JSONL artifact sizes,
safe dry-run log path, `transactionSent=false`, no signing or wallet client
creation, and the expected G10/G11 dry-run blocker without regenerating the
Preview. The authorization-ready summary applies the stricter fresh-consent
window and must pass immediately before requesting or using any bounded
real-transaction authorization.

To inspect the planner alone, run:

```powershell
npm.cmd run plan:canary:v10:postdeploy:summary
```

The command is read-only, verifies V10 provenance first, keeps stdout bounded,
and reports one exact next phase. If it reports a ready funded resolve,
authorize only that resolve, wait for its receipt, and rerun the planner before
claims or fee flush. Never reuse a pre-resolve claim plan after the state
transition.

Before reading long proof JSON, tables, or logs, run the compact launch status
checks. These commands are read-only status views; they do not replace strict
proof validation and do not write launch artifacts.

```powershell
npm.cmd run proof:prelaunch:summary
npm.cmd run proof:local:summary
npm.cmd run proof:security-followup:summary
npm.cmd run proof:autonomous:daily:summary
npm.cmd run proof:process-model:summary
npm.cmd run proof:templates:summary
npm.cmd run proof:files:summary
npm.cmd run proof:collector-redaction:summary
npm.cmd run proof:readiness:summary
npm.cmd run proof:launch-map:summary
npm.cmd run proof:remaining:summary
npm.cmd run proof:mainnet:summary
npm.cmd run proof:mainnet:strict:summary
npm.cmd run proof:chain:summary
npm.cmd run proof:chain:strict:summary
npm.cmd run proof:signoff:summary
npm.cmd run proof:signoff:strict:summary
npm.cmd run proof:host:summary
npm.cmd run proof:host:strict:summary
npm.cmd run proof:indexer:summary
npm.cmd run proof:indexer:strict:summary
npm.cmd run proof:restore:summary
npm.cmd run proof:restore:strict:summary
npm.cmd run proof:monitoring:summary
npm.cmd run proof:monitoring:strict:summary
npm.cmd run proof:qa:summary
npm.cmd run proof:qa:strict:summary
npm.cmd run proof:canary:summary
npm.cmd run proof:testnet:canary:strict:summary
npm.cmd run proof:testnet:canary:v10:summary
npm.cmd run db:backup:summary
npm.cmd run db:backup:strict:summary
npm.cmd run proof:launch:summary
npm.cmd run proof:launch:strict:summary
```

If a testnet canary reports a pending-nonce blocker, use only the bounded
recovery helper and keep the dry-run result as evidence:

```powershell
npm.cmd run soak:testnet:clear-pending:summary
```

If `pendingGap=0` and `wouldSend=false`, do not execute anything. If the gap is
nonzero, stop and get fresh explicit approval for exactly one Linea Sepolia
zero-value self-transfer replacement. The execution command must include both
switches:

```powershell
npm.cmd run soak:testnet:clear-pending -- --execute --confirm-lowest-pending-nonce-replacement
npm.cmd run soak:testnet:clear-pending:summary
```

The helper is scoped to `AUTOMINER_A`, verifies the Linea Sepolia chain, reads
the public role address before loading signing material, caps replacement at
one nonce per invocation, and never calls the game or token contracts. Do not
restart a managed soak until the post-execution dry-run reports a zero gap.

Canary evidence must be a real target-RPC JSONL run with at least 50 successful auto-miner unique epochs, recovery checks for reload/reconnect/tab-close/pending tx/remount, and transaction scans proving no duplicate bets, nonce loops, or stuck pending. The canary draft command requires `--live-log` to point to the saved JSONL artifact.

For a long testnet soak, set `LIVE_TEST_HEALTH_BASE_URL` to the same running application, provide its `HEALTH_DIAGNOSTICS_SECRET`, and optionally set `LIVE_TEST_HEALTH_SAMPLE_EVERY_ROUNDS` (default `10`). Plain HTTP is accepted only for localhost. The URL and secret are never written to JSONL. Sampling failures do not interrupt bets, but strict proof rejects an enabled series with failures or fewer than two successful samples. The summary reports first/max/delta for RSS, heap, SQLite DB, and WAL bytes.
QA evidence must include Privy allowed origins, redacted production Privy App ID configured proof, connect/disconnect/reconnect, wrong network, mobile Web3 browser, clean-wallet first tx, slow auth, failure states, support/audit visibility, final browser/mobile layout, mainnet wording, and debug autominer smoke artifacts. Wallet browser checks must record the exact production origin.
Final QA evidence must also include a fresh Codex Security scan report or sealed scan artifact for the exact launch candidate, with no open High/Medium local findings. The local `proof:security-followup:summary` command is a required regression guard but is not a substitute for the final scan.

```powershell
$env:CANARY_PROOF_PATH = "docs/canary-proof.json"
$env:LIVE_CANARY_MIN_EPOCHS = "50"
$env:LIVE_CANARY_RPC_LABEL = "<redacted-provider-rpc-label>"
$env:LIVE_TEST_HEALTH_BASE_URL = "https://testnet.playlore.xyz"
$env:HEALTH_DIAGNOSTICS_SECRET = "<same secret configured on the app>"
# Read-only preflight by default.
npm.cmd run live:canary

# Require a fresh, bounded authorization before enabling real sends.
$env:LIVE_TEST_EXECUTE = "1"
npm.cmd run live:canary -- --execute-live
npm.cmd run proof:qa:plan -- --origin=https://playlore.xyz --network=linea-mainnet --chain-id=59144 --out=docs/qa-canary-test-plan.draft.md
npm.cmd run proof:qa:draft -- --origin=https://playlore.xyz --network=linea-mainnet --chain-id=59144 --wallet-artifact=docs/qa-wallet-flow-report.md --failure-artifact=docs/qa-failure-state-report.md --support-artifact=docs/qa-support-audit-report.md --finalqa-artifact=docs/qa-final-browser-report.md --smoke-artifact=docs/qa-smoke-debug-autominer.log --clean-wallet-tx=<txHash> --out=docs/qa-proof.draft.json
npm.cmd run proof:qa -- --strict
npm.cmd run proof:canary:draft -- --network=linea-mainnet --chain-id=59144 --contract=<contract> --rpc-label=<redacted-provider-rpc-label> --live-log=data/live-test-runs/live-canary-YYYY.jsonl --target-artifact=docs/canary-target-proof.log --recovery-artifact=docs/canary-recovery-proof.log --session-artifact=docs/canary-session-summary.log --tx-artifact=docs/canary-transaction-scan.log --out=docs/canary-proof.draft.json
npm.cmd run proof:canary -- data/live-test-runs/live-canary-YYYY.jsonl --strict
# Keep LORE_DB_PATH, LORE_BACKUP_DIR, LORE_RESTORE_DRILL_DIR, and LORE_RESTORE_BACKUP set to the reviewed external restore-proof paths before final launch proof.
# Complete the final Codex Security scan for the exact launch candidate before final proof files.
npm.cmd run proof:deps
npm.cmd run proof:deps:all
npm.cmd run proof:files -- --canary-log=<canary-log-file>
npm.cmd run proof:launch -- --strict --canary-log=<canary-log-file>
```

## 7. Launch hold conditions

Stop launch if any of these remain true:
- Any G1-G14 gate is not Complete.
- Any strict proof command fails.
- Production dependency audit reports any high or critical advisories.
- Full dependency/toolchain audit reports any high or critical advisory outside
  the documented known dev-only ESLint/minimatch exception.
- Final security scan evidence is missing, stale, not for the exact launch
  candidate, or has any open High/Medium local finding.
- Any proof JSON still contains TODO/template values.
- Canary evidence is simulated, too short, not run against the target RPC, or lacks concrete recovery/session/transaction artifacts.
- Monitoring lacks concrete fired alert and recovery evidence.
