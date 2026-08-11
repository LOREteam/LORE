import assert from "node:assert/strict";
import * as chatAvatarUploadModule from "../app/lib/chatAvatarUpload.ts";
import * as chatAvatarModule from "../app/lib/chatAvatar.ts";
import * as chatMessagesModule from "../app/lib/chatMessages.ts";

export function runChatContentTests() {
  const chatAvatarUpload = chatAvatarUploadModule.default ?? chatAvatarUploadModule;
  assert.equal(
    chatAvatarUpload.validateCustomAvatarFile({ type: "text/plain", size: 42 }),
    "Use a JPG, PNG, GIF, or WEBP image.",
  );
  assert.equal(
    chatAvatarUpload.validateCustomAvatarFile({ type: "image/png", size: 5 * 1024 * 1024 + 1 }),
    "Image must be 5 MB or smaller.",
  );
  assert.equal(chatAvatarUpload.validateCustomAvatarFile({ type: "image/webp", size: 2048 }), null);

  const chatAvatar = chatAvatarModule.default ?? chatAvatarModule;
  const avatarPng = new Uint8Array(24);
  avatarPng.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  avatarPng[19] = 2;
  avatarPng[23] = 2;
  assert.equal(
    chatAvatar.isSupportedChatAvatarDataUrl(`data:image/png;base64,${Buffer.from(avatarPng).toString("base64")}`),
    true,
  );
  avatarPng[17] = 4;
  assert.equal(
    chatAvatar.isSupportedChatAvatarDataUrl(`data:image/png;base64,${Buffer.from(avatarPng).toString("base64")}`),
    false,
    "custom avatars must reject compressed images whose decoded dimensions exceed the render budget",
  );

  const chatMessages = chatMessagesModule.default ?? chatMessagesModule;
  assert.deepEqual(chatMessages.normalizeChatMessages("bad-shape"), []);
  assert.deepEqual(
    chatMessages.normalizeChatMessages([
      { id: "b", text: "second", sender: "0x2", senderName: 2, senderAvatar: "bad", timestamp: 2 },
      { id: "a", text: "first", sender: "0x1", senderName: "Lore", senderAvatar: null, timestamp: 1 },
      { id: "empty", text: "", sender: "0x3", timestamp: 3 },
      { id: "bad-time", text: "ignored", sender: "0x4", timestamp: "bad" },
    ]),
    [
      { id: "a", text: "first", sender: "0x1", senderName: "Lore", senderAvatar: null, timestamp: 1 },
      { id: "b", text: "second", sender: "0x2", senderName: null, senderAvatar: null, timestamp: 2 },
    ],
  );
}
