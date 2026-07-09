import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const strict = process.argv.includes("--strict") || process.env.PROOF_STRICT === "1";
const args = new Map(
  process.argv
    .slice(2)
    .filter((arg) => arg.startsWith("--") && arg.includes("="))
    .map((arg) => {
      const [key, ...rest] = arg.slice(2).split("=");
      return [key, rest.join("=")];
    }),
);

const requiredGroups = {
  wallet: [
    "privyAllowedOrigins",
    "desktopConnect",
    "desktopDisconnect",
    "desktopReconnect",
    "wrongNetwork",
    "mobileWeb3Browser",
    "cleanWalletFirstTx",
    "slowNetworkAuthModal",
    "slowNetworkChatAuth",
  ],
  failureStateUx: [
    "disabledActionsExplainReason",
    "pendingBet",
    "pendingResolve",
    "pendingChatAuth",
    "pendingProfileSave",
    "degradedDataVisible",
    "routeChunkRecovery",
    "noSilentNoop",
  ],
  supportAuditVisibility: [
    "betHistoryFields",
    "autoMinerLogFields",
    "diagnosticsIndexerLag",
    "diagnosticsHeartbeat",
    "diagnosticsServingMode",
  ],
  finalQa: [
    "browserSmokeDebugAutominer",
    "mobileLayout",
    "rightPanelOverlays",
    "chatGeometry",
    "faqMainnetWording",
    "whitepaperMainnetWording",
    "onboardingMainnetWording",
  ],
};

const okStatuses = new Set(["ok", "pass", "passed", "success", "verified", "complete"]);
const TX_RE = /^0x[a-fA-F0-9]{64}$/;
const ZERO_TX = "0x0000000000000000000000000000000000000000000000000000000000000000";
const TEMPLATE_VALUE_RE = /REPLACE_|<REDACTED>|TODO|TBD/i;
const secretKeyPattern = /(secret|private[_-]?key|mnemonic|webhook|dsn|api[_-]?key|api[_-]?token|auth[_-]?token|access[_-]?token|bearer|session|cookie)/i;
const REQUIRED_BET_HISTORY_FIELDS = ["epoch", "tile", "amount", "txHash", "result"];
const REQUIRED_AUTOMINER_LOG_FIELDS = ["round", "epoch", "nonce", "txHash", "retryCount"];
const knownNetworkChainIds = new Map([
  ["mainnet", 59144],
  ["sepolia", 59141],
]);

function requiresQaTimestamp(group, checkId) {
  if (group === "supportAuditVisibility" || group === "finalQa") return true;
  if (group === "failureStateUx") return true;
  return group === "wallet" && checkId !== "privyAllowedOrigins";
}

function env(name) {
  return process.env[name]?.trim() || "";
}

function argOrEnv(argName, envName, fallback) {
  return args.get(argName)?.trim() || env(envName) || fallback;
}

function hasText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasRealText(value) {
  return hasText(value) && !TEMPLATE_VALUE_RE.test(value);
}

function hasIsoTimestamp(value) {
  if (!hasRealText(value)) return false;
  const text = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(text)) return false;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return false;
  const normalized = text.includes(".") ? text : text.replace("Z", ".000Z");
  return parsed.toISOString() === normalized;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function checkStatus(value) {
  return okStatuses.has(String(value ?? "").trim().toLowerCase());
}

function hasEvidence(check) {
  if (!isPlainObject(check)) return false;
  return [
    check.evidence,
    check.evidencePath,
    check.link,
    check.txHash,
    check.notes,
    check.artifact,
    check.screenshot,
    check.screenshotPath,
    check.logPath,
    check.reportPath,
  ].some(hasRealText);
}

function hasConcreteText(value) {
  if (!hasRealText(value)) return false;
  const text = String(value).trim();
  return /https?:\/\//i.test(text) ||
    /(?:^|[\\/\s])[^\s]+\.(?:json|jsonl|log|md|txt|csv|png|jpg|jpeg|webp|html|zip)(?:\b|$)/i.test(text) ||
    /\bnpm(?:\.cmd)?\s+run\s+(?:smoke:browser|proof:qa|proof:[a-z0-9:-]+)\b/i.test(text) ||
    /\bproof:[a-z0-9:-]+\b/i.test(text) ||
    /\b(?:screenshot|playwright|browser\s+smoke|mobile|privy|wrong\s+network|pending|diagnostics|bet\s+history|auto[-\s]?miner\s+log|debug\s+autominer)\b/i.test(text);
}

