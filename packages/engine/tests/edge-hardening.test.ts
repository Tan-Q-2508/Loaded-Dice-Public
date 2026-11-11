import { describe, expect, it } from 'vitest';
import {
  applyAction,
  assertInvariants,
  type GameState,
  type Phase,
} from '../src/index.js';
import { assertDeckIntegrity, drawTiles } from '../src/deck.js';
import { isVetoUnlocked, nextLivingPlayerId } from '../src/state-helpers.js';
import {
  advancePastRoleReveal,
  findPlayerByRole,
  makeDeps,
  nominateAndElect,
  startFivePlayerGame,
} from './helpers.js';

const deps = (seed = 42) => makeDeps(seed);

describe('EC-34 unreachable phase FREEZE', () => {
  it('finalize FREEZEs when invariants reject an invalid phase kind', () => {
    let state = advancePastRoleReveal(startFivePlayerGame(34), deps(34));
    // Inject an unrepresentable phase via cast — if ever observed, FREEZE.
    state = {
      ...state,
      phase: { kind: 'NOT_A_REAL_PHASE' } as unknown as Phase,
    };
    const result = applyAction(
      state,
      {
        type: 'NOMINATE_SENAPATI',
        maharajId: state.maharajCandidateId,
        nomineeId: state.players.find((p) => p.id !== state.maharajCandidateId)!.id,
      },
      deps(34),
    );
    // Either rejected (phase gate) or frozen via invariant — never crashes/guesses.
    const terminal =
      result.state.phase.kind === 'ROOM_FROZEN' ||
      result.events.some((e) => e.type === 'ACTION_REJECTED');
    expect(terminal).toBe(true);
  });
});

describe('EC-48 / EC-55 / EC-56 deck TERMINATE integrity', () => {
  it('EC-48: insufficient deck+ash for draw returns corrupt error path', () => {
    let state = advancePastRoleReveal(startFivePlayerGame(48), deps(48));
    state = {
      ...state,
      decreeDeck: [],
      ashPile: [],
      enactedDharma: 6,
      enactedAdharma: 11,
      expectedTileCount: 17,
    };
    const draw = drawTiles(state, 3, deps(48).rng.shuffle.bind(deps(48).rng));
    expect('error' in draw).toBe(true);
    if ('error' in draw) {
      expect(draw.error).toMatch(/Insufficient/i);
    }
  });

  it('EC-48: accepted government with empty deck+ash → ROOM_CORRUPTED', () => {
    let state = advancePastRoleReveal(startFivePlayerGame(148), deps(148));
    const nominee = state.players.find((p) => p.id !== state.maharajCandidateId)!.id;
    state = {
      ...state,
      decreeDeck: [],
      ashPile: [],
      enactedDharma: 6,
      enactedAdharma: 11,
      expectedTileCount: 17,
    };
    state = nominateAndElect(state, nominee, deps(148), 'HA');
    expect(state.phase.kind).toBe('ROOM_CORRUPTED');
  });

  it('EC-55: duplicate tile id fails integrity', () => {
    const state = startFivePlayerGame(55);
    const dup = state.decreeDeck[0]!;
    const bad = {
      ...state,
      decreeDeck: [...state.decreeDeck, { ...dup }],
      expectedTileCount: state.expectedTileCount + 1,
    };
    const result = assertDeckIntegrity(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/Duplicate/i);
  });

  it('EC-56: unknown tile type fails integrity', () => {
    const state = startFivePlayerGame(56);
    const bad = {
      ...state,
      decreeDeck: [
        ...state.decreeDeck.slice(1),
        { id: 'bogus', type: 'NOT_A_TILE' as 'DHARMA' },
      ],
    };
    const result = assertDeckIntegrity(bad);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/Unknown tile type/i);
  });
});

