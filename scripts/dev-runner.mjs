import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const IS_WINDOWS = process.platform === "win32";
const command = "npm";
const tasks = [
  { name: "SITE", args: ["run", "dev:ui"] },
  { name: "BOT", args: ["run", "bot:supervisor"] },
];

let settled = false;
let shuttingDown = false;
let remaining = tasks.length;
let shutdownTimer = null;
const children = [];

function prefixPipe(stream, name, target) {
  if (!stream) return;

  let buffer = "";

  stream.on("data", function (chunk) {
    buffer += chunk.toString();
    const parts = buffer.split(/\r?\n/);
    buffer = parts.length ? parts.pop() : "";

    for (const line of parts) {
      target.write(line ? "[" + name + "] " + line + "\n" : "\n");
    }
  });

  stream.on("end", function () {
    if (buffer.length) {
      target.write("[" + name + "] " + buffer + "\n");
    }
  });
}

function stopAll(exceptChild) {
  for (const child of children) {
    if (child === exceptChild) continue;
    if (!child.pid || child.killed || child.exitCode !== null || child.signalCode !== null) continue;

    if (IS_WINDOWS) {
      const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      });
      killer.unref();
      continue;
    }

    child.kill("SIGTERM");
  }
}

function shutdown(code, exceptChild) {
  if (shuttingDown) return;

  settled = true;
  shuttingDown = true;
  process.exitCode = code;
  stopAll(exceptChild);

  shutdownTimer = setTimeout(function () {
    process.exit(code);
  }, 3000);
}

for (const task of tasks) {
  const child = spawn(IS_WINDOWS ? `${command} ${task.args.join(" ")}` : command, IS_WINDOWS ? [] : task.args, {
    cwd: root,
    env: process.env,
    shell: IS_WINDOWS,
    stdio: ["inherit", "pipe", "pipe"],
  });

  prefixPipe(child.stdout, task.name, process.stdout);
  prefixPipe(child.stderr, task.name, process.stderr);
  children.push(child);

  child.on("error", function (error) {
    if (settled) return;
    process.stderr.write("[" + task.name + "] " + String(error) + "\n");
    shutdown(1, child);
  });

  child.on("exit", function (code, signal) {
    remaining -= 1;

    if (shuttingDown) {
      if (remaining === 0) {
        if (shutdownTimer) clearTimeout(shutdownTimer);
        process.exit(process.exitCode ?? 0);
      }
      return;
    }

    if (signal) {
      shutdown(1, child);
      return;
    }
    if (code !== 0) {
      shutdown(code ? code : 1, child);
      return;
    }
    if (remaining === 0) {
      process.exit(0);
    }
  });
}

process.once("SIGINT", function () {
  shutdown(0);
});

process.once("SIGTERM", function () {
  shutdown(0);
});
