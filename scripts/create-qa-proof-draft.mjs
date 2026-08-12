import { mkdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const ZERO_TX = "0x0000000000000000000000000000000000000000000000000000000000000000";
const MAX_QA_DRAFT_ARTIFACT_BYTES = 512 * 1024;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

function refuseFinalProofOutput(outPath) {
  const normalized = path.relative(process.cwd(), outPath).replace(/\\/g, "/");
  if (normalized === "docs/qa-proof.json") {
    throw new Error("QA draft generator writes incomplete drafts only; use --out=docs/qa-proof.draft.json, then promote to docs/qa-proof.json only after real wallet/browser/mobile evidence and strict validation");
  }
}
function argValue(name, fallback = "") {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length) : process.env[name.toUpperCase().replaceAll("-", "_")] || fallback;
}

function isFinalHttpsOrigin(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    const host = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === "" &&
      (host.includes(".") || host.includes(":")) &&
      !(
        host === "localhost" ||
        host === "0.0.0.0" ||
        host === "::" ||
        host === "::1" ||
        host === "127.0.0.1" ||
        host.endsWith(".localhost") ||
        host.endsWith(".local") ||
        host.endsWith(".example") ||
        host.endsWith(".test") ||
        host.endsWith(".invalid") ||
        /^0\./.test(host) ||
        /^127\./.test(host) ||
        /^10\./.test(host) ||
        /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host) ||
        /^169\.254\./.test(host) ||
        /^192\.168\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
        /^192\.0\.2\./.test(host) ||
        /^198\.(1[89])\./.test(host) ||
        /^198\.51\.100\./.test(host) ||
        /^203\.0\.113\./.test(host) ||
        /^::ffff:/i.test(host) ||
        /^f[cd][0-9a-f]*:/i.test(host) ||
        /^fe[89ab][0-9a-f]*:/i.test(host) ||
        /^2001:db8:/i.test(host)
      );
  } catch {
    return false;
  }
}

function normalizeNetwork(network) {
  const normalized = String(network ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "-");
  if (["main", "linea", "prod", "production", "linea-mainnet"].includes(normalized)) return "mainnet";
  if (["testnet", "linea-sepolia", "sepolia-testnet"].includes(normalized)) return "sepolia";
  return normalized;
}

function knownChainId(network) {
  const normalized = normalizeNetwork(network);
  if (normalized === "mainnet") return "59144";
  if (normalized === "sepolia") return "59141";
  return "";
}

function isPositiveInteger(value) {
  return parsePositiveInteger(value) !== null;
}

function parsePositiveInteger(value) {
  const normalized = String(value ?? "").trim();
  if (!/^[1-9]\d{0,15}$/.test(normalized)) return null;
  const parsed = BigInt(normalized);
  return parsed <= MAX_SAFE_INTEGER_BIGINT ? Number(parsed) : null;
}

function regularFileStat(filePath) {
  try {
    const stats = statSync(filePath);
    return stats.isFile() ? stats : null;
  } catch {
    return null;
  }
}

function requireExistingArtifact(name) {
  const value = argValue(name);
  if (!value) {
    throw new Error(`--${name} is required when drafting QA launch evidence`);
  }
  const resolved = path.resolve(process.cwd(), value);
  const stats = regularFileStat(resolved);
  if (!stats) {
    throw new Error(`--${name} must point to an existing redacted file artifact`);
  }
  if (stats.size > MAX_QA_DRAFT_ARTIFACT_BYTES) {
    throw new Error(`--${name} artifact is too large to reference safely`);
  }
  return value;
}

function sameArtifact(left, right) {
  return path.resolve(process.cwd(), left).toLowerCase() === path.resolve(process.cwd(), right).toLowerCase();
}

function requireDistinctArtifacts(entries) {
  for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
      const [leftName, leftPath] = entries[leftIndex];
      const [rightName, rightPath] = entries[rightIndex];
      if (sameArtifact(leftPath, rightPath)) {
        throw new Error(`--${leftName} and --${rightName} must point to distinct QA evidence files`);
      }
    }
  }
}

function isRealTx(value) {
  const normalized = String(value ?? "").trim();
  return /^0x[a-fA-F0-9]{64}$/.test(normalized) && normalized.toLowerCase() !== ZERO_TX;
}

