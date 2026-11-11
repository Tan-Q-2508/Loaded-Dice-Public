import { randomUUID } from 'node:crypto';
import {
  issueSession,
  type IssuedSession,
  type RandomBytesFn,
} from '@shaatir-shakuni/auth';
import type { AllocateRoomCodeResult } from './room-code.js';
import { validateDisplayNameRaw, normalizeDisplayName } from './names.js';
import type { LobbyFail, LobbyPlayer, LobbyRoom } from './types.js';

export interface CreateRoomInput {
  readonly displayName: string;
  readonly now: number;
  readonly rebalanceEnabled?: boolean;
  readonly socketId?: string | null;
  readonly roomId?: string;
  readonly playerId?: string;
  readonly sessionId?: string;
  readonly randomBytesFn?: RandomBytesFn;
  /** Caller supplies allocation (typically wraps `allocateRoomCode` + DB lookup). */
  readonly allocateCode: () => AllocateRoomCodeResult;
}

export interface CreateRoomOk {
  readonly ok: true;
  readonly room: LobbyRoom;
  readonly hostPlayer: LobbyPlayer;
  readonly session: IssuedSession;
}

export type CreateRoomResult = CreateRoomOk | LobbyFail;

/**
 * Plan a new LOBBY room with host player + issued session.
 * Orchestration persists the returned entities.
 */
export function createRoom(input: CreateRoomInput): CreateRoomResult {
  const nameFail = validateDisplayNameRaw(input.displayName);
  if (nameFail) return nameFail;

  const allocated = input.allocateCode();
  if (!allocated.ok) return allocated;

  const displayName = input.displayName.trim();
  const playerId = input.playerId ?? randomUUID();
  const roomId = input.roomId ?? randomUUID();
  const session = issueSession({
    playerId,
    now: input.now,
    socketId: input.socketId ?? null,
    sessionId: input.sessionId,
    randomBytesFn: input.randomBytesFn,
  });

  const hostPlayer: LobbyPlayer = {
    id: playerId,
    displayName,
    normalizedDisplayName: normalizeDisplayName(displayName),
    seatOrder: 0,
    connectionStatus: 'CONNECTED',
    joinedAt: input.now,
    sessionId: session.id,
  };

  const room: LobbyRoom = {
    id: roomId,
    roomCode: allocated.roomCode,
    hostPlayerId: playerId,
    status: 'LOBBY',
    rebalanceEnabled: input.rebalanceEnabled ?? false,
    players: [hostPlayer],
    hostAloneGraceStartedAt: null,
    emptySinceAt: null,
  };

  return { ok: true, room, hostPlayer, session };
}
