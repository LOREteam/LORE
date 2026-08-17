import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  assertV10RuntimeIdentity,
  createCanonicalV10ProvenanceChildEnv,
  normalizeV10ExecutableRuntime,
  parseV10RuntimeIdentityManifest,
  type V10RuntimeIdentityManifest,
} from "./v10-runtime-identity";

const ADDRESS = "0x1111111111111111111111111111111111111111";
const DEPLOY_BLOCK = 31_035_418n;
const BLOCK_HASH = `0x${"ab".repeat(32)}` as const;
const EXECUTABLE_BYTES = 64;
const normalizedRuntime = `${"0".repeat(64)}${"aa".repeat(32)}`;
const normalizedDigest = createHash("sha256").update(normalizedRuntime).digest("hex");

function runtime(immutableByte: string, suffix = "aa") {
  return `0x${immutableByte.repeat(32)}${suffix.repeat(32)}cc0001` as `0x${string}`;
}

function manifest(): V10RuntimeIdentityManifest {
  return {
    compilerVersion: "0.8.36+commit.8a079791.Emscripten.clang",
    executableRuntimeBytes: EXECUTABLE_BYTES,
    normalizedExecutableRuntimeSha256: normalizedDigest,
    runtimeBytecodeSha256: "b".repeat(64),
    runtimeBytecodeBytes: EXECUTABLE_BYTES + 3,
    runtimeImmutableReferences: [{ start: 0, length: 32 }],
    sourceSha256: "c".repeat(64),
  };
}

function reader(overrides: Partial<Parameters<typeof assertV10RuntimeIdentity>[0]["reader"]> = {}) {
  return {
    getChainId: async () => 59141,
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ hash: BLOCK_HASH, number: blockNumber }),
    getBytecode: async ({ blockNumber }: { blockNumber?: bigint }) => {
      if (blockNumber === DEPLOY_BLOCK - 1n) return "0x";
      return blockNumber === DEPLOY_BLOCK ? runtime("11") : runtime("22");
    },
    ...overrides,
  };
}

