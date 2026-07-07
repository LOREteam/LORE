import { existsSync, writeFileSync } from "node:fs";
import { Wallet } from "ethers";

const outputPath = ".env.live-test-wallets";

if (existsSync(outputPath)) {
  console.error(`${outputPath} already exists; refusing to overwrite`);
  process.exit(2);
}

const roles = ["MANUAL", "AUTOMINER_A", "AUTOMINER_B", "AUTOMINER_C", "RESOLVER"];
const wallets = roles.map((role) => ({ role, wallet: Wallet.createRandom() }));

const lines = [
  "# Local burner wallets for LORE live test. Do not commit or share private keys.",
  "# Network: Linea Sepolia chainId 59141",
];

for (const { role, wallet } of wallets) {
  lines.push(`LORE_LIVE_TEST_${role}_ADDRESS=${wallet.address}`);
  lines.push(`LORE_LIVE_TEST_${role}_PRIVATE_KEY=${wallet.privateKey}`);
}

writeFileSync(outputPath, `${lines.join("\n")}\n`, { mode: 0o600 });

console.log(JSON.stringify(
  wallets.map(({ role, wallet }) => ({ role, address: wallet.address })),
  null,
  2,
));
