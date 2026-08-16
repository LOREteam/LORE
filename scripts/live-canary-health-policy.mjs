const CONTENT_LENGTH_RE = /^(?:0|[1-9]\d{0,15})$/;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

export const MAX_CANARY_HEALTH_RESPONSE_BYTES = 256 * 1024;

function healthTimeoutError() {
  return new Error("health sample request timed out");
}

export function parseCanaryHealthContentLength(value) {
  if (value == null || value === "") return null;
  if (!CONTENT_LENGTH_RE.test(value)) {
    throw new Error("health sample response has invalid content-length");
  }
  const parsed = BigInt(value);
  if (parsed > MAX_SAFE_INTEGER_BIGINT) {
    throw new Error("health sample response has invalid content-length");
  }
  return Number(parsed);
}

export async function readBoundedCanaryHealthJson(
  response,
  {
    maxBytes = MAX_CANARY_HEALTH_RESPONSE_BYTES,
    signal,
  } = {},
) {
  const contentLength = parseCanaryHealthContentLength(response.headers.get("content-length"));
  if (contentLength !== null && contentLength > maxBytes) {
    throw new Error("health sample response body too large");
  }
  if (!response.body) throw new Error("health sample response body is empty");

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let rejectOnAbort;
  const abortPromise = signal
    ? new Promise((_, reject) => {
        rejectOnAbort = () => reject(healthTimeoutError());
        signal.addEventListener("abort", rejectOnAbort, { once: true });
      })
    : null;

  let totalBytes = 0;
  let text = "";
  try {
    if (signal?.aborted) throw healthTimeoutError();
    while (true) {
      const read = reader.read();
      const { done, value } = abortPromise
        ? await Promise.race([read, abortPromise])
        : await read;
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error("health sample response body too large");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    try {
      return JSON.parse(text);
    } catch {
      throw new Error("health sample response is not valid JSON");
    }
  } catch (error) {
    if (signal?.aborted) {
      await reader.cancel().catch(() => undefined);
      throw healthTimeoutError();
    }
    throw error;
  } finally {
    if (signal && rejectOnAbort) signal.removeEventListener("abort", rejectOnAbort);
  }
}

export async function fetchCanaryHealthPayloadPair({
  baseUrl,
  secret,
  timeoutMs,
  fetchImpl = fetch,
  setTimeoutImpl = setTimeout,
  clearTimeoutImpl = clearTimeout,
}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error("health sample timeout must be a positive safe integer");
  }

  const controller = new AbortController();
  let timeout;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeoutImpl(() => {
      controller.abort();
      reject(healthTimeoutError());
    }, timeoutMs);
  });
  const headers = {
    "cache-control": "no-cache",
    "x-health-diagnostics-secret": secret,
  };

  const fetchAndRead = async () => {
    const [runtimeResponse, dataSyncResponse] = await Promise.all([
      fetchImpl(new URL("/api/health/runtime", baseUrl), {
        headers,
        redirect: "error",
        signal: controller.signal,
      }),
      fetchImpl(new URL("/api/health/data-sync", baseUrl), {
        headers,
        redirect: "error",
        signal: controller.signal,
      }),
    ]);
    if (!runtimeResponse.ok || !dataSyncResponse.ok) {
      throw new Error(
        `Health endpoints returned runtime=${runtimeResponse.status} dataSync=${dataSyncResponse.status}`,
      );
    }
    const [runtimePayload, dataSyncPayload] = await Promise.all([
      readBoundedCanaryHealthJson(runtimeResponse, { signal: controller.signal }),
      readBoundedCanaryHealthJson(dataSyncResponse, { signal: controller.signal }),
    ]);
    return { runtimePayload, dataSyncPayload };
  };

  try {
    return await Promise.race([fetchAndRead(), deadline]);
  } finally {
    clearTimeoutImpl(timeout);
  }
}
