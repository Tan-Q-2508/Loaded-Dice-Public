import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import {
  applyAction,
  createClock,
  createInitialState,
  createRng,
  defaultPowerTable,
  type EngineDeps,
  type GameState,
} from '@shaatir-shakuni/engine';
import {
  PROTOCOL_VERSION,
  ClientEvents,
  ServerEvents,
  collectWireTileIds,
  buildStateSyncPayload,
} from '@shaatir-shakuni/socket-api';
import { createTestMonotonicClock } from '../src/clock.js';
import { MemoryPersistence } from '../src/memory-persistence.js';
import { Orchestrator } from '../src/orchestrator.js';
import { createIncidentLogger } from '../src/freeze-log.js';
import { broadcastRoomState } from '../src/broadcast.js';
import { resolveCorsOriginConfig, toSocketIoCorsOrigin } from '../src/cors.js';
import { ROOM_CREATE_BUCKET } from '../src/rate-limit.js';
import { createRoomRuntime } from '../src/room-runtime.js';

type Emission = { socketId: string; event: string; payload: unknown };

const PLAYER_IDS = ['p1', 'p2', 'p3', 'p4', 'p5'] as const;

function envelope(
  payload: unknown,
  overrides: Partial<{
    actionUuid: string;
    sequence: number;
    stateVersion: number;
  }> = {},
) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    actionUuid: overrides.actionUuid ?? randomUUID(),
    sequence: overrides.sequence ?? 1,
    stateVersion: overrides.stateVersion ?? 0,
    payload,
  };
}

function makeDeps(seed = 42): EngineDeps {
  return {
    rng: createRng(seed),
    clock: createClock(0),
    powerTable: defaultPowerTable,
    enforceImmutability: true,
  };
}

function startGame(seed = 42): GameState {
  const state = createInitialState('room-1', 'p1');
  const names = Object.fromEntries(PLAYER_IDS.map((id) => [id, id]));
  return applyAction(
    state,
    {
      type: 'START_GAME',
      playerIds: [...PLAYER_IDS],
      displayNames: names,
      hostPlayerId: 'p1',
      rebalanceEnabled: false,
      seed,
    },
    makeDeps(seed),
  ).state;
}

function pastRoleReveal(state: GameState, seed = 42): GameState {
  let current = state;
  const deps = makeDeps(seed);
  for (const id of PLAYER_IDS) {
    current = applyAction(current, { type: 'ACK_ROLE_REVEAL', playerId: id }, deps).state;
  }
  return current;
}

function toLegislationMaharaj(seed = 7): GameState {
  let state = pastRoleReveal(startGame(seed), seed);
  const deps = makeDeps(seed);
  const maharaj = state.maharajCandidateId;
  const nominee = state.players.find((p) => p.id !== maharaj)!.id;
  state = applyAction(
    state,
    { type: 'NOMINATE_SENAPATI', maharajId: maharaj, nomineeId: nominee },
    deps,
  ).state;
  if (state.phase.kind === 'DISCUSSION_PRE_VOTE') {
    state = applyAction(state, { type: 'DISCUSSION_PRE_VOTE_TIMEOUT' }, deps).state;
  }
  for (const p of state.players.filter((pl) => pl.isAlive)) {
    state = applyAction(state, { type: 'CAST_VOTE', playerId: p.id, vote: 'HA' }, deps).state;
  }
  if (state.phase.kind === 'ELECTION_VOTING' && state.phase.votesRevealed) {
    state = applyAction(state, { type: 'RESOLVE_ELECTION' }, deps).state;
  }
  return state;
}

function createOrch() {
  const emissions: Emission[] = [];
  const persist = new MemoryPersistence();
  const clock = createTestMonotonicClock(0);
  const orch = new Orchestrator({
    persist,
    clock,
    emit: (socketId, event, payload) => {
      emissions.push({ socketId, event, payload });
    },
    memoryPersist: persist,
    incidents: createIncidentLogger(() => undefined),
  });
  return { orch, emissions, persist, clock };
}

async function createRoom(orch: Orchestrator, emissions: Emission[], socketId = 'sock-1') {
  await orch.handleEvent(
    socketId,
    ClientEvents.ROOM_CREATE,
    envelope({ displayName: 'Hosty' }),
  );
  const created = emissions.find((e) => e.event === ServerEvents.ROOM_CREATED);
  expect(created).toBeDefined();
  return created!.payload as {
    roomId: string;
    roomCode: string;
    authToken: string;
    playerId: string;
  };
}

