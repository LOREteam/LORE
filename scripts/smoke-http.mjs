import { performance } from "node:perf_hooks";
import { parsePositiveIntegerEnv } from "./env-parsing.mjs";

const BASE_URL = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const TIMEOUT_MS = parsePositiveIntegerEnv(process.env.SMOKE_TIMEOUT_MS, 60_000);
const WARMUP_TIMEOUT_MS = parsePositiveIntegerEnv(process.env.SMOKE_WARMUP_TIMEOUT_MS, 120_000);
const SKIP_WARMUP = process.env.SMOKE_SKIP_WARMUP === "1";
const RETRYABLE_ATTEMPTS = parsePositiveIntegerEnv(process.env.SMOKE_RETRY_ATTEMPTS, 3);
const RETRY_DELAY_MS = parsePositiveIntegerEnv(process.env.SMOKE_RETRY_DELAY_MS, 1_500);
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000001";
const HOME_TITLE = "LORE - Linea Mining Game";
const HOME_MARKERS = ["LORE", "Hot Tiles", "Analytics", "FAQ", "Leaderboards"];
const DECIMAL_STRING_RE = /^\d+(?:\.\d+)?$/;
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const TX_HASH_RE = /^0x[a-fA-F0-9]{64}$/;

function assertDecimalString(value, label) {
  if (typeof value !== "string" || !DECIMAL_STRING_RE.test(value)) {
    throw new Error(`${label} must be a decimal string`);
  }
}

function assertFiniteNumber(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be finite`);
  }
}

function assertIntegerString(value, label) {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string`);
  }
  try {
    if (BigInt(value) < 0n) throw new Error("negative");
  } catch {
    throw new Error(`${label} must be an unsigned integer string`);
  }
}

function assertOptionalTxHash(value, label) {
  if (value === undefined || value === null || value === "") return;
  if (typeof value !== "string" || !TX_HASH_RE.test(value)) {
    throw new Error(`${label} must be a transaction hash`);
  }
}

function assertAddress(value, label) {
  if (typeof value !== "string" || !ADDRESS_RE.test(value)) {
    throw new Error(`${label} must be an address`);
  }
}