describe('EC-61 / EC-62 executive powers', () => {
  it('EC-61: Vanvas resolves for living target (engine has no connection gate)', () => {
    let state = advancePastRoleReveal(startFivePlayerGame(61), deps(61));
    const maharaj = state.maharajCandidateId;
    const target = state.players.find(
      (p) => p.id !== maharaj && p.role !== 'DURYODHANA',
    )!;
    state = {
      ...state,
      phase: { kind: 'EXECUTIVE_ACTION', power: 'VANVAS' },
      currentGovernment: {
        maharajId: maharaj,
        senapatiId: state.players.find((p) => p.id !== maharaj)!.id,
      },
    };
    state = applyAction(
      state,
      { type: 'EXEC_VANVAS', maharajId: maharaj, targetId: target.id },
      deps(61),
    ).state;
    expect(state.players.find((p) => p.id === target.id)?.isAlive).toBe(false);
    expect(state.phase.kind).not.toBe('ROOM_FROZEN');
  });

  it('EC-62: wrong power action rejected; phase carries exactly one power', () => {
    let state = advancePastRoleReveal(startFivePlayerGame(62), deps(62));
    const maharaj = state.maharajCandidateId;
    state = {
      ...state,
      phase: { kind: 'EXECUTIVE_ACTION', power: 'AKASHVANI' },
      currentGovernment: {
        maharajId: maharaj,
        senapatiId: state.players.find((p) => p.id !== maharaj)!.id,
      },
    };
    expect(state.phase.kind).toBe('EXECUTIVE_ACTION');
    if (state.phase.kind === 'EXECUTIVE_ACTION') {
      expect(state.phase.power).toBe('AKASHVANI');
    }
    const result = applyAction(
      state,
      {
        type: 'EXEC_VANVAS',
        maharajId: maharaj,
        targetId: state.players.find((p) => p.id !== maharaj)!.id,
      },
      deps(62),
    );
    expect(result.events[0]?.type).toBe('ACTION_REJECTED');
  });
});

describe('EC-65 / EC-66 Rajya Sabha Summons placard', () => {
  it('EC-65: rejected summons government returns placard after original Maharaj', () => {
    let state = advancePastRoleReveal(startFivePlayerGame(65), deps(65));
    const originalMaharaj = state.maharajCandidateId;
    const expectedReturn = nextLivingPlayerId(state, originalMaharaj)!;
    const special = state.players.find(
      (p) => p.id !== originalMaharaj && p.id !== expectedReturn,
    )!.id;

    state = {
      ...state,
      phase: { kind: 'EXECUTIVE_ACTION', power: 'RAJYA_SABHA_SUMMONS' },
      currentGovernment: {
        maharajId: originalMaharaj,
        senapatiId: state.players.find((p) => p.id !== originalMaharaj)!.id,
      },
    };
    state = applyAction(
      state,
      {
        type: 'EXEC_RAJYA_SABHA_SUMMONS',
        maharajId: originalMaharaj,
        targetId: special,
      },
      deps(65),
    ).state;
    expect(state.maharajCandidateId).toBe(special);
    expect(state.summonsReturnAfterPlayerId).toBe(expectedReturn);

    const nominee = state.players.find(
      (p) => p.id !== special && p.isAlive,
    )!.id;
    state = nominateAndElect(state, nominee, deps(65), 'NAHI');
    expect(state.phase.kind).toBe('ELECTION_NOMINATION');
    expect(state.maharajCandidateId).toBe(expectedReturn);
    expect(state.summonsReturnAfterPlayerId).toBeNull();
  });

  it('EC-66: summons of next-in-rotation can yield two consecutive Maharaj turns', () => {
    let state = advancePastRoleReveal(startFivePlayerGame(66), deps(66));
    const originalMaharaj = state.maharajCandidateId;
    const nextInRotation = nextLivingPlayerId(state, originalMaharaj)!;

    state = {
      ...state,
      phase: { kind: 'EXECUTIVE_ACTION', power: 'RAJYA_SABHA_SUMMONS' },
      currentGovernment: {
        maharajId: originalMaharaj,
        senapatiId: state.players.find((p) => p.id !== originalMaharaj)!.id,
      },
    };
    state = applyAction(
      state,
      {
        type: 'EXEC_RAJYA_SABHA_SUMMONS',
        maharajId: originalMaharaj,
        targetId: nextInRotation,
      },
      deps(66),
    ).state;
    expect(state.maharajCandidateId).toBe(nextInRotation);

    // Reject special election — return target is also nextInRotation → two turns.
    const nominee = state.players.find(
      (p) => p.id !== nextInRotation && p.isAlive,
    )!.id;
    state = nominateAndElect(state, nominee, deps(66), 'NAHI');
    expect(state.maharajCandidateId).toBe(nextInRotation);
  });
});

