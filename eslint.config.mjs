import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // These are React Compiler experimental rules (not core rules-of-hooks / exhaustive-deps).
      // Disabled because this codebase intentionally uses patterns they flag:
      //   refs: mutating refs in render callbacks (useMining* hooks)
      //   set-state-in-effect: coordinated state updates in effects
      //   purity: side-effects in render helpers
      // TODO: gradually fix violations and re-enable these one by one.
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/purity": "off",
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
]);

export default eslintConfig;