describe('reconnect / disconnect races (orchestrator)', () => {
  it('late disconnect of superseded socket does not mark player DISCONNECTED', async () => {
    const { orch, emissions } = createOrch();
    const room = await createRoom(orch, emissions);
    const oldToken = room.authToken;
    const runtime = orch.registry.get(room.roomId)!;

    // Reconnect on a new socket WHILE old sock-1 is still bound (chaos race).
    emissions.length = 0;
    await orch.handleEvent(
      'sock-2',
      ClientEvents.SESSION_RECONNECT,
      envelope({ authToken: oldToken }, { sequence: 1, stateVersion: 0 }),
    );
    expect(emissions.some((e) => e.event === ServerEvents.STATE_SYNC)).toBe(true);
    expect(runtime.writableByPlayer.get(room.playerId)).toBe('sock-2');
    const lobbyAfterReconnect = runtime.lobby.players.find((p) => p.id === room.playerId)!;
    expect(lobbyAfterReconnect.connectionStatus).toBe('CONNECTED');

    // Late disconnect of the superseded socket must not clobber status/writable.
    await orch.handleDisconnect('sock-1');
    expect(runtime.writableByPlayer.get(room.playerId)).toBe('sock-2');
    const lobbyAfterLateDisconnect = runtime.lobby.players.find((p) => p.id === room.playerId)!;
    expect(lobbyAfterLateDisconnect.connectionStatus).toBe('CONNECTED');
    expect(runtime.sockets.has('sock-1')).toBe(false);
    expect(runtime.sockets.has('sock-2')).toBe(true);

    orch.dispose();
  });
});

describe('EC-13 reconnect token rotation (orchestrator)', () => {
  it('rotates token on reconnect; previous token fails; new token returned', async () => {
    const { orch, emissions, persist } = createOrch();
    const room = await createRoom(orch, emissions);
    const oldToken = room.authToken;

    await orch.handleDisconnect('sock-1');
    emissions.length = 0;

    await orch.handleEvent(
      'sock-2',
      ClientEvents.SESSION_RECONNECT,
      envelope({ authToken: oldToken }, { sequence: 1, stateVersion: 0 }),
    );

    const sync = emissions.find((e) => e.event === ServerEvents.STATE_SYNC);
    expect(sync).toBeDefined();
    const payload = sync!.payload as { authToken?: string; view: { viewerId: string } };
    expect(payload.authToken).toBeDefined();
    expect(payload.authToken).not.toBe(oldToken);
    expect(payload.view.viewerId).toBe(room.playerId);

    expect(await persist.findSessionByToken(oldToken)).toBeNull();
    expect(await persist.findSessionByToken(payload.authToken!)).not.toBeNull();

    emissions.length = 0;
    await orch.handleEvent(
      'sock-3',
      ClientEvents.SESSION_RECONNECT,
      envelope({ authToken: oldToken }, { sequence: 1, stateVersion: 0 }),
    );
    const rejected = emissions.find((e) => e.event === ServerEvents.ACTION_REJECTED);
    expect(rejected).toBeDefined();
    expect((rejected!.payload as { code: string }).code).toBe('UNAUTHORIZED');

    orch.dispose();
  });
});

describe('EC-21 adversarial sequence replay (live orchestrator)', () => {
  it('rejects replayed and skipped sequences on bound actionable events', async () => {
    const { orch, emissions } = createOrch();
    const room = await createRoom(orch, emissions);
    const runtime = orch.registry.get(room.roomId)!;
    const binding = runtime.sockets.get('sock-1')!;
    const stateVersion = runtime.gameState!.stateVersion;
    const seq = binding.expectedSequence;

    emissions.length = 0;
    const firstUuid = randomUUID();
    await orch.handleEvent(
      'sock-1',
      ClientEvents.CHAT_SEND,
      envelope(
        { roomId: room.roomId, text: 'hello' },
        { actionUuid: firstUuid, sequence: seq, stateVersion },
      ),
    );
    expect(emissions.some((e) => e.event === ServerEvents.CHAT_MESSAGE)).toBe(true);
    expect(binding.expectedSequence).toBe(seq + 1);

    emissions.length = 0;
    // Replay captured packet (same sequence + uuid)
    await orch.handleEvent(
      'sock-1',
      ClientEvents.CHAT_SEND,
      envelope(
        { roomId: room.roomId, text: 'hello' },
        { actionUuid: firstUuid, sequence: seq, stateVersion },
      ),
    );
    expect(
      emissions.some(
        (e) =>
          e.event === ServerEvents.ACTION_REJECTED &&
          (e.payload as { code: string }).code === 'SEQUENCE_REJECTED',
      ),
    ).toBe(true);
    expect(emissions.filter((e) => e.event === ServerEvents.CHAT_MESSAGE)).toHaveLength(0);

    emissions.length = 0;
    // Skip ahead (gap) — also rejected
    await orch.handleEvent(
      'sock-1',
      ClientEvents.CHAT_SEND,
      envelope(
        { roomId: room.roomId, text: 'gap' },
        { sequence: seq + 5, stateVersion },
      ),
    );
    expect(
      emissions.some(
        (e) =>
          e.event === ServerEvents.ACTION_REJECTED &&
          (e.payload as { code: string }).code === 'SEQUENCE_REJECTED',
      ),
    ).toBe(true);

    orch.dispose();
  });
});

