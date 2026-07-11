import { existsSync, writeFileSync } from "node:fs";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const outputPath = ".env.live-test-wallets";

if (existsSync(outputPath)) {
  console.error(`${outputPath} already exists; refusing to overwrite`);
  process.exit(2);
}

const roles = ["MANUAL", "AUTOMINER_A", "AUTOMINER_B", "AUTOMINER_C", "RESOLVER"];
const wallets = roles.map((role) => {
  const privateKey = generatePrivateKey();
  const account = privateKeyToAccount(privateKey);
  return { role, address: account.address, privateKey };
});

const lines = [
  "# Local burner wallets for LORE live test. Do not commit or share private keys.",
  "# Network: Linea Sepolia chainId 59141",
];

for (const { role, address, privateKey } of wallets) {
  lines.push(`LORE_LIVE_TEST_${role}_ADDRESS=${address}`);
  lines.push(`LORE_LIVE_TEST_${role}_PRIVATE_KEY=${privateKey}`);
}

writeFileSync(outputPath, `${lines.join("\n")}\n`, { mode: 0o600 });

console.log(JSON.stringify(
  wallets.map(({ role, address }) => ({ role, address })),
  null,
  2,
));
