import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as jackpotBannerModule from "../app/components/JackpotBanner.tsx";

export function runJackpotBannerPresentationTests() {
  const jackpotBannerSource = readFileSync("app/components/JackpotBanner.tsx", "utf8");
  const jackpotBanner = jackpotBannerModule.default ?? jackpotBannerModule;
  assert.match(
    jackpotBannerSource,
    /import \{ GAME_EVENTS_ABI \} from "\.\.\/\.\.\/config\/generated\/lineaOreV10Abi"[\s\S]*function getGameEvent<Name extends \(typeof GAME_EVENTS_ABI\)\[number\]\["name"\]>[\s\S]*GAME_EVENTS_ABI\.find[\s\S]*Missing generated game event[\s\S]*getGameEvent\("DailyJackpotAwarded"\)[\s\S]*getGameEvent\("WeeklyJackpotAwarded"\)[\s\S]*getGameEvent\("EpochResolved"\)/,
    "jackpot on-chain log fallback must source every event fragment from the generated V10 ABI snapshot",
  );
  assert.doesNotMatch(
    jackpotBannerSource,
    /parseAbiItem|event (?:DailyJackpotAwarded|WeeklyJackpotAwarded|EpochResolved)\(/,
    "jackpot on-chain log fallback must not define local ABI event strings",
  );
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
  assert.equal(
    jackpotBanner.formatJackpotAmountText("9007199254740993.1234567"),
    "9007199254740993.123457",
    "indexed jackpot decimal text must round exactly without Number precision loss",
  );
  for (const invalidAmount of ["0", "bad", Infinity, null]) {
    assert.equal(
      jackpotBanner.formatJackpotAmountText(invalidAmount),
      null,
      `indexed jackpot amount ${String(invalidAmount)} must not create a displayable payout`,
    );
  }
  assert.equal(
    jackpotBanner.formatJackpotAmountWei(9007199254740993123456789n),
    "9007199.254741",
    "on-chain jackpot wei must retain exact bigint rounding without formatUnits coercion",
  );
  assert.equal(jackpotBanner.formatJackpotAmountWei(0n), null);
  assert.equal(jackpotBanner.formatJackpotAmountWei(null), null);
  assert.equal(
    jackpotBanner.formatJackpotDisplayAmount("12345678901234567890.123456"),
    "12,345,678,901,234,567,890.1235",
    "visible and shared jackpot text must group exact decimal text without number-locale coercion",
  );
  assert.equal(jackpotBanner.formatJackpotDisplayAmount("1000.000001"), "1,000");
  assert.equal(jackpotBanner.formatJackpotDisplayAmount("bad"), null);
  assert.equal(jackpotBanner.formatJackpotDisplayAmount(null), null);
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
