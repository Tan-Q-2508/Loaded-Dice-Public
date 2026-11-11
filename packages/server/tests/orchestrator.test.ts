import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { PROTOCOL_VERSION, ClientEvents, ServerEvents } from '@shaatir-shakuni/socket-api';
import { createTestMonotonicClock } from '../src/clock.js';
import { MemoryPersistence } from '../src/memory-persistence.js';
import { Orchestrator } from '../src/orchestrator.js';
import { createIncidentLogger } from '../src/freeze-log.js';

function envelope(payload: unknown, overrides: Partial<{
  actionUuid: string;
  sequence: number;
  stateVersion: number;
}> = {}) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    actionUuid: overrides.actionUuid ?? randomUUID(),
    sequence: overrides.sequence ?? 1,
    stateVersion: overrides.stateVersion ?? 0,
    payload,
  };
}

describe('Orchestrator wiring', () => {
  it('creates a room and returns room:created', async () => {
    const emissions: { socketId: string; event: string; payload: unknown }[] = [];
    const persist = new MemoryPersistence();
    const orch = new Orchestrator({
      persist,
      clock: createTestMonotonicClock(0),
      emit: (socketId, event, payload) => {
        emissions.push({ socketId, event, payload });
      },
      memoryPersist: persist,
      incidents: createIncidentLogger(() => undefined),
    });

    await orch.handleEvent(
      'sock-1',
      ClientEvents.ROOM_CREATE,
      envelope({ displayName: 'Hosty' }),
    );

    const created = emissions.find((e) => e.event === ServerEvents.ROOM_CREATED);
    expect(created).toBeDefined();
    const payload = created!.payload as {
      roomId: string;
      roomCode: string;
      authToken: string;
      playerId: string;
    };
    expect(payload.roomCode).toHaveLength(6);
    expect(payload.authToken.length).toBeGreaterThan(10);

    const sync = emissions.find((e) => e.event === ServerEvents.STATE_SYNC);
    expect(sync).toBeDefined();
    const view = (sync!.payload as { view: { hostPlayerId: string; rebalanceEnabled: boolean; players: unknown[]; phase: { kind: string } } }).view;
    expect(view.hostPlayerId).toBe(payload.playerId);
    expect(view.rebalanceEnabled).toBe(false);
    expect(view.players).toHaveLength(1);
    expect(view.phase.kind).toBe('LOBBY');
    orch.dispose();
  });

  it('EC-78: room create rejected when DB unavailable', async () => {
    const emissions: { event: string; payload: unknown }[] = [];
    const persist = new MemoryPersistence();
    persist.setAvailable(false);
    const orch = new Orchestrator({
      persist,
      clock: createTestMonotonicClock(0),
      emit: (_s, event, payload) => emissions.push({ event, payload }),
      memoryPersist: persist,
      incidents: createIncidentLogger(() => undefined),
    });

    await orch.handleEvent(
      'sock-1',
      ClientEvents.ROOM_CREATE,
      envelope({ displayName: 'Hosty' }),
    );

    const rejected = emissions.find((e) => e.event === ServerEvents.ACTION_REJECTED);
    expect(rejected).toBeDefined();
    expect((rejected!.payload as { message: string }).message).toMatch(/unavailable/i);
    orch.dispose();
  });

  it('create room detaches socket from a prior room', async () => {
    const emissions: { socketId: string; event: string; payload: unknown }[] = [];
    const persist = new MemoryPersistence();
    const orch = new Orchestrator({
      persist,
      clock: createTestMonotonicClock(0),
      emit: (socketId, event, payload) => {
        emissions.push({ socketId, event, payload });
      },
      memoryPersist: persist,
      incidents: createIncidentLogger(() => undefined),
    });

    await orch.handleEvent(
      'sock-1',
      ClientEvents.ROOM_CREATE,
      envelope({ displayName: 'Hosty' }),
    );
    const first = emissions.find((e) => e.event === ServerEvents.ROOM_CREATED)!
      .payload as { roomId: string; roomCode: string };
    const oldRuntime = orch.registry.get(first.roomId)!;
    expect(oldRuntime.sockets.has('sock-1')).toBe(true);

    emissions.length = 0;
    await orch.handleEvent(
      'sock-1',
      ClientEvents.ROOM_CREATE,
      envelope({ displayName: 'Hosty' }, { sequence: 2 }),
    );
    const second = emissions.find((e) => e.event === ServerEvents.ROOM_CREATED)!
      .payload as { roomId: string; roomCode: string };
    expect(second.roomId).not.toBe(first.roomId);
    expect(oldRuntime.sockets.has('sock-1')).toBe(false);
    expect(orch.registry.get(second.roomId)!.sockets.has('sock-1')).toBe(true);
    orch.dispose();
  });

  it('hello ok and protocol mismatch', async () => {
    const emissions: { event: string; payload: unknown }[] = [];
    const persist = new MemoryPersistence();
    const orch = new Orchestrator({
      persist,
      clock: createTestMonotonicClock(0),
      emit: (_s, event, payload) => emissions.push({ event, payload }),
      incidents: createIncidentLogger(() => undefined),
    });

    await orch.handleEvent('s', ClientEvents.HELLO, { protocolVersion: PROTOCOL_VERSION });
    expect(emissions.some((e) => e.event === ServerEvents.HELLO_OK)).toBe(true);

    emissions.length = 0;
    await orch.handleEvent('s', ClientEvents.HELLO, { protocolVersion: 999 });
    expect(emissions.some((e) => e.event === ServerEvents.PROTOCOL_MISMATCH)).toBe(true);
    orch.dispose();
  });
});

