import { beforeEach, describe, expect, it } from 'vitest';
import type { WirePlayerView } from '@shaatir-shakuni/socket-api';
import { PROTOCOL_VERSION } from '@shaatir-shakuni/socket-api';
import {
  canCastVote,
  canDoneDiscussing,
  canNominate,
  eligibleNominees,
  isGameWritable,
  livingOtherPlayers,
  livingPendingDoneIds,
  payloadForPending,
  termLimitedNomineeIds,
} from '../src/lib/gameplay-enablement';
import { useGameStore } from '../src/store/gameStore';

function baseView(overrides: Partial<WirePlayerView> = {}): WirePlayerView {
  return {
    roomId: '11111111-1111-1111-1111-111111111111',
    viewerId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    stateVersion: 3,
    protocolVersion: PROTOCOL_VERSION,
    phase: { kind: 'ELECTION_NOMINATION' },
    players: [
      {
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        displayName: 'A',
        seatOrder: 0,
        isAlive: true,
        revealedRole: null,
      },
      {
        id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        displayName: 'B',
        seatOrder: 1,
        isAlive: true,
        revealedRole: null,
      },
      {
        id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        displayName: 'C',
        seatOrder: 2,
        isAlive: false,
        revealedRole: null,
      },
    ],
    hostPlayerId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    rebalanceEnabled: false,
    ownRole: 'PANDAVA',
    ownTeam: 'PANDAVA',
    knownKauravas: [],
    knownDuryodhanaId: null,
    maharajCandidateId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    senapatiCandidateId: null,
    currentGovernment: null,
    lastElectedGovernment: null,
    enactedDharma: 0,
    enactedAdharma: 0,
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
    decreeDeckCount: 17,
    ashPileCount: 0,
    lastExiledPlayerId: null,
    winner: null,
    winReason: null,
    isSpectator: false,
    afkDeadlineMs: 60_000,
    serverNowMs: 1_000,
    deferredAfkPlayerIds: [],
    ...overrides,
  };
}

