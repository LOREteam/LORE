import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

const strict = process.argv.includes("--strict") || process.env.PROOF_STRICT === "1";
const summaryOnly = process.argv.includes("--summary-only");
const chainLaunchGates = ["G1"];
const chainLaunchGateGroups = "chain=1";
const MAX_TILE_ID = 25;
const CANONICAL_POSITIVE_INTEGER_RE = /^[1-9]\d{0,15}$/;
const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
const args = new Map(
  process.argv
    .slice(2)
    .filter((arg) => arg.startsWith("--") && arg.includes("="))
    .map((arg) => {
      const [key, ...rest] = arg.slice(2).split("=");
      return [key, rest.join("=")];
    }),
);

function launchGateSummary(issueCount) {
  const label = issueCount > 0 ? "blocked" : "covered";
  return `${label} gates: ${chainLaunchGates.join(", ")}; groups: ${chainLaunchGateGroups}`;
}

const READ_ABI_SOURCE = [
  "function owner() view returns (address)",
  "function token() view returns (address)",
  "function currentEpoch() view returns (uint256)",
  "function epochDuration() view returns (uint256)",
  "function epochStartTime() view returns (uint256)",
  "function feeRecipient() view returns (address)",
  "function rolloverPool() view returns (uint256)",
  "function dailyJackpotPool() view returns (uint256)",
  "function weeklyJackpotPool() view returns (uint256)",
  "function accruedOwnerFees() view returns (uint256)",
  "function accruedBurnFees() view returns (uint256)",
  "function getJackpotInfo() view returns (uint256 dailyPool, uint256 weeklyPool, uint256 lastDailyDay, uint256 lastWeeklyWeek, uint256 lastDailyEpoch, uint256 lastWeeklyEpoch, uint256 lastDailyAmount, uint256 lastWeeklyAmount)",
  "function epochs(uint256) view returns (uint256 totalPool, uint256 rewardPool, uint256 winningTile, bool isResolved, bool isDailyJackpot, bool isWeeklyJackpot)",
  "function getTileData(uint256) view returns (uint256[] pools, uint256[] users)",
  "function epochRebatePool(uint256) view returns (uint256)",
  "function epochRewardClaimed(uint256) view returns (uint256)",
  "function epochResolvedAt(uint256) view returns (uint256)",
  "function getRebateInfo(uint256,address) view returns (uint256 rebatePool, uint256 userVolume, uint256 pending, bool claimed, bool resolved)",
  "function getUserBetsAll(uint256,address) view returns (uint256[] bets)",
  "function hasClaimed(address,uint256) view returns (bool)",
  "function pendingResolverRewards(address) view returns (uint256)",
];

const CHAINS = {
  mainnet: {
    id: 59144,
    name: "Linea Mainnet",
    nativeCurrency: { name: "Linea Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: ["https://rpc.linea.build"] } },
  },
  sepolia: {
    id: 59141,
    name: "Linea Sepolia Testnet",
    nativeCurrency: { name: "Linea Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: ["https://rpc.sepolia.linea.build"] } },
    testnet: true,
  },
};

function env(name) {
  return process.env[name]?.trim() || "";
}

function getNetwork() {
  const raw = (env("LINEA_NETWORK") || env("NEXT_PUBLIC_LINEA_NETWORK") || "sepolia").toLowerCase();
  return raw === "mainnet" || raw === "main" || raw === "linea" || raw === "prod" ? "mainnet" : "sepolia";
}

function getRpcs(network) {
  const configured = env("KEEPER_RPC_URL") || env("NEXT_PUBLIC_LINEA_RPCS") || env("NEXT_PUBLIC_LINEA_SEPOLIA_RPCS");
  const urls = configured
    ? configured.split(",").map((url) => url.trim()).filter(Boolean)
    : network === "mainnet"
      ? ["https://rpc.linea.build"]
      : ["https://linea-sepolia-rpc.publicnode.com", "https://linea-sepolia.drpc.org", "https://rpc.sepolia.linea.build"];
  return [...new Set(urls)];
}

function configuredRpcSource() {
  if (env("KEEPER_RPC_URL")) return "KEEPER_RPC_URL";
  if (env("NEXT_PUBLIC_LINEA_RPCS")) return "NEXT_PUBLIC_LINEA_RPCS";
  if (env("NEXT_PUBLIC_LINEA_SEPOLIA_RPCS")) return "NEXT_PUBLIC_LINEA_SEPOLIA_RPCS";
  return "";
}

function isHttpsRpcUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && !parsed.username && !parsed.password && Boolean(parsed.hostname);
  } catch {
    return false;
  }
}

