import { NextResponse } from "next/server";

const FIREBASE_DB_URL =
  process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ||
  "https://lore-78751-default-rtdb.europe-west1.firebasedatabase.app";

export async function GET() {
  try {
    const res = await fetch(
      `${FIREBASE_DB_URL}/gamedata/jackpots.json?orderBy="epoch"&limitToLast=200`,
      { next: { revalidate: 10 } },
    );
    if (!res.ok) {
      return NextResponse.json({ jackpots: [] });
    }
    const raw = await res.json();
    if (!raw || typeof raw !== "object") {
      return NextResponse.json({ jackpots: [] });
    }

    const jackpots = Object.values(raw) as Array<{
      epoch: string;
      kind: "daily" | "weekly";
      amount: string;
      amountNum: number;
      txHash: string;
      blockNumber: string;
    }>;

    jackpots.sort((a, b) => Number(b.blockNumber) - Number(a.blockNumber));

    return NextResponse.json({ jackpots });
  } catch (err) {
    console.error("[api/jackpots] Error:", err);
    return NextResponse.json({ jackpots: [], error: "fetch failed" }, { status: 500 });
  }
}
