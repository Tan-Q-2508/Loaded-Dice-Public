import type { LobbyPlayer } from './types.js';

/**
 * EC-03: oldest-connected remaining player becomes host.
 * Prefer CONNECTED players by earliest `joinedAt`, then `seatOrder`.
 * If none CONNECTED, fall back to earliest joined among all remaining.
 */
export function selectOldestConnectedHost(
  players: readonly LobbyPlayer[],
): string | null {
  if (players.length === 0) {
    return null;
  }
  const connected = players.filter((p) => p.connectionStatus === 'CONNECTED');
  const pool = connected.length > 0 ? connected : [...players];
  const sorted = [...pool].sort((a, b) => {
    if (a.joinedAt !== b.joinedAt) {
      return a.joinedAt - b.joinedAt;
    }
    return a.seatOrder - b.seatOrder;
  });
  return sorted[0]?.id ?? null;
}

/**
 * EC-18: returning player after host migration never auto-reclaims host.
 * Mirrors `@shaatir-shakuni/auth` `resolveHostOnReconnect`.
 */
export function resolveLobbyHostOnReconnect(input: {
  readonly roomHostPlayerId: string;
  readonly reconnectingPlayerId: string;
}): {
  readonly hostPlayerId: string;
  readonly isCurrentHost: boolean;
  readonly reclaimedHost: false;
} {
  return {
    hostPlayerId: input.roomHostPlayerId,
    isCurrentHost: input.roomHostPlayerId === input.reconnectingPlayerId,
    reclaimedHost: false,
  };
}
