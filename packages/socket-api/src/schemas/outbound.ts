import { z } from 'zod';
import { rejectReasonCodeSchema } from './common.js';
import { PROTOCOL_VERSION } from '../protocol.js';

const roleSchema = z.enum(['PANDAVA', 'KAURAVA', 'DURYODHANA']);
const teamSchema = z.enum(['PANDAVA', 'KAURAVA']);
const voteChoiceSchema = z.enum(['HA', 'NAHI']);
const decreeTypeSchema = z.enum(['DHARMA', 'ADHARMA']);
const winReasonSchema = z.enum([
  'DHARMA_DECREES',
  'ADHARMA_DECREES',
  'DURYODHANA_VANVAS',
  'DURYODHANA_SENAPATI',
  'HOST_FORCE_END',
]);
const rajaagnaPowerSchema = z.enum([
  'DIVYA_DRISHTI',
  'RAJYA_SABHA_SUMMONS',
  'AKASHVANI',
  'VANVAS',
]);

const decreeTileSchema = z.object({
  id: z.string(),
  type: decreeTypeSchema,
});

const governmentPairSchema = z.object({
  maharajId: z.string(),
  senapatiId: z.string(),
});

const investigationResultSchema = z.object({
  targetPlayerId: z.string(),
  team: teamSchema,
});

const publicPlayerViewSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  seatOrder: z.number().int(),
  isAlive: z.boolean(),
  revealedRole: roleSchema.nullable(),
});

const phaseKindSchema = z.enum([
  'LOBBY',
  'ROLE_REVEAL',
  'ELECTION_NOMINATION',
  'DISCUSSION_PRE_VOTE',
  'ELECTION_VOTING',
  'KURUKSHETRA_ANARCHY',
  'LEGISLATION_MAHARAJ',
  'LEGISLATION_SENAPATI',
  'EXECUTIVE_ACTION',
  'DECREE_CEREMONY',
  'GAME_OVER',
  'ROOM_FROZEN',
  'ROOM_CORRUPTED',
]);

const decreeCeremonyFollowUpSchema = z.union([
  z.object({ kind: z.literal('NOMINATION') }),
  z.object({ kind: z.literal('EXECUTIVE'), power: rajaagnaPowerSchema }),
]);

/** Wire phase: tile arrays may be empty for unauthorized viewers. */
export const wirePhaseSchema = z.object({
  kind: phaseKindSchema,
  pendingAcks: z.array(z.string()).optional(),
  pendingDone: z.array(z.string()).optional(),
  votes: z.record(z.string(), z.union([voteChoiceSchema, z.undefined()])).optional(),
  votesRevealed: z.boolean().optional(),
  drawnTiles: z.array(decreeTileSchema).optional(),
  heldTiles: z.array(decreeTileSchema).optional(),
  vetoProposed: z.boolean().optional(),
  vetoVotes: z.record(z.string(), z.union([voteChoiceSchema, z.undefined()])).optional(),
  power: rajaagnaPowerSchema.optional(),
  peekedTiles: z.array(decreeTileSchema).optional(),
  tileType: decreeTypeSchema.optional(),
  tileId: z.string().optional(),
  followUp: decreeCeremonyFollowUpSchema.optional(),
  winner: teamSchema.optional(),
  reason: z.union([winReasonSchema, z.string()]).optional(),
});

