import {
  keccak256,
  parseTransaction,
  recoverTransactionAddress,
} from "viem";
import type { Address, Hex, TransactionSerialized } from "viem";

export type KeeperEligibilityObservation = {
  epoch: bigint;
  endTime: bigint;
  totalPool: bigint;
  isResolved: boolean;
};

export type KeeperNonceObservation = {
  latestNonce: number;
  pendingNonce: number;
};

export type KeeperReceiptObservation = {
  status: "success" | "reverted";
  transactionHash: `0x${string}`;
  blockHash: `0x${string}`;
  blockNumber: bigint;
  transactionIndex: number;
};

export type KeeperCanonicalBlockObservation = {
  headBlock: bigint;
  blockHash: Hex | null;
};

type AgreementReaders<T> = readonly [() => Promise<T>, () => Promise<T>];

export class KeeperRpcAgreementError extends Error {
  constructor(label: string) {
    super(`keeper_rpc_disagreement kind=${label}`);
    this.name = "KeeperRpcAgreementError";
  }
}

export type KeeperSignedTransactionRecord = {
  signer: Address;
  nonce: number;
  hash: Hex;
  serializedTransaction: Hex;
};

export class KeeperSignedTransactionIntegrityError extends Error {
  constructor(field: string) {
    super(`keeper_signed_transaction_integrity_failed field=${field}`);
    this.name = "KeeperSignedTransactionIntegrityError";
  }
}

const MAX_KEEPER_FINALITY_BLOCKS = 1_000_000n;

export function assertKeeperReceiptFinality(
  receipt: KeeperReceiptObservation,
  finalityBlocks: bigint,
  observations: readonly [KeeperCanonicalBlockObservation, KeeperCanonicalBlockObservation],
) {
  if (finalityBlocks <= 0n || finalityBlocks > MAX_KEEPER_FINALITY_BLOCKS) {
    throw new Error("keeper_finality_blocks_invalid");
  }
  const finalityTarget = receipt.blockNumber + finalityBlocks;
  if (observations.some((observation) => observation.headBlock < finalityTarget)) {
    return false;
  }
  for (const observation of observations) {
    if (
      !observation.blockHash ||
      observation.blockHash.toLowerCase() !== receipt.blockHash.toLowerCase()
    ) {
      throw new KeeperRpcAgreementError("receipt_canonical_block");
    }
  }
  return true;
}

function signedTransactionIntegrityFailure(field: string): never {
  throw new KeeperSignedTransactionIntegrityError(field);
}

export async function assertKeeperSignedTransactionIntegrity(
  record: KeeperSignedTransactionRecord,
  expected: {
    chainId: number;
    signer: Address;
    to: Address;
    data: Hex;
  },
) {
  if (keccak256(record.serializedTransaction).toLowerCase() !== record.hash.toLowerCase()) {
    signedTransactionIntegrityFailure("hash");
  }

  let transaction: ReturnType<typeof parseTransaction>;
  let recoveredSigner: Address;
  try {
    const serializedTransaction = record.serializedTransaction as TransactionSerialized;
    transaction = parseTransaction(serializedTransaction);
    recoveredSigner = await recoverTransactionAddress({
      serializedTransaction,
    });
  } catch {
    signedTransactionIntegrityFailure("serialized_transaction");
  }

  const normalizedExpectedSigner = expected.signer.toLowerCase();
  if (
    record.signer.toLowerCase() !== normalizedExpectedSigner ||
    recoveredSigner.toLowerCase() !== normalizedExpectedSigner
  ) {
    signedTransactionIntegrityFailure("signer");
  }
  if (transaction.type !== "legacy" && transaction.type !== "eip1559") {
    signedTransactionIntegrityFailure("type");
  }
  if (transaction.chainId !== expected.chainId) {
    signedTransactionIntegrityFailure("chain_id");
  }
  if ((transaction.nonce ?? 0) !== record.nonce) {
    signedTransactionIntegrityFailure("nonce");
  }
  if (!transaction.to || transaction.to.toLowerCase() !== expected.to.toLowerCase()) {
    signedTransactionIntegrityFailure("to");
  }
  if ((transaction.value ?? 0n) !== 0n) {
    signedTransactionIntegrityFailure("value");
  }
  if ((transaction.data ?? "0x").toLowerCase() !== expected.data.toLowerCase()) {
    signedTransactionIntegrityFailure("data");
  }
  if (typeof transaction.gas !== "bigint" || transaction.gas <= 0n) {
    signedTransactionIntegrityFailure("gas");
  }

  return transaction;
}

export function selectKeeperAgreementRpcUrls(
  urls: readonly string[],
): readonly [string, string] {
  const independentHosts = new Map<string, string>();
  for (const rawUrl of urls) {
    const endpoint = rawUrl.trim();
    if (!endpoint) continue;

    let parsed: URL;
    try {
      parsed = new URL(endpoint);
    } catch {
      throw new Error("keeper_rpc_url_invalid reason=parse");
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("keeper_rpc_url_invalid reason=scheme");
    }
    const hasUserInfo = /^[a-z][a-z\d+.-]*:[\\/]*[^/?#\\]*@/i.test(endpoint);
    if (hasUserInfo || parsed.username || parsed.password) {
      throw new Error("keeper_rpc_url_invalid reason=credentials");
    }

    // URL canonicalizes host case, IDNA and IP spelling; strip the DNS root dot
    // as well. Scheme, port, path and query aliases on one host remain one
    // witness, while the selected endpoint stays intact for transport.
    const parsedHostname = parsed.hostname.toLowerCase();
    const hostname = parsedHostname.replace(/\.+$/, "");
    if (!hostname) {
      throw new Error("keeper_rpc_url_invalid reason=host");
    }
    if (!independentHosts.has(hostname)) {
      independentHosts.set(hostname, endpoint);
    }
  }
  if (independentHosts.size < 2) {
    throw new Error("keeper_independent_rpc_required count=2");
  }
  const selected = [...independentHosts.values()];
  return [selected[0], selected[1]];
}

export async function readWithExactKeeperRpcAgreement<T>(
  label: string,
  readers: AgreementReaders<T>,
  fingerprint: (value: T) => string,
): Promise<T> {
  const [first, second] = await Promise.all([readers[0](), readers[1]()]);
  if (fingerprint(first) !== fingerprint(second)) {
    throw new KeeperRpcAgreementError(label);
  }
  return first;
}

export function fingerprintKeeperEligibility(value: KeeperEligibilityObservation) {
  return [
    value.epoch.toString(),
    value.endTime.toString(),
    value.totalPool.toString(),
    value.isResolved ? "1" : "0",
  ].join(":");
}

export function fingerprintKeeperNonce(value: KeeperNonceObservation) {
  return `${value.latestNonce}:${value.pendingNonce}`;
}

export function fingerprintKeeperReceipt(
  value: KeeperReceiptObservation | null,
) {
  if (!value) return "missing";
  return [
    value.status,
    value.transactionHash.toLowerCase(),
    value.blockHash.toLowerCase(),
    value.blockNumber.toString(),
    value.transactionIndex.toString(),
  ].join(":");
}
