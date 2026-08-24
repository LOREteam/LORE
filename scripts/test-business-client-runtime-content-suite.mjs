import { runGameDataPresentationTests } from "./test-business-game-data-presentation.mjs";
import { runRuntimePollingTests } from "./test-business-runtime-polling.mjs";
import { runChatPollingTests } from "./test-business-chat-polling.mjs";
import { runChatContentTests } from "./test-business-chat-content.mjs";

export function runClientRuntimeContentSuite() {
  runRuntimePollingTests();
  runChatPollingTests();
  runChatContentTests();
  runGameDataPresentationTests();
}
