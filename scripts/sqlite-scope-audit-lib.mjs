import crypto from "node:crypto";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const SCOPED_TABLES = [
  "scoped_epochs",
  "scoped_bets",
  "scoped_jackpots",
  "scoped_reward_claims",
  "scoped_protocol_fee_flushes",
];
const LEGACY_TABLES = ["epochs", "bets", "jackpots", "reward_claims", "protocol_fee_flushes"];

export function auditSqliteScopes(sourceInput, activeScope) {
  const sourcePath = resolve(sourceInput);
  if (!existsSync(sourcePath) || !statSync(sourcePath).isFile()) {
    throw new Error("Scope audit source must be an existing regular file");
  }
  if (!/^(?:mainnet|sepolia):0x[a-f0-9]{40}$/.test(activeScope)) {
    throw new Error("Active scope must use <mainnet|sepolia>:<contract-address>");
  }

  const db = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    const tables = new Set(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((row) => String(row.name)),
    );
    const foreignScopes = new Set();
    const foreignRowsByTable = {};
    for (const table of SCOPED_TABLES) {
      if (!tables.has(table)) continue;
      const rows = db.prepare(`SELECT scope, COUNT(*) AS count FROM ${table} GROUP BY scope`).all();
      foreignRowsByTable[table] = 0;
      for (const row of rows) {
        const scope = String(row.scope ?? "");
        if (scope === activeScope) continue;
        if (scope) foreignScopes.add(scope);
        foreignRowsByTable[table] += Number(row.count ?? 0);
      }
    }

    const legacyRowsByTable = {};
    for (const table of LEGACY_TABLES) {
      if (!tables.has(table)) continue;
      legacyRowsByTable[table] = Number(db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count ?? 0);
    }

    let staleMetaKeys = 0;
    let previousScopeMatches = null;
    if (tables.has("meta")) {
      staleMetaKeys = Number(db.prepare(`
        SELECT COUNT(*) AS count FROM meta
        WHERE (key GLOB 'mainnet:0x*:*' OR key GLOB 'sepolia:0x*:*')
          AND key NOT GLOB ?
      `).get(`${activeScope}:*`)?.count ?? 0);
      const previous = db.prepare("SELECT value FROM meta WHERE key = ?").get("__storage_active_contract_scope");
      previousScopeMatches = previous ? String(previous.value ?? "") === activeScope : null;
    }

    const foreignRows = Object.values(foreignRowsByTable).reduce((sum, count) => sum + count, 0);
    const legacyRows = Object.values(legacyRowsByTable).reduce((sum, count) => sum + count, 0);
    return {
      status: "pass",
      activeScopeHash: crypto.createHash("sha256").update(activeScope).digest("hex").slice(0, 12),
      previousScopeMatches,
      foreignScopeCount: foreignScopes.size,
      foreignRows,
      foreignRowsByTable,
      staleMetaKeys,
      legacyRows,
      legacyRowsByTable,
      cleanupRecommended: foreignRows > 0 || staleMetaKeys > 0 || legacyRows > 0 || previousScopeMatches === false,
      readOnly: true,
    };
  } finally {
    db.close();
  }
}
