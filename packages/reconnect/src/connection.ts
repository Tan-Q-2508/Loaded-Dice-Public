import type { ConnectionStatus } from '@shaatir-shakuni/db';

/** Session fields this layer mutates on connect/disconnect (auth owns token crypto). */
export type SessionHandle = {
  readonly id: string;
  readonly playerId: string;
  readonly authToken: string;
  readonly socketId: string | null;
  readonly lastSeenAtMs: number;
};

export type PlayerConnectionHandle = {
  readonly id: string;
  readonly roomId: string;
  readonly sessionId: string | null;
  readonly connectionStatus: ConnectionStatus;
  readonly isAlive: boolean;
};

export type DisconnectResult = {
  readonly player: PlayerConnectionHandle;
  readonly session: SessionHandle;
};

/**
 * Socket drop: clear socket binding and mark DISCONNECTED.
 * Session row is retained so reconnect can re-attach (Section 6).
 */
export function applyDisconnect(
  player: PlayerConnectionHandle,
  session: SessionHandle,
  nowMs: number,
): DisconnectResult {
  if (session.playerId !== player.id) {
    throw new Error('Session playerId does not match player.id');
  }
  return {
    player: {
      ...player,
      connectionStatus: 'DISCONNECTED',
    },
    session: {
      ...session,
      socketId: null,
      lastSeenAtMs: nowMs,
    },
  };
}

export type AttachOk = {
  readonly ok: true;
  readonly player: PlayerConnectionHandle;
  readonly session: SessionHandle;
  /** Previous socket id, if any — orchestration may demote it (EC-16 / 07-auth). */
  readonly previousSocketId: string | null;
};

export type AttachFail = {
  readonly ok: false;
  readonly code: 'SESSION_PLAYER_MISMATCH' | 'SESSION_TOKEN_MISMATCH';
  readonly message: string;
};

export type AttachResult = AttachOk | AttachFail;

export type AttachInput = {
  readonly player: PlayerConnectionHandle;
  readonly session: SessionHandle;
  /** Token presented on `session:reconnect` — must equal session.authToken. */
  readonly presentedAuthToken: string;
  readonly newSocketId: string;
  readonly nowMs: number;
};

/**
 * EC-08 / EC-25 / EC-26: re-attach a new socket to the existing Session/Player.
 * Does not create a Player. Token rotation is `07-auth` (call after attach succeeds).
 */
export function attachSession(input: AttachInput): AttachResult {
  const { player, session, presentedAuthToken, newSocketId, nowMs } = input;

  if (session.playerId !== player.id) {
    return {
      ok: false,
      code: 'SESSION_PLAYER_MISMATCH',
      message: 'Session is not bound to this player',
    };
  }

  if (player.sessionId !== null && player.sessionId !== session.id) {
    return {
      ok: false,
      code: 'SESSION_PLAYER_MISMATCH',
      message: 'Player is bound to a different session',
    };
  }

  if (presentedAuthToken !== session.authToken) {
    return {
      ok: false,
      code: 'SESSION_TOKEN_MISMATCH',
      message: 'Invalid session token',
    };
  }

  return {
    ok: true,
    previousSocketId: session.socketId,
    player: {
      ...player,
      sessionId: session.id,
      connectionStatus: 'CONNECTED',
    },
    session: {
      ...session,
      socketId: newSocketId,
      lastSeenAtMs: nowMs,
    },
  };
}

/** Mark RECONNECTING while a reconnect attempt is in flight (optional UX status). */
export function markReconnecting(player: PlayerConnectionHandle): PlayerConnectionHandle {
  return { ...player, connectionStatus: 'RECONNECTING' };
}
