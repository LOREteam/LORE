import { spawnSync } from "node:child_process";
import { redactProofText } from "./redact-proof-output.mjs";

const npmCommand = process.env.npm_execpath ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
const eslintArgs = process.env.npm_execpath
  ? [process.env.npm_execpath, "exec", "--", "eslint", ".", "--format", "json"]
  : ["exec", "--", "eslint", ".", "--format", "json"];
const result = spawnSync(npmCommand, eslintArgs, {
  cwd: process.cwd(),
  encoding: "utf8",
  maxBuffer: 2 * 1024 * 1024,
  env: {
    ...process.env,
    NO_UPDATE_NOTIFIER: "1",
    npm_config_update_notifier: "false",
    npm_config_fund: "false",
  },
});

function clamp(value, max = 180) {
  const safe = redactProofText(String(value ?? "")).replace(/\s+/g, " ").trim();
  return safe.length > max ? `${safe.slice(0, max - 3)}...` : safe;
}

function summarizeJson(output) {
  const parsed = JSON.parse(output || "[]");
  if (!Array.isArray(parsed)) throw new Error("eslint-json-not-array");
  let filesWithIssues = 0;
  let errorCount = 0;
  let warningCount = 0;
  const ruleIds = new Map();
  for (const entry of parsed) {
    const messages = Array.isArray(entry?.messages) ? entry.messages : [];
    if (messages.length > 0) filesWithIssues += 1;
    for (const message of messages) {
      errorCount += message?.severity === 2 ? 1 : 0;
      warningCount += message?.severity === 1 ? 1 : 0;
      const ruleId = typeof message?.ruleId === "string" && /^[a-z0-9@/_-]{1,80}$/i.test(message.ruleId)
        ? message.ruleId
        : "unknown";
      ruleIds.set(ruleId, (ruleIds.get(ruleId) ?? 0) + 1);
    }
  }
  return {
    status: errorCount === 0 && result.status === 0 ? "pass" : "fail",
    filesChecked: parsed.length,
    filesWithIssues,
    errors: errorCount,
    warnings: warningCount,
    ruleIds: [...ruleIds.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, 8)
      .map(([ruleId, count]) => `${ruleId}:${count}`),
  };
}

let summary;
try {
  summary = summarizeJson(result.stdout ?? "");
} catch (error) {
  summary = {
    status: "fail",
    filesChecked: 0,
    filesWithIssues: 0,
    errors: 0,
    warnings: 0,
    ruleIds: [],
    issue: result.error?.code === "ENOBUFS"
      ? "eslint-output-too-large"
      : clamp(error instanceof Error ? error.message : String(error)),
  };
}

if (result.error && result.error.code !== "ENOBUFS") {
  summary = {
    ...summary,
    status: "fail",
    issue: clamp(result.error.message),
  };
}

console.log(JSON.stringify(summary));

if (summary.status !== "pass" || result.status !== 0) {
  process.exitCode = 1;
}
