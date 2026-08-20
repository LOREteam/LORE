import { createHash } from "node:crypto";
import { closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import dotenv from "dotenv";
import { getAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const LIVE_TEST_WALLET_ROLES = Object.freeze([
  "MANUAL",
  "AUTOMINER_A",
  "AUTOMINER_B",
  "AUTOMINER_C",
  "RESOLVER",
]);

const MAX_ENV_FILE_BYTES = 8 * 1024;
const PRIVATE_KEY_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS_PATTERN = /^0x[0-9a-fA-F]{40}$/;

export class LiveTestWalletConfigError extends Error {
  constructor(role, reason) {
    super(`${role}: ${reason}`);
    this.role = role;
    this.reason = reason;
  }
}

function fail(role, reason) {
  throw new LiveTestWalletConfigError(role, reason);
}

function roleKey(role, suffix) {
  return `LORE_LIVE_TEST_${role}_${suffix}`;
}

function sameFileFingerprint(left, right) {
  return left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs;
}

function samePath(left, right) {
  return process.platform === "win32"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

function resolveCanonicalConfigRoot(cwd) {
  const requestedRoot = resolve(cwd);
  let stat;
  let physicalRoot;
  try {
    stat = lstatSync(requestedRoot);
    physicalRoot = realpathSync(requestedRoot);
  } catch {
    fail("SYSTEM", "config-root-unreadable");
  }
  if (stat.isSymbolicLink() || !stat.isDirectory() || !samePath(requestedRoot, physicalRoot)) {
    fail("SYSTEM", "config-root-not-canonical");
  }
  return { path: requestedRoot, stat };
}

function assertConfigRootUnchanged(root) {
  let currentStat;
  let physicalRoot;
  try {
    currentStat = lstatSync(root.path);
    physicalRoot = realpathSync(root.path);
  } catch {
    fail("SYSTEM", "config-root-changed");
  }
  if (
    currentStat.isSymbolicLink() ||
    !currentStat.isDirectory() ||
    currentStat.dev !== root.stat.dev ||
    currentStat.ino !== root.stat.ino ||
    currentStat.birthtimeMs !== root.stat.birthtimeMs ||
    !samePath(root.path, physicalRoot)
  ) {
    fail("SYSTEM", "config-root-changed");
  }
}

function readIsolatedEnvFile(cwd, filename, label) {
  const root = resolveCanonicalConfigRoot(cwd);
  const filePath = resolve(root.path, filename);
  let stat;
  try {
    stat = lstatSync(filePath);
  } catch {
    fail("SYSTEM", `${label}-file-missing`);
  }
  if (stat.isSymbolicLink() || !stat.isFile()) fail("SYSTEM", `${label}-file-not-ordinary`);
  let physicalFilePath;
  try {
    physicalFilePath = realpathSync(filePath);
  } catch {
    fail("SYSTEM", `${label}-file-unreadable`);
  }
  if (!samePath(filePath, physicalFilePath)) fail("SYSTEM", `${label}-file-not-ordinary`);
  if (stat.size <= 0) fail("SYSTEM", `${label}-file-empty`);
  if (stat.size > MAX_ENV_FILE_BYTES) fail("SYSTEM", `${label}-file-too-large`);

  let contents;
  let fd;
  try {
    fd = openSync(filePath, "r");
    const openedStat = fstatSync(fd);
    if (!openedStat.isFile() || !sameFileFingerprint(stat, openedStat)) {
      fail("SYSTEM", `${label}-file-changed`);
    }
    const buffer = Buffer.alloc(MAX_ENV_FILE_BYTES + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const bytesRead = readSync(fd, buffer, bytes, buffer.length - bytes, null);
      if (bytesRead === 0) break;
      bytes += bytesRead;
    }
    if (bytes > MAX_ENV_FILE_BYTES) fail("SYSTEM", `${label}-file-too-large`);
    const finalOpenedStat = fstatSync(fd);
    const finalPathStat = lstatSync(filePath);
    if (
      finalPathStat.isSymbolicLink() ||
      !finalPathStat.isFile() ||
      !sameFileFingerprint(openedStat, finalOpenedStat) ||
      !sameFileFingerprint(openedStat, finalPathStat)
    ) {
      fail("SYSTEM", `${label}-file-changed`);
    }
    contents = buffer.subarray(0, bytes).toString("utf8");
  } catch (error) {
    if (error instanceof LiveTestWalletConfigError) throw error;
    fail("SYSTEM", `${label}-file-unreadable`);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
  if (Buffer.byteLength(contents, "utf8") > MAX_ENV_FILE_BYTES) {
    fail("SYSTEM", `${label}-file-too-large`);
  }
  assertConfigRootUnchanged(root);

  try {
    return {
      assignmentNames: [...contents.matchAll(/^(?:\uFEFF)?\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/gm)]
        .map((match) => match[1]),
      values: dotenv.parse(contents),
    };
  } catch {
    fail("SYSTEM", `${label}-file-invalid`);
  }
}

function requireExactKeys(envFile, expectedKeys, label) {
  const actualKeys = Object.keys(envFile.values).sort();
  const assignmentNames = [...envFile.assignmentNames].sort();
  const requiredKeys = [...expectedKeys].sort();
  if (
    actualKeys.length !== requiredKeys.length ||
    actualKeys.some((key, index) => key !== requiredKeys[index]) ||
    assignmentNames.length !== requiredKeys.length ||
    assignmentNames.some((key, index) => key !== requiredKeys[index])
  ) {
    fail("SYSTEM", `${label}-keys-invalid`);
  }
}

function normalizeConfiguredAddress(role, value) {
  if (typeof value !== "string" || !ADDRESS_PATTERN.test(value)) {
    fail(role, "address-malformed");
  }
  try {
    const normalized = getAddress(value);
    if (value !== normalized) fail(role, "address-not-checksummed");
    return normalized;
  } catch (error) {
    if (error instanceof LiveTestWalletConfigError) throw error;
    fail(role, "address-malformed");
  }
}

function normalizePrivateKey(role, value) {
  if (typeof value !== "string" || !PRIVATE_KEY_PATTERN.test(value)) {
    fail(role, "private-key-malformed");
  }
  try {
    return {
      normalized: value.toLowerCase(),
      account: privateKeyToAccount(value),
    };
  } catch {
    fail(role, "private-key-malformed");
  }
}

function inheritedValue(environment, name) {
  const value = environment?.[name];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function computeWalletSetSha256(addressesByRole) {
  const canonical = LIVE_TEST_WALLET_ROLES
    .map((role) => `${role}=${addressesByRole.get(role)}`)
    .join("\n");
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function loadLiveTestPublicWalletConfig({
  cwd = process.cwd(),
  environment = process.env,
} = {}) {
  const addressNames = LIVE_TEST_WALLET_ROLES.map((role) => roleKey(role, "ADDRESS"));
  const addressFile = readIsolatedEnvFile(cwd, ".env.live-test-addresses", "address");
  requireExactKeys(addressFile, addressNames, "address");

  const addressesByRole = new Map();
  for (const role of LIVE_TEST_WALLET_ROLES) {
    const name = roleKey(role, "ADDRESS");
    const configuredAddress = normalizeConfiguredAddress(role, addressFile.values[name]);
    const inherited = inheritedValue(environment, name);
    if (inherited !== null) {
      let inheritedAddress;
      try {
        inheritedAddress = getAddress(inherited);
      } catch {
        fail(role, "inherited-address-malformed");
      }
      if (inheritedAddress !== configuredAddress) fail(role, "inherited-address-conflict");
    }
    addressesByRole.set(role, configuredAddress);
  }

  if (new Set([...addressesByRole.values()].map((address) => address.toLowerCase())).size !== LIVE_TEST_WALLET_ROLES.length) {
    fail("SYSTEM", "duplicate-address");
  }

  return {
    roles: [...LIVE_TEST_WALLET_ROLES],
    addressesByRole,
    walletSetSha256: computeWalletSetSha256(addressesByRole),
  };
}

export function loadLiveTestExecutionWalletConfig({
  cwd = process.cwd(),
  environment = process.env,
  expectedWalletSetSha256,
  publicConfig,
} = {}) {
  const verifiedPublicConfig = loadLiveTestPublicWalletConfig({ cwd, environment });
  if (
    expectedWalletSetSha256 !== undefined &&
    (typeof expectedWalletSetSha256 !== "string" || !/^[a-f0-9]{64}$/.test(expectedWalletSetSha256))
  ) {
    fail("SYSTEM", "expected-wallet-set-invalid");
  }
  if (
    publicConfig !== undefined &&
    publicConfig?.walletSetSha256 !== verifiedPublicConfig.walletSetSha256
  ) {
    fail("SYSTEM", "public-wallet-set-changed");
  }
  if (
    typeof expectedWalletSetSha256 === "string" &&
    expectedWalletSetSha256 !== verifiedPublicConfig.walletSetSha256
  ) {
    fail("SYSTEM", "public-wallet-set-changed");
  }

  const signingKeys = LIVE_TEST_WALLET_ROLES.flatMap((role) => [
    roleKey(role, "ADDRESS"),
    roleKey(role, "PRIVATE_KEY"),
  ]);
  const signingFile = readIsolatedEnvFile(cwd, ".env.live-test-wallets", "wallet");
  requireExactKeys(signingFile, signingKeys, "wallet");

  const accountsByRole = new Map();
  for (const role of LIVE_TEST_WALLET_ROLES) {
    const addressName = roleKey(role, "ADDRESS");
    const privateKeyName = roleKey(role, "PRIVATE_KEY");
    const publicAddress = verifiedPublicConfig.addressesByRole.get(role);
    const signingAddress = normalizeConfiguredAddress(role, signingFile.values[addressName]);
    const { normalized: filePrivateKey, account } = normalizePrivateKey(role, signingFile.values[privateKeyName]);
    if (signingAddress !== publicAddress) fail(role, "signing-address-mismatch");
    if (account.address !== publicAddress) fail(role, "private-key-address-mismatch");

    const inheritedAddress = inheritedValue(environment, addressName);
    if (inheritedAddress !== null) {
      let normalizedInheritedAddress;
      try {
        normalizedInheritedAddress = getAddress(inheritedAddress);
      } catch {
        fail(role, "inherited-address-malformed");
      }
      if (normalizedInheritedAddress !== publicAddress) fail(role, "inherited-address-conflict");
    }
    const inheritedPrivateKey = inheritedValue(environment, privateKeyName);
    if (inheritedPrivateKey !== null) {
      const { normalized } = normalizePrivateKey(role, inheritedPrivateKey);
      if (normalized !== filePrivateKey) fail(role, "inherited-private-key-conflict");
    }
    accountsByRole.set(role, account);
  }

  return {
    ...verifiedPublicConfig,
    accountsByRole,
  };
}

export function describeLiveTestWalletConfigError(error) {
  if (error instanceof LiveTestWalletConfigError) return `${error.role}: ${error.reason}`;
  return "SYSTEM: validation-failed";
}
