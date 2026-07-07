# Launch Proof Manifest Templates

Use these as shape references only. Do not copy secrets, private keys,
mnemonics, cookies, session data, API tokens, webhook URLs, DSNs, or full logs.
Replace every `REPLACE_*` value with redacted evidence from the deployed
environment before running the matching strict proof command.

## `docs/signoff-proof.json`

```json
{
  "contractEnv": {
    "network": "mainnet",
    "chainId": "59144",
    "contractAddress": "0x0000000000000000000000000000000000000000",
    "tokenAddress": "0x0000000000000000000000000000000000000000",
    "publicContractAddress": "0x0000000000000000000000000000000000000000",
    "keeperContractAddress": "0x0000000000000000000000000000000000000000",
    "deployBlock": "0",
    "publicDeployBlock": "0",
    "indexerStartBlock": "0",
    "finalityBlocks": "REPLACE_WITH_POSITIVE_FINALITY_BLOCKS",
    "keeperMatchesPublic": true,
    "indexerStartBlockMatchesDeployBlock": true,
    "finalityBlocksPositive": true,
    "command": "npm run proof:mainnet -- --strict",
    "evidence": "REPLACE_WITH_REDACTED_ENV_PROOF_SUMMARY",
    "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP"
  },
  "ownership": {
    "ownerAddress": "0x0000000000000000000000000000000000000000",
    "safeOrMultisig": true,
    "directOwnerReadMatches": true,
    "directOwnerReadEvidence": "REPLACE_WITH_DIRECT_OWNER_READ_COMMAND_OR_LINK",
    "proofTx": "0x0000000000000000000000000000000000000000000000000000000000000000",
    "governanceRecordEvidence": "REPLACE_WITH_SAFE_OR_GOVERNANCE_RECORD",
    "evidence": "REPLACE_WITH_OWNER_READ_OR_SAFE_LINK",
    "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP"
  },
  "randomness": {
    "decision": "accepted-risk",
    "riskAcceptedByOperator": true,
    "mitigationDeployed": false,
    "operator": "REPLACE_WITH_SIGNER_HANDLE",
    "signedAt": "REPLACE_WITH_ISO_TIMESTAMP",
    "evidence": "REPLACE_WITH_SIGN_OFF_NOTE_OR_LINK"
  },
  "chainComparison": {
    "jackpot": { "matches": true, "checkedEpochs": [0], "directChainEvidence": "REPLACE_WITH_CHAIN_READ", "appOrIndexerEvidence": "REPLACE_WITH_APP_OR_INDEXER_READ", "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP" },
    "safetyPool": { "matches": true, "checkedEpochs": [0], "directChainEvidence": "REPLACE_WITH_CHAIN_READ", "appOrIndexerEvidence": "REPLACE_WITH_APP_OR_INDEXER_READ", "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP" },
    "deposits": { "matches": true, "checkedEpochs": [0], "directChainEvidence": "REPLACE_WITH_CHAIN_READ", "appOrIndexerEvidence": "REPLACE_WITH_APP_OR_INDEXER_READ", "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP" },
    "rewards": { "matches": true, "checkedEpochs": [0], "directChainEvidence": "REPLACE_WITH_CHAIN_READ", "appOrIndexerEvidence": "REPLACE_WITH_APP_OR_INDEXER_READ", "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP" },
    "rebates": { "matches": true, "checkedEpochs": [0], "directChainEvidence": "REPLACE_WITH_CHAIN_READ", "appOrIndexerEvidence": "REPLACE_WITH_APP_OR_INDEXER_READ", "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP" },
    "resolve": { "matches": true, "checkedEpochs": [0], "directChainEvidence": "REPLACE_WITH_CHAIN_READ", "appOrIndexerEvidence": "REPLACE_WITH_APP_OR_INDEXER_READ", "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP" }
  }
}
```

Verify with:

```bash
npm run proof:signoff -- --strict
```

## `docs/host-proof.json`

