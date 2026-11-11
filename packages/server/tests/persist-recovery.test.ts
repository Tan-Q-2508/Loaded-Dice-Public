import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createInitialState,
  createRng,
  defaultPowerTable,
  createClock,
  seedForAction,
  type GameState,
} from '@shaatir-shakuni/engine';
import { isHostForceEndPayload } from '@shaatir-shakuni/db';
import { MemoryPersistence } from '../src/memory-persistence.js';
import { commitEngineResult, applyCommittedState } from '../src/persist.js';
import { createRoomRuntime } from '../src/room-runtime.js';
import { createIncidentLogger } from '../src/freeze-log.js';
import { applyAndCommit, freezeRoom, recoverRoom, resumeFrozenRoom } from '../src/recovery.js';
import { createTestMonotonicClock } from '../src/clock.js';

function lobby(roomId: string, host = 'host') {
  return {
    id: roomId,
    roomCode: 'ABC123',
    hostPlayerId: host,
    status: 'LOBBY',
    rebalanceEnabled: false,
    players: [
      {
        id: host,
        displayName: 'Host',
        normalizedDisplayName: 'host',
        seatOrder: 0,
        connectionStatus: 'CONNECTED' as const,
        joinedAt: 0,
        sessionId: 'sess-host',
      },
    ],
    hostAloneGraceStartedAt: null,
    emptySinceAt: null,
  };
}

function startedState(): GameState {
  const ids = ['p1', 'p2', 'p3', 'p4', 'p5'];
  const names: Record<string, string> = {
    p1: 'A',
    p2: 'B',
    p3: 'C',
    p4: 'D',
    p5: 'E',
  };
  const initial = createInitialState('room-1', 'p1');
  const deps = {
    rng: createRng(42),
    clock: createClock(0),
    powerTable: defaultPowerTable,
  };
  const { state } = applyAction(
    initial,
    {
      type: 'START_GAME',
      playerIds: ids,
      displayNames: names,
      hostPlayerId: 'p1',
      rebalanceEnabled: false,
      seed: 42,
    },
    deps,
  );
  return state;
}

function startAction(seed: number) {
  const ids = ['p1', 'p2', 'p3', 'p4', 'p5'];
  return {
    type: 'START_GAME' as const,
    playerIds: ids,
    displayNames: {
      p1: 'A',
      p2: 'B',
      p3: 'C',
      p4: 'D',
      p5: 'E',
    },
    hostPlayerId: 'p1',
    rebalanceEnabled: false,
    seed,
  };
}

