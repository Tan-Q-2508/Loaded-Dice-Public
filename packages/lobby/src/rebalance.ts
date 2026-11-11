import { NOT_HOST_MESSAGE, NOT_LOBBY_MESSAGE } from './constants.js';
import type { LobbyFail, LobbyRoom } from './types.js';

export interface SetRebalanceInput {
  readonly room: LobbyRoom;
  readonly actorPlayerId: string;
  readonly rebalanceEnabled: boolean;
}

export interface SetRebalanceOk {
  readonly ok: true;
  readonly room: LobbyRoom;
}

export type SetRebalanceResult = SetRebalanceOk | LobbyFail;

/** Host-only, LOBBY-only rebalance toggle (master spec §3 / §5.1). */
export function setRebalance(input: SetRebalanceInput): SetRebalanceResult {
  const { room, actorPlayerId, rebalanceEnabled } = input;

  if (room.status !== 'LOBBY') {
    return {
      ok: false,
      code: 'NOT_LOBBY',
      message: NOT_LOBBY_MESSAGE,
    };
  }

  if (actorPlayerId !== room.hostPlayerId) {
    return {
      ok: false,
      code: 'NOT_HOST',
      message: NOT_HOST_MESSAGE,
    };
  }

  return {
    ok: true,
    room: {
      ...room,
      rebalanceEnabled,
    },
  };
}
