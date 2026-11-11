import { selectOldestConnectedHost } from './host.js';
import { compactSeats } from './leave.js';
import type { LobbyRoom } from './types.js';

export interface ResetToRematchLobbyInput {
  readonly room: LobbyRoom;
  readonly now: number;
}

export interface ResetToRematchLobbyOk {
  readonly ok: true;
  readonly room: LobbyRoom;
  readonly hostMigrated: boolean;
}

/**
 * Room-lifecycle rematch: same room id + code, keep membership, return to LOBBY.
 * Not an engine win-condition action.
 */
export function resetToRematchLobby(
  input: ResetToRematchLobbyInput,
): ResetToRematchLobbyOk {
  const players = compactSeats(input.room.players);
  const currentHost = players.find((p) => p.id === input.room.hostPlayerId);
  let hostPlayerId = input.room.hostPlayerId;
  let hostMigrated = false;

  if (!currentHost || currentHost.connectionStatus !== 'CONNECTED') {
    const nextHost = selectOldestConnectedHost(players);
    if (nextHost !== null && nextHost !== hostPlayerId) {
      hostPlayerId = nextHost;
      hostMigrated = true;
    }
  }

  return {
    ok: true,
    room: {
      ...input.room,
      status: 'LOBBY',
      hostPlayerId,
      players,
      hostAloneGraceStartedAt: null,
      emptySinceAt: players.length === 0 ? input.now : null,
    },
    hostMigrated,
  };
}
