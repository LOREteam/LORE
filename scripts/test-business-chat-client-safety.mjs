import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as appShellStateModule from "../app/hooks/useAppShellState.ts";
import * as lineaOreClientViewPropsModule from "../app/lib/lineaOreClientViewProps.ts";
import * as indexerFinalityModule from "../app/lib/indexerFinality.ts";
import * as indexerWatchPolicyModule from "../app/lib/indexerWatchPolicy.ts";
import * as chatSessionClientModule from "../app/lib/chatSessionClient.ts";
import * as chatAuthModule from "../app/lib/chatAuth.ts";
import * as chatAuthRuntimeModule from "../app/lib/chatAuthRuntime.ts";
import * as chatSessionModule from "../app/api/_lib/chatSession.ts";
import * as chatSendStateModule from "../app/lib/chatSendState.ts";
import * as chatRuntimePolicyModule from "../app/lib/chatRuntimePolicy.ts";
import * as chatProfileRuntimeModule from "../app/lib/chatProfileRuntime.ts";
import * as chatWalletRuntimeModule from "../app/lib/chatWalletRuntime.ts";
import * as chatProfileReadPolicyModule from "../app/api/chat/profile/readPolicy.ts";
import * as chatProfileModalModule from "../app/components/chat/ChatProfileModal.tsx";
import * as chatWindowModule from "../app/components/chat/ChatWindow.tsx";
import * as headerWalletCardModule from "../app/components/header/HeaderWalletCard.tsx";

function listSourceFiles(root, sourceFilePattern = /\.(?:ts|tsx|mjs)$/) {
  const entries = readdirSync(root, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return listSourceFiles(path, sourceFilePattern);
    return sourceFilePattern.test(entry.name) ? [path] : [];
  });
}

const indexerFinality = indexerFinalityModule.default ?? indexerFinalityModule;
const indexerWatchPolicy = indexerWatchPolicyModule.default ?? indexerWatchPolicyModule;
const chatSessionClient = chatSessionClientModule.default ?? chatSessionClientModule;
const chatAuth = chatAuthModule.default ?? chatAuthModule;
const chatAuthRuntime = chatAuthRuntimeModule.default ?? chatAuthRuntimeModule;
const chatSession = chatSessionModule.default ?? chatSessionModule;
const chatSendState = chatSendStateModule.default ?? chatSendStateModule;
const chatRuntimePolicy = chatRuntimePolicyModule.default ?? chatRuntimePolicyModule;
const chatProfileRuntime = chatProfileRuntimeModule.default ?? chatProfileRuntimeModule;
const chatWalletRuntime = chatWalletRuntimeModule.default ?? chatWalletRuntimeModule;
const chatProfileReadPolicy = chatProfileReadPolicyModule.default ?? chatProfileReadPolicyModule;
const chatProfileModal = chatProfileModalModule.default ?? chatProfileModalModule;
const chatWindow = chatWindowModule.default ?? chatWindowModule;
const headerWalletCard = headerWalletCardModule.default ?? headerWalletCardModule;

const CHAT_PROFILE_ADDRESS_A = "0x1111111111111111111111111111111111111111";
const CHAT_PROFILE_ADDRESS_B = "0x2222222222222222222222222222222222222222";
const CHAT_PROFILE_ADDRESS_C = "0x3333333333333333333333333333333333333333";

function uppercaseHexAddress(address) {
  return `0x${address.slice(2).toUpperCase()}`;
}

function assertChatProfileReadScopePolicy(candidate) {
  assert.deepEqual(candidate(null, null), {
    ok: false,
    error: "walletAddress or walletAddresses is required",
  });
  assert.deepEqual(candidate(" 0x1111111111111111111111111111111111111111 ", null), {
    ok: true,
    kind: "single",
    walletAddress: CHAT_PROFILE_ADDRESS_A,
  });
  assert.deepEqual(candidate("0x1234", null), {
    ok: false,
    error: "Invalid walletAddress",
  });
  assert.deepEqual(
    candidate(null, `${CHAT_PROFILE_ADDRESS_A}, ${CHAT_PROFILE_ADDRESS_A},${CHAT_PROFILE_ADDRESS_B}`),
    {
      ok: true,
      kind: "batch",
      walletAddresses: [CHAT_PROFILE_ADDRESS_A, CHAT_PROFILE_ADDRESS_B],
    },
  );
  assert.deepEqual(candidate(null, ""), {
    ok: false,
    error: "Invalid walletAddresses",
  });
  assert.deepEqual(candidate(null, " , , "), {
    ok: false,
    error: "Invalid walletAddresses",
  });
  assert.deepEqual(candidate(null, `${CHAT_PROFILE_ADDRESS_A},0x1234`), {
    ok: false,
    error: "Invalid walletAddresses",
  });

  const oneHundredAddresses = Array.from(
    { length: chatProfileReadPolicy.MAX_REQUESTED_CHAT_PROFILE_WALLETS },
    () => CHAT_PROFILE_ADDRESS_A,
  ).join(",");
  assert.deepEqual(candidate(null, oneHundredAddresses), {
    ok: true,
    kind: "batch",
    walletAddresses: [CHAT_PROFILE_ADDRESS_A],
  });
  assert.deepEqual(candidate(null, `${oneHundredAddresses},${CHAT_PROFILE_ADDRESS_B}`), {
    ok: false,
    error: "Too many walletAddresses",
  });

  assert.deepEqual(candidate(CHAT_PROFILE_ADDRESS_A, "0x1234"), {
    ok: true,
    kind: "single",
    walletAddress: CHAT_PROFILE_ADDRESS_A,
  });
  assert.deepEqual(candidate(CHAT_PROFILE_ADDRESS_A, ""), {
    ok: false,
    error: "Invalid walletAddresses",
  });
}

export function runChatProfileReadScopeTests() {
  assertChatProfileReadScopePolicy(chatProfileReadPolicy.parseChatProfileReadScope);
  const overLimitBatch = Array.from(
    { length: chatProfileReadPolicy.MAX_REQUESTED_CHAT_PROFILE_WALLETS + 1 },
    () => CHAT_PROFILE_ADDRESS_A,
  ).join(",");
  let overLimitNormalizerCalls = 0;
  assert.deepEqual(
    chatProfileReadPolicy.parseChatProfileReadScope(null, overLimitBatch, () => {
      overLimitNormalizerCalls += 1;
      return CHAT_PROFILE_ADDRESS_A;
    }),
    { ok: false, error: "Too many walletAddresses" },
  );
  assert.equal(
    overLimitNormalizerCalls,
    0,
    "over-limit profile batches must fail before attacker-controlled normalization work",
  );

  assert.throws(
    () => assertChatProfileReadScopePolicy((walletAddress, walletAddressesParam) => {
      if (walletAddressesParam?.split(",").filter(Boolean).length === 101) {
        return chatProfileReadPolicy.parseChatProfileReadScope(
          walletAddress,
          walletAddressesParam.split(",").slice(0, 100).join(","),
        );
      }
      return chatProfileReadPolicy.parseChatProfileReadScope(walletAddress, walletAddressesParam);
    }),
    /Expected values to be strictly deep-equal/,
    "silent batch truncation mutant must be killed",
  );
  assert.throws(
    () => assertChatProfileReadScopePolicy((walletAddress, walletAddressesParam) => {
      const result = chatProfileReadPolicy.parseChatProfileReadScope(walletAddress, walletAddressesParam);
      return result.ok || result.error !== "Invalid walletAddresses" || !walletAddressesParam
        ? result
        : { ok: true, kind: "batch", walletAddresses: [String(walletAddressesParam).toLowerCase()] };
    }),
    /Expected values to be strictly deep-equal/,
    "unchecked batch-address normalization mutant must be killed",
  );
  assert.throws(
    () => assertChatProfileReadScopePolicy((walletAddress, walletAddressesParam) => {
      const result = chatProfileReadPolicy.parseChatProfileReadScope(walletAddress, walletAddressesParam);
      return !result.ok && result.error === "walletAddress or walletAddresses is required"
        ? { ok: true, kind: "batch", walletAddresses: [] }
        : result;
    }),
    /Expected values to be strictly deep-equal/,
    "implicit list-all fallback mutant must be killed",
  );
  assert.throws(
    () => assertChatProfileReadScopePolicy((walletAddress, walletAddressesParam) => {
      const result = chatProfileReadPolicy.parseChatProfileReadScope(walletAddress, walletAddressesParam);
      if (result.ok && result.kind === "batch" && walletAddressesParam?.includes(",")) {
        return {
          ...result,
          walletAddresses: walletAddressesParam.split(",").map((value) => value.trim()),
        };
      }
      return result;
    }),
    /Expected values to be strictly deep-equal/,
    "missing batch de-duplication mutant must be killed",
  );
}

function createChatProfileStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  const writes = [];
  const removals = [];
  return {
    values,
    writes,
    removals,
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      writes.push({ key, value });
      values.set(key, value);
    },
    removeItem(key) {
      removals.push(key);
      values.delete(key);
    },
  };
}

