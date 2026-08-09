# LineaOreV10 Design And Deployment Gate

Status: deployed testnet candidate with bounded mined-receipt evidence. Local
V10 compiler provenance is reproducible and manifest-matched. Final mainnet
readiness still requires fresh external deployed-bytecode, env, owner, canary,
indexer, wallet, host, monitoring, and QA evidence.

## Reviewer Snapshot

| Dimension | Decision and current evidence |
| --- | --- |
| Protocol economics | V9 fee, jackpot, resolver, rebate, rollover, reward, and dust formulas are preserved. Fee delivery timing is the only policy change: accrual remains in resolve and transfer moves to explicit permissionless flush. |
| User hot path | Exact canonical Linea state-override A/B makes every one of the 28 comparable V10 runtime paths cheaper than V9. Single-tile and 3/5/25-tile bitmap bets improve about 20%, 25%, 28%, and 32%. |
| Safety model | Non-upgradeable immutable-token contract, two-step ownership, timelocked configuration, no owner withdrawal/pause/rescue, transient reentrancy protection, checks-effects-interactions, and atomic token-transfer rollback. |
| Compatibility | All 138 required V9 ABI items remain. The protected epoch-bound bitmap selector is additive. Unique-player counts intentionally become event/indexer-derived; the compatibility getter remains but returns zero on chain. |
| Reproducibility | Exact compiler/import/settings/source/ABI/creation/runtime hashes are pinned. The canonical profile is Solidity 0.8.36, optimizer 200, no IR, Osaka, OpenZeppelin 5.6.1. |
| Current proof boundary | Local properties, manifest-matched compiler provenance, offline deployed-verifier readiness, exact read-only Linea execution, bounded mined gas, fresh-indexer reconciliation, and local production-build API/UI smoke pass. Fresh external deployed-bytecode, claim/flush/failure canaries, HTTPS wallet recovery, host, monitoring, wallet QA, and long-soak evidence remain open. |

### Requested reviewer focus

1. Validate the unchanged V9 randomness/resolver timing threat separately from
   the V10 storage and gas changes; it is deliberately not presented as VRF.
2. Review packed-word masks and bounds together with their compatibility
   getters, especially epoch clock, resolution metadata, jackpot metadata, and
   per-user claim flags.
3. Reconcile every fee/reward/rebate/resolver/jackpot/dust allocation against
   the conservation ledger and one-year settlement boundaries.
4. Confirm that all external token interactions remain atomic under false
   returns, reverts, and callbacks, while a failed explicit fee flush cannot
   block epoch resolution.
5. Treat legacy epoch-unbound bet selectors and event-derived player counts as
   explicit compatibility tradeoffs, not accidental omissions.

## Contract Boundary

V10 deliberately preserves the V9 game model:

- identical fee, jackpot, resolver reward, rebate, rollover, and dust constants;
- identical winning-tile entropy inputs and jackpot timing/probability logic;
- identical public function/event/error selectors required by V9 clients;
- identical non-upgradeable ownership model, two-step ownership transfer, and
  timelocked epoch-duration/fee-recipient changes;
- no permit, randomness, or tokenomics change.

V10 changes only storage and execution mechanics:

- OpenZeppelin `ReentrancyGuardTransient` replaces the persistent guard;
- epoch duration/current epoch/start time share one checked storage word;
- resolution timestamp, winning tile, jackpot flags, and reward-dust flag share
  one checked epoch metadata word;
- daily and weekly jackpot check timestamps share one storage word and are
  committed together when both probability windows advance;
- each user's epoch volume plus reward- and rebate-claimed flags share one
  checked storage word; the compatibility getters mask/unmask the packed value;
- per-tile unique-player counts are reconstructed from canonical bet events,
  removing one non-financial storage write for every user's first bet on a tile;
- bitmap popcount is constant-time instead of a per-bit loop;
- bet entrypoints cache one prepared epoch and never re-read it after token
  interaction, and reject malformed targets before epoch or token work;
- `placeBatchBetsBitmapForEpoch` binds every public-UI bet to the epoch the
  caller observed. Active epochs receive the bet directly; an expired empty
  epoch advances exactly once and receives the bet in the next epoch. Stale,
  closing, and expired funded epochs reject before the stake transfer, so an
  ambiguous transaction cannot move funds across a contested boundary. All V9
  selectors remain available for ABI compatibility;
- all proportional fee/reward/rebate calculations use OpenZeppelin
  `Math.mulDiv`, preserving floor rounding without intermediate overflow;
- owner and burn allocations accrue during resolve, but their token transfers
  no longer run automatically inside every 120th resolution. The existing
  permissionless `flushProtocolFees()` remains the only delivery path, so
  allocation and tokenomics stay unchanged while epoch progress no longer
  depends on non-critical fee transfers;
- the source pins Solidity 0.8.36 exactly, rejects zero/self owner and
  fee-recipient configurations, and rejects token addresses without deployed
  code.

Financial amounts remain full-width `uint256`. The packed clock horizons are far
beyond practical protocol lifetime (`uint32` seconds, `uint96` epochs,
`uint128` Unix time), and explicit overflow guards fail closed.

### Packed storage map

| Word | Bit range | Value |
| --- | --- | --- |
| `_epochClockData` | `0..31` | Epoch duration (`uint32`). |
| `_epochClockData` | `32..127` | Current epoch (`uint96`). |
| `_epochClockData` | `128..255` | Epoch start timestamp (`uint128`). |
| `Epoch.resolutionData` | `0..127` | Resolution timestamp (`uint128`); zero means unresolved. |
| `Epoch.resolutionData` | `128..135` | Winning tile (`uint8`). |
| `Epoch.resolutionData` | `136`, `137`, `138` | Daily award, weekly award, and reward-dust-settled flags. |
| `_jackpotCheckTimestamps` | `0..127`, `128..255` | Last daily and weekly probability-check timestamps. |
| `_lastDailyJackpotData` / `_lastWeeklyJackpotData` | `0..127`, `128..223` | Award period identifier and award epoch (`uint96`); upper 32 bits remain unused. |
| `_userEpochRebateData[epoch][user]` | `0..253`, `254`, `255` | Full user epoch volume plus reward-claimed and rebate-claimed flags. |

The invariant suite round-trips every packed boundary, preserves the public
compatibility getters, and requires explicit overflow reverts rather than
truncation.

### Epoch state machine

| Observed state | Protected epoch-bound bitmap selector | Legacy V9-compatible selectors | `resolveEpoch` |
| --- | --- | --- | --- |
| Active, outside the two-second guard | Accepts only when `expectedEpoch` equals current epoch. | Accepts against current epoch. | Reverts `TimerNotEnded`. |
| Closing guard | Reverts `EpochClosing` before token transfer. | Reverts `EpochClosing` before token transfer. | Still reverts `TimerNotEnded`. |
| Expired and empty | Atomically resolves exactly one empty epoch, then records the bet in the next epoch. | Resolves the empty epoch and records the bet in the next epoch. | Resolves, but spends keeper gas without a resolver reward. |
| Expired and funded | Reverts `EpochClosing`; a separate resolver must close the epoch. | Resolves the funded epoch, accrues the resolver reward to the caller, then records the bet in the next epoch. | Resolves the current epoch and accrues its resolver reward to the caller. |
| Stale `expectedEpoch` | Reverts `UnexpectedEpoch` before token transfer. | No observed-epoch binding exists. | A non-current argument reverts `CanOnlyResolveCurrent`. |

