import { describe, expect, it } from 'vitest';
import {
  allocateRoomCode,
  assertUniqueNormalizedName,
  buildStartGameAction,
  canStartGame,
  compactSeats,
  createRoom,
  evaluateHostGrace,
  evaluateLobbyIdle,
  GENERIC_JOIN_REJECT_MESSAGE,
  HOST_ALONE_GRACE_MS,
  joinRoom,
  leaveLobby,
  LOBBY_IDLE_MS,
  markHostDisconnectedAlone,
  MAX_PLAYERS,
  MIN_PLAYERS_TO_START,
  normalizeDisplayName,
  PROFANITY_FILTERING_ENABLED,
  resetToRematchLobby,
  resolveLobbyHostOnReconnect,
  ROOM_CODE_MAX_RETRIES,
  setRebalance,
  type LobbyPlayer,
  type LobbyRoom,
} from '../src/index.js';

function fixedBytes(fill: number): (size: number) => Buffer {
  return (size) => Buffer.alloc(size, fill);
}

function createHostRoom(
  overrides: {
    displayName?: string;
    now?: number;
    rebalanceEnabled?: boolean;
    code?: string;
  } = {},
): Extract<ReturnType<typeof createRoom>, { ok: true }> {
  const code = overrides.code ?? 'ABCDEF';
  const result = createRoom({
    displayName: overrides.displayName ?? 'Host',
    now: overrides.now ?? 1_000,
    rebalanceEnabled: overrides.rebalanceEnabled,
    playerId: 'host-1',
    roomId: 'room-1',
    sessionId: 'sess-host',
    randomBytesFn: fixedBytes(1),
    allocateCode: () => ({ ok: true, roomCode: code, attempts: 1 }),
  });
  if (!result.ok) throw new Error(result.message);
  return result;
}

function joinAs(
  room: LobbyRoom,
  opts: { displayName: string; playerId: string; sessionId: string; now?: number },
): Extract<ReturnType<typeof joinRoom>, { ok: true; kind: 'JOINED' }> {
  const result = joinRoom({
    room,
    displayName: opts.displayName,
    now: opts.now ?? 2_000,
    playerId: opts.playerId,
    sessionId: opts.sessionId,
    randomBytesFn: fixedBytes(2),
  });
  if (!result.ok || result.kind !== 'JOINED') {
    throw new Error(result.ok ? 'expected JOINED' : result.message);
  }
  return result;
}

