import { auditSqliteScopes } from "./sqlite-scope-audit-lib.mjs";

function argValue(name) {
  const prefix = `--${name}=`;
  return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length).trim() || "";
}

const source = argValue("source");
const network = argValue("network").toLowerCase();
const contract = argValue("contract").toLowerCase();
if (!source || !["mainnet", "sepolia"].includes(network) || !/^0x[a-f0-9]{40}$/.test(contract)) {
  throw new Error("Usage: npm run db:scope-audit -- --source=<db.sqlite> --network=<mainnet|sepolia> --contract=<address>");
}

console.log(JSON.stringify(auditSqliteScopes(source, `${network}:${contract}`)));
