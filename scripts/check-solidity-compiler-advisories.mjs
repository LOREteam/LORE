import assert from "node:assert/strict";
import { redactProofText } from "./redact-proof-output.mjs";

const COMPILER_VERSION = "0.8.36";
const EXPECTED_RELEASE_DATE = "2026-07-09";
const BUG_DATABASE_URL =
  "https://raw.githubusercontent.com/argotorg/solidity/develop/docs/bugs_by_version.json";
const MAX_BUG_DATABASE_BYTES = 512 * 1024;
const CONTENT_LENGTH_RE = /^(?:0|[1-9]\d{0,15})$/;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const summaryOnly = process.argv.includes("--summary-only");

function describeAdvisoryError(error) {
  const message = error instanceof Error ? error.message : String(error);
  const safe = redactProofText(message).replace(/\s+/g, " ").trim();
  return safe.length > 220 ? `${safe.slice(0, 217)}...` : safe;
}

function parseContentLengthHeader(value) {
  if (value == null || value === "") return null;
  if (!CONTENT_LENGTH_RE.test(value)) {
    throw new Error("Official Solidity bug database response has invalid content-length");
  }
  const parsed = BigInt(value);
  if (parsed > MAX_SAFE_INTEGER_BIGINT) {
    throw new Error("Official Solidity bug database response has invalid content-length");
  }
  return Number(parsed);
}

async function readBoundedJsonResponse(response) {
  const contentLength = parseContentLengthHeader(response.headers.get("content-length"));
  if (contentLength !== null && contentLength > MAX_BUG_DATABASE_BYTES) {
    throw new Error("Official Solidity bug database response is too large");
  }
  if (!response.body) throw new Error("Official Solidity bug database response is empty");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let totalBytes = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_BUG_DATABASE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error("Official Solidity bug database response is too large");
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return JSON.parse(text);
}

async function fetchOfficialBugDatabase() {
  let lastError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const response = await fetch(BUG_DATABASE_URL, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        throw new Error(`Official Solidity bug database returned HTTP ${response.status}`);
      }
      return readBoundedJsonResponse(response);
    } catch (error) {
      lastError = error;
      if (attempt === 2) break;
    }
  }
  throw lastError;
}

function validateCompilerEntry(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    throw new Error(`Official Solidity bug database has no ${COMPILER_VERSION} entry`);
  }
  if (entry.released !== EXPECTED_RELEASE_DATE) {
    throw new Error(
      `Unexpected ${COMPILER_VERSION} release date: ${String(entry.released)}`,
    );
  }
  if (!Array.isArray(entry.bugs)) {
    throw new Error(`Official Solidity bug database has invalid ${COMPILER_VERSION} bugs`);
  }
  if (entry.bugs.length > 0) {
    throw new Error(
      `Solidity ${COMPILER_VERSION} has known compiler bugs: ${entry.bugs.join(", ")}`,
    );
  }
  return entry;
}

async function runSelfTest() {
  assert.deepEqual(validateCompilerEntry({ bugs: [], released: EXPECTED_RELEASE_DATE }), {
    bugs: [],
    released: EXPECTED_RELEASE_DATE,
  });
  assert.throws(() => validateCompilerEntry(undefined), /has no 0\.8\.36 entry/);
  assert.throws(
    () => validateCompilerEntry({ bugs: ["SOL-2099-1"], released: EXPECTED_RELEASE_DATE }),
    /SOL-2099-1/,
  );
  assert.throws(
    () => validateCompilerEntry({ bugs: [], released: "2099-01-01" }),
    /Unexpected 0\.8\.36 release date/,
  );
  await assert.rejects(
    () =>
      readBoundedJsonResponse(
        new Response("{}", {
          headers: { "content-length": String(MAX_BUG_DATABASE_BYTES + 1) },
        }),
    ),
    /response is too large/,
  );
  await assert.rejects(
    () =>
      readBoundedJsonResponse(
        {
          headers: { get: (name) => (name.toLowerCase() === "content-length" ? String(Number.MAX_SAFE_INTEGER) : null) },
          get body() {
            throw new Error("safe-max Solidity bug database response body must not be read");
          },
        },
      ),
    /response is too large/,
  );
  await assert.rejects(
    () =>
      readBoundedJsonResponse(
        new Response("{}", {
          headers: { "content-length": "1e3" },
        }),
    ),
    /invalid content-length/,
  );
  await assert.rejects(
    () =>
      readBoundedJsonResponse(
        new Response("{}", {
          headers: { "content-length": (BigInt(Number.MAX_SAFE_INTEGER) + 1n).toString() },
        }),
      ),
    /invalid content-length/,
  );
  await assert.rejects(
    () =>
      readBoundedJsonResponse(
        new Response(new Uint8Array([...new TextEncoder().encode('{"ok":"'), 0xff, ...new TextEncoder().encode('"}')])),
      ),
    TypeError,
  );
  console.log(JSON.stringify({ status: "pass", mode: "self-test" }));
}

async function runAdvisoryCheck() {
  const database = await fetchOfficialBugDatabase();
  const entry = validateCompilerEntry(database?.[COMPILER_VERSION]);
  console.log(
    JSON.stringify({
      status: "pass",
      compilerVersion: COMPILER_VERSION,
      released: entry.released,
      knownBugCount: entry.bugs.length,
      source: "official-solidity-bug-database",
    }),
  );
}

try {
  if (process.argv.includes("--self-test")) {
    await runSelfTest();
  } else {
    await runAdvisoryCheck();
  }
} catch (error) {
  if (!summaryOnly) throw error;
  console.log(
    JSON.stringify({
      status: "fail",
      compilerVersion: COMPILER_VERSION,
      issue: describeAdvisoryError(error),
      source: "official-solidity-bug-database",
    }),
  );
  process.exitCode = 1;
}