describe('admin routes (EC-R01)', () => {
  it('GET /admin/frozen-rooms lists frozen rooms and incidents when authenticated', async () => {
    const persist = new MemoryPersistence();
    const clock = createTestMonotonicClock(0);
    const incidents = createIncidentLogger(() => undefined);
    const orch = new Orchestrator({
      persist,
      clock,
      emit: () => undefined,
      incidents,
      memoryPersist: persist,
    });

    const { createRoomRuntime } = await import('../src/room-runtime.js');
    const { createInitialState } = await import('@shaatir-shakuni/engine');
    const { mountAdminRoutes } = await import('../src/admin.js');
    const express = (await import('express')).default;

    const runtime = createRoomRuntime({
      roomId: randomUUID(),
      roomCode: 'FROZEN1',
      lobby: {
        id: 'x',
        roomCode: 'FROZEN1',
        hostPlayerId: 'h',
        status: 'FROZEN',
        rebalanceEnabled: false,
        players: [],
        hostAloneGraceStartedAt: null,
        emptySinceAt: null,
      },
      gameState: createInitialState('x', 'h'),
      status: 'FROZEN',
    });
    runtime.frozenReason = 'test';
    runtime.incidentAtMs = 1;
    orch.registerRuntime(runtime);
    incidents.log({
      kind: 'FREEZE',
      roomId: runtime.roomId,
      roomCode: runtime.roomCode,
      reason: 'test',
      timestampMs: 1,
      lastKnownSnapshotVersion: 0,
    });

    const adminToken = 'test-admin-secret';
    const app = express();
    mountAdminRoutes(app, orch, persist, { adminToken });

    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    const unauth = await fetch(`http://127.0.0.1:${port}/admin/frozen-rooms`);
    expect(unauth.status).toBe(401);

    const res = await fetch(`http://127.0.0.1:${port}/admin/frozen-rooms`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.ok).toBe(true);
    const body = (await res.json()) as {
      frozenRooms: { roomId: string }[];
      incidents: unknown[];
    };
    expect(body.frozenRooms.some((r) => r.roomId === runtime.roomId)).toBe(true);
    expect(body.incidents.length).toBeGreaterThan(0);

    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    orch.dispose();
  });
});