describe('EC-107 / gates — exiled chat and lobby sequence', () => {
  it('rejects chat:send from an exiled player', async () => {
    const { orch, emissions } = createOrch();
    const room = await createRoom(orch, emissions);
    const runtime = orch.registry.get(room.roomId)!;
    let state = startGame(11);
    // Exile host player id in engine state — map to orch player
    state = {
      ...state,
      roomId: runtime.roomId,
      hostPlayerId: room.playerId,
      players: state.players.map((p, i) =>
        i === 0
          ? { ...p, id: room.playerId, isAlive: false }
          : { ...p, id: randomUUID() },
      ),
      maharajCandidateId: room.playerId,
    };
    runtime.gameState = state;
    runtime.status = 'IN_PROGRESS';

    const binding = runtime.sockets.get('sock-1')!;
    emissions.length = 0;
    await orch.handleEvent(
      'sock-1',
      ClientEvents.CHAT_SEND,
      envelope(
        { roomId: room.roomId, text: 'from beyond' },
        { sequence: binding.expectedSequence, stateVersion: state.stateVersion },
      ),
    );

    const rejected = emissions.find((e) => e.event === ServerEvents.ACTION_REJECTED);
    expect(rejected).toBeDefined();
    expect((rejected!.payload as { code: string }).code).toBe('CHAT_FORBIDDEN');
    expect(emissions.filter((e) => e.event === ServerEvents.CHAT_MESSAGE)).toHaveLength(0);
    orch.dispose();
  });
});

describe('Emit-view privacy matrix (secret-bearing phases)', () => {
  it('actor / non-actor / spectator / post-game filtering for legislation + roles', () => {
    const seed = 19;
    const state = toLegislationMaharaj(seed);
    expect(state.phase.kind).toBe('LEGISLATION_MAHARAJ');
    if (state.phase.kind !== 'LEGISLATION_MAHARAJ') return;

    const maharaj = state.currentGovernment!.maharajId;
    const other = state.players.find((p) => p.id !== maharaj && p.isAlive)!.id;
    const secretIds = state.phase.drawnTiles.map((t) => t.id);

    const actor = buildStateSyncPayload(state, maharaj).view;
    const nonActor = buildStateSyncPayload(state, other).view;
    const spectator = buildStateSyncPayload(state, other, { asSpectator: true }).view;

    expect(actor.drawnTilesForMaharaj.length).toBe(3);
    for (const id of secretIds) {
      expect(collectWireTileIds(actor)).toContain(id);
      expect(collectWireTileIds(nonActor)).not.toContain(id);
      expect(collectWireTileIds(spectator)).not.toContain(id);
    }
    expect(nonActor.phase.drawnTiles ?? []).toEqual([]);
    expect(spectator.ownRole).toBeNull();
    expect(spectator.ownTeam).toBeNull();
    expect(spectator.knownKauravas).toEqual([]);

    // Broadcast path: dead player gets spectator wire
    const emissions: Emission[] = [];
    const runtime = createRoomRuntime({
      roomId: state.roomId,
      roomCode: 'PRIV01',
      lobby: {
        id: state.roomId,
        roomCode: 'PRIV01',
        hostPlayerId: state.hostPlayerId,
        status: 'IN_PROGRESS',
        rebalanceEnabled: false,
        players: state.players.map((p, i) => ({
          id: p.id,
          displayName: p.displayName,
          normalizedDisplayName: p.displayName.toLowerCase(),
          seatOrder: i,
          connectionStatus: 'CONNECTED' as const,
          joinedAt: 0,
          sessionId: randomUUID(),
        })),
        hostAloneGraceStartedAt: null,
        emptySinceAt: null,
      },
      gameState: {
        ...state,
        players: state.players.map((p) =>
          p.id === other ? { ...p, isAlive: false } : p,
        ),
      },
      status: 'IN_PROGRESS',
    });
    runtime.sockets.set('sock-m', {
      socketId: 'sock-m',
      playerId: maharaj,
      sessionId: randomUUID(),
      expectedSequence: 1,
      isWritable: true,
    });
    runtime.sockets.set('sock-s', {
      socketId: 'sock-s',
      playerId: other,
      sessionId: randomUUID(),
      expectedSequence: 1,
      isWritable: true,
    });

    broadcastRoomState(
      runtime,
      (socketId, event, payload) => emissions.push({ socketId, event, payload }),
      'update',
    );

    const mUpdate = emissions.find((e) => e.socketId === 'sock-m');
    const sUpdate = emissions.find((e) => e.socketId === 'sock-s');
    expect(mUpdate).toBeDefined();
    expect(sUpdate).toBeDefined();
    const mView = (mUpdate!.payload as { view: { drawnTilesForMaharaj: unknown[]; isSpectator: boolean } }).view;
    const sView = (sUpdate!.payload as { view: { drawnTilesForMaharaj: unknown[]; isSpectator: boolean; ownRole: string | null } }).view;
    expect(mView.drawnTilesForMaharaj.length).toBe(3);
    expect(mView.isSpectator).toBe(false);
    expect(sView.isSpectator).toBe(true);
    expect(sView.drawnTilesForMaharaj).toEqual([]);
    expect(sView.ownRole).toBeNull();

    // Post-game: roles revealed on public players; still no live decree tiles
    const over: GameState = {
      ...state,
      phase: { kind: 'GAME_OVER', winner: 'PANDAVA', reason: 'DHARMA_DECREES' },
    };
    const postActor = buildStateSyncPayload(over, maharaj).view;
    const postOther = buildStateSyncPayload(over, other).view;
    expect(postActor.players.every((p) => p.revealedRole !== null)).toBe(true);
    expect(postOther.players.every((p) => p.revealedRole !== null)).toBe(true);
    expect(postActor.drawnTilesForMaharaj).toEqual([]);
    expect(postOther.drawnTilesForMaharaj).toEqual([]);
  });
});

