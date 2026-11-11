import type { WirePlayerView } from '@shaatir-shakuni/socket-api';

function nameOf(view: WirePlayerView, id: string | null | undefined): string {
  if (!id) return '—';
  return view.players.find((p) => p.id === id)?.displayName ?? id.slice(0, 6);
}

export function phaseTitle(kind: WirePlayerView['phase']['kind']): string {
  switch (kind) {
    case 'ROLE_REVEAL':
      return 'Role reveal';
    case 'ELECTION_NOMINATION':
      return 'Nomination';
    case 'DISCUSSION_PRE_VOTE':
      return 'Discussion';
    case 'ELECTION_VOTING':
      return 'Election';
    case 'KURUKSHETRA_ANARCHY':
      return 'Kurukshetra Anarchy';
    case 'LEGISLATION_MAHARAJ':
      return 'Legislation';
    case 'LEGISLATION_SENAPATI':
      return 'Legislation';
    case 'DECREE_CEREMONY':
      return 'Decree enacted';
    case 'EXECUTIVE_ACTION':
      return 'Rajaagna';
    case 'GAME_OVER':
      return 'Game over';
    case 'ROOM_FROZEN':
      return 'Frozen';
    case 'ROOM_CORRUPTED':
      return 'Corrupted';
    default:
      return kind;
  }
}

function powerPlain(power: string | undefined): string {
  switch (power) {
    case 'DIVYA_DRISHTI':
      return 'Divya Drishti (investigate a player’s party)';
    case 'RAJYA_SABHA_SUMMONS':
      return 'Rajya Sabha Summons (special election)';
    case 'AKASHVANI':
      return 'Akashvani (peek the top three decrees)';
    case 'VANVAS':
      return 'Vanvas (exile a player)';
    default:
      return power ?? 'a Rajaagna power';
  }
}

/** Public table narration — safe for every seat. */
export function phaseNarration(view: WirePlayerView): string {
  const kind = view.phase.kind;
  const maharaj = nameOf(view, view.maharajCandidateId);
  const senapati = nameOf(view, view.senapatiCandidateId);
  const govM = nameOf(view, view.currentGovernment?.maharajId);
  const govS = nameOf(view, view.currentGovernment?.senapatiId);
  const exiled = nameOf(view, view.lastExiledPlayerId);

  switch (kind) {
    case 'ROLE_REVEAL':
      return 'Look at your role privately. Acknowledge when ready.';
    case 'ELECTION_NOMINATION':
      return `${maharaj} is choosing a Senapati. Discuss around the table, then lock the nominee.`;
    case 'DISCUSSION_PRE_VOTE':
      return `${maharaj} nominated ${senapati}. Discuss the government — ready up when the table is set.`;
    case 'ELECTION_VOTING': {
      if (view.votesRevealed || view.phase.votesRevealed) {
        return `Ballots are face-up for ${maharaj} + ${senapati}. Read the table, then ready to continue.`;
      }
      return `${maharaj} (Maharaj) and ${senapati} (Senapati) stand for election. Cast Ha or Nahi.`;
    }
    case 'LEGISLATION_MAHARAJ':
      return `${govM} (Maharaj) draws three decrees and discards one privately.`;
    case 'LEGISLATION_SENAPATI':
      if (view.phase.vetoProposed) {
        return `${govS} proposed Shakuni’s Dice. The government must agree to veto, or enact a decree.`;
      }
      return `${govS} (Senapati) receives two decrees and must discard one to enact the other.`;
    case 'DECREE_CEREMONY': {
      const tile = view.lastEnactedDecree ?? view.phase.tileType;
      if (tile === 'ADHARMA' && view.enactedAdharma === 3) {
        return 'Third Adharma Decree — warning: if Duryodhana is elected Senapati from now on, the Kauravas win immediately.';
      }
      const label = tile === 'DHARMA' ? 'Dharma' : tile === 'ADHARMA' ? 'Adharma' : 'A';
      return `${label} Decree lands on the track. Discuss, then ready to continue.`;
    }
    case 'KURUKSHETRA_ANARCHY':
      return 'Three rejected governments — Kurukshetra Anarchy enacts the top decree with no power.';
    case 'EXECUTIVE_ACTION': {
      const power = view.phase.power;
      if (power === 'AKASHVANI') {
        return `${govM} (Maharaj) is resolving Akashvani — peeking the top three decrees of the Decree Deck.`;
      }
      if (power === 'VANVAS') {
        return `${govM} (Maharaj) must choose a player for Vanvas (exile).${
          view.lastExiledPlayerId ? ` Last exile: ${exiled}.` : ''
        }`;
      }
      if (power === 'DIVYA_DRISHTI') {
        return `${govM} (Maharaj) uses Divya Drishti — choose whose party membership card to see.`;
      }
      if (power === 'RAJYA_SABHA_SUMMONS') {
        return `${govM} (Maharaj) uses Rajya Sabha Summons — choose who becomes the next Maharaj.`;
      }
      return `${govM} (Maharaj) resolves ${powerPlain(power)}.`;
    }
    case 'GAME_OVER':
      return 'The court is closed. Every role is revealed.';
    case 'ROOM_FROZEN':
    case 'ROOM_CORRUPTED':
      return 'This game cannot continue.';
    default:
      return '';
  }
}

export function isCeremonyPhase(view: WirePlayerView): boolean {
  if (view.phase.kind === 'DECREE_CEREMONY') return true;
  if (view.phase.kind === 'DISCUSSION_PRE_VOTE') return true;
  if (view.phase.kind === 'ELECTION_VOTING') {
    return Boolean(view.votesRevealed || view.phase.votesRevealed);
  }
  return false;
}
