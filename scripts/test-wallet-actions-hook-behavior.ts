import assert from "node:assert/strict";
import { mock } from "node:test";
import { encodeFunctionData } from "viem";
import { APP_CHAIN_ID, CONTRACT_ADDRESS, EXPLORER_TX_BASE_URL, GAME_ABI } from "../app/lib/constants";
import {
  createWalletContractIntent,
  waitForStableWalletTransferReceipt,
  withWalletTransferIntentLease,
  WalletTransactionRevertedError,
} from "../app/lib/walletTransferIntent";

type Notification = {
  message: string;
  tone?: "info" | "success" | "warning" | "danger";
};

type TransactionRequest = {
  to: `0x${string}`;
  data?: `0x${string}`;
  value?: bigint;
  gas?: bigint;
  nonce?: number;
  expectedActor?: `0x${string}`;
  transferIntent?: {
    asset: "native" | "contract-call" | `0x${string}`;
    destination: `0x${string}`;
    amountWei: bigint;
  };
  contractIntent?: {
    contract: `0x${string}`;
    calldata: `0x${string}`;
  };
};

type HookResult = {
  connectedResolverRewards: string;
  embeddedResolverRewards: string;
  isDepositingEth: boolean;
  isClaimingConnectedResolverRewards: boolean;
  refreshPendingTransactionStatus: (replacementHash?: string) => Promise<unknown>;
  cancelPendingTransaction: () => Promise<void>;
  handleDepositEthToEmbedded: () => Promise<void>;
  handleDepositTokenToEmbedded: () => Promise<void>;
  handleClaimConnectedResolverRewards: () => Promise<void>;
  handleClaimEmbeddedResolverRewards: () => Promise<void>;
};

type UseWalletActions = (options: Record<string, unknown>) => HookResult;

type LocalStorageLike = {
  readonly length: number;
  getItem: (key: string) => string | null;
  key: (index: number) => string | null;
  removeItem: (key: string) => void;
  setItem: (key: string, value: string) => void;
};

type ReceiptMode = "pending" | "success" | "reverted";

type StableReceipt = {
  transactionHash: `0x${string}`;
  blockHash: `0x${string}`;
  blockNumber: bigint;
  transactionIndex: number;
  status: Exclude<ReceiptMode, "pending">;
};

type StableReceiptClient = {
  getBlockNumber: () => Promise<bigint>;
  getTransaction: () => Promise<{ hash: `0x${string}` }>;
  getTransactionReceipt: () => Promise<StableReceipt>;
  waitForTransactionReceipt: () => Promise<StableReceipt>;
};

const EMBEDDED_ACTOR = "0x1111111111111111111111111111111111111111" as const;
const EXTERNAL_ACTOR = "0x2222222222222222222222222222222222222222" as const;
const OTHER_ACTOR = "0x3333333333333333333333333333333333333333" as const;
const HASH = `0x${"a".repeat(64)}` as const;
const BLOCK_HASH = `0x${"b".repeat(64)}` as const;
const TRACKED_NONCE = 7;
const DEFAULT_ETH_DEPOSIT_WEI = 1_000_000_000_000_000n;
const STORAGE_PREFIX = "lineaore:wallet-transfer-intent:v1";

class HookMachine {
  private cursor = 0;
  private readonly slots: unknown[] = [];

  render<T>(factory: () => T): T {
    this.cursor = 0;
    setActiveHookMachine(this);
    try {
      return factory();
    } finally {
      setActiveHookMachine(null);
    }
  }

  state<T>(initial: T | (() => T)): [T, (value: T | ((current: T) => T)) => void] {
    const index = this.cursor++;
    if (!(index in this.slots)) {
      this.slots[index] = typeof initial === "function"
        ? (initial as () => T)()
        : initial;
    }
    const setValue = (value: T | ((current: T) => T)) => {
      const current = this.slots[index] as T;
      this.slots[index] = typeof value === "function"
        ? (value as (current: T) => T)(current)
        : value;
    };
    return [this.slots[index] as T, setValue];
  }

  ref<T>(initial: T): { current: T } {
    const index = this.cursor++;
    if (!(index in this.slots)) this.slots[index] = { current: initial };
    return this.slots[index] as { current: T };
  }

  memo<T>(factory: () => T): T {
    this.cursor += 1;
    return factory();
  }

  callback<T>(value: T): T {
    this.cursor += 1;
    return value;
  }
}

let activeHookMachine: HookMachine | null = null;

function setActiveHookMachine(machine: HookMachine | null) {
  activeHookMachine = machine;
}

function requireHookMachine() {
  assert.ok(activeHookMachine, "hook primitives must run inside the deterministic hook machine");
  return activeHookMachine;
}

function useStateMock<T>(initial: T | (() => T)) {
  return requireHookMachine().state(initial);
}

function useRefMock<T>(initial: T) {
  return requireHookMachine().ref(initial);
}

function useMemoMock<T>(factory: () => T) {
  return requireHookMachine().memo(factory);
}

function useCallbackMock<T>(value: T) {
  return requireHookMachine().callback(value);
}

const storageData = new Map<string, string>();
let armTrackedNonceAfterNextLengthRead = false;
const localStorage: LocalStorageLike = {
  get length() {
    const observedLength = storageData.size;
    if (armTrackedNonceAfterNextLengthRead) {
      armTrackedNonceAfterNextLengthRead = false;
      saveWalletTransferState({
        actor: EMBEDDED_ACTOR,
        destination: EXTERNAL_ACTOR,
        amountWei: 1n,
        nonce: TRACKED_NONCE,
      });
    }
    return observedLength;
  },
  getItem: (key) => storageData.get(key) ?? null,
  key: (index) => [...storageData.keys()][index] ?? null,
  removeItem: (key) => {
    storageData.delete(key);
  },
  setItem: (key, value) => {
    storageData.set(key, value);
  },
};

Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: { localStorage },
});
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    locks: {
      request: async (
        _name: string,
        _options: unknown,
        callback: (lock: object | null) => Promise<unknown>,
      ) => callback({}),
    },
  },
});

