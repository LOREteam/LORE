import "dotenv/config";

import {
  createPublicClient,
  createWalletClient,
  fallback,
  formatUnits,
  getAddress,
  http,
  type Address,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { GAME_ABI, LINEA_TOKEN_ADDRESS, TOKEN_ABI, CONTRACT_ADDRESS } from "../app/lib/constants";
import { parsePositiveLineaAmountWeiOrFallback } from "../app/lib/tokenAmountMath";
import {
  clampKeeperFeeOverridesToBalance,
  getAffordableKeeperGasLimit,
  getFallbackFeeOverrides,
  getKeeperFeeOverrides,
} from "../app/lib/lineaFees";
import { tileIdsToMask } from "../app/lib/tileMask";
import { parseOptionalPositiveIntegerEnv, parseOptionalPositiveIntegerInRangeEnv } from "../config/envParsing";
import { getConfiguredLineaNetwork, getLineaChain, getStableLineaReadRpcs } from "../config/publicConfig";

const APP_NETWORK = getConfiguredLineaNetwork();
const APP_CHAIN = getLineaChain(APP_NETWORK);
const BASE_URL = process.env.TEST_WALLET_BASE_URL?.trim() || "http://localhost:3000";
const DRY_RUN = process.env.TEST_WALLET_DRY_RUN === "1";
const SAFE_SECONDS_LEFT = parseOptionalPositiveIntegerEnv(process.env.TEST_WALLET_SAFE_SECONDS_LEFT, 35);
const MAX_EPOCH_READY_WAIT_MS = parseOptionalPositiveIntegerEnv(process.env.TEST_WALLET_MAX_EPOCH_READY_WAIT_MS, 180_000);
const POST_TX_API_WAIT_MS = parseOptionalPositiveIntegerEnv(process.env.TEST_WALLET_POST_TX_API_WAIT_MS, 5_000);
const SINGLE_AMOUNT = parsePositiveLineaAmountWeiOrFallback(process.env.TEST_WALLET_SINGLE_BET_AMOUNT, "1");
const BATCH_AMOUNT = parsePositiveLineaAmountWeiOrFallback(process.env.TEST_WALLET_BATCH_BET_AMOUNT, "1");
const BATCH_TILE_COUNT = parseOptionalPositiveIntegerInRangeEnv(process.env.TEST_WALLET_BATCH_TILE_COUNT, 3, 1, 24);
const APPROVE_GAS_FALLBACK = 80_000n;
const SINGLE_GAS_FALLBACK = 140_000n;
const BATCH_GAS_FALLBACK = 240_000n;
const MAX_UINT256 = (1n << 256n) - 1n;

type PlaytestSummary = {
  address: Address;
  network: string;
  contract: Address;
  token: Address;
  epoch: string;
  singleTile: number;
  batchTiles: number[];
  singleTx?: string;
  batchTx?: string;
  approvedTx?: string;
};

type TestAccount = ReturnType<typeof privateKeyToAccount>;

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRequiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

function normalizePrivateKey(raw: string) {
  return raw.startsWith("0x") ? (raw as `0x${string}`) : (`0x${raw}` as `0x${string}`);
}

function buildTilePlan(epoch: bigint) {
  const base = Number(epoch % 25n) + 1;
  const singleTile = base;
  const batchTiles: number[] = [];
  let candidate = ((base + 6 - 1) % 25) + 1;
  while (batchTiles.length < BATCH_TILE_COUNT) {
    if (candidate !== singleTile && !batchTiles.includes(candidate)) {
      batchTiles.push(candidate);
    }
    candidate = (candidate % 25) + 1;
  }
  return { singleTile, batchTiles };
}

async function waitForSafeEpochWindow(publicClient: PublicClient) {
  const startedAt = Date.now();
  for (;;) {
    const epochWindow = await readEpochWindow(publicClient);
    const { epoch, secondsLeft } = epochWindow;
    if (secondsLeft > SAFE_SECONDS_LEFT) {
      return epochWindow;
    }
    if (Date.now() - startedAt >= MAX_EPOCH_READY_WAIT_MS) {
      throw new Error(
        `Timed out waiting for a safe betting window. epoch=${epoch.toString()} secondsLeft=${secondsLeft}. ` +
        "Check that the keeper or auto-resolve path is advancing epochs.",
      );
    }
    const waitMs = Math.max((secondsLeft + 3) * 1000, 5_000);
    console.log(`[playtest] epoch ${epoch.toString()} too close to end (${secondsLeft}s left), waiting ${Math.ceil(waitMs / 1000)}s`);
    await delay(waitMs);
  }
}

async function readEpochWindow(publicClient: PublicClient) {
  const epoch = await publicClient.readContract({
    address: CONTRACT_ADDRESS,
    abi: GAME_ABI,
    functionName: "currentEpoch",
  });
  const endTime = await publicClient.readContract({
    address: CONTRACT_ADDRESS,
    abi: GAME_ABI,
    functionName: "getEpochEndTime",
    args: [epoch],
  });
  const now = Math.floor(Date.now() / 1000);
  return {
    epoch,
    epochEndTime: endTime,
    secondsLeft: Number(endTime) - now,
  };
}

async function getFeeOverrides(publicClient: PublicClient) {
  try {
    const fees = await publicClient.estimateFeesPerGas();
    return getKeeperFeeOverrides(fees, APP_CHAIN.id) ?? getFallbackFeeOverrides(APP_CHAIN.id, "keeper");
  } catch {
    return getFallbackFeeOverrides(APP_CHAIN.id, "keeper");
  }
}

async function ensureAllowance(
  publicClient: PublicClient,
  walletClient: ReturnType<typeof createWalletClient>,
  account: TestAccount,
  neededAmount: bigint,
): Promise<`0x${string}` | null> {
  const allowance = await publicClient.readContract({
    address: LINEA_TOKEN_ADDRESS,
    abi: TOKEN_ABI,
    functionName: "allowance",
    args: [account.address, CONTRACT_ADDRESS],
  });
  if (allowance >= neededAmount) {
    console.log(`[playtest] allowance already sufficient: ${formatUnits(allowance, 18)} LINEA`);
    return null;
  }

  const nativeBalance = await publicClient.getBalance({ address: account.address });
  let feeOverrides = await getFeeOverrides(publicClient);
  let estimatedGas: bigint;
  try {
    estimatedGas = await publicClient.estimateContractGas({
      account: account.address,
      address: LINEA_TOKEN_ADDRESS,
      abi: TOKEN_ABI,
      functionName: "approve",
      args: [CONTRACT_ADDRESS, MAX_UINT256],
      ...feeOverrides,
    } as never);
  } catch {
    estimatedGas = APPROVE_GAS_FALLBACK;
  }
  feeOverrides = clampKeeperFeeOverridesToBalance(feeOverrides, estimatedGas, nativeBalance) ?? feeOverrides;
  const gas = getAffordableKeeperGasLimit(estimatedGas, nativeBalance, feeOverrides) ?? estimatedGas;

  console.log(`[playtest] approving token spend, allowance=${formatUnits(allowance, 18)} needed=${formatUnits(neededAmount, 18)}`);
  const hash = await walletClient.writeContract({
    account,
    chain: APP_CHAIN,
    address: LINEA_TOKEN_ADDRESS,
    abi: TOKEN_ABI,
    functionName: "approve",
    args: [CONTRACT_ADDRESS, MAX_UINT256],
    gas,
    ...feeOverrides,
  } as never);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`approve failed: ${hash}`);
  }
  return hash;
}

