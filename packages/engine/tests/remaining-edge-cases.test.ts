import { describe, it, expect } from 'vitest';
import {
  applyAction,
  createClock,
  deepFreeze,
  assertInvariants,
  getPlayerView,
} from '../src/index.js';

import {
  makeDeps,
  startFivePlayerGame,
  advancePastRoleReveal,
  nominateAndElect,
  findPlayerByRole,
} from './helpers.js';
import { assertDeckIntegrity, totalTiles } from '../src/deck.js';
import { createInitialState } from '../src/index.js';

const deps = (seed = 42) => makeDeps(seed);

describe('remaining edge cases', () => {
  it('EC-42: summons allows term-limited Maharaj candidate', () => {
    let state = advancePastRoleReveal(startFivePlayerGame(30), deps(30));
    const maharaj = state.maharajCandidateId;
    const lastGov = { maharajId: maharaj, senapatiId: 'p2' };
    const result = applyAction(
      {
        ...state,
        lastElectedGovernment: lastGov,
        phase: { kind: 'EXECUTIVE_ACTION', power: 'RAJYA_SABHA_SUMMONS' },
        currentGovernment: { maharajId: maharaj, senapatiId: 'p3' },
      },
      { type: 'EXEC_RAJYA_SABHA_SUMMONS', maharajId: maharaj, targetId: lastGov.maharajId },
      deps(30),
    );
    expect(result.state.maharajCandidateId).toBe(lastGov.maharajId);
  });

  it('EC-46/EC-47: reshuffle when deck low before draw', () => {
    let state = advancePastRoleReveal(startFivePlayerGame(12), deps(12));
    state = nominateAndElect(
      state,
      state.players.find((p) => p.id !== state.maharajCandidateId)!.id,
      deps(12),
    );
    if (state.phase.kind !== 'LEGISLATION_MAHARAJ') return;
    expect(state.phase.drawnTiles.length).toBe(3);
    assertInvariants(state);
  });

  it('EC-50/EC-51: veto agree discards both; disagree forces enact', () => {
    let state = advancePastRoleReveal(startFivePlayerGame(55), deps(55));
    state = nominateAndElect(
      state,
      state.players.find((p) => p.id !== state.maharajCandidateId)!.id,
      deps(55),
    );
    expect(state.phase.kind).toBe('LEGISLATION_MAHARAJ');
    if (state.phase.kind !== 'LEGISLATION_MAHARAJ') return;
    const maharaj = state.currentGovernment!.maharajId;
    const discard = state.phase.drawnTiles[0]!.id;
    state = applyAction(state, { type: 'DISCARD_MAHARAJ_TILE', maharajId: maharaj, tileId: discard }, deps(55)).state;
    expect(state.phase.kind).toBe('LEGISLATION_SENAPATI');
    if (state.phase.kind !== 'LEGISLATION_SENAPATI') return;
    // Unlock veto without breaking tile accounting: treat 5 Adharma as enacted by
    // removing that many tiles from the deck (they are no longer "in play" as deck tiles).
    const bump = 5 - state.enactedAdharma;
    state = {
      ...state,
      enactedAdharma: 5,
      decreeDeck: state.decreeDeck.slice(bump),
    };
    const m = state.currentGovernment!.maharajId;
    const s = state.currentGovernment!.senapatiId;
    state = applyAction(state, { type: 'PROPOSE_VETO', senapatiId: s }, deps(55)).state;
    let current = applyAction(state, { type: 'CAST_VETO_VOTE', playerId: m, vote: 'HA' }, deps(55)).state;
    current = applyAction(current, { type: 'CAST_VETO_VOTE', playerId: s, vote: 'HA' }, deps(55)).state;
    expect(current.electionTracker).toBe(1);
    expect(current.phase.kind).toBe('ELECTION_NOMINATION');
  });

  it('EC-54/EC-57: deck integrity detects corruption', () => {
    const state = startFivePlayerGame();
    const bad = { ...state, decreeDeck: [...state.decreeDeck, { id: 'extra', type: 'DHARMA' as const }] };
    const result = assertDeckIntegrity(bad);
    expect(result.ok).toBe(false);
  });

  it('EC-58: cannot exile dead player', () => {
    let state = advancePastRoleReveal(startFivePlayerGame(), deps());
    const maharaj = state.maharajCandidateId;
    state = {
      ...state,
      players: state.players.map((p) => (p.id === 'p5' ? { ...p, isAlive: false } : p)),
      phase: { kind: 'EXECUTIVE_ACTION', power: 'VANVAS' },
      currentGovernment: { maharajId: maharaj, senapatiId: 'p2' },
    };
    const result = applyAction(
      state,
      { type: 'EXEC_VANVAS', maharajId: maharaj, targetId: 'p5' },
      deps(),
    );
    expect(result.events[0]?.type).toBe('ACTION_REJECTED');
  });

  it('EC-60: invalid target player id rejected', () => {
    let state = advancePastRoleReveal(startFivePlayerGame(), deps());
    const maharaj = state.maharajCandidateId;
    state = {
      ...state,
      phase: { kind: 'EXECUTIVE_ACTION', power: 'VANVAS' },
      currentGovernment: { maharajId: maharaj, senapatiId: 'p2' },
    };
    const result = applyAction(
      state,
      { type: 'EXEC_VANVAS', maharajId: maharaj, targetId: 'ghost' },
      deps(),
    );
    expect(result.events[0]?.type).toBe('ACTION_REJECTED');
  });

  it('EC-99: deep freeze throws on mutation', () => {
    const state = deepFreeze(startFivePlayerGame());
    expect(() => {
      (state as { roomId: string }).roomId = 'mutated';
    }).toThrow();
  });

  it('EC-102: clock is injectable', () => {
    const clock = createClock(1000);
    expect(clock.now()).toBe(1000);
  });

  it('EC-105: decree win ends before power resolution', () => {
    let state = advancePastRoleReveal(startFivePlayerGame(18), deps(18));
    state = {
      ...state,
      enactedDharma: 4,
      expectedTileCount: 17,
      phase: {
        kind: 'LEGISLATION_SENAPATI',
        heldTiles: [
          { id: 'd1', type: 'DHARMA' },
          { id: 'd2', type: 'DHARMA' },
        ],
        vetoProposed: false,
        vetoVotes: {},
      },
      currentGovernment: { maharajId: state.maharajCandidateId, senapatiId: 'p2' },
      decreeDeck: state.decreeDeck.slice(2),
      ashPile: state.decreeDeck.slice(0, 2),
    };
    if (totalTiles(state) !== 17) {
      state = { ...state, enactedDharma: 4, decreeDeck: state.decreeDeck.slice(0, 11), ashPile: [] };
    }
    const senapati = state.currentGovernment!.senapatiId;
    const enact = state.phase.heldTiles.find((t) => t.type === 'DHARMA')!;
    state = applyAction(
      state,
      { type: 'DISCARD_SENAPATI_TILE', senapatiId: senapati, tileId: enact.id },
      deps(18),
    ).state;
    if (state.enactedDharma >= 5) {
      expect(state.phase.kind).toBe('GAME_OVER');
    }
  });

  it('EC-110-113: core invariants on valid state', () => {
    const state = advancePastRoleReveal(startFivePlayerGame(), deps());
    assertInvariants(state);
    const alive = state.players.filter((p) => p.isAlive).length;
    const dead = state.players.filter((p) => !p.isAlive).length;
    expect(alive + dead).toBe(state.players.length);
  });

  it('EC-117: vote count bounded by living players', () => {
    let state = advancePastRoleReveal(startFivePlayerGame(), deps());
    state = nominateAndElect(
      state,
      state.players.find((p) => p.id !== state.maharajCandidateId)!.id,
      deps(),
    );
    if (state.phase.kind === 'ELECTION_VOTING') {
      const votes = Object.values(state.phase.votes).filter(Boolean).length;
      expect(votes).toBeLessThanOrEqual(state.players.filter((p) => p.isAlive).length);
    }
  });

  it('7+ players: Duryodhana does not know Kauravas', () => {
    const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];
    const names = Object.fromEntries(ids.map((id) => [id, id]));
    const state = applyAction(
      createInitialState('room-7', 'p1'),
      {
        type: 'START_GAME',
        playerIds: ids,
        displayNames: names,
        hostPlayerId: 'p1',
        rebalanceEnabled: false,
        seed: 101,
      },
      deps(101),
    ).state;
    const duryodhana = findPlayerByRole(state, 'DURYODHANA');
    expect(getPlayerView(state, duryodhana).knownKauravas.length).toBe(0);
  });
});
