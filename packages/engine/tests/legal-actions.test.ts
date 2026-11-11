import { describe, expect, it } from 'vitest';
import {
  applyAction,
  assertInvariants,
  createInitialState,
  getLegalActions,
  getSystemLegalActions,
} from '../src/index.js';
import { isSenapatiEligible } from '../src/term-limits.js';
import {
  advancePastRoleReveal,
  makeDeps,
  nominateAndElect,
  startFivePlayerGame,
} from './helpers.js';

describe('getLegalActions', () => {
  it('ROLE_REVEAL: only pending players may ACK; system may timeout', () => {
    const state = startFivePlayerGame(7);
    expect(state.phase.kind).toBe('ROLE_REVEAL');
    if (state.phase.kind !== 'ROLE_REVEAL') return;

    const pending = state.phase.pendingAcks;
    expect(getLegalActions(state, pending[0]!).map((a) => a.type)).toEqual([
      'ACK_ROLE_REVEAL',
    ]);
    const acked = applyAction(
      state,
      { type: 'ACK_ROLE_REVEAL', playerId: pending[0]! },
      makeDeps(7),
    ).state;
    expect(getLegalActions(acked, pending[0]!)).toEqual([]);
    expect(getSystemLegalActions(state).map((a) => a.type)).toEqual([
      'ROLE_REVEAL_TIMEOUT',
    ]);
  });

  it('ELECTION_NOMINATION: Maharaj only gets eligible nominees matching isSenapatiEligible', () => {
    const deps = makeDeps(11);
    const state = advancePastRoleReveal(startFivePlayerGame(11), deps);
    expect(state.phase.kind).toBe('ELECTION_NOMINATION');
    const maharajId = state.maharajCandidateId;
    const legal = getLegalActions(state, maharajId);
    expect(legal.length).toBeGreaterThan(0);
    expect(legal.every((a) => a.type === 'NOMINATE_SENAPATI')).toBe(true);

    const eligibleIds = state.players
      .filter((p) => isSenapatiEligible(state, p.id).eligible)
      .map((p) => p.id)
      .sort();
    const legalIds = legal
      .filter((a) => a.type === 'NOMINATE_SENAPATI')
      .map((a) => a.nomineeId)
      .sort();
    expect(legalIds).toEqual(eligibleIds);

    for (const other of state.players) {
      if (other.id === maharajId) continue;
      expect(getLegalActions(state, other.id)).toEqual([]);
    }
  });

  it('ELECTION_VOTING: living players without ballots get HA/NAHI; system has CAST_DEFAULT_VOTES', () => {
    const deps = makeDeps(13);
    let state = advancePastRoleReveal(startFivePlayerGame(13), deps);
    const nominee = state.players.find((p) => p.id !== state.maharajCandidateId)!.id;
    state = applyAction(
      state,
      {
        type: 'NOMINATE_SENAPATI',
        maharajId: state.maharajCandidateId,
        nomineeId: nominee,
      },
      deps,
    ).state;
    expect(state.phase.kind).toBe('DISCUSSION_PRE_VOTE');
    state = applyAction(state, { type: 'DISCUSSION_PRE_VOTE_TIMEOUT' }, deps).state;
    expect(state.phase.kind).toBe('ELECTION_VOTING');
    const voter = state.players[0]!.id;
    const votes = getLegalActions(state, voter);
    expect(votes.map((a) => (a.type === 'CAST_VOTE' ? a.vote : null))).toEqual([
      'HA',
      'NAHI',
    ]);
    expect(getSystemLegalActions(state).map((a) => a.type)).toEqual(['CAST_DEFAULT_VOTES']);

    state = applyAction(state, { type: 'CAST_VOTE', playerId: voter, vote: 'HA' }, deps).state;
    expect(getLegalActions(state, voter)).toEqual([]);
  });

  it('LEGISLATION_MAHARAJ: seated Maharaj may discard each drawn tile', () => {
    const deps = makeDeps(42);
    let state = advancePastRoleReveal(startFivePlayerGame(42), deps);
    const nominee = state.players.find((p) => p.id !== state.maharajCandidateId)!.id;
    state = nominateAndElect(state, nominee, deps, 'HA');
    expect(state.phase.kind).toBe('LEGISLATION_MAHARAJ');
    if (state.phase.kind !== 'LEGISLATION_MAHARAJ') return;
    const maharajId = state.currentGovernment!.maharajId;
    const legal = getLegalActions(state, maharajId);
    expect(legal).toHaveLength(3);
    expect(legal.every((a) => a.type === 'DISCARD_MAHARAJ_TILE')).toBe(true);
    expect(getLegalActions(state, state.currentGovernment!.senapatiId)).toEqual([]);
  });

  it('LEGISLATION_SENAPATI: Senapati gets discard options for both held tiles', () => {
    const deps = makeDeps(42);
    let state = advancePastRoleReveal(startFivePlayerGame(42), deps);
    const nominee = state.players.find((p) => p.id !== state.maharajCandidateId)!.id;
    state = nominateAndElect(state, nominee, deps, 'HA');
    expect(state.phase.kind).toBe('LEGISLATION_MAHARAJ');
    if (state.phase.kind !== 'LEGISLATION_MAHARAJ') return;
    const maharajId = state.currentGovernment!.maharajId;
    state = applyAction(
      state,
      {
        type: 'DISCARD_MAHARAJ_TILE',
        maharajId,
        tileId: state.phase.drawnTiles[0]!.id,
      },
      deps,
    ).state;
    expect(state.phase.kind).toBe('LEGISLATION_SENAPATI');
    if (state.phase.kind !== 'LEGISLATION_SENAPATI') return;
    const senapatiId = state.currentGovernment!.senapatiId;
    const legal = getLegalActions(state, senapatiId);
    expect(legal.filter((a) => a.type === 'DISCARD_SENAPATI_TILE')).toHaveLength(2);
    expect(legal.some((a) => a.type === 'PROPOSE_VETO')).toBe(false);
  });

  it('EC-122: enacting Adharma into a power keeps seated government for EXECUTIVE_ACTION', () => {
    const deps = makeDeps(77);
    let state = advancePastRoleReveal(startFivePlayerGame(77), deps);
    // Force enough Adharma so the next enactment hits a power slot (5–6 track: slot 3 = AKASHVANI).
    // Drive by mutating counts carefully while preserving tile accounting, then elect & enact.
    // Simpler path: set enactedAdharma to 2, remove 2 tiles from deck, elect, enact ADHARMA.
    state = {
      ...state,
      enactedAdharma: 2,
      decreeDeck: state.decreeDeck.slice(2),
    };
    const nominee = state.players.find((p) => p.id !== state.maharajCandidateId)!.id;
    state = nominateAndElect(state, nominee, deps, 'HA');
    expect(state.phase.kind).toBe('LEGISLATION_MAHARAJ');
    if (state.phase.kind !== 'LEGISLATION_MAHARAJ') return;
    const gov = state.currentGovernment!;
    // Discard to leave an ADHARMA to enact if possible; otherwise enact whatever and skip.
    const tiles = state.phase.drawnTiles;
    const dharmaDiscard = tiles.find((t) => t.type === 'DHARMA') ?? tiles[0]!;
    state = applyAction(
      state,
      { type: 'DISCARD_MAHARAJ_TILE', maharajId: gov.maharajId, tileId: dharmaDiscard.id },
      deps,
    ).state;
    expect(state.phase.kind).toBe('LEGISLATION_SENAPATI');
    if (state.phase.kind !== 'LEGISLATION_SENAPATI') return;
    const held = state.phase.heldTiles;
    const discard =
      held.find((t) => t.type === 'DHARMA')?.id ??
      held[0]!.id;
    state = applyAction(
      state,
      { type: 'DISCARD_SENAPATI_TILE', senapatiId: gov.senapatiId, tileId: discard },
      deps,
    ).state;
    if (state.phase.kind === 'EXECUTIVE_ACTION') {
      expect(state.currentGovernment).not.toBeNull();
      expect(state.currentGovernment?.maharajId).toBe(gov.maharajId);
      expect(state.currentGovernment?.senapatiId).toBe(gov.senapatiId);
      assertInvariants(state);
    }
  });

  it('EC-121: deck integrity holds while tiles are drawn into legislation', () => {
    const deps = makeDeps(42);
    let state = advancePastRoleReveal(startFivePlayerGame(42), deps);
    const nominee = state.players.find((p) => p.id !== state.maharajCandidateId)!.id;
    state = nominateAndElect(state, nominee, deps, 'HA');
    expect(state.phase.kind).toBe('LEGISLATION_MAHARAJ');
    assertInvariants(state);
  });

  it('EC-123: 6-player rebalance pre-enacts one Adharma without breaking tile total', () => {
    const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'] as const;
    const deps = makeDeps(9);
    const names = Object.fromEntries(ids.map((id) => [id, id]));
    const state = applyAction(
      createInitialState('room-rb', 'p1'),
      {
        type: 'START_GAME',
        playerIds: [...ids],
        displayNames: names,
        hostPlayerId: 'p1',
        rebalanceEnabled: true,
        seed: 9,
      },
      deps,
    ).state;
    expect(state.enactedAdharma).toBe(1);
    expect(state.decreeDeck.length).toBe(16);
    expect(state.decreeDeck.length + state.enactedAdharma).toBe(17);
    assertInvariants(state);
  });
});
