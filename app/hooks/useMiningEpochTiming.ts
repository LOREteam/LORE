"use client";

import type { PublicClient } from "viem";
import { CONTRACT_ADDRESS, GAME_ABI } from "../lib/constants";
import { log } from "../lib/logger";
import { delay } from "../lib/utils";

const WAIT_FOR_EPOCH_MAX_MS = 75_000;
const EXTERNAL_RESOLVE_GRACE_MAX_MS = 8_000;
const EXTERNAL_RESOLVE_POLL_MS = 500;

interface AwaitEpochReadyParams {
  isActive: () => boolean;
  lastPlacedEpoch: bigint;
  onProgress: (message: string) => void;
  readClient: () => PublicClient | undefined;
  renewLock: () => void;
  roundIndex: number;
  rounds: number;
  secureRandom: (max: number) => number;
}

export async function awaitEpochReadyToBet({
  isActive,
  lastPlacedEpoch,
  onProgress,
  readClient,
  renewLock,
  roundIndex,
  rounds,
  secureRandom,
}: AwaitEpochReadyParams) {
  onProgress(`${roundIndex} / ${rounds} - waiting for epoch to end...`);

  const waitPhaseStart = Date.now();
  while (isActive()) {
    if (Date.now() - waitPhaseStart > WAIT_FOR_EPOCH_MAX_MS) {
      log.warn("AutoMine", "wait for epoch timeout - proceeding to place bet", {
        lastPlacedEpoch: lastPlacedEpoch.toString(),
      });
      onProgress(`${roundIndex} / ${rounds} - epoch wait timeout, placing bet...`);
      break;
    }

    try {
      const client = readClient();
      if (!client) {
        await delay(200);
        continue;
      }

      const endTime = (await client.readContract({
        address: CONTRACT_ADDRESS,
        abi: GAME_ABI,
        functionName: "getEpochEndTime",
        args: [lastPlacedEpoch],
      })) as bigint;
      const nowSec = BigInt(Math.floor(Date.now() / 1000));
      if (nowSec >= endTime) break;

      const secLeft = Number(endTime - nowSec);
      const waitMs = secLeft <= 10
        ? Math.min(secLeft * 1000 + 100, 300)
        : secLeft <= 60
          ? Math.min(secLeft * 1000 + 200, 500)
          : Math.min(secLeft * 1000 + 300, 2000);
      renewLock();
      await delay(waitMs);
    } catch (error) {
      log.warn("AutoMine", "getEpochEndTime failed in wait loop, retrying", error);
      await delay(500);
    }
  }

  if (!isActive()) return { stopped: true } as const;

  try {
    const client = readClient();
    if (client) {
      let latestEpoch = (await client.readContract({
        address: CONTRACT_ADDRESS,
        abi: GAME_ABI,
        functionName: "currentEpoch",
      })) as bigint;

      if (latestEpoch <= lastPlacedEpoch) {
        const graceStart = Date.now();
        const initialJitterMs = 400 + secureRandom(1000);
        onProgress(`${roundIndex} / ${rounds} - waiting first resolver...`);
        await delay(initialJitterMs);

        while (isActive() && Date.now() - graceStart < EXTERNAL_RESOLVE_GRACE_MAX_MS) {
          latestEpoch = (await client.readContract({
            address: CONTRACT_ADDRESS,
            abi: GAME_ABI,
            functionName: "currentEpoch",
          })) as bigint;
          if (latestEpoch > lastPlacedEpoch) {
            log.info("AutoMine", "epoch advanced by other player - placing without resolve race", {
              previousEpoch: lastPlacedEpoch.toString(),
              latestEpoch: latestEpoch.toString(),
            });
            break;
          }
          await delay(EXTERNAL_RESOLVE_POLL_MS);
        }
      }
    }
  } catch (error) {
    log.warn("AutoMine", "external resolver grace check failed, placing anyway", error);
  }

  return { stopped: !isActive() } as const;
}
