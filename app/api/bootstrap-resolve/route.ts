import { NextResponse } from "next/server";
import { encodeFunctionData, keccak256 } from "viem";
import type { Hex } from "viem";
import {
  assertKeeperFeeBudget,
  getKeeperFeeOverrides,
} from "../../lib/lineaFees";
import { recordLineaEstimateGasShadow } from "../../lib/lineaEstimateGasShadow";
import {
  assertKeeperSignedTransactionIntegrity,
  fingerprintKeeperEligibility,
  fingerprintKeeperNonce,
  fingerprintKeeperReceipt,
  KeeperRpcAgreementError,
  KeeperSignedTransactionIntegrityError,
  readWithExactKeeperRpcAgreement,
} from "../../../server/keeperSigningSafety";
import type {
  KeeperEligibilityObservation,
  KeeperNonceObservation,
  KeeperReceiptObservation,
} from "../../../server/keeperSigningSafety";
import {
  deleteMetaJson,
  readMetaJsonStrict,
  setMetaJson,
} from "../../../server/storage";
import { enforceSharedRateLimit } from "../_lib/sharedRateLimit";
import { logRouteError } from "../_lib/routeError";
import { applyNoStoreHeaders } from "../_lib/responseHeaders";
import {
  acquireResolveLock,
  APP_CHAIN,
  BOOTSTRAP_RESOLVE_ABI,
  BOOTSTRAP_RPC_UNAVAILABLE_RETRY_MS,
  CONTRACT_ADDRESS,
  getBootstrapAgreementClients,
  getBootstrapKeeperAccount,
  getResolveNoopReason,
  isAuthorizedBootstrapRequest,
  isLocalDevBootstrapRequest,
  isRpcReadRetryableError,
  RESOLVE_OPERATION_LOCK_TTL_MS,
  RESOLVE_THROTTLE_MS,
} from "./shared";

const INSUFFICIENT_FUNDS_RETRY_MS = 300_000;
const RESOLVE_RECEIPT_TIMEOUT_MS = 25_000;
const RESOLVE_GAS_BUFFER_PERCENT = 150n;
const ZERO_CONTENT_LENGTH_RE = /^0$/;
const BOOTSTRAP_PENDING_RESOLVE_META_KEY = "bootstrap:pendingResolve:v1";
const HASH_RE = /^0x[a-fA-F0-9]{64}$/;
const SERIALIZED_TRANSACTION_RE = /^0x(?:[a-fA-F0-9]{2})+$/;
const PENDING_STATES = new Set(["signed", "submitted"]);
const FINAL_STATES = new Set(["success", "reverted"]);

type BootstrapAgreementClients = ReturnType<
  typeof getBootstrapAgreementClients
>["clients"];
type BootstrapPublicClient = BootstrapAgreementClients[number];
type BootstrapPendingResolveRecord = {
  epoch: string;
  signer: `0x${string}`;
  nonce: number;
  hash: `0x${string}`;
  serializedTransaction: Hex;
  signedAt: number;
  state: "signed" | "submitted" | "success" | "reverted";
};

class BootstrapPendingResolveRecordError extends Error {
  constructor(reason: string) {
    super(`bootstrap_pending_record_invalid reason=${reason}`);
    this.name = "BootstrapPendingResolveRecordError";
  }
}

function hasUnexpectedRequestBody(request: Request) {
  const contentLength = request.headers.get("content-length")?.trim();
  if (contentLength) {
    if (!ZERO_CONTENT_LENGTH_RE.test(contentLength)) return true;
  }
  return request.body !== null;
}

function json(payload: Record<string, unknown>, init?: ResponseInit) {
  return applyNoStoreHeaders(NextResponse.json(payload, init));
}

function isKeeperInsufficientFundsError(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes("insufficient funds") ||
    lower.includes("exceeds the balance of the account")
  );
}

function isReceiptPendingError(message: string) {
  const lower = message.toLowerCase();
  return (
    lower.includes("timed out") ||
    lower.includes("timeout") ||
    lower.includes("transaction receipt") &&
      (lower.includes("not found") || lower.includes("could not be found"))
  );
}

