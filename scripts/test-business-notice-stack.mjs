import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as noticeStackModule from "../app/components/NoticeStack.tsx";

const { NoticeStack } = noticeStackModule.default ?? noticeStackModule;

function countMatches(value, pattern) {
  return [...value.matchAll(pattern)].length;
}

function noticeMarkupIssues(html, noticeCount) {
  const issues = [];
  if (!html.includes('aria-label="Notifications"')) issues.push("notifications-label");
  if (/<div[^>]*aria-label="Notifications"[^>]*role=/.test(html)) issues.push("container-live-role");
  if (!html.includes("env(safe-area-inset-top")) issues.push("safe-area-top");
  if (countMatches(html, /aria-atomic="true"/g) !== noticeCount) issues.push("atomic-count");
  if (countMatches(html, /aria-label="Dismiss notice"/g) !== noticeCount) issues.push("dismiss-label-count");
  if (countMatches(html, /class="[^"]*\bh-11\b[^"]*\bw-11\b[^"]*"/g) !== noticeCount) {
    issues.push("dismiss-target-count");
  }
  return issues;
}

export function runNoticeStackBehaviorTests() {
  let dismissCalls = 0;
  const render = (notices) => renderToStaticMarkup(React.createElement(NoticeStack, {
    notices,
    onDismiss: () => { dismissCalls += 1; },
  }));

  assert.equal(render([]), "");
  assert.equal(dismissCalls, 0);

  const notices = [
    { id: 1, tone: "info", message: "Information" },
    { id: 2, tone: "success", message: "Completed" },
    { id: 3, tone: "warning", message: "Needs attention" },
    { id: 4, tone: "danger", message: "Failure <secret>" },
  ];
  const html = render(notices);
  assert.deepEqual(noticeMarkupIssues(html, notices.length), []);
  assert.equal(dismissCalls, 0, "SSR must not invoke dismiss callbacks");
  assert.equal(countMatches(html, /role="alert"/g), 1);
  assert.equal(countMatches(html, /aria-live="assertive"/g), 1);
  assert.equal(countMatches(html, /role="status"/g), 3);
  assert.equal(countMatches(html, /aria-live="polite"/g), 3);
  assert.equal(countMatches(html, /type="button"/g), 4);
  for (const label of ["Info", "Success", "Warning", "Error"]) {
    assert.match(html, new RegExp(`>${label}<`));
  }
  assert.match(html, /Failure &lt;secret&gt;/);
  assert.match(html, /focus-visible:ring-2/);

  const mutants = [
    html.replace('role="alert"', 'role="status"'),
    html.replace('aria-live="assertive"', 'aria-live="polite"'),
    html.replace('aria-atomic="true"', 'aria-atomic="false"'),
    html.replace(/\bh-11\b/, "h-8"),
    html.replace('aria-label="Dismiss notice"', 'aria-label="Close"'),
  ];
  for (const mutant of mutants) {
    const semanticFailure = countMatches(mutant, /role="alert"/g) !== 1
      || countMatches(mutant, /aria-live="assertive"/g) !== 1
      || noticeMarkupIssues(mutant, notices.length).length > 0;
    assert.equal(semanticFailure, true, "notice accessibility mutant must be rejected");
  }
}
