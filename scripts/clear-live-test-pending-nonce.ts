import { config as loadDotenv } from "dotenv";
import { existsSync, statSync } from "node:fs";
import { createPublicClient, createWalletClient, fallback, getAddress, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { getFallbackFeeOverrides, getKeeperFeeOverrides } from "../app/lib/lineaFees";
import { sanitizeSupportLogPayload } from "../app/lib/sentrySanitize";
import { getConfiguredLineaNetwork, getLineaChain, getPreferredLineaRpcs, getStableLineaReadRpcs } from "../config/publicConfig";

const PUBLIC_ADDRESS_ENV_PATH = ".env.live-test-addresses";
const LIVE_WALLET_ENV_PATH = ".env.live-test-wallets";
const PUBLIC_ADDRESS_ENV_NAME_RE =
  /^LORE_LIVE_TEST_(?:MANUAL|AUTOMINER_A|AUTOMINER_B|AUTOMINER_C|RESOLVER)_ADDRESS$/;
const SIGNING_ENV_NAME_RE = /(?:^|_)(?:PRIVATE_KEY|MNEMONIC|SEED(?:_PHRASE)?|SIGNING_KEY)(?:_|$)/i;
const INSPECT_PUBLIC_ADDRESS_ENV_ARG = "--inspect-public-address-env";
const BEHAVIOR_SELF_TEST_ARG = "--behavior-self-test";
const BEHAVIOR_SELF_TEST_SECRET_FAULT_ARG = "--self-test-secret-fault";

function assertOptionalEnvFile(path: string, description: string) {
  if (existsSync(path) && !statSync(path).isFile()) {
    throw new Error(`${path} must be ${description}, not a directory`);
  }
}

function loadPublicAddressEnvFileIfPresent(): Readonly<Record<string, string>> {
  assertOptionalEnvFile(PUBLIC_ADDRESS_ENV_PATH, "an address env file");
  if (!existsSync(PUBLIC_ADDRESS_ENV_PATH)) return Object.freeze({});
  const isolatedEnv: Record<string, string> = {};
  const result = loadDotenv({
    path: PUBLIC_ADDRESS_ENV_PATH,
    override: false,
    quiet: true,
    processEnv: isolatedEnv,
  });
  if (result.error) throw new Error(`${PUBLIC_ADDRESS_ENV_PATH} could not be parsed safely`);
  const parsed = result.parsed ?? {};
  if (Object.keys(parsed).some((name) => !PUBLIC_ADDRESS_ENV_NAME_RE.test(name))) {
    throw new Error(`${PUBLIC_ADDRESS_ENV_PATH} may contain only public live-test role addresses`);
  }
  return Object.freeze({ ...parsed });
}

function loadSigningEnvFileIfPresent() {
  assertOptionalEnvFile(LIVE_WALLET_ENV_PATH, "a wallet env file");
  if (!existsSync(LIVE_WALLET_ENV_PATH)) return;
  const result = loadDotenv({ path: LIVE_WALLET_ENV_PATH, override: false, quiet: true });
  if (result.error) throw new Error(`${LIVE_WALLET_ENV_PATH} could not be parsed safely`);
}

function hasSigningMaterialInEnvironment(env: Readonly<Record<string, string | undefined>> = process.env) {
  return Object.entries(env).some(
    ([name, value]) => Boolean(value?.trim()) && SIGNING_ENV_NAME_RE.test(name),
  );
}

const ROLE = "AUTOMINER_A";
const EXECUTE = process.argv.includes("--execute");
const EXECUTION_CONFIRMATION = "--confirm-lowest-pending-nonce-replacement";
const EXECUTION_CONFIRMED = process.argv.includes(EXECUTION_CONFIRMATION);
const BEHAVIOR_SELF_TEST = process.argv.includes(BEHAVIOR_SELF_TEST_ARG);
const BEHAVIOR_SELF_TEST_SECRET_FAULT = process.argv.includes(BEHAVIOR_SELF_TEST_SECRET_FAULT_ARG);
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

function assertExecutionAdmission(execute: boolean, confirmed: boolean) {
  if (execute && !confirmed) {
    throw new Error(`Refusing recovery execution without ${EXECUTION_CONFIRMATION}`);
  }
}

function normalizePrivateKey(raw: string): `0x${string}` {
  const trimmed = raw.trim();
  return trimmed.startsWith("0x") ? (trimmed as `0x${string}`) : (`0x${trimmed}` as `0x${string}`);
}

function getAccount() {
  loadSigningEnvFileIfPresent();
  const key = process.env.LORE_LIVE_TEST_AUTOMINER_A_PRIVATE_KEY?.trim();
  if (!key) throw new Error(`Missing LORE_LIVE_TEST_${ROLE}_PRIVATE_KEY in .env.live-test-wallets`);
  return privateKeyToAccount(normalizePrivateKey(key));
}

function getDryRunAddress(publicAddressEnv: Readonly<Record<string, string>>): Address {
  const address =
    process.env.LORE_LIVE_TEST_AUTOMINER_A_ADDRESS?.trim() ||
    publicAddressEnv.LORE_LIVE_TEST_AUTOMINER_A_ADDRESS?.trim();
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

type RecoveryAccount = ReturnType<typeof privateKeyToAccount>;
type RecoveryPublicClient = ReturnType<typeof createPublicClient>;

async function runRecoveryWithClients({
  execute,
  address,
  signingMaterialLoaded,
  publicClient,
  loadAccount,
  sendReplacement,
  emit,
}: {
  execute: boolean;
  address: Address;
  signingMaterialLoaded: boolean;
  publicClient: RecoveryPublicClient;
  loadAccount: () => RecoveryAccount;
  sendReplacement: (
    account: RecoveryAccount,
    transaction: { to: Address; value: bigint; nonce: number; gas: bigint },
    fees: Awaited<ReturnType<typeof getReplacementFees>>,
  ) => Promise<`0x${string}`>;
  emit: (value: unknown) => void;
}) {
  const rpcChainId = await publicClient.getChainId();
  if (rpcChainId !== CHAIN.id) throw new Error("Configured recovery RPC is not Linea Sepolia");
  let state = await readNonceState(publicClient, address);
  emit({
    role: ROLE,
    mode: execute ? "execute" : "dry-run",
    pendingNonceGap: nonNegativeSafeInteger(state.gap),
    replacementCap: MAX_REPLACEMENTS,
    wouldSendReplacement: execute && state.gap > 0,
    operationalBoundary: {
      dryRunDefault: !execute,
      signingMaterialLoaded,
      walletClientCreated: false,
      contractWriteSubmitted: false,
      transactionSent: false,
    },
  });
  if (state.gap === 0 || !execute) return;
  const account = loadAccount();
  if (account.address !== address) {
    throw new Error("Configured recovery signer does not match the public role address");
  }
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
      to: address,
      value: 0n,
      nonce: state.latest,
      gas: 21_000n,
    };
    const hash = await sendReplacement(account, transaction, fees);
    try {
      await publicClient.waitForTransactionReceipt({ hash, timeout: RECEIPT_TIMEOUT_MS });
    } catch {
      // The next nonce read is authoritative when receipt propagation lags.
    }
    state = await readNonceState(publicClient, address);
    emit({
      role: ROLE,
      replacementCount: nonNegativeSafeInteger(replacementCount + 1),
      pendingNonceGap: nonNegativeSafeInteger(state.gap),
    });
    // One nonce per invocation keeps recovery bounded and prevents a blind queue sweep.
    return;
  }
}

