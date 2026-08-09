import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const MAX_TRACKED_PID = 2_147_483_647;
const LINUX_BOOT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DECIMAL_START_TOKEN_RE = /^[1-9]\d{0,31}$/;
const WINDOWS_START_TOKEN_RE = /^win32:[1-9]\d{0,31}$/;
const LINUX_START_TOKEN_RE = /^linux:[0-9a-f-]{36}:[1-9]\d{0,31}$/;
const MAX_IDENTITY_COMMAND_OUTPUT_BYTES = 4 * 1024;

function validPid(pid) {
  return Number.isSafeInteger(pid) && pid > 0 && pid <= MAX_TRACKED_PID;
}

export function parseProcessStartToken(value) {
  if (typeof value !== "string" || value.length > 128) return null;
  const token = value.trim();
  return WINDOWS_START_TOKEN_RE.test(token) || LINUX_START_TOKEN_RE.test(token)
    ? token
    : null;
}

function readLinuxProcessStartIdentity(pid) {
  let stat;
  try {
    stat = readFileSync(`/proc/${pid}/stat`, "utf8");
  } catch (error) {
    return error?.code === "ENOENT" || error?.code === "ESRCH"
      ? { state: "not-running" }
      : { state: "unavailable" };
  }

  let bootId;
  try {
    bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim().toLowerCase();
  } catch {
    return { state: "unavailable" };
  }
  if (!LINUX_BOOT_ID_RE.test(bootId)) return { state: "unavailable" };

  const commandStart = stat.indexOf("(");
  const commandEnd = stat.lastIndexOf(")");
  if (commandStart <= 0 || commandEnd <= commandStart) return { state: "unavailable" };
  if (stat.slice(0, commandStart).trim() !== String(pid)) return { state: "unavailable" };
  const fieldsAfterCommand = stat.slice(commandEnd + 1).trim().split(/\s+/);
  const startTicks = fieldsAfterCommand[19];
  if (!DECIMAL_START_TOKEN_RE.test(startTicks ?? "")) return { state: "unavailable" };
  return { state: "ok", startToken: `linux:${bootId}:${startTicks}` };
}

function windowsPowerShellPath() {
  const windowsRoot = process.env.SystemRoot?.trim() || process.env.WINDIR?.trim() || "C:\\Windows";
  return join(windowsRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

function readWindowsProcessStartIdentity(pid) {
  const command = [
    "$ErrorActionPreference = 'Stop'",
    `try { $p = Get-Process -Id ${pid} -ErrorAction Stop } catch { if ($_.FullyQualifiedErrorId -like 'NoProcessFoundForGivenId,*') { exit 3 }; exit 4 }`,
    "try { $created = $p.StartTime } catch { exit 4 }",
    "[Console]::Out.Write($created.ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture))",
  ].join("; ");
  const result = spawnSync(
    windowsPowerShellPath(),
    ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command],
    {
      encoding: "utf8",
      windowsHide: true,
      timeout: 3_000,
      maxBuffer: MAX_IDENTITY_COMMAND_OUTPUT_BYTES,
    },
  );
  if (result.status === 3) return { state: "not-running" };
  if (result.status !== 0 || result.error) return { state: "unavailable" };
  const startTicks = result.stdout.trim();
  if (!DECIMAL_START_TOKEN_RE.test(startTicks)) return { state: "unavailable" };
  return { state: "ok", startToken: `win32:${startTicks}` };
}

export function readProcessStartIdentity(pid) {
  if (!validPid(pid)) return { state: "unavailable" };
  if (process.platform === "linux") return readLinuxProcessStartIdentity(pid);
  if (process.platform === "win32") return readWindowsProcessStartIdentity(pid);
  return { state: "unavailable" };
}

export function verifyProcessStartIdentity(pid, expectedStartToken) {
  const parsedToken = parseProcessStartToken(expectedStartToken);
  if (!parsedToken) return "unavailable";
  const current = readProcessStartIdentity(pid);
  if (current.state !== "ok") return current.state;
  return current.startToken === parsedToken ? "match" : "mismatch";
}
