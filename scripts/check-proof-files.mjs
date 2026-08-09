import { spawnSync } from "node:child_process";
import { closeSync, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const MAX_CANARY_FIRST_LINE_SCAN_BYTES = 1024 * 1024;
const CANARY_LINE_READ_CHUNK_BYTES = 64 * 1024;
const MAX_PROOF_FILE_JSON_BYTES = 512 * 1024;
const args = new Map(
  process.argv
    .slice(2)
    .filter((arg) => arg.startsWith("--") && arg.includes("="))
    .map((arg) => {
      const [key, ...rest] = arg.slice(2).split("=");
      return [key, rest.join("=")];
    }),
);

const docsDir = path.join(process.cwd(), "docs");
const canaryLogPath = args.get("canary-log") || process.env.PROOF_CANARY_LOG || "";
const requireFinalManifests = process.argv.includes("--strict") || Boolean(canaryLogPath);
const summaryOnly = process.argv.includes("--summary-only");
const expectedFinalManifests = {
  "signoff-proof.json": {
    envName: "SIGNOFF_PROOF_PATH",
    script: "scripts/check-signoff-proof.mjs",
    args: ["--strict"],
  },
  "host-proof.json": {
    envName: "HOST_PROOF_PATH",
    script: "scripts/check-host-proof.mjs",
    args: ["--strict"],
  },
  "indexer-proof.json": {
    envName: "INDEXER_PROOF_PATH",
    script: "scripts/check-indexer-dry-run.mjs",
    args: ["--strict"],
  },
  "restore-proof.json": {
    envName: "RESTORE_PROOF_PATH",
    script: "scripts/verify-db-restore.mjs",
    args: ["--strict"],
  },
  "monitoring-proof.json": {
    envName: "MONITORING_PROOF_PATH",
    script: "scripts/check-monitoring-proof.mjs",
    args: ["--strict"],
  },
  "qa-proof.json": {
    envName: "QA_PROOF_PATH",
    script: "scripts/check-qa-proof.mjs",
    args: ["--strict"],
  },
  "canary-proof.json": {
    envName: "CANARY_PROOF_PATH",
    script: "scripts/analyze-live-canary-proof.mjs",
    args: ["--strict"],
    needsCanaryLog: true,
  },
};
const expectedFinalManifestNames = Object.keys(expectedFinalManifests);
// These files are valid local/testnet evidence, never mainnet launch manifests.
const expectedAuxiliaryProofArtifacts = new Set(["chain-proof-snapshot.json", "testnet-canary-proof.json"]);
const TEMPLATE_VALUE_RE = /REPLACE_|<REDACTED>|TODO|TBD/i;
const secretKeyPattern =
  /(secret|private[_-]?key|mnemonic|webhook|dsn|api[_-]?key|api[_-]?token|auth[_-]?token|access[_-]?token|bearer|session|cookie|password)/i;
const rpcUrlKeyPattern = /^(rpc|rpc[_-]?url|.*rpc.*url)$/i;
const unsafeDiagnosticKeyPattern = /^(?:error|message|diagnostic|reason|cause|stack|rawError|rawMessage)$/i;
const unsafeDiagnosticTextPattern = /(?:https?:\/\/|\b0x[a-fA-F0-9]{40}\b|\b0x[a-fA-F0-9]{80,}\b)/i;

function isPlainObject(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function findTemplateLikeValues(value, valuePath = "$") {
  const findings = [];
  if (Array.isArray(value)) {
    value.forEach((entry, index) => findings.push(...findTemplateLikeValues(entry, `${valuePath}[${index}]`)));
    return findings;
  }
  if (typeof value === "string") {
    if (TEMPLATE_VALUE_RE.test(value)) findings.push(valuePath);
    return findings;
  }
  if (!isPlainObject(value)) return findings;
  for (const [key, entry] of Object.entries(value)) {
    findings.push(...findTemplateLikeValues(entry, `${valuePath}.${key}`));
  }
  return findings;
}

function findSecretLikeValues(value, valuePath = "$") {
  const findings = [];
  if (Array.isArray(value)) {
    value.forEach((entry, index) => findings.push(...findSecretLikeValues(entry, `${valuePath}[${index}]`)));
    return findings;
  }
  if (!isPlainObject(value)) return findings;
  for (const [key, entry] of Object.entries(value)) {
    const childPath = `${valuePath}.${key}`;
    if ((secretKeyPattern.test(key) || (rpcUrlKeyPattern.test(key) && looksLikeUrl(entry))) && typeof entry === "string") {
      const normalized = entry.trim().toLowerCase();
      if (!["", "present", "configured", "redacted", "<redacted>"].includes(normalized)) {
        findings.push(childPath);
      }
    }
    findings.push(...findSecretLikeValues(entry, childPath));
  }
  return findings;
}

function findUnsafeDiagnosticValues(value, valuePath = "$") {
  const findings = [];
  if (Array.isArray(value)) {
    value.forEach((entry, index) => findings.push(...findUnsafeDiagnosticValues(entry, `${valuePath}[${index}]`)));
    return findings;
  }
  if (!isPlainObject(value)) return findings;
  for (const [key, entry] of Object.entries(value)) {
    const childPath = `${valuePath}.${key}`;
    if (
      typeof entry === "string" &&
      unsafeDiagnosticKeyPattern.test(key) &&
      unsafeDiagnosticTextPattern.test(entry)
    ) {
      findings.push(childPath);
    }
    findings.push(...findUnsafeDiagnosticValues(entry, childPath));
  }
  return findings;
}

function looksLikeUrl(value) {
  try {
    new URL(String(value ?? "").trim());
    return true;
  } catch {
    return false;
  }
}

function readFirstNonEmptyLine(filePath) {
  const fd = openSync(filePath, "r");
  const buffer = Buffer.alloc(CANARY_LINE_READ_CHUNK_BYTES);
  let pending = "";
  let scannedBytes = 0;
  try {
    while (scannedBytes < MAX_CANARY_FIRST_LINE_SCAN_BYTES) {
      const bytesToRead = Math.min(buffer.length, MAX_CANARY_FIRST_LINE_SCAN_BYTES - scannedBytes);
      const bytesRead = readSync(fd, buffer, 0, bytesToRead, null);
      if (bytesRead === 0) break;
      scannedBytes += bytesRead;
      pending += buffer.toString("utf8", 0, bytesRead);
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) return line.replace(/^\uFEFF/, "");
      }
    }
  } finally {
    closeSync(fd);
  }

  if (scannedBytes >= MAX_CANARY_FIRST_LINE_SCAN_BYTES && !pending.includes("\n")) {
    throw new Error(`first non-empty JSONL line was not found within ${MAX_CANARY_FIRST_LINE_SCAN_BYTES} bytes`);
  }
  return pending.trim() ? pending.replace(/^\uFEFF/, "") : "";
}

