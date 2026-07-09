import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

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
const expectedAuxiliaryProofArtifacts = new Set(["chain-proof-snapshot.json"]);
const TEMPLATE_VALUE_RE = /REPLACE_|<REDACTED>|TODO|TBD/i;
const secretKeyPattern =
  /(secret|private[_-]?key|mnemonic|webhook|dsn|api[_-]?key|api[_-]?token|auth[_-]?token|access[_-]?token|bearer|session|cookie|password)/i;
const rpcUrlKeyPattern = /^(rpc|rpc[_-]?url|.*rpc.*url)$/i;

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

function looksLikeUrl(value) {
  try {
    new URL(String(value ?? "").trim());
    return true;
  } catch {
    return false;
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
  if (!existsSync(canaryLogAbsolutePath)) {
    issues.push(`canary log does not exist: ${canaryLogPath}`);
  } else if (!statSync(canaryLogAbsolutePath).isFile()) {
    issues.push(`canary log is not a file: ${canaryLogPath}`);
  } else if (!/\.jsonl$/i.test(canaryLogPath)) {
    issues.push(`canary log must be a .jsonl file: ${canaryLogPath}`);
  } else if (statSync(canaryLogAbsolutePath).size === 0) {
    issues.push(`canary log is empty: ${canaryLogPath}`);
  } else {
    const firstNonEmptyCanaryLine = readFileSync(canaryLogAbsolutePath, "utf8").split(/\r?\n/).find((line) => line.trim());
    if (!firstNonEmptyCanaryLine) {
      issues.push(`canary log has no non-empty JSONL lines: ${canaryLogPath}`);
    } else {
      try {
        const firstCanaryRecord = JSON.parse(firstNonEmptyCanaryLine);
        if (!isPlainObject(firstCanaryRecord)) {
          issues.push(`canary log first JSONL record must be an object: ${canaryLogPath}`);
        } else {
          const templateFindings = findTemplateLikeValues(firstCanaryRecord);
          const secretFindings = findSecretLikeValues(firstCanaryRecord);
          if (templateFindings.length > 0) {
            issues.push(`canary log first JSONL record has template-like values at ${templateFindings.slice(0, 5).join(", ")}: ${canaryLogPath}`);
          }
          if (secretFindings.length > 0) {
            issues.push(`canary log first JSONL record has secret-like values at ${secretFindings.slice(0, 5).join(", ")}: ${canaryLogPath}`);
          }
        }
      } catch {
        issues.push(`canary log first non-empty line is not valid JSON: ${canaryLogPath}`);
      }
    }
  }
}

for (const name of expectedAuxiliaryProofArtifacts) {
  const filePath = path.join(docsDir, name);
  if (!existsSync(filePath)) continue;

  let artifact;
  try {
    artifact = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    issues.push(`${name}: invalid JSON`);
    rows.push([name, "invalid auxiliary", "n/a", "n/a", "n/a", error instanceof Error ? error.message : String(error)]);
    continue;
  }

  const templateFindings = findTemplateLikeValues(artifact);
  const secretFindings = findSecretLikeValues(artifact);
  if (templateFindings.length > 0) {
    issues.push(`${name}: template-like values at ${templateFindings.slice(0, 5).join(", ")}`);
  }
  if (secretFindings.length > 0) {
    issues.push(`${name}: secret-like values at ${secretFindings.slice(0, 5).join(", ")}`);
  }
  rows.push([
    name,
    "present auxiliary",
    templateFindings.length === 0 ? "no" : "yes",
    secretFindings.length === 0 ? "no" : "yes",
    "n/a",
    templateFindings.length === 0 && secretFindings.length === 0 ? "clean" : "issue",
  ]);
}


for (const name of expectedFinalManifestNames) {
  const validator = expectedFinalManifests[name];
  const filePath = path.join(docsDir, name);
  if (!existsSync(filePath)) {
    if (requireFinalManifests) {
      issues.push(`${name}: missing final proof manifest`);
    }
    rows.push([name, "missing", "n/a", "n/a", "n/a", requireFinalManifests ? "required for final proof" : "not yet collected"]);
    continue;
  }

  let manifest;
  try {
    manifest = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    issues.push(`${name}: invalid JSON`);
    rows.push([name, "invalid", "n/a", "n/a", "n/a", error instanceof Error ? error.message : String(error)]);
    continue;
  }

  const templateFindings = findTemplateLikeValues(manifest);
  const secretFindings = findSecretLikeValues(manifest);
  if (templateFindings.length > 0) {
    issues.push(`${name}: template-like values at ${templateFindings.slice(0, 5).join(", ")}`);
  }
  if (secretFindings.length > 0) {
    issues.push(`${name}: secret-like values at ${secretFindings.slice(0, 5).join(", ")}`);
  }

  let validatorResult = "n/a";
  let validatorSummary = "";
  if (templateFindings.length === 0 && secretFindings.length === 0) {
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
    validatorResult,
    templateFindings.length === 0 && secretFindings.length === 0 && validatorResult !== "fail"
      ? (validatorSummary || "clean").replace(/\|/g, "\\|")
      : "issue",
  ]);
}

console.log("# Proof File Guard");
console.log("");
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log("");
printTable(["Manifest", "Status", "Template Values", "Secret-like Values", "Strict Validator", "Summary"], rows);
console.log("");
console.log(`Summary: ${issues.length === 0 ? (requireFinalManifests ? "all required proof manifest files are present and clean" : "proof manifest files are clean or not yet collected") : `${issues.length} issue(s): ${issues.join("; ")}`}.`);

if (issues.length > 0) {
  process.exitCode = 1;
}
