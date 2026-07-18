export type CanaryHealthSample = {
  dbBytes: number;
  diskFreeBytes: number;
  heapUsedBytes: number;
  rssBytes: number;
  runtimeUptimeSeconds: number;
  walBytes: number;
};

function readNonNegativeMetric(value: unknown, field: string) {
  const metric = Number(value);
  if (!Number.isFinite(metric) || metric < 0) throw new Error(`Health metric ${field} is missing or invalid`);
  return metric;
}

export function parseCanaryHealthBaseUrl(raw: string | undefined) {
  const value = raw?.trim();
  if (!value) return null;
  const url = new URL(value);
  const isLocalHttp = url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !isLocalHttp) {
    throw new Error("LIVE_TEST_HEALTH_BASE_URL must use HTTPS, except for localhost");
  }
  return url;
}

export function parseCanaryHealthPayloads(runtime: unknown, dataSync: unknown): CanaryHealthSample {
  const runtimePayload = runtime as { process?: Record<string, unknown>; redacted?: boolean } | null;
  const dataSyncPayload = dataSync as { storage?: Record<string, unknown>; redacted?: boolean } | null;
  if (!runtimePayload || runtimePayload.redacted) throw new Error("Runtime health diagnostics are unavailable or redacted");
  if (!dataSyncPayload || dataSyncPayload.redacted) throw new Error("Data-sync health diagnostics are unavailable or redacted");
  return {
    dbBytes: readNonNegativeMetric(dataSyncPayload.storage?.dbBytes, "storage.dbBytes"),
    diskFreeBytes: readNonNegativeMetric(dataSyncPayload.storage?.diskFreeBytes, "storage.diskFreeBytes"),
    heapUsedBytes: readNonNegativeMetric(runtimePayload.process?.heapUsedBytes, "process.heapUsedBytes"),
    rssBytes: readNonNegativeMetric(runtimePayload.process?.rssBytes, "process.rssBytes"),
    runtimeUptimeSeconds: readNonNegativeMetric(runtimePayload.process?.uptimeSeconds, "process.uptimeSeconds"),
    walBytes: readNonNegativeMetric(dataSyncPayload.storage?.walBytes, "storage.walBytes"),
  };
}
