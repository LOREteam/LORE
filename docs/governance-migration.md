# Governance Migration

## Goal

Move LORE from a single-key `Ownable` setup to an ownership model that is acceptable for production reviews:

- multisig ownership today
- timelock + multisig ownership when operationally ready
- no ownership renounce for the live game contract

## What changed in V7

The latest deploy-ready contract source is [contracts/LineaOreV7.sol](/d:/linea-miner-main/contracts/LineaOreV7.sol).

Key governance changes:

- `Ownable` -> `Ownable2Step`
- separate `feeRecipient` treasury address
- timelocked treasury change:
  - `scheduleFeeRecipientChange(address)`
  - `cancelFeeRecipientChange()`
- ownership renounce disabled
- protocol fees now go to `feeRecipient`, not `owner()`
- equal-size multi-bets can use `placeBatchBetsSameAmount(...)`
- rebate accounting now tracks per-user epoch volume incrementally, so rebate preview/claim paths do not scan all 25 tiles per epoch

This matters because a `TimelockController` can safely be the owner without trapping protocol fees.

## Recommended deployment topology

### Minimum acceptable

- `owner` = Safe multisig
- `feeRecipient` = treasury Safe

### Preferred

- `owner` = `TimelockController`
- `TimelockController` proposer/executor/admin = Safe multisig
- `feeRecipient` = treasury Safe

## Suggested signer model

- Safe `2/3` if the team is still small
- Safe `3/5` if you already have 5 trusted operators

Do not use a single EOA as live owner.

## Why not renounce ownership

Renouncing ownership is a bad fit for this contract family because:

- admin recovery actions still exist
- epoch duration management still exists
- stale referral settlement still exists
- the game may still need governed operational actions

For LORE, immutability is less important than removing single-key risk.

## Deployment checklist

1. Deploy `LineaOreV7` with:
   - `tokenAddress`
   - `initialOwner`
   - `initialFeeRecipient`
2. Verify the contract source.
3. If using the preferred model:
   - deploy `TimelockController`
   - set the Safe as proposer/executor/admin as planned
   - transfer ownership of `LineaOreV7` to the timelock
   - call `acceptOwnership` from the timelock flow
4. Update frontend constants:
   - `LINEA_NETWORK` / `NEXT_PUBLIC_LINEA_NETWORK`
   - `CONTRACT_ADDRESS`
   - `CONTRACT_DEPLOY_BLOCK`
   - `NEXT_PUBLIC_LINEA_RPCS` if you want pinned production RPCs
5. Update any indexer/backfill assumptions if deployment block changes.
6. Announce the ownership model publicly:
   - owner address
   - treasury address
   - timelock delay if used

## Frontend migration note

The current frontend still points at the existing deployed address in [app/lib/constants.ts](/d:/linea-miner-main/app/lib/constants.ts).

After V7 deployment, update:

- `CONTRACT_ADDRESS`
- `CONTRACT_DEPLOY_BLOCK`

The ABI in [app/lib/constants.ts](/d:/linea-miner-main/app/lib/constants.ts) already includes the methods needed by the current V7 deploy candidate.
