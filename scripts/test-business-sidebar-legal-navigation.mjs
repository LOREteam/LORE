import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export function runSidebarLegalNavigationTests() {
  const sidebarSource = readFileSync("app/components/Sidebar.tsx", "utf8");
  const whitePaperSource = readFileSync("app/components/WhitePaper.tsx", "utf8");
  assert.match(sidebarSource, /href="\/privacy"[\s\S]*Privacy/, "privacy policy must stay discoverable from the main application shell");
  assert.match(sidebarSource, /href="\/terms"[\s\S]*Terms/, "terms of play must stay discoverable from the main application shell");
  assert.match(whitePaperSource, /href="\/privacy"[\s\S]*Privacy Policy[\s\S]*href="\/terms"[\s\S]*Terms of Play/, "White Paper footer must link both Privacy Policy and Terms of Play");
  assert.match(sidebarSource, /href="\/privacy"[\s\S]*min-h-11[\s\S]*Privacy[\s\S]*href="\/terms"[\s\S]*min-h-11[\s\S]*Terms/, "sidebar legal links must keep mobile touch targets");
  assert.match(sidebarSource, /claimAllLabel = isClaiming \? "Reward claim is already pending"[\s\S]*aria-label=\{claimAllLabel\}[\s\S]*title=\{claimAllLabel\}/, "sidebar reward claim-all action must keep an accessible pending/ready label");
  assert.match(sidebarSource, /claimLabel = isClaiming \? "Reward claim is already pending"[\s\S]*aria-label=\{claimLabel\}[\s\S]*title=\{claimLabel\}/, "sidebar reward claim action must keep an accessible pending/ready label");
}
