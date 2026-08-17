import { appendFileSync, closeSync, lstatSync, mkdirSync, openSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

function samePath(left, right) {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function lstatPathEntry(path, fsApi) {
  try {
    return fsApi.lstatSync(path);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

export function createLiveCanaryLogPath({
  configuredPath = process.env.LIVE_TEST_LOG_PATH,
  cwd = process.cwd(),
  now = new Date(),
  fsApi = { lstatSync, mkdirSync, realpathSync },
} = {}) {
  const configured = typeof configuredPath === "string" ? configuredPath.trim() : "";
  if (configured && !isAbsolute(configured)) {
    throw new Error("LIVE_TEST_LOG_PATH must be an absolute path");
  }

  const logPath = configured
    ? resolve(configured)
    : join(
      resolve(cwd, "data", "live-test-runs"),
      `live-canary-${now.toISOString().replace(/[:.]/g, "-")}.jsonl`,
    );
  const parent = dirname(logPath);
  fsApi.mkdirSync(parent, { recursive: true });
  const parentStats = fsApi.lstatSync(parent);
  if (!parentStats.isDirectory() || parentStats.isSymbolicLink()) {
    throw new Error("Live canary log parent must be an ordinary directory");
  }
  const canonicalParent = fsApi.realpathSync(parent);
  if (!samePath(canonicalParent, parent)) {
    throw new Error("Live canary log parent must not resolve through a reparse point");
  }

  const logStats = lstatPathEntry(logPath, fsApi);
  if (logStats !== null) {
    if (!logStats.isFile() || logStats.isSymbolicLink()) {
      throw new Error("Live canary log path must be an ordinary file");
    }
  }
  return logPath;
}

export function initializeLiveCanaryLogFile({
  logPath,
  fsApi = { closeSync, openSync },
}) {
  let handle = null;
  try {
    handle = fsApi.openSync(logPath, "wx");
  } finally {
    if (handle !== null) fsApi.closeSync(handle);
  }
}

export function appendBoundedLiveCanaryLine({
  logPath,
  line,
  maxBytes,
  fsApi = { appendFileSync, lstatSync, statSync },
}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error("Live canary log byte cap must be a positive safe integer");
  }
  const linkStats = fsApi.lstatSync(logPath);
  const fileStats = fsApi.statSync(logPath);
  if (!linkStats.isFile() || linkStats.isSymbolicLink() || !fileStats.isFile()) {
    throw new Error("Live canary log path must remain an ordinary file");
  }
  const payload = Buffer.isBuffer(line) ? line : Buffer.from(String(line), "utf8");
  if (payload.length > maxBytes || fileStats.size > maxBytes - payload.length) {
    throw new Error(`Live canary log reached its ${maxBytes}-byte complete-artifact cap`);
  }
  fsApi.appendFileSync(logPath, payload);
  return fileStats.size + payload.length;
}
