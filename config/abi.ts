import { parseAbi } from "viem";

/**
 * Shared V9-compatible resolve ABI fragments used by the keeper bot and
 * bootstrap-resolve API route. V10 intentionally preserves these selectors.
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