```json
{
  "origin": "https://REPLACE_WITH_FINAL_ORIGIN",
  "hostType": "production",
  "processModel": {
    "supervisor": "pm2",
    "lore-site": {
      "supervised": true,
      "running": true,
      "status": "running",
      "command": "npm run start",
      "evidence": "REPLACE_WITH_PM2_OR_SUPERVISOR_OUTPUT",
      "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP"
    },
    "lore-bot": {
      "supervised": true,
      "running": true,
      "status": "running",
      "command": "npm run bot",
      "evidence": "REPLACE_WITH_PM2_OR_SUPERVISOR_OUTPUT",
      "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP"
    },
    "lore-indexer": {
      "supervised": true,
      "running": true,
      "status": "running",
      "command": "npm run indexer",
      "evidence": "REPLACE_WITH_PM2_OR_SUPERVISOR_OUTPUT",
      "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP"
    }
  },
  "persistentDb": {
    "path": "REPLACE_WITH_ABSOLUTE_DB_PATH_OUTSIDE_REPO",
    "absolutePathOutsideRepo": true,
    "restartSurvived": true,
    "rebootSurvived": true,
    "evidence": "REPLACE_WITH_RESTART_OR_REBOOT_PROOF",
    "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP"
  },
  "healthProd": {
    "status": "pass",
    "command": "npm run health:prod",
    "url": "https://REPLACE_WITH_FINAL_ORIGIN",
    "runtimeHealthPassed": true,
    "dataSyncHealthPassed": true,
    "diagnosticsAuthPassed": true,
    "finalityLagChecked": true,
    "jackpotRowsChecked": true,
    "summary": "REPLACE_WITH_HEALTH_PROD_SUMMARY",
    "timestamp": "REPLACE_WITH_ISO_TIMESTAMP"
  },
  "loadHttp": {
    "status": "pass",
    "command": "npm run load:http",
    "hostType": "canary",
    "url": "https://REPLACE_WITH_STAGING_OR_CANARY_ORIGIN",
    "durationMs": 60000,
    "concurrency": 50,
    "requestCount": 1,
    "errorRate": 0,
    "maxErrorRate": 0.01,
    "p95Ms": 1,
    "maxP95Ms": 1500,
    "summary": "REPLACE_WITH_LOAD_HTTP_SUMMARY",
    "timestamp": "REPLACE_WITH_ISO_TIMESTAMP"
  }
}
```

Verify with:

```bash
npm run proof:host -- --strict
```

## `docs/indexer-proof.json`

```json
{
  "dryRun": {
    "status": "pass",
    "command": "npm run indexer:once",
    "freshDb": true,
    "fromDeployBlock": true,
    "startBlock": "0",
    "deployBlock": "0",
    "summary": "REPLACE_WITH_INDEXER_ONCE_SUMMARY",
    "timestamp": "REPLACE_WITH_ISO_TIMESTAMP"
  },
  "finality": {
    "finalityBlocksPositive": true,
    "finalityBlocks": "REPLACE_WITH_POSITIVE_FINALITY_BLOCKS",
    "dataSyncHealthFinalityAware": true,
    "evidence": "REPLACE_WITH_FINALITY_LAG_AND_DATA_SYNC_HEALTH_PROOF",
    "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP"
  },
  "chainSnapshot": {
    "path": "data/proof-runs/indexer-REPLACE_WITH_STAMP/chain-snapshot.json",
    "expectedChainId": 59144,
    "rpcChainId": 59144,
    "rpcChainIdMatches": true,
    "rpcSource": "REPLACE_WITH_CONFIGURED_RPC_ENV_NAME",
    "contractAddress": "0x0000000000000000000000000000000000000000",
    "contractAddressMatches": true,
    "evidence": "REPLACE_WITH_DIRECT_CHAIN_SNAPSHOT_SUMMARY",
    "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP"
  },
  "chainComparison": {
    "jackpot": { "matches": true, "checkedEpochs": [0], "evidence": "REPLACE_WITH_DIRECT_CHAIN_COMPARISON", "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP" },
    "deposits": { "matches": true, "checkedEpochs": [0], "evidence": "REPLACE_WITH_DIRECT_CHAIN_COMPARISON", "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP" },
    "rewards": { "matches": true, "checkedEpochs": [0], "evidence": "REPLACE_WITH_DIRECT_CHAIN_COMPARISON", "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP" },
    "rebates": { "matches": true, "checkedEpochs": [0], "evidence": "REPLACE_WITH_DIRECT_CHAIN_COMPARISON", "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP" },
    "latestEpochs": { "matches": true, "checkedEpochs": [0], "evidence": "REPLACE_WITH_DIRECT_CHAIN_COMPARISON", "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP" }
  }
}
```

