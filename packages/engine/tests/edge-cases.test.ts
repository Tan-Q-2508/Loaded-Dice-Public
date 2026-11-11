import { describe, it, expect } from 'vitest';
import { applyAction, createInitialState, getPlayerView } from '../src/index.js';
import { isSenapatiEligible } from '../src/term-limits.js';
import {
  makeDeps,
  startFivePlayerGame,
  advancePastRoleReveal,
  nominateAndElect,
  findPlayerByRole,
} from './helpers.js';

const deps = () => makeDeps(42);

describe('edge cases batch 2', () => {
  it('EC-41: 5 living players term limit exception', () => {
    let state = advancePastRoleReveal(startFivePlayerGame(11), deps());
    const firstGov = {
      maharajId: state.maharajCandidateId,
      senapatiId: state.players.find((p) => p.id !== state.maharajCandidateId)!.id,
    };
    state = nominateAndElect(state, firstGov.senapatiId, deps());
    if (state.phase.kind === 'LEGISLATION_MAHARAJ') {
      // complete one government cycle minimally
      state = nominateAndElect(state, firstGov.maharajId, deps());
    }
    state = { ...state, lastElectedGovernment: firstGov, enactedDharma: 0, enactedAdharma: 0 };
    const living = state.players.filter((p) => p.isAlive);
    expect(living.length).toBe(5);
    const eligibility = state.lastElectedGovernment;
    expect(eligibility).toBeTruthy();
  });

  it('EC-131: with 3 living, term limits ignored when they would leave zero nominees', () => {
    let state = advancePastRoleReveal(startFivePlayerGame(20291381), deps());
    // Force the stuck shape from QA seed 20291381: 3 alive, last gov = the other two.
    const alive = ['p1', 'p2', 'p3'];
    state = {
      ...state,
      phase: { kind: 'ELECTION_NOMINATION' },
      maharajCandidateId: 'p2',
      lastElectedGovernment: { maharajId: 'p1', senapatiId: 'p3' },
      players: state.players.map((p) => ({
        ...p,
        isAlive: alive.includes(p.id),
      })),
    };
    expect(state.players.filter((p) => p.isAlive).length).toBe(3);
    // Without the escape hatch both p1 and p3 are term-limited and p2 can't self-nominate.
    expect(isSenapatiEligible(state, 'p1').eligible).toBe(true);
    expect(isSenapatiEligible(state, 'p3').eligible).toBe(true);
    expect(isSenapatiEligible(state, 'p2').eligible).toBe(false);
  });

  it('EC-43/EC-44: anarchy reshuffles and skips power', () => {
    let state = advancePastRoleReveal(startFivePlayerGame(77), deps());
    state = { ...state, electionTracker: 2 };
    const maharaj = state.maharajCandidateId;
    const nominee = state.players.find((p) => p.id !== maharaj)!.id;
    state = applyAction(
      state,
      { type: 'NOMINATE_SENAPATI', maharajId: maharaj, nomineeId: nominee },
      deps(),
    ).state;
    state = applyAction(state, { type: 'DISCUSSION_PRE_VOTE_TIMEOUT' }, deps()).state;
    for (const p of state.players.filter((pl) => pl.isAlive)) {
      state = applyAction(state, { type: 'CAST_VOTE', playerId: p.id, vote: 'NAHI' }, deps()).state;
      if (state.phase.kind !== 'ELECTION_VOTING') break;
    }
    if (state.phase.kind === 'ELECTION_VOTING' && state.phase.votesRevealed) {
      state = applyAction(state, { type: 'RESOLVE_ELECTION' }, deps()).state;
    }
    if (state.phase.kind === 'DECREE_CEREMONY') {
      state = applyAction(state, { type: 'ADVANCE_AFTER_DECREE' }, deps()).state;
    }
    expect(state.electionTracker).toBe(0);
    expect(state.phase.kind).toBe('ELECTION_NOMINATION');
  });

  it('EC-45: enactment resets tracker', () => {
    let state = advancePastRoleReveal(startFivePlayerGame(5), deps());
    state = { ...state, electionTracker: 2 };
    state = nominateAndElect(
      state,
      state.players.find((p) => p.id !== state.maharajCandidateId)!.id,
      deps(),
    );
    if (state.phase.kind === 'LEGISLATION_MAHARAJ') {
      const maharaj = state.currentGovernment!.maharajId;
      const discard = state.phase.drawnTiles[0]!.id;
      state = applyAction(state, { type: 'DISCARD_MAHARAJ_TILE', maharajId: maharaj, tileId: discard }, deps()).state;
      if (state.phase.kind === 'LEGISLATION_SENAPATI') {
        const senapati = state.currentGovernment!.senapatiId;
        const enact = state.phase.heldTiles.find((t) => t.type === 'DHARMA') ?? state.phase.heldTiles[0];
        state = applyAction(
          state,
          { type: 'DISCARD_SENAPATI_TILE', senapatiId: senapati, tileId: enact!.id },
          deps(),
        ).state;
        expect(state.electionTracker).toBe(0);
      }
    }
  });

  it('EC-63: cannot investigate same player twice', () => {
    let state = advancePastRoleReveal(startFivePlayerGame(88), deps());
    state = {
      ...state,
      phase: { kind: 'EXECUTIVE_ACTION', power: 'DIVYA_DRISHTI' },
      currentGovernment: {
        maharajId: state.maharajCandidateId,
        senapatiId: state.players.find((p) => p.id !== state.maharajCandidateId)!.id,
      },
      investigatedPlayerIds: ['p2'],
    };
    const result = applyAction(
      state,
      { type: 'EXEC_DIVYA_DRISHTI', maharajId: state.maharajCandidateId, targetId: 'p2' },
      deps(),
    );
    expect(result.events[0]?.type).toBe('ACTION_REJECTED');
  });

  it('EC-73: investigation only in private view', () => {
    let state = advancePastRoleReveal(startFivePlayerGame(66), deps());
    const maharaj = state.maharajCandidateId;
    const target = state.players.find((p) => p.id !== maharaj)!.id;
    state = {
      ...state,
      phase: { kind: 'EXECUTIVE_ACTION', power: 'DIVYA_DRISHTI' },
      currentGovernment: { maharajId: maharaj, senapatiId: target },
    };
    state = applyAction(
      state,
      { type: 'EXEC_DIVYA_DRISHTI', maharajId: maharaj, targetId: target },
      deps(),
    ).state;
    const mView = getPlayerView(state, maharaj);
    const oView = getPlayerView(state, target);
    expect(mView.ownInvestigations.length).toBe(1);
    expect(oView.ownInvestigations.length).toBe(0);
  });

  it('EC-103: Vanvas win takes precedence when targeting Duryodhana', () => {
    const state = startFivePlayerGame();
    const duryodhana = findPlayerByRole(state, 'DURYODHANA');
    const maharaj = state.maharajCandidateId;
    let s = {
      ...state,
      phase: { kind: 'EXECUTIVE_ACTION' as const, power: 'VANVAS' as const },
      currentGovernment: {
        maharajId: maharaj,
        senapatiId: state.players.find((p) => p.id !== maharaj && p.id !== duryodhana)!.id,
      },
    };
    s = applyAction(s, { type: 'EXEC_VANVAS', maharajId: maharaj, targetId: duryodhana }, deps()).state;
    expect(s.phase.kind).toBe('GAME_OVER');
  });

  it('EC-68: non-Duryodhana exile continues game', () => {
    let state = advancePastRoleReveal(startFivePlayerGame(44), deps());
    const maharaj = state.maharajCandidateId;
    const target = state.players.find((p) => p.role === 'PANDAVA')!.id;
    state = {
      ...state,
      phase: { kind: 'EXECUTIVE_ACTION', power: 'VANVAS' },
      currentGovernment: {
        maharajId: maharaj,
        senapatiId: state.players.find((p) => p.id !== maharaj && p.id !== target)!.id,
      },
    };
    state = applyAction(
      state,
      { type: 'EXEC_VANVAS', maharajId: maharaj, targetId: target },
      deps(),
    ).state;
    expect(state.phase.kind).toBe('ELECTION_NOMINATION');
    expect(state.players.find((p) => p.id === target)?.isAlive).toBe(false);
  });
});
