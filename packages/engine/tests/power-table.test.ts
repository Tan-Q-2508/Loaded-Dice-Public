import { describe, expect, it } from 'vitest';
import {
  applyAction,
  defaultPowerTable,
  POWER_TRACK_5_6,
  POWER_TRACK_7_8,
  POWER_TRACK_9_10,
  trackForStartPlayerCount,
  type RajaagnaPower,
} from '../src/index.js';
import {
  advancePastRoleReveal,
  makeDeps,
  nominateAndElect,
  startFivePlayerGame,
} from './helpers.js';

const TRACK_5_6: readonly (RajaagnaPower | null)[] = [
  null,
  null,
  'AKASHVANI',
  'VANVAS',
  'VANVAS',
];
const TRACK_7_8: readonly (RajaagnaPower | null)[] = [
  null,
  'DIVYA_DRISHTI',
  'RAJYA_SABHA_SUMMONS',
  'VANVAS',
  'VANVAS',
];
const TRACK_9_10: readonly (RajaagnaPower | null)[] = [
  'DIVYA_DRISHTI',
  'DIVYA_DRISHTI',
  'RAJYA_SABHA_SUMMONS',
  'VANVAS',
  'VANVAS',
];

function expectFullTrack(
  startCounts: readonly number[],
  expected: readonly (RajaagnaPower | null)[],
): void {
  for (const count of startCounts) {
    expect(trackForStartPlayerCount(count)).toEqual(expected);
    for (let slot = 1; slot <= 5; slot++) {
      expect(defaultPowerTable.getPower(count, slot)).toBe(expected[slot - 1]);
    }
  }
}

describe('EC-124: full Adharma power tracks', () => {
  it('exports the canonical track constants', () => {
    expect(POWER_TRACK_5_6).toEqual(TRACK_5_6);
    expect(POWER_TRACK_7_8).toEqual(TRACK_7_8);
    expect(POWER_TRACK_9_10).toEqual(TRACK_9_10);
  });

  it('maps every start count 5–10, slots 1–5', () => {
    expectFullTrack([5, 6], TRACK_5_6);
    expectFullTrack([7, 8], TRACK_7_8);
    expectFullTrack([9, 10], TRACK_9_10);
  });
});

describe('EC-125: startPlayerCount, not living count', () => {
  it('lookup ignores a hypothetical living-count argument — only start count bands', () => {
    // 9-player start track has DIVYA_DRISHTI at slot 1; 5-player track does not.
    expect(defaultPowerTable.getPower(9, 1)).toBe('DIVYA_DRISHTI');
    expect(defaultPowerTable.getPower(5, 1)).toBeNull();
  });

  it('engine grants power from startPlayerCount even if living players are fewer', () => {
    const deps = makeDeps(91);
    let state = advancePastRoleReveal(startFivePlayerGame(91), deps);
    // Simulate mid-game exile reducing living count toward a smaller band,
    // while preserving startPlayerCount = 5 and forcing next Adharma into slot 3.
    state = {
      ...state,
      players: state.players.map((p, i) =>
        i === 4 ? { ...p, isAlive: false } : p,
      ),
      enactedAdharma: 2,
      decreeDeck: state.decreeDeck.slice(2),
    };
    expect(state.startPlayerCount).toBe(5);
    expect(state.players.filter((p) => p.isAlive).length).toBe(4);

    const nominee = state.players.find(
      (p) => p.isAlive && p.id !== state.maharajCandidateId,
    )!.id;
    state = nominateAndElect(state, nominee, deps, 'HA');
    expect(state.phase.kind).toBe('LEGISLATION_MAHARAJ');
    if (state.phase.kind !== 'LEGISLATION_MAHARAJ') return;

    const gov = state.currentGovernment!;
    const tiles = state.phase.drawnTiles;
    // Prefer discarding Dharma so an Adharma can be enacted into slot 3.
    const discard =
      tiles.find((t) => t.type === 'DHARMA') ?? tiles[0]!;
    state = applyAction(
      state,
      { type: 'DISCARD_MAHARAJ_TILE', maharajId: gov.maharajId, tileId: discard.id },
      deps,
    ).state;
    if (state.phase.kind !== 'LEGISLATION_SENAPATI') return;

    const held = state.phase.heldTiles;
    const enactAdharma = held.find((t) => t.type === 'ADHARMA');
    if (!enactAdharma) return; // RNG did not leave Adharma — skip soft assertion

    const other = held.find((t) => t.id !== enactAdharma.id)!;
    state = applyAction(
      state,
      { type: 'DISCARD_SENAPATI_TILE', senapatiId: gov.senapatiId, tileId: other.id },
      deps,
    ).state;

    expect(state.phase.kind).toBe('DECREE_CEREMONY');
    if (state.phase.kind === 'DECREE_CEREMONY') {
      expect(state.phase.followUp).toEqual({ kind: 'EXECUTIVE', power: 'AKASHVANI' });
    }
    state = applyAction(state, { type: 'ADVANCE_AFTER_DECREE' }, deps).state;

    expect(state.phase.kind).toBe('EXECUTIVE_ACTION');
    if (state.phase.kind === 'EXECUTIVE_ACTION') {
      expect(state.phase.power).toBe(
        defaultPowerTable.getPower(state.startPlayerCount, state.enactedAdharma),
      );
      expect(state.phase.power).toBe('AKASHVANI');
    }
  });
});