Verify with:

```bash
npm run proof:indexer -- --strict
```

## `docs/restore-proof.json`

```json
{
  "backupSchedule": {
    "enabled": true,
    "cadence": "REPLACE_WITH_RECURRING_BACKUP_CADENCE",
    "evidence": "REPLACE_WITH_BACKUP_SCHEDULE_OR_CRON_PROOF",
    "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP"
  },
  "restoreDrill": {
    "status": "pass",
    "command": "npm run proof:restore -- --strict",
    "backupPathOutsideRepo": true,
    "restorePathOutsideRepo": true,
    "backupRestoreDirsDistinct": true,
    "sourceDbOutsideBackupRestoreDirs": true,
    "sourceDbPath": "REPLACE_WITH_ABSOLUTE_SOURCE_DB_PATH",
    "backupDir": "REPLACE_WITH_ABSOLUTE_BACKUP_DIR",
    "restoreDir": "REPLACE_WITH_ABSOLUTE_RESTORE_DIR",
    "summary": "REPLACE_WITH_SQLITE_RESTORE_SUMMARY",
    "timestamp": "REPLACE_WITH_ISO_TIMESTAMP"
  },
  "restoredStagingHealth": {
    "status": "pass",
    "command": "npm run health:prod",
    "hostType": "restore",
    "url": "https://REPLACE_WITH_RESTORED_STAGING_ORIGIN",
    "runtimeHealthPassed": true,
    "dataSyncHealthPassed": true,
    "finalityLagChecked": true,
    "summary": "REPLACE_WITH_RESTORED_STAGING_HEALTH_SUMMARY_WITH_finalityLagBlocks",
    "timestamp": "REPLACE_WITH_ISO_TIMESTAMP"
  },
  "indexerPreservation": {
    "heartbeatPreserved": true,
    "latestIndexedEpochPreserved": true,
    "heartbeatBefore": "REPLACE_WITH_HEARTBEAT_BEFORE_RESTORE",
    "heartbeatAfter": "REPLACE_WITH_HEARTBEAT_AFTER_RESTORE",
    "latestIndexedEpochBefore": "0",
    "latestIndexedEpochAfter": "0",
    "evidence": "REPLACE_WITH_HEARTBEAT_AND_EPOCH_COMPARISON",
    "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP"
  }
}
```

Verify with:

```bash
npm run proof:restore -- --strict
```

## `docs/monitoring-proof.json`

