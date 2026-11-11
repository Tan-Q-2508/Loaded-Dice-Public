import { describe, expect, it } from 'vitest';
import { rejectReasonCodeSchema } from '@shaatir-shakuni/socket-api';
import {
  ACTION_BLOCKED_ROOM_STATUSES,
  AUTH_TOKEN_BYTE_LENGTH,
  SESSION_EXPIRED_MESSAGE,
  SESSION_FORCE_EXPIRED_ROOM_STATUSES,
  SESSION_IDLE_TTL_MS,
  UNAUTHORIZED_SESSION_MESSAGE,
  assertCanSubmitAction,
  authTokensEqual,
  generateAuthToken,
  isSocketWritable,
  issueSession,
  registerWritableConnection,
  resolveHostOnReconnect,
  rotateAuthToken,
  validateAndRotateSession,
  validateSessionToken,
  type SessionRecord,
} from '../src/index.js';

const NOW = 1_700_000_000_000;

function fixedRandomBytes(fill: number): (n: number) => Uint8Array {
  return (n: number) => Uint8Array.from({ length: n }, () => fill);
}

function session(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    playerId: '22222222-2222-2222-2222-222222222222',
    authToken: generateAuthToken(fixedRandomBytes(7)),
    socketId: 'socket-a',
    lastSeenAt: NOW,
    ...overrides,
  };
}

describe('EC-13 high-entropy opaque tokens', () => {
  it('generates 256-bit-class base64url tokens', () => {
    const token = generateAuthToken();
    const decoded = Buffer.from(token, 'base64url');
    expect(decoded.byteLength).toBe(AUTH_TOKEN_BYTE_LENGTH);
    expect(token).not.toMatch(/[+/=]/);
  });

  it('does not derive the token from player id', () => {
    const a = issueSession({
      playerId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      now: NOW,
      randomBytesFn: fixedRandomBytes(1),
    });
    const b = issueSession({
      playerId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      now: NOW,
      randomBytesFn: fixedRandomBytes(1),
    });
    expect(a.authToken).toBe(b.authToken);
    expect(a.authToken).not.toContain('aaaa');
    expect(a.authToken).not.toContain('bbbb');
  });

  it('rotateAuthToken invalidates the previous token immediately', () => {
    const original = session({ authToken: generateAuthToken(fixedRandomBytes(3)) });
    const rotated = rotateAuthToken(original, NOW + 1000, fixedRandomBytes(9));

    expect(rotated.authToken).not.toBe(rotated.previousToken);
    expect(rotated.previousToken).toBe(original.authToken);
    expect(authTokensEqual(rotated.session.authToken, rotated.authToken)).toBe(true);

    const oldStillPresented = validateSessionToken({
      presentedToken: rotated.previousToken,
      session: rotated.session,
      roomStatus: 'IN_PROGRESS',
      now: NOW + 1000,
    });
    expect(oldStillPresented.ok).toBe(false);
    if (!oldStillPresented.ok) {
      expect(oldStillPresented.code).toBe('UNAUTHORIZED');
      expect(oldStillPresented.message).toBe(UNAUTHORIZED_SESSION_MESSAGE);
    }
  });

  it('validateAndRotateSession rotates on successful reconnect path', () => {
    const s = session({ authToken: generateAuthToken(fixedRandomBytes(4)) });
    const result = validateAndRotateSession(
      {
        presentedToken: s.authToken,
        session: s,
        roomStatus: 'LOBBY',
        now: NOW + 50,
      },
      fixedRandomBytes(11),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.previousToken).toBe(s.authToken);
      expect(result.authToken).not.toBe(s.authToken);
      expect(result.playerId).toBe(s.playerId);
    }
  });
});

