import { performance } from "node:perf_hooks";

const BASE_URL = process.env.SMOKE_BASE_URL || "http://localhost:3000";
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 60_000);
const WARMUP_TIMEOUT_MS = Number(process.env.SMOKE_WARMUP_TIMEOUT_MS || 120_000);
const SKIP_WARMUP = process.env.SMOKE_SKIP_WARMUP === "1";
const RETRYABLE_ATTEMPTS = Number(process.env.SMOKE_RETRY_ATTEMPTS || 3);
const RETRY_DELAY_MS = Number(process.env.SMOKE_RETRY_DELAY_MS || 1_500);
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000001";
const HOME_MARKERS = ["LORE", "Hot Tiles", "Analytics", "FAQ", "Leaderboards"];

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
    name: "jackpots",
    path: "/api/jackpots",
    assert: async (response, body) => {
      if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new Error("expected json");
      }
      JSON.parse(body);
    },
  },
  {
    name: "leaderboards",
    path: "/api/leaderboards",
    assert: async (response, body) => {
      if (!response.headers.get("content-type")?.includes("application/json")) {
        throw new Error("expected json");
      }
      JSON.parse(body);
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
      JSON.parse(body);
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
        if (!Array.isArray(row.tileIds)) continue;
        const uniqueTileCount = new Set(row.tileIds).size;
        if (uniqueTileCount !== row.tileIds.length) {
          throw new Error(`deposit row ${row.epoch} still has duplicate tile ids`);
        }
        if (Array.isArray(row.amounts) && row.amounts.length !== row.tileIds.length) {
          throw new Error(`deposit row ${row.epoch} has mismatched amounts length`);
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

async function fetchWithTimeout(url) {
  return fetchWithCustomTimeout(url, TIMEOUT_MS);
}

async function fetchWithCustomTimeout(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        "cache-control": "no-cache",
      },
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
      const response = await fetchWithTimeout(url);
      const body = await response.text();
      const elapsedMs = Math.round(performance.now() - startedAt);

      if (!response.ok) {
        throw new Error(`status ${response.status}`);
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
