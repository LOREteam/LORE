import { runDataSyncHealthPolicyTests } from "./test-business-data-sync-health-policy.mjs";
import { runAdminOpsPolicyTests } from "./test-business-admin-ops-policy.mjs";
import { runAdminOpsPresentationTests } from "./test-business-admin-ops-presentation.mjs";

export function runOperationsHealthSuite() {
  runDataSyncHealthPolicyTests();
  runAdminOpsPolicyTests();
  runAdminOpsPresentationTests();
}
