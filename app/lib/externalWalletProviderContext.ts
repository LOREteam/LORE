import { getAddress, type Address } from "viem";

export type ExternalWalletEip1193Provider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};

export type ExternalWalletProviderContextErrorCode =
  | "wallet_transfer_intent_external_chain_changed"
  | "wallet_transfer_intent_actor_changed"
  | "wallet_transfer_intent_external_account_unavailable";

export class ExternalWalletProviderContextError extends Error {
  readonly safeBeforeSubmission = true;

  constructor(readonly code: ExternalWalletProviderContextErrorCode) {
    super(code);
    this.name = "ExternalWalletProviderContextError";
  }
}

export function isSafeExternalWalletProviderContextError(
  error: unknown,
): error is ExternalWalletProviderContextError {
  return error instanceof ExternalWalletProviderContextError && error.safeBeforeSubmission;
}

function unknownProviderContext(message: string): Error {
  return new Error(`External wallet provider returned an invalid ${message}`);
}

async function requestProviderWithTimeout(
  provider: ExternalWalletEip1193Provider,
  method: string,
  timeoutMs: number,
): Promise<unknown> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      provider.request({ method }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`External wallet provider ${method} request timed out`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

function parseProviderChainId(value: unknown): number {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) {
    throw unknownProviderContext("chain ID");
  }

  const chainId = Number.parseInt(value, 16);
  if (!Number.isSafeInteger(chainId) || chainId < 1) {
    throw unknownProviderContext("chain ID");
  }

  return chainId;
}

function parseProviderAccounts(value: unknown): Address[] {
  if (!Array.isArray(value)) {
    throw unknownProviderContext("accounts response");
  }

  if (value.length === 0) {
    return [];
  }

  try {
    return value.map((account) => {
      if (typeof account !== "string") {
        throw unknownProviderContext("account address");
      }
      return getAddress(account);
    });
  } catch {
    throw unknownProviderContext("account address");
  }
}

export async function assertExternalWalletProviderContext({
  provider,
  expectedActor,
  expectedChainId,
  timeoutMs = 5_000,
}: {
  provider: ExternalWalletEip1193Provider;
  expectedActor?: string;
  expectedChainId: number;
  timeoutMs?: number;
}): Promise<Address> {
  const [chainIdValue, accountsValue] = await Promise.all([
    requestProviderWithTimeout(provider, "eth_chainId", timeoutMs),
    requestProviderWithTimeout(provider, "eth_accounts", timeoutMs),
  ]);

  // Both responses must be valid before a mismatch can safely abandon a lease.
  // Otherwise a malformed/uncertain provider reply preserves the intent and
  // prevents a blind retry from creating a duplicate transaction.
  const chainId = parseProviderChainId(chainIdValue);
  const accounts = parseProviderAccounts(accountsValue);

  if (chainId !== expectedChainId) {
    throw new ExternalWalletProviderContextError(
      "wallet_transfer_intent_external_chain_changed",
    );
  }

  const providerAccount = accounts[0];
  if (!providerAccount) {
    throw new ExternalWalletProviderContextError(
      "wallet_transfer_intent_external_account_unavailable",
    );
  }

  if (!expectedActor) {
    return providerAccount;
  }

  let canonicalExpectedActor: string;
  try {
    canonicalExpectedActor = getAddress(expectedActor);
  } catch {
    throw unknownProviderContext("expected account address");
  }

  if (providerAccount !== canonicalExpectedActor) {
    throw new ExternalWalletProviderContextError(
      "wallet_transfer_intent_actor_changed",
    );
  }

  return providerAccount;
}
