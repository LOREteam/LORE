import { NextResponse } from "next/server";

const FIREBASE_DB_URL =
  process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ||
  "https://lore-78751-default-rtdb.europe-west1.firebasedatabase.app";

export async function GET() {
  try {
    const res = await fetch(`${FIREBASE_DB_URL}/gamedata/epochs.json`, {
      next: { revalidate: 10 },
    });
    if (!res.ok) {
      return NextResponse.json({ epochs: {} });
    }
    const raw = await res.json();
    return NextResponse.json({ epochs: raw ?? {} });
  } catch (err) {
    console.error("[api/epochs] Error:", err);
    return NextResponse.json({ epochs: {}, error: "fetch failed" }, { status: 500 });
  }
}
