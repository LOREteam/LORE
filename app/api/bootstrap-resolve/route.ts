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
  { maxFeeBumpPercent: 350n, priorityBumpPercent: 320n },
  { maxFeeBumpPercent: 520n, priorityBumpPercent: 480n },
] as const;

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
      transport: http(rpcUrl, { timeout: 15_000, retryCount: 1 }),
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

    // Skip empty epochs entirely — burning gas to resolve a round
    // with zero bets is wasteful. Round simply sits frozen until a
    // player shows up; their bet will trigger the contract's
    // built-in `_autoResolveIfNeeded()` automatically.
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
        if (
          noopReason === "resolve_fee_bump_needed" &&
          replacingPendingTx &&
          attemptIndex < feeBumpSteps.length - 1
        ) {
          continue;
        }
        throw err;
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
