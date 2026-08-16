import {
  parseCleanupMinAgeHours,
  runWorkspaceCleanup,
} from "./cleanup-workspace-model.mjs";

const dryRun = process.argv.includes("--dry-run");
const summaryOnly = process.argv.includes("--summary-only");
const minAge = parseCleanupMinAgeHours(process.env.CLEANUP_MIN_AGE_HOURS);
const summary = await runWorkspaceCleanup({
  root: process.cwd(),
  dryRun,
  summaryOnly,
  minAgeHours: minAge.hours,
  minAgeMs: minAge.milliseconds,
});

console.log(JSON.stringify(summary));
