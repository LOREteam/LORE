import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { config as loadDotenv } from "dotenv";
import solc from "solc";
import {
  createPublicClient,
  decodeFunctionResult,
  encodeAbiParameters,
  encodeFunctionData,
  encodePacked,
  fallback,
  getAddress,
  getContractAddress,
  http,
  keccak256,
  parseUnits,
  toHex,
  type Address,
  type Abi,
  type Hex,
} from "viem";
import { TOKEN_ABI } from "../app/lib/constants";
import { GAME_ABI } from "../config/generated/lineaOreV10Abi";
import {
  getConfiguredContractAddress,
  getConfiguredLineaNetwork,
  getConfiguredLineaTokenAddress,
  getLineaChain,
  getStableLineaReadRpcs,
} from "../config/publicConfig";

const require = createRequire(import.meta.url);
const legacySolc = require("solc-0.8.34") as typeof solc;
assert.match(legacySolc.version(), /^0\.8\.34\+/, "V9 benchmark compiler must match the deployed manifest");
assert.match(solc.version(), /^0\.8\.36\+/, "V10 benchmark compiler must match the candidate manifest");

const CONTRACTS = [
  { path: "contracts/LineaOreV9.sol", name: "LineaOreV9" },
  { path: "contracts/LineaOreV10.sol", name: "LineaOreV10" },
] as const;
const SYNTHETIC_EPOCH = 1_000_000_000_000n;
const SYNTHETIC_DURATION = 3_600n;
const BET_AMOUNT = parseUnits("1", 18);
const DAY_SECONDS = 86_400n;
const WEEK_SECONDS = 604_800n;
const MONDAY_OFFSET_SECONDS = 259_200n;
const DUST_SETTLE_DELAY_SECONDS = 365n * DAY_SECONDS;
const FEE_FLUSH_INTERVAL_EPOCHS = 120n;
const EMPTY_SIMULATION_ADDRESS = getAddress("0x000000000000000000000000000000000000bEEF");
const TOKEN_SIMULATION_ADDRESS = getAddress("0x000000000000000000000000000000000000cafE");
const HARNESS_SIMULATION_ADDRESS = getAddress("0x000000000000000000000000000000000000F00D");
const CALLER_SIMULATION_ADDRESS = getAddress("0x000000000000000000000000000000000000d00D");
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as Address;
const REENTRANCY_GUARD_STORAGE_SLOT = "0x9b779b17422d0df92223018b32b4d1fa46e071723d6817e2486d003becc55f00" as Hex;
const LIVE_TEST_ROLES = ["MANUAL", "AUTOMINER_A", "AUTOMINER_B", "AUTOMINER_C"] as const;
const DECIMAL_INTEGER_RE = /^(?:0|[1-9]\d{0,15})$/;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const BEHAVIOR_ONLY_TIMEOUT_MS = parsePositiveIntegerEnv("V10_BEHAVIOR_TIMEOUT_MS", 90_000, 1_000, 900_000);
const MAX_RPC_RESPONSE_BYTES = 512 * 1024;
const MAX_BENCHMARK_SOURCE_BYTES = 2 * 1024 * 1024;
const MAX_BENCHMARK_COMPILER_CONFIG_BYTES = 512 * 1024;
const MAX_PREPARED_INITCODE_BYTES = 256 * 1024;
const CONTENT_LENGTH_RE = /^(?:0|[1-9]\d{0,15})$/;
type LiveTestRole = (typeof LIVE_TEST_ROLES)[number];
type AccountReadiness = {
  role: LiveTestRole;
  configured: boolean;
  nativeBalanceReady?: boolean;
  tokenBalanceReady?: boolean;
  allowanceReady?: boolean;
  eligible: boolean;
};
type BenchmarkRow = {
  contract: string;
  operation: string;
  mode: string;
  tiles: number;
  gasLimit: number;
  baseFeePerGas: string;
  priorityFeePerGas: string;
  estimatedFeeWei?: string;
  gasDeltaVsV9?: number;
  gasDeltaPercentVsV9?: number;
};

function parsePositiveIntegerEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return parsePositiveIntegerValue(name, raw, min, max);
}

function parsePositiveIntegerValue(name: string, raw: string, min: number, max: number): number {
  if (!DECIMAL_INTEGER_RE.test(raw)) {
    throw new Error(`${name} must be a canonical decimal integer`);
  }
  const parsed = BigInt(raw);
  if (parsed > MAX_SAFE_INTEGER_BIGINT) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  const numeric = Number(parsed);
  if (!Number.isSafeInteger(numeric) || numeric < min || numeric > max) {
    throw new Error(`${name} must be between ${min} and ${max}`);
  }
  return numeric;
}

function toSafeDisplayInteger(value: bigint, label: string): number {
  if (value < 0n || value > MAX_SAFE_INTEGER_BIGINT) {
    throw new Error(`${label} must fit in a JavaScript safe integer`);
  }
  return Number(value);
}

function readBoundedUtf8File(filePath: string, maxBytes: number, label: string): string {
  const stats = fs.statSync(filePath);
  if (!stats.isFile()) {
    throw new Error(`${label} must be a file: ${filePath}`);
  }
  if (stats.size > maxBytes) {
    throw new Error(`${label} is too large to benchmark safely: ${filePath}`);
  }
  return fs.readFileSync(filePath, "utf8");
}

const v10CompilerConfig = JSON.parse(
  readBoundedUtf8File(
    "contracts/LineaOreV10.compiler-config.json",
    MAX_BENCHMARK_COMPILER_CONFIG_BYTES,
    "V10 compiler config",
  ),
);
assert.deepEqual(
  {
    language: v10CompilerConfig.language,
    optimizer: v10CompilerConfig.settings?.optimizer,
    viaIR: v10CompilerConfig.settings?.viaIR,
    evmVersion: v10CompilerConfig.settings?.evmVersion,
  },
  {
    language: "Solidity",
    optimizer: { enabled: true, runs: 200 },
    viaIR: false,
    evmVersion: "osaka",
  },
  "V10 compiler config must match the canonical profile",
);
const v10RunsArg = process.argv.find((arg) => arg.startsWith("--v10-runs="))?.split("=", 2)[1];
const V10_OPTIMIZER_RUNS = v10RunsArg !== undefined
  ? parsePositiveIntegerValue("--v10-runs", v10RunsArg, 1, 1_000_000)
  : v10CompilerConfig.settings.optimizer.runs;