const checks = [
  {
    name: "home",
    path: "/",
    assert: async (response, body) => {
      if (!response.headers.get("content-type")?.includes("text/html")) {
        throw new Error("expected text/html");
      }
      if (body.length < 1000) {
        throw new Error("homepage body too small");
      }
      if (!body.includes(HOME_TITLE)) {
        throw new Error(`homepage missing title: ${HOME_TITLE}`);
      }
      if (body.includes("<title>Dota") || body.includes("Dota 2")) {
        throw new Error("homepage appears to be a different local app");
      }
      for (const marker of HOME_MARKERS) {
        if (!body.includes(marker)) {
          throw new Error(`homepage missing marker: ${marker}`);
        }
      }
      if (body.includes("ReferenceError") || body.includes("Internal Server Error")) {
        throw new Error("homepage contains server error markers");
      }
    },
  },
  {
    name: "admin-page",
    path: "/admin",
    assert: async (response, body) => {
      if (!response.headers.get("content-type")?.includes("text/html")) {
        throw new Error("expected text/html");
      }
      if (!body.includes("LORE Ops") || !body.includes("Runtime, indexer, and API health dashboard")) {
        throw new Error("admin page missing ops shell markers");
      }
      if (body.includes("ReferenceError") || body.includes("Internal Server Error")) {
        throw new Error("admin page contains server error markers");
      }
    },
  },
  {
    name: "admin-ops-auth",
    path: "/api/admin/ops",
    expectedStatus: 401,
    assert: async (response, body) => {
      if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new Error("expected json");
      }
      if (!response.headers.get("cache-control")?.includes("no-store")) {
        throw new Error("admin ops unauthenticated responses must be no-store");
      }
      const json = JSON.parse(body);
      if (json.error !== "Admin auth required") {
        throw new Error("admin ops unauthenticated response must require admin auth");
      }
      const leakedKeys = ["status", "logSources", "recentErrors", "storage", "indexerStorage", "runtime"].filter(
        (key) => Object.prototype.hasOwnProperty.call(json, key),
      );
      if (leakedKeys.length > 0) {
        throw new Error(`admin ops unauthenticated response leaked keys: ${leakedKeys.join(", ")}`);
      }
    },
  },
  {
    name: "admin-proc-auth",
    path: "/api/admin/processes",
    expectedStatuses: [401, 404],
    assert: async (response, body) => {
      if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new Error("expected json");
      }
      if (!response.headers.get("cache-control")?.includes("no-store")) {
        throw new Error("admin processes unauthenticated responses must be no-store");
      }
      const json = JSON.parse(body);
      const allowedErrors = ["Admin auth required", "Admin process controls are disabled"];
      if (!allowedErrors.includes(json.error)) {
        throw new Error("admin processes unauthenticated response must require auth or be disabled");
      }
      const leakedKeys = ["status", "processes", "process", "started", "pid", "logFile"].filter((key) =>
        Object.prototype.hasOwnProperty.call(json, key),
      );
      if (leakedKeys.length > 0) {
        throw new Error(`admin processes unauthenticated response leaked keys: ${leakedKeys.join(", ")}`);
      }
    },
  },
  {
    name: "admin-auth-get",
    path: "/api/admin/auth",
    expectedStatus: 401,
    assert: async (response, body) => {
      if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new Error("expected json");
      }
      if (!response.headers.get("cache-control")?.includes("no-store")) {
        throw new Error("admin auth GET unauthenticated responses must be no-store");
      }
      const json = JSON.parse(body);
      if (json.error !== "Admin auth required") {
        throw new Error("admin auth GET without session must require admin auth");
      }
      const leakedKeys = ["ok", "address", "expiresAt", "session"].filter((key) =>
        Object.prototype.hasOwnProperty.call(json, key),
      );
      if (leakedKeys.length > 0) {
        throw new Error(`admin auth GET unauthenticated response leaked keys: ${leakedKeys.join(", ")}`);
      }
    },
  },
  {
    name: "admin-auth-bad",
    path: "/api/admin/auth",
    method: "POST",
    body: "{",
    headers: { "content-type": "application/json" },
    expectedStatuses: [400, 503],
    assert: async (response, body) => {
      if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new Error("expected json");
      }
      if (!response.headers.get("cache-control")?.includes("no-store")) {
        throw new Error("admin auth POST error responses must be no-store");
      }
      const json = JSON.parse(body);
      if (response.status === 400 && json.error !== "Invalid auth payload") {
        throw new Error("admin auth malformed POST should reject invalid payload");
      }
      if (response.status === 503 && json.error !== "Admin wallet is not configured on this environment") {
        throw new Error("admin auth malformed POST returned unexpected 503 payload");
      }
    },
  },
  {
    name: "admin-owner-bad",
    path: "/api/admin/check-owner?address=not-an-address",
    expectedStatus: 400,
    assert: async (response, body) => {
      if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new Error("expected json");
      }
      if (!response.headers.get("cache-control")?.includes("no-store")) {
        throw new Error("admin owner check responses must be no-store");
      }
      const json = JSON.parse(body);
      if (json.error !== "Invalid address" || json.isOwner !== false) {
        throw new Error("admin owner check invalid-address response has unexpected shape");
      }
      if (Object.prototype.hasOwnProperty.call(json, "owner")) {
        throw new Error("admin owner check invalid-address response leaked owner");
      }
    },
  },
  {
    name: "chat-auth-bad",
    path: "/api/chat/auth",
    method: "POST",
    body: "{",
    headers: { "content-type": "application/json" },
    expectedStatus: 400,
    assert: async (response, body) => {
      if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new Error("expected json");
      }
      if (!response.headers.get("cache-control")?.includes("no-store")) {
        throw new Error("chat auth POST error responses must be no-store");
      }
      const json = JSON.parse(body);
      if (json.error !== "Invalid auth payload") {
        throw new Error("chat auth malformed POST should reject invalid payload");
      }
    },
  },
  {
    name: "chat-msg-bad",
    path: "/api/chat/messages",
    method: "POST",
    body: "{",
    headers: { "content-type": "application/json" },
    expectedStatus: 400,
    assert: async (response, body) => {
      if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new Error("expected json");
      }
      if (!response.headers.get("cache-control")?.includes("no-store")) {
        throw new Error("chat message POST error responses must be no-store");
      }
      const json = JSON.parse(body);
      if (json.error !== "Invalid message payload") {
        throw new Error("chat message malformed POST should reject invalid payload");
      }
    },
  },
  {
    name: "chat-profile-bad",
    path: "/api/chat/profile",
    method: "PUT",
    body: "{",
    headers: { "content-type": "application/json" },
    expectedStatus: 400,
    assert: async (response, body) => {
      if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new Error("expected json");
      }
      if (!response.headers.get("cache-control")?.includes("no-store")) {
        throw new Error("chat profile PUT error responses must be no-store");
      }
      const json = JSON.parse(body);
      if (json.error !== "Invalid profile payload") {
        throw new Error("chat profile malformed PUT should reject invalid payload");
      }
    },
  },
  {
    name: "rewards-bad",
    path: "/api/rewards",
    method: "POST",
    body: "{",
    headers: { "content-type": "application/json" },
    expectedStatus: 400,
    assert: async (response, body) => {
      if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new Error("expected json");
      }
      if (!response.headers.get("cache-control")?.includes("no-store")) {
        throw new Error("rewards POST error responses must be no-store");
      }
      const json = JSON.parse(body);
      if (json.error !== "Invalid rewards payload") {
        throw new Error("rewards malformed POST should reject invalid payload");
      }
    },
  },
  {
    name: "epochs",
    path: "/api/epochs?epochs=1,2,3",
    assert: async (response, body) => {
      if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new Error("expected json");
      }
      JSON.parse(body);
    },
  },
  {
    name: "live-state",
    path: "/api/live-state",
    assert: async (response, body) => {
      if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new Error("expected json");
      }
      const json = JSON.parse(body);
      assertIntegerString(json.currentEpoch, "live-state currentEpoch");
      assertFiniteNumber(json.fetchedAt, "live-state fetchedAt");
      if (json.epochEndTime !== null) assertIntegerString(json.epochEndTime, "live-state epochEndTime");
      if (json.rolloverPool !== null) assertIntegerString(json.rolloverPool, "live-state rolloverPool");
      if (json.epochDuration !== null) assertIntegerString(json.epochDuration, "live-state epochDuration");
      if (json.pendingEpochDuration !== null) {
        assertIntegerString(json.pendingEpochDuration, "live-state pendingEpochDuration");
      }
      if (json.pendingEpochDurationEta !== null) {
        assertIntegerString(json.pendingEpochDurationEta, "live-state pendingEpochDurationEta");
      }
      if (json.pendingEpochDurationEffectiveFromEpoch !== null) {
        assertIntegerString(
          json.pendingEpochDurationEffectiveFromEpoch,
          "live-state pendingEpochDurationEffectiveFromEpoch",
        );
      }
      if (json.jackpotInfo !== null) {
        if (!Array.isArray(json.jackpotInfo) || json.jackpotInfo.length !== 8) {
          throw new Error("live-state jackpotInfo must be an 8-item tuple");
        }
        json.jackpotInfo.forEach((value, index) => {
          assertIntegerString(value, `live-state jackpotInfo[${index}]`);
        });
      }
      if (json.currentEpochData !== null) {
        if (!Array.isArray(json.currentEpochData) || json.currentEpochData.length !== 6) {
          throw new Error("live-state currentEpochData must be a 6-item tuple");
        }
        for (let index = 0; index < 3; index += 1) {
          assertIntegerString(json.currentEpochData[index], `live-state currentEpochData[${index}]`);
        }
        for (let index = 3; index < 6; index += 1) {
          if (typeof json.currentEpochData[index] !== "boolean") {
            throw new Error(`live-state currentEpochData[${index}] must be boolean`);
          }
        }
      }
      if (json.tileData !== null) {
        if (!Array.isArray(json.tileData.pools) || !Array.isArray(json.tileData.users)) {
          throw new Error("live-state tileData must include pools and users arrays");
        }
        if (json.tileData.pools.length !== 25 || json.tileData.users.length !== 25) {
          throw new Error("live-state tileData arrays must have 25 entries");
        }
        json.tileData.pools.forEach((value, index) => {
          assertIntegerString(value, `live-state tileData.pools[${index}]`);
        });
        json.tileData.users.forEach((value, index) => {
          assertIntegerString(value, `live-state tileData.users[${index}]`);
        });
      }
      if (json.tileUserCounts !== null) {
        if (!Array.isArray(json.tileUserCounts) || json.tileUserCounts.length !== 25) {
          throw new Error("live-state tileUserCounts must have 25 entries");
        }
        json.tileUserCounts.forEach((value, index) => {
          if (!Number.isInteger(value) || value < 0) {
            throw new Error(`live-state tileUserCounts[${index}] must be a non-negative integer`);
          }
        });
      }
      if (json.indexedTilePools !== null) {
        if (!Array.isArray(json.indexedTilePools) || json.indexedTilePools.length !== 25) {
          throw new Error("live-state indexedTilePools must have 25 entries");
        }
        json.indexedTilePools.forEach((value, index) => {
          assertIntegerString(value, `live-state indexedTilePools[${index}]`);
        });
      }
    },
  },
  {
    name: "health-sync",
    path: "/api/health/data-sync",
    assert: async (response, body) => {
      if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new Error("expected json");
      }
      const json = JSON.parse(body);
      if (typeof json.status !== "string" || json.status.length === 0) {
        throw new Error("health-sync status must be a non-empty string");
      }
      if (json.visibility !== "public" || json.redacted !== true) {
        throw new Error("health-sync public response must be redacted");
      }
      if (!json.contract || typeof json.contract !== "object") {
        throw new Error("health-sync contract object missing");
      }
      if (json.contract.currentEpoch !== null && !Number.isInteger(json.contract.currentEpoch)) {
        throw new Error("health-sync contract.currentEpoch must be an integer or null");
      }
      if (json.contract.headBlock !== null || json.contract.finalityTargetBlock !== null) {
        throw new Error("health-sync public contract block details must be redacted");
      }
      if (!json.storage || typeof json.storage !== "object") {
        throw new Error("health-sync storage object missing");
      }
      if (
        json.storage.lastIndexedBlock !== null ||
        json.storage.repairCursorBlock !== null ||
        json.storage.latestStoredJackpotBlock !== null ||
        json.storage.latestRewardClaimBlock !== null
      ) {
        throw new Error("health-sync public storage block details must be redacted");
      }
      if (json.storage.lagBlocks !== null && !Number.isFinite(json.storage.lagBlocks)) {
        throw new Error("health-sync storage.lagBlocks must be finite or null");
      }
      if (
        json.storage.lagToFinalityTargetBlocks !== null &&
        !Number.isFinite(json.storage.lagToFinalityTargetBlocks)
      ) {
        throw new Error("health-sync storage.lagToFinalityTargetBlocks must be finite or null");
      }
      if (!json.env || typeof json.env.indexerFinalityBlocks !== "string") {
        throw new Error("health-sync env.indexerFinalityBlocks must be present");
      }
      if (json.env.dbPath !== null || json.env.deployBlock !== null || json.env.lagWarnBlocks !== null) {
        throw new Error("health-sync public env details must be redacted");
      }
      if (
        json.indexer?.run?.fromBlock !== null ||
        json.indexer?.run?.toBlock !== null ||
        json.indexer?.run?.lastProcessedBlock !== null ||
        json.indexer?.run?.totalLogs !== undefined
      ) {
        throw new Error("health-sync public indexer run details must be redacted");
      }
      if (!Array.isArray(json.hints)) {
        throw new Error("health-sync hints must be an array");
      }
    },
  },
  {
    name: "health-runtime",
    path: "/api/health/runtime",
    assert: async (response, body) => {
      if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new Error("expected json");
      }
      if (!response.headers.get("cache-control")?.includes("no-store")) {
        throw new Error("health-runtime public responses must be no-store");
      }
      const json = JSON.parse(body);
      if (json.status !== "ok" || json.visibility !== "public" || json.redacted !== true) {
        throw new Error("health-runtime public response must be redacted");
      }
      if (!json.metrics || typeof json.metrics !== "object" || Object.keys(json.metrics).length !== 0) {
        throw new Error("health-runtime public metrics must be redacted");
      }
      if (!Number.isFinite(json.ts)) {
        throw new Error("health-runtime timestamp must be finite");
      }
      if (!json.publicConfig || typeof json.publicConfig !== "object") {
        throw new Error("health-runtime must include public config diagnostics");
      }
      if (!Number.isInteger(json.publicConfig.chainId)) {
        throw new Error("health-runtime public config must include chain id");
      }
      if (typeof json.publicConfig.chainName !== "string" || json.publicConfig.chainName.length === 0) {
        throw new Error("health-runtime public config must include chain name");
      }
      if (typeof json.publicConfig.privyAppIdConfigured !== "boolean") {
        throw new Error("health-runtime public config must include Privy app id status");
      }
      if (typeof json.publicConfig.privyFallbackActive !== "boolean") {
        throw new Error("health-runtime public config must include Privy fallback status");
      }
      if (
        typeof json.publicConfig.eip7702Enabled !== "boolean" ||
        typeof json.publicConfig.eip7702MiningEnabled !== "boolean"
      ) {
        throw new Error("health-runtime public config must include EIP-7702 disabled-state diagnostics");
      }
      if (typeof json.publicConfig.readOnlyMode !== "boolean") {
        throw new Error("health-runtime public config must include read-only mode diagnostics");
      }
    },
  },
  {
    name: "jackpots",
    path: "/api/jackpots",
    assert: async (response, body) => {
      if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new Error("expected json");
      }
      const json = JSON.parse(body);
      if (!Array.isArray(json.jackpots)) {
        throw new Error("jackpots payload missing jackpots array");
      }
      for (const row of json.jackpots.slice(0, 20)) {
        assertIntegerString(row.epoch, "jackpot epoch");
        if (row.kind !== "daily" && row.kind !== "weekly") {
          throw new Error(`jackpot ${row.epoch} has invalid kind`);
        }
        assertDecimalString(row.amount, `jackpot ${row.epoch} amount`);
        assertFiniteNumber(row.amountNum, `jackpot ${row.epoch} amountNum`);
        assertIntegerString(row.blockNumber, `jackpot ${row.epoch} blockNumber`);
        assertOptionalTxHash(row.txHash, `jackpot ${row.epoch} txHash`);
        if (row.timestamp !== undefined && row.timestamp !== null) {
          assertFiniteNumber(row.timestamp, `jackpot ${row.epoch} timestamp`);
        }
      }
    },
  },
  {
    name: "global-stats",
    path: "/api/global-stats",
    assert: async (response, body) => {
      if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new Error("expected json");
      }
      if (!response.headers.get("cache-control")?.includes("no-store")) {
        throw new Error("global-stats responses must be no-store");
      }
      const json = JSON.parse(body);
      assertIntegerString(json.totalVolumeWei, "global-stats totalVolumeWei");
      assertIntegerString(json.totalBurnWei, "global-stats totalBurnWei");
      assertIntegerString(json.lastIndexedBlock, "global-stats lastIndexedBlock");
      if (!Number.isSafeInteger(json.resolvedEpochs) || json.resolvedEpochs < 0) {
        throw new Error("global-stats resolvedEpochs must be a non-negative safe integer");
      }
    },
  },
  {
    name: "leaderboards",
    path: "/api/leaderboards",
    assert: async (response, body) => {
      if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new Error("expected json");
      }
      const json = JSON.parse(body);
      const boardNames = ["biggestSingleWin", "luckiest", "oneTileWonder", "mostWins", "whales", "underdog"];
      for (const boardName of boardNames) {
        const rows = json[boardName];
        if (!Array.isArray(rows)) {
          throw new Error(`leaderboards payload missing ${boardName} array`);
        }
        for (const row of rows.slice(0, 20)) {
          if (!Number.isInteger(row.rank) || row.rank <= 0) {
            throw new Error(`${boardName} entry rank must be a positive integer`);
          }
          assertAddress(row.address, `${boardName} entry address`);
          if (typeof row.value !== "string" || row.value.length === 0) {
            throw new Error(`${boardName} entry value must be a non-empty string`);
          }
          assertFiniteNumber(row.valueNum, `${boardName} entry valueNum`);
        }
      }
      if (!Array.isArray(json.luckyTile)) {
        throw new Error("leaderboards payload missing luckyTile array");
      }
      for (const row of json.luckyTile.slice(0, 25)) {
        if (!Number.isInteger(row.tileId) || row.tileId < 1 || row.tileId > 25) {
          throw new Error("luckyTile tileId must be between 1 and 25");
        }
        if (!Number.isInteger(row.wins) || row.wins < 0) {
          throw new Error("luckyTile wins must be a non-negative integer");
        }
        assertFiniteNumber(row.pct, "luckyTile pct");
      }
    },
  },
  {
    name: "chat-messages",
    path: "/api/chat/messages",
    assert: async (response, body) => {
      if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new Error("expected json");
      }
      JSON.parse(body);
    },
  },
  {
    name: "recent-wins",
    path: "/api/recent-wins",
    assert: async (response, body) => {
      if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new Error("expected json");
      }
      const json = JSON.parse(body);
      if (!Array.isArray(json.wins)) {
        throw new Error("recent wins payload missing wins array");
      }
      for (const row of json.wins.slice(0, 20)) {
        assertIntegerString(row.epoch, "recent win epoch");
        assertAddress(row.user, `recent win ${row.epoch} user`);
        assertDecimalString(row.amount, `recent win ${row.epoch} amount`);
        assertDecimalString(row.amountRaw, `recent win ${row.epoch} amountRaw`);
        if (row.tileId !== undefined && (!Number.isInteger(row.tileId) || row.tileId < 1 || row.tileId > 25)) {
          throw new Error(`recent win ${row.epoch} tileId must be between 1 and 25`);
        }
        if (
          row.jackpotKind !== undefined &&
          row.jackpotKind !== "daily" &&
          row.jackpotKind !== "weekly" &&
          row.jackpotKind !== "daily-weekly"
        ) {
          throw new Error(`recent win ${row.epoch} has invalid jackpotKind`);
        }
        assertOptionalTxHash(row.txHash, `recent win ${row.epoch} txHash`);
        if (row.blockNumber !== undefined) {
          assertIntegerString(row.blockNumber, `recent win ${row.epoch} blockNumber`);
        }
      }
    },
  },
  {
    name: "deposits",
    path: `/api/deposits?user=${ZERO_ADDRESS}`,
    assert: async (response, body) => {
      if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new Error("expected json");
      }
      const json = JSON.parse(body);
      if (!Array.isArray(json.deposits)) {
        throw new Error("deposits payload missing deposits array");
      }
      for (const row of json.deposits.slice(0, 20)) {
        assertDecimalString(row.totalAmount, `deposit row ${row.epoch} totalAmount`);
        assertFiniteNumber(row.totalAmountNum, `deposit row ${row.epoch} totalAmountNum`);
        if (!Array.isArray(row.tileIds)) continue;
        const uniqueTileCount = new Set(row.tileIds).size;
        if (uniqueTileCount !== row.tileIds.length) {
          throw new Error(`deposit row ${row.epoch} still has duplicate tile ids`);
        }
        if (Array.isArray(row.amounts) && row.amounts.length !== row.tileIds.length) {
          throw new Error(`deposit row ${row.epoch} has mismatched amounts length`);
        }
        for (const amount of row.amounts ?? []) {
          assertDecimalString(amount, `deposit row ${row.epoch} amount`);
        }
      }
    },
  },
  {
    name: "deposits-rewards",
    path: `/api/deposits?user=${ZERO_ADDRESS}&includeRewards=1`,
    assert: async (response, body) => {
      if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new Error("expected json");
      }
      const json = JSON.parse(body);
      if (json.epochs && typeof json.epochs === "object") {
        const epochEntry = Object.values(json.epochs)[0];
        if (epochEntry && typeof epochEntry === "object") {
          if (!("isDailyJackpot" in epochEntry) || !("isWeeklyJackpot" in epochEntry)) {
            throw new Error("deposits rewards payload missing jackpot flags");
          }
        }
      }
      if (json.rewards && typeof json.rewards === "object") {
        for (const [epoch, reward] of Object.entries(json.rewards).slice(0, 20)) {
          if (!reward || typeof reward !== "object") {
            throw new Error(`reward ${epoch} must be an object`);
          }
          assertDecimalString(reward.reward, `reward ${epoch} reward`);
          assertDecimalString(reward.rewardPool, `reward ${epoch} rewardPool`);
          assertDecimalString(reward.winningTilePool, `reward ${epoch} winningTilePool`);
          assertDecimalString(reward.userWinningAmount, `reward ${epoch} userWinningAmount`);
          if (typeof reward.winningTile !== "number" || !Number.isInteger(reward.winningTile)) {
            throw new Error(`reward ${epoch} winningTile must be an integer`);
          }
        }
      }
    },
  },
  {
    name: "rebates",
    path: `/api/rebates?user=${ZERO_ADDRESS}`,
    assert: async (response, body) => {
      if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new Error("expected json");
      }
      JSON.parse(body);
    },
  },
];

