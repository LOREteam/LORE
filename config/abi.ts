import { parseAbi } from "viem";

/**
 * Shared V8 contract ABI fragments used by both the keeper bot and
 * the bootstrap-resolve API route.
 */
export const RESOLVE_ABI = parseAbi([
  "function resolveEpoch(uint256 epoch) external",
  "function currentEpoch() public view returns (uint256)",
  "function getEpochEndTime(uint256 epoch) public view returns (uint256)",
  "function epochs(uint256) public view returns (uint256 totalPool, uint256 rewardPool, uint256 winningTile, bool isResolved, bool isDailyJackpot, bool isWeeklyJackpot)",
  "error TimerNotEnded()",
  "error AlreadyResolved()",
  "error CanOnlyResolveCurrent()",
]);
