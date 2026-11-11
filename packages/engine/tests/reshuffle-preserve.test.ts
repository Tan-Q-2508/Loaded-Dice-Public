import { describe, expect, it } from 'vitest';
import { applyAction, getPlayerView } from '../src/index.js';
import { createTile, reshuffleIfNeeded } from '../src/deck.js';
import {
  advancePastRoleReveal,
  makeDeps,
  startFivePlayerGame,
} from './helpers.js';

describe('reshuffle preserves remaining draw tiles', () => {
  it('places shuffled ash under leftover deck cards (does not mix them)', () => {
    const top = [createTile('DHARMA'), createTile('ADHARMA')];
    const ash = [createTile('DHARMA'), createTile('ADHARMA'), createTile('DHARMA')];
    const state = {
      ...advancePastRoleReveal(startFivePlayerGame(12), makeDeps(12)),
      decreeDeck: top,
      ashPile: ash,
    };
    const identity = (tiles: readonly { id: string }[]) => [...tiles] as typeof ash;
    const result = reshuffleIfNeeded(state, 3, identity);
    expect(result.reshuffled).toBe(true);
    expect(result.state.ashPile).toEqual([]);
    expect(result.state.decreeDeck.slice(0, 2).map((t) => t.id)).toEqual(
      top.map((t) => t.id),
    );
    expect(result.state.decreeDeck.length).toBe(5);
  });

  it('Akashvani peek sees 3 tiles after refill when only 2 remain on the deck', () => {
    const deps = makeDeps(88);
    let state = advancePastRoleReveal(startFivePlayerGame(88), deps);
    const maharaj = state.maharajCandidateId;
    const pool = [...state.decreeDeck, ...state.ashPile];
    const preserved = pool.slice(0, 2);
    const ash = pool.slice(2);
    state = {
      ...state,
      currentGovernment: {
        maharajId: maharaj,
        senapatiId: state.players.find((p) => p.id !== maharaj)!.id,
      },
      decreeDeck: preserved,
      ashPile: ash,
      phase: {
        kind: 'DECREE_CEREMONY',
        tileType: 'ADHARMA',
        tileId: 'cer-1',
        followUp: { kind: 'EXECUTIVE', power: 'AKASHVANI' },
        pendingDone: [],
      },
    };
    state = applyAction(state, { type: 'ADVANCE_AFTER_DECREE' }, deps).state;
    expect(state.phase.kind).toBe('EXECUTIVE_ACTION');
    if (state.phase.kind !== 'EXECUTIVE_ACTION') return;
    expect(state.phase.power).toBe('AKASHVANI');
    expect(state.decreeDeck.slice(0, 2).map((t) => t.id)).toEqual(
      preserved.map((t) => t.id),
    );
    expect(state.decreeDeck.length).toBeGreaterThanOrEqual(3);
    expect(state.ashPile.length).toBe(0);
    const view = getPlayerView(state, maharaj);
    expect(view.peekedTiles.length).toBe(3);
    expect(view.peekedTiles.map((t) => t.id)).toEqual(
      state.decreeDeck.slice(0, 3).map((t) => t.id),
    );
  });
});
