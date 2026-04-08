# LORE — Pre-Mainnet Audit Report

**Date:** 2026-04-07
**Scope:** `LineaOreV7.sol`, `LineaOre7702Delegate.sol`, frontend (Next.js App Router), API routes, hooks, config.
**Commit:** current working tree.

---

## 1. Smart Contracts

### 1.1 `LineaOreV7.sol` — verdict: ready for mainnet with caveats

**Strengths:**
- `Ownable2Step` — safe 2-step ownership transfer.
- `renounceOwnership()` explicitly disabled — cannot be bricked.
- `ReentrancyGuard` on every external state-changing function (`placeBet`, `placeBatchBets`, `placeBatchBetsSameAmount`, `resolveEpoch`, `claimReward`, `claimRewards`, `claimResolverRewards`, `claimEpochRebate`, `claimEpochsRebate`, `flushProtocolFees`, `settleEpochDust`).
- CEI (checks-effects-interactions) respected: state updates before `safeTransfer` in all claim paths.
- `SafeERC20` wrappers on every token transfer.
- Timelocks: `EPOCH_DURATION_TIMELOCK = 30 min`, `FEE_RECIPIENT_TIMELOCK = 24 h`.
- Back-run protection: `_autoResolveIfNeeded` increments `currentEpoch` BEFORE `_recordBet`, so a resolver-bettor cannot land a bet in the epoch they are resolving.
- Division truncation in reward/rebate math under-claims (sum of claims ≤ pool) — dust settled after 365 days via `settleEpochDust`.
- Resolver reward capped: `if (resolverReward > L.protocolFee) resolverReward = L.protocolFee`.
- Jackpot probability model is a sound Poisson-like decay: over a full day/week, P(trigger) → 1.
- Zero-address checks in constructor for token/owner/feeRecipient.
- Solidity 0.8.20: built-in overflow checks; `unchecked` limited to loop increments.

**Medium findings:**

**M1 — Randomness is miner/validator-influenceable.**
`_resolveCurrentEpoch` derives `winningTile` from `block.prevrandao + blockhash(block.number-1) + epoch + pools`. A Linea sequencer (or a validator in a proof-of-stake fork) can in principle bias the outcome by choosing whether to include a resolve tx in a given block. For the stake sizes expected in LORE, this is the standard "good enough" randomness used by most on-chain lotteries. Document this in the FAQ or whitepaper so users understand the trust model. If you want full fairness, migrate to Chainlink VRF or a commit-reveal scheme.

**M2 — `EPOCH_DURATION_TIMELOCK = 30 minutes` is short for mainnet.**
30 min is fine during ops but gives users very little notice before epoch timing shifts. Consider bumping to 24 h or 48 h before mainnet. The change only applies from `currentEpoch + 1` so it is already forward-only, but the timelock window is the only thing protecting users who have open bets when the change is scheduled.

**M3 — Rollover pool can be milked on empty epochs.**
If `resolveEpoch` is called on an epoch with `totalPool == 0` but `rolloverPool > 0`, `_splitFees` still takes 8% from the rollover (2% daily jackpot, 3% weekly, 2% protocol, 1% burn) before rolling the remainder forward. In practice the client now avoids auto-resolving empty epochs and `_autoResolveIfNeeded` is only triggered by a new bet (which always has `totalPool > 0`), so the leak is naturally bounded. Low practical risk. Optional hardening: skip fee extraction when `ep.totalPool == 0`.

**Low findings:**

**L1 — Fee-on-transfer tokens not supported.**
`placeBet` assumes `safeTransferFrom(user, this, amount)` moves exactly `amount`. LINEA is a standard ERC-20 with no FoT, so this is fine, but it should be documented as a contract assumption to prevent accidental re-deployment with a tax token.

**L2 — Dust from integer division.**
Bounded per-epoch (< 100 wei from the 2/3/2/1% splits; token is 18-decimal). Non-issue in practice.

**L3 — `resolveEpoch` permissionless — gas race.**
Multiple users can race to call `resolveEpoch` for the 5 bps resolver reward. Losers pay gas for a reverting tx. Mitigated by `_autoResolveIfNeeded` folding the resolve into the first bet of the next epoch, so a standalone `resolveEpoch` is only called when no one bets for a full epoch.

**L4 — `claimResolverRewards` has no upper bound.**
Not a problem (limited by the token held), but a very long-running keeper could accumulate a large resolver balance. Operational note only.

### 1.2 `LineaOre7702Delegate.sol` — verdict: ready

