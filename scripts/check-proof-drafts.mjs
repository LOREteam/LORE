import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const tmp = mkdtempSync(join(tmpdir(), "lore-proof-drafts-"));
const canaryLog = join(tmp, "canary.jsonl");
const emptyCanaryLog = join(tmp, "empty-canary.jsonl");
const canaryTargetArtifact = join(tmp, "canary-target-proof.log");
const canaryRecoveryArtifact = join(tmp, "canary-recovery-proof.log");
const canarySessionArtifact = join(tmp, "canary-session-summary.log");
const canaryTxArtifact = join(tmp, "canary-transaction-scan.log");
const canaryEvent = JSON.stringify({ timestamp: "2026-07-09T00:00:00.000Z", round: 0, ok: true, txStatus: "success", role: "AUTOMINER_A", mode: "bet", epoch: 1, tiles: [1], txHash: "0x1111111111111111111111111111111111111111111111111111111111111111", network: "linea-mainnet", chainId: 59144, contractAddress: "0x1111111111111111111111111111111111111111", rpcLabel: "redacted-mainnet-rpc" });
writeFileSync(canaryLog, `${canaryEvent}\n`, "utf8");
writeFileSync(emptyCanaryLog, "", "utf8");
const canaryFullLog = join(tmp, "canary-full.jsonl");
const canaryFullTxHashes = Array.from({ length: 50 }, (_, index) => `0x${(index + 1).toString(16).padStart(64, "0")}`);
const canaryFullEvents = canaryFullTxHashes.map((txHash, index) => JSON.stringify({
  timestamp: new Date(Date.UTC(2026, 6, 9, 0, index, 0)).toISOString(),
  round: index,
  ok: true,
  txStatus: "success",
  role: "AUTOMINER_A",
  mode: "bet",
  epoch: index + 1,
  tiles: [1],
  txHash,
  network: "linea-mainnet",
  chainId: 59144,
  contractAddress: "0x1111111111111111111111111111111111111111",
  rpcLabel: "redacted-mainnet-rpc",
}));
writeFileSync(canaryFullLog, `${canaryFullEvents.join("\n")}\n`, "utf8");
const testnetCanaryFullLog = join(tmp, "testnet-canary-full.jsonl");
const testnetCanaryFullEvents = canaryFullEvents.map((event) => JSON.stringify({
  ...JSON.parse(event),
  network: "linea-sepolia",
  chainId: 59141,
  rpcLabel: "redacted-sepolia-rpc",
}));
writeFileSync(testnetCanaryFullLog, `${testnetCanaryFullEvents.join("\n")}\n`, "utf8");
const canaryTemplateLiveLog = join(tmp, "canary-template-live.jsonl");
const canarySecretLiveLog = join(tmp, "canary-secret-live.jsonl");
const canaryMalformedLiveLog = join(tmp, "canary-malformed-live.jsonl");
const canaryNonObjectLiveLog = join(tmp, "canary-non-object-live.jsonl");
writeFileSync(
  canaryTemplateLiveLog,
  `${canaryFullEvents.map((event, index) => index === 1 ? JSON.stringify({ ...JSON.parse(event), diagnostic: "TODO" }) : event).join("\n")}\n`,
  "utf8",
);
writeFileSync(
  canarySecretLiveLog,
  `${canaryFullEvents.map((event, index) => index === 2 ? JSON.stringify({ ...JSON.parse(event), rpcUrl: "https://rpc.example.test/secret-key" }) : event).join("\n")}\n`,
  "utf8",
);
writeFileSync(
  canaryMalformedLiveLog,
  `${canaryFullEvents.map((event, index) => index === 3 ? "not-json" : event).join("\n")}\n`,
  "utf8",
);
writeFileSync(
  canaryNonObjectLiveLog,
  `${canaryFullEvents.map((event, index) => index === 4 ? "[]" : event).join("\n")}\n`,
  "utf8",
);
writeFileSync(canaryTargetArtifact, "synthetic canary target proof\n", "utf8");
writeFileSync(canaryRecoveryArtifact, "synthetic canary recovery proof\n", "utf8");
writeFileSync(canarySessionArtifact, "synthetic canary session proof\n", "utf8");
writeFileSync(canaryTxArtifact, "synthetic canary transaction proof\n", "utf8");
const canaryMissingArtifact = join(tmp, "missing-canary-target-proof.log");
const canaryMissingArtifactManifest = join(tmp, "canary-missing-local-artifact.json");
const canaryValidStrictManifestPath = join(tmp, "canary-valid-strict.json");
writeFileSync(
  canaryMissingArtifactManifest,
  JSON.stringify({
    targetNetwork: {
      realTargetNetwork: true,
      network: "linea-mainnet",
      chainId: 59144,
      rpc: "redacted-mainnet-rpc",
      contractAddress: "0x1111111111111111111111111111111111111111",
      checkedAt: "2026-07-09T00:00:00.000Z",
      evidencePath: canaryMissingArtifact,
    },
    recovery: {
      reload: { status: "verified", checkedAt: "2026-07-09T00:00:00.000Z", evidencePath: canaryRecoveryArtifact },
      reconnect: { status: "verified", checkedAt: "2026-07-09T00:00:00.000Z", evidencePath: canaryRecoveryArtifact },
      tabCloseRestore: { status: "verified", checkedAt: "2026-07-09T00:00:00.000Z", evidencePath: canaryRecoveryArtifact },
      pendingTxRecovery: { status: "verified", checkedAt: "2026-07-09T00:00:00.000Z", txHash: canaryFullTxHashes[0], evidencePath: canaryRecoveryArtifact },
      routeSwitchOrRemount: { status: "verified", checkedAt: "2026-07-09T00:00:00.000Z", evidencePath: canaryRecoveryArtifact },
    },
    autoMinerSession: {
      status: "verified",
      targetRpcConfirmed: true,
      rounds: 50,
      uniqueEpochs: 50,
      checkedAt: "2026-07-09T00:49:00.000Z",
      evidencePath: canarySessionArtifact,
    },
    transactionHealth: {
      noDuplicateBets: true,
      noNonceLoops: true,
      noStuckPending: true,
      pendingRecoveryConverged: true,
      txHashes: [canaryFullTxHashes[0]],
      checkedAt: "2026-07-09T00:49:00.000Z",
      evidencePath: canaryTxArtifact,
    },
  }),
  "utf8",
);
const canaryIrrelevantArtifact = join(tmp, "canary-irrelevant.log");
const canaryIrrelevantTargetManifest = join(tmp, "canary-irrelevant-target.json");
const canaryIrrelevantRecoveryManifest = join(tmp, "canary-irrelevant-recovery.json");
const canaryIrrelevantSessionManifest = join(tmp, "canary-irrelevant-session.json");
const canaryIrrelevantTxManifest = join(tmp, "canary-irrelevant-transaction.json");
writeFileSync(canaryIrrelevantArtifact, "pm2 process list only\n", "utf8");
const canaryValidStrictManifest = {
  targetNetwork: {
    realTargetNetwork: true,
    network: "linea-mainnet",
    chainId: 59144,
    rpc: "redacted-mainnet-rpc",
    contractAddress: "0x1111111111111111111111111111111111111111",
    checkedAt: "2026-07-09T00:00:00.000Z",
    evidencePath: canaryTargetArtifact,
  },
  recovery: {
    reload: { status: "verified", checkedAt: "2026-07-09T00:00:00.000Z", evidencePath: canaryRecoveryArtifact },
    reconnect: { status: "verified", checkedAt: "2026-07-09T00:00:00.000Z", evidencePath: canaryRecoveryArtifact },
    tabCloseRestore: { status: "verified", checkedAt: "2026-07-09T00:00:00.000Z", evidencePath: canaryRecoveryArtifact },
    pendingTxRecovery: { status: "verified", checkedAt: "2026-07-09T00:00:00.000Z", txHash: canaryFullTxHashes[0], evidencePath: canaryRecoveryArtifact },
    routeSwitchOrRemount: { status: "verified", checkedAt: "2026-07-09T00:00:00.000Z", evidencePath: canaryRecoveryArtifact },
  },
  autoMinerSession: {
    status: "verified",
    targetRpcConfirmed: true,
    rounds: 50,
    uniqueEpochs: 50,
    checkedAt: "2026-07-09T00:49:00.000Z",
    evidencePath: canarySessionArtifact,
  },
  transactionHealth: {
    noDuplicateBets: true,
    noNonceLoops: true,
    noStuckPending: true,
    pendingRecoveryConverged: true,
    txHashes: [canaryFullTxHashes[0]],
    checkedAt: "2026-07-09T00:49:00.000Z",
    evidencePath: canaryTxArtifact,
  },
};
writeFileSync(canaryValidStrictManifestPath, JSON.stringify(canaryValidStrictManifest), "utf8");
const testnetCanaryValidStrictManifestPath = join(tmp, "testnet-canary-valid-strict.json");
const testnetCanaryValidStrictManifest = {
  ...canaryValidStrictManifest,
  targetNetwork: {
    ...canaryValidStrictManifest.targetNetwork,
    network: "linea-sepolia",
    chainId: 59141,
    rpc: "redacted-sepolia-rpc",
  },
};
writeFileSync(testnetCanaryValidStrictManifestPath, JSON.stringify(testnetCanaryValidStrictManifest), "utf8");
writeFileSync(
  canaryIrrelevantTargetManifest,
  JSON.stringify({
    ...canaryValidStrictManifest,
    targetNetwork: { ...canaryValidStrictManifest.targetNetwork, evidencePath: canaryIrrelevantArtifact },
  }),
  "utf8",
);
writeFileSync(
  canaryIrrelevantRecoveryManifest,
  JSON.stringify({
    ...canaryValidStrictManifest,
    recovery: Object.fromEntries(Object.entries(canaryValidStrictManifest.recovery).map(([key, value]) => [key, { ...value, evidencePath: canaryIrrelevantArtifact }])),
  }),
  "utf8",
);
writeFileSync(
  canaryIrrelevantSessionManifest,
  JSON.stringify({
    ...canaryValidStrictManifest,
    autoMinerSession: { ...canaryValidStrictManifest.autoMinerSession, evidencePath: canaryIrrelevantArtifact },
  }),
  "utf8",
);
writeFileSync(
  canaryIrrelevantTxManifest,
  JSON.stringify({
    ...canaryValidStrictManifest,
    transactionHealth: { ...canaryValidStrictManifest.transactionHealth, evidencePath: canaryIrrelevantArtifact },
  }),
  "utf8",
);
const qaWalletArtifact = join(tmp, "qa-wallet-flow-report.md");
const qaFailureArtifact = join(tmp, "qa-failure-state-report.md");
const qaSupportArtifact = join(tmp, "qa-support-audit-report.md");
const qaFinalArtifact = join(tmp, "qa-final-browser-report.md");
const qaSmokeArtifact = join(tmp, "qa-smoke-debug-autominer.log");
writeFileSync(qaWalletArtifact, "synthetic wallet QA report\n", "utf8");
writeFileSync(qaFailureArtifact, "synthetic failure-state QA report\n", "utf8");
writeFileSync(qaSupportArtifact, "synthetic support audit QA report\n", "utf8");
writeFileSync(qaFinalArtifact, "synthetic final browser QA report\n", "utf8");
writeFileSync(qaSmokeArtifact, "synthetic debug autominer smoke log\n", "utf8");
const qaMissingArtifact = join(tmp, "missing-qa-wallet-flow-report.md");
const qaMissingArtifactManifest = join(tmp, "qa-missing-local-artifact.json");
const checkedAt = "2026-07-09T00:00:00.000Z";
const qaCheck = (artifact, origin = undefined) => ({
  status: "verified",
  checkedAt,
  evidencePath: artifact,
  ...(origin ? { origin } : {}),
});
writeFileSync(
  qaMissingArtifactManifest,
  JSON.stringify({
    targetNetwork: "linea-mainnet",
    targetChainId: 59144,
    wallet: {
      privyAllowedOrigins: {
        ...qaCheck(qaMissingArtifact),
        origin: "https://playlore.xyz",
        exactProductionOrigin: true,
        developmentFallbackAppIdUsed: false,
      },
      desktopConnect: qaCheck(qaWalletArtifact, "https://playlore.xyz"),
      desktopDisconnect: qaCheck(qaWalletArtifact, "https://playlore.xyz"),
      desktopReconnect: qaCheck(qaWalletArtifact, "https://playlore.xyz"),
      wrongNetwork: {
        ...qaCheck(qaWalletArtifact, "https://playlore.xyz"),
        unsupportedChainWarningVisible: true,
        targetChainId: 59144,
        testedChainId: 1,
      },
      mobileWeb3Browser: qaCheck(qaWalletArtifact, "https://playlore.xyz"),
      cleanWalletFirstTx: {
        ...qaCheck(qaWalletArtifact, "https://playlore.xyz"),
        txHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
        network: "linea-mainnet",
        chainId: 59144,
      },
      slowNetworkAuthModal: qaCheck(qaWalletArtifact, "https://playlore.xyz"),
      slowNetworkChatAuth: qaCheck(qaWalletArtifact, "https://playlore.xyz"),
    },
    failureStateUx: {
      disabledActionsExplainReason: qaCheck(qaFailureArtifact),
      pendingBet: qaCheck(qaFailureArtifact),
      pendingResolve: qaCheck(qaFailureArtifact),
      pendingChatAuth: qaCheck(qaFailureArtifact),
      pendingProfileSave: qaCheck(qaFailureArtifact),
      degradedDataVisible: qaCheck(qaFailureArtifact),
      routeChunkRecovery: qaCheck(qaFailureArtifact),
      noSilentNoop: qaCheck(qaFailureArtifact),
    },
    supportAuditVisibility: {
      betHistoryFields: {
        ...qaCheck(qaSupportArtifact),
        fields: ["epoch", "tile", "amount", "txHash", "result"],
      },
      autoMinerLogFields: {
        ...qaCheck(qaSupportArtifact),
        fields: ["round", "epoch", "nonce", "txHash", "retryCount"],
      },
      diagnosticsIndexerLag: qaCheck(qaSupportArtifact),
      diagnosticsHeartbeat: qaCheck(qaSupportArtifact),
      diagnosticsServingMode: qaCheck(qaSupportArtifact),
    },
    finalQa: {
      browserSmokeDebugAutominer: {
        ...qaCheck(qaSmokeArtifact),
        origin: "https://playlore.xyz",
        command: '$env:SMOKE_INCLUDE_DEBUG_AUTOMINER_SCENARIOS = "1"; npm.cmd run smoke:browser',
        debugAutominerScenariosPassed: true,
        noUnexpectedConsoleErrors: true,
        unsupportedWalletWarningsNotMasked: true,
      },
      mobileLayout: qaCheck(qaFinalArtifact),
      rightPanelOverlays: qaCheck(qaFinalArtifact),
      chatGeometry: qaCheck(qaFinalArtifact),
      faqMainnetWording: qaCheck(qaFinalArtifact),
      whitepaperMainnetWording: qaCheck(qaFinalArtifact),
      onboardingMainnetWording: qaCheck(qaFinalArtifact),
    },
  }),
  "utf8",
);
const qaIrrelevantArtifact = join(tmp, "qa-irrelevant.log");
const qaIrrelevantWalletManifest = join(tmp, "qa-irrelevant-wallet.json");
const qaIrrelevantFailureManifest = join(tmp, "qa-irrelevant-failure.json");
const qaIrrelevantSupportManifest = join(tmp, "qa-irrelevant-support.json");
const qaIrrelevantFinalManifest = join(tmp, "qa-irrelevant-final.json");
const qaIrrelevantSmokeManifest = join(tmp, "qa-irrelevant-smoke.json");
writeFileSync(qaIrrelevantArtifact, "pm2 process list only\n", "utf8");
const qaValidStrictManifest = {
  targetNetwork: "linea-mainnet",
  targetChainId: 59144,
  wallet: {
    privyAllowedOrigins: {
      ...qaCheck(qaWalletArtifact),
      origin: "https://playlore.xyz",
      exactProductionOrigin: true,
      developmentFallbackAppIdUsed: false,
    },
    desktopConnect: qaCheck(qaWalletArtifact, "https://playlore.xyz"),
    desktopDisconnect: qaCheck(qaWalletArtifact, "https://playlore.xyz"),
    desktopReconnect: qaCheck(qaWalletArtifact, "https://playlore.xyz"),
    wrongNetwork: {
      ...qaCheck(qaWalletArtifact, "https://playlore.xyz"),
      unsupportedChainWarningVisible: true,
      targetChainId: 59144,
      testedChainId: 1,
    },
    mobileWeb3Browser: qaCheck(qaWalletArtifact, "https://playlore.xyz"),
    cleanWalletFirstTx: {
      ...qaCheck(qaWalletArtifact, "https://playlore.xyz"),
      txHash: "0x1111111111111111111111111111111111111111111111111111111111111111",
      network: "linea-mainnet",
      chainId: 59144,
    },
    slowNetworkAuthModal: qaCheck(qaWalletArtifact, "https://playlore.xyz"),
    slowNetworkChatAuth: qaCheck(qaWalletArtifact, "https://playlore.xyz"),
  },
  failureStateUx: {
    disabledActionsExplainReason: qaCheck(qaFailureArtifact),
    pendingBet: qaCheck(qaFailureArtifact),
    pendingResolve: qaCheck(qaFailureArtifact),
    pendingChatAuth: qaCheck(qaFailureArtifact),
    pendingProfileSave: qaCheck(qaFailureArtifact),
    degradedDataVisible: qaCheck(qaFailureArtifact),
    routeChunkRecovery: qaCheck(qaFailureArtifact),
    noSilentNoop: qaCheck(qaFailureArtifact),
  },
  supportAuditVisibility: {
    betHistoryFields: {
      ...qaCheck(qaSupportArtifact),
      fields: ["epoch", "tile", "amount", "txHash", "result"],
    },
    autoMinerLogFields: {
      ...qaCheck(qaSupportArtifact),
      fields: ["round", "epoch", "nonce", "txHash", "retryCount"],
    },
    diagnosticsIndexerLag: qaCheck(qaSupportArtifact),
    diagnosticsHeartbeat: qaCheck(qaSupportArtifact),
    diagnosticsServingMode: qaCheck(qaSupportArtifact),
  },
  finalQa: {
    browserSmokeDebugAutominer: {
      ...qaCheck(qaSmokeArtifact),
      origin: "https://playlore.xyz",
      command: '$env:SMOKE_INCLUDE_DEBUG_AUTOMINER_SCENARIOS = "1"; npm.cmd run smoke:browser',
      debugAutominerScenariosPassed: true,
      noUnexpectedConsoleErrors: true,
      unsupportedWalletWarningsNotMasked: true,
    },
    mobileLayout: qaCheck(qaFinalArtifact),
    rightPanelOverlays: qaCheck(qaFinalArtifact),
    chatGeometry: qaCheck(qaFinalArtifact),
    faqMainnetWording: qaCheck(qaFinalArtifact),
    whitepaperMainnetWording: qaCheck(qaFinalArtifact),
    onboardingMainnetWording: qaCheck(qaFinalArtifact),
  },
};
const withQaArtifact = (manifest, path, replacement) => JSON.stringify(replacement(structuredClone(manifest), path));
writeFileSync(qaIrrelevantWalletManifest, withQaArtifact(qaValidStrictManifest, qaIrrelevantArtifact, (manifest, artifact) => {
  for (const check of Object.values(manifest.wallet)) check.evidencePath = artifact;
  return manifest;
}), "utf8");
writeFileSync(qaIrrelevantFailureManifest, withQaArtifact(qaValidStrictManifest, qaIrrelevantArtifact, (manifest, artifact) => {
  for (const check of Object.values(manifest.failureStateUx)) check.evidencePath = artifact;
  return manifest;
}), "utf8");
writeFileSync(qaIrrelevantSupportManifest, withQaArtifact(qaValidStrictManifest, qaIrrelevantArtifact, (manifest, artifact) => {
  for (const check of Object.values(manifest.supportAuditVisibility)) check.evidencePath = artifact;
  return manifest;
}), "utf8");
writeFileSync(qaIrrelevantFinalManifest, withQaArtifact(qaValidStrictManifest, qaIrrelevantArtifact, (manifest, artifact) => {
  for (const [key, check] of Object.entries(manifest.finalQa)) if (key !== "browserSmokeDebugAutominer") check.evidencePath = artifact;
  return manifest;
}), "utf8");
writeFileSync(qaIrrelevantSmokeManifest, withQaArtifact(qaValidStrictManifest, qaIrrelevantArtifact, (manifest, artifact) => {
  manifest.finalQa.browserSmokeDebugAutominer.evidencePath = artifact;
  return manifest;
}), "utf8");
const signoffEnvLog = join(tmp, "signoff-env.log");
const signoffFailedEnvLog = join(tmp, "signoff-env-failed.log");
const signoffChainLog = join(tmp, "signoff-chain.log");
writeFileSync(signoffEnvLog, "Summary: all checked env gates passed. proof:mainnet contract env chainId deploy owner Safe multisig direct owner read randomness decision accepted-risk operator sign-off app indexer chain comparison jackpot safetyPool deposits rewards rebates resolve.", "utf8");
writeFileSync(signoffFailedEnvLog, "Summary: 30 env gate(s) missing or failing.", "utf8");
writeFileSync(signoffChainLog, "Summary: synthetic proof:chain direct-chain proof output owner direct owner read jackpot safetyPool deposits rewards rebates resolve chain comparison.", "utf8");
const signoffMissingArtifact = join(tmp, "missing-signoff-env.log");
const signoffMissingArtifactManifest = join(tmp, "signoff-missing-local-artifact.json");
const signoffIrrelevantArtifact = join(tmp, "irrelevant-signoff-evidence.log");
const signoffIrrelevantEnvManifest = join(tmp, "signoff-irrelevant-env-artifact.json");
const signoffIrrelevantOwnerManifest = join(tmp, "signoff-irrelevant-owner-artifact.json");
const signoffIrrelevantRandomnessManifest = join(tmp, "signoff-irrelevant-randomness-artifact.json");
const signoffIrrelevantChainManifest = join(tmp, "signoff-irrelevant-chain-artifact.json");
writeFileSync(signoffIrrelevantArtifact, "Summary: archived generic operator note with no launch proof markers.", "utf8");
const signoffAddress = "0x1111111111111111111111111111111111111111";
const signoffTx = "0x1111111111111111111111111111111111111111111111111111111111111111";
const signoffComparison = (key) => ({
  matches: true,
  directChainEvidence: `artifact: ${signoffChainLog} direct ${key}`,
  appOrIndexerEvidence: `artifact: ${signoffEnvLog} app ${key}`,
  checkedEpochs: [1],
  checkedAt: "2026-07-09T00:00:00.000Z",
});
writeFileSync(
  signoffMissingArtifactManifest,
  JSON.stringify({
    contractEnv: {
      network: "mainnet",
      chainId: 59144,
      contractAddress: signoffAddress,
      tokenAddress: signoffAddress,
      publicContractAddress: signoffAddress,
      keeperContractAddress: signoffAddress,
      deployBlock: "1",
      publicDeployBlock: "1",
      indexerStartBlock: "1",
      finalityBlocks: "1",
      keeperMatchesPublic: true,
      indexerStartBlockMatchesDeployBlock: true,
      finalityBlocksPositive: true,
      checkedAt: "2026-07-09T00:00:00.000Z",
      evidencePath: signoffMissingArtifact,
    },
    ownership: {
      ownerAddress: signoffAddress,
      safeOrMultisig: true,
      directOwnerReadMatches: true,
      directOwnerReadEvidence: `artifact: ${signoffChainLog}`,
      governanceRecordEvidence: "https://safe.linea.build/tx/0x1111111111111111111111111111111111111111",
      proofTx: signoffTx,
      checkedAt: "2026-07-09T00:00:00.000Z",
    },
    randomness: {
      decision: "accepted-risk",
      operator: "launch-operator",
      signedAt: "2026-07-09T00:00:00.000Z",
      riskAcceptedByOperator: true,
      evidence: `artifact: ${signoffEnvLog}`,
    },
    chainComparison: {
      jackpot: signoffComparison("jackpot"),
      safetyPool: signoffComparison("safetyPool"),
      deposits: signoffComparison("deposits"),
      rewards: signoffComparison("rewards"),
      rebates: signoffComparison("rebates"),
      resolve: signoffComparison("resolve"),
    },
  }),
  "utf8",
);
const signoffValidStrictManifest = JSON.parse(readFileSync(signoffMissingArtifactManifest, "utf8"));
signoffValidStrictManifest.contractEnv.evidencePath = signoffEnvLog;
const withSignoffArtifact = (mutator) => {
  const manifest = JSON.parse(JSON.stringify(signoffValidStrictManifest));
  mutator(manifest);
  return JSON.stringify(manifest);
};
writeFileSync(signoffIrrelevantEnvManifest, withSignoffArtifact((manifest) => {
  manifest.contractEnv.evidencePath = signoffIrrelevantArtifact;
}), "utf8");
writeFileSync(signoffIrrelevantOwnerManifest, withSignoffArtifact((manifest) => {
  manifest.ownership.directOwnerReadEvidence = `artifact: ${signoffIrrelevantArtifact}`;
}), "utf8");
writeFileSync(signoffIrrelevantRandomnessManifest, withSignoffArtifact((manifest) => {
  manifest.randomness.evidence = `artifact: ${signoffIrrelevantArtifact}`;
}), "utf8");
writeFileSync(signoffIrrelevantChainManifest, withSignoffArtifact((manifest) => {
  manifest.chainComparison.jackpot.directChainEvidence = `artifact: ${signoffIrrelevantArtifact}`;
  manifest.chainComparison.jackpot.appOrIndexerEvidence = `artifact: ${signoffIrrelevantArtifact}`;
}), "utf8");
const signoffEnvPatch = {
  LINEA_NETWORK: "mainnet",
  NEXT_PUBLIC_LINEA_NETWORK: "mainnet",
  LINEA_CHAIN_ID: "59144",
  NEXT_PUBLIC_LINEA_CHAIN_ID: "59144",
  NEXT_PUBLIC_CONTRACT_ADDRESS: signoffAddress,
  KEEPER_CONTRACT_ADDRESS: signoffAddress,
  NEXT_PUBLIC_LINEA_TOKEN_ADDRESS: signoffAddress,
  NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1",
  INDEXER_START_BLOCK: "1",
  INDEXER_FINALITY_BLOCKS: "1",
};
const hostHealthLog = join(tmp, "host-health-prod.log");
const hostLoadLog = join(tmp, "host-load-http.log");
const hostProcessEvidence = join(tmp, "host-process-model.log");
const hostPersistenceEvidence = join(tmp, "host-persistence.log");
const hostExternalDbPath = join(tmp, "host-prod.sqlite");
const hostHealthMissingBaseLog = join(tmp, "host-health-missing-base.log");
const hostLoadMissingBaseLog = join(tmp, "host-load-missing-base.log");
writeFileSync(hostHealthLog, "[prod-health] OK\nbase=https://playlore.xyz runtime=ok dataSync=ok effectiveLagBlocks=2 finalityLagBlocks=2\n", "utf8");
writeFileSync(hostLoadLog, "Load base URL: https://canary.playlore.xyz\nConcurrency: 10; client IPs: 10; duration: 60000ms; timeout: 10000ms\nTOTAL count= 100 fail= 0 err= 0.00% p50= 100ms p95= 400ms p99= 700ms\n", "utf8");
writeFileSync(hostProcessEvidence, "pm2 lore-site online\npm2 lore-bot online\npm2 lore-indexer online\n", "utf8");
writeFileSync(hostPersistenceEvidence, "persistent DB proof: LORE_DB_PATH C:\\external\\lore.sqlite restart survived reboot survived sqlite database path verified\n", "utf8");
writeFileSync(hostExternalDbPath, "synthetic external host db path marker", "utf8");
writeFileSync(hostHealthMissingBaseLog, "[prod-health] OK\nruntime=ok dataSync=ok effectiveLagBlocks=2 finalityLagBlocks=2\n", "utf8");
writeFileSync(hostLoadMissingBaseLog, "Concurrency: 10; client IPs: 10; duration: 60000ms; timeout: 10000ms\nTOTAL count= 100 fail= 0 err= 0.00% p50= 100ms p95= 400ms p99= 700ms\n", "utf8");
const hostMissingArtifact = join(tmp, "missing-host-process-model.log");
const hostMissingArtifactManifest = join(tmp, "host-missing-local-artifact.json");
const hostProcess = (name, command, evidencePath) => ({
  status: "running",
  running: true,
  supervised: true,
  command,
  checkedAt: "2026-07-09T00:00:00.000Z",
  evidencePath,
});
writeFileSync(
  hostMissingArtifactManifest,
  JSON.stringify({
    origin: "https://playlore.xyz",
    hostType: "production",
    processModel: {
      supervisor: "pm2",
      "lore-site": hostProcess("lore-site", "npm.cmd run start", hostMissingArtifact),
      "lore-bot": hostProcess("lore-bot", "npm.cmd run bot", hostProcessEvidence),
      "lore-indexer": hostProcess("lore-indexer", "npm.cmd run indexer", hostProcessEvidence),
    },
    persistentDb: {
      absolutePathOutsideRepo: true,
      restartSurvived: true,
      rebootSurvived: true,
      path: hostExternalDbPath,
      checkedAt: "2026-07-09T00:00:00.000Z",
      evidencePath: hostProcessEvidence,
    },
    healthProd: {
      status: "ok",
      command: "npm.cmd run health:prod",
      url: "https://playlore.xyz",
      runtimeHealthPassed: true,
      dataSyncHealthPassed: true,
      diagnosticsAuthPassed: true,
      finalityLagChecked: true,
      jackpotRowsChecked: true,
      timestamp: "2026-07-09T00:00:00.000Z",
      evidencePath: hostHealthLog,
      summary: "[prod-health] OK base=https://playlore.xyz runtime=ok dataSync=ok finalityLagBlocks=2",
    },
    loadHttp: {
      status: "ok",
      command: "npm.cmd run load:http",
      url: "https://canary.playlore.xyz",
      hostType: "canary",
      requestCount: 100,
      errorRate: 0,
      maxErrorRate: 0.01,
      p95Ms: 400,
      maxP95Ms: 1000,
      durationMs: 60000,
      concurrency: 10,
      timestamp: "2026-07-09T00:00:00.000Z",
      evidencePath: hostLoadLog,
      summary: "Load base URL: https://canary.playlore.xyz TOTAL count=100 fail=0 err=0.00% p95=400ms",
    },
  }),
  "utf8",
);
const hostIrrelevantProcessEvidence = join(tmp, "host-irrelevant-process-model.log");
const hostIrrelevantProcessManifest = join(tmp, "host-irrelevant-process-model.json");
writeFileSync(hostIrrelevantProcessEvidence, "pm2 unrelated-service online\n", "utf8");
writeFileSync(
  hostIrrelevantProcessManifest,
  JSON.stringify({
    origin: "https://playlore.xyz",
    hostType: "production",
    processModel: {
      supervisor: "pm2",
      "lore-site": hostProcess("lore-site", "npm.cmd run start", hostIrrelevantProcessEvidence),
      "lore-bot": hostProcess("lore-bot", "npm.cmd run bot", hostIrrelevantProcessEvidence),
      "lore-indexer": hostProcess("lore-indexer", "npm.cmd run indexer", hostIrrelevantProcessEvidence),
    },
    persistentDb: {
      absolutePathOutsideRepo: true,
      restartSurvived: true,
      rebootSurvived: true,
      path: hostExternalDbPath,
      checkedAt: "2026-07-09T00:00:00.000Z",
      evidencePath: hostProcessEvidence,
    },
    healthProd: {
      status: "ok",
      command: "npm.cmd run health:prod",
      url: "https://playlore.xyz",
      runtimeHealthPassed: true,
      dataSyncHealthPassed: true,
      diagnosticsAuthPassed: true,
      finalityLagChecked: true,
      jackpotRowsChecked: true,
      timestamp: "2026-07-09T00:00:00.000Z",
      evidencePath: hostHealthLog,
      summary: "[prod-health] OK base=https://playlore.xyz runtime=ok dataSync=ok finalityLagBlocks=2",
    },
    loadHttp: {
      status: "ok",
      command: "npm.cmd run load:http",
      url: "https://canary.playlore.xyz",
      hostType: "canary",
      requestCount: 100,
      errorRate: 0,
      maxErrorRate: 0.01,
      p95Ms: 400,
      maxP95Ms: 1000,
      durationMs: 60000,
      concurrency: 10,
      timestamp: "2026-07-09T00:00:00.000Z",
      evidencePath: hostLoadLog,
      summary: "Load base URL: https://canary.playlore.xyz TOTAL count=100 fail=0 err=0.00% p95=400ms",
    },
  }),
  "utf8",
);
const hostIrrelevantArtifact = join(tmp, "host-irrelevant-evidence.log");
const hostIrrelevantPersistentManifest = join(tmp, "host-irrelevant-persistent-artifact.json");
const hostIrrelevantHealthManifest = join(tmp, "host-irrelevant-health-artifact.json");
const hostIrrelevantLoadManifest = join(tmp, "host-irrelevant-load-artifact.json");
writeFileSync(hostIrrelevantArtifact, "Summary: generic archived note without launch proof markers.\n", "utf8");
const hostValidStrictManifest = JSON.parse(readFileSync(hostMissingArtifactManifest, "utf8"));
hostValidStrictManifest.processModel["lore-site"].evidencePath = hostProcessEvidence;
hostValidStrictManifest.persistentDb.evidencePath = hostPersistenceEvidence;
const withHostArtifact = (mutator) => {
  const manifest = JSON.parse(JSON.stringify(hostValidStrictManifest));
  mutator(manifest);
  return JSON.stringify(manifest);
};
writeFileSync(hostIrrelevantPersistentManifest, withHostArtifact((manifest) => {
  manifest.persistentDb.evidencePath = hostIrrelevantArtifact;
}), "utf8");
writeFileSync(hostIrrelevantHealthManifest, withHostArtifact((manifest) => {
  manifest.healthProd.evidencePath = hostIrrelevantArtifact;
}), "utf8");
writeFileSync(hostIrrelevantLoadManifest, withHostArtifact((manifest) => {
  manifest.loadHttp.evidencePath = hostIrrelevantArtifact;
}), "utf8");
const indexerLog = join(tmp, "indexer-once.log");
const indexerRepoDbLog = join(tmp, "indexer-repo-db.log");
const indexerHealthLog = join(tmp, "indexer-health-prod.log");
const indexerHealthMissingBaseLog = join(tmp, "indexer-health-missing-base.log");
const indexerChainSnapshot = join(tmp, "chain-proof-snapshot.json");
const indexerChainSnapshotMissingGeneratedAt = join(tmp, "chain-proof-missing-generated-at.json");
const indexerChainSnapshotTooFewEpochs = join(tmp, "chain-proof-too-few-epochs.json");
const indexerChainSnapshotNonObject = join(tmp, "chain-proof-non-object.json");
writeFileSync(indexerLog, "[indexer] SQLite path: C:\\external\\lore.sqlite\n[indexer] Contract: 0x1111111111111111111111111111111111111111\n[indexer] Deploy block: 1\n[indexer] Start block: 1\n[indexer] Finality blocks: 1\n[indexer] Scanning blocks 1..10\n[indexer] Finished runOnce\n", "utf8");
writeFileSync(indexerRepoDbLog, `[indexer] SQLite path: ${join(process.cwd(), "repo-indexer.sqlite")}\n[indexer] Contract: 0x1111111111111111111111111111111111111111\n[indexer] Deploy block: 1\n[indexer] Start block: 1\n[indexer] Finality blocks: 1\n[indexer] Scanning blocks 1..10\n[indexer] Finished runOnce\n`, "utf8");
writeFileSync(indexerHealthLog, "[prod-health] OK\nbase=https://playlore.xyz runtime=ok dataSync=ok effectiveLagBlocks=1 finalityLagBlocks=1\n", "utf8");
writeFileSync(indexerHealthMissingBaseLog, "[prod-health] OK\nruntime=ok dataSync=ok effectiveLagBlocks=1 finalityLagBlocks=1\n", "utf8");
writeFileSync(indexerChainSnapshot, JSON.stringify({ generatedAt: "2026-07-09T00:00:00.000Z", expectedChainId: 59144, rpcChainId: 59144, rpcSource: "redacted-mainnet-rpc", contractAddress: "0x1111111111111111111111111111111111111111", epochs: [{ epoch: 1 }] }), "utf8");
const indexerMissingArtifact = join(tmp, "missing-indexer-once.log");
const indexerMissingArtifactManifest = join(tmp, "indexer-missing-local-artifact.json");
const indexerIrrelevantArtifact = join(tmp, "indexer-irrelevant-evidence.log");
const indexerIrrelevantDryRunManifest = join(tmp, "indexer-irrelevant-dry-run-artifact.json");
const indexerIrrelevantFinalityManifest = join(tmp, "indexer-irrelevant-finality-artifact.json");
const indexerIrrelevantSnapshotManifest = join(tmp, "indexer-irrelevant-snapshot-artifact.json");
const indexerIrrelevantComparisonManifest = join(tmp, "indexer-irrelevant-comparison-artifact.json");
writeFileSync(indexerIrrelevantArtifact, "Summary: generic archived note without indexer or chain proof markers.\n", "utf8");
const indexerComparison = (key) => ({
  matches: true,
  checkedEpochs: [1],
  checkedAt: "2026-07-09T00:00:00.000Z",
  evidence: `artifact: ${indexerChainSnapshot} for ${key}`,
});
writeFileSync(
  indexerMissingArtifactManifest,
  JSON.stringify({
    dryRun: {
      status: "verified",
      command: "npm.cmd run indexer:once",
      freshDb: true,
      fromDeployBlock: true,
      dbPath: hostExternalDbPath,
      startBlock: 1,
      deployBlock: 1,
      timestamp: "2026-07-09T00:00:00.000Z",
      evidencePath: indexerMissingArtifact,
      summary: "[indexer] Deploy block: 1\n[indexer] Start block: 1\n[indexer] Finished runOnce",
    },
    finality: {
      finalityBlocksPositive: true,
      finalityBlocks: 1,
      dataSyncHealthFinalityAware: true,
      checkedAt: "2026-07-09T00:00:00.000Z",
      evidencePath: indexerHealthLog,
      summary: "[prod-health] OK base=https://playlore.xyz runtime=ok dataSync=ok finalityLagBlocks=1",
    },
    chainSnapshot: {
      path: indexerChainSnapshot,
      expectedChainId: 59144,
      rpcChainId: 59144,
      rpcChainIdMatches: true,
      rpcSource: "redacted-mainnet-rpc",
      contractAddress: "0x1111111111111111111111111111111111111111",
      contractAddressMatches: true,
      checkedAt: "2026-07-09T00:00:00.000Z",
      evidence: `artifact: ${indexerChainSnapshot}`,
    },
    chainComparison: {
      jackpot: indexerComparison("jackpot"),
      deposits: indexerComparison("deposits"),
      rewards: indexerComparison("rewards"),
      rebates: indexerComparison("rebates"),
      latestEpochs: indexerComparison("latestEpochs"),
    },
  }),
  "utf8",
);
const indexerValidStrictManifest = JSON.parse(readFileSync(indexerMissingArtifactManifest, "utf8"));
indexerValidStrictManifest.dryRun.evidencePath = indexerLog;
const withIndexerArtifact = (mutator) => {
  const manifest = JSON.parse(JSON.stringify(indexerValidStrictManifest));
  mutator(manifest);
  return JSON.stringify(manifest);
};
writeFileSync(indexerIrrelevantDryRunManifest, withIndexerArtifact((manifest) => {
  manifest.dryRun.evidencePath = indexerIrrelevantArtifact;
}), "utf8");
writeFileSync(indexerIrrelevantFinalityManifest, withIndexerArtifact((manifest) => {
  manifest.finality.evidencePath = indexerIrrelevantArtifact;
}), "utf8");
writeFileSync(indexerIrrelevantSnapshotManifest, withIndexerArtifact((manifest) => {
  manifest.chainSnapshot.path = indexerIrrelevantArtifact;
}), "utf8");
writeFileSync(indexerIrrelevantComparisonManifest, withIndexerArtifact((manifest) => {
  manifest.chainComparison.jackpot.evidence = `artifact: ${indexerIrrelevantArtifact}`;
}), "utf8");
writeFileSync(indexerChainSnapshotMissingGeneratedAt, JSON.stringify({ expectedChainId: 59144, rpcChainId: 59144, rpcSource: "redacted-mainnet-rpc", contractAddress: "0x1111111111111111111111111111111111111111", epochs: [{ epoch: 1 }] }), "utf8");
writeFileSync(indexerChainSnapshotTooFewEpochs, JSON.stringify({ generatedAt: "2026-07-09T00:00:00.000Z", expectedChainId: 59144, rpcChainId: 59144, rpcSource: "redacted-mainnet-rpc", contractAddress: "0x1111111111111111111111111111111111111111", epochs: [{ epoch: 1 }] }), "utf8");
writeFileSync(indexerChainSnapshotNonObject, "[]", "utf8");
const monitoringAlertArtifact = join(tmp, "monitoring-alert-export.log");
const monitoringRecoveryArtifact = join(tmp, "monitoring-recovery-export.log");
const monitoringAlertTargetArtifact = join(tmp, "monitoring-alert-target-test.log");
const monitoringErrorEventArtifact = join(tmp, "error-tracking-test-event.log");
writeFileSync(monitoringAlertArtifact, "ALERT synthetic fired monitor export\n", "utf8");
writeFileSync(monitoringRecoveryArtifact, "RECOVERY synthetic resolved monitor export\n", "utf8");
writeFileSync(monitoringAlertTargetArtifact, "SLACK synthetic alert target test export\n", "utf8");
writeFileSync(monitoringErrorEventArtifact, "SENTRY synthetic error tracking test event\n", "utf8");
const monitoringMissingArtifact = join(tmp, "missing-monitoring-alert-export.log");
const monitoringMissingArtifactManifest = join(tmp, "monitoring-missing-local-artifact.json");
const monitoringKinds = [
  "health-prod",
  "data-sync",
  "stale-indexer-heartbeat",
  "indexer-lag",
  "bot-restart",
  "indexer-restart",
  "reverted-tx",
];
writeFileSync(
  monitoringMissingArtifactManifest,
  JSON.stringify({
    origin: "https://playlore.xyz",
    monitors: monitoringKinds.map((kind) => ({
      kind,
      enabled: true,
      provider: "synthetic-monitor",
      cadenceSeconds: kind === "health-prod" ? 60 : 120,
      url: kind === "health-prod" ? "https://playlore.xyz/api/health/runtime" : "https://playlore.xyz/api/health/data-sync",
      alertCondition: `${kind} synthetic alert condition`,
      evidencePath: kind === "health-prod" ? monitoringMissingArtifact : monitoringAlertArtifact,
      link: `artifact: ${kind === "health-prod" ? monitoringMissingArtifact : monitoringAlertArtifact}`,
      lastAlertTestAt: "2026-07-09T00:00:00.000Z",
      recoveryEvidencePath: monitoringRecoveryArtifact,
      recoveryLink: `artifact: ${monitoringRecoveryArtifact}`,
      lastRecoveryAt: "2026-07-09T00:01:00.000Z",
    })),
    alertTargets: [{
      name: "synthetic slack",
      kind: "slack",
      verified: true,
      lastTestAt: "2026-07-09T00:00:00.000Z",
      evidencePath: monitoringAlertTargetArtifact,
      link: `artifact: ${monitoringAlertTargetArtifact}`,
    }],
    errorTracking: {
      enabled: true,
      provider: "synthetic-error-tracker",
      project: "lore-mainnet",
      environment: "production",
      releaseOrDeploy: "synthetic-release",
      testEventStatus: "success",
      testEventAt: "2026-07-09T00:00:00.000Z",
      testEventId: "SENTRY-123456",
      testEventEvidencePath: monitoringErrorEventArtifact,
      testEventLink: `artifact: ${monitoringErrorEventArtifact}`,
    },
  }),
  "utf8",
);

