import { createHash } from "node:crypto";
import { getCanonicalRpcHostname } from "../config/productionRuntime";
import { sanitizeSentryPayload } from "../app/lib/sentrySanitize";

const ADDRESS_RE = /^0x[0-9a-f]{40}$/i;
const HASH_RE = /^0x[0-9a-f]{64}$/i;
const DATA_RE = /^0x(?:[0-9a-f]{2})*$/i;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
export const INDEXER_RPC_MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
export const INDEXER_RPC_MAX_JSON_DEPTH = 64;
export const INDEXER_RPC_MAX_LOG_TOPICS = 4;
export const INDEXER_RPC_MAX_LOG_DATA_BYTES = 1024 * 1024;
const INDEXER_RPC_MAX_AGREEMENT_FINGERPRINT_BYTES = 4 * 1024;

export function describeIndexerError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "unknown");
  return sanitizeSentryPayload(message).slice(0, 160);
}

export type IndexerRpcLog = {
  address: string;
  blockHash: string | null;
  blockNumber: bigint | null;
  data: string;
  logIndex: number | bigint | null;
  removed: boolean;
  topics: readonly string[];
  transactionHash: string | null;
};

export type ValidatedRpcLogSet<T extends IndexerRpcLog> = {
  logs: T[];
  identityKeys: string[];
  payloadFingerprints: string[];
  agreementFingerprint: string;
};

export class IndexerRpcResponseLimitError extends Error {
  constructor(reason: "bytes" | "content_length" | "json_depth" | "logs") {
    super(`indexer RPC response limit exceeded: ${reason}`);
    this.name = "IndexerRpcResponseLimitError";
  }
}

export function getIndexerRpcResponseLimitError(
  error: unknown,
): IndexerRpcResponseLimitError | null {
  let current = error;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 8; depth += 1) {
    if (current instanceof IndexerRpcResponseLimitError) return current;
    if (!current || typeof current !== "object" || seen.has(current)) return null;
    seen.add(current);
    current = "cause" in current ? (current as { cause?: unknown }).cause : undefined;
  }
  return null;
}

export function isIndexerRpcResponseLimitError(
  error: unknown,
): boolean {
  return getIndexerRpcResponseLimitError(error) !== null;
}

type FetchLike = (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) => Promise<Response>;

function validatePositiveSafeLimit(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`invalid ${label}`);
  }
}

async function rejectRpcResponse(
  response: Response,
  reason: "bytes" | "content_length",
): Promise<never> {
  try {
    await response.body?.cancel();
  } catch {
    // The response is rejected regardless of whether the transport acknowledges cancellation.
  }
  throw new IndexerRpcResponseLimitError(reason);
}

export function createBoundedIndexerRpcFetch(options: {
  fetchFn?: FetchLike;
  maxResponseBytes?: number;
  maxJsonDepth?: number;
} = {}): typeof fetch {
  const fetchFn = options.fetchFn ?? globalThis.fetch;
  const maxResponseBytes = options.maxResponseBytes ?? INDEXER_RPC_MAX_RESPONSE_BYTES;
  const maxJsonDepth = options.maxJsonDepth ?? INDEXER_RPC_MAX_JSON_DEPTH;
  validatePositiveSafeLimit(maxResponseBytes, "indexer RPC response byte limit");
  validatePositiveSafeLimit(maxJsonDepth, "indexer RPC JSON depth limit");

  const boundedFetch: FetchLike = async (input, init) => {
    const response = await fetchFn(input, init);
    const rawContentLength = response.headers.get("content-length");
    if (rawContentLength !== null) {
      if (!/^(?:0|[1-9]\d*)$/.test(rawContentLength)) {
        return rejectRpcResponse(response, "content_length");
      }
      if (BigInt(rawContentLength) > BigInt(maxResponseBytes)) {
        return rejectRpcResponse(response, "bytes");
      }
    }
    if (response.body === null) return response;

    let observedBytes = 0;
    let jsonDepth = 0;
    let inString = false;
    let escaped = false;
    const decoder = new TextDecoder();
    const scanJsonDepth = (text: string) => {
      for (const character of text) {
        if (inString) {
          if (escaped) {
            escaped = false;
          } else if (character === "\\") {
            escaped = true;
          } else if (character === "\"") {
            inString = false;
          }
          continue;
        }
        if (character === "\"") {
          inString = true;
        } else if (character === "{" || character === "[") {
          jsonDepth += 1;
          if (jsonDepth > maxJsonDepth) {
            throw new IndexerRpcResponseLimitError("json_depth");
          }
        } else if ((character === "}" || character === "]") && jsonDepth > 0) {
          jsonDepth -= 1;
        }
      }
    };

    const guardedBody = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          observedBytes += chunk.byteLength;
          if (observedBytes > maxResponseBytes) {
            throw new IndexerRpcResponseLimitError("bytes");
          }
          scanJsonDepth(decoder.decode(chunk, { stream: true }));
          controller.enqueue(chunk);
        },
        flush() {
          scanJsonDepth(decoder.decode());
        },
      }),
    );
    return new Response(guardedBody, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    });
  };

  return boundedFetch as typeof fetch;
}

