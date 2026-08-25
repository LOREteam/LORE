import assert from "node:assert/strict";
import { fork, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const PLATFORM = "linux/amd64";
const PARITY_HOST = "valkey-parity.playlore.xyz";
const ARTIFACT_PATH = resolve(REPO_ROOT, "artifacts", "valkey-runtime", "valkey-rest-rate-limit.json");
const PROTECTED_DB_PATH = resolve(REPO_ROOT, "data", "lore-v10.sqlite");
const TEMP_PREFIX = "lore-valkey-rest-";
const RESPONSE_LIMIT_BYTES = 65_536;
const COMMAND_OUTPUT_LIMIT_BYTES = 65_536;
const COMMAND_TIMEOUT_MS = 15_000;
const OWNERSHIP_LABEL = "lore.parity.run";
const ADMIN_SESSION_COOKIE = "lore_admin_session";
const ADMIN_SESSION_IDLE_TTL_MS = 15 * 60 * 1_000;
const ADMIN_SESSION_ABSOLUTE_TTL_MS = 8 * 60 * 60 * 1_000;
const SOURCE_BINDING_PATHS = Object.freeze([
  "app/api/_lib/adminSession.ts",
  "app/api/_lib/externalRateLimit.ts",
  "app/lib/adminAuth.ts",
  "package.json",
  "scripts/test-valkey-rest-rate-limit.mjs",
  "server/db.ts",
  "server/storage.ts",
]);

const IMAGES = Object.freeze({
  valkey: Object.freeze({
    repository: "valkey/valkey",
    selectionTag: "8.1.9",
    indexDigest: "sha256:f0ba225266310efba5fb33383e21c64fbd07907304224786c780606e7ebd7327",
    platformDigest: "sha256:3d9b17f2fa3d938c63c0e951a669f8752f57fdee2d771a757830f66b4c8cc0bf",
  }),
  restFacade: Object.freeze({
    repository: "hiett/serverless-redis-http",
    selectionTag: "0.0.10",
    indexDigest: "sha256:65128347949bca511e448fd7238780d624573d74c22b79155a7563db19e9b678",
    platformDigest: "sha256:01d66211581ebd552e07292e3b73f1f475e52c48aa725049809aa09a7ba23238",
  }),
  httpsProxy: Object.freeze({
    repository: "caddy",
    selectionTag: "2.11.4-alpine",
    indexDigest: "sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648",
    platformDigest: "sha256:98eb57d882ccd5213d1688764db10c1ca2c58a1ca3a6717a3411ad798f7a423a",
  }),
});

const secrets = new Set();

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function withTimeout(promise, timeoutMs, message) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function snapshotFile(path) {
  try {
    const info = await stat(path, { bigint: true });
    assert.equal(info.isFile(), true, `${path} must be a regular file`);
    const content = await readFile(path);
    return {
      exists: true,
      mtimeNs: info.mtimeNs.toString(),
      sha256: sha256(content),
      size: Number(info.size),
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false };
    throw error;
  }
}

async function snapshotProtectedDb() {
  return {
    base: await snapshotFile(PROTECTED_DB_PATH),
    shm: await snapshotFile(`${PROTECTED_DB_PATH}-shm`),
    wal: await snapshotFile(`${PROTECTED_DB_PATH}-wal`),
  };
}

function imageReference(image, digest = image.platformDigest) {
  return `${image.repository}@${digest}`;
}

function redact(value) {
  let redacted = String(value ?? "");
  for (const secret of secrets) {
    if (secret) redacted = redacted.split(secret).join("[redacted]");
  }
  return redacted;
}

function run(command, args, {
  allowFailure = false,
  environment = process.env,
  stdin = null,
  timeoutMs = COMMAND_TIMEOUT_MS,
} = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: REPO_ROOT,
      env: environment,
      stdio: [stdin === null ? "ignore" : "pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    let outputBytes = 0;
    let terminationReason = null;
    let terminationDeadline = null;
    let settled = false;
    let timeout = null;
    const clearTimers = () => {
      clearTimeout(timeout);
      clearTimeout(terminationDeadline);
    };
    const rejectOnce = (error) => {
      if (settled) return;
      settled = true;
      clearTimers();
      reject(error);
    };
    const terminate = (reason) => {
      if (terminationReason !== null) return;
      terminationReason = reason;
      try {
        child.kill("SIGKILL");
      } catch (error) {
        rejectOnce(new AggregateError([error], `${command} ${args[0] ?? "command"} could not be terminated after ${reason}`));
        return;
      }
      terminationDeadline = setTimeout(() => {
        rejectOnce(new Error(`${command} ${args[0] ?? "command"} ${reason} and did not exit within 2s`));
      }, 2_000);
    };
    const collect = (target) => (chunk) => {
      outputBytes += chunk.byteLength;
      if (outputBytes > COMMAND_OUTPUT_LIMIT_BYTES) {
        terminate(`output exceeded ${COMMAND_OUTPUT_LIMIT_BYTES} bytes`);
        return;
      }
      target.push(chunk);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    timeout = setTimeout(() => terminate(`timed out after ${timeoutMs}ms`), timeoutMs);
    child.on("error", (error) => {
      rejectOnce(error);
    });
    child.on("close", (status) => {
      if (settled) return;
      settled = true;
      clearTimers();
      const result = {
        status: status ?? 1,
        stdout: redact(Buffer.concat(stdout).toString("utf8").trim()),
        stderr: redact(Buffer.concat(stderr).toString("utf8").trim()),
      };
      if (terminationReason !== null) {
        reject(new Error(`${command} ${args[0] ?? "command"} ${terminationReason}`));
        return;
      }
      if (result.status !== 0 && !allowFailure) {
        reject(new Error(`${command} ${args[0] ?? "command"} failed (${result.status}): ${result.stderr || result.stdout || "no diagnostic"}`));
        return;
      }
      resolvePromise(result);
    });
    if (stdin !== null) child.stdin.end(stdin);
  });
}

function docker(args, options) {
  return run("docker", args, options);
}

function git(args, options) {
  return run("git", args, options);
}

function minimalChildEnvironment(values) {
  const inherited = {};
  for (const name of ["ComSpec", "SystemRoot", "TEMP", "TMP", "WINDIR"]) {
    if (process.env[name]) inherited[name] = process.env[name];
  }
  return {
    ...inherited,
    NODE_ENV: "test",
    ...values,
  };
}

function normalizeHeaders(headers) {
  const normalized = {};
  for (const [name, value] of new Headers(headers).entries()) normalized[name] = value;
  return normalized;
}

function createPinnedHttpsFetch({ ca, endpoint, expectedToken = null, observation }) {
  const expected = new URL(endpoint);
  assert.equal(expected.protocol, "https:");
  assert.equal(expected.hostname, PARITY_HOST);
  assert.ok(expected.port);
  return (input, init = {}) => new Promise((resolvePromise, reject) => {
    const requested = new URL(String(input));
    if (
      requested.protocol !== expected.protocol ||
      requested.hostname !== expected.hostname ||
      requested.port !== expected.port ||
      requested.pathname !== expected.pathname
    ) {
      reject(new Error("parity transport refused an unexpected endpoint"));
      return;
    }
    const body = init.body === undefined ? null : Buffer.from(String(init.body));
    const headers = normalizeHeaders(init.headers);
    const command = body === null ? null : JSON.parse(body.toString("utf8"));
    const commandName = Array.isArray(command) ? command[0] : null;
    observation.lastRequest = {
      argumentCount: Array.isArray(command) && commandName === "EVAL" ? Math.max(0, command.length - 4) : null,
      bearerMatches: expectedToken === null ? null : headers.authorization === `Bearer ${expectedToken}`,
      commandName,
      contentType: headers["content-type"] ?? null,
      keyCount: Array.isArray(command) && commandName === "EVAL" ? command[2] : null,
      method: init.method ?? "GET",
      redisKey: Array.isArray(command) && commandName === "EVAL" ? command[3] : command?.[1] ?? null,
      scriptSha256: Array.isArray(command) && commandName === "EVAL" && typeof command[1] === "string"
        ? sha256(command[1])
        : null,
      ttlMsArgument: Array.isArray(command) && (
        (commandName === "SET" && command.length === 6) ||
        (commandName === "EVAL" && command.length === 7)
      ) && /^\d+$/.test(String(command.at(-1)))
        ? String(command.at(-1))
        : null,
    };
    headers.host = PARITY_HOST;
    if (body !== null) headers["content-length"] = String(body.byteLength);
    const request = httpsRequest({
      ca,
      headers,
      hostname: "127.0.0.1",
      method: init.method ?? "GET",
      path: `${requested.pathname}${requested.search}`,
      port: Number(expected.port),
      rejectUnauthorized: true,
      servername: PARITY_HOST,
      signal: init.signal,
    });
    request.setTimeout(3_000, () => request.destroy(new Error("parity HTTPS request timed out")));
    request.on("response", (response) => {
      const socket = response.socket;
      if (!socket.encrypted || socket.authorized !== true) {
        response.resume();
        reject(new Error("parity HTTPS certificate was not authorized"));
        return;
      }
      observation.tlsAuthorized = true;
      observation.tlsProtocol = socket.getProtocol() ?? "unknown";
      observation.requestCount += 1;
      const responseHeaders = new Headers();
      for (const [name, value] of Object.entries(response.headers)) {
        if (Array.isArray(value)) {
          for (const entry of value) responseHeaders.append(name, entry);
        } else if (value !== undefined) {
          responseHeaders.set(name, value);
        }
      }
      resolvePromise(new Response(Readable.toWeb(response), {
        headers: responseHeaders,
        status: response.statusCode ?? 500,
        statusText: response.statusMessage ?? "",
      }));
    });
    request.on("error", reject);
    if (body !== null) request.write(body);
    request.end();
  });
}

async function readBoundedJson(response) {
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.ok(bytes.byteLength <= RESPONSE_LIMIT_BYTES, "REST facade response exceeded the parity harness bound");
  const text = bytes.toString("utf8");
  try {
    return { json: JSON.parse(text), text: null };
  } catch {
    return { json: null, text };
  }
}

async function executeRestCommand(fetchImpl, endpoint, token, command) {
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(3_000),
  });
  const payload = await readBoundedJson(response);
  return { ok: response.ok, status: response.status, ...payload };
}

function keeperBudgetRedisKey(chainId, contractAddress) {
  return `lore:keeper-budget:v1:${sha256(`${chainId}:${contractAddress.toLowerCase()}`)}`;
}

function keeperReservationField(signerAddress, nonce) {
  return `r:${sha256(`${signerAddress.toLowerCase()}:${nonce}`)}`;
}

function normalizeRedisHashResponse(response) {
  assert.equal(response.ok, true);
  assert.ok(Array.isArray(response.json?.result));
  assert.equal(response.json.result.length % 2, 0);
  const entries = [];
  for (let index = 0; index < response.json.result.length; index += 2) {
    entries.push([String(response.json.result[index]), String(response.json.result[index + 1])]);
  }
  return Object.fromEntries(entries.sort(([left], [right]) => left.localeCompare(right)));
}

