import { NextResponse } from "next/server";
import { verifyMessage } from "viem";
import { firebaseWriteUrl } from "../../_lib/dataBridge";

const MAX_TEXT_LENGTH = 280;
const MAX_NAME_LENGTH = 20;
const MAX_AVATAR_LENGTH = 8_000;

type ChatMessagePayload = {
  text?: unknown;
  sender?: unknown;
  senderName?: unknown;
  senderAvatar?: unknown;
  authAddress?: unknown;
  authMessage?: unknown;
  authSignature?: unknown;
};

function isAddress(value: unknown): value is `0x${string}` {
  return typeof value === "string" && /^0x[a-fA-F0-9]{40}$/.test(value);
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as ChatMessagePayload;
    const text = typeof body.text === "string" ? body.text.trim().slice(0, MAX_TEXT_LENGTH) : "";
    const sender = typeof body.sender === "string" ? body.sender.toLowerCase() : "";
    const authAddress = typeof body.authAddress === "string" ? body.authAddress.toLowerCase() : "";
    const authMessage = typeof body.authMessage === "string" ? body.authMessage : "";
    const authSignature = typeof body.authSignature === "string" ? body.authSignature : "";

    if (!text) {
      return NextResponse.json({ error: "Message text is required" }, { status: 400 });
    }
    if (!isAddress(sender) || !isAddress(authAddress) || sender !== authAddress) {
      return NextResponse.json({ error: "Invalid sender proof" }, { status: 400 });
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

    const senderName =
      typeof body.senderName === "string" ? body.senderName.trim().slice(0, MAX_NAME_LENGTH) : null;
    const senderAvatar =
      typeof body.senderAvatar === "string" && body.senderAvatar.length <= MAX_AVATAR_LENGTH
        ? body.senderAvatar
        : null;

    const payload: Record<string, unknown> = {
      text,
      sender,
      senderName,
      senderAvatar,
      timestamp: Date.now(),
    };

    const res = await fetch(firebaseWriteUrl("messages"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json({ error: `Firebase write failed: ${res.status}` }, { status: 502 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[api/chat/messages] Error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
