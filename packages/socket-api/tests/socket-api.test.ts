import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createInitialState,
  createRng,
  createClock,
  defaultPowerTable,
  type EngineDeps,
  type GameState,
} from '@shaatir-shakuni/engine';
import {
  PROTOCOL_VERSION,
  ClientEvents,
  parseInboundEvent,
  parseWithSchema,
  gameActionSchema,
  clientHelloSchema,
  checkClientHello,
  checkConnectionGuards,
  createMemoryActionDedupStore,
  checkActionDedup,
  rememberActionUuid,
  checkChatGate,
  buildStateSyncPayload,
  collectWireTileIds,
  stateSyncSchema,
  wirePlayerViewSchema,
} from '../src/index.js';

const PLAYER_IDS = ['p1', 'p2', 'p3', 'p4', 'p5'] as const;

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

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: PROTOCOL_VERSION,
    actionUuid: randomUUID(),
    sequence: 0,
    stateVersion: 0,
    ...overrides,
  };
}

describe('Zod inbound validation', () => {
  it('accepts a valid game:action envelope', () => {
    const raw = {
      ...envelope(),
      payload: { type: 'CAST_VOTE', vote: 'HA' },
    };
    const result = parseWithSchema(gameActionSchema, raw);
    expect(result.ok).toBe(true);
  });

  it('rejects invalid vote choice without throwing', () => {
    const raw = {
      ...envelope(),
      payload: { type: 'CAST_VOTE', vote: 'MAYBE' },
    };
    const result = parseInboundEvent(ClientEvents.GAME_ACTION, raw);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('VALIDATION_FAILED');
    }
  });

  it('parses room:play_again like room:start', () => {
    const roomId = randomUUID();
    const raw = {
      ...envelope(),
      payload: { roomId },
    };
    const result = parseInboundEvent(ClientEvents.ROOM_PLAY_AGAIN, raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect((result.data as { payload: { roomId: string } }).payload.roomId).toBe(roomId);
    }
  });

  it('rejects unknown event names', () => {
    const result = parseInboundEvent('not:a:real:event', {});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('UNKNOWN_EVENT');
    }
  });

  it('rejects non-uuid actionUuid', () => {
    const raw = {
      ...envelope({ actionUuid: 'not-a-uuid' }),
      payload: { type: 'ACK_ROLE_REVEAL' },
    };
    const result = parseInboundEvent(ClientEvents.GAME_ACTION, raw);
    expect(result.ok).toBe(false);
  });
});

describe('EC-24 protocol version', () => {
  it('detects mismatch explicitly on hello', () => {
    const ok = checkClientHello(PROTOCOL_VERSION);
    expect(ok.ok).toBe(true);
    expect(ok.requireStateSync).toBe(false);

    const bad = checkClientHello(PROTOCOL_VERSION + 99);
    expect(bad.ok).toBe(false);
    expect(bad.requireStateSync).toBe(true);
    expect(bad.serverVersion).toBe(PROTOCOL_VERSION);
  });

  it('parses hello and flags mismatch via guard', () => {
    const parsed = parseWithSchema(clientHelloSchema, { protocolVersion: 999 });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const hello = checkClientHello(parsed.data.protocolVersion as number);
    expect(hello.requireStateSync).toBe(true);
  });
});

