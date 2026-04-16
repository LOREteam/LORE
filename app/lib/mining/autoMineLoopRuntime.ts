import { delay } from "../utils";
import { log } from "../logger";
import type { AutoMineLoopRuntimeCommand } from "./autoMineLoopRuntimeCommand";
import type {
  AutoMineLoopSelection,
  AutoMineLoopSessionCheckpoint,
  AutoMineLoopState,
} from "./autoMineLoopModel";

interface CompleteRoundArgs {
  betStr: string;
  blocks: number;
  rounds: number;
  roundIndex: number;
  placedEpoch: bigint;
  displayTiles?: number[];
  displayEpoch?: bigint;
  progressMessage?: string;
  announceBet?: boolean;
}

export interface AutoMineLoopStateEffects {
  progress?: boolean;
  selection?: boolean;
  session?: boolean;
}

export interface AutoMineLoopRuntime {
  getNow(): number;
  handleConfirmedRound(params: {
    placedEpoch: bigint;
    progressMessage?: string | null;
    roundIndex: number;
    tilesToBet: number[];
  }): Promise<void>;
  handleEpochReady(params: {
    blocks: number;
    roundIndex: number;
    rounds: number;
  }): void | Promise<void>;
  handleSessionRefresh(refreshSession: () => Promise<void>): Promise<number | null>;
  readRefreshSession(): (() => Promise<void>) | undefined;
  renewLock(): void;
  runCommands(commands: AutoMineLoopRuntimeCommand[]): Promise<void>;
  syncState(state: AutoMineLoopState, effects?: AutoMineLoopStateEffects): void;
}

interface CreateAutoMineLoopRuntimeOptions {
  betStr: string;
  blocks: number;
  completeAutoMineRound: (args: CompleteRoundArgs) => Promise<void>;
  getNow?: () => number;
  onAutoMineBetConfirmed?: () => void;
  onProgress: (message: string) => void;
  onRefetchEpoch?: () => void;
  onSaveSession: (payload: {
    active: boolean;
    betStr: string;
    blocks: number;
    rounds: number;
    nextRoundIndex: number;
    lastPlacedEpoch: string | null;
  }) => void;
  pendingBetRef: { current: unknown | null };
  readRefreshSession: () => (() => Promise<void>) | undefined;
  renewLock: () => void;
  rounds: number;
  setSelection: (tiles: number[], epoch: string | null) => void;
  sleep?: (ms: number) => Promise<void>;
}

function applySelection(
  setSelection: (tiles: number[], epoch: string | null) => void,
  selection: AutoMineLoopSelection,
) {
  setSelection(selection.tiles, selection.epoch);
}

function persistCheckpoint(params: {
  betStr: string;
  blocks: number;
  rounds: number;
  checkpoint: AutoMineLoopSessionCheckpoint;
  onSaveSession: CreateAutoMineLoopRuntimeOptions["onSaveSession"];
}) {
  const { betStr, blocks, rounds, checkpoint, onSaveSession } = params;
  onSaveSession({
    active: true,
    betStr,
    blocks,
    rounds,
    nextRoundIndex: checkpoint.nextRoundIndex,
    lastPlacedEpoch: checkpoint.lastPlacedEpoch,
  });
}

export function createAutoMineLoopRuntime({
  betStr,
  blocks,
  completeAutoMineRound,
  getNow = Date.now,
  onAutoMineBetConfirmed,
  onProgress,
  onRefetchEpoch,
  onSaveSession,
  pendingBetRef,
  readRefreshSession,
  renewLock,
  rounds,
  setSelection,
  sleep = delay,
}: CreateAutoMineLoopRuntimeOptions): AutoMineLoopRuntime {
  return {
    getNow() {
      return getNow();
    },
    async runCommands(commands) {
      for (const command of commands) {
        switch (command.type) {
          case "clear-pending-bet":
            pendingBetRef.current = null;
            break;

          case "sleep":
            await sleep(command.ms);
            break;

          case "confirmation-start":
            if (command.clearSelection) {
              setSelection([], null);
            }
            onProgress(command.progressMessage);
            if (command.refetchEpoch) {
              onRefetchEpoch?.();
            }
            break;
        }
      }
    },
    async handleConfirmedRound({
      placedEpoch,
      progressMessage,
      roundIndex,
      tilesToBet,
    }) {
      onAutoMineBetConfirmed?.();
      await completeAutoMineRound({
        betStr,
        blocks,
        rounds,
        roundIndex,
        placedEpoch,
        displayTiles: tilesToBet,
        displayEpoch: placedEpoch,
        progressMessage: progressMessage ?? `${roundIndex + 1} / ${rounds} - confirmed (detected on-chain)`,
        announceBet: false,
      });
    },
    async handleEpochReady({ blocks, roundIndex, rounds }) {
      onRefetchEpoch?.();
      onProgress(`${roundIndex} / ${rounds} - placing bet (${blocks} tiles)...`);
    },
    async handleSessionRefresh(refreshSession) {
      try {
        await refreshSession();
        const refreshedAt = getNow();
        log.info("AutoMine", "session refreshed");
        return refreshedAt;
      } catch (error) {
        log.warn("AutoMine", "session refresh failed (continuing)", error);
        return null;
      }
    },
    readRefreshSession,
    renewLock,
    syncState(state, effects = {}) {
      const { progress = true, selection = true, session = true } = effects;

      if (selection) {
        applySelection(setSelection, state.selection);
      }
      if (progress && state.progressMessage) {
        onProgress(state.progressMessage);
      }
      if (session && state.sessionCheckpoint) {
        persistCheckpoint({
          betStr,
          blocks,
          rounds,
          checkpoint: state.sessionCheckpoint,
          onSaveSession,
        });
      }
    },
  };
}
