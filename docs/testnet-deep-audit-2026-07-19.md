# LORE Testnet Deep Audit

Living evidence matrix for the current V9 source candidate. This is not a
mainnet sign-off. Items remain open until the stated runtime or product evidence
exists.

## Confirmed And Fixed

| ID | Area | Finding | Resolution | Evidence |
| --- | --- | --- | --- | --- |
| LORE-AUD-001 | Reward liabilities | Mature unclaimed winning rewards could only be settled one epoch and one token transfer at a time. | Added `settleEpochsDust`; it skips invalid entries, closes each mature liability before transfer, and makes one aggregate transfer. | `contracts/LineaOreV9.sol:199`, `contracts/LineaOreV9.sol:212`, contract invariants and exact compile proof |
| LORE-AUD-002 | Rebate liabilities | Rebate claims had no aggregate accounting or expiry settlement, so unclaimed balances could remain stranded forever. | Added aggregate claimed accounting, one-year expiry, single settlement, and batch settlement to the timelocked fee recipient. | `contracts/LineaOreV9.sol:192`, `contracts/LineaOreV9.sol:245`, `contracts/LineaOreV9.sol:256` |
| LORE-AUD-003 | RPC/API fallback | Historical `getEpochEndTime` always returns zero, but `/api/epochs` performed a second full multicall and exposed zero as a timestamp. | Removed the guaranteed-zero historical reads. Indexer timestamps remain authoritative; chain-only fallback leaves unknown time absent. | `contracts/LineaOreV9.sol:646`, `app/api/epochs/route.ts:192` |
| LORE-AUD-010 | Keeper funds | Emergency stuck-nonce cancellation derived its fee from 98% of the keeper balance, allowing an anomalous replacement path to consume almost all funded gas. | Added an unconditional 0.001 ETH maximum cancellation cost; lower balance headroom still applies. | `app/api/bootstrap-resolve/route.ts:27`, business-logic source invariant |
| LORE-AUD-012 | Canonical origin | Jackpot sharing used `playlore.xyz` while metadata and robots fell back to `lore.game` when the public-site env was absent. | Unified canonical and robots fallback origins on `https://playlore.xyz`; explicit deployment env still takes precedence. | `app/layout.tsx:37`, `app/robots.ts:3` |
| LORE-AUD-014 | Tiny rounded claims | A winning share could round to zero; single and mixed batch paths handled that edge differently and could close zero-value state. | Single claims reject zero before state changes; mixed batches skip zero-rounded entries without emitting misleading claim events. Reward scanners already omit zero-value candidates. | `contracts/LineaOreV9.sol:555`, contract invariants and exact compile proof |
| LORE-AUD-018 | Browser regression harness | The Leaderboards smoke waited for a data-dependent/viewport-animated section. It retried for about 32 seconds and emitted a misleading skip even though the tab itself was ready. | Navigation smoke now asserts the stable visible intro; data and empty states remain covered by their dedicated scenarios. | `scripts/smoke-browser.mjs:395` |
| LORE-AUD-019 | Annual settlement evidence | Reward/rebate dust events existed in the ABI but were discarded by the operational indexer. | The indexer now persists per-epoch reward/rebate dust settlements and the chain-to-indexer audit verifies kind, epoch, and amount. | `scripts/indexer.ts`, `scripts/audit-chain-indexer-window.mjs`, contract invariants |
| LORE-AUD-020 | Ambiguous Privy send | A silent send timeout correctly avoided automatic retry, but without a returned hash the manual form could unlock and a second click could submit another bet. | Silent bets now reserve the pending nonce and persist a hashless pending record on ambiguous sends. Recovery fails closed until latest/pending chain nonce proves completion or the existing 15-minute not-found grace expires. | `app/lib/miningTxPath.ts`, `app/hooks/useMiningStandardBetPath.ts`, business-logic tests |
| LORE-AUD-021 | Batch bet gas | `_recordBet` rewrote `userEpochVolumes` and `epochs.totalPool` once per selected tile even though both values are transaction aggregates. | All four bet entrypoints now update the two aggregate slots exactly once per transaction; per-tile pool, user bet, and unique-user accounting is unchanged. A 25-tile batch avoids 48 redundant aggregate SSTORE updates. | `contracts/LineaOreV9.sol`, contract invariants and exact compile proof |
| LORE-AUD-022 | Indexer event persistence | Batch claims and resolver rewards rewrote a growing JSON metadata object per chunk, while the new dust path was unsupported and would throw on its first event. | Added one scoped normalized event table with idempotent row upserts for batch claims, resolver rewards, and dust settlements. Legacy JSON remains readable; scope audit, restore proof, and indexer dry-run know the new table. | `server/db.ts`, `server/storage.ts`, `scripts/test-indexer-event-storage.ts`, DB operation tests |
| LORE-AUD-023 | Jackpot indexing | Jackpot award events are emitted before `EpochResolved`; the indexer could then create the epoch row with both jackpot flags false. | Event processing now records awarded epoch IDs and applies them when the resolved row is created, independent of log order. | `scripts/indexer.ts`, contract/indexer invariant test |
| LORE-AUD-024 | Ambiguous claim sends | Reward and rebate batch fallback treated every send exception as a deterministic failure. A wallet timeout after submission could split and resend already accepted claims. | Wallet-send timeouts are classified as ambiguous; reward, deep-reward, and Safety Pool flows stop fallback/resubmission and tell the user to check activity before retrying. Resolver claims use the same status wording. | `app/hooks/useMining.shared.ts`, claim hooks, business-logic tests |
| LORE-AUD-027 | Deep reward discovery | Deep Reward Scan swept every protocol epoch and derived its account from the external wagmi connection even though gameplay uses the embedded Privy wallet. | Added a rate-limited cursor API over distinct indexed participation epochs. Deep scan now verifies only those candidates on-chain and prefers the embedded Privy address. | `app/api/claim-candidates/route.ts`, `server/storage.ts`, `app/hooks/useDeepRewardScan.ts`, SQLite pagination test |