function regularFileStat(filePath) {
  try {
    const stats = statSync(filePath);
    return stats.isFile() ? stats : null;
  } catch {
    return null;
  }
}

function fileExists(filePath) {
  return regularFileStat(filePath) !== null;
}

function readProofJsonFile(filePath, label) {
  const fileStat = regularFileStat(filePath);
  if (!fileStat) {
    return {
      ok: false,
      issue: `${label}: proof JSON file is not a file`,
      summary: "proof JSON file is not a file",
    };
  }
  if (fileStat.size > MAX_PROOF_FILE_JSON_BYTES) {
    return {
      ok: false,
      issue: `${label}: proof JSON file is too large to validate safely`,
      summary: "proof JSON file is too large to validate safely",
    };
  }

  try {
    return { ok: true, value: JSON.parse(readFileSync(filePath, "utf8")) };
  } catch (error) {
    return {
      ok: false,
      issue: `${label}: invalid JSON`,
      summary: error instanceof Error ? error.message : String(error),
    };
  }
}

function printTable(headers, rows) {
  console.log(`| ${headers.join(" | ")} |`);
  console.log(`| ${headers.map(() => "---").join(" | ")} |`);
  for (const row of rows) console.log(`| ${row.join(" | ")} |`);
}

function summarize(output) {
  return output.split(/\r?\n/).find((line) => line.startsWith("Summary:")) ?? output.split(/\r?\n/).find(Boolean) ?? "";
}