process.env.NEXT_PUBLIC_LINEA_RPCS = "https://rpc-one.example.com,https://rpc-two.example.net";
process.env.NEXT_PUBLIC_LINEA_SEPOLIA_RPCS = "https://rpc-one.example.com,https://rpc-two.example.net";

let transferReceiptMode: ReceiptMode = "pending";
let transferTransaction: {
  hash: `0x${string}`;
  chainId: number;
  from: string;
  nonce: number;
  to: string;
  value: bigint;
  input: `0x${string}`;
  type: "eip1559";
} = createNativeTransaction({
  actor: EXTERNAL_ACTOR,
  destination: EMBEDDED_ACTOR,
  amountWei: DEFAULT_ETH_DEPOSIT_WEI,
});

function receiptFor(mode: Exclude<ReceiptMode, "pending">) {
  return {
    transactionHash: HASH,
    blockHash: BLOCK_HASH,
    blockNumber: 100n,
    transactionIndex: 0,
    status: mode,
  };
}

function timeoutError() {
  const error = new Error("receipt timed out");
  error.name = "TimeoutError";
  return error;
}

function receiptNotFoundError() {
  const error = new Error("transaction receipt not found");
  error.name = "TransactionReceiptNotFoundError";
  return error;
}

type TestNonceReader = (args: {
  address: `0x${string}`;
  blockTag: "latest" | "pending";
}) => Promise<number>;

function createReceiptClient(
  canonicalHost: string,
  getTransactionCount: TestNonceReader = async ({ blockTag }) =>
    blockTag === "latest" ? TRACKED_NONCE : TRACKED_NONCE + 1,
  getReceiptMode: () => ReceiptMode = () => transferReceiptMode,
) {
  return {
    canonicalHost,
    getBlockNumber: async () => 200n,
    getTransaction: async () => ({ ...transferTransaction }),
    getTransactionReceipt: async () => {
      const receiptMode = getReceiptMode();
      if (receiptMode === "pending") throw receiptNotFoundError();
      return receiptFor(receiptMode);
    },
    waitForTransactionReceipt: async () => {
      const receiptMode = getReceiptMode();
      if (receiptMode === "pending") throw timeoutError();
      return receiptFor(receiptMode);
    },
    getTransactionCount,
  };
}

const transferReceiptClients = [
  createReceiptClient("rpc-one.example.com"),
  createReceiptClient("rpc-two.example.net"),
];
const resolverRewardsByActor = new Map<string, bigint>();
let resolverRefetches = 0;

mock.module("react", {
  namedExports: {
    useCallback: useCallbackMock,
    useMemo: useMemoMock,
    useRef: useRefMock,
    useState: useStateMock,
  },
});

mock.module("wagmi", {
  namedExports: {
    useReadContract: (input: { args?: readonly string[] }) => {
      const actor = input.args?.[0]?.toLowerCase();
      return {
        data: actor ? resolverRewardsByActor.get(actor) ?? 0n : 0n,
        refetch: async () => {
          resolverRefetches += 1;
        },
      };
    },
  },
});

mock.module(new URL("../app/lib/logger.ts", import.meta.url).href, {
  namedExports: {
    log: {
      debug: () => undefined,
      error: () => undefined,
      info: () => undefined,
      warn: () => undefined,
    },
  },
});

let useWalletActions: UseWalletActions;

function createNativeTransaction(input: {
  actor: `0x${string}`;
  destination: `0x${string}`;
  amountWei: bigint;
  chainId?: number;
  nonce?: number;
}) {
  return {
    hash: HASH,
    chainId: input.chainId ?? APP_CHAIN_ID,
    from: input.actor.toLowerCase(),
    nonce: input.nonce ?? TRACKED_NONCE,
    to: input.destination.toLowerCase(),
    value: input.amountWei,
    input: "0x" as const,
    type: "eip1559" as const,
  };
}