function createKeeperReservationInput({
  chainId,
  contractAddress,
  signerAddress,
  nonce,
  reservedMaxCostWei,
  maxSignatures = 10,
  maxReservedCostWei = "100",
  intentSeed = `nonce-${nonce}`,
}) {
  return {
    chainId,
    contractAddress,
    signerAddress,
    nonce,
    epoch: String(10_000 + nonce),
    signingIntentHash: `0x${sha256(`keeper-parity:${intentSeed}`)}`,
    reservedMaxCostWei: String(reservedMaxCostWei),
    policy: {
      maxSignatures,
      maxReservedCostWei: String(maxReservedCostWei),
    },
  };
}

function assertEvalTransport(response, { argumentCount, redisKey, scriptSha256 }) {
  assert.equal(response.transport.tlsAuthorized, true);
  assert.match(response.transport.tlsProtocol, /^TLSv1\.[23]$/);
  assert.equal(response.transport.request.bearerMatches, true);
  assert.equal(response.transport.request.commandName, "EVAL");
  assert.equal(response.transport.request.contentType, "application/json");
  assert.equal(response.transport.request.keyCount, "1");
  assert.equal(response.transport.request.method, "POST");
  assert.equal(response.transport.request.redisKey, redisKey);
  assert.equal(response.transport.request.argumentCount, argumentCount);
  assert.equal(response.transport.request.scriptSha256, scriptSha256);
}

async function readServerClock(fetchImpl, endpoint, token) {
  const response = await executeRestCommand(fetchImpl, endpoint, token, ["TIME"]);
  assert.equal(response.ok, true, "Valkey TIME must succeed through the HTTPS REST facade");
  assert.ok(Array.isArray(response.json?.result) && response.json.result.length === 2);
  assert.match(String(response.json.result[0]), /^\d+$/);
  const seconds = Number(response.json.result[0]);
  assert.ok(Number.isSafeInteger(seconds) && seconds >= 0);
  return {
    seconds,
    secondsUntilNextUtcDay: 86_400 - (seconds % 86_400),
    utcDay: Math.floor(seconds / 86_400),
  };
}

async function inspectRedisExpiry(fetchImpl, endpoint, token, redisKey) {
  const response = await executeRestCommand(fetchImpl, endpoint, token, [
    "EVAL",
    [
      'local server_time = redis.call("TIME")',
      'local ttl = redis.call("PTTL", KEYS[1])',
      'local expires_at = redis.call("PEXPIRETIME", KEYS[1])',
      "return {server_time[1], server_time[2], ttl, expires_at}",
    ].join("\n"),
    "1",
    redisKey,
  ]);
  assert.equal(response.ok, true, "Redis expiry observation must succeed");
  assert.ok(Array.isArray(response.json?.result) && response.json.result.length === 4);
  const values = response.json.result.map((value) => {
    assert.match(String(value), /^\d+$/);
    const parsed = Number(value);
    assert.ok(Number.isSafeInteger(parsed) && parsed >= 0);
    return parsed;
  });
  const [seconds, microseconds, ttlMs, expiresAtMs] = values;
  assert.ok(microseconds < 1_000_000);
  assert.ok(ttlMs > 0);
  const nowMs = (seconds * 1_000) + Math.floor(microseconds / 1_000);
  const utcDay = Math.floor(seconds / 86_400);
  assert.ok(
    Math.abs((nowMs + ttlMs) - expiresAtMs) <= 5,
    "Redis PTTL and absolute expiry must describe the same server deadline",
  );
  return { expiresAtMs, nowMs, ttlMs, utcDay };
}

async function inspectKeeperExpiry(fetchImpl, endpoint, token, redisKey) {
  const expiry = await inspectRedisExpiry(fetchImpl, endpoint, token, redisKey);
  const expectedMidnightMs = (expiry.utcDay + 1) * 86_400_000;
  assert.ok(
    expiry.expiresAtMs >= expectedMidnightMs - 5 && expiry.expiresAtMs <= expectedMidnightMs + 1_005,
    "keeper absolute expiry must match the next server UTC midnight within the script's one-second precision",
  );
  return { ...expiry, expectedMidnightMs };
}

function decodeSessionCookie(value) {
  assert.equal(typeof value, "string");
  const parts = value.split(".");
  assert.equal(parts.length, 2);
  assert.match(parts[0], /^[A-Za-z0-9_-]+$/);
  assert.match(parts[1], /^[A-Za-z0-9_-]+$/);
  return JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
}

function sessionRedisKey(sessionId) {
  return `lore:admin-session:v2:${sha256(sessionId)}`;
}

function serializeSessionRecord(payload) {
  return `${sha256(payload.address)}:${payload.absoluteExpiresAt}:${payload.sessionVersion}`;
}

function assertSessionCookie(cookie, expectedExpiresAt) {
  assert.ok(cookie);
  assert.equal(cookie.name, ADMIN_SESSION_COOKIE);
  assert.equal(cookie.httpOnly, true);
  assert.equal(cookie.sameSite, "strict");
  assert.equal(cookie.secure, true);
  assert.equal(cookie.path, "/");
  assert.equal(cookie.expiresAt, expectedExpiresAt);
  assert.equal(typeof cookie.value, "string");
}

