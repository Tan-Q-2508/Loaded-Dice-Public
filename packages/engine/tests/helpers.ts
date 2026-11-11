import {
  applyAction,
  createInitialState,
  createRng,
  createClock,
  defaultPowerTable,
  type GameState,
  type EngineDeps,
  type GameAction,
} from '../src/index.js';

export const PLAYER_IDS = ['p1', 'p2', 'p3', 'p4', 'p5'] as const;

export function makeDeps(seed = 42): EngineDeps {
  return {
    rng: createRng(seed),
    clock: createClock(0),
    powerTable: defaultPowerTable,
    enforceImmutability: true,
  };
}

export function startFivePlayerGame(seed = 42, rebalance = false): GameState {
  const state = createInitialState('room-1', 'p1');
  const names = Object.fromEntries(PLAYER_IDS.map((id) => [id, id]));
  const deps = makeDeps(seed);
  const result = applyAction(
    state,
    {
      type: 'START_GAME',
      playerIds: [...PLAYER_IDS],
      displayNames: names,
      hostPlayerId: 'p1',
      rebalanceEnabled: rebalance,
      seed,
    },
    deps,
  );
  return result.state;
}

export function advancePastRoleReveal(state: GameState, deps: EngineDeps): GameState {
  let current = state;
  for (const id of PLAYER_IDS) {
    current = applyAction(current, { type: 'ACK_ROLE_REVEAL', playerId: id }, deps).state;
  }
  return current;
}

export function runActions(
  state: GameState,
  actions: GameAction[],
  deps: EngineDeps,
): GameState {
  return actions.reduce((s, action) => applyAction(s, action, deps).state, state);
}

/** Drain public ceremony holds (discussion / vote reveal / decree placement). */
export function resolveCeremonies(state: GameState, deps: EngineDeps): GameState {
  let current = state;
  for (let i = 0; i < 16; i += 1) {
    if (current.phase.kind === 'DISCUSSION_PRE_VOTE') {
      current = applyAction(current, { type: 'DISCUSSION_PRE_VOTE_TIMEOUT' }, deps).state;
      continue;
    }
    if (current.phase.kind === 'ELECTION_VOTING' && current.phase.votesRevealed) {
      current = applyAction(current, { type: 'RESOLVE_ELECTION' }, deps).state;
      continue;
    }
    if (current.phase.kind === 'DECREE_CEREMONY') {
      current = applyAction(current, { type: 'ADVANCE_AFTER_DECREE' }, deps).state;
      continue;
    }
    break;
  }
  return current;
}

export function castAllVotes(
  state: GameState,
  vote: 'HA' | 'NAHI',
  deps: EngineDeps,
): GameState {
  let current = state;
  if (current.phase.kind === 'DISCUSSION_PRE_VOTE') {
    current = resolveCeremonies(current, deps);
  }
  if (current.phase.kind !== 'ELECTION_VOTING') return current;
  for (const p of current.players.filter((pl) => pl.isAlive)) {
    current = applyAction(
      current,
      { type: 'CAST_VOTE', playerId: p.id, vote },
      deps,
    ).state;
  }
  return resolveCeremonies(current, deps);
}

export function nominateAndElect(
  state: GameState,
  nomineeId: string,
  deps: EngineDeps,
  vote: 'HA' | 'NAHI' = 'HA',
): GameState {
  const maharajId = state.maharajCandidateId;
  let current = applyAction(
    state,
    { type: 'NOMINATE_SENAPATI', maharajId, nomineeId },
    deps,
  ).state;
  return castAllVotes(current, vote, deps);
}

export function completeLegislation(
  state: GameState,
  deps: EngineDeps,
  enactIndex: 0 | 1 = 0,
): GameState {
  if (state.phase.kind !== 'LEGISLATION_MAHARAJ') return state;
  const maharajId = state.currentGovernment?.maharajId;
  if (!maharajId) return state;
  const discardId = state.phase.drawnTiles[0]?.id;
  if (!discardId) return state;
  let current = applyAction(
    state,
    { type: 'DISCARD_MAHARAJ_TILE', maharajId, tileId: discardId },
    deps,
  ).state;
  if (current.phase.kind !== 'LEGISLATION_SENAPATI') return current;
  const senapatiId = current.currentGovernment?.senapatiId;
  if (!senapatiId) return current;
  const enactId = current.phase.heldTiles[enactIndex]?.id;
  if (!enactId) return current;
  current = applyAction(
    current,
    { type: 'DISCARD_SENAPATI_TILE', senapatiId, tileId: enactId },
    deps,
  ).state;
  return resolveCeremonies(current, deps);
}

export function findPlayerByRole(state: GameState, role: string): string {
  const p = state.players.find((pl) => pl.role === role);
  if (!p) throw new Error(`No player with role ${role}`);
  return p.id;
}
