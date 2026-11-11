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
} from '@shaatir-shakuni/engine';
import { getPolicy } from './policies.js';
import { writeRepro } from './repro.js';
import type {
  FailureKind,
  GameRepro,
  GameResult,
  PolicyName,
  SimSummary,
} from './types.js';

export interface RunGameOptions {
  readonly seed: number;
  readonly playerCount: number;
  readonly rebalanceEnabled: boolean;
  readonly policyByPlayer: Readonly<Record<string, PolicyName>>;
  readonly maxSteps?: number;
  /** When true, persist repro files under failuresDir on failure. */
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

function failureFromState(
  state: GameState,
): { kind: FailureKind; message: string } | null {
  if (state.phase.kind === 'ROOM_FROZEN') {
    return { kind: 'room_frozen', message: state.phase.reason };
  }
  if (state.phase.kind === 'ROOM_CORRUPTED') {
    return { kind: 'room_corrupted', message: state.phase.reason };
  }
  return null;
}

function buildRepro(
  opts: RunGameOptions,
  playerIds: readonly string[],
  actions: readonly GameAction[],
  kind: FailureKind,
  message: string,
  step: number,
): GameRepro {
  return {
    version: 1,
    seed: opts.seed,
    playerCount: opts.playerCount,
    rebalanceEnabled: opts.rebalanceEnabled,
    playerIds,
    policyByPlayer: opts.policyByPlayer,
    actions,
    failure: { kind, message, step },
  };
}

/**
 * Replay a saved repro through the real engine. Returns whether the same
 * failure kind/message was observed (harness correctness property).
 */
export function replayRepro(repro: GameRepro): {
  readonly matched: boolean;
  readonly observed: { kind: FailureKind; message: string } | null;
  readonly finalPhase: GameState['phase']['kind'];
} {
  const deps = makeDeps(repro.seed);
  let state = createInitialState(`repro-${repro.seed}`, repro.playerIds[0]!);
  let observed: { kind: FailureKind; message: string } | null = null;

  try {
    for (let i = 0; i < repro.actions.length; i += 1) {
      const action = repro.actions[i]!;
      const result = applyAction(state, action, deps);
      state = result.state;
      const fromState = failureFromState(state);
      if (fromState) {
        observed = fromState;
        break;
      }
      try {
        assertInvariants(state);
      } catch (err) {
        observed = {
          kind: 'invariant',
          message: err instanceof Error ? err.message : String(err),
        };
        break;
      }
    }
    if (!observed && repro.failure.kind === 'max_steps') {
      // max_steps failures are harness-side: the action log is a prefix of a
      // non-terminal game. Matching means replay leaves a non-terminal state
      // with the same recorded message.
      if (!isTerminal(state)) {
        observed = {
          kind: 'max_steps',
          message: repro.failure.message,
        };
      }
    }
    if (!observed && repro.failure.kind === 'stuck') {
      if (
        !isTerminal(state) &&
        playersWithLegalActions(state).length === 0 &&
        getSystemLegalActions(state).length === 0
      ) {
        observed = { kind: 'stuck', message: repro.failure.message };
      }
    }
  } catch (err) {
    observed = {
      kind: 'throw',
      message: err instanceof Error ? err.message : String(err),
    };
  }

  const matched =
    observed !== null &&
    observed.kind === repro.failure.kind &&
    observed.message === repro.failure.message;

  return { matched, observed, finalPhase: state.phase.kind };
}

export function runGame(opts: RunGameOptions): GameResult {
  const playerIds = playerIdsForCount(opts.playerCount);
  const displayNames = Object.fromEntries(playerIds.map((id) => [id, id]));
  const deps = makeDeps(opts.seed);
  const maxSteps = opts.maxSteps ?? 5000;
  const actions: GameAction[] = [];

  let state = createInitialState(`sim-${opts.seed}`, playerIds[0]!);
  const startAction: GameAction = {
    type: 'START_GAME',
    playerIds,
    displayNames,
    hostPlayerId: playerIds[0]!,
    rebalanceEnabled: opts.rebalanceEnabled,
    seed: opts.seed,
  };

  const finishFailure = (
    kind: FailureKind,
    message: string,
    step: number,
  ): GameResult => {
    const repro = buildRepro(opts, playerIds, actions, kind, message, step);
    let reproPath: string | undefined;
    if (opts.persistRepro !== false && opts.failuresDir) {
      reproPath = writeRepro(repro, opts.failuresDir);
    }
    return {
      ok: false,
      seed: opts.seed,
      playerCount: opts.playerCount,
      rebalanceEnabled: opts.rebalanceEnabled,
      steps: step,
      finalPhase: state.phase.kind,
      repro,
      reproPath,
    };
  };

  try {
    const started = applyAction(state, startAction, deps);
    state = started.state;
    actions.push(startAction);
    assertInvariants(state);

    for (let step = 1; step <= maxSteps; step += 1) {
      if (state.phase.kind === 'GAME_OVER') {
        return {
          ok: true,
          seed: opts.seed,
          playerCount: opts.playerCount,
          rebalanceEnabled: opts.rebalanceEnabled,
          steps: step - 1,
          finalPhase: state.phase.kind,
        };
      }
      const terminalFail = failureFromState(state);
      if (terminalFail) {
        return finishFailure(terminalFail.kind, terminalFail.message, step - 1);
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
            return finishFailure(
              'stuck',
              `Player ${playerId} skipped with no legal or system action available`,
              step,
            );
          }
        } else {
          actionToApply = decision.action;
          expectRejection = true;
        }
      } else {
        const system = getSystemLegalActions(state);
        if (system.length === 0) {
          return finishFailure(
            'stuck',
            `No legal player or system actions in phase ${state.phase.kind}`,
            step,
          );
        }
        actionToApply = system[0]!;
      }

      if (!actionToApply) {
        return finishFailure('stuck', 'Driver produced no action', step);
      }

      const beforeVersion = state.stateVersion;
      const result = applyAction(state, actionToApply, deps);
      state = result.state;
      actions.push(actionToApply);

      if (expectRejection) {
        const rejected = result.events.some((e) => e.type === 'ACTION_REJECTED');
        if (!rejected && failureFromState(state)) {
          const fail = failureFromState(state)!;
          return finishFailure(fail.kind, fail.message, step);
        }
        // Legal rejection of illegal probe â€” continue without treating as failure.
        if (rejected) {
          assertInvariants(state);
          continue;
        }
      }

      const afterFail = failureFromState(state);
      if (afterFail) {
        return finishFailure(afterFail.kind, afterFail.message, step);
      }

      try {
        assertInvariants(state);
      } catch (err) {
        return finishFailure(
          'invariant',
          err instanceof Error ? err.message : String(err),
          step,
        );
      }

      if (
        state.stateVersion === beforeVersion &&
        !result.events.some((e) => e.type === 'ACTION_REJECTED')
      ) {
        // No-op non-rejection is unexpected for a "legal" action.
        return finishFailure(
          'stuck',
          `Action ${actionToApply.type} did not advance stateVersion`,
          step,
        );
      }
    }

