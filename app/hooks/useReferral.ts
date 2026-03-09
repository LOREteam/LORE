"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { formatUnits, encodeFunctionData } from "viem";
import {
  CONTRACT_ADDRESS,
  GAME_ABI,
  APP_CHAIN_ID,
  TX_RECEIPT_TIMEOUT_MS,
} from "../lib/constants";
import { delay, isUserRejection } from "../lib/utils";
import { log } from "../lib/logger";

const REF_STORAGE_KEY = "lineaore:pending-ref-code:v1";
const ZERO_BYTES6 = "0x000000000000";
const GAS_SET_REFERRER = BigInt(250_000);
const GAS_REGISTER_REFERRAL = BigInt(300_000);
const ACCRUE_BATCH_SIZE = BigInt(50);
const GAS_ACCRUE_BATCH = BigInt(1_600_000);
const GAS_FINAL_CLAIM = BigInt(300_000);

function isTimeoutLike(err: unknown): boolean {
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  return msg.includes("timed out") || msg.includes("timeout");
}

type SilentSendFn = (tx: {
  to: `0x${string}`;
  data?: `0x${string}`;
  value?: bigint;
  gas?: bigint;
}) => Promise<`0x${string}`>;

interface UseReferralOptions {
  sendTransactionSilent?: SilentSendFn;
}

