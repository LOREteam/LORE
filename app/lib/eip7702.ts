import { encodeFunctionData, getAddress, parseAbi } from "viem";
import {
  getConfiguredEip7702DelegateAddress,
  getConfiguredEip7702Enabled,
  getConfiguredEip7702MiningEnabled,
} from "../../config/publicConfig";
import { APP_CHAIN_ID, CONTRACT_ADDRESS, LINEA_TOKEN_ADDRESS } from "./constants";

export const EIP7702_ENABLED = getConfiguredEip7702Enabled();
export const EIP7702_MINING_ENABLED = getConfiguredEip7702MiningEnabled();

function normalizeOptionalAddress(value: string) {
  if (!value) return null;
  try {
    return getAddress(value);
  } catch {
    return null;
  }
}

export const EIP7702_DELEGATE_ADDRESS = normalizeOptionalAddress(
  getConfiguredEip7702DelegateAddress(),
);

export const EIP7702_GAME_DELEGATE_ABI = parseAbi([
  "function approveAndPlaceBatchSameAmount(address token,address game,uint256[] calldata tileIds,uint256 amount,address spender,uint256 approvalAmount) external",
  "function placeBatchSameAmount(address game,uint256[] calldata tileIds,uint256 amount) external",
  "function claimRewards(address game,uint256[] calldata epochs) external",
  "function claimEpochsRebate(address game,uint256[] calldata epochs) external",
  "function resolveEpoch(address game,uint256 epoch) external",
  "function claimResolverRewards(address game) external",
]);

export interface Eip7702CapabilityState {
  enabled: boolean;
  chainId: number;
  configured: boolean;
  delegateAddress: `0x${string}` | null;
  supportedByWallet: boolean;
  mode: "disabled" | "unconfigured" | "ready";
}

export interface Signed7702AuthorizationLike {
  address: `0x${string}`;
  chainId: number;
  nonce: number;
  r: `0x${string}`;
  s: `0x${string}`;
  yParity: number;
  v?: bigint;
}

export function getEip7702CapabilityState(supportedByWallet: boolean): Eip7702CapabilityState {
  const configured = Boolean(EIP7702_DELEGATE_ADDRESS);
  return {
    enabled: EIP7702_ENABLED,
    chainId: APP_CHAIN_ID,
    configured,
    delegateAddress: EIP7702_DELEGATE_ADDRESS,
    supportedByWallet,
    mode: !EIP7702_ENABLED ? "disabled" : configured && supportedByWallet ? "ready" : "unconfigured",
  };
}

export function buildApproveAndBet7702Call(tileIds: number[], amountRaw: bigint, approvalAmount: bigint) {
  if (!EIP7702_DELEGATE_ADDRESS) throw new Error("EIP-7702 delegate address is not configured.");
  return encodeFunctionData({
    abi: EIP7702_GAME_DELEGATE_ABI,
    functionName: "approveAndPlaceBatchSameAmount",
    args: [
      LINEA_TOKEN_ADDRESS,
      CONTRACT_ADDRESS,
      tileIds.map((tileId) => BigInt(tileId)),
      amountRaw,
      CONTRACT_ADDRESS,
      approvalAmount,
    ],
  });
}

export function buildBet7702Call(tileIds: number[], amountRaw: bigint) {
  if (!EIP7702_DELEGATE_ADDRESS) throw new Error("EIP-7702 delegate address is not configured.");
  return encodeFunctionData({
    abi: EIP7702_GAME_DELEGATE_ABI,
    functionName: "placeBatchSameAmount",
    args: [CONTRACT_ADDRESS, tileIds.map((tileId) => BigInt(tileId)), amountRaw],
  });
}

export function buildClaimRewards7702Call(epochs: bigint[]) {
  if (!EIP7702_DELEGATE_ADDRESS) throw new Error("EIP-7702 delegate address is not configured.");
  return encodeFunctionData({
    abi: EIP7702_GAME_DELEGATE_ABI,
    functionName: "claimRewards",
    args: [CONTRACT_ADDRESS, epochs],
  });
}

export function buildClaimRebates7702Call(epochs: bigint[]) {
  if (!EIP7702_DELEGATE_ADDRESS) throw new Error("EIP-7702 delegate address is not configured.");
  return encodeFunctionData({
    abi: EIP7702_GAME_DELEGATE_ABI,
    functionName: "claimEpochsRebate",
    args: [CONTRACT_ADDRESS, epochs],
  });
}

export function buildResolveEpoch7702Call(epoch: bigint) {
  if (!EIP7702_DELEGATE_ADDRESS) throw new Error("EIP-7702 delegate address is not configured.");
  return encodeFunctionData({
    abi: EIP7702_GAME_DELEGATE_ABI,
    functionName: "resolveEpoch",
    args: [CONTRACT_ADDRESS, epoch],
  });
}

const EIP7702_PROBE_ABI = parseAbi(["function currentEpoch() view returns (uint256)"]);

export function buildEip7702ProbeRequest() {
  return {
    to: CONTRACT_ADDRESS,
    data: encodeFunctionData({
      abi: EIP7702_PROBE_ABI,
      functionName: "currentEpoch",
    }),
  };
}
