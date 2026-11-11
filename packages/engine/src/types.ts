/** Short codes per 00-MASTER-SPEC.md Section 2 */
export type Team = 'PANDAVA' | 'KAURAVA';
export type Role = 'PANDAVA' | 'KAURAVA' | 'DURYODHANA';
export type DecreeType = 'DHARMA' | 'ADHARMA';
export type VoteChoice = 'HA' | 'NAHI';
export type RajaagnaPower =
  | 'DIVYA_DRISHTI'
  | 'RAJYA_SABHA_SUMMONS'
  | 'AKASHVANI'
  | 'VANVAS';

export type WinReason =
  | 'DHARMA_DECREES'
  | 'ADHARMA_DECREES'
  | 'DURYODHANA_VANVAS'
  | 'DURYODHANA_SENAPATI'
  | 'HOST_FORCE_END';

export type FailureMode = 'ROOM_FROZEN' | 'ROOM_CORRUPTED';

export interface DecreeTile {
  readonly id: string;
  readonly type: DecreeType;
}

export interface Player {
  readonly id: string;
  readonly displayName: string;
  readonly seatOrder: number;
  readonly role: Role | null;
  readonly isAlive: boolean;
}

export interface GovernmentPair {
  readonly maharajId: string;
  readonly senapatiId: string;
}

export type Phase =
  | { readonly kind: 'LOBBY' }
  | { readonly kind: 'ROLE_REVEAL'; readonly pendingAcks: readonly string[] }
  | { readonly kind: 'ELECTION_NOMINATION' }
  | {
      /** Table discussion after Senapati is nominated, before ballots open. */
      readonly kind: 'DISCUSSION_PRE_VOTE';
      readonly pendingDone: readonly string[];
    }
  | {
      readonly kind: 'ELECTION_VOTING';
      readonly votes: Readonly<Record<string, VoteChoice | undefined>>;
      readonly votesRevealed: boolean;
      /**
       * Living seats that have not yet ready-up'd during the vote-reveal hold.
       * Empty / unused while `votesRevealed` is false.
       */
      readonly pendingDone: readonly string[];
    }
  | { readonly kind: 'KURUKSHETRA_ANARCHY' }
  | { readonly kind: 'LEGISLATION_MAHARAJ'; readonly drawnTiles: readonly DecreeTile[] }
  | {
      readonly kind: 'LEGISLATION_SENAPATI';
      /** Always length 2 in authoritative state; may be empty in filtered player views. */
      readonly heldTiles: readonly DecreeTile[];
      readonly vetoProposed: boolean;
      readonly vetoVotes: Readonly<Record<string, VoteChoice | undefined>>;
    }
  | {
      readonly kind: 'EXECUTIVE_ACTION';
      readonly power: RajaagnaPower;
      readonly peekedTiles?: readonly DecreeTile[];
    }
  | {
      /**
       * Public table hold after a decree is enacted — tracks show the new tile
       * before nomination / executive continues.
       */
      readonly kind: 'DECREE_CEREMONY';
      readonly tileType: DecreeType;
      readonly tileId: string;
      readonly followUp:
        | { readonly kind: 'NOMINATION' }
        | { readonly kind: 'EXECUTIVE'; readonly power: RajaagnaPower };
      /** Living seats that have not yet ready-up'd during the decree hold. */
      readonly pendingDone: readonly string[];
    }
  | {
      readonly kind: 'GAME_OVER';
      readonly winner: Team;
      readonly reason: WinReason;
    }
  | { readonly kind: 'ROOM_FROZEN'; readonly reason: string }
  | { readonly kind: 'ROOM_CORRUPTED'; readonly reason: string };

export interface InvestigationResult {
  readonly targetPlayerId: string;
  readonly team: Team;
}

export interface GameState {
  readonly roomId: string;
  readonly hostPlayerId: string;
  readonly rebalanceEnabled: boolean;
  readonly startPlayerCount: number;
  readonly players: readonly Player[];
  readonly phase: Phase;
  readonly decreeDeck: readonly DecreeTile[];
  readonly ashPile: readonly DecreeTile[];
  readonly enactedDharma: number;
  readonly enactedAdharma: number;
  readonly electionTracker: number;
  readonly maharajCandidateId: string;
  readonly senapatiCandidateId: string | null;
  readonly currentGovernment: GovernmentPair | null;
  readonly lastElectedGovernment: GovernmentPair | null;
  readonly investigatedPlayerIds: readonly string[];
  readonly summonsReturnAfterPlayerId: string | null;
  readonly privateInvestigations: Readonly<Record<string, readonly InvestigationResult[]>>;
  /** Most recent Vanvas target; null until the first exile this game. */
  readonly lastExiledPlayerId: string | null;
  readonly seed: number;
  readonly stateVersion: number;
  readonly expectedTileCount: number;
}

