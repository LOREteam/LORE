import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  describeAdvisoryError,
  fetchOfficialBugDatabase,
  parseContentLengthHeader,
  readBoundedJsonResponse,
  runCompilerAdvisoryCli,
  validateCompilerEntry,
} from "./check-solidity-compiler-advisories.mjs";

const MAX_BYTES = 512 * 1024;

function responseFromChunks(chunks, contentLength = null) {
  let index = 0;
  let cancelled = false;
  return {
    headers: { get: (name) => name.toLowerCase() === "content-length" ? contentLength : null },
    body: {
      getReader: () => ({
        read: async () => index < chunks.length
          ? { done: false, value: chunks[index++] }
          : { done: true, value: undefined },
        cancel: async () => { cancelled = true; },
      }),
    },
    wasCancelled: () => cancelled,
  };
}

export async function runCompilerAdvisoryBehaviorTests() {
  assert.equal(parseContentLengthHeader(null), null);
  assert.equal(parseContentLengthHeader(""), null);
  assert.equal(parseContentLengthHeader("0"), 0);
  assert.equal(parseContentLengthHeader(String(MAX_BYTES)), MAX_BYTES);
  for (const invalid of ["00", "01", "+1", "-1", "1.0", "1e3", " 1", "1 ", "9007199254740992"]) {
    assert.throws(() => parseContentLengthHeader(invalid), /invalid content-length/);
  }

  const encoded = new TextEncoder().encode('{"0.8.36":{"bugs":[],"released":"2026-07-09"}}');
  assert.deepEqual(await readBoundedJsonResponse(responseFromChunks([
    encoded.slice(0, 11),
    encoded.slice(11),
  ], String(encoded.byteLength))), {
    "0.8.36": { bugs: [], released: "2026-07-09" },
  });
  const oversized = responseFromChunks([new Uint8Array(MAX_BYTES), new Uint8Array([1])]);
  await assert.rejects(() => readBoundedJsonResponse(oversized), /response is too large/);
  assert.equal(oversized.wasCancelled(), true);
  await assert.rejects(
    () => readBoundedJsonResponse(responseFromChunks([new Uint8Array([0xff])])),
    TypeError,
  );

  assert.deepEqual(validateCompilerEntry({ bugs: [], released: "2026-07-09" }), {
    bugs: [],
    released: "2026-07-09",
  });
  assert.throws(() => validateCompilerEntry({ bugs: ["SOL-2099-1"], released: "2026-07-09" }), /SOL-2099-1/);
  assert.throws(() => validateCompilerEntry({ bugs: [], released: "2099-01-01" }), /Unexpected 0\.8\.36 release date/);

  let fetchCalls = 0;
  const signals = [];
  const database = await fetchOfficialBugDatabase({
    timeoutSignal: (timeoutMs) => {
      signals.push(timeoutMs);
      return { kind: "test-signal" };
    },
    fetchImpl: async (url, options) => {
      fetchCalls += 1;
      assert.equal(url, "https://raw.githubusercontent.com/argotorg/solidity/develop/docs/bugs_by_version.json");
      assert.deepEqual(options.headers, { accept: "application/json" });
      assert.deepEqual(options.signal, { kind: "test-signal" });
      if (fetchCalls === 1) throw new Error("transient failure");
      return new Response(JSON.stringify({ "0.8.36": { bugs: [], released: "2026-07-09" } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
  assert.equal(fetchCalls, 2);
  assert.deepEqual(signals, [15_000, 15_000]);
  assert.equal(database["0.8.36"].released, "2026-07-09");

  let failedCalls = 0;
  await assert.rejects(
    () => fetchOfficialBugDatabase({
      fetchImpl: async () => {
        failedCalls += 1;
        throw new Error("still unavailable");
      },
      timeoutSignal: () => ({ kind: "test-signal" }),
    }),
    /still unavailable/,
  );
  assert.equal(failedCalls, 2);

  const successLines = [];
  const successExit = await runCompilerAdvisoryCli({
    argv: [],
    fetchImpl: async () => new Response(JSON.stringify({
      "0.8.36": { bugs: [], released: "2026-07-09" },
    }), { status: 200 }),
    timeoutSignal: () => ({ kind: "test-signal" }),
    writeLine: (line) => successLines.push(line),
  });
  assert.equal(successExit, 0);
  assert.equal(successLines.length, 1);
  assert.deepEqual(JSON.parse(successLines[0]), {
    status: "pass",
    compilerVersion: "0.8.36",
    released: "2026-07-09",
    knownBugCount: 0,
    source: "official-solidity-bug-database",
  });

  const knownBugLines = [];
  const knownBugExit = await runCompilerAdvisoryCli({
    argv: ["--summary-only"],
    fetchImpl: async () => new Response(JSON.stringify({
      "0.8.36": { bugs: ["SOL-2099-1"], released: "2026-07-09" },
    }), { status: 200 }),
    timeoutSignal: () => ({ kind: "test-signal" }),
    writeLine: (line) => knownBugLines.push(line),
  });
  assert.equal(knownBugExit, 1);
  assert.equal(knownBugLines.length, 1);
  assert.match(JSON.parse(knownBugLines[0]).issue, /SOL-2099-1/);

  const summaryLines = [];
  const hostile = "C:\\Users\\operator\\private\\bugs.json S-1-5-21-111-222-333-1001 https://user:secret@example.invalid/db";
  const summaryExit = await runCompilerAdvisoryCli({
    argv: ["--summary-only"],
    fetchImpl: async () => { throw new Error(hostile); },
    timeoutSignal: () => ({ kind: "test-signal" }),
    writeLine: (line) => summaryLines.push(line),
  });
  assert.equal(summaryExit, 1);
  assert.equal(summaryLines.length, 1);
  const summary = JSON.parse(summaryLines[0]);
  assert.equal(summary.status, "fail");
  assert.equal(summary.compilerVersion, "0.8.36");
  assert.equal(summary.source, "official-solidity-bug-database");
  assert.equal(summary.issue.length <= 220, true);
  assert.doesNotMatch(summaryLines[0], /operator|S-1-5-21|user:secret|private|example\.invalid/i);
  assert.match(describeAdvisoryError(new Error(hostile)), /redacted/i);

  await assert.rejects(
    () => runCompilerAdvisoryCli({
      argv: [],
      fetchImpl: async () => { throw new Error("no silent fallback"); },
      timeoutSignal: () => ({ kind: "test-signal" }),
      writeLine: () => assert.fail("non-summary failure must not print a false-green result"),
    }),
    /no silent fallback/,
  );

  const importProbe = spawnSync(process.execPath, [
    "--input-type=module",
    "--eval",
    'globalThis.fetch=()=>{throw new Error("fetch-on-import")}; await import("./scripts/check-solidity-compiler-advisories.mjs");',
  ], { cwd: process.cwd(), encoding: "utf8", timeout: 10_000 });
  assert.equal(importProbe.status, 0);
  assert.equal(importProbe.stdout, "");
  assert.equal(importProbe.stderr, "");

  const selfTestProbe = spawnSync(process.execPath, [
    "scripts/check-solidity-compiler-advisories.mjs",
    "--self-test",
  ], { cwd: process.cwd(), encoding: "utf8", timeout: 10_000 });
  assert.equal(selfTestProbe.status, 0);
  assert.equal(selfTestProbe.stderr, "");
  assert.deepEqual(JSON.parse(selfTestProbe.stdout), { status: "pass", mode: "self-test" });
}
