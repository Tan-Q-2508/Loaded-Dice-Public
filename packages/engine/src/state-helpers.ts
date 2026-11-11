import type { GameState, GameEvent, Phase } from './types.js';

export function createInitialState(roomId: string, hostPlayerId: string): GameState {
  return {
    roomId,
    hostPlayerId,
    rebalanceEnabled: false,
    startPlayerCount: 0,
    players: [],
    phase: { kind: 'LOBBY' },
    decreeDeck: [],
    ashPile: [],
    enactedDharma: 0,
    enactedAdharma: 0,
    electionTracker: 0,
    maharajCandidateId: '',
    senapatiCandidateId: null,
    currentGovernment: null,
    lastElectedGovernment: null,
    investigatedPlayerIds: [],
    summonsReturnAfterPlayerId: null,
    privateInvestigations: {},
    lastExiledPlayerId: null,
    seed: 0,
    stateVersion: 0,
    expectedTileCount: 17,
  };
}

export function bumpVersion(state: GameState, events: GameEvent[]): {
  state: GameState;
  events: GameEvent[];
} {
  return {
    state: { ...state, stateVersion: state.stateVersion + 1 },
    events,
  };
}

export function reject(
  state: GameState,
  actionType: string,
  reason: string,
): { state: GameState; events: GameEvent[] } {
  return {
    state,
    events: [{ type: 'ACTION_REJECTED', actionType, reason }],
  };
}

export function freeze(
  state: GameState,
  reason: string,
): { state: GameState; events: GameEvent[] } {
  const next: GameState = {
    ...state,
    phase: { kind: 'ROOM_FROZEN', reason },
    stateVersion: state.stateVersion + 1,
  };
  return {
    state: next,
    events: [{ type: 'ROOM_FAILURE', mode: 'ROOM_FROZEN', reason }],
  };
}

export function corrupt(
  state: GameState,
  reason: string,
): { state: GameState; events: GameEvent[] } {
  const next: GameState = {
    ...state,
    phase: { kind: 'ROOM_CORRUPTED', reason },
    stateVersion: state.stateVersion + 1,
  };
  return {
    state: next,
    events: [{ type: 'ROOM_FAILURE', mode: 'ROOM_CORRUPTED', reason }],
  };
}

export function livingPlayers(state: GameState) {
  return state.players.filter((p) => p.isAlive);
}

export function getPlayer(state: GameState, playerId: string) {
  return state.players.find((p) => p.id === playerId);
}

export function nextLivingPlayerId(
  state: GameState,
  afterPlayerId: string,
): string | null {
  const living = livingPlayers(state).sort((a, b) => a.seatOrder - b.seatOrder);
  if (living.length === 0) return null;
  const idx = living.findIndex((p) => p.id === afterPlayerId);
  if (idx === -1) {
    return living[0]?.id ?? null;
  }
  const next = living[(idx + 1) % living.length];
  return next?.id ?? null;
}

export function advanceMaharajPlacard(state: GameState): GameState {
  const nextId = nextLivingPlayerId(state, state.maharajCandidateId);
  if (!nextId) return state;
  return { ...state, maharajCandidateId: nextId, senapatiCandidateId: null };
}

export function phaseKind(phase: Phase): Phase['kind'] {
  return phase.kind;
}

export function withPhase(
  state: GameState,
  phase: Phase,
  events: GameEvent[],
): { state: GameState; events: GameEvent[] } {
  const from = state.phase.kind;
  const to = phase.kind;
  const phaseEvent: GameEvent =
    from === to
      ? { type: 'PHASE_CHANGED', from, to }
      : { type: 'PHASE_CHANGED', from, to };
  return bumpVersion(
    { ...state, phase },
  {
    ...events,
    ...(from !== to ? [phaseEvent] : []),
  },
  );
}

export function isVetoUnlocked(state: GameState): boolean {
  return state.enactedAdharma >= 5;
}
