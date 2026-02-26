import { NextRequest, NextResponse } from "next/server";

const FIREBASE_DB_URL =
  process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ||
  "https://lore-78751-default-rtdb.europe-west1.firebasedatabase.app";

export async function GET(request: NextRequest) {
  const user = request.nextUrl.searchParams.get("user")?.toLowerCase();
  if (!user || !/^0x[0-9a-f]{40}$/.test(user)) {
    return NextResponse.json({ error: "Missing or invalid ?user=0x..." }, { status: 400 });
  }

  try {
    let res = await fetch(
      `${FIREBASE_DB_URL}/gamedata/bets/${user}.json?orderBy="epoch"&limitToLast=5000`,
      { next: { revalidate: 10 } },
    );
    if (res.status === 400) {
      res = await fetch(`${FIREBASE_DB_URL}/gamedata/bets/${user}.json`, {
        next: { revalidate: 10 },
      });
    }
    if (!res.ok) {
      return NextResponse.json(
        { deposits: [], error: `Firebase ${res.status}` },
        { status: 502 },
      );
    }
    const raw = await res.json();
    if (!raw || typeof raw !== "object") {
      return NextResponse.json({ deposits: [] });
    }

    let deposits = Object.values(raw) as Array<{
      epoch: string;
      tileIds: number[];
      totalAmount: string;
      totalAmountNum: number;
      txHash: string;
      blockNumber: string;
    }>;

    // Only show deposits from current contract (exclude old contract epochs 71–1007+)
    const metaRes = await fetch(`${FIREBASE_DB_URL}/gamedata/_meta/currentEpoch.json`, {
      next: { revalidate: 10 },
    });
    const currentEpoch = metaRes.ok ? Number(await metaRes.json()) : NaN;
    if (Number.isInteger(currentEpoch) && currentEpoch > 0) {
      deposits = deposits.filter((d) => {
        const n = Number(d.epoch);
        return Number.isInteger(n) && n >= 1 && n <= currentEpoch;
      });
    }

    deposits.sort((a, b) => Number(b.epoch) - Number(a.epoch));
    const limited = deposits.slice(0, 5000);

    return NextResponse.json({ deposits: limited });
  } catch (err) {
    console.error("[api/deposits] Error:", err);
    return NextResponse.json({ deposits: [], error: "fetch failed" }, { status: 500 });
  }
}