export type GameAction =
  | {
      readonly type: 'START_GAME';
      readonly playerIds: readonly string[];
      readonly displayNames: Readonly<Record<string, string>>;
      readonly hostPlayerId: string;
      readonly rebalanceEnabled: boolean;
      readonly seed: number;
    }
  | { readonly type: 'ACK_ROLE_REVEAL'; readonly playerId: string }
  | { readonly type: 'ROLE_REVEAL_TIMEOUT' }
  | { readonly type: 'NOMINATE_SENAPATI'; readonly maharajId: string; readonly nomineeId: string }
  /** Player ready-up during discussion / vote-reveal / decree ceremony holds. */
  | { readonly type: 'DONE_DISCUSSING'; readonly playerId: string }
  /** System — force-end DISCUSSION_PRE_VOTE when the hard deadline hits. */
  | { readonly type: 'DISCUSSION_PRE_VOTE_TIMEOUT' }
  | { readonly type: 'CAST_VOTE'; readonly playerId: string; readonly vote: VoteChoice }
  | { readonly type: 'CAST_DEFAULT_VOTES' }
  /** System — advance after vote-reveal ceremony hold. */
  | { readonly type: 'RESOLVE_ELECTION' }
  | { readonly type: 'DISCARD_MAHARAJ_TILE'; readonly maharajId: string; readonly tileId: string }
  | { readonly type: 'PROPOSE_VETO'; readonly senapatiId: string }
  | { readonly type: 'CAST_VETO_VOTE'; readonly playerId: string; readonly vote: VoteChoice }
  | {
      readonly type: 'DISCARD_SENAPATI_TILE';
      readonly senapatiId: string;
      readonly tileId: string;
    }
  | { readonly type: 'EXEC_DIVYA_DRISHTI'; readonly maharajId: string; readonly targetId: string }
  | { readonly type: 'EXEC_RAJYA_SABHA_SUMMONS'; readonly maharajId: string; readonly targetId: string }
  | { readonly type: 'EXEC_AKASHVANI_ACK'; readonly maharajId: string }
  | { readonly type: 'EXEC_VANVAS'; readonly maharajId: string; readonly targetId: string }
  /** System — advance after decree-enactment ceremony hold. */
  | { readonly type: 'ADVANCE_AFTER_DECREE' }
  | { readonly type: 'FORCE_END_GAME'; readonly hostPlayerId: string; readonly winner: Team };

export type GameEvent =
  | { readonly type: 'ACTION_REJECTED'; readonly actionType: string; readonly reason: string }
  | { readonly type: 'GAME_STARTED'; readonly seed: number; readonly startPlayerCount: number }
  | { readonly type: 'ROLE_ASSIGNED'; readonly playerId: string; readonly role: Role }
  | { readonly type: 'PHASE_CHANGED'; readonly from: Phase['kind']; readonly to: Phase['kind'] }
  | { readonly type: 'MAHARAJ_CANDIDATE_SET'; readonly playerId: string }
  | { readonly type: 'SENAPATI_NOMINATED'; readonly nomineeId: string }
  | { readonly type: 'VOTE_CAST'; readonly playerId: string; readonly vote: VoteChoice }
  | { readonly type: 'VOTES_REVEALED'; readonly votes: Readonly<Record<string, VoteChoice>> }
  | { readonly type: 'GOVERNMENT_REJECTED'; readonly electionTracker: number }
  | { readonly type: 'GOVERNMENT_ACCEPTED'; readonly maharajId: string; readonly senapatiId: string }
  | { readonly type: 'KURUKSHETRA_ANARCHY'; readonly enactedTileId: string; readonly tileType: DecreeType }
  | { readonly type: 'DECK_RESHUFFLED' }
  | { readonly type: 'TILE_DISCARDED'; readonly tileId: string; readonly by: 'MAHARAJ' | 'SENAPATI' | 'VETO' }
  | { readonly type: 'DECREE_ENACTED'; readonly tileId: string; readonly tileType: DecreeType; readonly dharmaCount: number; readonly adharmaCount: number }
  | { readonly type: 'VETO_PROPOSED' }
  | { readonly type: 'VETO_RESOLVED'; readonly accepted: boolean }
  | { readonly type: 'POWER_GRANTED'; readonly power: RajaagnaPower }
  | { readonly type: 'INVESTIGATION_RESULT'; readonly maharajId: string; readonly targetId: string; readonly team: Team }
  | { readonly type: 'SUMMONS_CALLED'; readonly targetId: string; readonly returnAfterPlayerId: string }
  | { readonly type: 'AKASHVANI_PEEK'; readonly maharajId: string; readonly tileIds: readonly string[] }
  | { readonly type: 'PLAYER_EXILED'; readonly playerId: string }
  | { readonly type: 'WIN_CONDITION_MET'; readonly winner: Team; readonly reason: WinReason }
  | { readonly type: 'ROOM_FAILURE'; readonly mode: FailureMode; readonly reason: string }
  | { readonly type: 'TERM_LIMITS_CLEARED' };

