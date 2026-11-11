import {
  applyAction,
  assertInvariants,
  createClock,
  createInitialState,
  createRng,
  defaultPowerTable,
  getLegalActions,
  getSystemLegalActions,
  playersWithLegalActions,
  type EngineDeps,
  type GameAction,
  type GameState,
  type Team,
  type WinReason,
} from '@shaatir-shakuni/engine';
import { checkHiddenInfo, checkWinnerCorrect } from './checks.js';
import {
  createCoverage,
  observeState,
  type MutableCoverage,
} from './coverage.js';
import { getPolicy } from './policies.js';
import { writeRepro } from './repro.js';
import type {
  FailureKind,
  GameRepro,
  PolicyName,
} from './types.js';

export type QaFailureCategory =
  | FailureKind
  | 'hidden_info_leak'
  | 'winner_incorrect'
  | 'illegal_terminal'
  | 'stall'
  | 'crash'
  | 'rule_violation'
  | 'fsm_error';

export interface QaGameResult {
  readonly ok: boolean;
  readonly seed: number;
  readonly playerCount: number;
  readonly rebalanceEnabled: boolean;
  readonly steps: number;
  readonly finalPhase: GameState['phase']['kind'];
  readonly winner: Team | null;
  readonly winReason: WinReason | null;
  readonly policyByPlayer: Readonly<Record<string, PolicyName>>;
  readonly coverage: MutableCoverage;
  readonly failureCategory: QaFailureCategory | null;
  readonly failureMessage: string | null;
  readonly repro?: GameRepro;
  readonly reproPath?: string;
  readonly durationMs: number;
}

export interface QaRunGameOptions {
  readonly seed: number;
  readonly playerCount: number;
  readonly rebalanceEnabled: boolean;
  readonly policyByPlayer: Readonly<Record<string, PolicyName>>;
  readonly maxSteps?: number;
  readonly persistRepro?: boolean;
  readonly failuresDir?: string;
}

function playerIdsForCount(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `p${i + 1}`);
}

function makeDeps(seed: number): EngineDeps {
  return {
    rng: createRng(seed),
    clock: createClock(0),
    powerTable: defaultPowerTable,
    enforceImmutability: true,
  };
}

function isTerminal(state: GameState): boolean {
  return (
    state.phase.kind === 'GAME_OVER' ||
    state.phase.kind === 'ROOM_FROZEN' ||
    state.phase.kind === 'ROOM_CORRUPTED'
  );
}

function legalPhaseTransition(
  from: GameState['phase']['kind'],
  to: GameState['phase']['kind'],
): boolean {
  if (from === to) return true;
  if (to === 'ROOM_FROZEN' || to === 'ROOM_CORRUPTED' || to === 'GAME_OVER') {
    return true;
  }
  const allowed: Readonly<Record<string, readonly string[]>> = {
    LOBBY: ['ROLE_REVEAL'],
    ROLE_REVEAL: ['ELECTION_NOMINATION'],
    ELECTION_NOMINATION: ['DISCUSSION_PRE_VOTE'],
    DISCUSSION_PRE_VOTE: ['ELECTION_VOTING'],
    ELECTION_VOTING: [
      'LEGISLATION_MAHARAJ',
      'ELECTION_NOMINATION',
      'KURUKSHETRA_ANARCHY',
      'DECREE_CEREMONY',
      'GAME_OVER',
    ],
    KURUKSHETRA_ANARCHY: [
      'ELECTION_NOMINATION',
      'EXECUTIVE_ACTION',
      'DECREE_CEREMONY',
      'GAME_OVER',
    ],
    LEGISLATION_MAHARAJ: ['LEGISLATION_SENAPATI'],
    LEGISLATION_SENAPATI: [
      'ELECTION_NOMINATION',
      'EXECUTIVE_ACTION',
      'DECREE_CEREMONY',
      'GAME_OVER',
      'KURUKSHETRA_ANARCHY',
    ],
    DECREE_CEREMONY: ['ELECTION_NOMINATION', 'EXECUTIVE_ACTION', 'GAME_OVER'],
    EXECUTIVE_ACTION: ['ELECTION_NOMINATION', 'GAME_OVER'],
  };
  const next = allowed[from];
  return next ? next.includes(to) : false;
}

/**
 * Instrumented full-game driver for QA: invariants, hidden-info, FSM edges,
 * winner correctness, and coverage after every transition.
 */