```json
{
  "origin": "REPLACE_WITH_FINAL_HTTPS_ORIGIN",
  "monitors": [
    {
      "kind": "health-prod",
      "enabled": true,
      "provider": "REPLACE_WITH_PROVIDER",
      "cadenceSeconds": 60,
      "command": "npm run health:prod",
      "url": "https://REPLACE_WITH_FINAL_ORIGIN/api/health/runtime",
      "alertCondition": "REPLACE_WITH_NON_OK_HEALTH_ALERT_CONDITION",
      "link": "REPLACE_WITH_MONITOR_PAGE_LINK",
      "lastAlertTestAt": "REPLACE_WITH_ISO_TIMESTAMP",
      "recoveryLink": "REPLACE_WITH_RECOVERY_OR_RESOLUTION_LINK",
      "lastRecoveryAt": "REPLACE_WITH_ISO_TIMESTAMP"
    },
    { "kind": "data-sync", "enabled": true, "provider": "REPLACE_WITH_PROVIDER", "url": "https://REPLACE_WITH_FINAL_ORIGIN/api/health/data-sync", "alertCondition": "REPLACE_WITH_DATA_SYNC_ALERT_CONDITION", "link": "REPLACE_WITH_MONITOR_PAGE_LINK", "lastAlertTestAt": "REPLACE_WITH_ISO_TIMESTAMP",
      "recoveryLink": "REPLACE_WITH_RECOVERY_OR_RESOLUTION_LINK",
      "lastRecoveryAt": "REPLACE_WITH_ISO_TIMESTAMP" },
    { "kind": "stale-indexer-heartbeat", "enabled": true, "provider": "REPLACE_WITH_PROVIDER", "url": "https://REPLACE_WITH_FINAL_ORIGIN/api/health/data-sync", "threshold": "REPLACE_WITH_HEARTBEAT_STALE_THRESHOLD", "link": "REPLACE_WITH_MONITOR_PAGE_LINK", "lastAlertTestAt": "REPLACE_WITH_ISO_TIMESTAMP",
      "recoveryLink": "REPLACE_WITH_RECOVERY_OR_RESOLUTION_LINK",
      "lastRecoveryAt": "REPLACE_WITH_ISO_TIMESTAMP" },
    { "kind": "indexer-lag", "enabled": true, "provider": "REPLACE_WITH_PROVIDER", "url": "https://REPLACE_WITH_FINAL_ORIGIN/api/health/data-sync", "threshold": "REPLACE_WITH_INDEXER_LAG_THRESHOLD", "link": "REPLACE_WITH_MONITOR_PAGE_LINK", "lastAlertTestAt": "REPLACE_WITH_ISO_TIMESTAMP",
      "recoveryLink": "REPLACE_WITH_RECOVERY_OR_RESOLUTION_LINK",
      "lastRecoveryAt": "REPLACE_WITH_ISO_TIMESTAMP" },
    { "kind": "bot-restart", "enabled": true, "provider": "REPLACE_WITH_PROVIDER", "alertCondition": "REPLACE_WITH_BOT_RESTART_ALERT_CONDITION", "link": "REPLACE_WITH_MONITOR_PAGE_LINK", "lastAlertTestAt": "REPLACE_WITH_ISO_TIMESTAMP",
      "recoveryLink": "REPLACE_WITH_RECOVERY_OR_RESOLUTION_LINK",
      "lastRecoveryAt": "REPLACE_WITH_ISO_TIMESTAMP" },
    { "kind": "indexer-restart", "enabled": true, "provider": "REPLACE_WITH_PROVIDER", "alertCondition": "REPLACE_WITH_INDEXER_RESTART_ALERT_CONDITION", "link": "REPLACE_WITH_MONITOR_PAGE_LINK", "lastAlertTestAt": "REPLACE_WITH_ISO_TIMESTAMP",
      "recoveryLink": "REPLACE_WITH_RECOVERY_OR_RESOLUTION_LINK",
      "lastRecoveryAt": "REPLACE_WITH_ISO_TIMESTAMP" },
    { "kind": "reverted-tx", "enabled": true, "provider": "REPLACE_WITH_PROVIDER", "threshold": "REPLACE_WITH_REVERTED_TX_THRESHOLD", "link": "REPLACE_WITH_MONITOR_PAGE_LINK", "lastAlertTestAt": "REPLACE_WITH_ISO_TIMESTAMP",
      "recoveryLink": "REPLACE_WITH_RECOVERY_OR_RESOLUTION_LINK",
      "lastRecoveryAt": "REPLACE_WITH_ISO_TIMESTAMP" }
  ],
  "alertTargets": [
    {
      "name": "REPLACE_WITH_ALERT_TARGET_LABEL",
      "kind": "pagerduty",
      "verified": true,
      "lastTestAt": "REPLACE_WITH_ISO_TIMESTAMP",
      "link": "REPLACE_WITH_ALERT_TARGET_TEST_LINK",
      "evidence": "REPLACE_WITH_REDACTED_FIRED_ALERT_PROOF"
    }
  ],
  "errorTracking": {
    "enabled": true,
    "provider": "Sentry",
    "project": "REPLACE_WITH_PROJECT_LABEL",
    "link": "REPLACE_WITH_PROJECT_OR_DASHBOARD_LINK",
    "environment": "REPLACE_WITH_ENVIRONMENT",
    "releaseOrDeploy": "REPLACE_WITH_RELEASE_OR_DEPLOY_ID",
    "testEventStatus": "pass",
    "testEventAt": "REPLACE_WITH_ISO_TIMESTAMP",
    "testEventId": "REPLACE_WITH_PROVIDER_EVENT_ID",
    "testEventLink": "REPLACE_WITH_PROVIDER_TEST_EVENT_LINK"
  }
}
```

Verify with:

```bash
npm run proof:monitoring -- --strict
```

## `docs/qa-proof.json`