async function placeSingleBet(
  publicClient: PublicClient,
  walletClient: ReturnType<typeof createWalletClient>,
  account: TestAccount,
  tile: number,
  amount: bigint,
) {
  const nativeBalance = await publicClient.getBalance({ address: account.address });
  let feeOverrides = await getFeeOverrides(publicClient);
  let estimatedGas: bigint;
  try {
    estimatedGas = await publicClient.estimateContractGas({
      account: account.address,
      address: CONTRACT_ADDRESS,
      abi: GAME_ABI,
      functionName: "placeBet",
      args: [BigInt(tile), amount],
      ...feeOverrides,
    } as never);
  } catch {
    estimatedGas = SINGLE_GAS_FALLBACK;
  }
  feeOverrides = clampKeeperFeeOverridesToBalance(feeOverrides, estimatedGas, nativeBalance) ?? feeOverrides;
  const gas = getAffordableKeeperGasLimit(estimatedGas, nativeBalance, feeOverrides) ?? estimatedGas;

  const hash = await walletClient.writeContract({
    account,
    chain: APP_CHAIN,
    address: CONTRACT_ADDRESS,
    abi: GAME_ABI,
    functionName: "placeBet",
    args: [BigInt(tile), amount],
    gas,
    ...feeOverrides,
  } as never);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`single bet failed: ${hash}`);
  }
  return hash;
}