- `onlyDelegatedSelf` modifier (`msg.sender == address(this)`) enforces that only an EIP-7702-delegated EOA can invoke these functions. Prevents arbitrary calls from third parties.
- No arbitrary `target.call(...)` exposure — only hardcoded game function signatures (`placeBatchBetsSameAmount`, `claimRewards`, `claimEpochsRebate`, `resolveEpoch`, `claimResolverRewards`).
- `forceApprove` used for approvals — safe for USDT-style non-zero approval reverts.
- Reverts bubble up via inline assembly, preserving custom errors from the game contract.
- Zero-address checks on all passed-in addresses.
- No state → no storage collision risk with the delegated EOA.

**Recommendation:** consider whitelisting the exact game contract address at deploy time (hardcode the immutable `GAME` address in the delegate) instead of passing `address game` per call. This prevents a phished user from delegating to a malicious game address. Trade-off: loses upgradeability.

---

## 2. Economics — formulas verified against contract

Per-epoch settlement (on resolve), `pool = epoch.totalPool + rolloverPool`:

| Slice | Source | Formula |
| --- | --- | --- |
| Daily jackpot accrual | `DAILY_JACKPOT_PERCENT = 2` | `pool * 2 / 100` |
| Weekly jackpot accrual | `WEEKLY_JACKPOT_PERCENT = 3` | `pool * 3 / 100` |
| Protocol fee | `PROTOCOL_FEE_PERCENT = 2` | `pool * 2 / 100` |
| Burn | `BURN_FEE_PERCENT = 1` | `pool * 1 / 100` |
| Resolver reward | `RESOLVER_REWARD_BPS = 5` | `pool * 5 / 10_000 = 0.05%` (taken OUT of protocol fee) |
| **Base reward pool** | — | `pool * 92 / 100` |

Protocol fee is then split 50/50:
- `ownerShare = (protocolFee - resolverReward) / 2` → `accruedOwnerFees`
- `rebateShare = (protocolFee - resolverReward) / 2` → `epochRebatePool[epoch]`

Per-user rebate: `rebatePool * userVolume / totalPool`.
Per-user reward: `rewardPool * userBetOnWinningTile / tilePoolOfWinningTile`.

If there is no winner on the resolved tile, `baseReward → rolloverPool` and jackpot/protocol/burn slices are still taken from the rollover (see M3).

All formulas match the whitepaper comment block at the top of the contract.

---

## 3. Frontend / API / Config

### 3.1 Fixes applied in this audit session

**Accessibility & contrast (WCAG AA on dark background):**
- Bulk replace of `text-gray-600 → text-gray-400` and `text-gray-700 → text-gray-500` in 14 components (AnalyticsDepositsPanel, AnalyticsJackpotHistoryPanel, AnalyticsBlockchainHistoryPanel, BetPanel, FAQ, Leaderboards, MaintenanceOverlay, RebatePanel, RewardScanner, Sidebar, WalletSettings*, WhitePaper, WinsTicker, MiningGrid, LoreIntro).
- `HubBalanceWarning` — added `aria-label="Dismiss warning"` + `type="button"` on the close icon.
- `UiButton` focus-visible ring strengthened (`tokens.ts`).
- `UiButton` — added `touch-manipulation select-none` (removes iOS 300ms tap delay + prevents accidental text selection on long-press).

**Empty states:**
- `AnalyticsBlockchainHistoryPanel` — added proper empty state when `historyViewData.length === 0 && !loading`.

**Error boundaries (Next.js App Router):**
- Added `app/error.tsx` — route-level boundary with Try-again / Hard-reload, logs via the existing `log.error` pipeline.
- Added `app/global-error.tsx` — fatal fallback for root-layout crashes, inline styles so it does not depend on Tailwind.
- Added `app/not-found.tsx` — themed 404.
- Existing `ErrorCatcher` continues to handle `window.error` / `unhandledrejection` + chunk-reload recovery. Defence-in-depth stack is now complete: component → route boundary → global boundary → window listener.

**Resolve / betting logic (previous iteration):**
- Removed `bettingLocked` dependency on `isAnalyzing` in `useMiningGuards.ts` / `useManualBetForm.ts` / `useAutoMinerForm.ts` / `BetPanel.tsx`. Users can now place bets during the reveal animation — the bet automatically lands in the next epoch because the contract auto-resolves on first bet.
- `useGameEpochPresentation.ts` — safety timeout reduced 30 s → 8 s.
- Client wallet auto-resolve disabled — this is what was spawning the stray 0x5485… resolve transactions.

