import { NOT_LOBBY_MESSAGE, PLAYER_NOT_IN_ROOM_MESSAGE } from './constants.js';
import { selectOldestConnectedHost } from './host.js';
import type { LobbyFail, LobbyPlayer, LobbyRoom } from './types.js';

export interface LeaveLobbyInput {
  readonly room: LobbyRoom;
  readonly playerId: string;
  readonly now: number;
}

export interface LeaveLobbyOk {
  readonly ok: true;
  readonly room: LobbyRoom;
  /** True when the leaving player was host and a new host was selected. */
  readonly hostMigrated: boolean;
  readonly previousHostPlayerId: string;
  readonly roomEmpty: boolean;
}

export type LeaveLobbyResult = LeaveLobbyOk | LobbyFail;

/**
 * EC-12: free seat and **compact** remaining seat_order to 0..n-1 (stable by prior order).
 * EC-03: if host leaves and others remain, promote oldest-connected remaining player.
 */
export function leaveLobby(input: LeaveLobbyInput): LeaveLobbyResult {
  const { room, playerId, now } = input;

  if (room.status !== 'LOBBY') {
    return {
      ok: false,
      code: 'NOT_LOBBY',
      message: NOT_LOBBY_MESSAGE,
    };
  }

  const leaving = room.players.find((p) => p.id === playerId);
  if (!leaving) {
    return {
      ok: false,
      code: 'PLAYER_NOT_IN_ROOM',
      message: PLAYER_NOT_IN_ROOM_MESSAGE,
    };
  }

  const remainingUnordered = room.players.filter((p) => p.id !== playerId);
  const remaining = compactSeats(remainingUnordered);

  const previousHostPlayerId = room.hostPlayerId;
  let hostPlayerId = room.hostPlayerId;
  let hostMigrated = false;

  if (remaining.length === 0) {
    return {
      ok: true,
      room: {
        ...room,
        hostPlayerId,
        players: [],
        hostAloneGraceStartedAt: null,
        emptySinceAt: now,
      },
      hostMigrated: false,
      previousHostPlayerId,
      roomEmpty: true,
    };
  }

  if (playerId === room.hostPlayerId) {
    const nextHost = selectOldestConnectedHost(remaining);
    if (nextHost !== null) {
      hostPlayerId = nextHost;
      hostMigrated = nextHost !== previousHostPlayerId;
    }
  }

  return {
    ok: true,
    room: {
      ...room,
      hostPlayerId,
      players: remaining,
      hostAloneGraceStartedAt: null,
      emptySinceAt: null,
    },
    hostMigrated,
    previousHostPlayerId,
    roomEmpty: false,
  };
}

/** Compact seat_order to 0..n-1 preserving relative order by prior seatOrder then id. */
export function compactSeats(players: readonly LobbyPlayer[]): LobbyPlayer[] {
  const sorted = [...players].sort((a, b) => {
    if (a.seatOrder !== b.seatOrder) return a.seatOrder - b.seatOrder;
    return a.id.localeCompare(b.id);
  });
  return sorted.map((p, index) => ({ ...p, seatOrder: index }));
}

export interface MarkHostDisconnectedAloneInput {
  readonly room: LobbyRoom;
  readonly now: number;
}

/**
 * EC-02: when the host disconnects and is the only member, start grace tracking.
 * Does not delete — call `evaluateHostGrace` later.
 */
export function markHostDisconnectedAlone(
  input: MarkHostDisconnectedAloneInput,
): LobbyRoom {
  const { room, now } = input;
  if (room.status !== 'LOBBY') return room;
  if (room.players.length !== 1) return room;
  const only = room.players[0];
  if (!only || only.id !== room.hostPlayerId) return room;

  const players: LobbyPlayer[] = [
    { ...only, connectionStatus: 'DISCONNECTED' },
  ];

  return {
    ...room,
    players,
    hostAloneGraceStartedAt: now,
  };
}