## Open Findings And Decisions

| ID | Severity | Area | Finding | Required decision or verification |
| --- | --- | --- | --- | --- |
| LORE-AUD-004 | High | Randomness/resolve | The resolver can choose the transaction block after epoch close; `prevrandao`, previous block hash, pools, and timing are public inputs. This preserves the known timing-selection risk. | Keep as explicitly accepted risk or approve a randomness redesign. Do not describe outcomes as externally verifiable randomness while this remains. |
| LORE-AUD-005 | Medium | Resolver liabilities | `pendingResolverRewards[address]` is an aggregate, permanent liability. Rewards belonging to lost or abandoned resolver addresses cannot be expired or recovered safely because accrual timestamps are not retained. | Decide whether resolver rewards must remain perpetual. Expiry requires new per-accrual or checkpoint accounting and would add resolve/claim cost. |
| LORE-AUD-006 | Fixed | Reward UX/RPC | Reward scanners checked resolved, claimed, and dust-settled state but not `epochResolvedAt`, so an expired reward could still appear claimable before dust settlement. | Automatic and deep scans now read `epochResolvedAt` only for winning candidates and cached wins, compare against the latest chain timestamp, and omit zero-value rounded claims. The 5,000-epoch base scan did not gain another full read pass. |
| LORE-AUD-007 | Product | Safety Pool | A player with any stake on the winning tile receives no rebate, including when most of that player's volume lost on other tiles. This is coherent for a pure-loser pool but must be explicitly described. | Confirm the intended rule and align White Paper/UI copy. Changing it alters tokenomics and claim amounts. |
| LORE-AUD-008 | Fixed | Resolve liveness | Earlier designs coupled periodic protocol-fee delivery to resolve, so a token-transfer failure could have blocked epoch progression. | V10 accrues owner and burn fees during resolve and leaves delivery to the explicit permissionless `flushProtocolFees()` path. Resolve no longer performs the fee-recipient/burn transfers. |
| LORE-AUD-009 | Low | Operator gas | Settlement arrays are caller-bounded rather than contract-capped. Oversized arrays can run out of gas but cannot harm other users or redirect funds. | Operator tooling should estimate gas and chunk mature epochs, initially 50-100 per transaction. |
| LORE-AUD-011 | High | Safety Pool fairness | Rebate eligibility is address-based: any winning-tile stake makes the wallet ineligible for its entire losing volume. Splitting the same multi-tile strategy across wallets preserves rebates on losing wallets, creating a direct sybil advantage over ordinary single-wallet users. | Recommended sybil-neutral formula is `(userVolume - userWinningTileBet) / totalLosingVolume`. This changes player payouts and requires explicit tokenomics approval before implementation. |
| LORE-AUD-013 | High | Late bet semantics | Every bet entrypoint calls `_autoResolveIfNeeded()` before validating the betting window. A transaction signed for epoch N but mined after its deadline can resolve N and place the stake into N+1 without an on-chain expected-epoch guard. | Prefer new epoch-bound entrypoints that accept `expectedEpoch` and revert on mismatch. Preserve old selectors only as an explicitly documented compatibility path if required. This is an ABI and UX decision, not a silent patch. |
| LORE-AUD-015 | Medium | Contract verification depth | Current contract checks compile exact bytecode and exercise source/model invariants, but they do not execute V9 bytecode against a local EVM. Reentrancy, revert rollback, event order, duplicate arrays, zero rounding, and the 120th-epoch flush boundary therefore lack direct execution proof. | Add a small local-EVM contract suite before deployment; cover every external mutating method and token failure mode without broad framework churn. |
| LORE-AUD-016 | Fixed | Product truth | White Paper still promised `Claim Anytime`, described fees as applying to the rollover-inclusive pool, and FAQ omitted the one-year settlement route and claimed a fixed one-second polling rate. | Copy now matches contract accounting: one-year claims, fees only on fresh stake, full rollover preservation, bounded settlement destination, and differentiated refresh intervals. |
| LORE-AUD-017 | Fixed | Tokenomics disclosure | Public copy described the 2% protocol fee as 1% treasury plus 1% Safety Pool, but the contract first pays a 0.05% resolver reward and splits the remaining 1.95% approximately equally. | White Paper and FAQ now disclose 0.05% resolver plus approximately 0.975% treasury and 0.975% Safety Pool, subject to integer rounding. |
| LORE-AUD-025 | Fixed | Claim discovery | Deep Reward Scan covers indexed participation history without sweeping every protocol epoch, and Safety Pool now exposes an explicit bounded load-older flow over indexed participation pages. | Keep this on-demand only; do not turn older Safety Pool history into frequent background polling or an unbounded request. |
| LORE-AUD-026 | Low | Rebate summary input | `getRebateSummary` counts duplicate epoch IDs more than once because it is a stateless view over caller input. Current server candidates are SQL `DISTINCT`, but other integrators can display an inflated preview if they pass duplicates. | Keep all callers deduplicated and document the input requirement; changing the view to dedupe arbitrary unsorted arrays would add quadratic work or require a new sorted-input contract. Claims themselves remain replay-safe. |
| LORE-AUD-028 | Medium | Bootstrap resolver operations | A secret-protected bootstrap resolver may automatically replace a stuck keeper nonce with one zero-value self-transfer. The path is bounded by a 21,000-gas limit, balance headroom, and a hard native-token cost ceiling, but it still spends keeper funds without a per-action operator confirmation. | Decide whether production keeps this liveness-first policy or requires an explicit runtime opt-in before automatic cancellation. Do not change it silently: either option affects operational recovery semantics, not player funds or tokenomics. |