function check(label, artifact = "", origin = "") {
  return {
    status: "TODO",
    ...(origin ? { origin } : {}),
    evidence: artifact ? `artifact: ${artifact}` : `TODO: record QA evidence for ${label}`,
    checkedAt: "TODO: ISO timestamp",
  };
}

const outPath = path.resolve(process.cwd(), argValue("out", "docs/qa-proof.draft.json"));
refuseFinalProofOutput(outPath);
const origin = argValue("origin", process.env.NEXT_PUBLIC_SITE_URL || "TODO: exact HTTPS production origin");
const network = argValue("network", process.env.NEXT_PUBLIC_LINEA_NETWORK || process.env.LINEA_NETWORK || "TODO: target network");
const chainId = argValue(
  "chain-id",
  process.env.NEXT_PUBLIC_LINEA_CHAIN_ID || process.env.LINEA_CHAIN_ID || knownChainId(network) || "TODO: target chain id",
);
const walletArtifact = requireExistingArtifact("wallet-artifact");
const failureArtifact = requireExistingArtifact("failure-artifact");
const supportArtifact = requireExistingArtifact("support-artifact");
const finalQaArtifact = requireExistingArtifact("finalqa-artifact");
const smokeArtifact = requireExistingArtifact("smoke-artifact");
const cleanWalletTx = argValue("clean-wallet-tx");
const securityScanBundle = argValue("security-scan-bundle", "TODO: absolute external sealed scan bundle path");
const securityScanManifestSha256 = argValue("security-scan-manifest-sha256", "TODO: scan-manifest.json SHA-256");
const securityScanReviewerKeyId = argValue("security-scan-reviewer-key-id", "TODO: trusted reviewer public-key SHA-256");
const securityScanAttestationSignature = argValue("security-scan-attestation-signature", "TODO: detached Ed25519 signature from independent reviewer");
const securityScanAttestationSignedAt = argValue("security-scan-attestation-signed-at", "TODO: detached attestation signing time in ISO-8601 UTC");
const securityScanAttestationExpiresAt = argValue("security-scan-attestation-expires-at", "TODO: detached attestation expiry within 24 hours in ISO-8601 UTC");
const candidateRevision = argValue(
  "candidate-revision",
  process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_SHA || process.env.SOURCE_VERSION || "TODO: exact 40-character candidate Git revision",
);

requireDistinctArtifacts([
  ["wallet-artifact", walletArtifact],
  ["failure-artifact", failureArtifact],
  ["support-artifact", supportArtifact],
  ["finalqa-artifact", finalQaArtifact],
  ["smoke-artifact", smokeArtifact],
]);

if (!isFinalHttpsOrigin(origin)) {
  throw new Error("--origin must be a public HTTPS origin without path, query, or hash");
}
if (!String(network).trim() || /TODO|TBD/i.test(network)) {
  throw new Error("--network must identify the target network");
}
if (normalizeNetwork(network) !== "mainnet") {
  throw new Error("--network must be mainnet for launch QA proof");
}
if (!isPositiveInteger(chainId)) {
  throw new Error("--chain-id must be a positive integer or derivable from --network");
}
const parsedChainId = parsePositiveInteger(chainId);
if (parsedChainId === null) {
  throw new Error("--chain-id must be a safe positive integer or derivable from --network");
}
if (parsedChainId !== 59144) {
  throw new Error("--chain-id must be 59144 for Linea mainnet launch proof");
}
if (!isRealTx(cleanWalletTx)) {
  throw new Error("--clean-wallet-tx must be a real non-zero tx hash");
}

