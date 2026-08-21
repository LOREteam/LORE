import { runBusinessLogicSuite } from "./business-logic-suite.mjs";

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