function redactAddress(value) {
  if (!value || !isAddress(value)) return value || "missing";
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function fmtWei(value) {
  const sign = value < 0n ? "-" : "";
  const raw = (value < 0n ? -value : value).toString().padStart(19, "0");
  const whole = raw.slice(0, -18).replace(/^0+(?=\d)/, "") || "0";
  const fraction = raw.slice(-18).replace(/0+$/, "");
  return `${sign}${whole}${fraction ? `.${fraction}` : ""}`;
}

function fmtBool(value) {
  return value ? "yes" : "no";
}

function parseChainTileId(value, tileCount = MAX_TILE_ID) {
  if (typeof value !== "bigint") return null;
  if (value < 1n || value > BigInt(tileCount)) return null;
  return toSafeDisplayInteger("chain tile id", value, 1, tileCount);
}

function toSafeDisplayInteger(label, value, min, max) {
  if (typeof value !== "bigint" || value < BigInt(min) || value > BigInt(max)) {
    throw new Error(`${label} must be between ${min} and ${max}`);
  }
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`${label} exceeds the safe integer display range`);
  }
  return Number(value);
}

function compareBigIntAscending(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function parseCanonicalPositiveBigInt(value) {
  const text = String(value ?? "").trim();
  if (!CANONICAL_POSITIVE_INTEGER_RE.test(text)) return null;
  return BigInt(text);
}

function parseEpochArgValues(raw) {
  if (!raw) return [];
  return raw.split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map(parseCanonicalPositiveBigInt);
}

function parseEpochs(raw, currentEpoch) {
  if (raw) {
    const values = parseEpochArgValues(raw).filter((value) => value !== null);
    return [...new Set(values)].sort(compareBigIntAscending);
  }
  const epochs = [];
  const start = currentEpoch > 3n ? currentEpoch - 3n : 1n;
  for (let epoch = start; epoch <= currentEpoch; epoch += 1n) epochs.push(epoch);
  return epochs;
}

function validateEpochArg(raw) {
  if (!raw) return [];
  const rawValues = raw.split(",").map((part) => part.trim()).filter(Boolean);
  const values = parseEpochArgValues(raw);
  const errors = [];
  let positiveCount = 0;
  for (const value of values) {
    if (value === null) {
      errors.push("epoch values must be canonical positive decimal integers");
    } else if (value > 0n) {
      positiveCount += 1;
    }
  }
  if (rawValues.length === 0 || positiveCount === 0) {
    errors.push("at least one positive epoch must be checked");
  }
  return [...new Set(errors)];
}

function sum(values) {
  return values.reduce((total, value) => total + value, 0n);
}

function printTable(headers, rows) {
  console.log(`| ${headers.join(" | ")} |`);
  console.log(`| ${headers.map(() => "---").join(" | ")} |`);
  for (const row of rows) {
    console.log(`| ${row.join(" | ")} |`);
  }
}

let READ_ABI;

async function read(client, address, functionName, args = []) {
  return client.readContract({ address, abi: READ_ABI, functionName, args });
}

function isAddress(value) {
  return ADDRESS_RE.test(value || "");
}

function isRealAddress(value) {
  return isAddress(value) && String(value).toLowerCase() !== ZERO_ADDRESS;
}

const network = getNetwork();
const chain = CHAINS[network];
const rpcs = getRpcs(network);
const rpcSource = configuredRpcSource();
const contractAddress = env("KEEPER_CONTRACT_ADDRESS") || env("NEXT_PUBLIC_CONTRACT_ADDRESS");
const configuredToken = env("NEXT_PUBLIC_LINEA_TOKEN_ADDRESS");
const userAddress = args.get("user") || env("PROOF_CHAIN_USER");
const epochArg = args.get("epochs") || env("PROOF_CHAIN_EPOCHS");
const outPath = args.get("out") || env("PROOF_CHAIN_OUT");
const issues = [];
const snapshot = {
  generatedAt: new Date().toISOString(),
  strict,
  network,
  expectedChainId: chain.id,
  rpcChainId: null,
  rpcEndpointCount: rpcs.length,
  rpcSource: rpcSource || "built-in fallback",
  contractAddress: isRealAddress(contractAddress) ? contractAddress : null,
  configuredTokenAddress: isRealAddress(configuredToken) ? configuredToken : null,
  userAddress: isRealAddress(userAddress) ? userAddress : null,
  topLevel: null,
  jackpotInfo: null,
  epochs: [],
  userReads: [],
  issues,
};

function writeSnapshot() {
  if (!outPath) return;
  const resolved = path.resolve(process.cwd(), outPath);
  mkdirSync(path.dirname(resolved), { recursive: true });
  writeFileSync(resolved, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`Snapshot written: ${path.relative(process.cwd(), resolved)}`);
}

console.log("# Chain / Funds Proof Snapshot");
console.log("");
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log(`Strict: ${strict ? "yes" : "no"}`);
console.log(`Network: ${network}`);
console.log(`RPC endpoints: ${rpcs.length}`);
console.log(`RPC source: ${rpcSource || "built-in fallback"}`);
console.log("");

if (strict && !rpcSource) {
  issues.push("strict chain proof requires configured RPC env, not built-in fallback RPCs");
}
if (strict && rpcSource && (rpcs.length === 0 || rpcs.some((url) => !isHttpsRpcUrl(url)))) {
  issues.push("strict chain proof requires configured HTTPS RPC endpoints");
}

if (configuredToken && !isRealAddress(configuredToken)) {
  issues.push("configured token address is zero or invalid");
}

if (userAddress && !isRealAddress(userAddress)) {
  issues.push("proof user address is zero or invalid");
}

issues.push(...validateEpochArg(epochArg));

if (!isRealAddress(contractAddress)) {
  issues.push("contract address is missing, zero, or invalid");
}

if (summaryOnly) {
  console.log("# Chain / Funds Proof Summary");
  console.log(`Strict: ${strict ? "yes" : "no"}`);
  console.log(`Network: ${network}`);
  console.log(`RPC source: ${rpcSource ? "configured" : "built-in fallback"}`);
  console.log(`Contract: ${isRealAddress(contractAddress) ? "present" : "missing"}`);
  console.log(`Token: ${isRealAddress(configuredToken) ? "present" : "missing"}`);
  console.log(`Epochs: ${epochArg ? "provided" : "default-window"}`);
  console.log("Would read RPC: false");
  console.log(`Summary: ${issues.length === 0 ? "chain proof status inputs are ready" : `${issues.length} issue(s): ${issues.join("; ")}`}; ${launchGateSummary(issues.length)}.`);
  if (strict && issues.length > 0) process.exitCode = 1;
} else if (!isRealAddress(contractAddress)) {
  console.log(`Summary: ${issues.length} issue(s): ${issues.join("; ")}; ${launchGateSummary(issues.length)}.`);
  writeSnapshot();
  if (strict) process.exitCode = 1;
} else if (issues.length > 0) {
  console.log(`Summary: ${issues.length} issue(s): ${issues.join("; ")}; ${launchGateSummary(issues.length)}.`);
  writeSnapshot();
  if (strict) process.exitCode = 1;
} else {
  let createPublicClient;
  let fallback;
  let http;
  let parseAbi;
  try {
    ({ createPublicClient, fallback, http, parseAbi } = await import("viem"));
    READ_ABI = parseAbi(READ_ABI_SOURCE);
  } catch (error) {
    issues.push(`viem dependency is unavailable: ${error instanceof Error ? error.code || error.message : String(error)}`);
    console.log(`Summary: ${issues.length} issue(s): ${issues.join("; ")}; ${launchGateSummary(issues.length)}.`);
    writeSnapshot();
    if (strict) process.exitCode = 1;
    process.exit();
  }

  const client = createPublicClient({
    chain,
    transport: fallback(rpcs.map((url) => http(url, { timeout: 20_000, retryCount: 1 })), { rank: true }),
  });

  try {
    const [rpcChainId, blockNumber, bytecode] = await Promise.all([
      client.getChainId(),
      client.getBlockNumber(),
      client.getBytecode({ address: contractAddress }),
    ]);
    snapshot.rpcChainId = rpcChainId;
    if (rpcChainId !== chain.id) {
      issues.push(`RPC chain id ${rpcChainId} does not match expected ${chain.id}`);
    }
    if (!bytecode || bytecode === "0x") issues.push("contract bytecode is empty at configured address");

    const [
      owner,
      token,
      currentEpoch,
      epochDuration,
      epochStartTime,
      feeRecipient,
      rolloverPool,
      dailyJackpotPool,
      weeklyJackpotPool,
      accruedOwnerFees,
      accruedBurnFees,
      jackpotInfo,
    ] = await Promise.all([
      read(client, contractAddress, "owner"),
      read(client, contractAddress, "token"),
      read(client, contractAddress, "currentEpoch"),
      read(client, contractAddress, "epochDuration"),
      read(client, contractAddress, "epochStartTime"),
      read(client, contractAddress, "feeRecipient"),
      read(client, contractAddress, "rolloverPool"),
      read(client, contractAddress, "dailyJackpotPool"),
      read(client, contractAddress, "weeklyJackpotPool"),
      read(client, contractAddress, "accruedOwnerFees"),
      read(client, contractAddress, "accruedBurnFees"),
      read(client, contractAddress, "getJackpotInfo"),
    ]);

    if (configuredToken && isRealAddress(configuredToken) && token.toLowerCase() !== configuredToken.toLowerCase()) {
      issues.push("configured token does not match on-chain token()");
    }
    if (!isRealAddress(owner)) issues.push("on-chain owner is zero or invalid");
    if (!isRealAddress(token)) issues.push("on-chain token() is zero or invalid");
    if (!isRealAddress(feeRecipient)) issues.push("on-chain feeRecipient is zero or invalid");
    if (epochDuration <= 0n) issues.push("on-chain epochDuration must be positive");
    if (epochStartTime <= 0n) issues.push("on-chain epochStartTime must be positive");

    snapshot.topLevel = {
      expectedChainId: chain.id,
      rpcChainId,
      blockNumber: blockNumber.toString(),
      bytecodePresent: Boolean(bytecode && bytecode !== "0x"),
      owner,
      feeRecipient,
      tokenOnChain: token,
      tokenConfigured: isRealAddress(configuredToken) ? configuredToken : null,
      tokenMatchesConfigured: configuredToken && isRealAddress(configuredToken) ? token.toLowerCase() === configuredToken.toLowerCase() : null,
      currentEpoch: currentEpoch.toString(),
      epochDuration: epochDuration.toString(),
      epochStartTime: epochStartTime.toString(),
      rolloverPoolWei: rolloverPool.toString(),
      dailyJackpotPoolWei: dailyJackpotPool.toString(),
      weeklyJackpotPoolWei: weeklyJackpotPool.toString(),
      accruedOwnerFeesWei: accruedOwnerFees.toString(),
      accruedBurnFeesWei: accruedBurnFees.toString(),
    };

    printTable(["Field", "Value"], [
      ["expected chain id", String(chain.id)],
      ["RPC chain id", String(rpcChainId)],
      ["head block", blockNumber.toString()],
      ["contract", redactAddress(contractAddress)],
      ["bytecode present", fmtBool(Boolean(bytecode && bytecode !== "0x"))],
      ["owner", redactAddress(owner)],
      ["fee recipient", redactAddress(feeRecipient)],
      ["token on-chain", redactAddress(token)],
      ["token configured", redactAddress(configuredToken)],
      ["token match", configuredToken && isRealAddress(configuredToken) ? fmtBool(token.toLowerCase() === configuredToken.toLowerCase()) : "not checked"],
      ["current epoch", currentEpoch.toString()],
      ["epoch duration sec", epochDuration.toString()],
      ["epoch start time", epochStartTime.toString()],
      ["rollover pool LINEA", fmtWei(rolloverPool)],
      ["daily jackpot pool LINEA", fmtWei(dailyJackpotPool)],
      ["weekly jackpot pool LINEA", fmtWei(weeklyJackpotPool)],
      ["accrued owner fees LINEA", fmtWei(accruedOwnerFees)],
      ["accrued burn fees LINEA", fmtWei(accruedBurnFees)],
    ]);

    console.log("");
    console.log("## Jackpot Info");
    snapshot.jackpotInfo = {
      dailyPoolWei: jackpotInfo[0].toString(),
      weeklyPoolWei: jackpotInfo[1].toString(),
      lastDailyDay: jackpotInfo[2].toString(),
      lastWeeklyWeek: jackpotInfo[3].toString(),
      lastDailyEpoch: jackpotInfo[4].toString(),
      lastWeeklyEpoch: jackpotInfo[5].toString(),
      lastDailyAmountWei: jackpotInfo[6].toString(),
      lastWeeklyAmountWei: jackpotInfo[7].toString(),
    };
    printTable(["Field", "Value"], [
      ["daily pool LINEA", fmtWei(jackpotInfo[0])],
      ["weekly pool LINEA", fmtWei(jackpotInfo[1])],
      ["last daily day", jackpotInfo[2].toString()],
      ["last weekly week", jackpotInfo[3].toString()],
      ["last daily epoch", jackpotInfo[4].toString()],
      ["last weekly epoch", jackpotInfo[5].toString()],
      ["last daily amount LINEA", fmtWei(jackpotInfo[6])],
      ["last weekly amount LINEA", fmtWei(jackpotInfo[7])],
    ]);

    const epochs = parseEpochs(epochArg, currentEpoch).slice(-25);
    console.log("");
    console.log("## Epoch Reads");
    const epochRows = [];
    for (const epoch of epochs) {
      const [epochData, tileData, rebatePool, rewardClaimed, resolvedAt] = await Promise.all([
        read(client, contractAddress, "epochs", [epoch]),
        read(client, contractAddress, "getTileData", [epoch]),
        read(client, contractAddress, "epochRebatePool", [epoch]),
        read(client, contractAddress, "epochRewardClaimed", [epoch]),
        read(client, contractAddress, "epochResolvedAt", [epoch]),
      ]);
      const tilePoolSum = sum(tileData[0]);
      const tileUsersSum = sum(tileData[1]);
      const totalPool = epochData[0];
      const tileSumMatches = tilePoolSum === totalPool;
      if (!tileSumMatches) issues.push(`epoch ${epoch.toString()} tile pool sum does not match totalPool`);
      if (epochData[3] && parseChainTileId(epochData[2], tileData[0].length) === null) {
        issues.push(`epoch ${epoch.toString()} resolved with invalid winningTile`);
      }
      snapshot.epochs.push({
        epoch: epoch.toString(),
        resolved: Boolean(epochData[3]),
        winningTile: epochData[2].toString(),
        totalPoolWei: totalPool.toString(),
        tilePoolSumWei: tilePoolSum.toString(),
        tilePoolSumMatches: tileSumMatches,
        tileUsersSum: tileUsersSum.toString(),
        rewardPoolWei: epochData[1].toString(),
        rebatePoolWei: rebatePool.toString(),
        rewardClaimedWei: rewardClaimed.toString(),
        resolvedAt: resolvedAt.toString(),
      });
      epochRows.push([
        epoch.toString(),
        fmtBool(epochData[3]),
        epochData[2].toString(),
        fmtWei(totalPool),
        fmtWei(tilePoolSum),
        fmtBool(tileSumMatches),
        tileUsersSum.toString(),
        fmtWei(epochData[1]),
        fmtWei(rebatePool),
        fmtWei(rewardClaimed),
        resolvedAt.toString(),
      ]);
    }
    printTable(
      ["Epoch", "Resolved", "Winning tile", "Total pool", "Tile sum", "Tile sum OK", "Tile users", "Reward pool", "Rebate pool", "Reward claimed", "Resolved at"],
      epochRows,
    );

    if (userAddress) {
      if (!isRealAddress(userAddress)) {
        // Already reported before RPC reads; skip user-specific calls.
      } else {
        console.log("");
        console.log("## User Reward / Rebate Reads");
        const userRows = [];
        const pendingResolverRewards = await read(client, contractAddress, "pendingResolverRewards", [userAddress]);
        for (const epoch of epochs) {
          const [epochData, tileData, rebateInfo, bets, rewardClaimed] = await Promise.all([
            read(client, contractAddress, "epochs", [epoch]),
            read(client, contractAddress, "getTileData", [epoch]),
            read(client, contractAddress, "getRebateInfo", [epoch, userAddress]),
            read(client, contractAddress, "getUserBetsAll", [epoch, userAddress]),
            read(client, contractAddress, "hasClaimed", [userAddress, epoch]),
          ]);
          const winningTile = parseChainTileId(epochData[2], Math.min(bets.length, tileData[0].length));
          const winningIndex = winningTile === null ? -1 : winningTile - 1;
          const winningBet = winningIndex >= 0 ? bets[winningIndex] : 0n;
          const winningTilePool = winningIndex >= 0 ? tileData[0][winningIndex] : 0n;
          const estimatedReward = epochData[3] && winningBet > 0n && winningTilePool > 0n
            ? (epochData[1] * winningBet) / winningTilePool
            : 0n;
          snapshot.userReads.push({
            epoch: epoch.toString(),
            userBetSumWei: sum(bets).toString(),
            userVolumeWei: rebateInfo[1].toString(),
            pendingRebateWei: rebateInfo[2].toString(),
            rebateClaimed: Boolean(rebateInfo[3]),
            winningBetWei: winningBet.toString(),
            estimatedRewardWei: estimatedReward.toString(),
            rewardClaimed: Boolean(rewardClaimed),
          });
          userRows.push([
            epoch.toString(),
            fmtWei(sum(bets)),
            fmtWei(rebateInfo[1]),
            fmtWei(rebateInfo[2]),
            fmtBool(rebateInfo[3]),
            fmtWei(winningBet),
            fmtWei(estimatedReward),
            fmtBool(rewardClaimed),
          ]);
        }
        printTable(
          ["Epoch", "User bet sum", "User volume", "Pending rebate", "Rebate claimed", "Winning bet", "Estimated reward", "Reward claimed"],
          userRows,
        );
        console.log("");
        console.log(`Pending resolver rewards for ${redactAddress(userAddress)}: ${fmtWei(pendingResolverRewards)} LINEA`);
      }
    }
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }

  console.log("");
  console.log(`Summary: ${issues.length === 0 ? "chain proof reads completed without detected issues" : `${issues.length} issue(s): ${issues.join("; ")}`}; ${launchGateSummary(issues.length)}.`);
  writeSnapshot();
  console.log("Copy this summary into `docs/mainnet-proof-record.md` only after confirming it was run against the intended network/RPC.");

  if (strict && issues.length > 0) {
    process.exitCode = 1;
  }
}

process.exit(process.exitCode ?? 0);