describe('gameplay enablement (term limits from wire lastElectedGovernment)', () => {
  it('nomination offers living others when no last government', () => {
    const view = baseView();
    const playerId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    expect(canNominate(view, playerId)).toBe(true);
    const others = livingOtherPlayers(view, playerId);
    expect(others.map((p) => p.id)).toEqual([
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    ]);
    expect(eligibleNominees(view, playerId).map((p) => p.id)).toEqual([
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    ]);
  });

  it('6 living: both last-government seats are term-limited', () => {
    const ids = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444',
      '55555555-5555-4555-8555-555555555555',
      '66666666-6666-4666-8666-666666666666',
    ];
    const players = ids.map((id, seatOrder) => ({
      id,
      displayName: String.fromCharCode(65 + seatOrder),
      seatOrder,
      isAlive: true,
      revealedRole: null,
    }));
    const view = baseView({
      players,
      maharajCandidateId: ids[2]!,
      lastElectedGovernment: { maharajId: ids[0]!, senapatiId: ids[1]! },
      startPlayerCount: 6,
    });
    const limited = termLimitedNomineeIds(view);
    expect([...limited].sort()).toEqual([ids[0], ids[1]].sort());
    expect(eligibleNominees(view, ids[2]!).map((p) => p.id)).not.toContain(ids[0]);
    expect(eligibleNominees(view, ids[2]!).map((p) => p.id)).not.toContain(ids[1]);
  });

  it('5 living: only last Senapati is term-limited', () => {
    const view = baseView({
      lastElectedGovernment: {
        maharajId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        senapatiId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      },
      players: [
        {
          id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
          displayName: 'A',
          seatOrder: 0,
          isAlive: true,
          revealedRole: null,
        },
        {
          id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
          displayName: 'B',
          seatOrder: 1,
          isAlive: true,
          revealedRole: null,
        },
        {
          id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
          displayName: 'C',
          seatOrder: 2,
          isAlive: true,
          revealedRole: null,
        },
        {
          id: 'dddddddd-dddd-dddd-dddd-dddddddddddd',
          displayName: 'D',
          seatOrder: 3,
          isAlive: true,
          revealedRole: null,
        },
        {
          id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
          displayName: 'E',
          seatOrder: 4,
          isAlive: true,
          revealedRole: null,
        },
      ],
      maharajCandidateId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      startPlayerCount: 5,
    });
    expect([...termLimitedNomineeIds(view)]).toEqual([
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    ]);
    const eligible = eligibleNominees(view, 'cccccccc-cccc-cccc-cccc-cccccccccccc').map(
      (p) => p.id,
    );
    expect(eligible).toContain('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    expect(eligible).not.toContain('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  });

  it('vote enablement uses wire revealed/own ballot flags only', () => {
    const view = baseView({
      phase: { kind: 'ELECTION_VOTING', votes: {}, votesRevealed: false, pendingDone: [] },
      votes: {},
      votesRevealed: false,
    });
    expect(canCastVote(view, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')).toBe(true);
    expect(
      canCastVote(
        baseView({
          phase: { kind: 'ELECTION_VOTING', votes: {}, votesRevealed: true, pendingDone: [] },
          votesRevealed: true,
        }),
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      ),
    ).toBe(false);
  });

  it('frozen / read-only / spectator are not writable', () => {
    const view = baseView();
    expect(isGameWritable(view, { readOnly: true, roomFrozen: false })).toBe(false);
    expect(isGameWritable(view, { readOnly: false, roomFrozen: true })).toBe(false);
    expect(
      isGameWritable(baseView({ isSpectator: true }), {
        readOnly: false,
        roomFrozen: false,
      }),
    ).toBe(false);
  });

  it('canDoneDiscussing is true for every pending living player at once', () => {
    const pendingDone = [
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    ];
    const view = baseView({
      phase: { kind: 'DISCUSSION_PRE_VOTE', pendingDone },
    });
    expect(livingPendingDoneIds(view)).toEqual(pendingDone);
    expect(canDoneDiscussing(view, pendingDone[0]!)).toBe(true);
    expect(canDoneDiscussing(view, pendingDone[1]!)).toBe(true);
    expect(canDoneDiscussing(view, 'cccccccc-cccc-cccc-cccc-cccccccccccc')).toBe(
      false,
    );
    const revealView = baseView({
      phase: {
        kind: 'ELECTION_VOTING',
        votes: {},
        votesRevealed: true,
        pendingDone,
      },
      votesRevealed: true,
    });
    expect(canDoneDiscussing(revealView, pendingDone[0]!)).toBe(true);
    expect(canDoneDiscussing(revealView, pendingDone[1]!)).toBe(true);
  });

  it('maps pending selection to game action payloads', () => {
    expect(payloadForPending('ack', 'ack', baseView())).toEqual({
      type: 'ACK_ROLE_REVEAL',
    });
    expect(
      payloadForPending(
        'nominee',
        'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        baseView(),
      ),
    ).toEqual({
      type: 'NOMINATE_SENAPATI',
      nomineeId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    });
  });
});

describe('EC-86 pending selection survives across view-compatible updates', () => {
  beforeEach(() => {
    useGameStore.setState({
      connectionPhase: 'ready',
      connectionMessage: null,
      authToken: 'tok',
      playerId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      roomId: '11111111-1111-1111-1111-111111111111',
      roomCode: 'ABC123',
      view: null,
      nextSequence: 1,
      lastError: null,
      readOnly: false,
      roomFrozen: null,
      pendingSelection: null,
      animationEpoch: 0,
      timerSyncedAtClientMs: null,
    });
  });

  it('keeps pre-submit selection when phase+version unchanged (orientation remount)', () => {
    const view = baseView();
    useGameStore.getState().applyView(view);
    useGameStore.getState().setPendingSelection({
      phaseKind: 'ELECTION_NOMINATION',
      stateVersion: 3,
      kind: 'nominee',
      value: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    });
    // Same authoritative version — e.g. soft remount / orientation without new sync
    useGameStore.getState().applyView({ ...view });
    expect(useGameStore.getState().pendingSelection?.value).toBe(
      'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    );
  });

  it('clears selection when stateVersion advances (EC-87 epoch bump)', () => {
    const view = baseView();
    useGameStore.getState().applyView(view);
    useGameStore.getState().setPendingSelection({
      phaseKind: 'ELECTION_NOMINATION',
      stateVersion: 3,
      kind: 'nominee',
      value: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    });
    const epochBefore = useGameStore.getState().animationEpoch;
    useGameStore.getState().applyView({ ...view, stateVersion: 4 });
    expect(useGameStore.getState().pendingSelection).toBeNull();
    expect(useGameStore.getState().animationEpoch).toBe(epochBefore + 1);
  });
});