function assertSessionPayload(actual, expected) {
  assert.ok(actual && typeof actual === "object", "session payload must be present");
  assert.equal(actual.aud, "lore-admin");
  assert.equal(actual.type, "admin-session");
  assert.equal(actual.address, expected.address);
  assert.equal(actual.sessionVersion, expected.sessionVersion);
  assert.equal(actual.startedAt, expected.startedAt);
  assert.equal(actual.issuedAt, expected.issuedAt);
  assert.equal(actual.expiresAt, expected.expiresAt);
  assert.equal(actual.absoluteExpiresAt, expected.absoluteExpiresAt);
  assert.match(actual.sessionId, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(
    sha256(actual.sessionId),
    sha256(expected.sessionId),
    "session payload must preserve the same opaque session identity",
  );
}

function assertSessionCommandTransport(
  response,
  { argumentCount = null, commandName, redisKey, scriptSha256 = null, ttlMsArgument = null },
) {
  assert.equal(response.transport.tlsAuthorized, true);
  assert.match(response.transport.tlsProtocol, /^TLSv1\.[23]$/);
  assert.equal(response.transport.request.bearerMatches, true);
  assert.equal(response.transport.request.commandName, commandName);
  assert.equal(response.transport.request.contentType, "application/json");
  assert.equal(response.transport.request.keyCount, commandName === "EVAL" ? "1" : null);
  assert.equal(response.transport.request.method, "POST");
  assert.equal(response.transport.request.redisKey, redisKey);
  assert.equal(response.transport.request.argumentCount, argumentCount);
  assert.equal(response.transport.request.scriptSha256, scriptSha256);
  assert.equal(response.transport.request.ttlMsArgument, ttlMsArgument);
}

function createSessionResponseCapture() {
  let cookie = null;
  return {
    response: {
      cookies: {
        set(name, value, options) {
          assert.ok(options?.expires instanceof Date);
          cookie = {
            expiresAt: options.expires.getTime(),
            httpOnly: options.httpOnly,
            name,
            path: options.path,
            sameSite: options.sameSite,
            secure: options.secure,
            value,
          };
        },
      },
    },
    takeCookie() {
      return cookie;
    },
  };
}

function createSessionRequest(cookieValue) {
  return {
    cookies: {
      get(name) {
        return name === ADMIN_SESSION_COOKIE && typeof cookieValue === "string"
          ? { value: cookieValue }
          : undefined;
      },
    },
  };
}

function validateOwnedName(name) {
  assert.match(name, /^lore-valkey-rest-\d+-[0-9a-f]{8}-(?:backend|ingress|valkey|srh|caddy)$/);
}

function validateOwnedTempRoot(path) {
  const resolvedTemp = resolve(tmpdir());
  const resolvedPath = resolve(path);
  assert.equal(dirname(resolvedPath), resolvedTemp);
  assert.ok(basename(resolvedPath).startsWith(TEMP_PREFIX));
  return resolvedPath;
}

async function assertPinnedImage(name, image) {
  const [platformResult, indexResult] = await Promise.all([
    docker([
      "image", "inspect", "--format", "{{json .Descriptor}}|{{.Os}}/{{.Architecture}}", imageReference(image),
    ]),
    docker([
      "image", "inspect", "--format", "{{json .Descriptor}}", imageReference(image, image.indexDigest),
    ]),
  ]);
  const [platformDescriptorText, platform] = platformResult.stdout.split("|");
  const platformDescriptor = JSON.parse(platformDescriptorText);
  const indexDescriptor = JSON.parse(indexResult.stdout);
  assert.equal(platformDescriptor.digest, image.platformDigest, `${name} platform digest`);
  assert.equal(platformDescriptor.mediaType, "application/vnd.oci.image.manifest.v1+json", `${name} manifest type`);
  assert.equal(platform, PLATFORM, `${name} platform`);
  assert.equal(indexDescriptor.digest, image.indexDigest, `${name} index digest`);
  assert.equal(indexDescriptor.mediaType, "application/vnd.oci.image.index.v1+json", `${name} index type`);
}

function captureResourceId(result, name, target) {
  assert.match(result.stdout, /^[0-9a-f]{64}$/, `${name} must return an exact Docker resource ID`);
  target.set(name, result.stdout);
}

function assertAuthoritativeDockerAbsence(result, kind, name) {
  assert.notEqual(result.status, 0, `${kind} ${name} must be absent`);
  const pattern = kind === "container"
    ? /No such (?:container|object)/i
    : /(?:network .* not found|No such (?:network|object))/i;
  assert.match(result.stderr, pattern, `${kind} ${name} absence must be authoritative`);
}

async function inspectOwnedResource(kind, name, runLabel) {
  const format = kind === "container"
    ? `{{.Id}}|{{index .Config.Labels "${OWNERSHIP_LABEL}"}}`
    : `{{.Id}}|{{index .Labels "${OWNERSHIP_LABEL}"}}`;
  const args = kind === "container"
    ? ["container", "inspect", "--format", format, name]
    : ["network", "inspect", "--format", format, name];
  const inspection = await docker(args, { allowFailure: true });
  if (inspection.status !== 0) {
    assertAuthoritativeDockerAbsence(inspection, kind, name);
    return null;
  }
  const separator = inspection.stdout.indexOf("|");
  assert.ok(separator > 0, `${kind} ${name} ownership inspection must be structured`);
  const id = inspection.stdout.slice(0, separator);
  const observedLabel = inspection.stdout.slice(separator + 1);
  assert.match(id, /^[0-9a-f]{64}$/, `${kind} ${name} must expose an exact ID`);
  assert.equal(observedLabel, runLabel, `${kind} ${name} ownership label mismatch`);
  return id;
}

async function assertRuntimeOwnership(kind, ids, runLabel) {
  for (const [name, expectedId] of ids) {
    const observedId = await inspectOwnedResource(kind, name, runLabel);
    assert.equal(observedId, expectedId, `${kind} ${name} ID must match its create result`);
  }
}

async function removeOwnedResource(kind, name, runLabel, capturedIds) {
  const observedId = await inspectOwnedResource(kind, name, runLabel);
  if (observedId === null) return;
  const capturedId = capturedIds.get(name);
  if (capturedId !== undefined) {
    assert.equal(observedId, capturedId, `${kind} ${name} changed identity before cleanup`);
  }
  if (kind === "container") await docker(["rm", "--force", observedId]);
  else await docker(["network", "rm", observedId]);
  const absent = await inspectOwnedResource(kind, observedId, runLabel);
  assert.equal(absent, null, `${kind} ${name} must be absent after cleanup`);
  const nameAbsent = await inspectOwnedResource(kind, name, runLabel);
  assert.equal(nameAbsent, null, `${kind} name ${name} must not be reused during cleanup`);
}

async function assertNoResourcesWithRunLabel(runLabel) {
  const [containers, networks] = await Promise.all([
    docker(["container", "ls", "--all", "--quiet", "--filter", `label=${OWNERSHIP_LABEL}=${runLabel}`]),
    docker(["network", "ls", "--quiet", "--filter", `label=${OWNERSHIP_LABEL}=${runLabel}`]),
  ]);
  assert.equal(containers.stdout, "", "no container with the parity run label may survive cleanup");
  assert.equal(networks.stdout, "", "no network with the parity run label may survive cleanup");
}

async function inspectSourceBinding(relativePath) {
  const [workingTreeBlob, revisionBlob] = await Promise.all([
    git(["hash-object", "--", relativePath]),
    git(["rev-parse", `HEAD:${relativePath}`], { allowFailure: true }),
  ]);
  assert.match(workingTreeBlob.stdout, /^[0-9a-f]{40,64}$/, `${relativePath} working-tree blob`);
  const trackedAtRevision = revisionBlob.status === 0 && /^[0-9a-f]{40,64}$/.test(revisionBlob.stdout);
  return {
    boundToSourceRevision: trackedAtRevision && revisionBlob.stdout === workingTreeBlob.stdout,
    revisionBlob: trackedAtRevision ? revisionBlob.stdout : null,
    trackedAtRevision,
    workingTreeBlob: workingTreeBlob.stdout,
  };
}

async function captureSourceProvenance() {
  const revisionBefore = await git(["rev-parse", "HEAD"]);
  const [trackedStatus, fileEntries, bindingEntries] = await Promise.all([
    git(["status", "--porcelain=v1", "--untracked-files=no"]),
    Promise.all(SOURCE_BINDING_PATHS.map(async (relativePath) => [
      relativePath,
      await readFile(resolve(REPO_ROOT, ...relativePath.split("/")), "utf8"),
    ])),
    Promise.all(SOURCE_BINDING_PATHS.map(async (relativePath) => [relativePath, await inspectSourceBinding(relativePath)])),
  ]);
  const revisionAfter = await git(["rev-parse", "HEAD"]);
  assert.equal(revisionAfter.stdout, revisionBefore.stdout, "source revision must remain stable during provenance capture");
  const files = Object.fromEntries(fileEntries);
  const bindings = Object.fromEntries(bindingEntries);
  return {
    bindings,
    files,
    sourceRevisionSha: revisionBefore.stdout,
    sourceSha256: Object.fromEntries(Object.entries(files).map(([relativePath, content]) => [relativePath, sha256(content)])),
    trackedWorktreeStatus: trackedStatus.stdout,
  };
}

async function assertDockerServerPlatform() {
  const result = await docker(["version", "--format", "{{.Server.Os}}/{{.Server.Arch}}"]);
  assert.equal(result.stdout, PLATFORM, "Docker server platform must match the pinned manifests");
}

async function waitForExit(child, timeoutMs = 5_000) {
  if (child.exitCode !== null || child.signalCode !== null) return child.exitCode;
  return new Promise((resolvePromise, reject) => {
    const onExit = (code) => {
      clearTimeout(timeout);
      resolvePromise(code);
    };
    const timeout = setTimeout(() => {
      child.off("exit", onExit);
      reject(new Error("replica did not exit within the cleanup deadline"));
    }, timeoutMs);
    child.once("exit", onExit);
  });
}

async function forceStopChild(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill("SIGKILL");
  try {
    await waitForExit(child, 2_000);
  } catch (firstError) {
    child.kill("SIGKILL");
    try {
      await waitForExit(child, 2_000);
    } catch (secondError) {
      throw new AggregateError([firstError, secondError], "replica could not be terminated within the bounded cleanup deadline");
    }
  }
}

async function createReplica({
  adminSessionSecret,
  adminWalletAddress,
  caPath,
  chatAuthSecret,
  dbPath,
  endpoint,
  expectedSourceSha256,
  registry,
  replicaId,
  token,
}) {
  const child = fork(SCRIPT_PATH, ["--replica"], {
    cwd: REPO_ROOT,
    env: minimalChildEnvironment({
      ADMIN_AUTH_SECRET: adminSessionSecret,
      CHAT_AUTH_SECRET: chatAuthSecret,
      LORE_VALKEY_PARITY_CA_PATH: caPath,
      LORE_VALKEY_PARITY_ENDPOINT: endpoint,
      LORE_VALKEY_PARITY_REPLICA_ID: replicaId,
      LORE_DB_PATH: dbPath,
      NEXT_PUBLIC_ADMIN_WALLET_ADDRESS: adminWalletAddress,
      NODE_ENV: "production",
      TSX_DISABLE_CACHE: "1",
      UPSTASH_REDIS_REST_TOKEN: token,
      UPSTASH_REDIS_REST_URL: endpoint,
      WEB_REPLICA_COUNT: "2",
    }),
    execArgv: ["--import", "tsx"],
    silent: true,
    windowsHide: true,
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr = redact(`${stderr}${chunk}`).slice(-4_096);
  });
  child.stdout.on("data", () => undefined);
  const pending = new Map();
  let readyResolve;
  let readyReject;
  const ready = new Promise((resolvePromise, reject) => {
    readyResolve = resolvePromise;
    readyReject = reject;
  });
  child.on("message", (message) => {
    if (!message || typeof message !== "object") return;
    if (message.type === "ready") {
      readyResolve(message);
      return;
    }
    if (message.type === "response" && pending.has(message.id)) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) entry.reject(new Error(redact(message.error)));
      else entry.resolve(message);
    }
  });
  child.once("error", (error) => {
    readyReject(error);
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  });
  child.once("exit", (code) => {
    const error = new Error(`replica ${replicaId} exited early (${code ?? "signal"}): ${stderr || "no diagnostic"}`);
    readyReject(error);
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
  });
  let sequence = 0;
  let readyVerified = false;
  let verifiedPid = null;
  const sendRequest = async (type, input) => {
    sequence += 1;
    const id = `${replicaId}-${sequence}`;
    const response = new Promise((resolvePromise, reject) => {
      pending.set(id, { resolve: resolvePromise, reject });
    });
    if (!child.connected) {
      pending.delete(id);
      throw new Error(`replica ${replicaId} IPC disconnected before request`);
    }
    try {
      child.send({ id, type, input }, (error) => {
        if (!error || !pending.has(id)) return;
        pending.get(id).reject(error);
      });
      return await withTimeout(response, 5_000, `replica ${replicaId} request timed out`);
    } finally {
      pending.delete(id);
    }
  };
  const replica = {
    get pid() {
      return verifiedPid;
    },
    replicaId,
    async consume(input) {
      return sendRequest("consume", input);
    },
    async reserveKeeper(input) {
      return sendRequest("reserve-keeper", input);
    },
    async issueSession(input) {
      return sendRequest("session-issue", input);
    },
    async readSession(input) {
      return sendRequest("session-read", input);
    },
    async rotateSession(input) {
      return sendRequest("session-rotate", input);
    },
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) {
        throw new Error(`replica ${replicaId} exited before graceful shutdown acknowledgement`);
      }
      if (!readyVerified) {
        await forceStopChild(child);
        throw new Error(`replica ${replicaId} was not ready for graceful shutdown`);
      }
      const shutdownResponse = await sendRequest("shutdown", {});
      assert.equal(shutdownResponse.result?.dbClosed, true, `replica ${replicaId} must acknowledge DB close`);
      try {
        await waitForExit(child);
      } catch (error) {
        await forceStopChild(child);
        throw error;
      }
      assert.equal(child.signalCode, null, `replica ${replicaId} must not require forced termination`);
      assert.equal(child.exitCode, 0, `replica ${replicaId} must exit cleanly after DB close`);
    },
  };
  registry.push(replica);
  const readyMessage = await withTimeout(ready, 10_000, `replica ${replicaId} readiness timed out`);
  assert.equal(readyMessage.replicaId, replicaId);
  assert.ok(Number.isInteger(readyMessage.pid) && readyMessage.pid > 0);
  assert.equal(
    readyMessage.externalRateLimitSourceSha256,
    expectedSourceSha256.externalRateLimit,
    `replica ${replicaId} must import the captured external rate-limit source`,
  );
  assert.equal(
    readyMessage.adminSessionSourceSha256,
    expectedSourceSha256.adminSession,
    `replica ${replicaId} must import the captured admin-session source`,
  );
  assert.equal(
    readyMessage.adminAuthSourceSha256,
    expectedSourceSha256.adminAuth,
    `replica ${replicaId} must import the captured admin-auth source`,
  );
  assert.equal(readyMessage.adminSessionIdleTtlMs, ADMIN_SESSION_IDLE_TTL_MS);
  verifiedPid = readyMessage.pid;
  readyVerified = true;
  return replica;
}