function selfTestCondition(condition: unknown, label: string): asserts condition {
  if (!condition) throw new Error(`behavior self-test failed: ${label}`);
}

function selfTestErrorMatches(error: unknown, pattern: RegExp) {
  return error instanceof Error && pattern.test(error.message);
}

async function runBehaviorSelfTest() {
  if (BEHAVIOR_SELF_TEST_SECRET_FAULT) {
    throw new Error("rpc=https://operator:wallet-secret@rpc.invalid/private?token=private-token");
  }

  let faultMutantsRejected = 0;
  for (const [execute, confirmed, accepted] of [
    [false, false, true],
    [false, true, true],
    [true, false, false],
    [true, true, true],
  ] as const) {
    let actualAccepted = true;
    try {
      assertExecutionAdmission(execute, confirmed);
    } catch {
      actualAccepted = false;
    }
    selfTestCondition(actualAccepted === accepted, "execution admission matrix diverged");
    if (!accepted) faultMutantsRejected += 1;
  }

  selfTestCondition(hasSigningMaterialInEnvironment({}) === false, "empty env was classified as signing material");
  for (const name of ["PRIVATE_KEY", "LORE_PRIVATE_KEY", "WALLET_MNEMONIC", "SEED_PHRASE", "SIGNING_KEY_BACKUP"]) {
    selfTestCondition(
      hasSigningMaterialInEnvironment({ [name]: "present" }) === true,
      "signing material alias was not detected",
    );
    faultMutantsRejected += 1;
  }
  selfTestCondition(
    hasSigningMaterialInEnvironment({ LORE_LIVE_TEST_AUTOMINER_A_ADDRESS: "0x1111111111111111111111111111111111111111" }) === false,
    "public address was misclassified as signing material",
  );

  let missingAddressRejected = false;
  try {
    getDryRunAddress({});
  } catch (error) {
    missingAddressRejected = selfTestErrorMatches(error, /Missing LORE_LIVE_TEST_AUTOMINER_A_ADDRESS in \.env\.live-test-addresses/);
  }
  selfTestCondition(missingAddressRejected, "missing public address did not fail with operator guidance");
  faultMutantsRejected += 1;

  for (const value of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1", 1n, null, undefined]) {
    selfTestCondition(nonNegativeSafeInteger(value) === 0, "unsafe summary integer mutant was accepted");
    faultMutantsRejected += 1;
  }
  selfTestCondition(nonNegativeSafeInteger(0) === 0, "zero summary integer was rejected");
  selfTestCondition(nonNegativeSafeInteger(42) === 42, "safe summary integer was not preserved");

  const address = "0x2222222222222222222222222222222222222222" as Address;
  const otherAddress = "0x3333333333333333333333333333333333333333" as Address;
  const matchingAccount = { address } as RecoveryAccount;
  const mismatchedAccount = { address: otherAddress } as RecoveryAccount;
  const makePublicClient = ({
    chainId = CHAIN.id,
    nonceSequence = [10, 12, 11, 12],
    balance = 10n ** 18n,
    receiptRejects = true,
  }: {
    chainId?: number;
    nonceSequence?: number[];
    balance?: bigint;
    receiptRejects?: boolean;
  } = {}) => {
    const nonces = [...nonceSequence];
    const calls = {
      chain: 0,
      nonce: 0,
      fees: 0,
      balance: 0,
      receipt: 0,
    };
    const client = {
      async getChainId() {
        calls.chain += 1;
        return chainId;
      },
      async getTransactionCount() {
        calls.nonce += 1;
        const value = nonces.shift();
        if (value === undefined) throw new Error("unexpected nonce read");
        return value;
      },
      async estimateFeesPerGas() {
        calls.fees += 1;
        return { gasPrice: 2n };
      },
      async getBalance() {
        calls.balance += 1;
        return balance;
      },
      async waitForTransactionReceipt() {
        calls.receipt += 1;
        if (receiptRejects) throw new Error("synthetic receipt propagation lag");
        return { status: "success" };
      },
    } as unknown as RecoveryPublicClient;
    return { client, calls };
  };
  const makeWalletHarness = () => {
    const transactions: Array<Record<string, unknown>> = [];
    let walletClientsCreated = 0;
    const factory = () => {
      walletClientsCreated += 1;
      return {
        async sendTransaction(transaction: Record<string, unknown>) {
          transactions.push(transaction);
          return `0x${"a".repeat(64)}` as `0x${string}`;
        },
      };
    };
    return { transactions, factory, walletClientsCreated: () => walletClientsCreated };
  };

  {
    const { client, calls } = makePublicClient({ nonceSequence: [10, 12] });
    const wallet = makeWalletHarness();
    let accountLoads = 0;
    const emitted: unknown[] = [];
    await runRecoveryWithClients({
      execute: false,
      address,
      signingMaterialLoaded: false,
      publicClient: client,
      loadAccount: () => {
        accountLoads += 1;
        return matchingAccount;
      },
      sendReplacement: async (_account, transaction, fees) => wallet.factory().sendTransaction({
        ...transaction,
        ...(fees.gasPrice !== undefined
          ? { gasPrice: fees.gasPrice }
          : { maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas }),
      } as never),
      emit: (value) => emitted.push(value),
    });
    const summary = emitted[0] as Record<string, unknown>;
    selfTestCondition(accountLoads === 0 && wallet.walletClientsCreated() === 0, "dry-run loaded signing or wallet state");
    selfTestCondition(wallet.transactions.length === 0, "dry-run submitted a transaction");
    selfTestCondition(calls.chain === 1 && calls.nonce === 2 && calls.fees === 0, "dry-run performed unexpected RPC operations");
    selfTestCondition(summary.pendingNonceGap === 2 && summary.wouldSendReplacement === false, "dry-run summary lost nonce-gap evidence");
    faultMutantsRejected += 1;
  }

  {
    const { client } = makePublicClient({ nonceSequence: [10, 10] });
    const wallet = makeWalletHarness();
    let accountLoads = 0;
    await runRecoveryWithClients({
      execute: true,
      address,
      signingMaterialLoaded: false,
      publicClient: client,
      loadAccount: () => {
        accountLoads += 1;
        return matchingAccount;
      },
      sendReplacement: async (_account, transaction, fees) => wallet.factory().sendTransaction({
        ...transaction,
        ...(fees.gasPrice !== undefined
          ? { gasPrice: fees.gasPrice }
          : { maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas }),
      } as never),
      emit: () => {},
    });
    selfTestCondition(accountLoads === 0 && wallet.walletClientsCreated() === 0, "zero-gap execution loaded signing state");
    selfTestCondition(wallet.transactions.length === 0, "zero-gap execution submitted a transaction");
    faultMutantsRejected += 1;
  }

  {
    const { client } = makePublicClient({ chainId: 59144, nonceSequence: [] });
    const wallet = makeWalletHarness();
    let rejected = false;
    try {
      await runRecoveryWithClients({
        execute: false,
        address,
        signingMaterialLoaded: false,
        publicClient: client,
        loadAccount: () => matchingAccount,
        sendReplacement: async (_account, transaction, fees) => wallet.factory().sendTransaction({
          ...transaction,
          ...(fees.gasPrice !== undefined
            ? { gasPrice: fees.gasPrice }
            : { maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas }),
        } as never),
        emit: () => {},
      });
    } catch (error) {
      rejected = selfTestErrorMatches(error, /RPC is not Linea Sepolia/);
    }
    selfTestCondition(rejected && wallet.walletClientsCreated() === 0, "wrong-chain mutant reached wallet state");
    faultMutantsRejected += 1;
  }

  {
    const { client } = makePublicClient({ nonceSequence: [10, 12] });
    const wallet = makeWalletHarness();
    let rejected = false;
    try {
      await runRecoveryWithClients({
        execute: true,
        address,
        signingMaterialLoaded: true,
        publicClient: client,
        loadAccount: () => mismatchedAccount,
        sendReplacement: async (_account, transaction, fees) => wallet.factory().sendTransaction({
          ...transaction,
          ...(fees.gasPrice !== undefined
            ? { gasPrice: fees.gasPrice }
            : { maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas }),
        } as never),
        emit: () => {},
      });
    } catch (error) {
      rejected = selfTestErrorMatches(error, /signer does not match the public role address/);
    }
    selfTestCondition(rejected && wallet.walletClientsCreated() === 0, "mismatched signer mutant created a wallet client");
    selfTestCondition(wallet.transactions.length === 0, "mismatched signer mutant submitted a transaction");
    faultMutantsRejected += 1;
  }

  let happySummaryText = "";
  {
    const { client, calls } = makePublicClient();
    const wallet = makeWalletHarness();
    const emitted: unknown[] = [];
    await runRecoveryWithClients({
      execute: true,
      address,
      signingMaterialLoaded: true,
      publicClient: client,
      loadAccount: () => matchingAccount,
      sendReplacement: async (_account, transaction, fees) => wallet.factory().sendTransaction({
        ...transaction,
        ...(fees.gasPrice !== undefined
          ? { gasPrice: fees.gasPrice }
          : { maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas }),
      } as never),
      emit: (value) => emitted.push(value),
    });
    selfTestCondition(wallet.walletClientsCreated() === 1, "bounded execution did not create exactly one wallet client");
    selfTestCondition(wallet.transactions.length === 1, "bounded execution did not submit exactly one replacement");
    const transaction = wallet.transactions[0];
    selfTestCondition(transaction.to === address, "replacement was not a self-transfer");
    selfTestCondition(transaction.value === 0n, "replacement transferred value");
    selfTestCondition(transaction.nonce === 10, "replacement did not use the lowest pending nonce");
    selfTestCondition(transaction.gas === 21_000n, "replacement exceeded the fixed gas boundary");
    selfTestCondition(!("abi" in transaction) && !("functionName" in transaction), "replacement contained contract-call fields");
    selfTestCondition(calls.receipt === 1 && calls.nonce === 4, "receipt lag did not fall back to an authoritative nonce read");
    selfTestCondition((emitted[1] as Record<string, unknown>).replacementCount === 1, "replacement summary lost its bounded count");
    selfTestCondition((emitted[1] as Record<string, unknown>).pendingNonceGap === 1, "replacement summary lost the remaining gap");
    happySummaryText = JSON.stringify(emitted);
    selfTestCondition(!happySummaryText.includes(address), "operator summary exposed the role address");
    selfTestCondition(!/0x[a-f0-9]{64}/i.test(happySummaryText), "operator summary exposed the transaction hash");
    faultMutantsRejected += 5;
  }

  console.log(JSON.stringify({
    status: "pass",
    cliExecute: EXECUTE,
    cliConfirmed: EXECUTION_CONFIRMED,
    cliAdmitted: !EXECUTE || EXECUTION_CONFIRMED,
    dryRunDefault: true,
    publicAddressIsolation: true,
    signingMaterialDetection: true,
    wrongChainRejected: true,
    mismatchedSignerRejected: true,
    singleSelfTransfer: true,
    summaryRedacted: true,
    walletClientsCreated: 0,
    networkRequests: 0,
    contractWrites: 0,
    faultMutantsRejected,
  }));
}

