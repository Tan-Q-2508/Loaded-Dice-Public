import type { GameState } from './types.js';
import { livingPlayers } from './state-helpers.js';

function isTermLimitedNominee(
  state: GameState,
  nomineeId: string,
  livingCount: number,
): boolean {
  const last = state.lastElectedGovernment;
  if (!last) return false;
  // Spec §5.3 / EC-41: with exactly 5 living, only the last Senapati is limited.
  if (livingCount === 5) return nomineeId === last.senapatiId;
  return nomineeId === last.maharajId || nomineeId === last.senapatiId;
}

export function isSenapatiEligible(
  state: GameState,
  nomineeId: string,
): { eligible: true } | { eligible: false; reason: string } {
  const nominee = state.players.find((p) => p.id === nomineeId);
  if (!nominee || !nominee.isAlive) {
    return { eligible: false, reason: 'Nominee is not a living player' };
  }
  if (nomineeId === state.maharajCandidateId) {
    return { eligible: false, reason: 'Maharaj candidate cannot be nominated as Senapati' };
  }

  const living = livingPlayers(state);
  const last = state.lastElectedGovernment;

  if (!last) return { eligible: true };

  // Escape hatch (Secret Hitler parity; QA seed 20291381): if every living
  // player other than the Maharaj Candidate is term-limited, ignore term
  // limits for this nomination — otherwise ELECTION_NOMINATION has zero
  // legal actions and the room deadlocks (EC-34).
  const others = living.filter((p) => p.id !== state.maharajCandidateId);
  const anyNonLimitedOther = others.some(
    (p) => !isTermLimitedNominee(state, p.id, living.length),
  );
  if (!anyNonLimitedOther) {
    return { eligible: true };
  }

  if (living.length === 5) {
    if (nomineeId === last.senapatiId) {
      return { eligible: false, reason: 'Most recent Senapati is term-limited' };
    }
    return { eligible: true };
  }

  if (nomineeId === last.maharajId || nomineeId === last.senapatiId) {
    return { eligible: false, reason: 'Last elected government pair is term-limited' };
  }

  return { eligible: true };
}