describe('EC-21/EC-22 sequence + EC-23/EC-33 state version', () => {
  it('accepts exact next sequence and matching state version', () => {
    const result = checkConnectionGuards({
      protocolVersion: PROTOCOL_VERSION,
      sequence: 3,
      expectedSequence: 3,
      claimedStateVersion: 10,
      currentStateVersion: 10,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.nextExpectedSequence).toBe(4);
    }
  });

  it('rejects behind or skipped sequence without reordering', () => {
    const behind = checkConnectionGuards({
      protocolVersion: PROTOCOL_VERSION,
      sequence: 1,
      expectedSequence: 3,
      claimedStateVersion: 1,
      currentStateVersion: 1,
    });
    expect(behind.ok).toBe(false);
    if (!behind.ok) {
      expect(behind.code).toBe('SEQUENCE_REJECTED');
    }

    const skipped = checkConnectionGuards({
      protocolVersion: PROTOCOL_VERSION,
      sequence: 5,
      expectedSequence: 3,
      claimedStateVersion: 1,
      currentStateVersion: 1,
    });
    expect(skipped.ok).toBe(false);
    if (!skipped.ok) {
      expect(skipped.code).toBe('SEQUENCE_REJECTED');
    }
  });

  it('allows stale state version so concurrent votes/acks are not dropped', () => {
    const result = checkConnectionGuards({
      protocolVersion: PROTOCOL_VERSION,
      sequence: 0,
      expectedSequence: 0,
      claimedStateVersion: 4,
      currentStateVersion: 9,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.nextExpectedSequence).toBe(1);
    }
  });

  it('rejects future state version claims', () => {
    const result = checkConnectionGuards({
      protocolVersion: PROTOCOL_VERSION,
      sequence: 0,
      expectedSequence: 0,
      claimedStateVersion: 12,
      currentStateVersion: 9,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('STATE_VERSION_MISMATCH');
      expect(result.requireStateSync).toBe(true);
    }
  });

  it('rejects protocol mismatch before sequence check', () => {
    const result = checkConnectionGuards({
      protocolVersion: 0,
      sequence: 0,
      expectedSequence: 0,
      claimedStateVersion: 0,
      currentStateVersion: 0,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('PROTOCOL_MISMATCH');
      expect(result.requireStateSync).toBe(true);
    }
  });
});

describe('EC-19/EC-20 action UUID dedup', () => {
  it('first UUID is NEW; second is DUPLICATE silent no-op', () => {
    const store = createMemoryActionDedupStore();
    const id = randomUUID();
    expect(checkActionDedup(store, id).kind).toBe('NEW');
    rememberActionUuid(store, id);
    expect(checkActionDedup(store, id).kind).toBe('DUPLICATE');
    expect(checkActionDedup(store, randomUUID()).kind).toBe('NEW');
  });
});

describe('EC-53 chat gate', () => {
  it('forbids chat for everyone during LEGISLATION_MAHARAJ and SENAPATI', () => {
    const maharajPhase = toLegislationMaharaj(11);
    expect(maharajPhase.phase.kind).toBe('LEGISLATION_MAHARAJ');
    const maharajId = maharajPhase.currentGovernment!.maharajId;
    const gate = checkChatGate(maharajPhase.phase);
    expect(gate.allowed).toBe(false);
    expect(gate.code).toBe('CHAT_FORBIDDEN');
    // Gate is phase-based, not role-based — Maharaj is also blocked.
    expect(maharajId).toBeTruthy();

    const deps = makeDeps(11);
    const discard = maharajPhase.phase.kind === 'LEGISLATION_MAHARAJ'
      ? maharajPhase.phase.drawnTiles[0]!.id
      : '';
    const senapatiState = applyAction(
      maharajPhase,
      { type: 'DISCARD_MAHARAJ_TILE', maharajId, tileId: discard },
      deps,
    ).state;
    expect(senapatiState.phase.kind).toBe('LEGISLATION_SENAPATI');
    expect(checkChatGate(senapatiState.phase).allowed).toBe(false);
  });

  it('allows chat outside legislation phases', () => {
    const state = pastRoleReveal(startGame(3), 3);
    expect(state.phase.kind).toBe('ELECTION_NOMINATION');
    expect(checkChatGate(state.phase).allowed).toBe(true);
  });
});

describe('EC-15 state sync is authoritative filtered view', () => {
  it('buildStateSyncPayload matches wire schema and carries server stateVersion', () => {
    const state = startGame(5);
    const sync = buildStateSyncPayload(state, 'p1');
    const parsed = stateSyncSchema.safeParse(sync);
    expect(parsed.success).toBe(true);
    expect(sync.view.stateVersion).toBe(state.stateVersion);
    expect(sync.view.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(sync.view.ownRole).not.toBeNull();
  });
});

describe('EC-30 wire timer display fields', () => {
  it('attaches afkDeadlineMs and serverNowMs when provided', () => {
    const state = startGame(5);
    const sync = buildStateSyncPayload(state, 'p1', {
      timers: { afkDeadlineMs: 15_000, serverNowMs: 1_000 },
    });
    expect(wirePlayerViewSchema.safeParse(sync.view).success).toBe(true);
    expect(sync.view.afkDeadlineMs).toBe(15_000);
    expect(sync.view.serverNowMs).toBe(1_000);
  });

  it('defaults timers to null deadline and zero serverNow when omitted', () => {
    const state = startGame(5);
    const sync = buildStateSyncPayload(state, 'p1');
    expect(sync.view.afkDeadlineMs).toBeNull();
    expect(sync.view.serverNowMs).toBe(0);
  });
});

describe('EC-69/EC-71/EC-72/EC-73 wire filtering', () => {
  it('EC-72: non-Maharaj wire view has no drawn tiles (top-level or phase)', () => {
    const state = toLegislationMaharaj(21);
    expect(state.phase.kind).toBe('LEGISLATION_MAHARAJ');
    if (state.phase.kind !== 'LEGISLATION_MAHARAJ') return;

    const maharaj = state.currentGovernment!.maharajId;
    const other = state.players.find((p) => p.id !== maharaj)!.id;
    const secretIds = state.phase.drawnTiles.map((t) => t.id);

    const maharajWire = buildStateSyncPayload(state, maharaj).view;
    const otherWire = buildStateSyncPayload(state, other).view;

    expect(maharajWire.drawnTilesForMaharaj.length).toBe(3);
    expect(new Set(collectWireTileIds(maharajWire)).size).toBe(3);
    for (const id of secretIds) {
      expect(collectWireTileIds(otherWire)).not.toContain(id);
    }
    expect(otherWire.drawnTilesForMaharaj).toEqual([]);
    expect(otherWire.phase.drawnTiles ?? []).toEqual([]);
  });

  it('EC-72: non-Senapati wire view has no held tiles in phase', () => {
    let state = toLegislationMaharaj(22);
    const deps = makeDeps(22);
    const maharaj = state.currentGovernment!.maharajId;
    if (state.phase.kind !== 'LEGISLATION_MAHARAJ') return;
    const discard = state.phase.drawnTiles[0]!.id;
    state = applyAction(
      state,
      { type: 'DISCARD_MAHARAJ_TILE', maharajId: maharaj, tileId: discard },
      deps,
    ).state;
    expect(state.phase.kind).toBe('LEGISLATION_SENAPATI');
    if (state.phase.kind !== 'LEGISLATION_SENAPATI') return;

    const senapati = state.currentGovernment!.senapatiId;
    const other = state.players.find((p) => p.id !== senapati)!.id;
    const secretIds = state.phase.heldTiles.map((t) => t.id);

    const senapatiWire = buildStateSyncPayload(state, senapati).view;
    const otherWire = buildStateSyncPayload(state, other).view;

    expect(senapatiWire.heldTiles.length).toBe(2);
    for (const id of secretIds) {
      expect(collectWireTileIds(otherWire)).not.toContain(id);
    }
    expect(otherWire.heldTiles).toEqual([]);
    expect(otherWire.phase.heldTiles ?? []).toEqual([]);
  });

  it('EC-71: spectator sync hides role and investigations', () => {
    const state = startGame(9);
    const wire = buildStateSyncPayload(state, 'p1', { asSpectator: true }).view;
    expect(wire.isSpectator).toBe(true);
    expect(wire.ownRole).toBeNull();
    expect(wire.ownTeam).toBeNull();
    expect(wire.knownKauravas).toEqual([]);
    expect(wire.ownInvestigations).toEqual([]);
    expect(wire.heldTiles).toEqual([]);
    expect(wire.drawnTilesForMaharaj).toEqual([]);
  });

  it('EC-69/EC-73: investigation results only on investigating Maharaj wire view', () => {
    let state = pastRoleReveal(startGame(30), 30);
    const maharaj = state.maharajCandidateId;
    const target = state.players.find((p) => p.id !== maharaj)!.id;
    state = {
      ...state,
      phase: { kind: 'EXECUTIVE_ACTION', power: 'DIVYA_DRISHTI' },
      currentGovernment: { maharajId: maharaj, senapatiId: target },
      privateInvestigations: {
        [maharaj]: [{ targetPlayerId: target, team: 'KAURAVA' }],
      },
    };

    const mWire = buildStateSyncPayload(state, maharaj).view;
    const oWire = buildStateSyncPayload(state, target).view;

    expect(mWire.ownInvestigations).toEqual([
      { targetPlayerId: target, team: 'KAURAVA' },
    ]);
    expect(oWire.ownInvestigations).toEqual([]);
    expect(wirePlayerViewSchema.safeParse(mWire).success).toBe(true);
    expect(wirePlayerViewSchema.safeParse(oWire).success).toBe(true);
  });

  it('EC-69: other players do not see foreign roles on wire', () => {
    const state = startGame(12);
    const wire = buildStateSyncPayload(state, 'p1').view;
    for (const p of wire.players) {
      expect(p.revealedRole).toBeNull();
    }
    expect(wire.ownRole).not.toBeNull();
  });
});
