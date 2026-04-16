import { NextResponse } from "next/server";
import { createWalletClient, http } from "viem";
import {
  clampKeeperFeeOverridesToBalance,
  getAffordableKeeperGasLimit,
  getKeeperFeeOverrides,
} from "../../lib/lineaFees";
import { enforceSharedRateLimit } from "../_lib/sharedRateLimit";
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
  RESOLVE_THROTTLE_MS,
} from "./shared";

const REPLACE_PENDING_FEE_BUMP_STEPS = [
  { maxFeeBumpPercent: 220n, priorityBumpPercent: 200n },
  { maxFeeBumpPercent: 400n, priorityBumpPercent: 380n },
  { maxFeeBumpPercent: 800n, priorityBumpPercent: 780n },
  { maxFeeBumpPercent: 1600n, priorityBumpPercent: 1580n },
  { maxFeeBumpPercent: 3500n, priorityBumpPercent: 3480n },
] as const;

// Absolute fee floor for "cancel stuck tx" self-transfers. We want these
// values high enough to dominate any realistic stuck-tx fee so the
// replacement is never rejected as underpriced.
const CANCEL_TX_MAX_FEE_PER_GAS_WEI = 5_000_000_000n; // 5 gwei
const CANCEL_TX_PRIORITY_FEE_WEI = 5_000_000_000n; // 5 gwei
const CANCEL_TX_GAS_LIMIT = 21_000n;