async function placeBatchBet(
  publicClient: PublicClient,
  walletClient: ReturnType<typeof createWalletClient>,
  account: TestAccount,
  tiles: number[],
  amount: bigint,
) {
  const nativeBalance = await publicClient.getBalance({ address: account.address });
  const tileArgs = tiles.map((tile) => BigInt(tile));
  const tileMask = tileIdsToMask(tiles);
  let feeOverrides = await getFeeOverrides(publicClient);
  let estimatedGas: bigint;
  let hash: `0x${string}`;

  try {
    estimatedGas = await publicClient.estimateContractGas({
      account: account.address,
      address: CONTRACT_ADDRESS,
      abi: GAME_ABI,
      functionName: "placeBatchBetsBitmap",
      args: [tileMask, amount],
      ...feeOverrides,
    } as never);
    feeOverrides = clampKeeperFeeOverridesToBalance(feeOverrides, estimatedGas, nativeBalance) ?? feeOverrides;
    const gas = getAffordableKeeperGasLimit(estimatedGas, nativeBalance, feeOverrides) ?? estimatedGas;
    hash = await walletClient.writeContract({
      account,
      chain: APP_CHAIN,
      address: CONTRACT_ADDRESS,
      abi: GAME_ABI,
      functionName: "placeBatchBetsBitmap",
      args: [tileMask, amount],
      gas,
      ...feeOverrides,
    } as never);
  } catch (bitmapError) {
    const bitmapMessage = bitmapError instanceof Error ? bitmapError.message : String(bitmapError);
    console.log(`[playtest] placeBatchBetsBitmap unavailable or failed, falling back: ${bitmapMessage}`);
    try {
      estimatedGas = await publicClient.estimateContractGas({
        account: account.address,
        address: CONTRACT_ADDRESS,
        abi: GAME_ABI,
        functionName: "placeBatchBetsSameAmount",
        args: [tileArgs, amount],
        ...feeOverrides,
      } as never);
      feeOverrides = clampKeeperFeeOverridesToBalance(feeOverrides, estimatedGas, nativeBalance) ?? feeOverrides;
      const gas = getAffordableKeeperGasLimit(estimatedGas, nativeBalance, feeOverrides) ?? estimatedGas;
      hash = await walletClient.writeContract({
        account,
        chain: APP_CHAIN,
        address: CONTRACT_ADDRESS,
        abi: GAME_ABI,
        functionName: "placeBatchBetsSameAmount",
        args: [tileArgs, amount],
        gas,
        ...feeOverrides,
      } as never);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(`[playtest] placeBatchBetsSameAmount unavailable or failed, falling back: ${message}`);
      const amountArgs = tiles.map(() => amount);
      try {
        estimatedGas = await publicClient.estimateContractGas({
          account: account.address,
          address: CONTRACT_ADDRESS,
          abi: GAME_ABI,
          functionName: "placeBatchBets",
          args: [tileArgs, amountArgs],
          ...feeOverrides,
        } as never);
      } catch {
        estimatedGas = BATCH_GAS_FALLBACK;
      }
      feeOverrides = clampKeeperFeeOverridesToBalance(feeOverrides, estimatedGas, nativeBalance) ?? feeOverrides;
      const gas = getAffordableKeeperGasLimit(estimatedGas, nativeBalance, feeOverrides) ?? estimatedGas;
      hash = await walletClient.writeContract({
        account,
        chain: APP_CHAIN,
        address: CONTRACT_ADDRESS,
        abi: GAME_ABI,
        functionName: "placeBatchBets",
        args: [tileArgs, amountArgs],
        gas,
        ...feeOverrides,
      } as never);
    }
  }

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") {
    throw new Error(`batch bet failed: ${hash}`);
  }
  return hash;
}