const monitoringIrrelevantArtifact = join(tmp, "monitoring-irrelevant.log");
const monitoringIrrelevantAlertManifest = join(tmp, "monitoring-irrelevant-alert.json");
const monitoringIrrelevantRecoveryManifest = join(tmp, "monitoring-irrelevant-recovery.json");
const monitoringIrrelevantTargetManifest = join(tmp, "monitoring-irrelevant-target.json");
const monitoringIrrelevantErrorManifest = join(tmp, "monitoring-irrelevant-error.json");
writeFileSync(monitoringIrrelevantArtifact, "pm2 process list only\n", "utf8");
const monitoringValidStrictManifest = {
  origin: "https://playlore.xyz",
  monitors: monitoringKinds.map((kind) => ({
    kind,
    enabled: true,
    provider: "synthetic-monitor",
    cadenceSeconds: kind === "health-prod" ? 60 : 120,
    url: kind === "health-prod" ? "https://playlore.xyz/api/health/runtime" : "https://playlore.xyz/api/health/data-sync",
    alertCondition: `${kind} synthetic alert condition`,
    evidencePath: monitoringAlertArtifact,
    link: `artifact: ${monitoringAlertArtifact}`,
    lastAlertTestAt: "2026-07-09T00:00:00.000Z",
    recoveryEvidencePath: monitoringRecoveryArtifact,
    recoveryLink: `artifact: ${monitoringRecoveryArtifact}`,
    lastRecoveryAt: "2026-07-09T00:01:00.000Z",
  })),
  alertTargets: [{
    name: "synthetic slack",
    kind: "slack",
    verified: true,
    lastTestAt: "2026-07-09T00:00:00.000Z",
    evidencePath: monitoringAlertTargetArtifact,
    link: `artifact: ${monitoringAlertTargetArtifact}`,
  }],
  errorTracking: {
    enabled: true,
    provider: "synthetic-error-tracker",
    project: "lore-mainnet",
    environment: "production",
    releaseOrDeploy: "synthetic-release",
    testEventStatus: "success",
    testEventAt: "2026-07-09T00:00:00.000Z",
    testEventId: "SENTRY-123456",
    testEventEvidencePath: monitoringErrorEventArtifact,
    testEventLink: `artifact: ${monitoringErrorEventArtifact}`,
  },
};
writeFileSync(
  monitoringIrrelevantAlertManifest,
  JSON.stringify({
    ...monitoringValidStrictManifest,
    monitors: monitoringValidStrictManifest.monitors.map((monitor) => ({ ...monitor, evidencePath: monitoringIrrelevantArtifact, link: `artifact: ${monitoringIrrelevantArtifact}` })),
  }),
  "utf8",
);
writeFileSync(
  monitoringIrrelevantRecoveryManifest,
  JSON.stringify({
    ...monitoringValidStrictManifest,
    monitors: monitoringValidStrictManifest.monitors.map((monitor) => ({ ...monitor, recoveryEvidencePath: monitoringIrrelevantArtifact, recoveryLink: `artifact: ${monitoringIrrelevantArtifact}` })),
  }),
  "utf8",
);
writeFileSync(
  monitoringIrrelevantTargetManifest,
  JSON.stringify({
    ...monitoringValidStrictManifest,
    alertTargets: monitoringValidStrictManifest.alertTargets.map((target) => ({ ...target, evidencePath: monitoringIrrelevantArtifact, link: `artifact: ${monitoringIrrelevantArtifact}` })),
  }),
  "utf8",
);
writeFileSync(
  monitoringIrrelevantErrorManifest,
  JSON.stringify({
    ...monitoringValidStrictManifest,
    errorTracking: { ...monitoringValidStrictManifest.errorTracking, testEventEvidencePath: monitoringIrrelevantArtifact, testEventLink: `artifact: ${monitoringIrrelevantArtifact}` },
  }),
  "utf8",
);
const restoreSourcePath = join(mkdtempSync(join(tmpdir(), "lore-proof-restore-source-")), "source.sqlite");
const restoreBackupDir = mkdtempSync(join(tmpdir(), "lore-proof-restore-backup-"));
const restoreDir = mkdtempSync(join(tmpdir(), "lore-proof-restore-restored-"));
const restoreBackupPath = join(restoreBackupDir, "backup.sqlite");
const restoreLog = join(tmp, "restore-drill.log");
const restoreHealthLog = join(tmp, "restore-health-prod.log");
const restoreHealthMissingRuntimeLog = join(tmp, "restore-health-missing-runtime.log");
const restoreBackupScheduleArtifact = join(tmp, "restore-backup-schedule.log");
const restorePreservationArtifact = join(tmp, "restore-indexer-preservation.log");
const restoreDirectoryArtifact = mkdtempSync(join(tmpdir(), "lore-proof-restore-artifact-dir-"));
writeFileSync(restoreSourcePath, "synthetic source db for collector draft guard", "utf8");
writeFileSync(restoreBackupPath, "synthetic backup artifact for collector draft guard", "utf8");
writeFileSync(restoreLog, "Summary: backup/restore drill completed without detected issues.\n", "utf8");
writeFileSync(restoreHealthLog, "[prod-health] OK\nbase=https://restore.playlore.xyz runtime=ok dataSync=ok effectiveLagBlocks=1 finalityLagBlocks=1\n", "utf8");
writeFileSync(restoreHealthMissingRuntimeLog, "[prod-health] OK\nbase=https://restore.playlore.xyz dataSync=ok effectiveLagBlocks=1 finalityLagBlocks=1\n", "utf8");
writeFileSync(restoreBackupScheduleArtifact, "synthetic backup schedule export\n", "utf8");
writeFileSync(restorePreservationArtifact, "heartbeatBefore=abc heartbeatAfter=abc latestIndexedEpochBefore=1 latestIndexedEpochAfter=1\n", "utf8");
const restoreMissingArtifact = join(tmp, "missing-restore-backup-schedule.log");
const restoreMissingArtifactManifest = join(tmp, "restore-missing-local-artifact.json");
writeFileSync(
  restoreMissingArtifactManifest,
  JSON.stringify({
    backupSchedule: {
      enabled: true,
      cadence: "daily cron backup",
      checkedAt: "2026-07-09T00:00:00.000Z",
      evidencePath: restoreMissingArtifact,
      link: `artifact: ${restoreMissingArtifact}`,
    },
    restoreDrill: {
      status: "verified",
      command: "npm run proof:restore -- --strict",
      backupPathOutsideRepo: true,
      restorePathOutsideRepo: true,
      backupRestoreDirsDistinct: true,
      sourceDbOutsideBackupRestoreDirs: true,
      sourceDbPath: restoreSourcePath,
      backupDir: restoreBackupDir,
      restoreDir,
      backupArtifact: restoreBackupPath,
      timestamp: "2026-07-09T00:00:00.000Z",
      evidencePath: restoreLog,
    },
    restoredStagingHealth: {
      status: "healthy",
      command: "npm run health:prod -- --base=https://restore.playlore.xyz",
      hostType: "restore",
      url: "https://restore.playlore.xyz",
      runtimeHealthPassed: true,
      dataSyncHealthPassed: true,
      finalityLagChecked: true,
      timestamp: "2026-07-09T00:00:00.000Z",
      evidence: `base=https://restore.playlore.xyz runtime=ok dataSync=ok finalityLagBlocks=1 artifact: ${restoreHealthLog}`,
      evidencePath: restoreHealthLog,
    },
    indexerPreservation: {
      heartbeatPreserved: true,
      latestIndexedEpochPreserved: true,
      heartbeatBefore: "abc",
      heartbeatAfter: "abc",
      latestIndexedEpochBefore: "1",
      latestIndexedEpochAfter: "1",
      checkedAt: "2026-07-09T00:00:00.000Z",
      evidencePath: restorePreservationArtifact,
    },
  }),
  "utf8",
);