async function fetchWithTimeout(url, options) {
  return fetchWithCustomTimeout(url, TIMEOUT_MS, options);
}

async function fetchWithCustomTimeout(url, timeoutMs, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const headers = {
      "cache-control": "no-cache",
      ...(options.headers ?? {}),
    };
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function isRetryableError(error) {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return message.includes("aborted") || message.includes("fetch failed") || message.includes("timeout");
}

async function delay(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function runCheck(check) {
  const url = `${BASE_URL}${check.path}`;
  let lastError = null;

  for (let attempt = 1; attempt <= RETRYABLE_ATTEMPTS; attempt += 1) {
    const startedAt = performance.now();
    try {
      const response = await fetchWithTimeout(url, {
        method: check.method,
        body: check.body,
        headers: check.headers,
      });
      const body = await response.text();
      const elapsedMs = Math.round(performance.now() - startedAt);
      const expectedStatus = check.expectedStatus ?? 200;
      const expectedStatuses = check.expectedStatuses ?? [expectedStatus];

      if (!expectedStatuses.includes(response.status)) {
        throw new Error(`status ${response.status}, expected ${expectedStatuses.join(" or ")}`);
      }

      await check.assert(response, body);
      console.log(`PASS ${check.name.padEnd(14)} ${String(response.status).padEnd(3)} ${String(elapsedMs).padStart(5)} ms ${check.path}`);
      return null;
    } catch (error) {
      const elapsedMs = Math.round(performance.now() - startedAt);
      const message = error instanceof Error ? error.message : String(error);
      lastError = { check: check.name, path: check.path, message };

      if (attempt < RETRYABLE_ATTEMPTS && isRetryableError(error)) {
        console.warn(`RETRY ${check.name.padEnd(13)} attempt ${attempt + 1}/${RETRYABLE_ATTEMPTS} after ${String(elapsedMs).padStart(5)} ms :: ${message}`);
        await delay(RETRY_DELAY_MS);
        continue;
      }

      console.error(`FAIL ${check.name.padEnd(14)} --- ${String(elapsedMs).padStart(5)} ms ${check.path} :: ${message}`);
      return lastError;
    }
  }

  return lastError;
}

async function warmUpChecks() {
  console.log(`Warm-up timeout: ${WARMUP_TIMEOUT_MS} ms`);

  for (const check of checks) {
    const url = `${BASE_URL}${check.path}`;
    const startedAt = performance.now();

    try {
      const response = await fetchWithCustomTimeout(url, WARMUP_TIMEOUT_MS);
      await response.text();
      const elapsedMs = Math.round(performance.now() - startedAt);
      console.log(`WARM ${check.name.padEnd(14)} ${String(response.status).padEnd(3)} ${String(elapsedMs).padStart(5)} ms ${check.path}`);
    } catch (error) {
      const elapsedMs = Math.round(performance.now() - startedAt);
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`WARM ${check.name.padEnd(14)} --- ${String(elapsedMs).padStart(5)} ms ${check.path} :: ${message}`);
    }
  }
}

async function run() {
  console.log(`Smoke base URL: ${BASE_URL}`);
  if (!SKIP_WARMUP) {
    await warmUpChecks();
  }
  const failures = [];

  for (const check of checks) {
    const failure = await runCheck(check);
    if (failure) {
      failures.push(failure);
    }
  }

  if (failures.length > 0) {
    console.error(`\nSmoke failures: ${failures.length}`);
    process.exit(1);
  }

  console.log("\nSmoke HTTP checks passed.");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
