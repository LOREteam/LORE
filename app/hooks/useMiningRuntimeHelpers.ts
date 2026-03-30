"use client";

import { useCallback, useRef } from "react";
import type { MutableRefObject } from "react";
import type { PublicClient } from "viem";
import {
  APP_CHAIN_ID,
  CONTRACT_ADDRESS,
  CONTRACT_HAS_TOKEN_GETTER,
  GAME_ABI,
  LINEA_TOKEN_ADDRESS,
} from "../lib/constants";
import { getFallbackFeeOverrides, getKeeperFeeOverrides, getLineaFeeOverrides } from "../lib/lineaFees";
import { log } from "../lib/logger";
import { isMissingTokenGetterError, isNetworkError, withMiningRpcTimeout } from "./useMining.shared";

type GasOverrides = { maxFeePerGas?: bigint; maxPriorityFeePerGas?: bigint } | { gasPrice?: bigint };
type FeeEstimate = Awaited<ReturnType<PublicClient["estimateFeesPerGas"]>>;
const FEE_ESTIMATE_CACHE_TTL_MS = 3_000;

interface UseMiningRuntimeHelpersOptions {
  getActorAddress: () => string | null;
  publicClientRef: MutableRefObject<PublicClient | undefined>;
  tokenGetterWarningShownRef: MutableRefObject<boolean>;
  gasBumpBase: bigint;
  minGasPlaceBet: bigint;
  minGasPlaceBatch: bigint;
  gasCostBufferBps: bigint;
  bpsDenominator: bigint;
}