function isPendingResolveRecord(value: unknown): value is BootstrapPendingResolveRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<BootstrapPendingResolveRecord>;
  return (
    typeof record.epoch === "string" &&
    /^\d+$/.test(record.epoch) &&
    typeof record.signer === "string" &&
    /^0x[a-fA-F0-9]{40}$/.test(record.signer) &&
    Number.isSafeInteger(record.nonce) &&
    (record.nonce ?? -1) >= 0 &&
    typeof record.hash === "string" &&
    HASH_RE.test(record.hash) &&
    typeof record.serializedTransaction === "string" &&
    SERIALIZED_TRANSACTION_RE.test(record.serializedTransaction) &&
    Number.isSafeInteger(record.signedAt) &&
    (record.signedAt ?? 0) > 0 &&
    typeof record.state === "string" &&
    (PENDING_STATES.has(record.state) || FINAL_STATES.has(record.state))
  );
}

function readPendingResolveRecord() {
  let stored: { found: false } | { found: true; value: unknown };
  try {
    stored = readMetaJsonStrict<unknown>(BOOTSTRAP_PENDING_RESOLVE_META_KEY);
  } catch {
    throw new BootstrapPendingResolveRecordError("json");
  }
  if (!stored.found) return null;
  const value = stored.value;
  if (!isPendingResolveRecord(value)) {
    throw new BootstrapPendingResolveRecordError("shape");
  }
  return value;
}

function savePendingResolveRecord(record: BootstrapPendingResolveRecord) {
  setMetaJson(BOOTSTRAP_PENDING_RESOLVE_META_KEY, record);
  return record;
}

function expectedResolveData(epoch: string) {
  return encodeFunctionData({
    abi: BOOTSTRAP_RESOLVE_ABI,
    functionName: "resolveEpoch",
    args: [BigInt(epoch)],
  });
}

function assertBootstrapPendingResolveIntegrity(
  record: BootstrapPendingResolveRecord,
  expectedSigner: `0x${string}`,
  expectedEpoch?: bigint,
) {
  if (expectedEpoch !== undefined && BigInt(record.epoch) !== expectedEpoch) {
    throw new BootstrapPendingResolveRecordError("epoch_mismatch");
  }
  return assertKeeperSignedTransactionIntegrity(record, {
    chainId: APP_CHAIN.id,
    signer: expectedSigner,
    to: CONTRACT_ADDRESS,
    data: expectedResolveData(record.epoch),
  });
}

async function readBootstrapEligibility(
  client: BootstrapPublicClient,
): Promise<KeeperEligibilityObservation> {
  const epoch = await client.readContract({
    address: CONTRACT_ADDRESS,
    abi: BOOTSTRAP_RESOLVE_ABI,
    functionName: "currentEpoch",
  }) as bigint;
  const [endTime, epochData] = await Promise.all([
    client.readContract({
      address: CONTRACT_ADDRESS,
      abi: BOOTSTRAP_RESOLVE_ABI,
      functionName: "getEpochEndTime",
      args: [epoch],
    }) as Promise<bigint>,
    client.readContract({
      address: CONTRACT_ADDRESS,
      abi: BOOTSTRAP_RESOLVE_ABI,
      functionName: "epochs",
      args: [epoch],
    }) as Promise<[bigint, bigint, bigint, boolean, boolean, boolean]>,
  ]);
  return {
    epoch,
    endTime,
    totalPool: epochData[0],
    isResolved: Boolean(epochData[3]),
  };
}

function readAgreedBootstrapEligibility(clients: BootstrapAgreementClients) {
  return readWithExactKeeperRpcAgreement(
    "bootstrap_eligibility",
    [
      () => readBootstrapEligibility(clients[0]),
      () => readBootstrapEligibility(clients[1]),
    ],
    fingerprintKeeperEligibility,
  );
}

async function readBootstrapNonce(
  client: BootstrapPublicClient,
  address: `0x${string}`,
): Promise<KeeperNonceObservation> {
  const [latestNonce, pendingNonce] = await Promise.all([
    client.getTransactionCount({ address, blockTag: "latest" }),
    client.getTransactionCount({ address, blockTag: "pending" }),
  ]);
  return { latestNonce, pendingNonce };
}

