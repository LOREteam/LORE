import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const http = require("node:http");
const https = require("node:https");
const net = require("node:net");
const tls = require("node:tls");

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const BLOCKED_ERROR_CODE = "P1_PERF_EXTERNAL_NETWORK_BLOCKED";

function normalizeHostname(value) {
  return String(value ?? "")
    .trim()
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .toLowerCase();
}

function isLoopbackHostname(value) {
  const hostname = normalizeHostname(value);
  return hostname.length === 0 || LOOPBACK_HOSTS.has(hostname);
}

function blockedError() {
  const error = new Error(BLOCKED_ERROR_CODE);
  error.code = BLOCKED_ERROR_CODE;
  return error;
}

function assertLoopbackUrl(input) {
  const url = input instanceof URL ? input : new URL(String(input));
  if (!["http:", "https:"].includes(url.protocol)) return;
  if (!isLoopbackHostname(url.hostname)) throw blockedError();
}

function hostnameFromRequestArgs(input, options) {
  if (input instanceof URL) return input.hostname;
  if (typeof input === "string") {
    try {
      return new URL(input).hostname;
    } catch {
      return "";
    }
  }
  const requestOptions = {
    ...(input && typeof input === "object" ? input : {}),
    ...(options && typeof options === "object" ? options : {}),
  };
  return requestOptions.hostname ?? requestOptions.host ?? "";
}

function guardRequest(original) {
  return function guardedRequest(input, options, callback) {
    if (!isLoopbackHostname(hostnameFromRequestArgs(input, options))) throw blockedError();
    return original.call(this, input, options, callback);
  };
}

function guardConnect(original) {
  return function guardedConnect(...args) {
    const first = args[0];
    const second = args[1];
    if (typeof first === "string" && !/^\d+$/.test(first)) {
      // Named pipes and Unix-domain sockets are local IPC, not network destinations.
      return original.apply(this, args);
    }
    const options = first && typeof first === "object" ? first : {};
    const hostname = options.host ?? options.hostname ?? (typeof second === "string" ? second : "");
    if (!isLoopbackHostname(hostname)) throw blockedError();
    return original.apply(this, args);
  };
}

if (typeof globalThis.fetch === "function") {
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input, init) => {
    const requestUrl = typeof input === "string" || input instanceof URL ? input : input?.url;
    assertLoopbackUrl(requestUrl);
    return originalFetch(input, init);
  };
}

http.request = guardRequest(http.request);
http.get = guardRequest(http.get);
https.request = guardRequest(https.request);
https.get = guardRequest(https.get);
net.connect = guardConnect(net.connect);
net.createConnection = guardConnect(net.createConnection);
tls.connect = guardConnect(tls.connect);