export interface EngineDeps {
  readonly rng: Rng;
  readonly clock: Clock;
  readonly powerTable: PowerTable;
  readonly enforceImmutability?: boolean;
}

export interface Rng {
  next(): number;
  shuffle<T>(items: readonly T[]): T[];
  pickOne<T>(items: readonly T[]): T;
}

export interface Clock {
  now(): number;
}

export interface PowerTable {
  getPower(startPlayerCount: number, adharmaSlot: number): RajaagnaPower | null;
}

export interface ApplyResult {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}

export interface PlayerView {
  readonly roomId: string;
  readonly viewerId: string;
  readonly phase: Phase;
  readonly players: readonly PublicPlayerView[];
  readonly hostPlayerId: string;
  readonly rebalanceEnabled: boolean;
  readonly ownRole: Role | null;
  readonly ownTeam: Team | null;
  /** Other Kaurava teammates only — excludes Duryodhana (see knownDuryodhanaId). */
  readonly knownKauravas: readonly string[];
  /**
   * Private: Duryodhana’s player id when the viewer is allowed to know them
   * (Kaurava always; Duryodhana = self). Null for Pandavas / spectators.
   */
  readonly knownDuryodhanaId: string | null;
  readonly maharajCandidateId: string;
  readonly senapatiCandidateId: string | null;
  readonly currentGovernment: GovernmentPair | null;
  /**
   * Most recently *elected* government still under Rajya Maryada (term limits).
   * Public information — differs from `currentGovernment`, which is cleared once
   * that government's legislative session ends. Null when no term limits apply
   * (game start, or after Kurukshetra anarchy / tracker clear).
   */
  readonly lastElectedGovernment: GovernmentPair | null;
  readonly enactedDharma: number;
  readonly enactedAdharma: number;
  readonly electionTracker: number;
  readonly vetoUnlocked: boolean;
  readonly heldTiles: readonly DecreeTile[];
  readonly drawnTilesForMaharaj: readonly DecreeTile[];
  readonly peekedTiles: readonly DecreeTile[];
  readonly ownInvestigations: readonly InvestigationResult[];
  readonly votes: Readonly<Record<string, VoteChoice | undefined>> | null;
  readonly votesRevealed: boolean;
  /** Game-start seat count — public; drives Adharma power-track icons. */
  readonly startPlayerCount: number;
  /**
   * Face-up decree just placed on a track during `DECREE_CEREMONY`, else null.
   * Public theater only — never a private discard.
   */
  readonly lastEnactedDecree: DecreeType | null;
  /** Public deck size — never tile contents. */
  readonly decreeDeckCount: number;
  /** Public ash pile size — never tile contents. */
  readonly ashPileCount: number;
  readonly lastExiledPlayerId: string | null;
  readonly winner: Team | null;
  readonly winReason: WinReason | null;
  readonly isSpectator: boolean;
}

export interface PublicPlayerView {
  readonly id: string;
  readonly displayName: string;
  readonly seatOrder: number;
  readonly isAlive: boolean;
  readonly revealedRole: Role | null;
}

export const ROLE_COUNTS: Readonly<
  Record<number, { pandavas: number; kauravas: number; duryodhanaKnowsKauravas: boolean }>
> = {
  5: { pandavas: 3, kauravas: 1, duryodhanaKnowsKauravas: true },
  6: { pandavas: 4, kauravas: 1, duryodhanaKnowsKauravas: true },
  7: { pandavas: 4, kauravas: 2, duryodhanaKnowsKauravas: false },
  8: { pandavas: 5, kauravas: 2, duryodhanaKnowsKauravas: false },
  9: { pandavas: 5, kauravas: 3, duryodhanaKnowsKauravas: false },
  10: { pandavas: 6, kauravas: 3, duryodhanaKnowsKauravas: false },
};

export function teamForRole(role: Role): Team {
  return role === 'PANDAVA' ? 'PANDAVA' : 'KAURAVA';
}

export function isTerminalPhase(phase: Phase): boolean {
  return (
    phase.kind === 'GAME_OVER' ||
    phase.kind === 'ROOM_FROZEN' ||
    phase.kind === 'ROOM_CORRUPTED'
  );
}
