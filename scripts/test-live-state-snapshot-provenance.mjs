import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testDir = mkdtempSync(join(tmpdir(), "lore-live-state-snapshot-provenance-"));
process.env.LORE_DB_PATH = join(testDir, "live-state.sqlite");
process.env.NEXT_PUBLIC_LINEA_NETWORK = "sepolia";

const SNAPSHOT_KEY = "snapshot:live-state:v1";
const payload = {
  currentEpoch: "42",
  epochEndTime: "123456",
  jackpotInfo: ["1", "2", "0", "0", "40", "39", "3", "4"],
  rolloverPool: "5",
  currentEpochData: ["6", "0", "0", false, false, false],
  tileData: { pools: ["6"], users: ["1"] },
  tileUserCounts: [1],
  indexedTilePools: ["6"],
  epochDuration: "60",
  pendingEpochDuration: "0",
  pendingEpochDurationEta: "0",
  pendingEpochDurationEffectiveFromEpoch: "0",
  fetchedAt: Date.now(),
};

async function main() {
  const { db } = await import("../server/db");
  const { getMetaJson, setMetaJson } = await import("../server/storage");
  const liveState = await import("../app/api/live-state/shared");
  const source = readFileSync("app/api/live-state/shared.ts", "utf8");

  try {
    setMetaJson(SNAPSHOT_KEY, { payload, savedAt: Date.now(), source: "rpc" });
    assert.equal(
      liveState.loadLiveStateSnapshot(Number.POSITIVE_INFINITY),
      null,
      "a persisted single-RPC snapshot must be rejected even when fresh and well shaped",
    );

    liveState.saveLiveStateSnapshot(payload, "indexed");
    assert.equal(
      liveState.loadLiveStateSnapshot(Number.POSITIVE_INFINITY)?.currentEpoch,
      "42",
      "an explicitly indexed snapshot must remain available for durable fallback",
    );
    assert.equal(
      getMetaJson(SNAPSHOT_KEY)?.source,
      "indexed",
      "durable snapshot envelopes must carry their trusted indexed provenance",
    );

    assert.doesNotMatch(
      source,
      /saveLiveStateSnapshot\(payload(?:,|\))/,
      "the direct RPC payload must never be passed to the durable snapshot sink",
    );
    assert.match(
      source,
      /const indexedSnapshot = buildStoredLiveStateBootstrap\(\);[\s\S]*saveLiveStateSnapshot\(indexedSnapshot, "indexed"\)/,
      "the durable sink must receive only a bootstrap rebuilt from canonical indexed storage",
    );

    console.log("live-state snapshot provenance tests passed");
  } finally {
    db.close();
    rmSync(testDir, { recursive: true, force: true });
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
