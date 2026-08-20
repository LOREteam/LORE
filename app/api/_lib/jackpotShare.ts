import { readJackpotPayload } from "./jackpotsService";
import { selectVerifiedJackpotShare, type VerifiedJackpotShare } from "../../lib/jackpotShareVerification";

export type { VerifiedJackpotShare } from "../../lib/jackpotShareVerification";

export async function readVerifiedJackpotShare(txHash: string | null | undefined): Promise<VerifiedJackpotShare | null> {
  const { payload } = await readJackpotPayload();
  return selectVerifiedJackpotShare(payload.jackpots, txHash);
}
