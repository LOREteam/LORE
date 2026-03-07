import { NextRequest, NextResponse } from "next/server";
import { decodeEventLog, encodeEventTopics, formatUnits, parseAbi, toHex } from "viem";
import {
  CONTRACT_ADDRESS,
  CONTRACT_DEPLOY_BLOCK,
  fetchFirebaseJson,
  fetchFirebaseWithOrderFallback,
  filterByCurrentEpoch,
  parseCurrentEpoch,
  patchFirebase,
  publicClient,
} from "../_lib/dataBridge";

const LOG_CHUNK_BLOCKS = 50_000n;

const EVENTS_ABI = parseAbi([
  "event BetPlaced(uint256 indexed epoch, address indexed user, uint256 indexed tileId, uint256 amount)",
  "event BatchBetsPlaced(uint256 indexed epoch, address indexed user, uint256[] tileIds, uint256[] amounts, uint256 totalAmount)",
]);
const [betSig] = encodeEventTopics({ abi: EVENTS_ABI, eventName: "BetPlaced" });
const [batchSig] = encodeEventTopics({ abi: EVENTS_ABI, eventName: "BatchBetsPlaced" });

type DepositRow = {
  epoch: string;
  tileIds: number[];
  totalAmount: string;
  totalAmountNum: number;
  txHash: string;
  blockNumber: string;
  amounts?: string[];
};

function buildDepositKey(epoch: string, txHash: string, blockNumber: string): string {
  const normalizedHash = txHash.toLowerCase().trim();
  if (/^0x[0-9a-f]+$/.test(normalizedHash)) {
    return `${epoch}_${normalizedHash}`;
  }
  return `${epoch}_nohash_${blockNumber}`;
}

function dedupeDeposits(rows: DepositRow[]): DepositRow[] {
  const byKey = new Map<string, DepositRow>();
  for (const row of rows) {
    const key = `${row.epoch}_${String(row.txHash ?? "").toLowerCase().trim()}`;
    const prev = byKey.get(key);
    if (!prev) {
      byKey.set(key, row);
      continue;
    }
    const prevBlock = Number(prev.blockNumber ?? "0");
    const nextBlock = Number(row.blockNumber ?? "0");
    if (nextBlock >= prevBlock) {
      byKey.set(key, row);
    }
  }
  return Array.from(byKey.values());
}

async function getLogsByTopicAndUser(topic0: `0x${string}`, userTopic: `0x${string}`) {
  const all: Awaited<ReturnType<typeof publicClient.getLogs>> = [];
  const head = await publicClient.getBlockNumber();
  for (let from = CONTRACT_DEPLOY_BLOCK; from <= head; from += LOG_CHUNK_BLOCKS) {
    const to = from + LOG_CHUNK_BLOCKS - 1n > head ? head : from + LOG_CHUNK_BLOCKS - 1n;
    const logsRequest = {
      address: CONTRACT_ADDRESS,
      topics: [topic0, null, userTopic],
      fromBlock: from,
      toBlock: to,
    } as unknown as Parameters<typeof publicClient.getLogs>[0];
    const logs = await publicClient.getLogs(logsRequest);
    all.push(...logs);
  }
  return all;
}