function normalizeLogIndex(value: number | bigint | null): string | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? String(value) : null;
  }
  if (typeof value === "bigint") {
    return value >= 0n && value <= MAX_SAFE_INTEGER_BIGINT ? value.toString() : null;
  }
  return null;
}

export function getUniqueRpcUrls(urls: readonly string[]) {
  const unique = new Map<string, string>();
  for (const rawUrl of urls) {
    const url = rawUrl.trim();
    if (!url) continue;
    let identity: string;
    try {
      identity = new URL(url).href;
    } catch {
      identity = url;
    }
    if (!unique.has(identity)) unique.set(identity, url);
  }
  return [...unique.values()];
}

export function requireIndependentRpcUrls(
  urls: readonly string[],
  minimumResponses = 2,
) {
  if (!Number.isSafeInteger(minimumResponses) || minimumResponses < 2) {
    throw new Error("indexer RPC agreement requires at least two independent responses");
  }
  const independentUrls = new Map<string, string>();
  for (const url of getUniqueRpcUrls(urls)) {
    const hostname = getCanonicalRpcHostname(url);
    if (hostname === null) {
      throw new Error("indexer RPC agreement received an invalid endpoint URL");
    }
    if (!independentUrls.has(hostname)) independentUrls.set(hostname, url);
  }
  if (independentUrls.size < minimumResponses) {
    throw new Error(
      `indexer requires at least ${minimumResponses} independent RPC origins; received ${independentUrls.size}`,
    );
  }
  return [...independentUrls.values()];
}

export class IndexerRpcWorkBudgetError extends Error {
  constructor(reason: "rpc_calls" | "logs" | "split_nodes" | "time") {
    super(`indexer RPC work budget exhausted: ${reason}`);
    this.name = "IndexerRpcWorkBudgetError";
  }
}

export type IndexerRpcWorkBudget = {
  consumeRpcCall: () => number;
  consumeSplitNode: () => void;
  recordLogs: (count: number) => void;
  remainingTimeMs: () => number;
  snapshot: () => { rpcCalls: number; logs: number; splitNodes: number };
};

export function isIndexerRpcWorkBudgetError(
  error: unknown,
): error is IndexerRpcWorkBudgetError {
  return error instanceof IndexerRpcWorkBudgetError;
}

export function createIndexerRpcWorkBudget(options: {
  maxRpcCalls: number;
  maxLogs: number;
  maxLogsPerResponse?: number;
  maxSplitNodes: number;
  maxElapsedMs: number;
  nowMs?: () => number;
}): IndexerRpcWorkBudget {
  const {
    maxRpcCalls,
    maxLogs,
    maxLogsPerResponse = maxLogs,
    maxSplitNodes,
    maxElapsedMs,
  } = options;
  if (
    !Number.isSafeInteger(maxRpcCalls) ||
    maxRpcCalls <= 0 ||
    !Number.isSafeInteger(maxLogs) ||
    maxLogs <= 0 ||
    !Number.isSafeInteger(maxLogsPerResponse) ||
    maxLogsPerResponse <= 0 ||
    maxLogsPerResponse > maxLogs ||
    !Number.isSafeInteger(maxSplitNodes) ||
    maxSplitNodes <= 0 ||
    !Number.isSafeInteger(maxElapsedMs) ||
    maxElapsedMs <= 0
  ) {
    throw new Error("invalid indexer RPC work budget");
  }
  const nowMs = options.nowMs ?? Date.now;
  const startedAt = nowMs();
  if (!Number.isFinite(startedAt)) {
    throw new Error("invalid indexer RPC budget clock");
  }
  let rpcCalls = 0;
  let logs = 0;
  let splitNodes = 0;

  const remainingTimeMs = () => {
    const now = nowMs();
    if (!Number.isFinite(now) || now < startedAt) {
      throw new IndexerRpcWorkBudgetError("time");
    }
    const remaining = maxElapsedMs - (now - startedAt);
    if (remaining <= 0) {
      throw new IndexerRpcWorkBudgetError("time");
    }
    return Math.max(1, Math.floor(remaining));
  };

  return {
    consumeRpcCall() {
      const remaining = remainingTimeMs();
      if (rpcCalls >= maxRpcCalls) {
        throw new IndexerRpcWorkBudgetError("rpc_calls");
      }
      rpcCalls += 1;
      return remaining;
    },
    consumeSplitNode() {
      remainingTimeMs();
      if (splitNodes >= maxSplitNodes) {
        throw new IndexerRpcWorkBudgetError("split_nodes");
      }
      splitNodes += 1;
    },
    recordLogs(count: number) {
      remainingTimeMs();
      if (!Number.isSafeInteger(count) || count < 0) {
        throw new IndexerRpcWorkBudgetError("logs");
      }
      if (count > maxLogsPerResponse) {
        throw new IndexerRpcResponseLimitError("logs");
      }
      if (logs + count > maxLogs) throw new IndexerRpcWorkBudgetError("logs");
      logs += count;
    },
    remainingTimeMs,
    snapshot: () => ({ rpcCalls, logs, splitNodes }),
  };
}

