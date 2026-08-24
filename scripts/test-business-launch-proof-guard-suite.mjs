import { runLaunchCommandMapBehaviorTests } from "./test-business-launch-command-map.mjs";
import { runReadinessChecklistBehaviorTests } from "./test-business-readiness-checklist.mjs";
import { runProofCollectorRedactionBehaviorTests } from "./test-business-proof-collector-redaction.mjs";
import { runProofTemplateBehaviorTests } from "./test-business-proof-templates.mjs";
import { runProcessModelBehaviorTests } from "./test-business-process-model.mjs";

export function runLaunchProofGuardSuite() {
  runLaunchCommandMapBehaviorTests();
  runReadinessChecklistBehaviorTests();
  runProofCollectorRedactionBehaviorTests();
  runProofTemplateBehaviorTests();
  runProcessModelBehaviorTests();
}
