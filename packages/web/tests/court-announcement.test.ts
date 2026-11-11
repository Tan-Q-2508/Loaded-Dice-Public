import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, type WirePlayerView } from '@shaatir-shakuni/socket-api';
import { courtAnnouncement } from '../src/lib/court-announcement';

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function baseView(overrides: Partial<WirePlayerView> = {}): WirePlayerView {
  return {
    roomId: '11111111-1111-1111-1111-111111111111',
    viewerId: A,
    stateVersion: 3,
    protocolVersion: PROTOCOL_VERSION,
    phase: { kind: 'ELECTION_NOMINATION' },
    players: [
      { id: A, displayName: 'Arjun', seatOrder: 0, isAlive: true, revealedRole: null },
      { id: B, displayName: 'Bheem', seatOrder: 1, isAlive: true, revealedRole: null },
    ],
    hostPlayerId: A,
    rebalanceEnabled: false,
    ownRole: 'PANDAVA',
    ownTeam: 'PANDAVA',
    knownKauravas: [],
    knownDuryodhanaId: null,
    maharajCandidateId: A,
    senapatiCandidateId: null,
    currentGovernment: null,
    lastElectedGovernment: null,
    enactedDharma: 0,
    enactedAdharma: 3,
    electionTracker: 0,
    vetoUnlocked: false,
    heldTiles: [],
    drawnTilesForMaharaj: [],
    peekedTiles: [],
    ownInvestigations: [],
    votes: null,
    votesRevealed: false,
    startPlayerCount: 5,
    lastEnactedDecree: null,
    decreeDeckCount: 10,
    ashPileCount: 2,
    lastExiledPlayerId: null,
    winner: null,
    winReason: null,
    isSpectator: false,
    afkDeadlineMs: null,
    serverNowMs: 1_000,
    deferredAfkPlayerIds: [],
    ...overrides,
  };
}

describe('courtAnnouncement', () => {
  it('announces the next Maharaj during nomination', () => {
    const a = courtAnnouncement(baseView());
    expect(a?.kind).toBe('nomination');
    expect(a?.title).toMatch(/Arjun is Maharaj/);
    expect(a?.body).toMatch(/choose a Senapati/);
  });

  it('announces exile and the next Maharaj together', () => {
    const a = courtAnnouncement(
      baseView({ lastExiledPlayerId: B }),
    );
    expect(a?.kind).toBe('exile');
    expect(a?.title).toMatch(/Bheem has been exiled/);
    expect(a?.body).toMatch(/Vanvas/);
    expect(a?.body).toMatch(/Arjun is now Maharaj/);
  });

  it('announces the proposed government', () => {
    const a = courtAnnouncement(
      baseView({
        phase: { kind: 'DISCUSSION_PRE_VOTE', pendingDone: [A, B] },
        senapatiCandidateId: B,
      }),
    );
    expect(a?.kind).toBe('government');
    expect(a?.body).toMatch(/Arjun/);
    expect(a?.body).toMatch(/Bheem/);
  });

  it('warns when the third Adharma Decree activates the Senapati threat', () => {
    const a = courtAnnouncement(
      baseView({
        phase: {
          kind: 'DECREE_CEREMONY',
          tileType: 'ADHARMA',
          tileId: 't3',
          followUp: { kind: 'NOMINATION' },
          pendingDone: [A, B],
        },
        lastEnactedDecree: 'ADHARMA',
        enactedAdharma: 3,
        startPlayerCount: 8,
      }),
    );
    expect(a?.kind).toBe('duryodhana-senapati-warning');
    expect(a?.title).toMatch(/Warning/i);
    expect(a?.body).toMatch(/if Duryodhana is elected Senapati/i);
    expect(a?.body).toMatch(/Kauravas win immediately/i);
  });

  it('does not treat game-over as the activation warning', () => {
    const a = courtAnnouncement(
      baseView({
        phase: { kind: 'GAME_OVER', winner: 'KAURAVA', reason: 'DURYODHANA_SENAPATI' },
        senapatiCandidateId: B,
        winner: 'KAURAVA',
        winReason: 'DURYODHANA_SENAPATI',
      }),
    );
    expect(a).toBeNull();
  });
});