export async function POST(request: Request) {
  if (!isAuthorizedBootstrapRequest(request)) {
    return NextResponse.json({ ok: true, action: "noop", reason: "bootstrap_keeper_disabled" });
  }

  const account = getBootstrapKeeperAccount();
  if (!account) {
    return NextResponse.json({ ok: true, action: "noop", reason: "bootstrap_keeper_disabled" });
  }

  const rateLimited = await enforceSharedRateLimit(request, {
    bucket: "api-bootstrap-resolve",
    limit: isLocalDevBootstrapRequest(request) ? 60 : 12,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  try {
    const { result: currentEpoch, rpcUrl, client: publicClient } = await readContractResilient<bigint>({
      address: CONTRACT_ADDRESS,
      abi: BOOTSTRAP_RESOLVE_ABI,
      functionName: "currentEpoch",
    });

    if (!(await acquireResolveLock(currentEpoch))) {
      return NextResponse.json({
        ok: true,
        action: "noop",
        reason: "bootstrap_resolve_throttled",
        currentEpoch: currentEpoch.toString(),
        retryAfter: Math.max(1, Math.ceil(RESOLVE_THROTTLE_MS / 1000)),
      });
    }

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
      return NextResponse.json({
        ok: true,
        action: "noop",
        currentEpoch: currentEpoch.toString(),
        isResolved,
        isExpired,
      });
    }

    // V8 atomic resolve: skip empty epochs — burning gas to resolve a
    // round with zero bets is wasteful. It will sit frozen until a player
    // bet triggers the contract's built-in _autoResolveIfNeeded().
    if (totalPool === 0n) {
      return NextResponse.json({
        ok: true,
        action: "noop",
        reason: "epoch_empty",
        currentEpoch: currentEpoch.toString(),
        isResolved,
        isExpired,
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
    const replacingPendingTx = pendingNonce > latestNonce;

    const gasEstimate = await publicClient.estimateContractGas({
      account: account.address,
      address: CONTRACT_ADDRESS,
      abi: BOOTSTRAP_RESOLVE_ABI,
      functionName: "resolveEpoch",
      args: [currentEpoch],
    });
    const keeperBalance = await publicClient.getBalance({ address: account.address });
    const feeBumpSteps = replacingPendingTx
      ? REPLACE_PENDING_FEE_BUMP_STEPS
      : [{ maxFeeBumpPercent: 130n, priorityBumpPercent: 125n }] as const;

    let lastWriteError: unknown = null;
    let lastFeeBumpRejection = false;
    for (const [attemptIndex, bumpStep] of feeBumpSteps.entries()) {
      const fees = await publicClient.estimateFeesPerGas();
      const estimatedFeeOverrides = getKeeperFeeOverrides(
        fees,
        APP_CHAIN.id,
        bumpStep.maxFeeBumpPercent,
        bumpStep.priorityBumpPercent,
      );
      const feeOverrides = clampKeeperFeeOverridesToBalance(
        estimatedFeeOverrides,
        gasEstimate,
        keeperBalance,
      );
      const gas = getAffordableKeeperGasLimit(gasEstimate, keeperBalance, feeOverrides, 150n);

      if (gas === null) {
        return NextResponse.json({
          ok: false,
          reason: "resolve_failed",
          error: `keeper_insufficient_funds balance=${keeperBalance.toString()} estimatedGas=${gasEstimate.toString()}`,
        }, { status: 500 });
      }

      try {
        const hash = await walletClient.writeContract({
          address: CONTRACT_ADDRESS,
          abi: BOOTSTRAP_RESOLVE_ABI,
          functionName: "resolveEpoch",
          args: [currentEpoch],
          gas,
          ...(replacingPendingTx ? { nonce: latestNonce } : {}),
          ...(feeOverrides?.gasPrice !== undefined
            ? { gasPrice: feeOverrides.gasPrice }
            : {
                maxFeePerGas: feeOverrides?.maxFeePerGas,
                maxPriorityFeePerGas: feeOverrides?.maxPriorityFeePerGas,
              }),
        });

        return NextResponse.json({
          ok: true,
          action: "sent",
          currentEpoch: currentEpoch.toString(),
          hash,
        });
      } catch (err) {
        lastWriteError = err;
        const message = err instanceof Error ? err.message : String(err);
        const noopReason = getResolveNoopReason(message);
        lastFeeBumpRejection = noopReason === "resolve_fee_bump_needed";
        if (
          lastFeeBumpRejection &&
          replacingPendingTx &&
          attemptIndex < feeBumpSteps.length - 1
        ) {
          continue;
        }
        if (lastFeeBumpRejection && replacingPendingTx) {
          break;
        }
        throw err;
      }
    }

    // Escape hatch for a nonce stuck behind an older tx whose fees are so
    // high that normal bump attempts can't replace it. Send a 0-value
    // self-transfer at the same nonce with dramatically higher fees — this
    // costs ~21k gas and, once mined, frees the nonce so the next resolve
    // call can proceed with a fresh nonce.
    if (replacingPendingTx && lastFeeBumpRejection) {
      try {
        const cancelGasCeiling = CANCEL_TX_GAS_LIMIT * CANCEL_TX_MAX_FEE_PER_GAS_WEI;
        if (keeperBalance < cancelGasCeiling) {
          return NextResponse.json({
            ok: false,
            reason: "resolve_failed",
            error: `cancel_stuck_tx_insufficient_funds balance=${keeperBalance.toString()} needed=${cancelGasCeiling.toString()}`,
          }, { status: 500 });
        }
        const cancelHash = await walletClient.sendTransaction({
          to: account.address,
          value: 0n,
          nonce: latestNonce,
          gas: CANCEL_TX_GAS_LIMIT,
          maxFeePerGas: CANCEL_TX_MAX_FEE_PER_GAS_WEI,
          maxPriorityFeePerGas: CANCEL_TX_PRIORITY_FEE_WEI,
        });
        return NextResponse.json({
          ok: true,
          action: "cancelled",
          reason: "pending_tx_cancelled",
          cancelledNonce: latestNonce,
          hash: cancelHash,
          retryAfter: Math.max(1, Math.ceil(RESOLVE_THROTTLE_MS / 1000)),
        });
      } catch (cancelErr) {
        const message = cancelErr instanceof Error ? cancelErr.message : String(cancelErr);
        return NextResponse.json({
          ok: true,
          action: "noop",
          reason: "cancel_stuck_tx_failed",
          error: message,
          retryAfter: Math.max(1, Math.ceil(RESOLVE_THROTTLE_MS / 1000)),
        });
      }
    }

    throw lastWriteError ?? new Error("resolve_failed");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const noopReason = getResolveNoopReason(message);
    if (noopReason) {
      return NextResponse.json({
        ok: true,
        action: "noop",
        reason: noopReason,
        retryAfter: noopReason === "resolve_fee_bump_needed"
          ? Math.max(1, Math.ceil(RESOLVE_THROTTLE_MS / 1000))
          : undefined,
      });
    }
    if (isRpcReadRetryableError(message)) {
      return NextResponse.json({
        ok: true,
        action: "noop",
        reason: "bootstrap_rpc_unavailable",
        retryAfter: Math.max(1, Math.ceil(BOOTSTRAP_RPC_UNAVAILABLE_RETRY_MS / 1000)),
      });
    }
    return NextResponse.json({ ok: false, reason: "resolve_failed", error: message }, { status: 500 });
  }
}
