import { randomUUID } from 'node:crypto';
import type { RejectReasonCode } from '@shaatir-shakuni/socket-api';
import {
  ACTION_BLOCKED_ROOM_STATUSES,
  SESSION_EXPIRED_MESSAGE,
  SESSION_FORCE_EXPIRED_ROOM_STATUSES,
  SESSION_IDLE_TTL_MS,
  UNAUTHORIZED_SESSION_MESSAGE,
} from './constants.js';
import { authTokensEqual, generateAuthToken, type RandomBytesFn } from './token.js';

/** In-memory shape matching DB Session fields needed for auth decisions. */
export interface SessionRecord {
  readonly id: string;
  readonly playerId: string;
  readonly authToken: string;
  readonly socketId: string | null;
  readonly lastSeenAt: number;
}

export interface IssuedSession {
  readonly id: string;
  readonly playerId: string;
  readonly authToken: string;
  readonly socketId: string | null;
  readonly lastSeenAt: number;
}

export interface IssueSessionInput {
  readonly playerId: string;
  readonly now: number;
  readonly socketId?: string | null;
  /** Inject for tests; production callers omit and get a random UUID. */
  readonly sessionId?: string;
  readonly randomBytesFn?: RandomBytesFn;
}

export function issueSession(input: IssueSessionInput): IssuedSession {
  return {
    id: input.sessionId ?? randomUUID(),
    playerId: input.playerId,
    authToken: generateAuthToken(input.randomBytesFn),
    socketId: input.socketId ?? null,
    lastSeenAt: input.now,
  };
}

export function isSessionIdleExpired(
  lastSeenAt: number,
  now: number,
  idleTtlMs: number = SESSION_IDLE_TTL_MS,
): boolean {
  return now - lastSeenAt > idleTtlMs;
}

export function isRoomStatusForceExpired(roomStatus: string): boolean {
  return (SESSION_FORCE_EXPIRED_ROOM_STATUSES as readonly string[]).includes(roomStatus);
}

export function isActionBlockedRoomStatus(roomStatus: string): boolean {
  return (ACTION_BLOCKED_ROOM_STATUSES as readonly string[]).includes(roomStatus);
}

export interface ValidateSessionOk {
  readonly ok: true;
  readonly sessionId: string;
  readonly playerId: string;
  /** Identity always comes from the session row — never from claimedPlayerId (EC-109). */
  readonly ignoredClaimedPlayerId: string | null;
}

export interface ValidateSessionFail {
  readonly ok: false;
  readonly code: Extract<RejectReasonCode, 'UNAUTHORIZED' | 'SESSION_EXPIRED'>;
  readonly message: string;
}

export type ValidateSessionResult = ValidateSessionOk | ValidateSessionFail;

export interface ValidateSessionTokenInput {
  readonly presentedToken: string;
  /**
   * Session row looked up by presented token (or null if no row).
   * Callers must not trust client-asserted player ids for the lookup key.
   */
  readonly session: SessionRecord | null;
  readonly roomStatus: string;
  readonly now: number;
  /** Optional client-asserted id — ignored for identity resolution (EC-109). */
  readonly claimedPlayerId?: string | null;
  readonly idleTtlMs?: number;
}

/**
 * EC-14 / EC-109: validate token → session identity.
 * Unknown/wrong → UNAUTHORIZED (no existence leak). Expired → SESSION_EXPIRED.
 */
export function validateSessionToken(input: ValidateSessionTokenInput): ValidateSessionResult {
  const claimed = input.claimedPlayerId ?? null;

  if (input.session === null) {
    return {
      ok: false,
      code: 'UNAUTHORIZED',
      message: UNAUTHORIZED_SESSION_MESSAGE,
    };
  }

  if (!authTokensEqual(input.presentedToken, input.session.authToken)) {
    return {
      ok: false,
      code: 'UNAUTHORIZED',
      message: UNAUTHORIZED_SESSION_MESSAGE,
    };
  }

  if (
    isRoomStatusForceExpired(input.roomStatus) ||
    isSessionIdleExpired(input.session.lastSeenAt, input.now, input.idleTtlMs)
  ) {
    return {
      ok: false,
      code: 'SESSION_EXPIRED',
      message: SESSION_EXPIRED_MESSAGE,
    };
  }

  return {
    ok: true,
    sessionId: input.session.id,
    playerId: input.session.playerId,
    ignoredClaimedPlayerId: claimed,
  };
}

export interface RotateAuthTokenResult {
  readonly session: SessionRecord;
  readonly previousToken: string;
  readonly authToken: string;
}

/**
 * EC-13: rotate token on successful reconnect; previous value is immediately invalid.
 */
export function rotateAuthToken(
  session: SessionRecord,
  now: number,
  randomBytesFn?: RandomBytesFn,
): RotateAuthTokenResult {
  const previousToken = session.authToken;
  const authToken = generateAuthToken(randomBytesFn);
  return {
    previousToken,
    authToken,
    session: {
      ...session,
      authToken,
      lastSeenAt: now,
    },
  };
}

/**
 * Convenience for the reconnect success path: validate → rotate.
 * Returns validation failure unchanged; on success returns rotated session + identity.
 */
export function validateAndRotateSession(
  input: ValidateSessionTokenInput,
  randomBytesFn?: RandomBytesFn,
):
  | ValidateSessionFail
  | {
      readonly ok: true;
      readonly sessionId: string;
      readonly playerId: string;
      readonly ignoredClaimedPlayerId: string | null;
      readonly previousToken: string;
      readonly authToken: string;
      readonly session: SessionRecord;
    } {
  const validated = validateSessionToken(input);
  if (!validated.ok) {
    return validated;
  }
  if (input.session === null) {
    return {
      ok: false,
      code: 'UNAUTHORIZED',
      message: UNAUTHORIZED_SESSION_MESSAGE,
    };
  }
  const rotated = rotateAuthToken(input.session, input.now, randomBytesFn);
  return {
    ok: true,
    sessionId: validated.sessionId,
    playerId: validated.playerId,
    ignoredClaimedPlayerId: validated.ignoredClaimedPlayerId,
    previousToken: rotated.previousToken,
    authToken: rotated.authToken,
    session: rotated.session,
  };
}
