import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve, relative } from "node:path";

const STRICT = process.argv.includes("--strict") || process.env.PROOF_STRICT === "1";
const args = new Map(
  process.argv
    .slice(2)
    .filter((arg) => arg.startsWith("--") && arg.includes("="))
    .map((arg) => {
      const [key, ...rest] = arg.slice(2).split("=");
      return [key, rest.join("=")];
    }),
);
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const REPO_ROOT = process.cwd();
const DEV_PRIVY_APP_ID = "cmlqkgtmg00og0cjueu4mxmn9";

const requiredPresence = [
  "LINEA_NETWORK",
  "NEXT_PUBLIC_LINEA_NETWORK",
  "LINEA_CHAIN_ID",
  "NEXT_PUBLIC_LINEA_CHAIN_ID",
  "KEEPER_CONTRACT_ADDRESS",
  "NEXT_PUBLIC_CONTRACT_ADDRESS",
  "NEXT_PUBLIC_LINEA_TOKEN_ADDRESS",
  "INDEXER_START_BLOCK",
  "NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK",
  "INDEXER_FINALITY_BLOCKS",
  "KEEPER_RPC_URL",
  "NEXT_PUBLIC_SITE_URL",
  "NEXT_PUBLIC_PRIVY_APP_ID",
  "HEALTH_DIAGNOSTICS_SECRET",
  "TRUST_PROXY_HEADERS",
  "LORE_DB_PATH",
];

const secretLike = new Set([
  "HEALTH_DIAGNOSTICS_SECRET",
  "KEEPER_PRIVATE_KEY",
  "BOOTSTRAP_KEEPER_PRIVATE_KEY",
  "CHAT_AUTH_SECRET",
  "BOOTSTRAP_RESOLVE_SECRET",
  "KEEPER_RPC_URL",
]);

function env(name) {
  return process.env[name]?.trim() || "";
}