async function fetchJson(url: string) {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  const text = await response.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: response.status, ok: response.ok, json };
}

async function main() {
  const account = process.env.TEST_WALLET_PRIVATE_KEY?.trim()
    ? privateKeyToAccount(normalizePrivateKey(getRequiredEnv("TEST_WALLET_PRIVATE_KEY")))
    : null;
  const dryRunAddress = process.env.TEST_WALLET_ADDRESS?.trim()
    ? getAddress(process.env.TEST_WALLET_ADDRESS)
    : account?.address;
  if (!DRY_RUN && !account) {
    throw new Error("Missing required env var: TEST_WALLET_PRIVATE_KEY");
  }

  const rpcUrls = getStableLineaReadRpcs(process.env.TEST_WALLET_RPC_URL ?? process.env.NEXT_PUBLIC_LINEA_RPCS, APP_NETWORK);
  const transport = fallback(rpcUrls.map((url) => http(url)));
  const publicClient = createPublicClient({ chain: APP_CHAIN, transport });
  const walletClient = account ? createWalletClient({ account, chain: APP_CHAIN, transport }) : null;

  const contractToken = await publicClient.readContract({
    address: CONTRACT_ADDRESS,
    abi: GAME_ABI,
    functionName: "token",
  });
  if (String(contractToken).toLowerCase() !== LINEA_TOKEN_ADDRESS.toLowerCase()) {
    throw new Error(`Contract token mismatch: expected ${LINEA_TOKEN_ADDRESS}, got ${contractToken}`);
  }

  const epochWindow = DRY_RUN
    ? await readEpochWindow(publicClient)
    : await waitForSafeEpochWindow(publicClient);
  const { epoch, secondsLeft } = epochWindow;
  const { singleTile, batchTiles } = buildTilePlan(epoch);
  const neededAmount = SINGLE_AMOUNT + BATCH_AMOUNT * BigInt(batchTiles.length);

  console.log(`[playtest] dryRun=${DRY_RUN ? "yes" : "no"}`);
  console.log(`[playtest] wallet=${dryRunAddress ? "configured" : "not-set"}`);
  console.log(`[playtest] network=${APP_NETWORK} chainId=${APP_CHAIN.id}`);
  console.log(`[playtest] rpcCount=${rpcUrls.length}`);
  console.log(`[playtest] contract=${CONTRACT_ADDRESS}`);
  console.log(`[playtest] token=${LINEA_TOKEN_ADDRESS}`);
  console.log(`[playtest] epoch=${epoch.toString()} secondsLeft=${secondsLeft}`);
  console.log(`[playtest] single=${singleTile} x ${formatUnits(SINGLE_AMOUNT, 18)} LINEA`);
  console.log(`[playtest] batch=${batchTiles.join(",")} x ${formatUnits(BATCH_AMOUNT, 18)} LINEA`);

  if (DRY_RUN) {
    let tokenBalance: bigint | null = null;
    let nativeBalance: bigint | null = null;
    let allowance: bigint | null = null;
    if (dryRunAddress) {
      [tokenBalance, nativeBalance, allowance] = await Promise.all([
        publicClient.readContract({
          address: LINEA_TOKEN_ADDRESS,
          abi: TOKEN_ABI,
          functionName: "balanceOf",
          args: [dryRunAddress],
        }),
        publicClient.getBalance({ address: dryRunAddress }),
        publicClient.readContract({
          address: LINEA_TOKEN_ADDRESS,
          abi: TOKEN_ABI,
          functionName: "allowance",
          args: [dryRunAddress, CONTRACT_ADDRESS],
        }),
      ]);
      console.log(
        `[playtest] walletPreflight token=${tokenBalance >= neededAmount ? "ready" : "insufficient"} ` +
        `gas=${nativeBalance > 0n ? "ready" : "insufficient"} ` +
        `allowance=${allowance >= neededAmount ? "ready" : "approval-needed"}`,
      );
    }

    const [home, deposits, rebates] = await Promise.all([
      fetch(`${BASE_URL}/`, { headers: { accept: "text/html" } }).then((response) => ({ ok: response.ok, status: response.status })),
      dryRunAddress
        ? fetchJson(`${BASE_URL}/api/deposits?user=${dryRunAddress.toLowerCase()}&includeRewards=1`)
        : Promise.resolve({ ok: false, status: 0, json: "skipped: TEST_WALLET_ADDRESS not set" }),
      dryRunAddress
        ? fetchJson(`${BASE_URL}/api/rebates?user=${dryRunAddress.toLowerCase()}`)
        : Promise.resolve({ ok: false, status: 0, json: "skipped: TEST_WALLET_ADDRESS not set" }),
    ]);
    console.log("[playtest] dry-run api snapshots");
    console.log(JSON.stringify({
      home,
      depositsStatus: deposits.status,
      depositsOk: deposits.ok,
      rebatesStatus: rebates.status,
      rebatesOk: rebates.ok,
      epochEndTime: epochWindow.epochEndTime.toString(),
      epochIsStale: secondsLeft <= 0,
      hasEnoughToken: tokenBalance == null ? null : tokenBalance >= neededAmount,
      hasEnoughEth: nativeBalance == null ? null : nativeBalance > 0n,
      allowanceEnough: allowance == null ? null : allowance >= neededAmount,
    }, (_key, value) => (typeof value === "bigint" ? value.toString() : value), 2));
    return;
  }

  if (!account || !walletClient) {
    throw new Error("Wallet client unavailable");
  }

  const tokenBalance = await publicClient.readContract({
    address: LINEA_TOKEN_ADDRESS,
    abi: TOKEN_ABI,
    functionName: "balanceOf",
    args: [account.address],
  });
  const nativeBalance = await publicClient.getBalance({ address: account.address });
  console.log(`[playtest] walletPreflight token=${tokenBalance >= neededAmount ? "ready" : "insufficient"} gas=${nativeBalance > 0n ? "ready" : "insufficient"}`);

  if (tokenBalance < neededAmount) {
    throw new Error("Insufficient LINEA balance for the requested test");
  }
  if (nativeBalance <= 0n) {
    throw new Error("Insufficient ETH for gas");
  }

  const approvedTx = await ensureAllowance(publicClient, walletClient, account, neededAmount);
  const singleTx = await placeSingleBet(publicClient, walletClient, account, singleTile, SINGLE_AMOUNT);
  const batchTx = await placeBatchBet(publicClient, walletClient, account, batchTiles, BATCH_AMOUNT);

  const userBets = await publicClient.readContract({
    address: CONTRACT_ADDRESS,
    abi: GAME_ABI,
    functionName: "getUserBetsAll",
    args: [epoch, account.address],
  });
  const verifiedSingle = userBets[singleTile - 1] ?? 0n;
  const verifiedBatch = batchTiles.map((tile) => ({
    tile,
    amount: userBets[tile - 1] ?? 0n,
  }));

  await delay(POST_TX_API_WAIT_MS);

  const deposits = await fetchJson(`${BASE_URL}/api/deposits?user=${account.address.toLowerCase()}&includeRewards=1`);
  const rewards = await fetchJson(`${BASE_URL}/api/rebates?user=${account.address.toLowerCase()}`);

  const summary: PlaytestSummary = {
    address: getAddress(account.address),
    network: APP_NETWORK,
    contract: CONTRACT_ADDRESS,
    token: LINEA_TOKEN_ADDRESS,
    epoch: epoch.toString(),
    singleTile,
    batchTiles,
    approvedTx: approvedTx ?? undefined,
    singleTx,
    batchTx,
  };

  console.log("[playtest] on-chain verification");
  console.log(`  single tile ${singleTile}: ${formatUnits(verifiedSingle, 18)} LINEA`);
  for (const entry of verifiedBatch) {
    console.log(`  batch tile ${entry.tile}: ${formatUnits(entry.amount, 18)} LINEA`);
  }

  console.log("[playtest] api snapshots");
  const safeSummary = Object.fromEntries(Object.entries(summary).filter(([key]) => key !== "address"));
  console.log(JSON.stringify({
    summary: safeSummary,
    depositsStatus: deposits.status,
    depositsOk: deposits.ok,
    rebatesStatus: rewards.status,
    rebatesOk: rewards.ok,
  }, null, 2));
}

main().catch((error) => {
  console.error("[playtest] failed", error);
  process.exitCode = 1;
});
