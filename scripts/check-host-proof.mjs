import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

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

const requiredProcesses = ["lore-site", "lore-bot", "lore-indexer"];
const expectedProcessCommands = new Map([
  ["lore-site", /\brun start(?:\s|$)/],
  ["lore-bot", /\brun bot(?:\s|$)/],
  ["lore-indexer", /\brun indexer(?:\s|$)/],
]);
const TEMPLATE_VALUE_RE = /REPLACE_|<REDACTED>|TODO|TBD/i;
const secretKeyPattern = /(secret|private[_-]?key|mnemonic|webhook|dsn|api[_-]?key|api[_-]?token|auth[_-]?token|access[_-]?token|bearer|session|cookie|password)/i;

function env(name) {
  return process.env[name]?.trim() || "";
}

function argOrEnv(argName, envName, fallback) {
  return args.get(argName)?.trim() || env(envName) || fallback;
}

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
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

function hasEvidence(value) {
  if (!isPlainObject(value)) return false;
  return [
    value.evidence,
    value.evidencePath,
    value.link,
    value.summary,
    value.artifact,
    value.notes,
    value.logPath,
    value.reportPath,
    value.commandOutputPath,
  ].some(hasRealText);
}

function hasConcreteText(value) {
  if (!hasRealText(value)) return false;
  const text = String(value).trim();
  return /https?:\/\//i.test(text) ||
    /(?:^|[\\/\s])[^\s]+\.(?:json|jsonl|log|md|txt|csv)(?:\b|$)/i.test(text) ||
    /\bnpm(?:\.cmd)?\s+run\b/i.test(text) ||
    /\bproof:[a-z0-9:-]+\b/i.test(text) ||
    /\b(?:pm2|systemctl|journalctl|docker\s+compose)\b/i.test(text) ||
    /\b(?:finalityLagBlocks|requestCount|p95|TOTAL)=?\b/i.test(text);
}

function hasConcreteEvidence(value) {
  if (!isPlainObject(value)) return false;
  return [
    value.evidencePath,
    value.link,
    value.artifact,
    value.logPath,
    value.reportPath,
    value.commandOutputPath,
    value.evidence,
    value.summary,
    value.notes,
  ].some(hasConcreteText);
}

