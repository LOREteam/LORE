import "dotenv/config";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { formatRuntimeSmokeError } from "./runtime-smoke-error-policy.mjs";

export function verifySqliteStartup(sourceInput) {
  if (sourceInput === ":memory:") return { status: "pass", state: "memory" };
  const sourcePath = path.resolve(sourceInput);
  if (!existsSync(sourcePath)) return { status: "pass", state: "missing-new" };
  const stat = statSync(sourcePath);
  if (!stat.isFile()) throw new Error("SQLite startup path is not a regular file");
  if (stat.size === 0) return { status: "pass", state: "empty-new" };

  let db;
  try {
    db = new DatabaseSync(sourcePath, { readOnly: true });
    const result = String(db.prepare("PRAGMA quick_check").get()?.quick_check ?? "");
    if (result !== "ok") throw new Error(result || "unknown integrity result");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`SQLite startup validation failed: ${message}`);
  } finally {
    db?.close();
  }
  return { status: "pass", state: "existing", bytes: stat.size };
}

export function runSqliteStartupCli({
  sourceInput = process.env.LORE_DB_PATH || "data/lore.sqlite",
  verify = verifySqliteStartup,
  log = console.log,
  errorLog = console.error,
} = {}) {
  try {
    const result = verify(sourceInput);
    log(JSON.stringify({ status: result.status, state: result.state, bytes: result.bytes ?? 0 }));
    return 0;
  } catch (error) {
    errorLog(`[db-startup] FAIL ${formatRuntimeSmokeError(error)}`);
    return 1;
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  process.exitCode = runSqliteStartupCli();
}
