import {
  getLegalActions,
  getSystemLegalActions,
  playersWithLegalActions,
  type GameAction,
  type GameState,
  type Phase,
} from '@shaatir-shakuni/engine';
import { DEFAULT_TIMEOUTS, type TimeoutConfig } from './timeouts.js';

const TIMED_PHASES: ReadonlySet<Phase['kind']> = new Set([
  'ROLE_REVEAL',
  'ELECTION_NOMINATION',
  'DISCUSSION_PRE_VOTE',
  'ELECTION_VOTING',
  'LEGISLATION_MAHARAJ',
  'LEGISLATION_SENAPATI',
  'EXECUTIVE_ACTION',
  'DECREE_CEREMONY',
]);

const MULTI_SEAT_PHASES: ReadonlySet<Phase['kind']> = new Set([
  'ROLE_REVEAL',
  'DISCUSSION_PRE_VOTE',
  'ELECTION_VOTING',
  'DECREE_CEREMONY',
]);

export function phaseNeedsAfkDeadline(phaseKind: Phase['kind']): boolean {
  return TIMED_PHASES.has(phaseKind);
}

export function isMultiSeatTimedPhase(phase: Phase): boolean {
  return MULTI_SEAT_PHASES.has(phase.kind);
}

/** Stable key so soft→hard windows don't reset when deferred seats update. */
export function phaseTimerKey(phase: Phase): string {
  if (phase.kind === 'ELECTION_VOTING') {
    return `ELECTION_VOTING:${phase.votesRevealed ? 'reveal' : 'open'}`;
  }
  if (phase.kind === 'DECREE_CEREMONY') {
    return `DECREE_CEREMONY:${phase.tileId}`;
  }
  if (phase.kind === 'DISCUSSION_PRE_VOTE') {
    return 'DISCUSSION_PRE_VOTE';
  }
  if (phase.kind === 'ROLE_REVEAL') {
    return 'ROLE_REVEAL';
  }
  return phase.kind;
}

export function hardDurationMs(
  phase: Phase,
  timeouts: TimeoutConfig = DEFAULT_TIMEOUTS,
): number {
  switch (phase.kind) {
    case 'ROLE_REVEAL':
      return timeouts.roleRevealMs;
    case 'DISCUSSION_PRE_VOTE':
      return timeouts.discussionPreVoteMs;
    case 'DECREE_CEREMONY':
      return timeouts.ceremonyDecreeMs;
    case 'ELECTION_VOTING':
      return phase.votesRevealed
        ? timeouts.ceremonyVoteRevealMs
        : timeouts.actionMs;
    default:
      return timeouts.actionMs;
  }
}

/**
 * Absolute deadline for the current required-action / ceremony window.
 * Callers store this and re-derive remaining time (EC-29) — never a decrementing counter.
 *
 * Pass the full `Phase` when available so vote-reveal uses ceremonyVoteRevealMs.
 */
export function computeAfkDeadline(
  phase: Phase | Phase['kind'],
  windowStartedAtMs: number,
  timeouts: TimeoutConfig = DEFAULT_TIMEOUTS,
): number | null {
  if (typeof phase === 'string') {
    if (!phaseNeedsAfkDeadline(phase)) return null;
    if (phase === 'ROLE_REVEAL') return windowStartedAtMs + timeouts.roleRevealMs;
    if (phase === 'DISCUSSION_PRE_VOTE') {
      return windowStartedAtMs + timeouts.discussionPreVoteMs;
    }
    if (phase === 'DECREE_CEREMONY') {
      return windowStartedAtMs + timeouts.ceremonyDecreeMs;
    }
    return windowStartedAtMs + timeouts.actionMs;
  }
  if (!phaseNeedsAfkDeadline(phase.kind)) return null;
  return windowStartedAtMs + hardDurationMs(phase, timeouts);
}

/** Soft AFK mark deadline (multi-seat only); null when solo-actor. */
export function computeSoftAfkDeadline(
  phase: Phase,
  windowStartedAtMs: number,
  hardDeadlineMs: number,
  timeouts: TimeoutConfig = DEFAULT_TIMEOUTS,
): number | null {
  if (!isMultiSeatTimedPhase(phase)) return null;
  const soft = windowStartedAtMs + timeouts.softAfkMs;
  return Math.min(soft, hardDeadlineMs);
}

export function isAfkDeadlineExpired(deadlineMs: number | null, nowMs: number): boolean {
  if (deadlineMs === null) return false;
  return nowMs >= deadlineMs;
}

