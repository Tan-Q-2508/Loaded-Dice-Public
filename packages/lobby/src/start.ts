import type { GameAction } from '@shaatir-shakuni/engine';
import {
  BAD_PLAYER_COUNT_MESSAGE,
  MAX_PLAYERS,
  MIN_PLAYERS_TO_START,
  NOT_HOST_MESSAGE,
  NOT_LOBBY_MESSAGE,
} from './constants.js';
import type { LobbyFail, LobbyRoom } from './types.js';

export interface StartGameEligibility {
  readonly canStart: boolean;
  readonly reason: LobbyFail | null;
  readonly playerCount: number;
}

export function canStartGame(
  room: LobbyRoom,
  actorPlayerId: string,
): StartGameEligibility {
  const playerCount = room.players.length;

  if (room.status !== 'LOBBY') {
    return {
      canStart: false,
      playerCount,
      reason: { ok: false, code: 'NOT_LOBBY', message: NOT_LOBBY_MESSAGE },
    };
  }

  if (actorPlayerId !== room.hostPlayerId) {
    return {
      canStart: false,
      playerCount,
      reason: { ok: false, code: 'NOT_HOST', message: NOT_HOST_MESSAGE },
    };
  }

  if (playerCount < MIN_PLAYERS_TO_START || playerCount > MAX_PLAYERS) {
    return {
      canStart: false,
      playerCount,
      reason: {
        ok: false,
        code: 'BAD_PLAYER_COUNT',
        message: BAD_PLAYER_COUNT_MESSAGE,
      },
    };
  }

  return { canStart: true, playerCount, reason: null };
}

export interface BuildStartGameActionInput {
  readonly room: LobbyRoom;
  readonly actorPlayerId: string;
  readonly seed: number;
}

export interface BuildStartGameActionOk {
  readonly ok: true;
  readonly action: Extract<GameAction, { type: 'START_GAME' }>;
}

export type BuildStartGameActionResult = BuildStartGameActionOk | LobbyFail;

/**
 * Host-only start when membership ∈ [5, 10]. Returns engine START_GAME inputs;
 * orchestration applies via `applyAction`.
 */
export function buildStartGameAction(
  input: BuildStartGameActionInput,
): BuildStartGameActionResult {
  const eligibility = canStartGame(input.room, input.actorPlayerId);
  if (!eligibility.canStart) {
    return eligibility.reason ?? {
      ok: false,
      code: 'BAD_PLAYER_COUNT',
      message: BAD_PLAYER_COUNT_MESSAGE,
    };
  }

  const ordered = [...input.room.players].sort(
    (a, b) => a.seatOrder - b.seatOrder,
  );
  const playerIds = ordered.map((p) => p.id);
  const displayNames: Record<string, string> = {};
  for (const p of ordered) {
    displayNames[p.id] = p.displayName;
  }

  return {
    ok: true,
    action: {
      type: 'START_GAME',
      playerIds,
      displayNames,
      hostPlayerId: input.room.hostPlayerId,
      rebalanceEnabled: input.room.rebalanceEnabled,
      seed: input.seed,
    },
  };
}
