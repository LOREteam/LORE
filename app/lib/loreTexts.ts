const rng = () => Math.random();

export function pickRandom<T>(arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

// ── Loading / spinner states ────────────────────────────────────────

export const loadingQuotes = [
  "The Lattice hums… synchronizing…",
  "Crystals aligning… patience, miner",
  "Kael once waited three epochs for a sign…",
  "The chain remembers… loading your path",
  "Deep in the mines, data flows like ore…",
  "The crystal veins pulse with new data…",
  "Echoes from the Lattice… almost there",
  "Ore fragments coalescing…",
  "The mines stir beneath the chain…",
  "Reading the ancient ledger of the Lattice…",
  "The grid stirs… data seeps from the veins…",
  "Patience, miner. The chain yields its secrets slowly",
  "Crystal nodes awakening…",
  "Tracing the veins of the Lattice…",
  "The mines breathe. Data follows",
] as const;

export const processingQuotes = [
  "The Lattice is listening…",
  "Your signal ripples through the crystal…",
  "Kael watches. The chain records",
  "The ore trembles… processing your command",
  "Transmitting through the crystal network…",
  "The Lattice weighs your offering…",
  "Your stake travels the crystal path…",
  "The chain receives your claim…",
  "Mining the transaction into the Lattice…",
  "The grid awaits confirmation…",
] as const;

export const searchingQuotes = [
  "Scanning the deep shafts…",
  "Crystal sonar pulsing…",
  "Kael's lantern sweeps the tunnels…",
  "Probing forgotten veins of the Lattice…",
  "The echoes return… searching…",
  "Sifting the ore for unclaimed crystals…",
  "The Lattice yields its hidden rewards…",
  "Tracing every claim through the chain…",
  "Dust settles. The scanner reads the veins…",
  "Hunting for echoes in the mine's depths…",
] as const;

// ── Mining grid – win/loss flavor ───────────────────────────────────

export const yourWinQuotes = [
  "The Lattice chose you!",
  "Kael nods from the shadows",
  "Your pickaxe struck true",
  "The crystal sings your name!",
  "Fortune favors the bold miner",
  "A vein of pure light – yours",
  "The chain will remember this",
  "Your instinct led to ore!",
  "The grid bowed to your stake",
  "A miner's dream – crystal in hand",
] as const;

export const roundWinQuotes = [
  "The Lattice has spoken",
  "A crystal shard glows bright",
  "The winning vein revealed",
  "The ore chose its miner",
  "Another echo in the Lattice",
  "The chain crowns a victor",
  "One tile shimmers. The round ends",
  "The mines have chosen",
  "A vein sealed. The epoch closes",
  "The crystal pulse fades. Winner found",
] as const;

export const lossQuotes = [
  "The mines giveth and taketh…",
  "Even Kael lost his first hundred rounds",
  "The Lattice tests the worthy",
  "Dust settles. The crystal waits",
  "Not this vein. Try another",
  "The ore hides deeper still",
  "Another shift. Another chance",
  "The grid remembers. The next epoch awaits",
  "Dust to dust. The chain continues",
  "Patience, miner. The veins run deep",
] as const;

// ── Leaderboard lore epithets ───────────────────────────────────────

export const leaderboardLore: Record<string, { title: string; quote: string }> = {
  biggestWin:    { title: "Crystal Breaker",       quote: "One swing. One fortune. The Lattice bowed" },
  luckiest:     { title: "Fortune's Child",        quote: "The crystals whisper their names in the dark" },
  oneTile:      { title: "Precision Miner",        quote: "One tile. One truth. The Lattice reveals all" },
  mostWins:     { title: "Lattice Veteran",        quote: "The chain remembers every victory" },
  whales:       { title: "Deep Shaft Dweller",     quote: "The deeper you mine, the louder the Lattice hums" },
  underdog:     { title: "Shadow Miner",           quote: "Against all odds, the crystal answered" },
  luckyTile:    { title: "The Lattice's Favorite", quote: "Some tiles hold ancient resonance" },
};

// ── Empty states ────────────────────────────────────────────────────

export const emptyStates = {
  leaderboard: [
    "The mines are silent… no miners have ventured deep enough yet",
    "The Lattice sleeps. No names carved in crystal",
    "The shafts are empty. The chain awaits its first legends",
  ] as const,
  luckyTileGrid: [
    "No echoes from the Lattice in this range. The crystals sleep",
    "The tiles hold no wins yet in this span",
    "The grid is still. No lucky vein in sight",
  ] as const,
  leaderboardTab: [
    "Open this tab and let the Lattice reveal who dared to mine",
    "The chain remembers every miner. Let it show you who leads",
  ] as const,
  analytics: [
    "The ore veins lie untapped. Begin mining to trace your path",
    "No history yet. Stake your claim and the chain will remember",
    "The mines await your first swing. Analytics will follow",
  ] as const,
  rewards: [
    "The Lattice holds no unclaimed crystals for you… yet",
    "No rewards pulse in your name. Stake and wait",
    "The chain owes you nothing – yet. Keep mining",
  ] as const,
  chat: [
    "The echo chamber awaits its first voice…",
    "The mines are silent. Speak, miner",
  ] as const,
  chatSub: [
    "Speak into the void – Kael is listening",
    "Your words will echo through the Lattice",
  ] as const,
  transfers: [
    "No ore has moved through these tunnels",
    "The chain holds no record of your transfers here",
  ] as const,
};

// ── Kael quotes (sidebar footer) ────────────────────────────────────

export const kaelQuotes = [
  "The chain remembers every miner. The Lattice rewards the bold",
  "I was the first to hear its hum – but I will not be the last. Place your stake. Trust your instinct",
  "The ore awaits those who dare to mine",
  "Deep beneath the chain, the crystals whisper truth",
  "One swing. One fortune. The Lattice chooses",
  "The mines reward the patient and the bold",
  "Every tile holds a vein. Find yours",
  "The chain remembers every victory",
  "Stake your claim. The grid waits for no one",
  "The crystals hum when a miner finds the vein",
  "Patience and instinct – the pickaxe of the wise",
  "In the dark of the Lattice, only the bold dare mine",
  "Each epoch is a new chance. Each tile, a new hope",
  "The chain forgets nothing. Neither should you",
  "Fortune favors the miner who trusts the Lattice",
  "One tile. One truth. The ore reveals all",
  "The veins run deep. Deeper still run those who follow them",
  "I mined when the grid was young. The ore was no gentler then",
  "The Lattice chooses. The miner stakes. The chain remembers",
  "Dust and crystal – the path of every miner",
  "Sharpen your instinct. The next shift awaits",
  "The mines give to those who dare to ask",
  "Not every swing finds ore. But every swing teaches",
  "The crystal sings for those who listen",
  "Trust the Lattice. It has seen all before",
] as const;

// ── Maintenance overlay ─────────────────────────────────────────────

export const maintenance = {
  heading:   "The Crystal Lattice is Restructuring",
  body:      "Deep beneath the chain, the Lattice shifts and realigns. Kael watches over the mines while the crystals reform. The ore will flow again soon…",
  status:    "Lattice Recalibration in Progress",
  brand:     "LORE · The Chain Remembers",
} as const;