```json
{
  "targetNetwork": "linea-mainnet",
  "targetChainId": 59144,
  "wallet": {
    "privyAllowedOrigins": {
      "status": "verified",
      "origin": "https://REPLACE_WITH_PRODUCTION_ORIGIN",
      "exactProductionOrigin": true,
      "developmentFallbackAppIdUsed": false,
      "evidence": "REPLACE_WITH_PRIVY_DASHBOARD_URL_OR_SCREENSHOT_PATH",
      "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP"
    },
    "desktopConnect": { "status": "verified", "evidence": "REPLACE_WITH_QA_SCREENSHOT_OR_LOG_PATH", "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP" },
    "desktopDisconnect": { "status": "verified", "evidence": "REPLACE_WITH_QA_SCREENSHOT_OR_LOG_PATH", "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP" },
    "desktopReconnect": { "status": "verified", "evidence": "REPLACE_WITH_QA_SCREENSHOT_OR_LOG_PATH", "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP" },
    "wrongNetwork": { "status": "verified", "targetChainId": 59144, "testedChainId": 59141, "unsupportedChainWarningVisible": true, "evidence": "REPLACE_WITH_QA_SCREENSHOT_OR_LOG_PATH", "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP" },
    "mobileWeb3Browser": { "status": "verified", "evidence": "REPLACE_WITH_QA_SCREENSHOT_OR_LOG_PATH", "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP" },
    "cleanWalletFirstTx": { "status": "verified", "network": "linea-mainnet", "chainId": 59144, "txHash": "0x0000000000000000000000000000000000000000000000000000000000000000", "evidence": "REPLACE_WITH_QA_SCREENSHOT_OR_LOG_PATH", "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP" },
    "slowNetworkAuthModal": { "status": "verified", "evidence": "REPLACE_WITH_QA_SCREENSHOT_OR_LOG_PATH", "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP" },
    "slowNetworkChatAuth": { "status": "verified", "evidence": "REPLACE_WITH_QA_SCREENSHOT_OR_LOG_PATH", "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP" }
  },
  "failureStateUx": {
    "disabledActionsExplainReason": { "status": "verified", "evidence": "REPLACE_WITH_QA_SCREENSHOT_OR_LOG_PATH", "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP" },
    "pendingBet": { "status": "verified", "evidence": "REPLACE_WITH_QA_SCREENSHOT_OR_LOG_PATH", "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP" },
    "pendingResolve": { "status": "verified", "evidence": "REPLACE_WITH_QA_SCREENSHOT_OR_LOG_PATH", "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP" },
    "pendingChatAuth": { "status": "verified", "evidence": "REPLACE_WITH_QA_SCREENSHOT_OR_LOG_PATH", "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP" },
    "pendingProfileSave": { "status": "verified", "evidence": "REPLACE_WITH_QA_SCREENSHOT_OR_LOG_PATH", "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP" },
    "degradedDataVisible": { "status": "verified", "evidence": "REPLACE_WITH_QA_SCREENSHOT_OR_LOG_PATH", "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP" },
    "routeChunkRecovery": { "status": "verified", "evidence": "REPLACE_WITH_QA_SCREENSHOT_OR_LOG_PATH", "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP" },
    "noSilentNoop": { "status": "verified", "evidence": "REPLACE_WITH_QA_SCREENSHOT_OR_LOG_PATH", "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP" }
  },
  "supportAuditVisibility": {
    "betHistoryFields": { "status": "verified", "fields": ["epoch", "tile", "amount", "txHash", "result"], "evidence": "REPLACE_WITH_QA_SCREENSHOT_OR_LOG_PATH", "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP" },
    "autoMinerLogFields": { "status": "verified", "fields": ["round", "epoch", "nonce", "txHash", "retryCount"], "evidence": "REPLACE_WITH_QA_SCREENSHOT_OR_LOG_PATH", "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP" },
    "diagnosticsIndexerLag": { "status": "verified", "evidence": "REPLACE_WITH_QA_SCREENSHOT_OR_LOG_PATH", "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP" },
    "diagnosticsHeartbeat": { "status": "verified", "evidence": "REPLACE_WITH_QA_SCREENSHOT_OR_LOG_PATH", "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP" },
    "diagnosticsServingMode": { "status": "verified", "evidence": "REPLACE_WITH_QA_SCREENSHOT_OR_LOG_PATH", "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP" }
  },
  "finalQa": {
    "browserSmokeDebugAutominer": {
      "status": "verified",
      "origin": "https://REPLACE_WITH_PRODUCTION_ORIGIN",
      "command": "$env:SMOKE_INCLUDE_DEBUG_AUTOMINER_SCENARIOS = \"1\"; npm.cmd run smoke:browser; Remove-Item Env:\\SMOKE_INCLUDE_DEBUG_AUTOMINER_SCENARIOS",
      "debugAutominerScenariosPassed": true,
      "noUnexpectedConsoleErrors": true,
      "unsupportedWalletWarningsNotMasked": true,
      "evidence": "REPLACE_WITH_SMOKE_LOG_OR_REPORT_PATH",
      "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP"
    },
    "mobileLayout": { "status": "verified", "evidence": "REPLACE_WITH_QA_SCREENSHOT_OR_LOG_PATH", "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP" },
    "rightPanelOverlays": { "status": "verified", "evidence": "REPLACE_WITH_QA_SCREENSHOT_OR_LOG_PATH", "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP" },
    "chatGeometry": { "status": "verified", "evidence": "REPLACE_WITH_QA_SCREENSHOT_OR_LOG_PATH", "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP" },
    "faqMainnetWording": { "status": "verified", "evidence": "REPLACE_WITH_QA_SCREENSHOT_OR_LOG_PATH", "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP" },
    "whitepaperMainnetWording": { "status": "verified", "evidence": "REPLACE_WITH_QA_SCREENSHOT_OR_LOG_PATH", "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP" },
    "onboardingMainnetWording": { "status": "verified", "evidence": "REPLACE_WITH_QA_SCREENSHOT_OR_LOG_PATH", "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP" }
  }
}
```