function readAgreedBootstrapNonce(
  clients: BootstrapAgreementClients,
  address: `0x${string}`,
) {
  return readWithExactKeeperRpcAgreement(
    "bootstrap_nonce",
    [
      () => readBootstrapNonce(clients[0], address),
      () => readBootstrapNonce(clients[1], address),
    ],
    fingerprintKeeperNonce,
  );
}

async function readBootstrapReceipt(
  client: BootstrapPublicClient,
  hash: `0x${string}`,
  waitForReceipt: boolean,
): Promise<KeeperReceiptObservation | null> {
  try {
    const receipt = waitForReceipt
      ? await client.waitForTransactionReceipt({
          hash,
          timeout: RESOLVE_RECEIPT_TIMEOUT_MS,
        })
      : await client.getTransactionReceipt({ hash });
    return {
      status: receipt.status === "success" ? "success" : "reverted",
      transactionHash: receipt.transactionHash,
      blockHash: receipt.blockHash,
      blockNumber: receipt.blockNumber,
      transactionIndex: receipt.transactionIndex,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isReceiptPendingError(message)) return null;
    throw err;
  }
}

function readAgreedBootstrapReceipt(
  clients: BootstrapAgreementClients,
  hash: `0x${string}`,
  waitForReceipt: boolean,
) {
  return readWithExactKeeperRpcAgreement(
    "bootstrap_receipt",
    [
      () => readBootstrapReceipt(clients[0], hash, waitForReceipt),
      () => readBootstrapReceipt(clients[1], hash, waitForReceipt),
    ],
    fingerprintKeeperReceipt,
  );
}

async function confirmBootstrapSubmission(
  clients: BootstrapAgreementClients,
  record: BootstrapPendingResolveRecord,
  options: { waitForReceipt?: boolean } = {},
) {
  const receipt = await readAgreedBootstrapReceipt(
    clients,
    record.hash,
    options.waitForReceipt !== false,
  );
  const nonce = await readAgreedBootstrapNonce(clients, record.signer);
  if (
    receipt &&
    (receipt.transactionHash.toLowerCase() !== record.hash.toLowerCase() ||
      nonce.latestNonce <= record.nonce)
  ) {
    throw new KeeperRpcAgreementError("bootstrap_receipt_nonce");
  }
  return { receipt, nonce };
}

