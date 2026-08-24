import {
  closeSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import path from "node:path";

const RUN_ID_RE = /^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12})$/;
const SHA256_RE = /^[a-f0-9]{64}$/;
const MAX_TOMBSTONE_BYTES = 2 * 1024;
const ACTIVE_LEASE_NAME = "active-v10-canary.json";
const ACTIVE_LEASES = new WeakMap();

export const V10_PREVIEW_CONSENT_LEDGER_RELATIVE_PATH = path.join(
  "data",
  "live-test-consent-uses",
);
export const V10_CANARY_EXECUTION_LEASE_RELATIVE_PATH = path.join(
  V10_PREVIEW_CONSENT_LEDGER_RELATIVE_PATH,
  ACTIVE_LEASE_NAME,
);

const DEFAULT_FS_API = Object.freeze({
  closeSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  unlinkSync,
  writeSync,
});

function samePath(left, right) {
  const resolvedLeft = path.resolve(left);
  const resolvedRight = path.resolve(right);
  return process.platform === "win32"
    ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
    : resolvedLeft === resolvedRight;
}

function storeError(code, message, cause) {
  const error = new Error(message, cause === undefined ? undefined : { cause });
  error.code = code;
  return error;
}

function alreadyConsumedError() {
  return storeError(
    "V10_PREVIEW_CONSENT_ALREADY_CONSUMED",
    "V10 Preview consent is already consumed or reserved",
  );
}

function leaseHeldError() {
  return storeError(
    "V10_CANARY_EXECUTION_LEASE_HELD",
    "Another repository-local V10 canary execution lease is already active or reserved",
  );
}

