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
let restartAttempt = 0;

const MIN_UPTIME_MS = 5000;
const MAX_FAST_CRASHES = 3;
let consecutiveFastCrashes = 0;
const alertCooldowns = new Map();

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

function nextDelayMs() {
  const base = 2000;
  const cap = 30000;
  const ms = Math.min(cap, base * Math.pow(2, Math.min(restartAttempt, 4)));
  restartAttempt += 1;
  return ms;
}

function runBot() {
  console.log(`[bot-supervisor] Starting bot at ${new Date().toISOString()}`);
  void sendAlert(`starting bot at \`${new Date().toISOString()}\``, "supervisor-start", 60000);
  const startedAt = Date.now();

  const child = spawn("npm run bot", {
    cwd: projectRoot,
    stdio: "inherit",
    shell: true,
  });

  child.on("error", (error) => {
    if (stopping) return;
    console.error(`[bot-supervisor] Bot process error: ${error.message}`);
  });

  child.on("exit", (code, signal) => {
    if (stopping) return;

    const uptimeMs = Date.now() - startedAt;
    const reason = signal ? `signal ${signal}` : `code ${String(code ?? "null")}`;

    if (uptimeMs < MIN_UPTIME_MS) {
      consecutiveFastCrashes += 1;
    } else {
      consecutiveFastCrashes = 0;
      restartAttempt = 0;
    }

    if (consecutiveFastCrashes >= MAX_FAST_CRASHES) {
      console.error(
        `[bot-supervisor] Bot crashed ${MAX_FAST_CRASHES} times within ${MIN_UPTIME_MS / 1000}s each. ` +
        `Likely a config error (missing env vars?). Stopping supervisor.`,
      );
      void sendAlert(
        `bot crashed ${MAX_FAST_CRASHES} times in a row (uptime < ${Math.round(MIN_UPTIME_MS / 1000)}s). Supervisor stopped.`,
        "supervisor-fatal",
        60000,
      );
      process.exit(1);
    }

    const ms = nextDelayMs();
    console.error(`[bot-supervisor] Bot exited (${reason}, uptime ${Math.round(uptimeMs / 1000)}s). Restarting in ${ms}ms...`);
    void sendAlert(
      `bot exited (${reason}, uptime ${Math.round(uptimeMs / 1000)}s). Restart in ${ms}ms.`,
      "supervisor-restart",
      120000,
    );

    setTimeout(() => {
      if (!stopping) runBot();
    }, ms);
  });

  const stopHandler = (sig) => {
    if (stopping) return;
    stopping = true;
    console.log(`[bot-supervisor] Received ${sig}, stopping bot...`);
    child.kill("SIGTERM");
  };

  process.once("SIGINT", () => stopHandler("SIGINT"));
  process.once("SIGTERM", () => stopHandler("SIGTERM"));
}

runBot();
