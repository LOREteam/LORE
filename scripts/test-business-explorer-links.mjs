import assert from "node:assert/strict";
import * as explorerLinksModule from "../app/lib/explorerLinks.ts";

export function runExplorerLinkTests() {
  const explorerLinks = explorerLinksModule.default ?? explorerLinksModule;
  assert.equal(
    explorerLinks.getExplorerTxUrl(`0x${"a".repeat(64)}`),
    `https://sepolia.lineascan.build/tx/0x${"a".repeat(64)}`,
  );
  assert.equal(
    explorerLinks.getExplorerTxUrl(`  0x${"b".repeat(64)}  `),
    `https://sepolia.lineascan.build/tx/0x${"b".repeat(64)}`,
    "explorer transaction links may trim wallet/provider whitespace around a valid tx hash",
  );
  assert.equal(explorerLinks.getExplorerTxUrl("0x1234"), null);
  assert.equal(explorerLinks.getExplorerTxUrl(`0x${"c".repeat(64)}?wallet=0x${"d".repeat(40)}`), null);
  assert.equal(explorerLinks.getExplorerTxUrl(`0x${"e".repeat(64)}\nhttps://attacker.invalid`), null);
  assert.equal(
    explorerLinks.getExplorerAddressUrl("0x0000000000000000000000000000000000000001"),
    "https://sepolia.lineascan.build/address/0x0000000000000000000000000000000000000001",
  );
  assert.equal(explorerLinks.getExplorerAddressUrl("bad-address"), null);
}
