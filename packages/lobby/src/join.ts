import { randomUUID } from 'node:crypto';
import {
  issueSession,
  type IssuedSession,
  type RandomBytesFn,
} from '@shaatir-shakuni/auth';
import {
  DISPLAY_NAME_TAKEN_MESSAGE,
  GAME_ALREADY_STARTED_MESSAGE,
  GENERIC_JOIN_REJECT_MESSAGE,
  MAX_PLAYERS,
  ROOM_FULL_MESSAGE,
} from './constants.js';
import { normalizeDisplayName, validateDisplayNameRaw } from './names.js';
import type { LobbyFail, LobbyPlayer, LobbyRoom } from './types.js';

export interface ExistingLobbySession {
  readonly sessionId: string;
  readonly playerId: string;
  readonly authToken: string;
}

export interface JoinRoomInput {
  /**
   * Room looked up by code, or null if no row / not visible.
   * Callers must not leak existence differences in messaging (EC-11).
   */
  readonly room: LobbyRoom | null;
  readonly displayName: string;
  readonly now: number;
  readonly socketId?: string | null;
  readonly playerId?: string;
  readonly sessionId?: string;
  readonly randomBytesFn?: RandomBytesFn;
  /**
   * If the client presents a session already bound to a player in this room,
   * reattach instead of creating a duplicate (EC-08).
   */
  readonly existingSession?: ExistingLobbySession | null;
}

export interface JoinRoomNewOk {
  readonly ok: true;
  readonly kind: 'JOINED';
  readonly room: LobbyRoom;
  readonly player: LobbyPlayer;
  readonly session: IssuedSession;
}

export interface JoinRoomReattachOk {
  readonly ok: true;
  readonly kind: 'REATTACH';
  readonly room: LobbyRoom;
  readonly player: LobbyPlayer;
  /** Existing session id — orch/reconnect rotates token separately. */
  readonly sessionId: string;
}

export interface JoinRoomReclaimOk {
  readonly ok: true;
  readonly kind: 'RECLAIM';
  readonly room: LobbyRoom;
  readonly player: LobbyPlayer;
  /** New token, same session id — persist via updateSession, not addSession. */
  readonly session: IssuedSession;
}

export type JoinRoomResult =
  | JoinRoomNewOk
  | JoinRoomReattachOk
  | JoinRoomReclaimOk
  | LobbyFail;

function genericNotJoinable(): LobbyFail {
  return {
    ok: false,
    code: 'ROOM_NOT_JOINABLE',
    message: GENERIC_JOIN_REJECT_MESSAGE,
  };
}

/**
 * Join a LOBBY room or reattach an existing in-room session (EC-08).
 */
export function joinRoom(input: JoinRoomInput): JoinRoomResult {
  const room = input.room;
  if (room === null) {
    return genericNotJoinable();
  }

  // EC-08: session already maps to a player in this room → reattach, ignore new name for identity
  if (input.existingSession) {
    const existing = room.players.find(
      (p) =>
        p.id === input.existingSession!.playerId &&
        p.sessionId === input.existingSession!.sessionId,
    );
    if (existing) {
      const reattached: LobbyPlayer = {
        ...existing,
        connectionStatus: 'CONNECTED',
      };
      const players = room.players.map((p) =>
        p.id === reattached.id ? reattached : p,
      );
      return {
        ok: true,
        kind: 'REATTACH',
        room: {
          ...room,
          players,
          hostAloneGraceStartedAt: null,
          emptySinceAt: null,
        },
        player: reattached,
        sessionId: input.existingSession.sessionId,
      };
    }
  }

  const nameFail = validateDisplayNameRaw(input.displayName);
  if (nameFail) return nameFail;

  const displayName = input.displayName.trim();
  const normalized = normalizeDisplayName(displayName);
  const nameMatch = room.players.find((p) => p.normalizedDisplayName === normalized);

  if (nameMatch) {
    // Vacant-seat reclaim: invite code + normalized name. Do not steal a live seat (EC-06).
    if (nameMatch.connectionStatus === 'CONNECTED') {
      return {
        ok: false,
        code: 'DISPLAY_NAME_TAKEN',
        message: DISPLAY_NAME_TAKEN_MESSAGE,
      };
    }
    if (!nameMatch.sessionId) {
      return genericNotJoinable();
    }
    const session = issueSession({
      playerId: nameMatch.id,
      now: input.now,
      socketId: input.socketId ?? null,
      sessionId: nameMatch.sessionId,
      randomBytesFn: input.randomBytesFn,
    });
    const reclaimed: LobbyPlayer = {
      ...nameMatch,
      connectionStatus: 'CONNECTED',
      sessionId: session.id,
    };
    return {
      ok: true,
      kind: 'RECLAIM',
      room: {
        ...room,
        players: room.players.map((p) => (p.id === reclaimed.id ? reclaimed : p)),
        hostAloneGraceStartedAt: null,
        emptySinceAt: null,
      },
      player: reclaimed,
      session,
    };
  }

  if (room.status === 'IN_PROGRESS' || room.status === 'GAME_OVER') {
    return {
      ok: false,
      code: 'GAME_ALREADY_STARTED',
      message: GAME_ALREADY_STARTED_MESSAGE,
    };
  }

  if (room.status !== 'LOBBY') {
    // EXPIRED / ARCHIVED / ABANDONED / etc. — non-enumerating (EC-11)
    return genericNotJoinable();
  }

  if (room.players.length >= MAX_PLAYERS) {
    return {
      ok: false,
      code: 'ROOM_FULL',
      message: ROOM_FULL_MESSAGE,
    };
  }

  const playerId = input.playerId ?? randomUUID();
  const session = issueSession({
    playerId,
    now: input.now,
    socketId: input.socketId ?? null,
    sessionId: input.sessionId,
    randomBytesFn: input.randomBytesFn,
  });

  const nextSeat =
    room.players.length === 0
      ? 0
      : Math.max(...room.players.map((p) => p.seatOrder)) + 1;

  const player: LobbyPlayer = {
    id: playerId,
    displayName,
    normalizedDisplayName: normalized,
    seatOrder: nextSeat,
    connectionStatus: 'CONNECTED',
    joinedAt: input.now,
    sessionId: session.id,
  };

  return {
    ok: true,
    kind: 'JOINED',
    room: {
      ...room,
      players: [...room.players, player],
      hostAloneGraceStartedAt: null,
      emptySinceAt: null,
    },
    player,
    session,
  };
}