export function runQaGame(opts: QaRunGameOptions): QaGameResult {
  const startedAt = Date.now();
  const playerIds = playerIdsForCount(opts.playerCount);
  const displayNames = Object.fromEntries(playerIds.map((id) => [id, id]));
  const deps = makeDeps(opts.seed);
  const maxSteps = opts.maxSteps ?? 5000;
  const actions: GameAction[] = [];
  const coverage = createCoverage();
  for (const name of Object.values(opts.policyByPlayer)) {
    coverage.policiesUsed.add(name);
  }

  let state = createInitialState(`qa-${opts.seed}`, playerIds[0]!);
  observeState(coverage, state);

  const startAction: GameAction = {
    type: 'START_GAME',
    playerIds,
    displayNames,
    hostPlayerId: playerIds[0]!,
    rebalanceEnabled: opts.rebalanceEnabled,
    seed: opts.seed,
  };

  const finish = (
    ok: boolean,
    category: QaFailureCategory | null,
    message: string | null,
    step: number,
  ): QaGameResult => {
    let repro: GameRepro | undefined;
    let reproPath: string | undefined;
    if (!ok && category) {
      const kind: FailureKind =
        category === 'hidden_info_leak' ||
        category === 'winner_incorrect' ||
        category === 'illegal_terminal' ||
        category === 'rule_violation' ||
        category === 'fsm_error' ||
        category === 'stall' ||
        category === 'crash'
          ? category === 'stall'
            ? 'stuck'
            : category === 'crash'
              ? 'throw'
              : 'invariant'
          : category;
      repro = {
        version: 1,
        seed: opts.seed,
        playerCount: opts.playerCount,
        rebalanceEnabled: opts.rebalanceEnabled,
        playerIds,
        policyByPlayer: opts.policyByPlayer,
        actions,
        failure: {
          kind,
          message: message ?? category,
          step,
        },
      };
      if (opts.persistRepro !== false && opts.failuresDir) {
        reproPath = writeRepro(repro, opts.failuresDir);
      }
    }

    const winner =
      state.phase.kind === 'GAME_OVER' ? state.phase.winner : null;
    const winReason =
      state.phase.kind === 'GAME_OVER' ? state.phase.reason : null;

    return {
      ok,
      seed: opts.seed,
      playerCount: opts.playerCount,
      rebalanceEnabled: opts.rebalanceEnabled,
      steps: step,
      finalPhase: state.phase.kind,
      winner,
      winReason,
      policyByPlayer: opts.policyByPlayer,
      coverage,
      failureCategory: category,
      failureMessage: message,
      repro,
      reproPath,
      durationMs: Date.now() - startedAt,
    };
  };

  try {
    const started = applyAction(state, startAction, deps);
    state = started.state;
    actions.push(startAction);
    observeState(coverage, state, started.events);
    assertInvariants(state);
    const leak0 = checkHiddenInfo(state);
    if (leak0) {
      return finish(false, leak0.kind, leak0.message, 0);
    }

    for (let step = 1; step <= maxSteps; step += 1) {
      if (state.phase.kind === 'GAME_OVER') {
        const winCheck = checkWinnerCorrect(state);
        if (winCheck) {
          return finish(false, winCheck.kind, winCheck.message, step - 1);
        }
        return finish(true, null, null, step - 1);
      }
      if (state.phase.kind === 'ROOM_FROZEN') {
        return finish(false, 'room_frozen', state.phase.reason, step - 1);
      }
      if (state.phase.kind === 'ROOM_CORRUPTED') {
        return finish(false, 'room_corrupted', state.phase.reason, step - 1);
      }

      const actors = playersWithLegalActions(state);
      let actionToApply: GameAction | null = null;
      let expectRejection = false;

      if (actors.length > 0) {
        const playerId = actors[0]!;
        const legal = getLegalActions(state, playerId);
        const policyName = opts.policyByPlayer[playerId] ?? 'random';
        const policy = getPolicy(policyName);
        const decision = policy.decide({
          state,
          playerId,
          legal,
          rng: deps.rng,
        });

        if (decision.kind === 'action') {
          actionToApply = decision.action;
        } else if (decision.kind === 'skip') {
          const system = getSystemLegalActions(state);
          if (system.length > 0) {
            actionToApply = system[0]!;
          } else if (legal.length > 0) {
            actionToApply = deps.rng.pickOne(legal);
          } else if (actors.length > 1) {
            const nextId = actors[1]!;
            const nextLegal = getLegalActions(state, nextId);
            if (nextLegal.length > 0) {
              actionToApply = deps.rng.pickOne(nextLegal);
            }
          }
          if (!actionToApply) {
            return finish(
              false,
              'stuck',
              `Player ${playerId} skipped with no fallback action`,
              step,
            );
          }
        } else {
          actionToApply = decision.action;
          expectRejection = true;
          coverage.illegalProbes += 1;
        }
      } else {
        const system = getSystemLegalActions(state);
        if (system.length === 0) {
          return finish(
            false,
            'stuck',
            `No legal player or system actions in phase ${state.phase.kind}`,
            step,
          );
        }
        actionToApply = system[0]!;
      }

      const beforePhase = state.phase.kind;
      const beforeVersion = state.stateVersion;
      const result = applyAction(state, actionToApply, deps);
      state = result.state;
      actions.push(actionToApply);
      observeState(coverage, state, result.events);

      if (!legalPhaseTransition(beforePhase, state.phase.kind)) {
        return finish(
          false,
          'fsm_error',
          `Illegal FSM transition ${beforePhase} → ${state.phase.kind} via ${actionToApply.type}`,
          step,
        );
      }

      if (expectRejection) {
        const rejected = result.events.some((e) => e.type === 'ACTION_REJECTED');
        if (rejected) {
          coverage.expectedRejections += 1;
          assertInvariants(state);
          const leak = checkHiddenInfo(state);
          if (leak) return finish(false, leak.kind, leak.message, step);
          continue;
        }
        if (isTerminal(state) && state.phase.kind !== 'GAME_OVER') {
          return finish(
            false,
            state.phase.kind === 'ROOM_FROZEN' ? 'room_frozen' : 'room_corrupted',
            'phase' in state.phase && 'reason' in state.phase
              ? String(state.phase.reason)
              : 'terminal after illegal probe',
            step,
          );
        }
      }

      try {
        assertInvariants(state);
      } catch (err) {
        return finish(
          false,
          'invariant',
          err instanceof Error ? err.message : String(err),
          step,
        );
      }

      const leak = checkHiddenInfo(state);
      if (leak) {
        return finish(false, leak.kind, leak.message, step);
      }

      if (
        state.stateVersion === beforeVersion &&
        !result.events.some((e) => e.type === 'ACTION_REJECTED')
      ) {
        return finish(
          false,
          'stuck',
          `Action ${actionToApply.type} did not advance stateVersion`,
          step,
        );
      }
    }

    return finish(false, 'max_steps', `Exceeded maxSteps=${maxSteps}`, maxSteps);
  } catch (err) {
    return finish(
      false,
      'throw',
      err instanceof Error ? err.message : String(err),
      actions.length,
    );
  }
}
