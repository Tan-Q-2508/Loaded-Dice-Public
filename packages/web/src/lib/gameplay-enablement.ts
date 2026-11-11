import type { GameActionPayload, WirePlayerView } from '@shaatir-shakuni/socket-api';

/**
 * UI enablement from wire phase + private fields only.
 * Does not reimplement term limits or win conditions — server rejects illegal acts.
 */

export function isGameWritable(
  view: WirePlayerView | null,
  opts: { readonly readOnly: boolean; readonly roomFrozen: boolean },
): boolean {
  if (!view || opts.readOnly || opts.roomFrozen) return false;
  if (view.isSpectator) return false;
  const kind = view.phase.kind;
  if (
    kind === 'GAME_OVER' ||
    kind === 'ROOM_FROZEN' ||
    kind === 'ROOM_CORRUPTED' ||
    kind === 'LOBBY' ||
    kind === 'KURUKSHETRA_ANARCHY'
  ) {
    return false;
  }
  return true;
}

export function canAckRoleReveal(
  view: WirePlayerView,
  playerId: string | null,
): boolean {
  if (view.phase.kind !== 'ROLE_REVEAL' || !playerId) return false;
  const pending = view.phase.pendingAcks ?? [];
  return pending.includes(playerId);
}

export function discussionSeatId(
  view: WirePlayerView,
  playerId: string | null,
): string | null {
  return playerId ?? view.viewerId ?? null;
}

export function isDiscussionReadyUpPhase(view: WirePlayerView): boolean {
  const kind = view.phase.kind;
  if (kind === 'DISCUSSION_PRE_VOTE' || kind === 'DECREE_CEREMONY') return true;
  if (kind === 'ELECTION_VOTING' && (view.votesRevealed || view.phase.votesRevealed)) {
    return true;
  }
  return false;
}

/** Every living seat still in pendingDone — never first-only. */
export function livingPendingDoneIds(view: WirePlayerView): readonly string[] {
  if (!isDiscussionReadyUpPhase(view)) return [];
  const pending = new Set(view.phase.pendingDone ?? []);
  return view.players.filter((p) => p.isAlive && pending.has(p.id)).map((p) => p.id);
}

export function canDoneDiscussing(
  view: WirePlayerView,
  playerId: string | null,
): boolean {
  if (view.isSpectator) return false;
  const seatId = discussionSeatId(view, playerId);
  if (!seatId) return false;
  return livingPendingDoneIds(view).includes(seatId);
}

export function canNominate(view: WirePlayerView, playerId: string | null): boolean {
  return (
    view.phase.kind === 'ELECTION_NOMINATION' &&
    playerId !== null &&
    playerId === view.maharajCandidateId &&
    !view.isSpectator
  );
}

export function canCastVote(view: WirePlayerView, playerId: string | null): boolean {
  if (view.phase.kind !== 'ELECTION_VOTING' || !playerId || view.isSpectator) return false;
  if (view.votesRevealed || view.phase.votesRevealed) return false;
  const me = view.players.find((p) => p.id === playerId);
  if (!me?.isAlive) return false;
  const votes = view.votes ?? view.phase.votes ?? null;
  if (votes && votes[playerId] !== undefined) return false;
  return true;
}

export function canDiscardMaharajTile(
  view: WirePlayerView,
  playerId: string | null,
): boolean {
  if (view.phase.kind !== 'LEGISLATION_MAHARAJ' || !playerId) return false;
  if (view.currentGovernment?.maharajId !== playerId) return false;
  return view.drawnTilesForMaharaj.length > 0 || (view.phase.drawnTiles?.length ?? 0) > 0;
}

export function canActAsSenapati(
  view: WirePlayerView,
  playerId: string | null,
): boolean {
  if (view.phase.kind !== 'LEGISLATION_SENAPATI' || !playerId) return false;
  return view.currentGovernment?.senapatiId === playerId;
}

export function canActAsMaharajVeto(
  view: WirePlayerView,
  playerId: string | null,
): boolean {
  if (view.phase.kind !== 'LEGISLATION_SENAPATI' || !playerId) return false;
  if (!view.phase.vetoProposed) return false;
  return view.currentGovernment?.maharajId === playerId;
}

export function canProposeVeto(view: WirePlayerView, playerId: string | null): boolean {
  return (
    canActAsSenapati(view, playerId) &&
    view.vetoUnlocked &&
    !view.phase.vetoProposed
  );
}

