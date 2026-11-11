import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRng } from '@shaatir-shakuni/engine';
import {
  createCoverage,
  mergeCoverage,
  type MutableCoverage,
} from './coverage.js';
import { runQaGame, type QaGameResult } from './qa-driver.js';
import type { PolicyName } from './types.js';

/** User-facing personalities mapped onto engine policies. */
export type Personality =
  | 'random'
  | 'aggressive'
  | 'cautious'
  | 'strategic'
  | 'chaotic'
  | 'always-veto'
  | 'always-reject'
  | 'duryodhana-seeking'
  | 'disconnect-sim'
  | 'always-investigate-same-target-first';

const PERSONALITY_TO_POLICY: Readonly<Record<Personality, PolicyName>> = {
  random: 'random',
  aggressive: 'always-veto',
  cautious: 'always-reject',
  strategic: 'duryodhana-seeking',
  chaotic: 'disconnect-sim',
  'always-veto': 'always-veto',
  'always-reject': 'always-reject',
  'duryodhana-seeking': 'duryodhana-seeking',
  'disconnect-sim': 'disconnect-sim',
  'always-investigate-same-target-first':
    'always-investigate-same-target-first',
};

const PERSONALITY_POOL: readonly Personality[] = [
  'random',
  'aggressive',
  'cautious',
  'strategic',
  'chaotic',
  'always-veto',
  'always-reject',
  'duryodhana-seeking',
  'disconnect-sim',
  'always-investigate-same-target-first',
];

export interface MatrixGamePlan {
  readonly index: number;
  readonly playerCount: number;
  readonly seed: number;
  readonly rebalanceEnabled: boolean;
  readonly personalities: readonly Personality[];
  readonly policyByPlayer: Readonly<Record<string, PolicyName>>;
}

export interface QaMatrixOptions {
  /** Games per player count (default 10 → 60 total). */
  readonly gamesPerCount?: number;
  readonly baseSeed?: number;
  readonly maxSteps?: number;
  readonly persistRepro?: boolean;
  readonly failuresDir?: string;
}

export interface QaMatrixSummary {
  readonly plans: readonly MatrixGamePlan[];
  readonly results: readonly QaGameResult[];
  readonly coverage: MutableCoverage;
  readonly gamesCompleted: number;
  readonly gamesFailed: number;
  readonly durationMs: number;
}

function assignPersonalities(
  playerCount: number,
  seed: number,
): { personalities: Personality[]; policyByPlayer: Record<string, PolicyName> } {
  const rng = createRng(seed ^ 0xa5a5a5a5);
  const personalities: Personality[] = [];
  // Pin a diverse adversarial mix into the first seats, then fill randomly.
  const pinned: Personality[] = [
    'chaotic',
    'aggressive',
    'cautious',
    'strategic',
    'disconnect-sim',
  ];
  for (let i = 0; i < playerCount; i += 1) {
    if (i < pinned.length) {
      personalities.push(pinned[i]!);
    } else {
      personalities.push(rng.pickOne([...PERSONALITY_POOL]));
    }
  }
  const policyByPlayer: Record<string, PolicyName> = {};
  for (let i = 0; i < playerCount; i += 1) {
    policyByPlayer[`p${i + 1}`] = PERSONALITY_TO_POLICY[personalities[i]!];
  }
  return { personalities, policyByPlayer };
}

/**
 * Builds the exact test matrix: playerCount ∈ [5..10] × N games, unique seeds.
 */
export function buildMatrixPlans(opts: QaMatrixOptions = {}): MatrixGamePlan[] {
  const gamesPerCount = opts.gamesPerCount ?? 10;
  const baseSeed = opts.baseSeed ?? (Date.now() & 0xffffffff);
  const plans: MatrixGamePlan[] = [];
  let index = 0;
  for (let playerCount = 5; playerCount <= 10; playerCount += 1) {
    for (let g = 0; g < gamesPerCount; g += 1) {
      // Distinct seed per game; large stride avoids collision with policy RNG xor.
      const seed = (baseSeed + index * 9973 + playerCount * 131) >>> 0;
      const rebalanceEnabled = g % 2 === 1;
      const { personalities, policyByPlayer } = assignPersonalities(
        playerCount,
        seed,
      );
      plans.push({
        index,
        playerCount,
        seed,
        rebalanceEnabled,
        personalities,
        policyByPlayer,
      });
      index += 1;
    }
  }
  return plans;
}

export function runQaMatrix(opts: QaMatrixOptions = {}): QaMatrixSummary {
  const startedAt = Date.now();
  const here = path.dirname(fileURLToPath(import.meta.url));
  const failuresDir =
    opts.failuresDir ?? path.resolve(here, '../failures/qa');
  const plans = buildMatrixPlans(opts);
  const results: QaGameResult[] = [];
  const coverage = createCoverage();
  let gamesCompleted = 0;
  let gamesFailed = 0;

  for (const plan of plans) {
    const result = runQaGame({
      seed: plan.seed,
      playerCount: plan.playerCount,
      rebalanceEnabled: plan.rebalanceEnabled,
      policyByPlayer: plan.policyByPlayer,
      maxSteps: opts.maxSteps ?? 8000,
      persistRepro: opts.persistRepro !== false,
      failuresDir,
    });
    results.push(result);
    mergeCoverage(coverage, result.coverage);
    if (result.ok) gamesCompleted += 1;
    else gamesFailed += 1;
  }

  return {
    plans,
    results,
    coverage,
    gamesCompleted,
    gamesFailed,
    durationMs: Date.now() - startedAt,
  };
}