The shipped frontend and managed V10 canary use only the protected selector.
The legacy behavior is retained solely for ABI compatibility and must not be
mistaken for equivalent epoch-intent protection.

## Canonical Build

Use exactly (do not use the compiler default):

- Solidity `0.8.36+commit.8a079791`;
- optimizer enabled, `200` runs;
- `viaIR: false`;
- EVM version `osaka`;
- OpenZeppelin Contracts `5.6.1` from the locked dependency tree.

`contracts/LineaOreV10.compiler-config.json` is the tracked canonical settings
source. In Remix Advanced Configurations choose **Use configuration file** for
that file and separately select compiler 0.8.36. A compiler configuration does
not import or validate the source tree, so the Remix workspace must still keep
`contracts/LineaOreV10.sol` and every dependency under the exact canonical
paths. This boundary follows the official
[Remix compiler configuration documentation](https://remix-ide.readthedocs.io/en/latest/compile.html#json-file-for-compiler-configuration).

Export the complete source-pinned Standard JSON independently with:

```powershell
npm.cmd run prepare:contract:v10:standard-json
```

The ignored `.tmp/v10-canonical-standard-json-input.json` embeds all 15 exact source
units under their canonical paths, verifies every source hash, recompiles without
an import callback, and must reproduce the manifest creation and runtime
bytecode exactly. It is an input for independent `solc --standard-json`, source
verification, explorers, and reviewers; it is not assumed to populate a Remix
workspace. For direct repository filesystem access, prefer Remix Desktop; the
official [filesystem guidance](https://remix-ide.readthedocs.io/en/latest/remixd.html)
marks Remixd as deprecated. The local preparation proof remains mandatory.
This source-only command finishes before loading any deployment network, token,
constructor, contract, or RPC configuration and does not open `.env.local` or
`.env`.

For a path-preserving Remix Desktop workspace, generate:

```powershell
npm.cmd run prepare:contract:v10:remix-workspace
```

The ignored `.tmp/v10-canonical-remix-workspace` contains the root contract,
compiler configuration, and all 15 manifest-pinned source units under their
exact Solidity source names. The generator rejects absolute or parent-traversal
paths, recompiles only the files it wrote, and publishes the directory only
after both a full-source compile and a root-only filesystem-import compile
reproduce the canonical creation and runtime bytecode. The second path mirrors
opening only the root contract in Remix and resolving every import from the
generated workspace. Open that directory as the workspace root, keep
`contracts/LineaOreV10.sol` at that exact path, select
`contracts/LineaOreV10.compiler-config.json`, and separately select compiler
0.8.36. Do not rename or paste the contract into a root-level file.
The generated root `README.md` records the verified source-set, creation, and
runtime SHA-256 fingerprints and byte lengths, the exact compiler controls,
constructor argument order, and the mandatory strict post-deployment command.
It intentionally contains no address, key, RPC, or constructor value.
This preparation is local-only and constructor-independent; it has no RPC,
wallet, signing, deployment, or transaction capability. A regression run with
mainnet selected, no configured token, and intentionally invalid constructor
inputs still reproduced the exact source set and bytecode; constructor-bound
preparation and fresh deployment verification continue to validate those
inputs separately.

The canonical hashes and bytecode sizes live in
`contracts/LineaOreV10.compilation.json` and are verified by:

```powershell
npm.cmd run proof:contract-compile:v10
```

The local compiler-size matrix independently pins V9 to Solidity 0.8.34 and
V10 to Solidity 0.8.36, then compares optimizer runs `1`, `200`, `10000`, and
`1000000` with and without IR:

```powershell
npm.cmd run bench:contract:v10:compiler-matrix:summary
```

All 16 profiles remain below EIP-170. The canonical V10 profile (`runs=200`,
no IR) is 17,278 creation bytes and 16,488 runtime bytes, with 8,088 runtime
bytes of EIP-170 headroom. This matrix is compile-size evidence only; it does
not replace the paired Linea runtime-gas simulation below.

All 22 state-changing ABI entrypoints have compiler-visible NatSpec, including
all 22 parameters declared by the contract's own mutating methods. Adding that
reviewer documentation changed Solidity metadata only: the stripped
16,435-byte executable runtime and its keccak remained identical. The compiler
emits one reviewed warning (`2394`) from OpenZeppelin `TransientSlot.sol` about
transient storage composability; the invariant gate accepts only that exact
end-of-call lock-clearing case and rejects every other warning.

Immediately before deployment, also query Solidity's official
`bugs_by_version.json` database. The check fails closed if the pinned release is
missing, its release identity changes, the response is malformed, or any known
bug is assigned to 0.8.36:

```powershell
npm.cmd run proof:contract-compiler-advisories:v10
```

The 2026-07-22 review found zero listed bugs for Solidity 0.8.36. This online
check is intentionally separate from the reproducible local compilation proof:
the local manifest proves exact inputs and outputs, while the mutable official
database can surface a newly disclosed compiler advisory before deployment.

Fresh adjacent Linea state-override runs also compare code-generation profiles,
not just size. `runs=1` saved about 54.8k one-time deployment gas, but added
roughly 1.3-1.5k gas to the protected 1/3-tile paths and made the stable
bet/claim/resolve rows more expensive. `runs=10000` added 2,908 runtime bytes
and about 603k deployment gas while saving only 13 gas on the protected
1/3-tile paths and about 2.1k on a 48-epoch rebate batch. `viaIR` passed the
complete behavior/rollback matrix and reduced runtime by 1,742 bytes plus
deployment by about 384k gas, but its user-facing result was mixed: protected
1/3-tile bets cost 327/147 gas more and small claim/flush paths cost roughly
344-1,277 gas more, while large batches and most resolves became cheaper. The
200-run non-IR profile therefore remains the reproducible default optimized for
the frequent small protected-bet and single-claim surface; `viaIR` did not fail
safety checks, it simply did not produce a clear user-runtime win worth changing
the canonical pipeline immediately before deployment. Solidity 0.8.36 includes
the current compiler security fixes:
<https://www.soliditylang.org/blog/2026/07/09/solidity-0.8.36-release-announcement/>.

V10 requires EIP-1153 support. Linea's Osaka environment accepted the
transaction-free TLOAD/TSTORE simulations, and Linea documents Osaka support as
live across the network:
<https://linea.build/blog/ethereum-evolves-and-so-does-linea-introducing-the-fusaka-upgrade>.
OpenZeppelin documents that its transient guard clears the slot after each protected call:
<https://docs.openzeppelin.com/contracts/5.x/api/utils#ReentrancyGuardTransient>.

## Transaction-Free Evidence

The comparison uses Linea `linea_estimateGas`, temporary code/state overrides,
and `eth_call`; it never signs or sends a transaction. V9 is compiled with its
historical pinned `0.8.34` toolchain and V10 with the canonical `0.8.36`
toolchain. The benchmark fails closed if either compiler drifts. Linea documents
the state-override estimator at
<https://docs.linea.build/api/reference/linea-estimategas>.

The table is the fresh paired estimator snapshot for the exact canonical
candidate. Every report records its Linea block number and timestamp. Absolute
`linea_estimateGas` values, especially
jackpot-award rows with larger state/event effects, can vary with the estimator
context; compare V9 and V10 rows from the same run. Deterministic `eth_call`
state assertions, not an old absolute gas number, remain the behavior proof.
Mutation gas rows use a callback-free standard ERC-20 stub. Reentrancy and
false-return rollback use separate malicious stubs so their callback overhead
cannot inflate the production-like gas baseline.

| Path | V9 gas | V10 canonical gas | Delta |
| --- | ---: | ---: | ---: |
| Deployment | 3,507,776 | 3,730,924 | +6.36% |
| Single tile | 175,209 | 140,420 | -19.86% |
| Arrays, 3 tiles | 317,014 | 238,275 | -24.84% |
| Bitmap, 3 contiguous tiles | 312,224 | 233,663 | -25.16% |
| Bitmap, 3 sparse tiles | 317,304 | 235,749 | -25.70% |
| Same amount, 3 tiles | 313,837 | 235,405 | -24.99% |
| Bitmap, 5 contiguous tiles | 448,482 | 324,563 | -27.63% |
| Bitmap, 5 sparse tiles | 453,115 | 326,474 | -27.95% |
| Bitmap, 25 tiles | 1,811,108 | 1,233,596 | -31.89% |
| Empty resolve | 122,121 | 69,247 | -43.30% |
| Funded resolve, no winner | 274,811 | 224,036 | -18.48% |
| Funded resolve, winner | 279,443 | 228,714 | -18.15% |
| Jackpot checks, no award | 286,122 | 233,550 | -18.37% |
| Daily jackpot award | 309,302 | 236,469 | -23.55% |
| Weekly jackpot award | 309,529 | 236,843 | -23.48% |
| Single reward claim | 92,546 | 82,048 | -11.34% |
| Single rebate claim | 95,767 | 65,045 | -32.08% |
| Rebate batch, 48 epochs | 3,234,904 | 1,936,362 | -40.14% |
| Reward dust batch, 48 epochs | 1,645,382 | 462,035 | -71.92% |

All 28 comparable runtime bet/resolve/claim/settlement/flush paths are cheaper
than V9 in the exact canonical snapshot. Full-precision math, the additive
epoch-bound entrypoint, and constructor/configuration/storage hardening added
223,149 gas (+6.36%) to that one-time deployment estimate. The completed
behavior harness proves 95 successful state transitions, 88 expected
boundary/duplicate/admin-guard reverts, malicious-token reentry blocking,
caught-revert guard recovery, and 35 atomic rollback paths. Nine focused
success probes assert exact tile pools, user bets, and user volume for all five
V10 bet selectors and all four V9 selectors. Fourteen false-return probes prove
full rollback across the same selectors, including every V10 path after an
expired empty epoch would otherwise advance.
Six direct production-ABI view cases additionally compare V9 and V10
`getEpochEndTime`, `getJackpotInfo`, `previewRebate`, `getRebateInfo`, and
`getRebateSummary` results under identical state overrides. They prove packed
jackpot metadata round-trips exactly, current/non-current epoch end semantics
remain compatible, active rebate previews agree across the individual and
aggregate getters, and the exact one-year boundary returns zero claimable
preview. The duplicate-epoch summary case deliberately preserves the
caller-deduplication precondition documented below.
The completed run also proves identical normal-range V9/V10
accounting snapshots, and explicit conservation of the complete funded pool in
winner, no-winner, empty-rollover, non-awarding dual jackpot checks,
daily-jackpot, weekly-jackpot, and full-precision branches. Daily and weekly
award executions additionally require identical V9/V10 winning tiles, flags,
award history, and check timestamps. It also proves
packed rebate-volume preservation after claim, checked max-volume overflow,
correct post-state for reward/rebate/dust/fee mutations, exact one-year
claim/dust boundaries, two-step ownership cancel and acceptance semantics,
unauthorized admin rejection, timelock schedule/cancel state, ready/not-ready
timelock application, invalid admin-input rejection, disabled ownership
renunciation, and a blocked inbound malicious-token reentry probe. A false-returning
ERC-20 additionally proves atomic rollback for betting, single and batch
reward/rebate claims, both single and batch dust paths, resolver claims, and fee
flush, including a ready pending fee recipient. Mixed batch arrays prove that
one eligible epoch is processed once while unresolved, ineligible, and repeated
epochs are skipped; an immediate replay then rejects because nothing remains.
Three additional EVM states prove that V9
overflows while V10 completes full-precision fee split, reward, and rebate
accounting. Six creation-call checks prove that V10 rejects a zero token, a
token address without code, a zero or self owner, and a zero or self fee
recipient. Scheduled fee-recipient changes also reject the contract itself, so
owner fees and expired dust cannot be cleared into an unrecoverable self-transfer.
Negative checks require an EVM execution-revert response; transport and generic RPC
failures cannot make the gate pass.
The same harness performs an ephemeral `CREATE` with the exact canonical init
code and constructor encoding. The resulting runtime hash and length must match
the immutable-patched compiler output, while token, owner, fee recipient, epoch
1, 60-second duration, constructor timestamp, pools, fees, and pending admin
state must match the documented initial state.

In the fresh canonical snapshot, six V10-only protected bitmap measurements add
only 1,373 gas over the legacy single-tile entrypoint and 172-173 gas over the
matching legacy bitmap path:

| Protected path | V10 gas |
| --- | ---: |
| 1 tile | 141,793 |
| 3 contiguous tiles | 233,835 |
| 3 sparse tiles | 235,922 |
| 5 sparse tiles | 326,646 |
| 25 tiles | 1,233,769 |
| 1 tile after an expired empty epoch | 187,343 |

The on-demand empty-epoch transition costs about 45,550 gas above an active
single-tile protected bet, but saves roughly 23,697 gas versus separate empty
resolve and protected-bet calls, avoids a second transaction, and spends no
keeper gas while nobody is playing.

An A/B implementation sharing both bitmap recording loops reduced deployment by
36,309 gas but added 44-45 gas to every user bet. The canonical candidate keeps
the hot path inline; the cumulative runtime saving overtakes the one-time deploy
saving after roughly 825 bets.

The canonical public resolver now relies on the mandatory shared
`_resolveCurrentEpoch` resolution guard instead of loading the same epoch state
twice. A reproducible no-RPC compile A/B reintroduces the old outer guard and
proves byte-for-byte ABI equality, identical semantic storage layout, and a
47-byte creation/runtime regression. The invariant suite requires the internal
guard and rejects reintroduction of the redundant external read.

The canonical resolve path also caches the fresh, daily, and weekly pool words
across entropy and fee allocation. Reward, rebate, and expired-dust paths cache
their packed epoch/user words instead of repeatedly loading the same storage
slots. `previewRebate` now returns zero after the user has claimed, matching the
mutating claim paths. Local invariants pin these transformations and preserve
the V9 entropy and accounting formulas. Fresh Linea execution confirms the
complete candidate is cheaper on every comparable path; no isolated gas delta
is attributed to this cache change without a dedicated one-change A/B.

Daily and weekly award metadata now each pack the period index and award epoch
into one word while retaining all four V9 getter selectors and values. This
reduces four storage slots to two, removes one `SSTORE` from every actual daily
or weekly jackpot award, and lets `getJackpotInfo` read two metadata slots
instead of four. The manual compatibility getters add 94 creation/runtime bytes
over the cache-only predecessor; exact receipt gas is still required, but the
first award avoids an additional zero-to-nonzero metadata write and subsequent
awards avoid an additional nonzero-to-nonzero write.

Reward-claimed state now occupies the second-highest bit of the existing
per-user epoch-volume word instead of a separate mapping slot. The public
`hasClaimed(address,uint256)` selector and value semantics remain unchanged,
while a successful claim updates an already nonzero word instead of creating a
new boolean slot. The volume field is consequently 254 bits rather than 255;
the enforced maximum remains many orders of magnitude above the immutable
token's possible game balance. This adds 18 creation/runtime bytes over the
packed-jackpot predecessor and is expected to remove the raw cost difference
between a zero-to-nonzero and nonzero-to-nonzero write per successful reward
claim. The complete state-override candidate measures 82,048 gas for the
single reward claim versus 92,546 for V9; that comparison is end-to-end and
does not assign the full delta to packing alone. A mined receipt remains the
post-deployment check. The current candidate is 49 bytes larger than the
17,229/16,439 candidate that started this review.

Resolution only accrues owner and burn fees. Delivery is deliberately separated
into the permissionless `flushProtocolFees()` call, so a rejecting token,
recipient, or burn transfer cannot block epoch progress. The explicit flush is
atomic: a failed transfer rolls back both fee buckets and any ready recipient
change, while a successful call clears the accrued liabilities.

Additional local gates prove:

- all 138 V9 ABI items remain callable; the compatibility-only
  `tileUserCounts` getter refines `view` to `pure` without changing its selector,
  and the V10-only epoch-bound selector/error are additive. `EpochEnded`
  remains ABI-only compatibility surface even though no V10 path emits it; the
  invariant gate permits no other declared custom error without a live revert
  site and anchors this exception to V9's live `EpochEnded` path;
- every compiled V10 custom error is present in the frontend `GAME_ABI`, and
  the capability detector's exact epoch-bound signature derives the selector
  found in compiled runtime;
- runtime size is 16,488 bytes, leaving 8,088 bytes below EIP-170;
- creation bytecode plus the three encoded constructor addresses is 17,374
  bytes, leaving 31,778 bytes below the EIP-3860 initcode limit;
- all external/public function selectors are unique;
- all 22 state-changing ABI entrypoints are explicitly classified: financial
  paths are `nonReentrant`, configuration paths are `onlyOwner`, and only the
  two inherited `Ownable2Step` transfer/accept methods sit outside those groups;
- all 22 state-changing ABI entrypoints have compiler-visible NatSpec, and a
  future undocumented mutating method or locally declared parameter fails the
  same invariant gate;
- every one of the 24 locally declared events is emitted and represented
  exactly in the frontend event ABI; the 16 accounting events consumed by the
  indexer are separately allowlisted so accidental observability loss fails;
- all 16 token interactions are explicitly assigned to their expected function,
  recipient and amount expression; unexpected token calls, low-level calls,
  inline assembly, or runtime contract creation fail the invariant gate;
- all ten external financial exits remain `nonReentrant`; the nine direct
  claim/settlement paths close their exact accounting liability before the
  ERC-20 transfer, while explicit fee flush clears owner and burn liabilities
  before their respective transfers and emits its summary only afterward;
- the provenance manifest hashes every Solidity source unit actually consumed
  by solc, including the transitive OpenZeppelin tree, rather than trusting the
  package version label alone;
- compiler output contains TLOAD/TSTORE and only the exact reviewed
  OpenZeppelin `TransientSlot.sol` warning `2394` described above;
- executable runtime contains no ORIGIN, CREATE/CREATE2, CALLCODE,
  DELEGATECALL, or SELFDESTRUCT opcode, and the ABI exposes no payable,
  fallback, or receive surface;
- 25,330 bitmap masks match a reference popcount;
- a fixed-seed full-range suite covers 20,002 `uint256` fee/accounting
  conservation states, 20,000 proportional reward/rebate states, and 3,995
  V9-safe-domain states with exact arithmetic equivalence;
- packed clock boundaries round-trip correctly;
- packed daily/weekly jackpot check timestamps round-trip at their `uint128`
  boundaries while preserving both V9 getters;
- packed user-volume/claimed boundaries round-trip and overflow fails closed;
- funded winner/no-winner, empty-rollover, daily/weekly jackpot awards, and
  full-precision states conserve every reward, rollover, jackpot, fee, resolver,
  burn, and rebate liability; jackpot flags/history and V9/V10 winning tiles
  also match;
- two-step ownership cancellation, both admin schedule/cancel paths, exact
  timelock ETAs, ready/not-ready application, invalid admin inputs, and disabled
  renunciation execute as specified on both V9 and V10;
- V9 accounting/model invariants and indexer storage tests still pass.

Run the complete local gate without a Linea RPC with:

```powershell
npm.cmd run gate:contract:v10:local
```

For an external semantic review, add the fresh official compiler-advisory check
and the fixed-synthetic-caller Linea state-override behavior matrix with:

```powershell
npm.cmd run gate:contract:v10:review
```

This review gate needs a readable Linea RPC but no funded token account,
allowance, private key, signature, or transaction. It proves the complete
behavior/rollback matrix independently of absolute gas estimation.

Run the complete transaction-free predeploy gate, including the official
compiler advisory check and paired read-only Linea gas simulation, with:

```powershell
npm.cmd run gate:contract:v10:predeploy
```

Unlike the review gate, the final gas benchmark deliberately requires one
configured public account whose existing token balance and allowance are large
enough to make the real-token `estimateGas` paths executable. Missing allowance
keeps predeploy red; it is not replaced with a synthetic-token gas claim. A
blocked run emits only configured role names and readiness booleans; it omits
addresses, balances, allowance amounts, and RPC URLs. The matrix always includes
all four test roles and identifies absent configuration explicitly.

Its component commands are:

```powershell
npm.cmd run proof:contract-compiler-advisories:v10
npm.cmd run proof:contract-compile:v10
npm.cmd run test:contract:v10
npm.cmd run bench:contract:v10:compiler-matrix:summary
npm.cmd run bench:contract:v10:diagnostics
npm.cmd run bench:contract:v10:behavior
npm.cmd run proof:contract-deployed:v10:offline
npm.cmd run test:contract
npm.cmd run test:indexer-storage
npm.cmd run test:logic
npm.cmd run typecheck
npx.cmd eslint app/lib/constants.ts scripts/check-solidity-compiler-advisories.mjs scripts/test-contract-v10-invariants.mjs scripts/benchmark-contract-v10.mjs scripts/benchmark-v10-linea-gas.ts scripts/verify-v10-deployed.ts
npm.cmd run build
npm.cmd run bench:contract:v10:summary
```

The diagnostics command compiles the embedded harness and malicious-token
probes locally without RPC access or loading any environment file. The behavior
command uses a fixed synthetic caller and runs before funded-account selection.
The broader summary benchmark selects a funded sender from public `*_ADDRESS`
values only. Neither mode imports private keys, creates a wallet client, signs,
or sends. Both RPC modes perform transaction-free state-override calls and
therefore send candidate bytecode, calldata, and synthetic/configured addresses
to the configured Linea RPC; run them only with explicit approval for that
disclosure.

## Economic Ledger

For exactly 100 LINEA of fresh stake and no rollover, the canonical V10 split
is:

| Liability | LINEA | Notes |
| --- | ---: | --- |
| Base reward or rollover | 92.000 | Distributed to winners, or carried forward when the winning tile is empty. |
| Daily jackpot reserve | 2.000 | Remains a player liability until an eligible daily award. |
| Weekly jackpot reserve | 3.000 | Remains a player liability until an eligible weekly award. |
| Safety Pool rebate | 0.975 | Half of the protocol fee after the resolver reward; eligibility is wallet-scoped. |
| Fee recipient | 0.975 | The other half of the net protocol fee. |
| Resolver reward | 0.050 | Accrued to the account resolving the epoch. |
| Burn | 1.000 | Accrued for transfer to the fixed burn address. |

The ledger conserves all 100 LINEA. Nominal player-facing liabilities total
97.975 LINEA, but this is not a promised player return: jackpot value is delayed
and high-variance, Safety Pool eligibility is conditional, unclaimed rewards and
rebates expire after one year, and wallet gas is external to the split. Integer
division floors each component for arbitrary token amounts; the owner side
receives the one-unit remainder when the post-resolver protocol fee is odd.
Rollover is never charged a second fee.

The invariant gate pins the six financial constants to their approved values,
checks this exact 100-LINEA ledger, and proves full conservation over 20,002
full-range states.

## ABI And Indexer Contract

The `getTileData(uint256)` return shape remains two 25-element arrays. Its pool
array remains canonical on-chain data. In V10 the user-count array is zero-filled
and `tileUserCounts(epoch,tile)` returns zero; exact unique-player counts come
from the four canonical bet events. The existing indexer deduplicates addresses
per epoch/tile and the live-state API overlays those indexed counts.

Deployment must start the V10 indexer from the exact V10 deployment block with a
fresh database or an explicitly isolated database path. Do not reuse V9 event
history under the V10 address. Normalized SQLite rows and metadata are scoped by
network plus contract address; the storage regression test injects a foreign
contract scope and proves it cannot affect tile counts, candidate pagination,
or global statistics. A fresh path is still required for deployment evidence
and simpler rollback. Keep `LORE_ALLOW_CONTRACT_SCOPE_PURGE` disabled during
cutover so the V9 database remains available for rollback and audit.

`getRebateSummary(address,uint256[])` is a caller-supplied preview and expects a
deduplicated epoch list. Repeating an epoch can repeat its preview amount, but
cannot create a duplicate payment: both single and batch claim paths close the
per-wallet epoch flag before transfer. The indexed candidate API already emits
unique epochs; third-party callers must preserve that precondition instead of
paying for an on-chain quadratic deduplication pass.

The normal frontend wallet-write and Privy silent paths prefer
`placeBatchBetsBitmapForEpoch` for every tile count. Auto-miner supplies its
planned epoch directly; manual betting reads the current epoch immediately
before simulation. A V9 deployment is supported only after a cached on-chain
bytecode capability check proves the V10 selector is absent. `UnexpectedEpoch`,
RPC failure, wallet rejection,
allowance failure, or any ambiguous send never falls back to an unbound method.

## Trust And Threat Model

| Actor or boundary | What it can influence | Contract boundary |
| --- | --- | --- |
| Bettor or third-party integration | Bet amount, tiles, calldata size, transaction timing, duplicate/replayed submissions | Amounts and tiles are validated, state-changing financial paths are non-reentrant, and the V10 protected bitmap selector binds funded bets to the observed epoch. Legacy selectors remain intentionally unbound for V9 ABI compatibility. |
| Permissionless resolver | Chooses when to resolve after expiry and receives the fixed resolver share | It cannot resolve early, skip the current epoch, change fee constants, or redirect another resolver's reward. Resolve-timing influence over V9 randomness remains a declared non-goal. |
| Linea sequencer/block producer | Timestamp, inclusion ordering, and the chain entropy inputs used by the unchanged V9 algorithm | The two-second closing guard limits late inclusion; it does not turn sequencer-controlled inputs into verifiable randomness. |
| Owner | Schedules epoch duration within 15-3,600 seconds, schedules the fee recipient, and initiates two-step ownership transfer | It cannot withdraw tracked game funds, pause betting, change percentages, select winners, replace the token, upgrade the contract, or renounce ownership. Duration and recipient changes are timelocked. |
| Fee recipient | Receives owner fees and expired reward/rebate dust | It has no privileged contract method. A token-level rejection can revert the separate permissionless flush or dust-settlement transfer, but cannot block epoch resolution because V10 performs no fee transfer in `resolve`. |
| Immutable ERC-20/token operator | Transfer success, pause/blacklist behavior, and non-standard balance semantics | SafeERC20 and atomic rollback prevent partial accounting, but the model explicitly trusts a standard non-rebasing, non-fee-on-transfer token for liveness and solvency. |
| Indexer/API/frontend | Presentation, unique-player counts, discovery, and transaction orchestration | They cannot mutate on-chain accounting. Pools, bets, resolution and claims remain canonical on-chain; unique-player counts are the documented ABI-semantic exception reconstructed from canonical events. |
| Sybil wallets | Splits economically related positions across addresses | Reward math remains address-local. Safety Pool eligibility is wallet-scoped and therefore not sybil-neutral by design. |

The contract is deliberately non-upgradeable and has no pause or rescue path.
This reduces owner authority and upgrade risk, but a discovered protocol bug or
token incompatibility requires migration to a new deployment rather than an
admin repair transaction.

## Known Limits

### Fee delivery policy

V10 removes the V9 automatic fee transfer from every 120th resolution and keeps
the existing permissionless `flushProtocolFees()` entrypoint. Allocation and
tokenomics are unchanged; only delivery timing changes. Epoch progress no
longer depends on two non-critical token transfers, while accrued owner and burn
liabilities remain visible until any account flushes them.

The exact read-only Linea A/B measured 6,118 less deployment gas and 88 less gas
on ordinary resolve paths; bet, claim, dust, resolver-claim, and explicit flush
paths are unchanged. More importantly, the canonical behavior harness resolves
epoch 120 successfully even when the token rejects every transfer, then proves
explicit flush success and rejecting-token rollback separately.

This is a liveness improvement, not a promise of lower aggregate gas at the old
one-flush-per-120-epochs cadence. A separately mined flush pays its own base
transaction cost. A less frequent value-based cadence amortizes that overhead;
the accrued liabilities remain visible and fully accounted for between calls.
The existing chain/indexer audit exposes both accrued buckets. Production can
set `RUNTIME_MONITOR_MAX_ACCRUED_PROTOCOL_FEES_WEI` to emit an alert when their
combined value crosses an operator-selected threshold; this monitor is
read-only and never calls `flushProtocolFees()`.

The no-RPC diagnostics gate compiles canonical and an opt-in automatic-flush
regression variant (`--v10-with-auto-flush`) from the same source. It requires
byte-for-byte ABI equality and an identical semantic storage layout (`label`,
`slot`, `offset`, and `type`). Canonical code is 28 creation bytes and 28 runtime
bytes smaller, so this policy does not require a migration adapter or storage
redesign.

- Current V9 randomness is intentionally unchanged. It is not equivalent to a
  VRF and remains a separate protocol-design decision.
- Legacy V9 bet selectors remain epoch-unbound for external ABI compatibility.
  The shipped frontend uses the protected selector; third-party integrations
  must do the same if they need epoch-intent protection.
- A legacy-selector caller can resolve a funded expired epoch inside the bet
  transaction, receive that epoch's resolver accrual, and then place the stake
  in the next epoch. This does not grant more resolution authority than the
  existing permissionless `resolveEpoch`, but it combines resolution timing and
  the next bet in one call. V10 preserves it only for V9 compatibility; the
  protected selector deliberately refuses this path.
- The contract has no application-level bet intent nonce. Chain account nonces
  prevent one signed raw transaction from executing twice, but two separately
  signed calls with identical calldata are two valid bets and debit twice. This
  avoids an additional persistent write on every hot-path bet; clients must
  reconcile pending nonce/receipt state after ambiguous submission instead of
  blindly signing a replacement bet. The shipped frontend's fallback and retry
  guards are part of this integration boundary.
- Safety Pool eligibility remains wallet-scoped: a wallet with any winning-tile
  bet is excluded from that epoch's losing-volume rebate. Splitting positions
  across wallets can therefore change eligibility. A sybil-neutral formula is a
  tokenomics change and requires explicit product approval rather than a silent
  V10 rewrite.
- Accounting assumes a standard non-rebasing, non-fee-on-transfer ERC-20 whose
  transfers do not selectively block the contract, fee recipient, or burn
  address.
- Permissionless resolution is not automatically economically self-sustaining.
  The resolver accrues only 0.05% of fresh stake and pays gas for both resolve
  and a later claim. A small funded expired epoch can therefore require the
  operated resolver even when an independent actor would rationally wait. The
  protected bet path intentionally refuses to move a funded expired epoch into
  the next round, so resolver uptime and an explicit gas budget remain liveness
  requirements until mined-gas/token-price evidence proves otherwise.
- Resolver rewards remain claimable indefinitely and have no confiscation or
  dust-expiry path. Retiring a resolver key therefore requires claiming its
  balance first; a lost key leaves that resolver liability locked rather than
  making it owner-withdrawable.
- The owner has no generic token or native-asset rescue and no surplus sweep.
  Tokens transferred directly to the contract outside a game entrypoint are
  not credited to any player or accounting bucket and cannot be recovered.
  Ordinary native transfers revert because there is no payable/receive surface;
  native currency forced in by EVM mechanisms is likewise stranded. This
  prevents an owner from reclassifying tracked player funds, but integrations
  must never fund the contract address directly.
- Simulations prove deterministic behavior for supplied state; only a deployed
  contract and mined receipts can prove the final chain artifact and real gas.
- One-year dust expiry cannot be wall-clock tested immediately after deployment;
  state-override tests cover it before deployment and historical live validation
  remains an operational gate.

## Deployment Checklist

1. Re-run every focused gate above with an unchanged worktree.
2. Verify the V10 provenance manifest immediately before compilation.
3. Generate the full source-pinned compiler input with
   `npm.cmd run prepare:contract:v10:standard-json`. It is
   constructor-independent and
   contains no address, wallet, signer, network, or transaction capability.
   If using Remix Desktop, also run
   `npm.cmd run prepare:contract:v10:remix-workspace` and open the generated
   path-preserving workspace instead of recreating its files manually.
   Then prepare the canonical constructor-bound initcode with
   `npm.cmd run prepare:contract:v10:deployment` after setting the three
   independent `V10_EXPECTED_*` constructor values. The command first verifies
   the compilation manifest, regenerates the same exact Standard JSON, then
   writes `.tmp/v10-canonical-initcode.hex` with restricted local permissions.
   A failed preparation removes stale deployable output; a successful one
   publishes the validated Standard JSON before the initcode marker. It reports
   byte length and hashes only; it has no network, wallet, signing, deployment,
   or transaction API. Deploy that
   exact contract-creation data through the separately approved signer flow;
   do not recompile it in a different workspace after this check.
   Before signing, run `npm.cmd run bench:contract:v10:deployment`. It regenerates
   the artifact, requires an exact byte-for-byte match, proves six invalid
   constructor paths revert, and calls only `linea_estimateGas`. It needs a
   configured public address with test ETH but does not require LINEA balance,
   allowance, a private key, or a wallet.
4. If compilation is independently repeated, use the generated Standard JSON
   through a Standard JSON compiler interface, not as a presumed Remix workspace
   importer and not from an unrelated root-level source copy. It pins
   `contracts/LineaOreV10.sol`, all transitive OpenZeppelin Contracts 5.6.1
   units, compiler settings, and source-unit paths that Solidity commits into
   metadata. In Remix, keep those exact workspace paths and select
   `contracts/LineaOreV10.compiler-config.json`; otherwise deploy the already
   verified exact initcode through the separately approved signer flow.
5. Supply non-zero constructor values in this order: token, initial owner,
   initial fee recipient. Confirm each value independently before signing.
6. Record deployment transaction hash, contract address, and deployment block.
7. Verify source/compiler settings and compare deployed runtime bytecode against
   the canonical local compilation with its token immutable patched. The
   verifier checks both the full runtime and executable runtime with Solidity
   metadata removed. A metadata-only mismatch is reported diagnostically but
   still fails the strict deployment gate; fix the source path, dependency
   version, or compiler settings rather than waiving it.
8. Confirm token, owner, fee recipient, epoch 1, 60-second duration, start time,
   zero pools/fees, and no pending admin changes using read-only calls.
9. Simulate one active protected bitmap bet, one expired-empty atomic advance,
   plus stale, closing, and expired-funded reverts before signing any canary
   transaction.
10. Stop the site, resolver, and indexer before changing configuration. Update
   contract address and deploy block atomically across frontend, indexer, API,
   resolver, proof tooling, and production configuration. At minimum set
   `KEEPER_CONTRACT_ADDRESS`, `NEXT_PUBLIC_CONTRACT_ADDRESS`,
   `INDEXER_START_BLOCK`, and `NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK` to one
   address/block pair, set
   `NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS=1`, and use a new
   `LORE_DB_PATH`. Keep the V9 environment and database as rollback evidence;
   do not enable contract-scope purge.
11. Run the strict fresh-deployment verifier before any application process or
    wallet action. It must pass against the exact V10 deployment transaction.
12. Keep all writers stopped until the deployment reaches the confirmation or
    finality depth selected for the testnet release, then run the same strict
    fresh verifier again. Preserve both results; an immediate receipt is not a
    durable deployment proof by itself.
13. Rebuild Next.js after setting the final `NEXT_PUBLIC_*` values; those values
    are compiled into the browser bundle. Then run the one-shot fresh V10
    indexer, verify its deploy-block cursor and health, and run `smoke:http`
    against the rebuilt application. Runtime health must report
    `contractRequiresEpochBoundBets: true`; the smoke fails if the caller expects
    V10 protection but the running build is stale. Only then restart the site,
    resolver, continuous indexer, and monitor. A process restart without a new
    production build is not a valid frontend cutover.

After updating the local V10 address/token configuration, step 7 and the
machine-checkable portion of step 8 are one read-only command:

```powershell
$env:V10_EXPECTED_TOKEN_ADDRESS = "<expected-token>"
$env:V10_EXPECTED_INITIAL_OWNER = "<expected-owner>"
$env:V10_EXPECTED_INITIAL_FEE_RECIPIENT = "<expected-fee-recipient>"
$env:V10_DEPLOY_TX_HASH = "<deployment-transaction-hash>"
npm.cmd run proof:contract-deployed:v10:fresh
```

For the first and post-finality checks, prefer the composite read-only gate:

```powershell
npm.cmd run gate:contract:v10:postdeploy:readonly
```

It runs the exact fresh-deployment verifier first and collects the existing
strict chain/funds snapshot only after that succeeds. Its invariant-pinned
composition contains no wallet, signer, canary, deployment, or transaction
command. Preserve the immediate and post-finality outputs as separate evidence.

The command first requires the exact source/import/ABI/creation/runtime manifest
proof, then runs the chain verifier. The verifier fails before RPC reads if
any independently entered expected constructor address or
the deployment transaction hash is missing or malformed. In `--fresh` mode it
rebuilds the exact creation input from the canonical creation bytecode and the
three constructor values, then requires a successful contract-creation receipt
at the configured address and deployment block. It also requires explicit, matching
`NEXT_PUBLIC_CONTRACT_ADDRESS`/`KEEPER_CONTRACT_ADDRESS` and
`NEXT_PUBLIC_CONTRACT_DEPLOY_BLOCK`/`INDEXER_START_BLOCK` pairs, and requires the
independent `V10_EXPECTED_TOKEN_ADDRESS` to match
`NEXT_PUBLIC_LINEA_TOKEN_ADDRESS`. Because the frontend, indexer, and accounting
proofs use 18-decimal LINEA units, it also requires the deployed token's
`decimals()` getter to return 18. It additionally requires
`NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS=1`, preventing the V10 browser
bundle from silently using legacy epoch-unbound selectors. It verifies the
constructor timestamp against that block, requires no runtime bytecode at the
same address one block earlier, confirms the token has runtime code, and checks
clean epoch-1 pools, claims, contract token balance, fees, and pending admin
state. It reports only boolean comparisons, not configured addresses or the
transaction hash, and redacts RPC URLs and long hex identifiers from failures.

## Post-Deployment Test Matrix

Before any long soak, run bounded canaries in this order:

1. Read-only ABI/state and deployed-bytecode verification.
2. One protected first-time single-tile bet and one protected repeat bet on the
   same tile/user; record mined gas and expected epoch.
3. Protected bitmap bets for 3, 5, sparse, and 25 tiles; compare token debit, event totals,
   tile pools, user bets, and indexed unique counts.
4. Expired-empty atomic advance, stale expected epoch, closing window,
   expired-funded epoch, user rejection, insufficient
   allowance/balance/gas, pending receipt, confirmed revert, and
   retry-without-duplicate-send paths. Prove only the explicit empty-epoch case
   advances, and stale/closing/funded-expired bets never move into the next epoch.
5. Manual resolve, bet-triggered auto-resolve, empty rollover, funded no-winner,
   and funded winner paths.
6. Single/batch reward and rebate claims, duplicate rejection, resolver reward,
   fee flush, and read-only dust eligibility.
   Claim resolver rewards before rotating or retiring any resolver key.
7. Accounting conservation after funded-winner, funded-no-winner, rollover,
   jackpot, claim, fee, and dust mutations. Sum every live liability and compare
   it with the contract token balance; explain only known floor-rounding dust.
8. Two-step ownership transfer/cancel, disabled renunciation, epoch-duration
   schedule/cancel/apply, and fee-recipient schedule/cancel/apply after their
   exact timelocks. Use read-only simulations before any signed admin canary.
9. Fresh V10 indexer replay from the deployment block, then chain/indexer/API/UI
   reconciliation for epochs, pools, bets, counts, rewards, rebates, and jackpots.
10. Compare mined receipt gas with this document's transaction-free baseline and
   investigate any material regression before starting a managed soak.
11. Calculate resolver break-even from mined resolve gas, amortized resolver-claim
   gas, current gas price, and the LINEA/ETH value ratio. If the 0.05% reward is
   below cost at the smallest expected funded pool, document and fund the
   operated resolver as a protocol liveness expense rather than assuming public
   keepers will resolve it.

### Bounded live matrix result

The first authorized live tranche completed with four approvals, 12 protected
bets, and five resolves, exactly matching the 21-transaction ceiling. All
receipts succeeded. Six bet epochs covered first and repeat writes for one,
contiguous/sparse three, contiguous/sparse five, and 25 tiles. There were no
duplicate hashes, nonce gaps, ambiguous sends, reverts, or successful legacy
epoch-unbound bets. The remaining funded epoch was intentionally left open by
that ceiling and later closed by a separate one-transaction authorization:
`resolveEpoch(7)` succeeded, used 165,715 gas, and advanced the contract to
epoch 8 without a retry or follow-up write.

| Comparable bet path | Mined V9 gas | Mined V10 gas | V10 delta |
| --- | ---: | ---: | ---: |
| 1 tile, first write | 283,143 | 204,655 | -27.72% |
| 1 tile, repeat write | 80,768 | 72,297 | -10.49% |
| 3 contiguous tiles | 315,227 | 232,741 | -26.17% |
| 3 sparse tiles | 315,227 | 232,672 | -26.19% |
| 5 contiguous tiles | 455,583 | 322,553 | -29.20% |
| 5 sparse tiles | 455,583 | 322,763 | -29.15% |
| 25 tiles | 1,834,477 | 1,222,848 | -33.34% |

V10 repeat-write receipts were 95,941/95,872 gas for contiguous/sparse three
tiles, 117,353/117,563 for contiguous/sparse five tiles, and 328,848 for 25
tiles. The first resolve used 223,878 gas and the next four used 121,278 each.
The dedicated strict V10 proof, fresh indexer replay, chain/indexer accounting,
production HTTP smoke, and responsive browser smoke all pass.

The deployed executable runtime matches the canonical V10 executable bytes and
constructor state. Remix compiled the source under a different source-unit
layout, producing a metadata-only full-bytecode/creation-input mismatch. This
does not invalidate the bounded testnet gas or behavior evidence, but the final
reproducible deployment must use the exact manifest layout and pass the strict
verifier without an exception. The verifier reads all constructor-era owner,
fee-recipient, epoch-clock, pending-admin, pool, claim, and balance state at the
deployment block rather than latest state. It therefore remains repeatable
after gameplay; the current strict result has only `runtimeBytecode` and the
corresponding exact `deploymentTransaction` input red.

### Resolver economics from mined receipts

The first five bounded resolve receipts used 708,990 gas in total: 223,878 once
and 121,278 four times. Their actual aggregate network fee was
0.00053779027996293 ETH, while 0.34 LINEA of fresh test stake accrued only
0.00017 LINEA at the fixed 0.05% resolver rate. Per-epoch break-even ranged from
0.242556 to 34.980938 ETH per LINEA because both stake and gas price varied.
The separately authorized sixth receipt used 165,715 gas. These intentionally
tiny test pools do not prove public resolver profitability.

For a funded epoch, resolver break-even is:

`LINEA price in ETH >= resolve native fee in ETH / (fresh pool in LINEA * 0.0005)`

The read-only post-deploy planner reports this ratio from current estimated gas,
gas price, and fresh pool without assuming a market price. If the market ratio
is lower, the operated resolver must be treated as a protocol liveness expense.
Do not raise the resolver share or change tokenomics without a separate design
and economic review.

### Remaining bounded phase

Run the transaction-free planner before every remaining live tranche:

```powershell
npm.cmd run plan:canary:v10:postdeploy:summary
```

It verifies V10 provenance first, keeps stdout bounded, and reads public role
addresses only from process env or the ignored public-only
`.env.live-test-addresses`; it does not open `.env.live-test-wallets` and has no
wallet, signing, private-key, or write API. If a funded resolve is ready, the
output authorizes no claims from the same snapshot: execute at most that
separately approved resolve, wait for its receipt, and rerun the planner. Only
the fresh post-resolve result may set the exact batched reward/rebate,
resolver-claim, and fee-flush transaction cap. For every permitted claim/flush
the report emits address-free call counts and aggregate estimates. The call
count must equal the transaction limit or the planner fails closed. Dust remains
read-only until the one-year eligibility boundary. Resolve gas estimates are
block-dependent, so
the plan reports raw estimation separately from a conservative 500,000 gas
limit; unused gas is not charged.

The official planner command first reruns canonical compiler provenance. It
then strips only Solidity metadata from deployed code, zeroes the 16 exact
token-immutable ranges pinned by the manifest, and requires the complete
16,435-byte executable runtime hash to match before any mutation simulation.
The separately decoded `token()` value must still match the configured token;
the token address must contain bytecode and return exactly 18 decimals at the
same pinned block. This admits the known metadata-only Remix difference on the
bounded testnet deployment while rejecting changed executable logic, a changed
or incompatible immutable token, or a locally drifted source/dependency
manifest.

The planner determines that phase boundary before per-role claim discovery. A
ready resolve therefore skips stale role-claim and fee-flush reads/simulations
instead of computing a plan that cannot be authorized. Historical and per-role
discovery reads use bounded four-item batches; state-changing simulations and
exact-revert checks remain sequential. The pre-resolve six-epoch snapshot
passed all 21 then-applicable exact checks and simulated only resolve. The
fresh current post-resolve scan covers all seven resolved epochs, passes all 29
applicable exact checks, and produces seven exact claim/resolver/fee-flush
records with 564,999 estimated gas. A prior 5,000-epoch-cap run produced the
same call set; a truncated history similarly skips claim/flush planning and
remains fail-closed.

The snapshot is literal rather than advisory. The planner captures one Linea
block before reading state, then pins deployed bytecode, token balance, every
contract read, positive simulation, gas estimate, and exact negative check to
that block. Its report includes the block number and timestamp. This prevents a
concurrent resolve, claim, flush, or governance activation from combining state
from adjacent blocks into one authorization decision.

Pending governance is also a hard planning barrier. A nonzero pending owner,
epoch duration, or fee recipient can alter authority or resolve/flush behavior,
so the planner skips positive mutation simulations and emits a zero transaction
limit until an operator explicitly reviews and clears the transition. Runtime
identity, public-state discovery, and exact negative checks remain available for
diagnosis. The current deployment reports a clean governance state.

Completed governance changes are pinned as well. The planner compares current
`owner()`, `feeRecipient()`, and `epochDuration()` at the same snapshot block
with the tracked Linea Sepolia expectations. Optional
`V10_EXPECTED_CURRENT_OWNER`, `V10_EXPECTED_CURRENT_FEE_RECIPIENT`, and
`V10_EXPECTED_CURRENT_EPOCH_DURATION` overrides must be updated after an
intentional reviewed change. A mismatch exposes only boolean match status,
blocks every mutation recommendation, and requires operator review; the report
never prints the expected or observed addresses.

Negative checks are state-aware. `EpochClosing` is required from the protected
bet path only while the current epoch is funded, expired, and resolve-ready. An
empty expired epoch may advance atomically and accept the first returning bet,
so treating that successful simulation as a failure would incorrectly block
the post-resolve claim phase. Reward and dust checks follow the one-year
lifecycle as well: a closed reward window requires
`RewardClaimWindowExpired`, and premature dust checks are omitted once the
settlement actions become eligible rather than misclassifying a legal write as
a failed negative.

The same planner computes a fail-closed observable-liability floor from the
current epoch stake, rollover, both jackpot reserves, owner/burn fee buckets,
unsettled reward and rebate pools, and pending resolver rewards for every
configured test role. Aggregate claimed values above their pool or a contract
token balance below this floor fails the run. Earlier epochs outside a truncated
scan, unknown third-party resolver addresses, and direct ERC-20 transfers are
explicit residual scope, not owner-withdrawable surplus. On the current complete
seven-epoch deployment the floor equals the token balance exactly, with zero
deficit and zero residual.

The deployed read-only negative matrix also requires exact decoded custom
errors for unresolved/empty reward, rebate, and resolver claims; stale and
funded-expired protected bets; zero/out-of-grid bitmap; zero amount;
non-current resolve; invalid single tiles; mismatched arrays; both epoch-duration
bounds; invalid fee recipients; disabled ownership renunciation; no-pending
timelock activation; premature reward/rebate dust settlement; and unauthorized
epoch-duration/fee-recipient scheduling. Both batch dust entrypoints additionally
reject empty arrays exactly and return `NothingToClaim` before the one-year
boundary. The report declares which lifecycle-dependent checks apply; all 29
checks pass on the current post-resolve snapshot. The applicable count may
change as claim and dust windows mature, so the exact decoded error list, not a
fixed count alone, is the security evidence. RPC/transport failures and unknown
reverts fail the planner instead of being counted as security evidence. The
one-shot planner exits after output without RPC ranking timers. If its
configured epoch window truncates resolved history, it marks the claim plan
incomplete and refuses claim/fee-flush authorization until a complete bounded
scan is rerun.

For the managed V10 canary, use the V10-specific proof command rather than the
legacy-compatible analyzer:

```powershell
npm.cmd run live:canary:v10:matrix
npm.cmd run live:canary:v10:matrix -- --execute
npm.cmd run proof:testnet:canary:v10 -- <live-canary.jsonl> --manifest=<canary-proof.json>
```

The first command performs only wallet/nonce/balance/selector preflight. The
second command is the explicit transaction boundary: it runs six bounded
matrix rounds and repeats each same user/tile bet once for first-write versus
repeat-write mined gas. Run it only after reviewing the dry-run result and
granting fresh authorization for those testnet transactions.

`playtest:wallet` is also transaction-free by default. Its V10 path verifies
deployed selector support and never falls back from a protected send to a
legacy selector. Live playtest execution now requires both
`TEST_WALLET_EXECUTE=1` and `--execute`; `--execute` alone fails before signing
material is loaded. It still requires a fresh bounded authorization.

When `NEXT_PUBLIC_CONTRACT_REQUIRES_EPOCH_BOUND_BETS=1`, the live canary checks
the deployed runtime for the protected selector before wallet preflight or any
allowance transaction, then sends every canary bet through
`placeBatchBetsBitmapForEpoch`. The strict V10 analyzer rejects the evidence if
even one successful bet is unmarked or used an epoch-unbound path. Its first
six planned rounds cover 1 tile, contiguous and sparse 3/5-tile sets, and the
full 25-tile grid; the strict proof rejects a missing case and prints mined-gas
p50/p95/max for each. Compact managed-soak status separately reports successful
`epochBoundBets` and `epochUnboundBets`; V10 signoff requires the latter to
remain zero.