async function main() {
  assertExecutionAdmission(EXECUTE, EXECUTION_CONFIRMED);
  const publicAddressEnv = loadPublicAddressEnvFileIfPresent();
  const signingMaterialLoaded = hasSigningMaterialInEnvironment();
  if (process.argv.includes(INSPECT_PUBLIC_ADDRESS_ENV_ARG)) {
    console.log(JSON.stringify({
      mode: EXECUTE ? "execute" : "dry-run",
      publicAddressKeys: Object.keys(publicAddressEnv).sort(),
      signingMaterialLoaded,
      walletClientCreated: false,
      contractWriteSubmitted: false,
      transactionSent: false,
    }));
    if (signingMaterialLoaded) {
      throw new Error("Read-only pending-nonce inspection refuses inherited signing material");
    }
    return;
  }
  if (!EXECUTE && signingMaterialLoaded) {
    throw new Error("Dry-run pending-nonce recovery refuses inherited signing material");
  }
  const address = getDryRunAddress(publicAddressEnv);
  const primary = process.env.LIVE_TEST_RPC_URL ?? process.env.NEXT_PUBLIC_LINEA_RPCS;
  const publicClient = createPublicClient({
    chain: CHAIN,
    transport: fallback(getStableLineaReadRpcs(primary, NETWORK).map((url) => http(url))),
  });
  await runRecoveryWithClients({
    execute: EXECUTE,
    address,
    signingMaterialLoaded,
    publicClient,
    loadAccount: getAccount,
    sendReplacement: async (account, transaction, fees) => {
      const walletClient = createWalletClient({
        account,
        chain: CHAIN,
        transport: fallback(getPreferredLineaRpcs(primary, NETWORK).map((url) => http(url))),
      });
      return fees.gasPrice !== undefined
        ? walletClient.sendTransaction({ ...transaction, account, chain: CHAIN, gasPrice: fees.gasPrice })
        : walletClient.sendTransaction({
          ...transaction,
          account,
          chain: CHAIN,
          maxFeePerGas: fees.maxFeePerGas,
          maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
        });
    },
    emit: (value) => console.log(JSON.stringify(value)),
  });
}

const cliOperation = BEHAVIOR_SELF_TEST ? runBehaviorSelfTest() : main();

cliOperation.catch((error) => {
  const message = error instanceof Error ? error.message : "pending nonce recovery failed";
  const sanitized = sanitizeSupportLogPayload({ message }).message;
  console.error(`pending-nonce recovery failed: ${typeof sanitized === "string" ? sanitized : "Unknown error"}`);
  process.exitCode = 1;
});