function seatOrderOf(state: GameState, playerId: string): number {
  return state.players.find((p) => p.id === playerId)?.seatOrder ?? Number.MAX_SAFE_INTEGER;
}

/**
 * Pick the lowest-seatOrder NOMINATE_SENAPATI among legal actions (EC-39).
 */
export function pickAfkNomination(state: GameState): GameAction | null {
  if (state.phase.kind !== 'ELECTION_NOMINATION') return null;
  const legal = getLegalActions(state, state.maharajCandidateId).filter(
    (a): a is Extract<GameAction, { type: 'NOMINATE_SENAPATI' }> =>
      a.type === 'NOMINATE_SENAPATI',
  );
  if (legal.length === 0) return null;
  const sorted = [...legal].sort(
    (a, b) => seatOrderOf(state, a.nomineeId) - seatOrderOf(state, b.nomineeId),
  );
  return sorted[0] ?? null;
}

function actingPlayerId(state: GameState): string | null {
  switch (state.phase.kind) {
    case 'LEGISLATION_MAHARAJ':
      return state.currentGovernment?.maharajId ?? null;
    case 'LEGISLATION_SENAPATI':
      if (state.phase.vetoProposed) {
        const gov = state.currentGovernment;
        if (!gov) return null;
        if (state.phase.vetoVotes[gov.senapatiId] === undefined) return gov.senapatiId;
        if (state.phase.vetoVotes[gov.maharajId] === undefined) return gov.maharajId;
        return null;
      }
      return state.currentGovernment?.senapatiId ?? null;
    case 'EXECUTIVE_ACTION':
      return state.currentGovernment?.maharajId ?? null;
    default:
      return null;
  }
}

/**
 * Prefer NAHI for auto veto votes (same default-cast policy as EC-40).
 * Otherwise first legal action in engine order (stable for legislation tiles).
 */
function pickSingleActorAfkAction(state: GameState): GameAction | null {
  const actorId = actingPlayerId(state);
  if (!actorId) return null;
  const legal = getLegalActions(state, actorId);
  if (legal.length === 0) return null;

  const nahiVeto = legal.find(
    (a) => a.type === 'CAST_VETO_VOTE' && a.vote === 'NAHI',
  );
  if (nahiVeto) return nahiVeto;

  return legal[0] ?? null;
}

/**
 * When an AFK / ceremony deadline fires, the engine action orchestration should apply.
 * System actions (role-reveal timeout, default votes, ceremony advances) take precedence.
 */
export function resolveAfkAction(state: GameState): GameAction | null {
  const system = getSystemLegalActions(state);
  if (system.length > 0) {
    return system[0] ?? null;
  }

  if (state.phase.kind === 'ELECTION_NOMINATION') {
    return pickAfkNomination(state);
  }

  if (
    state.phase.kind === 'LEGISLATION_MAHARAJ' ||
    state.phase.kind === 'LEGISLATION_SENAPATI' ||
    state.phase.kind === 'EXECUTIVE_ACTION'
  ) {
    return pickSingleActorAfkAction(state);
  }

  return null;
}

/**
 * Auto-act one deferred seat (lowest seat order) — used when humans are done
 * and deferred AFK bots should catch up before the hard deadline.
 */
export function resolveDeferredSeatAction(
  state: GameState,
  deferredPlayerIds: ReadonlySet<string>,
): GameAction | null {
  const pending = playersWithLegalActions(state).filter((id) =>
    deferredPlayerIds.has(id),
  );
  if (pending.length === 0) return null;
  const sorted = [...pending].sort(
    (a, b) => seatOrderOf(state, a) - seatOrderOf(state, b),
  );
  const playerId = sorted[0];
  if (!playerId) return null;
  const legal = getLegalActions(state, playerId);
  if (legal.length === 0) return null;

  const done = legal.find((a) => a.type === 'DONE_DISCUSSING');
  if (done) return done;
  const ack = legal.find((a) => a.type === 'ACK_ROLE_REVEAL');
  if (ack) return ack;
  const nahi = legal.find((a) => a.type === 'CAST_VOTE' && a.vote === 'NAHI');
  if (nahi) return nahi;
  return legal[0] ?? null;
}

/**
 * True when every seat that still owes an action is in the deferred set
 * (humans / non-deferred have finished — bots may catch up).
 */
export function onlyDeferredSeatsRemain(
  state: GameState,
  deferredPlayerIds: ReadonlySet<string>,
): boolean {
  const pending = playersWithLegalActions(state);
  if (pending.length === 0) return false;
  return pending.every((id) => deferredPlayerIds.has(id));
}
