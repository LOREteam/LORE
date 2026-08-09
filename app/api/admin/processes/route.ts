import { closeSync, existsSync, openSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { spawn } from "node:child_process";
import { NextRequest, NextResponse } from "next/server";
import { readAdminSession } from "../../_lib/adminSession";
import { enforceSharedRateLimit } from "../../_lib/sharedRateLimit";
import { applyNoStoreHeaders } from "../../_lib/responseHeaders";
import { readBoundedJsonBody } from "../../_lib/boundedJsonBody";

const MAX_REQUEST_BODY_BYTES = 1_024;
const TRACKED_PID_RE = /^[1-9]\d{0,9}$/;
const MAX_TRACKED_PID = 2_147_483_647;
const MAX_TRACKED_PID_BIGINT = BigInt(MAX_TRACKED_PID);

const PROCESS_CONFIG = {
  indexer: {
    label: "Indexer",
    args: ["run", "indexer"],
    logFile: resolve(process.cwd(), "artifacts", "indexer-watch.log"),
    pidFile: resolve(process.cwd(), "artifacts", "indexer-watch.pid"),
  },
  bot: {
    label: "Bot / Keeper",
    args: ["run", "bot"],
    logFile: resolve(process.cwd(), "artifacts", "bot.log"),
    pidFile: resolve(process.cwd(), "artifacts", "bot.pid"),
  },
} as const;

type ProcessKey = keyof typeof PROCESS_CONFIG;

function isAdminProcessRouteEnabled() {
  return process.env.NODE_ENV !== "production" && process.env.ADMIN_PROCESS_ROUTE_ENABLED === "1";
}

function disabledResponse() {
  return applyNoStoreHeaders(
    NextResponse.json({ error: "Admin process controls are disabled" }, { status: 404 }),
    { varyCookie: true },
  );
}

function pathIsRegularFile(file: string) {
  try {
    return existsSync(file) && statSync(file).isFile();
  } catch {
    return false;
  }
}

function getProcessStatus(target: ProcessKey) {
  const config = PROCESS_CONFIG[target];
  const pid = readTrackedPid(target);
  const running = pid != null && isProcessAlive(pid);
  if (!pathIsRegularFile(config.logFile)) {
    return {
      target,
      label: config.label,
      status: "missing" as const,
      ageMs: null,
      logFile: basename(config.logFile),
      pid,
      running,
    };
  }

  const ageMs = Date.now() - statSync(config.logFile).mtimeMs;
  return {
    target,
    label: config.label,
    status: ageMs <= 90_000 ? "fresh" as const : "stale" as const,
    ageMs,
    logFile: basename(config.logFile),
    pid,
    running,
  };
}

function startLocalProcess(target: ProcessKey) {
  const config = PROCESS_CONFIG[target];
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const logFd = openSync(config.logFile, "a");
  const child = spawn(command, config.args, {
    cwd: process.cwd(),
    env: process.env,
    detached: true,
    shell: process.platform === "win32",
    stdio: ["ignore", logFd, logFd],
    ...(process.platform === "win32" ? { windowsHide: true } : {}),
  });
  closeSync(logFd);
  if (child.pid) {
    writeFileSync(config.pidFile, String(child.pid), "utf8");
  }
  child.unref();
}

function readTrackedPid(target: ProcessKey) {
  const config = PROCESS_CONFIG[target];
  if (!pathIsRegularFile(config.pidFile)) return null;
  const raw = readFileSync(config.pidFile, "utf8").trim();
  if (!TRACKED_PID_RE.test(raw)) return null;
  const pid = BigInt(raw);
  return pid <= MAX_TRACKED_PID_BIGINT ? Number(pid) : null;
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  if (!isAdminProcessRouteEnabled()) return disabledResponse();

  const rateLimited = await enforceSharedRateLimit(request, {
    bucket: "api-admin-processes-get",
    limit: 30,
    windowMs: 60_000,
  });
  if (rateLimited) return applyNoStoreHeaders(rateLimited, { varyCookie: true });

  if (!(await readAdminSession(request))) {
    return applyNoStoreHeaders(
      NextResponse.json({ error: "Admin auth required" }, { status: 401 }),
      { varyCookie: true },
    );
  }

  return applyNoStoreHeaders(
    NextResponse.json({
      status: "ok",
      processes: {
        indexer: getProcessStatus("indexer"),
        bot: getProcessStatus("bot"),
      },
    }),
    { varyCookie: true },
  );
}

export async function POST(request: NextRequest) {
  if (!isAdminProcessRouteEnabled()) return disabledResponse();

  const rateLimited = await enforceSharedRateLimit(request, {
    bucket: "api-admin-processes-post",
    limit: 10,
    windowMs: 60_000,
  });
  if (rateLimited) return applyNoStoreHeaders(rateLimited, { varyCookie: true });

  if (!(await readAdminSession(request))) {
    return applyNoStoreHeaders(
      NextResponse.json({ error: "Admin auth required" }, { status: 401 }),
      { varyCookie: true },
    );
  }

  const parsedBody = await readBoundedJsonBody<{ target?: string }>(request, MAX_REQUEST_BODY_BYTES);
  if (!parsedBody.ok && parsedBody.reason === "too-large") {
    return applyNoStoreHeaders(
      NextResponse.json({ error: "Process payload too large" }, { status: 413 }),
      { varyCookie: true },
    );
  }
  if (!parsedBody.ok && parsedBody.reason === "unsupported-content-type") {
    return applyNoStoreHeaders(
      NextResponse.json({ error: "Process payload must be JSON" }, { status: 415 }),
      { varyCookie: true },
    );
  }
  const body = parsedBody.ok ? parsedBody.value : null;
  if (!body?.target || !(body.target in PROCESS_CONFIG)) {
    return applyNoStoreHeaders(
      NextResponse.json({ error: "Unknown process target" }, { status: 400 }),
      { varyCookie: true },
    );
  }

  const target = body.target as ProcessKey;
  const currentStatus = getProcessStatus(target);
  if (currentStatus.running) {
    return applyNoStoreHeaders(
      NextResponse.json({
        status: "ok",
        started: false,
        reason: "already-running",
        process: currentStatus,
      }),
      { varyCookie: true },
    );
  }

  startLocalProcess(target);

  return applyNoStoreHeaders(
    NextResponse.json({
      status: "ok",
      started: true,
      process: getProcessStatus(target),
    }),
    { varyCookie: true },
  );
}
