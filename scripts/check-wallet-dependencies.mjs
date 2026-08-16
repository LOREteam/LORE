import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { redactProofText } from "./redact-proof-output.mjs";
import {
  resolveTrustedNpmCli,
  trustedNpmCommand,
  trustedNpmEnvironment,
} from "./trusted-npm-cli.mjs";

export const REQUIRED_WALLET_PACKAGES = ["@privy-io/react-auth", "@privy-io/wagmi", "wagmi", "viem"];
const AUDIT_ARGS = ["ls", ...REQUIRED_WALLET_PACKAGES, "--depth=1", "--json"];

function compactError(value) {
  const text = redactProofText(String(value ?? ""))
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 220 ? `${text.slice(0, 205)}...<truncated>` : text;
}

function emitFailure(issue, field, value, log) {
  const summary = { status: "fail", issue, [field]: compactError(value) };
  log(JSON.stringify(summary));
  return { exitCode: 1, summary };
}

export function runWalletDependencyAuditCli({
  env = process.env,
  spawnSyncFn = spawnSync,
  resolveTrustedNpmCliFn = resolveTrustedNpmCli,
  trustedNpmCommandFn = trustedNpmCommand,
  trustedNpmEnvironmentFn = trustedNpmEnvironment,
  log = console.log,
} = {}) {
  let launcher;
  try {
    launcher = resolveTrustedNpmCliFn();
  } catch (error) {
    return emitFailure("npm-ls-startup", "detail", error instanceof Error ? error.message : error, log);
  }

  const command = trustedNpmCommandFn(AUDIT_ARGS, launcher);
  let result;
  try {
    result = spawnSyncFn(command.command, command.args, {
      cwd: launcher.repoRoot,
      env: trustedNpmEnvironmentFn(env, launcher),
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      windowsHide: true,
    });
  } catch (error) {
    return emitFailure("npm-ls-startup", "detail", error instanceof Error ? error.message : error, log);
  }
  if (result.error) return emitFailure("npm-ls-startup", "detail", result.error.message, log);

  const raw = result.stdout?.trim() || result.stderr?.trim() || "";
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emitFailure("npm-ls-json", "sample", raw, log);
  }
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    return emitFailure("npm-ls-report", "detail", "top-level npm ls report must be an object", log);
  }

  const dependencies = parsed.dependencies && !Array.isArray(parsed.dependencies) && typeof parsed.dependencies === "object"
    ? parsed.dependencies
    : {};
  const versions = Object.fromEntries(
    REQUIRED_WALLET_PACKAGES.map((name) => [name, typeof dependencies[name]?.version === "string"
      ? dependencies[name].version.trim() || null
      : null]),
  );
  const missing = REQUIRED_WALLET_PACKAGES.filter((name) => versions[name] === null);
  const failed = missing.length > 0 || result.status !== 0;
  const summary = {
    status: failed ? "fail" : "pass",
    privy: versions["@privy-io/react-auth"],
    privyWagmi: versions["@privy-io/wagmi"],
    wagmi: versions.wagmi,
    viem: versions.viem,
    missing,
  };
  log(JSON.stringify(summary));
  return { exitCode: failed ? 1 : 0, summary };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = runWalletDependencyAuditCli().exitCode;
}