/** True when this seat still owes a required action (hides AFK timer while waiting on others). */
export function playerHasPendingAction(
  view: WirePlayerView,
  playerId: string | null,
): boolean {
  if (!playerId || view.isSpectator) return false;
  if (canAckRoleReveal(view, playerId)) return true;
  if (canDoneDiscussing(view, playerId)) return true;
  if (canNominate(view, playerId)) return true;
  if (canCastVote(view, playerId)) return true;
  if (canDiscardMaharajTile(view, playerId)) return true;
  if (canActAsSenapati(view, playerId)) return true;
  if (canActAsMaharajVeto(view, playerId)) {
    const votes = view.phase.vetoVotes ?? {};
    return votes[playerId] === undefined;
  }
  if (canExecPower(view, playerId)) return true;
  return false;
}

export function canExecPower(view: WirePlayerView, playerId: string | null): boolean {
  if (view.phase.kind !== 'EXECUTIVE_ACTION' || !playerId) return false;
  return view.currentGovernment?.maharajId === playerId;
}

/** Living others — nomination/power targets. */
export function livingOtherPlayers(
  view: WirePlayerView,
  playerId: string | null,
): WirePlayerView['players'] {
  return view.players.filter((p) => p.isAlive && p.id !== playerId);
}

/**
 * Term-limited ids from public wire fields (Rajya Maryada).
 * Mirrors engine `isSenapatiEligible` including the 5-living exception
 * and the EC-131 deadlock escape (if every other living seat is limited,
 * limits are ignored so nomination cannot stall).
 */
export function termLimitedNomineeIds(view: WirePlayerView): ReadonlySet<string> {
  const last = view.lastElectedGovernment;
  if (!last) return new Set();
  const living = view.players.filter((p) => p.isAlive);
  const limited =
    living.length === 5
      ? new Set([last.senapatiId])
      : new Set([last.maharajId, last.senapatiId]);
  const others = living.filter((p) => p.id !== view.maharajCandidateId);
  const anyEligibleOther = others.some((p) => !limited.has(p.id));
  if (!anyEligibleOther) return new Set();
  return limited;
}

/** Living others the Maharaj may nominate (term-limited seats excluded). */
export function eligibleNominees(
  view: WirePlayerView,
  playerId: string | null,
): WirePlayerView['players'] {
  const limited = termLimitedNomineeIds(view);
  return livingOtherPlayers(view, playerId).filter((p) => !limited.has(p.id));
}

export function maharajTiles(view: WirePlayerView): WirePlayerView['drawnTilesForMaharaj'] {
  if (view.drawnTilesForMaharaj.length > 0) return view.drawnTilesForMaharaj;
  return view.phase.drawnTiles ?? [];
}

export function senapatiTiles(view: WirePlayerView): WirePlayerView['heldTiles'] {
  if (view.heldTiles.length > 0) return view.heldTiles;
  return view.phase.heldTiles ?? [];
}

export function payloadForPending(
  kind:
    | 'nominee'
    | 'vote'
    | 'tile'
    | 'target'
    | 'vetoVote'
    | 'ack'
    | 'doneDiscussing'
    | 'proposeVeto'
    | 'akashvani',
  value: string,
  view: WirePlayerView,
): GameActionPayload | null {
  switch (kind) {
    case 'ack':
      return { type: 'ACK_ROLE_REVEAL' };
    case 'doneDiscussing':
      return { type: 'DONE_DISCUSSING' };
    case 'nominee':
      return { type: 'NOMINATE_SENAPATI', nomineeId: value };
    case 'vote':
      return { type: 'CAST_VOTE', vote: value === 'HA' ? 'HA' : 'NAHI' };
    case 'tile':
      if (view.phase.kind === 'LEGISLATION_MAHARAJ') {
        return { type: 'DISCARD_MAHARAJ_TILE', tileId: value };
      }
      if (view.phase.kind === 'LEGISLATION_SENAPATI') {
        return { type: 'DISCARD_SENAPATI_TILE', tileId: value };
      }
      return null;
    case 'proposeVeto':
      return { type: 'PROPOSE_VETO' };
    case 'vetoVote':
      return { type: 'CAST_VETO_VOTE', vote: value === 'HA' ? 'HA' : 'NAHI' };
    case 'akashvani':
      return { type: 'EXEC_AKASHVANI_ACK' };
    case 'target': {
      if (view.phase.kind !== 'EXECUTIVE_ACTION' || !view.phase.power) return null;
      switch (view.phase.power) {
        case 'DIVYA_DRISHTI':
          return { type: 'EXEC_DIVYA_DRISHTI', targetId: value };
        case 'RAJYA_SABHA_SUMMONS':
          return { type: 'EXEC_RAJYA_SABHA_SUMMONS', targetId: value };
        case 'VANVAS':
          return { type: 'EXEC_VANVAS', targetId: value };
        default:
          return null;
      }
    }
    default: {
      const _exhaustive: never = kind;
      void _exhaustive;
      return null;
    }
  }
}
