import { config as loadDotenv } from "dotenv";
import { existsSync, statSync } from "node:fs";
import { createPublicClient, createWalletClient, fallback, getAddress, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { getFallbackFeeOverrides, getKeeperFeeOverrides } from "../app/lib/lineaFees";
import { sanitizeSupportLogPayload } from "../app/lib/sentrySanitize";
import { getConfiguredLineaNetwork, getLineaChain, getPreferredLineaRpcs, getStableLineaReadRpcs } from "../config/publicConfig";

const PUBLIC_ADDRESS_ENV_PATH = ".env.live-test-addresses";
const LIVE_WALLET_ENV_PATH = ".env.live-test-wallets";

function loadEnvFileIfPresent(path: string, description: string) {
  if (existsSync(path) && !statSync(path).isFile()) {
    throw new Error(`${path} must be ${description}, not a directory`);
  }
  loadDotenv({ path, override: false, quiet: true });
}

loadEnvFileIfPresent(PUBLIC_ADDRESS_ENV_PATH, "an address env file");

const ROLE = "AUTOMINER_A";
const EXECUTE = process.argv.includes("--execute");
const EXECUTION_CONFIRMATION = "--confirm-lowest-pending-nonce-replacement";
const EXECUTION_CONFIRMED = process.argv.includes(EXECUTION_CONFIRMATION);
const MAX_REPLACEMENTS = 1;
const RECEIPT_TIMEOUT_MS = 90_000;
const NETWORK = getConfiguredLineaNetwork();
const CHAIN = getLineaChain(NETWORK);

if (CHAIN.id !== 59141) {
  throw new Error("pending-nonce recovery is limited to Linea Sepolia live-test wallets");
}

function nonNegativeSafeInteger(value: unknown): number {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : 0;
}

function normalizePrivateKey(raw: string): `0x${string}` {
  const trimmed = raw.trim();
  return trimmed.startsWith("0x") ? (trimmed as `0x${string}`) : (`0x${trimmed}` as `0x${string}`);
}

function getAccount() {
  loadEnvFileIfPresent(LIVE_WALLET_ENV_PATH, "a wallet env file");
  const key = process.env.LORE_LIVE_TEST_AUTOMINER_A_PRIVATE_KEY?.trim();
  if (!key) throw new Error(`Missing LORE_LIVE_TEST_${ROLE}_PRIVATE_KEY in .env.live-test-wallets`);
  return privateKeyToAccount(normalizePrivateKey(key));
}

function getDryRunAddress(): Address {
  const address = process.env.LORE_LIVE_TEST_AUTOMINER_A_ADDRESS?.trim();
  if (!address) throw new Error(`Missing LORE_LIVE_TEST_${ROLE}_ADDRESS in ${PUBLIC_ADDRESS_ENV_PATH}`);
  return getAddress(address);
}

async function getReplacementFees(publicClient: ReturnType<typeof createPublicClient>) {
  try {
    const fees = await publicClient.estimateFeesPerGas();
    // 3x current fee is intentionally bounded recovery-only headroom for replacing old testnet sends.
    return getKeeperFeeOverrides(fees, CHAIN.id, 300n, 300n) ?? getFallbackFeeOverrides(CHAIN.id, "keeper");
  } catch {
    return getFallbackFeeOverrides(CHAIN.id, "keeper");
  }
}

async function readNonceState(publicClient: ReturnType<typeof createPublicClient>, address: `0x${string}`) {
  const [latest, pending] = await Promise.all([
    publicClient.getTransactionCount({ address, blockTag: "latest" }),
    publicClient.getTransactionCount({ address, blockTag: "pending" }),
  ]);
  return { latest, pending, gap: pending > latest ? pending - latest : 0 };
}

async function main() {
  if (EXECUTE && !EXECUTION_CONFIRMED) {
    throw new Error(`Refusing recovery execution without ${EXECUTION_CONFIRMATION}`);
  }
  const address = getDryRunAddress();
  const primary = process.env.LIVE_TEST_RPC_URL ?? process.env.NEXT_PUBLIC_LINEA_RPCS;
  const publicClient = createPublicClient({
    chain: CHAIN,
    transport: fallback(getStableLineaReadRpcs(primary, NETWORK).map((url) => http(url))),
  });

  const rpcChainId = await publicClient.getChainId();
  if (rpcChainId !== CHAIN.id) throw new Error("Configured recovery RPC is not Linea Sepolia");
  let state = await readNonceState(publicClient, address);
  console.log(JSON.stringify({
    role: ROLE,
    mode: EXECUTE ? "execute" : "dry-run",
    pendingNonceGap: nonNegativeSafeInteger(state.gap),
    replacementCap: MAX_REPLACEMENTS,
    wouldSendReplacement: EXECUTE && state.gap > 0,
    operationalBoundary: {
      dryRunDefault: !EXECUTE,
      signingMaterialLoaded: false,
      walletClientCreated: false,
      contractWriteSubmitted: false,
      transactionSent: false,
    },
  }));
  if (state.gap === 0) return;
  if (!EXECUTE) return;
  const account = getAccount();
  if (account.address !== address) {
    throw new Error("Configured recovery signer does not match the public role address");
  }
  if (!account) throw new Error("Internal error: missing execution account");
  const walletClient = createWalletClient({
    account,
    chain: CHAIN,
    transport: fallback(getPreferredLineaRpcs(primary, NETWORK).map((url) => http(url))),
  });
  for (let replacementCount = 0; state.gap > 0; replacementCount += 1) {
    if (replacementCount >= MAX_REPLACEMENTS) {
      throw new Error("Recovery cap reached before pending nonce queue cleared");
    }
    const fees = await getReplacementFees(publicClient);
    const balance = await publicClient.getBalance({ address });
    const effectivePrice = fees.gasPrice ?? fees.maxFeePerGas;
    if (!effectivePrice || balance < 21_000n * effectivePrice) {
      throw new Error("Insufficient native gas for pending-nonce replacement");
    }
    const transaction = {
      account,
      to: address,
      value: 0n,
      nonce: state.latest,
      gas: 21_000n,
    };
    const hash = fees.gasPrice !== undefined
      ? await walletClient.sendTransaction({ ...transaction, gasPrice: fees.gasPrice })
      : await walletClient.sendTransaction({
        ...transaction,
        maxFeePerGas: fees.maxFeePerGas,
        maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
      });
    try {
      await publicClient.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
    } catch {
      // The next nonce read is authoritative when receipt propagation lags.
    }
    state = await readNonceState(publicClient, address);
    console.log(JSON.stringify({
      role: ROLE,
      replacementCount: nonNegativeSafeInteger(replacementCount + 1),
      pendingNonceGap: nonNegativeSafeInteger(state.gap),
    }));
    // One nonce per invocation keeps recovery bounded and prevents a blind queue sweep.
    return;
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "pending nonce recovery failed";
  const sanitized = sanitizeSupportLogPayload({ message }).message;
  console.error(`pending-nonce recovery failed: ${typeof sanitized === "string" ? sanitized : "Unknown error"}`);
  process.exitCode = 1;
});
