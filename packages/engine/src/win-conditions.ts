import type { GameState, Team, WinReason, GameEvent } from './types.js';
import { getPlayer } from './state-helpers.js';

export function checkDecreeWin(
  state: GameState,
): { winner: Team; reason: WinReason } | null {
  if (state.enactedDharma >= 5) {
    return { winner: 'PANDAVA', reason: 'DHARMA_DECREES' };
  }
  if (state.enactedAdharma >= 6) {
    return { winner: 'KAURAVA', reason: 'ADHARMA_DECREES' };
  }
  return null;
}

export function checkDuryodhanaSenapatiWin(
  state: GameState,
  senapatiId: string,
): { winner: Team; reason: WinReason } | null {
  const player = getPlayer(state, senapatiId);
  if (!player || player.role !== 'DURYODHANA') return null;
  if (state.enactedAdharma >= 3) {
    return { winner: 'KAURAVA', reason: 'DURYODHANA_SENAPATI' };
  }
  return null;
}

export function checkVanvasWin(
  state: GameState,
  targetId: string,
): { winner: Team; reason: WinReason } | null {
  const player = getPlayer(state, targetId);
  if (player?.role === 'DURYODHANA') {
    return { winner: 'PANDAVA', reason: 'DURYODHANA_VANVAS' };
  }
  return null;
}

export function applyGameOver(
  state: GameState,
  winner: Team,
  reason: WinReason,
  events: GameEvent[] = [],
): { state: GameState; events: GameEvent[] } {
  return {
    state: {
      ...state,
      phase: { kind: 'GAME_OVER', winner, reason },
      currentGovernment: null,
      stateVersion: state.stateVersion + 1,
    },
    events: [
      ...events,
      { type: 'WIN_CONDITION_MET', winner, reason },
      { type: 'PHASE_CHANGED', from: state.phase.kind, to: 'GAME_OVER' },
    ],
  };
}
