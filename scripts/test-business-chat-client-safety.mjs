import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import * as appShellStateModule from "../app/hooks/useAppShellState.ts";
import * as lineaOreClientViewPropsModule from "../app/lib/lineaOreClientViewProps.ts";
import * as indexerFinalityModule from "../app/lib/indexerFinality.ts";
import * as indexerWatchPolicyModule from "../app/lib/indexerWatchPolicy.ts";
import * as chatSessionClientModule from "../app/lib/chatSessionClient.ts";
import * as chatAuthModule from "../app/lib/chatAuth.ts";

function listSourceFiles(root, sourceFilePattern = /\.(?:ts|tsx|mjs)$/) {
  const entries = readdirSync(root, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return listSourceFiles(path, sourceFilePattern);
    return sourceFilePattern.test(entry.name) ? [path] : [];
  });
}

const indexerFinality = indexerFinalityModule.default ?? indexerFinalityModule;
const indexerWatchPolicy = indexerWatchPolicyModule.default ?? indexerWatchPolicyModule;
const chatSessionClient = chatSessionClientModule.default ?? chatSessionClientModule;
const chatAuth = chatAuthModule.default ?? chatAuthModule;

export function runChatAndClientSafetyTests() {
  const useChatSource = readFileSync("app/hooks/useChat.ts", "utf8");
  assert.match(
    useChatSource,
    /sendCooldownUntilRef/,
    "chat send cooldown must track an absolute deadline so server retryAfter survives rerenders",
  );
  assert.match(
    useChatSource,
    /parseChatRetryAfterMs/,
    "chat send must honor server retryAfter from 429 responses",
  );
  assert.match(
    useChatSource,
    /import \{ log \} from "\.\.\/lib\/logger";[\s\S]*log\.warn\("Chat", tag, err\)/,
    "chat network warnings must use the shared redacted support logger",
  );
  assert.doesNotMatch(
    useChatSource,
    /console\.warn\(\`\$\{tag\} \$\{message\}`\)/,
    "chat network warnings must not bypass support-log redaction through direct console.warn",
  );
  const appShellState = appShellStateModule.default ?? appShellStateModule;
  assert.deepEqual(appShellState.normalizeCachedHotTile({ tileId: 7, wins: "3" }), { tileId: 7, wins: 3 });
  assert.deepEqual(
    appShellState.normalizeCachedHotTile({ tileId: "25", wins: "9007199254740991" }),
    { tileId: 25, wins: Number.MAX_SAFE_INTEGER },
  );
  assert.equal(appShellState.normalizeCachedHotTile({ tileId: 0, wins: 1 }), null);
  assert.equal(appShellState.normalizeCachedHotTile({ tileId: 26, wins: 1 }), null);
  assert.equal(appShellState.normalizeCachedHotTile({ tileId: "1.5", wins: 1 }), null);
  assert.equal(appShellState.normalizeCachedHotTile({ tileId: "1e2", wins: 1 }), null);
  assert.equal(appShellState.normalizeCachedHotTile({ tileId: 1, wins: " 2" }), null);
  assert.equal(appShellState.normalizeCachedHotTile({ tileId: 1, wins: "9007199254740992" }), null);
  assert.equal(appShellState.normalizeCachedHotTile({ tileId: 1, wins: "9999999999999999" }), null);
  assert.equal(appShellState.normalizeCachedHotTile({ tileId: 1, wins: Number.MAX_SAFE_INTEGER + 1 }), null);
  const appShellStateSource = readFileSync("app/hooks/useAppShellState.ts", "utf8");
  assert.match(
    appShellStateSource,
    /log\.info\("App", "mounted", \{ path: window\.location\.pathname, tab: readHashTab\(\), time:/,
    "App mount diagnostics must keep route evidence without query-string payloads",
  );
  assert.doesNotMatch(
    appShellStateSource,
    /window\.location\.href/,
    "App shell support logs must not capture full URLs",
  );
  assert.match(
    appShellStateSource,
    /const raw = window\.localStorage\.getItem\(ACTIVE_TAB_STORAGE_KEY\)[\s\S]*if \(raw === null\) return null;[\s\S]*VALID_TABS\.includes\(raw as TabId\)[\s\S]*window\.localStorage\.removeItem\(ACTIVE_TAB_STORAGE_KEY\)/,
    "App shell active-tab restore must clear invalid localStorage values before falling back",
  );
  assert.match(
    appShellStateSource,
    /import \{ GRID_SIZE \} from "\.\.\/lib\/constants";[\s\S]*tileId > GRID_SIZE/,
    "cached hot tiles must reject impossible tile ids before rendering stale localStorage data",
  );
  assert.match(
    appShellStateSource,
    /MAX_SAFE_INTEGER_BIGINT = BigInt\(Number\.MAX_SAFE_INTEGER\)[\s\S]*function parsePositiveSafeInteger[\s\S]*typeof value === "number"[\s\S]*Number\.isSafeInteger\(value\)[\s\S]*\/\^\[1-9\]\\d\*\$\/\.test\(value\)[\s\S]*const parsed = BigInt\(value\)[\s\S]*parsed > MAX_SAFE_INTEGER_BIGINT[\s\S]*return Number\(parsed\)/,
    "cached hot tiles must use BigInt-bounded canonical positive safe-integer parsing before rendering stale localStorage data",
  );
  assert.doesNotMatch(
    appShellStateSource,
    /Number\(value\.(?:tileId|wins)\)|const parsed = Number\(value\)[\s\S]*Number\.isSafeInteger\(parsed\)/,
    "cached hot tiles must not broadly coerce tile or win counters with Number(...) before bounds checks",
  );
  const lineaOreClientViewProps = lineaOreClientViewPropsModule.default ?? lineaOreClientViewPropsModule;
  assert.equal(lineaOreClientViewProps.derivePreviousGridEpoch("42"), "41");
  assert.equal(lineaOreClientViewProps.derivePreviousGridEpoch("1"), "0");
  assert.equal(lineaOreClientViewProps.derivePreviousGridEpoch("0"), null);
  assert.equal(lineaOreClientViewProps.derivePreviousGridEpoch("001"), null);
  assert.equal(lineaOreClientViewProps.derivePreviousGridEpoch("1.5"), null);
  assert.equal(lineaOreClientViewProps.derivePreviousGridEpoch("1e3"), null);
  assert.equal(lineaOreClientViewProps.derivePreviousGridEpoch("9007199254740993"), "9007199254740992");
  const lineaOreClientViewPropsSource = readFileSync("app/lib/lineaOreClientViewProps.ts", "utf8");
  assert.match(
    lineaOreClientViewPropsSource,
    /export function derivePreviousGridEpoch\(gridDisplayEpoch: string \| null \| undefined\): string \| null[\s\S]*\/\^\(\?:0\|\[1-9\]\\d\*\)\$\/\.test\(gridDisplayEpoch\)[\s\S]*BigInt\(gridDisplayEpoch\)[\s\S]*epoch - 1n/,
    "jackpot fallback previous grid epoch must use canonical string and bigint parsing",
  );
  assert.match(
    lineaOreClientViewPropsSource,
    /const previousGridEpoch = derivePreviousGridEpoch\(gridDisplayEpoch\)/,
    "jackpot fallback view props must route previous grid epoch through the strict helper",
  );
  assert.doesNotMatch(
    lineaOreClientViewPropsSource,
    /Number\(gridDisplayEpoch\)/,
    "jackpot fallback previous grid epoch must not broadly coerce gridDisplayEpoch",
  );
  assert.match(
    appShellStateSource,
    /if \(hotTiles\.length === 0\) \{[\s\S]*setVisibleHotTiles\(\(current\) => \(current\.length === 0 \? current : \[\]\)\)[\s\S]*window\.localStorage\.removeItem\(HOT_TILES_STORAGE_KEY\)/,
    "hot tile sync must clear stale cached sidebar winners when the current history has no resolved hot tiles",
  );
  assert.match(
    appShellStateSource,
    /const parsed = JSON\.parse\(raw\) as unknown\[\][\s\S]*if \(!Array\.isArray\(parsed\)\) \{[\s\S]*window\.localStorage\.removeItem\(HOT_TILES_STORAGE_KEY\)[\s\S]*catch \{[\s\S]*window\.localStorage\.removeItem\(HOT_TILES_STORAGE_KEY\)/,
    "hot-tile cache reads must clear corrupt or invalid localStorage entries",
  );
  const chatWindowSource = readFileSync("app/components/chat/ChatWindow.tsx", "utf8");
  const chatWidgetSource = readFileSync("app/components/chat/ChatWidget.tsx", "utf8");
  const floatingActionsSource = readFileSync("app/components/FloatingActions.tsx", "utf8");
  assert.match(
    floatingActionsSource,
    /<button[\s\S]{0,120}type="button"[\s\S]{0,240}aria-label="Open chat"[\s\S]{0,80}disabled/,
    "lazy chat fallback button must remain a non-submit accessible control",
  );
  assert.match(
    chatWidgetSource,
    /const CHAT_PANEL_ID = "lore-chat-panel"[\s\S]*<button[\s\S]*type="button"[\s\S]*aria-controls=\{CHAT_PANEL_ID\}[\s\S]*aria-expanded=\{open\}/,
    "chat toggle must expose its expanded state and controlled panel",
  );
  assert.match(
    chatWindowSource,
    /const CHAT_PANEL_ID = "lore-chat-panel"[\s\S]*<div[\s\S]*id=\{CHAT_PANEL_ID\}/,
    "chat panel root must keep the stable id controlled by the floating toggle",
  );
  assert.match(
    chatWindowSource,
    /aria-live="polite"/,
    "chat cooldown feedback must remain visible without relying on console warnings",
  );
  assert.match(
    chatWindowSource,
    /aria-hidden="true"[\s\S]*title=\{connected \? "Connected" : "Connecting\.\.\."\}[\s\S]*role="status" aria-live="polite" aria-atomic="true"[\s\S]*connected \? "Chat connected" : "Chat connecting"/,
    "chat connection indicator must expose a non-color screen-reader status",
  );
  assert.match(
    chatWindowSource,
    /CHAT_VERIFY_ERROR[\s\S]*setVerifyError\(CHAT_VERIFY_ERROR\)/,
    "chat verify failure UI must use stable safe copy instead of raw wallet/provider messages",
  );
  assert.doesNotMatch(
    chatWindowSource,
    /setVerifyError\(err instanceof Error \? err\.message/,
    "chat verify failure UI must not surface raw wallet/provider errors",
  );
  assert.match(
    chatWindowSource,
    /data-testid="chat-send-action"/,
    "chat send action must expose a stable smoke-test selector",
  );
  assert.match(
    chatWindowSource,
    /placeholder=\{`Message as \$\{displayName\}`\}[\s\S]*aria-label="Chat message"/,
    "chat message input must not rely on placeholder text as its only accessible name",
  );
  assert.match(
    chatWindowSource,
    /data-testid="chat-profile-open"/,
    "chat profile entrypoint must expose a stable smoke-test selector",
  );
  assert.match(
    chatWindowSource,
    /aria-label="Profile"[\s\S]{0,180}className="[^"]*\bh-12\b[^"]*\bw-12\b/,
    "chat profile action must keep a padded touch target for mobile users",
  );
  assert.match(
    chatWindowSource,
    /aria-label="Close chat panel"[\s\S]{0,180}className="[^"]*\bh-12\b[^"]*\bw-12\b/,
    "chat close action must keep a padded touch target for mobile users",
  );
  const chatProfileModalSource = readFileSync("app/components/chat/ChatProfileModal.tsx", "utf8");
  assert.match(
    chatProfileModalSource,
    /data-testid="chat-profile-save"/,
    "chat profile save action must expose a stable smoke-test selector",
  );
  assert.match(
    chatProfileModalSource,
    /aria-label="Close"[\s\S]{0,220}uiTokens\.focusRing/,
    "chat profile close action must keep a visible keyboard focus ring",
  );
  assert.match(
    chatProfileModalSource,
    /aria-label="Use wallet identity avatar"[\s\S]*aria-pressed=\{!avatar && !customAvatar\}/,
    "chat profile wallet identity avatar option must expose its accessible name and selected state",
  );
  assert.match(
    chatProfileModalSource,
    /aria-label=\{`Select \$\{id\} avatar`\}[\s\S]*aria-pressed=\{avatar === id && !customAvatar\}/,
    "chat profile preset avatar options must expose accessible names and selected state",
  );
  const chatAuthRouteSource = readFileSync("app/api/chat/auth/route.ts", "utf8");
  assert.match(
    chatAuthRouteSource,
    /async function verifyChatSignature\([\s\S]*return verifyChatWalletMessage\(\{[\s\S]*address,[\s\S]*message,[\s\S]*signature,[\s\S]*rpcWitnesses:/,
    "chat auth must delegate the intended personal-sign message to the quorum verifier",
  );
  assert.doesNotMatch(
    chatAuthRouteSource,
    /recoverAddress|keccak256\(toBytes\(message\)\)/,
    "chat auth must not accept raw eth_sign digest recovery as a login fallback",
  );
  assert.match(
    readFileSync("app/lib/chatAuth.ts", "utf8"),
    /normalizeChatAuthAddress[\s\S]*getAddress/,
    "chat auth must normalize wallet addresses with the EVM address parser",
  );
  assert.match(
    readFileSync("app/lib/chatAuth.ts", "utf8"),
    /const fields = \{ address, uri, chainId, nonce, issuedAt \};[\s\S]*normalized !== buildChatAuthMessage\(fields\)/,
    "chat auth must reject non-canonical signed messages instead of accepting extra or reordered fields",
  );
  assert.match(
    readFileSync("app/lib/chatAuth.ts", "utf8"),
    /function parseCanonicalIssuedAtMs[\s\S]*toISOString\(\) === issuedAt[\s\S]*parseCanonicalIssuedAtMs\(issuedAt\)/,
    "chat auth must reject non-canonical issuedAt timestamps before TTL checks",
  );
  assert.match(
    readFileSync("app/lib/chatAuth.ts", "utf8"),
    /function parseCanonicalChainId[\s\S]*\^\[1-9\]\\d\{0,15\}\$[\s\S]*Number\.isSafeInteger\(parsed\)[\s\S]*const chainId = parseCanonicalChainId\(values\.get\("chain id"\)\)[\s\S]*chainId === null/,
    "chat auth must canonical-parse signed chain IDs before session issuance",
  );
  assert.match(
    readFileSync("app/lib/chatAuth.ts", "utf8"),
    /function parseCanonicalNonce[\s\S]*\^\[a-f0-9\]\{32,128\}\$[\s\S]*const nonce = parseCanonicalNonce\(values\.get\("nonce"\)\)[\s\S]*nonce === null/,
    "chat auth must canonical-parse signed nonces before session issuance",
  );
  assert.doesNotMatch(
    readFileSync("app/lib/chatAuth.ts", "utf8"),
    /Number\(values\.get\("chain id"\)|Number\.isInteger\(chainId\)/,
    "chat auth must not use broad Number() parsing for signed chain IDs",
  );
  assert.doesNotMatch(
    readFileSync("app/lib/chatAuth.ts", "utf8"),
    /\^\[a-f0-9\]\{32,128\}\$\/i|values\.get\("nonce"\) \?\? ""/,
    "chat auth must not accept case-insensitive or default-empty signed nonces",
  );
  assert.match(
    readFileSync("app/lib/chatAuth.ts", "utf8"),
    /export function getChatAuthProofTtlMs[\s\S]*parseCanonicalIssuedAtMs\(issuedAt\)[\s\S]*Number\.isSafeInteger\(now\)[\s\S]*remainingMs > 0 \? remainingMs : null/,
    "chat auth replay-lock TTL must use canonical issuedAt parsing",
  );
  assert.match(
    chatAuthRouteSource,
    /getChatAuthProofTtlMs\(fields\.issuedAt\)[\s\S]*ttlMs === null[\s\S]*Expired auth proof[\s\S]*consumeChatProof\(authAddress, fields\.nonce, fields\.uri, authSignature, ttlMs\)/,
    "chat auth route must fail closed before replay-lock consumption when issuedAt TTL is invalid",
  );
  assert.doesNotMatch(
    chatAuthRouteSource,
    /Date\.parse\(fields\.issuedAt\)|CHAT_AUTH_PROOF_TTL_MS - \(Date\.now\(\) - issuedAtMs\)/,
    "chat auth route must not recalculate replay-lock TTL with broad Date.parse",
  );
  assert.match(
    chatAuthRouteSource,
    /normalizeChatAuthAddress\(body\.authAddress\)/,
    "chat auth route must reuse the shared wallet address normalizer",
  );
  assert.match(
    chatAuthRouteSource,
    /isTrustedAuthUri\(fields\.uri, trustedOrigin, "\/chat"\)/,
    "chat auth route must bind signed messages to the exact chat URI path",
  );
  assert.doesNotMatch(
    chatAuthRouteSource,
    /new URL\(fields\.uri\)\.origin/,
    "chat auth route must not accept signed messages by origin-only URI comparison",
  );
  assert.match(
    chatAuthRouteSource,
    /requiresExternalSharedLock\(\)[\s\S]*acquireExternalExpiringLock/,
    "chat auth must use a shared replay lock when production runs more than one web replica",
  );
  assert.match(
    readFileSync("app/api/_lib/chatSession.ts", "utf8"),
    /normalizeChatAuthAddress/,
    "chat session cookies must store and validate normalized wallet addresses",
  );
  assert.match(
    readFileSync("app/api/chat/messages/route.ts", "utf8"),
    /normalizeChatAuthAddress\(body\.sender\)/,
    "chat message sends must normalize sender addresses before session comparison",
  );
  assert.match(
    readFileSync("app/api/chat/profile/route.ts", "utf8"),
    /normalizeChatAuthAddress/,
    "chat profile reads and writes must normalize wallet addresses before cache or session use",
  );
  assert.match(
    readFileSync("app/api/chat/profile/route.ts", "utf8"),
    /walletAddressesParam !== null && rawRequestedAddresses\.length === 0/,
    "chat profile batch reads must reject empty walletAddresses instead of falling through to list-all",
  );
  assert.match(
    readFileSync("app/api/chat/profile/route.ts", "utf8"),
    /const MAX_REQUESTED_PROFILE_WALLETS = 100;[\s\S]*?split\(",", MAX_REQUESTED_PROFILE_WALLETS \+ 1\)[\s\S]*?rawRequestedAddresses\.length > MAX_REQUESTED_PROFILE_WALLETS[\s\S]*?Too many walletAddresses/,
    "chat profile batch reads must reject over-limit walletAddresses before normalization instead of silently truncating",
  );
  assert.doesNotMatch(
    readFileSync("app/api/chat/profile/route.ts", "utf8"),
    /new Set\(normalizedRequestedAddresses\)\]\.slice\(0, MAX_REQUESTED_PROFILE_WALLETS\)/,
    "chat profile batch reads must not silently truncate over-limit normalized walletAddresses",
  );
  assert.match(
    readFileSync("app/api/chat/profile/route.ts", "utf8"),
    /walletAddress or walletAddresses is required/,
    "chat profile reads must require an explicit wallet scope instead of returning every stored profile",
  );
  assert.match(
    readFileSync("app/hooks/useChatProfile.ts", "utf8"),
    /normalizeChatAuthAddress\(walletAddress\)/,
    "chat profile hook must normalize wallet addresses before local cache and API use",
  );
  assert.doesNotMatch(
    readFileSync("app/hooks/useChatProfile.ts", "utf8"),
    /response\.text\(\)/,
    "chat profile save errors must use the bounded JSON response helper instead of raw response text",
  );
  assert.match(
    readFileSync("app/hooks/useChatProfile.ts", "utf8"),
    /const raw = localStorage\.getItem\(key\)[\s\S]*clearProfileKey\(key\)[\s\S]*const legacy = localStorage\.getItem\(LEGACY_STORAGE_KEY\)[\s\S]*JSON\.parse\(legacy\)[\s\S]*catch[\s\S]*clearProfileKey\(LEGACY_STORAGE_KEY\)[\s\S]*if \(!legacyRaw \|\| typeof legacyRaw !== "object"\)[\s\S]*clearProfileKey\(LEGACY_STORAGE_KEY\)/,
    "chat profile cache reads must clear corrupt or invalid current and legacy localStorage entries",
  );
  assert.match(
    readFileSync("app/hooks/useChat.ts", "utf8"),
    /normalizeChatAuthAddress\(walletAddress\)/,
    "chat send hook must normalize wallet addresses before optimistic or persisted messages",
  );
  assert.match(
    readFileSync("app/hooks/useChat.ts", "utf8"),
    /const raw = localStorage\.getItem\(CHAT_CACHE_KEY\)[\s\S]*localStorage\.removeItem\(CHAT_CACHE_KEY\)/,
    "chat message cache reads must clear corrupt or invalid localStorage entries",
  );
  const useChatOptimisticSource = readFileSync("app/hooks/useChat.ts", "utf8");
  assert.match(
    useChatOptimisticSource,
    /function createOptimisticMessageId[\s\S]*crypto\.randomUUID[\s\S]*crypto\.getRandomValues[\s\S]*Math\.random/,
    "chat optimistic local ids must prefer native crypto before legacy random fallback",
  );
  assert.match(
    useChatOptimisticSource,
    /id: createOptimisticMessageId\(now\)/,
    "chat send hook must use the centralized optimistic id helper",
  );
  assert.match(
    readFileSync("app/hooks/useChatWidgetRuntime.ts", "utf8"),
    /normalizeChatAuthAddress\(message\.sender\)/,
    "chat unread counters must normalize sender addresses before ownership comparison",
  );
  assert.match(
    readFileSync("app/components/chat/ChatWindow.tsx", "utf8"),
    /normalizeChatAuthAddress\(msg\.sender\)/,
    "chat message rows must normalize sender addresses before ownership styling",
  );
  assert.match(
    readFileSync("app/hooks/useRebate.ts", "utf8"),
    /getRebateCacheKey[\s\S]*getAddress\(address\)/,
    "rebate cache keys must normalize wallet addresses with the EVM address parser",
  );
  assert.match(
    readFileSync("app/hooks/useRebate.ts", "utf8"),
    /const cacheKey = getRebateCacheKey\(address\)[\s\S]*localStorage\.removeItem\(cacheKey\)[\s\S]*const cacheKey = getClaimPlanCacheKey\(address, epochs\)[\s\S]*localStorage\.removeItem\(cacheKey\)/,
    "rebate and claim-plan caches must clear corrupt or invalid localStorage entries",
  );
  assert.match(
    readFileSync("app/hooks/useRewardScanner.ts", "utf8"),
    /getRewardScanCacheKey[\s\S]*getAddress\(address\)/,
    "reward scan cache keys must normalize wallet addresses with the EVM address parser",
  );
  assert.match(
    readFileSync("app/hooks/useRewardScanner.ts", "utf8"),
    /const cacheKey = getRewardScanCacheKey\(address\)[\s\S]*let sourceKey = cacheKey[\s\S]*sourceKey = v1Key[\s\S]*localStorage\.removeItem\(sourceKey\)/,
    "reward scan cache reads must clear corrupt or invalid v2 and legacy cache entries",
  );
  assert.match(
    readFileSync("app/hooks/useDepositHistory.ts", "utf8"),
    /getDepositCacheKey[\s\S]*getAddress\(userAddress\)/,
    "deposit cache keys must normalize wallet addresses with the EVM address parser",
  );
  assert.match(
    readFileSync("app/hooks/useDepositHistory.ts", "utf8"),
    /function normalizeDepositUserAddress[\s\S]*getAddress\(userAddress\)\.toLowerCase\(\)/,
    "deposit history hook must normalize user addresses before cache and API use",
  );
  assert.match(
    readFileSync("app/hooks/useDepositHistory.ts", "utf8"),
    /const cacheKey = getDepositCacheKey\(userAddress\)[\s\S]*localStorage\.removeItem\(cacheKey\)/,
    "deposit history cache reads must clear corrupt or invalid localStorage entries",
  );
  assert.match(
    readFileSync("app/hooks/useAnalyticsAchievements.ts", "utf8"),
    /getAchievementStorageKey[\s\S]*getAddress\(walletAddress\)/,
    "achievement cache keys must normalize wallet addresses with the EVM address parser",
  );
  assert.match(
    readFileSync("app/api/rewards/route.ts", "utf8"),
    /getAddress\(typeof body\.user === "string" \? body\.user : ""\)\.toLowerCase\(\)/,
    "rewards route must normalize user addresses with the EVM address parser",
  );
  assert.match(
    readFileSync("app/api/_lib/rewardSummary.ts", "utf8"),
    /const normalizedUser = getAddress\(user\)\.toLowerCase\(\)/,
    "reward summary reads must normalize user addresses before cache and chain reads",
  );
  const headerWalletA11ySource = readFileSync("app/components/header/HeaderWalletCard.tsx", "utf8");
  assert.match(
    headerWalletA11ySource,
    /aria-label=\{embeddedAddressCopied \? "Privy wallet address copied" : "Copy Privy wallet address"\}/,
    "header wallet copy action must expose a stable accessible name",
  );
  assert.match(
    headerWalletA11ySource,
    /aria-label="Open Privy wallet address in explorer"/,
    "header wallet explorer icon link must expose a stable accessible name",
  );
  assert.match(
    headerWalletA11ySource,
    /target="_blank"[\s\S]{0,120}rel="noopener noreferrer"/,
    "header wallet explorer link must explicitly isolate new tabs",
  );
  const appNewTabIsolationIssues = [];
  const appWindowOpenIssues = [];
  for (const file of listSourceFiles("app")) {
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/<a\b[\s\S]*?>/g)) {
      const tag = match[0];
      if (!tag.includes('target="_blank"')) continue;
      const rel = tag.match(/\brel="([^"]*)"/)?.[1] ?? "";
      if (!/\bnoopener\b/.test(rel) || !/\bnoreferrer\b/.test(rel)) {
        appNewTabIsolationIssues.push(file);
      }
    }
    for (const match of source.matchAll(/window\.open\(([\s\S]*?)\);/g)) {
      const call = match[1];
      if (!call.includes('"_blank"')) continue;
      const features = call.match(/,\s*"([^"]*)"\s*\)?$/)?.[1] ?? "";
      if (!/\bnoopener\b/.test(features) || !/\bnoreferrer\b/.test(features)) {
        appWindowOpenIssues.push(file);
      }
    }
  }
  assert.deepEqual(
    [...new Set(appNewTabIsolationIssues)],
    [],
    "all app target=_blank links must explicitly use noopener noreferrer",
  );
  assert.deepEqual(
    [...new Set(appWindowOpenIssues)],
    [],
    "all app window.open(_blank) calls must explicitly use noopener and noreferrer",
  );
  const removedWalletExperimentMarker = "77" + "02";
  const removedWalletExperimentPatterns = [
    new RegExp(`\\bEIP-${removedWalletExperimentMarker}\\b`),
    new RegExp(`\\beip${removedWalletExperimentMarker}\\b`, "i"),
    new RegExp(`\\bWalletSettings${removedWalletExperimentMarker}\\b`),
    new RegExp(`\\b${removedWalletExperimentMarker}Delegate\\b`),
    new RegExp(`\\bpatch-privy-${removedWalletExperimentMarker}\\b`),
  ];
  const removedWalletExperimentIssues = [];
  const activeWalletExperimentSourceFiles = [
    ...listSourceFiles("app"),
    ...listSourceFiles("config"),
    ...listSourceFiles("contracts", /\.(?:sol|ts|mjs)$/),
    ...listSourceFiles("scripts"),
    ...listSourceFiles("docs", /\.(?:md|json|txt)$/).filter((file) => !file.startsWith(join("docs", "archive"))),
    "AGENTS.md",
    "README.md",
    "SECURITY.md",
    "package.json",
  ].filter((file) => file !== join("scripts", "test-business-logic.mjs"));
  for (const file of activeWalletExperimentSourceFiles) {
    const source = readFileSync(file, "utf8");
    if (removedWalletExperimentPatterns.some((pattern) => pattern.test(source))) {
      removedWalletExperimentIssues.push(file);
    }
  }
  assert.deepEqual(
    [...new Set(removedWalletExperimentIssues)],
    [],
    "active source, operator docs, and package metadata must not reintroduce the removed wallet experiment",
  );
  const walletSettingsOverviewSource = readFileSync("app/components/wallet/WalletSettingsOverviewPanel.tsx", "utf8");
  assert.match(
    walletSettingsOverviewSource,
    /role="switch"[\s\S]*aria-checked=\{animationEnabled\}[\s\S]*aria-label=\{animationEnabled \? "Disable animation effects" : "Enable animation effects"\}/,
    "wallet settings animation switch must expose a state-aware accessible name",
  );
  assert.match(
    walletSettingsOverviewSource,
    /connectedResolverClaimLabel[\s\S]*embeddedResolverClaimLabel[\s\S]*role="status"[\s\S]*aria-live="polite"[\s\S]*aria-label=\{connectedResolverClaimLabel\}[\s\S]*title=\{connectedResolverClaimLabel\}[\s\S]*aria-label=\{embeddedResolverClaimLabel\}[\s\S]*title=\{embeddedResolverClaimLabel\}/,
    "wallet settings resolver reward claims must expose state-aware labels and announce claim progress",
  );
  const stableChatWalletAddressSource = readFileSync("app/hooks/useStableChatWalletAddress.ts", "utf8");
  assert.match(
    stableChatWalletAddressSource,
    /getAddress\(address\)/,
    "stable chat wallet selection must normalize localStorage candidates with the EVM address parser",
  );
  assert.match(
    stableChatWalletAddressSource,
    /function clearStoredChatWalletAddress\(\)[\s\S]*window\.localStorage\.removeItem\(CHAT_WALLET_STORAGE_KEY\)[\s\S]*rawStored !== null[\s\S]*clearStoredChatWalletAddress\(\)/,
    "stable chat wallet selection must clear invalid or stale localStorage candidates",
  );
  assert.match(
    readFileSync("app/lib/chatSessionClient.ts", "utf8"),
    /normalizeChatAuthAddress/,
    "client chat session storage must normalize wallet addresses before keying localStorage",
  );
  const useChatAuthSource = readFileSync("app/hooks/useChatAuth.ts", "utf8");
  assert.match(
    useChatAuthSource,
    /normalizeChatAuthAddress\(walletAddress\)/,
    "chat auth hook must normalize wallet addresses before signing or session lookup",
  );
  assert.match(
    useChatAuthSource,
    /const normalizedWallet = normalizeChatAuthAddress\(walletAddress\);[\s\S]*if \(!normalizedWallet\) return false;/,
    "chat auth refresh must fail closed when wallet address normalization fails",
  );
  assert.match(
    useChatAuthSource,
    /readJsonResponse<\{ error\?: string \}>/,
    "chat auth API error parsing must use the bounded JSON response helper",
  );
  assert.doesNotMatch(
    useChatAuthSource,
    /response\.json\(\)/,
    "chat auth API error parsing must not use unbounded response.json",
  );
  assert.match(
    useChatAuthSource,
    /method: "personal_sign"/,
    "chat auth must request personal_sign from injected wallets",
  );
  assert.doesNotMatch(
    useChatAuthSource,
    /method: "eth_sign"/,
    "chat auth must not ask wallets for raw eth_sign fallback signatures",
  );

  const previousLocalStorage = globalThis.localStorage;
  try {
    const storage = new Map();
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, String(value)),
        removeItem: (key) => storage.delete(key),
      },
    });
    const validChatAddress = "0x1111111111111111111111111111111111111111";
    const chatKey = chatSessionClient.getChatAuthStorageKey(validChatAddress);
    assert.equal(chatSessionClient.normalizeChatAuthSessionExpiresAt("120000", 100_000), 120_000);
    assert.equal(chatSessionClient.normalizeChatAuthSessionExpiresAt(120_000, 100_000), 120_000);
    assert.equal(chatSessionClient.normalizeChatAuthSessionExpiresAt("00120000", 100_000), null);
    assert.equal(chatSessionClient.normalizeChatAuthSessionExpiresAt("1e5", 100_000), null);
    assert.equal(chatSessionClient.normalizeChatAuthSessionExpiresAt(120_000.5, 100_000), null);
    assert.equal(chatSessionClient.normalizeChatAuthSessionExpiresAt(Number.MAX_SAFE_INTEGER + 1, 100_000), null);
    assert.equal(chatSessionClient.normalizeChatAuthSessionExpiresAt(99_999, 100_000), null);
    assert.equal(
      chatSessionClient.normalizeChatAuthSessionExpiresAt(Date.now() + chatAuth.CHAT_AUTH_SESSION_TTL_MS + 120_000),
      null,
      "chat auth session expiry must reject implausibly far future timestamps",
    );
    const validStringExpiry = Date.now() + 60_000;
    storage.set(chatKey, JSON.stringify({ address: validChatAddress, expiresAt: String(validStringExpiry) }));
    assert.deepEqual(chatSessionClient.loadChatAuthSession(validChatAddress), {
      address: validChatAddress,
      expiresAt: validStringExpiry,
    });
    storage.set(chatKey, JSON.stringify({ address: validChatAddress, expiresAt: Date.now() - 1 }));
    assert.equal(chatSessionClient.loadChatAuthSession(validChatAddress), null);
    assert.equal(storage.has(chatKey), false, "expired chat auth session must be cleared from storage");
    storage.set(chatKey, JSON.stringify({ address: validChatAddress, expiresAt: Date.now() + chatAuth.CHAT_AUTH_SESSION_TTL_MS + 120_000 }));
    assert.equal(chatSessionClient.loadChatAuthSession(validChatAddress), null);
    assert.equal(storage.has(chatKey), false, "far-future chat auth session must be cleared from storage");
    storage.set(chatKey, JSON.stringify({ address: validChatAddress, expiresAt: Date.now() + 60_000.5 }));
    assert.equal(chatSessionClient.loadChatAuthSession(validChatAddress), null);
    assert.equal(storage.has(chatKey), false, "fractional chat auth session expiry must be cleared from storage");
    storage.set(chatKey, "{bad json");
    assert.equal(chatSessionClient.loadChatAuthSession(validChatAddress), null);
    assert.equal(storage.has(chatKey), false, "corrupt chat auth session must be cleared from storage");
    storage.set(chatKey, JSON.stringify({ address: "0x0000000000000000000000000000000000000002", expiresAt: Date.now() + 60_000 }));
    assert.equal(chatSessionClient.loadChatAuthSession(validChatAddress), null);
    assert.equal(storage.has(chatKey), false, "mismatched chat auth session must be cleared from storage");
    storage.set(chatKey, JSON.stringify({ address: validChatAddress }));
    assert.equal(chatSessionClient.loadChatAuthSession(validChatAddress), null);
    assert.equal(storage.has(chatKey), false, "invalid chat auth session shape must be cleared from storage");
    assert.equal(chatSessionClient.getChatAuthStorageKey("0xabc"), "");
    assert.equal(chatSessionClient.loadChatAuthSession("0xabc"), null);
  } finally {
    if (previousLocalStorage === undefined) {
      delete globalThis.localStorage;
    } else {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: previousLocalStorage,
      });
    }
  }

  const chatSessionClientSource = readFileSync("app/lib/chatSessionClient.ts", "utf8");
  assert.match(
    chatSessionClientSource,
    /function normalizeChatAuthSessionExpiresAt[\s\S]*Number\.isSafeInteger\(value\)[\s\S]*\/\^\(\?:0\|\[1-9\]\\d\{0,15\}\)\$\/[\s\S]*expiresAt - now > CHAT_AUTH_SESSION_TTL_MS \+ CHAT_AUTH_SESSION_MAX_FUTURE_SKEW_MS[\s\S]*const expiresAt = normalizeChatAuthSessionExpiresAt\(parsed\.expiresAt\)[\s\S]*const expiresAt = normalizeChatAuthSessionExpiresAt\(session\.expiresAt\)/,
    "client chat sessions must normalize expiry timestamps before restore or save",
  );
  assert.doesNotMatch(
    chatSessionClientSource,
    /typeof parsed\.expiresAt !== "number"[\s\S]*parsed\.expiresAt <= Date\.now\(\)|expiresAt:\s*parsed\.expiresAt/,
    "client chat session storage must not return to broad expiry acceptance",
  );
  assert.match(
    useChatAuthSource,
    /normalizeChatAuthSessionExpiresAt\(response\.headers\.get\("x-chat-session-expires-at"\)\)/,
    "chat auth hook must normalize server expiry headers before storing client sessions",
  );
  assert.doesNotMatch(
    useChatAuthSource,
    /Number\(response\.headers\.get\("x-chat-session-expires-at"\)/,
    "chat auth hook must not coerce server expiry headers with broad Number parsing",
  );

  assert.equal(indexerFinality.parseIndexerFinalityBlocks("12"), 12n);
  assert.equal(indexerFinality.parseIndexerFinalityBlocks("-1"), 0n);
  assert.equal(indexerFinality.parseIndexerFinalityBlocks("bad"), 0n);
  assert.equal(indexerFinality.getIndexerFinalityTargetBlock(100n, 12n), 88n);
  assert.equal(indexerFinality.getIndexerFinalityTargetBlock(100n, 0n), 100n);
  assert.equal(indexerFinality.getIndexerFinalityTargetBlock(5n, 12n), null);
  assert.equal(indexerFinality.getIndexerTargetLagBlocks(80n, 88n), 8);
  assert.equal(
    indexerFinality.getIndexerTargetLagBlocks(0n, BigInt(Number.MAX_SAFE_INTEGER) + 10n),
    Number.MAX_SAFE_INTEGER,
  );
  assert.equal(indexerFinality.getIndexerTargetLagBlocks(90n, 88n), 0);
  assert.equal(indexerFinality.getIndexerTargetLagBlocks(null, 88n), null);
  assert.equal(indexerFinality.getIndexerTargetLagBlocks(80n, null), null);
  assert.match(
    readFileSync("app/lib/indexerFinality.ts", "utf8"),
    /function bigintToNonNegativeSafeNumber[\s\S]*Number\.MAX_SAFE_INTEGER[\s\S]*return bigintToNonNegativeSafeNumber\(targetBlock - lastIndexedBlock\)/,
    "indexer finality target lag must saturate unsafe bigint deltas instead of broadly coercing them",
  );
  assert.match(
    readFileSync("scripts/audit-chain-indexer-window.mjs", "utf8"),
    /function regularFileStat\(filePath\)[\s\S]*statSync\(filePath\)[\s\S]*stats\.isFile\(\) \? stats : null[\s\S]*!dbPath \|\| !regularFileStat\(dbPath\)[\s\S]*LORE_DB_PATH must point to an existing indexer SQLite database file/,
    "chain-indexer audit must reject missing or directory DB paths through a shared regular-file stat boundary",
  );
  assert.equal(indexerFinality.hasMainnetIndexerFinality("12"), true);
  assert.equal(indexerFinality.hasMainnetIndexerFinality("0"), false);
  assert.equal(indexerFinality.hasMainnetIndexerFinality("bad"), false);
  assert.equal(indexerWatchPolicy.parseIndexerWatchFailureLimit("3"), 3);
  assert.equal(indexerWatchPolicy.parseIndexerWatchFailureLimit("0"), 5);
  assert.equal(indexerWatchPolicy.parseIndexerWatchFailureLimit("101"), 5);
  assert.deepEqual(indexerWatchPolicy.recordIndexerWatchFailure(0, 3), {
    failures: 1,
    shouldRestart: false,
  });
  assert.deepEqual(indexerWatchPolicy.recordIndexerWatchFailure(2, 3), {
    failures: 3,
    shouldRestart: true,
  });
  assert.deepEqual(indexerWatchPolicy.recordIndexerWatchFailure(2.5, 3), {
    failures: 1,
    shouldRestart: false,
  });
  assert.deepEqual(indexerWatchPolicy.recordIndexerWatchFailure(Number.NaN, 3), {
    failures: 1,
    shouldRestart: false,
  });
  assert.deepEqual(indexerWatchPolicy.recordIndexerWatchFailure(Number.MAX_SAFE_INTEGER + 1, 3), {
    failures: 1,
    shouldRestart: false,
  });
  assert.deepEqual(indexerWatchPolicy.recordIndexerWatchFailure(2, 2.5), {
    failures: 3,
    shouldRestart: false,
  });
  const indexerWatchPolicySource = readFileSync("app/lib/indexerWatchPolicy.ts", "utf8");
  assert.match(
    indexerWatchPolicySource,
    /function normalizeIndexerWatchFailureCount\(value: number\)[\s\S]*Number\.isSafeInteger\(value\)[\s\S]*function normalizeIndexerWatchFailureLimit\(value: number\)[\s\S]*Number\.isSafeInteger\(value\)[\s\S]*const limit = normalizeIndexerWatchFailureLimit\(failureLimit\)/,
    "indexer watch restart policy must reject malformed failure counters and limits before restart decisions",
  );
  assert.doesNotMatch(
    indexerWatchPolicySource,
    /Math\.trunc\(consecutiveFailures\)/,
    "indexer watch restart policy must not coerce malformed counters with Math.trunc",
  );
}
