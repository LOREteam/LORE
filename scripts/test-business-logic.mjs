import { isAbsolute, relative, resolve } from "node:path";

function assertIsolatedBusinessLogicEnvironment() {
  if (process.env.LORE_BUSINESS_LOGIC_ISOLATED_RUNNER !== "1") {
    throw new Error("test-business-logic.mjs must start through business-logic-isolated-runner.mjs");
  }
  const dbPath = process.env.LORE_DB_PATH;
  if (typeof dbPath !== "string" || !isAbsolute(dbPath)) {
    throw new Error("test-business-logic.mjs requires an absolute isolated LORE_DB_PATH");
  }
  const protectedDataRoot = resolve("data");
  const relativePath = relative(protectedDataRoot, resolve(dbPath));
  if (relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))) {
    throw new Error("test-business-logic.mjs refuses a LORE_DB_PATH inside protected data");
  }
}

assertIsolatedBusinessLogicEnvironment();
const { runBusinessLogicSuite } = await import("./business-logic-suite.mjs");

async function withExpectedWarningSuppression(fn) {
  const originalWarn = console.warn;
  let suppressed = 0;
  console.warn = (...args) => {
    const first = typeof args[0] === "string" ? args[0] : "";
    if (first === "[AutoMine]" || first === "[ManualMine]" || first === "[DirectMine]") {
      suppressed += 1;
      return;
    }
    originalWarn(...args);
  };
  try {
    await fn();
  } finally {
    console.warn = originalWarn;
  }
  return suppressed;
}



const suppressedExpectedWarnings = await withExpectedWarningSuppression(runBusinessLogicSuite);
if (suppressedExpectedWarnings > 0) {
  console.log(`Suppressed ${suppressedExpectedWarnings} expected synthetic warning log(s).`);
}
