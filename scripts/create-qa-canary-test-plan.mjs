import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

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
  const normalized = String(value ?? "").trim();
  return /^[1-9]\d*$/.test(normalized) && Number.isSafeInteger(Number(normalized));
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
  throw new Error("--origin must be a non-local HTTPS origin without path, query, or hash");
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
if (Number(chainId) !== 59144) {
  throw new Error("--chain-id must be 59144 for Linea mainnet launch proof");
}
if (existsSync(outPath) && !hasFlag("force")) {
  throw new Error(`${path.relative(process.cwd(), outPath)} already exists; pass --force to overwrite`);
}

const groups = [
  ["Wallet QA", [
    "Privy allowed origins include the exact production origin and no development fallback app id is active.",
    "Desktop connect, disconnect, reconnect, and wrong-network warning are verified.",
    "Clean wallet first transaction succeeds and records a real non-zero tx hash.",
    "Mobile Web3 browser connect and transaction flow are verified.",
    "Slow network auth modal and slow chat auth are visible and recoverable.",
  ]],
  ["Failure-State UX", [
    "Disabled actions explain the reason instead of silently doing nothing.",
    "Pending states are visible for bet, resolve, chat auth, and profile save.",
    "Degraded/stale data is labelled clearly.",
    "Route chunk recovery is visible and recoverable.",
    "No silent no-op remains in wallet, mining, chat, or profile flows.",
  ]],
  ["Support / Audit Visibility", [
    "Bet history shows epoch, tile, amount, txHash, and result.",
    "Auto-miner logs show round, epoch, nonce, txHash, and retryCount.",
    "Diagnostics/admin view shows indexer lag, heartbeat, and serving mode.",
  ]],
  ["Final Launch QA", [
    "Browser smoke runs with debug autominer scenarios enabled.",
    "No unexpected console errors are present; unsupported wallet warnings are not masked.",
    "Mobile layout, right panel, overlays, and chat geometry are verified.",
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
- Chain ID: ${chainId}

${sections}

## Commands

\`\`\`powershell
npm.cmd run proof:qa:draft -- --origin=${origin} --network=${network} --chain-id=${chainId} --wallet-artifact=docs/qa-wallet-flow-report.md --failure-artifact=docs/qa-failure-state-report.md --support-artifact=docs/qa-support-audit-report.md --finalqa-artifact=docs/qa-final-browser-report.md --smoke-artifact=docs/qa-smoke-debug-autominer.log --clean-wallet-tx=<txHash> --out=docs/qa-proof.draft.json
npm.cmd run proof:qa -- --strict
\`\`\`

## Evidence Rules

- Use only final HTTPS origin evidence for launch proof.
- Redact cookies, tokens, Privy session data, RPC URLs, and unnecessary wallet inventory.
- Every completed item needs an ISO UTC timestamp and a concrete screenshot, log, tx hash, provider link, or QA artifact.
`;

mkdirSync(path.dirname(outPath), { recursive: true });
writeFileSync(outPath, markdown, "utf8");
console.log(`QA canary test plan written: ${path.relative(process.cwd(), outPath)}`);
