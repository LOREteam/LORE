import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import * as jackpotBannerModule from "../app/components/JackpotBanner.tsx";

function readJackpotBannerBehavior() {
  const jackpotBannerUrl = new URL("../app/components/JackpotBanner.tsx", import.meta.url).href;
  const generatedAbiUrl = new URL("../config/generated/lineaOreV10Abi.ts", import.meta.url).href;
  const script = [
    'const { mock } = await import("node:test");',
    'const actualReact = await import("react");',
    `const jackpotBannerUrl = ${JSON.stringify(jackpotBannerUrl)};`,
    `const generatedAbiUrl = ${JSON.stringify(generatedAbiUrl)};`,
    "const capturedEvents = [];",
    "const publicClient = {",
    "  getBlockNumber: async () => 6000n,",
    "  getLogs: async ({ event }) => {",
    "    capturedEvents.push(event);",
    '    return event.name === "EpochResolved"',
    "      ? [{ args: { jackpotBonus: 3000000000000000000n } }]",
    "      : [];",
    "  },",
    "};",
    "let stateValues = [];",
    "let stateUpdates = [];",
    "let effects = [];",
    "let stateIndex = 0;",
    "let idIndex = 0;",
    "function beginRender(values) {",
    "  stateValues = values;",
    "  stateUpdates = [];",
    "  effects = [];",
    "  stateIndex = 0;",
    "  idIndex = 0;",
    "}",
    "const reactNamedExports = Object.fromEntries(",
    '  Object.entries(actualReact).filter(([name]) => name !== "default" && name !== "module.exports"),',
    ");",
    "Object.assign(reactNamedExports, {",
    "  useState: () => {",
    "    const slot = stateIndex++;",
    "    return [stateValues[slot], (value) => {",
    '      stateUpdates[slot] = typeof value === "function" ? value(stateValues[slot]) : value;',
    "    }];",
    "  },",
    "  useRef: (current) => ({ current }),",
    "  useMemo: (factory) => factory(),",
    "  useCallback: (callback) => callback,",
    "  useEffect: (callback, deps) => { effects.push({ callback, deps }); },",
    "  useId: () => `:jackpot-probe-${++idIndex}:`,",
    "});",
    'const reactMock = mock.module("react", {',
    "  defaultExport: actualReact.default,",
    "  namedExports: reactNamedExports,",
    "});",
    'const wagmiMock = mock.module("wagmi", {',
    "  namedExports: { usePublicClient: () => publicClient },",
    "});",
    "const imported = await import(jackpotBannerUrl);",
    "const jackpotBanner = imported.default ?? imported;",
    "const generatedImported = await import(generatedAbiUrl);",
    "const generatedAbi = generatedImported.default ?? generatedImported;",
    "const fallbackProps = {",
    "  winningTileId: 7,",
    "  isRevealing: false,",
    "  tileViewData: [{ tileId: 7, hasMyBet: true }],",
    '  epoch: "42",',
    "  isDailyJackpot: true,",
    "  isWeeklyJackpot: true,",
    "  jackpotAmount: 0,",
    "};",
    "beginRender([false, false, false, null, null]);",
    "jackpotBanner.JackpotBanner.type(fallbackProps);",
    "const fetchEffect = effects.find(({ deps }) => deps?.length === 6 && deps.includes(publicClient));",
    'if (!fetchEffect) throw new Error("missing jackpot fallback effect");',
    "const previousFetch = globalThis.fetch;",
    'globalThis.fetch = async () => { throw new Error("fixture indexer unavailable"); };',
    "try {",
    "  const cleanup = fetchEffect.callback();",
    "  for (let turn = 0; turn < 20 && stateUpdates[4] === undefined; turn += 1) {",
    "    await new Promise((resolve) => setImmediate(resolve));",
    "  }",
    "  cleanup?.();",
    "} finally {",
    "  globalThis.fetch = previousFetch;",
    "}",
    "const indexedAmount = stateUpdates[4] ?? null;",
    "const openState = [",
    "  true,",
    "  true,",
    "  false,",
    '  { key: "42:7:weekly", kind: "weekly", amountText: "1234.500000", epoch: "42", tileId: 7 },',
    "  null,",
    "];",
    "const openProps = { ...fallbackProps, isDailyJackpot: false, jackpotAmount: 1234.5 };",
    "const previousRandom = Math.random;",
    "let randomCalls = 0;",
    "let firstTree;",
    "let secondTree;",
    "Math.random = () => {",
    "  randomCalls += 1;",
    "  return randomCalls % 2 === 1 ? 0.125 : 0.875;",
    "};",
    "try {",
    "  beginRender(openState);",
    "  firstTree = jackpotBanner.JackpotBanner.type(openProps);",
    "  beginRender(openState);",
    "  secondTree = jackpotBanner.JackpotBanner.type(openProps);",
    "} finally {",
    "  Math.random = previousRandom;",
    "}",
    "wagmiMock.restore();",
    "reactMock.restore();",
    'const { renderToStaticMarkup } = await import("react-dom/server");',
    "const firstHtml = renderToStaticMarkup(firstTree);",
    "const secondHtml = renderToStaticMarkup(secondTree);",
    'const closeTag = firstHtml.match(/<button[^>]*aria-label="Close jackpot banner"[^>]*>/)?.[0] ?? "";',
    'const closeClasses = closeTag.match(/class="([^"]+)"/)?.[1] ?? "";',
    'const describedBy = firstHtml.match(/role="dialog"[^>]*aria-describedby="([^"]+)"/)?.[1] ?? null;',
    'const description = firstHtml.match(/<p id="([^"]+)" class="sr-only">([^<]+)<\\/p>/);',
    'const eventNames = ["DailyJackpotAwarded", "WeeklyJackpotAwarded", "EpochResolved"];',
    "const canonicalEvents = eventNames.map((name) =>",
    "  generatedAbi.GAME_EVENTS_ABI.find((event) => event.name === name),",
    ");",
    "console.log(JSON.stringify({",
    "  fallback: { names: capturedEvents.map((event) => event.name), indexedAmount },",
    "  canonicalIdentity: capturedEvents.map((event, index) => event === canonicalEvents[index]),",
    "  determinism: { randomCalls, sameMarkup: firstHtml === secondHtml },",
    "  closeButton: {",
    "    present: Boolean(closeTag),",
    '    h12: /(?:^|\\s)h-12(?:\\s|$)/.test(closeClasses),',
    '    w12: /(?:^|\\s)w-12(?:\\s|$)/.test(closeClasses),',
    "  },",
    "  description: {",
    "    linked: describedBy !== null && describedBy === description?.[1],",
    "    text: description?.[2] ?? null,",
    "  },",
    "}));",
  ].join("\n");

  const result = spawnSync(
    process.execPath,
    [
      "--no-warnings",
      "--experimental-test-module-mocks",
      "--import",
      "tsx",
      "--input-type=module",
      "--eval",
      script,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, TSX_DISABLE_CACHE: "1" },
      maxBuffer: 512 * 1024,
      timeout: 30_000,
      windowsHide: true,
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `jackpot banner behavior probe failed: ${result.error?.message ?? result.stderr.trim()}`,
    );
  }
  return JSON.parse(result.stdout.trim());
}