describe('CORS production allowlist', () => {
  it('allows wildcard outside production', () => {
    const cfg = resolveCorsOriginConfig({ NODE_ENV: 'development' });
    expect(cfg.mode).toBe('wildcard');
    expect(toSocketIoCorsOrigin(cfg)).toBe('*');
  });

  it('requires CORS_ORIGINS allowlist in production (no *)', () => {
    expect(() =>
      resolveCorsOriginConfig({ NODE_ENV: 'production', CORS_ORIGINS: '' }),
    ).toThrow(/CORS_ORIGINS/);
    expect(() =>
      resolveCorsOriginConfig({ NODE_ENV: 'production', CORS_ORIGINS: '*' }),
    ).toThrow(/CORS_ORIGINS/);

    const cfg = resolveCorsOriginConfig({
      NODE_ENV: 'production',
      CORS_ORIGINS: 'https://a.example, https://b.example',
    });
    expect(cfg).toEqual({
      mode: 'allowlist',
      origins: ['https://a.example', 'https://b.example'],
    });
    expect(toSocketIoCorsOrigin(cfg)).toEqual([
      'https://a.example',
      'https://b.example',
    ]);
  });
});

describe('Unauthenticated path rate limits', () => {
  it('rate-limits room:create floods', async () => {
    const { orch, emissions } = createOrch();
    const capacity = ROOM_CREATE_BUCKET.capacity;

    for (let i = 0; i < capacity; i++) {
      emissions.length = 0;
      await orch.handleEvent(
        'flood-sock',
        ClientEvents.ROOM_CREATE,
        envelope({ displayName: `Host${i}` }),
      );
      expect(emissions.some((e) => e.event === ServerEvents.ROOM_CREATED)).toBe(true);
    }

    emissions.length = 0;
    await orch.handleEvent(
      'flood-sock',
      ClientEvents.ROOM_CREATE,
      envelope({ displayName: 'Overflow' }),
    );
    expect(
      emissions.some(
        (e) =>
          e.event === ServerEvents.ACTION_REJECTED &&
          (e.payload as { code: string }).code === 'RATE_LIMITED',
      ),
    ).toBe(true);
    orch.dispose();
  });
});

describe('Admin auth hardening', () => {
  it('does not expose frozen-room incidents without a valid admin token', async () => {
    const persist = new MemoryPersistence();
    const orch = new Orchestrator({
      persist,
      clock: createTestMonotonicClock(0),
      emit: () => undefined,
      incidents: createIncidentLogger(() => undefined),
      memoryPersist: persist,
    });
    const { mountAdminRoutes } = await import('../src/admin.js');
    const express = (await import('express')).default;
    const app = express();
    mountAdminRoutes(app, orch, persist, { adminToken: 'secret' });

    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    const unauth = await fetch(`http://127.0.0.1:${port}/admin/frozen-rooms`);
    expect(unauth.status).toBe(401);
    const body = (await unauth.json()) as { incidents?: unknown };
    expect(body.incidents).toBeUndefined();

    const bad = await fetch(`http://127.0.0.1:${port}/admin/frozen-rooms`, {
      headers: { Authorization: 'Bearer wrong' },
    });
    expect(bad.status).toBe(401);

    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
    orch.dispose();
  });
});
