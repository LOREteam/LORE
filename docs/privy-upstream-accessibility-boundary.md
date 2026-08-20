# Privy embedded-modal accessibility boundary

Status: accepted upstream limitation; external QA remains required.

## Pinned dependency and observed boundary

The application pins `@privy-io/react-auth` through the repository lockfile at
`3.27.2`. Its hosted embedded authentication surface is third-party DOM, not a
LORE-owned component. The known upstream accessibility limitations are:

- the email continuation control exposes the accessible name `Submit` rather
  than task-specific copy;
- the provider close target measures 24 by 24 CSS pixels.

Neither limitation is remediated by application CSS, DOM mutation, test-only
overrides, or edits under `node_modules`. Those approaches would make the
local result non-reproducible and could interfere with provider updates.

## Product boundary

LORE-owned login entrypoints, focus trapping, safe-area layout, close controls
outside the provider surface, and wallet/recovery status remain subject to
normal product accessibility tests. This record does not waive them and does
not claim that the provider's controls are conformant.

The upstream limits are accepted only as an explicit exception for the hosted
Privy-owned controls until a supported provider release changes them. They are
not a release-success signal and cannot be used to mark wallet/mobile QA
complete.

## Required external evidence before release

Run a real public-HTTPS embedded-modal session with the pinned provider and
record redacted evidence for keyboard traversal, focus containment, dismissal,
mobile Web3 provider handoff, safe-area geometry, connect/reconnect,
clean-wallet first action, account/chain change, rejection, pending, revert,
and recovery. The evidence must identify the provider version and origin, but
must not include sessions, wallet addresses, private keys, or tokens.

Re-open this exception when upgrading Privy or when the provider offers a
supported configuration that changes either control. Do not patch the
provider's DOM or CSS as a workaround.
