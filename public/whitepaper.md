LORE Protocol: Whitepaper v1.0
1. Introduction
LORE (Linea_Ore) is a decentralized parimutuel prediction protocol built specifically for the Linea Network. The platform enables users to engage in high-frequency, grid-based competitive mining rounds. LORE combines the thrill of strategy with a robust deflationary mechanism, directly contributing to the Linea ecosystem's health through automated token burning.

2. Core Mechanics
The protocol operates on a 5x5 matrix (25 unique tiles).

Round Cycle: Every 60 seconds, a new mining cycle begins.

Deployment: Users deploy $LINEA tokens to one or multiple tiles within the grid.

Selection: At the end of the cycle, a winning tile is selected via a cryptographically secure random source.

Distribution: The total pool (Motherlode) is distributed among participants who deployed to the winning tile, proportional to their stake.

3. Tokenomics & Burn Mechanism
LORE is designed to be net-deflationary for the Linea token supply. Every round, a total protocol fee of 5% is levied on the Motherlode:

2.5% Burn Rate: Half of the fee is permanently removed from circulation by sending it to the official dead address (0x0...dEaD). This mechanism reduces the total supply of tokens, rewarding long-term holders of the underlying asset.

2.5% Treasury: The remaining portion is allocated to the protocol treasury for maintenance, infrastructure, and future development.

4. Automation: The Auto-Miner
To maximize efficiency, LORE provides a built-in "Auto-Miner" interface.
Users can pre-set their mining parameters:

Target Tiles: Number of random tiles to cover per round.

Cycle Duration: Total number of rounds to remain active.
This feature ensures continuous participation without manual intervention, optimized for high-volume users.

5. Security & Transparency
Verified Contracts: All protocol logic is handled by smart contracts verified on Lineascan.

Non-Custodial: Users retain control of their funds until deployment. Rewards are claimed directly from the contract.

Immutable Execution: Round resolutions are finalized on-chain, ensuring that no central party can alter the outcome.