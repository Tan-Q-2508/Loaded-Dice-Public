import { describe, expect, it } from 'vitest';
import { applyAction, getPlayerView, getSystemLegalActions } from '../src/index.js';
import {
  advancePastRoleReveal,
  makeDeps,
  nominateAndElect,
  resolveCeremonies,
  startFivePlayerGame,
} from './helpers.js';

describe('table ceremonies', () => {
  it('last vote leaves votesRevealed hold; RESOLVE_ELECTION advances', () => {
    const deps = makeDeps(42);
    let state = advancePastRoleReveal(startFivePlayerGame(42), deps);
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

    const living = state.players.filter((p) => p.isAlive);
    for (let i = 0; i < living.length - 1; i += 1) {
      state = applyAction(
        state,
        { type: 'CAST_VOTE', playerId: living[i]!.id, vote: 'HA' },
        deps,
      ).state;
    }
    state = applyAction(
      state,
      { type: 'CAST_VOTE', playerId: living[living.length - 1]!.id, vote: 'HA' },
      deps,
    ).state;

    expect(state.phase.kind).toBe('ELECTION_VOTING');
    if (state.phase.kind !== 'ELECTION_VOTING') return;
    expect(state.phase.votesRevealed).toBe(true);
    expect(getSystemLegalActions(state)).toEqual([{ type: 'RESOLVE_ELECTION' }]);

    const view = getPlayerView(state, living[0]!.id);
    expect(view.votesRevealed).toBe(true);
    expect(view.votes?.[living[1]!.id]).toBe('HA');
    expect(view.startPlayerCount).toBe(5);

    state = applyAction(state, { type: 'RESOLVE_ELECTION' }, deps).state;
    expect(state.phase.kind).toBe('LEGISLATION_MAHARAJ');
  });

  it('enacted decree enters DECREE_CEREMONY then ADVANCE_AFTER_DECREE', () => {
    const deps = makeDeps(42);
    let state = advancePastRoleReveal(startFivePlayerGame(42), deps);
    const nominee = state.players.find((p) => p.id !== state.maharajCandidateId)!.id;
    state = nominateAndElect(state, nominee, deps, 'HA');
    expect(state.phase.kind).toBe('LEGISLATION_MAHARAJ');
    if (state.phase.kind !== 'LEGISLATION_MAHARAJ') return;

    const maharajId = state.currentGovernment!.maharajId;
    const discardId = state.phase.drawnTiles[0]!.id;
    state = applyAction(
      state,
      { type: 'DISCARD_MAHARAJ_TILE', maharajId, tileId: discardId },
      deps,
    ).state;
    expect(state.phase.kind).toBe('LEGISLATION_SENAPATI');
    if (state.phase.kind !== 'LEGISLATION_SENAPATI') return;

    const senapatiId = state.currentGovernment!.senapatiId;
    const discardSen = state.phase.heldTiles[0]!.id;
    state = applyAction(
      state,
      { type: 'DISCARD_SENAPATI_TILE', senapatiId, tileId: discardSen },
      deps,
    ).state;

    expect(state.phase.kind).toBe('DECREE_CEREMONY');
    if (state.phase.kind !== 'DECREE_CEREMONY') return;
    expect(getSystemLegalActions(state)).toEqual([{ type: 'ADVANCE_AFTER_DECREE' }]);

    const view = getPlayerView(state, maharajId);
    expect(view.lastEnactedDecree).toBe(state.phase.tileType);
    expect(view.enactedDharma + view.enactedAdharma).toBeGreaterThan(0);

    state = applyAction(state, { type: 'ADVANCE_AFTER_DECREE' }, deps).state;
    expect(
      state.phase.kind === 'ELECTION_NOMINATION' ||
        state.phase.kind === 'EXECUTIVE_ACTION',
    ).toBe(true);
    expect(getPlayerView(state, maharajId).lastEnactedDecree).toBeNull();
  });

  it('resolveCeremonies helper drains both holds', () => {
    const deps = makeDeps(7);
    let state = advancePastRoleReveal(startFivePlayerGame(7), deps);
    const nominee = state.players.find((p) => p.id !== state.maharajCandidateId)!.id;
    state = nominateAndElect(state, nominee, deps, 'HA');
    expect(state.phase.kind).toBe('LEGISLATION_MAHARAJ');
    state = resolveCeremonies(state, deps);
    expect(state.phase.kind).toBe('LEGISLATION_MAHARAJ');
  });

  it('DONE_DISCUSSING is idempotent for duplicates and late arrivals', () => {
    const deps = makeDeps(11);
    let state = advancePastRoleReveal(startFivePlayerGame(11), deps);
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
    if (state.phase.kind !== 'DISCUSSION_PRE_VOTE') return;

    const firstId = state.phase.pendingDone[0]!;
    const first = applyAction(state, { type: 'DONE_DISCUSSING', playerId: firstId }, deps);
    expect(first.events.some((e) => e.type === 'ACTION_REJECTED')).toBe(false);
    state = first.state;
    expect(state.phase.kind).toBe('DISCUSSION_PRE_VOTE');
    if (state.phase.kind !== 'DISCUSSION_PRE_VOTE') return;
    expect(state.phase.pendingDone.includes(firstId)).toBe(false);

    const duplicate = applyAction(state, { type: 'DONE_DISCUSSING', playerId: firstId }, deps);
    expect(duplicate.events.some((e) => e.type === 'ACTION_REJECTED')).toBe(false);
    expect(duplicate.state.stateVersion).toBeGreaterThan(state.stateVersion);
    state = duplicate.state;
    expect(state.phase.kind).toBe('DISCUSSION_PRE_VOTE');
    if (state.phase.kind !== 'DISCUSSION_PRE_VOTE') return;

    while (state.phase.kind === 'DISCUSSION_PRE_VOTE' && state.phase.pendingDone.length > 0) {
      const id = state.phase.pendingDone[0]!;
      state = applyAction(state, { type: 'DONE_DISCUSSING', playerId: id }, deps).state;
    }
    expect(state.phase.kind).toBe('ELECTION_VOTING');

    const late = applyAction(state, { type: 'DONE_DISCUSSING', playerId: firstId }, deps);
    expect(late.events.some((e) => e.type === 'ACTION_REJECTED')).toBe(false);
    expect(late.state.phase.kind).toBe('ELECTION_VOTING');
    expect(late.state.stateVersion).toBeGreaterThan(state.stateVersion);
  });
});
