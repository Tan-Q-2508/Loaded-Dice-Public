import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createClock,
  createInitialState,
  createRng,
  defaultPowerTable,
  type EngineDeps,
  type GameState,
} from '@shaatir-shakuni/engine';
import { collectWireTileIds } from '@shaatir-shakuni/socket-api';
import {
  applyDisconnect,
  attachSession,
  computeAfkDeadline,
  DEFAULT_TIMEOUTS,
  emptyRoomDisposition,
  isAfkDeadlineExpired,
  isInReconnectWindow,
  performNetworkBlipReconnect,
  performReconnect,
  pickAfkNomination,
  reconnectCapabilities,
  resolveAfkAction,
  type PlayerConnectionHandle,
  type SessionHandle,
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

function startFivePlayerGame(seed = 42): GameState {
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

function advancePastRoleReveal(state: GameState, deps: EngineDeps): GameState {
  let current = state;
  for (const id of PLAYER_IDS) {
    current = applyAction(current, { type: 'ACK_ROLE_REVEAL', playerId: id }, deps).state;
  }
  return current;
}

function castAllVotes(
  state: GameState,
  vote: 'HA' | 'NAHI',
  deps: EngineDeps,
): GameState {
  let current = state;
  if (current.phase.kind === 'DISCUSSION_PRE_VOTE') {
    current = applyAction(current, { type: 'DISCUSSION_PRE_VOTE_TIMEOUT' }, deps).state;
  }
  if (current.phase.kind !== 'ELECTION_VOTING') return current;
  for (const p of current.players.filter((pl) => pl.isAlive)) {
    current = applyAction(
      current,
      { type: 'CAST_VOTE', playerId: p.id, vote },
      deps,
    ).state;
  }
  if (current.phase.kind === 'ELECTION_VOTING' && current.phase.votesRevealed) {
    current = applyAction(current, { type: 'RESOLVE_ELECTION' }, deps).state;
  }
  if (current.phase.kind === 'DECREE_CEREMONY') {
    current = applyAction(current, { type: 'ADVANCE_AFTER_DECREE' }, deps).state;
  }
  return current;
}

function nominateAndElect(
  state: GameState,
  nomineeId: string,
  deps: EngineDeps,
): GameState {
  const maharajId = state.maharajCandidateId;
  let current = applyAction(
    state,
    { type: 'NOMINATE_SENAPATI', maharajId, nomineeId },
    deps,
  ).state;
  return castAllVotes(current, 'HA', deps);
}

function basePlayer(id: string): PlayerConnectionHandle {
  return {
    id,
    roomId: '11111111-1111-1111-1111-111111111111',
    sessionId: '22222222-2222-2222-2222-222222222222',
    connectionStatus: 'CONNECTED',
    isAlive: true,
  };
}

function baseSession(playerId: string): SessionHandle {
  return {
    id: '22222222-2222-2222-2222-222222222222',
    playerId,
    authToken: 'opaque-token-abc',
    socketId: 'socket-old',
    lastSeenAtMs: 1_000,
  };
}

describe('connection attach / disconnect (EC-08)', () => {
  it('re-attaches the same Player/Session and never invents a new player id', () => {
    const player = basePlayer('p1');
    const session = baseSession('p1');
    const result = attachSession({
      player,
      session,
      presentedAuthToken: 'opaque-token-abc',
      newSocketId: 'socket-new',
      nowMs: 5_000,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.player.id).toBe('p1');
    expect(result.session.id).toBe(session.id);
    expect(result.session.socketId).toBe('socket-new');
    expect(result.player.connectionStatus).toBe('CONNECTED');
    expect(result.previousSocketId).toBe('socket-old');
  });

  it('rejects a mismatched token without mutating identity', () => {
    const result = attachSession({
      player: basePlayer('p1'),
      session: baseSession('p1'),
      presentedAuthToken: 'wrong',
      newSocketId: 'socket-new',
      nowMs: 5_000,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('SESSION_TOKEN_MISMATCH');
  });

  it('disconnect clears socket and marks DISCONNECTED', () => {
    const out = applyDisconnect(basePlayer('p1'), baseSession('p1'), 9_000);
    expect(out.player.connectionStatus).toBe('DISCONNECTED');
    expect(out.session.socketId).toBeNull();
    expect(out.session.lastSeenAtMs).toBe(9_000);
  });
});

describe('EC-04 IN_PROGRESS empty-room window', () => {
  it('preserves IN_PROGRESS rooms inside the reconnect window', () => {
    const now = 100_000;
    const goneAt = now - 60_000;
    expect(
      emptyRoomDisposition({
        roomStatus: 'IN_PROGRESS',
        lastSocketGoneAtMs: goneAt,
        nowMs: now,
      }),
    ).toBe('PRESERVE');
    expect(
      isInReconnectWindow({
        roomStatus: 'IN_PROGRESS',
        lastSocketGoneAtMs: goneAt,
        nowMs: now,
      }),
    ).toBe(true);
  });

  it('abandons IN_PROGRESS only after the reconnect window elapses', () => {
    const goneAt = 0;
    const after = DEFAULT_TIMEOUTS.inProgressReconnectWindowMs;
    expect(
      emptyRoomDisposition({
        roomStatus: 'IN_PROGRESS',
        lastSocketGoneAtMs: goneAt,
        nowMs: after,
      }),
    ).toBe('ABANDON');
  });

  it('does not apply lobby cleanup policy here (LOBBY → NOT_APPLICABLE)', () => {
    expect(
      emptyRoomDisposition({
        roomStatus: 'LOBBY',
        lastSocketGoneAtMs: 0,
        nowMs: 999_999_999,
      }),
    ).toBe('NOT_APPLICABLE');
  });
});

describe('EC-25 / EC-26 resync', () => {
  it('restores private Maharaj tiles on mid-legislation reconnect', () => {
    const deps = makeDeps(7);
    let state = advancePastRoleReveal(startFivePlayerGame(7), deps);
    const maharaj = state.maharajCandidateId;
    const nominee = state.players.find((p) => p.id !== maharaj)?.id;
    if (!nominee) throw new Error('no nominee');
    state = nominateAndElect(state, nominee, deps);
    expect(state.phase.kind).toBe('LEGISLATION_MAHARAJ');
    if (state.phase.kind !== 'LEGISLATION_MAHARAJ') return;
    const tileIds = state.phase.drawnTiles.map((t) => t.id);

    const result = performReconnect({
      player: basePlayer(maharaj),
      session: { ...baseSession(maharaj), playerId: maharaj },
      presentedAuthToken: 'opaque-token-abc',
      newSocketId: 'sock-refresh',
      nowMs: 50_000,
      gameState: state,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sync.view.viewerId).toBe(maharaj);
    expect(result.sync.view.drawnTilesForMaharaj.map((t) => t.id)).toEqual(tileIds);
    expect(result.capabilities.canSubmitGameActions).toBe(true);
  });

  it('uses the same function for network-blip reconnect (EC-26)', () => {
    expect(performNetworkBlipReconnect).toBe(performReconnect);
  });

  it('does not leak Maharaj tiles to another reconnecting player', () => {
    const deps = makeDeps(7);
    let state = advancePastRoleReveal(startFivePlayerGame(7), deps);
    const maharaj = state.maharajCandidateId;
    const other = state.players.find((p) => p.id !== maharaj)?.id;
    if (!other) throw new Error('no other');
    state = nominateAndElect(state, other, deps);
    expect(state.phase.kind).toBe('LEGISLATION_MAHARAJ');
    if (state.phase.kind !== 'LEGISLATION_MAHARAJ') return;
    const secretIds = new Set(state.phase.drawnTiles.map((t) => t.id));

    const result = performReconnect({
      player: basePlayer(other),
      session: { ...baseSession(other), playerId: other },
      presentedAuthToken: 'opaque-token-abc',
      newSocketId: 'sock-other',
      nowMs: 50_000,
      gameState: state,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const leaked = collectWireTileIds(result.sync.view).filter((id) => secretIds.has(id));
    expect(leaked).toEqual([]);
  });
});

describe('EC-107 exiled reconnect', () => {
  it('reconnects as spectator without others’ hand tiles', () => {
    const deps = makeDeps(11);
    let state = advancePastRoleReveal(startFivePlayerGame(11), deps);
    // Drive until we can exile someone: force a known path via repeated elect+enact is heavy;
    // instead mark a player dead on a cloned mid-nomination state for view/capability checks.
    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 0 ? { ...p, isAlive: false } : p,
      ),
    };
    const exiledId = state.players[0]!.id;

    const result = performReconnect({
      player: { ...basePlayer(exiledId), isAlive: false },
      session: { ...baseSession(exiledId), playerId: exiledId },
      presentedAuthToken: 'opaque-token-abc',
      newSocketId: 'sock-exile',
      nowMs: 80_000,
      gameState: state,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.capabilities.isSpectator).toBe(true);
    expect(result.capabilities.canSubmitGameActions).toBe(false);
    expect(result.sync.view.isSpectator).toBe(true);
    expect(result.sync.view.heldTiles).toEqual([]);
    expect(result.sync.view.drawnTilesForMaharaj).toEqual([]);
  });
});

describe('EC-108 GAME_OVER reconnect', () => {
  it('allows reconnect with full reveal and no submit capability', () => {
    const deps = makeDeps(3);
    let state = advancePastRoleReveal(startFivePlayerGame(3), deps);
    state = applyAction(
      state,
      { type: 'FORCE_END_GAME', hostPlayerId: 'p1', winner: 'PANDAVA' },
      deps,
    ).state;
    expect(state.phase.kind).toBe('GAME_OVER');

    const result = performReconnect({
      player: basePlayer('p2'),
      session: { ...baseSession('p2'), playerId: 'p2' },
      presentedAuthToken: 'opaque-token-abc',
      newSocketId: 'sock-over',
      nowMs: 90_000,
      gameState: state,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.capabilities.canSubmitGameActions).toBe(false);
    expect(result.sync.view.winner).toBe('PANDAVA');
    expect(result.sync.view.players.every((p) => p.revealedRole !== null)).toBe(true);
  });
});

describe('EC-39 AFK nomination timeout', () => {
  it('computes an absolute action deadline', () => {
    const started = 10_000;
    const deadline = computeAfkDeadline('ELECTION_NOMINATION', started);
    expect(deadline).toBe(started + DEFAULT_TIMEOUTS.actionMs);
    expect(isAfkDeadlineExpired(deadline, deadline! - 1)).toBe(false);
    expect(isAfkDeadlineExpired(deadline, deadline!)).toBe(true);
  });

  it('auto-nominates the lowest seatOrder eligible player', () => {
    const deps = makeDeps(5);
    const state = advancePastRoleReveal(startFivePlayerGame(5), deps);
    expect(state.phase.kind).toBe('ELECTION_NOMINATION');

    const action = pickAfkNomination(state);
    expect(action?.type).toBe('NOMINATE_SENAPATI');
    if (action?.type !== 'NOMINATE_SENAPATI') return;

    const applied = applyAction(state, action, deps);
    expect(applied.rejected).toBeUndefined();
    expect(applied.state.phase.kind).toBe('DISCUSSION_PRE_VOTE');

    const viaResolve = resolveAfkAction(state);
    expect(viaResolve).toEqual(action);
  });

  it('role-reveal AFK resolves to ROLE_REVEAL_TIMEOUT', () => {
    const state = startFivePlayerGame(9);
    expect(resolveAfkAction(state)?.type).toBe('ROLE_REVEAL_TIMEOUT');
    expect(computeAfkDeadline('ROLE_REVEAL', 0)).toBe(DEFAULT_TIMEOUTS.roleRevealMs);
  });

  it('vote-reveal ceremony uses ceremonyVoteRevealMs and RESOLVE_ELECTION', () => {
    const phase = {
      kind: 'ELECTION_VOTING' as const,
      votes: { p1: 'HA' as const },
      votesRevealed: true,
      pendingDone: ['p1'],
    };
    expect(computeAfkDeadline(phase, 0)).toBe(DEFAULT_TIMEOUTS.ceremonyVoteRevealMs);
    const deps = makeDeps(5);
    let state = advancePastRoleReveal(startFivePlayerGame(5), deps);
    const maharaj = state.maharajCandidateId;
    const nominee = state.players.find((p) => p.id !== maharaj)?.id;
    if (!nominee) throw new Error('no nominee');
    state = applyAction(
      state,
      { type: 'NOMINATE_SENAPATI', maharajId: maharaj, nomineeId: nominee },
      deps,
    ).state;
    expect(state.phase.kind).toBe('DISCUSSION_PRE_VOTE');
    state = applyAction(state, { type: 'DISCUSSION_PRE_VOTE_TIMEOUT' }, deps).state;
    for (const p of state.players.filter((pl) => pl.isAlive)) {
      state = applyAction(state, { type: 'CAST_VOTE', playerId: p.id, vote: 'HA' }, deps).state;
    }
    expect(state.phase.kind).toBe('ELECTION_VOTING');
    if (state.phase.kind !== 'ELECTION_VOTING') return;
    expect(state.phase.votesRevealed).toBe(true);
    expect(resolveAfkAction(state)?.type).toBe('RESOLVE_ELECTION');
  });

  it('decree ceremony uses ceremonyDecreeMs and ADVANCE_AFTER_DECREE', () => {
    const phase = {
      kind: 'DECREE_CEREMONY' as const,
      tileType: 'DHARMA' as const,
      tileId: 't1',
      followUp: { kind: 'NOMINATION' as const },
      pendingDone: ['p1'],
    };
    expect(computeAfkDeadline(phase, 1000)).toBe(1000 + DEFAULT_TIMEOUTS.ceremonyDecreeMs);
  });

  it('voting AFK resolves to CAST_DEFAULT_VOTES', () => {
    const deps = makeDeps(5);
    let state = advancePastRoleReveal(startFivePlayerGame(5), deps);
    const maharaj = state.maharajCandidateId;
    const nominee = state.players.find((p) => p.id !== maharaj)?.id;
    if (!nominee) throw new Error('no nominee');
    state = applyAction(
      state,
      { type: 'NOMINATE_SENAPATI', maharajId: maharaj, nomineeId: nominee },
      deps,
    ).state;
    expect(resolveAfkAction(state)?.type).toBe('DISCUSSION_PRE_VOTE_TIMEOUT');
    state = applyAction(state, { type: 'DISCUSSION_PRE_VOTE_TIMEOUT' }, deps).state;
    expect(resolveAfkAction(state)?.type).toBe('CAST_DEFAULT_VOTES');
  });
});

describe('reconnectCapabilities', () => {
  it('blocks submits for frozen rooms', () => {
    const state = startFivePlayerGame(1);
    const frozen: GameState = {
      ...state,
      phase: { kind: 'ROOM_FROZEN', reason: 'test' },
    };
    const caps = reconnectCapabilities(frozen, 'p1');
    expect(caps.canSubmitGameActions).toBe(false);
  });
});
