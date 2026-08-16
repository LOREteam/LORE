import { redactProofText } from "./redact-proof-output.mjs";

const CONTENT_LENGTH_RE = /^(?:0|[1-9]\d{0,15})$/;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const SIGNING_ENV_NAME_RE = /(?:^|_)(?:PRIVATE_KEY|MNEMONIC|SEED(?:_PHRASE)?|SIGNING_KEY)(?:_|$)/i;

export const MAX_PLAYTEST_JSON_RESPONSE_BYTES = 512 * 1024;
export const MAX_PLAYTEST_ERROR_CHARS = 500;

function playtestTimeoutError() {
  return new Error("wallet playtest request timed out");
}

export function hasWalletSigningMaterial(environment) {
  return Object.entries(environment).some(
    ([name, value]) => Boolean(String(value ?? "").trim()) && SIGNING_ENV_NAME_RE.test(name),
  );
}

export function resolveWalletPlaytestAdmission({
  executeRequested,
  executeEnvironmentValue,
  signingMaterialPresent,
}) {
  if (executeRequested && executeEnvironmentValue !== "1") {
    throw new Error("Refusing wallet playtest execution without TEST_WALLET_EXECUTE=1");
  }
  const liveExecutionConfirmed = executeRequested && executeEnvironmentValue === "1";
  const dryRun = !liveExecutionConfirmed;
  if (dryRun && signingMaterialPresent) {
    throw new Error("Dry-run wallet playtest refuses inherited signing material");
  }
  return { dryRun, liveExecutionConfirmed };
}

export function parsePlaytestContentLength(value) {
  if (value == null || value === "") return null;
  if (!CONTENT_LENGTH_RE.test(value)) {
    throw new Error("playtest JSON response has invalid content-length");
  }
  const parsed = BigInt(value);
  if (parsed > MAX_SAFE_INTEGER_BIGINT) {
    throw new Error("playtest JSON response has invalid content-length");
  }
  return Number(parsed);
}

export async function readBoundedPlaytestResponseText(
  response,
  {
    maxBytes = MAX_PLAYTEST_JSON_RESPONSE_BYTES,
    signal,
  } = {},
) {
  const contentLength = parsePlaytestContentLength(response.headers.get("content-length"));
  if (contentLength !== null && contentLength > maxBytes) {
    throw new Error("playtest JSON response body too large");
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let rejectOnAbort;
  const abortPromise = signal
    ? new Promise((_, reject) => {
        rejectOnAbort = () => reject(playtestTimeoutError());
        signal.addEventListener("abort", rejectOnAbort, { once: true });
      })
    : null;
  let totalBytes = 0;
  let text = "";
  try {
    if (signal?.aborted) throw playtestTimeoutError();
    while (true) {
      const read = reader.read();
      const { done, value } = abortPromise
        ? await Promise.race([read, abortPromise])
        : await read;
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error("playtest JSON response body too large");
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } catch (error) {
    if (signal?.aborted) {
      await reader.cancel().catch(() => undefined);
      throw playtestTimeoutError();
    }
    throw error;
  } finally {
    if (signal && rejectOnAbort) signal.removeEventListener("abort", rejectOnAbort);
  }
}

async function withPlaytestDeadline(timeoutMs, operation, {
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
} = {}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("wallet playtest request timeout must be a positive safe integer");
  }
  const controller = new AbortController();
  let timeout;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeoutImpl(() => {
      controller.abort();
      reject(playtestTimeoutError());
    }, timeoutMs);
  });
  try {
    return await Promise.race([operation(controller.signal), deadline]);
  } finally {
    clearTimeoutImpl(timeout);
  }
}

export async function fetchPlaytestJson({
  url,
  timeoutMs,
  fetchImpl = fetch,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
}) {
  return withPlaytestDeadline(
    timeoutMs,
    async (signal) => {
      const response = await fetchImpl(url, {
        headers: { accept: "application/json" },
        signal,
      });
      const text = await readBoundedPlaytestResponseText(response, { signal });
      let json = null;
      try {
        json = JSON.parse(text);
      } catch {
        json = text;
      }
      return { status: response.status, ok: response.ok, json };
    },
    { setTimeoutImpl, clearTimeoutImpl },
  );
}

export async function fetchPlaytestStatus({
  url,
  accept,
  timeoutMs,
  fetchImpl = fetch,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
}) {
  return withPlaytestDeadline(
    timeoutMs,
    async (signal) => {
      const response = await fetchImpl(url, { headers: { accept }, signal });
      return { ok: response.ok, status: response.status };
    },
    { setTimeoutImpl, clearTimeoutImpl },
  );
}

export function describeWalletPlaytestError(error) {
  const text = redactProofText(error instanceof Error ? error.message : String(error))
    .replace(/\b(?:https?|wss?):\/\/[^\s"'<>)}\]]+/gi, "<redacted-url>")
    .replace(/\b[A-Za-z]:\\[^\s"'<>)}\]]+/g, "<redacted-path>")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= MAX_PLAYTEST_ERROR_CHARS) return text;
  const suffix = "...<truncated>";
  return `${text.slice(0, MAX_PLAYTEST_ERROR_CHARS - suffix.length)}${suffix}`;
}