async function assertChatProfileRuntimeBehavior(runtime) {
  const keyA = `${runtime.CHAT_PROFILE_STORAGE_KEY_PREFIX}${CHAT_PROFILE_ADDRESS_A}`;
  const keyB = `${runtime.CHAT_PROFILE_STORAGE_KEY_PREFIX}${CHAT_PROFILE_ADDRESS_B}`;
  assert.equal(
    runtime.getChatProfileStorageKey(` ${uppercaseHexAddress(CHAT_PROFILE_ADDRESS_A)} `),
    keyA,
    "chat profile cache keys must use the canonical wallet address",
  );
  assert.equal(
    runtime.getChatProfileStorageKey("0x1234"),
    runtime.CHAT_PROFILE_LEGACY_STORAGE_KEY,
    "invalid wallet addresses must not create a wallet-scoped cache key",
  );

  const currentStorage = createChatProfileStorage({
    [keyA]: JSON.stringify({
      name: "  Twenty-character-naME-overflow ",
      avatar: "miner-helmet",
      customAvatar: "not-an-image",
      updatedAt: Number.NaN,
    }),
    unrelated: "preserve",
  });
  assert.deepEqual(runtime.readChatProfileCache(currentStorage, CHAT_PROFILE_ADDRESS_A), {
    name: "Twenty-character-naME".slice(0, runtime.CHAT_PROFILE_NAME_MAX),
    avatar: "miner-helmet",
    customAvatar: null,
    updatedAt: 0,
  });
  assert.equal(currentStorage.values.get("unrelated"), "preserve");

  const corruptCurrentStorage = createChatProfileStorage({
    [keyA]: "{",
    [runtime.CHAT_PROFILE_LEGACY_STORAGE_KEY]: JSON.stringify({ name: "Legacy" }),
    unrelated: "preserve",
  });
  assert.deepEqual(
    runtime.readChatProfileCache(corruptCurrentStorage, CHAT_PROFILE_ADDRESS_A),
    runtime.emptyChatProfile(),
    "a corrupt wallet-scoped profile must fail closed instead of falling back across scopes",
  );
  assert.deepEqual(corruptCurrentStorage.removals, [keyA]);
  assert.equal(corruptCurrentStorage.values.has(runtime.CHAT_PROFILE_LEGACY_STORAGE_KEY), true);
  assert.equal(corruptCurrentStorage.values.get("unrelated"), "preserve");

  const legacyStorage = createChatProfileStorage({
    [runtime.CHAT_PROFILE_LEGACY_STORAGE_KEY]: JSON.stringify({
      name: " Legacy Miner ",
      avatar: "crossed-picks",
      customAvatar: null,
      updatedAt: 42,
    }),
    unrelated: "preserve",
  });
  const migrated = runtime.readChatProfileCache(legacyStorage, CHAT_PROFILE_ADDRESS_A);
  assert.deepEqual(migrated, {
    name: "Legacy Miner",
    avatar: "crossed-picks",
    customAvatar: null,
    updatedAt: 42,
  });
  assert.deepEqual(JSON.parse(legacyStorage.values.get(keyA)), migrated);
  assert.equal(
    legacyStorage.values.has(runtime.CHAT_PROFILE_LEGACY_STORAGE_KEY),
    false,
    "successful legacy migration must consume the global key exactly once",
  );
  assert.deepEqual(
    runtime.readChatProfileCache(legacyStorage, CHAT_PROFILE_ADDRESS_B),
    runtime.emptyChatProfile(),
    "one wallet's migrated legacy profile must not restore into another wallet",
  );
  assert.equal(legacyStorage.values.has(keyB), false);
  assert.equal(legacyStorage.values.get("unrelated"), "preserve");

  const failedMigrationStorage = createChatProfileStorage({
    [runtime.CHAT_PROFILE_LEGACY_STORAGE_KEY]: JSON.stringify({ name: "Legacy" }),
  });
  failedMigrationStorage.setItem = () => {
    throw new Error("quota");
  };
  assert.deepEqual(
    runtime.readChatProfileCache(failedMigrationStorage, CHAT_PROFILE_ADDRESS_A),
    runtime.emptyChatProfile(),
    "failed wallet-scoped publication must fail closed",
  );
  assert.equal(
    failedMigrationStorage.values.has(runtime.CHAT_PROFILE_LEGACY_STORAGE_KEY),
    false,
    "failed publication must not leave a globally reusable legacy profile",
  );
  assert.equal(failedMigrationStorage.values.has(keyA), false);

  const corruptLegacyStorage = createChatProfileStorage({
    [runtime.CHAT_PROFILE_LEGACY_STORAGE_KEY]: "[]",
    unrelated: "preserve",
  });
  assert.deepEqual(
    runtime.readChatProfileCache(corruptLegacyStorage, CHAT_PROFILE_ADDRESS_A),
    runtime.emptyChatProfile(),
  );
  assert.deepEqual(corruptLegacyStorage.removals, [runtime.CHAT_PROFILE_LEGACY_STORAGE_KEY]);
  assert.equal(corruptLegacyStorage.values.get("unrelated"), "preserve");

  const persistedStorage = createChatProfileStorage();
  runtime.persistChatProfileCache(persistedStorage, uppercaseHexAddress(CHAT_PROFILE_ADDRESS_B), migrated);
  assert.deepEqual(persistedStorage.writes, [{ key: keyB, value: JSON.stringify(migrated) }]);

  let invalidFetchCalls = 0;
  assert.equal(
    await runtime.fetchRemoteChatProfile("0x1234", async () => {
      invalidFetchCalls += 1;
      throw new Error("must not run");
    }),
    null,
  );
  assert.equal(invalidFetchCalls, 0);

  const fetchCalls = [];
  const fetched = await runtime.fetchRemoteChatProfile(
    ` ${uppercaseHexAddress(CHAT_PROFILE_ADDRESS_A)} `,
    async (input, init) => {
      fetchCalls.push({ input: String(input), init });
      return new Response(JSON.stringify({ profile: { name: " Remote ", avatar: "miner-helmet", updatedAt: 7 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  );
  assert.deepEqual(fetchCalls, [{
    input: `/api/chat/profile?walletAddress=${CHAT_PROFILE_ADDRESS_A}`,
    init: { cache: "no-store" },
  }]);
  assert.deepEqual(fetched, {
    name: "Remote",
    avatar: "miner-helmet",
    customAvatar: null,
    updatedAt: 7,
  });

  const saveCalls = [];
  await runtime.saveRemoteChatProfile(
    ` ${uppercaseHexAddress(CHAT_PROFILE_ADDRESS_B)} `,
    { name: "Miner", avatar: null, customAvatar: null },
    {
      now: () => 123,
      fetcher: async (input, init) => {
        saveCalls.push({ input: String(input), init });
        return new Response(null, { status: 204 });
      },
    },
  );
  assert.equal(saveCalls.length, 1);
  assert.equal(saveCalls[0].input, "/api/chat/profile");
  assert.equal(saveCalls[0].init.method, "PUT");
  assert.deepEqual(saveCalls[0].init.headers, { "Content-Type": "application/json" });
  assert.deepEqual(JSON.parse(saveCalls[0].init.body), {
    walletAddress: CHAT_PROFILE_ADDRESS_B,
    name: "Miner",
    avatar: null,
    customAvatar: null,
    updatedAt: 123,
  });

  let oversizedBodyReads = 0;
  await assert.rejects(
    runtime.saveRemoteChatProfile(CHAT_PROFILE_ADDRESS_A, migrated, {
      fetcher: async () => ({
        ok: false,
        status: 500,
        headers: new Headers({
          "Content-Type": "application/json",
          "Content-Length": String(2 * 1024 * 1024 + 1),
        }),
        body: {
          getReader() {
            oversizedBodyReads += 1;
            throw new Error("oversized body must not be read");
          },
        },
      }),
    }),
    (error) => error instanceof Error && error.message === "HTTP 500",
    "profile save failures must remain bounded and must not expose server response text",
  );
  assert.equal(oversizedBodyReads, 0, "oversized profile errors must reject before body consumption");
}

export async function runChatProfileRuntimeTests() {
  await assertChatProfileRuntimeBehavior(chatProfileRuntime);
  await assert.rejects(
    assertChatProfileRuntimeBehavior({
      ...chatProfileRuntime,
      readChatProfileCache(storage, walletAddress) {
        const value = chatProfileRuntime.readChatProfileCache(storage, walletAddress);
        if (walletAddress && value.name) {
          storage.setItem(chatProfileRuntime.CHAT_PROFILE_LEGACY_STORAGE_KEY, JSON.stringify(value));
        }
        return value;
      },
    }),
    /successful legacy migration must consume the global key exactly once/,
    "non-consuming legacy migration mutant must be killed",
  );
  await assert.rejects(
    assertChatProfileRuntimeBehavior({
      ...chatProfileRuntime,
      getChatProfileStorageKey(walletAddress) {
        return `${chatProfileRuntime.CHAT_PROFILE_STORAGE_KEY_PREFIX}${String(walletAddress).trim().toLowerCase()}`;
      },
    }),
    /invalid wallet addresses must not create a wallet-scoped cache key/,
    "unchecked wallet-key normalization mutant must be killed",
  );
}

function assertChatWalletRuntimeBehavior(runtime) {
  assert.equal(runtime.normalizeChatWalletCandidate("0x1234"), null);
  assert.equal(
    runtime.normalizeChatWalletCandidate(` ${uppercaseHexAddress(CHAT_PROFILE_ADDRESS_A)} `),
    CHAT_PROFILE_ADDRESS_A,
  );
  assert.deepEqual(
    runtime.normalizeChatWalletCandidates([
      null,
      "0x1234",
      CHAT_PROFILE_ADDRESS_A,
      uppercaseHexAddress(CHAT_PROFILE_ADDRESS_A),
      CHAT_PROFILE_ADDRESS_B,
    ]),
    [CHAT_PROFILE_ADDRESS_A, CHAT_PROFILE_ADDRESS_B],
    "chat wallet candidates must be canonical, valid, ordered, and de-duplicated",
  );

  const storedCandidate = createChatProfileStorage({
    [runtime.CHAT_WALLET_STORAGE_KEY]: uppercaseHexAddress(CHAT_PROFILE_ADDRESS_B),
  });
  assert.equal(
    runtime.selectStableChatWalletAddress(
      storedCandidate,
      [CHAT_PROFILE_ADDRESS_A, CHAT_PROFILE_ADDRESS_B],
    ),
    CHAT_PROFILE_ADDRESS_B,
  );
  assert.deepEqual(storedCandidate.removals, []);
  assert.equal(
    runtime.selectStableChatWalletAddress(
      storedCandidate,
      [CHAT_PROFILE_ADDRESS_A, CHAT_PROFILE_ADDRESS_B],
      CHAT_PROFILE_ADDRESS_A,
    ),
    CHAT_PROFILE_ADDRESS_A,
    "an active allowed address must remain stable without a storage override",
  );

  const staleCandidate = createChatProfileStorage({
    [runtime.CHAT_WALLET_STORAGE_KEY]: CHAT_PROFILE_ADDRESS_C,
    unrelated: "preserve",
  });
  assert.equal(
    runtime.selectStableChatWalletAddress(
      staleCandidate,
      [CHAT_PROFILE_ADDRESS_A, CHAT_PROFILE_ADDRESS_B],
    ),
    CHAT_PROFILE_ADDRESS_A,
  );
  assert.deepEqual(staleCandidate.removals, [runtime.CHAT_WALLET_STORAGE_KEY]);
  assert.equal(staleCandidate.values.get("unrelated"), "preserve");

  const failingRead = createChatProfileStorage();
  failingRead.getItem = () => {
    throw new Error("private mode");
  };
  assert.equal(
    runtime.selectStableChatWalletAddress(failingRead, [CHAT_PROFILE_ADDRESS_A]),
    CHAT_PROFILE_ADDRESS_A,
    "storage read failures must fall back to the first valid runtime candidate",
  );
  assert.deepEqual(failingRead.removals, [runtime.CHAT_WALLET_STORAGE_KEY]);
  assert.equal(runtime.selectStableChatWalletAddress(null, []), null);

  const persisted = createChatProfileStorage({ unrelated: "preserve" });
  runtime.persistStableChatWalletAddress(persisted, uppercaseHexAddress(CHAT_PROFILE_ADDRESS_B));
  assert.deepEqual(persisted.writes, [{
    key: runtime.CHAT_WALLET_STORAGE_KEY,
    value: CHAT_PROFILE_ADDRESS_B,
  }]);
  runtime.persistStableChatWalletAddress(persisted, null);
  assert.deepEqual(persisted.removals, [runtime.CHAT_WALLET_STORAGE_KEY]);
  assert.equal(persisted.values.get("unrelated"), "preserve");

  assert.equal(
    runtime.isOwnChatMessageSender(
      uppercaseHexAddress(CHAT_PROFILE_ADDRESS_A),
      CHAT_PROFILE_ADDRESS_A,
    ),
    true,
  );
  assert.equal(runtime.isOwnChatMessageSender(CHAT_PROFILE_ADDRESS_B, CHAT_PROFILE_ADDRESS_A), false);
  assert.equal(runtime.isOwnChatMessageSender("0x1234", null), false);
  assert.equal(runtime.isOwnChatMessageSender(null, null), false);
  assert.equal(
    runtime.countOtherChatMessages(
      [
        { sender: CHAT_PROFILE_ADDRESS_A },
        { sender: uppercaseHexAddress(CHAT_PROFILE_ADDRESS_A) },
        { sender: CHAT_PROFILE_ADDRESS_B },
        { sender: "0x1234" },
      ],
      CHAT_PROFILE_ADDRESS_A,
    ),
    2,
    "unread identity must count different and malformed senders but not canonical own messages",
  );
}

export function runChatWalletRuntimeTests() {
  assertChatWalletRuntimeBehavior(chatWalletRuntime);
  assert.throws(
    () => assertChatWalletRuntimeBehavior({
      ...chatWalletRuntime,
      normalizeChatWalletCandidate(address) {
        return typeof address === "string" && address.trim()
          ? address.trim().toLowerCase()
          : null;
      },
    }),
    /Expected values to be strictly equal/,
    "unchecked wallet candidate mutant must be killed",
  );
  assert.throws(
    () => assertChatWalletRuntimeBehavior({
      ...chatWalletRuntime,
      isOwnChatMessageSender(sender, walletAddress) {
        return String(sender ?? "").toLowerCase() === String(walletAddress ?? "").toLowerCase();
      },
    }),
    /Expected values to be strictly equal/,
    "empty or malformed sender ownership mutant must be killed",
  );
  assert.throws(
    () => assertChatWalletRuntimeBehavior({
      ...chatWalletRuntime,
      selectStableChatWalletAddress(_storage, candidates, currentAddress = null) {
        return chatWalletRuntime.normalizeChatWalletCandidate(currentAddress) ?? candidates[0] ?? null;
      },
    }),
    /Expected values to be strictly equal|Expected values to be strictly deep-equal/,
    "stale stored wallet cleanup mutant must be killed",
  );
}

function createCookieJar() {
  const values = new Map();
  const writes = [];
  return {
    values,
    writes,
    request: {
      cookies: {
        get: (name) => values.has(name) ? { value: values.get(name) } : undefined,
      },
    },
    response: {
      cookies: {
        set: (name, value, options) => {
          writes.push({ name, value, options });
          values.set(name, value);
        },
      },
    },
  };
}

function decodeChatSessionToken(token) {
  const encoded = token.split(".", 1)[0];
  return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
}

function mutateChatSessionToken(token, mutation) {
  const [encoded, signature] = token.split(".");
  const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  return `${Buffer.from(JSON.stringify(mutation(payload)), "utf8").toString("base64url")}.${signature}`;
}

function createChatMessage(id, timestamp, text = id) {
  return {
    id,
    text,
    sender: "0x1111111111111111111111111111111111111111",
    senderName: null,
    senderAvatar: null,
    timestamp,
  };
}

function createMemoryStorage(initialEntries = {}) {
  const values = new Map(Object.entries(initialEntries));
  const removed = [];
  const written = [];
  return {
    values,
    removed,
    written,
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => {
      removed.push(key);
      values.delete(key);
    },
    setItem: (key, value) => {
      written.push([key, value]);
      values.set(key, value);
    },
  };
}

function findButtonTag(markup, attribute) {
  const tag = [...markup.matchAll(/<button\b[^>]*>/g)]
    .map(([value]) => value)
    .find((value) => value.includes(attribute));
  assert.ok(tag, `rendered chat profile must contain button ${attribute}`);
  return tag;
}

function findTag(markup, tagName, attribute) {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>`, "g");
  const tag = [...markup.matchAll(pattern)]
    .map(([value]) => value)
    .find((value) => value.includes(attribute));
  assert.ok(tag, `rendered chat UI must contain ${tagName} ${attribute}`);
  return tag;
}

function renderChatProfileModal(avatar) {
  return renderToStaticMarkup(React.createElement(chatProfileModal.ChatProfileModal, {
    profile: { name: "Miner", avatar, customAvatar: null },
    walletAddress: CHAT_PROFILE_ADDRESS_A,
    onSave: () => undefined,
    onClose: () => undefined,
  }));
}

function renderChatWindow(connected) {
  return renderToStaticMarkup(React.createElement(chatWindow.ChatWindow, {
    messages: [],
    walletAddress: CHAT_PROFILE_ADDRESS_A,
    profile: { name: "Miner", avatar: null, customAvatar: null },
    displayName: "Miner",
    connected,
    authReady: true,
    onEnsureAuth: async () => true,
    sendCooldownRemainingMs: 0,
    isSending: false,
    onSend: async () => true,
    onUpdateProfile: () => undefined,
    onClose: () => undefined,
    variant: "embedded",
  }));
}

function renderHeaderWalletCard(overrides = {}) {
  return renderToStaticMarkup(React.createElement(headerWalletCard.HeaderWalletCard, {
    authenticated: true,
    loginState: {
      busy: false,
      buttonText: "Login / Connect",
      disabled: true,
      error: null,
      modalOpen: false,
      statusAnnouncement: "Wallet connected.",
    },
    embeddedWalletAddress: CHAT_PROFILE_ADDRESS_A,
    embeddedWalletSyncing: false,
    embeddedAddressCopied: false,
    onCopyEmbeddedAddress: () => undefined,
    onLogin: () => undefined,
    onLogout: () => undefined,
    onOpenWalletSettings: () => undefined,
    privyEthBalance: "1.25",
    privyEthBalanceLoading: false,
    privyTokenBalance: "42",
    privyTokenBalanceLoading: false,
    ...overrides,
  }));
}

function assertConnectedHeaderWalletMarkup(markup) {
  assert.match(markup, /role="group"[^>]*aria-label="Wallet account"/);
  assert.match(
    findButtonTag(markup, 'aria-label="Copy Privy wallet address"'),
    /type="button"[^>]*title="Copy address"|title="Copy address"[^>]*type="button"/,
  );
  const explorerLink = markup
    .match(/<a\b[^>]*aria-label="Open Privy wallet address in explorer"[^>]*>/)?.[0];
  assert.ok(explorerLink, "connected wallet must render its explorer action");
  assert.match(explorerLink, /href="https:\/\/sepolia\.lineascan\.build\/address\/0x1111/);
  assert.match(explorerLink, /target="_blank"/);
  assert.match(explorerLink, /rel="noopener noreferrer"/);
  assert.match(markup, />1\.25<span[^>]*> ETH<\/span>/);
  assert.match(markup, />42<span[^>]*> LINEA<\/span>/);
}

export function runHeaderWalletCardBehaviorTests() {
  const connected = renderHeaderWalletCard();
  assertConnectedHeaderWalletMarkup(connected);

  const copied = renderHeaderWalletCard({ embeddedAddressCopied: true });
  assert.match(
    findButtonTag(copied, 'aria-label="Privy wallet address copied"'),
    /type="button"[^>]*title="Copied"|title="Copied"[^>]*type="button"/,
  );
  assert.doesNotMatch(copied, /aria-label="Copy Privy wallet address"/);

  const invalidAddress = renderHeaderWalletCard({ embeddedWalletAddress: "private-rpc-token" });
  assert.doesNotMatch(invalidAddress, /Open Privy wallet address in explorer|target="_blank"/);

  const login = renderHeaderWalletCard({
    authenticated: false,
    embeddedWalletAddress: null,
    loginState: {
      busy: true,
      buttonText: "Connecting...",
      disabled: true,
      error: null,
      modalOpen: true,
      statusAnnouncement: "Wallet login dialog is open.",
    },
  });
  assert.match(login, /role="group"[^>]*aria-label="Wallet login"/);
  const loginButton = findButtonTag(login, 'aria-label="Login or connect wallet"');
  assert.match(loginButton, /type="button"/);
  assert.match(loginButton, /aria-describedby="header-privy-login-status"/);
  assert.match(loginButton, /aria-haspopup="dialog"/);
  assert.match(loginButton, /aria-expanded="true"/);
  assert.match(loginButton, /aria-busy="true"/);
  assert.match(loginButton, /disabled=""/);
  assert.match(login, /role="status"[^>]*aria-live="polite"[^>]*aria-atomic="true"/);

  const syncing = renderHeaderWalletCard({ embeddedWalletAddress: null, embeddedWalletSyncing: true });
  assert.match(syncing, />Syncing</);
  assert.match(syncing, /Restoring embedded wallet session\.\.\./);
  const notCreated = renderHeaderWalletCard({ embeddedWalletAddress: null });
  assert.match(notCreated, />Not created</);
  assert.match(notCreated, /Create embedded wallet in Settings to play and receive rewards\./);

  assert.throws(
    () => assertConnectedHeaderWalletMarkup(connected.replace(' rel="noopener noreferrer"', "")),
    /noopener noreferrer/,
    "missing new-tab isolation mutant must be killed",
  );
  assert.throws(
    () => assertConnectedHeaderWalletMarkup(
      connected.replace('aria-label="Copy Privy wallet address"', 'aria-label="Wallet"'),
    ),
    /must contain button aria-label="Copy Privy wallet address"/,
    "generic copy-label mutant must be killed",
  );
}

export async function runChatAndClientSafetyTests() {
  const useChatSource = readFileSync("app/hooks/useChat.ts", "utf8");
  assert.deepEqual(chatRuntimePolicy.createChatSendCooldown(1_500, 10_000), {
    startedAt: 10_000,
    cooldownUntil: 11_500,
    remainingMs: 1_500,
  });
  assert.equal(chatRuntimePolicy.getChatSendCooldownRemaining(11_500, 10_250), 1_250);
  assert.equal(chatRuntimePolicy.getChatSendCooldownRemaining(11_500, 12_000), 0);

  const warningRef = { current: 0 };
  const warnings = [];
  const warningSink = (...args) => warnings.push(args);
  const hostileWarning = new Error("secret rpc diagnostic 0xdeadbeef");
  assert.equal(
    chatRuntimePolicy.warnChatNetworkOnce("poll_failed", warningRef, hostileWarning, 15_000, warningSink),
    true,
  );
  assert.deepEqual(warnings, [["Chat", "poll_failed", hostileWarning]]);
  assert.equal(
    chatRuntimePolicy.warnChatNetworkOnce("poll_failed", warningRef, hostileWarning, 29_999, warningSink),
    false,
  );
  assert.equal(warnings.length, 1);
  assert.equal(
    chatRuntimePolicy.warnChatNetworkOnce("poll_failed", warningRef, hostileWarning, 30_000, warningSink),
    true,
  );
  assert.equal(warnings.length, 2);

  assert.equal(
    chatRuntimePolicy.createOptimisticMessageId(
      42,
      {
        randomUUID: () => "uuid-priority",
        getRandomValues: () => { throw new Error("getRandomValues must not run"); },
      },
      () => { throw new Error("Math.random fallback must not run"); },
    ),
    "local:42:uuid-priority",
  );
  assert.equal(
    chatRuntimePolicy.createOptimisticMessageId(
      43,
      { getRandomValues: (bytes) => { bytes.fill(0xab); return bytes; } },
      () => { throw new Error("Math.random fallback must not run"); },
    ),
    `local:43:${"ab".repeat(12)}`,
  );
  assert.equal(
    chatRuntimePolicy.createOptimisticMessageId(44, {}, () => 0.5),
    `local:44:${(0.5).toString(36).slice(2)}`,
  );

  const malformedChatCache = createMemoryStorage({
    [chatRuntimePolicy.CHAT_CACHE_KEY]: "{malformed",
    unrelated: "preserve",
  });
  assert.deepEqual(chatRuntimePolicy.readChatMessageCache(malformedChatCache), []);
  assert.deepEqual(malformedChatCache.removed, [chatRuntimePolicy.CHAT_CACHE_KEY]);
  assert.equal(malformedChatCache.values.get("unrelated"), "preserve");
  const persistedChatCache = createMemoryStorage();
  chatRuntimePolicy.persistChatMessageCache(
    persistedChatCache,
    Array.from({ length: 105 }, (_, index) => createChatMessage(`server:${index}`, index)),
  );
  const persistedMessages = JSON.parse(persistedChatCache.values.get(chatRuntimePolicy.CHAT_CACHE_KEY));
  assert.equal(persistedMessages.length, 100);
  assert.equal(persistedMessages[0].timestamp, 5);
  assert.equal(persistedMessages.at(-1).timestamp, 104);
  assert.deepEqual(
    [
      /createChatSendCooldown\(durationMs, now\)/.test(useChatSource),
      [...useChatSource.matchAll(/getChatSendCooldownRemaining\(sendCooldownUntilRef\.current,/g)].length,
      /applyChatNetworkWarning[\s\S]*log\.warn\(scope, warningTag, error\)/.test(useChatSource),
      /return readChatMessageCache\(localStorage\)/.test(useChatSource),
      /persistChatMessageCache\(localStorage, messages\)/.test(useChatSource),
      /id: createOptimisticMessageId\(now\)/.test(useChatSource),
    ],
    [true, 3, true, true, true, true],
    "useChat must remain bound to the behavior-tested cooldown, warning, cache, and entropy policies",
  );
  const appShellState = appShellStateModule.default ?? appShellStateModule;
  assert.deepEqual(appShellState.normalizeCachedHotTile({ tileId: 7, wins: "3" }), { tileId: 7, wins: 3 });
  assert.deepEqual(
    appShellState.normalizeCachedHotTile({ tileId: "25", wins: "9007199254740991" }),
    { tileId: 25, wins: Number.MAX_SAFE_INTEGER },
  );
  assert.equal(appShellState.normalizeCachedHotTile({ tileId: 0, wins: 1 }), null);
  assert.equal(appShellState.normalizeCachedHotTile({ tileId: 26, wins: 1 }), null);
  assert.equal(appShellState.normalizeCachedHotTile({ tileId: "1.5", wins: 1 }), null);
  assert.equal(appShellState.normalizeCachedHotTile({ tileId: "1e2", wins: 1 }), null);
  assert.equal(appShellState.normalizeCachedHotTile({ tileId: 1, wins: " 2" }), null);
  assert.equal(appShellState.normalizeCachedHotTile({ tileId: 1, wins: "9007199254740992" }), null);
  assert.equal(appShellState.normalizeCachedHotTile({ tileId: 1, wins: "9999999999999999" }), null);
  assert.equal(appShellState.normalizeCachedHotTile({ tileId: 1, wins: Number.MAX_SAFE_INTEGER + 1 }), null);
  const appShellStateSource = readFileSync("app/hooks/useAppShellState.ts", "utf8");
  const validTabStorage = createMemoryStorage({
    [appShellState.ACTIVE_TAB_STORAGE_KEY]: "faq",
  });
  assert.equal(appShellState.readSavedAppShellTab(validTabStorage), "faq");
  assert.deepEqual(validTabStorage.removed, []);

  const invalidTabStorage = createMemoryStorage({
    [appShellState.ACTIVE_TAB_STORAGE_KEY]: "admin",
    unrelated: "preserve",
  });
  assert.equal(appShellState.readSavedAppShellTab(invalidTabStorage), null);
  assert.deepEqual(invalidTabStorage.removed, [appShellState.ACTIVE_TAB_STORAGE_KEY]);
  assert.equal(invalidTabStorage.values.get("unrelated"), "preserve");

  const cachedTileStorage = createMemoryStorage({
    [appShellState.HOT_TILES_STORAGE_KEY]: JSON.stringify([
      { tileId: "1", wins: "2" },
      { tileId: 0, wins: 3 },
      { tileId: 2, wins: 4 },
      { tileId: 3, wins: 5 },
      { tileId: 4, wins: 6 },
      { tileId: 5, wins: 7 },
      { tileId: 6, wins: 8 },
    ]),
  });
  assert.deepEqual(appShellState.readCachedAppShellHotTiles(cachedTileStorage), [
    { tileId: 1, wins: 2 },
    { tileId: 2, wins: 4 },
    { tileId: 3, wins: 5 },
    { tileId: 4, wins: 6 },
    { tileId: 5, wins: 7 },
  ]);
  assert.deepEqual(cachedTileStorage.removed, []);

  const malformedTileStorage = createMemoryStorage({
    [appShellState.HOT_TILES_STORAGE_KEY]: "{malformed",
    unrelated: "preserve",
  });
  assert.deepEqual(appShellState.readCachedAppShellHotTiles(malformedTileStorage), []);
  assert.deepEqual(malformedTileStorage.removed, [appShellState.HOT_TILES_STORAGE_KEY]);
  assert.equal(malformedTileStorage.values.get("unrelated"), "preserve");

  const persistedTileStorage = createMemoryStorage({ unrelated: "preserve" });
  appShellState.persistAppShellHotTiles(persistedTileStorage, [{ tileId: 7, wins: 9 }]);
  assert.deepEqual(persistedTileStorage.written, [[
    appShellState.HOT_TILES_STORAGE_KEY,
    JSON.stringify([{ tileId: 7, wins: 9 }]),
  ]]);
  appShellState.persistAppShellHotTiles(persistedTileStorage, []);
  assert.deepEqual(persistedTileStorage.removed, [appShellState.HOT_TILES_STORAGE_KEY]);
  assert.equal(persistedTileStorage.values.get("unrelated"), "preserve");

  const mountDiagnostic = appShellState.createAppMountDiagnostic(
    { pathname: "/hub", href: "/hub?secret=0xdeadbeef" },
    "analytics",
    new Date("2026-08-14T00:00:00.000Z"),
  );
  assert.deepEqual(mountDiagnostic, {
    path: "/hub",
    tab: "analytics",
    time: "2026-08-14T00:00:00.000Z",
  });
  assert.doesNotMatch(JSON.stringify(mountDiagnostic), /secret|0xdeadbeef/);
  assert.deepEqual(
    [
      /return readSavedAppShellTab\(window\.localStorage\)/.test(appShellStateSource),
      /return readCachedAppShellHotTiles\(window\.localStorage\)/.test(appShellStateSource),
      [...appShellStateSource.matchAll(/persistAppShellHotTiles\(window\.localStorage, hotTiles\)/g)].length,
      /createAppMountDiagnostic\(window\.location, readHashTab\(\)\)/.test(appShellStateSource),
    ],
    [true, true, 2, true],
    "App shell runtime must remain bound to the behavior-tested storage and diagnostic policies",
  );
  const lineaOreClientViewProps = lineaOreClientViewPropsModule.default ?? lineaOreClientViewPropsModule;
  assert.equal(lineaOreClientViewProps.derivePreviousGridEpoch("42"), "41");
  assert.equal(lineaOreClientViewProps.derivePreviousGridEpoch("1"), "0");
  assert.equal(lineaOreClientViewProps.derivePreviousGridEpoch("0"), null);
  assert.equal(lineaOreClientViewProps.derivePreviousGridEpoch("001"), null);
  assert.equal(lineaOreClientViewProps.derivePreviousGridEpoch("1.5"), null);
  assert.equal(lineaOreClientViewProps.derivePreviousGridEpoch("1e3"), null);
  assert.equal(lineaOreClientViewProps.derivePreviousGridEpoch("9007199254740993"), "9007199254740992");
  const chatWindowSource = readFileSync("app/components/chat/ChatWindow.tsx", "utf8");
  const floatingActionsSource = readFileSync("app/components/FloatingActions.tsx", "utf8");
  assert.match(
    floatingActionsSource,
    /<button[\s\S]{0,120}type="button"[\s\S]{0,240}aria-label="Open chat"[\s\S]{0,80}disabled/,
    "lazy chat fallback button must remain a non-submit accessible control",
  );
  const closedToggleMarkup = renderToStaticMarkup(React.createElement(chatWindow.ChatToggleButton, {
    open: false,
    unread: 120,
    onToggle: () => undefined,
  }));
  const closedToggle = findButtonTag(closedToggleMarkup, 'aria-label="Open chat"');
  assert.match(closedToggle, /type="button"/);
  assert.match(closedToggle, /aria-controls="lore-chat-panel"/);
  assert.match(closedToggle, /aria-expanded="false"/);
  assert.match(closedToggle, /title="Open chat"/);
  assert.match(closedToggle, /\bh-11\b/);
  assert.match(closedToggle, /\bw-11\b/);
  assert.match(closedToggle, /focus-visible:ring-2/);
  assert.match(closedToggleMarkup, />99\+<\/span>/);

  const openToggleMarkup = renderToStaticMarkup(React.createElement(chatWindow.ChatToggleButton, {
    open: true,
    unread: 120,
    onToggle: () => undefined,
  }));
  const openToggle = findButtonTag(openToggleMarkup, 'aria-label="Close chat"');
  assert.match(openToggle, /aria-controls="lore-chat-panel"/);
  assert.match(openToggle, /aria-expanded="true"/);
  assert.match(openToggle, /title="Close chat"/);
  assert.doesNotMatch(openToggleMarkup, />99\+<\/span>/);
  const connectedChatMarkup = renderChatWindow(true);
  assert.match(connectedChatMarkup, /id="lore-chat-panel"/);
  assert.match(connectedChatMarkup, /role="status" aria-live="polite" aria-atomic="true">Chat connected/);
  assert.match(connectedChatMarkup, /aria-hidden="true"[^>]*title="Connected"/);
  const cooldownLiveRegion = findTag(connectedChatMarkup, "div", 'aria-live="polite"');
  assert.match(cooldownLiveRegion, /aria-live="polite"/);
  const sendAction = findButtonTag(connectedChatMarkup, 'data-testid="chat-send-action"');
  assert.match(sendAction, /type="button"/);
  assert.match(sendAction, /aria-label="Send message"/);
  const messageInput = findTag(connectedChatMarkup, "input", 'aria-label="Chat message"');
  assert.match(messageInput, /placeholder="Message as Miner"/);
  const profileAction = findButtonTag(connectedChatMarkup, 'data-testid="chat-profile-open"');
  assert.match(profileAction, /aria-label="Profile"/);
  assert.match(profileAction, /\bh-12\b/);
  assert.match(profileAction, /\bw-12\b/);
  const closeChatAction = findButtonTag(connectedChatMarkup, 'aria-label="Close chat panel"');
  assert.match(closeChatAction, /type="button"/);
  assert.match(closeChatAction, /\bh-12\b/);
  assert.match(closeChatAction, /\bw-12\b/);
  const connectingChatMarkup = renderChatWindow(false);
  assert.match(connectingChatMarkup, /role="status" aria-live="polite" aria-atomic="true">Chat connecting/);
  assert.match(connectingChatMarkup, /aria-hidden="true"[^>]*title="Connecting\.\.\."/);
  assert.equal(await chatWindow.resolveChatVerificationError(async () => true), null);
  assert.equal(
    await chatWindow.resolveChatVerificationError(async () => false),
    "Verification failed. Try again or refresh the page.",
  );
  const hostileVerificationError = await chatWindow.resolveChatVerificationError(async () => {
    throw new Error("secret provider diagnostic 0xdeadbeef");
  });
  assert.equal(hostileVerificationError, "Verification error. Try again or refresh the page.");
  assert.doesNotMatch(hostileVerificationError, /secret|provider|0xdeadbeef/i);
  assert.match(
    chatWindowSource,
    /resolveChatVerificationError\(onEnsureAuth\)\.then\(setVerifyError\)/,
    "chat verification control must use the behavior-tested redaction action",
  );
  const walletIdentityMarkup = renderChatProfileModal(null);
  assert.match(walletIdentityMarkup, /role="dialog"/);
  assert.match(walletIdentityMarkup, /aria-modal="true"/);
  const saveButton = findButtonTag(walletIdentityMarkup, 'data-testid="chat-profile-save"');
  assert.match(saveButton, /type="button"/);
  const closeButton = findButtonTag(walletIdentityMarkup, 'aria-label="Close"');
  assert.match(closeButton, /type="button"/);
  assert.match(closeButton, /\bh-11\b/);
  assert.match(closeButton, /\bw-11\b/);
  assert.match(closeButton, /focus-visible:/);
  const walletIdentityButton = findButtonTag(walletIdentityMarkup, 'aria-label="Use wallet identity avatar"');
  assert.match(walletIdentityButton, /aria-pressed="true"/);
  const unselectedPresetButton = findButtonTag(walletIdentityMarkup, 'aria-label="Select miner-helmet avatar"');
  assert.match(unselectedPresetButton, /aria-pressed="false"/);

  const presetMarkup = renderChatProfileModal("miner-helmet");
  assert.match(
    findButtonTag(presetMarkup, 'aria-label="Use wallet identity avatar"'),
    /aria-pressed="false"/,
  );
  assert.match(
    findButtonTag(presetMarkup, 'aria-label="Select miner-helmet avatar"'),
    /aria-pressed="true"/,
  );
  const chatAuthRouteSource = readFileSync("app/api/chat/auth/route.ts", "utf8");
  assert.match(
    chatAuthRouteSource,
    /async function verifyChatSignature\([\s\S]*return verifyChatWalletMessage\(\{[\s\S]*address,[\s\S]*message,[\s\S]*signature,[\s\S]*rpcWitnesses:/,
    "chat auth must delegate the intended personal-sign message to the quorum verifier",
  );
  assert.doesNotMatch(
    chatAuthRouteSource,
    /recoverAddress|keccak256\(toBytes\(message\)\)/,
    "chat auth must not accept raw eth_sign digest recovery as a login fallback",
  );
  const validChatAddress = "0x1111111111111111111111111111111111111111";
  const authNow = Date.parse("2026-08-13T12:05:00.000Z");
  const authFields = {
    address: validChatAddress,
    uri: "https://lore.example/chat",
    chainId: 59144,
    nonce: "ab".repeat(16),
    issuedAt: "2026-08-13T12:04:00.000Z",
  };
  const canonicalAuthMessage = chatAuth.buildChatAuthMessage(authFields);
  assert.deepEqual(chatAuth.parseChatAuthMessage(canonicalAuthMessage), authFields);
  assert.equal(chatAuth.isChatAuthIssuedAtValid(authFields.issuedAt, authNow), true);
  assert.equal(chatAuth.getChatAuthProofTtlMs(authFields.issuedAt, authNow), chatAuth.CHAT_AUTH_PROOF_TTL_MS - 60_000);
  for (const mutant of [
    canonicalAuthMessage.replace("Chain ID: 59144", "Chain ID: 059144"),
    canonicalAuthMessage.replace(authFields.nonce, authFields.nonce.toUpperCase()),
    canonicalAuthMessage.replace(authFields.issuedAt, "2026-08-13T12:04:00Z"),
    `${canonicalAuthMessage}\nRole: admin`,
    canonicalAuthMessage.replace("URI: https://lore.example/chat", "URI: javascript:alert(1)"),
  ]) {
    assert.equal(chatAuth.parseChatAuthMessage(mutant), null, `non-canonical auth mutant must fail closed: ${mutant.slice(-30)}`);
  }
  assert.equal(chatAuth.isChatAuthIssuedAtValid("2026-08-13T12:06:00.001Z", authNow), false);
  assert.equal(chatAuth.getChatAuthProofTtlMs("2026-08-13T11:59:59.999Z", authNow), null);
  assert.match(
    chatAuthRouteSource,
    /getChatAuthProofTtlMs\(fields\.issuedAt\)[\s\S]*ttlMs === null[\s\S]*Expired auth proof[\s\S]*consumeChatProof\(authAddress, fields\.nonce, fields\.uri, authSignature, ttlMs\)/,
    "chat auth route must fail closed before replay-lock consumption when issuedAt TTL is invalid",
  );
  assert.doesNotMatch(
    chatAuthRouteSource,
    /Date\.parse\(fields\.issuedAt\)|CHAT_AUTH_PROOF_TTL_MS - \(Date\.now\(\) - issuedAtMs\)/,
    "chat auth route must not recalculate replay-lock TTL with broad Date.parse",
  );
  assert.match(
    chatAuthRouteSource,
    /normalizeChatAuthAddress\(body\.authAddress\)/,
    "chat auth route must reuse the shared wallet address normalizer",
  );
  assert.match(
    chatAuthRouteSource,
    /isTrustedAuthUri\(fields\.uri, trustedOrigin, "\/chat"\)/,
    "chat auth route must bind signed messages to the exact chat URI path",
  );
  assert.doesNotMatch(
    chatAuthRouteSource,
    /new URL\(fields\.uri\)\.origin/,
    "chat auth route must not accept signed messages by origin-only URI comparison",
  );
  assert.match(
    chatAuthRouteSource,
    /requiresExternalSharedLock\(\)[\s\S]*acquireExternalExpiringLock/,
    "chat auth must use a shared replay lock when production runs more than one web replica",
  );
  const previousChatSecret = process.env.CHAT_AUTH_SECRET;
  process.env.CHAT_AUTH_SECRET = "chat-client-safety-test-secret";
  try {
    const jar = createCookieJar();
    const expiresAt = chatSession.issueChatSession(jar.response, ` ${validChatAddress} `);
    const issuedCookie = jar.writes.at(-1);
    assert.equal(issuedCookie.name, "lore_chat_session");
    assert.equal(issuedCookie.options.httpOnly, true);
    assert.equal(issuedCookie.options.sameSite, "lax");
    assert.equal(issuedCookie.options.path, "/api/chat");
    assert.equal(issuedCookie.options.expires.getTime(), expiresAt);
    const decoded = decodeChatSessionToken(issuedCookie.value);
    assert.equal(decoded.address, validChatAddress);
    assert.deepEqual(chatSession.readChatSession(jar.request), decoded);

    jar.values.set("lore_chat_session", `${issuedCookie.value.slice(0, -1)}${issuedCookie.value.endsWith("a") ? "b" : "a"}`);
    assert.equal(chatSession.readChatSession(jar.request), null, "tampered chat-session signature must fail closed");
    jar.values.set("lore_chat_session", mutateChatSessionToken(issuedCookie.value, (payload) => ({ ...payload, address: "0x2222222222222222222222222222222222222222" })));
    assert.equal(chatSession.readChatSession(jar.request), null, "payload mutation must fail before session use");
    jar.values.set("lore_chat_session", `${issuedCookie.value}.extra`);
    assert.equal(chatSession.readChatSession(jar.request), null, "multi-part session cookie must fail closed");
    jar.values.set("lore_chat_session", "a".repeat(1_025));
    assert.equal(chatSession.readChatSession(jar.request), null, "oversized session cookie must fail closed");

    chatSession.clearChatSession(jar.response);
    const clearedCookie = jar.writes.at(-1);
    assert.equal(clearedCookie.value, "");
    assert.equal(clearedCookie.options.expires.getTime(), 0);
    assert.equal(chatSession.readChatSession(jar.request), null);
  } finally {
    if (previousChatSecret === undefined) delete process.env.CHAT_AUTH_SECRET;
    else process.env.CHAT_AUTH_SECRET = previousChatSecret;
  }
  runChatProfileReadScopeTests();
  await runChatProfileRuntimeTests();
  const useChatProfileSource = readFileSync("app/hooks/useChatProfile.ts", "utf8");
  assert.deepEqual(
    [
      /normalizeChatAuthAddress\(walletAddress\)/.test(useChatProfileSource),
      /readChatProfileCache\(localStorage, walletAddress\)/.test(useChatProfileSource),
      /persistChatProfileCache\(localStorage, walletAddress, profile\)/.test(useChatProfileSource),
      /fetchRemoteChatProfile\(normalizedWallet\)/.test(useChatProfileSource),
      [...useChatProfileSource.matchAll(/saveRemoteChatProfile\(normalizedWallet,/g)].length,
    ],
    [true, true, true, true, 2],
    "useChatProfile must remain bound to the behavior-tested wallet, cache, and bounded remote policies",
  );
  assert.match(
    readFileSync("app/hooks/useChat.ts", "utf8"),
    /normalizeChatAuthAddress\(walletAddress\)/,
    "chat send hook must normalize wallet addresses before optimistic or persisted messages",
  );
  const serverMessage = createChatMessage("server:1", 2, "sent");
  const optimisticMessage = createChatMessage("local:1", 1, "sending");
  const priorMessage = createChatMessage("server:0", 0, "prior");
  assert.deepEqual(
    chatSendState.reconcileChatSendAttempt([priorMessage, optimisticMessage], optimisticMessage, { ok: true, message: serverMessage }),
    [priorMessage, serverMessage],
    "successful send must atomically replace its optimistic row",
  );
  assert.deepEqual(
    chatSendState.reconcileChatSendAttempt([priorMessage, serverMessage, optimisticMessage], optimisticMessage, { ok: true, message: serverMessage }),
    [priorMessage, serverMessage],
    "poll races must not duplicate an already-observed server row",
  );
  assert.deepEqual(
    chatSendState.reconcileChatSendAttempt([priorMessage, optimisticMessage], optimisticMessage, { ok: false, error: new Error("HTTP 500") }),
    [priorMessage],
    "failed send must roll back only its optimistic row",
  );
  assert.deepEqual(
    chatSendState.reconcileChatSendAttempt([optimisticMessage, createChatMessage("local:2", 3)], optimisticMessage, { ok: false, error: "offline" }),
    [createChatMessage("local:2", 3)],
    "one failed send must preserve unrelated optimistic rows",
  );
  runChatWalletRuntimeTests();
  const useChatWidgetRuntimeSource = readFileSync("app/hooks/useChatWidgetRuntime.ts", "utf8");
  const chatWindowIdentitySource = readFileSync("app/components/chat/ChatWindow.tsx", "utf8");
  const stableChatWalletAddressSource = readFileSync("app/hooks/useStableChatWalletAddress.ts", "utf8");
  assert.deepEqual(
    [
      /countOtherChatMessages\(messages, walletAddress\)/.test(useChatWidgetRuntimeSource),
      /isOwnChatMessageSender\(msg\.sender, walletAddress\)/.test(chatWindowIdentitySource),
      /normalizeChatWalletCandidates\(addresses\)/.test(stableChatWalletAddressSource),
      [...stableChatWalletAddressSource.matchAll(/selectStableChatWalletAddress\(/g)].length,
      /persistStableChatWalletAddress\(window\.localStorage, next\)/.test(stableChatWalletAddressSource),
    ],
    [true, true, true, 2, true],
    "chat widget, rows, and stable wallet hook must use the behavior-tested identity policy",
  );
  assert.match(
    readFileSync("app/hooks/useRebate.ts", "utf8"),
    /getRebateCacheKey[\s\S]*getAddress\(address\)/,
    "rebate cache keys must normalize wallet addresses with the EVM address parser",
  );
  assert.match(
    readFileSync("app/hooks/useRebate.ts", "utf8"),
    /const cacheKey = getRebateCacheKey\(address\)[\s\S]*localStorage\.removeItem\(cacheKey\)[\s\S]*const cacheKey = getClaimPlanCacheKey\(address, epochs\)[\s\S]*localStorage\.removeItem\(cacheKey\)/,
    "rebate and claim-plan caches must clear corrupt or invalid localStorage entries",
  );
  assert.match(
    readFileSync("app/hooks/useRewardScanner.ts", "utf8"),
    /getRewardScanCacheKey[\s\S]*getAddress\(address\)/,
    "reward scan cache keys must normalize wallet addresses with the EVM address parser",
  );
  assert.match(
    readFileSync("app/hooks/useRewardScanner.ts", "utf8"),
    /const cacheKey = getRewardScanCacheKey\(address\)[\s\S]*let sourceKey = cacheKey[\s\S]*sourceKey = v1Key[\s\S]*localStorage\.removeItem\(sourceKey\)/,
    "reward scan cache reads must clear corrupt or invalid v2 and legacy cache entries",
  );
  assert.match(
    readFileSync("app/hooks/useDepositHistory.ts", "utf8"),
    /getDepositCacheKey[\s\S]*getAddress\(userAddress\)/,
    "deposit cache keys must normalize wallet addresses with the EVM address parser",
  );
  assert.match(
    readFileSync("app/hooks/useDepositHistory.ts", "utf8"),
    /function normalizeDepositUserAddress[\s\S]*getAddress\(userAddress\)\.toLowerCase\(\)/,
    "deposit history hook must normalize user addresses before cache and API use",
  );
  assert.match(
    readFileSync("app/hooks/useAnalyticsAchievements.ts", "utf8"),
    /getAchievementStorageKey[\s\S]*getAddress\(walletAddress\)/,
    "achievement cache keys must normalize wallet addresses with the EVM address parser",
  );
  assert.match(
    readFileSync("app/api/rewards/route.ts", "utf8"),
    /getAddress\(typeof body\.user === "string" \? body\.user : ""\)\.toLowerCase\(\)/,
    "rewards route must normalize user addresses with the EVM address parser",
  );
  assert.match(
    readFileSync("app/api/_lib/rewardSummary.ts", "utf8"),
    /const normalizedUser = getAddress\(user\)\.toLowerCase\(\)/,
    "reward summary reads must normalize user addresses before cache and chain reads",
  );
  runHeaderWalletCardBehaviorTests();
  const appNewTabIsolationIssues = [];
  const appWindowOpenIssues = [];
  for (const file of listSourceFiles("app")) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/<a\b[\s\S]*?>/g)) {
      const tag = match[0];
      if (!tag.includes('target="_blank"')) continue;
      const rel = tag.match(/\brel="([^"]*)"/)?.[1] ?? "";
      if (!/\bnoopener\b/.test(rel) || !/\bnoreferrer\b/.test(rel)) {
        appNewTabIsolationIssues.push(file);
      }
    }
    for (const match of source.matchAll(/window\.open\(([\s\S]*?)\);/g)) {
      const call = match[1];
      if (!call.includes('"_blank"')) continue;
      const features = call.match(/,\s*"([^"]*)"\s*\)?$/)?.[1] ?? "";
      if (!/\bnoopener\b/.test(features) || !/\bnoreferrer\b/.test(features)) {
        appWindowOpenIssues.push(file);
      }
    }
  }
  assert.deepEqual(
    [...new Set(appNewTabIsolationIssues)],
    [],
    "all app target=_blank links must explicitly use noopener noreferrer",
  );
  assert.deepEqual(
    [...new Set(appWindowOpenIssues)],
    [],
    "all app window.open(_blank) calls must explicitly use noopener and noreferrer",
  );
  const removedWalletExperimentMarker = "77" + "02";
  const removedWalletExperimentPatterns = [
    new RegExp(`\\bEIP-${removedWalletExperimentMarker}\\b`),
    new RegExp(`\\beip${removedWalletExperimentMarker}\\b`, "i"),
    new RegExp(`\\bWalletSettings${removedWalletExperimentMarker}\\b`),
    new RegExp(`\\b${removedWalletExperimentMarker}Delegate\\b`),
    new RegExp(`\\bpatch-privy-${removedWalletExperimentMarker}\\b`),
  ];
  const removedWalletExperimentIssues = [];
  const activeWalletExperimentSourceFiles = [
    ...listSourceFiles("app"),
    ...listSourceFiles("config"),
    ...listSourceFiles("contracts", /\.(?:sol|ts|mjs)$/),
    ...listSourceFiles("scripts"),
    ...listSourceFiles("docs", /\.(?:md|json|txt)$/).filter((file) => !file.startsWith(join("docs", "archive"))),
    "AGENTS.md",
    "README.md",
    "SECURITY.md",
    "package.json",
  ].filter((file) => file !== join("scripts", "test-business-logic.mjs"));
  for (const file of activeWalletExperimentSourceFiles) {
    const source = readFileSync(file, "utf8");
    if (removedWalletExperimentPatterns.some((pattern) => pattern.test(source))) {
      removedWalletExperimentIssues.push(file);
    }
  }
  assert.deepEqual(
    [...new Set(removedWalletExperimentIssues)],
    [],
    "active source, operator docs, and package metadata must not reintroduce the removed wallet experiment",
  );
  const walletSettingsOverviewSource = readFileSync("app/components/wallet/WalletSettingsOverviewPanel.tsx", "utf8");
  assert.match(
    walletSettingsOverviewSource,
    /role="switch"[\s\S]*aria-checked=\{animationEnabled\}[\s\S]*aria-label=\{animationEnabled \? "Disable animation effects" : "Enable animation effects"\}/,
    "wallet settings animation switch must expose a state-aware accessible name",
  );
  assert.match(
    walletSettingsOverviewSource,
    /connectedResolverClaimLabel[\s\S]*embeddedResolverClaimLabel[\s\S]*role="status"[\s\S]*aria-live="polite"[\s\S]*aria-label=\{connectedResolverClaimLabel\}[\s\S]*title=\{connectedResolverClaimLabel\}[\s\S]*aria-label=\{embeddedResolverClaimLabel\}[\s\S]*title=\{embeddedResolverClaimLabel\}/,
    "wallet settings resolver reward claims must expose state-aware labels and announce claim progress",
  );
  assert.match(
    readFileSync("app/lib/chatSessionClient.ts", "utf8"),
    /normalizeChatAuthAddress/,
    "client chat session storage must normalize wallet addresses before keying localStorage",
  );
  const useChatAuthSource = readFileSync("app/hooks/useChatAuth.ts", "utf8");
  const providerRequests = [];
  const fallbackSignerCalls = [];
  const runtimeCanonicalAuthMessage = chatAuth.buildChatAuthMessage({
    ...authFields,
    chainId: chatAuthRuntime.CHAT_AUTH_CHAIN_ID,
  });
  const providerProof = await chatAuthRuntime.createChatAuthProof({
    walletAddress: ` ${validChatAddress} `,
    origin: "https://lore.example",
    wallets: [{
      address: validChatAddress,
      getEthereumProvider: async () => ({
        request: async (request) => {
          providerRequests.push(request);
          return "0xprovider-signature";
        },
      }),
    }],
    signMessage: async (...args) => {
      fallbackSignerCalls.push(args);
      return "0xfallback-signature";
    },
    uiTitle: "Verify wallet for chat",
    issuedAt: authFields.issuedAt,
    nonce: authFields.nonce,
  });
  assert.deepEqual(providerProof, {
    authAddress: validChatAddress,
    authMessage: runtimeCanonicalAuthMessage,
    authSignature: "0xprovider-signature",
  });
  assert.equal(providerRequests.length, 1);
  assert.equal(providerRequests[0].method, "personal_sign");
  assert.equal(providerRequests[0].params[1], validChatAddress);
  assert.equal(Buffer.from(providerRequests[0].params[0].slice(2), "hex").toString("utf8"), runtimeCanonicalAuthMessage);
  assert.deepEqual(fallbackSignerCalls, []);

  const fallbackProof = await chatAuthRuntime.createChatAuthProof({
    walletAddress: validChatAddress,
    origin: "https://lore.example",
    wallets: [],
    signMessage: async (message, title) => {
      fallbackSignerCalls.push([message, title]);
      return "0xfallback-signature";
    },
    uiTitle: "Verify wallet for chat",
    issuedAt: authFields.issuedAt,
    nonce: authFields.nonce,
  });
  assert.equal(fallbackProof.authSignature, "0xfallback-signature");
  assert.deepEqual(fallbackSignerCalls, [[runtimeCanonicalAuthMessage, "Verify wallet for chat"]]);
  assert.equal(
    await chatAuthRuntime.createChatAuthProof({
      walletAddress: "0x1234",
      origin: "https://lore.example",
      wallets: [],
      signMessage: async () => { throw new Error("must not sign invalid wallet"); },
      uiTitle: "Verify wallet for chat",
      issuedAt: authFields.issuedAt,
      nonce: authFields.nonce,
    }),
    null,
  );

  const sessionFetchCalls = [];
  const sessionExpiresAt = Date.now() + 60_000;
  const returnedExpiry = await chatAuthRuntime.requestChatAuthSession(
    "POST",
    providerProof,
    async (url, init) => {
      sessionFetchCalls.push([url, init]);
      return new Response("{}", {
        status: 200,
        headers: { "x-chat-session-expires-at": String(sessionExpiresAt) },
      });
    },
  );
  assert.equal(returnedExpiry, sessionExpiresAt);
  assert.equal(sessionFetchCalls[0][0], "/api/chat/auth");
  assert.equal(sessionFetchCalls[0][1].method, "POST");
  assert.equal(sessionFetchCalls[0][1].cache, "no-store");
  assert.deepEqual(JSON.parse(sessionFetchCalls[0][1].body), providerProof);
  assert.equal(
    await chatAuthRuntime.requestChatAuthSession(
      "GET",
      undefined,
      async () => new Response("{}", {
        status: 200,
        headers: { "x-chat-session-expires-at": "00120000" },
      }),
    ),
    null,
  );
  let oversizedAuthError = null;
  try {
    await chatAuthRuntime.requestChatAuthSession(
      "GET",
      undefined,
      async () => new Response(JSON.stringify({
        error: "secret provider diagnostic 0xdeadbeef",
        padding: "x".repeat(70_000),
      }), { status: 500 }),
    );
  } catch (error) {
    oversizedAuthError = error;
  }
  assert.equal(oversizedAuthError?.message, "Chat auth HTTP 500");
  assert.doesNotMatch(oversizedAuthError?.message ?? "", /secret|provider|0xdeadbeef/i);
  assert.deepEqual(
    [
      /createChatAuthProof\(\{[\s\S]*walletAddress: normalizedWallet[\s\S]*origin: window\.location\.origin/.test(useChatAuthSource),
      /requestChatAuthSession\("POST", proof\)/.test(useChatAuthSource),
      /requestChatAuthSession\("GET"\)/.test(useChatAuthSource),
      [...useChatAuthSource.matchAll(/normalizeChatAuthAddress\(walletAddress\)/g)].length,
    ],
    [true, true, true, 3],
    "useChatAuth must remain bound to the behavior-tested proof, session, and wallet-normalization policies",
  );

  const previousLocalStorage = globalThis.localStorage;
  const previousWindow = globalThis.window;
  try {
    const storage = new Map();
    const sessionEvents = [];
    const eventTarget = new EventTarget();
    eventTarget.addEventListener(chatSessionClient.CHAT_AUTH_SESSION_EVENT, (event) => {
      sessionEvents.push(event.detail);
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: eventTarget,
    });
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: (key) => storage.delete(key),
      },
    });
    const chatKey = chatSessionClient.getChatAuthStorageKey(validChatAddress);
    assert.equal(chatSessionClient.normalizeChatAuthSessionExpiresAt("120000", 100_000), 120_000);
    assert.equal(chatSessionClient.normalizeChatAuthSessionExpiresAt(120_000, 100_000), 120_000);
    assert.equal(chatSessionClient.normalizeChatAuthSessionExpiresAt("00120000", 100_000), null);
    assert.equal(chatSessionClient.normalizeChatAuthSessionExpiresAt("1e5", 100_000), null);
    assert.equal(chatSessionClient.normalizeChatAuthSessionExpiresAt(120_000.5, 100_000), null);
    assert.equal(chatSessionClient.normalizeChatAuthSessionExpiresAt(Number.MAX_SAFE_INTEGER + 1, 100_000), null);
    assert.equal(chatSessionClient.normalizeChatAuthSessionExpiresAt(99_999, 100_000), null);
    assert.equal(
      chatSessionClient.normalizeChatAuthSessionExpiresAt(Date.now() + chatAuth.CHAT_AUTH_SESSION_TTL_MS + 120_000),
      null,
      "chat auth session expiry must reject implausibly far future timestamps",
    );
    const validStringExpiry = Date.now() + 60_000;
    storage.set(chatKey, JSON.stringify({ address: validChatAddress, expiresAt: String(validStringExpiry) }));
    assert.deepEqual(chatSessionClient.loadChatAuthSession(validChatAddress), {
      address: validChatAddress,
      expiresAt: validStringExpiry,
    });
    storage.set(chatKey, JSON.stringify({ address: validChatAddress, expiresAt: Date.now() - 1 }));
    assert.equal(chatSessionClient.loadChatAuthSession(validChatAddress), null);
    assert.equal(storage.has(chatKey), false, "expired chat auth session must be cleared from storage");
    storage.set(chatKey, JSON.stringify({ address: validChatAddress, expiresAt: Date.now() + chatAuth.CHAT_AUTH_SESSION_TTL_MS + 120_000 }));
    assert.equal(chatSessionClient.loadChatAuthSession(validChatAddress), null);
    assert.equal(storage.has(chatKey), false, "far-future chat auth session must be cleared from storage");
    storage.set(chatKey, JSON.stringify({ address: validChatAddress, expiresAt: Date.now() + 60_000.5 }));
    assert.equal(chatSessionClient.loadChatAuthSession(validChatAddress), null);
    assert.equal(storage.has(chatKey), false, "fractional chat auth session expiry must be cleared from storage");
    storage.set(chatKey, "{bad json");
    assert.equal(chatSessionClient.loadChatAuthSession(validChatAddress), null);
    assert.equal(storage.has(chatKey), false, "corrupt chat auth session must be cleared from storage");
    storage.set(chatKey, JSON.stringify({ address: "0x0000000000000000000000000000000000000002", expiresAt: Date.now() + 60_000 }));
    assert.equal(chatSessionClient.loadChatAuthSession(validChatAddress), null);
    assert.equal(storage.has(chatKey), false, "mismatched chat auth session must be cleared from storage");
    storage.set(chatKey, JSON.stringify({ address: validChatAddress }));
    assert.equal(chatSessionClient.loadChatAuthSession(validChatAddress), null);
    assert.equal(storage.has(chatKey), false, "invalid chat auth session shape must be cleared from storage");
    assert.equal(chatSessionClient.getChatAuthStorageKey("0xabc"), "");
    assert.equal(chatSessionClient.loadChatAuthSession("0xabc"), null);
    const sessionToSave = { address: ` ${validChatAddress} `, expiresAt: Date.now() + 60_000 };
    chatSessionClient.saveChatAuthSession(sessionToSave);
    assert.deepEqual(JSON.parse(storage.get(chatKey)), {
      address: validChatAddress,
      expiresAt: sessionToSave.expiresAt,
    });
    assert.deepEqual(sessionEvents.at(-1), {
      address: validChatAddress,
      expiresAt: sessionToSave.expiresAt,
    });
    const savedRaw = storage.get(chatKey);
    chatSessionClient.saveChatAuthSession({ address: validChatAddress, expiresAt: Date.now() - 1 });
    assert.equal(storage.get(chatKey), savedRaw, "invalid session saves must leave the last valid session intact");
    chatSessionClient.clearChatAuthSession(` ${validChatAddress} `);
    assert.equal(storage.has(chatKey), false);
    assert.deepEqual(sessionEvents.at(-1), { address: validChatAddress, expiresAt: null });
  } finally {
    if (previousLocalStorage === undefined) {
      delete globalThis.localStorage;
    } else {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: previousLocalStorage,
      });
    }
    if (previousWindow === undefined) delete globalThis.window;
    else Object.defineProperty(globalThis, "window", { configurable: true, value: previousWindow });
  }

  assert.equal(indexerFinality.parseIndexerFinalityBlocks("12"), 12n);
  assert.equal(indexerFinality.parseIndexerFinalityBlocks("-1"), 0n);
  assert.equal(indexerFinality.parseIndexerFinalityBlocks("bad"), 0n);
  assert.equal(indexerFinality.getIndexerFinalityTargetBlock(100n, 12n), 88n);
  assert.equal(indexerFinality.getIndexerFinalityTargetBlock(100n, 0n), 100n);
  assert.equal(indexerFinality.getIndexerFinalityTargetBlock(5n, 12n), null);
  assert.equal(indexerFinality.getIndexerTargetLagBlocks(80n, 88n), 8);
  assert.equal(
    indexerFinality.getIndexerTargetLagBlocks(0n, BigInt(Number.MAX_SAFE_INTEGER) + 10n),
    Number.MAX_SAFE_INTEGER,
  );
  assert.equal(indexerFinality.getIndexerTargetLagBlocks(90n, 88n), 0);
  assert.equal(indexerFinality.getIndexerTargetLagBlocks(null, 88n), null);
  assert.equal(indexerFinality.getIndexerTargetLagBlocks(80n, null), null);
  assert.equal(indexerFinality.hasMainnetIndexerFinality("12"), true);
  assert.equal(indexerFinality.hasMainnetIndexerFinality("0"), false);
  assert.equal(indexerFinality.hasMainnetIndexerFinality("bad"), false);
  assert.equal(indexerWatchPolicy.parseIndexerWatchFailureLimit("3"), 3);
  assert.equal(indexerWatchPolicy.parseIndexerWatchFailureLimit("0"), 5);
  assert.equal(indexerWatchPolicy.parseIndexerWatchFailureLimit("101"), 5);
  assert.deepEqual(indexerWatchPolicy.recordIndexerWatchFailure(0, 3), {
    failures: 1,
    shouldRestart: false,
  });
  assert.deepEqual(indexerWatchPolicy.recordIndexerWatchFailure(2, 3), {
    failures: 3,
    shouldRestart: true,
  });
  assert.deepEqual(indexerWatchPolicy.recordIndexerWatchFailure(2.5, 3), {
    failures: 1,
    shouldRestart: false,
  });
  assert.deepEqual(indexerWatchPolicy.recordIndexerWatchFailure(Number.NaN, 3), {
    failures: 1,
    shouldRestart: false,
  });
  assert.deepEqual(indexerWatchPolicy.recordIndexerWatchFailure(Number.MAX_SAFE_INTEGER + 1, 3), {
    failures: 1,
    shouldRestart: false,
  });
  assert.deepEqual(indexerWatchPolicy.recordIndexerWatchFailure(2, 2.5), {
    failures: 3,
    shouldRestart: false,
  });
}
