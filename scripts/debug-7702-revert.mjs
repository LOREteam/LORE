#!/usr/bin/env node
/**
 * Debug script: fetches a reverted 7702 tx and tries to extract the revert reason.
 * Usage: node scripts/debug-7702-revert.mjs <tx-hash>
 * Example: node scripts/debug-7702-revert.mjs 0xa5f9671933d184510fc6da39a423cf183585a040cb2fa358eebdbec1d4b8c253
 */

const TX_HASH = process.argv[2];
if (!TX_HASH) {
  console.error("Usage: node scripts/debug-7702-revert.mjs <tx-hash>");
  process.exit(1);
}

const RPC = process.env.RPC_URL || "https://rpc.sepolia.linea.build";

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`RPC error: ${JSON.stringify(json.error)}`);
  return json.result;
}

function decodeRevertData(hex) {
  if (!hex || hex === "0x") return "(empty revert data)";
  // Error(string) selector = 0x08c379a2
  if (hex.startsWith("0x08c379a2")) {
    try {
      const offset = parseInt(hex.slice(10, 74), 16);
      const len = parseInt(hex.slice(74, 138), 16);
      const msgStart = 10 + offset * 2 + 64;
      const msgHex = hex.slice(msgStart, msgStart + len * 2);
      return "Error: " + Buffer.from(msgHex, "hex").toString("utf8");
    } catch { /* fall through */ }
  }
  // Panic(uint256) selector = 0x4e487b71
  if (hex.startsWith("0x4e487b71")) {
    const code = parseInt(hex.slice(10, 74), 16);
    return `Panic(${code})`;
  }
  // Custom error — show selector + raw
  const selector = hex.slice(0, 10);
  const knownSelectors = {
    "0x82b42900": "OnlyDelegatedSelf()",
    "0xd92e233d": "ZeroAddress()",
    "0x1fff5f29": "EmptyArray()",
    "0x1f2a2005": "ZeroAmount()",
    // Common ERC20 errors
    "0xfb8f41b2": "InsufficientAllowance()",
    "0xe602df05": "ERC20InsufficientAllowance(address,uint256,uint256)",
    "0xf4d678b8": "InsufficientBalance()",
    "0xe450d38c": "ERC20InsufficientBalance(address,uint256,uint256)",
  };
  return knownSelectors[selector] || `Unknown custom error (selector: ${selector}, data: ${hex})`;
}