## External Mutation Matrix

| Path | State and transfer order | Duplicate/replay behavior | Residual risk |
| --- | --- | --- | --- |
| `placeBet` and three batch variants | Validate window/input, pull one aggregate token amount, then record pool/user state; a revert rolls the transfer back. | Repeated transactions are intentional additional bets; frontend nonce/pending guards must prevent accidental resends. | Late-mined transactions can target the next epoch because selectors do not bind `expectedEpoch` (AUD-013). Fee-on-transfer tokens are unsupported. |
| `resolveEpoch` / auto-resolve | Resolve state, accrue liabilities, and advance epoch; protocol fees remain accrued until an explicit `flushProtocolFees()` call. | Only current unresolved epoch can resolve. Fee delivery no longer blocks resolve. | Known timing-selectable randomness (AUD-004). |
| Single/batch reward claim | Validate eligibility/deadline, close claim state and aggregate liability, then make one transfer. | Claimed and duplicate batch epochs cannot pay twice; zero-only claims revert. Ambiguous wallet sends no longer trigger split retries. | Requires final signed-wallet evidence on the deployment target. |
| Single/batch rebate claim | Shared preview/consume closes user state and aggregate liability before one transfer. | Duplicate epochs skip after the first consume. Ambiguous wallet sends no longer trigger fallback retries. | Address-based eligibility is sybil-asymmetric (AUD-011); final signed-wallet evidence remains deployment-target work. |
| Single/batch reward dust | One-year boundary, close epoch liability, then transfer once to the timelocked fee recipient. | Duplicate or already-settled epochs skip; a zero-dust mature epoch can still be closed. | Caller must chunk arrays (AUD-009); settlement evidence is indexed and chain-audited. |
| Single/batch rebate dust | One-year boundary, set aggregate claimed amount to the pool, then transfer once to the timelocked fee recipient. | Duplicate/already-empty entries cannot transfer twice. | Zero-pool epochs remain implicit no-liability entries rather than separately marked closed; settlement evidence is indexed and chain-audited. |
| Resolver reward claim | Zero caller liability before transfer. | A second claim sees zero and reverts. | Aggregate liabilities have no safe expiry (AUD-005). |
| Protocol fee flush | Apply matured recipient change, zero owner/burn accruals, then transfer; revert restores all state. | A successful repeat sees nothing to flush. | Token freeze/blacklist/insolvency can block the 120th resolve (AUD-008). |
| Timelocked admin updates | Schedule/cancel explicitly; duration applies only after both ETA and epoch boundary; recipient changes after ETA. | Re-scheduling replaces the pending proposal and restarts its ETA. | Owner key operations still require deployment runbook and live timelock drills. |

