import { JackpotBanner } from "../../components/JackpotBanner";

export default function JackpotPreviewPage() {
  return (
    <main className="min-h-screen bg-[#060612]">
      <JackpotBanner
        winningTileId={3}
        isRevealing
        tileViewData={[
          { tileId: 1, hasMyBet: false },
          { tileId: 2, hasMyBet: false },
          { tileId: 3, hasMyBet: true },
          { tileId: 4, hasMyBet: false },
        ]}
        epoch="1284"
        walletAddress="0x1234567890abcdef1234567890abcdef12345678"
        isDailyJackpot
        jackpotAmount={40}
        hasMyWinningBet
        reducedMotion={false}
      />
    </main>
  );
}
