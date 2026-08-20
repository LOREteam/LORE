import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { privateKeyToAccount } from "viem/accounts";
import {
  loadLiveTestExecutionWalletConfig,
  loadLiveTestPublicWalletConfig,
} from "./live-test-wallet-config.mjs";

const SCRIPT_PATH = fileURLToPath(new URL("./check-live-test-wallet-config.mjs", import.meta.url));
const ROLES = ["MANUAL", "AUTOMINER_A", "AUTOMINER_B", "AUTOMINER_C", "RESOLVER"];
const KEYS = ROLES.map((_, index) => `0x${(index + 1).toString(16).padStart(64, "0")}`);
const ADDRESSES = KEYS.map((key) => privateKeyToAccount(key).address);
const CHANGED_ADDRESS = privateKeyToAccount(`0x${"6".padStart(64, "0")}`).address;
const SENTINEL = "live-test-wallet-secret-sentinel";

function walletContents(keys = KEYS, addresses = ADDRESSES, extra = "") {
  return `${ROLES.flatMap((role, index) => [
    `LORE_LIVE_TEST_${role}_ADDRESS=${addresses[index]}`,
    `LORE_LIVE_TEST_${role}_PRIVATE_KEY=${keys[index]}`,
  ]).join("\n")}\n${extra}`;
}

function addressContents(addresses = ADDRESSES, extra = "") {
  return `${ROLES.map((role, index) => `LORE_LIVE_TEST_${role}_ADDRESS=${addresses[index]}`).join("\n")}\n${extra}`;
}

function createFixture({ wallets = walletContents(), addresses = addressContents() } = {}) {
  const cwd = mkdtempSync(join(tmpdir(), "lore-live-wallet-config-"));
  writeFileSync(join(cwd, ".env.live-test-wallets"), wallets, "utf8");
  writeFileSync(join(cwd, ".env.live-test-addresses"), addresses, "utf8");
  return cwd;
}

function runFixture(cwd, extraEnvironment = {}) {
  return spawnSync(process.execPath, [SCRIPT_PATH], {
    cwd,
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", ...extraEnvironment },
    timeout: 10_000,
  });
}

function assertNoLeak(result) {
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, new RegExp(SENTINEL));
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /0x[0-9a-fA-F]{40}|0x[0-9a-fA-F]{64}/);
}

function withFixture(options, assertion) {
  const cwd = createFixture(options);
  try {
    const result = runFixture(cwd);
    assertion(result, cwd);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

withFixture({}, (result) => {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  const parsed = JSON.parse(result.stdout);
  assert.match(parsed.walletSetSha256, /^[0-9a-f]{64}$/);
  assert.deepEqual({ ...parsed, walletSetSha256: "<digest>" }, {
    status: "pass",
    roles: ROLES,
    addressMatches: true,
    unique: true,
    walletSetSha256: "<digest>",
    signingMaterialLoaded: true,
    signatureRequested: false,
    networkRequests: 0,
  });
});

withFixture({ addresses: addressContents([ADDRESSES[1], ...ADDRESSES.slice(1)]) }, (result) => {
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /^SYSTEM: duplicate-address\s*$/);
  assert.equal(result.stdout, "");
  assertNoLeak(result);
});

withFixture({ wallets: walletContents([SENTINEL, ...KEYS.slice(1)]) }, (result) => {
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /^MANUAL: private-key-malformed\s*$/);
  assert.equal(result.stdout, "");
  assertNoLeak(result);
});

withFixture({
  wallets: walletContents([KEYS[0], KEYS[0], ...KEYS.slice(2)], [ADDRESSES[0], ADDRESSES[0], ...ADDRESSES.slice(2)]),
  addresses: addressContents([ADDRESSES[0], ADDRESSES[0], ...ADDRESSES.slice(2)]),
}, (result) => {
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /^SYSTEM: duplicate-address\s*$/);
  assert.equal(result.stdout, "");
  assertNoLeak(result);
});

withFixture({ wallets: walletContents(KEYS, ADDRESSES, `UNEXPECTED_KEY=${SENTINEL}\n`) }, (result) => {
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /^SYSTEM: wallet-keys-invalid\s*$/);
  assert.equal(result.stdout, "");
  assertNoLeak(result);
});

withFixture({ wallets: walletContents(KEYS, [ADDRESSES[1], ...ADDRESSES.slice(1)]) }, (result) => {
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /^MANUAL: signing-address-mismatch\s*$/);
  assert.equal(result.stdout, "");
  assertNoLeak(result);
});

