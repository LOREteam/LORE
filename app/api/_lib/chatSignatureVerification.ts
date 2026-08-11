import {
  createPublicClient,
  http,
  isAddressEqual,
  recoverMessageAddress,
  type Address,
  type Chain,
  type Hex,
  type Transport,
} from "viem";

const REQUIRED_CHAT_SIGNATURE_RPC_WITNESSES = 2;

export type ChatSignatureRpcWitness = {
  canonicalHost: string;
  verifyMessage: (parameters: {
    address: Address;
    message: string;
    signature: Hex;
  }) => Promise<boolean>;
};

export type ChatSignatureTransportFactory = (url: string) => Transport;

export class ChatSignatureRpcQuorumError extends Error {
  constructor() {
    super("chat_signature_independent_rpc_required count=2");
    this.name = "ChatSignatureRpcQuorumError";
  }
}

function parseCanonicalRpcHost(endpoint: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    return null;
  }
  const hasUserInfo = /^[a-z][a-z\d+.-]*:\/\/[^/?#]*@/i.test(endpoint);
  if (
    parsed.protocol !== "https:" ||
    hasUserInfo ||
    parsed.username ||
    parsed.password
  ) {
    return null;
  }
  const canonicalHost = parsed.hostname.toLowerCase().replace(/\.+$/, "");
  return canonicalHost || null;
}

export function createChatSignatureRpcWitnesses(options: {
  rpcUrls: readonly string[];
  chain?: Chain;
  transportForUrl?: ChatSignatureTransportFactory;
}): readonly ChatSignatureRpcWitness[] {
  const transportForUrl = options.transportForUrl ??
    ((url: string) => http(url, { timeout: 20_000, retryCount: 0 }));
  const seenHosts = new Set<string>();
  const witnesses: ChatSignatureRpcWitness[] = [];

  for (const rawUrl of options.rpcUrls) {
    const endpoint = rawUrl.trim();
    const canonicalHost = parseCanonicalRpcHost(endpoint);
    if (!canonicalHost || seenHosts.has(canonicalHost)) continue;

    const client = createPublicClient({
      chain: options.chain,
      transport: transportForUrl(endpoint),
    });
    seenHosts.add(canonicalHost);
    witnesses.push({
      canonicalHost,
      verifyMessage: (parameters) => client.verifyMessage(parameters),
    });
    if (witnesses.length === REQUIRED_CHAT_SIGNATURE_RPC_WITNESSES) break;
  }

  return witnesses;
}

export async function verifyChatWalletMessage(options: {
  address: Address;
  message: string;
  signature: Hex;
  rpcWitnesses: readonly ChatSignatureRpcWitness[];
}) {
  try {
    const recoveredAddress = await recoverMessageAddress({
      message: options.message,
      signature: options.signature,
    });
    if (isAddressEqual(recoveredAddress, options.address)) return true;
  } catch {
    // Contract-wallet signatures are not required to be ECDSA-recoverable.
  }

  const rpcWitnesses = options.rpcWitnesses.slice(
    0,
    REQUIRED_CHAT_SIGNATURE_RPC_WITNESSES,
  );
  if (rpcWitnesses.length !== REQUIRED_CHAT_SIGNATURE_RPC_WITNESSES) {
    throw new ChatSignatureRpcQuorumError();
  }
  if (rpcWitnesses[0].canonicalHost === rpcWitnesses[1].canonicalHost) {
    throw new ChatSignatureRpcQuorumError();
  }

  const verdicts = await Promise.all(
    rpcWitnesses.map((witness) => witness.verifyMessage({
      address: options.address,
      message: options.message,
      signature: options.signature,
    })),
  );
  return verdicts[0] === verdicts[1] && verdicts[0] === true;
}
