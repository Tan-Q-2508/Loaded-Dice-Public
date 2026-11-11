import {
  type GameAction,
  type GameState,
  type Role,
} from '@shaatir-shakuni/engine';
import type { Policy, PolicyContext, PolicyDecision, PolicyName } from './types.js';

function pickRandom<T>(items: readonly T[], rng: PolicyContext['rng']): T {
  return rng.pickOne(items);
}

function fallbackRandom(ctx: PolicyContext): PolicyDecision {
  if (ctx.legal.length === 0) return { kind: 'skip' };
  return { kind: 'action', action: pickRandom(ctx.legal, ctx.rng) };
}

/** Baseline: uniform among engine-reported legal actions. */
export const randomPolicy: Policy = {
  name: 'random',
  decide(ctx) {
    return fallbackRandom(ctx);
  },
};

/**
 * Stresses Shakuni's Dice (veto) and its interaction with the Election Tracker
 * (EC-49–EC-52): proposes veto whenever legal, and votes HA on veto ballots.
 */
export const alwaysVetoPolicy: Policy = {
  name: 'always-veto',
  decide(ctx) {
    const propose = ctx.legal.find((a) => a.type === 'PROPOSE_VETO');
    if (propose) return { kind: 'action', action: propose };
    const vetoHa = ctx.legal.find(
      (a) => a.type === 'CAST_VETO_VOTE' && a.vote === 'HA',
    );
    if (vetoHa) return { kind: 'action', action: vetoHa };
    return fallbackRandom(ctx);
  },
};

/**
 * Stresses Kurukshetra Anarchy and repeated-rejection sequences (EC-43–EC-45):
 * always votes NAHI on elections.
 */
export const alwaysRejectPolicy: Policy = {
  name: 'always-reject',
  decide(ctx) {
    const nahi = ctx.legal.find((a) => a.type === 'CAST_VOTE' && a.vote === 'NAHI');
    if (nahi) return { kind: 'action', action: nahi };
    return fallbackRandom(ctx);
  },
};

/**
 * Stresses once-ever-per-player Divya Drishti targeting (EC-63): as Maharaj,
 * always investigates the lowest-seat-order living eligible target first.
 */
export const alwaysInvestigateSameTargetFirstPolicy: Policy = {
  name: 'always-investigate-same-target-first',
  decide(ctx) {
    const investigates = ctx.legal.filter(
      (a): a is Extract<GameAction, { type: 'EXEC_DIVYA_DRISHTI' }> =>
        a.type === 'EXEC_DIVYA_DRISHTI',
    );
    if (investigates.length > 0) {
      const ranked = [...investigates].sort((a, b) => {
        const sa =
          ctx.state.players.find((p) => p.id === a.targetId)?.seatOrder ?? 999;
        const sb =
          ctx.state.players.find((p) => p.id === b.targetId)?.seatOrder ?? 999;
        return sa - sb;
      });
      return { kind: 'action', action: ranked[0]! };
    }
    return fallbackRandom(ctx);
  },
};

function roleOf(state: GameState, playerId: string): Role | null {
  return state.players.find((p) => p.id === playerId)?.role ?? null;
}

function knownDuryodhanaId(state: GameState, playerId: string): string | null {
  const self = roleOf(state, playerId);
  if (self === 'DURYODHANA') return playerId;
  if (self === 'KAURAVA') {
    const d = state.players.find((p) => p.role === 'DURYODHANA');
    return d?.id ?? null;
  }
  return null;
}

/**
 * Kaurava-team policy that seats Duryodhana as Senapati as fast as private
 * knowledge allows — stresses post-3rd-Adharma Duryodhana-Senapati win timing.
 */
export const duryodhanaSeekingPolicy: Policy = {
  name: 'duryodhana-seeking',
  decide(ctx) {
    const duryodhanaId = knownDuryodhanaId(ctx.state, ctx.playerId);
    if (!duryodhanaId) return fallbackRandom(ctx);

    const nominate = ctx.legal.find(
      (a) => a.type === 'NOMINATE_SENAPATI' && a.nomineeId === duryodhanaId,
    );
    if (nominate) return { kind: 'action', action: nominate };

    if (ctx.state.senapatiCandidateId === duryodhanaId) {
      const ha = ctx.legal.find((a) => a.type === 'CAST_VOTE' && a.vote === 'HA');
      if (ha) return { kind: 'action', action: ha };
    } else {
      const nahi = ctx.legal.find(
        (a) => a.type === 'CAST_VOTE' && a.vote === 'NAHI',
      );
      if (nahi) return { kind: 'action', action: nahi };
    }

    return fallbackRandom(ctx);
  },
};

/**
 * Engine-input disconnect / AFK probes (not real sockets):
 * occasionally skips (driver applies CAST_DEFAULT_VOTES / ROLE_REVEAL_TIMEOUT),
 * submits an ineligible-player action, or resubmits a stale duplicate.
 */
export const disconnectSimPolicy: Policy = {
  name: 'disconnect-sim',
  decide(ctx) {
    const roll = ctx.rng.next();
    if (roll < 0.15) {
      return { kind: 'skip' };
    }
    if (roll < 0.25) {
      // Action from a player who is dead / wrong actor — engine must reject.
      const dead = ctx.state.players.find((p) => !p.isAlive);
      if (dead) {
        return {
          kind: 'illegal',
          action: { type: 'CAST_VOTE', playerId: dead.id, vote: 'HA' },
        };
      }
      return {
        kind: 'illegal',
        action: {
          type: 'NOMINATE_SENAPATI',
          maharajId: 'not-the-maharaj',
          nomineeId: ctx.playerId,
        },
      };
    }
    if (roll < 0.35) {
      // Wrong-phase / unknown actor — engine must reject without corrupting.
      return {
        kind: 'illegal',
        action: { type: 'CAST_VOTE', playerId: 'ghost-player', vote: 'HA' },
      };
    }
    return fallbackRandom(ctx);
  },
};

const POLICIES: Record<PolicyName, Policy> = {
  random: randomPolicy,
  'always-veto': alwaysVetoPolicy,
  'always-reject': alwaysRejectPolicy,
  'always-investigate-same-target-first': alwaysInvestigateSameTargetFirstPolicy,
  'duryodhana-seeking': duryodhanaSeekingPolicy,
  'disconnect-sim': disconnectSimPolicy,
};

export function getPolicy(name: PolicyName): Policy {
  return POLICIES[name];
}

export const ALL_POLICY_NAMES: readonly PolicyName[] = Object.keys(
  POLICIES,
) as PolicyName[];
