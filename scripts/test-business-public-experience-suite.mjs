import { runPublicMetadataTests } from "./test-business-public-metadata.mjs";
import { runPublicPresentationTests } from "./test-business-public-presentation.mjs";
import { runDirectRouteSsrTests } from "./test-business-direct-route-ssr.mjs";
import { runTutorialAndPublicCopyTests } from "./test-business-tutorial-public-copy.mjs";

export function runPublicExperienceSuite() {
  runPublicMetadataTests();
  runPublicPresentationTests();
  runDirectRouteSsrTests();
  runTutorialAndPublicCopyTests();
}