**RPC resilience:**
- `app/api/admin/check-owner/route.ts` was using a single-node `createPublicClient`. Replaced with the shared `publicClient` from `dataBridge.ts` which already uses viem `fallback()` across all `SERVER_RPC_URLS`.

**SEO / indexing:**
- Added `app/robots.ts`: disallows `/api/`, `/admin`, `/dev`, `/jackpot-win`; fully disallows all agents when not in production or when `NEXT_PUBLIC_MAINTENANCE_MODE=1`.

### 3.2 Items verified — no change needed

**Race conditions in hooks:** `useDepositHistory`, `useLeaderboards`, `useJackpotHistory`, `useAddressNames`, `useChatAuth`, `useRebate`, `useMiningLifecycle` all use `mountedRef` + `requestIdRef` (or equivalent `cancelled` flags) to prevent stale-response setState. Clean.

**API route hygiene:** every public route (`deposits`, `rewards`, `epochs`, `rebates`, `leaderboards`, `live-state`, `jackpots`, `recent-wins`, `bootstrap-resolve`) and chat route (`auth`, `messages`, `profile`) calls `enforceSharedRateLimit` with a per-bucket limit. Input validation on all address/epoch parameters (regex `^0x[0-9a-f]{40}$`, `Number.isInteger && > 0`, `MAX_EPOCHS_PER_REQUEST = 400`). Clean.

**Secret handling:** `KEEPER_PRIVATE_KEY`, `CHAT_AUTH_SECRET`, `HEALTH_DIAGNOSTICS_SECRET`, `BOOTSTRAP_KEEPER_PRIVATE_KEY` are all referenced only from server-side files (`app/api/...`, `bot.ts`, `server/...`). None are leaked to the client bundle. Clean.

**Production env gating:** `config/publicConfig.ts` throws `${envName} is required when LINEA_NETWORK=mainnet` for `CONTRACT_ADDRESS`, `DEPLOY_BLOCK`, `LINEA_TOKEN_ADDRESS`. Mainnet cannot accidentally run with Sepolia defaults.

**Tap targets:** `MobileTabNav` already has `min-h-[44px]` per WCAG mobile guidelines.

### 3.3 Recommended before mainnet (not yet done)

1. **Bump `EPOCH_DURATION_TIMELOCK` to 24 h** (M2 above). Requires contract change — must happen before deploy.
2. **Consider hardcoding `GAME` address in the 7702 delegate.** Requires contract change.
3. **Add `HEALTH_DIAGNOSTICS_SECRET` and `CHAT_AUTH_SECRET`** as long random strings (32+ bytes) in production env — not optional, production should fail fast without them.
4. **Wire up Telegram keeper alerts** (`ALERT_TELEGRAM_BOT_TOKEN`, `ALERT_TELEGRAM_CHAT_ID`) — already supported in env schema, just needs to be set.
5. **Decide on `NEXT_PUBLIC_ENABLE_CLIENT_AUTO_RESOLVE=0`** (recommended off on mainnet to avoid browser-side gas burn). Current default is already 0.
6. **Set `CHAT_AUTH_SECRET` to a 256-bit random value** — the dev fallback logs a console warning and must not reach production.
7. **Run a testnet dry-run** with the mainnet env file against the Sepolia contract to validate env wiring end-to-end before flipping `LINEA_NETWORK=mainnet`.
8. **Static contract re-audit** by a third party (Zellic, Spearbit, Cantina) given the TVL this will custody — recommended regardless of the above findings.
9. **Bug bounty** (Immunefi or Cantina Code) with at least 10% of TVL as the high-severity payout.

### 3.4 Verification

- `npx tsc --noEmit` — 0 errors.
- `npx eslint app/**/*.{ts,tsx}` across all touched files — 0 errors, 0 warnings.
- No game-logic, contract interaction, or resolve-flow code was modified during the UX passes. Only presentation, error-handling, and RPC plumbing.

---

## 4. Summary

**Safe to proceed to mainnet** subject to:
- Contract tweaks M2 and (optional) the 7702-delegate hardcode — both require redeploy.
- Production env checklist in §3.3.
- A third-party audit pass is strongly recommended for this TVL class.

The frontend, API, and config layers are in good shape. Error boundaries and RPC fallbacks are in place. Rate limits and input validation are applied consistently. The key randomness caveat (M1) is inherent to on-chain RNG without VRF and should be documented to users rather than fixed in contract.
