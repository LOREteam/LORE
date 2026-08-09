import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, resolve, relative } from "node:path";

const STRICT = process.argv.includes("--strict") || process.env.PROOF_STRICT === "1";
const SUMMARY_ONLY = process.argv.includes("--summary-only");
const COMPACT_ONLY = process.argv.includes("--compact");
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
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

const requiredPresence = [
  "LINEA_NETWORK",
  "NEXT_PUBLIC_LINEA_NETWORK",
  "LINEA_CHAIN_ID",
  "NEXT_PUBLIC_LINEA_CHAIN_ID",
  "KEEPER_CONTRACT_ADDRESS",
  "NEXT_PUBLIC_CONTRACT_ADDRESS",
  "NEXT_PUBLIC_LINEA_TOKEN_ADDRESS",
  "NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS",
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

function parsePositiveInteger(value) {
  const normalized = String(value ?? "").trim();
  if (!/^[1-9]\d{0,15}$/.test(normalized)) return null;
  const parsed = BigInt(normalized);
  return parsed <= MAX_SAFE_INTEGER_BIGINT ? Number(parsed) : null;
}

function isPositiveInteger(value) {
  return parsePositiveInteger(value) !== null;
}

function isRealAddress(value) {
  return ADDRESS_RE.test(value) && String(value).toLowerCase() !== ZERO_ADDRESS;
}

function isTruthyEnvValue(value) {
  return ["1", "true", "yes", "on", "enabled"].includes(String(value ?? "").trim().toLowerCase());
}

function isPrivateKeyHex(value) {
  return /^(?:0x)?[a-fA-F0-9]{64}$/.test(String(value ?? "").trim());
}

function isHttpsUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && Boolean(url.hostname);
  } catch {
    return false;
  }
}

function isFinalHttpsOrigin(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^\[(.*)\]$/, "$1");
    return url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      url.search === "" &&
      url.hash === "" &&
      (host.includes(".") || host.includes(":")) &&
      !(
        host === "localhost" ||
        host === "0.0.0.0" ||
        host === "::" ||
        host === "::1" ||
        host === "127.0.0.1" ||
        host.endsWith(".localhost") ||
        host.endsWith(".local") ||
        host.endsWith(".example") ||
        host.endsWith(".test") ||
        host.endsWith(".invalid") ||
        /^0\./.test(host) ||
        /^127\./.test(host) ||
        /^10\./.test(host) ||
        /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host) ||
        /^169\.254\./.test(host) ||
        /^192\.168\./.test(host) ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
        /^192\.0\.2\./.test(host) ||
        /^198\.(1[89])\./.test(host) ||
        /^198\.51\.100\./.test(host) ||
        /^203\.0\.113\./.test(host) ||
        /^::ffff:/i.test(host) ||
        /^f[cd][0-9a-f]*:/i.test(host) ||
        /^fe[89ab][0-9a-f]*:/i.test(host) ||
        /^2001:db8:/i.test(host)
      );
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

function getBackupDirStatus() {
  const backupDirs = ["LORE_BACKUP_DIR", "RUNTIME_MONITOR_BACKUP_DIR"]
    .map((name) => env(name))
    .filter(Boolean);
  if (backupDirs.length === 0) return status(false, "missing");
  for (const backupDir of backupDirs) {
    if (!isAbsolute(backupDir)) return status(false, "not absolute");
    const rel = relative(REPO_ROOT, resolve(backupDir));
    const insideRepo = rel === "" || (rel && !rel.startsWith("..") && !rel.includes(":"));
    if (insideRepo) return status(false, "inside repo");
  }
  return status(true, "configured outside repo");
}

function isFinalMainnetEnvProofPath(filePath) {
  return relative(process.cwd(), resolve(process.cwd(), filePath)).replace(/\\/g, "/") === "docs/mainnet-env-proof.log";
}

