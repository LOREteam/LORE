import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { redactProofText } from "./redact-proof-output.mjs";
import { parseSummaryTimeoutEnv } from "./summary-timeout.mjs";

const MAX_SUMMARY_MATCH_COUNT = 9999;

function countMatches(text, pattern) {
  let count = 0;
  pattern.lastIndex = 0;
  let match = pattern.exec(text);
  while (match !== null) {
    count += 1;
    if (count >= MAX_SUMMARY_MATCH_COUNT) return MAX_SUMMARY_MATCH_COUNT;
    if (match[0] === "") pattern.lastIndex += 1;
    match = pattern.exec(text);
  }
  return count;
}

function classifyBuildWarningKinds(text) {
  return /ExperimentalWarning:\s+SQLite is an experimental feature/i.test(text) ? ["sqlite-experimental"] : [];
}

function classifyBuildNoticeKinds(text) {
  return /Using edge runtime on a page currently disables static generation for that page/i.test(text)
    ? ["edge-runtime-static-generation-disabled"] : [];
}

function countBuildWarningKindOccurrences(text) {
  const count = countMatches(text, /ExperimentalWarning:\s+SQLite is an experimental feature/gi);
  return count > 0 ? { "sqlite-experimental": count } : {};
}

export function summarizeBuildResult(result) {
  const output = redactProofText(`${result?.stdout ?? ""}\n${result?.stderr ?? ""}`);
  const timedOut = result?.error?.code === "ETIMEDOUT";
  const outputTooLarge = result?.error?.code === "ENOBUFS";
  const compiled = /Compiled successfully/.test(output);
  const proxy = /Proxy \(Middleware\)/.test(output);
  const errors = countMatches(output, /\b(?:error|failed)\b/gi);
  const warningKinds = classifyBuildWarningKinds(output);
  const noticeKinds = classifyBuildNoticeKinds(output);
  const warningKindCounts = countBuildWarningKindOccurrences(output);
  const classifiedWarnings = Object.values(warningKindCounts).reduce((total, count) => total + count, 0);
  const genericWarningTokens = countMatches(output, /\bwarn(?:ing)?\b/gi);
  const knownWarningCompanions = Math.min(
    classifiedWarnings,
    countMatches(output, /--trace-warnings\b/gi),
  );
  const unclassifiedWarnings = Math.max(0, genericWarningTokens - knownWarningCompanions);
  const warnings = Math.min(MAX_SUMMARY_MATCH_COUNT, classifiedWarnings + unclassifiedWarnings);
  const issue = outputTooLarge ? "build-output-too-large"
    : unclassifiedWarnings > 0 ? "build-unclassified-warnings"
      : result?.error && result.error.code !== "ETIMEDOUT" ? "build-spawn-failed" : undefined;
  const pass = result?.status === 0 && compiled && proxy && !timedOut && !outputTooLarge && unclassifiedWarnings === 0;
  return {
    status: pass ? "pass" : "fail", compiled, proxy, warnings, warningKinds, warningKindCounts,
    classifiedWarnings, unclassifiedWarnings, notices: noticeKinds.length, noticeKinds, errors, timedOut,
    ...(issue ? { issue } : {}),
  };
}

export function runBuildSummary({
  spawn = spawnSync, cwd = process.cwd(), env = process.env, execPath = process.execPath,
  platform = process.platform, writeLine = (line) => console.log(line),
} = {}) {
  const command = env.npm_execpath ? execPath : platform === "win32" ? "npm.cmd" : "npm";
  const args = env.npm_execpath ? [env.npm_execpath, "--silent", "run", "build"] : ["--silent", "run", "build"];
  const result = spawn(command, args, {
    cwd, encoding: "utf8", maxBuffer: 4 * 1024 * 1024,
    timeout: parseSummaryTimeoutEnv("BUILD_SUMMARY_TIMEOUT_MS", 600_000, { max: 1_800_000 }),
    env: { ...env, NO_UPDATE_NOTIFIER: "1", npm_config_update_notifier: "false", npm_config_fund: "false" },
  });
  const summary = summarizeBuildResult(result);
  writeLine(JSON.stringify(summary));
  return { summary, exitCode: summary.status === "pass" ? 0 : 1 };
}

function isDirectRun() {
  return Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  try {
    const { exitCode } = runBuildSummary();
    process.exitCode = exitCode;
  } catch (error) {
    console.log(JSON.stringify({
      status: "fail", issue: "build-summary-config-invalid",
      error: redactProofText(error instanceof Error ? error.message : String(error)).slice(0, 300),
    }));
    process.exitCode = 1;
  }
}
