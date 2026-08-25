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
const SOURCE_BINDING_PATHS = Object.freeze([
  "app/api/_lib/externalRateLimit.ts",
  "package.json",
  "scripts/test-valkey-rest-rate-limit.mjs",
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
    observation.lastRequest = {
      bearerMatches: expectedToken === null ? null : headers.authorization === `Bearer ${expectedToken}`,
      commandName: Array.isArray(command) ? command[0] : null,
      contentType: headers["content-type"] ?? null,
      keyCount: Array.isArray(command) ? command[2] : null,
      method: init.method ?? "GET",
      redisKey: Array.isArray(command) ? command[3] : null,
      scriptSha256: Array.isArray(command) && typeof command[1] === "string" ? sha256(command[1]) : null,
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

async function createReplica({ caPath, dbPath, endpoint, expectedExternalRateLimitSha256, registry, replicaId, token }) {
  const child = fork(SCRIPT_PATH, ["--replica"], {
    cwd: REPO_ROOT,
    env: minimalChildEnvironment({
      LORE_VALKEY_PARITY_CA_PATH: caPath,
      LORE_VALKEY_PARITY_ENDPOINT: endpoint,
      LORE_VALKEY_PARITY_REPLICA_ID: replicaId,
      LORE_DB_PATH: dbPath,
      UPSTASH_REDIS_REST_TOKEN: token,
      UPSTASH_REDIS_REST_URL: endpoint,
    }),
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
  const replica = {
    get pid() {
      return verifiedPid;
    },
    replicaId,
    async consume(input) {
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
        child.send({ id, type: "consume", input }, (error) => {
          if (!error || !pending.has(id)) return;
          pending.get(id).reject(error);
        });
        return await withTimeout(response, 5_000, `replica ${replicaId} request timed out`);
      } finally {
        pending.delete(id);
      }
    },
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      if (!readyVerified) {
        await forceStopChild(child);
        return;
      }
      if (child.connected) {
        try {
          child.send({ type: "shutdown" }, () => undefined);
        } catch {
          await forceStopChild(child);
          return;
        }
      }
      try {
        await waitForExit(child);
      } catch {
        await forceStopChild(child);
      }
      assert.ok(child.exitCode !== null || child.signalCode !== null, `replica ${replicaId} must exit during cleanup`);
    },
  };
  registry.push(replica);
  const readyMessage = await withTimeout(ready, 10_000, `replica ${replicaId} readiness timed out`);
  assert.equal(readyMessage.replicaId, replicaId);
  assert.ok(Number.isInteger(readyMessage.pid) && readyMessage.pid > 0);
  assert.equal(
    readyMessage.externalRateLimitSourceSha256,
    expectedExternalRateLimitSha256,
    `replica ${replicaId} must import the captured external rate-limit source`,
  );
  verifiedPid = readyMessage.pid;
  readyVerified = true;
  return replica;
}

async function replicaMain() {
  const caPath = process.env.LORE_VALKEY_PARITY_CA_PATH;
  const endpoint = process.env.LORE_VALKEY_PARITY_ENDPOINT;
  const replicaId = process.env.LORE_VALKEY_PARITY_REPLICA_ID;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!caPath || !endpoint || !replicaId || !token) throw new Error("replica parity configuration is incomplete");
  secrets.add(token);
  const ca = await readFile(caPath, "utf8");
  const observation = { lastRequest: null, requestCount: 0, tlsAuthorized: false, tlsProtocol: null };
  const fetchImpl = createPinnedHttpsFetch({ ca, endpoint, expectedToken: token, observation });
  const externalRateLimitSourcePath = resolve(REPO_ROOT, "app", "api", "_lib", "externalRateLimit.ts");
  const externalRateLimitSourceBefore = await readFile(externalRateLimitSourcePath, "utf8");
  const externalRateLimitModule = await import("../app/api/_lib/externalRateLimit.ts");
  const externalRateLimitSourceAfter = await readFile(externalRateLimitSourcePath, "utf8");
  assert.equal(
    externalRateLimitSourceAfter,
    externalRateLimitSourceBefore,
    "external rate-limit source must remain stable across replica import",
  );
  const externalRateLimit = externalRateLimitModule.default ?? externalRateLimitModule;
  process.send?.({
    type: "ready",
    externalRateLimitSourceSha256: sha256(externalRateLimitSourceBefore),
    pid: process.pid,
    replicaId,
  });
  let queue = Promise.resolve();
  process.on("message", (message) => {
    queue = queue.then(async () => {
      if (!message || typeof message !== "object") return;
      if (message.type === "shutdown") {
        process.disconnect();
        return;
      }
      if (message.type !== "consume") return;
      try {
        const result = await externalRateLimit.consumeExternalRateLimit(
          message.input.bucket,
          message.input.key,
          message.input.limit,
          message.input.windowMs,
          message.input.now,
          fetchImpl,
        );
        process.send?.({
          id: message.id,
          type: "response",
          result,
          transport: {
            requestCount: observation.requestCount,
            request: observation.lastRequest,
            tlsAuthorized: observation.tlsAuthorized,
            tlsProtocol: observation.tlsProtocol,
          },
        });
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
  secrets.add(valkeyPassword);
  secrets.add(restToken);
  secrets.add(wrongToken);
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
    const sourceProvenanceBefore = await captureSourceProvenance();
    assert.deepEqual(
      sourceProvenanceBefore,
      sourceProvenanceAtStartup,
      "HEAD, harness, package entry, and production source must remain stable from process startup through setup",
    );
    const expectedExternalRateLimitSha256 = sourceProvenanceBefore.sourceSha256["app/api/_lib/externalRateLimit.ts"];

    const replicaA = await createReplica({
      caPath,
      dbPath: join(tempRoot, "replica-a.sqlite"),
      endpoint,
      expectedExternalRateLimitSha256,
      registry: replicas,
      replicaId: "replica-a",
      token: restToken,
    });
    const replicaB = await createReplica({
      caPath,
      dbPath: join(tempRoot, "replica-b.sqlite"),
      endpoint,
      expectedExternalRateLimitSha256,
      registry: replicas,
      replicaId: "replica-b",
      token: restToken,
    });
    assert.notEqual(replicaA.pid, replicaB.pid, "replicas must be distinct OS processes");

    const wrongBearerReplica = await createReplica({
      caPath,
      dbPath: join(tempRoot, "replica-wrong-bearer.sqlite"),
      endpoint,
      expectedExternalRateLimitSha256,
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
      assert.equal(response.transport.tlsAuthorized, true);
      assert.match(response.transport.tlsProtocol, /^TLSv1\.[23]$/);
      assert.equal(response.transport.request.bearerMatches, true);
      assert.equal(response.transport.request.commandName, "EVAL");
      assert.equal(response.transport.request.contentType, "application/json");
      assert.equal(response.transport.request.keyCount, "1");
      assert.equal(response.transport.request.method, "POST");
      assert.equal(response.transport.request.redisKey, redisKey);
    }
    assert.equal(typeof ttlAfterFirst.json?.result, "number");
    assert.equal(typeof ttlAfterSecond.json?.result, "number");
    assert.ok(ttlAfterFirst.json.result > 0 && ttlAfterFirst.json.result <= windowMs);
    assert.ok(ttlAfterSecond.json.result > 0 && ttlAfterSecond.json.result < ttlAfterFirst.json.result);

    const storedCount = await executeRestCommand(ready.fetchImpl, endpoint, restToken, ["GET", redisKey]);
    assert.equal(storedCount.json?.result, "3");
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
    const rateLimitSource = sourceProvenanceBefore.files["app/api/_lib/externalRateLimit.ts"];
    const harnessSource = sourceProvenanceBefore.files["scripts/test-valkey-rest-rate-limit.mjs"];
    const rateLimitScript = rateLimitSource.match(/const RATE_LIMIT_SCRIPT = `([\s\S]*?)`;/)?.[1];
    assert.ok(rateLimitScript, "RATE_LIMIT_SCRIPT must remain extractable for provenance");
    for (const response of [first, second, third]) {
      assert.equal(response.transport.request.scriptSha256, sha256(rateLimitScript));
    }
    evidence = {
      status: "partial",
      scope: "https-rest-rate-limit-two-replica",
      sourceRevisionSha: sourceProvenanceBefore.sourceRevisionSha,
      sourceBinding: {
        allRelevantFilesBoundToRevision,
        files: sourceBindings,
        stableAcrossExecution: true,
        stableFromProcessStartup: true,
        trackedWorktreeClean: sourceProvenanceBefore.trackedWorktreeStatus === "",
      },
      platform: PLATFORM,
      images: Object.fromEntries(Object.entries(IMAGES).map(([name, image]) => [name, {
        executedPlatformManifestDigest: image.platformDigest,
        observedLocalIndexDigest: image.indexDigest,
        selectionTag: image.selectionTag,
      }])),
      runtime: {
        httpsProxyVersion: caddyVersion,
        valkeyVersion,
      },
      sourceSha256: {
        externalRateLimit: sha256(rateLimitSource),
        rateLimitScript: sha256(rateLimitScript),
        testHarness: sha256(harnessSource),
      },
      checks: {
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
        loopbackOnlyPublishedPort: true,
        ownedResourceIdsAndLabelsVerified: true,
      },
      missing: [
        "REST facade self-reported runtime version (immutable manifest is verified)",
        "keeper daily budget through HTTPS REST",
        "admin session rotation through HTTPS REST",
        "deployed web replicas and provider-managed HTTPS endpoint",
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
  evidence.checks.exactOwnedCleanup = true;
  evidence.checks.protectedDbUnchanged = true;
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
