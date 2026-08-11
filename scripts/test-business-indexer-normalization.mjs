import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export function runIndexerNormalizationTests() {
  const indexerErrorSource = readFileSync("scripts/indexer.ts", "utf8");
  assert.match(
    indexerErrorSource,
    /function describeIndexerError\(error: unknown\)[\s\S]*?sanitizeSentryPayload\(message\)\.slice\(0, 160\)/,
    "indexer must sanitize provider error text before logging it",
  );
  assert.doesNotMatch(indexerErrorSource, /console\.(?:warn|error)\([^)]*(?:err as Error|,\s*err\b)/, "indexer logs must not emit raw provider error objects or messages");
  assert.match(
    indexerErrorSource,
    /const MAX_TILE_ID = 25[\s\S]*function parseChainTileId\(value: bigint\)[\s\S]*value <= 0n \|\| value > BigInt\(MAX_TILE_ID\)[\s\S]*function parseChainTileIds\(values: readonly bigint\[\]\)[\s\S]*if \(tileId === null\) return null[\s\S]*const tileId = parseChainTileId\(args\.tileId\)[\s\S]*const tileIds = parseChainTileIds\(args\.tileIds\)[\s\S]*tileIds === null[\s\S]*tileIds\.length !== args\.amounts\.length[\s\S]*const winningTile = parseChainTileId\(args\.winningTile\)/,
    "indexer must safely narrow chain tile IDs and winningTile evidence before normalized storage writes",
  );
  assert.match(
    indexerErrorSource,
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function parseChainPositiveSafeInteger\(value: bigint\)[\s\S]*value <= 0n \|\| value > MAX_SAFE_INTEGER_BIGINT[\s\S]*const epochsClaimed = parseChainPositiveSafeInteger\(args\.epochsClaimed\)[\s\S]*epochsClaimed === null[\s\S]*epochsClaimed,/,
    "indexer must safely narrow batch claim epochsClaimed before normalized storage writes",
  );
  assert.match(
    indexerErrorSource,
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function toDisplayNumberWei\(value: bigint\)[\s\S]*value <= 0n[\s\S]*1_000_000_000_000n[\s\S]*scaled > MAX_SAFE_INTEGER_BIGINT[\s\S]*totalAmountNum: toDisplayNumberWei\(args\.(?:amount|totalAmount)\)[\s\S]*amountNum: toDisplayNumberWei\(args\.amount\)[\s\S]*rewardNum: toDisplayNumberWei\(args\.reward\)/,
    "indexer must derive display numeric amount fields through bounded bigint math",
  );
  assert.doesNotMatch(
    indexerErrorSource,
    /tileIds: \[Number\(args\.tileId\)\]|tileIds: args\.tileIds\.map\(Number\)|winningTile: Number\(args\.winningTile\)|epochsClaimed: Number\(args\.epochsClaimed\)|parseFloat\(formatUnits\(args\.(?:amount|totalAmount|reward), 18\)\)/,
    "indexer must not broadly coerce event tile IDs, winningTile values, batch claim counts, or display amount fields",
  );
}