withFixture({}, (result, cwd) => {
  const conflict = runFixture(cwd, { LORE_LIVE_TEST_MANUAL_ADDRESS: CHANGED_ADDRESS });
  assert.notEqual(conflict.status, 0);
  assert.match(conflict.stderr, /^MANUAL: inherited-address-conflict\s*$/);
  assertNoLeak(conflict);
  assert.equal(result.status, 0);
});

withFixture({}, (result, cwd) => {
  const conflict = runFixture(cwd, { LORE_LIVE_TEST_MANUAL_PRIVATE_KEY: KEYS[1] });
  assert.notEqual(conflict.status, 0);
  assert.match(conflict.stderr, /^MANUAL: inherited-private-key-conflict\s*$/);
  assertNoLeak(conflict);
  assert.equal(result.status, 0);
});

const changedAfterPreviewFixture = createFixture();
try {
  const publicConfig = loadLiveTestPublicWalletConfig({
    cwd: changedAfterPreviewFixture,
    environment: {},
  });
  writeFileSync(
    join(changedAfterPreviewFixture, ".env.live-test-addresses"),
    addressContents([CHANGED_ADDRESS, ...ADDRESSES.slice(1)]),
    "utf8",
  );
  assert.throws(
    () => loadLiveTestExecutionWalletConfig({
      cwd: changedAfterPreviewFixture,
      environment: {},
      expectedWalletSetSha256: publicConfig.walletSetSha256,
      publicConfig,
    }),
    /public-wallet-set-changed/,
  );
} finally {
  rmSync(changedAfterPreviewFixture, { recursive: true, force: true });
}

withFixture({ wallets: `${SENTINEL.repeat(600)}\n` }, (result) => {
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /^SYSTEM: wallet-file-too-large\s*$/);
  assert.equal(result.stdout, "");
  assertNoLeak(result);
});

const symlinkFixture = createFixture();
try {
  const walletPath = join(symlinkFixture, ".env.live-test-wallets");
  const targetPath = join(symlinkFixture, "wallet-target");
  writeFileSync(targetPath, walletContents(), "utf8");
  rmSync(walletPath);
  let symlinkCreated = false;
  try {
    symlinkSync(targetPath, walletPath, "file");
    symlinkCreated = true;
  } catch (error) {
    if (!new Set(["EPERM", "EACCES", "UNKNOWN"]).has(error?.code)) throw error;
  }
  if (symlinkCreated) {
    const result = runFixture(symlinkFixture);
    assert.match(result.stderr, /^SYSTEM: wallet-file-not-ordinary\s*$/);
    assert.equal(result.stdout, "");
    assertNoLeak(result);
  }
} finally {
  rmSync(symlinkFixture, { recursive: true, force: true });
}

const publicSymlinkFixture = createFixture();
try {
  const addressPath = join(publicSymlinkFixture, ".env.live-test-addresses");
  const targetPath = join(publicSymlinkFixture, "address-target");
  writeFileSync(targetPath, addressContents(), "utf8");
  rmSync(addressPath);
  let symlinkCreated = false;
  try {
    symlinkSync(targetPath, addressPath, "file");
    symlinkCreated = true;
  } catch (error) {
    if (!new Set(["EPERM", "EACCES", "UNKNOWN"]).has(error?.code)) throw error;
  }
  if (symlinkCreated) {
    const result = runFixture(publicSymlinkFixture);
    assert.match(result.stderr, /^SYSTEM: address-file-not-ordinary\s*$/);
    assert.equal(result.stdout, "");
    assertNoLeak(result);
  }
} finally {
  rmSync(publicSymlinkFixture, { recursive: true, force: true });
}

const reparseTargetFixture = createFixture();
const reparseParent = mkdtempSync(join(tmpdir(), "lore-live-wallet-config-link-"));
const reparseRoot = join(reparseParent, "config-root");
let reparseCreated = false;
try {
  try {
    symlinkSync(reparseTargetFixture, reparseRoot, "junction");
    reparseCreated = true;
  } catch (error) {
    if (!new Set(["EPERM", "EACCES", "UNKNOWN"]).has(error?.code)) throw error;
  }
  if (reparseCreated) {
    assert.throws(
      () => loadLiveTestPublicWalletConfig({ cwd: reparseRoot, environment: {} }),
      /config-root-not-canonical/,
    );
  }
} finally {
  if (reparseCreated) unlinkSync(reparseRoot);
  rmSync(reparseTargetFixture, { recursive: true, force: true });
  rmSync(reparseParent, { recursive: true, force: true });
}

console.log(JSON.stringify({ status: "pass", cases: 13 }));
