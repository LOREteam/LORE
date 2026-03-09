import { NextResponse } from "next/server";
import { verifyMessage } from "viem";
import { firebaseWriteUrl } from "../../_lib/dataBridge";

const MAX_NAME_LENGTH = 20;
const MAX_AVATAR_LENGTH = 8_000;

type ProfilePayload = {
  walletAddress?: unknown;
  name?: unknown;
  avatar?: unknown;
  customAvatar?: unknown;
  updatedAt?: unknown;
  authAddress?: unknown;
  authMessage?: unknown;
  authSignature?: unknown;
};

function isAddress(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json()) as ProfilePayload;
    const walletAddress = typeof body.walletAddress === "string" ? body.walletAddress.toLowerCase() : "";
    const authAddress = typeof body.authAddress === "string" ? body.authAddress.toLowerCase() : "";
    const authMessage = typeof body.authMessage === "string" ? body.authMessage : "";
    const authSignature = typeof body.authSignature === "string" ? body.authSignature : "";

    if (!isAddress(walletAddress) || !isAddress(authAddress) || walletAddress !== authAddress) {
      return NextResponse.json({ error: "Invalid profile proof" }, { status: 400 });
    }
    if (!/^0x[a-fA-F0-9]{130,}$/.test(authSignature)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }
    if (
      !authMessage.includes("LORE Chat Verification") ||
      !authMessage.toLowerCase().includes(`address: ${authAddress}`)
    ) {
      return NextResponse.json({ error: "Invalid auth message" }, { status: 400 });
    }

    const verified = await verifyMessage({
      address: authAddress,
      message: authMessage,
      signature: authSignature as `0x${string}`,
    });
    if (!verified) {
      return NextResponse.json({ error: "Signature verification failed" }, { status: 401 });
    }

    const payload = {
      name: typeof body.name === "string" ? body.name.trim().slice(0, MAX_NAME_LENGTH) : null,
      avatar:
        typeof body.avatar === "string" && body.avatar.length <= 120 ? body.avatar : null,
      customAvatar:
        typeof body.customAvatar === "string" && body.customAvatar.length <= MAX_AVATAR_LENGTH
          ? body.customAvatar
          : null,
      updatedAt: typeof body.updatedAt === "number" ? body.updatedAt : Date.now(),
    };

    const res = await fetch(firebaseWriteUrl(`gamedata/chatProfiles/${walletAddress}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({ error: `Firebase write failed: ${res.status}` }, { status: 502 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[api/chat/profile] Error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