function hasConcreteEvidence(check) {
  if (!isPlainObject(check)) return false;
  if (isRealTx(check.txHash)) return true;
  return [
    check.evidencePath,
    check.link,
    check.artifact,
    check.screenshot,
    check.screenshotPath,
    check.logPath,
    check.reportPath,
    check.commandOutputPath,
  ].some(hasConcreteText);
}

function findSecretLikeValues(value, path = "$") {
  const findings = [];
  if (Array.isArray(value)) {
    value.forEach((entry, index) => findings.push(...findSecretLikeValues(entry, `${path}[${index}]`)));
    return findings;
  }
  if (!isPlainObject(value)) return findings;
  for (const [key, entry] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (secretKeyPattern.test(key) && typeof entry === "string") {
      const normalized = entry.trim().toLowerCase();
      if (!["", "present", "configured", "redacted", "<redacted>"].includes(normalized)) {
        findings.push(childPath);
      }
    }
    findings.push(...findSecretLikeValues(entry, childPath));
  }
  return findings;
}

function findTemplateLikeValues(value, path = "$") {
  const findings = [];
  if (Array.isArray(value)) {
    value.forEach((entry, index) => findings.push(...findTemplateLikeValues(entry, `${path}[${index}]`)));
    return findings;
  }
  if (typeof value === "string") {
    if (TEMPLATE_VALUE_RE.test(value)) findings.push(path);
    return findings;
  }
  if (!isPlainObject(value)) return findings;
  for (const [key, entry] of Object.entries(value)) {
    findings.push(...findTemplateLikeValues(entry, `${path}.${key}`));
  }
  return findings;
}

function isRealTx(value) {
  const normalized = String(value ?? "");
  return TX_RE.test(normalized) && normalized.toLowerCase() !== ZERO_TX;
}

function hasHttpsOrigin(value) {
  try {
    const url = new URL(String(value ?? "").trim());
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      !["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(host) &&
      !host.endsWith(".local");
  } catch {
    return false;
  }
}

function normalizeOrigin(value) {
  try {
    return new URL(String(value ?? "").trim()).origin.toLowerCase();
  } catch {
    return "";
  }
}

function normalizeNetwork(value) {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "-");
  if (["main", "linea", "prod", "production", "linea-mainnet"].includes(normalized)) return "mainnet";
  if (["testnet", "linea-sepolia", "sepolia-testnet"].includes(normalized)) return "sepolia";
  return normalized;
}