const V10_VIA_IR = process.argv.includes("--v10-via-ir") || v10CompilerConfig.settings.viaIR;
const V10_WITH_AUTO_FLUSH = process.argv.includes("--v10-with-auto-flush");
if (!Number.isSafeInteger(V10_OPTIMIZER_RUNS) || V10_OPTIMIZER_RUNS < 1 || V10_OPTIMIZER_RUNS > 1_000_000) {
  throw new Error("--v10-runs must be an integer from 1 to 1000000");
}
const DIAGNOSTIC_SOURCE = `
// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.20;

interface IGame {
    function token() external view returns (address);
    function currentEpoch() external view returns (uint256);
    function epochStartTime() external view returns (uint256);
    function epochs(uint256) external view returns (uint256, uint256, uint256, bool, bool, bool);
    function getTileData(uint256) external view returns (uint256[] memory, uint256[] memory);
    function getUserBetsAll(uint256, address) external view returns (uint256[] memory);
    function userEpochVolumes(uint256, address) external view returns (uint256);
    function placeBet(uint256, uint256) external;
    function placeBatchBets(uint256[] calldata, uint256[] calldata) external;
    function placeBatchBetsSameAmount(uint256[] calldata, uint256) external;
    function placeBatchBetsBitmap(uint32, uint256) external;
    function placeBatchBetsBitmapForEpoch(uint256, uint32, uint256) external;
    function resolveEpoch(uint256) external;
    function rolloverPool() external view returns (uint256);
    function dailyJackpotPool() external view returns (uint256);
    function weeklyJackpotPool() external view returns (uint256);
    function lastDailyJackpotDay() external view returns (uint256);
    function lastWeeklyJackpotWeek() external view returns (uint256);
    function lastDailyJackpotEpoch() external view returns (uint256);
    function lastWeeklyJackpotEpoch() external view returns (uint256);
    function lastDailyJackpotAmount() external view returns (uint256);
    function lastWeeklyJackpotAmount() external view returns (uint256);
    function lastDailyJackpotCheckTs() external view returns (uint256);
    function lastWeeklyJackpotCheckTs() external view returns (uint256);
    function accruedOwnerFees() external view returns (uint256);
    function accruedBurnFees() external view returns (uint256);
    function pendingResolverRewards(address) external view returns (uint256);
    function epochRebatePool(uint256) external view returns (uint256);
    function epochRebateClaimed(uint256) external view returns (uint256);
    function rebateClaimed(uint256, address) external view returns (bool);
    function epochRewardClaimed(uint256) external view returns (uint256);
    function hasClaimed(address, uint256) external view returns (bool);
    function epochDustSettled(uint256) external view returns (bool);
    function epochResolvedAt(uint256) external view returns (uint256);
    function epochDuration() external view returns (uint256);
    function owner() external view returns (address);
    function pendingOwner() external view returns (address);
    function feeRecipient() external view returns (address);
    function pendingEpochDuration() external view returns (uint256);
    function pendingEpochDurationEta() external view returns (uint256);
    function pendingEpochDurationEffectiveFromEpoch() external view returns (uint256);
    function pendingFeeRecipient() external view returns (address);
    function pendingFeeRecipientEta() external view returns (uint256);
    function claimReward(uint256) external;
    function claimRewards(uint256[] calldata) external;
    function claimEpochRebate(uint256) external;
    function claimEpochsRebate(uint256[] calldata) external;
    function settleEpochDust(uint256) external;
    function settleEpochsDust(uint256[] calldata) external;
    function settleEpochRebateDust(uint256) external;
    function settleEpochsRebateDust(uint256[] calldata) external;
    function claimResolverRewards() external;
    function flushProtocolFees() external;
    function transferOwnership(address) external;
    function acceptOwnership() external;
    function renounceOwnership() external;
    function scheduleEpochDuration(uint256) external;
    function cancelEpochDurationChange() external;
    function scheduleFeeRecipientChange(address) external;
    function cancelFeeRecipientChange() external;
}

contract StandardTransferToken {
    function transferFrom(address, address, uint256) external pure returns (bool) {
        return true;
    }

    function transfer(address, uint256) external pure returns (bool) {
        return true;
    }
}

contract ReentrancyProbeToken {
    uint256 private _depth;
    error ReentrySucceeded();

    function _probeReentry() private {
        if (_depth == 0) {
            _depth = 1;
            (bool success, ) = msg.sender.call(abi.encodeWithSelector(IGame.placeBet.selector, 1, 1));
            _depth = 0;
            if (success) revert ReentrySucceeded();
        }
    }

    function transferFrom(address, address, uint256) external returns (bool) {
        _probeReentry();
        return true;
    }

    function transfer(address, uint256) external returns (bool) {
        _probeReentry();
        return true;
    }
}

contract RejectingTransferToken {
    function transferFrom(address, address, uint256) external pure returns (bool) {
        return false;
    }

    function transfer(address, uint256) external pure returns (bool) {
        return false;
    }
}

contract StateHarness {
    struct BetSnapshot {
        uint256 startEpoch;
        uint256 currentEpoch;
        uint256 totalPool;
        uint256 rewardPool;
        uint256 winningTile;
        bool resolved;
        bool startEpochResolved;
        uint256[] pools;
        uint256[] users;
        uint256[] bets;
        uint256 userVolume;
    }

    struct ResolveSnapshot {
        uint256 currentEpoch;
        uint256 totalPool;
        uint256 rewardPool;
        uint256 winningTile;
        bool resolved;
        bool dailyJackpot;
        bool weeklyJackpot;
        uint256 rollover;
        uint256 dailyPool;
        uint256 weeklyPool;
        uint256 ownerFees;
        uint256 burnFees;
        uint256 resolverRewards;
        uint256 rebatePool;
        uint256 resolvedAt;
        uint256 lastDailyDay;
        uint256 lastWeeklyWeek;
        uint256 lastDailyEpoch;
        uint256 lastWeeklyEpoch;
        uint256 lastDailyAmount;
        uint256 lastWeeklyAmount;
        uint256 lastDailyCheckTs;
        uint256 lastWeeklyCheckTs;
    }

    struct MutationSnapshot {
        bool rewardClaimedByCaller;
        bool rebateClaimedByCaller;
        bool rewardDustSettled;
        bool duplicateRejected;
        uint256 rewardClaimedTotal;
        uint256 rebateClaimedTotal;
        uint256 resolverRewards;
        uint256 ownerFees;
        uint256 burnFees;
        uint256 userVolume;
    }

    struct RollbackSnapshot {
        bool rejected;
        bool rewardClaimedByCaller;
        bool rebateClaimedByCaller;
        bool rewardDustSettled;
        uint256 rewardClaimedTotal;
        uint256 rebateClaimedTotal;
        uint256 resolverRewards;
        uint256 ownerFees;
        uint256 burnFees;
        address feeRecipient;
        address pendingFeeRecipient;
        uint256 pendingFeeRecipientEta;
    }

    struct OwnershipSnapshot {
        address ownerAfterAccept;
        address pendingOwnerAfterAccept;
        address pendingOwnerAfterTransfer;
    }

    struct DeploymentSnapshot {
        bytes32 runtimeCodeHash;
        uint256 runtimeCodeLength;
        address tokenAddress;
        address owner;
        address pendingOwner;
        address feeRecipient;
        uint256 currentEpoch;
        uint256 epochDuration;
        uint256 epochStartTime;
        uint256 epochOneTotalPool;
        bool epochOneResolved;
        uint256 rollover;
        uint256 dailyPool;
        uint256 weeklyPool;
        uint256 ownerFees;
        uint256 burnFees;
        uint256 pendingDuration;
        uint256 pendingDurationEta;
        uint256 pendingDurationEpoch;
        address pendingRecipient;
        uint256 pendingRecipientEta;
    }

    struct AdminSnapshot {
        address ownerBefore;
        address ownerAfter;
        address pendingOwnerDuring;
        address pendingOwnerAfterCancel;
        uint256 pendingDurationDuring;
        uint256 pendingDurationEtaDuring;
        uint256 pendingDurationEpochDuring;
        uint256 pendingDurationAfterCancel;
        address pendingRecipientDuring;
        uint256 pendingRecipientEtaDuring;
        address pendingRecipientAfterCancel;
        bool lowDurationRejected;
        bool highDurationRejected;
        bool zeroRecipientRejected;
        bool selfRecipientRejected;
        bool renounceRejected;
    }

    struct AdminApplySnapshot {
        uint256 currentEpoch;
        uint256 epochDuration;
        address feeRecipient;
        uint256 pendingDuration;
        uint256 pendingDurationEta;
        uint256 pendingDurationEpoch;
        address pendingRecipient;
        uint256 pendingRecipientEta;
    }

    function betTwice(address gameAddress, uint32 tileMask, uint256 amount)
        external
        returns (BetSnapshot memory snapshot)
    {
        IGame game = IGame(gameAddress);
        uint256 startEpoch = game.currentEpoch();
        game.placeBatchBetsBitmap(tileMask, amount);
        game.placeBatchBetsBitmap(tileMask, amount);
        return _snapshotBet(game, startEpoch);
    }

    function rejectThenBetAndSnapshot(address gameAddress, uint32 tileMask, uint256 amount)
        external
        returns (BetSnapshot memory snapshot)
    {
        IGame game = IGame(gameAddress);
        uint256 startEpoch = game.currentEpoch();
        (bool invalidSucceeded, ) = gameAddress.call(
            abi.encodeCall(IGame.placeBatchBetsBitmap, (uint32(0), amount))
        );
        if (invalidSucceeded) revert();
        game.placeBatchBetsBitmap(tileMask, amount);
        return _snapshotBet(game, startEpoch);
    }

    function betOnceByMode(
        address gameAddress,
        uint8 mode,
        uint256 expectedEpoch,
        uint32 tileMask,
        uint256 amount
    ) external returns (BetSnapshot memory snapshot) {
        IGame game = IGame(gameAddress);
        uint256 startEpoch = game.currentEpoch();
        (bool succeeded, bytes memory returnData) = gameAddress.call(
            _betData(mode, expectedEpoch, tileMask, amount)
        );
        if (!succeeded) {
            assembly ("memory-safe") {
                revert(add(returnData, 0x20), mload(returnData))
            }
        }
        return _snapshotBet(game, startEpoch);
    }

    function rejectBetByModeAndSnapshot(
        address gameAddress,
        uint8 mode,
        uint256 expectedEpoch,
        uint32 tileMask,
        uint256 amount
    ) external returns (BetSnapshot memory snapshot) {
        IGame game = IGame(gameAddress);
        uint256 startEpoch = game.currentEpoch();
        (bool succeeded, ) = gameAddress.call(_betData(mode, expectedEpoch, tileMask, amount));
        if (succeeded) revert();
        return _snapshotBet(game, startEpoch);
    }

    function _betData(uint8 mode, uint256 expectedEpoch, uint32 tileMask, uint256 amount)
        private
        pure
        returns (bytes memory)
    {
        if (mode == 0) return abi.encodeCall(IGame.placeBet, (1, amount));
        if (mode == 3) return abi.encodeCall(IGame.placeBatchBetsBitmap, (tileMask, amount));
        if (mode == 4) {
            return abi.encodeCall(IGame.placeBatchBetsBitmapForEpoch, (expectedEpoch, tileMask, amount));
        }

        uint256[] memory tileIds = new uint256[](3);
        tileIds[0] = 1;
        tileIds[1] = 13;
        tileIds[2] = 25;
        if (mode == 1) {
            uint256[] memory amounts = new uint256[](3);
            amounts[0] = amount;
            amounts[1] = amount * 2;
            amounts[2] = amount * 3;
            return abi.encodeCall(IGame.placeBatchBets, (tileIds, amounts));
        }
        if (mode == 2) return abi.encodeCall(IGame.placeBatchBetsSameAmount, (tileIds, amount));
        revert();
    }

    function deployAndSnapshot(
        bytes calldata creationCode,
        address tokenAddress,
        address initialOwner,
        address initialFeeRecipient
    ) external returns (DeploymentSnapshot memory snapshot) {
        bytes memory initCode = abi.encodePacked(
            creationCode,
            abi.encode(tokenAddress, initialOwner, initialFeeRecipient)
        );
        address deployed;
        assembly ("memory-safe") {
            deployed := create(0, add(initCode, 0x20), mload(initCode))
        }
        if (deployed == address(0)) revert();

        IGame game = IGame(deployed);
        snapshot.runtimeCodeHash = deployed.codehash;
        snapshot.runtimeCodeLength = deployed.code.length;
        snapshot.tokenAddress = game.token();
        snapshot.owner = game.owner();
        snapshot.pendingOwner = game.pendingOwner();
        snapshot.feeRecipient = game.feeRecipient();
        snapshot.currentEpoch = game.currentEpoch();
        snapshot.epochDuration = game.epochDuration();
        snapshot.epochStartTime = game.epochStartTime();
        (snapshot.epochOneTotalPool, , , snapshot.epochOneResolved, , ) = game.epochs(1);
        snapshot.rollover = game.rolloverPool();
        snapshot.dailyPool = game.dailyJackpotPool();
        snapshot.weeklyPool = game.weeklyJackpotPool();
        snapshot.ownerFees = game.accruedOwnerFees();
        snapshot.burnFees = game.accruedBurnFees();
        snapshot.pendingDuration = game.pendingEpochDuration();
        snapshot.pendingDurationEta = game.pendingEpochDurationEta();
        snapshot.pendingDurationEpoch = game.pendingEpochDurationEffectiveFromEpoch();
        snapshot.pendingRecipient = game.pendingFeeRecipient();
        snapshot.pendingRecipientEta = game.pendingFeeRecipientEta();
    }

    function betTwiceForEpoch(address gameAddress, uint256 expectedEpoch, uint32 tileMask, uint256 amount)
        external
        returns (BetSnapshot memory snapshot)
    {
        IGame game = IGame(gameAddress);
        uint256 startEpoch = game.currentEpoch();
        game.placeBatchBetsBitmapForEpoch(expectedEpoch, tileMask, amount);
        game.placeBatchBetsBitmapForEpoch(expectedEpoch, tileMask, amount);
        return _snapshotBet(game, startEpoch);
    }

    function betAfterExpiredEmptyEpoch(address gameAddress, uint256 expectedEpoch, uint32 tileMask, uint256 amount)
        external
        returns (BetSnapshot memory snapshot)
    {
        IGame game = IGame(gameAddress);
        uint256 startEpoch = game.currentEpoch();
        game.placeBatchBetsBitmapForEpoch(expectedEpoch, tileMask, amount);
        (bool staleRetrySucceeded, ) = gameAddress.call(
            abi.encodeCall(IGame.placeBatchBetsBitmapForEpoch, (expectedEpoch, tileMask, amount))
        );
        if (staleRetrySucceeded) revert();
        return _snapshotBet(game, startEpoch);
    }

    function _snapshotBet(IGame game, uint256 startEpoch)
        private
        view
        returns (BetSnapshot memory snapshot)
    {
        snapshot.startEpoch = startEpoch;
        snapshot.currentEpoch = game.currentEpoch();
        (
            snapshot.totalPool,
            snapshot.rewardPool,
            snapshot.winningTile,
            snapshot.resolved,
            ,

        ) = game.epochs(snapshot.currentEpoch);
        (, , , snapshot.startEpochResolved, , ) = game.epochs(startEpoch);
        (snapshot.pools, snapshot.users) = game.getTileData(snapshot.currentEpoch);
        snapshot.bets = game.getUserBetsAll(snapshot.currentEpoch, address(this));
        snapshot.userVolume = game.userEpochVolumes(snapshot.currentEpoch, address(this));
    }

    function resolveAndSnapshot(address gameAddress, uint256 epoch)
        external
        returns (ResolveSnapshot memory snapshot)
    {
        IGame game = IGame(gameAddress);
        game.resolveEpoch(epoch);
        snapshot.currentEpoch = game.currentEpoch();
        (
            snapshot.totalPool,
            snapshot.rewardPool,
            snapshot.winningTile,
            snapshot.resolved,
            snapshot.dailyJackpot,
            snapshot.weeklyJackpot
        ) = game.epochs(epoch);
        snapshot.rollover = game.rolloverPool();
        snapshot.dailyPool = game.dailyJackpotPool();
        snapshot.weeklyPool = game.weeklyJackpotPool();
        snapshot.ownerFees = game.accruedOwnerFees();
        snapshot.burnFees = game.accruedBurnFees();
        snapshot.resolverRewards = game.pendingResolverRewards(address(this));
        snapshot.rebatePool = game.epochRebatePool(epoch);
        snapshot.resolvedAt = game.epochResolvedAt(epoch);
        snapshot.lastDailyDay = game.lastDailyJackpotDay();
        snapshot.lastWeeklyWeek = game.lastWeeklyJackpotWeek();
        snapshot.lastDailyEpoch = game.lastDailyJackpotEpoch();
        snapshot.lastWeeklyEpoch = game.lastWeeklyJackpotEpoch();
        snapshot.lastDailyAmount = game.lastDailyJackpotAmount();
        snapshot.lastWeeklyAmount = game.lastWeeklyJackpotAmount();
        snapshot.lastDailyCheckTs = game.lastDailyJackpotCheckTs();
        snapshot.lastWeeklyCheckTs = game.lastWeeklyJackpotCheckTs();
    }

    function mutateAndSnapshot(address gameAddress, uint8 mode, uint256 epoch)
        external
        returns (MutationSnapshot memory snapshot)
    {
        IGame game = IGame(gameAddress);
        bytes memory mutationData = _mutationData(mode, epoch);
        (bool firstSucceeded, ) = gameAddress.call(mutationData);
        if (!firstSucceeded) revert();
        (bool duplicateSucceeded, ) = gameAddress.call(mutationData);
        if (duplicateSucceeded) revert();
        snapshot = _mutationSnapshot(game, epoch);
        snapshot.duplicateRejected = true;
    }

    function rejectMutationAndSnapshot(address gameAddress, uint8 mode, uint256 epoch)
        external
        returns (RollbackSnapshot memory snapshot)
    {
        IGame game = IGame(gameAddress);
        (bool succeeded, ) = gameAddress.call(_mutationData(mode, epoch));
        if (succeeded) revert();
        snapshot = _rollbackSnapshot(game, epoch);
        snapshot.rejected = true;
    }

    function mutateBatchAndSnapshot(address gameAddress, uint8 mode, uint256[] calldata epochs_)
        external
        returns (MutationSnapshot memory snapshot)
    {
        if (epochs_.length == 0) revert();
        IGame game = IGame(gameAddress);
        bytes memory mutationData = _batchMutationData(mode, epochs_);
        (bool firstSucceeded, ) = gameAddress.call(mutationData);
        if (!firstSucceeded) revert();
        (bool duplicateSucceeded, ) = gameAddress.call(mutationData);
        if (duplicateSucceeded) revert();
        snapshot = _mutationSnapshot(game, epochs_[0]);
        snapshot.duplicateRejected = true;
    }

    function rejectBatchMutationAndSnapshot(address gameAddress, uint8 mode, uint256[] calldata epochs_)
        external
        returns (RollbackSnapshot memory snapshot)
    {
        if (epochs_.length == 0) revert();
        IGame game = IGame(gameAddress);
        (bool succeeded, ) = gameAddress.call(_batchMutationData(mode, epochs_));
        if (succeeded) revert();
        snapshot = _rollbackSnapshot(game, epochs_[0]);
        snapshot.rejected = true;
    }

    function rejectBetAndSnapshot(address gameAddress, uint32 tileMask, uint256 amount)
        external
        returns (BetSnapshot memory snapshot)
    {
        IGame game = IGame(gameAddress);
        uint256 startEpoch = game.currentEpoch();
        (bool succeeded, ) = gameAddress.call(
            abi.encodeCall(IGame.placeBatchBetsBitmap, (tileMask, amount))
        );
        if (succeeded) revert();
        return _snapshotBet(game, startEpoch);
    }

    function acceptOwnershipAndSnapshot(address gameAddress, address nextOwner)
        external
        returns (OwnershipSnapshot memory snapshot)
    {
        IGame game = IGame(gameAddress);
        game.acceptOwnership();
        snapshot.ownerAfterAccept = game.owner();
        snapshot.pendingOwnerAfterAccept = game.pendingOwner();
        game.transferOwnership(nextOwner);
        snapshot.pendingOwnerAfterTransfer = game.pendingOwner();
    }

    function probeUnauthorizedAdmin(address gameAddress, address nextOwner, address nextRecipient)
        external
        returns (bool allRejected)
    {
        (bool transferSucceeded, ) = gameAddress.call(
            abi.encodeCall(IGame.transferOwnership, (nextOwner))
        );
        (bool durationSucceeded, ) = gameAddress.call(
            abi.encodeCall(IGame.scheduleEpochDuration, (120))
        );
        (bool durationCancelSucceeded, ) = gameAddress.call(
            abi.encodeCall(IGame.cancelEpochDurationChange, ())
        );
        (bool recipientSucceeded, ) = gameAddress.call(
            abi.encodeCall(IGame.scheduleFeeRecipientChange, (nextRecipient))
        );
        (bool recipientCancelSucceeded, ) = gameAddress.call(
            abi.encodeCall(IGame.cancelFeeRecipientChange, ())
        );
        (bool renounceSucceeded, ) = gameAddress.call(
            abi.encodeCall(IGame.renounceOwnership, ())
        );
        if (
            transferSucceeded || durationSucceeded || durationCancelSucceeded ||
            recipientSucceeded || recipientCancelSucceeded || renounceSucceeded
        ) revert();
        return true;
    }

    function _mutationData(uint8 mode, uint256 epoch) private pure returns (bytes memory mutationData) {
        if (mode == 0) return abi.encodeWithSelector(IGame.claimReward.selector, epoch);
        if (mode == 1) return abi.encodeWithSelector(IGame.claimEpochRebate.selector, epoch);
        if (mode == 2) return abi.encodeWithSelector(IGame.settleEpochDust.selector, epoch);
        if (mode == 3) return abi.encodeWithSelector(IGame.settleEpochRebateDust.selector, epoch);
        if (mode == 4) return abi.encodeWithSelector(IGame.claimResolverRewards.selector);
        if (mode == 5) return abi.encodeWithSelector(IGame.flushProtocolFees.selector);
        revert();
    }

    function _batchMutationData(uint8 mode, uint256[] calldata epochs_)
        private
        pure
        returns (bytes memory mutationData)
    {
        if (mode == 0) return abi.encodeWithSelector(IGame.claimRewards.selector, epochs_);
        if (mode == 1) return abi.encodeWithSelector(IGame.claimEpochsRebate.selector, epochs_);
        if (mode == 2) return abi.encodeWithSelector(IGame.settleEpochsDust.selector, epochs_);
        if (mode == 3) return abi.encodeWithSelector(IGame.settleEpochsRebateDust.selector, epochs_);
        revert();
    }

    function _mutationSnapshot(IGame game, uint256 epoch)
        private
        view
        returns (MutationSnapshot memory snapshot)
    {
        snapshot.rewardClaimedByCaller = game.hasClaimed(address(this), epoch);
        snapshot.rebateClaimedByCaller = game.rebateClaimed(epoch, address(this));
        snapshot.rewardDustSettled = game.epochDustSettled(epoch);
        snapshot.rewardClaimedTotal = game.epochRewardClaimed(epoch);
        snapshot.rebateClaimedTotal = game.epochRebateClaimed(epoch);
        snapshot.resolverRewards = game.pendingResolverRewards(address(this));
        snapshot.ownerFees = game.accruedOwnerFees();
        snapshot.burnFees = game.accruedBurnFees();
        snapshot.userVolume = game.userEpochVolumes(epoch, address(this));
    }

    function _rollbackSnapshot(IGame game, uint256 epoch)
        private
        view
        returns (RollbackSnapshot memory snapshot)
    {
        snapshot.rewardClaimedByCaller = game.hasClaimed(address(this), epoch);
        snapshot.rebateClaimedByCaller = game.rebateClaimed(epoch, address(this));
        snapshot.rewardDustSettled = game.epochDustSettled(epoch);
        snapshot.rewardClaimedTotal = game.epochRewardClaimed(epoch);
        snapshot.rebateClaimedTotal = game.epochRebateClaimed(epoch);
        snapshot.resolverRewards = game.pendingResolverRewards(address(this));
        snapshot.ownerFees = game.accruedOwnerFees();
        snapshot.burnFees = game.accruedBurnFees();
        snapshot.feeRecipient = game.feeRecipient();
        snapshot.pendingFeeRecipient = game.pendingFeeRecipient();
        snapshot.pendingFeeRecipientEta = game.pendingFeeRecipientEta();
    }

    function exerciseAdminControls(address gameAddress, address nextOwner, address nextRecipient)
        external
        returns (AdminSnapshot memory snapshot)
    {
        IGame game = IGame(gameAddress);
        snapshot.ownerBefore = game.owner();

        game.transferOwnership(nextOwner);
        snapshot.pendingOwnerDuring = game.pendingOwner();
        game.transferOwnership(address(0));
        snapshot.pendingOwnerAfterCancel = game.pendingOwner();

        game.scheduleEpochDuration(120);
        snapshot.pendingDurationDuring = game.pendingEpochDuration();
        snapshot.pendingDurationEtaDuring = game.pendingEpochDurationEta();
        snapshot.pendingDurationEpochDuring = game.pendingEpochDurationEffectiveFromEpoch();
        game.cancelEpochDurationChange();
        snapshot.pendingDurationAfterCancel = game.pendingEpochDuration();

        game.scheduleFeeRecipientChange(nextRecipient);
        snapshot.pendingRecipientDuring = game.pendingFeeRecipient();
        snapshot.pendingRecipientEtaDuring = game.pendingFeeRecipientEta();
        game.cancelFeeRecipientChange();
        snapshot.pendingRecipientAfterCancel = game.pendingFeeRecipient();

        (bool lowDurationSucceeded, ) = gameAddress.call(
            abi.encodeCall(IGame.scheduleEpochDuration, (14))
        );
        (bool highDurationSucceeded, ) = gameAddress.call(
            abi.encodeCall(IGame.scheduleEpochDuration, (3601))
        );
        (bool zeroRecipientSucceeded, ) = gameAddress.call(
            abi.encodeCall(IGame.scheduleFeeRecipientChange, (address(0)))
        );
        (bool selfRecipientSucceeded, ) = gameAddress.call(
            abi.encodeCall(IGame.scheduleFeeRecipientChange, (gameAddress))
        );
        (bool renounceSucceeded, ) = gameAddress.call(
            abi.encodeCall(IGame.renounceOwnership, ())
        );
        if (lowDurationSucceeded || highDurationSucceeded || zeroRecipientSucceeded || renounceSucceeded) revert();

        snapshot.lowDurationRejected = true;
        snapshot.highDurationRejected = true;
        snapshot.zeroRecipientRejected = true;
        snapshot.selfRecipientRejected = !selfRecipientSucceeded;
        snapshot.renounceRejected = true;
        snapshot.ownerAfter = game.owner();
    }

    function resolveAndSnapshotAdmin(address gameAddress, uint256 epoch)
        external
        returns (AdminApplySnapshot memory snapshot)
    {
        IGame game = IGame(gameAddress);
        game.resolveEpoch(epoch);
        snapshot.currentEpoch = game.currentEpoch();
        snapshot.epochDuration = game.epochDuration();
        snapshot.feeRecipient = game.feeRecipient();
        snapshot.pendingDuration = game.pendingEpochDuration();
        snapshot.pendingDurationEta = game.pendingEpochDurationEta();
        snapshot.pendingDurationEpoch = game.pendingEpochDurationEffectiveFromEpoch();
        snapshot.pendingRecipient = game.pendingFeeRecipient();
        snapshot.pendingRecipientEta = game.pendingFeeRecipientEta();
    }
}
`;

type StorageEntry = { label: string; slot: string; offset: number; type: string };
type CompiledContract = {
  name: string;
  abi: Abi;
  creationCode: Hex;
  runtimeCode: Hex;
  storage: StorageEntry[];
};
type DiagnosticContracts = {
  harnessAbi: Abi;
  harnessRuntime: Hex;
  rejectingTokenRuntime: Hex;
  standardTokenRuntime: Hex;
  reentrancyTokenRuntime: Hex;
};
type EstimateResult = {
  baseFeePerGas: Hex;
  gasLimit: Hex;
  priorityFeePerGas: Hex;
};