describe('EC-01 room code allocation', () => {
  it('returns a unique code on first free attempt', () => {
    const taken = new Set<string>(['AAAAAA']);
    const result = allocateRoomCode({
      codeExists: (c) => taken.has(c),
      randomBytesFn: fixedBytes(2),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.roomCode).toHaveLength(6);
      expect(result.roomCode).toMatch(/^[A-Z0-9]+$/);
      expect(result.attempts).toBe(1);
    }
  });

  it('retries on collision and aborts after the limit', () => {
    const result = allocateRoomCode({
      codeExists: () => true,
      maxRetries: 3,
      randomBytesFn: fixedBytes(3),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('ROOM_CODE_RETRY_EXHAUSTED');
    }
  });

  it('succeeds after transient collisions within the retry budget', () => {
    let calls = 0;
    const result = allocateRoomCode({
      codeExists: () => {
        calls += 1;
        return calls < 3;
      },
      maxRetries: ROOM_CODE_MAX_RETRIES,
      randomBytesFn: fixedBytes(4),
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.attempts).toBe(3);
    }
  });
});

describe('EC-06 / EC-07 display names', () => {
  it('treats case variants as the same normalized name', () => {
    expect(normalizeDisplayName('Alice')).toBe(normalizeDisplayName('alice'));
    const clash = assertUniqueNormalizedName('alice', ['alice']);
    expect(clash?.code).toBe('DISPLAY_NAME_TAKEN');
  });

  it('NFKC-normalizes before uniqueness (compatibility confusables)', () => {
    // Fullwidth Latin letters NFKC → ASCII
    const fullwidth = 'Ａｌｉｃｅ';
    const ascii = 'Alice';
    expect(normalizeDisplayName(fullwidth)).toBe(normalizeDisplayName(ascii));
  });

  it('rejects join when normalized name collides', () => {
    const created = createHostRoom({ displayName: 'Alice' });
    const join = joinRoom({
      room: created.room,
      displayName: 'alice',
      now: 2_000,
      playerId: 'p2',
      sessionId: 's2',
      randomBytesFn: fixedBytes(2),
    });
    expect(join.ok).toBe(false);
    if (!join.ok) expect(join.code).toBe('DISPLAY_NAME_TAKEN');
  });
});

describe('EC-89 profanity', () => {
  it('documents that profanity filtering is disabled in v1', () => {
    expect(PROFANITY_FILTERING_ENABLED).toBe(false);
    const created = createHostRoom({ displayName: 'DamnHost' });
    expect(created.ok).toBe(true);
  });
});

describe('create / join / leave', () => {
  it('creates a LOBBY room with host session and seat 0', () => {
    const created = createHostRoom();
    expect(created.room.status).toBe('LOBBY');
    expect(created.room.hostPlayerId).toBe('host-1');
    expect(created.hostPlayer.seatOrder).toBe(0);
    expect(created.session.playerId).toBe('host-1');
    expect(created.session.authToken.length).toBeGreaterThan(20);
  });

  it('EC-09 rejects join at capacity 10', () => {
    let room = createHostRoom().room;
    for (let i = 2; i <= MAX_PLAYERS; i++) {
      const joined = joinAs(room, {
        displayName: `P${i}`,
        playerId: `p${i}`,
        sessionId: `s${i}`,
        now: 1_000 + i,
      });
      room = joined.room;
    }
    expect(room.players).toHaveLength(MAX_PLAYERS);
    const overflow = joinRoom({
      room,
      displayName: 'Overflow',
      now: 9_000,
      playerId: 'p11',
      sessionId: 's11',
      randomBytesFn: fixedBytes(5),
    });
    expect(overflow.ok).toBe(false);
    if (!overflow.ok) expect(overflow.code).toBe('ROOM_FULL');
  });

  it('EC-10 rejects join when IN_PROGRESS with a clear game-started error', () => {
    const created = createHostRoom();
    const room: LobbyRoom = { ...created.room, status: 'IN_PROGRESS' };
    const join = joinRoom({
      room,
      displayName: 'Late',
      now: 3_000,
      playerId: 'late',
      sessionId: 'slate',
      randomBytesFn: fixedBytes(6),
    });
    expect(join.ok).toBe(false);
    if (!join.ok) {
      expect(join.code).toBe('GAME_ALREADY_STARTED');
      expect(join.message).not.toBe(GENERIC_JOIN_REJECT_MESSAGE);
    }
  });

  it('EC-11 uses the same generic message for missing and expired rooms', () => {
    const missing = joinRoom({
      room: null,
      displayName: 'X',
      now: 1,
      randomBytesFn: fixedBytes(7),
    });
    const expired = joinRoom({
      room: { ...createHostRoom().room, status: 'EXPIRED' },
      displayName: 'X',
      now: 1,
      randomBytesFn: fixedBytes(7),
    });
    expect(missing.ok).toBe(false);
    expect(expired.ok).toBe(false);
    if (!missing.ok && !expired.ok) {
      expect(missing.message).toBe(GENERIC_JOIN_REJECT_MESSAGE);
      expect(expired.message).toBe(GENERIC_JOIN_REJECT_MESSAGE);
      expect(missing.code).toBe('ROOM_NOT_JOINABLE');
      expect(expired.code).toBe('ROOM_NOT_JOINABLE');
    }
  });

  it('EC-08 reattaches an existing session without duplicating the player', () => {
    const created = createHostRoom();
    const joined = joinAs(created.room, {
      displayName: 'Guest',
      playerId: 'guest-1',
      sessionId: 'sess-guest',
    });
    expect(joined.room.players).toHaveLength(2);

    const reattach = joinRoom({
      room: joined.room,
      displayName: 'GuestRenamedIgnored',
      now: 5_000,
      existingSession: {
        sessionId: 'sess-guest',
        playerId: 'guest-1',
        authToken: 'tok',
      },
    });
    expect(reattach.ok).toBe(true);
    if (reattach.ok) {
      expect(reattach.kind).toBe('REATTACH');
      expect(reattach.room.players).toHaveLength(2);
      expect(reattach.player.displayName).toBe('Guest');
      expect(reattach.player.connectionStatus).toBe('CONNECTED');
    }
  });

  it('EC-12 compacts seat_order on leave', () => {
    let room = createHostRoom().room;
    room = joinAs(room, {
      displayName: 'A',
      playerId: 'a',
      sessionId: 'sa',
    }).room;
    room = joinAs(room, {
      displayName: 'B',
      playerId: 'b',
      sessionId: 'sb',
      now: 3_000,
    }).room;
    expect(room.players.map((p) => p.seatOrder).sort()).toEqual([0, 1, 2]);

    const left = leaveLobby({ room, playerId: 'a', now: 4_000 });
    expect(left.ok).toBe(true);
    if (left.ok) {
      expect(left.room.players.map((p) => p.seatOrder)).toEqual([0, 1]);
      expect(compactSeats(left.room.players).map((p) => p.seatOrder)).toEqual([
        0, 1,
      ]);
    }
  });
});

describe('EC-02 / EC-03 / EC-04 host + idle', () => {
  it('EC-02 deletes after host-alone grace elapses', () => {
    const created = createHostRoom({ now: 0 });
    const alone = markHostDisconnectedAlone({
      room: created.room,
      now: 100,
    });
    expect(alone.hostAloneGraceStartedAt).toBe(100);
    expect(
      evaluateHostGrace({ room: alone, now: 100 + HOST_ALONE_GRACE_MS - 1 }),
    ).toBe('HOLD');
    expect(
      evaluateHostGrace({ room: alone, now: 100 + HOST_ALONE_GRACE_MS }),
    ).toBe('DELETE');
  });

  it('EC-03 migrates host to oldest-connected remaining player on host leave', () => {
    let room = createHostRoom({ now: 1_000 }).room;
    room = joinAs(room, {
      displayName: 'Second',
      playerId: 'p2',
      sessionId: 's2',
      now: 2_000,
    }).room;
    room = joinAs(room, {
      displayName: 'Third',
      playerId: 'p3',
      sessionId: 's3',
      now: 3_000,
    }).room;

    const left = leaveLobby({ room, playerId: 'host-1', now: 4_000 });
    expect(left.ok).toBe(true);
    if (left.ok) {
      expect(left.hostMigrated).toBe(true);
      expect(left.room.hostPlayerId).toBe('p2');
    }
  });

  it('EC-04 expires empty LOBBY after idle; ignores IN_PROGRESS', () => {
    const created = createHostRoom({ now: 0 });
    const left = leaveLobby({
      room: created.room,
      playerId: 'host-1',
      now: 50,
    });
    expect(left.ok).toBe(true);
    if (!left.ok) return;

    expect(left.roomEmpty).toBe(true);
    expect(left.room.emptySinceAt).toBe(50);
    expect(
      evaluateLobbyIdle({
        room: left.room,
        now: 50 + LOBBY_IDLE_MS - 1,
      }),
    ).toBe('HOLD');
    expect(
      evaluateLobbyIdle({
        room: left.room,
        now: 50 + LOBBY_IDLE_MS,
      }),
    ).toBe('EXPIRE');

    const inProgress: LobbyRoom = {
      ...left.room,
      status: 'IN_PROGRESS',
      players: [],
      emptySinceAt: 50,
    };
    expect(evaluateLobbyIdle({ room: inProgress, now: 50 + LOBBY_IDLE_MS * 10 })).toBe(
      'NOT_APPLICABLE',
    );
  });
});

describe('EC-18 host reclaim', () => {
  it('never reclaims host on reconnect after migration', () => {
    const result = resolveLobbyHostOnReconnect({
      roomHostPlayerId: 'new-host',
      reconnectingPlayerId: 'old-host',
    });
    expect(result.reclaimedHost).toBe(false);
    expect(result.hostPlayerId).toBe('new-host');
    expect(result.isCurrentHost).toBe(false);
  });
});

describe('rebalance + start', () => {
  it('allows host to toggle rebalance only in LOBBY', () => {
    const created = createHostRoom();
    const ok = setRebalance({
      room: created.room,
      actorPlayerId: 'host-1',
      rebalanceEnabled: true,
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.room.rebalanceEnabled).toBe(true);

    const nonHost = setRebalance({
      room: created.room,
      actorPlayerId: 'other',
      rebalanceEnabled: true,
    });
    expect(nonHost.ok).toBe(false);

    const midGame = setRebalance({
      room: { ...created.room, status: 'IN_PROGRESS' },
      actorPlayerId: 'host-1',
      rebalanceEnabled: true,
    });
    expect(midGame.ok).toBe(false);
  });

  it('starts only for host with 5–10 players and builds START_GAME', () => {
    let room = createHostRoom().room;
    expect(canStartGame(room, 'host-1').canStart).toBe(false);

    for (let i = 2; i <= MIN_PLAYERS_TO_START; i++) {
      room = joinAs(room, {
        displayName: `P${i}`,
        playerId: `p${i}`,
        sessionId: `s${i}`,
        now: 1_000 + i,
      }).room;
    }

    expect(canStartGame(room, 'p2').canStart).toBe(false);
    expect(canStartGame(room, 'host-1').canStart).toBe(true);

    const started = buildStartGameAction({
      room,
      actorPlayerId: 'host-1',
      seed: 42,
    });
    expect(started.ok).toBe(true);
    if (started.ok) {
      expect(started.action.type).toBe('START_GAME');
      expect(started.action.playerIds).toHaveLength(MIN_PLAYERS_TO_START);
      expect(started.action.hostPlayerId).toBe('host-1');
      expect(started.action.seed).toBe(42);
    }
  });
});

describe('compactSeats helper', () => {
  it('renumbers seats stably', () => {
    const players: LobbyPlayer[] = [
      {
        id: 'b',
        displayName: 'B',
        normalizedDisplayName: 'b',
        seatOrder: 5,
        connectionStatus: 'CONNECTED',
        joinedAt: 2,
        sessionId: 'sb',
      },
      {
        id: 'a',
        displayName: 'A',
        normalizedDisplayName: 'a',
        seatOrder: 2,
        connectionStatus: 'CONNECTED',
        joinedAt: 1,
        sessionId: 'sa',
      },
    ];
    expect(compactSeats(players).map((p) => [p.id, p.seatOrder])).toEqual([
      ['a', 0],
      ['b', 1],
    ]);
  });
});

describe('invite-code vacant-seat reclaim', () => {
  function disconnect(room: LobbyRoom, playerId: string): LobbyRoom {
    return {
      ...room,
      players: room.players.map((p) =>
        p.id === playerId ? { ...p, connectionStatus: 'DISCONNECTED' as const } : p,
      ),
    };
  }

  it('reclaims a DISCONNECTED seat in LOBBY by normalized name', () => {
    const created = createHostRoom({ displayName: 'Hosty' });
    const joined = joinAs(created.room, {
      displayName: 'Guest',
      playerId: 'guest-1',
      sessionId: 'sess-guest',
    });
    const vacant = disconnect(joined.room, 'guest-1');
    const reclaim = joinRoom({
      room: vacant,
      displayName: 'guest',
      now: 9_000,
      playerId: 'should-not-use',
      sessionId: 'should-not-use',
      randomBytesFn: fixedBytes(8),
    });
    expect(reclaim.ok).toBe(true);
    if (reclaim.ok) {
      expect(reclaim.kind).toBe('RECLAIM');
      expect(reclaim.player.id).toBe('guest-1');
      expect(reclaim.session.id).toBe('sess-guest');
      expect(reclaim.session.authToken).not.toBe('tok');
      expect(reclaim.room.players).toHaveLength(2);
    }
  });

  it('reclaims a DISCONNECTED seat while IN_PROGRESS', () => {
    const created = createHostRoom({ displayName: 'Hosty' });
    const vacant: LobbyRoom = {
      ...disconnect(created.room, 'host-1'),
      status: 'IN_PROGRESS',
    };
    const reclaim = joinRoom({
      room: vacant,
      displayName: 'HOSTY',
      now: 9_000,
      randomBytesFn: fixedBytes(9),
    });
    expect(reclaim.ok).toBe(true);
    if (reclaim.ok) {
      expect(reclaim.kind).toBe('RECLAIM');
      expect(reclaim.player.id).toBe('host-1');
      expect(reclaim.session.id).toBe('sess-host');
    }
  });

  it('EC-10: new identity still rejected while IN_PROGRESS', () => {
    const created = createHostRoom();
    const room: LobbyRoom = { ...created.room, status: 'IN_PROGRESS' };
    const join = joinRoom({
      room,
      displayName: 'Late',
      now: 3_000,
      playerId: 'late',
      sessionId: 'slate',
      randomBytesFn: fixedBytes(6),
    });
    expect(join.ok).toBe(false);
    if (!join.ok) expect(join.code).toBe('GAME_ALREADY_STARTED');
  });

  it('EC-06: live CONNECTED same name is NAME_TAKEN', () => {
    const created = createHostRoom({ displayName: 'Hosty' });
    const join = joinRoom({
      room: created.room,
      displayName: 'hosty',
      now: 3_000,
      randomBytesFn: fixedBytes(10),
    });
    expect(join.ok).toBe(false);
    if (!join.ok) expect(join.code).toBe('DISPLAY_NAME_TAKEN');
  });
});

describe('resetToRematchLobby', () => {
  it('returns LOBBY with same code and migrates host if disconnected', () => {
    const created = createHostRoom({ displayName: 'Hosty', code: 'REM123' });
    let room = joinAs(created.room, {
      displayName: 'Guest',
      playerId: 'guest-1',
      sessionId: 'sess-guest',
      now: 2_000,
    }).room;
    room = {
      ...room,
      status: 'GAME_OVER',
      players: room.players.map((p) =>
        p.id === 'host-1' ? { ...p, connectionStatus: 'DISCONNECTED' as const } : p,
      ),
    };
    const rematch = resetToRematchLobby({ room, now: 50_000 });
    expect(rematch.room.status).toBe('LOBBY');
    expect(rematch.room.roomCode).toBe('REM123');
    expect(rematch.room.players).toHaveLength(2);
    expect(rematch.hostMigrated).toBe(true);
    expect(rematch.room.hostPlayerId).toBe('guest-1');
  });
});
