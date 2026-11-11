import { createInitialState } from '@shaatir-shakuni/engine';
import type { RoomRuntime } from './room-runtime.js';

/**
 * Mirror lobby membership into engine GameState while phase is LOBBY so
 * broadcastRoomState can emit roster + host + rebalance to clients.
 * Bumps stateVersion so clients track lobby mutations.
 */
export function syncLobbyIntoGameState(runtime: RoomRuntime): void {
  if (!runtime.gameState) {
    runtime.gameState = createInitialState(runtime.roomId, runtime.lobby.hostPlayerId);
  }

  const state = runtime.gameState;
  if (state.phase.kind !== 'LOBBY') {
    return;
  }

  runtime.gameState = {
    ...state,
    hostPlayerId: runtime.lobby.hostPlayerId,
    rebalanceEnabled: runtime.lobby.rebalanceEnabled,
    players: runtime.lobby.players.map((p) => ({
      id: p.id,
      displayName: p.displayName,
      seatOrder: p.seatOrder,
      role: null,
      isAlive: true,
    })),
    stateVersion: state.stateVersion + 1,
  };
}

/**
 * Replace a finished (or leftover) game with a fresh LOBBY engine state,
 * preserving/bumping stateVersion so clients accept the rematch update.
 */
export function resetGameStateForRematch(
  runtime: RoomRuntime,
  previousStateVersion: number,
): void {
  const initial = createInitialState(runtime.roomId, runtime.lobby.hostPlayerId);
  runtime.gameState = {
    ...initial,
    hostPlayerId: runtime.lobby.hostPlayerId,
    rebalanceEnabled: runtime.lobby.rebalanceEnabled,
    phase: { kind: 'LOBBY' },
    stateVersion: previousStateVersion,
  };
  syncLobbyIntoGameState(runtime);
}
