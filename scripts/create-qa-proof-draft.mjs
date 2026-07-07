import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const ZERO_TX = "0x0000000000000000000000000000000000000000000000000000000000000000";

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
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === "" &&
      !["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(host) &&
      !host.endsWith(".local");
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
  const normalized = String(value ?? "").trim();
  if (!/^[1-9]\d*$/.test(normalized)) return false;
  return Number.isSafeInteger(Number(normalized));
}

function optionalExistingArtifact(name) {
  const value = argValue(name);
  if (!value) return "";
  const resolved = path.resolve(process.cwd(), value);
  if (!existsSync(resolved)) {
    throw new Error(`--${name} must point to an existing redacted artifact`);
  }
  return value;
}

function isRealTx(value) {
  const normalized = String(value ?? "").trim();
  return /^0x[a-fA-F0-9]{64}$/.test(normalized) && normalized.toLowerCase() !== ZERO_TX;
}

function check(label, artifact = "") {
  return {
    status: "TODO",
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
const walletArtifact = optionalExistingArtifact("wallet-artifact");
const failureArtifact = optionalExistingArtifact("failure-artifact");
const supportArtifact = optionalExistingArtifact("support-artifact");
const finalQaArtifact = optionalExistingArtifact("finalqa-artifact");
const smokeArtifact = optionalExistingArtifact("smoke-artifact");
const cleanWalletTx = argValue("clean-wallet-tx", ZERO_TX);

if (!isFinalHttpsOrigin(origin)) {
  throw new Error("--origin must be a non-local HTTPS origin without path, query, or hash");
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
if (Number(chainId) !== 59144) {
  throw new Error("--chain-id must be 59144 for Linea mainnet launch proof");
}
if (cleanWalletTx !== ZERO_TX && !isRealTx(cleanWalletTx)) {
  throw new Error("--clean-wallet-tx must be a real non-zero tx hash");
}

const manifest = {
  targetNetwork: network,
  targetChainId: chainId,
  wallet: {
    privyAllowedOrigins: {
      status: "TODO",
      origin,
      exactProductionOrigin: false,
      developmentFallbackAppIdUsed: true,
      evidence: walletArtifact ? `artifact: ${walletArtifact}` : "TODO: Privy dashboard allowed-origin proof",
      checkedAt: "TODO: ISO timestamp",
    },
    desktopConnect: check("desktop wallet connect", walletArtifact),
    desktopDisconnect: check("desktop wallet disconnect", walletArtifact),
    desktopReconnect: check("desktop wallet reconnect", walletArtifact),
    wrongNetwork: {
      status: "TODO",
      targetChainId: chainId,
      testedChainId: "TODO: wrong chain id used for negative test",
      unsupportedChainWarningVisible: false,
      evidence: walletArtifact ? `artifact: ${walletArtifact}` : "TODO: wrong-network warning screenshot or QA note",
      checkedAt: "TODO: ISO timestamp",
    },
    mobileWeb3Browser: check("mobile Web3 browser", walletArtifact),
    cleanWalletFirstTx: {
      status: "TODO",
      network,
      chainId,
      txHash: cleanWalletTx,
      evidence: walletArtifact ? `artifact: ${walletArtifact}` : "TODO: real clean-wallet first transaction hash and QA note",
      checkedAt: "TODO: ISO timestamp",
    },
    slowNetworkAuthModal: check("slow network auth modal", walletArtifact),
    slowNetworkChatAuth: check("slow network chat auth", walletArtifact),
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
      fields: ["round", "epoch", "nonce", "txHash", "retryCount"],
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
console.log("Review TODO fields, add real wallet/mobile/browser evidence, then save as docs/qa-proof.json.");
