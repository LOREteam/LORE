import { redactProofText } from "./redact-proof-output.mjs";

export const MAX_BROWSER_SMOKE_JSON_BYTES = 256 * 1024;
export const MAX_BROWSER_SMOKE_DIAGNOSTIC_CHARS = 500;
export const REQUIRED_BROWSER_SMOKE_STEPS = Object.freeze([
  "verify browser boot does not trigger keeper resolve",
  "verify native Web Locks across two tabs",
  "verify hub visual regression guards",
  "verify keyboard focus indicator",
  "verify system reduced-motion preference",
  "verify desktop wallet selector",
  "verify isolated mobile wallet selector",
  "verify first-visit tutorial accessibility",
  "verify mobile touch targets",
  "verify mobile safety pool touch targets",
  "verify mobile leaderboards touch targets",
  "open desktop white paper tab",
]);
const DECIMAL_INTEGER_RE = /^(?:0|[1-9]\d{0,15})$/;
const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

export function parseSmokeChainId(value) {
  if (value == null || value === "") return 59141;
  if (!DECIMAL_INTEGER_RE.test(value)) {
    throw new Error("NEXT_PUBLIC_LINEA_CHAIN_ID must be a canonical decimal integer");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 1_000_000_000) {
    throw new Error("NEXT_PUBLIC_LINEA_CHAIN_ID must be between 1 and 1000000000");
  }
  return parsed;
}

export function parseBrowserSmokeContentLengthHeader(value) {
  if (value == null || value === "") return null;
  if (!DECIMAL_INTEGER_RE.test(value)) throw new Error("invalid browser smoke response content-length");
  const parsed = BigInt(value);
  if (parsed > MAX_SAFE_INTEGER_BIGINT) throw new Error("invalid browser smoke response content-length");
  return Number(parsed);
}

export async function readBoundedBrowserSmokeJsonResponse(response) {
  const contentLength = parseBrowserSmokeContentLengthHeader(response.headers.get("content-length"));
  if (contentLength !== null && contentLength > MAX_BROWSER_SMOKE_JSON_BYTES) {
    throw new Error("browser smoke JSON response body too large");
  }
  if (!response.body) throw new Error("browser smoke JSON response body is empty");
  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let totalBytes = 0;
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_BROWSER_SMOKE_JSON_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new Error("browser smoke JSON response body too large");
    }
    text += decoder.decode(value, { stream: true });
  }
  text += decoder.decode();
  return JSON.parse(text);
}

export async function fetchBrowserSmokeLiveState({
  baseUrl,
  timeoutMs,
  fetchImpl = fetch,
  timeoutSignal = AbortSignal.timeout,
}) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error("browser smoke live-state timeout must be a positive safe integer");
  }
  const response = await fetchImpl(new URL("/api/live-state", baseUrl), {
    cache: "no-store",
    signal: timeoutSignal(timeoutMs),
  });
  if (!response.ok) throw new Error(`live-state epoch probe returned ${response.status}`);
  return readBoundedBrowserSmokeJsonResponse(response);
}

export function isIgnoredBrowserConsoleMessage(message) {
  return [
    "linea-sepolia.drpc.org",
    "source=csp-report",
    "gc.kis.v2.scr.kaspersky-labs.com",
    "kaspersky-labs.com",
    "[AutoResolve] server keeper bootstrap",
    "useActiveWallet-",
    "Applying inline style violates the following Content Security Policy directive",
    "Loading the script 'http://gc.kis.v2.scr.kaspersky-labs.com/",
    "Loading the stylesheet 'http://gc.kis.v2.scr.kaspersky-labs.com/",
    "Can't perform a React state update on a component that hasn't mounted yet.",
    "Failed to load resource",
    "TypeError: Failed to fetch",
    "Do not know how to serialize a BigInt",
    "[HMR]",
    "[Fast Refresh]",
  ].some((part) => message.includes(part));
}

export function compactBrowserDiagnostic(value) {
  const text = redactProofText(value).replace(/\s+/g, " ").trim();
  if (text.length <= MAX_BROWSER_SMOKE_DIAGNOSTIC_CHARS) return text;
  return `${text.slice(0, MAX_BROWSER_SMOKE_DIAGNOSTIC_CHARS - 15)}...<truncated>`;
}

export function scopedBrowserDiagnostic(scope, value) {
  const text = compactBrowserDiagnostic(value);
  return scope ? `[${scope}] ${text}` : text;
}

