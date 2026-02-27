import { NextResponse } from "next/server";
import { encodeEventTopics, parseAbi, toHex, formatUnits } from "viem";
import {
  CONTRACT_ADDRESS,
  CONTRACT_DEPLOY_BLOCK,
  fetchFirebaseJson,
  fetchFirebaseWithOrderFallback,
  filterByCurrentEpoch,
  parseCurrentEpoch,
  publicClient,
} from "../_lib/dataBridge";

const READ_ABI = parseAbi([
  "function getJackpotInfo() view returns (uint256 dailyPool, uint256 weeklyPool, uint256 lastDailyDay, uint256 lastWeeklyWeek, uint256 lastDailyEpoch, uint256 lastWeeklyEpoch, uint256 lastDailyAmount, uint256 lastWeeklyAmount)",
]);
const EVENTS_ABI = parseAbi([
  "event DailyJackpotAwarded(uint256 indexed epoch, uint256 amount)",
  "event WeeklyJackpotAwarded(uint256 indexed epoch, uint256 amount)",
]);
const [dailySig] = encodeEventTopics({ abi: EVENTS_ABI, eventName: "DailyJackpotAwarded" });
const [weeklySig] = encodeEventTopics({ abi: EVENTS_ABI, eventName: "WeeklyJackpotAwarded" });

type JackpotRow = {
  epoch: string;
  kind: "daily" | "weekly";
  amount: string;
  amountNum: number;
  txHash: string;
  blockNumber: string;
};

async function fetchJackpotEventByEpoch(
  kind: "daily" | "weekly",
  epoch: number,
): Promise<{ txHash: string; blockNumber: string } | null> {
  if (!Number.isInteger(epoch) || epoch <= 0) return null;
  const topic0 = kind === "daily" ? dailySig : weeklySig;
  if (!topic0) return null;
  const epochTopic = toHex(BigInt(epoch), { size: 32 });
  const currentBlock = await publicClient.getBlockNumber();
  const logs = await publicClient.getLogs({
    address: CONTRACT_ADDRESS,
    topics: [topic0, epochTopic],
    fromBlock: CONTRACT_DEPLOY_BLOCK,
    toBlock: currentBlock,
  } as any);
  const log = logs[logs.length - 1];
  if (!log) return null;
  return {
    txHash: log.transactionHash ?? "",
    blockNumber: (log.blockNumber ?? 0n).toString(),
  };
}

export async function GET() {
  try {
    const fb = await fetchFirebaseWithOrderFallback<Record<string, JackpotRow>>(
      "gamedata/jackpots",
      "epoch",
      200,
    );
    if (!fb.ok) {
      return NextResponse.json(
        { jackpots: [], error: `Firebase ${fb.status}` },
        { status: 502 },
      );
    }
    const raw = fb.data ?? {};
    if (typeof raw !== "object") {
      return NextResponse.json({ jackpots: [] });
    }

    let jackpots = Object.values(raw) as JackpotRow[];

    // Only show jackpots from current contract
    const meta = await fetchFirebaseJson<number>("gamedata/_meta/currentEpoch");
    const currentEpoch = parseCurrentEpoch(meta.data);
    jackpots = filterByCurrentEpoch(jackpots, currentEpoch);
    jackpots = jackpots.filter((j) => {
      const blockNumber = Number(j.blockNumber ?? "0");
      // Drop stale jackpots from older contracts when block marker is available
      if (blockNumber > 0 && BigInt(blockNumber) < CONTRACT_DEPLOY_BLOCK) return false;
      return true;
    });

    // Safety fallback: if indexer skipped latest jackpot, recover from chain
    try {
      const info = await publicClient.readContract({
        address: CONTRACT_ADDRESS,
        abi: READ_ABI,
        functionName: "getJackpotInfo",
      }) as [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint];

      const lastDailyEpoch = Number(info[4]);
      const lastWeeklyEpoch = Number(info[5]);
      // Use string formatting with proper precision instead of Number division
      const formatAmount = (wei: bigint): { amount: string; amountNum: number } => ({
        amount: formatUnits(wei, 18),
        amountNum: parseFloat(formatUnits(wei, 18)),
      });

      const byKey = new Map<string, JackpotRow>();
      for (const j of jackpots) byKey.set(`${j.kind}_${j.epoch}`, j);

      if (Number.isInteger(lastDailyEpoch) && lastDailyEpoch > 0) {
        const key = `daily_${lastDailyEpoch}`;
        if (!byKey.has(key)) {
          const dailyFormatted = formatAmount(info[6]);
          const onchain = await fetchJackpotEventByEpoch("daily", lastDailyEpoch);
          byKey.set(key, {
            epoch: String(lastDailyEpoch),
            kind: "daily",
            amount: dailyFormatted.amount,
            amountNum: dailyFormatted.amountNum,
            txHash: onchain?.txHash ?? "",
            blockNumber: onchain?.blockNumber ?? "0",
          });
        }
      }

      if (Number.isInteger(lastWeeklyEpoch) && lastWeeklyEpoch > 0) {
        const key = `weekly_${lastWeeklyEpoch}`;
        if (!byKey.has(key)) {
          const weeklyFormatted = formatAmount(info[7]);
          const onchain = await fetchJackpotEventByEpoch("weekly", lastWeeklyEpoch);
          byKey.set(key, {
            epoch: String(lastWeeklyEpoch),
            kind: "weekly",
            amount: weeklyFormatted.amount,
            amountNum: weeklyFormatted.amountNum,
            txHash: onchain?.txHash ?? "",
            blockNumber: onchain?.blockNumber ?? "0",
          });
        }
      }

      jackpots = Array.from(byKey.values());
    } catch (err) {
      console.warn("[api/jackpots] On-chain fallback failed:", (err as Error).message);
    }

    jackpots.sort((a, b) => Number(b.blockNumber) - Number(a.blockNumber));
    const limited = jackpots.slice(0, 200);

    return NextResponse.json({ jackpots: limited });
  } catch (err) {
    console.error("[api/jackpots] Error:", err);
    return NextResponse.json({ jackpots: [], error: "fetch failed" }, { status: 500 });
  }
}
