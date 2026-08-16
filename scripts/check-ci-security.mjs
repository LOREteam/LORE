import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_WORKFLOW_PATH = path.resolve(process.cwd(), ".github/workflows/ci.yml");
export const MAX_CI_WORKFLOW_BYTES = 256 * 1024;

export function readCiWorkflow({
  workflowPath = DEFAULT_WORKFLOW_PATH,
  exists = existsSync,
  stat = statSync,
  read = readFileSync,
} = {}) {
  if (!exists(workflowPath)) {
    return { source: "", issues: ["CI workflow is missing"] };
  }
  try {
    const stats = stat(workflowPath);
    if (!stats.isFile()) {
      return { source: "", issues: ["CI workflow path is not a file"] };
    }
    if (stats.size > MAX_CI_WORKFLOW_BYTES) {
      return { source: "", issues: ["CI workflow is too large to validate safely"] };
    }
    return { source: read(workflowPath, "utf8"), issues: [] };
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

function stepBlocksAfter(source, usesNeedle) {
  const lines = source.split(/\r?\n/);
  const blocks = [];
  for (let usesIndex = 0; usesIndex < lines.length; usesIndex += 1) {
    if (!lines[usesIndex].includes(`uses: ${usesNeedle}`)) continue;
    const block = [];
    for (let index = usesIndex; index < lines.length; index += 1) {
      if (index > usesIndex && /^\s{6}-\s+name:/.test(lines[index])) break;
      block.push(lines[index]);
    }
    blocks.push(block.join("\n"));
  }
  return blocks;
}

function jobBlock(source, jobName) {
  const lines = source.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => line === `  ${jobName}:`);
  if (startIndex < 0) return "";
  const block = [];
  for (let index = startIndex; index < lines.length; index += 1) {
    if (index > startIndex && /^\s{2}[a-z0-9_-]+:\s*$/i.test(lines[index])) break;
    block.push(lines[index]);
  }
  return block.join("\n");
}

function npmRunScripts(source) {
  return source
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^run:\s+/, ""))
    .filter((line) => /^npm run [a-z0-9:._-]+$/i.test(line))
    .map((line) => line.slice("npm run ".length));
}