export function useReferral(options?: UseReferralOptions) {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: APP_CHAIN_ID });
  const { writeContractAsync } = useWriteContract();
  const [isRegistering, setIsRegistering] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);
  const [isSettingReferrer, setIsSettingReferrer] = useState(false);
  const attemptedAddressesRef = useRef(new Set<string>());

  const waitReceipt = useCallback(
    async (hash: `0x${string}`) => {
      if (!publicClient) return;
      const receipt = await Promise.race([
        publicClient.waitForTransactionReceipt({ hash }),
        delay(TX_RECEIPT_TIMEOUT_MS).then(() => { throw new Error("Timeout"); }),
      ]);
      if (receipt.status !== "success") {
        let txGas: bigint | null = null;
        try {
          const tx = await publicClient.getTransaction({ hash });
          txGas = tx.gas;
        } catch {
          // fall through to generic revert when tx lookup is unavailable
        }
        if (txGas !== null && receipt.gasUsed >= txGas) {
          throw new Error(`Out of gas: used=${receipt.gasUsed.toString()} limit=${txGas.toString()} hash=${hash}`);
        }
        throw new Error(`Transaction reverted: ${hash}`);
      }
    },
    [publicClient],
  );

  const { data: referralInfoRaw, refetch: refetchReferralInfo } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: GAME_ABI,
    functionName: "getReferralInfo",
    args: address ? [address] : undefined,
    chainId: APP_CHAIN_ID,
    query: { enabled: !!address, refetchInterval: 10_000 },
  });

  const referralInfo = useMemo(() => {
    if (!referralInfoRaw) return null;
    const [referrer, code, pending, totalEarned, referredUsers] = referralInfoRaw as [
      string, string, bigint, bigint, bigint
    ];
    return {
      referrer: referrer === "0x0000000000000000000000000000000000000000" ? null : referrer,
      code: code === ZERO_BYTES6 ? null : code as string,
      pendingEarnings: formatUnits(pending, 18),
      pendingEarningsWei: pending,
      totalEarnings: formatUnits(totalEarned, 18),
      totalEarningsWei: totalEarned,
      referredUsers: Number(referredUsers),
    };
  }, [referralInfoRaw]);

  const referralLink = useMemo(() => {
    if (!referralInfo?.code) return null;
    if (typeof window === "undefined") return null;
    return `${window.location.origin}?ref=${referralInfo.code}`;
  }, [referralInfo?.code]);

  const copyReferralLink = useCallback(async () => {
    if (!referralLink) return;
    try {
      await navigator.clipboard.writeText(referralLink);
    } catch {
      // Ignore clipboard denials in unsupported or blocked contexts.
    }
  }, [referralLink]);

  // Save referral code from URL on mount
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const ref = params.get("ref");
    if (ref && /^0x[a-fA-F0-9]{12}$/.test(ref)) {
      window.localStorage.setItem(REF_STORAGE_KEY, ref.toLowerCase());
      const url = new URL(window.location.href);
      url.searchParams.delete("ref");
      window.history.replaceState({}, "", url.toString());
    }
  }, []);

  useEffect(() => {
    if (!address || !publicClient || !referralInfo) return;
    const addrLower = address.toLowerCase();
    if (attemptedAddressesRef.current.has(addrLower)) return;
    if (referralInfo.referrer) {
      attemptedAddressesRef.current.add(addrLower);
      return;
    }

    const pendingCode = typeof window !== "undefined"
      ? window.localStorage.getItem(REF_STORAGE_KEY)
      : null;
    if (!pendingCode) return;

    attemptedAddressesRef.current.add(addrLower);
    let cancelled = false;

    const doSetReferrer = async () => {
      if (cancelled) return;
      setIsSettingReferrer(true);
      try {
        const silentSend = options?.sendTransactionSilent;
        if (silentSend) {
          const data = encodeFunctionData({
            abi: GAME_ABI,
            functionName: "setReferrer",
            args: [pendingCode as `0x${string}`],
          });
          const hash = await silentSend({ to: CONTRACT_ADDRESS, data, gas: GAS_SET_REFERRER });
          await waitReceipt(hash);
        } else {
          const hash = await writeContractAsync({
            address: CONTRACT_ADDRESS,
            abi: GAME_ABI,
            functionName: "setReferrer",
            args: [pendingCode as `0x${string}`],
            chainId: APP_CHAIN_ID,
            gas: GAS_SET_REFERRER,
          });
          await waitReceipt(hash);
        }
        if (!cancelled) {
          log.info("Referral", "referrer set successfully", { address: addrLower, code: pendingCode });
          void refetchReferralInfo().catch(() => {});
        }
      } catch (err) {
        if (isUserRejection(err) || isTimeoutLike(err)) {
          log.warn("Referral", "setReferrer not completed", err);
        } else {
          log.error("Referral", "setReferrer failed", err);
        }
        attemptedAddressesRef.current.delete(addrLower);
      } finally {
        if (!cancelled) setIsSettingReferrer(false);
      }
    };

    const timeout = setTimeout(doSetReferrer, 2000);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [address, publicClient, referralInfo, options?.sendTransactionSilent, writeContractAsync, refetchReferralInfo, waitReceipt]);

  // Register referral code
  const registerCode = useCallback(async () => {
    if (!address) return;
    setIsRegistering(true);
    try {
      const silentSend = options?.sendTransactionSilent;
      const interactiveTx = async () => {
        const hash = await writeContractAsync({
          address: CONTRACT_ADDRESS,
          abi: GAME_ABI,
          functionName: "registerReferralCode",
          args: [],
          chainId: APP_CHAIN_ID,
          gas: GAS_REGISTER_REFERRAL,
        });
        await waitReceipt(hash);
      };

      if (silentSend) {
        const data = encodeFunctionData({
          abi: GAME_ABI,
          functionName: "registerReferralCode",
          args: [],
        });
        try {
          const hash = await silentSend({ to: CONTRACT_ADDRESS, data, gas: GAS_REGISTER_REFERRAL });
          await waitReceipt(hash);
        } catch (err) {
          if (isTimeoutLike(err)) {
            log.warn("Referral", "registerReferralCode silent tx timeout, falling back to interactive flow");
            await interactiveTx();
          } else {
            throw err;
          }
        }
      } else {
        await interactiveTx();
      }
      log.info("Referral", "code registered");
      void refetchReferralInfo().catch(() => {});
    } catch (err) {
      if (isUserRejection(err) || isTimeoutLike(err)) {
        log.warn("Referral", "registerCode not completed", err);
      } else {
        log.error("Referral", "registerCode failed", err);
      }
    } finally {
      setIsRegistering(false);
    }
  }, [address, options?.sendTransactionSilent, writeContractAsync, refetchReferralInfo, waitReceipt]);

  // Claim pending referral earnings (batched accrue → lightweight claim)
  const claimEarnings = useCallback(async () => {
    if (!address || !publicClient || !referralInfo?.pendingEarningsWei || referralInfo.pendingEarningsWei === BigInt(0)) return;
    setIsClaiming(true);
    try {
      const silentSend = options?.sendTransactionSilent;

      let remaining: bigint;
      try {
        remaining = await publicClient.readContract({
          address: CONTRACT_ADDRESS,
          abi: GAME_ABI,
          functionName: "referralEpochsRemaining",
          args: [address as `0x${string}`],
        }) as bigint;
      } catch {
        remaining = BigInt(0);
      }

      log.info("Referral", "claimEarnings start", {
        remaining: remaining.toString(),
        pending: referralInfo.pendingEarningsWei.toString(),
      });

      if (remaining > BigInt(0)) {
        let accrued = BigInt(0);
        const total = remaining;

        while (accrued < total) {
          const batch = total - accrued > ACCRUE_BATCH_SIZE ? ACCRUE_BATCH_SIZE : total - accrued;

          log.info("Referral", "accrueReferralBatch", {
            batch: batch.toString(),
            accrued: accrued.toString(),
            total: total.toString(),
          });

          if (silentSend) {
            const data = encodeFunctionData({
              abi: GAME_ABI,
              functionName: "accrueReferralBatch",
              args: [batch],
            });
            try {
              const hash = await silentSend({ to: CONTRACT_ADDRESS, data, gas: GAS_ACCRUE_BATCH });
              await waitReceipt(hash);
            } catch (silentErr) {
              if (isUserRejection(silentErr)) throw silentErr;
              log.warn("Referral", "accrueReferralBatch silent failed, trying interactive", silentErr);
              const hash = await writeContractAsync({
                address: CONTRACT_ADDRESS,
                abi: GAME_ABI,
                functionName: "accrueReferralBatch",
                args: [batch],
                chainId: APP_CHAIN_ID,
                gas: GAS_ACCRUE_BATCH,
              });
              await waitReceipt(hash);
            }
          } else {
            const hash = await writeContractAsync({
              address: CONTRACT_ADDRESS,
              abi: GAME_ABI,
              functionName: "accrueReferralBatch",
              args: [batch],
              chainId: APP_CHAIN_ID,
              gas: GAS_ACCRUE_BATCH,
            });
            await waitReceipt(hash);
          }

          accrued += batch;
          if (accrued < total) await delay(1_500);
        }
      }

      if (silentSend) {
        const data = encodeFunctionData({
          abi: GAME_ABI,
          functionName: "claimAccruedReferralEarnings",
          args: [],
        });
        try {
          const hash = await silentSend({ to: CONTRACT_ADDRESS, data, gas: GAS_FINAL_CLAIM });
          await waitReceipt(hash);
        } catch (silentErr) {
          if (isUserRejection(silentErr)) throw silentErr;
          log.warn("Referral", "claimAccruedReferralEarnings silent failed, trying interactive", silentErr);
          const hash = await writeContractAsync({
            address: CONTRACT_ADDRESS,
            abi: GAME_ABI,
            functionName: "claimAccruedReferralEarnings",
            args: [],
            chainId: APP_CHAIN_ID,
            gas: GAS_FINAL_CLAIM,
          });
          await waitReceipt(hash);
        }
      } else {
        const hash = await writeContractAsync({
          address: CONTRACT_ADDRESS,
          abi: GAME_ABI,
          functionName: "claimAccruedReferralEarnings",
          args: [],
          chainId: APP_CHAIN_ID,
          gas: GAS_FINAL_CLAIM,
        });
        await waitReceipt(hash);
      }

      log.info("Referral", "earnings claimed");
      void refetchReferralInfo().catch(() => {});
    } catch (err) {
      if (isUserRejection(err) || isTimeoutLike(err)) {
        log.warn("Referral", "claimEarnings not completed", err);
      } else {
        log.error("Referral", "claimEarnings failed", err);
        if (typeof window !== "undefined") {
          window.alert(`Claim failed: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } finally {
      setIsClaiming(false);
    }
  }, [address, publicClient, referralInfo?.pendingEarningsWei, options?.sendTransactionSilent, writeContractAsync, refetchReferralInfo, waitReceipt]);

  return {
    referralInfo,
    referralLink,
    isRegistering,
    isClaiming,
    isSettingReferrer,
    registerCode,
    claimEarnings,
    copyReferralLink,
    refetchReferralInfo,
  };
}
