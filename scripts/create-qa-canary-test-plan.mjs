import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

function argValue(name, fallback = "") {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length).trim() : fallback;
}

function hasFlag(name) {
  return process.argv.includes(`--${name}`);
}

function isFinalHttpsOrigin(value) {
  try {
    const url = new URL(String(value ?? "").trim());
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

function normalizeNetwork(network) {
  const normalized = String(network ?? "").trim().toLowerCase().replace(/[\s_-]+/g, "-");
  if (["main", "linea", "prod", "production", "linea-mainnet"].includes(normalized)) return "mainnet";
  if (["testnet", "linea-sepolia", "sepolia-testnet"].includes(normalized)) return "sepolia";
  return normalized;
}

function knownChainId(network) {
  const normalized = normalizeNetwork(network);
  if (normalized === "mainnet") return "59144";
  if (normalized === "sepolia") return "59141";
  return "";
}

function isPositiveInteger(value) {
  return parsePositiveInteger(value) !== null;
}

function parsePositiveInteger(value) {
  const normalized = String(value ?? "").trim();
  if (!/^[1-9]\d{0,15}$/.test(normalized)) return null;
  const parsed = BigInt(normalized);
  return parsed <= MAX_SAFE_INTEGER_BIGINT ? Number(parsed) : null;
}

function hasRealText(value) {
  const text = String(value ?? "").trim();
  return Boolean(text) && !/^(todo|tbd)\b/i.test(text);
}

function printHelp() {
  console.log(`Usage:
  npm.cmd run proof:qa:plan -- --origin=https://playlore.xyz --network=linea-mainnet --out=docs/qa-canary-test-plan.draft.md

Options:
  --origin=<https-origin>  Final production HTTPS origin without path/query/hash.
  --network=<network>     Target network label, e.g. linea-mainnet.
  --chain-id=<id>         Optional chain id; derived for known Linea networks.
  --out=<path>            Output markdown path. Default: docs/qa-canary-test-plan.draft.md.
  --force                 Overwrite an existing output file.
`);
}

if (hasFlag("help") || hasFlag("h")) {
  printHelp();
  process.exit(0);
}

const origin = argValue("origin", process.env.NEXT_PUBLIC_SITE_URL || "");
const network = argValue("network", process.env.NEXT_PUBLIC_LINEA_NETWORK || process.env.LINEA_NETWORK || "");
const chainId = argValue("chain-id", process.env.NEXT_PUBLIC_LINEA_CHAIN_ID || process.env.LINEA_CHAIN_ID || knownChainId(network));
const outPath = path.resolve(process.cwd(), argValue("out", "docs/qa-canary-test-plan.draft.md"));

if (!isFinalHttpsOrigin(origin)) {
  throw new Error("--origin must be a public HTTPS origin without path, query, or hash");
}
if (!hasRealText(network)) {
  throw new Error("--network must identify the target network");
}
if (normalizeNetwork(network) !== "mainnet") {
  throw new Error("--network must be mainnet for launch QA proof");
}
if (!isPositiveInteger(chainId)) {
  throw new Error("--chain-id must be a positive integer or derivable from --network");
}
const parsedChainId = parsePositiveInteger(chainId);
if (parsedChainId === null) {
  throw new Error("--chain-id must be a safe positive integer or derivable from --network");
}
if (parsedChainId !== 59144) {
  throw new Error("--chain-id must be 59144 for Linea mainnet launch proof");
}
if (existsSync(outPath) && !hasFlag("force")) {
  throw new Error(`${path.relative(process.cwd(), outPath)} already exists; pass --force to overwrite`);
}

const groups = [
  ["Wallet QA", [
    "Privy allowed origins include the exact production origin, a production App ID is configured without recording the value, and no development fallback app id is active.",
    "Desktop connect, disconnect, reconnect, and wrong-network warning are verified.",
    "Wallet loading state resolves or shows a recoverable error within the documented timeout.",
    "Clean wallet first transaction succeeds and records a real non-zero tx hash.",
    "Mobile Web3 browser connect and transaction flow are verified.",
    "ETH top-up, LINEA deposit, withdrawal, rejected prompt, timeout, and signed on-chain revert copy are verified.",
    "Slow network auth modal and slow chat auth are visible and recoverable.",
  ]],
  ["Failure-State UX", [
    "Disabled actions explain the reason instead of silently doing nothing.",
    "Pending states are visible for bet, resolve, chat auth, and profile save.",
    "Degraded/stale data is labelled clearly.",
    "Pool chart remains visible with an explicit empty state when there are no bets.",
    "Manual bet, Auto-Miner, tile values, wallet balances, jackpot amounts, and reward amounts use consistent number typography.",
    "Route chunk recovery is visible and recoverable.",
    "No silent no-op remains in wallet, mining, chat, or profile flows.",
  ]],
  ["Support / Audit Visibility", [
    "Bet history shows epoch, tile, amount, txHash, and result.",
    "Auto-miner logs show round, epoch, nonce, txHash, retryCount, and stopReason.",
    "Diagnostics/admin view shows indexer lag, heartbeat, and serving mode.",
  ]],
  ["Final Launch QA", [
    "Browser smoke runs with debug autominer scenarios enabled.",
    "No unexpected console errors are present; unsupported wallet warnings are not masked.",
    "Mobile layout, jackpot ticker, right panel, overlays, and chat geometry are verified without clipping or overlap.",
    "Jackpot and reward visibility are verified in empty, pending, awarded, and claimable states.",
    "FAQ, Whitepaper, and onboarding wording are mainnet-first.",
  ]],
];

const sections = groups.map(([title, items]) => {
  const rows = items.map((item) => `| ${item} | TODO | TODO: screenshot/log/link | TODO: ISO timestamp |`).join("\n");
  return `## ${title}\n\n| Check | Status | Evidence | Checked at |\n| --- | --- | --- | --- |\n${rows}`;
}).join("\n\n");

const markdown = `# QA Canary Test Plan Draft

This is a draft test plan. It is not launch proof until the real QA evidence is copied into docs/qa-proof.json and npm.cmd run proof:qa -- --strict passes.

## Target

- Origin: ${origin}
- Network: ${network}
- Chain ID: ${parsedChainId}

${sections}

## Commands

\`\`\`powershell
npm.cmd run proof:qa:draft -- --origin=${origin} --network=${network} --chain-id=${parsedChainId} --wallet-artifact=docs/qa-wallet-flow-report.md --failure-artifact=docs/qa-failure-state-report.md --support-artifact=docs/qa-support-audit-report.md --finalqa-artifact=docs/qa-final-browser-report.md --smoke-artifact=docs/qa-smoke-debug-autominer.log --clean-wallet-tx=<txHash> --out=docs/qa-proof.draft.json
npm.cmd run proof:qa -- --strict
\`\`\`

## Evidence Rules

- Use only final public HTTPS origin evidence for launch proof.
- Redact cookies, tokens, Privy session data, RPC URLs, and unnecessary wallet inventory.
- Every completed item needs an ISO UTC timestamp and a concrete screenshot, log, tx hash, provider link, or QA artifact.
`;

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, markdown, "utf8");
console.log(`QA canary test plan written: ${path.relative(process.cwd(), outPath)}`);