export async function runV10RuntimeIdentityTests() {
  const parsed = parseV10RuntimeIdentityManifest(JSON.stringify(manifest()));
  assert.equal(parsed.normalizedExecutableRuntimeSha256, normalizedDigest);
  assert.equal(normalizeV10ExecutableRuntime(runtime("99"), parsed), normalizedDigest);
  assert.throws(
    () => parseV10RuntimeIdentityManifest(JSON.stringify({ ...manifest(), runtimeImmutableReferences: [] })),
    /canonical V10 runtime provenance is incomplete/,
  );
  assert.throws(
    () => parseV10RuntimeIdentityManifest(JSON.stringify({ ...manifest(), runtimeImmutableReferences: [{ start: 33, length: 32 }] })),
    /immutable reference layout is invalid/,
  );

  const identity = await assertV10RuntimeIdentity({
    contractAddress: ADDRESS,
    deployBlock: DEPLOY_BLOCK,
    expectedChainId: 59141,
    manifest: parsed,
    reader: reader(),
    snapshotBlock: DEPLOY_BLOCK + 7n,
    snapshotBlockHash: BLOCK_HASH,
    verifyCanonicalProvenance: async () => {},
  });
  assert.deepEqual(identity, {
    canonicalProvenanceVerified: true,
    chainId: 59141,
    contractAddress: ADDRESS,
    deployBlock: DEPLOY_BLOCK.toString(),
    executableBytes: EXECUTABLE_BYTES,
    executableRuntimeBytes: EXECUTABLE_BYTES,
    immutableReferences: 1,
    manifestMatched: true,
    manifestDigest: createHash("sha256").update(JSON.stringify({
      compilerVersion: parsed.compilerVersion,
      executableRuntimeBytes: parsed.executableRuntimeBytes,
      normalizedExecutableRuntimeSha256: parsed.normalizedExecutableRuntimeSha256,
      runtimeBytecodeSha256: parsed.runtimeBytecodeSha256,
      runtimeBytecodeBytes: parsed.runtimeBytecodeBytes,
      runtimeImmutableReferences: parsed.runtimeImmutableReferences,
      sourceSha256: parsed.sourceSha256,
    })).digest("hex"),
    normalizedRuntimeSha256: normalizedDigest,
    observedBlock: (DEPLOY_BLOCK + 7n).toString(),
    observedBlockHash: BLOCK_HASH,
  });

  await assert.rejects(
    () => assertV10RuntimeIdentity({
      contractAddress: ADDRESS,
      deployBlock: DEPLOY_BLOCK,
      expectedChainId: 59141,
      manifest: parsed,
      reader: reader({ getChainId: async () => 1 }),
      snapshotBlock: DEPLOY_BLOCK,
      snapshotBlockHash: BLOCK_HASH,
      verifyCanonicalProvenance: async () => {},
    }),
    /RPC chain ID does not match configured chain ID/,
  );
  await assert.rejects(
    () => assertV10RuntimeIdentity({
      contractAddress: ADDRESS,
      deployBlock: DEPLOY_BLOCK,
      expectedChainId: 59141,
      manifest: parsed,
      reader: reader({ getBlock: async () => ({ hash: BLOCK_HASH, number: DEPLOY_BLOCK - 1n }) }),
      snapshotBlock: DEPLOY_BLOCK,
      snapshotBlockHash: BLOCK_HASH,
      verifyCanonicalProvenance: async () => {},
    }),
    /configured deploy block is unavailable or inconsistent/,
  );
  await assert.rejects(
    () => assertV10RuntimeIdentity({
      contractAddress: ADDRESS,
      deployBlock: DEPLOY_BLOCK,
      expectedChainId: 59141,
      manifest: parsed,
      reader: reader({ getBytecode: async () => undefined }),
      snapshotBlock: DEPLOY_BLOCK,
      snapshotBlockHash: BLOCK_HASH,
      verifyCanonicalProvenance: async () => {},
    }),
    /configured contract has no valid deployed bytecode/,
  );
  await assert.rejects(
    () => assertV10RuntimeIdentity({
      contractAddress: ADDRESS,
      deployBlock: DEPLOY_BLOCK,
      expectedChainId: 59141,
      manifest: parsed,
      reader: reader({ getBytecode: async ({ blockNumber }) => {
        if (blockNumber === DEPLOY_BLOCK - 1n) return "0x";
        return blockNumber === DEPLOY_BLOCK ? runtime("11") : runtime("22", "bb");
      } }),
      snapshotBlock: DEPLOY_BLOCK + 1n,
      snapshotBlockHash: BLOCK_HASH,
      verifyCanonicalProvenance: async () => {},
    }),
    /canonical provenance/,
  );
  await assert.rejects(
    () => assertV10RuntimeIdentity({
      contractAddress: ADDRESS,
      deployBlock: DEPLOY_BLOCK,
      expectedChainId: 59141,
      manifest: parsed,
      reader: reader({ getBytecode: async () => runtime("11") }),
      snapshotBlock: DEPLOY_BLOCK,
      snapshotBlockHash: BLOCK_HASH,
      verifyCanonicalProvenance: async () => {},
    }),
    /code predates configured deploy block/,
  );
  await assert.rejects(
    () => assertV10RuntimeIdentity({
      contractAddress: ADDRESS,
      deployBlock: 0n,
      expectedChainId: 59141,
      manifest: parsed,
      reader: reader(),
      snapshotBlock: DEPLOY_BLOCK,
      snapshotBlockHash: BLOCK_HASH,
      verifyCanonicalProvenance: async () => {},
    }),
    /deploy block must be greater than zero/,
  );
  await assert.rejects(
    () => assertV10RuntimeIdentity({
      contractAddress: ADDRESS,
      deployBlock: DEPLOY_BLOCK,
      expectedChainId: 59141,
      manifest: parsed,
      reader: reader(),
      snapshotBlock: DEPLOY_BLOCK - 1n,
      snapshotBlockHash: BLOCK_HASH,
      verifyCanonicalProvenance: async () => {},
    }),
    /observed block predates configured deploy block/,
  );
  await assert.rejects(
    () => assertV10RuntimeIdentity({
      contractAddress: ADDRESS,
      deployBlock: DEPLOY_BLOCK,
      expectedChainId: 59141,
      manifest: parsed,
      reader: reader({ getBlock: async ({ blockNumber }) => ({ hash: null, number: blockNumber }) }),
      snapshotBlock: DEPLOY_BLOCK,
      snapshotBlockHash: BLOCK_HASH,
      verifyCanonicalProvenance: async () => {},
    }),
    /observed block hash is unavailable/,
  );
  await assert.rejects(
    () => assertV10RuntimeIdentity({
      contractAddress: ADDRESS,
      deployBlock: DEPLOY_BLOCK,
      expectedChainId: 59141,
      manifest: parsed,
      reader: reader(),
      snapshotBlock: DEPLOY_BLOCK,
      snapshotBlockHash: `0x${"cd".repeat(32)}`,
      verifyCanonicalProvenance: async () => {},
    }),
    /does not match the supplied snapshot/,
  );

  const childEnv = createCanonicalV10ProvenanceChildEnv({
    ComSpec: "C:\\Windows\\System32\\cmd.exe",
    SystemRoot: "C:\\Windows",
    PATH: "unsafe-path",
    NODE_ENV: "test",
    LORE_LIVE_TEST_MANUAL_PRIVATE_KEY: "unsafe-private-key",
    WALLET_MNEMONIC: "unsafe-mnemonic",
    LIVE_TEST_RPC_URL: "unsafe-rpc-url",
    NEXT_PUBLIC_LINEA_TOKEN_ADDRESS: "unsafe-token",
    HEALTH_DIAGNOSTICS_SECRET: "unsafe-secret",
    SESSION_TOKEN: "unsafe-session",
  });
  assert.equal(childEnv.ComSpec, "C:\\Windows\\System32\\cmd.exe");
  assert.equal(childEnv.SystemRoot, "C:\\Windows");
  assert.equal(childEnv.NODE_ENV, "test");
  assert.equal(childEnv.LORE_LIVE_TEST_MANUAL_PRIVATE_KEY, undefined);
  assert.equal(childEnv.WALLET_MNEMONIC, undefined);
  assert.equal(childEnv.LIVE_TEST_RPC_URL, undefined);
  assert.equal(childEnv.NEXT_PUBLIC_LINEA_TOKEN_ADDRESS, undefined);
  assert.equal(childEnv.HEALTH_DIAGNOSTICS_SECRET, undefined);
  assert.equal(childEnv.SESSION_TOKEN, undefined);
  assert.equal(childEnv.PATH, undefined);

  const manifestDirectory = mkdtempSync(path.join(tmpdir(), "lore-v10-runtime-identity-"));
  const manifestPath = path.join(manifestDirectory, "LineaOreV10.compilation.json");
  const manifestA = JSON.stringify(manifest());
  const manifestB = `${manifestA}\n`;
  try {
    writeFileSync(manifestPath, manifestA);
    await assert.rejects(
      () => assertV10RuntimeIdentity({
        contractAddress: ADDRESS,
        deployBlock: DEPLOY_BLOCK,
        expectedChainId: 59141,
        manifestPath,
        reader: reader(),
        snapshotBlock: DEPLOY_BLOCK + 7n,
        snapshotBlockHash: BLOCK_HASH,
        verifyCanonicalProvenance: async (snapshot) => {
          assert.equal(snapshot.manifestDigest, createHash("sha256").update(manifestA).digest("hex"));
          writeFileSync(manifestPath, manifestB);
        },
      }),
      /manifest changed during provenance verification/,
    );
  } finally {
    rmSync(manifestDirectory, { force: true, recursive: true });
  }

  const liveCanarySource = readFileSync(path.join(process.cwd(), "scripts", "live-round-canary.ts"), "utf8");
  const identityStart = liveCanarySource.indexOf("const runtimeIdentity = await assertV10RuntimeIdentity");
  const identityEvidence = liveCanarySource.indexOf("runtimeIdentity,", identityStart);
  const walletLoad = liveCanarySource.indexOf("const wallets = DRY_RUN ? loadDryRunWallets() : loadWallets();");
  const tokenRead = liveCanarySource.indexOf("const contractToken = await publicClient.readContract");
  const walletPreflight = liveCanarySource.indexOf("await runPreflight(logPath, publicClient, wallets, plannedSpendByRole);");
  assert.ok(identityStart >= 0 && identityEvidence > identityStart, "live canary must log runtime identity evidence");
  assert.ok(walletLoad > identityEvidence, "live canary must record runtime identity before loading wallet material");
  assert.ok(tokenRead > identityEvidence, "live canary must record runtime identity before token work");
  assert.ok(walletPreflight > identityEvidence, "live canary must record runtime identity before wallet preflight");
}

if (process.argv[1]?.endsWith("test-v10-runtime-identity.ts")) {
  runV10RuntimeIdentityTests()
    .then(() => console.log("V10 runtime identity behavior tests passed"))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
