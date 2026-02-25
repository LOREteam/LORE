"use client";

import { useMemo, useState } from "react";
import { useAccount, useReadContract, useWriteContract } from "wagmi";
import { formatUnits } from "viem";
import { usePrivy } from "@privy-io/react-auth";
import { APP_CHAIN_ID, CONTRACT_ADDRESS, GAME_ABI } from "../lib/constants";

function fmtToken(v?: bigint) {
  if (v === undefined) return "...";
  return Number(formatUnits(v, 18)).toFixed(4);
}

export default function AdminPage() {
  const { address } = useAccount();
  const { login } = usePrivy();
  const { writeContractAsync } = useWriteContract();
  const [nextDuration, setNextDuration] = useState("60");
  const [busy, setBusy] = useState<string | null>(null);

  const { data: owner } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: GAME_ABI,
    functionName: "owner",
    chainId: APP_CHAIN_ID,
  });
  const { data: accruedOwnerFees, refetch: refetchOwnerFees } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: GAME_ABI,
    functionName: "accruedOwnerFees",
    chainId: APP_CHAIN_ID,
  });
  const { data: accruedBurnFees, refetch: refetchBurnFees } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: GAME_ABI,
    functionName: "accruedBurnFees",
    chainId: APP_CHAIN_ID,
  });
  const { data: pendingResolverReward, refetch: refetchResolverReward } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: GAME_ABI,
    functionName: "pendingResolverRewards",
    args: address ? [address] : undefined,
    chainId: APP_CHAIN_ID,
    query: { enabled: !!address },
  });
  const { data: epochDuration, refetch: refetchDuration } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: GAME_ABI,
    functionName: "epochDuration",
    chainId: APP_CHAIN_ID,
  });
  const { data: pendingDuration, refetch: refetchPendingDuration } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: GAME_ABI,
    functionName: "pendingEpochDuration",
    chainId: APP_CHAIN_ID,
  });
  const { data: pendingEta, refetch: refetchPendingEta } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: GAME_ABI,
    functionName: "pendingEpochDurationEta",
    chainId: APP_CHAIN_ID,
  });
  const { data: pendingFromEpoch, refetch: refetchPendingFromEpoch } = useReadContract({
    address: CONTRACT_ADDRESS,
    abi: GAME_ABI,
    functionName: "pendingEpochDurationEffectiveFromEpoch",
    chainId: APP_CHAIN_ID,
  });

  const isOwner = useMemo(() => {
    if (!address || !owner) return false;
    return address.toLowerCase() === owner.toLowerCase();
  }, [address, owner]);

  const refetchAll = async () => {
    await Promise.all([
      refetchOwnerFees(),
      refetchBurnFees(),
      refetchResolverReward(),
      refetchDuration(),
      refetchPendingDuration(),
      refetchPendingEta(),
      refetchPendingFromEpoch(),
    ]);
  };

  const onFlush = async () => {
    try {
      setBusy("flush");
      await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: GAME_ABI,
        functionName: "flushProtocolFees",
        args: [],
        chainId: APP_CHAIN_ID,
      });
      await refetchAll();
    } finally {
      setBusy(null);
    }
  };

  const onClaimResolver = async () => {
    try {
      setBusy("resolver");
      await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: GAME_ABI,
        functionName: "claimResolverRewards",
        args: [],
        chainId: APP_CHAIN_ID,
      });
      await refetchAll();
    } finally {
      setBusy(null);
    }
  };

  const onScheduleDuration = async () => {
    const n = Number(nextDuration);
    if (!Number.isFinite(n) || n < 15 || n > 3600) {
      alert("Duration must be 15..3600 seconds.");
      return;
    }
    try {
      setBusy("schedule");
      await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: GAME_ABI,
        functionName: "scheduleEpochDuration",
        args: [BigInt(Math.floor(n))],
        chainId: APP_CHAIN_ID,
      });
      await refetchAll();
    } finally {
      setBusy(null);
    }
  };

  const onCancelDuration = async () => {
    try {
      setBusy("cancel");
      await writeContractAsync({
        address: CONTRACT_ADDRESS,
        abi: GAME_ABI,
        functionName: "cancelEpochDurationChange",
        args: [],
        chainId: APP_CHAIN_ID,
      });
      await refetchAll();
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="min-h-screen bg-[#060612] text-slate-200 p-6">
      <div className="max-w-3xl mx-auto space-y-4">
        <h1 className="text-2xl font-bold">LORE Admin</h1>
        <p className="text-sm text-gray-400">
          Contract: <span className="font-mono">{CONTRACT_ADDRESS}</span>
        </p>

        {!address ? (
          <button onClick={login} className="px-4 py-2 rounded bg-violet-600 hover:bg-violet-500">
            Login / Connect
          </button>
        ) : !isOwner ? (
          <div className="rounded border border-red-500/30 bg-red-500/10 p-3 text-red-300 text-sm space-y-1">
            <div>Connected wallet is not owner.</div>
            <div className="text-[12px] text-red-200/90">
              Connected: <span className="font-mono">{address}</span>
            </div>
            <div className="text-[12px] text-red-200/90">
              Owner: <span className="font-mono">{owner ?? "..."}</span>
            </div>
          </div>
        ) : (
          <>
            <div className="rounded border border-white/10 bg-white/[0.02] p-4 space-y-2">
              <div className="text-xs uppercase tracking-wider text-gray-400">Fees</div>
              <div className="text-sm">Accrued owner fees: <b>{fmtToken(accruedOwnerFees as bigint | undefined)}</b> LINEA</div>
              <div className="text-sm">Accrued burn fees: <b>{fmtToken(accruedBurnFees as bigint | undefined)}</b> LINEA</div>
              <button disabled={busy !== null} onClick={onFlush} className="px-3 py-2 rounded bg-sky-600 hover:bg-sky-500 disabled:opacity-50">
                Flush Protocol Fees
              </button>
            </div>

            <div className="rounded border border-white/10 bg-white/[0.02] p-4 space-y-2">
              <div className="text-xs uppercase tracking-wider text-gray-400">Resolver</div>
              <div className="text-sm">My pending resolver reward: <b>{fmtToken(pendingResolverReward as bigint | undefined)}</b> LINEA</div>
              <button disabled={busy !== null} onClick={onClaimResolver} className="px-3 py-2 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50">
                Claim Resolver Rewards
              </button>
            </div>

            <div className="rounded border border-white/10 bg-white/[0.02] p-4 space-y-2">
              <div className="text-xs uppercase tracking-wider text-gray-400">Epoch Duration</div>
              <div className="text-sm">Current: <b>{epochDuration ? Number(epochDuration) : "..."}s</b></div>
              <div className="text-sm">
                Pending: <b>{pendingDuration ? `${Number(pendingDuration)}s` : "none"}</b>
                {pendingEta ? `, ETA ${new Date(Number(pendingEta) * 1000).toLocaleString()}` : ""}
                {pendingFromEpoch ? `, from epoch #${pendingFromEpoch.toString()}` : ""}
              </div>
              <div className="flex gap-2">
                <input
                  value={nextDuration}
                  onChange={(e) => setNextDuration(e.target.value)}
                  className="px-2 py-1 rounded bg-black/30 border border-white/10"
                  placeholder="seconds"
                />
                <button disabled={busy !== null} onClick={onScheduleDuration} className="px-3 py-2 rounded bg-violet-600 hover:bg-violet-500 disabled:opacity-50">
                  Schedule
                </button>
                <button disabled={busy !== null} onClick={onCancelDuration} className="px-3 py-2 rounded bg-amber-600 hover:bg-amber-500 disabled:opacity-50">
                  Cancel
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