async function fetchDepositsFromChain(user: string, currentEpoch: number | null) {
  const userTopic = toHex(user as `0x${string}`, { size: 32 });
  const betLogs = betSig ? await getLogsByTopicAndUser(betSig, userTopic) : [];
  const batchLogs = batchSig ? await getLogsByTopicAndUser(batchSig, userTopic) : [];

  const byKey = new Map<string, DepositRow>();
  const all = [...betLogs, ...batchLogs];
  all.sort((a, b) => Number((a.blockNumber ?? 0n) - (b.blockNumber ?? 0n)));

  for (const log of all) {
    const topic0 = log.topics[0];
    if (!topic0) continue;
    try {
      if (topic0 === betSig) {
        const decoded = decodeEventLog({ abi: EVENTS_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName !== "BetPlaced") continue;
        const args = decoded.args as { epoch: bigint; tileId: bigint; amount: bigint };
        const ep = Number(args.epoch);
        if (currentEpoch && (ep < 1 || ep > currentEpoch)) continue;
        const key = buildDepositKey(
          args.epoch.toString(),
          log.transactionHash ?? "",
          (log.blockNumber ?? 0n).toString(),
        );
        const amount = formatUnits(args.amount, 18);
        const prev = byKey.get(key);
        if (prev) {
          prev.tileIds.push(Number(args.tileId));
          prev.totalAmountNum += parseFloat(amount);
          prev.totalAmount = prev.totalAmountNum.toString();
        } else {
          byKey.set(key, {
            epoch: args.epoch.toString(),
            tileIds: [Number(args.tileId)],
            amounts: [amount],
            totalAmount: amount,
            totalAmountNum: parseFloat(amount),
            txHash: log.transactionHash ?? "",
            blockNumber: (log.blockNumber ?? 0n).toString(),
          });
        }
      } else if (topic0 === batchSig) {
        const decoded = decodeEventLog({ abi: EVENTS_ABI, data: log.data, topics: log.topics });
        if (decoded.eventName !== "BatchBetsPlaced") continue;
        const args = decoded.args as { epoch: bigint; tileIds: readonly bigint[]; amounts: readonly bigint[]; totalAmount: bigint };
        const ep = Number(args.epoch);
        if (currentEpoch && (ep < 1 || ep > currentEpoch)) continue;
        const key = buildDepositKey(
          args.epoch.toString(),
          log.transactionHash ?? "",
          (log.blockNumber ?? 0n).toString(),
        );
        byKey.set(key, {
          epoch: args.epoch.toString(),
          tileIds: args.tileIds.map(Number),
          amounts: args.amounts.map((a) => formatUnits(a, 18)),
          totalAmount: formatUnits(args.totalAmount, 18),
          totalAmountNum: parseFloat(formatUnits(args.totalAmount, 18)),
          txHash: log.transactionHash ?? "",
          blockNumber: (log.blockNumber ?? 0n).toString(),
        });
      }
    } catch {
      // malformed log
    }
  }

  const rows = Array.from(byKey.values());
  rows.sort((a, b) => Number(b.epoch) - Number(a.epoch));
  return rows.slice(0, 5000);
}

export async function GET(request: NextRequest) {
  const user = request.nextUrl.searchParams.get("user")?.toLowerCase();
  if (!user || !/^0x[0-9a-f]{40}$/.test(user)) {
    return NextResponse.json({ error: "Missing or invalid ?user=0x..." }, { status: 400 });
  }

  try {
    const fb = await fetchFirebaseWithOrderFallback<Record<string, DepositRow>>(
      `gamedata/bets/${user}`,
      "epoch",
      5000,
    );
    if (!fb.ok) {
      return NextResponse.json(
        { deposits: [], error: `Firebase ${fb.status}` },
        { status: 502 },
      );
    }
    const raw = fb.data;
    if (!raw || typeof raw !== "object") {
      return NextResponse.json({ deposits: [] });
    }

    let deposits = Object.values(raw) as DepositRow[];

    // Only show deposits from current contract (exclude old contract epochs 71–1007+)
    const meta = await fetchFirebaseJson<number>("gamedata/_meta/currentEpoch");
    const currentEpochNum = parseCurrentEpoch(meta.data);
    deposits = filterByCurrentEpoch(deposits, currentEpochNum);
    deposits = deposits.filter((d) => {
      const blockNumber = Number(d.blockNumber ?? "0");
      // Drop stale deposits from older contracts when block marker is available
      if (blockNumber > 0 && BigInt(blockNumber) < CONTRACT_DEPLOY_BLOCK) return false;
      return true;
    });
    deposits = dedupeDeposits(deposits);

    // Chain supplement: if DB is empty/missing, recover user deposits from on-chain logs and upsert to Firebase
    if (deposits.length === 0) {
      const recovered = await fetchDepositsFromChain(user, currentEpochNum);
      if (recovered.length > 0) {
        const patch: Record<string, unknown> = {};
        for (const d of recovered) {
          const key = buildDepositKey(d.epoch, d.txHash, d.blockNumber);
          patch[key] = d;
        }
        await patchFirebase(`gamedata/bets/${user}`, patch);
        deposits = recovered;
      }
    }

    deposits.sort((a, b) => Number(b.epoch) - Number(a.epoch));
    const limited = deposits.slice(0, 5000);

    return NextResponse.json({ deposits: limited });
  } catch (err) {
    console.error("[api/deposits] Error:", err);
    return NextResponse.json({ deposits: [], error: "fetch failed" }, { status: 500 });
  }
}