describe('persist commit pipeline (EC-75/76/96/91)', () => {
  it('START_GAME shuffles from action.seed, not lobby seed 0 (always-Kaurava host)', async () => {
    const persist = new MemoryPersistence();
    await persist.saveNewRoom({
      roomId: 'room-1',
      roomCode: 'ABC123',
      hostPlayerId: 'p1',
      rebalanceEnabled: false,
      players: [],
      sessions: [],
    });

    const lobbyState = createInitialState('room-1', 'p1');
    expect(lobbyState.seed).toBe(0);
    const action = startAction(99);
    expect(seedForAction(lobbyState, action)).toBe(99);

    const runtime = createRoomRuntime({
      roomId: 'room-1',
      roomCode: 'ABC123',
      lobby: lobby('room-1', 'p1'),
      gameState: lobbyState,
      status: 'LOBBY',
    });

    const result = await applyAndCommit(
      runtime,
      action,
      persist,
      createClock(0),
      '22222222-2222-4222-8222-222222222222',
    );
    expect(result.kind).toBe('committed');
    if (result.kind !== 'committed') return;

    const expected = applyAction(createInitialState('room-1', 'p1'), action, {
      rng: createRng(99),
      clock: createClock(0),
      powerTable: defaultPowerTable,
    }).state;
    const stale = applyAction(createInitialState('room-1', 'p1'), startAction(1), {
      rng: createRng(1),
      clock: createClock(0),
      powerTable: defaultPowerTable,
    }).state;

    expect(result.state.players.map((p) => p.role)).toEqual(
      expected.players.map((p) => p.role),
    );
    expect(result.state.players.map((p) => p.role)).not.toEqual(
      stale.players.map((p) => p.role),
    );
    expect(result.state.seed).toBe(99);
  });

  it('EC-75: persist failure does not advance runtime state', async () => {
    const persist = new MemoryPersistence();
    const state = startedState();
    const runtime = createRoomRuntime({
      roomId: 'room-1',
      roomCode: 'ABC123',
      lobby: lobby('room-1', 'p1'),
      gameState: state,
      status: 'IN_PROGRESS',
    });
    await persist.saveNewRoom({
      roomId: 'room-1',
      roomCode: 'ABC123',
      hostPlayerId: 'p1',
      rebalanceEnabled: false,
      players: [],
      sessions: [],
    });

    const beforeVersion = state.stateVersion;
    persist.failNextAppend = true;

    // ROLE_REVEAL_TIMEOUT emits PHASE_CHANGED events (non-empty ledger write).
    const result = await applyAndCommit(
      runtime,
      { type: 'ROLE_REVEAL_TIMEOUT' },
      persist,
      createClock(0),
      '11111111-1111-4111-8111-111111111111',
    );

    expect(result.kind).toBe('persist_failed');
    expect(runtime.gameState?.stateVersion).toBe(beforeVersion);
    expect(persist.getEvents('room-1')).toHaveLength(0);
  });

  it('EC-96: commitEngineResult only reports committed after durable write', async () => {
    const persist = new MemoryPersistence();
    await persist.saveNewRoom({
      roomId: 'room-1',
      roomCode: 'ABC123',
      hostPlayerId: 'p1',
      rebalanceEnabled: false,
      players: [],
      sessions: [],
    });
    const state = startedState();
    const runtime = createRoomRuntime({
      roomId: 'room-1',
      roomCode: 'ABC123',
      lobby: lobby('room-1', 'p1'),
      gameState: state,
    });

    const deps = {
      rng: createRng(42),
      clock: createClock(0),
      powerTable: defaultPowerTable,
    };
    const applied = applyAction(state, { type: 'ROLE_REVEAL_TIMEOUT' }, deps);

    const commit = await commitEngineResult(
      runtime,
      applied.state,
      applied.events,
      persist,
      null,
      { type: 'ROLE_REVEAL_TIMEOUT' },
    );
    expect(commit.kind).toBe('committed');
    // Runtime not mutated until applyCommittedState
    expect(runtime.gameState?.stateVersion).toBe(state.stateVersion);
    if (commit.kind === 'committed') {
      applyCommittedState(runtime, commit.state);
    }
    expect(runtime.gameState?.stateVersion).toBe(applied.state.stateVersion);
  });

  it('EC-76: broadcast failure after persist is tolerated (emit swallow)', async () => {
    const emissions: { event: string }[] = [];
    const emit = () => {
      emissions.push({ event: 'x' });
      throw new Error('socket down');
    };
    // Just verify throw from emit doesn't escape broadcast helper
    const { broadcastRoomState } = await import('../src/broadcast.js');
    const state = startedState();
    const runtime = createRoomRuntime({
      roomId: 'room-1',
      roomCode: 'ABC123',
      lobby: lobby('room-1', 'p1'),
      gameState: state,
    });
    runtime.sockets.set('s1', {
      socketId: 's1',
      playerId: 'p1',
      sessionId: 'sess',
      expectedSequence: 1,
      isWritable: true,
    });
    expect(() => broadcastRoomState(runtime, emit, 'update')).not.toThrow();
    expect(emissions.length).toBeGreaterThan(0);
  });

  it('EC-91: host force-end produces distinguishable ledger payload', async () => {
    const persist = new MemoryPersistence();
    await persist.saveNewRoom({
      roomId: 'room-1',
      roomCode: 'ABC123',
      hostPlayerId: 'p1',
      rebalanceEnabled: false,
      players: [],
      sessions: [],
    });
    const state = startedState();
    const runtime = createRoomRuntime({
      roomId: 'room-1',
      roomCode: 'ABC123',
      lobby: lobby('room-1', 'p1'),
      gameState: state,
      status: 'IN_PROGRESS',
    });

    const result = await applyAndCommit(
      runtime,
      { type: 'FORCE_END_GAME', hostPlayerId: 'p1', winner: 'PANDAVA' },
      persist,
      createClock(0),
      null,
    );
    expect(result.kind).toBe('committed');
    if (result.kind === 'committed') {
      const win = result.events.find((e) => e.type === 'WIN_CONDITION_MET');
      expect(win).toBeDefined();
      expect(isHostForceEndPayload(win)).toBe(true);
    }
  });
});