async function broadcastSignedResolve(
  publicClient: BootstrapPublicClient,
  record: BootstrapPendingResolveRecord,
  expectedSigner: `0x${string}`,
  expectedEpoch: bigint,
) {
  await assertBootstrapPendingResolveIntegrity(
    record,
    expectedSigner,
    expectedEpoch,
  );
  let broadcastHash: `0x${string}`;
  try {
    broadcastHash = await publicClient.sendRawTransaction({
      serializedTransaction: record.serializedTransaction,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const noopReason = getResolveNoopReason(message);
    if (noopReason === "resolve_tx_known" || noopReason === "resolve_nonce_already_used") {
      return record.hash;
    }
    throw err;
  }
  if (broadcastHash.toLowerCase() !== record.hash.toLowerCase()) {
    throw new KeeperRpcAgreementError("bootstrap_submission_hash");
  }
  return broadcastHash;
}

function pendingResolveResponse(record: BootstrapPendingResolveRecord) {
  return json({
    ok: true,
    action: "pending",
    reason: "resolve_receipt_timeout",
    currentEpoch: record.epoch,
    hash: record.hash,
    retryAfter: Math.max(1, Math.ceil(RESOLVE_THROTTLE_MS / 1000)),
  });
}

async function confirmedResolveResponse(
  clients: BootstrapAgreementClients,
  record: BootstrapPendingResolveRecord,
  receipt: KeeperReceiptObservation,
) {
  // A final state is derived from a two-RPC receipt, never trusted from mutable
  // metadata. Clear the pending-only record only after every receipt-dependent
  // read succeeds, before allowing a later new nonce.
  let response: NextResponse;
  if (receipt.status === "reverted") {
    const latestEligibility = await readAgreedBootstrapEligibility(clients);
    const submittedEpoch = BigInt(record.epoch);
    if (latestEligibility.epoch > submittedEpoch) {
      response = json({
        ok: true,
        action: "noop",
        reason: "epoch_no_longer_current",
        currentEpoch: record.epoch,
        latestEpoch: latestEligibility.epoch.toString(),
        hash: record.hash,
      });
    } else if (
      latestEligibility.epoch === submittedEpoch &&
      latestEligibility.isResolved
    ) {
      response = json({
        ok: true,
        action: "noop",
        reason: "epoch_already_resolved",
        currentEpoch: record.epoch,
        hash: record.hash,
      });
    } else if (latestEligibility.epoch < submittedEpoch) {
      throw new KeeperRpcAgreementError("bootstrap_reverted_epoch");
    } else {
      response = json({
        ok: true,
        action: "noop",
        reason: "resolve_tx_reverted",
        currentEpoch: record.epoch,
        hash: record.hash,
        retryAfter: Math.max(1, Math.ceil(RESOLVE_THROTTLE_MS / 1000)),
      });
    }
  } else {
    response = json({
      ok: true,
      action: "sent",
      currentEpoch: record.epoch,
      hash: record.hash,
      txStatus: receipt.status,
    });
  }

  deleteMetaJson(BOOTSTRAP_PENDING_RESOLVE_META_KEY);
  return response;
}

async function resumePendingResolve(
  clients: BootstrapAgreementClients,
  record: BootstrapPendingResolveRecord,
  expectedSigner: `0x${string}`,
  expectedEpoch: bigint,
) {
  // A restored or crash-surviving record is untrusted until its complete signed
  // envelope is locally bound to this route's signer, chain, nonce and call.
  await assertBootstrapPendingResolveIntegrity(
    record,
    expectedSigner,
    expectedEpoch,
  );
  let confirmation = await confirmBootstrapSubmission(clients, record);
  if (confirmation.receipt) {
    return confirmedResolveResponse(clients, record, confirmation.receipt);
  }
  if (
    confirmation.nonce.latestNonce > record.nonce ||
    confirmation.nonce.pendingNonce > record.nonce
  ) {
    return pendingResolveResponse(record);
  }

  await broadcastSignedResolve(
    clients[0],
    record,
    expectedSigner,
    expectedEpoch,
  );
  const submittedRecord = savePendingResolveRecord({
    ...record,
    state: "submitted",
  });
  confirmation = await confirmBootstrapSubmission(clients, submittedRecord);
  if (!confirmation.receipt) return pendingResolveResponse(submittedRecord);
  return confirmedResolveResponse(clients, submittedRecord, confirmation.receipt);
}

export async function POST(request: Request) {
  if (!isAuthorizedBootstrapRequest(request)) {
    return json({ ok: false, reason: "bootstrap_unauthorized" }, { status: 403 });
  }
  if (hasUnexpectedRequestBody(request)) {
    return json({ ok: false, reason: "bootstrap_body_not_supported" }, { status: 413 });
  }

  const rateLimited = await enforceSharedRateLimit(request, {
    bucket: "api-bootstrap-resolve",
    limit: isLocalDevBootstrapRequest(request) ? 60 : 12,
    windowMs: 60_000,
  });
  if (rateLimited) return applyNoStoreHeaders(rateLimited);

  const keeperKeyConfigured = Boolean(
    process.env.BOOTSTRAP_KEEPER_PRIVATE_KEY?.trim(),
  );
  const account = getBootstrapKeeperAccount();
  if (!account) {
    if (keeperKeyConfigured) {
      logRouteError("api/bootstrap-resolve", new Error("bootstrap keeper key is configured but invalid"), {
        phase: "keeper-config",
      });
      return json({ ok: false, reason: "bootstrap_keeper_misconfigured" }, { status: 500 });
    }
    return json({ ok: true, action: "noop", reason: "bootstrap_keeper_disabled" });
  }

  try {
    const pendingRecord = readPendingResolveRecord();
    if (pendingRecord) {
      // Validate persisted state before touching RPCs so corruption or a bad
      // restore always becomes an explicit reconciliation condition.
      await assertBootstrapPendingResolveIntegrity(pendingRecord, account.address);
    }
    const { clients } = getBootstrapAgreementClients();
    const eligibility = await readAgreedBootstrapEligibility(clients);
    const currentEpoch = eligibility.epoch;
    const totalPool = eligibility.totalPool;
    const isResolved = eligibility.isResolved;
    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    const isExpired = nowSec >= eligibility.endTime;

    if (pendingRecord) {
      const storedEpoch = BigInt(pendingRecord.epoch);
      if (storedEpoch !== currentEpoch || FINAL_STATES.has(pendingRecord.state)) {
        // Stale epochs must never be rebroadcast, and mutable final-state labels
        // must never authorize a fresh signature. Only a matching two-RPC
        // receipt may reconcile and clear such a record.
        const confirmation = await confirmBootstrapSubmission(
          clients,
          pendingRecord,
          { waitForReceipt: false },
        );
        if (!confirmation.receipt) {
          throw new BootstrapPendingResolveRecordError(
            storedEpoch === currentEpoch
              ? "final_state_unverified"
              : "epoch_mismatch_unresolved",
          );
        }
        return confirmedResolveResponse(
          clients,
          pendingRecord,
          confirmation.receipt,
        );
      }
    }

    if (isResolved || !isExpired) {
      return json({
        ok: true,
        action: "noop",
        currentEpoch: currentEpoch.toString(),
        isResolved,
        isExpired,
      });
    }

    // Skip empty epochs: V9 legacy bets and V10 observed-epoch bets advance
    // one empty expired epoch on demand, without spending keeper gas while idle.
    if (totalPool === 0n) {
      return json({
        ok: true,
        action: "noop",
        reason: "epoch_empty",
        currentEpoch: currentEpoch.toString(),
        isResolved,
        isExpired,
      });
    }

    if (!(await acquireResolveLock(currentEpoch))) {
      return json({
        ok: true,
        action: "noop",
        reason: "bootstrap_resolve_throttled",
        currentEpoch: currentEpoch.toString(),
        retryAfter: Math.max(1, Math.ceil(RESOLVE_OPERATION_LOCK_TTL_MS / 1000)),
      });
    }

    if (pendingRecord && PENDING_STATES.has(pendingRecord.state)) {
      return await resumePendingResolve(
        clients,
        pendingRecord,
        account.address,
        currentEpoch,
      );
    }

    const nonceObservation = await readAgreedBootstrapNonce(
      clients,
      account.address,
    );
    const { latestNonce, pendingNonce } = nonceObservation;
    if (pendingNonce > latestNonce) {
      // A dedicated bootstrap key should only have route-owned pending work.
      // Without a durable matching record, never replace or cancel that nonce.
      return json({
        ok: true,
        action: "noop",
        reason: "bootstrap_pending_nonce_unbound",
        currentEpoch: currentEpoch.toString(),
        retryAfter: Math.max(1, Math.ceil(RESOLVE_THROTTLE_MS / 1000)),
      });
    }

    const publicClient = clients[0];
    const gasEstimate = await publicClient.estimateContractGas({
      account: account.address,
      address: CONTRACT_ADDRESS,
      abi: BOOTSTRAP_RESOLVE_ABI,
      functionName: "resolveEpoch",
      args: [currentEpoch],
    });
    await recordLineaEstimateGasShadow({
      publicClient,
      account: account.address,
      to: CONTRACT_ADDRESS,
      abi: BOOTSTRAP_RESOLVE_ABI,
      functionName: "resolveEpoch",
      args: [currentEpoch],
      baselineGas: gasEstimate,
      tag: "bootstrap-resolve",
    });
    const keeperBalance = await publicClient.getBalance({ address: account.address });
    const feeBumpSteps = [{ maxFeeBumpPercent: 130n, priorityBumpPercent: 125n }] as const;
    for (const bumpStep of feeBumpSteps) {
      const fees = await publicClient.estimateFeesPerGas();
      const estimatedFeeOverrides = getKeeperFeeOverrides(
        fees,
        APP_CHAIN.id,
        bumpStep.maxFeeBumpPercent,
        bumpStep.priorityBumpPercent,
      );
      const gas = (
        gasEstimate * RESOLVE_GAS_BUFFER_PERCENT + 99n
      ) / 100n;
      const requiredMaxCost = assertKeeperFeeBudget(
        estimatedFeeOverrides,
        gas,
        APP_CHAIN.id,
        "keeper",
      );

      if (keeperBalance < requiredMaxCost) {
        return json({
          ok: true,
          action: "noop",
          reason: "keeper_insufficient_funds",
          retryAfter: Math.max(1, Math.ceil(INSUFFICIENT_FUNDS_RETRY_MS / 1000)),
        });
      }
      if (!estimatedFeeOverrides) {
        throw new Error("keeper_fee_estimate_unavailable");
      }

      const data = encodeFunctionData({
        abi: BOOTSTRAP_RESOLVE_ABI,
        functionName: "resolveEpoch",
        args: [currentEpoch],
      });
      const transactionBase = {
        chainId: APP_CHAIN.id,
        data,
        gas,
        nonce: latestNonce,
        to: CONTRACT_ADDRESS,
        value: 0n,
      } as const;
      let serializedTransaction: Hex;
      if (estimatedFeeOverrides.gasPrice !== undefined) {
        serializedTransaction = await account.signTransaction({
          ...transactionBase,
          gasPrice: estimatedFeeOverrides.gasPrice,
          type: "legacy",
        });
      } else if (
        estimatedFeeOverrides.maxFeePerGas !== undefined &&
        estimatedFeeOverrides.maxPriorityFeePerGas !== undefined
      ) {
        serializedTransaction = await account.signTransaction({
          ...transactionBase,
          maxFeePerGas: estimatedFeeOverrides.maxFeePerGas,
          maxPriorityFeePerGas: estimatedFeeOverrides.maxPriorityFeePerGas,
          type: "eip1559",
        });
      } else {
        throw new Error("keeper_fee_estimate_incomplete");
      }

      const hash = keccak256(serializedTransaction);
      const signedRecord: BootstrapPendingResolveRecord = {
        epoch: currentEpoch.toString(),
        signer: account.address,
        nonce: latestNonce,
        hash,
        serializedTransaction,
        signedAt: Date.now(),
        state: "signed",
      };
      await assertBootstrapPendingResolveIntegrity(
        signedRecord,
        account.address,
        currentEpoch,
      );
      savePendingResolveRecord(signedRecord);
      await broadcastSignedResolve(
        publicClient,
        signedRecord,
        account.address,
        currentEpoch,
      );
      const submittedRecord = savePendingResolveRecord({
        ...signedRecord,
        state: "submitted",
      });
      const confirmation = await confirmBootstrapSubmission(
        clients,
        submittedRecord,
      );
      if (!confirmation.receipt) return pendingResolveResponse(submittedRecord);
      return confirmedResolveResponse(
        clients,
        submittedRecord,
        confirmation.receipt,
      );
    }

    throw new Error("resolve_failed");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (
      err instanceof BootstrapPendingResolveRecordError ||
      err instanceof KeeperSignedTransactionIntegrityError
    ) {
      logRouteError("api/bootstrap-resolve", err, {
        phase: "pending-record-integrity",
        recovery: "manual-reconciliation-required",
      });
      return json(
        {
          ok: false,
          reason: "bootstrap_pending_record_reconciliation_required",
        },
        { status: 409 },
      );
    }
    const noopReason = getResolveNoopReason(message);
    if (noopReason) {
      return json({
        ok: true,
        action: "noop",
        reason: noopReason,
        retryAfter: noopReason === "resolve_fee_bump_needed"
          ? Math.max(1, Math.ceil(RESOLVE_THROTTLE_MS / 1000))
          : undefined,
      });
    }
    if (isKeeperInsufficientFundsError(message)) {
      return json({
        ok: true,
        action: "noop",
        reason: "keeper_insufficient_funds",
        retryAfter: Math.max(1, Math.ceil(INSUFFICIENT_FUNDS_RETRY_MS / 1000)),
      });
    }
    if (isRpcReadRetryableError(message)) {
      return json({
        ok: true,
        action: "noop",
        reason: "bootstrap_rpc_unavailable",
        retryAfter: Math.max(1, Math.ceil(BOOTSTRAP_RPC_UNAVAILABLE_RETRY_MS / 1000)),
      });
    }
    logRouteError("api/bootstrap-resolve", err, { phase: "resolve" });
    return json({ ok: false, reason: "resolve_failed" }, { status: 500 });
  }
}
