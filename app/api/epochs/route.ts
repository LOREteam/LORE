import { NextResponse } from "next/server";
import { parseAbi } from "viem";
import { DEFAULT_API_EPOCHS_RECONCILE_MAX } from "../../../config/publicConfig";
import {
  CONTRACT_ADDRESS,
  CONTRACT_DEPLOY_BLOCK,
  fetchFirebaseJson,
  parseCurrentEpoch,
  patchFirebase,
  publicClient,
} from "../_lib/dataBridge";
const MAX_CHAIN_RECONCILE_EPOCHS = Number(process.env.API_EPOCHS_RECONCILE_MAX ?? String(DEFAULT_API_EPOCHS_RECONCILE_MAX));

const READ_ABI = parseAbi([
  "function epochs(uint256) view returns (uint256 totalPool, uint256 rewardPool, uint256 winningTile, bool isResolved, bool isDailyJackpot, bool isWeeklyJackpot)",
  "function currentEpoch() view returns (uint256)",
]);

type EpochRow = {
  winningTile: number;
  totalPool: string;
  rewardPool: string;
  fee?: string;
  jackpotBonus?: string;
  isDailyJackpot: boolean;
  isWeeklyJackpot: boolean;
  resolvedBlock?: string;
};

export async function GET() {
  try {
    const [epochsRes, metaRes] = await Promise.all([
      fetchFirebaseJson<Record<string, EpochRow>>("gamedata/epochs"),
      fetchFirebaseJson<number>("gamedata/_meta/currentEpoch"),
    ]);
    const raw = epochsRes.ok ? (epochsRes.data ?? {}) : {};
    let currentEpoch = parseCurrentEpoch(metaRes.data) ?? NaN;
    if (!Number.isInteger(currentEpoch) || currentEpoch <= 0) {
      try {
        currentEpoch = Number(await publicClient.readContract({
          address: CONTRACT_ADDRESS,
          abi: READ_ABI,
          functionName: "currentEpoch",
        }));
      } catch {
        currentEpoch = NaN;
      }
    }

    // If indexer wrote currentEpoch, only return epochs <= currentEpoch (exclude old contract data)
    let epochs =
      Number.isInteger(currentEpoch) && currentEpoch > 0
        ? Object.fromEntries(
            Object.entries(raw).filter(([key, value]) => {
              const n = Number(key);
              if (!Number.isInteger(n) || n < 1 || n > currentEpoch) return false;
              const resolvedBlock = Number((value as EpochRow).resolvedBlock ?? "0");
              // Drop stale epochs from older contracts when block marker is available
              if (resolvedBlock > 0 && BigInt(resolvedBlock) < CONTRACT_DEPLOY_BLOCK) return false;
              return true;
            }),
          )
        : raw;

    // Chain supplement: recover missing epochs in a safe capped batch and upsert back to Firebase
    if (Number.isInteger(currentEpoch) && currentEpoch > 1) {
      const present = new Set<number>(
        Object.keys(epochs)
          .map((k) => Number(k))
          .filter((n) => Number.isInteger(n) && n > 0),
      );
      const missing: number[] = [];
      for (let ep = 1; ep < currentEpoch; ep++) {
        if (!present.has(ep)) missing.push(ep);
      }

      if (missing.length > 0) {
        const target = missing.slice(-Math.max(1, MAX_CHAIN_RECONCILE_EPOCHS));
        const patch: Record<string, EpochRow> = {};
        for (const ep of target) {
          try {
            const row = await publicClient.readContract({
              address: CONTRACT_ADDRESS,
              abi: READ_ABI,
              functionName: "epochs",
              args: [BigInt(ep)],
            }) as [bigint, bigint, bigint, boolean, boolean, boolean];
            const isResolved = row[3];
            if (!isResolved) continue;
            patch[String(ep)] = {
              winningTile: Number(row[2]),
              totalPool: row[0].toString(),
              rewardPool: row[1].toString(),
              isDailyJackpot: row[4],
              isWeeklyJackpot: row[5],
            };
          } catch {
            // ignore one failed epoch
          }
        }

        if (Object.keys(patch).length > 0) {
          await patchFirebase("gamedata/epochs", patch);
          epochs = { ...epochs, ...patch };
        }
      }
    }

    return NextResponse.json({ epochs });
  } catch (err) {
    console.error("[api/epochs] Error:", err);
    return NextResponse.json({ epochs: {}, error: "fetch failed" }, { status: 500 });
  }
}