type RpcSettlement<T> =
  | { kind: "fulfilled"; index: number; value: T }
  | { kind: "rejected"; index: number; reason: unknown };

export async function awaitExactRpcAgreement<T>(
  responseFactories: ReadonlyArray<() => Promise<T>>,
  minimumResponses: number,
  fingerprint: (value: T) => string,
  budget: IndexerRpcWorkBudget,
): Promise<T> {
  if (!Number.isSafeInteger(minimumResponses) || minimumResponses < 2) {
    throw new Error("indexer RPC agreement requires at least two independent responses");
  }
  if (responseFactories.length < minimumResponses) {
    throw new Error("insufficient independent RPC providers for exact agreement");
  }

  const pending = new Map<number, Promise<RpcSettlement<T>>>();
  const groups = new Map<string, { count: number; value: T }>();
  let fulfilled = 0;
  let responseLimitError: IndexerRpcResponseLimitError | null = null;
  let nextFactoryIndex = 0;

  const startNext = () => {
    if (nextFactoryIndex >= responseFactories.length) return false;
    const index = nextFactoryIndex;
    nextFactoryIndex += 1;
    const settlement = Promise.resolve()
      .then(responseFactories[index])
      .then(
        (value): RpcSettlement<T> => ({ kind: "fulfilled", index, value }),
        (reason): RpcSettlement<T> => ({ kind: "rejected", index, reason }),
      );
    pending.set(index, settlement);
    return true;
  };

  for (let index = 0; index < minimumResponses; index += 1) startNext();

  const deadlineMarker = Symbol("indexer-rpc-agreement-deadline");
  let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
  const deadline = new Promise<typeof deadlineMarker>((resolve) => {
    deadlineTimer = setTimeout(resolve, budget.remainingTimeMs(), deadlineMarker);
  });

  try {
    while (pending.size > 0) {
      const settlement = await Promise.race([...pending.values(), deadline]);
      if (settlement === deadlineMarker) {
        throw new IndexerRpcWorkBudgetError("time");
      }
      pending.delete(settlement.index);

      if (settlement.kind === "rejected") {
        if (isIndexerRpcWorkBudgetError(settlement.reason)) throw settlement.reason;
        responseLimitError = getIndexerRpcResponseLimitError(settlement.reason) ?? responseLimitError;
        startNext();
        continue;
      }

      fulfilled += 1;
      const normalized = fingerprint(settlement.value);
      if (typeof normalized !== "string") {
        throw new Error("indexer RPC agreement received an invalid value fingerprint");
      }
      if (Buffer.byteLength(normalized, "utf8") > INDEXER_RPC_MAX_AGREEMENT_FINGERPRINT_BYTES) {
        throw new IndexerRpcResponseLimitError("bytes");
      }
      const group = groups.get(normalized);
      if (group) {
        group.count += 1;
        if (group.count >= minimumResponses) return group.value;
      } else {
        groups.set(normalized, { count: 1, value: settlement.value });
      }

      if (groups.size > 1) startNext();
    }
  } finally {
    if (deadlineTimer !== null) clearTimeout(deadlineTimer);
  }

  if (fulfilled >= minimumResponses) {
    throw new Error("independent RPC providers disagreed on normalized value");
  }
  if (responseLimitError !== null) throw responseLimitError;
  throw new Error("insufficient independent RPC responses for exact agreement");
}

