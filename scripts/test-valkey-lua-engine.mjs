import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dirname, "..");
const IMAGE = "valkey/valkey@sha256:f0ba225266310efba5fb33383e21c64fbd07907304224786c780606e7ebd7327";
const PLATFORM = "linux/amd64";
const ARTIFACT_PATH = resolve(REPO_ROOT, "artifacts", "valkey-runtime", "valkey-lua-engine.json");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function extractLua(source, name) {
  const match = source.match(new RegExp(`const ${name} = \\\`([\\s\\S]*?)\\\`;`));
  if (!match) throw new Error(`Could not extract ${name}.`);
  return match[1];
}

function docker(args, { environment = {}, allowFailure = false } = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn("docker", args, {
      cwd: REPO_ROOT,
      env: { ...process.env, ...environment },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (status) => {
      const result = {
        status: status ?? 1,
        stdout: Buffer.concat(stdout).toString("utf8").trim(),
        stderr: Buffer.concat(stderr).toString("utf8").trim(),
      };
      if (result.status !== 0 && !allowFailure) {
        reject(new Error(`docker ${args[0]} failed (${result.status}): ${result.stderr || result.stdout}`));
        return;
      }
      resolvePromise(result);
    });
  });
}

function lines(result) {
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

async function main() {
  const [rateLimitSource, sessionSource] = await Promise.all([
    readFile(resolve(REPO_ROOT, "app", "api", "_lib", "externalRateLimit.ts"), "utf8"),
    readFile(resolve(REPO_ROOT, "app", "api", "_lib", "adminSession.ts"), "utf8"),
  ]);
  const rateLimitScript = extractLua(rateLimitSource, "RATE_LIMIT_SCRIPT");
  const keeperBudgetScript = extractLua(rateLimitSource, "KEEPER_DAILY_BUDGET_SCRIPT");
  const rotateSessionScript = extractLua(sessionSource, "ROTATE_SESSION_SCRIPT");
  const secret = randomBytes(32).toString("hex");
  const container = `lore-valkey-lua-${process.pid}-${randomBytes(4).toString("hex")}`;
  const commandWithOptions = (args, options = {}) => docker(
    ["exec", container, "valkey-cli", "--raw", "--no-auth-warning", "-a", secret, ...args],
    options,
  );
  const command = (...args) => commandWithOptions(args);
  const evalScript = async (script, key, args) => lines(await command("EVAL", script, "1", key, ...args));

  try {
    await docker([
      "run", "--detach", "--name", container,
      "--network", "none", "--platform", PLATFORM,
      "--read-only", "--tmpfs", "/tmp:rw,noexec,nosuid,size=16m",
      "--tmpfs", "/data:rw,noexec,nosuid,size=16m,mode=1777",
      "--cap-drop", "ALL", "--cap-add", "CHOWN", "--cap-add", "SETUID", "--cap-add", "SETGID", "--security-opt", "no-new-privileges",
      IMAGE,
      "valkey-server", "--save", "", "--appendonly", "no", "--requirepass", secret,
    ]);

    let lastPing = null;
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const ping = await commandWithOptions(["PING"], { allowFailure: true });
      lastPing = ping;
      if (ping.status === 0 && ping.stdout === "PONG") break;
      if (attempt === 19) {
        const logs = await docker(["logs", "--tail", "20", container], { allowFailure: true });
        throw new Error(`Valkey did not become ready: ping=${lastPing.stderr || lastPing.stdout || "no diagnostic"}; logs=${logs.stderr || logs.stdout || "no diagnostic"}`);
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }

    const rateKey = "lore:test:rate";
    const rateFirst = await evalScript(rateLimitScript, rateKey, ["60000"]);
    const rateSecond = await evalScript(rateLimitScript, rateKey, ["60000"]);
    const rateThird = await evalScript(rateLimitScript, rateKey, ["60000"]);
    assert.equal(rateFirst[0], "1");
    assert.equal(rateSecond[0], "2");
    assert.equal(rateThird[0], "3");
    assert.ok(Number(rateFirst[1]) > 0 && Number(rateFirst[1]) <= 60000);
    assert.ok(Number(rateSecond[1]) > 0 && Number(rateSecond[1]) <= Number(rateFirst[1]));

    const budgetKey = "lore:test:keeper";
    const budgetFirst = await evalScript(keeperBudgetScript, budgetKey, ["r:one", "fingerprint-one", "2", "3", "10"]);
    const budgetReplay = await evalScript(keeperBudgetScript, budgetKey, ["r:one", "fingerprint-one", "2", "3", "10"]);
    const budgetConflict = await evalScript(keeperBudgetScript, budgetKey, ["r:one", "fingerprint-conflict", "2", "3", "10"]);
    const budgetSecond = await evalScript(keeperBudgetScript, budgetKey, ["r:two", "fingerprint-two", "2", "3", "10"]);
    const budgetExhausted = await evalScript(keeperBudgetScript, budgetKey, ["r:three", "fingerprint-three", "2", "3", "10"]);
    assert.deepEqual(budgetFirst.slice(0, 1), ["reserved"]);
    assert.deepEqual(budgetReplay.slice(0, 1), ["already_reserved"]);
    assert.deepEqual(budgetConflict, ["reservation_conflict"]);
    assert.deepEqual(budgetSecond.slice(0, 1), ["reserved"]);
    assert.deepEqual(budgetExhausted, ["signature_exhausted"]);
    const day = budgetFirst[1];
    await command("DEL", budgetKey);
    await command("HSET", budgetKey, "__day", day, "__count", "not-a-number", "__cost", "0");
    const budgetMalformed = await evalScript(keeperBudgetScript, budgetKey, ["r:four", "fingerprint-four", "2", "3", "10"]);
    assert.deepEqual(budgetMalformed, ["invalid_state"]);

    const sessionKey = "lore:test:session";
    await command("SET", sessionKey, "current");
    const sessionRotated = await evalScript(rotateSessionScript, sessionKey, ["current", "next", "60000"]);
    const sessionReplay = await evalScript(rotateSessionScript, sessionKey, ["current", "third", "60000"]);
    const sessionCurrent = lines(await command("GET", sessionKey));
    assert.deepEqual(sessionRotated, ["1"]);
    assert.deepEqual(sessionReplay, ["0"]);
    assert.deepEqual(sessionCurrent, ["next"]);

    const info = lines(await command("INFO", "server"));
    const valkeyVersion = info.find((line) => line.startsWith("valkey_version:"))?.slice("valkey_version:".length) ?? "unknown";
    const artifact = {
      status: "partial",
      scope: "direct-lua-engine",
      image: IMAGE,
      platform: PLATFORM,
      valkeyVersion,
      scriptSha256: {
        rateLimit: sha256(rateLimitScript),
        keeperDailyBudget: sha256(keeperBudgetScript),
        rotateSession: sha256(rotateSessionScript),
      },
      checks: {
        rateLimitGlobalIncrementAndTtl: true,
        keeperReservationReplayConflictCapAndMalformedState: true,
        rotateSessionAtomicAndReplaySafe: true,
      },
      missing: [
        "authenticated public HTTPS REST facade",
        "two web replica application requests",
        "external persistent database and restore evidence",
      ],
    };
    await mkdir(dirname(ARTIFACT_PATH), { recursive: true });
    await writeFile(ARTIFACT_PATH, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
    console.log(JSON.stringify(artifact));
  } finally {
    await docker(["stop", container], { allowFailure: true }).catch(() => undefined);
    await docker(["rm", "--force", container], { allowFailure: true }).catch(() => undefined);
  }
}

await main();