async function replicaMain() {
  const caPath = process.env.LORE_VALKEY_PARITY_CA_PATH;
  const endpoint = process.env.LORE_VALKEY_PARITY_ENDPOINT;
  const replicaId = process.env.LORE_VALKEY_PARITY_REPLICA_ID;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const adminSessionSecret = process.env.ADMIN_AUTH_SECRET;
  const adminWalletAddress = process.env.NEXT_PUBLIC_ADMIN_WALLET_ADDRESS;
  const chatAuthSecret = process.env.CHAT_AUTH_SECRET;
  if (
    !caPath || !endpoint || !replicaId || !token || !adminSessionSecret ||
    !adminWalletAddress || !chatAuthSecret
  ) throw new Error("replica parity configuration is incomplete");
  secrets.add(token);
  secrets.add(adminSessionSecret);
  secrets.add(chatAuthSecret);
  const ca = await readFile(caPath, "utf8");
  const observation = { lastRequest: null, requestCount: 0, tlsAuthorized: false, tlsProtocol: null };
  const fetchImpl = createPinnedHttpsFetch({ ca, endpoint, expectedToken: token, observation });
  globalThis.fetch = fetchImpl;
  const externalRateLimitSourcePath = resolve(REPO_ROOT, "app", "api", "_lib", "externalRateLimit.ts");
  const adminSessionSourcePath = resolve(REPO_ROOT, "app", "api", "_lib", "adminSession.ts");
  const adminAuthSourcePath = resolve(REPO_ROOT, "app", "lib", "adminAuth.ts");
  const [externalRateLimitSourceBefore, adminSessionSourceBefore, adminAuthSourceBefore] = await Promise.all([
    readFile(externalRateLimitSourcePath, "utf8"),
    readFile(adminSessionSourcePath, "utf8"),
    readFile(adminAuthSourcePath, "utf8"),
  ]);
  const [externalRateLimitModule, adminSessionModule, adminAuthModule, dbModule] = await Promise.all([
    import("../app/api/_lib/externalRateLimit.ts"),
    import("../app/api/_lib/adminSession.ts"),
    import("../app/lib/adminAuth.ts"),
    import("../server/db.ts"),
  ]);
  const [externalRateLimitSourceAfter, adminSessionSourceAfter, adminAuthSourceAfter] = await Promise.all([
    readFile(externalRateLimitSourcePath, "utf8"),
    readFile(adminSessionSourcePath, "utf8"),
    readFile(adminAuthSourcePath, "utf8"),
  ]);
  assert.equal(
    externalRateLimitSourceAfter,
    externalRateLimitSourceBefore,
    "external rate-limit source must remain stable across replica import",
  );
  assert.equal(adminSessionSourceAfter, adminSessionSourceBefore, "admin-session source must remain stable across import");
  assert.equal(adminAuthSourceAfter, adminAuthSourceBefore, "admin-auth source must remain stable across import");
  const externalRateLimit = externalRateLimitModule.default ?? externalRateLimitModule;
  const adminSession = adminSessionModule.default ?? adminSessionModule;
  const adminAuth = adminAuthModule.default ?? adminAuthModule;
  process.send?.({
    type: "ready",
    adminAuthSourceSha256: sha256(adminAuthSourceBefore),
    adminSessionIdleTtlMs: adminAuth.ADMIN_AUTH_SESSION_IDLE_TTL_MS,
    adminSessionSourceSha256: sha256(adminSessionSourceBefore),
    externalRateLimitSourceSha256: sha256(externalRateLimitSourceBefore),
    pid: process.pid,
    replicaId,
  });
  const transportEvidence = () => ({
    requestCount: observation.requestCount,
    request: observation.lastRequest,
    tlsAuthorized: observation.tlsAuthorized,
    tlsProtocol: observation.tlsProtocol,
  });
  let queue = Promise.resolve();
  process.on("message", (message) => {
    queue = queue.then(async () => {
      if (!message || typeof message !== "object") return;
      if (message.type === "shutdown") {
        let response;
        try {
          dbModule.db.close();
          response = { id: message.id, type: "response", result: { dbClosed: true } };
        } catch (error) {
          process.exitCode = 1;
          response = { id: message.id, type: "response", error: redact(error?.message ?? error) };
        }
        process.send?.(response, () => process.disconnect());
        return;
      }
      try {
        if (message.type === "consume") {
          const result = await externalRateLimit.consumeExternalRateLimit(
            message.input.bucket,
            message.input.key,
            message.input.limit,
            message.input.windowMs,
            message.input.now,
            fetchImpl,
          );
          process.send?.({ id: message.id, type: "response", result, transport: transportEvidence() });
          return;
        }
        if (message.type === "reserve-keeper") {
          const result = await externalRateLimit.reserveExternalKeeperDailyBudget({
            chainId: message.input.chainId,
            contractAddress: message.input.contractAddress,
            signerAddress: message.input.signerAddress,
            nonce: message.input.nonce,
            epoch: BigInt(message.input.epoch),
            signingIntentHash: message.input.signingIntentHash,
            reservedMaxCostWei: BigInt(message.input.reservedMaxCostWei),
            policy: {
              maxSignatures: message.input.policy.maxSignatures,
              maxReservedCostWei: BigInt(message.input.policy.maxReservedCostWei),
            },
          }, fetchImpl);
          process.send?.({
            id: message.id,
            type: "response",
            result: {
              ...result,
              reservedMaxCostWei: result.reservedMaxCostWei.toString(),
            },
            transport: transportEvidence(),
          });
          return;
        }
        if (message.type === "session-issue") {
          const capture = createSessionResponseCapture();
          const expiresAt = await adminSession.issueAdminSession(
            capture.response,
            message.input.address,
            message.input.now,
          );
          const cookie = capture.takeCookie();
          if (cookie?.value) secrets.add(cookie.value);
          process.send?.({
            id: message.id,
            type: "response",
            result: { cookie, expiresAt },
            transport: transportEvidence(),
          });
          return;
        }
        if (message.type === "session-read") {
          const result = await adminSession.readAdminSession(
            createSessionRequest(message.input.cookieValue),
            message.input.now,
          );
          process.send?.({ id: message.id, type: "response", result, transport: transportEvidence() });
          return;
        }
        if (message.type === "session-rotate") {
          const capture = createSessionResponseCapture();
          const expiresAt = await adminSession.rotateAdminSession(
            capture.response,
            message.input.previous,
            message.input.now,
          );
          const cookie = capture.takeCookie();
          if (cookie?.value) secrets.add(cookie.value);
          process.send?.({
            id: message.id,
            type: "response",
            result: { cookie, expiresAt },
            transport: transportEvidence(),
          });
          return;
        }
      } catch (error) {
        process.send?.({ id: message.id, type: "response", error: redact(error?.message ?? error) });
      }
    }).catch((error) => {
      process.send?.({ id: message?.id, type: "response", error: redact(error?.message ?? error) });
    });
  });
}

async function inspectPublishedPort(container) {
  const result = await docker(["port", container, "443/tcp"]);
  const matches = result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  assert.equal(matches.length, 1, "Caddy must publish exactly one HTTPS endpoint");
  const match = matches[0].match(/^127\.0\.0\.1:(\d+)$/);
  assert.ok(match, "Caddy HTTPS endpoint must be loopback-only");
  const port = Number(match[1]);
  assert.ok(Number.isInteger(port) && port > 0 && port <= 65_535);
  return port;
}

async function assertNoPublishedPorts(container) {
  const result = await docker(["port", container]);
  assert.equal(result.stdout, "", `${container} must not publish a host port`);
}

async function assertRuntimeNetworkTopology(names) {
  const backend = await docker([
    "network", "inspect", "--format", "{{.Internal}}|{{len .Containers}}", names.backend,
  ]);
  const ingress = await docker([
    "network", "inspect", "--format", "{{.Internal}}|{{len .Containers}}", names.ingress,
  ]);
  assert.equal(backend.stdout, "true|3", "backend must be internal and contain exactly Valkey, SRH, and Caddy");
  assert.equal(ingress.stdout, "false|1", "ingress must contain only Caddy");
}