export function validateRpcLogSet<T extends IndexerRpcLog>(
  logs: readonly T[],
  options: {
    contractAddress: string;
    fromBlock: bigint;
    toBlock: bigint;
    requestedTopics?: readonly string[];
  },
): ValidatedRpcLogSet<T> {
  const contractAddress = options.contractAddress.trim().toLowerCase();
  if (!ADDRESS_RE.test(contractAddress)) {
    throw new Error("indexer log validation received an invalid contract address");
  }
  if (options.fromBlock < 0n || options.toBlock < options.fromBlock) {
    throw new Error("indexer log validation received an invalid block range");
  }

  const requestedTopics = (options.requestedTopics ?? []).map((topic) => topic.toLowerCase());
  if (requestedTopics.length > INDEXER_RPC_MAX_LOG_TOPICS) {
    throw new Error("indexer log validation received too many requested topics");
  }
  for (const topic of requestedTopics) {
    if (!HASH_RE.test(topic)) {
      throw new Error("indexer log validation received a malformed requested topic");
    }
  }

  const entries: Array<{ identity: string; payload: string }> = [];
  const identities = new Set<string>();
  for (const log of logs) {
    const address = typeof log.address === "string" ? log.address.toLowerCase() : "";
    if (!ADDRESS_RE.test(address) || address !== contractAddress) {
      throw new Error("RPC returned a log for the wrong contract address");
    }
    if (log.removed !== false) {
      throw new Error("RPC returned a removed or malformed log");
    }
    if (
      typeof log.blockNumber !== "bigint" ||
      log.blockNumber < options.fromBlock ||
      log.blockNumber > options.toBlock
    ) {
      throw new Error("RPC returned a log outside the requested block range");
    }

    const blockHash = typeof log.blockHash === "string" ? log.blockHash.toLowerCase() : "";
    const transactionHash = typeof log.transactionHash === "string"
      ? log.transactionHash.toLowerCase()
      : "";
    const logIndex = normalizeLogIndex(log.logIndex);
    if (!HASH_RE.test(blockHash) || !HASH_RE.test(transactionHash) || logIndex === null) {
      throw new Error("RPC returned a log with malformed identity fields");
    }
    if (
      !Array.isArray(log.topics) ||
      log.topics.length === 0 ||
      log.topics.length > INDEXER_RPC_MAX_LOG_TOPICS
    ) {
      throw new Error("RPC returned a log without a valid topic identity");
    }
    const topics = log.topics.map((topic) => typeof topic === "string" ? topic.toLowerCase() : "");
    if (topics.some((topic) => !HASH_RE.test(topic))) {
      throw new Error("RPC returned a log with malformed topics");
    }
    if (requestedTopics.some((topic, index) => topics[index] !== topic)) {
      throw new Error("RPC returned a log outside the requested topic filter");
    }
    const rawData = typeof log.data === "string" ? log.data : "";
    if (rawData.length > 2 + (INDEXER_RPC_MAX_LOG_DATA_BYTES * 2)) {
      throw new IndexerRpcResponseLimitError("bytes");
    }
    const data = rawData.toLowerCase();
    if (!DATA_RE.test(data)) {
      throw new Error("RPC returned a log with malformed data");
    }

    const identity = [
      log.blockNumber.toString(),
      blockHash,
      transactionHash,
      logIndex,
    ].join(":");
    if (identities.has(identity)) {
      throw new Error("RPC returned duplicate normalized log identities");
    }
    identities.add(identity);
    const payloadFingerprint = createHash("sha256")
      .update(identity)
      .update("\0")
      .update(address)
      .update("\0")
      .update(topics.join(","))
      .update("\0")
      .update(data)
      .digest("hex");
    entries.push({
      identity,
      payload: payloadFingerprint,
    });
  }

  entries.sort((left, right) => left.identity.localeCompare(right.identity));
  const agreementHash = createHash("sha256");
  for (const entry of entries) {
    agreementHash.update(entry.identity).update("\0").update(entry.payload).update("\n");
  }
  return {
    logs: [...logs],
    identityKeys: entries.map((entry) => entry.identity),
    payloadFingerprints: entries.map((entry) => entry.payload),
    agreementFingerprint: agreementHash.digest("hex"),
  };
}