describe('invite-code reclaim + play again', () => {
  async function bootFive(
    orch: Orchestrator,
    emissions: { socketId: string; event: string; payload: unknown }[],
  ) {
    await orch.handleEvent('sock-h', ClientEvents.ROOM_CREATE, envelope({ displayName: 'Hosty' }));
    const created = emissions.find((e) => e.event === ServerEvents.ROOM_CREATED)!
      .payload as { roomId: string; roomCode: string; playerId: string };
    for (let i = 2; i <= 5; i++) {
      await orch.handleEvent(
        `sock-${i}`,
        ClientEvents.ROOM_JOIN,
        envelope({ roomCode: created.roomCode, displayName: `P${i}` }),
      );
    }
    const runtime = orch.registry.get(created.roomId)!;
    const hostBinding = runtime.sockets.get('sock-h')!;
    await orch.handleEvent(
      'sock-h',
      ClientEvents.ROOM_START,
      envelope(
        { roomId: created.roomId },
        {
          sequence: hostBinding.expectedSequence,
          stateVersion: runtime.gameState?.stateVersion ?? 0,
        },
      ),
    );
    expect(orch.registry.get(created.roomId)?.status).toBe('IN_PROGRESS');
    expect(orch.registry.get(created.roomId)?.lobby.players).toHaveLength(5);
    return created;
  }

  it('host disconnect + room:join same name rejoins; new identity IN_PROGRESS rejected', async () => {
    const emissions: { socketId: string; event: string; payload: unknown }[] = [];
    const persist = new MemoryPersistence();
    const orch = new Orchestrator({
      persist,
      clock: createTestMonotonicClock(0),
      emit: (socketId, event, payload) => {
        emissions.push({ socketId, event, payload });
      },
      memoryPersist: persist,
      incidents: createIncidentLogger(() => undefined),
    });

    const created = await bootFive(orch, emissions);
    await orch.handleDisconnect('sock-h');

    emissions.length = 0;
    await orch.handleEvent(
      'sock-h2',
      ClientEvents.ROOM_JOIN,
      envelope({ roomCode: created.roomCode, displayName: 'hosty' }),
    );
    const rejoined = emissions.find((e) => e.event === ServerEvents.ROOM_JOINED);
    expect(rejoined).toBeDefined();
    expect((rejoined!.payload as { playerId: string }).playerId).toBe(created.playerId);

    emissions.length = 0;
    await orch.handleEvent(
      'sock-late',
      ClientEvents.ROOM_JOIN,
      envelope({ roomCode: created.roomCode, displayName: 'Latecomer' }),
    );
    const rejected = emissions.find((e) => e.event === ServerEvents.ACTION_REJECTED);
    expect(rejected).toBeDefined();
    expect((rejected!.payload as { code: string }).code).toBe('GAME_ALREADY_STARTED');
    orch.dispose();
  });

  it('room:play_again after GAME_OVER returns LOBBY with same code; new join allowed', async () => {
    const emissions: { socketId: string; event: string; payload: unknown }[] = [];
    const persist = new MemoryPersistence();
    const orch = new Orchestrator({
      persist,
      clock: createTestMonotonicClock(0),
      emit: (socketId, event, payload) => {
        emissions.push({ socketId, event, payload });
      },
      memoryPersist: persist,
      incidents: createIncidentLogger(() => undefined),
    });

    const created = await bootFive(orch, emissions);
    const runtime = orch.registry.get(created.roomId)!;
    expect(runtime.gameState).not.toBeNull();
    runtime.status = 'GAME_OVER';
    runtime.lobby = { ...runtime.lobby, status: 'GAME_OVER' };
    runtime.gameState = {
      ...runtime.gameState!,
      phase: { kind: 'GAME_OVER', winner: 'PANDAVA', reason: 'DHARMA_DECREES' },
      stateVersion: (runtime.gameState?.stateVersion ?? 0) + 1,
    };

    const beforeCode = runtime.roomCode;
    const beforeVersion = runtime.gameState.stateVersion;
    const hostBinding = runtime.sockets.get('sock-h')!;
    emissions.length = 0;
    await orch.handleEvent(
      'sock-h',
      ClientEvents.ROOM_PLAY_AGAIN,
      envelope(
        { roomId: created.roomId },
        { sequence: hostBinding.expectedSequence, stateVersion: beforeVersion },
      ),
    );

    const after = orch.registry.get(created.roomId)!;
    expect(after.roomCode).toBe(beforeCode);
    expect(after.status).toBe('LOBBY');
    expect(after.gameState?.phase.kind).toBe('LOBBY');
    expect(after.gameState!.stateVersion).toBeGreaterThan(beforeVersion);

    emissions.length = 0;
    await orch.handleEvent(
      'sock-new',
      ClientEvents.ROOM_JOIN,
      envelope({ roomCode: beforeCode, displayName: 'Fresh' }),
    );
    expect(emissions.some((e) => e.event === ServerEvents.ROOM_JOINED)).toBe(true);
    orch.dispose();
  });
});

describe('EC-94 via orchestrator queue', () => {
  it('exposes per-room queue on orchestrator', () => {
    const persist = new MemoryPersistence();
    const orch = new Orchestrator({
      persist,
      clock: createTestMonotonicClock(0),
      emit: () => undefined,
      incidents: createIncidentLogger(() => undefined),
    });
    expect(orch.queue).toBeDefined();
    orch.dispose();
  });
});