export function runJackpotBannerPresentationTests() {
  const jackpotBanner = jackpotBannerModule.default ?? jackpotBannerModule;
  const behavior = readJackpotBannerBehavior();
  assert.deepEqual(
    behavior.fallback,
    {
      names: ["DailyJackpotAwarded", "WeeklyJackpotAwarded", "EpochResolved"],
      indexedAmount: "3.000000",
    },
    "jackpot on-chain log fallback must source every event fragment from the generated V10 ABI snapshot",
  );
  assert.deepEqual(
    behavior.canonicalIdentity,
    [true, true, true],
    "jackpot on-chain log fallback must not define local ABI event strings",
  );
  const completeShareUrl = new URL(jackpotBanner.buildJackpotShareIntentUrl({
    jackpotLabel: "WEEKLY JACKPOT",
    amountText: "1,234.5",
    epoch: "42",
    tileId: 7,
  }));
  assert.deepEqual(
    [completeShareUrl.origin, completeShareUrl.pathname],
    ["https://x.com", "/intent/tweet"],
    "jackpot sharing must use only the canonical X intent endpoint",
  );
  assert.deepEqual(
    [...completeShareUrl.searchParams.keys()],
    ["text"],
    "jackpot sharing must keep the intent payload in a single text parameter",
  );
  assert.equal(
    completeShareUrl.searchParams.get("text"),
    "I just mined the WEEKLY JACKPOT in LORE.\nWon: 1,234.5 LINEA\nEpoch #42 - Tile #7\nplaylore.xyz\n#LORE #Linea",
    "jackpot share text must include exact win context, canonical site, and hashtags",
  );
  assert.equal(
    new URL(jackpotBanner.buildJackpotShareIntentUrl({
      jackpotLabel: "DAILY JACKPOT",
      amountText: "9",
      epoch: null,
      tileId: null,
    })).searchParams.get("text"),
    "I just mined the DAILY JACKPOT in LORE.\nWon: 9 LINEA\nplaylore.xyz\n#LORE #Linea",
    "jackpot share text must omit unavailable context without adding an empty line",
  );
  assert.deepEqual(
    behavior.determinism,
    { randomCalls: 0, sameMarkup: true },
    "jackpot banner decorative overlays must stay deterministic to avoid hydration and visual-smoke noise",
  );
  assert.equal(
    jackpotBanner.formatJackpotAmountText("9007199254740993.1234567"),
    "9007199254740993.123457",
    "indexed jackpot decimal text must round exactly without Number precision loss",
  );
  for (const invalidAmount of ["0", "bad", Infinity, null]) {
    assert.equal(
      jackpotBanner.formatJackpotAmountText(invalidAmount),
      null,
      `indexed jackpot amount ${String(invalidAmount)} must not create a displayable payout`,
    );
  }
  assert.equal(
    jackpotBanner.formatJackpotAmountWei(9007199254740993123456789n),
    "9007199.254741",
    "on-chain jackpot wei must retain exact bigint rounding without formatUnits coercion",
  );
  assert.equal(jackpotBanner.formatJackpotAmountWei(0n), null);
  assert.equal(jackpotBanner.formatJackpotAmountWei(null), null);
  assert.equal(
    jackpotBanner.formatJackpotDisplayAmount("12345678901234567890.123456"),
    "12,345,678,901,234,567,890.1235",
    "visible and shared jackpot text must group exact decimal text without number-locale coercion",
  );
  assert.equal(jackpotBanner.formatJackpotDisplayAmount("1000.000001"), "1,000");
  assert.equal(jackpotBanner.formatJackpotDisplayAmount("bad"), null);
  assert.equal(jackpotBanner.formatJackpotDisplayAmount(null), null);
  assert.deepEqual(
    behavior.closeButton,
    { present: true, h12: true, w12: true },
    "jackpot close action must keep a 48px touch target for mobile users",
  );
  assert.deepEqual(
    behavior.description,
    {
      linked: true,
      text: "Won 1,234.5 LINEA. Epoch 42. Tile 7.",
    },
    "jackpot modal must expose the won amount, epoch, and tile as an accessible description",
  );
}
