import { redactProofText } from "./redact-proof-output.mjs";

export const MAX_RUNTIME_SMOKE_ERROR_CHARS = 500;
const TRUNCATION_SUFFIX = "...<truncated>";

function describeUnknownError(error) {
  try {
    return error instanceof Error ? error.message : String(error);
  } catch {
    return "unknown runtime error";
  }
}

export function formatRuntimeSmokeError(error) {
  const text = redactProofText(describeUnknownError(error))
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= MAX_RUNTIME_SMOKE_ERROR_CHARS) return text;
  return `${text.slice(0, MAX_RUNTIME_SMOKE_ERROR_CHARS - TRUNCATION_SUFFIX.length)}${TRUNCATION_SUFFIX}`;
}

export function createRuntimePageErrorCounter() {
  let count = 0;
  return {
    record() {
      count += 1;
    },
    count() {
      return count;
    },
  };
}