    return finishFailure(
      'max_steps',
      `Exceeded maxSteps=${maxSteps}`,
      maxSteps,
    );
  } catch (err) {
    return finishFailure(
      'throw',
      err instanceof Error ? err.message : String(err),
      actions.length,
    );
  }
}

export interface RunSimOptions {
  readonly games: number;
  readonly baseSeed?: number;
  readonly maxSteps?: number;
  readonly persistRepro?: boolean;
  readonly failuresDir?: string;
  /** Override policy assignment; default mixes all named policies. */
  readonly assignPolicies?: (
    playerIds: readonly string[],
    rngSeed: number,
  ) => Readonly<Record<string, PolicyName>>;
}

const DEFAULT_POLICY_POOL: readonly PolicyName[] = [
  'random',
  'always-veto',
  'always-reject',
  'always-investigate-same-target-first',
  'duryodhana-seeking',
  'disconnect-sim',
];

export function defaultAssignPolicies(
  playerIds: readonly string[],
  rngSeed: number,
): Readonly<Record<string, PolicyName>> {
  const rng = createRng(rngSeed ^ 0x9e3779b9);
  const map: Record<string, PolicyName> = {};
  for (const id of playerIds) {
    map[id] = rng.pickOne(DEFAULT_POLICY_POOL);
  }
  // Guarantee at least one of each adversarial policy across larger tables
  // by pinning the first few seats when player count allows.
  if (playerIds.length >= 5) {
    map[playerIds[0]!] = 'always-reject';
    map[playerIds[1]!] = 'always-veto';
    map[playerIds[2]!] = 'always-investigate-same-target-first';
    map[playerIds[3]!] = 'duryodhana-seeking';
    map[playerIds[4]!] = 'disconnect-sim';
  }
  return map;
}


/**
 * Run many complete games across player counts 5-10 and rebalance on/off.
 */
export function runSim(opts: RunSimOptions): SimSummary {
  const baseSeed = opts.baseSeed ?? 1;
  const assign = opts.assignPolicies ?? defaultAssignPolicies;
  const results: GameResult[] = [];
  let gamesRun = 0;
  let failures = 0;

  for (let i = 0; i < opts.games; i += 1) {
    const playerCount = 5 + (i % 6);
    const rebalanceEnabled = Math.floor(i / 6) % 2 === 1;
    const seed = baseSeed + i * 9973;
    const ids = playerIdsForCount(playerCount);
    const result = runGame({
      seed,
      playerCount,
      rebalanceEnabled,
      policyByPlayer: assign(ids, seed),
      maxSteps: opts.maxSteps,
      persistRepro: opts.persistRepro,
      failuresDir: opts.failuresDir,
    });
    results.push(result);
    gamesRun += 1;
    if (!result.ok) failures += 1;
  }

  return { gamesRun, failures, results };
}