export function requireAgreedRpcLogSets<T extends IndexerRpcLog>(
  responses: readonly ValidatedRpcLogSet<T>[],
  minimumResponses: number,
) {
  if (!Number.isSafeInteger(minimumResponses) || minimumResponses < 2) {
    throw new Error("indexer RPC agreement requires at least two independent responses");
  }
  if (responses.length < minimumResponses) {
    throw new Error("insufficient independent RPC responses for indexer log authenticity");
  }

  const reference = responses[0];
  for (const response of responses.slice(1)) {
    if (
      response.identityKeys.length !== reference.identityKeys.length ||
      response.identityKeys.some((identity, index) => identity !== reference.identityKeys[index])
    ) {
      throw new Error("independent RPC providers disagreed on normalized log identities");
    }
    if (
      response.payloadFingerprints.length !== reference.payloadFingerprints.length ||
      response.payloadFingerprints.some(
        (payload, index) => payload !== reference.payloadFingerprints[index],
      )
    ) {
      throw new Error("independent RPC providers disagreed on normalized log payloads");
    }
  }
  return [...reference.logs];
}

export function requireAgreedRpcValues<T>(
  responses: readonly T[],
  minimumResponses: number,
  fingerprint: (value: T) => string,
): T {
  if (!Number.isSafeInteger(minimumResponses) || minimumResponses < 2) {
    throw new Error("indexer RPC agreement requires at least two independent responses");
  }
  if (responses.length < minimumResponses) {
    throw new Error("insufficient independent RPC responses for indexer value authenticity");
  }
  const reference = responses[0];
  const referenceFingerprint = fingerprint(reference);
  if (typeof referenceFingerprint !== "string") {
    throw new Error("indexer RPC agreement received an invalid value fingerprint");
  }
  for (const response of responses.slice(1)) {
    if (fingerprint(response) !== referenceFingerprint) {
      throw new Error("independent RPC providers disagreed on normalized value");
    }
  }
  return reference;
}

export function parseIndexerCatchupChunkBlocks(
  value: unknown,
  maximumChunkBlocks: bigint,
) {
  if (maximumChunkBlocks <= 0n) {
    throw new Error("invalid maximum indexer catch-up chunk span");
  }
  if (value === null || value === undefined) return maximumChunkBlocks;
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) {
    throw new Error("stored indexer catch-up chunk span is invalid");
  }
  const maximumText = maximumChunkBlocks.toString();
  if (
    value.length > maximumText.length ||
    (value.length === maximumText.length && value > maximumText)
  ) {
    throw new Error("stored indexer catch-up chunk span exceeds its hard cap");
  }
  return BigInt(value);
}

export function reduceIndexerCatchupChunkBlocks(attemptSpan: bigint) {
  if (attemptSpan <= 0n) {
    throw new Error("invalid indexer catch-up chunk attempt span");
  }
  return attemptSpan === 1n ? 1n : (attemptSpan + 1n) / 2n;
}

export function createBoundedIndexerRunPlan(
  lastIndexedBlock: bigint,
  chainTargetBlock: bigint,
  chunkBlocks: bigint,
  maxHeadGapBlocks: bigint,
  maxChunks: number,
) {
  if (
    lastIndexedBlock < 0n ||
    chainTargetBlock < 0n ||
    chunkBlocks <= 0n ||
    maxHeadGapBlocks <= 0n ||
    !Number.isSafeInteger(maxChunks) ||
    maxChunks <= 0
  ) {
    throw new Error("invalid bounded indexer run limits");
  }

  const fromBlock = lastIndexedBlock + 1n;
  if (fromBlock > chainTargetBlock) {
    return {
      fromBlock,
      toBlock: chainTargetBlock,
      chunkCount: 0,
      capped: false,
    };
  }

  const chunkCapacity = chunkBlocks * BigInt(maxChunks);
  const permittedSpan = maxHeadGapBlocks < chunkCapacity ? maxHeadGapBlocks : chunkCapacity;
  const maximumTarget = lastIndexedBlock + permittedSpan;
  const toBlock = chainTargetBlock < maximumTarget ? chainTargetBlock : maximumTarget;
  const span = toBlock - fromBlock + 1n;
  const chunkCount = Number((span + chunkBlocks - 1n) / chunkBlocks);
  if (!Number.isSafeInteger(chunkCount) || chunkCount < 1 || chunkCount > maxChunks) {
    throw new Error("bounded indexer run produced an invalid chunk count");
  }
  return {
    fromBlock,
    toBlock,
    chunkCount,
    capped: toBlock < chainTargetBlock,
  };
}

