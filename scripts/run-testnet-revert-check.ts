import { writeFileSync } from "node:fs";
import { config as loadDotenv } from "dotenv";
import {
  createPublicClient,
  createWalletClient,
  fallback,
  http,
  zeroAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { LINEA_TOKEN_ADDRESS, TOKEN_ABI } from "../app/lib/constants";
import { getConfiguredLineaNetwork, getLineaChain, getPreferredLineaRpcs, getStableLineaReadRpcs } from "../config/publicConfig";

loadDotenv({ path: ".env.live-test-wallets", override: false, quiet: true });

const CONFIRMATION_FLAG = "--confirm";
const REVERT_GAS_LIMIT = 100_000n;
const TEST_AMOUNT = 1n;
const TESTNET_CHAIN_ID = 59141;
const roles = ["MANUAL", "AUTOMINER_A", "AUTOMINER_B", "AUTOMINER_C"];

function getFundedTestAccount() {
  for (const role of roles) {
    const key = process.env[`LORE_LIVE_TEST_${role}_PRIVATE_KEY`]?.trim();
    if (key) return privateKeyToAccount(key as `0x${string}`);
  }
  throw new Error("No local live-test wallet key is available.");
}

async function main() {
  if (!process.argv.includes(CONFIRMATION_FLAG)) {
    throw new Error(`Refusing to broadcast without ${CONFIRMATION_FLAG}.`);
  }

  const network = getConfiguredLineaNetwork();
  const chain = getLineaChain(network);
  if (chain.id !== TESTNET_CHAIN_ID) {
    throw new Error(`Refusing non-testnet revert check on chain ${chain.id}.`);
  }

  const rpcInput = process.env.LIVE_TEST_RPC_URL ?? process.env.NEXT_PUBLIC_LINEA_RPCS;
  const readTransport = fallback(getStableLineaReadRpcs(rpcInput, network).map((url) => http(url, { timeout: 20_000, retryCount: 1 })));
  const broadcastTransport = fallback(getPreferredLineaRpcs(rpcInput, network).map((url) => http(url, { timeout: 20_000, retryCount: 1 })));
  const publicClient = createPublicClient({ chain, transport: readTransport });
  const account = getFundedTestAccount();

  let simulationReverted = false;
  try {
    await publicClient.simulateContract({
      account,
      address: LINEA_TOKEN_ADDRESS,
      abi: TOKEN_ABI,
      functionName: "transfer",
      args: [zeroAddress, TEST_AMOUNT],
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/revert|invalidreceiver|invalid receiver|zero address/i.test(message)) {
      throw new Error("Refusing to broadcast because the revert simulation did not return the expected zero-recipient error.");
    }
    simulationReverted = true;
  }

  if (simulationReverted) {
    const walletClient = createWalletClient({ account, chain, transport: broadcastTransport });
    const hash = await walletClient.writeContract({
      account,
      chain,
      address: LINEA_TOKEN_ADDRESS,
      abi: TOKEN_ABI,
      functionName: "transfer",
      args: [zeroAddress, TEST_AMOUNT],
      gas: REVERT_GAS_LIMIT,
    });
    const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000, pollingInterval: 1_000 });
    if (receipt.status !== "reverted") {
      throw new Error(`Expected reverted receipt, received ${receipt.status}.`);
    }

    writeFileSync(
      "docs/testnet-signed-revert.json",
      `${JSON.stringify({
        kind: "testnet-signed-revert",
        network: "linea-sepolia",
        chainId: chain.id,
        token: LINEA_TOKEN_ADDRESS,
        transactionHash: hash,
        receiptStatus: receipt.status,
        gasUsed: receipt.gasUsed.toString(),
        checkedAt: new Date().toISOString(),
      }, null, 2)}\n`,
      "utf8",
    );
    console.log(`Signed testnet revert confirmed: ${hash}`);
    return;
  }

  throw new Error("Refusing to broadcast because zero-address transfer simulation did not revert.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Testnet revert check failed.");
  process.exitCode = 1;
});
