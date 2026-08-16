import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { redactProofText } from "./redact-proof-output.mjs";
import { parseSummaryTimeoutEnv } from "./summary-timeout.mjs";

function clamp(value, max = 180) {
  const safe = redactProofText(String(value ?? "")).replace(/\s+/g, " ").trim();
  return safe.length > max ? `${safe.slice(0, max - 3)}...` : safe;
}

export function summarizeEslintResult(result) {
  let summary;
  try {
    const parsed = JSON.parse(result?.stdout || "[]");
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
          ? message.ruleId : "unknown";
        ruleIds.set(ruleId, (ruleIds.get(ruleId) ?? 0) + 1);
      }
    }
    summary = {
      status: errorCount === 0 && result?.status === 0 ? "pass" : "fail",
      filesChecked: parsed.length,
      filesWithIssues,
      errors: errorCount,
      warnings: warningCount,
      ruleIds: [...ruleIds.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 8).map(([ruleId, count]) => `${ruleId}:${count}`),
    };
  } catch (error) {
    summary = {
      status: "fail", filesChecked: 0, filesWithIssues: 0, errors: 0, warnings: 0, ruleIds: [],
      issue: result?.error?.code === "ENOBUFS" ? "eslint-output-too-large" : clamp(error instanceof Error ? error.message : String(error)),
    };
  }
  if (result?.error?.code === "ENOBUFS") {
    summary = { ...summary, status: "fail", issue: "eslint-output-too-large" };
  } else if (result?.error) {
    summary = { ...summary, status: "fail", issue: "eslint-spawn-failed" };
  }
  return summary;
}

export function runEslintSummary({
  spawn = spawnSync, cwd = process.cwd(), env = process.env, execPath = process.execPath,
  platform = process.platform, writeLine = (line) => console.log(line),
} = {}) {
  const command = env.npm_execpath ? execPath : platform === "win32" ? "npm.cmd" : "npm";
  const args = env.npm_execpath
    ? [env.npm_execpath, "exec", "--", "eslint", ".", "--format", "json"]
    : ["exec", "--", "eslint", ".", "--format", "json"];
  const result = spawn(command, args, {
    cwd, encoding: "utf8", maxBuffer: 2 * 1024 * 1024,
    timeout: parseSummaryTimeoutEnv("ESLINT_SUMMARY_TIMEOUT_MS", 300_000),
    env: { ...env, NO_UPDATE_NOTIFIER: "1", npm_config_update_notifier: "false", npm_config_fund: "false" },
  });
  const summary = summarizeEslintResult(result);
  writeLine(JSON.stringify(summary));
  return { summary, exitCode: summary.status === "pass" ? 0 : 1 };
}

function isDirectRun() {
  return Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  try {
    const { exitCode } = runEslintSummary();
    process.exitCode = exitCode;
  } catch (error) {
    console.log(JSON.stringify({
      status: "fail", issue: "eslint-summary-config-invalid",
      error: redactProofText(error instanceof Error ? error.message : String(error)).slice(0, 300),
    }));
    process.exitCode = 1;
  }
}