function gateGroup(gate) {
  const normalized = gate.toLowerCase().replace(/[_-]+/g, " ");
  if (normalized.includes("network") || normalized.includes("chain id")) return "network";
  if (normalized.includes("contract") || normalized.includes("token address") || normalized.includes("protected bets")) return "contract";
  if (normalized.includes("indexer") || normalized.includes("deploy block") || normalized.includes("finality") || normalized.includes("db path")) return "indexer";
  if (normalized.includes("rpc") || normalized.includes("site url")) return "rpc-site";
  if (normalized.includes("privy")) return "privy";
  if (normalized.includes("proxy")) return "proxy";
  if (normalized.includes("rate limit") || normalized.includes("replica")) return "rate-limit";
  if (normalized.includes("backup")) return "backup";
  if (normalized.includes("admin wallet")) return "admin";
  if (normalized.includes("secret") || normalized.includes("key shape") || normalized.includes("auth")) return "credentials";
  return "other";
}

function failingGateGroups(failedChecks) {
  const groupCounts = new Map();
  for (const check of failedChecks) {
    const group = gateGroup(check.gate);
    groupCounts.set(group, (groupCounts.get(group) ?? 0) + 1);
  }
  return [...groupCounts]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([group, count]) => `${group}=${count}`)
    .join(", ") || "none";
}

function gateToken(gate) {
  return String(gate ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "unknown";
}

function failingGateTokens(failedChecks) {
  return failedChecks.map((check) => gateToken(check.gate)).join(", ") || "none";
}

function compactFailingGateTokens(failedChecks, maxTokens = 10) {
  const tokens = failedChecks.map((check) => gateToken(check.gate));
  if (tokens.length === 0) return "none";
  const shown = tokens.slice(0, maxTokens).join(", ");
  return tokens.length > maxTokens ? `${shown}, ... (+${tokens.length - maxTokens} more)` : shown;
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
const trustProxySecret = env("TRUST_PROXY_SECRET");
const contractRequiresEpochBoundBets = env("NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS");
const healthDiagnosticsSecret = env("HEALTH_DIAGNOSTICS_SECRET");
const chatAuthSecret = env("CHAT_AUTH_SECRET") || env("NEXTAUTH_SECRET");
const adminAuthSecret = env("ADMIN_AUTH_SECRET") || chatAuthSecret;
const adminWalletAddress = env("NEXT_PUBLIC_ADMIN_WALLET_ADDRESS");
const bootstrapResolveSecret = env("BOOTSTRAP_RESOLVE_SECRET");
const bootstrapKeeperPrivateKey = env("BOOTSTRAP_KEEPER_PRIVATE_KEY") || env("KEEPER_PRIVATE_KEY");
const keeperPrivateKey = env("KEEPER_PRIVATE_KEY");
const webReplicaCountRaw = env("WEB_REPLICA_COUNT") || "1";
const webReplicaCount = parsePositiveInteger(webReplicaCountRaw);
const hasValidWebReplicaCount = webReplicaCount !== null;
const requiresExternalRateLimit = hasValidWebReplicaCount && webReplicaCount > 1;
const dbStatus = getDbPathStatus();
const backupStatus = getBackupDirStatus();
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
    status: isPositiveInteger(deployBlock) && isPositiveInteger(publicDeployBlock) ? "pass" : "fail",
    value: `${deployBlock || "missing"} / ${publicDeployBlock || "missing"}`,
    ok: isPositiveInteger(deployBlock) && isPositiveInteger(publicDeployBlock),
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
    gate: "trusted proxy secret length",
    status: trustProxySecret.length >= 32 ? "pass" : "fail",
    value: yesNo(trustProxySecret),
    ok: trustProxySecret.length >= 32,
  },
  {
    gate: "health diagnostics secret length",
    status: healthDiagnosticsSecret.length >= 32 ? "pass" : "fail",
    value: yesNo(healthDiagnosticsSecret),
    ok: healthDiagnosticsSecret.length >= 32,
  },
  {
    gate: "chat auth secret length",
    status: chatAuthSecret.length >= 32 ? "pass" : "fail",
    value: yesNo(chatAuthSecret),
    ok: chatAuthSecret.length >= 32,
  },
  {
    gate: "admin auth secret length",
    status: adminAuthSecret.length >= 32 ? "pass" : "fail",
    value: yesNo(adminAuthSecret),
    ok: adminAuthSecret.length >= 32,
  },
  {
    gate: "admin wallet address shape",
    status: isRealAddress(adminWalletAddress) ? "pass" : "fail",
    value: redact(adminWalletAddress),
    ok: isRealAddress(adminWalletAddress),
  },
  {
    gate: "bootstrap resolve secret length",
    status: bootstrapResolveSecret.length >= 32 ? "pass" : "fail",
    value: yesNo(bootstrapResolveSecret),
    ok: bootstrapResolveSecret.length >= 32,
  },
  {
    gate: "bootstrap keeper key shape",
    status: isPrivateKeyHex(bootstrapKeeperPrivateKey) ? "pass" : "fail",
    value: yesNo(bootstrapKeeperPrivateKey),
    ok: isPrivateKeyHex(bootstrapKeeperPrivateKey),
  },
  {
    gate: "keeper key shape",
    status: isPrivateKeyHex(keeperPrivateKey) ? "pass" : "fail",
    value: yesNo(keeperPrivateKey),
    ok: isPrivateKeyHex(keeperPrivateKey),
  },
  {
    gate: "web replica count",
    status: hasValidWebReplicaCount ? "pass" : "fail",
    value: hasValidWebReplicaCount ? String(webReplicaCount) : "invalid",
    ok: hasValidWebReplicaCount,
  },
  {
    gate: "external rate limit for multi-replica web",
    status: !requiresExternalRateLimit ||
      (isHttpsUrl(env("UPSTASH_REDIS_REST_URL")) &&
        Boolean(env("UPSTASH_REDIS_REST_TOKEN")) &&
        env("RATE_LIMIT_EXTERNAL_FAIL_CLOSED") === "1")
      ? "pass"
      : "fail",
    value: requiresExternalRateLimit ? "required" : "not required",
    ok: !requiresExternalRateLimit ||
      (isHttpsUrl(env("UPSTASH_REDIS_REST_URL")) &&
        Boolean(env("UPSTASH_REDIS_REST_TOKEN")) &&
        env("RATE_LIMIT_EXTERNAL_FAIL_CLOSED") === "1"),
  },
  {
    gate: "V10 protected bets required",
    status: isTruthyEnvValue(contractRequiresEpochBoundBets) ? "pass" : "fail",
    value: contractRequiresEpochBoundBets || "missing",
    ok: isTruthyEnvValue(contractRequiresEpochBoundBets),
  },
  {
    gate: "persistent DB path",
    status: dbStatus.ok ? "pass" : "fail",
    value: dbStatus.message,
    ok: dbStatus.ok,
  },
  {
    gate: "server backup monitoring directory",
    status: backupStatus.ok ? "pass" : "fail",
    value: backupStatus.message,
    ok: backupStatus.ok,
  },
);