async function main() {
  console.log(`\n=== Debug EIP-7702 Revert: ${TX_HASH} ===\n`);

  // 1. Get transaction
  console.log("1. Fetching transaction...");
  const tx = await rpc("eth_getTransactionByHash", [TX_HASH]);
  if (!tx) { console.error("Transaction not found!"); return; }
  console.log(`   Type: ${tx.type} (${tx.type === "0x4" ? "EIP-7702 ✓" : "NOT 7702"})`);
  console.log(`   From: ${tx.from}`);
  console.log(`   To:   ${tx.to}`);
  console.log(`   Data: ${tx.input ? tx.input.slice(0, 10) + "..." + ` (${(tx.input.length - 2) / 2} bytes)` : "(empty)"}`);
  console.log(`   Block: ${parseInt(tx.blockNumber, 16)}`);
  console.log(`   Gas:  ${parseInt(tx.gas, 16)}`);
  if (tx.authorizationList) {
    console.log(`   AuthorizationList: ${tx.authorizationList.length} entries`);
    for (const auth of tx.authorizationList) {
      console.log(`     - address: ${auth.address}, chainId: ${parseInt(auth.chainId, 16)}, nonce: ${parseInt(auth.nonce, 16)}`);
    }
  } else {
    console.log(`   AuthorizationList: (not present or not returned by RPC)`);
  }

  // 2. Get receipt
  console.log("\n2. Fetching receipt...");
  const receipt = await rpc("eth_getTransactionReceipt", [TX_HASH]);
  if (!receipt) { console.error("Receipt not found!"); return; }
  const status = parseInt(receipt.status, 16);
  console.log(`   Status: ${status === 1 ? "SUCCESS ✓" : "REVERTED ✗"}`);
  console.log(`   Gas used: ${parseInt(receipt.gasUsed, 16)}`);
  if (receipt.revertReason) {
    console.log(`   Revert reason (from receipt): ${decodeRevertData(receipt.revertReason)}`);
  }

  // 3. Try eth_call replay to get revert data
  if (status === 0) {
    console.log("\n3. Replaying via eth_call to get revert reason...");
    try {
      const callParams = {
        from: tx.from,
        to: tx.to,
        data: tx.input,
        gas: tx.gas,
        ...(tx.maxFeePerGas ? { maxFeePerGas: tx.maxFeePerGas } : {}),
        ...(tx.maxPriorityFeePerGas ? { maxPriorityFeePerGas: tx.maxPriorityFeePerGas } : {}),
      };
      // Try at the block before the tx was mined
      const blockBefore = "0x" + (parseInt(tx.blockNumber, 16) - 1).toString(16);
      const result = await rpc("eth_call", [callParams, blockBefore]);
      console.log(`   eth_call succeeded (unexpected): ${result}`);
    } catch (e) {
      const errMsg = e.message || "";
      console.log(`   eth_call error: ${errMsg}`);
      // Try to extract revert data from error
      const match = errMsg.match(/"data"\s*:\s*"(0x[0-9a-fA-F]+)"/);
      if (match) {
        console.log(`   Revert data: ${match[1]}`);
        console.log(`   Decoded: ${decodeRevertData(match[1])}`);
      }
      // Also try extracting from the error object
      const dataMatch = errMsg.match(/execution reverted[:\s]*(0x[0-9a-fA-F]*)/i);
      if (dataMatch && dataMatch[1]) {
        console.log(`   Revert data (alt): ${dataMatch[1]}`);
        console.log(`   Decoded: ${decodeRevertData(dataMatch[1])}`);
      }
    }

    // 4. Check if the EOA has delegation code
    console.log("\n4. Checking EOA delegation code...");
    const code = await rpc("eth_getCode", [tx.from, "latest"]);
    if (!code || code === "0x") {
      console.log(`   EOA has NO code (no active 7702 delegation)`);
    } else if (code.startsWith("0xef0100")) {
      const delegateAddr = "0x" + code.slice(8);
      console.log(`   EOA has 7702 delegation → ${delegateAddr}`);
      // Check delegate contract code
      const delegateCode = await rpc("eth_getCode", [delegateAddr, "latest"]);
      console.log(`   Delegate contract code size: ${delegateCode ? (delegateCode.length - 2) / 2 : 0} bytes`);
    } else {
      console.log(`   EOA has non-delegation code: ${code.slice(0, 20)}...`);
    }

    // 5. Check method selector in tx data
    if (tx.input && tx.input.length >= 10) {
      const selector = tx.input.slice(0, 10);
      const knownMethods = {
        "0x2db75ba0": "placeBatchSameAmount(address,uint256[],uint256)",
        "0xf78a77c6": "approveAndPlaceBatchSameAmount(address,address,uint256[],uint256,address,uint256)",
      };
      console.log(`\n5. Calldata method selector: ${selector}`);
      console.log(`   Matched: ${knownMethods[selector] || "(unknown — check delegate ABI)"}`);
    }

    // 6. Check token allowance
    console.log("\n6. Checking token allowance...");
    const TOKEN = "0x2f1C4A029D8264D60db8e3e00d479F68E74BE637";
    const GAME = "0x712538A24aba20D03a8a7E6590ffAd9B2951dED1";
    const allowanceData = "0xdd62ed3e" + tx.from.slice(2).padStart(64, "0") + GAME.slice(2).padStart(64, "0");
    try {
      const allowanceHex = await rpc("eth_call", [{ to: TOKEN, data: allowanceData }, "latest"]);
      const allowance = BigInt(allowanceHex);
      console.log(`   Allowance(EOA → Game): ${allowance === BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff") ? "maxUint256 (unlimited)" : allowance.toString()}`);
    } catch (e) {
      console.log(`   Could not check allowance: ${e.message}`);
    }
  }

  console.log("\n=== Done ===\n");
}

main().catch(console.error);