function redact(value) {
  if (!value) return "missing";
  if (ADDRESS_RE.test(value)) return `${value.slice(0, 6)}...${value.slice(-4)}`;
  if (value.length <= 12) return "present";
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

function yesNo(value) {
  return value ? "yes" : "no";
}

function isNonNegativeInteger(value) {
  return /^\d+$/.test(value);
}

function isPositiveInteger(value) {
  return /^[1-9]\d*$/.test(value);
}

function isRealAddress(value) {
  return ADDRESS_RE.test(value) && String(value).toLowerCase() !== ZERO_ADDRESS;
}

function isTruthyEnvValue(value) {
  return ["1", "true", "yes", "on", "enabled"].includes(String(value ?? "").trim().toLowerCase());
}

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isFinalHttpsOrigin(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === "" &&
      !["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(host) &&
      !host.endsWith(".local");
  } catch {
    return false;
  }
}

function status(ok, message) {
  return { ok, message };
}

function getDbPathStatus() {
  const dbPath = env("LORE_DB_PATH");
  if (!dbPath) return status(false, "missing");
  const absolute = resolve(dbPath);
  const rel = relative(REPO_ROOT, absolute);
  const insideRepo = rel && !rel.startsWith("..") && !rel.includes(":");
  if (!isAbsolute(dbPath)) return status(false, "not absolute");
  if (insideRepo) return status(false, "inside repo");
  if (/[/\\]data[/\\]lore\.sqlite$/i.test(absolute)) return status(false, "repo-local default");
  return status(true, "absolute outside repo");
}

function isFinalMainnetEnvProofPath(filePath) {
  return relative(process.cwd(), resolve(process.cwd(), filePath)).replace(/\\/g, "/") === "docs/mainnet-env-proof.log";
}

const checks = [];

for (const name of requiredPresence) {
  checks.push({
    gate: name,
    status: env(name) ? "present" : "missing",
    value: secretLike.has(name) ? yesNo(env(name)) : redact(env(name)),
    ok: Boolean(env(name)),
  });
}

const keeperContract = env("KEEPER_CONTRACT_ADDRESS");
const publicContract = env("NEXT_PUBLIC_CONTRACT_ADDRESS");
const token = env("NEXT_PUBLIC_LINEA_TOKEN_ADDRESS");
const network = env("LINEA_NETWORK");
const publicNetwork = env("NEXT_PUBLIC_LINEA_NETWORK");
const chainId = env("LINEA_CHAIN_ID");
const publicChainId = env("NEXT_PUBLIC_LINEA_CHAIN_ID");
const deployBlock = env("INDEXER_START_BLOCK");
const publicDeployBlock = env("NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK");
const finalityBlocks = env("INDEXER_FINALITY_BLOCKS");
const keeperRpcUrl = env("KEEPER_RPC_URL");
const siteUrl = env("NEXT_PUBLIC_SITE_URL");
const privyAppId = env("NEXT_PUBLIC_PRIVY_APP_ID");
const trustProxyHeaders = env("TRUST_PROXY_HEADERS");
const eip7702Public = env("NEXT_PUBLIC_EIP7702_ENABLED");
const eip7702Server = env("EIP7702_ENABLED");
const eip7702MiningPublic = env("NEXT_PUBLIC_EIP7702_MINING_ENABLED");
const eip7702MiningServer = env("EIP7702_MINING_ENABLED");
const dbStatus = getDbPathStatus();
const outPath = args.get("out")?.trim() || process.env.PROOF_MAINNET_OUT?.trim() || "";

checks.push(
  {
    gate: "network is mainnet",
    status: network === "mainnet" && publicNetwork === "mainnet" ? "pass" : "fail",
    value: `${network || "missing"} / ${publicNetwork || "missing"}`,
    ok: network === "mainnet" && publicNetwork === "mainnet",
  },
  {
    gate: "target chain id",
    status: chainId === "59144" && publicChainId === "59144" ? "pass" : "fail",
    value: `${chainId || "missing"} / ${publicChainId || "missing"}`,
    ok: chainId === "59144" && publicChainId === "59144",
  },
  {
    gate: "chain ids match",
    status: chainId && publicChainId && chainId === publicChainId ? "pass" : "fail",
    value: `${chainId || "missing"} / ${publicChainId || "missing"}`,
    ok: Boolean(chainId && publicChainId && chainId === publicChainId),
  },
  {
    gate: "contract addresses match",
    status: keeperContract && publicContract && keeperContract.toLowerCase() === publicContract.toLowerCase() ? "pass" : "fail",
    value: `${redact(keeperContract)} / ${redact(publicContract)}`,
    ok: Boolean(keeperContract && publicContract && keeperContract.toLowerCase() === publicContract.toLowerCase()),
  },
  {
    gate: "contract address shape",
    status: isRealAddress(keeperContract) && isRealAddress(publicContract) ? "pass" : "fail",
    value: `${redact(keeperContract)} / ${redact(publicContract)}`,
    ok: isRealAddress(keeperContract) && isRealAddress(publicContract),
  },
  {
    gate: "token address shape",
    status: isRealAddress(token) ? "pass" : "fail",
    value: redact(token),
    ok: isRealAddress(token),
  },
  {
    gate: "deploy blocks match",
    status: deployBlock && publicDeployBlock && deployBlock === publicDeployBlock ? "pass" : "fail",
    value: `${deployBlock || "missing"} / ${publicDeployBlock || "missing"}`,
    ok: Boolean(deployBlock && publicDeployBlock && deployBlock === publicDeployBlock),
  },
  {
    gate: "deploy block shape",
    status: isNonNegativeInteger(deployBlock) && isNonNegativeInteger(publicDeployBlock) ? "pass" : "fail",
    value: `${deployBlock || "missing"} / ${publicDeployBlock || "missing"}`,
    ok: isNonNegativeInteger(deployBlock) && isNonNegativeInteger(publicDeployBlock),
  },
  {
    gate: "mainnet finality lag",
    status: isPositiveInteger(finalityBlocks) ? "pass" : "fail",
    value: finalityBlocks || "missing",
    ok: isPositiveInteger(finalityBlocks),
  },
  {
    gate: "keeper RPC is https",
    status: isHttpsUrl(keeperRpcUrl) ? "pass" : "fail",
    value: yesNo(keeperRpcUrl),
    ok: isHttpsUrl(keeperRpcUrl),
  },
  {
    gate: "site URL is final https origin",
    status: isFinalHttpsOrigin(siteUrl) ? "pass" : "fail",
    value: redact(siteUrl),
    ok: isFinalHttpsOrigin(siteUrl),
  },
  {
    gate: "Privy app id configured",
    status: privyAppId && privyAppId !== DEV_PRIVY_APP_ID ? "pass" : "fail",
    value: privyAppId === DEV_PRIVY_APP_ID ? "development fallback" : yesNo(privyAppId),
    ok: Boolean(privyAppId && privyAppId !== DEV_PRIVY_APP_ID),
  },
  {
    gate: "trusted proxy headers enabled",
    status: trustProxyHeaders === "1" ? "pass" : "fail",
    value: trustProxyHeaders || "missing",
    ok: trustProxyHeaders === "1",
  },
  {
    gate: "EIP-7702 disabled",
    status: !isTruthyEnvValue(eip7702Public) && !isTruthyEnvValue(eip7702Server) ? "pass" : "fail",
    value: `public=${eip7702Public || "unset"} server=${eip7702Server || "unset"}`,
    ok: !isTruthyEnvValue(eip7702Public) && !isTruthyEnvValue(eip7702Server),
  },
  {
    gate: "EIP-7702 mining disabled",
    status: !isTruthyEnvValue(eip7702MiningPublic) && !isTruthyEnvValue(eip7702MiningServer) ? "pass" : "fail",
    value: `public=${eip7702MiningPublic || "unset"} server=${eip7702MiningServer || "unset"}`,
    ok: !isTruthyEnvValue(eip7702MiningPublic) && !isTruthyEnvValue(eip7702MiningServer),
  },
  {
    gate: "persistent DB path",
    status: dbStatus.ok ? "pass" : "fail",
    value: dbStatus.message,
    ok: dbStatus.ok,
  },
);

const failed = checks.filter((check) => !check.ok);
const timestamp = new Date().toISOString();

const outputLines = [
  "# Mainnet Env Proof Snapshot",
  "",
  `Timestamp: ${timestamp}`,
  `Strict: ${STRICT ? "yes" : "no"}`,
  "",
  "| Gate | Status | Value |",
  "| --- | --- | --- |",
  ...checks.map((check) => `| ${check.gate} | ${check.status} | ${check.value} |`),
  "",
  `Summary: ${failed.length === 0 ? "all checked env gates passed" : `${failed.length} env gate(s) missing or failing`}.`,
  "",
  "Copy this summary into `docs/mainnet-proof-record.md` only after verifying it was run against the intended host/env.",
];

console.log(outputLines.join("\n"));

if (outPath) {
  const resolved = resolve(process.cwd(), outPath);
  if (STRICT && failed.length > 0 && isFinalMainnetEnvProofPath(resolved)) {
    console.log("Proof snapshot not written: strict check failed for final docs/mainnet-env-proof.log.");
  } else {
    mkdirSync(dirname(resolved), { recursive: true });
    writeFileSync(resolved, `${outputLines.join("\n")}\n`, "utf8");
    console.log(`Proof snapshot written: ${relative(process.cwd(), resolved)}`);
  }
}

if (STRICT && failed.length > 0) {
  process.exitCode = 1;
}


