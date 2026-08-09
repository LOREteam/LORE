import { NextResponse } from "next/server";
import { createWalletClient, http } from "viem";
import {
  assertKeeperFeeBudget,
  getKeeperFeeOverrides,
} from "../../lib/lineaFees";
import { recordLineaEstimateGasShadow } from "../../lib/lineaEstimateGasShadow";
import { enforceSharedRateLimit } from "../_lib/sharedRateLimit";
import { logRouteError } from "../_lib/routeError";
import { applyNoStoreHeaders } from "../_lib/responseHeaders";
import {
  acquireResolveLock,
  APP_CHAIN,
  BOOTSTRAP_RESOLVE_ABI,
  BOOTSTRAP_RPC_UNAVAILABLE_RETRY_MS,
  CONTRACT_ADDRESS,
  getBootstrapKeeperAccount,
  getResolveNoopReason,
  isAuthorizedBootstrapRequest,
  isLocalDevBootstrapRequest,
  isRpcReadRetryableError,
  readContractResilient,
  RESOLVE_OPERATION_LOCK_TTL_MS,
  RESOLVE_THROTTLE_MS,
} from "./shared";

const INSUFFICIENT_FUNDS_RETRY_MS = 300_000;
const RESOLVE_RECEIPT_TIMEOUT_MS = 25_000;
const RESOLVE_GAS_BUFFER_PERCENT = 150n;
const ZERO_CONTENT_LENGTH_RE = /^0$/;

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

  const keeperKeyConfigured = !!(
    process.env.BOOTSTRAP_KEEPER_PRIVATE_KEY?.trim() ||
    process.env.KEEPER_PRIVATE_KEY?.trim()
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
    const { result: currentEpoch, rpcUrl, client: publicClient } = await readContractResilient<bigint>({
      address: CONTRACT_ADDRESS,
      abi: BOOTSTRAP_RESOLVE_ABI,
      functionName: "currentEpoch",
    });

    const [{ result: epochEndTime }, { result: epochData }] = await Promise.all([
      readContractResilient<bigint>({
        address: CONTRACT_ADDRESS,
        abi: BOOTSTRAP_RESOLVE_ABI,
        functionName: "getEpochEndTime",
        args: [currentEpoch],
      }),
      readContractResilient<[bigint, bigint, bigint, boolean, boolean, boolean]>({
        address: CONTRACT_ADDRESS,
        abi: BOOTSTRAP_RESOLVE_ABI,
        functionName: "epochs",
        args: [currentEpoch],
      }),
    ]);

    const walletClient = createWalletClient({
      account,
      chain: APP_CHAIN,
      transport: http(rpcUrl, { timeout: 30_000, retryCount: 1 }),
    });

    const totalPool = epochData[0];
    const isResolved = Boolean(epochData[3]);
    const nowSec = BigInt(Math.floor(Date.now() / 1000));
    const isExpired = nowSec >= epochEndTime;

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

    const latestNonce = await publicClient.getTransactionCount({
      address: account.address,
      blockTag: "latest",
    });
    const pendingNonce = await publicClient.getTransactionCount({
      address: account.address,
      blockTag: "pending",
    });
    if (pendingNonce > latestNonce) {
      // This API has no durable hash-to-nonce ownership record. Replacing or
      // cancelling this nonce could affect an unrelated keeper transaction.
      return json({
        ok: true,
        action: "noop",
        reason: "bootstrap_pending_nonce_unbound",
        currentEpoch: currentEpoch.toString(),
        retryAfter: Math.max(1, Math.ceil(RESOLVE_THROTTLE_MS / 1000)),
      });
    }

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

      try {
        const hash = await walletClient.writeContract({
          address: CONTRACT_ADDRESS,
          abi: BOOTSTRAP_RESOLVE_ABI,
          functionName: "resolveEpoch",
          args: [currentEpoch],
          gas,
          nonce: latestNonce,
          ...(estimatedFeeOverrides?.gasPrice !== undefined
            ? { gasPrice: estimatedFeeOverrides.gasPrice }
            : {
                maxFeePerGas: estimatedFeeOverrides?.maxFeePerGas,
                maxPriorityFeePerGas: estimatedFeeOverrides?.maxPriorityFeePerGas,
              }),
        });

        const receipt = await publicClient.waitForTransactionReceipt({
          hash,
          timeout: RESOLVE_RECEIPT_TIMEOUT_MS,
        }).catch(() => null);

        if (!receipt) {
          return json({
            ok: true,
            action: "pending",
            reason: "resolve_receipt_timeout",
            currentEpoch: currentEpoch.toString(),
            hash,
            retryAfter: Math.max(1, Math.ceil(RESOLVE_THROTTLE_MS / 1000)),
          });
        }

        if (receipt?.status === "reverted") {
          const latestEpoch = await publicClient.readContract({
            address: CONTRACT_ADDRESS,
            abi: BOOTSTRAP_RESOLVE_ABI,
            functionName: "currentEpoch",
          }) as bigint;
          if (latestEpoch > currentEpoch) {
            return json({
              ok: true,
              action: "noop",
              reason: "epoch_no_longer_current",
              currentEpoch: currentEpoch.toString(),
              latestEpoch: latestEpoch.toString(),
              hash,
            });
          }

          const latestEpochData = await publicClient.readContract({
            address: CONTRACT_ADDRESS,
            abi: BOOTSTRAP_RESOLVE_ABI,
            functionName: "epochs",
            args: [currentEpoch],
          }) as [bigint, bigint, bigint, boolean, boolean, boolean];
          if (Boolean(latestEpochData[3])) {
            return json({
              ok: true,
              action: "noop",
              reason: "epoch_already_resolved",
              currentEpoch: currentEpoch.toString(),
              hash,
            });
          }

          return json({
            ok: true,
            action: "noop",
            reason: "resolve_tx_reverted",
            currentEpoch: currentEpoch.toString(),
            hash,
            retryAfter: Math.max(1, Math.ceil(RESOLVE_THROTTLE_MS / 1000)),
          });
        }

        return json({
          ok: true,
          action: "sent",
          currentEpoch: currentEpoch.toString(),
          hash,
          txStatus: receipt?.status,
        });
      } catch (err) {
        throw err;
      }
    }

    throw new Error("resolve_failed");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
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
