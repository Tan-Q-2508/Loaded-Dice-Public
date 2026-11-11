import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION, type WirePlayerView } from '@shaatir-shakuni/socket-api';
import { boardArt } from '../src/lib/board-art';
import {
  DiscussionPanel,
  GameOverPanel,
  LegislationMaharajPanel,
  LegislationSenapatiPanel,
  NominationPanel,
  VotingPanel,
} from '../src/screens/game/PhasePanels';

const A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

function baseView(overrides: Partial<WirePlayerView> = {}): WirePlayerView {
  return {
    roomId: '11111111-1111-1111-1111-111111111111',
    viewerId: A,
    stateVersion: 3,
    protocolVersion: PROTOCOL_VERSION,
    phase: { kind: 'DISCUSSION_PRE_VOTE', pendingDone: [A, B] },
    players: [
      { id: A, displayName: 'A', seatOrder: 0, isAlive: true, revealedRole: null },
      { id: B, displayName: 'B', seatOrder: 1, isAlive: true, revealedRole: null },
      { id: C, displayName: 'C', seatOrder: 2, isAlive: false, revealedRole: null },
    ],
    hostPlayerId: A,
    rebalanceEnabled: false,
    ownRole: 'PANDAVA',
    ownTeam: 'PANDAVA',
    knownKauravas: [],
    knownDuryodhanaId: null,
    maharajCandidateId: A,
    senapatiCandidateId: B,
    currentGovernment: { maharajId: A, senapatiId: B },
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
    serverNowMs: 1_000,
    deferredAfkPlayerIds: [],
    ...overrides,
  };
}

const noopPanel = {
  pending: null,
  onSelect: () => undefined,
  animationBlocksActions: false as const,
};

describe('NominationPanel term limits', () => {
  it('omits last-government seats and still announces to the table', () => {
    const D = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
    const E = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
    const F = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const view = baseView({
      phase: { kind: 'ELECTION_NOMINATION' },
      startPlayerCount: 6,
      players: [
        { id: A, displayName: 'A', seatOrder: 0, isAlive: true, revealedRole: null },
        { id: B, displayName: 'B', seatOrder: 1, isAlive: true, revealedRole: null },
        { id: C, displayName: 'C', seatOrder: 2, isAlive: true, revealedRole: null },
        { id: D, displayName: 'D', seatOrder: 3, isAlive: true, revealedRole: null },
        { id: E, displayName: 'E', seatOrder: 4, isAlive: true, revealedRole: null },
        { id: F, displayName: 'F', seatOrder: 5, isAlive: true, revealedRole: null },
      ],
      maharajCandidateId: C,
      lastElectedGovernment: { maharajId: A, senapatiId: B },
    });
    render(
      <NominationPanel
        view={view}
        playerId={C}
        writable
        onSubmit={vi.fn()}
        {...noopPanel}
      />,
    );
    expect(screen.getByTestId('court-announcement')).toBeInTheDocument();
    expect(screen.queryByTestId(`nominate-${A}`)).toBeNull();
    expect(screen.queryByTestId(`nominate-${B}`)).toBeNull();
    expect(screen.getByTestId(`nominate-${D}`)).toBeInTheDocument();
  });
});

describe('DiscussionPanel Duryodhana Senapati warning', () => {
  it('announces the threat when the third Adharma lands, not at game over', () => {
    const view = baseView({
      phase: {
        kind: 'DECREE_CEREMONY',
        tileType: 'ADHARMA',
        tileId: 't3',
        followUp: { kind: 'NOMINATION' },
        pendingDone: [A, B],
      },
      lastEnactedDecree: 'ADHARMA',
      enactedAdharma: 3,
      startPlayerCount: 6,
    });
    render(
      <DiscussionPanel view={view} playerId={A} writable onSubmit={vi.fn()} {...noopPanel} />,
    );
    expect(screen.getByTestId('duryodhana-senapati-warning')).toHaveTextContent(
      /if Duryodhana is elected Senapati/i,
    );
  });
});

