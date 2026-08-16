import { getAddress } from "viem";

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