function positiveInteger(value) {
  const normalized = String(value ?? "").trim();
  if (!/^[1-9]\d*$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function includesAll(values, required) {
  if (!Array.isArray(values)) return false;
  const normalized = new Set(values.map((value) => String(value).trim()).filter(Boolean));
  return required.every((field) => normalized.has(field));
}

function requiresQaOrigin(group, checkId) {
  return group === "wallet" && checkId !== "privyAllowedOrigins";
}

function qaOriginIssues(check, label, expectedOrigin) {
  const issues = [];
  const origin = check?.origin;
  if (!hasHttpsOrigin(origin)) {
    issues.push(`${label}.origin must be the exact HTTPS production origin`);
  } else if (expectedOrigin && normalizeOrigin(origin) !== normalizeOrigin(expectedOrigin)) {
    issues.push(`${label}.origin must match configured production origin`);
  }
  return issues;
}

function printTable(headers, rows) {
  console.log(`| ${headers.join(" | ")} |`);
  console.log(`| ${headers.map(() => "---").join(" | ")} |`);
  for (const row of rows) console.log(`| ${row.join(" | ")} |`);
}

const manifestPath = resolve(process.cwd(), argOrEnv("file", "QA_PROOF_PATH", "docs/qa-proof.json"));
const issues = [];
let manifest = null;

console.log("# Wallet / UX / Final QA Proof Summary");
console.log("");
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log(`Strict: ${strict ? "yes" : "no"}`);
console.log(`Manifest: ${manifestPath}`);
console.log("");

if (strict && /\.draft\.json$/i.test(manifestPath)) {
  issues.push("draft proof manifests are not accepted as launch proof");
}

if (!existsSync(manifestPath)) {
  issues.push("QA proof manifest is missing");
} else {
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    issues.push(`QA proof manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (manifest) {
  if (!isPlainObject(manifest)) {
    issues.push("QA proof manifest must be an object");
  } else {
    const targetNetwork = manifest.targetNetwork;
    const targetChainId = positiveInteger(manifest.targetChainId);
    const expectedNetwork = env("NEXT_PUBLIC_LINEA_NETWORK") || env("LINEA_NETWORK");
    const expectedChainId = positiveInteger(env("NEXT_PUBLIC_LINEA_CHAIN_ID") || env("LINEA_CHAIN_ID")) ??
      knownNetworkChainIds.get(normalizeNetwork(expectedNetwork || targetNetwork));
    const expectedOrigin = env("NEXT_PUBLIC_SITE_URL") || env("PUBLIC_SITE_URL") || env("SITE_URL");
    const secretFindings = findSecretLikeValues(manifest);
    if (secretFindings.length > 0) {
      issues.push(`secret-like values must be redacted: ${secretFindings.slice(0, 5).join(", ")}`);
    }
    const templateFindings = findTemplateLikeValues(manifest);
    if (templateFindings.length > 0) {
      issues.push(`template placeholder values must be replaced: ${templateFindings.slice(0, 5).join(", ")}`);
    }
    if (!hasRealText(targetNetwork)) {
      issues.push("targetNetwork is missing");
    }
    if (hasRealText(targetNetwork) && normalizeNetwork(targetNetwork) !== "mainnet") {
      issues.push("targetNetwork must be mainnet for launch QA proof");
    }
    if (expectedNetwork && hasRealText(targetNetwork) && normalizeNetwork(targetNetwork) !== normalizeNetwork(expectedNetwork)) {
      issues.push("targetNetwork must match configured Linea network");
    }
    if (targetChainId == null) {
      issues.push("targetChainId must be a positive integer");
    }
    if (targetChainId && targetChainId !== 59144) {
      issues.push("targetChainId must be 59144 for Linea mainnet launch proof");
    }
    if (expectedChainId && targetChainId && targetChainId !== expectedChainId) {
      issues.push("targetChainId must match configured Linea chain id");
    }

    const rows = [];
    for (const [group, checks] of Object.entries(requiredGroups)) {
      const section = isPlainObject(manifest[group]) ? manifest[group] : {};
      if (!isPlainObject(manifest[group])) issues.push(`missing QA section ${group}`);
      for (const checkId of checks) {
        const check = section[checkId];
        const statusOk = checkStatus(check?.status);
        const evidenceOk = hasEvidence(check);
        const concreteEvidenceOk = hasConcreteEvidence(check);
        if (!statusOk) issues.push(`${group}.${checkId} status is not pass/verified`);
        if (!evidenceOk) issues.push(`${group}.${checkId} has no evidence`);
        if (evidenceOk && !concreteEvidenceOk) {
          issues.push(`${group}.${checkId} must include concrete evidence path, link, artifact, screenshot, log, report, or tx hash`);
        }
        if (requiresQaTimestamp(group, checkId) && !hasIsoTimestamp(check?.checkedAt)) {
          issues.push(`${group}.${checkId}.checkedAt must be ISO-8601 UTC`);
        }
        if (requiresQaOrigin(group, checkId)) {
          issues.push(...qaOriginIssues(check, `${group}.${checkId}`, expectedOrigin));
        }
        rows.push([group, checkId, statusOk ? "yes" : "no", concreteEvidenceOk ? "yes" : "no"]);
      }
    }

    const smoke = manifest.finalQa?.browserSmokeDebugAutominer;
    if (isPlainObject(smoke)) {
      const command = String(smoke.command ?? "");
      if (!command.includes("SMOKE_INCLUDE_DEBUG_AUTOMINER_SCENARIOS") || !command.includes("smoke:browser")) {
        issues.push("finalQa.browserSmokeDebugAutominer must record debug autominer smoke command");
      }
      if (!hasIsoTimestamp(smoke.checkedAt)) {
        issues.push("finalQa.browserSmokeDebugAutominer.checkedAt must be ISO-8601 UTC");
      }
      if (!hasHttpsOrigin(smoke.origin)) {
        issues.push("finalQa.browserSmokeDebugAutominer.origin must be the exact HTTPS production origin");
      } else if (expectedOrigin && normalizeOrigin(smoke.origin) !== normalizeOrigin(expectedOrigin)) {
        issues.push("finalQa.browserSmokeDebugAutominer.origin must match configured production origin");
      }
      if (smoke.debugAutominerScenariosPassed !== true) {
        issues.push("finalQa.browserSmokeDebugAutominer.debugAutominerScenariosPassed must be true");
      }
      if (smoke.noUnexpectedConsoleErrors !== true) {
        issues.push("finalQa.browserSmokeDebugAutominer.noUnexpectedConsoleErrors must be true");
      }
      if (smoke.unsupportedWalletWarningsNotMasked !== true) {
        issues.push("finalQa.browserSmokeDebugAutominer.unsupportedWalletWarningsNotMasked must be true");
      }
    }

    const cleanWallet = manifest.wallet?.cleanWalletFirstTx;
    if (isPlainObject(cleanWallet) && !isRealTx(cleanWallet.txHash)) {
      issues.push("wallet.cleanWalletFirstTx must include a real non-zero txHash");
    }
    if (isPlainObject(cleanWallet) && !hasText(cleanWallet.network)) {
      issues.push("wallet.cleanWalletFirstTx.network is missing");
    }
    if (isPlainObject(cleanWallet) && hasRealText(targetNetwork) && hasText(cleanWallet.network) && normalizeNetwork(cleanWallet.network) !== normalizeNetwork(targetNetwork)) {
      issues.push("wallet.cleanWalletFirstTx.network must match targetNetwork");
    }
    if (isPlainObject(cleanWallet)) {
      const cleanWalletChainId = positiveInteger(cleanWallet.chainId);
      if (cleanWalletChainId == null) {
        issues.push("wallet.cleanWalletFirstTx.chainId must be a positive integer");
      } else if (targetChainId && cleanWalletChainId !== targetChainId) {
        issues.push("wallet.cleanWalletFirstTx.chainId must match targetChainId");
      }
    }

    const privyAllowedOrigins = manifest.wallet?.privyAllowedOrigins;
    if (isPlainObject(privyAllowedOrigins)) {
      if (!hasHttpsOrigin(privyAllowedOrigins.origin)) {
        issues.push("wallet.privyAllowedOrigins.origin must be the exact HTTPS production origin");
      }
      if (
        expectedOrigin &&
        hasHttpsOrigin(privyAllowedOrigins.origin) &&
        normalizeOrigin(privyAllowedOrigins.origin) !== normalizeOrigin(expectedOrigin)
      ) {
        issues.push("wallet.privyAllowedOrigins.origin must match configured production origin");
      }
      if (privyAllowedOrigins.exactProductionOrigin !== true) {
        issues.push("wallet.privyAllowedOrigins.exactProductionOrigin must be true");
      }
      if (privyAllowedOrigins.developmentFallbackAppIdUsed === true) {
        issues.push("wallet.privyAllowedOrigins.developmentFallbackAppIdUsed must not be true");
      }
      if (!hasIsoTimestamp(privyAllowedOrigins.checkedAt)) {
        issues.push("wallet.privyAllowedOrigins.checkedAt must be ISO-8601 UTC");
      }
    }

    const wrongNetwork = manifest.wallet?.wrongNetwork;
    if (isPlainObject(wrongNetwork) && wrongNetwork.unsupportedChainWarningVisible !== true) {
      issues.push("wallet.wrongNetwork.unsupportedChainWarningVisible must be true");
    }
    if (isPlainObject(wrongNetwork)) {
      const wrongTargetChainId = positiveInteger(wrongNetwork.targetChainId);
      const testedChainId = positiveInteger(wrongNetwork.testedChainId);
      if (wrongTargetChainId == null) {
        issues.push("wallet.wrongNetwork.targetChainId must be a positive integer");
      } else if (targetChainId && wrongTargetChainId !== targetChainId) {
        issues.push("wallet.wrongNetwork.targetChainId must match targetChainId");
      }
      if (testedChainId == null) {
        issues.push("wallet.wrongNetwork.testedChainId must be a positive integer");
      } else if (targetChainId && testedChainId === targetChainId) {
        issues.push("wallet.wrongNetwork.testedChainId must differ from targetChainId");
      }
    }

    const betHistoryFields = manifest.supportAuditVisibility?.betHistoryFields;
    if (isPlainObject(betHistoryFields) && !includesAll(betHistoryFields.fields, REQUIRED_BET_HISTORY_FIELDS)) {
      issues.push(`supportAuditVisibility.betHistoryFields.fields must include ${REQUIRED_BET_HISTORY_FIELDS.join(", ")}`);
    }

    const autoMinerLogFields = manifest.supportAuditVisibility?.autoMinerLogFields;
    if (isPlainObject(autoMinerLogFields) && !includesAll(autoMinerLogFields.fields, REQUIRED_AUTOMINER_LOG_FIELDS)) {
      issues.push(`supportAuditVisibility.autoMinerLogFields.fields must include ${REQUIRED_AUTOMINER_LOG_FIELDS.join(", ")}`);
    }

    console.log("## Required Checks");
    printTable(["Group", "Check", "Status OK", "Evidence"], rows);
  }
}

console.log("");
console.log(`Summary: ${issues.length === 0 ? "QA proof completed without detected issues" : `${issues.length} issue(s): ${issues.join("; ")}`}.`);
console.log("Copy this summary into `docs/mainnet-proof-record.md` only after confirming the manifest reflects real wallet, UX, browser, and mobile QA.");

if (strict && issues.length > 0) {
  process.exitCode = 1;
}