const restoreIrrelevantScheduleArtifact = join(tmp, "restore-irrelevant-schedule.log");
const restoreIrrelevantPreservationArtifact = join(tmp, "restore-irrelevant-preservation.log");
const restoreIrrelevantScheduleManifest = join(tmp, "restore-irrelevant-schedule-artifact.json");
const restoreIrrelevantPreservationManifest = join(tmp, "restore-irrelevant-preservation-artifact.json");
writeFileSync(restoreIrrelevantScheduleArtifact, "pm2 process list only\n", "utf8");
writeFileSync(restoreIrrelevantPreservationArtifact, "restore drill completed without indexer comparison\n", "utf8");
const restoreValidStrictManifest = {
  backupSchedule: {
    enabled: true,
    cadence: "daily cron backup",
    checkedAt: "2026-07-09T00:00:00.000Z",
    evidencePath: restoreBackupScheduleArtifact,
    link: `artifact: ${restoreBackupScheduleArtifact}`,
  },
  restoreDrill: {
    status: "verified",
    command: "npm run proof:restore -- --strict",
    backupPathOutsideRepo: true,
    restorePathOutsideRepo: true,
    backupRestoreDirsDistinct: true,
    sourceDbOutsideBackupRestoreDirs: true,
    sourceDbPath: restoreSourcePath,
    backupDir: restoreBackupDir,
    restoreDir,
    backupArtifact: restoreBackupPath,
    timestamp: "2026-07-09T00:00:00.000Z",
    evidencePath: restoreLog,
  },
  restoredStagingHealth: {
    status: "healthy",
    command: "npm run health:prod -- --base=https://restore.playlore.xyz",
    hostType: "restore",
    url: "https://restore.playlore.xyz",
    runtimeHealthPassed: true,
    dataSyncHealthPassed: true,
    finalityLagChecked: true,
    timestamp: "2026-07-09T00:00:00.000Z",
    evidence: `base=https://restore.playlore.xyz runtime=ok dataSync=ok finalityLagBlocks=1 artifact: ${restoreHealthLog}`,
    evidencePath: restoreHealthLog,
  },
  indexerPreservation: {
    heartbeatPreserved: true,
    latestIndexedEpochPreserved: true,
    heartbeatBefore: "abc",
    heartbeatAfter: "abc",
    latestIndexedEpochBefore: "1",
    latestIndexedEpochAfter: "1",
    checkedAt: "2026-07-09T00:00:00.000Z",
    evidencePath: restorePreservationArtifact,
  },
};
writeFileSync(
  restoreIrrelevantScheduleManifest,
  JSON.stringify({
    ...restoreValidStrictManifest,
    backupSchedule: {
      ...restoreValidStrictManifest.backupSchedule,
      evidencePath: restoreIrrelevantScheduleArtifact,
      link: `artifact: ${restoreIrrelevantScheduleArtifact}`,
    },
  }),
  "utf8",
);
writeFileSync(
  restoreIrrelevantPreservationManifest,
  JSON.stringify({
    ...restoreValidStrictManifest,
    indexerPreservation: {
      ...restoreValidStrictManifest.indexerPreservation,
      evidencePath: restoreIrrelevantPreservationArtifact,
    },
  }),
  "utf8",
);
const draftCases = [
  {
    id: "signoff",
    out: join(tmp, "signoff-proof.draft.json"),
    create: ["scripts/create-signoff-proof-draft.mjs"],
    createArgs: [`--env-log=${signoffEnvLog}`, `--chain-log=${signoffChainLog}`],
    check: ["scripts/check-signoff-proof.mjs"],
    checkArgs: (out) => ["--strict", `--file=${out}`],
  },
  {
    id: "host",
    out: join(tmp, "host-proof.draft.json"),
    create: ["scripts/create-host-proof-draft.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--host-type=production", "--load-origin=https://canary.playlore.xyz", "--load-host-type=canary", `--db-path=${hostExternalDbPath}`, "--supervisor=pm2", `--process-evidence=${hostProcessEvidence}`, `--health-log=${hostHealthLog}`, `--load-log=${hostLoadLog}`],
    check: ["scripts/check-host-proof.mjs"],
    checkArgs: (out) => ["--strict", `--file=${out}`],
  },
  {
    id: "indexer",
    out: join(tmp, "indexer-proof.draft.json"),
    create: ["scripts/create-indexer-proof-draft.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=1", "--chain-id=59144", "--deploy-block=1", "--start-block=1", "--finality-blocks=1", `--indexer-log=${indexerLog}`, `--health-log=${indexerHealthLog}`, `--chain-snapshot=${indexerChainSnapshot}`],
    check: ["scripts/check-indexer-dry-run.mjs"],
    checkArgs: (out) => ["--strict", `--manifest=${out}`],
  },
  {
    id: "restore",
    out: join(tmp, "restore-proof.draft.json"),
    create: ["scripts/create-restore-proof-draft.mjs"],
    createArgs: [`--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, "--restored-origin=https://restore.playlore.xyz", "--restored-host-type=restore", `--restore-log=${restoreLog}`, `--health-log=${restoreHealthLog}`, `--backup-schedule-artifact=${restoreBackupScheduleArtifact}`, `--preservation-artifact=${restorePreservationArtifact}`],
    check: ["scripts/verify-db-restore.mjs"],
    checkArgs: (out) => ["--strict", `--manifest=${out}`],
  },
  {
    id: "monitoring",
    out: join(tmp, "monitoring-proof.draft.json"),
    create: ["scripts/create-monitoring-proof-draft.mjs"],
    createArgs: ["--provider=synthetic-monitor", "--error-provider=synthetic-error-tracker", "--origin=https://playlore.xyz", `--monitor-artifact=${monitoringAlertArtifact}`, `--recovery-artifact=${monitoringRecoveryArtifact}`, `--alert-target-artifact=${monitoringAlertTargetArtifact}`, `--error-event-artifact=${monitoringErrorEventArtifact}`],
    check: ["scripts/check-monitoring-proof.mjs"],
    checkArgs: (out) => ["--strict", `--file=${out}`],
  },
  {
    id: "qa",
    out: join(tmp, "qa-proof.draft.json"),
    create: ["scripts/create-qa-proof-draft.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--network=linea-mainnet", "--chain-id=59144", `--wallet-artifact=${qaWalletArtifact}`, `--failure-artifact=${qaFailureArtifact}`, `--support-artifact=${qaSupportArtifact}`, `--finalqa-artifact=${qaFinalArtifact}`, `--smoke-artifact=${qaSmokeArtifact}`, "--clean-wallet-tx=0x1111111111111111111111111111111111111111111111111111111111111111"],
    check: ["scripts/check-qa-proof.mjs"],
    checkArgs: (out) => ["--strict", `--file=${out}`],
  },
  {
    id: "canary",
    out: join(tmp, "canary-proof.draft.json"),
    create: ["scripts/create-canary-proof-draft.mjs"],
    createArgs: ["--network=linea-mainnet", "--chain-id=59144", "--contract=0x1111111111111111111111111111111111111111", "--rpc-label=redacted-mainnet-rpc", `--live-log=${canaryLog}`, `--target-artifact=${canaryTargetArtifact}`, `--recovery-artifact=${canaryRecoveryArtifact}`, `--session-artifact=${canarySessionArtifact}`, `--tx-artifact=${canaryTxArtifact}`],
    check: ["scripts/analyze-live-canary-proof.mjs"],
    checkArgs: (out) => [canaryLog, "--strict", `--manifest=${out}`],
  },
  {
    id: "canary-testnet",
    out: join(tmp, "testnet-canary-proof.draft.json"),
    create: ["scripts/create-canary-proof-draft.mjs"],
    createArgs: ["--profile=testnet", "--network=linea-sepolia", "--chain-id=59141", "--contract=0x1111111111111111111111111111111111111111", "--rpc-label=redacted-sepolia-rpc", `--live-log=${testnetCanaryFullLog}`, `--target-artifact=${canaryTargetArtifact}`, `--recovery-artifact=${canaryRecoveryArtifact}`, `--session-artifact=${canarySessionArtifact}`, `--tx-artifact=${canaryTxArtifact}`],
    check: ["scripts/analyze-live-canary-proof.mjs"],
    checkArgs: (out) => [testnetCanaryFullLog, "--profile=testnet", "--strict", `--manifest=${out}`],
  },
];

const collectorDraftCases = [
  {
    id: "signoff-collector",
    out: join(tmp, "signoff-proof.collector.json"),
    create: ["scripts/collect-signoff-evidence.mjs"],
    createArgs: ["--epochs=1", "--user=0x1111111111111111111111111111111111111111", `--env-log=${signoffEnvLog}`, `--chain-log=${signoffChainLog}`],
    requiredSections: ["contractEnv", "ownership", "randomness", "chainComparison"],
    check: ["scripts/check-signoff-proof.mjs"],
    checkArgs: (out) => ["--strict", `--file=${out}`],
  },
  {
    id: "host-collector",
    out: join(tmp, "host-proof.collector.json"),
    create: ["scripts/collect-host-evidence.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--host-type=production", "--load-origin=https://canary.playlore.xyz", "--load-host-type=canary", `--db-path=${hostExternalDbPath}`, "--supervisor=pm2", `--process-evidence=${hostProcessEvidence}`, `--health-log=${hostHealthLog}`, `--load-log=${hostLoadLog}`],
    requiredSections: ["processModel", "persistentDb", "healthProd", "loadHttp"],
    check: ["scripts/check-host-proof.mjs"],
    checkArgs: (out) => ["--strict", `--file=${out}`],
  },
  {
    id: "indexer-collector",
    out: join(tmp, "indexer-proof.collector.json"),
    create: ["scripts/collect-indexer-evidence.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=1", "--chain-id=59144", "--deploy-block=1", "--finality-blocks=1", `--indexer-log=${indexerLog}`, `--health-log=${indexerHealthLog}`, `--chain-snapshot=${indexerChainSnapshot}`],
    requiredSections: ["dryRun", "finality", "chainSnapshot", "chainComparison"],
    check: ["scripts/check-indexer-dry-run.mjs"],
    checkArgs: (out) => ["--strict", `--manifest=${out}`],
  },
  {
    id: "restore-collector",
    out: join(tmp, "restore-proof.collector.json"),
    create: ["scripts/collect-restore-evidence.mjs"],
    createArgs: [
      `--source=${restoreSourcePath}`,
      `--backup-dir=${restoreBackupDir}`,
      `--restore-dir=${restoreDir}`,
      `--backup=${restoreBackupPath}`,
      "--restored-origin=https://restore.playlore.xyz",
      "--restored-host-type=restore",
      `--restore-log=${restoreLog}`,
      `--health-log=${restoreHealthLog}`,
      `--backup-schedule-artifact=${restoreBackupScheduleArtifact}`,
      `--preservation-artifact=${restorePreservationArtifact}`,
    ],
    requiredSections: ["backupSchedule", "restoreDrill", "restoredStagingHealth", "indexerPreservation"],
    check: ["scripts/verify-db-restore.mjs"],
    checkArgs: (out) => ["--strict", `--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, `--manifest=${out}`],
  },
];
const collectorRejectCases = [
  {
    id: "signoff-collector-missing-env-log",
    create: ["scripts/collect-signoff-evidence.mjs"],
    createArgs: ["--epochs=1", "--user=0x1111111111111111111111111111111111111111", `--chain-log=${signoffChainLog}`],
    expected: "--env-log is required when collecting signoff launch evidence",
  },
  {
    id: "signoff-collector-missing-chain-log",
    create: ["scripts/collect-signoff-evidence.mjs"],
    createArgs: ["--epochs=1", "--user=0x1111111111111111111111111111111111111111", `--env-log=${signoffEnvLog}`],
    expected: "--chain-log is required when collecting signoff launch evidence",
  },
  {
    id: "signoff-collector-failed-env-log",
    create: ["scripts/collect-signoff-evidence.mjs"],
    createArgs: ["--epochs=1", "--user=0x1111111111111111111111111111111111111111", `--env-log=${signoffFailedEnvLog}`, `--chain-log=${signoffChainLog}`],
    expected: "--env-log must contain successful proof:mainnet summary",
  },
  {
    id: "host-collector-missing-logs",
    create: ["scripts/collect-host-evidence.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--host-type=production", "--load-origin=https://canary.playlore.xyz", "--load-host-type=canary", `--db-path=${hostExternalDbPath}`, "--supervisor=pm2", `--process-evidence=${hostProcessEvidence}`],
    expected: "--health-log is required when collecting launch host evidence",
  },
  {
    id: "host-collector-missing-load-log",
    create: ["scripts/collect-host-evidence.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--host-type=production", "--load-origin=https://canary.playlore.xyz", "--load-host-type=canary", `--db-path=${hostExternalDbPath}`, "--supervisor=pm2", `--process-evidence=${hostProcessEvidence}`, `--health-log=${hostHealthLog}`],
    expected: "--load-log is required when collecting launch host evidence",
  },
  {
    id: "host-collector-missing-process-evidence",
    create: ["scripts/collect-host-evidence.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--host-type=production", "--load-origin=https://canary.playlore.xyz", "--load-host-type=canary", `--db-path=${hostExternalDbPath}`, "--supervisor=pm2", `--health-log=${hostHealthLog}`, `--load-log=${hostLoadLog}`],
    expected: "--process-evidence is required when collecting launch host evidence",
  },
  {
    id: "host-collector-repo-db",
    create: ["scripts/collect-host-evidence.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--host-type=production", "--load-origin=https://canary.playlore.xyz", "--load-host-type=canary", `--db-path=${join(process.cwd(), "repo-host.sqlite")}`, "--supervisor=pm2", `--process-evidence=${hostProcessEvidence}`, `--health-log=${hostHealthLog}`, `--load-log=${hostLoadLog}`],
    expected: "--db-path/LORE_DB_PATH must be an absolute path outside the repo checkout",
  },
  {
    id: "host-collector-missing-health-base",
    create: ["scripts/collect-host-evidence.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--host-type=production", "--load-origin=https://canary.playlore.xyz", "--load-host-type=canary", `--db-path=${hostExternalDbPath}`, "--supervisor=pm2", `--process-evidence=${hostProcessEvidence}`, `--health-log=${hostHealthMissingBaseLog}`, `--load-log=${hostLoadLog}`],
    expected: "--health-log must include base=<production origin>",
  },
  {
    id: "host-collector-missing-load-base",
    create: ["scripts/collect-host-evidence.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--host-type=production", "--load-origin=https://canary.playlore.xyz", "--load-host-type=canary", `--db-path=${hostExternalDbPath}`, "--supervisor=pm2", `--process-evidence=${hostProcessEvidence}`, `--health-log=${hostHealthLog}`, `--load-log=${hostLoadMissingBaseLog}`],
    expected: "--load-log must include Load base URL line",
  },
  {
    id: "indexer-collector-missing-indexer-log",
    create: ["scripts/collect-indexer-evidence.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=1", "--chain-id=59144", "--deploy-block=1", "--finality-blocks=1", `--health-log=${indexerHealthLog}`, `--chain-snapshot=${indexerChainSnapshot}`],
    expected: "--indexer-log is required when collecting indexer launch evidence",
  },
  {
    id: "indexer-collector-missing-health-log",
    create: ["scripts/collect-indexer-evidence.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=1", "--chain-id=59144", "--deploy-block=1", "--finality-blocks=1", `--indexer-log=${indexerLog}`, `--chain-snapshot=${indexerChainSnapshot}`],
    expected: "--health-log is required when collecting indexer launch evidence",
  },
  {
    id: "indexer-collector-missing-health-base",
    create: ["scripts/collect-indexer-evidence.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=1", "--chain-id=59144", "--deploy-block=1", "--finality-blocks=1", `--indexer-log=${indexerLog}`, `--health-log=${indexerHealthMissingBaseLog}`, `--chain-snapshot=${indexerChainSnapshot}`],
    expected: "--health-log must include base=<production origin>",
  },
  {
    id: "indexer-collector-missing-chain-snapshot",
    create: ["scripts/collect-indexer-evidence.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=1", "--chain-id=59144", "--deploy-block=1", "--finality-blocks=1", `--indexer-log=${indexerLog}`, `--health-log=${indexerHealthLog}`],
    expected: "--chain-snapshot is required when collecting indexer launch evidence",
  },
  {
    id: "indexer-collector-repo-db",
    create: ["scripts/collect-indexer-evidence.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=1", "--chain-id=59144", "--deploy-block=1", "--finality-blocks=1", `--indexer-log=${indexerRepoDbLog}`, `--health-log=${indexerHealthLog}`, `--chain-snapshot=${indexerChainSnapshot}`],
    expected: "--indexer-log [indexer] SQLite path must be outside the repo checkout",
  },
  {
    id: "indexer-collector-missing-snapshot-generated-at",
    create: ["scripts/collect-indexer-evidence.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=1", "--chain-id=59144", "--deploy-block=1", "--finality-blocks=1", `--indexer-log=${indexerLog}`, `--health-log=${indexerHealthLog}`, `--chain-snapshot=${indexerChainSnapshotMissingGeneratedAt}`],
    expected: "--chain-snapshot must include generatedAt as ISO-8601 UTC",
  },
  {
    id: "indexer-collector-too-few-snapshot-epochs",
    create: ["scripts/collect-indexer-evidence.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=2", "--chain-id=59144", "--deploy-block=1", "--finality-blocks=1", `--indexer-log=${indexerLog}`, `--health-log=${indexerHealthLog}`, `--chain-snapshot=${indexerChainSnapshotTooFewEpochs}`],
    expected: "--chain-snapshot epochs must include at least --epochs unique checked epochs",
  },
  {
    id: "indexer-collector-non-object-chain-snapshot",
    create: ["scripts/collect-indexer-evidence.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=1", "--chain-id=59144", "--deploy-block=1", "--finality-blocks=1", `--indexer-log=${indexerLog}`, `--health-log=${indexerHealthLog}`, `--chain-snapshot=${indexerChainSnapshotNonObject}`],
    expected: "must be a JSON object artifact",
  },  {
    id: "restore-collector-missing-runtime",
    create: ["scripts/collect-restore-evidence.mjs"],
    createArgs: [`--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, "--restored-origin=https://restore.playlore.xyz", "--restored-host-type=restore", `--restore-log=${restoreLog}`, `--health-log=${restoreHealthMissingRuntimeLog}`, `--backup-schedule-artifact=${restoreBackupScheduleArtifact}`, `--preservation-artifact=${restorePreservationArtifact}`],
    expected: "--health-log must include runtime=ok\/pass\/healthy",
  },
  {
    id: "restore-collector-missing-restore-log",
    create: ["scripts/collect-restore-evidence.mjs"],
    createArgs: [`--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, "--restored-origin=https://restore.playlore.xyz", "--restored-host-type=restore", `--health-log=${restoreHealthLog}`, `--backup-schedule-artifact=${restoreBackupScheduleArtifact}`, `--preservation-artifact=${restorePreservationArtifact}`],
    expected: "--restore-log is required when collecting restore launch evidence",
  },
  {
    id: "restore-collector-missing-health-log",
    create: ["scripts/collect-restore-evidence.mjs"],
    createArgs: [`--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, "--restored-origin=https://restore.playlore.xyz", "--restored-host-type=restore", `--restore-log=${restoreLog}`, `--backup-schedule-artifact=${restoreBackupScheduleArtifact}`, `--preservation-artifact=${restorePreservationArtifact}`],
    expected: "--health-log is required when collecting restore launch evidence",
  },
  {
    id: "restore-collector-missing-backup-schedule-artifact",
    create: ["scripts/collect-restore-evidence.mjs"],
    createArgs: [`--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, "--restored-origin=https://restore.playlore.xyz", "--restored-host-type=restore", `--restore-log=${restoreLog}`, `--health-log=${restoreHealthLog}`, `--preservation-artifact=${restorePreservationArtifact}`],
    expected: "--backup-schedule-artifact is required when collecting restore launch evidence",
  },
  {
    id: "restore-collector-missing-preservation-artifact",
    create: ["scripts/collect-restore-evidence.mjs"],
    createArgs: [`--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, "--restored-origin=https://restore.playlore.xyz", "--restored-host-type=restore", `--restore-log=${restoreLog}`, `--health-log=${restoreHealthLog}`, `--backup-schedule-artifact=${restoreBackupScheduleArtifact}`],
    expected: "--preservation-artifact is required when collecting restore launch evidence",
  },
  {
    id: "restore-collector-directory-backup-schedule-artifact",
    create: ["scripts/collect-restore-evidence.mjs"],
    createArgs: [`--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, "--restored-origin=https://restore.playlore.xyz", "--restored-host-type=restore", `--restore-log=${restoreLog}`, `--health-log=${restoreHealthLog}`, `--backup-schedule-artifact=${restoreDirectoryArtifact}`, `--preservation-artifact=${restorePreservationArtifact}`],
    expected: "must point to an existing redacted file artifact",
  },  {
    id: "canary-draft-missing-live-log",
    create: ["scripts/create-canary-proof-draft.mjs"],
    createArgs: ["--network=linea-mainnet", "--chain-id=59144", "--contract=0x1111111111111111111111111111111111111111", "--rpc-label=redacted-mainnet-rpc", `--target-artifact=${canaryTargetArtifact}`, `--recovery-artifact=${canaryRecoveryArtifact}`, `--session-artifact=${canarySessionArtifact}`, `--tx-artifact=${canaryTxArtifact}`],
    expected: "--live-log is required when drafting canary launch evidence",
  },
  {
    id: "canary-draft-missing-target-artifact",
    create: ["scripts/create-canary-proof-draft.mjs"],
    createArgs: ["--network=linea-mainnet", "--chain-id=59144", "--contract=0x1111111111111111111111111111111111111111", "--rpc-label=redacted-mainnet-rpc", `--live-log=${canaryLog}`, `--recovery-artifact=${canaryRecoveryArtifact}`, `--session-artifact=${canarySessionArtifact}`, `--tx-artifact=${canaryTxArtifact}`],
    expected: "--target-artifact is required when drafting canary launch evidence",
  },
  {
    id: "canary-draft-missing-recovery-artifact",
    create: ["scripts/create-canary-proof-draft.mjs"],
    createArgs: ["--network=linea-mainnet", "--chain-id=59144", "--contract=0x1111111111111111111111111111111111111111", "--rpc-label=redacted-mainnet-rpc", `--live-log=${canaryLog}`, `--target-artifact=${canaryTargetArtifact}`, `--session-artifact=${canarySessionArtifact}`, `--tx-artifact=${canaryTxArtifact}`],
    expected: "--recovery-artifact is required when drafting canary launch evidence",
  },
  {
    id: "canary-draft-missing-session-artifact",
    create: ["scripts/create-canary-proof-draft.mjs"],
    createArgs: ["--network=linea-mainnet", "--chain-id=59144", "--contract=0x1111111111111111111111111111111111111111", "--rpc-label=redacted-mainnet-rpc", `--live-log=${canaryLog}`, `--target-artifact=${canaryTargetArtifact}`, `--recovery-artifact=${canaryRecoveryArtifact}`, `--tx-artifact=${canaryTxArtifact}`],
    expected: "--session-artifact is required when drafting canary launch evidence",
  },
  {
    id: "canary-draft-missing-tx-artifact",
    create: ["scripts/create-canary-proof-draft.mjs"],
    createArgs: ["--network=linea-mainnet", "--chain-id=59144", "--contract=0x1111111111111111111111111111111111111111", "--rpc-label=redacted-mainnet-rpc", `--live-log=${canaryLog}`, `--target-artifact=${canaryTargetArtifact}`, `--recovery-artifact=${canaryRecoveryArtifact}`, `--session-artifact=${canarySessionArtifact}`],
    expected: "--tx-artifact is required when drafting canary launch evidence",
  },
  {
    id: "canary-draft-empty-live-log",
    create: ["scripts/create-canary-proof-draft.mjs"],
    createArgs: ["--network=linea-mainnet", "--chain-id=59144", "--contract=0x1111111111111111111111111111111111111111", "--rpc-label=redacted-mainnet-rpc", `--live-log=${emptyCanaryLog}`, `--target-artifact=${canaryTargetArtifact}`, `--recovery-artifact=${canaryRecoveryArtifact}`, `--session-artifact=${canarySessionArtifact}`, `--tx-artifact=${canaryTxArtifact}`],
    expected: "--live-log must include at least one successful auto-miner canary tx",
  },
  {
    id: "canary-draft-malformed-live-log",
    create: ["scripts/create-canary-proof-draft.mjs"],
    createArgs: ["--network=linea-mainnet", "--chain-id=59144", "--contract=0x1111111111111111111111111111111111111111", "--rpc-label=redacted-mainnet-rpc", `--live-log=${canaryMalformedLiveLog}`, `--target-artifact=${canaryTargetArtifact}`, `--recovery-artifact=${canaryRecoveryArtifact}`, `--session-artifact=${canarySessionArtifact}`, `--tx-artifact=${canaryTxArtifact}`],
    expected: "Invalid JSONL at",
  },
  {
    id: "canary-draft-non-object-live-log",
    create: ["scripts/create-canary-proof-draft.mjs"],
    createArgs: ["--network=linea-mainnet", "--chain-id=59144", "--contract=0x1111111111111111111111111111111111111111", "--rpc-label=redacted-mainnet-rpc", `--live-log=${canaryNonObjectLiveLog}`, `--target-artifact=${canaryTargetArtifact}`, `--recovery-artifact=${canaryRecoveryArtifact}`, `--session-artifact=${canarySessionArtifact}`, `--tx-artifact=${canaryTxArtifact}`],
    expected: "record must be an object",
  },
];

