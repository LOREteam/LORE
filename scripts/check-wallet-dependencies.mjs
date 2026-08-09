import { spawnSync } from "node:child_process";
import { redactProofText } from "./redact-proof-output.mjs";

const requiredPackages = ["@privy-io/react-auth", "@privy-io/wagmi", "wagmi", "viem"];
const auditArgs = ["ls", ...requiredPackages, "--depth=1", "--json"];
const npmCommand = process.platform === "win32"
  ? { command: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", `npm.cmd ${auditArgs.join(" ")}`] }
  : { command: "npm", args: auditArgs };

function compactError(value) {
  const text = redactProofText(String(value ?? ""))
    .replace(/\s+/g, " ")
    .trim();
  return text.length > 220 ? `${text.slice(0, 205)}...<truncated>` : text;
}

const result = spawnSync(npmCommand.command, npmCommand.args, {
  cwd: process.cwd(),
  encoding: "utf8",
  maxBuffer: 1024 * 1024,
});

if (result.error) {
  console.log(JSON.stringify({ status: "fail", issue: "npm-ls-startup", detail: compactError(result.error.message) }));
  process.exitCode = 1;
  process.exit();
}

const raw = result.stdout?.trim() || result.stderr?.trim() || "";
let parsed;
try {
  parsed = JSON.parse(raw);
} catch {
  console.log(JSON.stringify({ status: "fail", issue: "npm-ls-json", sample: compactError(raw) }));
  process.exitCode = 1;
  process.exit();
}

const dependencies = parsed.dependencies && typeof parsed.dependencies === "object" ? parsed.dependencies : {};
const versions = Object.fromEntries(
  requiredPackages.map((name) => [name, dependencies[name]?.version ?? null]),
);
const missing = requiredPackages.filter((name) => typeof versions[name] !== "string" || versions[name].length === 0);

console.log(JSON.stringify({
  status: missing.length > 0 || result.status !== 0 ? "fail" : "pass",
  privy: versions["@privy-io/react-auth"],
  privyWagmi: versions["@privy-io/wagmi"],
  wagmi: versions.wagmi,
  viem: versions.viem,
  missing,
}));

if (missing.length > 0 || result.status !== 0) process.exitCode = 1;