function saveWalletTransferState(input: {
  actor: `0x${string}`;
  destination: `0x${string}`;
  amountWei: bigint;
  nonce?: number;
  hash?: `0x${string}`;
}) {
  const now = Date.now();
  const nonce = input.nonce ?? TRACKED_NONCE;
  const actor = input.actor.toLowerCase();
  const destination = input.destination.toLowerCase();
  const amountWei = input.amountWei.toString();
  const key = [
    STORAGE_PREFIX,
    APP_CHAIN_ID,
    actor,
    "native",
    destination,
    amountWei,
  ].join(":");
  localStorage.setItem(key, JSON.stringify({
    id: "12345678-1234-4123-8123-123456789abc",
    actor,
    chainId: APP_CHAIN_ID,
    asset: "native",
    destination,
    amountWei,
    nonce,
    latestNonce: nonce,
    pendingNonce: nonce,
    hash: input.hash ?? HASH,
    transactionType: "eip1559",
    broadcastObserved: true,
    createdAt: now,
    updatedAt: now,
  }));
  transferTransaction = createNativeTransaction({
    actor: input.actor,
    destination: input.destination,
    amountWei: input.amountWei,
    nonce,
  });
  return key;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function flushMicrotasks() {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

type RenderOptions = {
  connectedWalletAddress?: string | null;
  embeddedWalletAddress?: string | null;
  externalWalletAddress?: string | null;
  getTransactionCount?: TestNonceReader;
  secondGetTransactionCount?: TestNonceReader;
  walletTransferReceiptClients?: readonly [
    ReturnType<typeof createReceiptClient>,
    ReturnType<typeof createReceiptClient>,
  ];
  sendTransactionSilent?: (tx: TransactionRequest) => Promise<typeof HASH>;
  sendTransactionFromExternal?: (tx: TransactionRequest) => Promise<typeof HASH>;
  writeContractAsync?: (input: Record<string, unknown>) => Promise<typeof HASH>;
  simulateContract?: (input: Record<string, unknown>) => Promise<unknown>;
  resolverReceiptMode?: ReceiptMode;
  externalTokenBalance?: bigint;
  notifications: Notification[];
  counters?: { embeddedEthRefetches: number; embeddedTokenRefetches: number };
};

function createHookRenderer(initialOptions: RenderOptions) {
  const machine = new HookMachine();
  let currentOptions = initialOptions;
  let result: HookResult;

  const render = () => {
    const options = currentOptions;
    const resolverReceiptMode = options.resolverReceiptMode ?? transferReceiptMode;
    const firstNonceReader = options.getTransactionCount ?? (async ({ blockTag }) =>
      blockTag === "latest" ? TRACKED_NONCE : TRACKED_NONCE + 1);
    const secondNonceReader = options.secondGetTransactionCount ?? firstNonceReader;
    const hookReceiptClients = options.walletTransferReceiptClients ?? [
      createReceiptClient("rpc-one.example.com", firstNonceReader, () => resolverReceiptMode),
      createReceiptClient("rpc-two.example.net", secondNonceReader, () => resolverReceiptMode),
    ] as const;
    const publicClient = {
      estimateFeesPerGas: async () => ({ gasPrice: 1n }),
      estimateGas: async () => 100_000n,
      getBlockNumber: async () => 200n,
      getTransaction: async () => ({ hash: HASH }),
      getTransactionCount: firstNonceReader,
      getTransactionReceipt: async () => {
        if (resolverReceiptMode === "pending") throw receiptNotFoundError();
        return receiptFor(resolverReceiptMode);
      },
      readContract: async () => options.externalTokenBalance ?? 10n ** 30n,
      simulateContract: options.simulateContract ?? (async () => undefined),
      waitForTransactionReceipt: async () => {
        if (resolverReceiptMode === "pending") throw timeoutError();
        return receiptFor(resolverReceiptMode);
      },
    };
    const rawSilentSend = options.sendTransactionSilent ?? (async () => HASH);
    const rawWriteContract = options.writeContractAsync ?? (async () => HASH);
    const durableSilentSend = async (transaction: TransactionRequest) => {
      if (!transaction.contractIntent) return rawSilentSend(transaction);
      const actor = (options.embeddedWalletAddress ?? EMBEDDED_ACTOR).toLowerCase() as `0x${string}`;
      const intent = createWalletContractIntent({
        actor,
        chainId: APP_CHAIN_ID,
        ...transaction.contractIntent,
      });
      const nonceClients = [
        { getTransactionCount: firstNonceReader },
        { getTransactionCount: secondNonceReader },
      ] as const;
      return withWalletTransferIntentLease(intent, nonceClients, async (acquisition, retainResult) => {
        if (acquisition.status === "known-hash") return acquisition.hash;
        transferTransaction = {
          hash: HASH,
          chainId: APP_CHAIN_ID,
          from: actor,
          nonce: acquisition.lease.nonce,
          to: transaction.contractIntent!.contract.toLowerCase(),
          value: 0n,
          input: transaction.contractIntent!.calldata.toLowerCase() as `0x${string}`,
          type: "eip1559",
        };
        const retained = await retainResult(
          rawSilentSend(transaction).then((hash) => ({ hash })),
          acquisition.lease,
        );
        return retained.hash;
      }, { abandonOnError: (error) => (error as { code?: unknown })?.code === 4001 });
    };
    const durableWriteContract = async (input: Record<string, unknown>) => {
      const actor = input.account;
      const nonce = input.nonce;
      if (
        input.functionName === "claimResolverRewards" &&
        typeof actor === "string" &&
        typeof nonce === "number"
      ) {
        transferTransaction = {
          hash: HASH,
          chainId: APP_CHAIN_ID,
          from: actor.toLowerCase(),
          nonce,
          to: CONTRACT_ADDRESS.toLowerCase(),
          value: 0n,
          input: encodeFunctionData({
            abi: GAME_ABI,
            functionName: "claimResolverRewards",
          }).toLowerCase() as `0x${string}`,
          type: "eip1559",
        };
      }
      return rawWriteContract(input);
    };

    result = machine.render(() => useWalletActions({
      connectedWalletAddress: options.connectedWalletAddress ?? null,
      embeddedWalletAddress: options.embeddedWalletAddress ?? EMBEDDED_ACTOR,
      externalWalletAddress: options.externalWalletAddress ?? EXTERNAL_ACTOR,
      embeddedTokenBalance: { value: 10n ** 30n },
      embeddedEthBalance: { value: 10n ** 30n },
      writeContractAsync: durableWriteContract,
      sendTransactionSilent: durableSilentSend,
      sendTransactionFromExternal: options.sendTransactionFromExternal ?? (async () => HASH),
      publicClient,
      refetchEmbeddedEthBalance: () => {
        if (options.counters) options.counters.embeddedEthRefetches += 1;
      },
      refetchEmbeddedTokenBalance: () => {
        if (options.counters) options.counters.embeddedTokenRefetches += 1;
      },
      walletTransfersEnabled: true,
      notify: (message: string, tone?: Notification["tone"]) => {
        options.notifications.push({ message, tone });
      },
      onOpenWalletSettings: () => undefined,
      minEthForGas: 0,
      minEthWithdrawReserveWei: 0n,
      walletTransferReceiptClients: hookReceiptClients,
    }));
  };

  render();
  return {
    get result() {
      return result;
    },
    rerender(next: Partial<RenderOptions> = {}) {
      currentOptions = { ...currentOptions, ...next };
      render();
    },
  };
}

function resetRuntimeState() {
  storageData.clear();
  armTrackedNonceAfterNextLengthRead = false;
  resolverRewardsByActor.clear();
  resolverRefetches = 0;
  transferReceiptMode = "pending";
  transferTransaction = createNativeTransaction({
    actor: EXTERNAL_ACTOR,
    destination: EMBEDDED_ACTOR,
    amountWei: DEFAULT_ETH_DEPOSIT_WEI,
  });
}

function hasNotification(
  notifications: Notification[],
  tone: Notification["tone"],
  fragment: string,
) {
  return notifications.some((notification) =>
    notification.tone === tone && notification.message.includes(fragment)
  );
}

function assertNoRawNeedle(notifications: Notification[], needle: string) {
  assert.ok(
    notifications.every(({ message }) => !message.includes(needle)),
    `user notifications must not expose raw provider detail ${needle}`,
  );
}

async function testWrongNetworkRefresh() {
  resetRuntimeState();
  const notifications: Notification[] = [];
  const hook = createHookRenderer({
    notifications,
    getTransactionCount: async () => {
      throw new Error("chain id mismatch: wrong network");
    },
  });
  assert.equal(await hook.result.refreshPendingTransactionStatus(), null);
  assert.ok(
    hasNotification(notifications, "warning", "wallet is on the wrong network") &&
      notifications.some(({ message }) => message.includes("Switch to")),
    "wrong-network nonce reads must produce an actionable network transition",
  );
}

async function testRejectedRepair() {
  resetRuntimeState();
  const notifications: Notification[] = [];
  let sends = 0;
  const hook = createHookRenderer({
    notifications,
    sendTransactionSilent: async () => {
      sends += 1;
      throw Object.assign(new Error("User rejected the request"), { code: 4001 });
    },
  });
  await hook.result.cancelPendingTransaction();
  assert.equal(sends, 1);
  assert.deepEqual(notifications.at(-1), {
    message: "Pending transaction repair rejected in wallet.",
    tone: "info",
  });
}

async function testPendingRepair() {
  resetRuntimeState();
  const notifications: Notification[] = [];
  let sends = 0;
  const hook = createHookRenderer({
    notifications,
    sendTransactionSilent: async () => {
      sends += 1;
      return HASH;
    },
  });
  await hook.result.cancelPendingTransaction();
  assert.equal(sends, 1);
  assert.ok(
    notifications.some(({ message, tone }) =>
      tone === "warning" &&
      message.includes("still pending confirmation") &&
      message.includes(`${EXPLORER_TX_BASE_URL}/${HASH}`)
    ),
    "a hash-known receipt timeout must transition to pending with an explorer link",
  );
}

async function testDivergentNonceEvidenceBlocksRepair() {
  resetRuntimeState();
  const notifications: Notification[] = [];
  let sends = 0;
  const hook = createHookRenderer({
    notifications,
    secondGetTransactionCount: async ({ blockTag }) =>
      blockTag === "latest" ? TRACKED_NONCE : TRACKED_NONCE + 2,
    sendTransactionSilent: async () => {
      sends += 1;
      return HASH;
    },
  });

  await hook.result.cancelPendingTransaction();

  assert.equal(sends, 0, "divergent nonce evidence must not reach the wallet send sink");
  assert.ok(hasNotification(notifications, "warning", "independent RPCs disagree"));
}

async function testDuplicateNonceClientBlocksRepair() {
  resetRuntimeState();
  const notifications: Notification[] = [];
  const firstClient = createReceiptClient("same-rpc.example.com");
  const secondClient = createReceiptClient("same-rpc.example.com");
  let sends = 0;
  const hook = createHookRenderer({
    notifications,
    walletTransferReceiptClients: [firstClient, secondClient],
    sendTransactionSilent: async () => {
      sends += 1;
      return HASH;
    },
  });

  await hook.result.cancelPendingTransaction();

  assert.equal(sends, 0, "duplicate RPC origins must not authorize repair");
  assert.ok(hasNotification(notifications, "warning", "two independent RPCs"));
}

async function testManualReplacementReconciliationPresentation() {
  resetRuntimeState();
  const notifications: Notification[] = [];
  const hook = createHookRenderer({ notifications });
  saveWalletTransferState({
    actor: EXTERNAL_ACTOR,
    destination: EMBEDDED_ACTOR,
    amountWei: DEFAULT_ETH_DEPOSIT_WEI,
  });

  await hook.result.refreshPendingTransactionStatus(HASH);
  assert.ok(
    notifications.some(({ message, tone }) =>
      tone === "warning" &&
      message.includes("exact gas-only replacement") &&
      message.includes("remains pending finality") &&
      message.includes(`${EXPLORER_TX_BASE_URL}/${HASH}`)
    ),
    "manual replacement reconciliation must expose its pending state with the exact explorer URL",
  );
  assert.equal(storageData.size, 1, "a pending replacement must keep the original transfer intent blocked");

  notifications.length = 0;
  transferTransaction = {
    ...transferTransaction,
    to: OTHER_ACTOR.toLowerCase() as `0x${string}`,
  };
  await hook.result.refreshPendingTransactionStatus(HASH);
  assert.ok(
    notifications.some(({ message, tone }) =>
      tone === "warning" &&
      message.includes("not accepted by both RPCs") &&
      message.includes("remains blocked for manual review")
    ),
    "a mismatched replacement must fail closed with manual-reconciliation guidance",
  );
  assert.equal(storageData.size, 1, "a rejected replacement must not release the blocked transfer intent");
}

async function testDuplicateRepair() {
  resetRuntimeState();
  const notifications: Notification[] = [];
  const sendGate = deferred<typeof HASH>();
  let sends = 0;
  const hook = createHookRenderer({
    notifications,
    sendTransactionSilent: async () => {
      sends += 1;
      return sendGate.promise;
    },
  });
  const first = hook.result.cancelPendingTransaction();
  await flushMicrotasks();
  await hook.result.cancelPendingTransaction();
  assert.equal(sends, 1, "a rapid second clear must not reach the wallet send sink");
  assert.ok(hasNotification(notifications, "info", "already in progress"));
  sendGate.resolve(HASH);
  await first;
}

async function testSinkAdjacentTrackedNonceRecheck() {
  resetRuntimeState();
  const notifications: Notification[] = [];
  let sends = 0;
  const hook = createHookRenderer({
    notifications,
    sendTransactionSilent: async () => {
      sends += 1;
      return HASH;
    },
  });

  armTrackedNonceAfterNextLengthRead = true;
  await hook.result.cancelPendingTransaction();

  assert.equal(sends, 0, "the sink-adjacent tracked-nonce recheck must block wallet submission");
  assert.ok(hasNotification(notifications, "danger", "tracked transfer, bet, or approval"));
}

async function testTransferDuplicateAndState() {
  resetRuntimeState();
  const notifications: Notification[] = [];
  const sendGate = deferred<typeof HASH>();
  let sends = 0;
  const hook = createHookRenderer({
    notifications,
    sendTransactionFromExternal: async (tx) => {
      sends += 1;
      assert.equal(tx.expectedActor?.toLowerCase(), EXTERNAL_ACTOR.toLowerCase());
      return sendGate.promise;
    },
  });

  const first = hook.result.handleDepositEthToEmbedded();
  await flushMicrotasks();
  hook.rerender();
  assert.equal(hook.result.isDepositingEth, true, "the transfer must expose its signing/pending state");
  await hook.result.handleDepositEthToEmbedded();
  assert.equal(sends, 1, "a rapid duplicate transfer must not reach the external wallet sink");

  sendGate.reject(Object.assign(new Error("User rejected the request"), { code: 4001 }));
  await first;
  hook.rerender();
  assert.equal(hook.result.isDepositingEth, false, "the transfer state must clear after rejection");
  assert.ok(hasNotification(notifications, "info", "ETH top-up rejected in wallet"));
}

async function testTransferPendingRetainsIntent() {
  resetRuntimeState();
  transferReceiptMode = "pending";
  const notifications: Notification[] = [];
  const hook = createHookRenderer({
    notifications,
    sendTransactionFromExternal: async (tx) => {
      assert.equal(tx.to.toLowerCase(), EMBEDDED_ACTOR.toLowerCase());
      assert.equal(tx.expectedActor?.toLowerCase(), EXTERNAL_ACTOR.toLowerCase());
      assert.equal(tx.value, DEFAULT_ETH_DEPOSIT_WEI);
      saveWalletTransferState({
        actor: EXTERNAL_ACTOR,
        destination: EMBEDDED_ACTOR,
        amountWei: DEFAULT_ETH_DEPOSIT_WEI,
      });
      return HASH;
    },
  });

  await hook.result.handleDepositEthToEmbedded();
  assert.equal(storageData.size, 1, "a pending transfer must retain its durable safety intent");
  assert.ok(
    notifications.some(({ message, tone }) =>
      tone === "info" && message.includes("still pending confirmation") && message.includes(HASH)
    ),
  );
}

async function testTransferSuccessClearsIntent() {
  resetRuntimeState();
  transferReceiptMode = "success";
  const notifications: Notification[] = [];
  const counters = { embeddedEthRefetches: 0, embeddedTokenRefetches: 0 };
  const hook = createHookRenderer({
    notifications,
    counters,
    sendTransactionFromExternal: async () => {
      saveWalletTransferState({
        actor: EXTERNAL_ACTOR,
        destination: EMBEDDED_ACTOR,
        amountWei: DEFAULT_ETH_DEPOSIT_WEI,
      });
      return HASH;
    },
  });

  await hook.result.handleDepositEthToEmbedded();
  assert.equal(storageData.size, 0, "a final confirmed transfer must clear its exact intent");
  assert.equal(counters.embeddedEthRefetches, 1);
  assert.ok(hasNotification(notifications, "success", "ETH transfer to the Privy wallet was sent"));
  assert.ok(notifications.at(-1)?.message.includes(HASH));
}

async function testTransferRevertClearsIntentSafely() {
  resetRuntimeState();
  transferReceiptMode = "reverted";
  const notifications: Notification[] = [];
  const hook = createHookRenderer({
    notifications,
    sendTransactionFromExternal: async () => {
      saveWalletTransferState({
        actor: EXTERNAL_ACTOR,
        destination: EMBEDDED_ACTOR,
        amountWei: DEFAULT_ETH_DEPOSIT_WEI,
      });
      return HASH;
    },
  });

  await hook.result.handleDepositEthToEmbedded();
  assert.equal(storageData.size, 0, "a final reverted transfer must release its exact intent");
  assert.ok(hasNotification(notifications, "danger", "reverted on-chain"));
  assert.ok(notifications.some(({ message }) => message.includes("Funds were not moved")));
}

async function testTransferNetworkMismatchFailsClosed() {
  resetRuntimeState();
  transferReceiptMode = "success";
  const notifications: Notification[] = [];
  const counters = { embeddedEthRefetches: 0, embeddedTokenRefetches: 0 };
  const hook = createHookRenderer({
    notifications,
    counters,
    sendTransactionFromExternal: async () => {
      saveWalletTransferState({
        actor: EXTERNAL_ACTOR,
        destination: EMBEDDED_ACTOR,
        amountWei: DEFAULT_ETH_DEPOSIT_WEI,
      });
      transferTransaction = {
        ...transferTransaction,
        chainId: APP_CHAIN_ID + 1,
      };
      return HASH;
    },
  });

  await hook.result.handleDepositEthToEmbedded();
  assert.equal(storageData.size, 1, "a wrong-chain transaction must leave the intent blocked");
  assert.equal(counters.embeddedEthRefetches, 0);
  assert.ok(hasNotification(notifications, "warning", "do not match the approved request"));
  assert.equal(hasNotification(notifications, "success", "was sent"), false);
}

async function testTransferProviderErrorIsRedacted() {
  resetRuntimeState();
  const notifications: Notification[] = [];
  const rawNeedle = "provider-secret-needle";
  const hook = createHookRenderer({
    notifications,
    sendTransactionFromExternal: async () => {
      throw new Error(`JSON-RPC provider failed with ${rawNeedle}`);
    },
  });

  await hook.result.handleDepositEthToEmbedded();
  assert.ok(hasNotification(notifications, "danger", "wallet provider"));
  assertNoRawNeedle(notifications, rawNeedle);
}

function stableReceipt(
  status: Exclude<ReceiptMode, "pending">,
  blockHash = BLOCK_HASH,
): StableReceipt {
  return {
    transactionHash: HASH,
    blockHash,
    blockNumber: 100n,
    transactionIndex: 0,
    status,
  };
}

function stableReceiptClient(input: {
  waited: StableReceipt | Error;
  receipts: readonly (StableReceipt | Error)[];
  head: bigint;
}): StableReceiptClient {
  let receiptRead = 0;
  return {
    getBlockNumber: async () => input.head,
    getTransaction: async () => ({ hash: HASH }),
    getTransactionReceipt: async () => {
      const result = input.receipts[Math.min(receiptRead, input.receipts.length - 1)];
      receiptRead += 1;
      if (result instanceof Error) throw result;
      return result;
    },
    waitForTransactionReceipt: async () => {
      if (input.waited instanceof Error) throw input.waited;
      return input.waited;
    },
  };
}

async function testStableReceiptTwoOriginFinality() {
  const confirmed = stableReceipt("success");
  assert.equal(
    await waitForStableWalletTransferReceipt([
      stableReceiptClient({ waited: confirmed, receipts: [confirmed, confirmed], head: 101n }),
      stableReceiptClient({ waited: confirmed, receipts: [confirmed, confirmed], head: 101n }),
    ], HASH, 1_000),
    "confirmed",
    "matching finalized receipts from two origins must confirm",
  );

  const canonicalReorg = stableReceipt("success", `0x${"c".repeat(64)}` as `0x${string}`);
  await assert.rejects(
    () => waitForStableWalletTransferReceipt([
      stableReceiptClient({ waited: confirmed, receipts: [confirmed, canonicalReorg], head: 101n }),
      stableReceiptClient({ waited: confirmed, receipts: [confirmed, canonicalReorg], head: 101n }),
    ], HASH, 1_000),
    /wallet_transfer_receipt_diverged/,
    "a canonical reread that differs after finality must reject",
  );

  await assert.rejects(
    () => waitForStableWalletTransferReceipt([
      stableReceiptClient({ waited: confirmed, receipts: [confirmed], head: 101n }),
      stableReceiptClient({ waited: timeoutError(), receipts: [receiptNotFoundError()], head: 101n }),
    ], HASH, 1_000),
    /wallet_transfer_receipt_diverged/,
    "one origin alone must not confirm a receipt",
  );

  await assert.rejects(
    () => waitForStableWalletTransferReceipt([
      stableReceiptClient({ waited: confirmed, receipts: [confirmed], head: 101n }),
      stableReceiptClient({ waited: confirmed, receipts: [confirmed], head: 100n }),
    ], HASH, 1_000),
    /wallet_transfer_receipt_finality_insufficient/,
    "a stale origin head must not confirm a receipt",
  );

  const reverted = stableReceipt("reverted");
  await assert.rejects(
    () => waitForStableWalletTransferReceipt([
      stableReceiptClient({ waited: reverted, receipts: [reverted, reverted], head: 101n }),
      stableReceiptClient({ waited: reverted, receipts: [reverted, reverted], head: 101n }),
    ], HASH, 1_000),
    (error: unknown) => {
      assert.ok(error instanceof WalletTransactionRevertedError, "a finalized revert must retain its typed error");
      assert.equal(error.transactionHash, HASH, "a finalized revert must retain its definitive hash");
      return true;
    },
  );
}

async function testResolverRewardDisplaySemantics() {
  resetRuntimeState();
  resolverRewardsByActor.set(EXTERNAL_ACTOR.toLowerCase(), 1_234_567_890_000_000_000n);
  resolverRewardsByActor.set(EMBEDDED_ACTOR.toLowerCase(), 100_126_000_000_000_000_000n);
  const hook = createHookRenderer({
    connectedWalletAddress: EXTERNAL_ACTOR,
    notifications: [],
  });
  assert.equal(hook.result.connectedResolverRewards, "1.2346", "sub-threshold resolver rewards keep four decimal places");
  assert.equal(hook.result.embeddedResolverRewards, "100.13", "large resolver rewards use the two-decimal display threshold");

  resetRuntimeState();
  resolverRewardsByActor.set(EXTERNAL_ACTOR.toLowerCase(), -1n);
  const negativeHook = createHookRenderer({
    connectedWalletAddress: EXTERNAL_ACTOR,
    notifications: [],
  });
  assert.equal(negativeHook.result.connectedResolverRewards, "0.0000", "negative resolver rewards must fail closed in the display");
}

async function testExternalLineaBalanceBlocksDepositSink() {
  resetRuntimeState();
  const notifications: Notification[] = [];
  let sends = 0;
  const hook = createHookRenderer({
    notifications,
    externalTokenBalance: 9n * 10n ** 18n,
    sendTransactionFromExternal: async () => {
      sends += 1;
      return HASH;
    },
  });

  await hook.result.handleDepositTokenToEmbedded();
  assert.equal(sends, 0, "an insufficient external LINEA balance must not reach the wallet send sink");
  assert.ok(hasNotification(notifications, "warning", "Insufficient LINEA balance in external wallet."));
}

async function testResolverStaleActorAndDuplicateGuards() {
  resetRuntimeState();
  resolverRewardsByActor.set(EXTERNAL_ACTOR.toLowerCase(), 5n);
  resolverRewardsByActor.set(OTHER_ACTOR.toLowerCase(), 5n);
  const notifications: Notification[] = [];
  const simulationGate = deferred<void>();
  let simulations = 0;
  let writes = 0;
  const hook = createHookRenderer({
    connectedWalletAddress: EXTERNAL_ACTOR,
    notifications,
    resolverReceiptMode: "success",
    simulateContract: async () => {
      simulations += 1;
      return simulationGate.promise;
    },
    writeContractAsync: async () => {
      writes += 1;
      return HASH;
    },
  });

  const first = hook.result.handleClaimConnectedResolverRewards();
  await flushMicrotasks();
  hook.rerender();
  assert.equal(hook.result.isClaimingConnectedResolverRewards, true);
  await hook.result.handleClaimConnectedResolverRewards();
  assert.equal(simulations, 1, "a rapid duplicate claim must not begin a second simulation");

  hook.rerender({ connectedWalletAddress: OTHER_ACTOR });
  simulationGate.resolve();
  await first;
  hook.rerender();
  assert.equal(writes, 0, "a resolver actor change after simulation must stop before the wallet sink");
  assert.equal(hook.result.isClaimingConnectedResolverRewards, false);
}

async function testEmbeddedResolverStaleActorStopsSink() {
  resetRuntimeState();
  resolverRewardsByActor.set(EMBEDDED_ACTOR.toLowerCase(), 5n);
  resolverRewardsByActor.set(OTHER_ACTOR.toLowerCase(), 5n);
  const notifications: Notification[] = [];
  const simulationGate = deferred<void>();
  let sends = 0;
  const hook = createHookRenderer({
    notifications,
    simulateContract: async () => simulationGate.promise,
    sendTransactionSilent: async () => {
      sends += 1;
      return HASH;
    },
  });

  const claim = hook.result.handleClaimEmbeddedResolverRewards();
  await flushMicrotasks();
  hook.rerender({ embeddedWalletAddress: OTHER_ACTOR });
  simulationGate.resolve();
  await claim;
  assert.equal(sends, 0, "an embedded resolver actor change after simulation must stop before the wallet sink");
}

async function testResolverSuccessWiring() {
  resetRuntimeState();
  resolverRewardsByActor.set(EXTERNAL_ACTOR.toLowerCase(), 5n);
  const notifications: Notification[] = [];
  const order: string[] = [];
  let writeInput: Record<string, unknown> | undefined;
  const hook = createHookRenderer({
    connectedWalletAddress: EXTERNAL_ACTOR,
    notifications,
    resolverReceiptMode: "success",
    simulateContract: async () => {
      order.push("simulate");
    },
    writeContractAsync: async (input) => {
      order.push("write");
      writeInput = input;
      return HASH;
    },
  });

  await hook.result.handleClaimConnectedResolverRewards();
  assert.deepEqual(order, ["simulate", "write"], "resolver claim simulation must precede wallet submission");
  assert.equal(writeInput?.functionName, "claimResolverRewards");
  assert.equal(writeInput?.chainId, APP_CHAIN_ID);
  assert.equal(writeInput?.account, EXTERNAL_ACTOR);
  assert.equal(writeInput?.nonce, TRACKED_NONCE + 1);
  assert.equal(writeInput?.gas, 120_000n);
  assert.equal(resolverRefetches, 2, "successful claims must refresh both resolver reward reads");
  assert.ok(hasNotification(notifications, "success", "Resolver rewards claimed"));
  assert.ok(notifications.at(-1)?.message.includes(HASH));
  assert.equal(storageData.size, 0, "a confirmed connected resolver claim must release its durable intent");
}

async function testResolverPendingAndRevertedStates() {
  resetRuntimeState();
  resolverRewardsByActor.set(EMBEDDED_ACTOR.toLowerCase(), 5n);
  const pendingNotifications: Notification[] = [];
  let pendingSends = 0;
  const pendingHook = createHookRenderer({
    notifications: pendingNotifications,
    resolverReceiptMode: "pending",
    sendTransactionSilent: async (tx) => {
      pendingSends += 1;
      assert.equal(tx.to.toLowerCase(), CONTRACT_ADDRESS.toLowerCase());
      assert.equal(tx.gas, 120_000n);
      assert.ok(tx.data?.startsWith("0x"));
      assert.equal(tx.contractIntent?.contract.toLowerCase(), CONTRACT_ADDRESS.toLowerCase());
      assert.equal(tx.contractIntent?.calldata, tx.data);
      return HASH;
    },
  });
  await pendingHook.result.handleClaimEmbeddedResolverRewards();
  assert.equal(pendingSends, 1);
  assert.ok(
    pendingNotifications.some(({ message, tone }) =>
      tone === "info" && message.includes("still pending confirmation") && message.includes(HASH)
    ),
  );
  assert.equal(storageData.size, 1, "a pending embedded resolver claim must retain its durable intent");

  resetRuntimeState();
  resolverRewardsByActor.set(EXTERNAL_ACTOR.toLowerCase(), 5n);
  const connectedPendingNotifications: Notification[] = [];
  const connectedPendingHook = createHookRenderer({
    connectedWalletAddress: EXTERNAL_ACTOR,
    notifications: connectedPendingNotifications,
    resolverReceiptMode: "pending",
  });
  await connectedPendingHook.result.handleClaimConnectedResolverRewards();
  assert.ok(
    connectedPendingNotifications.some(({ message, tone }) =>
      tone === "info" && message.includes("still pending confirmation") && message.includes(HASH)
    ),
  );
  assert.equal(storageData.size, 1, "a pending connected resolver claim must retain its durable intent");

  resetRuntimeState();
  resolverRewardsByActor.set(EMBEDDED_ACTOR.toLowerCase(), 5n);
  const embeddedSuccessNotifications: Notification[] = [];
  const embeddedSuccessHook = createHookRenderer({
    notifications: embeddedSuccessNotifications,
    resolverReceiptMode: "success",
  });
  await embeddedSuccessHook.result.handleClaimEmbeddedResolverRewards();
  assert.ok(hasNotification(embeddedSuccessNotifications, "success", "Resolver rewards claimed"));
  assert.equal(storageData.size, 0, "a confirmed exact embedded resolver claim must release its durable intent");

  resetRuntimeState();
  resolverRewardsByActor.set(EMBEDDED_ACTOR.toLowerCase(), 5n);
  const embeddedRevertedNotifications: Notification[] = [];
  const embeddedRevertedHook = createHookRenderer({
    notifications: embeddedRevertedNotifications,
    resolverReceiptMode: "reverted",
  });
  await embeddedRevertedHook.result.handleClaimEmbeddedResolverRewards();
  assert.ok(hasNotification(embeddedRevertedNotifications, "danger", "reverted"));
  assert.equal(storageData.size, 0, "a stably reverted exact embedded resolver claim must release its durable intent");

  resetRuntimeState();
  resolverRewardsByActor.set(EXTERNAL_ACTOR.toLowerCase(), 5n);
  const revertedNotifications: Notification[] = [];
  const revertedHook = createHookRenderer({
    connectedWalletAddress: EXTERNAL_ACTOR,
    notifications: revertedNotifications,
    resolverReceiptMode: "reverted",
  });
  await revertedHook.result.handleClaimConnectedResolverRewards();
  assert.ok(hasNotification(revertedNotifications, "danger", "reverted on-chain"));
  assert.ok(revertedNotifications.some(({ message }) => message.includes("No funds were moved")));
  assert.equal(storageData.size, 0, "a stably reverted connected resolver claim must release its durable intent");
}

async function testEmbeddedResolverActorSwitchStillResolvesTerminalIntent() {
  resetRuntimeState();
  resolverRewardsByActor.set(EMBEDDED_ACTOR.toLowerCase(), 5n);
  resolverRewardsByActor.set(OTHER_ACTOR.toLowerCase(), 5n);
  const notifications: Notification[] = [];
  const receiptGate = deferred<StableReceipt>();
  const firstNonceReader: TestNonceReader = async ({ blockTag }) =>
    blockTag === "latest" ? TRACKED_NONCE : TRACKED_NONCE + 1;
  const receiptClients = [
    {
      ...createReceiptClient("rpc-one.example.com", firstNonceReader, () => "success"),
      waitForTransactionReceipt: async () => receiptGate.promise,
    },
    {
      ...createReceiptClient("rpc-two.example.net", firstNonceReader, () => "success"),
      waitForTransactionReceipt: async () => receiptGate.promise,
    },
  ] as const;
  const hook = createHookRenderer({
    notifications,
    resolverReceiptMode: "success",
    walletTransferReceiptClients: receiptClients,
  });

  const claim = hook.result.handleClaimEmbeddedResolverRewards();
  await flushMicrotasks();
  await flushMicrotasks();
  assert.equal(storageData.size, 1, "the submitted claim must be durable while finality is pending");
  hook.rerender({ embeddedWalletAddress: OTHER_ACTOR });
  receiptGate.resolve(receiptFor("success"));
  await claim;
  assert.equal(
    storageData.size,
    0,
    "terminal exact evidence must clear the original actor intent even after the UI actor changes",
  );
}

async function testResolverRejectionAndProviderRedaction() {
  resetRuntimeState();
  resolverRewardsByActor.set(EXTERNAL_ACTOR.toLowerCase(), 5n);
  const rejectedNotifications: Notification[] = [];
  const rejectedHook = createHookRenderer({
    connectedWalletAddress: EXTERNAL_ACTOR,
    notifications: rejectedNotifications,
    writeContractAsync: async () => {
      throw Object.assign(new Error("User rejected the request"), { code: 4001 });
    },
  });
  await rejectedHook.result.handleClaimConnectedResolverRewards();
  assert.deepEqual(rejectedNotifications.at(-1), {
    message: "Resolver reward claim rejected in wallet.",
    tone: "info",
  });
  assert.equal(storageData.size, 0, "a proven pre-broadcast connected rejection must release its lease");

  resetRuntimeState();
  resolverRewardsByActor.set(EXTERNAL_ACTOR.toLowerCase(), 5n);
  const rawNeedle = "claim-provider-secret-needle";
  const providerNotifications: Notification[] = [];
  const providerHook = createHookRenderer({
    connectedWalletAddress: EXTERNAL_ACTOR,
    notifications: providerNotifications,
    writeContractAsync: async () => {
      throw new Error(`RPC provider leaked ${rawNeedle}`);
    },
  });
  await providerHook.result.handleClaimConnectedResolverRewards();
  assert.ok(hasNotification(providerNotifications, "danger", "wallet provider"));
  assertNoRawNeedle(providerNotifications, rawNeedle);
  assert.equal(storageData.size, 1, "an ambiguous connected provider failure must retain the duplicate-send block");
}

async function main() {
  const walletActionsModule = await import("../app/hooks/useWalletActions") as unknown as {
    default?: { useWalletActions?: UseWalletActions };
    useWalletActions?: UseWalletActions;
  };
  const walletActionsExports = walletActionsModule.default ?? walletActionsModule;
  const hookFactory = walletActionsExports.useWalletActions;
  assert.equal(typeof hookFactory, "function");
  useWalletActions = hookFactory as UseWalletActions;
  await testWrongNetworkRefresh();
  await testRejectedRepair();
  await testPendingRepair();
  await testDivergentNonceEvidenceBlocksRepair();
  await testDuplicateNonceClientBlocksRepair();
  await testManualReplacementReconciliationPresentation();
  await testDuplicateRepair();
  await testSinkAdjacentTrackedNonceRecheck();
  await testTransferDuplicateAndState();
  await testTransferPendingRetainsIntent();
  await testTransferSuccessClearsIntent();
  await testTransferRevertClearsIntentSafely();
  await testTransferNetworkMismatchFailsClosed();
  await testTransferProviderErrorIsRedacted();
  await testStableReceiptTwoOriginFinality();
  await testResolverRewardDisplaySemantics();
  await testExternalLineaBalanceBlocksDepositSink();
  await testResolverStaleActorAndDuplicateGuards();
  await testEmbeddedResolverStaleActorStopsSink();
  await testResolverSuccessWiring();
  await testResolverPendingAndRevertedStates();
  await testEmbeddedResolverActorSwitchStillResolvesTerminalIntent();
  await testResolverRejectionAndProviderRedaction();

  console.log("wallet actions hook behavior tests passed (23 cases)");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
