import type { GameEvent } from '@shaatir-shakuni/engine';

export type NameOf = (playerId: string) => string;

/**
 * Renders an engine `GameEvent` (the same event vocabulary persisted for
 * crash recovery) into a human-readable narration line. This is why the
 * narrator doesn't need to hand-roll state diffing — the engine already
 * describes exactly what happened at each step.
 */
export function formatGameEvent(ev: GameEvent, nameOf: NameOf): string {
  switch (ev.type) {
    case 'GAME_STARTED':
      return `Game started — seed=${ev.seed}, ${ev.startPlayerCount} players.`;
    case 'ROLE_ASSIGNED':
      return `Roles dealt: ${nameOf(ev.playerId)} is secretly ${ev.role}.`;
    case 'PHASE_CHANGED':
      return `Phase: ${ev.from} -> ${ev.to}`;
    case 'MAHARAJ_CANDIDATE_SET':
      return `${nameOf(ev.playerId)} is the new Maharaj candidate.`;
    case 'SENAPATI_NOMINATED':
      return `Nominated ${nameOf(ev.nomineeId)} as Senapati.`;
    case 'VOTE_CAST':
      return `${nameOf(ev.playerId)} cast a vote.`;
    case 'VOTES_REVEALED': {
      const ha = Object.values(ev.votes).filter((v) => v === 'HA').length;
      const nahi = Object.values(ev.votes).filter((v) => v === 'NAHI').length;
      return `Votes revealed: ${ha} HA / ${nahi} NAHI.`;
    }
    case 'GOVERNMENT_REJECTED':
      return `Election failed (election tracker now ${ev.electionTracker}).`;
    case 'GOVERNMENT_ACCEPTED':
      return `Government elected — Maharaj ${nameOf(ev.maharajId)}, Senapati ${nameOf(ev.senapatiId)}.`;
    case 'KURUKSHETRA_ANARCHY':
      return `Kurukshetra Anarchy! Top decree auto-enacted (${ev.tileType}).`;
    case 'DECK_RESHUFFLED':
      return 'Decree deck reshuffled.';
    case 'TILE_DISCARDED':
      return `Tile discarded by ${ev.by}.`;
    case 'DECREE_ENACTED':
      return `Decree enacted: ${ev.tileType} (Dharma ${ev.dharmaCount} / Adharma ${ev.adharmaCount}).`;
    case 'VETO_PROPOSED':
      return 'Senapati proposes a veto.';
    case 'VETO_RESOLVED':
      return ev.accepted
        ? 'Veto accepted — decree discarded unenacted.'
        : 'Veto rejected — Senapati must enact a tile.';
    case 'POWER_GRANTED':
      return `Rajaagna power granted: ${ev.power}.`;
    case 'INVESTIGATION_RESULT':
      return `${nameOf(ev.maharajId)} investigates ${nameOf(ev.targetId)} — team is ${ev.team}.`;
    case 'SUMMONS_CALLED':
      return `${nameOf(ev.targetId)} summoned to Rajya Sabha (Maharaj returns to ${nameOf(ev.returnAfterPlayerId)} after).`;
    case 'AKASHVANI_PEEK':
      return `${nameOf(ev.maharajId)} peeks the top ${ev.tileIds.length} decrees via Akashvani.`;
    case 'PLAYER_EXILED':
      return `${nameOf(ev.playerId)} is exiled (Vanvas)!`;
    case 'WIN_CONDITION_MET':
      return `GAME OVER — ${ev.winner} wins (${ev.reason}).`;
    case 'ROOM_FAILURE':
      return `Room ${ev.mode}: ${ev.reason}`;
    case 'TERM_LIMITS_CLEARED':
      return 'Term limits cleared.';
    case 'ACTION_REJECTED':
      return `Action rejected: ${ev.actionType} (${ev.reason})`;
    default:
      return `Unrecognized event: ${JSON.stringify(ev)}`;
  }
}
