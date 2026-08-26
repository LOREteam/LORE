import { getAddress } from "viem";
import {
  createPendingMiningAgreementClients,
  waitForPendingMiningReceiptAgreement,
  type PendingMiningTxClients,
} from "./miningTxPath";
import {
  createWalletContractIntent,
  retainWalletTransferSendResult,
  resolveWalletTransferIntent,
  withWalletTransferIntentLease,
  type WalletTransferIntentAcquisition,
  type WalletTransferNonceClients,
  type WalletTransferReceiptClients,
} from "./walletTransferIntent";

const HEX_RE = /^0x(?:[0-9a-fA-F]{2})*$/;
const HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const SUPPORTED_TRANSACTION_TYPES = new Set(["legacy", "eip2930", "eip1559"]);

export class ClaimTransactionIntentError extends Error {
  constructor() {
    super("Claim transaction does not match the submitted intent.");
    this.name = "ClaimTransactionIntentError";
  }
}

export type ClaimTransactionIntent = {
  actor: string;
  chainId: number;
  contract: string;
  calldata: `0x${string}`;
};

export type ClaimTransactionNonceClient = {
  getTransactionCount: (args: {
    address: `0x${string}`;
    blockTag: "latest" | "pending";
  }) => Promise<unknown>;
  getTransaction?: (args: { hash: `0x${string}` }) => Promise<unknown>;
};

export type ClaimTransactionNonceClients = readonly [
  ClaimTransactionNonceClient,
  ClaimTransactionNonceClient,
];

type ClaimTransactionObservation = {
  hash?: unknown;
  chainId?: unknown;
  from?: unknown;
  to?: unknown;
  value?: unknown;
  input?: unknown;
  type?: unknown;
};

function normalizedAddress(value: unknown) {
  if (typeof value !== "string") throw new ClaimTransactionIntentError();
  try {
    return getAddress(value).toLowerCase();
  } catch {
    throw new ClaimTransactionIntentError();
  }
}

function normalizeClaimNonce(value: unknown) {
  if (typeof value === "bigint") {
    if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new ClaimTransactionIntentError();
    }
    return Number(value);
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ClaimTransactionIntentError();
  }
  return value;
}

function toWalletTransferNonceClients(
  clients: ClaimTransactionNonceClients,
): WalletTransferNonceClients {
  return clients.map((client) => ({
    getTransactionCount: async (args: {
      address: `0x${string}`;
      blockTag: "latest" | "pending";
    }) =>
      normalizeClaimNonce(await client.getTransactionCount(args)),
    ...(typeof client.getTransaction === "function"
      ? { getTransaction: client.getTransaction.bind(client) }
      : {}),
  })) as unknown as WalletTransferNonceClients;
}

export function createClaimTransactionNonceClients(): ClaimTransactionNonceClients | null {
  const clients = createPendingMiningAgreementClients();
  if (
    !clients ||
    typeof clients[0].getTransactionCount !== "function" ||
    typeof clients[1].getTransactionCount !== "function"
  ) {
    return null;
  }
  return clients as ClaimTransactionNonceClients;
}

/**
 * Reserve the actor nonce and retain a late wallet result before every Wagmi
 * claim sink. Hashless contract calls deliberately stay blocked across reloads
 * until an observed hash reaches exact terminal reconciliation.
 */
export async function withClaimTransactionIntentLease<T>(
  intent: ClaimTransactionIntent,
  clients: ClaimTransactionNonceClients,
  callback: (
    acquisition: WalletTransferIntentAcquisition,
    retainResult: typeof retainWalletTransferSendResult,
  ) => Promise<T>,
  options?: {
    abandonOnError?: (error: unknown) => boolean;
  },
): Promise<T> {
  return withWalletTransferIntentLease(
    createWalletContractIntent(intent),
    toWalletTransferNonceClients(clients),
    callback,
    options,
  );
}

/**
 * Reject a wallet-returned hash unless the canonical transaction envelope is
 * exactly the zero-value claim call the active wallet prepared.
 */