function runStrictValidator(config, manifestPath, canaryLogPath) {
  const args = [
    config.script,
    ...(config.needsCanaryLog ? [canaryLogPath] : []),
    ...config.args,
  ];
  const env = {
    ...process.env,
    [config.envName]: manifestPath,
  };
  return spawnSync(process.execPath, args, {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
    maxBuffer: 1024 * 1024,
  });
}

const rows = [];
const issues = [];
const existingDocs = existsSync(docsDir) ? readdirSync(docsDir) : [];
const unexpectedProofFiles = existingDocs
  .filter((name) => /-proof.*\.json$/i.test(name))
  .filter((name) => !expectedFinalManifestNames.includes(name) && !expectedAuxiliaryProofArtifacts.has(name) && !/\.draft\.json$/i.test(name));

for (const name of unexpectedProofFiles) {
  issues.push(`unexpected proof-like JSON file docs/${name}`);
}

if (canaryLogPath) {
  const canaryLogAbsolutePath = path.isAbsolute(canaryLogPath) ? canaryLogPath : path.join(process.cwd(), canaryLogPath);
  let canaryLogStatus = "present";
  let canaryLogTemplateValues = "n/a";
  let canaryLogSecretValues = "n/a";
  let canaryLogUnsafeDiagnostics = "n/a";
  let canaryLogSummary = "clean";
  const recordCanaryLogIssue = (message) => {
    issues.push(message);
    canaryLogStatus = "issue";
    canaryLogSummary = message.replace(/\|/g, "\\|");
  };

  if (!existsSync(canaryLogAbsolutePath)) {
    recordCanaryLogIssue(`canary log does not exist: ${canaryLogPath}`);
  } else {
    const canaryLogStat = regularFileStat(canaryLogAbsolutePath);
    if (!canaryLogStat) {
      recordCanaryLogIssue(`canary log is not a file: ${canaryLogPath}`);
    } else if (!/\.jsonl$/i.test(canaryLogPath)) {
      recordCanaryLogIssue(`canary log must be a .jsonl file: ${canaryLogPath}`);
    } else if (canaryLogStat.size === 0) {
      recordCanaryLogIssue(`canary log is empty: ${canaryLogPath}`);
    } else {
      canaryLogTemplateValues = "no";
      canaryLogSecretValues = "no";
      canaryLogUnsafeDiagnostics = "no";
      let firstNonEmptyCanaryLine = "";
      try {
        firstNonEmptyCanaryLine = readFirstNonEmptyLine(canaryLogAbsolutePath);
      } catch (error) {
        recordCanaryLogIssue(`canary log first JSONL record could not be read safely: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (!firstNonEmptyCanaryLine) {
        recordCanaryLogIssue(`canary log has no non-empty JSONL lines: ${canaryLogPath}`);
      } else {
        try {
          const firstCanaryRecord = JSON.parse(firstNonEmptyCanaryLine);
          if (!isPlainObject(firstCanaryRecord)) {
            recordCanaryLogIssue(`canary log first JSONL record must be an object: ${canaryLogPath}`);
          } else {
            const templateFindings = findTemplateLikeValues(firstCanaryRecord);
            const secretFindings = findSecretLikeValues(firstCanaryRecord);
            const unsafeDiagnosticFindings = findUnsafeDiagnosticValues(firstCanaryRecord);
            const canaryLogProblems = [];
            canaryLogTemplateValues = templateFindings.length === 0 ? "no" : "yes";
            canaryLogSecretValues = secretFindings.length === 0 ? "no" : "yes";
            canaryLogUnsafeDiagnostics = unsafeDiagnosticFindings.length === 0 ? "no" : "yes";
            if (templateFindings.length > 0) {
              issues.push(`canary log first JSONL record has template-like values at ${templateFindings.slice(0, 5).join(", ")}: ${canaryLogPath}`);
              canaryLogProblems.push("template-like values");
            }
            if (secretFindings.length > 0) {
              issues.push(`canary log first JSONL record has secret-like values at ${secretFindings.slice(0, 5).join(", ")}: ${canaryLogPath}`);
              canaryLogProblems.push("secret-like values");
            }
            if (unsafeDiagnosticFindings.length > 0) {
              issues.push(`canary log first JSONL record has unsafe diagnostic values at ${unsafeDiagnosticFindings.slice(0, 5).join(", ")}: ${canaryLogPath}`);
              canaryLogProblems.push("unsafe diagnostic values");
            }
            if (canaryLogProblems.length > 0) {
              canaryLogStatus = "issue";
              canaryLogSummary = canaryLogProblems.join(", ");
            }
          }
        } catch {
          recordCanaryLogIssue(`canary log first non-empty line is not valid JSON: ${canaryLogPath}`);
        }
      }
    }
  }
  rows.push([
    "canary-log",
    canaryLogStatus,
    canaryLogTemplateValues,
    canaryLogSecretValues,
    canaryLogUnsafeDiagnostics,
    "n/a",
    canaryLogSummary,
  ]);
}

for (const name of expectedAuxiliaryProofArtifacts) {
  const filePath = path.join(docsDir, name);
  if (!existsSync(filePath)) continue;
  if (!fileExists(filePath)) {
    issues.push(`${name}: not a file`);
    rows.push([name, "invalid auxiliary", "n/a", "n/a", "n/a", "n/a", "not a file"]);
    continue;
  }

  let artifact;
  const artifactResult = readProofJsonFile(filePath, name);
  if (!artifactResult.ok) {
    issues.push(artifactResult.issue);
    rows.push([name, "invalid auxiliary", "n/a", "n/a", "n/a", "n/a", artifactResult.summary]);
    continue;
  }
  artifact = artifactResult.value;

  const templateFindings = findTemplateLikeValues(artifact);
  const secretFindings = findSecretLikeValues(artifact);
  const unsafeDiagnosticFindings = findUnsafeDiagnosticValues(artifact);
  if (templateFindings.length > 0) {
    issues.push(`${name}: template-like values at ${templateFindings.slice(0, 5).join(", ")}`);
  }
  if (secretFindings.length > 0) {
    issues.push(`${name}: secret-like values at ${secretFindings.slice(0, 5).join(", ")}`);
  }
  if (unsafeDiagnosticFindings.length > 0) {
    issues.push(`${name}: unsafe diagnostic values at ${unsafeDiagnosticFindings.slice(0, 5).join(", ")}`);
  }
  rows.push([
    name,
    "present auxiliary",
    templateFindings.length === 0 ? "no" : "yes",
    secretFindings.length === 0 ? "no" : "yes",
    unsafeDiagnosticFindings.length === 0 ? "no" : "yes",
    "n/a",
    templateFindings.length === 0 && secretFindings.length === 0 && unsafeDiagnosticFindings.length === 0 ? "clean" : "issue",
  ]);
}


for (const name of expectedFinalManifestNames) {
  const validator = expectedFinalManifests[name];
  const filePath = path.join(docsDir, name);
  if (!existsSync(filePath)) {
    if (requireFinalManifests) {
      issues.push(`${name}: missing final proof manifest`);
    }
    rows.push([name, "missing", "n/a", "n/a", "n/a", "n/a", requireFinalManifests ? "required for final proof" : "not yet collected"]);
    continue;
  }
  if (!fileExists(filePath)) {
    issues.push(`${name}: not a file`);
    rows.push([name, "invalid", "n/a", "n/a", "n/a", "n/a", "not a file"]);
    continue;
  }

  let manifest;
  const manifestResult = readProofJsonFile(filePath, name);
  if (!manifestResult.ok) {
    issues.push(manifestResult.issue);
    rows.push([name, "invalid", "n/a", "n/a", "n/a", "n/a", manifestResult.summary]);
    continue;
  }
  manifest = manifestResult.value;

  const templateFindings = findTemplateLikeValues(manifest);
  const secretFindings = findSecretLikeValues(manifest);
  const unsafeDiagnosticFindings = findUnsafeDiagnosticValues(manifest);
  if (templateFindings.length > 0) {
    issues.push(`${name}: template-like values at ${templateFindings.slice(0, 5).join(", ")}`);
  }
  if (secretFindings.length > 0) {
    issues.push(`${name}: secret-like values at ${secretFindings.slice(0, 5).join(", ")}`);
  }
  if (unsafeDiagnosticFindings.length > 0) {
    issues.push(`${name}: unsafe diagnostic values at ${unsafeDiagnosticFindings.slice(0, 5).join(", ")}`);
  }

  let validatorResult = "n/a";
  let validatorSummary = "";
  if (templateFindings.length === 0 && secretFindings.length === 0 && unsafeDiagnosticFindings.length === 0) {
    if (validator.needsCanaryLog && !canaryLogPath) {
      validatorResult = "fail";
      validatorSummary = "provide --canary-log=<path> or PROOF_CANARY_LOG to validate canary proof against live JSONL";
      issues.push(`${name}: ${validatorSummary}`);
    } else {
      const result = runStrictValidator(validator, filePath, canaryLogPath);
      const output = `${result.stdout || ""}\n${result.stderr || ""}`;
      const exitCode = typeof result.status === "number" ? result.status : 1;
      validatorResult = exitCode === 0 ? "pass" : "fail";
      validatorSummary = summarize(output);
      if (exitCode !== 0) {
        issues.push(`${name}: strict validator failed: ${validatorSummary}`);
      }
    }
  }

  rows.push([
    name,
    "present",
    templateFindings.length === 0 ? "no" : "yes",
    secretFindings.length === 0 ? "no" : "yes",
    unsafeDiagnosticFindings.length === 0 ? "no" : "yes",
    validatorResult,
    templateFindings.length === 0 && secretFindings.length === 0 && unsafeDiagnosticFindings.length === 0 && validatorResult !== "fail"
      ? (validatorSummary || "clean").replace(/\|/g, "\\|")
      : "issue",
  ]);
}

console.log("# Proof File Guard");
console.log("");
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log("");
if (summaryOnly) {
  console.log(
    `status=${issues.length === 0 ? "pass" : "fail"}, manifests=${rows.length}, issues=${issues.length}, strict=${requireFinalManifests}, canaryLog=${canaryLogPath ? "present" : "missing"}`,
  );
  console.log(`Summary: ${issues.length === 0 ? (requireFinalManifests ? "all required proof manifest files are present and clean" : "proof manifest files are clean or not yet collected") : `${issues.length} proof file issue(s)`}.`);
} else {
  printTable(["Manifest", "Status", "Template Values", "Secret-like Values", "Unsafe Diagnostics", "Strict Validator", "Summary"], rows);
  console.log("");
  console.log(`Summary: ${issues.length === 0 ? (requireFinalManifests ? "all required proof manifest files are present and clean" : "proof manifest files are clean or not yet collected") : `${issues.length} issue(s): ${issues.join("; ")}`}.`);
}

if (issues.length > 0) {
  process.exitCode = 1;
}