export const wirePlayerViewSchema = z.object({
  roomId: z.string(),
  viewerId: z.string(),
  stateVersion: z.number().int().nonnegative(),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  phase: wirePhaseSchema,
  players: z.array(publicPlayerViewSchema),
  /** Authoritative host — required for lobby UI host controls. */
  hostPlayerId: z.string(),
  /** Authoritative rebalance flag — required for lobby UI toggle. */
  rebalanceEnabled: z.boolean(),
  ownRole: roleSchema.nullable(),
  ownTeam: teamSchema.nullable(),
  knownKauravas: z.array(z.string()),
  knownDuryodhanaId: z.string().nullable(),
  maharajCandidateId: z.string(),
  senapatiCandidateId: z.string().nullable(),
  currentGovernment: governmentPairSchema.nullable(),
  /**
   * Most recently elected government still under term limits (Rajya Maryada).
   * Public — see engine `PlayerView.lastElectedGovernment`.
   */
  lastElectedGovernment: governmentPairSchema.nullable(),
  enactedDharma: z.number().int().nonnegative(),
  enactedAdharma: z.number().int().nonnegative(),
  electionTracker: z.number().int().nonnegative(),
  vetoUnlocked: z.boolean(),
  heldTiles: z.array(decreeTileSchema),
  drawnTilesForMaharaj: z.array(decreeTileSchema),
  peekedTiles: z.array(decreeTileSchema),
  ownInvestigations: z.array(investigationResultSchema),
  votes: z.record(z.string(), z.union([voteChoiceSchema, z.undefined()])).nullable(),
  votesRevealed: z.boolean(),
  startPlayerCount: z.number().int().nonnegative(),
  lastEnactedDecree: decreeTypeSchema.nullable(),
  decreeDeckCount: z.number().int().nonnegative(),
  ashPileCount: z.number().int().nonnegative(),
  lastExiledPlayerId: z.string().nullable(),
  winner: teamSchema.nullable(),
  winReason: winReasonSchema.nullable(),
  isSpectator: z.boolean(),
  /**
   * Absolute AFK deadline (server clock ms), or null when no timer window.
   * Display-only on clients (EC-30); server alone decides expiry.
   */
  afkDeadlineMs: z.number().int().nullable(),
  /** Server clock reading at emit time — pair with afkDeadlineMs for display countdown. */
  serverNowMs: z.number().int().nonnegative(),
  /** Seats waiting to auto-act after connected players finish (display-only). */
  deferredAfkPlayerIds: z.array(z.string()),
});

export const stateSyncSchema = z.object({
  view: wirePlayerViewSchema,
  /**
   * Present after successful `session:reconnect` token rotation (EC-13).
   * Clients must persist this and discard the previous token.
   */
  authToken: z.string().min(1).optional(),
});

export const stateUpdateSchema = z.object({
  view: wirePlayerViewSchema,
});

export const actionRejectedSchema = z.object({
  actionUuid: z.string().uuid().optional(),
  code: rejectReasonCodeSchema,
  /** Safe player-facing message — never stack traces or hidden roles. */
  message: z.string(),
});

export const actionDedupedSchema = z.object({
  actionUuid: z.string().uuid(),
});

export const roomFrozenSchema = z.object({
  roomId: z.string(),
  /** Player-facing category only (e.g. "game_cannot_continue"), not invariant names. */
  reasonCategory: z.string(),
  mode: z.enum(['FROZEN', 'CORRUPTED']),
});

export const chatMessageSchema = z.object({
  roomId: z.string(),
  senderPlayerId: z.string(),
  displayName: z.string(),
  text: z.string(),
  sentAt: z.number().int(),
});

export const sessionReadOnlySchema = z.object({
  reason: z.literal('SUPERSEDED_BY_NEWER_CONNECTION'),
});

export const protocolMismatchSchema = z.object({
  clientVersion: z.number().int(),
  serverVersion: z.literal(PROTOCOL_VERSION),
  /** Client must wait for / request a full state:sync. */
  requireStateSync: z.literal(true),
});

export const helloOkSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
});

export const roomCreatedSchema = z.object({
  roomId: z.string().uuid(),
  roomCode: z.string(),
  authToken: z.string(),
  playerId: z.string().uuid(),
});

export const roomJoinedSchema = z.object({
  roomId: z.string().uuid(),
  roomCode: z.string(),
  authToken: z.string(),
  playerId: z.string().uuid(),
});

export const errorSchema = z.object({
  code: rejectReasonCodeSchema,
  message: z.string(),
});

export type WirePlayerView = z.infer<typeof wirePlayerViewSchema>;
export type StateSyncPayload = z.infer<typeof stateSyncSchema>;
export type ActionRejectedPayload = z.infer<typeof actionRejectedSchema>;
export type RoomFrozenPayload = z.infer<typeof roomFrozenSchema>;
export type ProtocolMismatchPayload = z.infer<typeof protocolMismatchSchema>;
