import { HOST_ALONE_GRACE_MS, LOBBY_IDLE_MS } from './constants.js';
import type { LobbyRoom } from './types.js';

export type HostGraceDisposition = 'HOLD' | 'DELETE' | 'NOT_APPLICABLE';
export type LobbyIdleDisposition = 'HOLD' | 'EXPIRE' | 'NOT_APPLICABLE';

export interface EvaluateHostGraceInput {
  readonly room: LobbyRoom;
  readonly now: number;
  readonly graceMs?: number;
}

/**
 * EC-02: host alone disconnected — after grace, delete the room.
 * If others joined or host reconnected, grace should already be cleared by callers.
 */
export function evaluateHostGrace(
  input: EvaluateHostGraceInput,
): HostGraceDisposition {
  const { room, now } = input;
  const graceMs = input.graceMs ?? HOST_ALONE_GRACE_MS;

  if (room.status !== 'LOBBY') return 'NOT_APPLICABLE';
  if (room.hostAloneGraceStartedAt === null) return 'NOT_APPLICABLE';
  if (room.players.length !== 1) return 'NOT_APPLICABLE';

  const only = room.players[0];
  if (!only || only.id !== room.hostPlayerId) return 'NOT_APPLICABLE';
  if (only.connectionStatus === 'CONNECTED') return 'NOT_APPLICABLE';

  if (now - room.hostAloneGraceStartedAt >= graceMs) {
    return 'DELETE';
  }
  return 'HOLD';
}

export interface EvaluateLobbyIdleInput {
  readonly room: LobbyRoom;
  readonly now: number;
  readonly idleMs?: number;
}

/**
 * EC-04 lobby half: empty LOBBY → expire after idle timeout.
 * IN_PROGRESS empty rooms are NOT handled here (04-reconnect).
 */
export function evaluateLobbyIdle(
  input: EvaluateLobbyIdleInput,
): LobbyIdleDisposition {
  const { room, now } = input;
  const idleMs = input.idleMs ?? LOBBY_IDLE_MS;

  if (room.status === 'IN_PROGRESS') return 'NOT_APPLICABLE';
  if (room.status !== 'LOBBY') return 'NOT_APPLICABLE';
  if (room.players.length > 0) return 'NOT_APPLICABLE';
  if (room.emptySinceAt === null) return 'NOT_APPLICABLE';

  if (now - room.emptySinceAt >= idleMs) {
    return 'EXPIRE';
  }
  return 'HOLD';
}