async function waitForFacade({ caPath, caddyContainer, endpoint, runtimeContainers, token }) {
  let ca = null;
  let copyDiagnostic = "not attempted";
  let lastError = null;
  let systemCaRejected = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (!systemCaRejected) {
      const untrustedObservation = { lastRequest: null, requestCount: 0, tlsAuthorized: false, tlsProtocol: null };
      const untrustedFetch = createPinnedHttpsFetch({ ca: undefined, endpoint, observation: untrustedObservation });
      try {
        await executeRestCommand(untrustedFetch, endpoint, token, ["PING"]);
        throw new Error("the ephemeral Caddy CA was trusted unexpectedly");
      } catch (error) {
        if ([
          "DEPTH_ZERO_SELF_SIGNED_CERT",
          "SELF_SIGNED_CERT_IN_CHAIN",
          "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
          "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
        ].includes(error?.code)) {
          systemCaRejected = true;
        } else {
          lastError = error;
        }
      }
    }
    if (ca === null) {
      const copied = await docker([
        "exec", caddyContainer, "cat", "/data/caddy/pki/authorities/local/root.crt",
      ], { allowFailure: true });
      if (copied.status === 0 && copied.stdout.includes("-----BEGIN CERTIFICATE-----")) {
        ca = `${copied.stdout}\n`;
        await writeFile(caPath, ca, { encoding: "utf8", flag: "wx", mode: 0o600 });
      }
      else copyDiagnostic = copied.stderr || copied.stdout || `status ${copied.status}`;
    }
    if (ca !== null) {
      const observation = { lastRequest: null, requestCount: 0, tlsAuthorized: false, tlsProtocol: null };
      const fetchImpl = createPinnedHttpsFetch({ ca, endpoint, expectedToken: token, observation });
      try {
        const response = await executeRestCommand(fetchImpl, endpoint, token, ["PING"]);
        if (response.ok && response.json?.result === "PONG" && observation.tlsAuthorized && systemCaRejected) {
          return { ca, fetchImpl, observation, systemCaRejected };
        }
        lastError = new Error(`facade readiness returned status ${response.status}`);
      } catch (error) {
        lastError = error;
      }
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
  const states = [];
  for (const [name, container] of Object.entries(runtimeContainers)) {
    const state = await docker([
      "container", "inspect", "--format", "{{.State.Status}}|{{.State.ExitCode}}|{{.State.Error}}", container,
    ], { allowFailure: true });
    states.push(`${name}=${state.status === 0 ? state.stdout : "missing"}`);
  }
  throw new Error(
    `HTTPS REST facade did not become ready: ${redact(lastError?.message ?? "CA unavailable")}; `
    + `${states.join(", ")}; public-root-read=${redact(copyDiagnostic)}`,
  );
}

async function main(sourceProvenanceAtStartup) {
  const protectedDbBefore = await snapshotProtectedDb();
  assert.equal(protectedDbBefore.base.exists, true, "protected SQLite base must exist before the parity test");
  const suffix = `${process.pid}-${randomBytes(4).toString("hex")}`;
  const runLabel = suffix;
  const names = {
    backend: `lore-valkey-rest-${suffix}-backend`,
    ingress: `lore-valkey-rest-${suffix}-ingress`,
    valkey: `lore-valkey-rest-${suffix}-valkey`,
    srh: `lore-valkey-rest-${suffix}-srh`,
    caddy: `lore-valkey-rest-${suffix}-caddy`,
  };
  for (const name of Object.values(names)) validateOwnedName(name);
  const tempRoot = validateOwnedTempRoot(await mkdtemp(join(tmpdir(), TEMP_PREFIX)));
  const valkeyPassword = randomBytes(32).toString("hex");
  const restToken = randomBytes(32).toString("hex");
  const wrongToken = randomBytes(32).toString("hex");
  const adminSessionSecret = randomBytes(48).toString("base64url");
  const chatAuthSecret = randomBytes(48).toString("base64url");
  const adminWalletAddress = `0x${randomBytes(20).toString("hex")}`;
  secrets.add(valkeyPassword);
  secrets.add(restToken);
  secrets.add(wrongToken);
  secrets.add(adminSessionSecret);
  secrets.add(chatAuthSecret);
  const valkeyConfigPath = join(tempRoot, "valkey.conf");
  const srhTokensPath = join(tempRoot, "tokens.json");
  const caddyfilePath = join(tempRoot, "Caddyfile");
  const caPath = join(tempRoot, "caddy-root.crt");
  const createdContainerIds = new Map();
  const createdNetworkIds = new Map();
  const attemptedContainerNames = new Set();
  const attemptedNetworkNames = new Set();
  const replicas = [];
  let evidence = null;
  let cleanupVerified = false;
  let sourceProvenanceBefore = null;
  try {
    await Promise.all([
      writeFile(valkeyConfigPath, [
        "bind 0.0.0.0",
        "protected-mode yes",
        "port 6379",
        "save \"\"",
        "appendonly no",
        `requirepass ${valkeyPassword}`,
        "",
      ].join("\n"), { encoding: "utf8", flag: "wx", mode: 0o600 }),
      writeFile(srhTokensPath, `${JSON.stringify({
        [restToken]: {
          connection_string: `redis://:${valkeyPassword}@valkey:6379/0`,
          max_connections: 4,
          srh_id: `lore-${suffix}`,
        },
      })}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 }),
      writeFile(caddyfilePath, [
        "{",
        "  admin off",
        "  auto_https disable_redirects",
        "}",
        `${PARITY_HOST} {`,
        "  tls internal",
        "  request_body {",
        "    max_size 64KB",
        "  }",
        "  reverse_proxy http://srh:8080",
        "}",
        "",
      ].join("\n"), { encoding: "utf8", flag: "wx", mode: 0o600 }),
    ]);
    await Promise.all([
      assertDockerServerPlatform(),
      ...Object.entries(IMAGES).map(([name, image]) => assertPinnedImage(name, image)),
    ]);
    attemptedNetworkNames.add(names.backend);
    const backendNetwork = await docker([
      "network", "create", "--driver", "bridge", "--internal",
      "--label", `${OWNERSHIP_LABEL}=${runLabel}`,
      names.backend,
    ]);
    captureResourceId(backendNetwork, names.backend, createdNetworkIds);
    attemptedNetworkNames.add(names.ingress);
    const ingressNetwork = await docker([
      "network", "create", "--driver", "bridge",
      "--label", `${OWNERSHIP_LABEL}=${runLabel}`,
      names.ingress,
    ]);
    captureResourceId(ingressNetwork, names.ingress, createdNetworkIds);

    attemptedContainerNames.add(names.valkey);
    const valkeyContainer = await docker([
      "run", "--detach", "--name", names.valkey,
      "--label", `${OWNERSHIP_LABEL}=${runLabel}`,
      "--pull", "never",
      "--network", names.backend, "--network-alias", "valkey",
      "--platform", PLATFORM, "--read-only",
      "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m",
      "--tmpfs", "/data:rw,noexec,nosuid,size=16m,mode=1777",
      "--cap-drop", "ALL", "--cap-add", "CHOWN", "--cap-add", "SETUID", "--cap-add", "SETGID",
      "--security-opt", "no-new-privileges",
      "--mount", `type=bind,source=${valkeyConfigPath},target=/usr/local/etc/valkey/valkey.conf,readonly`,
      imageReference(IMAGES.valkey),
      "valkey-server", "/usr/local/etc/valkey/valkey.conf",
    ]);
    captureResourceId(valkeyContainer, names.valkey, createdContainerIds);

    attemptedContainerNames.add(names.srh);
    const restFacadeContainer = await docker([
      "run", "--detach", "--name", names.srh,
      "--label", `${OWNERSHIP_LABEL}=${runLabel}`,
      "--pull", "never",
      "--network", names.backend, "--network-alias", "srh",
      "--platform", PLATFORM, "--read-only",
      "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m",
      "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
      "--env", "SRH_MODE=file", "--env", "SRH_PORT=8080",
      "--mount", `type=bind,source=${srhTokensPath},target=/app/srh-config/tokens.json,readonly`,
      imageReference(IMAGES.restFacade),
    ]);
    captureResourceId(restFacadeContainer, names.srh, createdContainerIds);

    attemptedContainerNames.add(names.caddy);
    const caddyContainer = await docker([
      "run", "--detach", "--name", names.caddy,
      "--label", `${OWNERSHIP_LABEL}=${runLabel}`,
      "--pull", "never",
      "--network", names.ingress,
      "--platform", PLATFORM, "--read-only",
      "--tmpfs", "/data:rw,noexec,nosuid,size=32m",
      "--tmpfs", "/config:rw,noexec,nosuid,size=8m",
      "--tmpfs", "/tmp:rw,noexec,nosuid,size=8m",
      "--cap-drop", "ALL", "--cap-add", "NET_BIND_SERVICE",
      "--security-opt", "no-new-privileges",
      "--publish", "127.0.0.1::443/tcp",
      "--mount", `type=bind,source=${caddyfilePath},target=/etc/caddy/Caddyfile,readonly`,
      imageReference(IMAGES.httpsProxy),
    ]);
    captureResourceId(caddyContainer, names.caddy, createdContainerIds);
    await docker(["network", "connect", "--alias", "caddy", names.backend, names.caddy]);
    await Promise.all([
      assertNoPublishedPorts(names.valkey),
      assertNoPublishedPorts(names.srh),
      assertRuntimeNetworkTopology(names),
      assertRuntimeOwnership("container", createdContainerIds, runLabel),
      assertRuntimeOwnership("network", createdNetworkIds, runLabel),
    ]);

    const port = await inspectPublishedPort(names.caddy);
    const endpoint = `https://${PARITY_HOST}:${port}`;
    const ready = await waitForFacade({
      caPath,
      caddyContainer: names.caddy,
      endpoint,
      runtimeContainers: { caddy: names.caddy, srh: names.srh, valkey: names.valkey },
      token: restToken,
    });

    assert.equal(ready.systemCaRejected, true, "the ephemeral Caddy CA must not be trusted implicitly");
    sourceProvenanceBefore = await captureSourceProvenance();
    assert.deepEqual(
      sourceProvenanceBefore,
      sourceProvenanceAtStartup,
      "HEAD, harness, package entry, and production source must remain stable from process startup through setup",
    );
    const expectedSourceSha256 = {
      adminAuth: sourceProvenanceBefore.sourceSha256["app/lib/adminAuth.ts"],
      adminSession: sourceProvenanceBefore.sourceSha256["app/api/_lib/adminSession.ts"],
      externalRateLimit: sourceProvenanceBefore.sourceSha256["app/api/_lib/externalRateLimit.ts"],
    };
    const externalRateLimitSource = sourceProvenanceBefore.files["app/api/_lib/externalRateLimit.ts"];
    const adminSessionSource = sourceProvenanceBefore.files["app/api/_lib/adminSession.ts"];
    const rateLimitScript = externalRateLimitSource.match(/const RATE_LIMIT_SCRIPT = `([\s\S]*?)`;/)?.[1];
    const keeperDailyBudgetScript = externalRateLimitSource.match(/const KEEPER_DAILY_BUDGET_SCRIPT = `([\s\S]*?)`;/)?.[1];
    const rotateSessionScript = adminSessionSource.match(/const ROTATE_SESSION_SCRIPT = `([\s\S]*?)`;/)?.[1];
    assert.ok(rateLimitScript, "RATE_LIMIT_SCRIPT must remain extractable for provenance");
    assert.ok(keeperDailyBudgetScript, "KEEPER_DAILY_BUDGET_SCRIPT must remain extractable for provenance");
    assert.ok(rotateSessionScript, "ROTATE_SESSION_SCRIPT must remain extractable for provenance");
    const rateLimitScriptSha256 = sha256(rateLimitScript);
    const keeperDailyBudgetScriptSha256 = sha256(keeperDailyBudgetScript);
    const rotateSessionScriptSha256 = sha256(rotateSessionScript);

    const replicaA = await createReplica({
      adminSessionSecret,
      adminWalletAddress,
      caPath,
      chatAuthSecret,
      dbPath: join(tempRoot, "replica-a.sqlite"),
      endpoint,
      expectedSourceSha256,
      registry: replicas,
      replicaId: "replica-a",
      token: restToken,
    });
    const replicaB = await createReplica({
      adminSessionSecret,
      adminWalletAddress,
      caPath,
      chatAuthSecret,
      dbPath: join(tempRoot, "replica-b.sqlite"),
      endpoint,
      expectedSourceSha256,
      registry: replicas,
      replicaId: "replica-b",
      token: restToken,
    });
    assert.notEqual(replicaA.pid, replicaB.pid, "replicas must be distinct OS processes");

    const wrongBearerReplica = await createReplica({
      adminSessionSecret,
      adminWalletAddress,
      caPath,
      chatAuthSecret,
      dbPath: join(tempRoot, "replica-wrong-bearer.sqlite"),
      endpoint,
      expectedSourceSha256,
      registry: replicas,
      replicaId: "replica-wrong-bearer",
      token: wrongToken,
    });

    const windowMs = 60_000;
    const now = Math.floor(Date.now() / windowMs) * windowMs + 1;
    const input = {
      bucket: "valkey-parity",
      key: `shared-${randomBytes(8).toString("hex")}`,
      limit: 2,
      now,
      windowMs,
    };
    const redisKey = `lore:rate-limit:${input.bucket}:${input.key}:${now - (now % windowMs)}`;
    await assert.rejects(
      () => wrongBearerReplica.consume({ ...input, key: `unauthorized-${randomBytes(8).toString("hex")}` }),
      /external rate-limit store rejected request \((?:401|403)\)/,
      "the production rate-limit caller must fail closed on the wrong bearer",
    );
    const first = await replicaA.consume(input);
    const ttlAfterFirst = await executeRestCommand(ready.fetchImpl, endpoint, restToken, ["PTTL", redisKey]);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 75));
    const second = await replicaB.consume(input);
    const ttlAfterSecond = await executeRestCommand(ready.fetchImpl, endpoint, restToken, ["PTTL", redisKey]);
    const third = await replicaA.consume(input);
    assert.deepEqual(first.result, { allowed: true });
    assert.deepEqual(second.result, { allowed: true });
    assert.equal(third.result.allowed, false);
    assert.ok(Number.isInteger(third.result.retryAfter) && third.result.retryAfter >= 1 && third.result.retryAfter <= 60);
    for (const response of [first, second, third]) {
      assertEvalTransport(response, {
        argumentCount: 1,
        redisKey,
        scriptSha256: rateLimitScriptSha256,
      });
    }
    assert.equal(typeof ttlAfterFirst.json?.result, "number");
    assert.equal(typeof ttlAfterSecond.json?.result, "number");
    assert.ok(ttlAfterFirst.json.result > 0 && ttlAfterFirst.json.result <= windowMs);
    assert.ok(ttlAfterSecond.json.result > 0 && ttlAfterSecond.json.result < ttlAfterFirst.json.result);

    const storedCount = await executeRestCommand(ready.fetchImpl, endpoint, restToken, ["GET", redisKey]);
    assert.equal(storedCount.json?.result, "3");

    const keeperClockBefore = await readServerClock(ready.fetchImpl, endpoint, restToken);
    assert.ok(
      keeperClockBefore.secondsUntilNextUtcDay > 300,
      "keeper parity started within five minutes of UTC midnight; rerun after rollover",
    );
    const keeperChainId = 59_144;
    const keeperContractAddress = `0x${randomBytes(20).toString("hex")}`;
    const keeperSignerAddress = `0x${randomBytes(20).toString("hex")}`;
    const keeperRedisKey = keeperBudgetRedisKey(keeperChainId, keeperContractAddress);
    const keeperFirstInput = createKeeperReservationInput({
      chainId: keeperChainId,
      contractAddress: keeperContractAddress,
      signerAddress: keeperSignerAddress,
      nonce: 1,
      reservedMaxCostWei: "30",
    });
    const keeperSecondInput = createKeeperReservationInput({
      chainId: keeperChainId,
      contractAddress: keeperContractAddress,
      signerAddress: keeperSignerAddress,
      nonce: 2,
      reservedMaxCostWei: "40",
    });
    const keeperWrongBearerInput = {
      ...keeperFirstInput,
      contractAddress: `0x${randomBytes(20).toString("hex")}`,
    };
    await assert.rejects(
      () => wrongBearerReplica.reserveKeeper(keeperWrongBearerInput),
      /external keeper daily budget store rejected request \((?:401|403)\)/,
      "the production keeper budget caller must fail closed on the wrong bearer",
    );
    const keeperWrongBearerState = await executeRestCommand(
      ready.fetchImpl,
      endpoint,
      restToken,
      ["EXISTS", keeperBudgetRedisKey(keeperChainId, keeperWrongBearerInput.contractAddress)],
    );
    assert.equal(keeperWrongBearerState.json?.result, 0, "wrong-bearer keeper request must not create state");
    const keeperFirst = await replicaA.reserveKeeper(keeperFirstInput);
    const keeperExpiryAfterFirst = await inspectKeeperExpiry(ready.fetchImpl, endpoint, restToken, keeperRedisKey);
    const keeperSecond = await replicaB.reserveKeeper(keeperSecondInput);
    assert.equal(keeperFirst.result.status, "reserved");
    assert.equal(keeperFirst.result.utcDay, keeperClockBefore.utcDay);
    assert.equal(keeperFirst.result.reservedSignatureCount, 1);
    assert.equal(keeperFirst.result.reservedMaxCostWei, "30");
    assert.equal(keeperSecond.result.status, "reserved");
    assert.equal(keeperSecond.result.utcDay, keeperClockBefore.utcDay);
    assert.equal(keeperSecond.result.reservedSignatureCount, 2);
    assert.equal(keeperSecond.result.reservedMaxCostWei, "70");
    assert.equal(keeperExpiryAfterFirst.utcDay, keeperClockBefore.utcDay);

    const keeperRaceInputs = [3, 4].map((nonce) => createKeeperReservationInput({
      chainId: keeperChainId,
      contractAddress: keeperContractAddress,
      signerAddress: keeperSignerAddress,
      nonce,
      reservedMaxCostWei: "30",
    }));
    const keeperRace = await Promise.allSettled([
      replicaA.reserveKeeper(keeperRaceInputs[0]),
      replicaB.reserveKeeper(keeperRaceInputs[1]),
    ]);
    const keeperRaceWinnerIndex = keeperRace.findIndex((result) => result.status === "fulfilled");
    assert.notEqual(keeperRaceWinnerIndex, -1, "one keeper cost race contender must reserve");
    assert.equal(
      keeperRace.filter((result) => result.status === "fulfilled").length,
      1,
      "exactly one keeper cost race contender must reserve",
    );
    const keeperRaceLoser = keeperRace.find((result) => result.status === "rejected");
    assert.match(keeperRaceLoser?.reason?.message ?? "", /external keeper daily budget reserved cost exhausted/);
    const keeperRaceWinner = keeperRace[keeperRaceWinnerIndex].value;
    assert.equal(keeperRaceWinner.result.status, "reserved");
    assert.equal(keeperRaceWinner.result.utcDay, keeperClockBefore.utcDay);
    assert.equal(keeperRaceWinner.result.reservedSignatureCount, 3);
    assert.equal(keeperRaceWinner.result.reservedMaxCostWei, "100");

    const keeperExpiryBeforeReplay = await inspectKeeperExpiry(ready.fetchImpl, endpoint, restToken, keeperRedisKey);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 75));
    const keeperReplayReplica = keeperRaceWinnerIndex === 0 ? replicaB : replicaA;
    const keeperReplay = await keeperReplayReplica.reserveKeeper(keeperRaceInputs[keeperRaceWinnerIndex]);
    const keeperExpiryAfterReplay = await inspectKeeperExpiry(ready.fetchImpl, endpoint, restToken, keeperRedisKey);
    assert.deepEqual(keeperReplay.result, {
      status: "already_reserved",
      utcDay: keeperClockBefore.utcDay,
      reservedSignatureCount: 3,
      reservedMaxCostWei: "100",
    });
    assert.equal(
      keeperExpiryAfterReplay.expiresAtMs,
      keeperExpiryBeforeReplay.expiresAtMs,
      "keeper replay must preserve the exact absolute expiry",
    );
    assert.ok(
      keeperExpiryAfterReplay.ttlMs < keeperExpiryBeforeReplay.ttlMs,
      "keeper replay must not reset the midnight TTL",
    );

    const [keeperHashBeforeConflictResponse, keeperHashLength] = await Promise.all([
      executeRestCommand(ready.fetchImpl, endpoint, restToken, ["HGETALL", keeperRedisKey]),
      executeRestCommand(ready.fetchImpl, endpoint, restToken, ["HLEN", keeperRedisKey]),
    ]);
    const keeperHashBeforeConflict = normalizeRedisHashResponse(keeperHashBeforeConflictResponse);
    assert.equal(keeperHashBeforeConflict.__day, String(keeperClockBefore.utcDay));
    assert.equal(keeperHashBeforeConflict.__count, "3");
    assert.equal(keeperHashBeforeConflict.__cost, "100");
    assert.equal(keeperHashLength.json?.result, 6);
    await assert.rejects(
      () => keeperReplayReplica.reserveKeeper({
        ...keeperRaceInputs[keeperRaceWinnerIndex],
        signingIntentHash: `0x${sha256("keeper-parity:conflicting-intent")}`,
      }),
      /external keeper daily budget reservation conflict/,
    );
    const keeperHashAfterConflict = normalizeRedisHashResponse(await executeRestCommand(
      ready.fetchImpl,
      endpoint,
      restToken,
      ["HGETALL", keeperRedisKey],
    ));
    assert.deepEqual(keeperHashAfterConflict, keeperHashBeforeConflict, "keeper conflict must not mutate shared state");
    const keeperExpiryAfterConflict = await inspectKeeperExpiry(ready.fetchImpl, endpoint, restToken, keeperRedisKey);
    assert.equal(
      keeperExpiryAfterConflict.expiresAtMs,
      keeperExpiryAfterReplay.expiresAtMs,
      "keeper conflict must preserve the exact absolute expiry",
    );
    await assert.rejects(
      () => replicaA.reserveKeeper(createKeeperReservationInput({
        chainId: keeperChainId,
        contractAddress: keeperContractAddress,
        signerAddress: keeperSignerAddress,
        nonce: 5,
        reservedMaxCostWei: "30",
        maxReservedCostWei: "90",
      })),
      /external keeper daily budget stored usage exceeds active policy/,
    );

    const signatureContractAddress = `0x${randomBytes(20).toString("hex")}`;
    const signatureRedisKey = keeperBudgetRedisKey(keeperChainId, signatureContractAddress);
    const signatureRaceInputs = [10, 11].map((nonce) => createKeeperReservationInput({
      chainId: keeperChainId,
      contractAddress: signatureContractAddress,
      signerAddress: keeperSignerAddress,
      nonce,
      reservedMaxCostWei: "1",
      maxSignatures: 1,
    }));
    const signatureRace = await Promise.allSettled([
      replicaA.reserveKeeper(signatureRaceInputs[0]),
      replicaB.reserveKeeper(signatureRaceInputs[1]),
    ]);
    const signatureRaceWinnerIndex = signatureRace.findIndex((result) => result.status === "fulfilled");
    const signatureRaceWinner = signatureRace.find((result) => result.status === "fulfilled");
    const signatureRaceLoser = signatureRace.find((result) => result.status === "rejected");
    assert.equal(signatureRace.filter((result) => result.status === "fulfilled").length, 1);
    assert.notEqual(signatureRaceWinnerIndex, -1);
    assert.equal(signatureRaceWinner.value.result.status, "reserved");
    assert.equal(signatureRaceWinner.value.result.utcDay, keeperClockBefore.utcDay);
    assert.equal(signatureRaceWinner.value.result.reservedSignatureCount, 1);
    assert.equal(signatureRaceWinner.value.result.reservedMaxCostWei, "1");
    assert.match(signatureRaceLoser?.reason?.message ?? "", /external keeper daily budget signature count exhausted/);
    const signatureHash = normalizeRedisHashResponse(await executeRestCommand(
      ready.fetchImpl,
      endpoint,
      restToken,
      ["HGETALL", signatureRedisKey],
    ));
    const signatureWinnerField = keeperReservationField(
      keeperSignerAddress,
      signatureRaceInputs[signatureRaceWinnerIndex].nonce,
    );
    const signatureLoserField = keeperReservationField(
      keeperSignerAddress,
      signatureRaceInputs[signatureRaceWinnerIndex === 0 ? 1 : 0].nonce,
    );
    assert.equal(Object.keys(signatureHash).length, 4);
    assert.equal(signatureHash.__day, String(keeperClockBefore.utcDay));
    assert.equal(signatureHash.__count, "1");
    assert.equal(signatureHash.__cost, "1");
    assert.match(signatureHash[signatureWinnerField] ?? "", /^[0-9a-f]{64}$/);
    assert.equal(signatureHash[signatureLoserField], undefined);
    const signatureExpiry = await inspectKeeperExpiry(ready.fetchImpl, endpoint, restToken, signatureRedisKey);
    assert.equal(signatureExpiry.utcDay, keeperClockBefore.utcDay);

    const rolloverContractAddress = `0x${randomBytes(20).toString("hex")}`;
    const rolloverRedisKey = keeperBudgetRedisKey(keeperChainId, rolloverContractAddress);
    const rolloverSeedInput = createKeeperReservationInput({
      chainId: keeperChainId,
      contractAddress: rolloverContractAddress,
      signerAddress: keeperSignerAddress,
      nonce: 30,
      reservedMaxCostWei: "7",
    });
    const rolloverSeed = await replicaA.reserveKeeper(rolloverSeedInput);
    assert.equal(rolloverSeed.result.status, "reserved");
    assert.equal(rolloverSeed.result.utcDay, keeperClockBefore.utcDay);
    const forcePreviousDay = await executeRestCommand(
      ready.fetchImpl,
      endpoint,
      restToken,
      ["HSET", rolloverRedisKey, "__day", String(keeperClockBefore.utcDay - 1)],
    );
    assert.equal(forcePreviousDay.ok, true);
    assert.equal(forcePreviousDay.json?.result, 0);
    const rolloverReplacementInput = createKeeperReservationInput({
      chainId: keeperChainId,
      contractAddress: rolloverContractAddress,
      signerAddress: keeperSignerAddress,
      nonce: 31,
      reservedMaxCostWei: "11",
    });
    const rolloverReplacement = await replicaB.reserveKeeper(rolloverReplacementInput);
    assert.deepEqual(rolloverReplacement.result, {
      status: "reserved",
      utcDay: keeperClockBefore.utcDay,
      reservedSignatureCount: 1,
      reservedMaxCostWei: "11",
    });
    const [rolloverHashLength, rolloverOldReservation, rolloverExpiry] = await Promise.all([
      executeRestCommand(ready.fetchImpl, endpoint, restToken, ["HLEN", rolloverRedisKey]),
      executeRestCommand(ready.fetchImpl, endpoint, restToken, [
        "HGET",
        rolloverRedisKey,
        keeperReservationField(keeperSignerAddress, rolloverSeedInput.nonce),
      ]),
      inspectKeeperExpiry(ready.fetchImpl, endpoint, restToken, rolloverRedisKey),
    ]);
    const rolloverHash = normalizeRedisHashResponse(await executeRestCommand(
      ready.fetchImpl,
      endpoint,
      restToken,
      ["HGETALL", rolloverRedisKey],
    ));
    assert.equal(rolloverHashLength.json?.result, 4);
    assert.equal(rolloverOldReservation.json?.result, null);
    assert.equal(rolloverHash.__day, String(keeperClockBefore.utcDay));
    assert.equal(rolloverHash.__count, "1");
    assert.equal(rolloverHash.__cost, "11");
    assert.equal(rolloverExpiry.utcDay, keeperClockBefore.utcDay);

    const malformedContractAddress = `0x${randomBytes(20).toString("hex")}`;
    const malformedRedisKey = keeperBudgetRedisKey(keeperChainId, malformedContractAddress);
    const malformedSeedInput = createKeeperReservationInput({
      chainId: keeperChainId,
      contractAddress: malformedContractAddress,
      signerAddress: keeperSignerAddress,
      nonce: 40,
      reservedMaxCostWei: "1",
    });
    const malformedKeeperSeed = await replicaA.reserveKeeper(malformedSeedInput);
    assert.equal(malformedKeeperSeed.result.status, "reserved");
    const malformedSeed = await executeRestCommand(
      ready.fetchImpl,
      endpoint,
      restToken,
      ["HSET", malformedRedisKey, "__count", "not-a-number"],
    );
    assert.equal(malformedSeed.ok, true);
    assert.equal(malformedSeed.json?.result, 0);
    const malformedStateBeforeReject = normalizeRedisHashResponse(await executeRestCommand(
      ready.fetchImpl,
      endpoint,
      restToken,
      ["HGETALL", malformedRedisKey],
    ));
    const malformedExpiryBeforeReject = await inspectKeeperExpiry(
      ready.fetchImpl,
      endpoint,
      restToken,
      malformedRedisKey,
    );
    await assert.rejects(
      () => replicaB.reserveKeeper(createKeeperReservationInput({
        chainId: keeperChainId,
        contractAddress: malformedContractAddress,
        signerAddress: keeperSignerAddress,
        nonce: 20,
        reservedMaxCostWei: "1",
      })),
      /external keeper daily budget state invalid; manual reconciliation required/,
    );
    const malformedStateAfterReject = normalizeRedisHashResponse(await executeRestCommand(
      ready.fetchImpl,
      endpoint,
      restToken,
      ["HGETALL", malformedRedisKey],
    ));
    const malformedExpiryAfterReject = await inspectKeeperExpiry(
      ready.fetchImpl,
      endpoint,
      restToken,
      malformedRedisKey,
    );
    assert.deepEqual(
      malformedStateAfterReject,
      malformedStateBeforeReject,
      "malformed keeper refusal must not mutate the corrupted hash",
    );
    assert.equal(
      malformedExpiryAfterReject.expiresAtMs,
      malformedExpiryBeforeReject.expiresAtMs,
      "malformed keeper refusal must preserve the exact absolute expiry",
    );
    const malformedDelete = await executeRestCommand(ready.fetchImpl, endpoint, restToken, ["DEL", malformedRedisKey]);
    assert.equal(malformedDelete.json?.result, 1);

    const keeperClockAfter = await readServerClock(ready.fetchImpl, endpoint, restToken);
    assert.equal(keeperClockAfter.utcDay, keeperClockBefore.utcDay, "keeper parity sequence must remain within one UTC day");
    for (const response of [keeperFirst, keeperSecond, keeperRaceWinner, keeperReplay]) {
      assertEvalTransport(response, {
        argumentCount: 5,
        redisKey: keeperRedisKey,
        scriptSha256: keeperDailyBudgetScriptSha256,
      });
    }
    assertEvalTransport(signatureRaceWinner.value, {
      argumentCount: 5,
      redisKey: signatureRedisKey,
      scriptSha256: keeperDailyBudgetScriptSha256,
    });
    for (const response of [rolloverSeed, rolloverReplacement]) {
      assertEvalTransport(response, {
        argumentCount: 5,
        redisKey: rolloverRedisKey,
        scriptSha256: keeperDailyBudgetScriptSha256,
      });
    }
    assertEvalTransport(malformedKeeperSeed, {
      argumentCount: 5,
      redisKey: malformedRedisKey,
      scriptSha256: keeperDailyBudgetScriptSha256,
    });

    const sessionNow = Date.now();
    const issuedSession = await replicaA.issueSession({ address: adminWalletAddress, now: sessionNow });
    const issuedCookie = issuedSession.result.cookie;
    if (issuedCookie?.value) secrets.add(issuedCookie.value);
    assert.equal(issuedSession.result.expiresAt, sessionNow + ADMIN_SESSION_IDLE_TTL_MS);
    assertSessionCookie(issuedCookie, issuedSession.result.expiresAt);
    const sessionV1 = decodeSessionCookie(issuedCookie.value);
    if (typeof sessionV1?.sessionId === "string") secrets.add(sessionV1.sessionId);
    const expectedSessionV1 = {
      address: adminWalletAddress.toLowerCase(),
      absoluteExpiresAt: sessionNow + ADMIN_SESSION_ABSOLUTE_TTL_MS,
      expiresAt: sessionNow + ADMIN_SESSION_IDLE_TTL_MS,
      issuedAt: sessionNow,
      sessionId: sessionV1.sessionId,
      sessionVersion: 1,
      startedAt: sessionNow,
    };
    assertSessionPayload(sessionV1, expectedSessionV1);
    const sessionKey = sessionRedisKey(sessionV1.sessionId);
    assertSessionCommandTransport(issuedSession, {
      commandName: "SET",
      redisKey: sessionKey,
      ttlMsArgument: String(ADMIN_SESSION_IDLE_TTL_MS),
    });
    const sessionRecordV1 = serializeSessionRecord(sessionV1);
    const storedSessionV1 = await executeRestCommand(ready.fetchImpl, endpoint, restToken, ["GET", sessionKey]);
    assert.equal(storedSessionV1.ok, true);
    assert.equal(storedSessionV1.json?.result, sessionRecordV1);
    const issuedSessionExpiry = await inspectRedisExpiry(ready.fetchImpl, endpoint, restToken, sessionKey);
    assert.ok(issuedSessionExpiry.ttlMs > 0 && issuedSessionExpiry.ttlMs <= ADMIN_SESSION_IDLE_TTL_MS);
    assert.ok(
      Math.abs(issuedSessionExpiry.expiresAtMs - issuedSession.result.expiresAt) <= 5_000,
      "issued session store deadline must remain near the returned cookie deadline",
    );

    const [sessionReadA, sessionReadB] = await Promise.all([
      replicaA.readSession({ cookieValue: issuedCookie.value, now: sessionNow }),
      replicaB.readSession({ cookieValue: issuedCookie.value, now: sessionNow }),
    ]);
    assertSessionPayload(sessionReadA.result, sessionV1);
    assertSessionPayload(sessionReadB.result, sessionV1);
    for (const response of [sessionReadA, sessionReadB]) {
      assertSessionCommandTransport(response, { commandName: "GET", redisKey: sessionKey });
    }

    const sessionStateBeforeWrongBearer = await executeRestCommand(
      ready.fetchImpl,
      endpoint,
      restToken,
      ["GET", sessionKey],
    );
    const sessionExpiryBeforeWrongBearer = await inspectRedisExpiry(
      ready.fetchImpl,
      endpoint,
      restToken,
      sessionKey,
    );
    await assert.rejects(
      () => wrongBearerReplica.rotateSession({ previous: sessionReadA.result, now: sessionNow + 500 }),
      /shared admin session store rejected the request/,
      "admin session rotation must fail closed on the wrong bearer",
    );
    const sessionStateAfterWrongBearer = await executeRestCommand(
      ready.fetchImpl,
      endpoint,
      restToken,
      ["GET", sessionKey],
    );
    const sessionExpiryAfterWrongBearer = await inspectRedisExpiry(
      ready.fetchImpl,
      endpoint,
      restToken,
      sessionKey,
    );
    assert.equal(sessionStateAfterWrongBearer.json?.result, sessionStateBeforeWrongBearer.json?.result);
    assert.equal(
      sessionExpiryAfterWrongBearer.expiresAtMs,
      sessionExpiryBeforeWrongBearer.expiresAtMs,
      "wrong-Bearer rotation must preserve the exact session deadline",
    );

    const rotationNow = sessionNow + 1_000;
    const sessionRace = await Promise.all([
      replicaA.rotateSession({ previous: sessionReadA.result, now: rotationNow }),
      replicaB.rotateSession({ previous: sessionReadB.result, now: rotationNow }),
    ]);
    for (const response of sessionRace) {
      if (response.result.cookie?.value) secrets.add(response.result.cookie.value);
      assertSessionCommandTransport(response, {
        argumentCount: 3,
        commandName: "EVAL",
        redisKey: sessionKey,
        scriptSha256: rotateSessionScriptSha256,
        ttlMsArgument: String(ADMIN_SESSION_IDLE_TTL_MS),
      });
    }
    const sessionWinnerIndex = sessionRace.findIndex((response) => response.result.expiresAt !== null);
    assert.ok(sessionWinnerIndex === 0 || sessionWinnerIndex === 1, "exactly one replica must win rotation");
    assert.equal(
      sessionRace.filter((response) => response.result.expiresAt !== null).length,
      1,
      "concurrent rotation must have exactly one winner",
    );
    const sessionWinner = sessionRace[sessionWinnerIndex];
    const sessionLoser = sessionRace[sessionWinnerIndex === 0 ? 1 : 0];
    assert.equal(sessionWinner.result.expiresAt, rotationNow + ADMIN_SESSION_IDLE_TTL_MS);
    assertSessionCookie(sessionWinner.result.cookie, sessionWinner.result.expiresAt);
    assert.equal(sessionLoser.result.expiresAt, null);
    assert.equal(sessionLoser.result.cookie, null);
    const sessionV2 = decodeSessionCookie(sessionWinner.result.cookie.value);
    if (typeof sessionV2?.sessionId === "string") secrets.add(sessionV2.sessionId);
    assertSessionPayload(sessionV2, {
      ...sessionV1,
      expiresAt: rotationNow + ADMIN_SESSION_IDLE_TTL_MS,
      issuedAt: rotationNow,
      sessionVersion: 2,
    });
    const sessionRecordV2 = serializeSessionRecord(sessionV2);
    const storedSessionV2 = await executeRestCommand(ready.fetchImpl, endpoint, restToken, ["GET", sessionKey]);
    assert.equal(storedSessionV2.ok, true);
    assert.equal(storedSessionV2.json?.result, sessionRecordV2);
    const rotatedSessionExpiry = await inspectRedisExpiry(ready.fetchImpl, endpoint, restToken, sessionKey);
    assert.ok(rotatedSessionExpiry.ttlMs > 0 && rotatedSessionExpiry.ttlMs <= ADMIN_SESSION_IDLE_TTL_MS);
    assert.ok(
      rotatedSessionExpiry.expiresAtMs > issuedSessionExpiry.expiresAtMs,
      "successful rotation must move the idle deadline forward",
    );
    assert.ok(
      Math.abs(rotatedSessionExpiry.expiresAtMs - sessionWinner.result.expiresAt) <= 5_000,
      "rotated session store deadline must remain near the returned cookie deadline",
    );

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 75));
    const replayReplica = sessionWinnerIndex === 0 ? replicaB : replicaA;
    const replayBeforeExpiry = await inspectRedisExpiry(ready.fetchImpl, endpoint, restToken, sessionKey);
    const staleRotationReplay = await replayReplica.rotateSession({
      previous: sessionV1,
      now: rotationNow + 1_000,
    });
    assert.equal(staleRotationReplay.result.expiresAt, null);
    assert.equal(staleRotationReplay.result.cookie, null);
    assertSessionCommandTransport(staleRotationReplay, {
      argumentCount: 3,
      commandName: "EVAL",
      redisKey: sessionKey,
      scriptSha256: rotateSessionScriptSha256,
      ttlMsArgument: String(ADMIN_SESSION_IDLE_TTL_MS),
    });
    const replayedSessionState = await executeRestCommand(
      ready.fetchImpl,
      endpoint,
      restToken,
      ["GET", sessionKey],
    );
    const replayAfterExpiry = await inspectRedisExpiry(ready.fetchImpl, endpoint, restToken, sessionKey);
    assert.equal(replayedSessionState.json?.result, sessionRecordV2);
    assert.equal(
      replayAfterExpiry.expiresAtMs,
      replayBeforeExpiry.expiresAtMs,
      "stale rotation must preserve the exact active session deadline",
    );
    assert.ok(replayAfterExpiry.ttlMs < replayBeforeExpiry.ttlMs, "stale rotation must not extend session TTL");

    const [oldCookieReadA, oldCookieReadB, newCookieReadA, newCookieReadB] = await Promise.all([
      replicaA.readSession({ cookieValue: issuedCookie.value, now: rotationNow + 1_000 }),
      replicaB.readSession({ cookieValue: issuedCookie.value, now: rotationNow + 1_000 }),
      replicaA.readSession({ cookieValue: sessionWinner.result.cookie.value, now: rotationNow + 1_000 }),
      replicaB.readSession({ cookieValue: sessionWinner.result.cookie.value, now: rotationNow + 1_000 }),
    ]);
    assert.equal(oldCookieReadA.result, null);
    assert.equal(oldCookieReadB.result, null);
    assertSessionPayload(newCookieReadA.result, sessionV2);
    assertSessionPayload(newCookieReadB.result, sessionV2);
    for (const response of [oldCookieReadA, oldCookieReadB, newCookieReadA, newCookieReadB]) {
      assertSessionCommandTransport(response, { commandName: "GET", redisKey: sessionKey });
    }

    const unauthorized = await executeRestCommand(ready.fetchImpl, endpoint, wrongToken, ["PING"]);
    assert.equal(unauthorized.ok, false);
    assert.ok(unauthorized.status === 401 || unauthorized.status === 403);
    assert.equal(unauthorized.json?.result, undefined);
    const invalidEval = await executeRestCommand(
      ready.fetchImpl,
      endpoint,
      restToken,
      ["EVAL", "return redis.call('SET')", "0"],
    );
    assert.ok(typeof invalidEval.json?.error === "string" && invalidEval.json.error.length > 0);
    const serverInfo = await executeRestCommand(ready.fetchImpl, endpoint, restToken, ["INFO", "server"]);
    assert.equal(serverInfo.ok, true);
    assert.equal(typeof serverInfo.json?.result, "string");
    const valkeyVersion = serverInfo.json.result.match(/(?:^|\r?\n)valkey_version:([^\r\n]+)/)?.[1] ?? "unknown";
    assert.equal(valkeyVersion, "8.1.9");

    const [caddyVersionResult, sourceProvenanceAfter] = await Promise.all([
      docker(["exec", names.caddy, "caddy", "version"]),
      captureSourceProvenance(),
    ]);
    assert.deepEqual(
      sourceProvenanceAfter,
      sourceProvenanceBefore,
      "HEAD, relevant source blobs, and working-tree content must remain stable across execution",
    );
    const caddyVersion = caddyVersionResult.stdout.split(/\s+/)[0];
    assert.equal(caddyVersion, "v2.11.4", "Caddy runtime version");
    const sourceBindings = sourceProvenanceBefore.bindings;
    const allRelevantFilesBoundToRevision = Object.values(sourceBindings)
      .every((binding) => binding.boundToSourceRevision);
    const harnessSource = sourceProvenanceBefore.files["scripts/test-valkey-rest-rate-limit.mjs"];
    evidence = {
      status: "partial",
      scope: "https-rest-rate-limit-keeper-session-two-replica",
      sourceRevisionSha: sourceProvenanceBefore.sourceRevisionSha,
      sourceBinding: {
        allRelevantFilesBoundToRevision,
        files: sourceBindings,
        stableAcrossExecution: true,
        stableFromProcessStartup: true,
        trackedWorktreeClean: sourceProvenanceBefore.trackedWorktreeStatus === "",
      },
      containerPlatform: PLATFORM,
      hostNode: {
        architecture: process.arch,
        platform: process.platform,
        version: process.version,
      },
      images: Object.fromEntries(Object.entries(IMAGES).map(([name, image]) => [name, {
        executedPlatformManifestDigest: image.platformDigest,
        observedLocalIndexDigest: image.indexDigest,
        selectionTag: image.selectionTag,
      }])),
      runtime: {
        httpsProxyVersion: caddyVersion,
        keeperUtcDay: keeperClockBefore.utcDay,
        valkeyVersion,
      },
      sourceSha256: {
        adminAuth: sha256(sourceProvenanceBefore.files["app/lib/adminAuth.ts"]),
        adminSession: sha256(adminSessionSource),
        externalRateLimit: sha256(externalRateLimitSource),
        keeperDailyBudgetScript: keeperDailyBudgetScriptSha256,
        rateLimitScript: rateLimitScriptSha256,
        rotateSessionScript: rotateSessionScriptSha256,
        testHarness: sha256(harnessSource),
      },
      checks: {
        adminSessionAtomicRotationThroughHttpsRest: true,
        adminSessionOldCookieRejectedForRead: true,
        adminSessionSharedAcrossReplicas: true,
        adminSessionStaleRotationPreservedStateAndDeadline: true,
        adminSessionWrongBearerPreservedStateAndDeadline: true,
        authenticatedTlsTransport: true,
        applicationWrongBearerFailClosed: true,
        backendInternalWithNoDataStoreHostPorts: true,
        defaultSystemCaRejected: true,
        wrongBearerRejected: true,
        resultAndErrorEnvelopes: true,
        replicasReportedCapturedSourceDigest: true,
        twoIndependentNodeReplicas: true,
        sharedAllowedAllowedBlockedSequence: true,
        ttlSetOnceAndNotReset: true,
        keeperDailyBudgetThroughHttpsRest: true,
        keeperCrossReplicaReplayAndConflict: true,
        keeperAtomicCostAndSignatureCaps: true,
        keeperConflictLeftStateUnchanged: true,
        keeperPastDayStateResetAgainstServerTime: true,
        keeperServerTimeUtcDayAndMidnightTtl: true,
        keeperMalformedStateFailClosed: true,
        loopbackOnlyPublishedPort: true,
        ownedResourceIdsAndLabelsVerified: true,
      },
      missing: [
        "REST facade self-reported runtime version (immutable manifest is verified)",
        "deployed web replicas and provider-managed HTTPS endpoint",
        "hosted /api/admin/auth route, browser Set-Cookie, and public-HTTPS enforcement",
        "persistent external database and backup/restore evidence",
      ],
    };
  } finally {
    const cleanupFailures = [];
    for (const replica of replicas.reverse()) {
      try {
        await replica.stop();
      } catch (error) {
        cleanupFailures.push(error);
      }
    }
    const cleanupContainers = [...attemptedContainerNames].reverse();
    const cleanupNetworks = [...attemptedNetworkNames].reverse();
    for (let pass = 0; pass < 2; pass += 1) {
      for (const container of cleanupContainers) {
        try {
          validateOwnedName(container);
          await removeOwnedResource("container", container, runLabel, createdContainerIds);
        } catch (error) {
          cleanupFailures.push(error);
        }
      }
      for (const network of cleanupNetworks) {
        try {
          validateOwnedName(network);
          await removeOwnedResource("network", network, runLabel, createdNetworkIds);
        } catch (error) {
          cleanupFailures.push(error);
        }
      }
      if (pass === 0 && (cleanupContainers.length > 0 || cleanupNetworks.length > 0)) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
      }
    }
    if (cleanupContainers.length > 0 || cleanupNetworks.length > 0) {
      try {
        await assertNoResourcesWithRunLabel(runLabel);
      } catch (error) {
        cleanupFailures.push(error);
      }
    }
    try {
      await rm(validateOwnedTempRoot(tempRoot), { force: true, recursive: true });
    } catch (error) {
      cleanupFailures.push(error);
    }
    try {
      assert.deepEqual(await snapshotProtectedDb(), protectedDbBefore, "protected SQLite base/WAL/SHM identity must not change");
    } catch (error) {
      cleanupFailures.push(error);
    }
    if (cleanupFailures.length > 0) throw new AggregateError(cleanupFailures, "Valkey parity cleanup failed");
    cleanupVerified = true;
  }

  assert.ok(evidence, "parity evidence must exist after a successful run");
  assert.equal(cleanupVerified, true, "exact cleanup must be verified before artifact publication");
  assert.ok(sourceProvenanceBefore, "pre-execution source provenance must exist");
  const sourceProvenanceAfterCleanup = await captureSourceProvenance();
  assert.deepEqual(
    sourceProvenanceAfterCleanup,
    sourceProvenanceBefore,
    "HEAD, relevant source blobs, and working-tree content must remain stable through cleanup",
  );
  evidence.checks.exactOwnedCleanup = true;
  evidence.checks.protectedDbUnchanged = true;
  evidence.checks.replicaGracefulDbCloseAndExit = true;
  evidence.sourceBinding.stableThroughCleanup = true;
  const serializedEvidence = JSON.stringify(evidence);
  for (const secret of secrets) assert.equal(serializedEvidence.includes(secret), false, "evidence must not contain test secrets");
  await mkdir(dirname(ARTIFACT_PATH), { recursive: true });
  await writeFile(ARTIFACT_PATH, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(evidence));
}

if (process.argv[2] === "--replica") await replicaMain();
else {
  const sourceProvenanceAtStartup = await captureSourceProvenance();
  await main(sourceProvenanceAtStartup);
}