function readImport(importPath: string) {
  for (const candidate of [path.resolve(importPath), path.resolve("node_modules", importPath)]) {
    try {
      return {
        contents: readBoundedUtf8File(candidate, MAX_BENCHMARK_SOURCE_BYTES, `Solidity import ${importPath}`),
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") throw error;
      // Try the next deterministic local import root.
    }
  }
  return { error: `Import not found: ${importPath}` };
}

function patchImmutableAddress(bytecode: string, references: unknown, address: Address) {
  let patched = bytecode;
  const allReferences = Object.values((references ?? {}) as Record<string, Array<{ length: number; start: number }>>)
    .flat();
  if (allReferences.length === 0) throw new Error("Compiled runtime is missing the token immutable reference");
  for (const reference of allReferences) {
    const replacement = address.slice(2).padStart(reference.length * 2, "0");
    const start = reference.start * 2;
    patched = `${patched.slice(0, start)}${replacement}${patched.slice(start + reference.length * 2)}`;
  }
  return `0x${patched}` as Hex;
}

function compileContract(
  contractPath: string,
  contractName: string,
  token: Address,
  optimizerRuns: number,
  viaIR: boolean,
  compiler = solc,
  automaticFeeFlush = V10_WITH_AUTO_FLUSH,
  duplicateExternalResolveGuard = false,
): CompiledContract {
  let source = readBoundedUtf8File(
    contractPath,
    MAX_BENCHMARK_SOURCE_BYTES,
    `contract source ${contractPath}`,
  ).replace(/\r\n?/g, "\n");
  if (contractName === "LineaOreV10" && automaticFeeFlush) {
    const flushAnchor = `        _storeEpochClock(clock.duration, L.epoch + 1, block.timestamp);
        _applyPendingEpochDurationIfReady();
        _applyPendingFeeRecipientIfReady();
`;
    const automaticFlushBlock = `        if (L.epoch % FEE_FLUSH_INTERVAL_EPOCHS == 0) {
            _flushProtocolFees();
        }
`;
    assert.equal(source.split(flushAnchor).length, 2, "V10 automatic-flush experiment anchor drifted");
    source = source.replace(flushAnchor, `${flushAnchor}${automaticFlushBlock}`);
  }
  if (contractName === "LineaOreV10" && duplicateExternalResolveGuard) {
    const optimizedResolveBlock = `    function resolveEpoch(uint256 epoch) external nonReentrant {
        EpochClock memory clock = _loadEpochClock();
        if (epoch != clock.epoch) revert CanOnlyResolveCurrent();
        if (block.timestamp < clock.startTime + clock.duration) revert TimerNotEnded();
        _resolveCurrentEpoch(clock);
    }
`;
    const duplicateGuardBlock = optimizedResolveBlock.replace(
      "        _resolveCurrentEpoch(clock);",
      "        if (_isResolved(_epochs[epoch])) revert AlreadyResolved();\n        _resolveCurrentEpoch(clock);",
    );
    assert.equal(source.split(optimizedResolveBlock).length, 2, "V10 resolve-guard experiment source drifted");
    source = source.replace(optimizedResolveBlock, duplicateGuardBlock);
  }
  const input = {
    language: "Solidity",
    sources: { [contractPath]: { content: source } },
    settings: {
      optimizer: { enabled: true, runs: optimizerRuns },
      viaIR,
      evmVersion: "osaka",
      outputSelection: {
        "*": {
          "*": [
            "abi",
            "storageLayout",
            "evm.bytecode.object",
            "evm.deployedBytecode.object",
            "evm.deployedBytecode.immutableReferences",
          ],
        },
      },
    },
  };
  const output = JSON.parse(compiler.compile(JSON.stringify(input), { import: readImport }));
  const errors = (output.errors ?? []).filter((entry: { severity: string }) => entry.severity === "error");
  if (errors.length > 0) {
    throw new Error(errors.map((entry: { message: string }) => entry.message).join(" | "));
  }
  const compiled = output.contracts?.[contractPath]?.[contractName];
  if (!compiled) throw new Error(`Missing compiler output for ${contractName}`);
  return {
    name: contractName,
    abi: compiled.abi as Abi,
    creationCode: `0x${compiled.evm.bytecode.object}` as Hex,
    runtimeCode: patchImmutableAddress(
      compiled.evm.deployedBytecode.object,
      compiled.evm.deployedBytecode.immutableReferences,
      token,
    ),
    storage: compiled.storageLayout.storage,
  };
}

function compileDiagnosticContracts(): DiagnosticContracts {
  const input = {
    language: "Solidity",
    sources: { "Diagnostic.sol": { content: DIAGNOSTIC_SOURCE } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "osaka",
      outputSelection: { "*": { "*": ["abi", "evm.deployedBytecode.object"] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors ?? []).filter((entry: { severity: string }) => entry.severity === "error");
  if (errors.length > 0) throw new Error(errors.map((entry: { message: string }) => entry.message).join(" | "));
  const harness = output.contracts?.["Diagnostic.sol"]?.StateHarness;
  const rejectingToken = output.contracts?.["Diagnostic.sol"]?.RejectingTransferToken;
  const standardToken = output.contracts?.["Diagnostic.sol"]?.StandardTransferToken;
  const token = output.contracts?.["Diagnostic.sol"]?.ReentrancyProbeToken;
  if (!harness || !rejectingToken || !standardToken || !token) {
    throw new Error("Missing diagnostic compiler output");
  }
  return {
    harnessAbi: harness.abi as Abi,
    harnessRuntime: `0x${harness.evm.deployedBytecode.object}` as Hex,
    rejectingTokenRuntime: `0x${rejectingToken.evm.deployedBytecode.object}` as Hex,
    standardTokenRuntime: `0x${standardToken.evm.deployedBytecode.object}` as Hex,
    reentrancyTokenRuntime: `0x${token.evm.deployedBytecode.object}` as Hex,
  };
}

function storageSlotNumber(contract: CompiledContract, label: string) {
  const entry = contract.storage.find((candidate) => candidate.label === label);
  if (!entry) throw new Error(`${contract.name} storage layout is missing ${label}`);
  return BigInt(entry.slot);
}

function storageSlot(contract: CompiledContract, label: string) {
  return toHex(storageSlotNumber(contract, label), { size: 32 });
}

function storageValue(value: bigint) {
  return toHex(value, { size: 32 });
}

function dayStart(timestamp: bigint) {
  return (timestamp / DAY_SECONDS) * DAY_SECONDS;
}

function mondayWeek(timestamp: bigint) {
  return (timestamp + MONDAY_OFFSET_SECONDS) / WEEK_SECONDS;
}

function weekStartMonday(timestamp: bigint) {
  const week = mondayWeek(timestamp);
  return week === 0n ? 0n : week * WEEK_SECONDS - MONDAY_OFFSET_SECONDS;
}

function findJackpotAwardEpoch({
  kind,
  prevrandao,
  timestamp,
  lastCheck,
  periodEnd,
}: {
  kind: "daily" | "weekly";
  prevrandao: bigint;
  timestamp: bigint;
  lastCheck: bigint;
  periodEnd: bigint;
}) {
  const elapsed = timestamp - lastCheck;
  const remaining = periodEnd - lastCheck;
  assert.ok(elapsed > 0n && remaining > elapsed, `${kind} jackpot test needs an open non-zero period`);
  for (let offset = 1n; offset <= 1_000_000n; offset += 1n) {
    const epoch = SYNTHETIC_EPOCH + 10_000n + offset;
    if (epoch % FEE_FLUSH_INTERVAL_EPOCHS === 0n) continue;
    const random = BigInt(keccak256(encodePacked(
      ["uint256", "string", "uint256", "uint256", "uint256"],
      [prevrandao, kind, epoch, lastCheck, timestamp],
    ))) % remaining;
    if (random < elapsed) return epoch;
  }
  throw new Error(`Unable to derive deterministic ${kind} jackpot epoch`);
}

function findJackpotNoAwardEpoch(prevrandao: bigint, timestamp: bigint, lastCheck: bigint) {
  const dailyRemaining = dayStart(timestamp) + DAY_SECONDS - lastCheck;
  const weeklyRemaining = weekStartMonday(timestamp) + WEEK_SECONDS - lastCheck;
  const elapsed = timestamp - lastCheck;
  assert.ok(elapsed > 0n && dailyRemaining > elapsed && weeklyRemaining > elapsed);
  for (let offset = 1n; offset <= 10_000n; offset += 1n) {
    const epoch = SYNTHETIC_EPOCH + 2_000_000n + offset;
    if (epoch % FEE_FLUSH_INTERVAL_EPOCHS === 0n) continue;
    const dailyRandom = BigInt(keccak256(encodePacked(
      ["uint256", "string", "uint256", "uint256", "uint256"],
      [prevrandao, "daily", epoch, lastCheck, timestamp],
    ))) % dailyRemaining;
    const weeklyRandom = BigInt(keccak256(encodePacked(
      ["uint256", "string", "uint256", "uint256", "uint256"],
      [prevrandao, "weekly", epoch, lastCheck, timestamp],
    ))) % weeklyRemaining;
    if (dailyRandom >= elapsed && weeklyRandom >= elapsed) return epoch;
  }
  throw new Error("Unable to derive a deterministic non-awarding jackpot-check epoch");
}

function buildClockStateDiff(
  contract: CompiledContract,
  timestamp: bigint,
  epoch = SYNTHETIC_EPOCH,
) {
  const labels = new Set(contract.storage.map(({ label }) => label));
  const guardState = contract.name === "LineaOreV9"
    ? { [REENTRANCY_GUARD_STORAGE_SLOT]: storageValue(1n) }
    : {};
  if (labels.has("_epochClockData")) {
    const packed =
      SYNTHETIC_DURATION |
      (epoch << 32n) |
      (timestamp << 128n);
    return { ...guardState, [storageSlot(contract, "_epochClockData")]: storageValue(packed) };
  }
  return {
    ...guardState,
    [storageSlot(contract, "epochDuration")]: storageValue(SYNTHETIC_DURATION),
    [storageSlot(contract, "currentEpoch")]: storageValue(epoch),
    [storageSlot(contract, "epochStartTime")]: storageValue(timestamp),
  };
}

function mappingEntrySlot(keyType: "address" | "uint256", key: Address | bigint, parentSlot: bigint) {
  return BigInt(keccak256(encodeAbiParameters(
    [{ type: keyType }, { type: "uint256" }],
    [key, parentSlot],
  )));
}

function buildUserVolumeOverflowState(
  contract: CompiledContract,
  timestamp: bigint,
  user: Address,
) {
  const stateDiff: Record<Hex, Hex> = buildClockStateDiff(contract, timestamp);
  const mappingLabel = contract.name === "LineaOreV10" ? "_userEpochRebateData" : "userEpochVolumes";
  const epochSlot = mappingEntrySlot("uint256", SYNTHETIC_EPOCH, storageSlotNumber(contract, mappingLabel));
  const userSlot = mappingEntrySlot("address", user, epochSlot);
  const maxVolume = contract.name === "LineaOreV10" ? (1n << 255n) - 1n : (1n << 256n) - 1n;
  stateDiff[toHex(userSlot, { size: 32 })] = storageValue(maxVolume);
  return stateDiff;
}

function setDirectStorage(
  stateDiff: Record<Hex, Hex>,
  contract: CompiledContract,
  label: string,
  value: bigint,
) {
  if (contract.storage.some((entry) => entry.label === label)) {
    stateDiff[storageSlot(contract, label)] = storageValue(value);
  }
}

function setJackpotCheckTimestamps(
  stateDiff: Record<Hex, Hex>,
  contract: CompiledContract,
  dailyCheck: bigint,
  weeklyCheck: bigint,
) {
  if (contract.storage.some((entry) => entry.label === "_jackpotCheckTimestamps")) {
    const maxTimestamp = (1n << 128n) - 1n;
    assert.ok(dailyCheck <= maxTimestamp && weeklyCheck <= maxTimestamp);
    setDirectStorage(stateDiff, contract, "_jackpotCheckTimestamps", dailyCheck | (weeklyCheck << 128n));
    return;
  }
  setDirectStorage(stateDiff, contract, "lastDailyJackpotCheckTs", dailyCheck);
  setDirectStorage(stateDiff, contract, "lastWeeklyJackpotCheckTs", weeklyCheck);
}

function setJackpotAwardMetadata(
  stateDiff: Record<Hex, Hex>,
  contract: CompiledContract,
  kind: "daily" | "weekly",
  period: bigint,
  epoch = 0n,
) {
  const packedLabel = kind === "daily" ? "_lastDailyJackpotData" : "_lastWeeklyJackpotData";
  if (contract.storage.some((entry) => entry.label === packedLabel)) {
    assert.ok(period <= (1n << 128n) - 1n && epoch <= (1n << 96n) - 1n);
    setDirectStorage(stateDiff, contract, packedLabel, period | (epoch << 128n));
    return;
  }
  setDirectStorage(
    stateDiff,
    contract,
    kind === "daily" ? "lastDailyJackpotDay" : "lastWeeklyJackpotWeek",
    period,
  );
  setDirectStorage(
    stateDiff,
    contract,
    kind === "daily" ? "lastDailyJackpotEpoch" : "lastWeeklyJackpotEpoch",
    epoch,
  );
}

function buildResolveStateDiff(
  contract: CompiledContract,
  timestamp: bigint,
  scenario: "empty" | "empty-with-rollover" | "funded-no-winner" | "winner-25-funded-tiles",
  epoch = SYNTHETIC_EPOCH,
) {
  const stateDiff: Record<Hex, Hex> = buildClockStateDiff(
    contract,
    timestamp - SYNTHETIC_DURATION - 1n,
    epoch,
  );
  for (const label of [
    "rolloverPool",
    "dailyJackpotPool",
    "weeklyJackpotPool",
    "accruedOwnerFees",
    "accruedBurnFees",
    "pendingEpochDuration",
    "pendingEpochDurationEta",
    "pendingEpochDurationEffectiveFromEpoch",
    "pendingFeeRecipient",
    "pendingFeeRecipientEta",
  ]) {
    setDirectStorage(stateDiff, contract, label, 0n);
  }
  setJackpotAwardMetadata(stateDiff, contract, "daily", timestamp / 86_400n);
  setJackpotAwardMetadata(stateDiff, contract, "weekly", (timestamp + 259_200n) / 604_800n);
  if (scenario === "empty") return stateDiff;
  if (scenario === "empty-with-rollover") {
    setDirectStorage(stateDiff, contract, "rolloverPool", BET_AMOUNT * 7n);
    return stateDiff;
  }

  const epochMappingLabel = contract.storage.some(({ label }) => label === "_epochs") ? "_epochs" : "epochs";
  const epochBase = mappingEntrySlot("uint256", epoch, storageSlotNumber(contract, epochMappingLabel));
  const tilePoolsBase = storageSlotNumber(contract, "tilePools");
  const totalPool = BET_AMOUNT * 25n;
  stateDiff[toHex(epochBase, { size: 32 })] = storageValue(totalPool);
  if (scenario === "funded-no-winner") return stateDiff;
  const epochTileBase = mappingEntrySlot("uint256", epoch, tilePoolsBase);
  for (let tile = 1n; tile <= 25n; tile += 1n) {
    const tileSlot = mappingEntrySlot("uint256", tile, epochTileBase);
    stateDiff[toHex(tileSlot, { size: 32 })] = storageValue(BET_AMOUNT);
  }
  return stateDiff;
}

function buildJackpotResolveStateDiff(
  contract: CompiledContract,
  timestamp: bigint,
  kind: "daily" | "weekly",
  epoch: bigint,
) {
  const stateDiff = buildResolveStateDiff(contract, timestamp, "winner-25-funded-tiles", epoch);
  let dailyCheck = 0n;
  let weeklyCheck = 0n;
  if (kind === "daily") {
    const today = timestamp / DAY_SECONDS;
    setDirectStorage(stateDiff, contract, "dailyJackpotPool", BET_AMOUNT * 7n);
    setJackpotAwardMetadata(stateDiff, contract, "daily", today - 1n);
    dailyCheck = dayStart(timestamp);
  } else {
    const week = mondayWeek(timestamp);
    setDirectStorage(stateDiff, contract, "weeklyJackpotPool", BET_AMOUNT * 11n);
    setJackpotAwardMetadata(stateDiff, contract, "weekly", week - 1n);
    weeklyCheck = weekStartMonday(timestamp);
  }
  setJackpotCheckTimestamps(stateDiff, contract, dailyCheck, weeklyCheck);
  return stateDiff;
}

function buildJackpotCheckResolveStateDiff(
  contract: CompiledContract,
  timestamp: bigint,
  epoch: bigint,
) {
  const stateDiff = buildResolveStateDiff(contract, timestamp, "winner-25-funded-tiles", epoch);
  setJackpotAwardMetadata(stateDiff, contract, "daily", timestamp / DAY_SECONDS - 1n);
  setJackpotAwardMetadata(stateDiff, contract, "weekly", mondayWeek(timestamp) - 1n);
  setJackpotCheckTimestamps(stateDiff, contract, timestamp - 1n, timestamp - 1n);
  return stateDiff;
}

function setMappingValue(
  stateDiff: Record<Hex, Hex>,
  contract: CompiledContract,
  label: string,
  keys: Array<{ type: "address" | "uint256"; value: Address | bigint }>,
  value: bigint,
) {
  let slot = storageSlotNumber(contract, label);
  for (const key of keys) slot = mappingEntrySlot(key.type, key.value, slot);
  stateDiff[toHex(slot, { size: 32 })] = storageValue(value);
}

function setResolvedEpoch(
  stateDiff: Record<Hex, Hex>,
  contract: CompiledContract,
  {
    epoch,
    totalPool,
    rewardPool,
    winningTile,
    resolvedAt,
  }: {
    epoch: bigint;
    totalPool: bigint;
    rewardPool: bigint;
    winningTile: bigint;
    resolvedAt: bigint;
  },
) {
  const isV10 = contract.storage.some(({ label }) => label === "_epochs");
  const epochMappingLabel = isV10 ? "_epochs" : "epochs";
  const epochBase = mappingEntrySlot("uint256", epoch, storageSlotNumber(contract, epochMappingLabel));
  stateDiff[toHex(epochBase, { size: 32 })] = storageValue(totalPool);
  stateDiff[toHex(epochBase + 1n, { size: 32 })] = storageValue(rewardPool);
  if (isV10) {
    stateDiff[toHex(epochBase + 2n, { size: 32 })] = storageValue(resolvedAt | (winningTile << 128n));
    return;
  }
  stateDiff[toHex(epochBase + 2n, { size: 32 })] = storageValue(winningTile);
  stateDiff[toHex(epochBase + 3n, { size: 32 })] = storageValue(1n);
  setMappingValue(stateDiff, contract, "epochResolvedAt", [{ type: "uint256", value: epoch }], resolvedAt);
}

function setUserEpochVolume(
  stateDiff: Record<Hex, Hex>,
  contract: CompiledContract,
  epoch: bigint,
  user: Address,
  volume: bigint,
) {
  if (contract.storage.some(({ label }) => label === "userEpochVolumes")) {
    setMappingValue(stateDiff, contract, "userEpochVolumes", [
      { type: "uint256", value: epoch },
      { type: "address", value: user },
    ], volume);
    return;
  }
  if (contract.storage.some(({ label }) => label === "_userEpochRebateData")) {
    setMappingValue(stateDiff, contract, "_userEpochRebateData", [
      { type: "uint256", value: epoch },
      { type: "address", value: user },
    ], volume);
    return;
  }
  setMappingValue(stateDiff, contract, "userBets", [
    { type: "uint256", value: epoch },
    { type: "uint256", value: 2n },
    { type: "address", value: user },
  ], volume);
}

function baseMutationState(contract: CompiledContract, timestamp: bigint) {
  const stateDiff: Record<Hex, Hex> = buildClockStateDiff(contract, timestamp);
  setDirectStorage(stateDiff, contract, "feeRecipient", BigInt(HARNESS_SIMULATION_ADDRESS));
  for (const label of [
    "pendingFeeRecipient",
    "pendingFeeRecipientEta",
    "accruedOwnerFees",
    "accruedBurnFees",
  ]) {
    setDirectStorage(stateDiff, contract, label, 0n);
  }
  return stateDiff;
}

function buildMutationState(
  contract: CompiledContract,
  timestamp: bigint,
  sender: Address,
  mode: "reward" | "rebate" | "reward-dust" | "rebate-dust" | "resolver-reward" | "fee-flush",
  resolvedAtOverride?: bigint,
) {
  const stateDiff = baseMutationState(contract, timestamp);
  const totalPool = BET_AMOUNT * 25n;
  const rewardPool = BET_AMOUNT * 23n;
  const expiredAt = timestamp - DUST_SETTLE_DELAY_SECONDS - 1n;
  if (mode === "resolver-reward") {
    setMappingValue(stateDiff, contract, "pendingResolverRewards", [{ type: "address", value: sender }], BET_AMOUNT);
    return stateDiff;
  }
  if (mode === "fee-flush") {
    setDirectStorage(stateDiff, contract, "accruedOwnerFees", BET_AMOUNT);
    setDirectStorage(stateDiff, contract, "accruedBurnFees", BET_AMOUNT);
    return stateDiff;
  }

  setResolvedEpoch(stateDiff, contract, {
    epoch: SYNTHETIC_EPOCH,
    totalPool,
    rewardPool,
    winningTile: 1n,
    resolvedAt: resolvedAtOverride ?? (mode.endsWith("dust") ? expiredAt : timestamp),
  });
  if (mode === "reward") {
    setMappingValue(stateDiff, contract, "tilePools", [
      { type: "uint256", value: SYNTHETIC_EPOCH },
      { type: "uint256", value: 1n },
    ], BET_AMOUNT * 10n);
    setMappingValue(stateDiff, contract, "userBets", [
      { type: "uint256", value: SYNTHETIC_EPOCH },
      { type: "uint256", value: 1n },
      { type: "address", value: sender },
    ], BET_AMOUNT * 10n);
    return stateDiff;
  }
  if (mode === "rebate") {
    setMappingValue(stateDiff, contract, "tilePools", [
      { type: "uint256", value: SYNTHETIC_EPOCH },
      { type: "uint256", value: 1n },
    ], BET_AMOUNT * 5n);
    setUserEpochVolume(stateDiff, contract, SYNTHETIC_EPOCH, sender, BET_AMOUNT * 10n);
    setMappingValue(stateDiff, contract, "epochRebatePool", [{ type: "uint256", value: SYNTHETIC_EPOCH }], BET_AMOUNT);
    return stateDiff;
  }
  if (mode === "reward-dust") {
    setMappingValue(stateDiff, contract, "epochRewardClaimed", [{ type: "uint256", value: SYNTHETIC_EPOCH }], BET_AMOUNT * 20n);
    return stateDiff;
  }
  setMappingValue(stateDiff, contract, "epochRebatePool", [{ type: "uint256", value: SYNTHETIC_EPOCH }], BET_AMOUNT);
  setMappingValue(stateDiff, contract, "epochRebateClaimed", [{ type: "uint256", value: SYNTHETIC_EPOCH }], BET_AMOUNT / 2n);
  return stateDiff;
}

function buildMixedBatchMutationState(
  contract: CompiledContract,
  timestamp: bigint,
  sender: Address,
  mode: "reward" | "rebate" | "reward-dust" | "rebate-dust",
) {
  const stateDiff = buildMutationState(contract, timestamp, sender, mode);
  setResolvedEpoch(stateDiff, contract, {
    epoch: SYNTHETIC_EPOCH + 2n,
    totalPool: BET_AMOUNT * 25n,
    rewardPool: BET_AMOUNT * 23n,
    winningTile: 1n,
    resolvedAt: mode.endsWith("dust")
      ? timestamp - DUST_SETTLE_DELAY_SECONDS + 1n
      : timestamp,
  });
  if (mode === "rebate-dust") {
    setMappingValue(stateDiff, contract, "epochRebatePool", [
      { type: "uint256", value: SYNTHETIC_EPOCH + 2n },
    ], BET_AMOUNT);
  }
  return stateDiff;
}

function buildFullPrecisionMutationState(
  contract: CompiledContract,
  timestamp: bigint,
  sender: Address,
  mode: "reward" | "rebate",
) {
  const stateDiff = baseMutationState(contract, timestamp);
  if (mode === "reward") {
    const rewardPool = 1n << 200n;
    const userBet = 1n << 100n;
    setResolvedEpoch(stateDiff, contract, {
      epoch: SYNTHETIC_EPOCH,
      totalPool: 1n << 201n,
      rewardPool,
      winningTile: 1n,
      resolvedAt: timestamp,
    });
    setMappingValue(stateDiff, contract, "tilePools", [
      { type: "uint256", value: SYNTHETIC_EPOCH },
      { type: "uint256", value: 1n },
    ], 1n << 101n);
    setMappingValue(stateDiff, contract, "userBets", [
      { type: "uint256", value: SYNTHETIC_EPOCH },
      { type: "uint256", value: 1n },
      { type: "address", value: sender },
    ], userBet);
    return stateDiff;
  }

  setResolvedEpoch(stateDiff, contract, {
    epoch: SYNTHETIC_EPOCH,
    totalPool: 1n << 220n,
    rewardPool: 0n,
    winningTile: 1n,
    resolvedAt: timestamp,
  });
  setUserEpochVolume(stateDiff, contract, SYNTHETIC_EPOCH, sender, 1n << 219n);
  setMappingValue(stateDiff, contract, "epochRebatePool", [
    { type: "uint256", value: SYNTHETIC_EPOCH },
  ], 1n << 210n);
  return stateDiff;
}

function buildFullPrecisionResolveState(contract: CompiledContract, timestamp: bigint) {
  const stateDiff = buildResolveStateDiff(contract, timestamp, "funded-no-winner");
  const epochMappingLabel = contract.storage.some(({ label }) => label === "_epochs") ? "_epochs" : "epochs";
  const epochBase = mappingEntrySlot("uint256", SYNTHETIC_EPOCH, storageSlotNumber(contract, epochMappingLabel));
  stateDiff[toHex(epochBase, { size: 32 })] = storageValue(1n << 255n);
  return stateDiff;
}

function buildMutationBatchState(
  contract: CompiledContract,
  timestamp: bigint,
  sender: Address,
  epochs: bigint[],
  mode: "reward" | "rebate" | "reward-dust" | "rebate-dust",
) {
  const stateDiff = baseMutationState(contract, timestamp);
  const expiredAt = timestamp - DUST_SETTLE_DELAY_SECONDS - 1n;
  for (const epoch of epochs) {
    setResolvedEpoch(stateDiff, contract, {
      epoch,
      totalPool: BET_AMOUNT * 25n,
      rewardPool: BET_AMOUNT * 23n,
      winningTile: 1n,
      resolvedAt: mode.endsWith("dust") ? expiredAt : timestamp,
    });
    if (mode === "reward") {
      setMappingValue(stateDiff, contract, "tilePools", [
        { type: "uint256", value: epoch },
        { type: "uint256", value: 1n },
      ], BET_AMOUNT * 10n);
      setMappingValue(stateDiff, contract, "userBets", [
        { type: "uint256", value: epoch },
        { type: "uint256", value: 1n },
        { type: "address", value: sender },
      ], BET_AMOUNT * 10n);
    } else if (mode === "rebate") {
      setMappingValue(stateDiff, contract, "tilePools", [
        { type: "uint256", value: epoch },
        { type: "uint256", value: 1n },
      ], BET_AMOUNT * 5n);
      setUserEpochVolume(stateDiff, contract, epoch, sender, BET_AMOUNT * 10n);
      setMappingValue(stateDiff, contract, "epochRebatePool", [{ type: "uint256", value: epoch }], BET_AMOUNT);
    } else if (mode === "reward-dust") {
      setMappingValue(stateDiff, contract, "epochRewardClaimed", [{ type: "uint256", value: epoch }], BET_AMOUNT * 20n);
    } else {
      setMappingValue(stateDiff, contract, "epochRebatePool", [{ type: "uint256", value: epoch }], BET_AMOUNT);
      setMappingValue(stateDiff, contract, "epochRebateClaimed", [{ type: "uint256", value: epoch }], BET_AMOUNT / 2n);
    }
  }
  return stateDiff;
}

function configuredAccountAddresses() {
  const walletEnvironment: Record<string, string> = {};
  loadDotenv({
    path: ".env.live-test-wallets",
    override: false,
    quiet: true,
    processEnv: walletEnvironment,
  });
  try {
    return LIVE_TEST_ROLES
      .map((role) => {
        const name = `LORE_LIVE_TEST_${role}_ADDRESS`;
        return {
          role,
          address: process.env[name]?.trim() || walletEnvironment[name]?.trim(),
        };
      })
      .filter((account): account is { role: LiveTestRole; address: string } => Boolean(account.address))
      .map(({ role, address }) => ({ role, address: getAddress(address) }));
  } finally {
    for (const name of Object.keys(walletEnvironment)) walletEnvironment[name] = "";
  }
}

function reportAccountReadiness(
  reason: "no-configured-account" | "deployment-account-not-ready" | "token-account-not-ready",
  accounts: readonly AccountReadiness[],
) {
  console.error(`[v10-linea-gas] ${JSON.stringify({ status: "blocked", reason, accounts })}`);
}

class BenchmarkBlockedError extends Error {
  constructor(
    readonly reason: "behavior-benchmark-timeout",
    readonly details: Record<string, unknown>,
  ) {
    super(reason);
  }
}

function reportBenchmarkBlocked(error: BenchmarkBlockedError) {
  console.error(`[v10-linea-gas] ${JSON.stringify({
    status: "blocked",
    reason: error.reason,
    ...error.details,
  })}`);
}

async function withBenchmarkTimeout<T>(promise: Promise<T>, timeoutMs: number, reason: BenchmarkBlockedError["reason"]) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new BenchmarkBlockedError(reason, { timeoutMs })), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function completeAccountReadiness(accounts: readonly AccountReadiness[]) {
  const byRole = new Map(accounts.map((account) => [account.role, account]));
  return LIVE_TEST_ROLES.map(
    (role): AccountReadiness => byRole.get(role) ?? { role, configured: false, eligible: false },
  );
}

function sanitizedRpcError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/https?:\/\/[^\s"']+/gi, "[redacted-rpc]")
    .replace(/0x[a-fA-F0-9]{40,}/g, "[redacted-hex]")
    .split(/\r?\n/)[0]
    .slice(0, 240);
}

function parseContentLengthHeader(value: string | null) {
  if (value == null || value === "") return null;
  if (!CONTENT_LENGTH_RE.test(value)) throw new Error("RPC response has invalid content-length");
  const parsed = BigInt(value);
  if (parsed > MAX_SAFE_INTEGER_BIGINT) throw new Error("RPC response has invalid content-length");
  return Number(parsed);
}

async function readBoundedJsonResponse(response: Response) {
  const contentLength = parseContentLengthHeader(response.headers.get("content-length"));
  if (contentLength !== null && contentLength > MAX_RPC_RESPONSE_BYTES) {
    throw new Error("RPC response body too large");
  }
  if (!response.body) throw new Error("RPC response body is empty");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let totalBytes = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_RPC_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error("RPC response body too large");
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return JSON.parse(text) as unknown;
}

async function rpcRequest<T>(rpcUrls: string[], method: string, params: unknown[]): Promise<T> {
  let lastError: unknown;
  for (const rpcUrl of rpcUrls) {
    try {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(30_000),
      });
      const payload = await readBoundedJsonResponse(response) as { error?: { code?: number; message?: string }; result?: T };
      if (!response.ok || payload.error || payload.result === undefined) {
        throw new Error(`RPC ${payload.error?.code ?? response.status}: ${payload.error?.message ?? "request failed"}`);
      }
      return payload.result;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(sanitizedRpcError(lastError));
}

async function expectRpcExecutionRevert(action: () => Promise<unknown>, label: string) {
  let failure: unknown;
  try {
    await action();
  } catch (error) {
    failure = error;
  }
  assert.ok(failure, `${label} must revert`);
  const message = sanitizedRpcError(failure);
  assert.match(
    message,
    /execution reverted|revert(?:ed)?\b|vm execution error/i,
    `${label} failed for a non-EVM reason: ${message}`,
  );
}

function asSnapshot(value: unknown) {
  if (Array.isArray(value) && value.length === 1 && typeof value[0] === "object") return value[0] as Record<string, unknown>;
  return value as Record<string, unknown>;
}

function bigintArray(value: unknown, label: string) {
  assert.ok(Array.isArray(value), `${label} must be an array`);
  return value.map((entry) => BigInt(entry as bigint));
}

async function runBehaviorChecks({
  rpcUrls,
  sender,
  blockNumber,
  blockTimestamp,
  blockPrevrandao,
}: {
  rpcUrls: string[];
  sender: Address;
  blockNumber: bigint;
  blockTimestamp: bigint;
  blockPrevrandao: bigint;
}) {
  const diagnostics = compileDiagnosticContracts();
  const games = CONTRACTS.map((entry) => compileContract(
    entry.path,
    entry.name,
    TOKEN_SIMULATION_ADDRESS,
    entry.name === "LineaOreV10" ? V10_OPTIMIZER_RUNS : 200,
    entry.name === "LineaOreV10" ? V10_VIA_IR : false,
    entry.name === "LineaOreV10" ? solc : legacySolc,
  ));

  const callHarness = async (
    game: CompiledContract,
    functionName:
      | "betTwice"
      | "rejectThenBetAndSnapshot"
      | "betOnceByMode"
      | "rejectBetByModeAndSnapshot"
      | "deployAndSnapshot"
      | "betTwiceForEpoch"
      | "betAfterExpiredEmptyEpoch"
      | "resolveAndSnapshot"
      | "mutateAndSnapshot"
      | "rejectMutationAndSnapshot"
      | "mutateBatchAndSnapshot"
      | "rejectBatchMutationAndSnapshot"
      | "rejectBetAndSnapshot"
      | "exerciseAdminControls"
      | "resolveAndSnapshotAdmin"
      | "acceptOwnershipAndSnapshot"
      | "probeUnauthorizedAdmin",
    args: readonly unknown[],
    stateDiff: Record<string, Hex>,
    tokenRuntime = diagnostics.reentrancyTokenRuntime,
  ) => {
    const data = encodeFunctionData({
      abi: diagnostics.harnessAbi,
      functionName,
      args,
    });
    const result = await rpcRequest<Hex>(rpcUrls, "eth_call", [
      {
        from: sender,
        to: HARNESS_SIMULATION_ADDRESS,
        data,
        gas: toHex(20_000_000n),
      },
      toHex(blockNumber),
      {
        [EMPTY_SIMULATION_ADDRESS]: { code: game.runtimeCode, stateDiff },
        [TOKEN_SIMULATION_ADDRESS]: { code: tokenRuntime },
        [HARNESS_SIMULATION_ADDRESS]: { code: diagnostics.harnessRuntime },
      },
    ]);
    return asSnapshot(decodeFunctionResult({
      abi: diagnostics.harnessAbi,
      functionName,
      data: result,
    }));
  };

  const callFrontendView = async (
    game: CompiledContract,
    data: Hex,
    stateDiff: Record<string, Hex>,
  ) => rpcRequest<Hex>(rpcUrls, "eth_call", [
    {
      from: sender,
      to: EMPTY_SIMULATION_ADDRESS,
      data,
      gas: toHex(5_000_000n),
    },
    toHex(blockNumber),
    {
      [EMPTY_SIMULATION_ADDRESS]: { code: game.runtimeCode, stateDiff },
    },
  ]);

  const expectHarnessRevert = async (
    game: CompiledContract,
    functionName:
      | "betTwice"
      | "rejectThenBetAndSnapshot"
      | "betOnceByMode"
      | "rejectBetByModeAndSnapshot"
      | "deployAndSnapshot"
      | "betTwiceForEpoch"
      | "betAfterExpiredEmptyEpoch"
      | "resolveAndSnapshot"
      | "mutateAndSnapshot"
      | "rejectMutationAndSnapshot"
      | "mutateBatchAndSnapshot"
      | "rejectBatchMutationAndSnapshot"
      | "rejectBetAndSnapshot"
      | "exerciseAdminControls"
      | "resolveAndSnapshotAdmin"
      | "acceptOwnershipAndSnapshot"
      | "probeUnauthorizedAdmin",
    args: readonly unknown[],
    stateDiff: Record<string, Hex>,
  ) => {
    await expectRpcExecutionRevert(
      () => callHarness(game, functionName, args, stateDiff),
      `${game.name} ${functionName} for the supplied boundary state`,
    );
  };

  const mask = 0x1001001;
  const populatedTileIndexes = new Set([0, 12, 24]);
  const resolveTotal = BET_AMOUNT * 25n;
  const dailyAccrual = (resolveTotal * 2n) / 100n;
  const weeklyAccrual = (resolveTotal * 3n) / 100n;
  const protocolFee = (resolveTotal * 2n) / 100n;
  const burnFee = (resolveTotal * 1n) / 100n;
  const resolverReward = (resolveTotal * 5n) / 10_000n;
  const rebatePool = (protocolFee - resolverReward) / 2n;
  const ownerFees = protocolFee - resolverReward - rebatePool;
  const baseReward = resolveTotal - dailyAccrual - weeklyAccrual - protocolFee - burnFee;
  const emptyRollover = BET_AMOUNT * 7n;
  const winners = new Map<string, bigint>();
  const accountedLiabilities = (snapshot: Record<string, unknown>) => [
    "rewardPool",
    "rollover",
    "dailyPool",
    "weeklyPool",
    "ownerFees",
    "burnFees",
    "resolverRewards",
    "rebatePool",
  ].reduce((total, key) => total + BigInt(snapshot[key] as bigint), 0n);
  const buildFrontendViewState = (game: CompiledContract, resolvedAt: bigint) => {
    const state = buildMutationState(
      game,
      blockTimestamp,
      HARNESS_SIMULATION_ADDRESS,
      "rebate",
      resolvedAt,
    );
    setDirectStorage(state, game, "dailyJackpotPool", BET_AMOUNT * 2n);
    setDirectStorage(state, game, "weeklyJackpotPool", BET_AMOUNT * 3n);
    setJackpotAwardMetadata(
      state,
      game,
      "daily",
      blockTimestamp / DAY_SECONDS - 1n,
      SYNTHETIC_EPOCH - 2n,
    );
    setJackpotAwardMetadata(
      state,
      game,
      "weekly",
      mondayWeek(blockTimestamp) - 1n,
      SYNTHETIC_EPOCH - 1n,
    );
    setDirectStorage(state, game, "lastDailyJackpotAmount", BET_AMOUNT * 4n);
    setDirectStorage(state, game, "lastWeeklyJackpotAmount", BET_AMOUNT * 5n);
    return state;
  };
  const readFrontendJackpotSnapshot = async (
    game: CompiledContract,
    state: Record<string, Hex>,
  ) => {
    const currentEndTime = decodeFunctionResult({
      abi: GAME_ABI,
      functionName: "getEpochEndTime",
      data: await callFrontendView(game, encodeFunctionData({
        abi: GAME_ABI,
        functionName: "getEpochEndTime",
        args: [SYNTHETIC_EPOCH],
      }), state),
    });
    const nonCurrentEndTime = decodeFunctionResult({
      abi: GAME_ABI,
      functionName: "getEpochEndTime",
      data: await callFrontendView(game, encodeFunctionData({
        abi: GAME_ABI,
        functionName: "getEpochEndTime",
        args: [SYNTHETIC_EPOCH + 1n],
      }), state),
    });
    const [
      dailyPool,
      weeklyPool,
      lastDailyDay,
      lastWeeklyWeek,
      lastDailyEpoch,
      lastWeeklyEpoch,
      lastDailyAmount,
      lastWeeklyAmount,
    ] = decodeFunctionResult({
      abi: GAME_ABI,
      functionName: "getJackpotInfo",
      data: await callFrontendView(game, encodeFunctionData({
        abi: GAME_ABI,
        functionName: "getJackpotInfo",
      }), state),
    });
    return {
      currentEndTime,
      nonCurrentEndTime,
      dailyPool,
      weeklyPool,
      lastDailyDay,
      lastWeeklyWeek,
      lastDailyEpoch,
      lastWeeklyEpoch,
      lastDailyAmount,
      lastWeeklyAmount,
    };
  };
  const readFrontendRebateSnapshot = async (
    game: CompiledContract,
    state: Record<string, Hex>,
  ) => {
    const previewRebate = decodeFunctionResult({
      abi: GAME_ABI,
      functionName: "previewRebate",
      data: await callFrontendView(game, encodeFunctionData({
        abi: GAME_ABI,
        functionName: "previewRebate",
        args: [SYNTHETIC_EPOCH, HARNESS_SIMULATION_ADDRESS],
      }), state),
    });
    const [
      rebatePool,
      userVolume,
      pendingRebate,
      rebateClaimed,
      epochResolved,
    ] = decodeFunctionResult({
      abi: GAME_ABI,
      functionName: "getRebateInfo",
      data: await callFrontendView(game, encodeFunctionData({
        abi: GAME_ABI,
        functionName: "getRebateInfo",
        args: [SYNTHETIC_EPOCH, HARNESS_SIMULATION_ADDRESS],
      }), state),
    });
    const [summaryPending, summaryClaimableEpochs] = decodeFunctionResult({
      abi: GAME_ABI,
      functionName: "getRebateSummary",
      data: await callFrontendView(game, encodeFunctionData({
        abi: GAME_ABI,
        functionName: "getRebateSummary",
        args: [HARNESS_SIMULATION_ADDRESS, [SYNTHETIC_EPOCH]],
      }), state),
    });
    const [duplicateSummaryPending, duplicateSummaryClaimableEpochs] = decodeFunctionResult({
      abi: GAME_ABI,
      functionName: "getRebateSummary",
      data: await callFrontendView(game, encodeFunctionData({
        abi: GAME_ABI,
        functionName: "getRebateSummary",
        args: [HARNESS_SIMULATION_ADDRESS, [SYNTHETIC_EPOCH, SYNTHETIC_EPOCH]],
      }), state),
    });
    return {
      previewRebate,
      rebatePool,
      userVolume,
      pendingRebate,
      rebateClaimed,
      epochResolved,
      summaryPending,
      summaryClaimableEpochs,
      duplicateSummaryPending,
      duplicateSummaryClaimableEpochs,
    };
  };
  const assertFrontendJackpotSnapshot = (snapshot: Record<string, unknown>) => {
    assert.equal(snapshot.currentEndTime, blockTimestamp + SYNTHETIC_DURATION);
    assert.equal(snapshot.nonCurrentEndTime, 0n);
    assert.equal(snapshot.dailyPool, BET_AMOUNT * 2n);
    assert.equal(snapshot.weeklyPool, BET_AMOUNT * 3n);
    assert.equal(snapshot.lastDailyDay, blockTimestamp / DAY_SECONDS - 1n);
    assert.equal(snapshot.lastWeeklyWeek, mondayWeek(blockTimestamp) - 1n);
    assert.equal(snapshot.lastDailyEpoch, SYNTHETIC_EPOCH - 2n);
    assert.equal(snapshot.lastWeeklyEpoch, SYNTHETIC_EPOCH - 1n);
    assert.equal(snapshot.lastDailyAmount, BET_AMOUNT * 4n);
    assert.equal(snapshot.lastWeeklyAmount, BET_AMOUNT * 5n);
  };
  const assertFrontendRebateSnapshot = (
    game: CompiledContract,
    snapshot: Record<string, unknown>,
    expired: boolean,
  ) => {
    const expectedPending = expired ? 0n : BET_AMOUNT / 2n;
    assert.equal(snapshot.previewRebate, expectedPending);
    assert.equal(snapshot.rebatePool, BET_AMOUNT);
    assert.equal(snapshot.userVolume, BET_AMOUNT * 10n);
    assert.equal(snapshot.pendingRebate, expectedPending);
    assert.equal(snapshot.rebateClaimed, false);
    assert.equal(snapshot.epochResolved, true);
    assert.equal(snapshot.summaryPending, expectedPending);
    assert.equal(snapshot.summaryClaimableEpochs, expired ? 0n : 1n);
    assert.equal(snapshot.duplicateSummaryPending, expectedPending * 2n);
    assert.equal(snapshot.duplicateSummaryClaimableEpochs, expired ? 0n : 2n);
    assert.equal(
      snapshot.previewRebate,
      snapshot.pendingRebate,
      `${game.name} previewRebate and getRebateInfo must agree`,
    );
  };
  let frontendViewCases = 0;
  for (const game of games) {
    const state = buildFrontendViewState(game, blockTimestamp);
    const jackpotSnapshot = await readFrontendJackpotSnapshot(game, state);
    assertFrontendJackpotSnapshot(jackpotSnapshot);

    const activeRebateSnapshot = await readFrontendRebateSnapshot(game, state);
    assertFrontendRebateSnapshot(game, activeRebateSnapshot, false);

    const expiredRebateSnapshot = await readFrontendRebateSnapshot(
      game,
      buildFrontendViewState(game, blockTimestamp - DUST_SETTLE_DELAY_SECONDS),
    );
    assertFrontendRebateSnapshot(game, expiredRebateSnapshot, true);
    frontendViewCases += 3;
  }

  const assertBetSnapshot = (
    game: CompiledContract,
    snapshot: Record<string, unknown>,
    autoResolved: boolean,
    repetitions = 2n,
  ) => {
    const expectedBetTotal = BET_AMOUNT * 3n * repetitions;
    assert.equal(snapshot.startEpoch, SYNTHETIC_EPOCH);
    assert.equal(snapshot.currentEpoch, SYNTHETIC_EPOCH + (autoResolved ? 1n : 0n));
    assert.equal(snapshot.startEpochResolved, autoResolved);
    assert.equal(snapshot.totalPool, expectedBetTotal);
    assert.equal(snapshot.rewardPool, 0n);
    assert.equal(snapshot.winningTile, 0n);
    assert.equal(snapshot.resolved, false);
    assert.equal(snapshot.userVolume, expectedBetTotal);
    const pools = bigintArray(snapshot.pools, `${game.name} pools`);
    const bets = bigintArray(snapshot.bets, `${game.name} bets`);
    const users = bigintArray(snapshot.users, `${game.name} users`);
    assert.equal(pools.length, 25);
    assert.equal(bets.length, 25);
    assert.equal(users.length, 25);
    for (let index = 0; index < 25; index += 1) {
      const expectedAmount = populatedTileIndexes.has(index) ? BET_AMOUNT * repetitions : 0n;
      assert.equal(pools[index], expectedAmount, `${game.name} pool mismatch at tile ${index + 1}`);
      assert.equal(bets[index], expectedAmount, `${game.name} user bet mismatch at tile ${index + 1}`);
      const expectedUsers = game.name === "LineaOreV9" && populatedTileIndexes.has(index) ? 1n : 0n;
      assert.equal(users[index], expectedUsers, `${game.name} user count mismatch at tile ${index + 1}`);
    }
  };

  const expectedBetAmounts = (mode: number) => {
    const amounts = Array<bigint>(25).fill(0n);
    amounts[0] = BET_AMOUNT;
    if (mode === 0) return amounts;
    amounts[12] = mode === 1 ? BET_AMOUNT * 2n : BET_AMOUNT;
    amounts[24] = mode === 1 ? BET_AMOUNT * 3n : BET_AMOUNT;
    return amounts;
  };

  const assertBetEntrypointSnapshot = (
    game: CompiledContract,
    snapshot: Record<string, unknown>,
    mode: number,
  ) => {
    const expectedAmounts = expectedBetAmounts(mode);
    const expectedTotal = expectedAmounts.reduce((total, amount) => total + amount, 0n);
    assert.equal(snapshot.startEpoch, SYNTHETIC_EPOCH);
    assert.equal(snapshot.currentEpoch, SYNTHETIC_EPOCH);
    assert.equal(snapshot.startEpochResolved, false);
    assert.equal(snapshot.totalPool, expectedTotal);
    assert.equal(snapshot.rewardPool, 0n);
    assert.equal(snapshot.winningTile, 0n);
    assert.equal(snapshot.resolved, false);
    assert.equal(snapshot.userVolume, expectedTotal);
    const pools = bigintArray(snapshot.pools, `${game.name} mode ${mode} pools`);
    const bets = bigintArray(snapshot.bets, `${game.name} mode ${mode} bets`);
    const users = bigintArray(snapshot.users, `${game.name} mode ${mode} users`);
    assert.equal(pools.length, 25);
    assert.equal(bets.length, 25);
    assert.equal(users.length, 25);
    for (let index = 0; index < 25; index += 1) {
      assert.equal(pools[index], expectedAmounts[index], `${game.name} mode ${mode} pool mismatch at tile ${index + 1}`);
      assert.equal(bets[index], expectedAmounts[index], `${game.name} mode ${mode} user bet mismatch at tile ${index + 1}`);
      const expectedUsers = game.name === "LineaOreV9" && expectedAmounts[index] > 0n ? 1n : 0n;
      assert.equal(users[index], expectedUsers, `${game.name} mode ${mode} user count mismatch at tile ${index + 1}`);
    }
  };

  const assertEmptyBetSnapshot = (
    game: CompiledContract,
    snapshot: Record<string, unknown>,
    label: string,
  ) => {
    assert.equal(snapshot.startEpoch, SYNTHETIC_EPOCH, `${game.name} ${label} start epoch`);
    assert.equal(snapshot.currentEpoch, SYNTHETIC_EPOCH, `${game.name} ${label} current epoch`);
    assert.equal(snapshot.startEpochResolved, false, `${game.name} ${label} resolved flag`);
    assert.equal(snapshot.totalPool, 0n, `${game.name} ${label} total pool`);
    assert.equal(snapshot.rewardPool, 0n, `${game.name} ${label} reward pool`);
    assert.equal(snapshot.winningTile, 0n, `${game.name} ${label} winning tile`);
    assert.equal(snapshot.resolved, false, `${game.name} ${label} current resolved flag`);
    assert.equal(snapshot.userVolume, 0n, `${game.name} ${label} user volume`);
    for (const [field, values] of [
      ["pools", bigintArray(snapshot.pools, `${game.name} ${label} pools`)],
      ["bets", bigintArray(snapshot.bets, `${game.name} ${label} bets`)],
      ["users", bigintArray(snapshot.users, `${game.name} ${label} users`)],
    ] as const) {
      assert.equal(values.length, 25, `${game.name} ${label} ${field} length`);
      assert.ok(values.every((value) => value === 0n), `${game.name} ${label} ${field} must roll back`);
    }
  };

  const assertResolveSnapshot = (
    game: CompiledContract,
    snapshot: Record<string, unknown>,
    hasWinner: boolean,
  ) => {
    assert.equal(snapshot.currentEpoch, SYNTHETIC_EPOCH + 1n);
    assert.equal(snapshot.totalPool, resolveTotal);
    assert.equal(snapshot.rewardPool, hasWinner ? baseReward : 0n);
    assert.equal(snapshot.resolved, true);
    assert.equal(snapshot.dailyJackpot, false);
    assert.equal(snapshot.weeklyJackpot, false);
    assert.equal(snapshot.rollover, hasWinner ? 0n : baseReward);
    assert.equal(snapshot.dailyPool, dailyAccrual);
    assert.equal(snapshot.weeklyPool, weeklyAccrual);
    assert.equal(snapshot.ownerFees, ownerFees);
    assert.equal(snapshot.burnFees, burnFee);
    assert.equal(snapshot.resolverRewards, resolverReward);
    assert.equal(snapshot.rebatePool, rebatePool);
    assert.equal(snapshot.resolvedAt, blockTimestamp);
    assert.equal(
      accountedLiabilities(snapshot),
      resolveTotal,
      `${game.name} resolved liabilities must conserve the full funded pool`,
    );
    const winningTile = BigInt(snapshot.winningTile as bigint);
    assert.ok(winningTile >= 1n && winningTile <= 25n);
    winners.set(`${game.name}:${hasWinner ? "winner" : "no-winner"}`, winningTile);
  };

  let betEntrypointSuccesses = 0;
  let betEntrypointRollbackReverts = 0;
  for (const game of games) {
    const activeState = buildClockStateDiff(game, blockTimestamp);
    const highestBetMode = game.name === "LineaOreV10" ? 4 : 3;
    for (let mode = 0; mode <= highestBetMode; mode += 1) {
      const placed = await callHarness(
        game,
        "betOnceByMode",
        [EMPTY_SIMULATION_ADDRESS, mode, SYNTHETIC_EPOCH, mask, BET_AMOUNT],
        activeState,
      );
      assertBetEntrypointSnapshot(game, placed, mode);
      betEntrypointSuccesses += 1;

      const rejected = await callHarness(
        game,
        "rejectBetByModeAndSnapshot",
        [EMPTY_SIMULATION_ADDRESS, mode, SYNTHETIC_EPOCH, mask, BET_AMOUNT],
        activeState,
        diagnostics.rejectingTokenRuntime,
      );
      assertEmptyBetSnapshot(game, rejected, `active mode ${mode} rollback`);
      betEntrypointRollbackReverts += 1;

      if (game.name === "LineaOreV10") {
        const expiredRejected = await callHarness(
          game,
          "rejectBetByModeAndSnapshot",
          [EMPTY_SIMULATION_ADDRESS, mode, SYNTHETIC_EPOCH, mask, BET_AMOUNT],
          buildResolveStateDiff(game, blockTimestamp, "empty"),
          diagnostics.rejectingTokenRuntime,
        );
        assertEmptyBetSnapshot(game, expiredRejected, `expired mode ${mode} rollback`);
        betEntrypointRollbackReverts += 1;
      }
    }

    const activeBet = await callHarness(
      game,
      "betTwice",
      [EMPTY_SIMULATION_ADDRESS, mask, BET_AMOUNT],
      activeState,
    );
    assertBetSnapshot(game, activeBet, false);

    const afterCaughtRevertBet = await callHarness(
      game,
      "rejectThenBetAndSnapshot",
      [EMPTY_SIMULATION_ADDRESS, mask, BET_AMOUNT],
      activeState,
    );
    assertBetSnapshot(game, afterCaughtRevertBet, false, 1n);

    const autoResolveBet = await callHarness(
      game,
      "betTwice",
      [EMPTY_SIMULATION_ADDRESS, mask, BET_AMOUNT],
      buildResolveStateDiff(game, blockTimestamp, "empty"),
    );
    assertBetSnapshot(game, autoResolveBet, true);

    for (const scenario of ["funded-no-winner", "winner-25-funded-tiles"] as const) {
      const resolved = await callHarness(
        game,
        "resolveAndSnapshot",
        [EMPTY_SIMULATION_ADDRESS, SYNTHETIC_EPOCH],
        buildResolveStateDiff(game, blockTimestamp, scenario),
      );
      assertResolveSnapshot(game, resolved, scenario === "winner-25-funded-tiles");
    }

    const emptyRolloverSnapshot = await callHarness(
      game,
      "resolveAndSnapshot",
      [EMPTY_SIMULATION_ADDRESS, SYNTHETIC_EPOCH],
      buildResolveStateDiff(game, blockTimestamp, "empty-with-rollover"),
    );
    assert.equal(emptyRolloverSnapshot.currentEpoch, SYNTHETIC_EPOCH + 1n);
    assert.equal(emptyRolloverSnapshot.totalPool, 0n);
    assert.equal(emptyRolloverSnapshot.rewardPool, 0n);
    assert.equal(emptyRolloverSnapshot.resolved, true);
    assert.equal(emptyRolloverSnapshot.dailyJackpot, false);
    assert.equal(emptyRolloverSnapshot.weeklyJackpot, false);
    assert.equal(emptyRolloverSnapshot.rollover, emptyRollover);
    assert.equal(emptyRolloverSnapshot.resolvedAt, blockTimestamp);
    assert.equal(
      accountedLiabilities(emptyRolloverSnapshot),
      emptyRollover,
      `${game.name} empty epoch must preserve rollover without charging fees`,
    );
    winners.set(`${game.name}:empty-rollover`, BigInt(emptyRolloverSnapshot.winningTile as bigint));

    const adminState = buildClockStateDiff(game, blockTimestamp);
    setDirectStorage(adminState, game, "_owner", BigInt(HARNESS_SIMULATION_ADDRESS));
    setDirectStorage(adminState, game, "feeRecipient", BigInt(sender));
    const adminSnapshot = await callHarness(
      game,
      "exerciseAdminControls",
      [EMPTY_SIMULATION_ADDRESS, sender, TOKEN_SIMULATION_ADDRESS],
      adminState,
    );
    assert.equal(getAddress(String(adminSnapshot.ownerBefore)), HARNESS_SIMULATION_ADDRESS);
    assert.equal(getAddress(String(adminSnapshot.ownerAfter)), HARNESS_SIMULATION_ADDRESS);
    assert.equal(getAddress(String(adminSnapshot.pendingOwnerDuring)), sender);
    assert.equal(getAddress(String(adminSnapshot.pendingOwnerAfterCancel)), ZERO_ADDRESS);
    assert.equal(adminSnapshot.pendingDurationDuring, 120n);
    assert.equal(adminSnapshot.pendingDurationEtaDuring, blockTimestamp + 30n * 60n);
    assert.equal(adminSnapshot.pendingDurationEpochDuring, SYNTHETIC_EPOCH + 1n);
    assert.equal(adminSnapshot.pendingDurationAfterCancel, 0n);
    assert.equal(getAddress(String(adminSnapshot.pendingRecipientDuring)), TOKEN_SIMULATION_ADDRESS);
    assert.equal(adminSnapshot.pendingRecipientEtaDuring, blockTimestamp + 24n * 60n * 60n);
    assert.equal(getAddress(String(adminSnapshot.pendingRecipientAfterCancel)), ZERO_ADDRESS);
    assert.equal(adminSnapshot.lowDurationRejected, true);
    assert.equal(adminSnapshot.highDurationRejected, true);
    assert.equal(adminSnapshot.zeroRecipientRejected, true);
    assert.equal(adminSnapshot.selfRecipientRejected, game.name === "LineaOreV10");
    assert.equal(adminSnapshot.renounceRejected, true);

    for (const ready of [false, true]) {
      const adminApplyState = buildResolveStateDiff(game, blockTimestamp, "empty");
      const eta = ready ? blockTimestamp : blockTimestamp + 1n;
      setDirectStorage(adminApplyState, game, "feeRecipient", BigInt(sender));
      setDirectStorage(adminApplyState, game, "pendingEpochDuration", 120n);
      setDirectStorage(adminApplyState, game, "pendingEpochDurationEta", eta);
      setDirectStorage(
        adminApplyState,
        game,
        "pendingEpochDurationEffectiveFromEpoch",
        SYNTHETIC_EPOCH + 1n,
      );
      setDirectStorage(adminApplyState, game, "pendingFeeRecipient", BigInt(TOKEN_SIMULATION_ADDRESS));
      setDirectStorage(adminApplyState, game, "pendingFeeRecipientEta", eta);
      const applied = await callHarness(
        game,
        "resolveAndSnapshotAdmin",
        [EMPTY_SIMULATION_ADDRESS, SYNTHETIC_EPOCH],
        adminApplyState,
      );
      assert.equal(applied.currentEpoch, SYNTHETIC_EPOCH + 1n);
      assert.equal(applied.epochDuration, ready ? 120n : SYNTHETIC_DURATION);
      assert.equal(
        getAddress(String(applied.feeRecipient)),
        ready ? TOKEN_SIMULATION_ADDRESS : sender,
      );
      assert.equal(applied.pendingDuration, ready ? 0n : 120n);
      assert.equal(applied.pendingDurationEta, ready ? 0n : eta);
      assert.equal(applied.pendingDurationEpoch, ready ? 0n : SYNTHETIC_EPOCH + 1n);
      assert.equal(
        getAddress(String(applied.pendingRecipient)),
        ready ? ZERO_ADDRESS : TOKEN_SIMULATION_ADDRESS,
      );
      assert.equal(applied.pendingRecipientEta, ready ? 0n : eta);
    }

    const ownershipAcceptanceState = buildClockStateDiff(game, blockTimestamp);
    setDirectStorage(ownershipAcceptanceState, game, "_owner", BigInt(sender));
    setDirectStorage(ownershipAcceptanceState, game, "_pendingOwner", BigInt(HARNESS_SIMULATION_ADDRESS));
    const ownership = await callHarness(
      game,
      "acceptOwnershipAndSnapshot",
      [EMPTY_SIMULATION_ADDRESS, TOKEN_SIMULATION_ADDRESS],
      ownershipAcceptanceState,
    );
    assert.equal(getAddress(String(ownership.ownerAfterAccept)), HARNESS_SIMULATION_ADDRESS);
    assert.equal(getAddress(String(ownership.pendingOwnerAfterAccept)), ZERO_ADDRESS);
    assert.equal(getAddress(String(ownership.pendingOwnerAfterTransfer)), TOKEN_SIMULATION_ADDRESS);

    const nonOwnerState = buildClockStateDiff(game, blockTimestamp);
    setDirectStorage(nonOwnerState, game, "_owner", BigInt(sender));
    setDirectStorage(nonOwnerState, game, "_pendingOwner", 0n);
    await expectHarnessRevert(
      game,
      "acceptOwnershipAndSnapshot",
      [EMPTY_SIMULATION_ADDRESS, TOKEN_SIMULATION_ADDRESS],
      nonOwnerState,
    );
    const unauthorizedAdminRejected = await callHarness(
      game,
      "probeUnauthorizedAdmin",
      [EMPTY_SIMULATION_ADDRESS, TOKEN_SIMULATION_ADDRESS, HARNESS_SIMULATION_ADDRESS],
      nonOwnerState,
    );
    assert.equal(unauthorizedAdminRejected, true);

    const graceStart = blockTimestamp - SYNTHETIC_DURATION + 1n;
    await expectHarnessRevert(
      game,
      "betTwice",
      [EMPTY_SIMULATION_ADDRESS, mask, BET_AMOUNT],
      buildClockStateDiff(game, graceStart),
    );
    await expectHarnessRevert(
      game,
      "resolveAndSnapshot",
      [EMPTY_SIMULATION_ADDRESS, SYNTHETIC_EPOCH],
      activeState,
    );
    await expectHarnessRevert(
      game,
      "betTwice",
      [EMPTY_SIMULATION_ADDRESS, mask, BET_AMOUNT],
      buildUserVolumeOverflowState(game, blockTimestamp, HARNESS_SIMULATION_ADDRESS),
    );
  }

  assert.equal(winners.get("LineaOreV9:winner"), winners.get("LineaOreV10:winner"));
  assert.equal(winners.get("LineaOreV9:no-winner"), winners.get("LineaOreV10:no-winner"));
  assert.equal(winners.get("LineaOreV9:empty-rollover"), winners.get("LineaOreV10:empty-rollover"));

  const jackpotEpochs = {
    daily: findJackpotAwardEpoch({
      kind: "daily",
      prevrandao: blockPrevrandao,
      timestamp: blockTimestamp,
      lastCheck: dayStart(blockTimestamp),
      periodEnd: dayStart(blockTimestamp) + DAY_SECONDS,
    }),
    weekly: findJackpotAwardEpoch({
      kind: "weekly",
      prevrandao: blockPrevrandao,
      timestamp: blockTimestamp,
      lastCheck: weekStartMonday(blockTimestamp),
      periodEnd: weekStartMonday(blockTimestamp) + WEEK_SECONDS,
    }),
  } as const;
  const jackpotCheckEpoch = findJackpotNoAwardEpoch(
    blockPrevrandao,
    blockTimestamp,
    blockTimestamp - 1n,
  );
  for (const game of games) {
    const snapshot = await callHarness(
      game,
      "resolveAndSnapshot",
      [EMPTY_SIMULATION_ADDRESS, jackpotCheckEpoch],
      buildJackpotCheckResolveStateDiff(game, blockTimestamp, jackpotCheckEpoch),
    );
    assert.equal(snapshot.currentEpoch, jackpotCheckEpoch + 1n);
    assert.equal(snapshot.totalPool, resolveTotal);
    assert.equal(snapshot.rewardPool, baseReward);
    assert.equal(snapshot.dailyJackpot, false);
    assert.equal(snapshot.weeklyJackpot, false);
    assert.equal(snapshot.dailyPool, dailyAccrual);
    assert.equal(snapshot.weeklyPool, weeklyAccrual);
    assert.equal(snapshot.lastDailyDay, blockTimestamp / DAY_SECONDS - 1n);
    assert.equal(snapshot.lastWeeklyWeek, mondayWeek(blockTimestamp) - 1n);
    assert.equal(snapshot.lastDailyCheckTs, blockTimestamp);
    assert.equal(snapshot.lastWeeklyCheckTs, blockTimestamp);
    assert.equal(
      accountedLiabilities(snapshot),
      resolveTotal,
      `${game.name} non-awarding jackpot checks must conserve the funded pool`,
    );
    winners.set(`${game.name}:jackpot-check-no-award`, BigInt(snapshot.winningTile as bigint));
  }
  assert.equal(
    winners.get("LineaOreV9:jackpot-check-no-award"),
    winners.get("LineaOreV10:jackpot-check-no-award"),
    "non-awarding jackpot check winning tile must remain V9 compatible",
  );
  for (const kind of ["daily", "weekly"] as const) {
    const epoch = jackpotEpochs[kind];
    const initialJackpot = kind === "daily" ? BET_AMOUNT * 7n : BET_AMOUNT * 11n;
    const currentAccrual = kind === "daily" ? dailyAccrual : weeklyAccrual;
    const awardedAmount = initialJackpot + currentAccrual;
    for (const game of games) {
      const snapshot = await callHarness(
        game,
        "resolveAndSnapshot",
        [EMPTY_SIMULATION_ADDRESS, epoch],
        buildJackpotResolveStateDiff(game, blockTimestamp, kind, epoch),
      );
      assert.equal(snapshot.currentEpoch, epoch + 1n);
      assert.equal(snapshot.totalPool, resolveTotal);
      assert.equal(snapshot.rewardPool, baseReward + awardedAmount);
      assert.equal(snapshot.resolved, true);
      assert.equal(snapshot.dailyJackpot, kind === "daily");
      assert.equal(snapshot.weeklyJackpot, kind === "weekly");
      assert.equal(snapshot.rollover, 0n);
      assert.equal(snapshot.dailyPool, kind === "daily" ? 0n : dailyAccrual);
      assert.equal(snapshot.weeklyPool, kind === "weekly" ? 0n : weeklyAccrual);
      assert.equal(snapshot.ownerFees, ownerFees);
      assert.equal(snapshot.burnFees, burnFee);
      assert.equal(snapshot.resolverRewards, resolverReward);
      assert.equal(snapshot.rebatePool, rebatePool);
      assert.equal(snapshot.resolvedAt, blockTimestamp);
      assert.equal(
        accountedLiabilities(snapshot),
        resolveTotal + initialJackpot,
        `${game.name} ${kind} jackpot award must conserve the funded pool and accrued jackpot`,
      );
      if (kind === "daily") {
        assert.equal(snapshot.lastDailyDay, blockTimestamp / DAY_SECONDS);
        assert.equal(snapshot.lastDailyEpoch, epoch);
        assert.equal(snapshot.lastDailyAmount, awardedAmount);
        assert.equal(snapshot.lastDailyCheckTs, blockTimestamp);
      } else {
        assert.equal(snapshot.lastWeeklyWeek, mondayWeek(blockTimestamp));
        assert.equal(snapshot.lastWeeklyEpoch, epoch);
        assert.equal(snapshot.lastWeeklyAmount, awardedAmount);
        assert.equal(snapshot.lastWeeklyCheckTs, blockTimestamp);
      }
      winners.set(`${game.name}:${kind}-jackpot`, BigInt(snapshot.winningTile as bigint));
    }
    assert.equal(
      winners.get(`LineaOreV9:${kind}-jackpot`),
      winners.get(`LineaOreV10:${kind}-jackpot`),
      `${kind} jackpot winning tile must remain V9 compatible`,
    );
  }

  const mutationModes = ["reward", "rebate", "reward-dust", "rebate-dust", "resolver-reward", "fee-flush"] as const;
  for (const game of games) {
    for (let mode = 0; mode < mutationModes.length; mode += 1) {
      const mutationName = mutationModes[mode];
      const snapshot = await callHarness(
        game,
        "mutateAndSnapshot",
        [EMPTY_SIMULATION_ADDRESS, mode, SYNTHETIC_EPOCH],
        buildMutationState(game, blockTimestamp, HARNESS_SIMULATION_ADDRESS, mutationName),
      );
      assert.equal(snapshot.rewardClaimedByCaller, mutationName === "reward");
      assert.equal(snapshot.rebateClaimedByCaller, mutationName === "rebate");
      assert.equal(snapshot.rewardDustSettled, mutationName === "reward-dust");
      assert.equal(snapshot.duplicateRejected, true);
      assert.equal(
        snapshot.rewardClaimedTotal,
        mutationName === "reward" ? BET_AMOUNT * 23n : mutationName === "reward-dust" ? BET_AMOUNT * 20n : 0n,
      );
      assert.equal(
        snapshot.rebateClaimedTotal,
        mutationName === "rebate" ? BET_AMOUNT / 2n : mutationName === "rebate-dust" ? BET_AMOUNT : 0n,
      );
      assert.equal(snapshot.resolverRewards, 0n);
      assert.equal(snapshot.ownerFees, 0n);
      assert.equal(snapshot.burnFees, 0n);
      assert.equal(snapshot.userVolume, mutationName === "rebate" ? BET_AMOUNT * 10n : 0n);
    }
  }

  const exactDustBoundary = blockTimestamp - DUST_SETTLE_DELAY_SECONDS;
  const oneSecondBeforeDustBoundary = exactDustBoundary + 1n;
  for (const game of games) {
    for (const [mutationName, mode] of [
      ["reward", 0],
      ["rebate", 1],
      ["reward-dust", 2],
      ["rebate-dust", 3],
    ] as const) {
      const succeedsAt = mutationName.endsWith("dust")
        ? exactDustBoundary
        : oneSecondBeforeDustBoundary;
      const boundarySnapshot = await callHarness(
        game,
        "mutateAndSnapshot",
        [EMPTY_SIMULATION_ADDRESS, mode, SYNTHETIC_EPOCH],
        buildMutationState(
          game,
          blockTimestamp,
          HARNESS_SIMULATION_ADDRESS,
          mutationName,
          succeedsAt,
        ),
      );
      assert.equal(boundarySnapshot.rewardClaimedByCaller, mutationName === "reward");
      assert.equal(boundarySnapshot.rebateClaimedByCaller, mutationName === "rebate");
      assert.equal(boundarySnapshot.rewardDustSettled, mutationName === "reward-dust");
      assert.equal(boundarySnapshot.duplicateRejected, true);

      const revertsAt = mutationName.endsWith("dust")
        ? oneSecondBeforeDustBoundary
        : exactDustBoundary;
      await expectHarnessRevert(
        game,
        "mutateAndSnapshot",
        [EMPTY_SIMULATION_ADDRESS, mode, SYNTHETIC_EPOCH],
        buildMutationState(
          game,
          blockTimestamp,
          HARNESS_SIMULATION_ADDRESS,
          mutationName,
          revertsAt,
        ),
      );
    }

    for (let mode = 0; mode < mutationModes.length; mode += 1) {
      const mutationName = mutationModes[mode];
      const rejectingState = buildMutationState(
        game,
        blockTimestamp,
        HARNESS_SIMULATION_ADDRESS,
        mutationName,
      );
      if (mutationName === "fee-flush") {
        setDirectStorage(rejectingState, game, "pendingFeeRecipient", BigInt(TOKEN_SIMULATION_ADDRESS));
        setDirectStorage(rejectingState, game, "pendingFeeRecipientEta", blockTimestamp);
      }
      const rollback = await callHarness(
        game,
        "rejectMutationAndSnapshot",
        [EMPTY_SIMULATION_ADDRESS, mode, SYNTHETIC_EPOCH],
        rejectingState,
        diagnostics.rejectingTokenRuntime,
      );
      assert.equal(rollback.rejected, true);
      assert.equal(rollback.rewardClaimedByCaller, false);
      assert.equal(rollback.rebateClaimedByCaller, false);
      assert.equal(rollback.rewardDustSettled, false);
      assert.equal(rollback.rewardClaimedTotal, mutationName === "reward-dust" ? BET_AMOUNT * 20n : 0n);
      assert.equal(rollback.rebateClaimedTotal, mutationName === "rebate-dust" ? BET_AMOUNT / 2n : 0n);
      assert.equal(rollback.resolverRewards, mutationName === "resolver-reward" ? BET_AMOUNT : 0n);
      assert.equal(rollback.ownerFees, mutationName === "fee-flush" ? BET_AMOUNT : 0n);
      assert.equal(rollback.burnFees, mutationName === "fee-flush" ? BET_AMOUNT : 0n);
      assert.equal(getAddress(String(rollback.feeRecipient)), HARNESS_SIMULATION_ADDRESS);
      assert.equal(
        getAddress(String(rollback.pendingFeeRecipient)),
        mutationName === "fee-flush" ? TOKEN_SIMULATION_ADDRESS : ZERO_ADDRESS,
      );
      assert.equal(rollback.pendingFeeRecipientEta, mutationName === "fee-flush" ? blockTimestamp : 0n);
    }

    const rejectedBet = await callHarness(
      game,
      "rejectBetAndSnapshot",
      [EMPTY_SIMULATION_ADDRESS, 0b10101, BET_AMOUNT],
      buildClockStateDiff(game, blockTimestamp),
      diagnostics.rejectingTokenRuntime,
    );
    assert.equal(rejectedBet.currentEpoch, SYNTHETIC_EPOCH);
    assert.equal(rejectedBet.totalPool, 0n);
    assert.equal(rejectedBet.userVolume, 0n);
    assert.ok((rejectedBet.pools as bigint[]).every((value) => value === 0n));
    assert.ok((rejectedBet.bets as bigint[]).every((value) => value === 0n));

    const mixedEpochs = [
      SYNTHETIC_EPOCH,
      SYNTHETIC_EPOCH + 1n,
      SYNTHETIC_EPOCH,
      SYNTHETIC_EPOCH + 2n,
    ];
    for (const [mutationName, mode] of [
      ["reward", 0],
      ["rebate", 1],
      ["reward-dust", 2],
      ["rebate-dust", 3],
    ] as const) {
      const mixedState = buildMixedBatchMutationState(
        game,
        blockTimestamp,
        HARNESS_SIMULATION_ADDRESS,
        mutationName,
      );
      const mixedBatch = await callHarness(
        game,
        "mutateBatchAndSnapshot",
        [EMPTY_SIMULATION_ADDRESS, mode, mixedEpochs],
        mixedState,
      );
      assert.equal(mixedBatch.rewardClaimedByCaller, mutationName === "reward");
      assert.equal(mixedBatch.rebateClaimedByCaller, mutationName === "rebate");
      assert.equal(mixedBatch.rewardDustSettled, mutationName === "reward-dust");
      assert.equal(mixedBatch.duplicateRejected, true);
      assert.equal(
        mixedBatch.rewardClaimedTotal,
        mutationName === "reward" ? BET_AMOUNT * 23n : mutationName === "reward-dust" ? BET_AMOUNT * 20n : 0n,
      );
      assert.equal(
        mixedBatch.rebateClaimedTotal,
        mutationName === "rebate" ? BET_AMOUNT / 2n : mutationName === "rebate-dust" ? BET_AMOUNT : 0n,
      );

      const batchRollback = await callHarness(
        game,
        "rejectBatchMutationAndSnapshot",
        [EMPTY_SIMULATION_ADDRESS, mode, mixedEpochs],
        mixedState,
        diagnostics.rejectingTokenRuntime,
      );
      assert.equal(batchRollback.rejected, true);
      assert.equal(batchRollback.rewardClaimedByCaller, false);
      assert.equal(batchRollback.rebateClaimedByCaller, false);
      assert.equal(batchRollback.rewardDustSettled, false);
      assert.equal(
        batchRollback.rewardClaimedTotal,
        mutationName === "reward-dust" ? BET_AMOUNT * 20n : 0n,
      );
      assert.equal(
        batchRollback.rebateClaimedTotal,
        mutationName === "rebate-dust" ? BET_AMOUNT / 2n : 0n,
      );
    }
  }

  const legacyGame = games.find(({ name }) => name === "LineaOreV9");
  const candidateGame = games.find(({ name }) => name === "LineaOreV10");
  assert.ok(legacyGame && candidateGame, "both benchmark contracts are required");

  const deployment = await callHarness(
    candidateGame,
    "deployAndSnapshot",
    [candidateGame.creationCode, TOKEN_SIMULATION_ADDRESS, sender, sender],
    buildClockStateDiff(candidateGame, blockTimestamp),
  );
  assert.equal(String(deployment.runtimeCodeHash), keccak256(candidateGame.runtimeCode));
  assert.equal(deployment.runtimeCodeLength, BigInt((candidateGame.runtimeCode.length - 2) / 2));
  assert.equal(getAddress(String(deployment.tokenAddress)), TOKEN_SIMULATION_ADDRESS);
  assert.equal(getAddress(String(deployment.owner)), sender);
  assert.equal(getAddress(String(deployment.pendingOwner)), ZERO_ADDRESS);
  assert.equal(getAddress(String(deployment.feeRecipient)), sender);
  assert.equal(deployment.currentEpoch, 1n);
  assert.equal(deployment.epochDuration, 60n);
  assert.equal(deployment.epochStartTime, blockTimestamp);
  assert.equal(deployment.epochOneTotalPool, 0n);
  assert.equal(deployment.epochOneResolved, false);
  assert.equal(deployment.rollover, 0n);
  assert.equal(deployment.dailyPool, 0n);
  assert.equal(deployment.weeklyPool, 0n);
  assert.equal(deployment.ownerFees, 0n);
  assert.equal(deployment.burnFees, 0n);
  assert.equal(deployment.pendingDuration, 0n);
  assert.equal(deployment.pendingDurationEta, 0n);
  assert.equal(deployment.pendingDurationEpoch, 0n);
  assert.equal(getAddress(String(deployment.pendingRecipient)), ZERO_ADDRESS);
  assert.equal(deployment.pendingRecipientEta, 0n);

  const epochBoundBet = await callHarness(
    candidateGame,
    "betTwiceForEpoch",
    [EMPTY_SIMULATION_ADDRESS, SYNTHETIC_EPOCH, mask, BET_AMOUNT],
    buildClockStateDiff(candidateGame, blockTimestamp),
  );
  assertBetSnapshot(candidateGame, epochBoundBet, false);
  await expectHarnessRevert(
    candidateGame,
    "betTwiceForEpoch",
    [EMPTY_SIMULATION_ADDRESS, SYNTHETIC_EPOCH - 1n, mask, BET_AMOUNT],
    buildClockStateDiff(candidateGame, blockTimestamp),
  );
  const protectedGraceStart = blockTimestamp - SYNTHETIC_DURATION + 1n;
  await expectHarnessRevert(
    candidateGame,
    "betTwiceForEpoch",
    [EMPTY_SIMULATION_ADDRESS, SYNTHETIC_EPOCH, mask, BET_AMOUNT],
    buildClockStateDiff(candidateGame, protectedGraceStart),
  );
  await expectHarnessRevert(
    candidateGame,
    "betTwiceForEpoch",
    [EMPTY_SIMULATION_ADDRESS, SYNTHETIC_EPOCH, mask, BET_AMOUNT],
    buildResolveStateDiff(candidateGame, blockTimestamp, "funded-no-winner"),
  );
  const emptyEpochAdvanceBet = await callHarness(
    candidateGame,
    "betAfterExpiredEmptyEpoch",
    [EMPTY_SIMULATION_ADDRESS, SYNTHETIC_EPOCH, mask, BET_AMOUNT],
    buildResolveStateDiff(candidateGame, blockTimestamp, "empty"),
  );
  assertBetSnapshot(candidateGame, emptyEpochAdvanceBet, true, 1n);

  const fullPrecisionPool = 1n << 255n;
  await expectHarnessRevert(
    legacyGame,
    "resolveAndSnapshot",
    [EMPTY_SIMULATION_ADDRESS, SYNTHETIC_EPOCH],
    buildFullPrecisionResolveState(legacyGame, blockTimestamp),
  );
  const fullPrecisionResolve = await callHarness(
    candidateGame,
    "resolveAndSnapshot",
    [EMPTY_SIMULATION_ADDRESS, SYNTHETIC_EPOCH],
    buildFullPrecisionResolveState(candidateGame, blockTimestamp),
  );
  const fullPrecisionProtocolFee = (fullPrecisionPool * 2n) / 100n;
  const fullPrecisionResolverReward = (fullPrecisionPool * 5n) / 10_000n;
  const fullPrecisionRebatePool = (fullPrecisionProtocolFee - fullPrecisionResolverReward) / 2n;
  const fullPrecisionOwnerFees = fullPrecisionProtocolFee - fullPrecisionResolverReward - fullPrecisionRebatePool;
  const fullPrecisionBaseReward = fullPrecisionPool
    - (fullPrecisionPool * 2n) / 100n
    - (fullPrecisionPool * 3n) / 100n
    - fullPrecisionProtocolFee
    - (fullPrecisionPool * 1n) / 100n;
  assert.equal(fullPrecisionResolve.totalPool, fullPrecisionPool);
  assert.equal(fullPrecisionResolve.rollover, fullPrecisionBaseReward);
  assert.equal(fullPrecisionResolve.ownerFees, fullPrecisionOwnerFees);
  assert.equal(fullPrecisionResolve.resolverRewards, fullPrecisionResolverReward);
  assert.equal(fullPrecisionResolve.rebatePool, fullPrecisionRebatePool);
  assert.equal(
    accountedLiabilities(fullPrecisionResolve),
    fullPrecisionPool,
    "V10 full-precision resolve must conserve the full funded pool",
  );

  for (const [mode, mutationIndex, expectedClaimed] of [
    ["reward", 0, 1n << 199n],
    ["rebate", 1, 1n << 209n],
  ] as const) {
    await expectHarnessRevert(
      legacyGame,
      "mutateAndSnapshot",
      [EMPTY_SIMULATION_ADDRESS, mutationIndex, SYNTHETIC_EPOCH],
      buildFullPrecisionMutationState(legacyGame, blockTimestamp, HARNESS_SIMULATION_ADDRESS, mode),
    );
    const snapshot = await callHarness(
      candidateGame,
      "mutateAndSnapshot",
      [EMPTY_SIMULATION_ADDRESS, mutationIndex, SYNTHETIC_EPOCH],
      buildFullPrecisionMutationState(candidateGame, blockTimestamp, HARNESS_SIMULATION_ADDRESS, mode),
    );
    assert.equal(mode === "reward" ? snapshot.rewardClaimedTotal : snapshot.rebateClaimedTotal, expectedClaimed);
    assert.equal(snapshot.duplicateRejected, true);
  }

  const feeFlushEpoch = 120n;
  const feeFlushState = buildResolveStateDiff(
    candidateGame,
    blockTimestamp,
    "funded-no-winner",
    feeFlushEpoch,
  );
  setDirectStorage(feeFlushState, candidateGame, "feeRecipient", BigInt(HARNESS_SIMULATION_ADDRESS));
  setDirectStorage(feeFlushState, candidateGame, "accruedOwnerFees", BET_AMOUNT);
  setDirectStorage(feeFlushState, candidateGame, "accruedBurnFees", BET_AMOUNT);
  const feeFlushSnapshot = await callHarness(
    candidateGame,
    "resolveAndSnapshot",
    [EMPTY_SIMULATION_ADDRESS, feeFlushEpoch],
    feeFlushState,
  );
  assert.equal(feeFlushSnapshot.currentEpoch, feeFlushEpoch + 1n);
  assert.equal(feeFlushSnapshot.resolved, true);
  assert.ok((feeFlushSnapshot.ownerFees as bigint) > BET_AMOUNT);
  assert.ok((feeFlushSnapshot.burnFees as bigint) > BET_AMOUNT);
  const rejectingTokenResolveSnapshot = await callHarness(
    candidateGame,
    "resolveAndSnapshot",
    [EMPTY_SIMULATION_ADDRESS, feeFlushEpoch],
    feeFlushState,
    diagnostics.rejectingTokenRuntime,
  );
  assert.equal(rejectingTokenResolveSnapshot.currentEpoch, feeFlushEpoch + 1n);
  assert.equal(rejectingTokenResolveSnapshot.resolved, true);
  assert.equal(rejectingTokenResolveSnapshot.ownerFees, feeFlushSnapshot.ownerFees);
  assert.equal(rejectingTokenResolveSnapshot.burnFees, feeFlushSnapshot.burnFees);

  return {
    status: "passed",
    contracts: games.length,
    successfulStateTransitions: games.length * (33 + mutationModes.length) + 8 + betEntrypointSuccesses,
    expectedBoundaryReverts: games.length * (34 + mutationModes.length) + 8,
    duplicateMutationReverts: games.length * (mutationModes.length + 4),
    atomicRollbackReverts: games.length * (mutationModes.length + 5) - 1 + betEntrypointRollbackReverts,
    unauthorizedAdminReverts: games.length * 6,
    mixedBatchCases: games.length * 4,
    frontendViewCases,
    betEntrypointSuccesses,
    betEntrypointRollbackReverts,
    deploymentRehearsal: "exact-creation/runtime-hash/immutables/owner/fee-recipient/clock/zero-accounting",
    accountingConservation: "funded-winner/funded-no-winner/empty-rollover/jackpot-check-no-award/daily-jackpot/weekly-jackpot/full-precision",
    adminControls: "two-step-cancel/accept/unauthorized-reject/timelock-schedule-cancel/apply-ready/preserve-not-ready/invalid-input/self-recipient-reject/renounce-disabled",
    claimDustBoundary: "claim-until-last-second/dust-from-exact-delay",
    failedTokenRollback: "all-bet-selectors/expired-empty-auto-advance/single-and-batch-reward/rebate/reward-dust/rebate-dust/resolver/fee-flush",
    betEntrypointSemantics: "exact-tile-pools/user-bets/user-volume/all-five-v10-selectors/all-four-v9-selectors",
    frontendViewCompatibility: "epoch-end/jackpot-aggregate/rebate-preview-info-summary/duplicate-preview/exact-expiry",
    fullPrecisionTransitions: 3,
    legacyOverflowReverts: 3,
    feeFlushBoundary: "resolve-accrues-with-rejecting-token/explicit-standard-pass/explicit-rejecting-revert",
    epochBoundBet: "active-pass/expired-empty-advance/stale-closing-funded-expired-revert",
    reentrancyProbe: "transferFrom-and-transfer-blocked/reset-after-success/reset-after-caught-revert",
  };
}

async function main() {
  if (process.argv.includes("--diagnostics-only")) {
    const diagnostics = compileDiagnosticContracts();
    const canonicalV10 = compileContract(
      "contracts/LineaOreV10.sol",
      "LineaOreV10",
      TOKEN_SIMULATION_ADDRESS,
      v10CompilerConfig.settings.optimizer.runs,
      v10CompilerConfig.settings.viaIR,
      solc,
      false,
    );
    const withAutoFlushV10 = compileContract(
      "contracts/LineaOreV10.sol",
      "LineaOreV10",
      TOKEN_SIMULATION_ADDRESS,
      v10CompilerConfig.settings.optimizer.runs,
      v10CompilerConfig.settings.viaIR,
      solc,
      true,
    );
    const duplicateResolveGuardV10 = compileContract(
      "contracts/LineaOreV10.sol",
      "LineaOreV10",
      TOKEN_SIMULATION_ADDRESS,
      v10CompilerConfig.settings.optimizer.runs,
      v10CompilerConfig.settings.viaIR,
      solc,
      false,
      true,
    );
    assert.deepEqual(withAutoFlushV10.abi, canonicalV10.abi, "automatic-flush policy variant changed the ABI");
    assert.deepEqual(duplicateResolveGuardV10.abi, canonicalV10.abi, "duplicate resolve-guard variant changed the ABI");
    const semanticStorageLayout = (entries: StorageEntry[]) => entries.map(({ label, slot, offset, type }) => ({
      label,
      slot,
      offset,
      type,
    }));
    assert.deepEqual(
      semanticStorageLayout(withAutoFlushV10.storage),
      semanticStorageLayout(canonicalV10.storage),
      "automatic-flush policy variant changed the storage layout",
    );
    assert.deepEqual(
      semanticStorageLayout(duplicateResolveGuardV10.storage),
      semanticStorageLayout(canonicalV10.storage),
      "duplicate resolve-guard variant changed the storage layout",
    );
    const canonicalCreationBytes = (canonicalV10.creationCode.length - 2) / 2;
    const canonicalRuntimeBytes = (canonicalV10.runtimeCode.length - 2) / 2;
    const withAutoFlushCreationBytes = (withAutoFlushV10.creationCode.length - 2) / 2;
    const withAutoFlushRuntimeBytes = (withAutoFlushV10.runtimeCode.length - 2) / 2;
    const duplicateResolveGuardCreationBytes = (duplicateResolveGuardV10.creationCode.length - 2) / 2;
    const duplicateResolveGuardRuntimeBytes = (duplicateResolveGuardV10.runtimeCode.length - 2) / 2;
    assert.ok(canonicalCreationBytes < withAutoFlushCreationBytes, "explicit-flush canonical must reduce creation size");
    assert.ok(canonicalRuntimeBytes < withAutoFlushRuntimeBytes, "explicit-flush canonical must reduce runtime size");
    assert.ok(
      canonicalCreationBytes < duplicateResolveGuardCreationBytes,
      "canonical single resolve guard must reduce creation size",
    );
    assert.ok(
      canonicalRuntimeBytes < duplicateResolveGuardRuntimeBytes,
      "canonical single resolve guard must reduce runtime size",
    );
    const harnessFunctions = diagnostics.harnessAbi
      .filter((entry) => entry.type === "function")
      .map((entry) => entry.name);
    assert.ok(
      harnessFunctions.includes("rejectThenBetAndSnapshot"),
      "Diagnostic harness must include the caught-revert transient-guard probe",
    );
    for (const [name, runtime] of [
      ["StateHarness", diagnostics.harnessRuntime],
      ["RejectingTransferToken", diagnostics.rejectingTokenRuntime],
      ["StandardTransferToken", diagnostics.standardTokenRuntime],
      ["ReentrancyProbeToken", diagnostics.reentrancyTokenRuntime],
    ] as const) {
      assert.ok(runtime.length > 2, `${name} diagnostic runtime must not be empty`);
    }
    console.log(JSON.stringify({
      status: "passed",
      compilerVersion: solc.version(),
      transactionSent: false,
      rpcUsed: false,
      environmentFilesLoaded: false,
      harnessFunctions: harnessFunctions.length,
      probes: [
        "caught-revert-then-valid-bet",
        "inbound-transferFrom-reentry",
        "outbound-transfer-reentry",
      ],
      tokenRoles: {
        gasBaseline: "StandardTransferToken",
        behaviorProbe: "ReentrancyProbeToken",
        rollbackProbe: "RejectingTransferToken",
      },
      automaticFlushPolicy: {
        abiEqual: true,
        storageLayoutEqual: true,
        canonical: {
          creationBytes: canonicalCreationBytes,
          runtimeBytes: canonicalRuntimeBytes,
        },
        automaticFlushVariant: {
          creationBytes: withAutoFlushCreationBytes,
          runtimeBytes: withAutoFlushRuntimeBytes,
        },
        delta: {
          creationBytes: canonicalCreationBytes - withAutoFlushCreationBytes,
          runtimeBytes: canonicalRuntimeBytes - withAutoFlushRuntimeBytes,
        },
      },
      resolveGuardPolicy: {
        abiEqual: true,
        storageLayoutEqual: true,
        canonical: {
          creationBytes: canonicalCreationBytes,
          runtimeBytes: canonicalRuntimeBytes,
        },
        duplicateExternalGuard: {
          creationBytes: duplicateResolveGuardCreationBytes,
          runtimeBytes: duplicateResolveGuardRuntimeBytes,
        },
        delta: {
          creationBytes: canonicalCreationBytes - duplicateResolveGuardCreationBytes,
          runtimeBytes: canonicalRuntimeBytes - duplicateResolveGuardRuntimeBytes,
        },
      },
    }));
    return;
  }

  const deploymentOnly = process.argv.includes("--deployment-only");
  const behaviorOnly = process.argv.includes("--behavior-only");
  loadDotenv({ path: ".env.local", override: false, quiet: true });
  loadDotenv({ path: ".env", override: false, quiet: true });
  const network = getConfiguredLineaNetwork();
  const chain = getLineaChain(network);
  const contractAddress = getAddress(getConfiguredContractAddress(process.env.NEXT_PUBLIC_CONTRACT_ADDRESS, network));
  const tokenAddress = getAddress(getConfiguredLineaTokenAddress(process.env.NEXT_PUBLIC_LINEA_TOKEN_ADDRESS, network));
  const rpcUrls = getStableLineaReadRpcs(process.env.LIVE_TEST_RPC_URL ?? process.env.NEXT_PUBLIC_LINEA_RPCS, network);
  const publicClient = createPublicClient({
    chain,
    transport: fallback(rpcUrls.map((url) => http(url, { timeout: 20_000, retryCount: 0 }))),
  });
  const latestBlock = await publicClient.getBlock({ blockTag: "latest" });
  if (!latestBlock.mixHash) throw new Error("Latest Linea block is missing the prevrandao/mixHash field");
  if (behaviorOnly) {
    const behaviorChecks = await withBenchmarkTimeout(
      runBehaviorChecks({
        rpcUrls,
        sender: CALLER_SIMULATION_ADDRESS,
        blockNumber: latestBlock.number,
        blockTimestamp: latestBlock.timestamp,
        blockPrevrandao: BigInt(latestBlock.mixHash),
      }),
      BEHAVIOR_ONLY_TIMEOUT_MS,
      "behavior-benchmark-timeout",
    );
    console.log(JSON.stringify({
      status: "passed",
      transactionSent: false,
      signingUsed: false,
      accountInput: "fixed-simulation-caller",
      behaviorChecks,
    }));
    return;
  }
  const accountAddresses = configuredAccountAddresses();
  if (accountAddresses.length === 0) {
    reportAccountReadiness("no-configured-account", completeAccountReadiness([]));
    throw new Error("No configured live-test public address is available for read-only estimation");
  }

  const requiredAmount = BET_AMOUNT * 25n;
  let sender: Address | undefined;
  if (deploymentOnly) {
    const nativeBalances = await Promise.all(accountAddresses.map(async ({ role, address }) => ({
      role,
      address,
      balance: await publicClient.getBalance({ address }),
    })));
    sender = nativeBalances
      .filter(({ balance }) => balance > 0n)
      .sort((left, right) => left.balance === right.balance ? 0 : left.balance > right.balance ? -1 : 1)[0]?.address;
    if (!sender) {
      reportAccountReadiness(
        "deployment-account-not-ready",
        completeAccountReadiness(
          nativeBalances.map(({ role, balance }) => ({
            role,
            configured: true,
            nativeBalanceReady: balance > 0n,
            eligible: balance > 0n,
          })),
        ),
      );
      throw new Error("No configured public address has native balance for deployment estimation");
    }
  } else {
    const accountReadiness: AccountReadiness[] = [];
    for (const { role, address } of accountAddresses) {
      const [balance, allowance] = await Promise.all([
        publicClient.readContract({ address: tokenAddress, abi: TOKEN_ABI, functionName: "balanceOf", args: [address] }),
        publicClient.readContract({ address: tokenAddress, abi: TOKEN_ABI, functionName: "allowance", args: [address, contractAddress] }),
      ]);
      const balanceReady = balance >= requiredAmount;
      const allowanceReady = allowance >= requiredAmount;
      accountReadiness.push({
        role,
        configured: true,
        tokenBalanceReady: balanceReady,
        allowanceReady,
        eligible: balanceReady && allowanceReady,
      });
      if (balanceReady && allowanceReady) {
        sender = address;
        break;
      }
    }
    if (!sender) {
      reportAccountReadiness("token-account-not-ready", completeAccountReadiness(accountReadiness));
      throw new Error("No configured account has sufficient token balance and allowance for transaction-free estimates");
    }
  }

  const jackpotCheckEpoch = findJackpotNoAwardEpoch(
    BigInt(latestBlock.mixHash),
    latestBlock.timestamp,
    latestBlock.timestamp - 1n,
  );
  const jackpotAwardEpochs = {
    daily: findJackpotAwardEpoch({
      kind: "daily",
      prevrandao: BigInt(latestBlock.mixHash),
      timestamp: latestBlock.timestamp,
      lastCheck: dayStart(latestBlock.timestamp),
      periodEnd: dayStart(latestBlock.timestamp) + DAY_SECONDS,
    }),
    weekly: findJackpotAwardEpoch({
      kind: "weekly",
      prevrandao: BigInt(latestBlock.mixHash),
      timestamp: latestBlock.timestamp,
      lastCheck: weekStartMonday(latestBlock.timestamp),
      periodEnd: weekStartMonday(latestBlock.timestamp) + WEEK_SECONDS,
    }),
  } as const;
  const senderNonce = await publicClient.getTransactionCount({ address: sender, blockNumber: latestBlock.number });
  const predictedDeploymentAddress = getContractAddress({ from: sender, nonce: BigInt(senderNonce) });
  const behaviorChecks = deploymentOnly
    ? { status: "skipped", reason: "deployment-only preflight" }
    : V10_WITH_AUTO_FLUSH
    ? { status: "skipped", reason: "in-memory automatic-flush regression variant; canonical behavior gate remains authoritative" }
    : await runBehaviorChecks({
      rpcUrls,
      sender,
      blockNumber: latestBlock.number,
      blockTimestamp: latestBlock.timestamp,
      blockPrevrandao: BigInt(latestBlock.mixHash),
    });
  const contracts = CONTRACTS.map((entry) => compileContract(
    entry.path,
    entry.name,
    tokenAddress,
    entry.name === "LineaOreV10" ? V10_OPTIMIZER_RUNS : 200,
    entry.name === "LineaOreV10" ? V10_VIA_IR : false,
    entry.name === "LineaOreV10" ? solc : legacySolc,
  ));
  const diagnosticContracts = compileDiagnosticContracts();
  const mutationContracts = CONTRACTS.map((entry) => compileContract(
    entry.path,
    entry.name,
    TOKEN_SIMULATION_ADDRESS,
    entry.name === "LineaOreV10" ? V10_OPTIMIZER_RUNS : 200,
    entry.name === "LineaOreV10" ? V10_VIA_IR : false,
    entry.name === "LineaOreV10" ? solc : legacySolc,
  ));
  const cases = [
    { mode: "single", tiles: 1, data: encodeFunctionData({ abi: GAME_ABI, functionName: "placeBet", args: [1n, BET_AMOUNT] }) },
    { mode: "arrays", tiles: 3, data: encodeFunctionData({ abi: GAME_ABI, functionName: "placeBatchBets", args: [[1n, 2n, 3n], [BET_AMOUNT, BET_AMOUNT, BET_AMOUNT]] }) },
    { mode: "bitmap", tiles: 3, data: encodeFunctionData({ abi: GAME_ABI, functionName: "placeBatchBetsBitmap", args: [0b111, BET_AMOUNT] }) },
    { mode: "bitmap-sparse", tiles: 3, data: encodeFunctionData({ abi: GAME_ABI, functionName: "placeBatchBetsBitmap", args: [0x1001001, BET_AMOUNT] }) },
    { mode: "sameAmount", tiles: 3, data: encodeFunctionData({ abi: GAME_ABI, functionName: "placeBatchBetsSameAmount", args: [[1n, 2n, 3n], BET_AMOUNT] }) },
    { mode: "bitmap", tiles: 5, data: encodeFunctionData({ abi: GAME_ABI, functionName: "placeBatchBetsBitmap", args: [0b1_1111, BET_AMOUNT] }) },
    { mode: "bitmap-sparse", tiles: 5, data: encodeFunctionData({ abi: GAME_ABI, functionName: "placeBatchBetsBitmap", args: [0x1041041, BET_AMOUNT] }) },
    { mode: "bitmap", tiles: 25, data: encodeFunctionData({ abi: GAME_ABI, functionName: "placeBatchBetsBitmap", args: [0x1ff_ffff, BET_AMOUNT] }) },
  ] as const;
  const epochBoundCases = [
    { mode: "bitmap", tiles: 1, mask: 0b1 },
    { mode: "bitmap", tiles: 3, mask: 0b111 },
    { mode: "bitmap-sparse", tiles: 3, mask: 0x1001001 },
    { mode: "bitmap-sparse", tiles: 5, mask: 0x1041041 },
    { mode: "bitmap", tiles: 25, mask: 0x1ff_ffff },
  ] as const;
  const rows: BenchmarkRow[] = [];

  const v10Contract = contracts.find(({ name }) => name === "LineaOreV10");
  assert.ok(v10Contract, "V10 constructor checks require the compiled candidate");
  const invalidConstructorCases: Array<{
    label: string;
    args: readonly [Address, Address, Address];
  }> = [
    { label: "zero token", args: [ZERO_ADDRESS, sender, sender] },
    { label: "token without code", args: [sender, sender, sender] },
    { label: "zero owner", args: [tokenAddress, ZERO_ADDRESS, sender] },
    { label: "self owner", args: [tokenAddress, predictedDeploymentAddress, sender] },
    { label: "zero fee recipient", args: [tokenAddress, sender, ZERO_ADDRESS] },
    { label: "self fee recipient", args: [tokenAddress, sender, predictedDeploymentAddress] },
  ];
  for (const testCase of invalidConstructorCases) {
    const invalidArgs = encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "address" }],
      testCase.args,
    );
    await expectRpcExecutionRevert(
      () => rpcRequest<Hex>(rpcUrls, "eth_call", [{
        from: sender,
        data: `${v10Contract.creationCode}${invalidArgs.slice(2)}` as Hex,
        gas: toHex(20_000_000n),
      }, toHex(latestBlock.number)]),
      `LineaOreV10 constructor with ${testCase.label}`,
    );
  }
  const constructorValidation = {
    status: "passed",
    expectedReverts: invalidConstructorCases.length,
  };

  const expectedTokenRaw = process.env.V10_EXPECTED_TOKEN_ADDRESS?.trim();
  const expectedOwnerRaw = process.env.V10_EXPECTED_INITIAL_OWNER?.trim();
  const expectedFeeRecipientRaw = process.env.V10_EXPECTED_INITIAL_FEE_RECIPIENT?.trim();
  if (deploymentOnly && (!expectedTokenRaw || !expectedOwnerRaw || !expectedFeeRecipientRaw)) {
    throw new Error("--deployment-only requires all three V10_EXPECTED constructor addresses");
  }
  if (deploymentOnly && getAddress(expectedTokenRaw!) !== tokenAddress) {
    throw new Error("V10_EXPECTED_TOKEN_ADDRESS must match the configured token");
  }
  const deploymentOwner = deploymentOnly ? getAddress(expectedOwnerRaw!) : sender;
  const deploymentFeeRecipient = deploymentOnly ? getAddress(expectedFeeRecipientRaw!) : sender;
  const constructorArgs = encodeAbiParameters(
    [{ type: "address" }, { type: "address" }, { type: "address" }],
    [tokenAddress, deploymentOwner, deploymentFeeRecipient],
  );
  const canonicalInitCode = `${v10Contract.creationCode}${constructorArgs.slice(2)}`.toLowerCase() as Hex;
  if (deploymentOnly) {
    const preparedInitCode = readBoundedUtf8File(
      ".tmp/v10-canonical-initcode.hex",
      MAX_PREPARED_INITCODE_BYTES,
      "prepared V10 initcode",
    ).trim().toLowerCase();
    assert.equal(preparedInitCode, canonicalInitCode, "prepared V10 initcode does not match the benchmark compiler and constructor values");
  }
  for (const contract of contracts) {
    const estimate = await rpcRequest<EstimateResult>(rpcUrls, "linea_estimateGas", [{
      from: sender,
      data: `${contract.creationCode}${constructorArgs.slice(2)}` as Hex,
      gas: toHex(20_000_000n),
    }]);
    const gasLimit = BigInt(estimate.gasLimit);
    const gasLimitNumber = toSafeDisplayInteger(gasLimit, `${contract.name} deployment gas limit`);
    const baseFeePerGas = BigInt(estimate.baseFeePerGas);
    const priorityFeePerGas = BigInt(estimate.priorityFeePerGas);
    rows.push({
      contract: contract.name,
      operation: "deploy",
      mode: "constructor",
      tiles: 0,
      gasLimit: gasLimitNumber,
      baseFeePerGas: baseFeePerGas.toString(),
      priorityFeePerGas: priorityFeePerGas.toString(),
      estimatedFeeWei: (gasLimit * (baseFeePerGas + priorityFeePerGas)).toString(),
    });
  }

  if (deploymentOnly) {
    const v9Deployment = rows.find((row) => row.contract === "LineaOreV9");
    const v10Deployment = rows.find((row) => row.contract === "LineaOreV10");
    assert.ok(v9Deployment && v10Deployment, "deployment-only preflight requires both V9 and V10 estimates");
    const v9Gas = v9Deployment.gasLimit;
    const v10Gas = v10Deployment.gasLimit;
    console.log(JSON.stringify({
      status: "passed",
      network,
      chainId: chain.id,
      blockNumber: latestBlock.number.toString(),
      compilerVersion: solc.version(),
      method: "linea_estimateGas",
      transactionSent: false,
      accountInput: "public-address-only",
      preparedInitCodeMatch: true,
      constructorValidation,
      deployments: rows,
      v10DeltaVsV9: v10Gas - v9Gas,
      v10DeltaPercentVsV9: Number((((v10Gas - v9Gas) / v9Gas) * 100).toFixed(2)),
    }));
    return;
  }

  for (const contract of contracts) {
    const stateDiff = buildClockStateDiff(contract, latestBlock.timestamp);
    for (const testCase of cases) {
      const estimate = await rpcRequest<EstimateResult>(rpcUrls, "linea_estimateGas", [
        {
          from: sender,
          to: contractAddress,
          data: testCase.data,
          gas: toHex(10_000_000n),
        },
        {
          [contractAddress]: {
            code: contract.runtimeCode,
            stateDiff,
          },
        },
      ]);
      rows.push({
        contract: contract.name,
        operation: "bet",
        mode: testCase.mode,
        tiles: testCase.tiles,
        gasLimit: toSafeDisplayInteger(BigInt(estimate.gasLimit), `${contract.name} ${testCase.mode} gas limit`),
        baseFeePerGas: BigInt(estimate.baseFeePerGas).toString(),
        priorityFeePerGas: BigInt(estimate.priorityFeePerGas).toString(),
      });
    }
    for (const scenario of ["empty", "funded-no-winner", "winner-25-funded-tiles"] as const) {
      const estimate = await rpcRequest<EstimateResult>(rpcUrls, "linea_estimateGas", [
        {
          from: sender,
          to: EMPTY_SIMULATION_ADDRESS,
          data: encodeFunctionData({ abi: GAME_ABI, functionName: "resolveEpoch", args: [SYNTHETIC_EPOCH] }),
          gas: toHex(10_000_000n),
        },
        {
          [EMPTY_SIMULATION_ADDRESS]: {
            code: contract.runtimeCode,
            stateDiff: buildResolveStateDiff(contract, latestBlock.timestamp, scenario),
          },
        },
      ]);
      rows.push({
        contract: contract.name,
        operation: "resolve",
        mode: scenario,
        tiles: scenario === "winner-25-funded-tiles" ? 25 : 0,
        gasLimit: toSafeDisplayInteger(BigInt(estimate.gasLimit), `${contract.name} resolve ${scenario} gas limit`),
        baseFeePerGas: BigInt(estimate.baseFeePerGas).toString(),
        priorityFeePerGas: BigInt(estimate.priorityFeePerGas).toString(),
      });
    }
    const jackpotCheckEstimate = await rpcRequest<EstimateResult>(rpcUrls, "linea_estimateGas", [
      {
        from: sender,
        to: EMPTY_SIMULATION_ADDRESS,
        data: encodeFunctionData({ abi: GAME_ABI, functionName: "resolveEpoch", args: [jackpotCheckEpoch] }),
        gas: toHex(10_000_000n),
      },
      {
        [EMPTY_SIMULATION_ADDRESS]: {
          code: contract.runtimeCode,
          stateDiff: buildJackpotCheckResolveStateDiff(contract, latestBlock.timestamp, jackpotCheckEpoch),
        },
      },
    ]);
    rows.push({
      contract: contract.name,
      operation: "resolve",
      mode: "jackpot-check-no-award",
      tiles: 25,
      gasLimit: toSafeDisplayInteger(BigInt(jackpotCheckEstimate.gasLimit), `${contract.name} jackpot check gas limit`),
      baseFeePerGas: BigInt(jackpotCheckEstimate.baseFeePerGas).toString(),
      priorityFeePerGas: BigInt(jackpotCheckEstimate.priorityFeePerGas).toString(),
    });
    for (const kind of ["daily", "weekly"] as const) {
      const epoch = jackpotAwardEpochs[kind];
      const jackpotAwardEstimate = await rpcRequest<EstimateResult>(rpcUrls, "linea_estimateGas", [
        {
          from: sender,
          to: EMPTY_SIMULATION_ADDRESS,
          data: encodeFunctionData({ abi: GAME_ABI, functionName: "resolveEpoch", args: [epoch] }),
          gas: toHex(10_000_000n),
        },
        {
          [EMPTY_SIMULATION_ADDRESS]: {
            code: contract.runtimeCode,
            stateDiff: buildJackpotResolveStateDiff(contract, latestBlock.timestamp, kind, epoch),
          },
        },
      ]);
      rows.push({
        contract: contract.name,
        operation: "resolve",
        mode: `${kind}-jackpot-award`,
        tiles: 25,
        gasLimit: toSafeDisplayInteger(BigInt(jackpotAwardEstimate.gasLimit), `${contract.name} ${kind} jackpot gas limit`),
        baseFeePerGas: BigInt(jackpotAwardEstimate.baseFeePerGas).toString(),
        priorityFeePerGas: BigInt(jackpotAwardEstimate.priorityFeePerGas).toString(),
      });
    }
  }

  const epochBoundStateDiff = buildClockStateDiff(v10Contract, latestBlock.timestamp);
  for (const testCase of epochBoundCases) {
    const estimate = await rpcRequest<EstimateResult>(rpcUrls, "linea_estimateGas", [
      {
        from: sender,
        to: contractAddress,
        data: encodeFunctionData({
          abi: GAME_ABI,
          functionName: "placeBatchBetsBitmapForEpoch",
          args: [SYNTHETIC_EPOCH, testCase.mask, BET_AMOUNT],
        }),
        gas: toHex(10_000_000n),
      },
      {
        [contractAddress]: {
          code: v10Contract.runtimeCode,
          stateDiff: epochBoundStateDiff,
        },
      },
    ]);
    rows.push({
      contract: v10Contract.name,
      operation: "bet-epoch-bound",
      mode: testCase.mode,
      tiles: testCase.tiles,
      gasLimit: toSafeDisplayInteger(BigInt(estimate.gasLimit), `${v10Contract.name} epoch-bound ${testCase.mode} gas limit`),
      baseFeePerGas: BigInt(estimate.baseFeePerGas).toString(),
      priorityFeePerGas: BigInt(estimate.priorityFeePerGas).toString(),
    });
  }

  const emptyAdvanceEstimate = await rpcRequest<EstimateResult>(rpcUrls, "linea_estimateGas", [
    {
      from: sender,
      to: contractAddress,
      data: encodeFunctionData({
        abi: GAME_ABI,
        functionName: "placeBatchBetsBitmapForEpoch",
        args: [SYNTHETIC_EPOCH, 1, BET_AMOUNT],
      }),
      gas: toHex(10_000_000n),
    },
    {
      [contractAddress]: {
        code: v10Contract.runtimeCode,
        stateDiff: buildResolveStateDiff(v10Contract, latestBlock.timestamp, "empty"),
      },
    },
  ]);
  rows.push({
    contract: v10Contract.name,
    operation: "bet-epoch-bound",
    mode: "bitmap-empty-advance",
    tiles: 1,
    gasLimit: toSafeDisplayInteger(BigInt(emptyAdvanceEstimate.gasLimit), `${v10Contract.name} bitmap-empty-advance gas limit`),
    baseFeePerGas: BigInt(emptyAdvanceEstimate.baseFeePerGas).toString(),
    priorityFeePerGas: BigInt(emptyAdvanceEstimate.priorityFeePerGas).toString(),
  });

  const mutationCases = [
    { mode: "reward", functionName: "claimReward", args: [SYNTHETIC_EPOCH] },
    { mode: "rebate", functionName: "claimEpochRebate", args: [SYNTHETIC_EPOCH] },
    { mode: "reward-dust", functionName: "settleEpochDust", args: [SYNTHETIC_EPOCH] },
    { mode: "rebate-dust", functionName: "settleEpochRebateDust", args: [SYNTHETIC_EPOCH] },
    { mode: "resolver-reward", functionName: "claimResolverRewards", args: [] },
    { mode: "fee-flush", functionName: "flushProtocolFees", args: [] },
  ] as const;
  for (const contract of mutationContracts) {
    for (const testCase of mutationCases) {
      const estimate = await rpcRequest<EstimateResult>(rpcUrls, "linea_estimateGas", [
        {
          from: sender,
          to: EMPTY_SIMULATION_ADDRESS,
          data: encodeFunctionData({ abi: GAME_ABI, functionName: testCase.functionName, args: testCase.args }),
          gas: toHex(10_000_000n),
        },
        {
          [EMPTY_SIMULATION_ADDRESS]: {
            code: contract.runtimeCode,
            stateDiff: buildMutationState(contract, latestBlock.timestamp, sender, testCase.mode),
          },
          [TOKEN_SIMULATION_ADDRESS]: { code: diagnosticContracts.standardTokenRuntime },
        },
      ]);
      rows.push({
        contract: contract.name,
        operation: "mutation",
        mode: testCase.mode,
        tiles: 0,
        gasLimit: toSafeDisplayInteger(BigInt(estimate.gasLimit), `${contract.name} ${testCase.mode} gas limit`),
        baseFeePerGas: BigInt(estimate.baseFeePerGas).toString(),
        priorityFeePerGas: BigInt(estimate.priorityFeePerGas).toString(),
      });
    }
    const batchMutationCases = [
      { mode: "reward-batch", functionName: "claimRewards", stateMode: "reward" },
      { mode: "rebate-batch", functionName: "claimEpochsRebate", stateMode: "rebate" },
      { mode: "reward-dust-batch", functionName: "settleEpochsDust", stateMode: "reward-dust" },
      { mode: "rebate-dust-batch", functionName: "settleEpochsRebateDust", stateMode: "rebate-dust" },
    ] as const;
    for (const batchSize of [8, 48]) {
      const epochs = Array.from({ length: batchSize }, (_, index) => SYNTHETIC_EPOCH + BigInt(index));
      for (const testCase of batchMutationCases) {
        const estimate = await rpcRequest<EstimateResult>(rpcUrls, "linea_estimateGas", [
          {
            from: sender,
            to: EMPTY_SIMULATION_ADDRESS,
            data: encodeFunctionData({ abi: GAME_ABI, functionName: testCase.functionName, args: [epochs] }),
            gas: toHex(20_000_000n),
          },
          {
            [EMPTY_SIMULATION_ADDRESS]: {
              code: contract.runtimeCode,
              stateDiff: buildMutationBatchState(contract, latestBlock.timestamp, sender, epochs, testCase.stateMode),
            },
            [TOKEN_SIMULATION_ADDRESS]: { code: diagnosticContracts.standardTokenRuntime },
          },
        ]);
        rows.push({
          contract: contract.name,
          operation: "mutation",
          mode: `${testCase.mode}-${batchSize}`,
          tiles: batchSize,
          gasLimit: toSafeDisplayInteger(BigInt(estimate.gasLimit), `${contract.name} ${testCase.mode}-${batchSize} gas limit`),
          baseFeePerGas: BigInt(estimate.baseFeePerGas).toString(),
          priorityFeePerGas: BigInt(estimate.priorityFeePerGas).toString(),
        });
      }
    }
  }

  const baselineByCase = new Map(
    rows.filter((row) => row.contract === "LineaOreV9")
      .map((row) => [`${row.operation}:${row.mode}:${row.tiles}`, row.gasLimit]),
  );
  const expectedRuntimeCases = [
    "bet:arrays:3",
    "bet:bitmap-sparse:3",
    "bet:bitmap-sparse:5",
    "bet:bitmap:3",
    "bet:bitmap:5",
    "bet:bitmap:25",
    "bet:sameAmount:3",
    "bet:single:1",
    "mutation:fee-flush:0",
    "mutation:rebate-batch-8:8",
    "mutation:rebate-batch-48:48",
    "mutation:rebate-dust-batch-8:8",
    "mutation:rebate-dust-batch-48:48",
    "mutation:rebate-dust:0",
    "mutation:rebate:0",
    "mutation:resolver-reward:0",
    "mutation:reward-batch-8:8",
    "mutation:reward-batch-48:48",
    "mutation:reward-dust-batch-8:8",
    "mutation:reward-dust-batch-48:48",
    "mutation:reward-dust:0",
    "mutation:reward:0",
    "resolve:empty:0",
    "resolve:daily-jackpot-award:25",
    "resolve:funded-no-winner:0",
    "resolve:jackpot-check-no-award:25",
    "resolve:weekly-jackpot-award:25",
    "resolve:winner-25-funded-tiles:25",
  ].sort();
  const expectedEpochBoundCases = [
    "bet-epoch-bound:bitmap-empty-advance:1",
    "bet-epoch-bound:bitmap-sparse:3",
    "bet-epoch-bound:bitmap-sparse:5",
    "bet-epoch-bound:bitmap:1",
    "bet-epoch-bound:bitmap:3",
    "bet-epoch-bound:bitmap:25",
  ];
  for (const contractName of ["LineaOreV9", "LineaOreV10"]) {
    const measuredCases = rows
      .filter((row) => row.contract === contractName && row.operation !== "deploy")
      .map((row) => `${row.operation}:${row.mode}:${row.tiles}`)
      .sort();
    const expectedCases = contractName === "LineaOreV10"
      ? [...expectedRuntimeCases, ...expectedEpochBoundCases].sort()
      : expectedRuntimeCases;
    assert.deepEqual(measuredCases, expectedCases, `${contractName} gas coverage must remain complete`);
  }
  for (const row of rows) {
    const baseline = baselineByCase.get(`${row.operation}:${row.mode}:${row.tiles}`);
    if (baseline === undefined) continue;
    row.gasDeltaVsV9 = row.gasLimit - baseline;
    row.gasDeltaPercentVsV9 = Number((((row.gasLimit - baseline) / baseline) * 100).toFixed(2));
  }
  const regressions = rows.filter(
    (row) =>
      row.contract === "LineaOreV10" &&
      row.operation !== "deploy" &&
      row.gasDeltaVsV9 !== undefined &&
      row.gasDeltaVsV9 >= 0,
  );
  const regressionPaths = regressions.map((row) => `${row.operation}:${row.mode}:${row.tiles}`);
  if (!process.argv.includes("--allow-gas-regressions")) {
    assert.deepEqual(regressionPaths, [], "V10 must not regress any measured transaction-free gas path");
  }

  const report = {
    network,
    chainId: chain.id,
    blockNumber: latestBlock.number.toString(),
    blockTimestamp: latestBlock.timestamp.toString(),
    compilerVersion: solc.version(),
    compiler: {
      v9Baseline: { version: legacySolc.version(), optimizer: true, runs: 200, viaIR: false, evmVersion: "osaka" },
      v10Candidate: {
        version: solc.version(),
        optimizer: true,
        runs: V10_OPTIMIZER_RUNS,
        viaIR: V10_VIA_IR,
        evmVersion: "osaka",
        automaticFeeFlush: V10_WITH_AUTO_FLUSH,
      },
    },
    method: "linea_estimateGas + temporary code/state override",
    transactionSent: false,
    accountInput: "public-address-only",
    tokenModels: {
      betAndDeploymentGas: "configured Linea token",
      mutationGas: "StandardTransferToken",
      behaviorReentrancy: "ReentrancyProbeToken",
      behaviorRollback: "RejectingTransferToken",
    },
    constructorValidation,
    behaviorChecks,
    gasRegressionGate: {
      status: regressionPaths.length === 0 ? "passed" : "failed",
      comparedPaths: rows.filter(
        (row) => row.contract === "LineaOreV10" && row.operation !== "deploy" && row.gasDeltaVsV9 !== undefined,
      ).length,
      candidateOnlyPaths: expectedEpochBoundCases.length,
      regressions: regressionPaths,
    },
    rows,
  };
  if (process.argv.includes("--summary-only")) {
    console.log(JSON.stringify({
      network: report.network,
      chainId: report.chainId,
      blockNumber: report.blockNumber,
      blockTimestamp: report.blockTimestamp,
      compilerVersion: report.compilerVersion,
      compiler: report.compiler,
      method: report.method,
      transactionSent: report.transactionSent,
      accountInput: report.accountInput,
      tokenModels: report.tokenModels,
      constructorValidation: report.constructorValidation,
      behaviorChecks: report.behaviorChecks,
      gasRegressionGate: report.gasRegressionGate,
      v10: rows
        .filter((row) => row.contract === "LineaOreV10")
        .map(({ operation, mode, tiles, gasLimit, gasDeltaVsV9, gasDeltaPercentVsV9 }) => ({
          operation,
          mode,
          tiles,
          gasLimit,
          gasDeltaVsV9,
          gasDeltaPercentVsV9,
        })),
    }, null, 2));
  } else {
    console.log(JSON.stringify(report, null, 2));
  }
}

main().catch((error) => {
  if (error instanceof BenchmarkBlockedError) {
    reportBenchmarkBlocked(error);
    process.exit(1);
  }
  console.error(`[v10-linea-gas] ${sanitizedRpcError(error)}`);
  process.exitCode = 1;
});
