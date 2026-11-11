import { describe, expect, it } from 'vitest';
import {
  applyAction,
  createInitialState,
  getPlayerView,
} from '../src/index.js';
import {
  advancePastRoleReveal,
  findPlayerByRole,
  makeDeps,
  startFivePlayerGame,
} from './helpers.js';

describe('knownDuryodhanaId private knowledge', () => {
  it('Kaurava always sees Duryodhana separately from knownKauravas (5p)', () => {
    const deps = makeDeps(42);
    const state = advancePastRoleReveal(startFivePlayerGame(42), deps);
    const kaurava = findPlayerByRole(state, 'KAURAVA');
    const duryodhana = findPlayerByRole(state, 'DURYODHANA');
    const view = getPlayerView(state, kaurava);
    expect(view.knownDuryodhanaId).toBe(duryodhana);
    expect(view.knownKauravas).not.toContain(duryodhana);
    expect(view.decreeDeckCount).toBe(state.decreeDeck.length);
    expect(view.ashPileCount).toBe(0);
    expect(view.lastExiledPlayerId).toBeNull();
  });

  it('Duryodhana knownDuryodhanaId is self; Pandava sees null', () => {
    const deps = makeDeps(42);
    const state = advancePastRoleReveal(startFivePlayerGame(42), deps);
    const duryodhana = findPlayerByRole(state, 'DURYODHANA');
    const pandava = findPlayerByRole(state, 'PANDAVA');
    expect(getPlayerView(state, duryodhana).knownDuryodhanaId).toBe(duryodhana);
    expect(getPlayerView(state, pandava).knownDuryodhanaId).toBeNull();
    expect(getPlayerView(state, pandava).knownKauravas).toEqual([]);
  });

  it('7p: each Kaurava knows Duryodhana; Duryodhana does not know Kauravas', () => {
    const deps = makeDeps(7);
    const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'];
    let state = createInitialState('room-7', 'p1');
    state = applyAction(
      state,
      {
        type: 'START_GAME',
        playerIds: ids,
        displayNames: Object.fromEntries(ids.map((id) => [id, id])),
        hostPlayerId: 'p1',
        rebalanceEnabled: false,
        seed: 7,
      },
      deps,
    ).state;
    for (const id of ids) {
      state = applyAction(state, { type: 'ACK_ROLE_REVEAL', playerId: id }, deps).state;
    }
    const duryodhana = findPlayerByRole(state, 'DURYODHANA');
    const kauravas = state.players.filter((p) => p.role === 'KAURAVA').map((p) => p.id);
    expect(kauravas).toHaveLength(2);
    for (const kid of kauravas) {
      const view = getPlayerView(state, kid);
      expect(view.knownDuryodhanaId).toBe(duryodhana);
      expect(view.knownKauravas).not.toContain(duryodhana);
      expect(view.knownKauravas).toHaveLength(1);
    }
    expect(getPlayerView(state, duryodhana).knownKauravas).toEqual([]);
    expect(getPlayerView(state, duryodhana).knownDuryodhanaId).toBe(duryodhana);
  });
});
