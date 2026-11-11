import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ALL_POLICY_NAMES,
  getPolicy,
  replayRepro,
  runGame,
  runSim,
  type GameRepro,
  type PolicyName,
} from '../src/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.join(here, 'fixtures');

describe('policies', () => {
  it('exports the four required adversarial policies plus random and disconnect', () => {
    expect(ALL_POLICY_NAMES).toEqual(
      expect.arrayContaining([
        'random',
        'always-veto',
        'always-reject',
        'always-investigate-same-target-first',
        'duryodhana-seeking',
        'disconnect-sim',
      ]),
    );
    for (const name of ALL_POLICY_NAMES) {
      expect(getPolicy(name).name).toBe(name);
    }
  });
});

describe('runGame / runSim', () => {
  it('drives complete games for player counts 5–10 with rebalance on/off (fast sample)', () => {
    const summary = runSim({
      games: 12,
      baseSeed: 100,
      maxSteps: 8000,
      persistRepro: false,
    });
    expect(summary.gamesRun).toBe(12);
    const counts = new Set(summary.results.map((r) => r.playerCount));
    expect(counts.has(5)).toBe(true);
    expect(counts.has(10)).toBe(true);
    const rebalance = new Set(summary.results.map((r) => r.rebalanceEnabled));
    expect(rebalance.has(true)).toBe(true);
    expect(rebalance.has(false)).toBe(true);

    if (summary.failures > 0) {
      const first = summary.results.find((r) => !r.ok);
      throw new Error(
        `Sim failures=${summary.failures}: ${first?.repro?.failure.kind} ${first?.repro?.failure.message} seed=${first?.seed}`,
      );
    }
    expect(summary.results.every((r) => r.ok && r.finalPhase === 'GAME_OVER')).toBe(
      true,
    );
  });

  it('random policy only selects among provided legal actions', () => {
    const policy = getPolicy('random');
    const legal = [
      { type: 'CAST_VOTE' as const, playerId: 'p1', vote: 'HA' as const },
      { type: 'CAST_VOTE' as const, playerId: 'p1', vote: 'NAHI' as const },
    ];
    // Minimal fake context — policy must pick from `legal`.
    const decision = policy.decide({
      state: {
        roomId: 'x',
        hostPlayerId: 'p1',
        rebalanceEnabled: false,
        startPlayerCount: 5,
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
        seed: 1,
        stateVersion: 0,
        expectedTileCount: 17,
      },
      playerId: 'p1',
      legal,
      rng: {
        next: () => 0.1,
        shuffle: <T>(items: readonly T[]) => [...items],
        pickOne: <T>(items: readonly T[]) => items[0] as T,
      },
    });
    expect(decision.kind).toBe('action');
    if (decision.kind === 'action') {
      expect(legal).toContainEqual(decision.action);
    }
  });
});

describe('replay repro', () => {
  it('replaying a saved max_steps repro reproduces the same failure', () => {
    mkdirSync(fixturesDir, { recursive: true });
    const policies: Record<string, PolicyName> = {
      p1: 'random',
      p2: 'random',
      p3: 'random',
      p4: 'random',
      p5: 'random',
    };
    const result = runGame({
      seed: 4242,
      playerCount: 5,
      rebalanceEnabled: false,
      policyByPlayer: policies,
      maxSteps: 3,
      persistRepro: false,
    });
    expect(result.ok).toBe(false);
    expect(result.repro).toBeDefined();
    const repro = result.repro!;
    expect(repro.failure.kind).toBe('max_steps');

    const fixturePath = path.join(fixturesDir, 'max-steps-repro.json');
    writeFileSync(fixturePath, `${JSON.stringify(repro, null, 2)}\n`, 'utf8');

    const loaded = JSON.parse(readFileSync(fixturePath, 'utf8')) as GameRepro;
    const replayed = replayRepro(loaded);
    expect(replayed.matched).toBe(true);
    expect(replayed.observed?.kind).toBe('max_steps');
    expect(replayed.observed?.message).toBe(loaded.failure.message);
  });
});