const failed = checks.filter((check) => !check.ok);
const timestamp = new Date().toISOString();

const outputLines = COMPACT_ONLY
  ? [
      "# Mainnet Env Proof Compact Status",
      "",
      `Timestamp: ${timestamp}`,
      `Strict: ${STRICT ? "yes" : "no"}`,
      `Gates checked: ${checks.length}`,
      `Failing gates: ${failed.length}`,
      `Failing gate groups: ${failingGateGroups(failed)}`,
      `Failing gate tokens sample: ${compactFailingGateTokens(failed)}`,
      "",
      `Summary: ${failed.length === 0 ? "all checked env gates passed" : `${failed.length} env gate(s) missing or failing`}.`,
    ]
  : SUMMARY_ONLY
  ? [
      "# Mainnet Env Proof Snapshot",
      "",
      `Timestamp: ${timestamp}`,
      `Strict: ${STRICT ? "yes" : "no"}`,
      `Gates checked: ${checks.length}`,
      `Failing gates: ${failed.length}`,
      `Failing gate names: ${failed.map((check) => check.gate).join(", ") || "none"}`,
      `Failing gate tokens: ${failingGateTokens(failed)}`,
      `Failing gate groups: ${failingGateGroups(failed)}`,
      "",
      `Summary: ${failed.length === 0 ? "all checked env gates passed" : `${failed.length} env gate(s) missing or failing`}.`,
    ]
  : [
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

if (outPath && !SUMMARY_ONLY) {
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