function lstatIfPresent(filePath, fsApi) {
  try {
    return fsApi.lstatSync(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function assertCanonicalDirectory(directoryPath, label, fsApi) {
  const stats = fsApi.lstatSync(directoryPath);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw storeError(
      "V10_PREVIEW_CONSENT_PATH_UNSAFE",
      `${label} must be an ordinary directory`,
    );
  }
  const canonicalPath = fsApi.realpathSync(directoryPath);
  if (!samePath(canonicalPath, directoryPath)) {
    throw storeError(
      "V10_PREVIEW_CONSENT_PATH_UNSAFE",
      `${label} must not resolve through a reparse point`,
    );
  }
  return canonicalPath;
}

function ensureCanonicalChildDirectory(parentPath, childName, label, fsApi) {
  const directoryPath = path.resolve(parentPath, childName);
  if (!samePath(path.dirname(directoryPath), parentPath)) {
    throw storeError(
      "V10_PREVIEW_CONSENT_PATH_UNSAFE",
      `${label} escaped its parent directory`,
    );
  }
  if (lstatIfPresent(directoryPath, fsApi) === null) {
    try {
      fsApi.mkdirSync(directoryPath);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
  }
  assertCanonicalDirectory(parentPath, `${label} parent`, fsApi);
  assertCanonicalDirectory(directoryPath, label, fsApi);
  return directoryPath;
}

function resolveConsentLedger(root, fsApi) {
  const repositoryRoot = path.resolve(root);
  assertCanonicalDirectory(repositoryRoot, "V10 Preview consent repository root", fsApi);
  const dataDirectory = ensureCanonicalChildDirectory(
    repositoryRoot,
    "data",
    "V10 Preview consent data directory",
    fsApi,
  );
  const ledgerDirectory = ensureCanonicalChildDirectory(
    dataDirectory,
    "live-test-consent-uses",
    "V10 Preview consent ledger directory",
    fsApi,
  );
  return { repositoryRoot, dataDirectory, ledgerDirectory };
}

function validateBinding(binding) {
  if (!binding || typeof binding !== "object" || Array.isArray(binding)) {
    throw storeError(
      "V10_PREVIEW_CONSENT_INVALID_BINDING",
      "V10 Preview consent binding must be an object",
    );
  }
  const runId = typeof binding.runId === "string" ? binding.runId.trim() : "";
  if (!RUN_ID_RE.test(runId)) {
    throw storeError(
      "V10_PREVIEW_CONSENT_INVALID_BINDING",
      "V10 Preview consent runId is invalid",
    );
  }
  const hashes = {};
  for (const name of [
    "previewSha256",
    "walletSetSha256",
    "canaryPlanSha256",
    "consentPlanSha256",
  ]) {
    const value = typeof binding[name] === "string" ? binding[name].trim().toLowerCase() : "";
    if (!SHA256_RE.test(value)) {
      throw storeError(
        "V10_PREVIEW_CONSENT_INVALID_BINDING",
        `V10 Preview consent ${name} is invalid`,
      );
    }
    hashes[name] = value;
  }
  return { runId, ...hashes };
}

function stableFileIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function writeAll(handle, payload, fsApi) {
  let offset = 0;
  while (offset < payload.length) {
    const written = fsApi.writeSync(handle, payload, offset, payload.length - offset);
    if (!Number.isInteger(written) || written <= 0) {
      throw new Error("V10 Preview consent tombstone write made no progress");
    }
    offset += written;
  }
}

function fsyncDirectoryEntry(directoryPath, fsApi) {
  if (process.platform === "win32") return;
  let handle = null;
  try {
    handle = fsApi.openSync(directoryPath, "r");
    fsApi.fsyncSync(handle);
  } finally {
    if (handle !== null) fsApi.closeSync(handle);
  }
}

function assertStableOrdinaryFile({
  filePath,
  expectedIdentity,
  expectedPayload,
  canonicalDirectory,
  label,
  fsApi,
}) {
  const pathStats = fsApi.lstatSync(filePath);
  if (
    !pathStats.isFile()
    || pathStats.isSymbolicLink()
    || pathStats.nlink !== 1
    || !stableFileIdentity(expectedIdentity, pathStats)
    || !samePath(path.dirname(fsApi.realpathSync(filePath)), canonicalDirectory)
  ) {
    throw new Error(`${label} changed during its protected lifecycle`);
  }
  if (expectedPayload !== undefined) {
    const payload = fsApi.readFileSync(filePath);
    if (!Buffer.isBuffer(payload) || payload.length > MAX_TOMBSTONE_BYTES || !payload.equals(expectedPayload)) {
      throw new Error(`${label} contents changed during its protected lifecycle`);
    }
    const afterReadStats = fsApi.lstatSync(filePath);
    if (!stableFileIdentity(pathStats, afterReadStats)) {
      throw new Error(`${label} changed while its contents were verified`);
    }
  }
  return pathStats;
}

/**
 * Acquires the single repository-local V10 canary execution lease.
 *
 * This lease deliberately has no stale timeout or automatic recovery. A crash
 * or persistence uncertainty leaves the active marker in place and requires
 * explicit operator inspection. The scope is one canonical repository root;
 * it is not a cross-worktree or cross-host coordination primitive.
 */
export function acquireV10CanaryExecutionLease({
  root = process.cwd(),
  binding,
  now = new Date(),
  fsApi = DEFAULT_FS_API,
} = {}) {
  const normalizedBinding = validateBinding(binding);
  const acquiredAt = new Date(now).toISOString();
  const { repositoryRoot, dataDirectory, ledgerDirectory } = resolveConsentLedger(root, fsApi);
  const leasePath = path.resolve(ledgerDirectory, ACTIVE_LEASE_NAME);
  if (!samePath(path.dirname(leasePath), ledgerDirectory)) {
    throw storeError(
      "V10_PREVIEW_CONSENT_PATH_UNSAFE",
      "V10 canary execution lease escaped its ledger directory",
    );
  }
  if (lstatIfPresent(leasePath, fsApi) !== null) throw leaseHeldError();

  const payload = Buffer.from(`${JSON.stringify({
    schema: 1,
    kind: "active-v10-canary",
    ...normalizedBinding,
    acquiredAt,
  })}\n`, "utf8");
  if (payload.length > MAX_TOMBSTONE_BYTES) {
    throw storeError(
      "V10_PREVIEW_CONSENT_INVALID_BINDING",
      "V10 canary execution lease exceeds its safe byte bound",
    );
  }

  let handle = null;
  let created = false;
  try {
    try {
      handle = fsApi.openSync(leasePath, "wx", 0o600);
      created = true;
    } catch (error) {
      if (error?.code === "EEXIST") throw leaseHeldError();
      throw error;
    }
    writeAll(handle, payload, fsApi);
    fsApi.fsyncSync(handle);
    const handleStats = fsApi.fstatSync(handle);
    if (!handleStats.isFile() || handleStats.nlink !== 1 || handleStats.size !== payload.length) {
      throw new Error("V10 canary execution lease handle is not a complete ordinary file");
    }
    fsApi.closeSync(handle);
    handle = null;

    assertCanonicalDirectory(repositoryRoot, "V10 Preview consent repository root", fsApi);
    assertCanonicalDirectory(dataDirectory, "V10 Preview consent data directory", fsApi);
    const canonicalLedgerDirectory = assertCanonicalDirectory(
      ledgerDirectory,
      "V10 Preview consent ledger directory",
      fsApi,
    );
    const leaseIdentity = assertStableOrdinaryFile({
      filePath: leasePath,
      expectedIdentity: handleStats,
      expectedPayload: payload,
      canonicalDirectory: canonicalLedgerDirectory,
      label: "V10 canary execution lease",
      fsApi,
    });
    fsyncDirectoryEntry(ledgerDirectory, fsApi);

    const lease = Object.freeze({
      status: "acquired",
      runId: normalizedBinding.runId,
      markerPath: path.relative(repositoryRoot, leasePath),
    });
    ACTIVE_LEASES.set(lease, {
      repositoryRoot,
      dataDirectory,
      ledgerDirectory,
      leasePath,
      leaseIdentity,
      payload,
      fsApi,
    });
    return lease;
  } catch (error) {
    if (handle !== null) {
      try {
        fsApi.closeSync(handle);
      } catch {
        // The exclusive lease remains reserved even if closing fails.
      }
    }
    if (!created && error?.code === "V10_CANARY_EXECUTION_LEASE_HELD") throw error;
    if (!created) throw error;
    throw storeError(
      "V10_CANARY_EXECUTION_LEASE_PERSISTENCE_FAILED",
      "V10 canary execution lease could not be durably recorded; the repository-local lease remains reserved",
      error,
    );
  }
}

export function releaseV10CanaryExecutionLease(lease) {
  const state = lease && typeof lease === "object" ? ACTIVE_LEASES.get(lease) : undefined;
  if (!state) {
    throw storeError(
      "V10_CANARY_EXECUTION_LEASE_NOT_OWNER",
      "V10 canary execution lease can only be released by its acquiring owner",
    );
  }
  const {
    repositoryRoot,
    dataDirectory,
    ledgerDirectory,
    leasePath,
    leaseIdentity,
    payload,
    fsApi,
  } = state;
  try {
    assertCanonicalDirectory(repositoryRoot, "V10 Preview consent repository root", fsApi);
    assertCanonicalDirectory(dataDirectory, "V10 Preview consent data directory", fsApi);
    const canonicalLedgerDirectory = assertCanonicalDirectory(
      ledgerDirectory,
      "V10 Preview consent ledger directory",
      fsApi,
    );
    assertStableOrdinaryFile({
      filePath: leasePath,
      expectedIdentity: leaseIdentity,
      expectedPayload: payload,
      canonicalDirectory: canonicalLedgerDirectory,
      label: "V10 canary execution lease",
      fsApi,
    });
    fsApi.unlinkSync(leasePath);
    ACTIVE_LEASES.delete(lease);
    fsyncDirectoryEntry(ledgerDirectory, fsApi);
  } catch (error) {
    throw storeError(
      "V10_CANARY_EXECUTION_LEASE_RELEASE_FAILED",
      "V10 canary execution lease could not be safely released",
      error,
    );
  }
  return Object.freeze({
    status: "released",
    runId: lease.runId,
    markerPath: lease.markerPath,
  });
}

/**
 * Permanently consumes one public V10 Preview authorization identity.
 *
 * The exclusive file is a tombstone, not a recoverable lock. Once its creation
 * succeeds it is deliberately never removed, including after a later write,
 * fsync, or verification failure. That makes a crash consume the attempt and
 * forces a new Preview and fresh authorization before any retry.
 */
export function consumeV10PreviewConsent({
  root = process.cwd(),
  binding,
  now = new Date(),
  fsApi = DEFAULT_FS_API,
} = {}) {
  const normalizedBinding = validateBinding(binding);
  const consumedAt = new Date(now).toISOString();
  const { repositoryRoot, dataDirectory, ledgerDirectory } = resolveConsentLedger(root, fsApi);
  const tombstoneName = `${normalizedBinding.runId}.json`;
  if (path.basename(tombstoneName) !== tombstoneName) {
    throw storeError(
      "V10_PREVIEW_CONSENT_PATH_UNSAFE",
      "V10 Preview consent tombstone name is unsafe",
    );
  }
  const tombstonePath = path.resolve(ledgerDirectory, tombstoneName);
  if (!samePath(path.dirname(tombstonePath), ledgerDirectory)) {
    throw storeError(
      "V10_PREVIEW_CONSENT_PATH_UNSAFE",
      "V10 Preview consent tombstone escaped its ledger directory",
    );
  }
  if (lstatIfPresent(tombstonePath, fsApi) !== null) throw alreadyConsumedError();

  const tombstone = {
    schema: 1,
    runId: normalizedBinding.runId,
    previewSha256: normalizedBinding.previewSha256,
    walletSetSha256: normalizedBinding.walletSetSha256,
    canaryPlanSha256: normalizedBinding.canaryPlanSha256,
    consentPlanSha256: normalizedBinding.consentPlanSha256,
    consumedAt,
  };
  const payload = Buffer.from(`${JSON.stringify(tombstone)}\n`, "utf8");
  if (payload.length > MAX_TOMBSTONE_BYTES) {
    throw storeError(
      "V10_PREVIEW_CONSENT_INVALID_BINDING",
      "V10 Preview consent tombstone exceeds its safe byte bound",
    );
  }

  let handle = null;
  let created = false;
  try {
    try {
      handle = fsApi.openSync(tombstonePath, "wx", 0o600);
      created = true;
    } catch (error) {
      if (error?.code === "EEXIST") throw alreadyConsumedError();
      throw error;
    }
    writeAll(handle, payload, fsApi);
    fsApi.fsyncSync(handle);
    const handleStats = fsApi.fstatSync(handle);
    if (!handleStats.isFile() || handleStats.nlink !== 1 || handleStats.size !== payload.length) {
      throw new Error("V10 Preview consent tombstone handle is not a complete ordinary file");
    }
    fsApi.closeSync(handle);
    handle = null;

    assertCanonicalDirectory(repositoryRoot, "V10 Preview consent repository root", fsApi);
    assertCanonicalDirectory(dataDirectory, "V10 Preview consent data directory", fsApi);
    const canonicalLedgerDirectory = assertCanonicalDirectory(
      ledgerDirectory,
      "V10 Preview consent ledger directory",
      fsApi,
    );
    const pathStats = fsApi.lstatSync(tombstonePath);
    if (
      !pathStats.isFile()
      || pathStats.isSymbolicLink()
      || pathStats.nlink !== 1
      || !stableFileIdentity(handleStats, pathStats)
      || !samePath(path.dirname(fsApi.realpathSync(tombstonePath)), canonicalLedgerDirectory)
    ) {
      throw new Error("V10 Preview consent tombstone changed during durable consumption");
    }
    fsyncDirectoryEntry(ledgerDirectory, fsApi);
  } catch (error) {
    if (handle !== null) {
      try {
        fsApi.closeSync(handle);
      } catch {
        // The exclusive tombstone remains reserved even if closing fails.
      }
    }
    if (!created && error?.code === "V10_PREVIEW_CONSENT_ALREADY_CONSUMED") throw error;
    if (!created) throw error;
    throw storeError(
      "V10_PREVIEW_CONSENT_PERSISTENCE_FAILED",
      "V10 Preview consent could not be durably recorded; this runId remains consumed",
      error,
    );
  }

  return Object.freeze({
    status: "consumed",
    runId: normalizedBinding.runId,
    markerPath: path.relative(repositoryRoot, tombstonePath),
  });
}
