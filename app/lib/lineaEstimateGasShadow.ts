import type { Abi, Address, Hex, PublicClient } from "viem";
import { encodeFunctionData } from "viem";
import { log } from "./logger";

function isEnabled() {
  return process.env.NEXT_PUBLIC_LINEA_ESTIMATE_GAS_SHADOW === "1" || process.env.LINEA_ESTIMATE_GAS_SHADOW === "1";
}

function ratioBps(lineaEstimate: bigint, baselineEstimate: bigint) {
  if (baselineEstimate <= 0n) return null;
  return Number((lineaEstimate * 10_000n) / baselineEstimate);
}

function classifyShadowUnavailableReason(error: unknown) {
  const candidate = error as { code?: unknown; name?: unknown; message?: unknown; shortMessage?: unknown };
  const text = [
    typeof candidate?.code === "string" || typeof candidate?.code === "number" ? String(candidate.code) : "",
    typeof candidate?.name === "string" ? candidate.name : "",
    typeof candidate?.shortMessage === "string" ? candidate.shortMessage : "",
    typeof candidate?.message === "string" ? candidate.message : "",
  ].join(" ").toLowerCase();
  if (text.includes("timeout") || text.includes("timed out")) return "timeout";
  if (text.includes("unsupported") || text.includes("method not found") || text.includes("-32601")) return "method-unsupported";
  if (text.includes("rate limit") || text.includes("too many request") || text.includes("429")) return "rate-limited";
  if (text.includes("revert") || text.includes("execution reverted")) return "revert";
  if (text.includes("network") || text.includes("fetch") || text.includes("socket") || text.includes("econn")) return "network";
  return "unknown";
}

export interface LineaEstimateGasShadowOptions {
  publicClient: PublicClient;
  account: Address;
  to: Address;
  abi: Abi;
  functionName: string;
  args: readonly unknown[];
  baselineGas: bigint;
  tag: string;
}

interface LineaEstimateGasShadowDependencies {
  enabled?: () => boolean;
  logInfo?: (tag: string, message: string, data?: unknown) => void;
}

export function createLineaEstimateGasShadowRecorder(
  dependencies: LineaEstimateGasShadowDependencies = {},
) {
  const shadowedKeys = new Set<string>();
  const enabled = dependencies.enabled ?? isEnabled;
  const logInfo = dependencies.logInfo ?? ((tag, message, data) => log.info(tag, message, data));

  return function record(options: LineaEstimateGasShadowOptions) {
    if (!enabled()) return;
    const key = `${options.tag}:${options.functionName}`;
    if (shadowedKeys.has(key)) return;
    shadowedKeys.add(key);

    return (async () => {
      try {
        const data = encodeFunctionData({
          abi: options.abi,
          functionName: options.functionName,
          args: options.args,
        });
        const request = options.publicClient.request as unknown as (args: {
          method: string;
          params: [{ from: Address; to: Address; data: Hex }];
        }) => Promise<bigint | Hex | number | string>;
        const raw = await request({
          method: "linea_estimateGas",
          params: [{ from: options.account, to: options.to, data }],
        });
        const lineaGas = typeof raw === "bigint" ? raw : BigInt(raw);
        logInfo("GasShadow", "linea_estimateGas shadow", {
          tag: options.tag,
          functionName: options.functionName,
          baselineGas: options.baselineGas,
          lineaGas,
          ratioBps: ratioBps(lineaGas, options.baselineGas),
        });
      } catch (error) {
        logInfo("GasShadow", "linea_estimateGas shadow unavailable", {
          tag: options.tag,
          functionName: options.functionName,
          reason: classifyShadowUnavailableReason(error),
        });
      }
    })();
  };
}

export const recordLineaEstimateGasShadow = createLineaEstimateGasShadowRecorder();