function sameOrderedValues(actual, expected) {
  return actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function artifactPaths(stepBlock) {
  const lines = stepBlock.split(/\r?\n/);
  const pathIndex = lines.findIndex((line) => /^\s+path:\s*\|\s*$/.test(line));
  if (pathIndex < 0) return [];
  const pathIndent = lines[pathIndex].match(/^\s*/)?.[0].length ?? 0;
  const paths = [];
  for (let index = pathIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    const indent = line.match(/^\s*/)?.[0].length ?? 0;
    if (indent <= pathIndent) break;
    paths.push(line.trim());
  }
  return paths;
}

function hasExactPaths(stepBlock, expectedPaths) {
  const actualPaths = artifactPaths(stepBlock);
  if (actualPaths.length !== expectedPaths.length) return false;
  const actual = new Set(actualPaths);
  return actual.size === expectedPaths.length && expectedPaths.every((entry) => actual.has(entry));
}

export function assessCiSecuritySource(source, initialIssues = []) {
  const issues = [...initialIssues];
  let weeklySchedule = false;
  let safeConcurrency = false;
  let jobTimeouts = false;
  let ubuntuNonSchedule = false;
  let windowsNonSchedule = false;
  let windowsCompact = false;
  let p1HardeningRows = false;
  let explicitIndexerStorage = false;
  let scheduledDependencyAudit = false;
  let artifactPathsStrict = false;
  let allCheckoutCredentialsDisabled = false;

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

  const checkoutBlocks = stepBlocksAfter(source, "actions/checkout@");
  allCheckoutCredentialsDisabled = checkoutBlocks.length > 0
    && checkoutBlocks.every((block) => /persist-credentials:\s*false/.test(block));
  if (checkoutBlocks.length === 0) {
    issues.push("CI must include an explicit actions/checkout step");
  } else if (!allCheckoutCredentialsDisabled) {
    issues.push("Every CI checkout must set persist-credentials: false");
  }

  weeklySchedule = /^\s{2}schedule:\s*$[\s\S]*?^\s{4}-\s+cron:\s*["']17 4 \* \* 1["']\s*$/m.test(source);
  if (!weeklySchedule) {
    issues.push("CI must run the dependency audit on the reviewed weekly schedule");
  }

  safeConcurrency = /^concurrency:\s*$[\s\S]*?^\s{2}group:\s*\$\{\{ github\.workflow \}\}-\$\{\{ github\.event_name \}\}-\$\{\{ github\.ref \}\}\s*$[\s\S]*?^\s{2}cancel-in-progress:\s*\$\{\{ github\.event_name != 'schedule' \}\}\s*$/m.test(source);
  if (!safeConcurrency) {
    issues.push("CI concurrency must isolate event/ref groups and preserve scheduled audits");
  }

  const ubuntuBlock = jobBlock(source, "checks");
  const windowsBlock = jobBlock(source, "checks-windows");
  const dependencyAuditBlock = jobBlock(source, "dependency-audit");

  ubuntuNonSchedule = /^\s{4}if:\s*github\.event_name != 'schedule'\s*$/m.test(ubuntuBlock)
    && /^\s{4}runs-on:\s*ubuntu-latest\s*$/m.test(ubuntuBlock)
    && /npm run smoke:browser/.test(ubuntuBlock);
  if (!ubuntuNonSchedule) {
    issues.push("The Ubuntu checks job must remain non-scheduled and retain browser smoke coverage");
  }

  windowsNonSchedule = /^\s{4}if:\s*github\.event_name != 'schedule'\s*$/m.test(windowsBlock)
    && /^\s{4}runs-on:\s*windows-latest\s*$/m.test(windowsBlock)
    && !/npm run smoke:browser|npm run start|SMOKE_BROWSER_EXECUTABLE|mkdir -p|\btrap\b/.test(windowsBlock);
  if (!windowsNonSchedule) {
    issues.push("The Windows checks job must be non-scheduled and must not use the POSIX browser launch path");
  }

  const requiredWindowsRunScripts = [
    "proof:wallet-deps:summary",
    "proof:ci-security:summary",
    "lint:summary",
    "typecheck:summary",
    "test:logic:summary",
    "test:p1-hardening:summary",
    "perf:p1:self-test",
    "test:contract:v10:summary",
    "proof:contract-compile:v10:summary",
    "test:indexer-storage:summary",
    "test:db-operations:summary",
    "test:monitoring:summary",
    "build:summary",
  ];
  const ubuntuRunScripts = npmRunScripts(ubuntuBlock);
  const windowsRunScripts = npmRunScripts(windowsBlock);
  windowsCompact = sameOrderedValues(windowsRunScripts, requiredWindowsRunScripts);
  if (!windowsCompact) {
    issues.push("The Windows checks job must run exactly the reviewed compact command rows in order");
  }

  p1HardeningRows = ubuntuRunScripts.filter((scriptName) => scriptName === "test:p1-hardening:all").length === 1
    && ubuntuRunScripts.filter((scriptName) => scriptName === "perf:p1:self-test").length === 1
    && windowsRunScripts.filter((scriptName) => scriptName === "test:p1-hardening:summary").length === 1
    && windowsRunScripts.filter((scriptName) => scriptName === "perf:p1:self-test").length === 1;
  if (!p1HardeningRows) {
    issues.push("Ubuntu and Windows CI must retain their reviewed P1 hardening and performance self-test rows");
  }

  explicitIndexerStorage = ubuntuBlock.includes("npm run test:indexer-storage:summary")
    && windowsBlock.includes("npm run test:indexer-storage:summary");
  if (!explicitIndexerStorage) {
    issues.push("Ubuntu and Windows CI must each run the explicit indexer storage summary row");
  }

  jobTimeouts = /^\s{4}timeout-minutes:\s*60\s*$/m.test(ubuntuBlock)
    && /^\s{4}timeout-minutes:\s*60\s*$/m.test(windowsBlock)
    && /^\s{4}timeout-minutes:\s*15\s*$/m.test(dependencyAuditBlock);
  if (!jobTimeouts) {
    issues.push("CI jobs must retain bounded 60/60/15 minute timeouts");
  }

  scheduledDependencyAudit = /^\s{4}if:\s*github\.event_name == 'schedule'\s*$/m.test(dependencyAuditBlock)
    && /^\s{4}runs-on:\s*ubuntu-latest\s*$/m.test(dependencyAuditBlock)
    && /id:\s*dependency_install/.test(dependencyAuditBlock)
    && /npm --silent run proof:deps:summary \| tee \.tmp\/dependency-audit-production\.json/.test(dependencyAuditBlock)
    && /npm --silent run proof:deps:all:summary \| tee \.tmp\/dependency-audit-all\.json/.test(dependencyAuditBlock)
    && (dependencyAuditBlock.match(/^\s{8}shell:\s*bash\s*$/gm)?.length ?? 0) === 2
    && (dependencyAuditBlock.match(/always\(\) && steps\.dependency_install\.outcome == 'success'/g)?.length ?? 0) >= 3;
  if (!scheduledDependencyAudit) {
    issues.push("The scheduled dependency job must run and retain both compact dependency audit gates after clean install");
  }

  const provenancePaths = [
    ".tmp/contract-compilation-provenance-v10.json",
  ];
  const dependencyAuditPaths = [
    ".tmp/dependency-audit-production.json",
    ".tmp/dependency-audit-all.json",
  ];
  const ubuntuArtifactBlocks = stepBlocksAfter(ubuntuBlock, "actions/upload-artifact@");
  const windowsArtifactBlocks = stepBlocksAfter(windowsBlock, "actions/upload-artifact@");
  const dependencyArtifactBlocks = stepBlocksAfter(dependencyAuditBlock, "actions/upload-artifact@");
  const artifactBlocks = [
    ...ubuntuArtifactBlocks,
    ...windowsArtifactBlocks,
    ...dependencyArtifactBlocks,
  ];
  const artifactSettingsStrict = artifactBlocks.length === 3
    && artifactBlocks.every((block) => (
      /if-no-files-found:\s*error/.test(block)
      && /retention-days:\s*7/.test(block)
      && /include-hidden-files:\s*true/.test(block)
      && artifactPaths(block).every((entry) => !/[?*]/.test(entry))
    ));
  artifactPathsStrict = artifactSettingsStrict
    && ubuntuArtifactBlocks.length === 1
    && windowsArtifactBlocks.length === 1
    && dependencyArtifactBlocks.length === 1
    && hasExactPaths(ubuntuArtifactBlocks[0], provenancePaths)
    && hasExactPaths(windowsArtifactBlocks[0], provenancePaths)
    && hasExactPaths(dependencyArtifactBlocks[0], dependencyAuditPaths);
  if (!artifactPathsStrict) {
    issues.push("CI artifacts must use exact reviewed paths, seven-day retention, and explicit hidden-file inclusion");
  }
  }

  const result = {
  status: issues.length === 0 ? "pass" : "fail",
  workflow: ".github/workflows/ci.yml",
  permissionsReadOnly: /^\s*permissions:\s*$/m.test(source) && /^\s{2}contents:\s*read\s*$/m.test(source),
  pullRequestTarget: /\bpull_request_target\b/.test(source),
  usesPinned: source ? lineValues(source, /^\s*uses:\s+\S+/).every(({ line }) => /@[0-9a-f]{40}(?:\s|$)/.test(line)) : false,
  checkoutPersistCredentialsFalse: allCheckoutCredentialsDisabled,
  weeklySchedule,
  safeConcurrency,
  jobTimeouts,
  ubuntuNonSchedule,
  windowsNonSchedule,
  windowsCompact,
  p1HardeningRows,
  explicitIndexerStorage,
  scheduledDependencyAudit,
  artifactPathsStrict,
  issues,
  };
  return result;
}

function compactCiSecurityResult(result) {
  return {
    status: result.status,
    permissionsReadOnly: result.permissionsReadOnly,
    pullRequestTarget: result.pullRequestTarget,
    usesPinned: result.usesPinned,
    checkoutPersistCredentialsFalse: result.checkoutPersistCredentialsFalse,
    weeklySchedule: result.weeklySchedule,
    safeConcurrency: result.safeConcurrency,
    jobTimeouts: result.jobTimeouts,
    ubuntuNonSchedule: result.ubuntuNonSchedule,
    windowsNonSchedule: result.windowsNonSchedule,
    windowsCompact: result.windowsCompact,
    p1HardeningRows: result.p1HardeningRows,
    explicitIndexerStorage: result.explicitIndexerStorage,
    scheduledDependencyAudit: result.scheduledDependencyAudit,
    artifactPathsStrict: result.artifactPathsStrict,
    issues: result.issues.length,
  };
}

export function runCiSecurityCli({
  argv = process.argv.slice(2),
  readWorkflow = readCiWorkflow,
  log = console.log,
} = {}) {
  const { source, issues } = readWorkflow();
  const result = assessCiSecuritySource(source, issues);
  const summaryOnly = argv.includes("--summary-only");
  log(JSON.stringify(summaryOnly ? compactCiSecurityResult(result) : result, null, summaryOnly ? 0 : 2));
  return { exitCode: result.issues.length > 0 ? 1 : 0, result };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  process.exitCode = runCiSecurityCli().exitCode;
}
