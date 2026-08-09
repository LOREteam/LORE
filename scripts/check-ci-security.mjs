import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const summaryOnly = process.argv.includes("--summary-only");
const workflowPath = path.resolve(process.cwd(), ".github/workflows/ci.yml");
const MAX_CI_WORKFLOW_BYTES = 256 * 1024;

function readWorkflow() {
  if (!existsSync(workflowPath)) {
    return { source: "", issues: ["CI workflow is missing"] };
  }
  try {
    const stats = statSync(workflowPath);
    if (!stats.isFile()) {
      return { source: "", issues: ["CI workflow path is not a file"] };
    }
    if (stats.size > MAX_CI_WORKFLOW_BYTES) {
      return { source: "", issues: ["CI workflow is too large to validate safely"] };
    }
    return { source: readFileSync(workflowPath, "utf8"), issues: [] };
  } catch {
    return { source: "", issues: ["CI workflow could not be read"] };
  }
}

function lineValues(source, pattern) {
  return source
    .split(/\r?\n/)
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => pattern.test(line));
}

function stepBlockAfter(source, usesNeedle) {
  const lines = source.split(/\r?\n/);
  const usesIndex = lines.findIndex((line) => line.includes(`uses: ${usesNeedle}`));
  if (usesIndex < 0) return "";
  const block = [];
  for (let index = usesIndex; index < lines.length; index += 1) {
    if (index > usesIndex && /^\s{6}-\s+name:/.test(lines[index])) break;
    block.push(lines[index]);
  }
  return block.join("\n");
}

const { source, issues } = readWorkflow();

if (source) {
  if (!/^\s*permissions:\s*$/m.test(source) || !/^\s{2}contents:\s*read\s*$/m.test(source)) {
    issues.push("CI must declare least-privilege top-level permissions with contents: read");
  }
  if (/\bpull_request_target\b/.test(source)) {
    issues.push("CI must not use pull_request_target for untrusted pull request code");
  }
  const writePermissionLines = lineValues(
    source,
    /^\s+(?:actions|checks|contents|deployments|id-token|issues|packages|pull-requests|security-events|statuses):\s*write\s*$/m,
  );
  for (const entry of writePermissionLines) {
    issues.push(`CI must not grant write-scoped GITHUB_TOKEN permissions at line ${entry.number}`);
  }

  const usesLines = lineValues(source, /^\s*uses:\s+\S+/);
  if (usesLines.length === 0) {
    issues.push("CI must keep third-party action steps explicit");
  }
  for (const entry of usesLines) {
    if (!/@[0-9a-f]{40}(?:\s|$)/.test(entry.line)) {
      issues.push(`CI action must be pinned to an immutable reviewed commit at line ${entry.number}`);
    }
  }

  const checkoutBlock = stepBlockAfter(source, "actions/checkout@");
  if (!checkoutBlock) {
    issues.push("CI must include an explicit actions/checkout step");
  } else if (!/persist-credentials:\s*false/.test(checkoutBlock)) {
    issues.push("CI checkout must set persist-credentials: false");
  }
}

const result = {
  status: issues.length === 0 ? "pass" : "fail",
  workflow: ".github/workflows/ci.yml",
  permissionsReadOnly: /^\s*permissions:\s*$/m.test(source) && /^\s{2}contents:\s*read\s*$/m.test(source),
  pullRequestTarget: /\bpull_request_target\b/.test(source),
  usesPinned: source ? lineValues(source, /^\s*uses:\s+\S+/).every(({ line }) => /@[0-9a-f]{40}(?:\s|$)/.test(line)) : false,
  checkoutPersistCredentialsFalse: /persist-credentials:\s*false/.test(stepBlockAfter(source, "actions/checkout@")),
  issues,
};

if (summaryOnly) {
  console.log(JSON.stringify({
    status: result.status,
    permissionsReadOnly: result.permissionsReadOnly,
    pullRequestTarget: result.pullRequestTarget,
    usesPinned: result.usesPinned,
    checkoutPersistCredentialsFalse: result.checkoutPersistCredentialsFalse,
    issues: result.issues.length,
  }));
} else {
  console.log(JSON.stringify(result, null, 2));
}

if (issues.length > 0) process.exitCode = 1;