export function compactPageError(error, source) {
  return {
    message: compactBrowserDiagnostic(error?.message || error),
    stack: compactBrowserDiagnostic(error?.stack || ""),
    source,
  };
}

export function isUnsupportedPrivyCoinbaseRegression(message) {
  return message.includes("configured chains are not") && message.includes("supported");
}

export function isIgnoredHydrationNoise(message) {
  return message.includes("A tree hydrated but some attributes of the server rendered HTML didn't match the client properties.")
    && message.includes('caret-color:"transparent"');
}

export function isIgnoredPageError(message) {
  return [
    "Do not know how to serialize a BigInt",
    "Loading chunk app/layout failed",
    "ChunkLoadError",
  ].some((part) => message.includes(part));
}

export function classifyBrowserConsoleEvent({ type, text, scope = "" }) {
  const diagnostic = scopedBrowserDiagnostic(scope, text);
  return {
    diagnostic,
    connectorRegression: isUnsupportedPrivyCoinbaseRegression(text),
    unexpectedError: type === "error" && !isIgnoredBrowserConsoleMessage(text),
  };
}

export async function createIsolatedBrowserSmokePage({
  browser,
  viewport,
  initScript,
  initArgument,
  pageErrorSource,
  consoleScope = "",
  pageErrors,
  consoleErrors,
  consoleRegressions,
}) {
  const context = await browser.newContext({ viewport });
  if (initScript) await context.addInitScript(initScript, initArgument);
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(compactPageError(error, pageErrorSource)));
  page.on("console", (message) => {
    const classified = classifyBrowserConsoleEvent({
      type: message.type(),
      text: message.text(),
      scope: consoleScope,
    });
    if (classified.connectorRegression) consoleRegressions.push(classified.diagnostic);
    if (classified.unexpectedError) consoleErrors.push(classified.diagnostic);
  });
  return { context, page };
}

export async function assertEmptyPoolChartVisual({ page, expectVisible, timeoutMs }) {
  const visual = page.locator('[data-testid="header-pool-chart-visual"]');
  await expectVisible(visual, "empty pool chart visual", timeoutMs);
  if (await visual.getAttribute("data-empty-pool") !== "true") {
    throw new Error("empty pool chart visual is not marked as empty");
  }
  return visual;
}

export async function runBrowserSmokeCli({
  mainFn,
  errorLog = console.error,
  processLike = process,
}) {
  try {
    await mainFn();
    return { ok: true };
  } catch (error) {
    errorLog(compactBrowserDiagnostic(error instanceof Error ? error.message : error));
    processLike.exitCode = 1;
    return { ok: false };
  }
}

export function browserSmokeRequiredStepIssues(observedLabels, requiredLabels = REQUIRED_BROWSER_SMOKE_STEPS) {
  if (!Array.isArray(observedLabels)) return ["browser smoke step observations are missing"];
  const observed = new Set(observedLabels);
  return requiredLabels.filter((label) => !observed.has(label)).map((label) => `missing browser smoke step: ${label}`);
}

export function createBrowserSmokeStepRunner({ now = Date.now, log = console.log } = {}) {
  const observedLabels = [];
  return {
    async run(label, task) {
      if (typeof label !== "string" || !label) throw new Error("browser smoke step label is required");
      if (typeof task !== "function") throw new Error(`browser smoke step task is required: ${label}`);
      const startedAt = now();
      log(`STEP ${label}...`);
      const result = await task();
      observedLabels.push(label);
      log(`STEP ${label} done in ${Math.max(0, now() - startedAt)}ms`);
      return result;
    },
    assertRequiredStepsComplete() {
      const issues = browserSmokeRequiredStepIssues(observedLabels);
      if (issues.length > 0) throw new Error(issues.join(", "));
    },
    observedLabels,
  };
}

export async function openBrowserLoginModalWithSingleReload({
  label,
  openModal,
  reload,
  expectReady,
  log = console.log,
}) {
  if (await openModal()) return true;
  log(`WARN ${label} login modal did not open; reloading once before retry`);
  await reload();
  await expectReady();
  return openModal();
}

export function assertNoUnattendedBootstrapResolveRequests(requests) {
  if (!Array.isArray(requests)) throw new Error("bootstrap-resolve request observations are missing");
  if (requests.length > 0) throw new Error("browser boot made an unattended bootstrap-resolve request");
}
