import type { GameState, GameEvent, Player, Role, EngineDeps } from './types.js';
import { ROLE_COUNTS, teamForRole } from './types.js';
import { buildDeck, resetTileCounter } from './deck.js';
import { bumpVersion } from './state-helpers.js';

export function assignRoles(
  playerIds: readonly string[],
  rng: EngineDeps['rng'],
): Map<string, Role> {
  const count = playerIds.length;
  const table = ROLE_COUNTS[count];
  if (!table) {
    throw new Error(`Invalid player count ${count}`);
  }
  const roles: Role[] = [
    ...Array.from({ length: table.pandavas }, () => 'PANDAVA' as Role),
    ...Array.from({ length: table.kauravas }, () => 'KAURAVA' as Role),
    'DURYODHANA',
  ];
  const shuffled = rng.shuffle(roles);
  const map = new Map<string, Role>();
  playerIds.forEach((id, i) => {
    map.set(id, shuffled[i] as Role);
  });
  return map;
}

export function startGame(
  state: GameState,
  playerIds: readonly string[],
  displayNames: Readonly<Record<string, string>>,
  hostPlayerId: string,
  rebalanceEnabled: boolean,
  seed: number,
  rng: EngineDeps['rng'],
): { state: GameState; events: GameEvent[] } {
  const count = playerIds.length;
  if (count < 5 || count > 10) {
    throw new Error('Player count must be 5-10');
  }

  resetTileCounter();

  let enactedDharma = 0;
  let enactedAdharma = 0;
  let expectedTileCount = 17;
  let adharmaInDeck = 11;

  if (rebalanceEnabled) {
    if (count === 6) {
      // Pre-enacted Adharma is one of the 11 Adharma tiles — remove it from the deck
      // so totalTiles (deck+ash+enacted+hand) stays 17 (EC-123).
      enactedAdharma = 1;
      adharmaInDeck = 10;
      expectedTileCount = 17;
    } else if (count === 7) {
      adharmaInDeck = 10;
      expectedTileCount = 16;
    } else if (count === 9) {
      adharmaInDeck = 9;
      expectedTileCount = 15;
    }
  }

  const deck = rng.shuffle(buildDeck(adharmaInDeck, 6));
  const roleMap = assignRoles(playerIds, rng);

  const players: Player[] = playerIds.map((id, index) => ({
    id,
    displayName: displayNames[id] ?? id,
    seatOrder: index,
    role: roleMap.get(id) ?? null,
    isAlive: true,
  }));

  const firstMaharaj = rng.pickOne(players);

  const events: GameEvent[] = [
    { type: 'GAME_STARTED', seed, startPlayerCount: count },
    ...players.map(
      (p): GameEvent => ({
        type: 'ROLE_ASSIGNED',
        playerId: p.id,
        role: p.role as Role,
      }),
    ),
    { type: 'MAHARAJ_CANDIDATE_SET', playerId: firstMaharaj.id },
    { type: 'PHASE_CHANGED', from: 'LOBBY', to: 'ROLE_REVEAL' },
  ];

  const next: GameState = {
    ...state,
    hostPlayerId,
    rebalanceEnabled,
    startPlayerCount: count,
    players,
    phase: { kind: 'ROLE_REVEAL', pendingAcks: [...playerIds] },
    decreeDeck: deck,
    ashPile: [],
    enactedDharma,
    enactedAdharma,
    electionTracker: 0,
    maharajCandidateId: firstMaharaj.id,
    senapatiCandidateId: null,
    currentGovernment: null,
    lastElectedGovernment: null,
    investigatedPlayerIds: [],
    summonsReturnAfterPlayerId: null,
    privateInvestigations: {},
    lastExiledPlayerId: null,
    seed,
    expectedTileCount,
    stateVersion: state.stateVersion + 1,
  };

  return { state: next, events };
}

export function knownKauravasForPlayer(state: GameState, viewerId: string): string[] {
  const viewer = state.players.find((p) => p.id === viewerId);
  if (!viewer?.role) return [];
  const table = ROLE_COUNTS[state.startPlayerCount];
  if (!table) return [];

  if (viewer.role === 'PANDAVA') return [];

  if (viewer.role === 'DURYODHANA') {
    if (!table.duryodhanaKnowsKauravas) return [];
    return state.players
      .filter((p) => p.role === 'KAURAVA')
      .map((p) => p.id);
  }

  if (viewer.role === 'KAURAVA') {
    // Teammates only — Duryodhana is exposed via knownDuryodhanaIdForPlayer.
    return state.players
      .filter((p) => p.role === 'KAURAVA')
      .map((p) => p.id)
      .filter((id) => id !== viewerId);
  }

  return [];
}

/** Private Duryodhana identity for viewers who are allowed to know them. */
export function knownDuryodhanaIdForPlayer(
  state: GameState,
  viewerId: string,
): string | null {
  const viewer = state.players.find((p) => p.id === viewerId);
  if (!viewer?.role) return null;
  if (viewer.role === 'PANDAVA') return null;
  if (viewer.role === 'DURYODHANA') return viewerId;
  if (viewer.role === 'KAURAVA') {
    return state.players.find((p) => p.role === 'DURYODHANA')?.id ?? null;
  }
  return null;
}

export { teamForRole };