describe('EC-14 expired vs unauthorized', () => {
  it('rejects unknown sessions with UNAUTHORIZED and a generic message', () => {
    const result = validateSessionToken({
      presentedToken: 'totally-unknown-token',
      session: null,
      roomStatus: 'IN_PROGRESS',
      now: NOW,
    });
    expect(result).toEqual({
      ok: false,
      code: 'UNAUTHORIZED',
      message: UNAUTHORIZED_SESSION_MESSAGE,
    });
  });

  it('rejects wrong token with the same UNAUTHORIZED message (no existence leak)', () => {
    const s = session();
    const result = validateSessionToken({
      presentedToken: 'wrong-token-value-xxxxxxxxxxxx',
      session: s,
      roomStatus: 'IN_PROGRESS',
      now: NOW,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('UNAUTHORIZED');
      expect(result.message).toBe(UNAUTHORIZED_SESSION_MESSAGE);
    }
  });

  it('rejects idle-expired tokens with SESSION_EXPIRED', () => {
    const s = session({ lastSeenAt: NOW });
    const result = validateSessionToken({
      presentedToken: s.authToken,
      session: s,
      roomStatus: 'IN_PROGRESS',
      now: NOW + SESSION_IDLE_TTL_MS + 1,
    });
    expect(result).toEqual({
      ok: false,
      code: 'SESSION_EXPIRED',
      message: SESSION_EXPIRED_MESSAGE,
    });
  });

  it.each([...SESSION_FORCE_EXPIRED_ROOM_STATUSES])(
    'rejects token when room status is %s',
    (roomStatus) => {
      const s = session();
      const result = validateSessionToken({
        presentedToken: s.authToken,
        session: s,
        roomStatus,
        now: NOW,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.code).toBe('SESSION_EXPIRED');
      }
    },
  );

  it('exposes SESSION_EXPIRED on the socket-api reject enum', () => {
    expect(rejectReasonCodeSchema.parse('SESSION_EXPIRED')).toBe('SESSION_EXPIRED');
  });
});

describe('EC-16 multi-tab writable / read-only', () => {
  it('makes the newest socket writable and demotes the prior one', () => {
    const result = registerWritableConnection({
      playerId: 'p1',
      newSocketId: 'socket-new',
      priorWritableSocketId: 'socket-old',
    });
    expect(result).toEqual({
      playerId: 'p1',
      writableSocketId: 'socket-new',
      demoteSocketId: 'socket-old',
      readOnlyReason: 'SUPERSEDED_BY_NEWER_CONNECTION',
    });
    expect(isSocketWritable('socket-new', result.writableSocketId)).toBe(true);
    expect(isSocketWritable('socket-old', result.writableSocketId)).toBe(false);
  });

  it('does not demote when there was no prior writable socket', () => {
    const result = registerWritableConnection({
      playerId: 'p1',
      newSocketId: 'socket-only',
      priorWritableSocketId: null,
    });
    expect(result.demoteSocketId).toBeNull();
    expect(result.readOnlyReason).toBeNull();
  });

  it('rejects actions from a demoted (non-writable) socket with NOT_WRITABLE', () => {
    const gate = assertCanSubmitAction({
      isWritable: false,
      roomStatus: 'IN_PROGRESS',
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.code).toBe('NOT_WRITABLE');
    }
  });
});

describe('EC-17 GAME_OVER identity ok, actions blocked', () => {
  it('still resolves identity after GAME_OVER', () => {
    const s = session();
    const result = validateSessionToken({
      presentedToken: s.authToken,
      session: s,
      roomStatus: 'GAME_OVER',
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.playerId).toBe(s.playerId);
    }
  });

  it('structurally rejects actions when room is GAME_OVER', () => {
    const gate = assertCanSubmitAction({
      isWritable: true,
      roomStatus: 'GAME_OVER',
    });
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.code).toBe('UNAUTHORIZED');
    }
  });

  it.each([...ACTION_BLOCKED_ROOM_STATUSES])(
    'blocks actions for room status %s',
    (roomStatus) => {
      const gate = assertCanSubmitAction({ isWritable: true, roomStatus });
      expect(gate.ok).toBe(false);
    },
  );

  it('allows actions in LOBBY / IN_PROGRESS when writable', () => {
    expect(assertCanSubmitAction({ isWritable: true, roomStatus: 'LOBBY' }).ok).toBe(true);
    expect(assertCanSubmitAction({ isWritable: true, roomStatus: 'IN_PROGRESS' }).ok).toBe(
      true,
    );
  });
});

describe('EC-18 host reconnect does not reclaim host', () => {
  it('leaves hostPlayerId unchanged when original host reconnects after migration', () => {
    const migratedHost = 'current-host-id';
    const originalHost = 'original-host-id';
    const result = resolveHostOnReconnect({
      roomHostPlayerId: migratedHost,
      reconnectingPlayerId: originalHost,
    });
    expect(result.hostPlayerId).toBe(migratedHost);
    expect(result.isCurrentHost).toBe(false);
    expect(result.reclaimedHost).toBe(false);
  });

  it('reports isCurrentHost when the current host reconnects, without reclaim side effects', () => {
    const host = 'host-id';
    const result = resolveHostOnReconnect({
      roomHostPlayerId: host,
      reconnectingPlayerId: host,
    });
    expect(result.hostPlayerId).toBe(host);
    expect(result.isCurrentHost).toBe(true);
    expect(result.reclaimedHost).toBe(false);
  });
});

describe('EC-109 identity from token only', () => {
  it('ignores client-asserted player id and uses the session row', () => {
    const s = session({ playerId: 'real-player-id' });
    const result = validateSessionToken({
      presentedToken: s.authToken,
      session: s,
      roomStatus: 'IN_PROGRESS',
      now: NOW,
      claimedPlayerId: 'stale-local-storage-player-id',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.playerId).toBe('real-player-id');
      expect(result.ignoredClaimedPlayerId).toBe('stale-local-storage-player-id');
      expect(result.playerId).not.toBe(result.ignoredClaimedPlayerId);
    }
  });
});
