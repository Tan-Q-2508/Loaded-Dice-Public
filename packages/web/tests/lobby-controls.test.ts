import { beforeEach, describe, expect, it } from 'vitest';
import type { WirePlayerView } from '@shaatir-shakuni/socket-api';
import { PROTOCOL_VERSION } from '@shaatir-shakuni/socket-api';
import {
  selectCanStart,
  selectCanToggleRebalance,
  selectIsHost,
  useGameStore,
} from '../src/store/gameStore';

function baseView(overrides: Partial<WirePlayerView> = {}): WirePlayerView {
  return {
    roomId: '11111111-1111-1111-1111-111111111111',
    viewerId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    stateVersion: 1,
    protocolVersion: PROTOCOL_VERSION,
    phase: { kind: 'LOBBY' },
    players: [
      {
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        displayName: 'Host',
        seatOrder: 0,
        isAlive: true,
        revealedRole: null,
      },
    ],
    hostPlayerId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    rebalanceEnabled: false,
    ownRole: null,
    ownTeam: null,
    knownKauravas: [],
    knownDuryodhanaId: null,
    maharajCandidateId: '',
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
    afkDeadlineMs: null,
    serverNowMs: 0,
    deferredAfkPlayerIds: [],
    ...overrides,
  };
}

function player(id: string, name: string, seat: number) {
  return {
    id,
    displayName: name,
    seatOrder: seat,
    isAlive: true,
    revealedRole: null as null,
  };
}

describe('lobby control selectors', () => {
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

  it('Start is host-only and only when player count is 5–10', () => {
    const hostId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    const four = [0, 1, 2, 3].map((i) =>
      player(
        i === 0 ? hostId : `bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb${i}`,
        `P${i}`,
        i,
      ),
    );
    useGameStore.getState().applyView(baseView({ players: four, hostPlayerId: hostId }));
    expect(selectIsHost(useGameStore.getState())).toBe(true);
    expect(selectCanStart(useGameStore.getState())).toBe(false);

    const five = [
      ...four,
      player('cccccccc-cccc-cccc-cccc-cccccccccccc', 'P4', 4),
    ];
    useGameStore.getState().applyView(baseView({ players: five, hostPlayerId: hostId }));
    expect(selectCanStart(useGameStore.getState())).toBe(true);

    useGameStore.setState({ playerId: 'cccccccc-cccc-cccc-cccc-cccccccccccc' });
    expect(selectIsHost(useGameStore.getState())).toBe(false);
    expect(selectCanStart(useGameStore.getState())).toBe(false);
  });

  it('rebalance toggle only for host in LOBBY', () => {
    const hostId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
    useGameStore.getState().applyView(baseView({ hostPlayerId: hostId }));
    expect(selectCanToggleRebalance(useGameStore.getState())).toBe(true);

    useGameStore.getState().applyView(
      baseView({
        hostPlayerId: hostId,
        phase: { kind: 'ROLE_REVEAL', pendingAcks: [] },
      }),
    );
    expect(selectCanToggleRebalance(useGameStore.getState())).toBe(false);

    useGameStore.getState().applyView(baseView({ hostPlayerId: hostId }));
    useGameStore.setState({ playerId: 'dddddddd-dddd-dddd-dddd-dddddddddddd' });
    expect(selectCanToggleRebalance(useGameStore.getState())).toBe(false);
  });

  it('applyView mirrors server state only', () => {
    const view = baseView({ rebalanceEnabled: true, stateVersion: 4 });
    useGameStore.getState().applyView(view);
    expect(useGameStore.getState().view?.rebalanceEnabled).toBe(true);
    expect(useGameStore.getState().view?.stateVersion).toBe(4);
    expect(useGameStore.getState().view?.hostPlayerId).toBe(view.hostPlayerId);
  });
});
