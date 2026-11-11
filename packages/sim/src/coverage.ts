import type {
  GameEvent,
  GameState,
  RajaagnaPower,
  Role,
  Team,
  WinReason,
} from '@shaatir-shakuni/engine';
import type { PolicyName } from './types.js';

export type PhaseKind = GameState['phase']['kind'];

export interface CoverageSnapshot {
  readonly phases: ReadonlySet<PhaseKind>;
  readonly powers: ReadonlySet<RajaagnaPower>;
  readonly winReasons: ReadonlySet<WinReason>;
  readonly winners: ReadonlySet<Team>;
  readonly rolesDealt: ReadonlySet<Role>;
  readonly policiesUsed: ReadonlySet<PolicyName>;
  readonly playerCounts: ReadonlySet<number>;
  readonly rebalanceOn: boolean;
  readonly rebalanceOff: boolean;
  readonly vetoProposed: boolean;
  readonly kurukshetraAnarchy: boolean;
  readonly illegalProbes: number;
  readonly expectedRejections: number;
}

export interface MutableCoverage {
  phases: Set<PhaseKind>;
  powers: Set<RajaagnaPower>;
  winReasons: Set<WinReason>;
  winners: Set<Team>;
  rolesDealt: Set<Role>;
  policiesUsed: Set<PolicyName>;
  playerCounts: Set<number>;
  rebalanceOn: boolean;
  rebalanceOff: boolean;
  vetoProposed: boolean;
  kurukshetraAnarchy: boolean;
  illegalProbes: number;
  expectedRejections: number;
}

export function createCoverage(): MutableCoverage {
  return {
    phases: new Set(),
    powers: new Set(),
    winReasons: new Set(),
    winners: new Set(),
    rolesDealt: new Set(),
    policiesUsed: new Set(),
    playerCounts: new Set(),
    rebalanceOn: false,
    rebalanceOff: false,
    vetoProposed: false,
    kurukshetraAnarchy: false,
    illegalProbes: 0,
    expectedRejections: 0,
  };
}

export function observeState(
  cov: MutableCoverage,
  state: GameState,
  events: readonly GameEvent[] = [],
): void {
  cov.phases.add(state.phase.kind);
  const count = state.startPlayerCount || state.players.length;
  if (count > 0) cov.playerCounts.add(count);
  if (state.rebalanceEnabled) cov.rebalanceOn = true;
  else cov.rebalanceOff = true;

  for (const p of state.players) {
    if (p.role) cov.rolesDealt.add(p.role);
  }

  if (state.phase.kind === 'EXECUTIVE_ACTION') {
    cov.powers.add(state.phase.power);
  }
  if (state.phase.kind === 'KURUKSHETRA_ANARCHY') {
    cov.kurukshetraAnarchy = true;
  }
  if (
    state.phase.kind === 'LEGISLATION_SENAPATI' &&
    state.phase.vetoProposed
  ) {
    cov.vetoProposed = true;
  }
  if (state.phase.kind === 'GAME_OVER') {
    cov.winners.add(state.phase.winner);
    cov.winReasons.add(state.phase.reason);
  }

  // Transient phases (e.g. anarchy) may be entered and left inside a single
  // applyAction — surface them via events so coverage isn't falsely empty.
  for (const ev of events) {
    if (ev.type === 'KURUKSHETRA_ANARCHY') {
      cov.kurukshetraAnarchy = true;
      cov.phases.add('KURUKSHETRA_ANARCHY');
    }
    if (ev.type === 'POWER_GRANTED') {
      cov.powers.add(ev.power);
      cov.phases.add('EXECUTIVE_ACTION');
    }
    if (ev.type === 'VETO_PROPOSED') {
      cov.vetoProposed = true;
    }
    if (ev.type === 'PHASE_CHANGED') {
      cov.phases.add(ev.to);
      cov.phases.add(ev.from);
    }
    if (ev.type === 'WIN_CONDITION_MET') {
      cov.winners.add(ev.winner);
      cov.winReasons.add(ev.reason);
    }
  }
}

export function mergeCoverage(
  into: MutableCoverage,
  from: MutableCoverage,
): void {
  for (const p of from.phases) into.phases.add(p);
  for (const p of from.powers) into.powers.add(p);
  for (const w of from.winReasons) into.winReasons.add(w);
  for (const w of from.winners) into.winners.add(w);
  for (const r of from.rolesDealt) into.rolesDealt.add(r);
  for (const p of from.policiesUsed) into.policiesUsed.add(p);
  for (const n of from.playerCounts) into.playerCounts.add(n);
  into.rebalanceOn = into.rebalanceOn || from.rebalanceOn;
  into.rebalanceOff = into.rebalanceOff || from.rebalanceOff;
  into.vetoProposed = into.vetoProposed || from.vetoProposed;
  into.kurukshetraAnarchy =
    into.kurukshetraAnarchy || from.kurukshetraAnarchy;
  into.illegalProbes += from.illegalProbes;
  into.expectedRejections += from.expectedRejections;
}

export function freezeCoverage(cov: MutableCoverage): CoverageSnapshot {
  return {
    phases: new Set(cov.phases),
    powers: new Set(cov.powers),
    winReasons: new Set(cov.winReasons),
    winners: new Set(cov.winners),
    rolesDealt: new Set(cov.rolesDealt),
    policiesUsed: new Set(cov.policiesUsed),
    playerCounts: new Set(cov.playerCounts),
    rebalanceOn: cov.rebalanceOn,
    rebalanceOff: cov.rebalanceOff,
    vetoProposed: cov.vetoProposed,
    kurukshetraAnarchy: cov.kurukshetraAnarchy,
    illegalProbes: cov.illegalProbes,
    expectedRejections: cov.expectedRejections,
  };
}