Verify with:

```bash
npm run proof:qa -- --strict
```

## `docs/canary-proof.json`

```json
{
  "targetNetwork": {
    "realTargetNetwork": true,
    "network": "linea-mainnet",
    "chainId": "59144",
    "rpc": "REPLACE_WITH_REDACTED_RPC_LABEL",
    "contractAddress": "REPLACE_WITH_CONTRACT_ADDRESS",
    "evidence": "REPLACE_WITH_TARGET_RPC_CONTRACT_PROOF_PATH_OR_SUMMARY",
    "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP"
  },
  "recovery": {
    "reload": { "status": "verified", "evidence": "REPLACE_WITH_RELOAD_RECOVERY_LOG_OR_SCREENSHOT_PATH", "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP" },
    "reconnect": { "status": "verified", "evidence": "REPLACE_WITH_RECONNECT_RECOVERY_LOG_OR_SCREENSHOT_PATH", "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP" },
    "tabCloseRestore": { "status": "verified", "evidence": "REPLACE_WITH_TAB_CLOSE_RESTORE_LOG_OR_SCREENSHOT_PATH", "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP" },
    "pendingTxRecovery": { "status": "verified", "txHash": "0xREPLACE_WITH_RECOVERED_PENDING_TX_HASH", "evidence": "REPLACE_WITH_PENDING_TX_RECOVERY_LOG_OR_REPORT_PATH", "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP" },
    "routeSwitchOrRemount": { "status": "verified", "evidence": "REPLACE_WITH_ROUTE_SWITCH_OR_REMOUNT_LOG_OR_SCREENSHOT_PATH", "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP" }
  },
  "autoMinerSession": {
    "status": "verified",
    "targetRpcConfirmed": true,
    "rounds": 50,
    "uniqueEpochs": 50,
    "evidence": "REPLACE_WITH_AUTOMINER_SESSION_JSONL_PATH_AND_COUNT_SUMMARY",
    "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP"
  },
  "transactionHealth": {
    "noDuplicateBets": true,
    "noNonceLoops": true,
    "noStuckPending": true,
    "pendingRecoveryConverged": true,
    "txHashes": ["0xREPLACE_WITH_SUCCESSFUL_CANARY_TX_HASH"],
    "evidence": "REPLACE_WITH_CANARY_LOG_PATH_AND_TX_HASH_SCAN_SUMMARY",
    "checkedAt": "REPLACE_WITH_ISO_TIMESTAMP"
  }
}
```

Verify with:

```bash
$env:CANARY_PROOF_PATH = "docs/canary-proof.json"
npm.cmd run proof:canary -- data/live-test-runs/live-canary-YYYY.jsonl --strict
Remove-Item Env:\CANARY_PROOF_PATH
```
