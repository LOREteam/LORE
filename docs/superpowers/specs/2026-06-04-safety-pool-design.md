# Safety Pool Design

## Goal

Replace the current participation rebate meaning with a Safety Pool: only players who participated in a resolved epoch and had zero bet on the winning tile can claim a proportional consolation payout.

## Rules

- The existing 1% player-return allocation remains funded from half of the 2% protocol fee.
- A user is eligible only if they placed at least one bet in the epoch and their bet on the winning tile is exactly zero.
- If a user placed any amount on the winning tile, they are a winner for Safety Pool purposes and receive no Safety Pool payout, even if they also placed losing bets.
- The Safety Pool denominator is total losing-player volume, modeled as `epoch.totalPool - tilePools[epoch][winningTile]`.
- A Safety Pool preview returns zero before the epoch is resolved, when the pool is empty, when there is no losing volume, or when the user is ineligible.
- Existing rebate ABI names stay in this PR to avoid broad app rewiring; user-facing copy changes to Safety Pool.

## User Experience

- The existing Rebate tab becomes Safety Pool in navigation and panel copy.
- The panel explains that Safety Pool is for players who missed the winning tile.
- Claim button and status messages refer to Safety Pool, not rebate.
- Documentation and smoke checks should look for Safety Pool copy.

## Scope

This change updates the contract formula, user-facing UI text, docs, and smoke expectations. It does not rename internal hooks/routes/storage/events because that would create a larger migration surface without changing user behavior.
