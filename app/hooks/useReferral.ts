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
import { delay } from "../lib/utils";
import { log } from "../lib/logger";

const REF_STORAGE_KEY = "lineaore:pending-ref-code:v1";
const ZERO_BYTES6 = "0x000000000000";

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
    await navigator.clipboard.writeText(referralLink);
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

  // Auto-set referrer when wallet connects (or switches) and there's a pending code.
  // Tracks per-address so switching Privy <-> main both get the referrer set.
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

    const doSetReferrer = async () => {
      setIsSettingReferrer(true);
      try {
        const silentSend = options?.sendTransactionSilent;
        if (silentSend) {
          const data = encodeFunctionData({
            abi: GAME_ABI,
            functionName: "setReferrer",
            args: [pendingCode as `0x${string}`],
          });
          const hash = await silentSend({ to: CONTRACT_ADDRESS, data });
          await Promise.race([
            publicClient.waitForTransactionReceipt({ hash }),
            delay(TX_RECEIPT_TIMEOUT_MS).then(() => { throw new Error("Timeout"); }),
          ]);
        } else {
          await writeContractAsync({
            address: CONTRACT_ADDRESS,
            abi: GAME_ABI,
            functionName: "setReferrer",
            args: [pendingCode as `0x${string}`],
            chainId: APP_CHAIN_ID,
          });
        }
        log.info("Referral", "referrer set successfully", { address: addrLower, code: pendingCode });
        refetchReferralInfo();
      } catch (err) {
        log.error("Referral", "setReferrer failed", err);
        attemptedAddressesRef.current.delete(addrLower);
      } finally {
        setIsSettingReferrer(false);
      }
    };

    const timeout = setTimeout(doSetReferrer, 2000);
    return () => clearTimeout(timeout);
  }, [address, publicClient, referralInfo, options?.sendTransactionSilent, writeContractAsync, refetchReferralInfo]);

  // Register referral code
  const registerCode = useCallback(async () => {
    if (!address) return;
    setIsRegistering(true);
    try {
      const silentSend = options?.sendTransactionSilent;
      if (silentSend) {
        const data = encodeFunctionData({
          abi: GAME_ABI,
          functionName: "registerReferralCode",
          args: [],
        });
        const hash = await silentSend({ to: CONTRACT_ADDRESS, data });
        if (publicClient) {
          await Promise.race([
            publicClient.waitForTransactionReceipt({ hash }),
            delay(TX_RECEIPT_TIMEOUT_MS).then(() => { throw new Error("Timeout"); }),
          ]);
        }
      } else {
        await writeContractAsync({
          address: CONTRACT_ADDRESS,
          abi: GAME_ABI,
          functionName: "registerReferralCode",
          args: [],
          chainId: APP_CHAIN_ID,
        });
      }
      log.info("Referral", "code registered");
      refetchReferralInfo();
    } catch (err) {
      log.error("Referral", "registerCode failed", err);
    } finally {
      setIsRegistering(false);
    }
  }, [address, options?.sendTransactionSilent, publicClient, writeContractAsync, refetchReferralInfo]);

  // Claim pending referral earnings
  const claimEarnings = useCallback(async () => {
    if (!address || !referralInfo?.pendingEarningsWei || referralInfo.pendingEarningsWei === BigInt(0)) return;
    setIsClaiming(true);
    try {
      const silentSend = options?.sendTransactionSilent;
      if (silentSend) {
        const data = encodeFunctionData({
          abi: GAME_ABI,
          functionName: "claimReferralEarnings",
          args: [],
        });
        const hash = await silentSend({ to: CONTRACT_ADDRESS, data });
        if (publicClient) {
          await Promise.race([
            publicClient.waitForTransactionReceipt({ hash }),
            delay(TX_RECEIPT_TIMEOUT_MS).then(() => { throw new Error("Timeout"); }),
          ]);
        }
      } else {
        await writeContractAsync({
          address: CONTRACT_ADDRESS,
          abi: GAME_ABI,
          functionName: "claimReferralEarnings",
          args: [],
          chainId: APP_CHAIN_ID,
        });
      }
      log.info("Referral", "earnings claimed");
      refetchReferralInfo();
    } catch (err) {
      log.error("Referral", "claimEarnings failed", err);
    } finally {
      setIsClaiming(false);
    }
  }, [address, referralInfo?.pendingEarningsWei, options?.sendTransactionSilent, publicClient, writeContractAsync, refetchReferralInfo]);

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
