import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as adminOpsPresentationModule from "../app/admin/adminOpsPresentation.tsx";

const adminOpsPresentation = adminOpsPresentationModule.default ?? adminOpsPresentationModule;

export function runAdminOpsPresentationTests() {
  const {
    AdminOpsButton,
    AdminOpsExternalLink,
    describeAdminClientError,
    formatAdminAge,
    formatAdminGib,
    formatAdminPercent,
    formatAdminWholePercent,
    normalizeConnectedAdminAddresses,
  } = adminOpsPresentation;

  const secretUrl = "https://user:password@rpc.example.invalid/private/key";
  const walletAddress = "0x1111111111111111111111111111111111111111";
  const described = describeAdminClientError(
    new Error(` provider failed\n${secretUrl}\nwallet=${walletAddress} `),
  );
  assert.ok(described.length > 0 && described.length <= 220);
  assert.equal(described.includes("\n"), false);
  assert.equal(described.includes(secretUrl), false);
  assert.equal(described.includes(walletAddress), false);
  assert.match(described, /<redacted>/);
  assert.equal(describeAdminClientError(new Error("")), "Admin operation failed");
  assert.equal(
    describeAdminClientError({ toString() { throw new Error("must-not-escape"); } }),
    "Admin operation failed",
  );
  assert.equal(describeAdminClientError(`  ${"x".repeat(400)}  `).length, 220);

  assert.equal(formatAdminPercent(12.345), "12.35%");
  for (const value of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(formatAdminPercent(value), "...");
  }
  assert.equal(formatAdminAge(-1), "...");
  assert.equal(formatAdminAge(0), "0 ms");
  assert.equal(formatAdminAge(999), "999 ms");
  assert.equal(formatAdminAge(1_000), "1.0 s");
  assert.equal(formatAdminAge(60_000), "1.0 min");
  assert.equal(formatAdminAge(3_600_000), "1.0 h");
  assert.equal(formatAdminAge(Number.NaN), "...");
  assert.equal(formatAdminGib(1_073_741_824), "1.00 GiB");
  assert.equal(formatAdminGib(0), "0.00 GiB");
  assert.equal(formatAdminGib(-1), "...");
  assert.equal(formatAdminGib(Number.POSITIVE_INFINITY), "...");
  assert.equal(formatAdminWholePercent(49.6), "50%");
  assert.equal(formatAdminWholePercent(null), "...");
  assert.equal(formatAdminWholePercent(Number.NaN), "...");

  const buttonHtml = renderToStaticMarkup(
    React.createElement(
      AdminOpsButton,
      {
        "aria-label": "Refresh diagnostics",
        className: "probe",
        disabled: true,
        type: "submit",
      },
      "Refresh",
    ),
  );
  assert.match(buttonHtml, /^<button[^>]*type="button"[^>]*>Refresh<\/button>$/);
  assert.match(buttonHtml, /aria-label="Refresh diagnostics"/);
  assert.match(buttonHtml, /class="probe"/);
  assert.match(buttonHtml, /disabled=""/);
  assert.doesNotMatch(buttonHtml, /type="submit"/);

  const mixedCaseAddress = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd";
  assert.deepEqual(
    normalizeConnectedAdminAddresses([
      mixedCaseAddress.toUpperCase().replace(/^0X/, "0x"),
      mixedCaseAddress,
      "not-an-address",
      null,
    ]),
    [mixedCaseAddress],
    "connected admin wallets must be canonicalized, deduplicated, and filtered",
  );
  const unsafeAddressMutant = (values) => [...new Set(values.filter(Boolean))];
  assert.notDeepEqual(
    unsafeAddressMutant([mixedCaseAddress.toUpperCase().replace(/^0X/, "0x"), mixedCaseAddress]),
    [mixedCaseAddress],
    "case-sensitive connected-wallet handling must be rejected by the canonical fixture",
  );

  const externalLinkHtml = renderToStaticMarkup(
    React.createElement(AdminOpsExternalLink, { href: "/api/health/runtime" }, "Runtime JSON"),
  );
  assert.match(externalLinkHtml, /href="\/api\/health\/runtime"/);
  assert.match(externalLinkHtml, /target="_blank"/);
  assert.match(externalLinkHtml, /rel="noopener noreferrer"/);
  assert.doesNotMatch(
    renderToStaticMarkup(React.createElement(AdminOpsExternalLink, { href: "/x", target: "_self", rel: "opener" }, "x")),
    /target="_self"|rel="opener"/,
    "callers must not weaken the fixed new-tab isolation attributes",
  );
}