export function useMiningRuntimeHelpers({
  getActorAddress,
  publicClientRef,
  tokenGetterWarningShownRef,
  gasBumpBase,
  minGasPlaceBet,
  minGasPlaceBatch,
  gasCostBufferBps,
  bpsDenominator,
}: UseMiningRuntimeHelpersOptions) {
  const feeEstimateCacheRef = useRef<{
    expiresAt: number;
    promise: Promise<FeeEstimate> | null;
    value: FeeEstimate | null;
  }>({
    expiresAt: 0,
    promise: null,
    value: null,
  });

  const readFeeEstimate = useCallback(async (label: string) => {
    const pc = publicClientRef.current;
    if (!pc) return null;

    const cache = feeEstimateCacheRef.current;
    const now = Date.now();
    if (cache.value && cache.expiresAt > now) {
      return cache.value;
    }
    if (cache.promise) {
      return cache.promise;
    }

    const pending = withMiningRpcTimeout(pc.estimateFeesPerGas(), label)
      .then((fees) => {
        feeEstimateCacheRef.current = {
          expiresAt: Date.now() + FEE_ESTIMATE_CACHE_TTL_MS,
          promise: null,
          value: fees,
        };
        return fees;
      })
      .catch((error) => {
        feeEstimateCacheRef.current.promise = null;
        throw error;
      });

    feeEstimateCacheRef.current.promise = pending;
    return pending;
  }, [publicClientRef]);

  const getBumpedFees = useCallback(async (percent: bigint = gasBumpBase) => {
    if (!publicClientRef.current) return getFallbackFeeOverrides(APP_CHAIN_ID, "normal");
    try {
      const fees = await readFeeEstimate("estimateFeesPerGas");
      if (!fees) return getFallbackFeeOverrides(APP_CHAIN_ID, "normal");
      return getLineaFeeOverrides(fees, APP_CHAIN_ID, percent, percent);
    } catch (err) {
      log.warn("AutoMine", "fee estimation failed, letting wallet decide", err);
    }
    return getFallbackFeeOverrides(APP_CHAIN_ID, "normal");
  }, [gasBumpBase, publicClientRef, readFeeEstimate]);

  const getUrgentFees = useCallback(async () => {
    if (!publicClientRef.current) return getFallbackFeeOverrides(APP_CHAIN_ID, "keeper");
    try {
      const fees = await readFeeEstimate("estimateUrgentFeesPerGas");
      if (!fees) return getFallbackFeeOverrides(APP_CHAIN_ID, "keeper");
      return getKeeperFeeOverrides(fees, APP_CHAIN_ID);
    } catch (err) {
      log.warn("AutoMine", "urgent fee estimation failed, falling back", err);
    }
    return getFallbackFeeOverrides(APP_CHAIN_ID, "keeper");
  }, [publicClientRef, readFeeEstimate]);

  const getApproveFees = useCallback(async (attempt = 0) => {
    if (!publicClientRef.current) return getFallbackFeeOverrides(APP_CHAIN_ID, "keeper");
    try {
      const fees = await readFeeEstimate("estimateApproveFeesPerGas");
      if (!fees) return getFallbackFeeOverrides(APP_CHAIN_ID, "keeper");
      const maxFeeBump = 130n + BigInt(attempt) * 25n;
      const priorityBump = 125n + BigInt(attempt) * 20n;
      return getKeeperFeeOverrides(fees, APP_CHAIN_ID, maxFeeBump, priorityBump);
    } catch (err) {
      log.warn("Approve", "approve fee estimation failed, falling back", err);
    }
    return getFallbackFeeOverrides(APP_CHAIN_ID, "keeper");
  }, [publicClientRef, readFeeEstimate]);

  const assertContractTokenMatches = useCallback(async () => {
    const pc = publicClientRef.current;
    if (!pc) return;

    if (!CONTRACT_HAS_TOKEN_GETTER) {
      if (!tokenGetterWarningShownRef.current) {
        tokenGetterWarningShownRef.current = true;
        log.warn("AutoMine", "token preflight disabled for legacy contract profile");
      }
      return;
    }

    let deployedToken: `0x${string}`;
    try {
      deployedToken = (await withMiningRpcTimeout(pc.readContract({
        address: CONTRACT_ADDRESS,
        abi: GAME_ABI,
        functionName: "token",
      }), "contract.token()")) as `0x${string}`;
    } catch (err) {
      if (isMissingTokenGetterError(err)) {
        throw new Error(
          "Contract token() getter is required by this deployment profile but returned no data. Check NEXT_PUBLIC_CONTRACT_ADDRESS and NEXT_PUBLIC_CONTRACT_HAS_TOKEN_GETTER.",
        );
      }
      throw err;
    }

    if (deployedToken.toLowerCase() !== LINEA_TOKEN_ADDRESS.toLowerCase()) {
      throw new Error(`Contract token mismatch: expected ${LINEA_TOKEN_ADDRESS}, got ${deployedToken}`);
    }
  }, [publicClientRef, tokenGetterWarningShownRef]);

  const getRequiredNativeCost = useCallback(
    async (gas: bigint, gasOverrides?: GasOverrides) => {
      const pc = publicClientRef.current;
      if (!pc) return 0n;

      let feePerGas: bigint | undefined;
      if (gasOverrides) {
        if ("gasPrice" in gasOverrides) feePerGas = gasOverrides.gasPrice;
        else if ("maxFeePerGas" in gasOverrides) feePerGas = gasOverrides.maxFeePerGas;
      }

      if (!feePerGas) {
        const fees = await readFeeEstimate("estimateGasCostFeesPerGas");
        if (!fees) return 0n;
        feePerGas = fees.maxFeePerGas ?? fees.gasPrice ?? 0n;
      }

      return ((gas * feePerGas) * gasCostBufferBps) / bpsDenominator;
    },
    [bpsDenominator, gasCostBufferBps, publicClientRef, readFeeEstimate],
  );

  const assertNativeGasBalance = useCallback(
    async (gas: bigint, gasOverrides?: GasOverrides) => {
      const pc = publicClientRef.current;
      const actorAddress = getActorAddress();
      if (!pc || !actorAddress) return;

      const [balance, requiredCost] = await Promise.all([
        withMiningRpcTimeout(pc.getBalance({ address: actorAddress as `0x${string}` }), "getBalance"),
        getRequiredNativeCost(gas, gasOverrides),
      ]);

      if (balance < requiredCost) {
        const have = Number(balance) / 1e18;
        const need = Number(requiredCost) / 1e18;
        throw new Error(`Not enough ETH for gas: need ~${need.toFixed(6)} ETH, have ${have.toFixed(6)} ETH.`);
      }
    },
    [getActorAddress, getRequiredNativeCost, publicClientRef],
  );

  const estimateGas = useCallback(
    async (functionName: string, args: readonly unknown[], bufferExtra: bigint) => {
      const minGas =
        functionName === "placeBatchBets" ||
        functionName === "placeBatchBetsSameAmount"
          ? minGasPlaceBatch
          : minGasPlaceBet;
      const pc = publicClientRef.current;
      const actorAddress = getActorAddress();
      if (!pc || !actorAddress) return minGas;
      try {
        const est = await withMiningRpcTimeout(pc.estimateContractGas({
          account: actorAddress as `0x${string}`,
          address: CONTRACT_ADDRESS,
          abi: GAME_ABI,
          functionName: functionName as "placeBet",
          args: args as [bigint, bigint],
        }), `estimateContractGas:${functionName}`);
        const withBuffer = (est * 180n) / 100n + bufferExtra;
        return withBuffer > minGas ? withBuffer : minGas;
      } catch (err) {
        if (isNetworkError(err)) return minGas;
        throw err;
      }
    },
    [getActorAddress, minGasPlaceBatch, minGasPlaceBet, publicClientRef],
  );

  const ensureContractPreflight = useCallback(async () => {
    const pc = publicClientRef.current;
    if (!pc) return;
    await assertContractTokenMatches();
    await withMiningRpcTimeout(pc.readContract({
      address: CONTRACT_ADDRESS,
      abi: GAME_ABI,
      functionName: "currentEpoch",
    }), "contract.currentEpoch()");
  }, [assertContractTokenMatches, publicClientRef]);

  return {
    getBumpedFees,
    getUrgentFees,
    getApproveFees,
    assertNativeGasBalance,
    estimateGas,
    ensureContractPreflight,
  };
}
