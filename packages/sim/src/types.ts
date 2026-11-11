import type { GameAction, GameState, Rng } from '@shaatir-shakuni/engine';

export type PolicyName =
  | 'random'
  | 'always-veto'
  | 'always-reject'
  | 'always-investigate-same-target-first'
  | 'duryodhana-seeking'
  | 'disconnect-sim';

export interface PolicyContext {
  readonly state: GameState;
  readonly playerId: string;
  readonly legal: readonly GameAction[];
  readonly rng: Rng;
}

/**
 * Returns a legal action to submit, or a special intent for the driver.
 * - `action`: submit this action (must be from `legal`, except disconnect probes)
 * - `skip`: player does not act; driver may apply a system timeout/default path
 * - `illegal`: submit a deliberately illegal/stale action to probe rejection
 */
export type PolicyDecision =
  | { readonly kind: 'action'; readonly action: GameAction }
  | { readonly kind: 'skip' }
  | { readonly kind: 'illegal'; readonly action: GameAction };

export interface Policy {
  readonly name: PolicyName;
  decide(ctx: PolicyContext): PolicyDecision;
}

export type FailureKind =
  | 'invariant'
  | 'throw'
  | 'room_frozen'
  | 'room_corrupted'
  | 'stuck'
  | 'max_steps';

export interface GameRepro {
  readonly version: 1;
  readonly seed: number;
  readonly playerCount: number;
  readonly rebalanceEnabled: boolean;
  readonly playerIds: readonly string[];
  readonly policyByPlayer: Readonly<Record<string, PolicyName>>;
  readonly actions: readonly GameAction[];
  readonly failure: {
    readonly kind: FailureKind;
    readonly message: string;
    readonly step: number;
  };
}

export interface GameResult {
  readonly ok: boolean;
  readonly seed: number;
  readonly playerCount: number;
  readonly rebalanceEnabled: boolean;
  readonly steps: number;
  readonly finalPhase: GameState['phase']['kind'];
  readonly repro?: GameRepro;
  readonly reproPath?: string;
}

export interface SimSummary {
  readonly gamesRun: number;
  readonly failures: number;
  readonly results: readonly GameResult[];
}