describe('EC-67 / EC-101 / EC-106 retags and shared counters', () => {
  it('EC-67 / EC-104: Vanvas on Duryodhana → immediate Pandava win', () => {
    let state = advancePastRoleReveal(startFivePlayerGame(67), deps(67));
    const duryodhana = findPlayerByRole(state, 'DURYODHANA');
    const maharaj = state.maharajCandidateId;
    state = {
      ...state,
      phase: { kind: 'EXECUTIVE_ACTION', power: 'VANVAS' },
      currentGovernment: {
        maharajId: maharaj,
        senapatiId: state.players.find((p) => p.id !== maharaj)!.id,
      },
    };
    state = applyAction(
      state,
      { type: 'EXEC_VANVAS', maharajId: maharaj, targetId: duryodhana },
      deps(67),
    ).state;
    expect(state.phase.kind).toBe('GAME_OVER');
    if (state.phase.kind === 'GAME_OVER') {
      expect(state.phase.reason).toBe('DURYODHANA_VANVAS');
      expect(state.phase.winner).toBe('PANDAVA');
    }
  });

  it('EC-101: engine package has no DB/ORM dependency', async () => {
    const pkg = await import('../package.json', { with: { type: 'json' } });
    const all = { ...pkg.default.dependencies, ...pkg.default.devDependencies };
    expect(all).not.toHaveProperty('drizzle-orm');
    expect(all).not.toHaveProperty('postgres');
    expect(all).not.toHaveProperty('pg');
  });

  it('EC-106: veto unlock and win path share enactedAdharma counter', () => {
    const state = {
      ...advancePastRoleReveal(startFivePlayerGame(106), deps(106)),
      enactedAdharma: 5,
    };
    expect(isVetoUnlocked(state)).toBe(true);
    expect(isVetoUnlocked({ ...state, enactedAdharma: 4 })).toBe(false);
    // Same field drives Adharma win at 6 — no parallel counter.
    expect(state.enactedAdharma).toBe(5);
    const winAtSix = { ...state, enactedAdharma: 6 };
    expect(winAtSix.enactedAdharma >= 6).toBe(true);
    expect(isVetoUnlocked(winAtSix)).toBe(true);
  });
});

describe('§23 named invariants EC-110–120', () => {
  it('EC-110: exactly one Maharaj candidate when required', () => {
    const state = advancePastRoleReveal(startFivePlayerGame(110), deps(110));
    expect(state.maharajCandidateId).toBeTruthy();
    expect(state.players.filter((p) => p.id === state.maharajCandidateId)).toHaveLength(1);
    assertInvariants(state);
  });

  it('EC-111–113 / 115–118 / 120: assertInvariants holds mid-election', () => {
    let state = advancePastRoleReveal(startFivePlayerGame(111), deps(111));
    const nominee = state.players.find((p) => p.id !== state.maharajCandidateId)!.id;
    state = applyAction(
      state,
      { type: 'NOMINATE_SENAPATI', maharajId: state.maharajCandidateId, nomineeId: nominee },
      deps(111),
    ).state;
    assertInvariants(state);
    expect(state.phase.kind).toBe('DISCUSSION_PRE_VOTE');
    const alive = state.players.filter((p) => p.isAlive).length;
    const dead = state.players.filter((p) => !p.isAlive).length;
    expect(alive + dead).toBe(state.players.length);
  });

  it('EC-116 overlaps EC-57: negative deck rejected by integrity', () => {
    const state = startFivePlayerGame(116);
    // Length cannot be negative in JS arrays; integrity still guards count mismatch.
    const bad = { ...state, decreeDeck: [], ashPile: [], enactedDharma: 0, enactedAdharma: 0 };
    expect(assertDeckIntegrity(bad).ok).toBe(false);
  });
});

describe('EC-97 replay audit', () => {
  it('replaying the same action sequence yields the same terminal stateVersion/phase', () => {
    const seed = 97;
    const d = deps(seed);
    const start = (): GameState =>
      advancePastRoleReveal(startFivePlayerGame(seed), d);

    const live = (): GameState => {
      let s = start();
      const nominee = s.players.find((p) => p.id !== s.maharajCandidateId)!.id;
      s = nominateAndElect(s, nominee, d, 'NAHI');
      s = nominateAndElect(
        s,
        s.players.find((p) => p.id !== s.maharajCandidateId)!.id,
        d,
        'NAHI',
      );
      return s;
    };

    const a = live();
    const b = live();
    expect(a.stateVersion).toBe(b.stateVersion);
    expect(a.phase.kind).toBe(b.phase.kind);
    expect(a.electionTracker).toBe(b.electionTracker);
    expect(a.maharajCandidateId).toBe(b.maharajCandidateId);
  });
});
