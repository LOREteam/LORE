import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

export function runJackpotBannerPresentationTests() {
  const jackpotBannerSource = readFileSync("app/components/JackpotBanner.tsx", "utf8");
  assert.match(
    jackpotBannerSource,
    /"playlore\.xyz"/,
    "jackpot Share on X text must point users to playlore.xyz",
  );
  assert.match(
    jackpotBannerSource,
    /"#LORE #Linea"/,
    "jackpot Share on X hashtags must be on their own text line",
  );
  assert.doesNotMatch(
    jackpotBannerSource,
    /url:\s*sharePageUrl|hashtags:\s*"LORE,Linea"|Play:/,
    "jackpot Share on X must not append a long URL or Play: prefix",
  );
  assert.doesNotMatch(
    jackpotBannerSource,
    /https:\/\/lore\.game|Play: lore\.game/,
    "jackpot Share on X must not use the old lore.game share URL",
  );
  assert.doesNotMatch(
    jackpotBannerSource,
    /Math\.random/,
    "jackpot banner decorative overlays must stay deterministic to avoid hydration and visual-smoke noise",
  );
  assert.match(
    jackpotBannerSource,
    /function formatJackpotAmountText\(value: unknown\): string \| null[\s\S]*formatDecimalTextFixed\(String\(value \?\? ""\)\.trim\(\), JACKPOT_AMOUNT_FRACTION_DIGITS\)[\s\S]*fixedAmountToScaled\(fixed\) !== 0n/,
    "jackpot banner indexed/API amount display must canonical-parse decimal text before using compatibility numbers",
  );
  assert.match(
    jackpotBannerSource,
    /function formatJackpotAmountWei\(value: bigint \| null \| undefined\): string \| null[\s\S]*formatBalanceFixed\([\s\S]*decimals: 18[\s\S]*JACKPOT_AMOUNT_FRACTION_DIGITS/,
    "jackpot banner on-chain amount fallback must format raw bigint wei without Number(formatUnits()) precision loss",
  );
  assert.match(
    jackpotBannerSource,
    /function formatJackpotDisplayAmount\(text: string \| null\): string \| null[\s\S]*formatDecimalTextFixed\(text, JACKPOT_DISPLAY_FRACTION_DIGITS\)[\s\S]*replace\(\/\\B\(\?=\(\\d\{3\}\)\+\(\?!\\d\)\)\/g, ","\)/,
    "jackpot banner visible/share amount must group decimal text without toLocaleString number coercion",
  );
  assert.doesNotMatch(
    jackpotBannerSource,
    /Number\.parseFloat|formatUnits|toLocaleString/,
    "jackpot banner amount recovery and display must not use parseFloat, formatUnits, or number-locale formatting",
  );
  assert.match(
    jackpotBannerSource,
    /aria-label="Close jackpot banner"[\s\S]*h-12 w-12/,
    "jackpot close action must keep a 48px touch target for mobile users",
  );
  assert.match(
    jackpotBannerSource,
    /aria-describedby=\{descriptionId\}[\s\S]*<p id=\{descriptionId\} className="sr-only">\{jackpotDescription\}<\/p>/,
    "jackpot modal must expose the won amount, epoch, and tile as an accessible description",
  );
}
