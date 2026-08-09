import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sharedSource = readFileSync("app/api/bootstrap-resolve/shared.ts", "utf8");
const routeSource = readFileSync("app/api/bootstrap-resolve/route.ts", "utf8");

assert.match(
  sharedSource,
  /RESOLVE_OPERATION_LOCK_TTL_MS = 5 \* 60 \* 1000[\s\S]*acquireExternalExpiringLock\([\s\S]*RESOLVE_OPERATION_LOCK_TTL_MS[\s\S]*acquireExpiringLock\([\s\S]*RESOLVE_OPERATION_LOCK_TTL_MS/,
  "the resolve operation lock must outlive RPC failover and the receipt wait in both stores",
);
assert.doesNotMatch(
  sharedSource,
  /`\$\{RESOLVE_LOCK_PATH\}:\$\{epoch\}`|epoch\.toString\(\),\s*RESOLVE_OPERATION_LOCK_TTL_MS/,
  "a new epoch must not bypass serialization of the same keeper account",
);
assert.match(
  sharedSource,
  /acquireExternalExpiringLock\(\s*RESOLVE_LOCK_PATH,[\s\S]*acquireExpiringLock\(\s*RESOLVE_LOCK_PATH,\s*"keeper"/,
  "external and SQLite locks must use the same global keeper resource",
);
assert.match(
  sharedSource,
  /now - lastResolveAttemptAt < RESOLVE_OPERATION_LOCK_TTL_MS/,
  "the development emergency fallback must preserve the same operation lifetime",
);

const noopCheck = routeSource.indexOf("if (isResolved || !isExpired)");
const emptyCheck = routeSource.indexOf("if (totalPool === 0n)");
const lockAcquire = routeSource.indexOf("if (!(await acquireResolveLock(currentEpoch)))");
const nonceRead = routeSource.indexOf("const latestNonce = await publicClient.getTransactionCount");
assert.ok(noopCheck >= 0 && emptyCheck > noopCheck);
assert.ok(
  lockAcquire > emptyCheck && nonceRead > lockAcquire,
  "only a funded expired epoch may acquire the long operation lock, before nonce/signing work",
);
assert.match(
  routeSource,
  /reason: "bootstrap_resolve_throttled"[\s\S]*Math\.ceil\(RESOLVE_OPERATION_LOCK_TTL_MS \/ 1000\)/,
  "lock contention must return retry guidance matching the operation lock lifetime",
);

console.log("bootstrap resolve lock tests passed");
