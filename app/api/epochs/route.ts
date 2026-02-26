import { NextResponse } from "next/server";

const FIREBASE_DB_URL =
  process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ||
  "https://lore-78751-default-rtdb.europe-west1.firebasedatabase.app";

export async function GET() {
  try {
    const [epochsRes, metaRes] = await Promise.all([
      fetch(`${FIREBASE_DB_URL}/gamedata/epochs.json`, { next: { revalidate: 10 } }),
      fetch(`${FIREBASE_DB_URL}/gamedata/_meta/currentEpoch.json`, { next: { revalidate: 10 } }),
    ]);
    if (!epochsRes.ok) {
      return NextResponse.json({ epochs: {} });
    }
    const raw = (await epochsRes.json()) ?? {};
    const currentEpoch = metaRes.ok ? Number(await metaRes.json()) : NaN;

    // If indexer wrote currentEpoch, only return epochs <= currentEpoch (exclude old contract data)
    const epochs =
      Number.isInteger(currentEpoch) && currentEpoch > 0
        ? Object.fromEntries(
            Object.entries(raw).filter(([key]) => {
              const n = Number(key);
              return Number.isInteger(n) && n >= 1 && n <= currentEpoch;
            }),
          )
        : raw;

    return NextResponse.json({ epochs });
  } catch (err) {
    console.error("[api/epochs] Error:", err);
    return NextResponse.json({ epochs: {}, error: "fetch failed" }, { status: 500 });
  }
}