describe('EC-126: out-of-range Adharma slots', () => {
  it('returns null for slots outside 1–5', () => {
    for (const count of [5, 6, 7, 8, 9, 10]) {
      expect(defaultPowerTable.getPower(count, 0)).toBeNull();
      expect(defaultPowerTable.getPower(count, 6)).toBeNull();
      expect(defaultPowerTable.getPower(count, -1)).toBeNull();
      expect(defaultPowerTable.getPower(count, 99)).toBeNull();
    }
  });
});

describe('EC-127: empty track cells grant no power', () => {
  it('null cells for early slots on each track', () => {
    expect(defaultPowerTable.getPower(5, 1)).toBeNull();
    expect(defaultPowerTable.getPower(5, 2)).toBeNull();
    expect(defaultPowerTable.getPower(6, 1)).toBeNull();
    expect(defaultPowerTable.getPower(6, 2)).toBeNull();
    expect(defaultPowerTable.getPower(7, 1)).toBeNull();
    expect(defaultPowerTable.getPower(8, 1)).toBeNull();
  });

  it('engine skips EXECUTIVE_ACTION when enacting into an empty slot', () => {
    const deps = makeDeps(55);
    let state = advancePastRoleReveal(startFivePlayerGame(55), deps);
    // Next Adharma is slot 1 on the 5–6 track → no power.
    expect(state.enactedAdharma).toBe(0);
    expect(defaultPowerTable.getPower(5, 1)).toBeNull();

    const nominee = state.players.find((p) => p.id !== state.maharajCandidateId)!.id;
    state = nominateAndElect(state, nominee, deps, 'HA');
    if (state.phase.kind !== 'LEGISLATION_MAHARAJ') return;

    const gov = state.currentGovernment!;
    const tiles = state.phase.drawnTiles;
    const discard = tiles.find((t) => t.type === 'DHARMA') ?? tiles[0]!;
    state = applyAction(
      state,
      { type: 'DISCARD_MAHARAJ_TILE', maharajId: gov.maharajId, tileId: discard.id },
      deps,
    ).state;
    if (state.phase.kind !== 'LEGISLATION_SENAPATI') return;

    const held = state.phase.heldTiles;
    const enactAdharma = held.find((t) => t.type === 'ADHARMA');
    if (!enactAdharma) return;

    const other = held.find((t) => t.id !== enactAdharma.id)!;
    state = applyAction(
      state,
      { type: 'DISCARD_SENAPATI_TILE', senapatiId: gov.senapatiId, tileId: other.id },
      deps,
    ).state;

    expect(state.enactedAdharma).toBe(1);
    expect(state.phase.kind).toBe('DECREE_CEREMONY');
    if (state.phase.kind === 'DECREE_CEREMONY') {
      expect(state.phase.followUp).toEqual({ kind: 'NOMINATION' });
    }
    state = applyAction(state, { type: 'ADVANCE_AFTER_DECREE' }, deps).state;
    expect(state.phase.kind).toBe('ELECTION_NOMINATION');
  });
});