function localArtifactPathFromText(value, key = "") {
  if (!hasRealText(value)) return "";
  const text = String(value).trim().replace(/^`|`$/g, "");
  if (/^https?:\/\//i.test(text)) return "";
  const artifactMatch = text.match(/^artifact:\s*(.+)$/i);
  const candidate = (artifactMatch ? artifactMatch[1] : text).trim().replace(/^`|`$/g, "");
  if (/^https?:\/\//i.test(candidate)) return "";
  const keySuggestsPath = /(?:evidencePath|artifact|logPath|reportPath|commandOutputPath|link)$/i.test(key);
  const valueLooksLikePath = /(?:^|[\\/\s])[^\s]+\.(?:json|jsonl|log|md|txt|csv)(?:\b|$)/i.test(candidate);
  return (artifactMatch || keySuggestsPath) && valueLooksLikePath ? candidate : "";
}

function findMissingLocalArtifactRefs(value, path = "$", key = "") {
  const findings = [];
  if (Array.isArray(value)) {
    value.forEach((entry, index) => findings.push(...findMissingLocalArtifactRefs(entry, `${path}[${index}]`, key)));
    return findings;
  }
  if (typeof value === "string") {
    const artifactPath = localArtifactPathFromText(value, key);
    if (artifactPath && !existsSync(resolve(process.cwd(), artifactPath))) {
      findings.push(`${path} -> ${artifactPath}`);
    }
    return findings;
  }
  if (!isPlainObject(value)) return findings;
  for (const [childKey, entry] of Object.entries(value)) {
    findings.push(...findMissingLocalArtifactRefs(entry, `${path}.${childKey}`, childKey));
  }
  return findings;
}

function hasNumericFinalityLagEvidence(value) {
  if (!isPlainObject(value)) return false;
  const text = [value.evidence, value.summary, value.notes, value.artifact, value.logPath, value.reportPath]
    .filter(hasRealText)
    .join("\n");
  const match = text.match(/\bfinalityLagBlocks=([^\s]+)/i);
  return Boolean(match && Number.isFinite(Number(match[1])));
}

function statusOk(value) {
  return ["ok", "pass", "passed", "healthy", "success", "green", "running"].includes(String(value ?? "").trim().toLowerCase());
}

function asFiniteNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizedOrigin(value) {
  if (!hasRealText(value)) return "";
  try {
    return new URL(String(value).trim()).origin.toLowerCase();
  } catch {
    return "";
  }
}

function originMatches(value, expectedOrigin) {
  const actual = normalizedOrigin(value);
  const expected = normalizedOrigin(expectedOrigin);
  return Boolean(actual && expected && actual === expected);
}

function evidenceText(value) {
  if (!isPlainObject(value)) return "";
  return [
    value.evidence,
    value.summary,
    value.notes,
    value.artifact,
    value.logPath,
    value.reportPath,
    value.commandOutputPath,
  ].filter(hasRealText).join("\n");
}

function healthEvidenceBaseMatches(value, expectedOrigin) {
  const expected = normalizedOrigin(expectedOrigin);
  if (!expected) return false;
  const text = evidenceText(value);
  const matches = [...text.matchAll(/\bbase=([^\s|]+)/gi)];
  return matches.some((match) => normalizedOrigin(match[1]) === expected);
}

function loadEvidenceBaseMatches(value, expectedOrigin) {
  const expected = normalizedOrigin(expectedOrigin);
  if (!expected) return false;
  const text = evidenceText(value);
  const matches = [...text.matchAll(/^\s*Load base URL:\s*([^\s|]+)/gim)];
  return matches.some((match) => normalizedOrigin(match[1]) === expected);
}

function configuredSiteOrigin() {
  return env("NEXT_PUBLIC_SITE_URL") || env("PUBLIC_SITE_URL") || env("SITE_URL");
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

function normalizeCommand(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

function isAnyPlatformAbsolute(filePath) {
  const value = String(filePath ?? "").trim();
  return isAbsolute(value) || /^[a-zA-Z]:[\\/]/.test(value) || /^\\\\/.test(value) || value.startsWith("/");
}

function pathStatus(filePath) {
  const value = String(filePath ?? "").trim();
  const absolute = isAnyPlatformAbsolute(value) ? resolve(value) : resolve(process.cwd(), value || ".");
  const relativeToRepo = relative(process.cwd(), absolute);
  return {
    isAbsolute: isAnyPlatformAbsolute(value),
    insideRepo: relativeToRepo === "" || (!relativeToRepo.startsWith("..") && !isAbsolute(relativeToRepo)),
  };
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

function printTable(headers, rows) {
  console.log(`| ${headers.join(" | ")} |`);
  console.log(`| ${headers.map(() => "---").join(" | ")} |`);
  for (const row of rows) console.log(`| ${row.join(" | ")} |`);
}

const manifestPath = resolve(process.cwd(), argOrEnv("file", "HOST_PROOF_PATH", "docs/host-proof.json"));
const issues = [];
let manifest = null;

console.log("# Production Host Proof Summary");
console.log("");
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log(`Strict: ${strict ? "yes" : "no"}`);
console.log(`Manifest: ${manifestPath}`);
console.log("");

if (strict && /\.draft\.json$/i.test(manifestPath)) {
  issues.push("draft proof manifests are not accepted as launch proof");
}

if (!existsSync(manifestPath)) {
  issues.push("host proof manifest is missing");
} else {
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    issues.push(`host proof manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (manifest) {
  if (!isPlainObject(manifest)) {
    issues.push("host proof manifest must be an object");
  } else {
    const secretFindings = findSecretLikeValues(manifest);
    if (secretFindings.length > 0) {
      issues.push(`secret-like values must be redacted: ${secretFindings.slice(0, 5).join(", ")}`);
    }
    const templateFindings = findTemplateLikeValues(manifest);
    if (templateFindings.length > 0) {
      issues.push(`template placeholder values must be replaced: ${templateFindings.slice(0, 5).join(", ")}`);
    }
    const missingArtifactRefs = findMissingLocalArtifactRefs(manifest);
    if (missingArtifactRefs.length > 0) {
      issues.push(`local host artifact references must exist: ${missingArtifactRefs.slice(0, 5).join(", ")}`);
    }

    const origin = manifest.origin;
    const hostType = String(manifest.hostType ?? "").trim().toLowerCase();
    if (hostType !== "production") {
      issues.push("hostType must be production for launch host proof");
    }
    if (!hasRealText(origin) || !isFinalHttpsOrigin(origin)) {
      issues.push("origin must be a final HTTPS origin without path, query, or hash");
    }
    const expectedOrigin = configuredSiteOrigin();
    if (expectedOrigin && normalizedOrigin(origin) && normalizedOrigin(expectedOrigin) !== normalizedOrigin(origin)) {
      issues.push("origin must match configured production origin");
    }

    const processModel = isPlainObject(manifest.processModel) ? manifest.processModel : {};
    if (!isPlainObject(manifest.processModel)) issues.push("processModel section is missing");
    if (!hasRealText(processModel.supervisor)) issues.push("processModel.supervisor is missing");
    const processCommands = [];
    for (const name of requiredProcesses) {
      const process = processModel[name];
      if (!isPlainObject(process)) {
        issues.push(`processModel.${name} is missing`);
        continue;
      }
      if (process.supervised !== true) issues.push(`processModel.${name}.supervised must be true`);
      if (process.running !== true && !statusOk(process.status)) issues.push(`processModel.${name} must be running`);
      if (!hasRealText(process.command)) {
        issues.push(`processModel.${name}.command is missing`);
      } else {
        const command = normalizeCommand(process.command);
        processCommands.push([name, command]);
        if (!expectedProcessCommands.get(name)?.test(command)) {
          issues.push(`processModel.${name}.command must match the expected launch role command`);
        }
      }
      if (!hasIsoTimestamp(process.checkedAt)) {
        issues.push(`processModel.${name}.checkedAt must be ISO-8601 UTC`);
      }
      if (!hasEvidence(process)) issues.push(`processModel.${name} has no evidence`);
      if (hasEvidence(process) && !hasConcreteEvidence(process)) {
        issues.push(`processModel.${name} must include concrete supervisor evidence path, link, artifact, command output, or pm2/systemd/docker marker`);
      }
    }
    const commandCounts = new Map();
    for (const [, command] of processCommands) {
      commandCounts.set(command, (commandCounts.get(command) ?? 0) + 1);
    }
    for (const [name, command] of processCommands) {
      if (commandCounts.get(command) > 1) {
        issues.push(`processModel.${name}.command must be distinct from the other launch processes`);
      }
    }

    const persistentDb = isPlainObject(manifest.persistentDb) ? manifest.persistentDb : {};
    if (!isPlainObject(manifest.persistentDb)) issues.push("persistentDb section is missing");
    if (persistentDb.absolutePathOutsideRepo !== true) issues.push("persistentDb.absolutePathOutsideRepo must be true");
    if (persistentDb.restartSurvived !== true) issues.push("persistentDb.restartSurvived must be true");
    if (persistentDb.rebootSurvived !== true) issues.push("persistentDb.rebootSurvived must be true");
    if (!hasRealText(persistentDb.path)) issues.push("persistentDb.path is missing");
    if (hasRealText(persistentDb.path)) {
      const dbPath = pathStatus(persistentDb.path);
      if (!dbPath.isAbsolute) issues.push("persistentDb.path must be absolute");
      if (dbPath.insideRepo) issues.push("persistentDb.path must be outside the repo checkout");
    }
    if (!hasIsoTimestamp(persistentDb.checkedAt)) issues.push("persistentDb.checkedAt must be ISO-8601 UTC");
    if (!hasEvidence(persistentDb)) issues.push("persistentDb has no evidence");
    if (hasEvidence(persistentDb) && !hasConcreteEvidence(persistentDb)) {
      issues.push("persistentDb must include concrete restart/reboot persistence evidence path, link, artifact, or command output");
    }

    const healthProd = isPlainObject(manifest.healthProd) ? manifest.healthProd : {};
    if (!isPlainObject(manifest.healthProd)) issues.push("healthProd section is missing");
    if (!statusOk(healthProd.status)) issues.push("healthProd.status must be ok/pass/healthy");
    if (!String(healthProd.command ?? "").includes("health:prod")) issues.push("healthProd.command must record npm run health:prod");
    if (!hasRealText(healthProd.url)) issues.push("healthProd.url is missing");
    if (hasRealText(healthProd.url) && !originMatches(healthProd.url, origin)) {
      issues.push("healthProd.url must match host proof origin");
    }
    if (!healthEvidenceBaseMatches(healthProd, origin)) {
      issues.push("healthProd evidence must include base=<production origin> from health:prod");
    }
    if (healthProd.runtimeHealthPassed !== true) issues.push("healthProd.runtimeHealthPassed must be true");
    if (healthProd.dataSyncHealthPassed !== true) issues.push("healthProd.dataSyncHealthPassed must be true");
    if (healthProd.diagnosticsAuthPassed !== true) issues.push("healthProd.diagnosticsAuthPassed must be true");
    if (healthProd.finalityLagChecked !== true) issues.push("healthProd.finalityLagChecked must be true");
    if (healthProd.jackpotRowsChecked !== true) issues.push("healthProd.jackpotRowsChecked must be true");
    if (!hasIsoTimestamp(healthProd.timestamp)) issues.push("healthProd.timestamp must be ISO-8601 UTC");
    if (!hasEvidence(healthProd)) issues.push("healthProd has no evidence");
    if (hasEvidence(healthProd) && !hasConcreteEvidence(healthProd)) {
      issues.push("healthProd must include concrete health:prod evidence path, link, artifact, command output, or summary marker");
    }
    if (!hasNumericFinalityLagEvidence(healthProd)) {
      issues.push("healthProd evidence must include numeric finalityLagBlocks from health:prod");
    }

    const loadHttp = isPlainObject(manifest.loadHttp) ? manifest.loadHttp : {};
    if (!isPlainObject(manifest.loadHttp)) issues.push("loadHttp section is missing");
    if (!statusOk(loadHttp.status)) issues.push("loadHttp.status must be ok/pass/healthy");
    if (!String(loadHttp.command ?? "").includes("load:http")) issues.push("loadHttp.command must record npm run load:http");
    if (!hasRealText(loadHttp.url)) issues.push("loadHttp.url is missing");
    if (hasRealText(loadHttp.url) && !isFinalHttpsOrigin(loadHttp.url)) {
      issues.push("loadHttp.url must be a non-local HTTPS staging or canary origin without path, query, or hash");
    }
    if (!["staging", "canary"].includes(String(loadHttp.hostType ?? "").trim().toLowerCase())) {
      issues.push("loadHttp.hostType must be staging or canary");
    }
    if (hasRealText(loadHttp.url) && originMatches(loadHttp.url, origin)) {
      issues.push("loadHttp.url must not be the final production origin");
    }
    if (!loadEvidenceBaseMatches(loadHttp, loadHttp.url)) {
      issues.push("loadHttp evidence must include Load base URL matching loadHttp.url from load:http");
    }
    const requestCount = asFiniteNumber(loadHttp.requestCount);
    const errorRate = asFiniteNumber(loadHttp.errorRate);
    const maxErrorRate = asFiniteNumber(loadHttp.maxErrorRate);
    const p95Ms = asFiniteNumber(loadHttp.p95Ms);
    const maxP95Ms = asFiniteNumber(loadHttp.maxP95Ms);
    const durationMs = asFiniteNumber(loadHttp.durationMs);
    const concurrency = asFiniteNumber(loadHttp.concurrency);
    if (requestCount == null || requestCount <= 0) issues.push("loadHttp.requestCount must be positive");
    if (errorRate == null || errorRate < 0 || errorRate > 1) issues.push("loadHttp.errorRate must be between 0 and 1");
    if (maxErrorRate == null || maxErrorRate < 0 || maxErrorRate > 1) issues.push("loadHttp.maxErrorRate must be between 0 and 1");
    if (errorRate != null && maxErrorRate != null && errorRate > maxErrorRate) issues.push("loadHttp.errorRate must be <= maxErrorRate");
    if (p95Ms == null || p95Ms <= 0) issues.push("loadHttp.p95Ms must be positive");
    if (maxP95Ms == null || maxP95Ms <= 0) issues.push("loadHttp.maxP95Ms must be positive");
    if (p95Ms != null && maxP95Ms != null && p95Ms > maxP95Ms) issues.push("loadHttp.p95Ms must be <= maxP95Ms");
    if (durationMs == null || durationMs <= 0) issues.push("loadHttp.durationMs must be positive");
    if (concurrency == null || concurrency <= 0) issues.push("loadHttp.concurrency must be positive");
    if (!hasIsoTimestamp(loadHttp.timestamp)) issues.push("loadHttp.timestamp must be ISO-8601 UTC");
    if (!hasEvidence(loadHttp)) issues.push("loadHttp has no evidence");
    if (hasEvidence(loadHttp) && !hasConcreteEvidence(loadHttp)) {
      issues.push("loadHttp must include concrete load:http evidence path, link, artifact, command output, or summary marker");
    }

    printTable(["Section", "Status"], [
      ["origin", isFinalHttpsOrigin(origin) ? "checked" : "issue"],
      ["processModel", requiredProcesses.every((name) => isPlainObject(processModel[name])) ? "checked" : "issue"],
      ["persistentDb", persistentDb.absolutePathOutsideRepo === true ? "checked" : "issue"],
      ["healthProd", statusOk(healthProd.status) ? "checked" : "issue"],
      ["loadHttp", statusOk(loadHttp.status) ? "checked" : "issue"],
    ]);
  }
}

console.log("");
console.log(`Summary: ${issues.length === 0 ? "production host proof completed without detected issues" : `${issues.length} issue(s): ${issues.join("; ")}`}.`);
console.log("Copy this summary into `docs/mainnet-proof-record.md` only after confirming the manifest reflects the deployed host, process supervisor, health check, and load test evidence.");

if (strict && issues.length > 0) {
  process.exitCode = 1;
}
