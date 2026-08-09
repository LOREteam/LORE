import { spawnSync } from "node:child_process";
import { redactProofText } from "./redact-proof-output.mjs";
import { parseSummaryTimeoutEnv } from "./summary-timeout.mjs";

const npmCommand = process.env.npm_execpath ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
const buildArgs = process.env.npm_execpath
  ? [process.env.npm_execpath, "--silent", "run", "build"]
  : ["--silent", "run", "build"];
const timeoutMs = parseSummaryTimeoutEnv("BUILD_SUMMARY_TIMEOUT_MS", 600_000, { max: 1_800_000 });
const MAX_SUMMARY_MATCH_COUNT = 9999;

const result = spawnSync(npmCommand, buildArgs, {
  cwd: process.cwd(),
  encoding: "utf8",
  maxBuffer: 4 * 1024 * 1024,
  timeout: timeoutMs,
  env: {
    ...process.env,
    NO_UPDATE_NOTIFIER: "1",
    npm_config_update_notifier: "false",
    npm_config_fund: "false",
  },
});

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
  const kinds = [];
  if (/ExperimentalWarning:\s+SQLite is an experimental feature/i.test(text)) {
    kinds.push("sqlite-experimental");
  }
  return kinds;
}

function classifyBuildNoticeKinds(text) {
  const kinds = [];
  if (/Using edge runtime on a page currently disables static generation for that page/i.test(text)) {
    kinds.push("edge-runtime-static-generation-disabled");
  }
  return kinds;
}

function countBuildWarningKindOccurrences(text) {
  const sqliteExperimental = countMatches(text, /ExperimentalWarning:\s+SQLite is an experimental feature/gi);
  return sqliteExperimental > 0 ? { "sqlite-experimental": sqliteExperimental } : {};
}

const output = redactProofText(`${result.stdout ?? ""}\n${result.stderr ?? ""}`);
const timedOut = result.error?.code === "ETIMEDOUT";
const outputTooLarge = result.error?.code === "ENOBUFS";
const compiled = /Compiled successfully/.test(output);
const proxy = /Proxy \(Middleware\)/.test(output);
const errors = countMatches(output, /\b(?:error|failed)\b/gi);
const warnings = countMatches(output, /\bwarn(?:ing)?\b/gi);
const warningKinds = classifyBuildWarningKinds(output);
const noticeKinds = classifyBuildNoticeKinds(output);
const warningKindCounts = countBuildWarningKindOccurrences(output);
const classifiedWarnings = Object.values(warningKindCounts).reduce((total, count) => total + count, 0);
const unclassifiedWarnings = Math.max(0, warnings - classifiedWarnings);
const hasUnclassifiedWarnings = unclassifiedWarnings > 0;
const issue = outputTooLarge
  ? "build-output-too-large"
  : hasUnclassifiedWarnings
    ? "build-unclassified-warnings"
    : !outputTooLarge && result.error && result.error.code !== "ETIMEDOUT"
      ? "build-spawn-failed"
      : undefined;
const pass = result.status === 0
  && compiled
  && proxy
  && !timedOut
  && !outputTooLarge
  && !hasUnclassifiedWarnings;

console.log(JSON.stringify({
  status: pass ? "pass" : "fail",
  compiled,
  proxy,
  warnings,
  warningKinds,
  warningKindCounts,
  classifiedWarnings,
  unclassifiedWarnings,
  notices: noticeKinds.length,
  noticeKinds,
  errors,
  timedOut,
  ...(issue ? { issue } : {}),
}));

if (!pass) {
  process.exitCode = 1;
}