export function createBoundedBackwardBlockScanPlan(
  minimumBlock: bigint,
  cursorToBlock: bigint,
  chunkBlocks: bigint,
  maxChunks: number,
) {
  if (
    minimumBlock < 0n ||
    cursorToBlock < 0n ||
    chunkBlocks <= 0n ||
    !Number.isSafeInteger(maxChunks) ||
    maxChunks <= 0
  ) {
    throw new Error("invalid bounded backward block scan limits");
  }
  if (cursorToBlock < minimumBlock) {
    return {
      fromBlock: minimumBlock,
      toBlock: cursorToBlock,
      chunkCount: 0,
      nextToBlock: null as bigint | null,
      complete: true,
    };
  }

  const maximumSpan = chunkBlocks * BigInt(maxChunks);
  const availableSpan = cursorToBlock - minimumBlock + 1n;
  const span = availableSpan < maximumSpan ? availableSpan : maximumSpan;
  const fromBlock = cursorToBlock - span + 1n;
  const chunkCount = Number((span + chunkBlocks - 1n) / chunkBlocks);
  if (!Number.isSafeInteger(chunkCount) || chunkCount < 1 || chunkCount > maxChunks) {
    throw new Error("bounded backward block scan produced an invalid chunk count");
  }
  const nextToBlock = fromBlock > minimumBlock ? fromBlock - 1n : null;
  return {
    fromBlock,
    toBlock: cursorToBlock,
    chunkCount,
    nextToBlock,
    complete: nextToBlock === null,
  };
}

export function parsePlausibleCurrentEpoch(
  value: bigint,
  deployBlock: bigint,
  observedBlock: bigint,
): number | null {
  if (deployBlock < 0n || observedBlock < deployBlock || value <= 0n) return null;
  const maximumEpoch = observedBlock - deployBlock + 1n;
  if (value > maximumEpoch || value > MAX_SAFE_INTEGER_BIGINT) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export function createReconcileEpochPlan(options: {
  currentEpoch: number;
  cursor: number;
  indexedEpochs: ReadonlySet<number>;
  maxTargets: number;
  recentWindow: number;
}) {
  const { currentEpoch, indexedEpochs, maxTargets, recentWindow } = options;
  if (
    !Number.isSafeInteger(currentEpoch) ||
    currentEpoch <= 0 ||
    !Number.isSafeInteger(maxTargets) ||
    maxTargets <= 0 ||
    !Number.isSafeInteger(recentWindow) ||
    recentWindow <= 0
  ) {
    throw new Error("invalid bounded epoch reconcile limits");
  }

  const lastResolvedEpoch = currentEpoch - 1;
  if (lastResolvedEpoch < 1) {
    return { candidateEpochs: [] as number[], targetEpochs: [] as number[], nextCursor: 1 };
  }
  const cursor = Number.isSafeInteger(options.cursor) && options.cursor >= 1 && options.cursor <= lastResolvedEpoch
    ? options.cursor
    : 1;
  const sequentialEnd = Math.min(lastResolvedEpoch, cursor + maxTargets - 1);
  const sequentialCandidates: number[] = [];
  for (let epoch = cursor; epoch <= sequentialEnd; epoch += 1) {
    sequentialCandidates.push(epoch);
  }
  const nextCursor = sequentialEnd >= lastResolvedEpoch ? 1 : sequentialEnd + 1;

  const recentStart = Math.max(1, lastResolvedEpoch - recentWindow + 1);
  const recentCandidates: number[] = [];
  for (let epoch = recentStart; epoch <= lastResolvedEpoch; epoch += 1) {
    recentCandidates.push(epoch);
  }

  const candidateEpochs = [...sequentialCandidates];
  const candidateSet = new Set(candidateEpochs);
  for (const epoch of recentCandidates) {
    if (!candidateSet.has(epoch)) {
      candidateSet.add(epoch);
      candidateEpochs.push(epoch);
    }
  }

  const targetEpochs = sequentialCandidates.filter((epoch) => !indexedEpochs.has(epoch));
  if (targetEpochs.length < maxTargets) {
    for (const epoch of recentCandidates) {
      if (
        targetEpochs.length >= maxTargets ||
        indexedEpochs.has(epoch) ||
        targetEpochs.includes(epoch)
      ) {
        continue;
      }
      targetEpochs.push(epoch);
    }
  }
  return { candidateEpochs, targetEpochs, nextCursor };
}
