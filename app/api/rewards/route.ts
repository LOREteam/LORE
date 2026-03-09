import { NextResponse } from "next/server";
import { formatUnits, parseAbi } from "viem";
import { CONTRACT_ADDRESS, publicClient } from "../_lib/dataBridge";
import { enforceSharedRateLimit } from "../_lib/sharedRateLimit";

const READ_ABI = parseAbi([
  "function epochs(uint256) view returns (uint256 totalPool, uint256 rewardPool, uint256 winningTile, bool isResolved, bool isDailyJackpot, bool isWeeklyJackpot)",
  "function userBets(uint256 epoch, uint256 tile, address user) view returns (uint256)",
  "function tilePools(uint256 epoch, uint256 tile) view returns (uint256)",
]);

const MAX_EPOCHS_PER_REQUEST = 400;
const MULTICALL_CHUNK = 100;

type RewardsRequest = {
  user?: unknown;
  epochs?: unknown;
};

type RewardRow = {
  reward: string;
  winningTile: number;
  rewardPool: string;
  winningTilePool: string;
  userWinningAmount: string;
};

export async function POST(request: Request) {
  const rateLimited = await enforceSharedRateLimit(request, {
    bucket: "api-rewards",
    limit: 20,
    windowMs: 60_000,
  });
  if (rateLimited) return rateLimited;

  try {
    const body = (await request.json()) as RewardsRequest;
    const user = typeof body.user === "string" ? body.user.toLowerCase() : "";
    if (!/^0x[0-9a-f]{40}$/.test(user)) {
      return NextResponse.json({ error: "Missing or invalid user" }, { status: 400 });
    }

    const epochsRaw = Array.isArray(body.epochs) ? body.epochs : [];
    const epochs = [...new Set(
      epochsRaw
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value > 0),
    )].slice(0, MAX_EPOCHS_PER_REQUEST);

    if (epochs.length === 0) {
      return NextResponse.json({ rewards: {} });
    }

    const rewards: Record<string, RewardRow> = {};

    for (let offset = 0; offset < epochs.length; offset += MULTICALL_CHUNK) {
      const chunk = epochs.slice(offset, offset + MULTICALL_CHUNK);
      const epochResults = await publicClient.multicall({
        contracts: chunk.map((epoch) => ({
          address: CONTRACT_ADDRESS,
          abi: READ_ABI,
          functionName: "epochs",
          args: [BigInt(epoch)],
        })),
      });

      const winningEpochs: Array<{
        epoch: number;
        rewardPool: bigint;
        winningTile: bigint;
      }> = [];

      chunk.forEach((epoch, index) => {
        const row = epochResults[index]?.result as
          | [bigint, bigint, bigint, boolean, boolean, boolean]
          | undefined;
        if (!row) return;
        const isResolved = Boolean(row[3]);
        const rewardPool = row[1];
        const winningTile = row[2];
        if (!isResolved || winningTile <= 0n || rewardPool <= 0n) return;
        winningEpochs.push({ epoch, rewardPool, winningTile });
      });

      if (winningEpochs.length === 0) continue;

      const [userBetResults, tilePoolResults] = await Promise.all([
        publicClient.multicall({
          contracts: winningEpochs.map((entry) => ({
            address: CONTRACT_ADDRESS,
            abi: READ_ABI,
            functionName: "userBets",
            args: [BigInt(entry.epoch), entry.winningTile, user as `0x${string}`],
          })),
        }),
        publicClient.multicall({
          contracts: winningEpochs.map((entry) => ({
            address: CONTRACT_ADDRESS,
            abi: READ_ABI,
            functionName: "tilePools",
            args: [BigInt(entry.epoch), entry.winningTile],
          })),
        }),
      ]);

      winningEpochs.forEach((entry, index) => {
        const userWinningAmount = (userBetResults[index]?.result as bigint | undefined) ?? 0n;
        const winningTilePool = (tilePoolResults[index]?.result as bigint | undefined) ?? 0n;
        if (userWinningAmount <= 0n || winningTilePool <= 0n) return;

        const reward = (entry.rewardPool * userWinningAmount) / winningTilePool;
        rewards[String(entry.epoch)] = {
          reward: formatUnits(reward, 18),
          winningTile: Number(entry.winningTile),
          rewardPool: formatUnits(entry.rewardPool, 18),
          winningTilePool: formatUnits(winningTilePool, 18),
          userWinningAmount: formatUnits(userWinningAmount, 18),
        };
      });
    }

    return NextResponse.json({ rewards });
  } catch (error) {
    console.error("[api/rewards] Error:", error);
    return NextResponse.json({ rewards: {}, error: "fetch failed" }, { status: 500 });
  }
}
