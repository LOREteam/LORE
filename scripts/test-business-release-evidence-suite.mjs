import { runReleaseOperationsTests } from "./test-business-release-operations.mjs";
import { runLiveCanaryHealthBehaviorTests } from "./test-business-live-canary-health.mjs";
import { runPlaytestWalletPolicyTests } from "./test-business-playtest-wallet-policy.mjs";
import { runAutonomousStatusBehaviorTests } from "./test-business-autonomous-status.mjs";
import { runAutonomousDailyStatusTests } from "./test-business-autonomous-daily-status.mjs";
import { runPrelaunchStatusBehaviorTests } from "./test-business-prelaunch-status.mjs";
import { runProofDraftBehaviorTests } from "./test-business-proof-drafts.mjs";
import { runProofFileBehaviorTests } from "./test-business-proof-files.mjs";
import {
  runLaunchProofRunnerBehaviorTests,
  runLocalProofPreflightBehaviorTests,
} from "./test-business-local-proof-preflight.mjs";

export async function runReleaseEvidenceSuite() {
  runReleaseOperationsTests();
  await runLiveCanaryHealthBehaviorTests();
  await runPlaytestWalletPolicyTests();
  runAutonomousStatusBehaviorTests();
  runAutonomousDailyStatusTests();
  runPrelaunchStatusBehaviorTests();
  runProofDraftBehaviorTests();
  runProofFileBehaviorTests();
  runLocalProofPreflightBehaviorTests();
  runLaunchProofRunnerBehaviorTests();
}
