import { describe, expect, it } from 'vitest';
import type { WirePlayerView } from '@shaatir-shakuni/socket-api';
import { PROTOCOL_VERSION } from '@shaatir-shakuni/socket-api';
import { isGameWritable } from '../src/lib/gameplay-enablement';
import {
  isHostForceEnd,
  revealRowsFromPlayers,
  roleLabel,
  teamLabel,
  winReasonLabel,
} from '../src/lib/theme-labels';

function gameOverView(
  overrides: Partial<WirePlayerView> = {},
): WirePlayerView {
  return {
    roomId: '11111111-1111-1111-1111-111111111111',
    viewerId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    stateVersion: 42,
    protocolVersion: PROTOCOL_VERSION,
    phase: {
      kind: 'GAME_OVER',
      winner: 'PANDAVA',
      reason: 'DHARMA_DECREES',
    },
    players: [
      {
        id: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        displayName: 'C',
        seatOrder: 2,
        isAlive: true,
        revealedRole: 'PANDAVA',
      },
      {
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        displayName: 'A',
        seatOrder: 0,
        isAlive: true,
        revealedRole: 'DURYODHANA',
      },
      {
        id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
        displayName: 'B',
        seatOrder: 1,
        isAlive: false,
        revealedRole: 'KAURAVA',
      },
    ],
    hostPlayerId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    rebalanceEnabled: false,
    ownRole: 'DURYODHANA',
    ownTeam: 'KAURAVA',
    knownKauravas: [],
    knownDuryodhanaId: null,
    maharajCandidateId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    senapatiCandidateId: null,
    currentGovernment: null,
    lastElectedGovernment: null,
    enactedDharma: 5,
    enactedAdharma: 2,
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
    winner: 'PANDAVA',
    winReason: 'DHARMA_DECREES',
    isSpectator: false,
    afkDeadlineMs: null,
    serverNowMs: 1_000,
    deferredAfkPlayerIds: [],
    ...overrides,
  };
}

describe('theme-labels', () => {
  it('maps all roles and teams to themed copy', () => {
    expect(roleLabel('PANDAVA')).toBe('Pandava');
    expect(roleLabel('KAURAVA')).toBe('Kaurava');
    expect(roleLabel('DURYODHANA')).toBe('Duryodhana');
    expect(roleLabel(null)).toBe('—');
    expect(teamLabel('PANDAVA')).toBe('Pandavas');
    expect(teamLabel('KAURAVA')).toBe('Kauravas');
  });

  it('maps all five WinReason values', () => {
    expect(winReasonLabel('DHARMA_DECREES')).toMatch(/Dharma/);
    expect(winReasonLabel('ADHARMA_DECREES')).toMatch(/Adharma/);
    expect(winReasonLabel('DURYODHANA_VANVAS')).toMatch(/Vanvas/);
    expect(winReasonLabel('DURYODHANA_SENAPATI')).toMatch(/Senapati/);
    expect(winReasonLabel('HOST_FORCE_END')).toBe('Host ended the game');
    expect(isHostForceEnd('HOST_FORCE_END')).toBe(true);
    expect(isHostForceEnd('DHARMA_DECREES')).toBe(false);
  });

  it('revealRowsFromPlayers sorts by seatOrder', () => {
    const rows = revealRowsFromPlayers(gameOverView().players);
    expect(rows.map((r) => r.displayName)).toEqual(['A', 'B', 'C']);
    expect(rows.map((r) => r.revealedRole)).toEqual([
      'DURYODHANA',
      'KAURAVA',
      'PANDAVA',
    ]);
    expect(rows[1]?.isAlive).toBe(false);
  });
});

describe('GAME_OVER reveal (EC-108 / EC-17 consumption)', () => {
  it('wire fixture exposes all revealed roles for the reveal table', () => {
    const view = gameOverView();
    const rows = revealRowsFromPlayers(view.players);
    expect(rows.every((r) => r.revealedRole !== null)).toBe(true);
    expect(teamLabel(view.winner)).toBe('Pandavas');
    expect(winReasonLabel(view.winReason)).toMatch(/Dharma/);
  });

  it('HOST_FORCE_END is distinct from natural win reasons', () => {
    const view = gameOverView({
      winner: 'KAURAVA',
      winReason: 'HOST_FORCE_END',
      phase: { kind: 'GAME_OVER', winner: 'KAURAVA', reason: 'HOST_FORCE_END' },
    });
    expect(isHostForceEnd(view.winReason)).toBe(true);
    expect(winReasonLabel(view.winReason)).toBe('Host ended the game');
  });

  it('GAME_OVER is not writable — no game-action affordance path', () => {
    const view = gameOverView();
    expect(
      isGameWritable(view, { readOnly: false, roomFrozen: false }),
    ).toBe(false);
  });
});