describe('recovery / freeze (EC-79/80/R01/R02)', () => {
  it('EC-79: recovers from snapshot (+ optional action replay)', async () => {
    const persist = new MemoryPersistence();
    await persist.saveNewRoom({
      roomId: 'room-1',
      roomCode: 'ABC123',
      hostPlayerId: 'p1',
      rebalanceEnabled: false,
      players: [],
      sessions: [],
    });
    const state = startedState();
    await persist.writeSnapshot('room-1', state.stateVersion, state);

    const recovered = await recoverRoom('room-1', persist, createClock(0));
    expect(recovered.ok).toBe(true);
    if (recovered.ok) {
      expect(recovered.state.stateVersion).toBe(state.stateVersion);
      expect(recovered.state.phase.kind).toBe('ROLE_REVEAL');
    }
  });

  it('EC-80: invariant failure on recovered state → freeze reason', async () => {
    const persist = new MemoryPersistence();
    await persist.saveNewRoom({
      roomId: 'room-1',
      roomCode: 'ABC123',
      hostPlayerId: 'p1',
      rebalanceEnabled: false,
      players: [],
      sessions: [],
    });
    const state = startedState();
    // Corrupt expected tile count to trip invariants
    const bad: GameState = { ...state, expectedTileCount: 1, decreeDeck: [], ashPile: [] };
    await persist.writeSnapshot('room-1', bad.stateVersion, bad);

    const recovered = await recoverRoom('room-1', persist, createClock(0));
    expect(recovered.ok).toBe(false);
  });

  it('EC-R01: freeze emits structured incident log', async () => {
    const persist = new MemoryPersistence();
    await persist.saveNewRoom({
      roomId: 'room-1',
      roomCode: 'ABC123',
      hostPlayerId: 'p1',
      rebalanceEnabled: false,
      players: [],
      sessions: [],
    });
    const incidents = createIncidentLogger(() => undefined);
    const runtime = createRoomRuntime({
      roomId: 'room-1',
      roomCode: 'ABC123',
      lobby: lobby('room-1', 'p1'),
      gameState: startedState(),
      status: 'IN_PROGRESS',
    });
    runtime.maxSnapshotVersion = 3;

    await freezeRoom(runtime, 'test invariant', persist, createClock(10), incidents);
    expect(runtime.status).toBe('FROZEN');
    expect(incidents.list()).toHaveLength(1);
    expect(incidents.list()[0]?.kind).toBe('FREEZE');
    expect(incidents.list()[0]?.lastKnownSnapshotVersion).toBe(3);

    const listed = await persist.listFrozenRooms();
    expect(listed.some((r) => r.roomId === 'room-1')).toBe(true);
  });

  it('EC-R02: resumeFrozenRoom reloads last good snapshot', async () => {
    const persist = new MemoryPersistence();
    await persist.saveNewRoom({
      roomId: 'room-1',
      roomCode: 'ABC123',
      hostPlayerId: 'p1',
      rebalanceEnabled: false,
      players: [],
      sessions: [],
    });
    const good = startedState();
    await persist.writeSnapshot('room-1', good.stateVersion, good);

    const incidents = createIncidentLogger(() => undefined);
    const runtime = createRoomRuntime({
      roomId: 'room-1',
      roomCode: 'ABC123',
      lobby: lobby('room-1', 'p1'),
      gameState: good,
      status: 'IN_PROGRESS',
    });
    // Mark FROZEN in memory without polluting the event ledger past the good snapshot
    // (simulates "bug fixed, resume from last known-good snapshot").
    runtime.status = 'FROZEN';
    runtime.frozenReason = 'bug';
    runtime.incidentAtMs = 1;
    runtime.gameState = {
      ...good,
      phase: { kind: 'ROOM_FROZEN', reason: 'bug' },
      stateVersion: good.stateVersion + 1,
    };
    await persist.updateRoomStatus('room-1', 'FROZEN', {
      frozenReason: 'bug',
      incidentAtMs: 1,
    });

    const resumed = await resumeFrozenRoom(runtime, persist, createClock(0));
    expect(resumed.ok).toBe(true);
    expect(runtime.status).toBe('IN_PROGRESS');
    expect(runtime.gameState?.phase.kind).toBe('ROLE_REVEAL');
    expect(runtime.frozenReason).toBeNull();
  });
});

describe('EC-78 DB unavailable', () => {
  it('rejects new room create path via persist.isAvailable', async () => {
    const persist = new MemoryPersistence();
    persist.setAvailable(false);
    expect(persist.isAvailable()).toBe(false);
    await expect(
      persist.saveNewRoom({
        roomId: 'x',
        roomCode: 'ZZZZZZ',
        hostPlayerId: 'h',
        rebalanceEnabled: false,
        players: [],
        sessions: [],
      }),
    ).rejects.toThrow(/DB_UNAVAILABLE/);
  });

  it('allows in-memory continue for IN_PROGRESS when DB drops mid-game', async () => {
    const persist = new MemoryPersistence();
    await persist.saveNewRoom({
      roomId: 'room-1',
      roomCode: 'ABC123',
      hostPlayerId: 'p1',
      rebalanceEnabled: false,
      players: [],
      sessions: [],
    });
    const runtime = createRoomRuntime({
      roomId: 'room-1',
      roomCode: 'ABC123',
      lobby: lobby('room-1', 'p1'),
      gameState: startedState(),
      status: 'IN_PROGRESS',
    });
    const before = runtime.gameState!.stateVersion;
    persist.setAvailable(false);

    const result = await applyAndCommit(
      runtime,
      { type: 'ROLE_REVEAL_TIMEOUT' },
      persist,
      createTestMonotonicClock(0),
      null,
    );
    expect(result.kind).toBe('committed');
    expect(runtime.gameState!.stateVersion).toBeGreaterThan(before);
    expect(runtime.pendingPersistJobs.length).toBeGreaterThan(0);
  });
});
