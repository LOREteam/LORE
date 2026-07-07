import { closeSync, existsSync, openSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";
import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedAdminRouteRequest } from "../../_lib/adminRouteAuth";
import { enforceSharedRateLimit } from "../../_lib/sharedRateLimit";
import { applyNoStoreHeaders } from "../../_lib/responseHeaders";

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

function getProcessStatus(target: ProcessKey) {
  const config = PROCESS_CONFIG[target];
  const pid = readTrackedPid(target);
  const running = pid != null && isProcessAlive(pid);
  if (!existsSync(config.logFile)) {
    return {
      target,
      label: config.label,
      status: "missing" as const,
      ageMs: null,
      logFile: config.logFile,
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
    logFile: config.logFile,
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
  if (!existsSync(config.pidFile)) return null;
  const raw = readFileSync(config.pidFile, "utf8").trim();
  const pid = Number(raw);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
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

  if (!isAuthorizedAdminRouteRequest(request)) {
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

  if (!isAuthorizedAdminRouteRequest(request)) {
    return applyNoStoreHeaders(
      NextResponse.json({ error: "Admin auth required" }, { status: 401 }),
      { varyCookie: true },
    );
  }

  const body = (await request.json().catch(() => null)) as { target?: string } | null;
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
