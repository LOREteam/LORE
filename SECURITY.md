# Security Notes

## Dependency Overrides

`package.json` intentionally pins `@typescript-eslint/typescript-estree` -> `minimatch` -> `brace-expansion` to `5.0.6`.

This override keeps the transitive `brace-expansion` dependency on a version that includes the fix for CVE-2026-45149 / GHSA-jxxr-4gwj-5jf2 and is also inside the fixed range for CVE-2026-33750 / GHSA-f886-m6hf-6m8v.
