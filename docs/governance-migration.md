# Governance Migration

## Goal

Move LORE from a single-key `Ownable` setup to an ownership model that is acceptable for production reviews:

- multisig ownership today
- timelock + multisig ownership when operationally ready
- no ownership renounce for the live game contract

## V9 Contract Profile

The active contract source is [contracts/LineaOreV9.sol](../contracts/LineaOreV9.sol).

Key governance properties:

- `Ownable` -> `Ownable2Step`
- separate `feeRecipient` treasury address
- timelocked treasury change:
  - `scheduleFeeRecipientChange(address)`
  - `cancelFeeRecipientChange()`
- ownership renounce disabled
- protocol fees now go to `feeRecipient`, not `owner()`
- equal-size multi-bets use `placeBatchBetsSameAmount(...)`
- compact equal-size multi-bets use `placeBatchBetsBitmap(uint32 tileMask, uint256 amount)`
- rebate accounting now tracks per-user epoch volume incrementally, so rebate preview/claim paths do not scan all 25 tiles per epoch
- empty rollover-only epochs no longer leak fees into jackpot / protocol / burn buckets

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
- the game may still need governed operational actions

For LORE, immutability is less important than removing single-key risk.

## Deployment checklist

1. Deploy `LineaOreV9` with:
   - `tokenAddress`
   - `initialOwner`
   - `initialFeeRecipient`
2. Verify the contract source.
3. If using the preferred model:
   - deploy `TimelockController`
   - set the Safe as proposer/executor/admin as planned
   - transfer ownership of `LineaOreV9` to the timelock
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

The app/runtime reads deployment settings from env and defaults in [config/publicConfig.ts](../config/publicConfig.ts).

After a new deployment, update:

- `CONTRACT_ADDRESS`
- `CONTRACT_DEPLOY_BLOCK`
- `LINEA_NETWORK` / `NEXT_PUBLIC_LINEA_NETWORK` when switching between Sepolia and mainnet
- `NEXT_PUBLIC_LINEA_TOKEN_ADDRESS` if the token address changes

The ABI in [app/lib/constants.ts](../app/lib/constants.ts) includes the V9 methods, including `placeBatchBetsBitmap(...)`.
