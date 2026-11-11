import type { WirePlayerView } from '@shaatir-shakuni/socket-api';

function nameOf(view: WirePlayerView, id: string | null | undefined): string {
  if (!id) return '—';
  return view.players.find((p) => p.id === id)?.displayName ?? id.slice(0, 6);
}

export type CourtAnnouncement = {
  readonly kind:
    | 'nomination'
    | 'government'
    | 'exile'
    | 'duryodhana-senapati-warning';
  readonly title: string;
  readonly body: string;
};

/** True once the 3rd Adharma is on the board and the game is still open. */
export function isDuryodhanaSenapatiThreatActive(view: WirePlayerView): boolean {
  if (view.phase.kind === 'GAME_OVER') return false;
  return view.enactedAdharma >= 3;
}

function justActivatedDuryodhanaSenapatiThreat(view: WirePlayerView): boolean {
  if (view.enactedAdharma !== 3) return false;
  const tile = view.lastEnactedDecree ?? view.phase.tileType;
  return tile === 'ADHARMA';
}

/** Public court announcement — safe for every seat. */
export function courtAnnouncement(view: WirePlayerView): CourtAnnouncement | null {
  const maharaj = nameOf(view, view.maharajCandidateId);
  const senapati = nameOf(view, view.senapatiCandidateId);
  const exiled = nameOf(view, view.lastExiledPlayerId);

  if (
    view.phase.kind === 'DECREE_CEREMONY' &&
    justActivatedDuryodhanaSenapatiThreat(view)
  ) {
    // #region agent log
    fetch('http://127.0.0.1:7361/ingest/3fd40a7f-41cf-45a6-ac18-e83e0fd4bfa6',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'fd802b'},body:JSON.stringify({sessionId:'fd802b',hypothesisId:'H6',location:'court-announcement.ts:warning',message:'Duryodhana Senapati threat announced on 3rd Adharma',data:{enactedAdharma:view.enactedAdharma,startPlayerCount:view.startPlayerCount,phase:view.phase.kind,lastEnacted:view.lastEnactedDecree},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    return {
      kind: 'duryodhana-senapati-warning',
      title: 'Warning: Duryodhana can now seize the court',
      body: 'The third Adharma Decree is on the board. From this moment, if Duryodhana is elected Senapati, the Kauravas win immediately. This is true at every player count.',
    };
  }

  if (view.phase.kind === 'DISCUSSION_PRE_VOTE') {
    return {
      kind: 'government',
      title: 'Government proposed',
      body: `${maharaj} (Maharaj) has nominated ${senapati} as Senapati. Discuss, then ready up.`,
    };
  }

  if (view.phase.kind === 'ELECTION_NOMINATION') {
    if (view.lastExiledPlayerId) {
      return {
        kind: 'exile',
        title: `${exiled} has been exiled`,
        body: `${exiled} was sent to Vanvas and can no longer vote or be nominated. ${maharaj} is now Maharaj and will choose a Senapati.`,
      };
    }
    return {
      kind: 'nomination',
      title: `${maharaj} is Maharaj`,
      body: `${maharaj} holds the placard and will choose a Senapati.`,
    };
  }

  return null;
}