const strictRejectCases = [
  {
    id: "signoff-missing-local-artifact-ref",
    check: ["scripts/check-signoff-proof.mjs"],
    checkArgs: ["--strict", `--file=${signoffMissingArtifactManifest}`],
    env: signoffEnvPatch,
    expected: "local signoff artifact references must exist",
  },
  {
    id: "signoff-irrelevant-env-artifact",
    check: ["scripts/check-signoff-proof.mjs"],
    checkArgs: ["--strict", `--file=${signoffIrrelevantEnvManifest}`],
    env: signoffEnvPatch,
    expected: "contractEnv evidence must mention proof:mainnet, env, contract, deploy, or chainId proof",
  },
  {
    id: "signoff-irrelevant-owner-artifact",
    check: ["scripts/check-signoff-proof.mjs"],
    checkArgs: ["--strict", `--file=${signoffIrrelevantOwnerManifest}`],
    env: signoffEnvPatch,
    expected: "ownership.directOwnerReadEvidence evidence must mention owner, Safe/multisig, governance, or direct-chain proof",
  },
  {
    id: "signoff-irrelevant-randomness-artifact",
    check: ["scripts/check-signoff-proof.mjs"],
    checkArgs: ["--strict", `--file=${signoffIrrelevantRandomnessManifest}`],
    env: signoffEnvPatch,
    expected: "randomness evidence must mention randomness decision or operator sign-off proof",
  },
  {
    id: "signoff-irrelevant-chain-artifact",
    check: ["scripts/check-signoff-proof.mjs"],
    checkArgs: ["--strict", `--file=${signoffIrrelevantChainManifest}`],
    env: signoffEnvPatch,
    expected: "chainComparison.jackpot evidence must mention jackpot, direct-chain, app, or indexer proof",
  },
  {
    id: "host-missing-local-artifact-ref",
    check: ["scripts/check-host-proof.mjs"],
    checkArgs: ["--strict", `--file=${hostMissingArtifactManifest}`],
    expected: "local host artifact references must exist",
  },
  {
    id: "host-irrelevant-process-evidence",
    check: ["scripts/check-host-proof.mjs"],
    checkArgs: ["--strict", `--file=${hostIrrelevantProcessManifest}`],
    expected: "processModel.lore-site evidence must mention lore-site in supervisor output",
  },
  {
    id: "host-irrelevant-persistent-artifact",
    check: ["scripts/check-host-proof.mjs"],
    checkArgs: ["--strict", `--file=${hostIrrelevantPersistentManifest}`],
    expected: "persistentDb evidence artifact must mention persistence, restart/reboot, or DB path proof",
  },
  {
    id: "host-irrelevant-health-artifact",
    check: ["scripts/check-host-proof.mjs"],
    checkArgs: ["--strict", `--file=${hostIrrelevantHealthManifest}`],
    expected: "healthProd evidence artifact must include [prod-health] OK, base, and numeric finalityLagBlocks",
  },
  {
    id: "host-irrelevant-load-artifact",
    check: ["scripts/check-host-proof.mjs"],
    checkArgs: ["--strict", `--file=${hostIrrelevantLoadManifest}`],
    expected: "loadHttp evidence artifact must include Load base URL, TOTAL, and p95 output",
  },
  {
    id: "indexer-missing-local-artifact-ref",
    check: ["scripts/check-indexer-dry-run.mjs"],
    checkArgs: ["--strict", `--db=${hostExternalDbPath}`, `--manifest=${indexerMissingArtifactManifest}`],
    env: { INDEXER_START_BLOCK: "1", NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1", INDEXER_FINALITY_BLOCKS: "1" },
    expected: "local indexer artifact references must exist",
  },
  {
    id: "indexer-irrelevant-dry-run-artifact",
    check: ["scripts/check-indexer-dry-run.mjs"],
    checkArgs: ["--strict", `--db=${hostExternalDbPath}`, `--manifest=${indexerIrrelevantDryRunManifest}`],
    env: { INDEXER_START_BLOCK: "1", NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1", INDEXER_FINALITY_BLOCKS: "1" },
    expected: "dryRun evidence artifact must include [indexer] Deploy block and [indexer] Start block",
  },
  {
    id: "indexer-irrelevant-finality-artifact",
    check: ["scripts/check-indexer-dry-run.mjs"],
    checkArgs: ["--strict", `--db=${hostExternalDbPath}`, `--manifest=${indexerIrrelevantFinalityManifest}`],
    env: { INDEXER_START_BLOCK: "1", NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1", INDEXER_FINALITY_BLOCKS: "1" },
    expected: "finality evidence artifact must include health:prod base and numeric finalityLagBlocks",
  },
  {
    id: "indexer-irrelevant-snapshot-artifact",
    check: ["scripts/check-indexer-dry-run.mjs"],
    checkArgs: ["--strict", `--db=${hostExternalDbPath}`, `--manifest=${indexerIrrelevantSnapshotManifest}`],
    env: { INDEXER_START_BLOCK: "1", NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1", INDEXER_FINALITY_BLOCKS: "1" },
    expected: "chainSnapshot.path artifact must include generatedAt, rpcChainId, and contractAddress",
  },
  {
    id: "indexer-irrelevant-comparison-artifact",
    check: ["scripts/check-indexer-dry-run.mjs"],
    checkArgs: ["--strict", `--db=${hostExternalDbPath}`, `--manifest=${indexerIrrelevantComparisonManifest}`],
    env: { INDEXER_START_BLOCK: "1", NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK: "1", INDEXER_FINALITY_BLOCKS: "1" },
    expected: "chainComparison.jackpot evidence artifact must mention jackpot, direct-chain, chain comparison, or indexer proof",
  },
  {
    id: "restore-missing-local-artifact-ref",
    check: ["scripts/verify-db-restore.mjs"],
    checkArgs: ["--strict", `--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, `--manifest=${restoreMissingArtifactManifest}`],
    expected: "local restore artifact references must exist",
  },
  {
    id: "restore-irrelevant-backup-schedule-artifact",
    check: ["scripts/verify-db-restore.mjs"],
    checkArgs: ["--strict", `--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, `--manifest=${restoreIrrelevantScheduleManifest}`],
    expected: "backupSchedule evidence must mention recurring scheduler/backup proof",
  },
  {
    id: "restore-irrelevant-preservation-artifact",
    check: ["scripts/verify-db-restore.mjs"],
    checkArgs: ["--strict", `--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, `--manifest=${restoreIrrelevantPreservationManifest}`],
    expected: "indexerPreservation evidence must mention heartbeat and latest indexed epoch before/after restore",
  },
  {
    id: "monitoring-missing-local-artifact-ref",
    check: ["scripts/check-monitoring-proof.mjs"],
    checkArgs: ["--strict", `--file=${monitoringMissingArtifactManifest}`],
    expected: "local monitoring artifact references must exist",
  },
  {
    id: "monitoring-irrelevant-alert-artifact",
    check: ["scripts/check-monitoring-proof.mjs"],
    checkArgs: ["--strict", `--file=${monitoringIrrelevantAlertManifest}`],
    expected: "fired-alert evidence must mention alert, monitor, fired, triggered, or incident proof",
  },
  {
    id: "monitoring-irrelevant-recovery-artifact",
    check: ["scripts/check-monitoring-proof.mjs"],
    checkArgs: ["--strict", `--file=${monitoringIrrelevantRecoveryManifest}`],
    expected: "recovery evidence must mention recovery, recovered, resolved, or resolution proof",
  },
  {
    id: "monitoring-irrelevant-alert-target-artifact",
    check: ["scripts/check-monitoring-proof.mjs"],
    checkArgs: ["--strict", `--file=${monitoringIrrelevantTargetManifest}`],
    expected: "alertTargets[0] evidence must mention alert target or notification channel proof",
  },
  {
    id: "monitoring-irrelevant-error-event-artifact",
    check: ["scripts/check-monitoring-proof.mjs"],
    checkArgs: ["--strict", `--file=${monitoringIrrelevantErrorManifest}`],
    expected: "error tracking test event evidence must mention error, exception, event, issue, or provider proof",
  },
  {
    id: "qa-missing-local-artifact-ref",
    check: ["scripts/check-qa-proof.mjs"],
    checkArgs: ["--strict", `--file=${qaMissingArtifactManifest}`],
    expected: "local QA artifact references must exist",
  },
  {
    id: "qa-irrelevant-wallet-artifact",
    check: ["scripts/check-qa-proof.mjs"],
    checkArgs: ["--strict", `--file=${qaIrrelevantWalletManifest}`],
    expected: "wallet.privyAllowedOrigins evidence must mention wallet/Privy/connect/mobile/wrong-network proof",
  },
  {
    id: "qa-irrelevant-failure-artifact",
    check: ["scripts/check-qa-proof.mjs"],
    checkArgs: ["--strict", `--file=${qaIrrelevantFailureManifest}`],
    expected: "failureStateUx.disabledActionsExplainReason evidence must mention failure-state/pending/degraded/no-op UX proof",
  },
  {
    id: "qa-irrelevant-support-artifact",
    check: ["scripts/check-qa-proof.mjs"],
    checkArgs: ["--strict", `--file=${qaIrrelevantSupportManifest}`],
    expected: "supportAuditVisibility.betHistoryFields evidence must mention support/audit/diagnostics visibility proof",
  },
  {
    id: "qa-irrelevant-final-artifact",
    check: ["scripts/check-qa-proof.mjs"],
    checkArgs: ["--strict", `--file=${qaIrrelevantFinalManifest}`],
    expected: "finalQa.mobileLayout evidence must mention final browser/mobile/mainnet wording QA proof",
  },
  {
    id: "qa-irrelevant-smoke-artifact",
    check: ["scripts/check-qa-proof.mjs"],
    checkArgs: ["--strict", `--file=${qaIrrelevantSmokeManifest}`],
    expected: "finalQa.browserSmokeDebugAutominer evidence must mention debug autominer browser smoke proof",
  },  {
    id: "canary-irrelevant-target-artifact",
    check: ["scripts/analyze-live-canary-proof.mjs"],
    checkArgs: [canaryFullLog, "--strict", `--manifest=${canaryIrrelevantTargetManifest}`],
    expected: "targetNetwork evidence must mention target RPC, chain, or Linea mainnet launch proof",
  },
  {
    id: "canary-irrelevant-recovery-artifact",
    check: ["scripts/analyze-live-canary-proof.mjs"],
    checkArgs: [canaryFullLog, "--strict", `--manifest=${canaryIrrelevantRecoveryManifest}`],
    expected: "recovery.reload evidence must mention reload, reconnect, tab-close, pending-tx, remount, or recovery proof",
  },
  {
    id: "canary-irrelevant-session-artifact",
    check: ["scripts/analyze-live-canary-proof.mjs"],
    checkArgs: [canaryFullLog, "--strict", `--manifest=${canaryIrrelevantSessionManifest}`],
    expected: "autoMinerSession evidence must mention auto-miner session, rounds, epochs, or target RPC proof",
  },
  {
    id: "canary-irrelevant-transaction-artifact",
    check: ["scripts/analyze-live-canary-proof.mjs"],
    checkArgs: [canaryFullLog, "--strict", `--manifest=${canaryIrrelevantTxManifest}`],
    expected: "transactionHealth evidence must mention transaction, tx, nonce, duplicate, stuck pending, or pending recovery proof",
  },
  {
    id: "canary-missing-local-artifact-ref",
    check: ["scripts/analyze-live-canary-proof.mjs"],
    checkArgs: [canaryFullLog, "--strict", `--manifest=${canaryMissingArtifactManifest}`],
    expected: "local canary artifact references must exist",
  },
  {
    id: "canary-live-log-template-value",
    check: ["scripts/analyze-live-canary-proof.mjs"],
    checkArgs: [canaryTemplateLiveLog, "--strict", `--manifest=${canaryValidStrictManifestPath}`],
    expected: "live canary log contains template-like values",
  },
  {
    id: "canary-live-log-secret-value",
    check: ["scripts/analyze-live-canary-proof.mjs"],
    checkArgs: [canarySecretLiveLog, "--strict", `--manifest=${canaryValidStrictManifestPath}`],
    expected: "live canary log contains secret-like values",
  },
  {
    id: "canary-live-log-malformed-jsonl",
    check: ["scripts/analyze-live-canary-proof.mjs"],
    checkArgs: [canaryMalformedLiveLog, "--strict", `--manifest=${canaryValidStrictManifestPath}`],
    expected: "Invalid JSONL at",
  },
  {
    id: "canary-live-log-non-object-jsonl",
    check: ["scripts/analyze-live-canary-proof.mjs"],
    checkArgs: [canaryNonObjectLiveLog, "--strict", `--manifest=${canaryValidStrictManifestPath}`],
    expected: "record must be an object",
  },
];

const finalOutputCases = [
  {
    id: "signoff-draft-missing-env-log",
    create: ["scripts/create-signoff-proof-draft.mjs"],
    createArgs: [`--chain-log=${signoffChainLog}`],
    expected: "--env-log is required when drafting signoff launch evidence",
  },
  {
    id: "signoff-draft-failed-env-log",
    create: ["scripts/create-signoff-proof-draft.mjs"],
    createArgs: [`--env-log=${signoffFailedEnvLog}`, `--chain-log=${signoffChainLog}`],
    expected: "--env-log must contain successful proof:mainnet summary",
  },
  {
    id: "signoff-final-output",
    create: ["scripts/create-signoff-proof-draft.mjs"],
    createArgs: ["--out=docs/signoff-proof.json"],
    expected: "writes incomplete drafts only",
  },
  {
    id: "host-draft-missing-health-log",
    create: ["scripts/create-host-proof-draft.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--host-type=production", "--load-origin=https://canary.playlore.xyz", "--load-host-type=canary", `--db-path=${hostExternalDbPath}`, "--supervisor=pm2", `--process-evidence=${hostProcessEvidence}`, `--load-log=${hostLoadLog}`],
    expected: "--health-log is required when drafting host launch evidence",
  },
  {
    id: "host-draft-missing-health-base",
    create: ["scripts/create-host-proof-draft.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--host-type=production", "--load-origin=https://canary.playlore.xyz", "--load-host-type=canary", `--db-path=${hostExternalDbPath}`, "--supervisor=pm2", `--process-evidence=${hostProcessEvidence}`, `--health-log=${hostHealthMissingBaseLog}`, `--load-log=${hostLoadLog}`],
    expected: "--health-log must include base=<production origin>",
  },
  {
    id: "host-draft-missing-load-base",
    create: ["scripts/create-host-proof-draft.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--host-type=production", "--load-origin=https://canary.playlore.xyz", "--load-host-type=canary", `--db-path=${hostExternalDbPath}`, "--supervisor=pm2", `--process-evidence=${hostProcessEvidence}`, `--health-log=${hostHealthLog}`, `--load-log=${hostLoadMissingBaseLog}`],
    expected: "--load-log must include Load base URL line",
  },
  {
    id: "host-final-output",
    create: ["scripts/create-host-proof-draft.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--load-origin=https://canary.playlore.xyz", "--load-host-type=canary", "--out=docs/host-proof.json"],
    expected: "writes incomplete drafts only",
  },
  {
    id: "indexer-draft-missing-indexer-log",
    create: ["scripts/create-indexer-proof-draft.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=1", "--chain-id=59144", "--deploy-block=1", "--start-block=1", "--finality-blocks=1", `--health-log=${indexerHealthLog}`, `--chain-snapshot=${indexerChainSnapshot}`],
    expected: "--indexer-log is required when drafting indexer launch evidence",
  },
  {
    id: "indexer-draft-repo-db",
    create: ["scripts/create-indexer-proof-draft.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=1", "--chain-id=59144", "--deploy-block=1", "--start-block=1", "--finality-blocks=1", `--indexer-log=${indexerRepoDbLog}`, `--health-log=${indexerHealthLog}`, `--chain-snapshot=${indexerChainSnapshot}`],
    expected: "--indexer-log [indexer] SQLite path must be outside the repo checkout",
  },
  {
    id: "indexer-draft-missing-health-base",
    create: ["scripts/create-indexer-proof-draft.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=1", "--chain-id=59144", "--deploy-block=1", "--finality-blocks=1", `--indexer-log=${indexerLog}`, `--health-log=${indexerHealthMissingBaseLog}`, `--chain-snapshot=${indexerChainSnapshot}`],
    expected: "--health-log must include base=<production origin>",
  },
  {
    id: "indexer-draft-missing-snapshot-generated-at",
    create: ["scripts/create-indexer-proof-draft.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=1", "--chain-id=59144", "--deploy-block=1", "--start-block=1", "--finality-blocks=1", `--indexer-log=${indexerLog}`, `--health-log=${indexerHealthLog}`, `--chain-snapshot=${indexerChainSnapshotMissingGeneratedAt}`],
    expected: "--chain-snapshot must include generatedAt as ISO-8601 UTC",
  },
  {
    id: "indexer-draft-too-few-snapshot-epochs",
    create: ["scripts/create-indexer-proof-draft.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=2", "--chain-id=59144", "--deploy-block=1", "--start-block=1", "--finality-blocks=1", `--indexer-log=${indexerLog}`, `--health-log=${indexerHealthLog}`, `--chain-snapshot=${indexerChainSnapshotTooFewEpochs}`],
    expected: "--chain-snapshot epochs must include at least --epochs unique checked epochs",
  },
  {
    id: "indexer-draft-non-object-chain-snapshot",
    create: ["scripts/create-indexer-proof-draft.mjs"],
    createArgs: ["--fresh-db=true", "--epochs=1", "--chain-id=59144", "--deploy-block=1", "--start-block=1", "--finality-blocks=1", `--indexer-log=${indexerLog}`, `--health-log=${indexerHealthLog}`, `--chain-snapshot=${indexerChainSnapshotNonObject}`],
    expected: "must be a JSON object artifact",
  },  {
    id: "indexer-final-output",
    create: ["scripts/create-indexer-proof-draft.mjs"],
    createArgs: ["--out=docs/indexer-proof.json"],
    expected: "writes incomplete drafts only",
  },
  {
    id: "restore-draft-missing-restore-log",
    create: ["scripts/create-restore-proof-draft.mjs"],
    createArgs: [`--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, "--restored-origin=https://restore.playlore.xyz", "--restored-host-type=restore", `--health-log=${restoreHealthLog}`, `--backup-schedule-artifact=${restoreBackupScheduleArtifact}`, `--preservation-artifact=${restorePreservationArtifact}`],
    expected: "--restore-log is required when drafting restore launch evidence",
  },
  {
    id: "restore-draft-missing-backup",
    create: ["scripts/create-restore-proof-draft.mjs"],
    createArgs: [`--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, "--restored-origin=https://restore.playlore.xyz", "--restored-host-type=restore", `--restore-log=${restoreLog}`, `--health-log=${restoreHealthLog}`, `--backup-schedule-artifact=${restoreBackupScheduleArtifact}`, `--preservation-artifact=${restorePreservationArtifact}`],
    expected: "--backup is required when drafting restore launch evidence",
  },
  {
    id: "restore-draft-failed-restore-log",
    create: ["scripts/create-restore-proof-draft.mjs"],
    createArgs: [`--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, "--restored-origin=https://restore.playlore.xyz", "--restored-host-type=restore", `--restore-log=${signoffChainLog}`, `--health-log=${restoreHealthLog}`, `--backup-schedule-artifact=${restoreBackupScheduleArtifact}`, `--preservation-artifact=${restorePreservationArtifact}`],
    expected: "--restore-log must include successful restore drill summary",
  },
  {
    id: "restore-draft-missing-runtime",
    create: ["scripts/create-restore-proof-draft.mjs"],
    createArgs: [`--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, "--restored-origin=https://restore.playlore.xyz", "--restored-host-type=restore", `--restore-log=${restoreLog}`, `--health-log=${restoreHealthMissingRuntimeLog}`, `--backup-schedule-artifact=${restoreBackupScheduleArtifact}`, `--preservation-artifact=${restorePreservationArtifact}`],
    expected: "--health-log must include runtime=ok/pass/healthy",
  },
  {
    id: "restore-draft-missing-backup-schedule-artifact",
    create: ["scripts/create-restore-proof-draft.mjs"],
    createArgs: [`--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, "--restored-origin=https://restore.playlore.xyz", "--restored-host-type=restore", `--restore-log=${restoreLog}`, `--health-log=${restoreHealthLog}`, `--preservation-artifact=${restorePreservationArtifact}`],
    expected: "--backup-schedule-artifact is required when drafting restore launch evidence",
  },
  {
    id: "restore-draft-missing-preservation-artifact",
    create: ["scripts/create-restore-proof-draft.mjs"],
    createArgs: [`--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, "--restored-origin=https://restore.playlore.xyz", "--restored-host-type=restore", `--restore-log=${restoreLog}`, `--health-log=${restoreHealthLog}`, `--backup-schedule-artifact=${restoreBackupScheduleArtifact}`],
    expected: "--preservation-artifact is required when drafting restore launch evidence",
  },
  {
    id: "restore-draft-directory-backup-schedule-artifact",
    create: ["scripts/create-restore-proof-draft.mjs"],
    createArgs: [`--source=${restoreSourcePath}`, `--backup-dir=${restoreBackupDir}`, `--restore-dir=${restoreDir}`, `--backup=${restoreBackupPath}`, "--restored-origin=https://restore.playlore.xyz", "--restored-host-type=restore", `--restore-log=${restoreLog}`, `--health-log=${restoreHealthLog}`, `--backup-schedule-artifact=${restoreDirectoryArtifact}`, `--preservation-artifact=${restorePreservationArtifact}`],
    expected: "must point to an existing redacted file artifact",
  },  {
    id: "restore-final-output",
    create: ["scripts/create-restore-proof-draft.mjs"],
    createArgs: ["--out=docs/restore-proof.json"],
    expected: "writes incomplete drafts only",
  },
  {
    id: "qa-final-output",
    create: ["scripts/create-qa-proof-draft.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--network=linea-mainnet", "--chain-id=59144", "--out=docs/qa-proof.json"],
    expected: "writes incomplete drafts only",
  },
  {
    id: "canary-final-output",
    create: ["scripts/create-canary-proof-draft.mjs"],
    createArgs: ["--network=linea-mainnet", "--chain-id=59144", "--contract=0x1111111111111111111111111111111111111111", "--rpc-label=redacted-mainnet-rpc", "--out=docs/canary-proof.json"],
    expected: "writes incomplete drafts only",
  },
  {
    id: "canary-testnet-final-output",
    create: ["scripts/create-canary-proof-draft.mjs"],
    createArgs: ["--profile=testnet", "--network=linea-sepolia", "--chain-id=59141", "--out=docs/testnet-canary-proof.json"],
    expected: "writes incomplete drafts only",
  },
  {
    id: "qa-missing-wallet-artifact",
    create: ["scripts/create-qa-proof-draft.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--network=linea-mainnet", "--chain-id=59144", `--failure-artifact=${qaFailureArtifact}`, `--support-artifact=${qaSupportArtifact}`, `--finalqa-artifact=${qaFinalArtifact}`, `--smoke-artifact=${qaSmokeArtifact}`, "--clean-wallet-tx=0x1111111111111111111111111111111111111111111111111111111111111111"],
    expected: "--wallet-artifact is required when drafting QA launch evidence",
  },
  {
    id: "qa-missing-failure-artifact",
    create: ["scripts/create-qa-proof-draft.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--network=linea-mainnet", "--chain-id=59144", `--wallet-artifact=${qaWalletArtifact}`, `--support-artifact=${qaSupportArtifact}`, `--finalqa-artifact=${qaFinalArtifact}`, `--smoke-artifact=${qaSmokeArtifact}`, "--clean-wallet-tx=0x1111111111111111111111111111111111111111111111111111111111111111"],
    expected: "--failure-artifact is required when drafting QA launch evidence",
  },
  {
    id: "qa-missing-support-artifact",
    create: ["scripts/create-qa-proof-draft.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--network=linea-mainnet", "--chain-id=59144", `--wallet-artifact=${qaWalletArtifact}`, `--failure-artifact=${qaFailureArtifact}`, `--finalqa-artifact=${qaFinalArtifact}`, `--smoke-artifact=${qaSmokeArtifact}`, "--clean-wallet-tx=0x1111111111111111111111111111111111111111111111111111111111111111"],
    expected: "--support-artifact is required when drafting QA launch evidence",
  },
  {
    id: "qa-missing-finalqa-artifact",
    create: ["scripts/create-qa-proof-draft.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--network=linea-mainnet", "--chain-id=59144", `--wallet-artifact=${qaWalletArtifact}`, `--failure-artifact=${qaFailureArtifact}`, `--support-artifact=${qaSupportArtifact}`, `--smoke-artifact=${qaSmokeArtifact}`, "--clean-wallet-tx=0x1111111111111111111111111111111111111111111111111111111111111111"],
    expected: "--finalqa-artifact is required when drafting QA launch evidence",
  },
  {
    id: "qa-missing-smoke-artifact",
    create: ["scripts/create-qa-proof-draft.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--network=linea-mainnet", "--chain-id=59144", `--wallet-artifact=${qaWalletArtifact}`, `--failure-artifact=${qaFailureArtifact}`, `--support-artifact=${qaSupportArtifact}`, `--finalqa-artifact=${qaFinalArtifact}`, "--clean-wallet-tx=0x1111111111111111111111111111111111111111111111111111111111111111"],
    expected: "--smoke-artifact is required when drafting QA launch evidence",
  },
  {
    id: "qa-missing-clean-wallet-tx",
    create: ["scripts/create-qa-proof-draft.mjs"],
    createArgs: ["--origin=https://playlore.xyz", "--network=linea-mainnet", "--chain-id=59144", `--wallet-artifact=${qaWalletArtifact}`, `--failure-artifact=${qaFailureArtifact}`, `--support-artifact=${qaSupportArtifact}`, `--finalqa-artifact=${qaFinalArtifact}`, `--smoke-artifact=${qaSmokeArtifact}`],
    expected: "--clean-wallet-tx must be a real non-zero tx hash",
  },
  {
    id: "monitoring-final-output",
    create: ["scripts/create-monitoring-proof-draft.mjs"],
    createArgs: ["--provider=synthetic-monitor", "--error-provider=synthetic-error-tracker", "--origin=https://playlore.xyz", "--out=docs/monitoring-proof.json"],
    expected: "writes incomplete drafts only",
  },
  {
    id: "monitoring-missing-monitor-artifact",
    create: ["scripts/create-monitoring-proof-draft.mjs"],
    createArgs: ["--provider=synthetic-monitor", "--error-provider=synthetic-error-tracker", "--origin=https://playlore.xyz", `--recovery-artifact=${monitoringRecoveryArtifact}`, `--alert-target-artifact=${monitoringAlertTargetArtifact}`, `--error-event-artifact=${monitoringErrorEventArtifact}`],
    expected: "--monitor-artifact is required when drafting monitoring launch evidence",
  },
  {
    id: "monitoring-missing-recovery-artifact",
    create: ["scripts/create-monitoring-proof-draft.mjs"],
    createArgs: ["--provider=synthetic-monitor", "--error-provider=synthetic-error-tracker", "--origin=https://playlore.xyz", `--monitor-artifact=${monitoringAlertArtifact}`, `--alert-target-artifact=${monitoringAlertTargetArtifact}`, `--error-event-artifact=${monitoringErrorEventArtifact}`],
    expected: "--recovery-artifact is required when drafting monitoring launch evidence",
  },
  {
    id: "monitoring-missing-alert-target-artifact",
    create: ["scripts/create-monitoring-proof-draft.mjs"],
    createArgs: ["--provider=synthetic-monitor", "--error-provider=synthetic-error-tracker", "--origin=https://playlore.xyz", `--monitor-artifact=${monitoringAlertArtifact}`, `--recovery-artifact=${monitoringRecoveryArtifact}`, `--error-event-artifact=${monitoringErrorEventArtifact}`],
    expected: "--alert-target-artifact is required when drafting monitoring launch evidence",
  },
  {
    id: "monitoring-missing-error-event-artifact",
    create: ["scripts/create-monitoring-proof-draft.mjs"],
    createArgs: ["--provider=synthetic-monitor", "--error-provider=synthetic-error-tracker", "--origin=https://playlore.xyz", `--monitor-artifact=${monitoringAlertArtifact}`, `--recovery-artifact=${monitoringRecoveryArtifact}`, `--alert-target-artifact=${monitoringAlertTargetArtifact}`],
    expected: "--error-event-artifact is required when drafting monitoring launch evidence",
  },
];

const strictPassCases = [
  {
    id: "canary-testnet-profile",
    check: ["scripts/analyze-live-canary-proof.mjs"],
    checkArgs: [testnetCanaryFullLog, "--profile=testnet", "--strict", `--manifest=${testnetCanaryValidStrictManifestPath}`],
    env: {
      LINEA_NETWORK: "sepolia",
      NEXT_PUBLIC_LINEA_NETWORK: "sepolia",
      LINEA_CHAIN_ID: "59141",
      NEXT_PUBLIC_LINEA_CHAIN_ID: "59141",
      NEXT_PUBLIC_CONTRACT_ADDRESS: "0x1111111111111111111111111111111111111111",
    },
  },
];

function runNode(args, envPatch = {}) {
  return spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    env: { ...process.env, ...envPatch },
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
}

function oneLine(output) {
  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const guardPattern = /writes incomplete drafts only|collector writes incomplete evidence drafts only|is required when (?:collecting|drafting)|must point to an existing redacted file artifact|must point to an existing redacted artifact|must contain successful proof:mainnet summary|must include successful restore drill summary|must include base=<production origin>|must include Load base URL line|must include \[prod-health\] OK|must include runtime=ok\/pass\/healthy|must include dataSync=ok\/pass\/healthy|must include numeric finalityLagBlocks=<number>|must be outside the repo checkout|must include generatedAt as ISO-8601 UTC|must include at least --epochs unique checked epochs|must match --deploy-block|must match --chain-snapshot contractAddress|must be a real non-zero tx hash|must include at least one successful auto-miner canary tx|local signoff artifact references must exist|contractEnv evidence must mention proof:mainnet, env, contract, deploy, or chainId proof|ownership\.directOwnerReadEvidence evidence must mention owner, Safe\/multisig, governance, or direct-chain proof|randomness evidence must mention randomness decision or operator sign-off proof|chainComparison\.jackpot evidence must mention jackpot, direct-chain, app, or indexer proof|local host artifact references must exist|persistentDb evidence artifact must mention persistence, restart\/reboot, or DB path proof|healthProd evidence artifact must include \[prod-health\] OK, base, and numeric finalityLagBlocks|loadHttp evidence artifact must include Load base URL, TOTAL, and p95 output|local indexer artifact references must exist|dryRun evidence artifact must include \[indexer\] Deploy block and \[indexer\] Start block|finality evidence artifact must include health:prod base and numeric finalityLagBlocks|chainSnapshot\.path artifact must include generatedAt, rpcChainId, and contractAddress|chainComparison\.jackpot evidence artifact must mention jackpot, direct-chain, chain comparison, or indexer proof|local monitoring artifact references must exist|fired-alert evidence must mention alert, monitor, fired, triggered, or incident proof|recovery evidence must mention recovery, recovered, resolved, or resolution proof|alertTargets\[0\] evidence must mention alert target or notification channel proof|error tracking test event evidence must mention error, exception, event, issue, or provider proof|local restore artifact references must exist|local QA artifact references must exist|wallet\.privyAllowedOrigins evidence must mention wallet\/Privy\/connect\/mobile\/wrong-network proof|failureStateUx\.disabledActionsExplainReason evidence must mention failure-state\/pending\/degraded\/no-op UX proof|supportAuditVisibility\.betHistoryFields evidence must mention support\/audit\/diagnostics visibility proof|finalQa\.mobileLayout evidence must mention final browser\/mobile\/mainnet wording QA proof|finalQa\.browserSmokeDebugAutominer evidence must mention debug autominer browser smoke proof|targetNetwork evidence must mention target RPC, chain, or Linea mainnet launch proof|recovery\.reload evidence must mention reload, reconnect, tab-close, pending-tx, remount, or recovery proof|autoMinerSession evidence must mention auto-miner session, rounds, epochs, or target RPC proof|transactionHealth evidence must mention transaction, tx, nonce, duplicate, stuck pending, or pending recovery proof|local canary artifact references must exist/i;
  const preferred = lines.find((line) => /^Error: /i.test(line) && guardPattern.test(line)) || lines.find((line) => guardPattern.test(line));
  const compact = preferred || lines.slice(-3).join(" | ");
  return compact.length > 260 ? `${compact.slice(0, 257)}...` : compact;
}

function printTable(headers, rows) {
  console.log(`| ${headers.join(" | ")} |`);
  console.log(`| ${headers.map(() => "---").join(" | ")} |`);
  for (const row of rows) console.log(`| ${row.join(" | ")} |`);
}

const rows = [];
const issues = [];

for (const item of draftCases) {
  const createResult = runNode([...item.create, ...item.createArgs, `--out=${item.out}`]);
  const createOutput = `${createResult.stdout || ""}\n${createResult.stderr || ""}`;
  if (createResult.status !== 0) {
    issues.push(`${item.id}: draft generation failed`);
    rows.push([item.id, "create failed", String(createResult.status), oneLine(createOutput).replace(/\|/g, "\\|")]);
    continue;
  }

  const checkResult = runNode([...item.check, ...item.checkArgs(item.out)]);
  const checkOutput = `${checkResult.stdout || ""}\n${checkResult.stderr || ""}`;
  const rejectedAsDraft = checkResult.status !== 0 && /draft proof manifests are not accepted as launch proof/i.test(checkOutput);
  if (!rejectedAsDraft) {
    issues.push(`${item.id}: strict validator did not reject draft proof manifest`);
  }
  rows.push([item.id, rejectedAsDraft ? "rejected" : "issue", String(checkResult.status), oneLine(checkOutput).replace(/\|/g, "\\|")]);
}

for (const item of collectorDraftCases) {
  const createResult = runNode([...item.create, ...item.createArgs, `--out=${item.out}`]);
  const createOutput = `${createResult.stdout || ""}\n${createResult.stderr || ""}`;
  if (createResult.status !== 0) {
    issues.push(`${item.id}: collector draft generation failed`);
    rows.push([item.id, "create failed", String(createResult.status), oneLine(createOutput).replace(/\|/g, "\\|")]);
    continue;
  }

  let manifest = null;
  try {
    manifest = JSON.parse(readFileSync(item.out, "utf8"));
  } catch {
    issues.push(`${item.id}: collector output is not valid JSON`);
  }
  const missingSections = item.requiredSections.filter((section) => !manifest || !(section in manifest));
  if (missingSections.length > 0) {
    issues.push(`${item.id}: collector output missing ${missingSections.join(", ")}`);
  }

  const checkResult = runNode([...item.check, ...item.checkArgs(item.out)]);
  const checkOutput = `${checkResult.stdout || ""}\n${checkResult.stderr || ""}`;
  const rejectedAsIncomplete = checkResult.status !== 0;
  if (!rejectedAsIncomplete) {
    issues.push(`${item.id}: strict validator accepted incomplete collector draft`);
  }
  rows.push([item.id, rejectedAsIncomplete && missingSections.length === 0 ? "rejected incomplete" : "issue", String(checkResult.status), oneLine(checkOutput).replace(/\|/g, "\\|")]);
}
for (const item of collectorRejectCases) {
  const createResult = runNode([...item.create, ...item.createArgs]);
  const createOutput = `${createResult.stdout || ""}\n${createResult.stderr || ""}`;
  const rejected = createResult.status !== 0 && createOutput.includes(item.expected);
  if (!rejected) {
    issues.push(`${item.id}: incomplete collector evidence was not rejected`);
  }
  rows.push([item.id, rejected ? "rejected" : "issue", String(createResult.status), oneLine(createOutput).replace(/\|/g, "\\|")]);
}

for (const item of strictPassCases) {
  const checkResult = runNode([...item.check, ...item.checkArgs], item.env);
  const checkOutput = `${checkResult.stdout || ""}\n${checkResult.stderr || ""}`;
  const passed = checkResult.status === 0 && /Summary: live canary proof checks passed\./i.test(checkOutput);
  if (!passed) {
    issues.push(`${item.id}: strict validator did not accept valid testnet canary evidence`);
  }
  rows.push([item.id, passed ? "passed testnet" : "issue", String(checkResult.status), oneLine(checkOutput).replace(/\|/g, "\\|")]);
}

for (const item of strictRejectCases) {
  const checkResult = runNode([...item.check, ...item.checkArgs], item.env);
  const checkOutput = `${checkResult.stdout || ""}\n${checkResult.stderr || ""}`;
  const rejected = checkResult.status !== 0 && checkOutput.includes(item.expected);
  if (!rejected) {
    issues.push(`${item.id}: strict validator did not reject missing local artifact evidence`);
  }
  rows.push([item.id, rejected ? "rejected" : "issue", String(checkResult.status), oneLine(checkOutput).replace(/\|/g, "\\|")]);
}

for (const item of finalOutputCases) {
  const createResult = runNode([...item.create, ...item.createArgs]);
  const createOutput = `${createResult.stdout || ""}\n${createResult.stderr || ""}`;
  const rejected = createResult.status !== 0 && createOutput.includes(item.expected);
  if (!rejected) {
    issues.push(`${item.id}: final proof output was not rejected`);
  }
  rows.push([item.id, rejected ? "rejected" : "issue", String(createResult.status), oneLine(createOutput).replace(/\|/g, "\\|")]);
}

const bundleOutDir = join(tmp, "proof-draft-bundle");
const bundleResult = runNode(["scripts/create-all-proof-drafts.mjs", `--out-dir=${bundleOutDir}`]);
const bundleOutput = `${bundleResult.stdout || ""}\n${bundleResult.stderr || ""}`;
const bundleWarns = bundleResult.status === 0 && /Draft files are not launch proof/i.test(bundleOutput) && /strict validation/i.test(bundleOutput);
if (!bundleWarns) {
  issues.push("draft-bundle: bundle generator did not warn that drafts are not launch proof");
}
let bundleRejectedCount = 0;
if (bundleResult.status === 0) {
  for (const item of draftCases) {
    const out = join(bundleOutDir, `${item.id}-proof.draft.json`);
    const checkResult = runNode([...item.check, ...item.checkArgs(out)]);
    if (checkResult.status !== 0) {
      bundleRejectedCount += 1;
    } else {
      issues.push(`draft-bundle: strict validator accepted ${item.id}-proof.draft.json`);
    }
  }
}
const bundleOk = bundleWarns && bundleRejectedCount === draftCases.length;
rows.push(["draft-bundle", bundleOk ? "created as non-proof" : "issue", String(bundleResult.status), oneLine(bundleOutput).replace(/\|/g, "\\|")]);
printTable(["Draft", "Strict Result", "Exit", "Evidence"], rows);
console.log(`Summary: ${issues.length === 0 ? "all proof drafts are rejected by strict validators" : `${issues.length} issue(s): ${issues.join("; ")}`}.`);

if (issues.length > 0) process.exitCode = 1;
