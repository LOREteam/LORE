import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as errorCatcherModule from "../app/components/ErrorCatcher.tsx";

export function runErrorShellBoundaryTests() {
  const errorCatcher = errorCatcherModule.default ?? errorCatcherModule;
  assert.deepEqual(
    [
      errorCatcher.isPrivyAuthSessionTimeout(
        "POST https://auth.privy.io/api/v1/sessions timed out",
      ),
      errorCatcher.isPrivyAuthSessionTimeout(
        "https://auth.privy.io/api/v1/sessions <no response>",
      ),
    ],
    [true, true],
  );
  assert.deepEqual(
    [
      errorCatcher.isPrivyAuthSessionTimeout(
        "https://auth.privy.io/api/v1/users timed out",
      ),
      errorCatcher.isPrivyAuthSessionTimeout(
        "https://auth.privy.io/api/v1/sessions returned 500",
      ),
    ],
    [false, false],
  );

  const intercepted = [];
  errorCatcher.suppressPrivyAuthSessionTimeoutEvent({
    preventDefault: () => intercepted.push("preventDefault"),
    stopImmediatePropagation: () => intercepted.push("stopImmediatePropagation"),
  });
  assert.deepEqual(
    intercepted,
    ["preventDefault", "stopImmediatePropagation"],
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
