LORE Protocol: Whitepaper v1.1

1. Introduction

LORE (Linea + ORE) is an on-chain prediction mining game built for Linea mainnet. The current repository is tested on Linea Sepolia until final mainnet contract addresses are configured.

Players place LINEA bets on a 5x5 grid of 25 tiles. When an epoch resolves, one tile wins. Players who backed that tile share the reward pool proportionally to their stake.

2. Core Mechanics

Grid: 25 tiles, numbered 1 through 25.

Epoch: The default round duration is 60 seconds. Bets are rejected at the end of the epoch, including the final safety window.

Betting: Players can bet on one or more tiles. The contract accepts any amount greater than zero, and the UI validates amounts before submitting transactions.

Resolution: Anyone able to submit a valid transaction can call resolveEpoch after the epoch ends. The UI and keeper infrastructure are expected to resolve rounds automatically.

Rewards: Winners claim rewards from the contract. If nobody bet on the winning tile, the base reward rolls into the next epoch.

3. Fee Split

Each epoch splits fresh pool volume as follows:

92% base reward for winning-tile holders.

2% accrues to the daily jackpot pool.

3% accrues to the weekly jackpot pool.

2% protocol fee, split between treasury accounting and participation rebates.

1% burn, sent to the dead address.

Rollover from no-winner epochs is added to the next epoch's base reward pool. Jackpot pools are separate reserves and are only awarded when their on-chain trigger conditions are met.

4. Jackpots

The daily jackpot can trigger once per UTC day on a resolved epoch with at least one winner.

The weekly jackpot can trigger once per Monday-based UTC week on a resolved epoch with at least one winner.

When a jackpot triggers, the entire accumulated jackpot pool is added to that epoch's winning-tile reward pool. If an epoch has no winner, jackpot pools remain untouched and continue growing.

5. Randomness Model

V9 uses transparent on-chain pseudo-randomness. The hardened source derives the winner tile from block.prevrandao, the previous blockhash, epoch number, current pool state, and jackpot pool state. The resolver address is intentionally excluded from winner entropy.

This model is auditable and fully on-chain, but it is not equivalent to VRF or commit-reveal randomness. Removing the resolver address closes caller-address grinding, while sequencer influence over block inputs and transaction inclusion remains part of the risk model. Mainnet launch review should explicitly cover resolver monitoring and any future randomness hardening.

6. Auto-Miner

The Auto-Miner automates repeated participation. Users configure bet size, number of random target tiles, and total cycles. The bot checks wallet balances before each round, persists session state locally, and stops when funds or wallet session state are no longer valid.

Auto-Miner does not improve mathematical odds. It only reduces manual clicking and increases the number of rounds a user can participate in.

7. Wallet And Custody

LORE uses Privy embedded wallets for low-friction transaction signing. Players need LINEA for bets and ETH on Linea for gas.

The game contract is non-custodial in the normal allowance model: tokens stay in the user's wallet until a bet transaction transfers the exact staked amount. Users can revoke token allowances with standard allowance-management tools.

8. Mainnet Readiness

The public copy is written for Linea mainnet, while the current testing environment may still point at Sepolia contracts. Before mainnet launch, deployment addresses, token addresses, explorer links, keeper configuration, resolver monitoring, and production environment variables must be verified against the final Linea mainnet contracts.
