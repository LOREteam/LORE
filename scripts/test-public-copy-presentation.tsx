import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FAQ } from "../app/components/FAQ";
import { WhitePaper } from "../app/components/WhitePaper";
import { CONTRACT_ADDRESS, LINEA_TOKEN_ADDRESS } from "../app/lib/constants";
import { shortenAddress } from "../app/lib/utils";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const whitePaper = renderToStaticMarkup(<WhitePaper />);
const faq = renderToStaticMarkup(<FAQ />);

assert.doesNotMatch(whitePaper, /Claim Anytime/, "White Paper must not promise perpetual claims");
assert.doesNotMatch(
  whitePaper,
  /title="Cycles"[\s\S]{0,220}(?:1(?:\u2013|-)\u221e|infinite|unlimited)/i,
  "White Paper must not imply unlimited Auto-Miner cycles",
);
assert.match(whitePaper, /Total rounds to auto-bet \(1-5000\)/, "White Paper Auto-Miner cycle copy must match the runtime 5000-cycle cap");
assert.doesNotMatch(
  `${whitePaper}\n${faq}`,
  /(?:tested on|During) Sepolia\b/,
  "player-facing docs must name Linea Sepolia instead of generic Sepolia",
);
assert.match(faq, /<button[^>]*type="button"[^>]*aria-expanded="(?:true|false)"[^>]*aria-controls="[^"]+"/, "FAQ accordion buttons must remain non-submit controls with expanded/panel wiring");
assert.match(whitePaper, new RegExp(escapeRegExp(shortenAddress(CONTRACT_ADDRESS))), "White Paper must display the configured game contract instead of a stale literal address");
assert.match(whitePaper, new RegExp(escapeRegExp(shortenAddress(LINEA_TOKEN_ADDRESS))), "White Paper must display the configured LINEA token instead of a stale literal address");

console.log("public-copy-presentation-pass");