export function assertClaimTransactionMatchesIntent(
  intent: ClaimTransactionIntent,
  hash: `0x${string}`,
  transaction: ClaimTransactionObservation,
) {
  const normalizedHash = typeof transaction.hash === "string" && HASH_RE.test(transaction.hash)
    ? transaction.hash.toLowerCase()
    : "";
  const normalizedInput = typeof transaction.input === "string" && HEX_RE.test(transaction.input)
    ? transaction.input.toLowerCase()
    : "";
  const transactionType = typeof transaction.type === "string"
    ? transaction.type.toLowerCase()
    : "";
  const intentChainId = Number.isSafeInteger(intent.chainId) && intent.chainId > 0
    ? intent.chainId
    : 0;
  const expectedInput = typeof intent.calldata === "string" && HEX_RE.test(intent.calldata)
    ? intent.calldata.toLowerCase()
    : "";

  if (
    !HASH_RE.test(hash) ||
    !intentChainId ||
    !expectedInput ||
    normalizedHash !== hash.toLowerCase() ||
    transaction.chainId !== intentChainId ||
    normalizedAddress(transaction.from) !== normalizedAddress(intent.actor) ||
    normalizedAddress(transaction.to) !== normalizedAddress(intent.contract) ||
    transaction.value !== 0n ||
    normalizedInput !== expectedInput ||
    !SUPPORTED_TRANSACTION_TYPES.has(transactionType)
  ) {
    throw new ClaimTransactionIntentError();
  }
}

/**
 * A submitted claim stays pending until two independently selected RPC origins
 * agree on a finalized receipt and both return the exact signed claim call.
 */
export async function waitForClaimTransactionReceiptAgreement(
  intent: ClaimTransactionIntent,
  hash: `0x${string}`,
  timeout: number,
  providedClients?: PendingMiningTxClients,
): Promise<"confirmed" | "pending"> {
  const clients = providedClients ?? createPendingMiningAgreementClients();
  if (!clients) return "pending";
  try {
    const receiptState = await waitForPendingMiningReceiptAgreement(clients, hash, timeout);
    if (receiptState !== "confirmed") return "pending";
    const transactions = await Promise.all(clients.map((client) => client.getTransaction({ hash })));
    assertClaimTransactionMatchesIntent(intent, hash, transactions[0]);
    assertClaimTransactionMatchesIntent(intent, hash, transactions[1]);
    return "confirmed";
  } catch (error) {
    if (error instanceof ClaimTransactionIntentError) throw error;
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (message.startsWith("transaction reverted")) throw error;
    return "pending";
  }
}

function getClaimResolutionClients(
  clients: PendingMiningTxClients,
): WalletTransferReceiptClients | null {
  for (const client of clients) {
    if (
      typeof client.waitForTransactionReceipt !== "function" ||
      typeof client.getTransactionReceipt !== "function" ||
      typeof client.getTransaction !== "function" ||
      typeof client.getBlockNumber !== "function"
    ) {
      return null;
    }
  }
  return clients as WalletTransferReceiptClients;
}

/**
 * Confirm a claim and resolve the durable pre-send lease only after the same
 * two independent RPC origins prove the exact canonical transaction envelope.
 */
export async function waitForTrackedClaimTransactionReceiptAgreement(
  intent: ClaimTransactionIntent,
  hash: `0x${string}`,
  timeout: number,
  providedClients?: PendingMiningTxClients,
): Promise<"confirmed" | "pending"> {
  const clients = providedClients ?? createPendingMiningAgreementClients();
  if (!clients) return "pending";

  let receiptState: "confirmed" | "pending";
  try {
    receiptState = await waitForClaimTransactionReceiptAgreement(intent, hash, timeout, clients);
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (!message.startsWith("transaction reverted")) throw error;
    const resolutionClients = getClaimResolutionClients(clients);
    if (!resolutionClients) throw new ClaimTransactionIntentError();
    let resolved: boolean;
    try {
      resolved = await resolveWalletTransferIntent(
        createWalletContractIntent(intent),
        hash,
        "reverted",
        resolutionClients,
      );
    } catch {
      throw new ClaimTransactionIntentError();
    }
    if (!resolved) throw new ClaimTransactionIntentError();
    throw error;
  }
  if (receiptState === "pending") return receiptState;

  const resolutionClients = getClaimResolutionClients(clients);
  if (!resolutionClients) throw new ClaimTransactionIntentError();
  let resolved: boolean;
  try {
    resolved = await resolveWalletTransferIntent(
      createWalletContractIntent(intent),
      hash,
      "confirmed",
      resolutionClients,
    );
  } catch {
    throw new ClaimTransactionIntentError();
  }
  if (!resolved) throw new ClaimTransactionIntentError();
  return receiptState;
}