## Token Flow Invariant

For a non-empty epoch, fees are calculated only from fresh stake. Rollover is
not charged again. The configured fresh-stake split is:

- 2% daily jackpot reserve;
- 3% weekly jackpot reserve;
- 2% protocol fee, including the resolver reward and Safety Pool/owner split;
- 1% sent to the burn address;
- the remaining 92% plus rollover becomes the base winning reward.

Jackpots return their reserves through later winning reward pools. Protocol
fee after the 0.05% resolver reward is split approximately equally between the
Safety Pool and fee recipient, with integer rounding assigned to the recipient
side. Existing conservation fuzz checks cover the fee split and rollover.

## Remaining Audit Matrix

- Contract: jackpot boundary dates, tiny-value rounding, fee flush boundary,
  duplicate batch entries, exact one-year boundaries, ownership transition,
  and all reserve-to-balance conservation checks.
- Web3: ABI/indexer event parity, stale contract feature flags, nonce and pending
  recovery, duplicate sends, rejected/reverted/expired claims, and explorer URLs.
- Server: every mutable route's auth, origin/CSRF assumptions, bounded input,
  rate limits, cache isolation, log redaction, and SQLite concurrency/recovery.
- Frontend: hook order, persistent-state validation, wallet reconnect, stale
  claim caches, clear transaction states, mobile overlays, rerender/polling cost,
  and empty/degraded states.
- Product: effective expected return, jackpot communication, Safety Pool
  eligibility wording, achievement attainability, first-bet friction, and
  responsible-play disclosures.