describe('GameOverPanel Play Again', () => {
  it('shows Play Again and does not require a game action', () => {
    const onPlayAgain = vi.fn();
    render(
      <GameOverPanel
        view={baseView({
          phase: { kind: 'GAME_OVER', winner: 'PANDAVA', reason: 'DHARMA_DECREES' },
          winner: 'PANDAVA',
          winReason: 'DHARMA_DECREES',
          players: [
            { id: A, displayName: 'A', seatOrder: 0, isAlive: true, revealedRole: 'PANDAVA' },
            { id: B, displayName: 'B', seatOrder: 1, isAlive: true, revealedRole: 'KAURAVA' },
          ],
        })}
        onPlayAgain={onPlayAgain}
      />,
    );
    fireEvent.click(screen.getByTestId('play-again'));
    expect(onPlayAgain).toHaveBeenCalledTimes(1);
  });
});

describe('DiscussionPanel simultaneous skip', () => {
  it('shows Done discussing for every living pending seat at once', () => {
    const view = baseView();
    const onSubmit = vi.fn();
    const { rerender } = render(
      <DiscussionPanel
        view={view}
        playerId={A}
        writable
        onSubmit={onSubmit}
        {...noopPanel}
      />,
    );
    expect(screen.getByTestId('done-discussing')).toBeEnabled();

    rerender(
      <DiscussionPanel
        view={{ ...view, viewerId: B }}
        playerId={B}
        writable
        onSubmit={onSubmit}
        {...noopPanel}
      />,
    );
    expect(screen.getByTestId('done-discussing')).toBeEnabled();
  });
});

describe('VotingPanel ballot cards', () => {
  it('renders HA and NAHI as card images, not text-only buttons', () => {
    const view = baseView({
      phase: { kind: 'ELECTION_VOTING', votes: {}, votesRevealed: false, pendingDone: [] },
      votes: {},
      votesRevealed: false,
    });
    const onSubmit = vi.fn();
    render(
      <VotingPanel view={view} playerId={A} writable onSubmit={onSubmit} {...noopPanel} />,
    );
    const ha = screen.getByTestId('vote-ha');
    const nahi = screen.getByTestId('vote-nahi');
    expect(ha.querySelector('img')?.getAttribute('src')).toBe(boardArt.voteHa);
    expect(nahi.querySelector('img')?.getAttribute('src')).toBe(boardArt.voteNahi);
    fireEvent.click(ha);
    expect(onSubmit).toHaveBeenCalledWith({ kind: 'vote', value: 'HA' });
  });
});

describe('LegislationMaharajPanel tile images', () => {
  it('shows three decree tile images to discard', () => {
    const tiles = [
      { id: 't1', type: 'DHARMA' as const },
      { id: 't2', type: 'ADHARMA' as const },
      { id: 't3', type: 'DHARMA' as const },
    ];
    const view = baseView({
      phase: { kind: 'LEGISLATION_MAHARAJ', drawnTiles: tiles },
      drawnTilesForMaharaj: tiles,
      currentGovernment: { maharajId: A, senapatiId: B },
    });
    render(
      <LegislationMaharajPanel
        view={view}
        playerId={A}
        writable
        onSubmit={vi.fn()}
        {...noopPanel}
      />,
    );
    expect(screen.getByTestId('tile-t1').querySelector('img')?.getAttribute('src')).toBe(
      boardArt.decreeDharma,
    );
    expect(screen.getByTestId('tile-t2').querySelector('img')?.getAttribute('src')).toBe(
      boardArt.decreeAdharma,
    );
    expect(screen.getByTestId('tile-t3').querySelector('img')).toBeTruthy();
  });
});

describe('LegislationSenapatiPanel tile images', () => {
  it('shows two existing decree tile images to discard', () => {
    const tiles = [
      { id: 's1', type: 'DHARMA' as const },
      { id: 's2', type: 'ADHARMA' as const },
    ];
    const view = baseView({
      phase: { kind: 'LEGISLATION_SENAPATI', heldTiles: tiles, vetoProposed: false },
      heldTiles: tiles,
      currentGovernment: { maharajId: A, senapatiId: B },
    });
    render(
      <LegislationSenapatiPanel
        view={view}
        playerId={B}
        writable
        onSubmit={vi.fn()}
        {...noopPanel}
      />,
    );
    expect(screen.getByTestId('tile-s1').querySelector('img')?.getAttribute('src')).toBe(
      boardArt.decreeDharma,
    );
    expect(screen.getByTestId('tile-s2').querySelector('img')?.getAttribute('src')).toBe(
      boardArt.decreeAdharma,
    );
  });
});
