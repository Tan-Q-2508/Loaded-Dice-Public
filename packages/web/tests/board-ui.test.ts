import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION, type WirePlayerView } from '@shaatir-shakuni/socket-api';
import {
  adharmaEmptySlotArt,
  boardArt,
  dharmaEmptySlotArt,
  roleCardArt,
} from '../src/lib/board-art';
import { isCeremonyPhase, phaseNarration } from '../src/lib/phase-banner-copy';
import { adharmaPowerTrack, powerSlotLabel } from '../src/lib/power-track-display';
import { roleSetupFooter } from '../src/lib/role-setup-copy';
import { ringSideCounts, splitSeatsAroundBoard } from '../src/lib/seat-ring';
import { powerLabel } from '../src/lib/theme-labels';

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
    ],
    hostPlayerId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    rebalanceEnabled: false,
    ownRole: 'PANDAVA',
    ownTeam: 'PANDAVA',
    knownKauravas: [],
    knownDuryodhanaId: null,
    maharajCandidateId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    senapatiCandidateId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    currentGovernment: null,
    lastElectedGovernment: null,
    enactedDharma: 2,
    enactedAdharma: 1,
    electionTracker: 1,
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

describe('board display helpers', () => {
  it('uses startPlayerCount for thematic Adharma power labels', () => {
    expect(powerSlotLabel(adharmaPowerTrack(5)[2]!)).toBe('Akashvani');
    expect(powerSlotLabel(adharmaPowerTrack(5)[3]!)).toBe('Vanvas');
    expect(powerSlotLabel(adharmaPowerTrack(7)[1]!)).toBe('Divya Drishti');
    expect(powerSlotLabel(adharmaPowerTrack(7)[2]!)).toBe('Rajya Sabha Summons');
    expect(powerSlotLabel(adharmaPowerTrack(7)[3]!)).toBe('Vanvas');
    expect(powerSlotLabel(adharmaPowerTrack(7)[4]!)).toBe('Vanvas');
    expect(powerSlotLabel(adharmaPowerTrack(9)[0]!)).toBe('Divya Drishti');
    expect(powerLabel('AKASHVANI')).toBe('Akashvani');
  });

  it('maps empty slot plates by power and position', () => {
    const track7 = adharmaPowerTrack(7);
    expect(adharmaEmptySlotArt(0, track7[0]!)).toBe(boardArt.slotEmpty);
    expect(adharmaEmptySlotArt(1, track7[1]!)).toBe(boardArt.slotDivyaDrishti);
    expect(adharmaEmptySlotArt(2, track7[2]!)).toBe(boardArt.slotRajyaSabhaSummons);
    expect(adharmaEmptySlotArt(3, track7[3]!)).toBe(boardArt.slotVanvas);
    expect(adharmaEmptySlotArt(4, track7[4]!)).toBe(boardArt.slotVanvasDice);
    expect(adharmaEmptySlotArt(5, null)).toBe(boardArt.slotAdharmaWin);
    expect(dharmaEmptySlotArt(3)).toBe(boardArt.slotEmpty);
    expect(dharmaEmptySlotArt(4)).toBe(boardArt.slotDharmaWin);
    expect(roleCardArt('DURYODHANA')).toBe(boardArt.roleDuryodhana);
  });

  it('prints player-count knowledge footer from the spec table', () => {
    expect(roleSetupFooter(7)).toMatch(/Duryodhana does not know/i);
    expect(roleSetupFooter(7)).toMatch(/Kauravas know Duryodhana/i);
    expect(roleSetupFooter(5)).toMatch(/Duryodhana knows the Kaurava/i);
  });

  it('narrates public legislation without leaking tile types', () => {
    const view = baseView({
      phase: { kind: 'LEGISLATION_MAHARAJ', drawnTiles: [] },
      currentGovernment: {
        maharajId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
        senapatiId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      },
    });
    const text = phaseNarration(view);
    expect(text).toContain('Maharaj');
    expect(text.toLowerCase()).toContain('privately');
    expect(text).not.toMatch(/DHARMA|ADHARMA/);
  });

  it('cues discussion during nomination and voting', () => {
    const nom = phaseNarration(baseView({ phase: { kind: 'ELECTION_NOMINATION' } }));
    expect(nom.toLowerCase()).toContain('discuss');
    const vote = phaseNarration(
      baseView({
        phase: { kind: 'ELECTION_VOTING', votes: {}, votesRevealed: false, pendingDone: [] },
        votesRevealed: false,
      }),
    );
    expect(vote.toLowerCase()).toMatch(/election|ha|nahi/);
  });

  it('warns on the third Adharma that Duryodhana as Senapati now wins', () => {
    const text = phaseNarration(
      baseView({
        phase: {
          kind: 'DECREE_CEREMONY',
          tileType: 'ADHARMA',
          tileId: 't3',
          followUp: { kind: 'NOMINATION' },
          pendingDone: [],
        },
        lastEnactedDecree: 'ADHARMA',
        enactedAdharma: 3,
      }),
    );
    expect(text.toLowerCase()).toMatch(/duryodhana/);
    expect(text.toLowerCase()).toMatch(/senapati/);
    expect(text.toLowerCase()).toMatch(/warning|win/);
  });

  it('treats vote reveal and decree ceremony as ceremony phases', () => {
    expect(
      isCeremonyPhase(
        baseView({
          phase: {
            kind: 'ELECTION_VOTING',
            votes: { 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa': 'HA' },
            votesRevealed: true,
            pendingDone: [],
          },
          votesRevealed: true,
        }),
      ),
    ).toBe(true);
    expect(
      isCeremonyPhase(
        baseView({
          phase: {
            kind: 'DECREE_CEREMONY',
            tileType: 'DHARMA',
            tileId: 't1',
            followUp: { kind: 'NOMINATION' },
            pendingDone: [],
          },
          lastEnactedDecree: 'DHARMA',
        }),
      ),
    ).toBe(true);
  });
});

describe('seat ring around the board', () => {
  it('puts extra seats on the taller left and right edges', () => {
    expect(ringSideCounts(5)).toEqual({ top: 1, right: 2, bottom: 1, left: 1 });
    expect(ringSideCounts(6)).toEqual({ top: 1, right: 2, bottom: 1, left: 2 });
    expect(ringSideCounts(7)).toEqual({ top: 2, right: 2, bottom: 1, left: 2 });
    expect(ringSideCounts(8)).toEqual({ top: 2, right: 2, bottom: 2, left: 2 });
    expect(ringSideCounts(9)).toEqual({ top: 2, right: 3, bottom: 2, left: 2 });
    expect(ringSideCounts(10)).toEqual({ top: 2, right: 3, bottom: 2, left: 3 });
  });

  it('walks clockwise and flips bottom/left for on-screen order', () => {
    const seats = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j'];
    const ring = splitSeatsAroundBoard(seats);
    expect(ring.top).toEqual(['a', 'b']);
    expect(ring.right).toEqual(['c', 'd', 'e']);
    expect(ring.bottom).toEqual(['g', 'f']);
    expect(ring.left).toEqual(['j', 'i', 'h']);
    expect(
      [...ring.top, ...ring.right, ...[...ring.bottom].reverse(), ...[...ring.left].reverse()],
    ).toEqual(seats);
  });
});