const manifest = {
  targetNetwork: network,
  targetChainId: parsedChainId,
  securityScan: {
    bundlePath: securityScanBundle,
    manifestSha256: securityScanManifestSha256,
    candidateRevision,
    attestation: {
      reviewerKeyId: securityScanReviewerKeyId,
      signedAt: securityScanAttestationSignedAt,
      expiresAt: securityScanAttestationExpiresAt,
      signature: securityScanAttestationSignature,
    },
  },
  wallet: {
    privyAllowedOrigins: {
      status: "TODO",
      origin,
      exactProductionOrigin: false,
      developmentFallbackAppIdUsed: true,
      productionAppIdConfigured: false,
      evidence: walletArtifact ? `artifact: ${walletArtifact}` : "TODO: Privy dashboard allowed-origin and production app id proof",
      checkedAt: "TODO: ISO timestamp",
    },
    desktopConnect: check("desktop wallet connect", walletArtifact, origin),
    desktopDisconnect: check("desktop wallet disconnect", walletArtifact, origin),
    desktopReconnect: check("desktop wallet reconnect", walletArtifact, origin),
    wrongNetwork: {
      status: "TODO",
      origin,
      targetChainId: parsedChainId,
      testedChainId: "TODO: wrong chain id used for negative test",
      unsupportedChainWarningVisible: false,
      evidence: walletArtifact ? `artifact: ${walletArtifact}` : "TODO: wrong-network warning screenshot or QA note",
      checkedAt: "TODO: ISO timestamp",
    },
    mobileWeb3Browser: check("mobile Web3 browser", walletArtifact, origin),
    cleanWalletFirstTx: {
      status: "TODO",
      origin,
      network,
      chainId: parsedChainId,
      txHash: cleanWalletTx,
      evidence: walletArtifact ? `artifact: ${walletArtifact}` : "TODO: real clean-wallet first transaction hash and QA note",
      checkedAt: "TODO: ISO timestamp",
    },
    slowNetworkAuthModal: check("slow network auth modal", walletArtifact, origin),
    slowNetworkChatAuth: check("slow network chat auth", walletArtifact, origin),
  },
  failureStateUx: {
    disabledActionsExplainReason: check("disabled buttons explain reason", failureArtifact),
    pendingBet: check("pending bet state", failureArtifact),
    pendingResolve: check("pending resolve state", failureArtifact),
    pendingChatAuth: check("pending chat auth state", failureArtifact),
    pendingProfileSave: check("pending profile save state", failureArtifact),
    degradedDataVisible: check("degraded or stale data visibility", failureArtifact),
    routeChunkRecovery: check("route chunk recovery", failureArtifact),
    noSilentNoop: check("no silent no-op actions", failureArtifact),
  },
  supportAuditVisibility: {
    betHistoryFields: {
      status: "TODO",
      fields: ["epoch", "tile", "amount", "txHash", "result"],
      evidence: supportArtifact ? `artifact: ${supportArtifact}` : "TODO: bet history QA note or screenshot",
      checkedAt: "TODO: ISO timestamp",
    },
    autoMinerLogFields: {
      status: "TODO",
      fields: ["round", "epoch", "nonce", "txHash", "retryCount", "stopReason"],
      evidence: supportArtifact ? `artifact: ${supportArtifact}` : "TODO: auto-miner log QA note or screenshot",
      checkedAt: "TODO: ISO timestamp",
    },
    diagnosticsIndexerLag: check("diagnostics indexer lag", supportArtifact),
    diagnosticsHeartbeat: check("diagnostics heartbeat", supportArtifact),
    diagnosticsServingMode: check("diagnostics serving mode", supportArtifact),
  },
  finalQa: {
    browserSmokeDebugAutominer: {
      status: "TODO",
      origin,
      command:
        '$env:SMOKE_INCLUDE_DEBUG_AUTOMINER_SCENARIOS = "1"; npm.cmd run smoke:browser; Remove-Item Env:\\SMOKE_INCLUDE_DEBUG_AUTOMINER_SCENARIOS',
      debugAutominerScenariosPassed: false,
      noUnexpectedConsoleErrors: false,
      unsupportedWalletWarningsNotMasked: false,
      evidence: smokeArtifact ? `artifact: ${smokeArtifact}` : "TODO: debug autominer smoke summary",
      checkedAt: "TODO: ISO timestamp",
    },
    mobileLayout: check("mobile layout", finalQaArtifact),
    rightPanelOverlays: check("right panel and overlays", finalQaArtifact),
    chatGeometry: check("chat geometry", finalQaArtifact),
    faqMainnetWording: check("FAQ mainnet wording", finalQaArtifact),
    whitepaperMainnetWording: check("whitepaper mainnet wording", finalQaArtifact),
    onboardingMainnetWording: check("onboarding mainnet wording", finalQaArtifact),
  },
};

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);

console.log(`QA proof draft written: ${path.relative(process.cwd(), outPath)}`);
console.log("Review TODO fields, add real wallet/mobile/browser evidence plus the external sealed security-scan bundle and independent detached reviewer signature, then save as docs/qa-proof.json.");
