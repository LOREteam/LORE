import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const ALERT_BOT_TOKEN = process.env.ALERT_TELEGRAM_BOT_TOKEN ?? "";
const ALERT_CHAT_ID = process.env.ALERT_TELEGRAM_CHAT_ID ?? "";
const ALERT_THREAD_ID = process.env.ALERT_TELEGRAM_THREAD_ID ?? "";
const ALERT_PREFIX = process.env.ALERT_PREFIX ?? "LORE Supervisor";

let stopping = false;
const MIN_UPTIME_MS = 5000;
const MAX_FAST_CRASHES = 3;
const alertCooldowns = new Map();

const managed = {
  bot: {
    command: "npm run bot",
    child: null,
    startedAt: 0,
    restartAttempt: 0,
    consecutiveFastCrashes: 0,
  },
  indexer: {
    command: "npm run indexer",
    child: null,
    startedAt: 0,
    restartAttempt: 0,
    consecutiveFastCrashes: 0,
  },
};

function shouldSendAlert(key, cooldownMs = 300000) {
  const now = Date.now();
  const last = alertCooldowns.get(key) ?? 0;
  if (now - last < cooldownMs) return false;
  alertCooldowns.set(key, now);
  return true;
}

async function sendAlert(text, key, cooldownMs = 300000) {
  if (!ALERT_BOT_TOKEN || !ALERT_CHAT_ID) return;
  if (!shouldSendAlert(key, cooldownMs)) return;
  try {
    const body = new URLSearchParams({
      chat_id: ALERT_CHAT_ID,
      text: `*${ALERT_PREFIX}*\n${text}`,
      parse_mode: "Markdown",
      disable_web_page_preview: "true",
    });
    if (ALERT_THREAD_ID) body.set("message_thread_id", ALERT_THREAD_ID);
    await fetch(`https://api.telegram.org/bot${ALERT_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch (err) {
    console.error("[bot-supervisor] failed to send alert:", err);
  }
}

function nextDelayMs(name) {
  const base = name === "bot" ? 2000 : 3000;
  const cap = name === "bot" ? 30000 : 20000;
  const restartAttempt = managed[name].restartAttempt;
  const ms = Math.min(cap, base * Math.pow(2, Math.min(restartAttempt, 4)));
  managed[name].restartAttempt = restartAttempt + 1;
  return ms;
}

function startManaged(name) {
  const meta = managed[name];
  meta.startedAt = Date.now();
  console.log(`[bot-supervisor] Starting ${name} at ${new Date().toISOString()}`);

  const child = spawn(meta.command, {
    cwd: projectRoot,
    stdio: "inherit",
    shell: true,
  });
  meta.child = child;

  child.on("error", (error) => {
    if (stopping) return;
    console.error(`[bot-supervisor] ${name} process error: ${error.message}`);
  });

  child.on("exit", (code, signal) => {
    if (stopping) return;

    const uptimeMs = Date.now() - meta.startedAt;
    const reason = signal ? `signal ${signal}` : `code ${String(code ?? "null")}`;

    if (uptimeMs < MIN_UPTIME_MS) {
      meta.consecutiveFastCrashes += 1;
    } else {
      meta.consecutiveFastCrashes = 0;
      meta.restartAttempt = 0;
    }

    if (meta.consecutiveFastCrashes >= MAX_FAST_CRASHES) {
      if (name === "indexer") {
        console.error(
          `[bot-supervisor] indexer crashed ${MAX_FAST_CRASHES} times. Keeping bot alive, indexer disabled.`,
        );
        void sendAlert(
          "indexer crashed repeatedly and was disabled; bot keeps running.",
          "supervisor-indexer-disabled",
          60000,
        );
        return;
      }
      console.error(
        `[bot-supervisor] ${name} crashed ${MAX_FAST_CRASHES} times within ${MIN_UPTIME_MS / 1000}s each. Stopping supervisor.`,
      );
      void sendAlert(
        `${name} crashed ${MAX_FAST_CRASHES} times in a row (uptime < ${Math.round(MIN_UPTIME_MS / 1000)}s). Supervisor stopped.`,
        `supervisor-fatal-${name}`,
        60000,
      );
      process.exit(1);
    }

    const ms = nextDelayMs(name);
    console.error(`[bot-supervisor] ${name} exited (${reason}, uptime ${Math.round(uptimeMs / 1000)}s). Restarting in ${ms}ms...`);
    void sendAlert(
      `${name} exited (${reason}, uptime ${Math.round(uptimeMs / 1000)}s). Restart in ${ms}ms.`,
      `supervisor-restart-${name}`,
      120000,
    );

    setTimeout(() => {
      if (!stopping) startManaged(name);
    }, ms);
  });
}

function runSupervisor() {
  void sendAlert(`starting bot+indexer at \`${new Date().toISOString()}\``, "supervisor-start", 60000);
  startManaged("bot");
  startManaged("indexer");

  const stopHandler = (sig) => {
    if (stopping) return;
    stopping = true;
    console.log(`[bot-supervisor] Received ${sig}, stopping bot + indexer...`);
    managed.bot.child?.kill("SIGTERM");
    managed.indexer.child?.kill("SIGTERM");
  };

  process.once("SIGINT", () => stopHandler("SIGINT"));
  process.once("SIGTERM", () => stopHandler("SIGTERM"));
}

runSupervisor();
