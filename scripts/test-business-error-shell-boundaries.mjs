import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export function runErrorShellBoundaryTests() {
  const globalErrorSource = readFileSync("app/global-error.tsx", "utf8");
  assert.match(
    globalErrorSource,
    /Hard reload/,
    "global error boundary must expose a hard reload fallback when app shell reset is not enough",
  );

  const errorCatcherSource = readFileSync("app/components/ErrorCatcher.tsx", "utf8");
  assert.match(
    errorCatcherSource,
    /isPrivyAuthSessionTimeout/,
    "global error catcher must classify transient Privy session timeouts",
  );
  assert.match(
    errorCatcherSource,
    /auth\.privy\.io\/api\/v1\/sessions/,
    "global error catcher must specifically target Privy session creation timeouts",
  );
  assert.match(
    errorCatcherSource,
    /stopImmediatePropagation/,
    "global error catcher must stop Next dev overlay for handled Privy auth timeouts",
  );

  const lineaOreClientSource = readFileSync("app/LineaOreClient.tsx", "utf8");
  assert.match(
    lineaOreClientSource,
    /dynamic\(\s*\(\)\s*=>\s*import\("\.\/components\/FirstVisitTutorial"\)/,
    "first-visit tutorial must stay lazy-loaded out of the main app client chunk",
  );
  assert.doesNotMatch(
    lineaOreClientSource,
    /import\s+\{\s*FirstVisitTutorial\s*\}\s+from\s+"\.\/components\/FirstVisitTutorial"/,
    "first-visit tutorial must not be statically imported by LineaOreClient",
  );
}
