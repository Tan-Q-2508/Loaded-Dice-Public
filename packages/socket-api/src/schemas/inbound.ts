import { z } from 'zod';
import { inboundEnvelopeSchema } from './common.js';

const voteChoiceSchema = z.enum(['HA', 'NAHI']);
const teamSchema = z.enum(['PANDAVA', 'KAURAVA']);

export const clientHelloSchema = z.object({
  protocolVersion: z.number().int().positive(),
});

export const roomCreateSchema = inboundEnvelopeSchema.extend({
  payload: z.object({
    displayName: z.string().min(1).max(32),
    rebalanceEnabled: z.boolean().optional(),
  }),
});

export const roomJoinSchema = inboundEnvelopeSchema.extend({
  payload: z.object({
    roomCode: z.string().min(1).max(16),
    displayName: z.string().min(1).max(32),
  }),
});

export const roomLeaveSchema = inboundEnvelopeSchema.extend({
  payload: z.object({
    roomId: z.string().uuid(),
  }),
});

export const roomStartSchema = inboundEnvelopeSchema.extend({
  payload: z.object({
    roomId: z.string().uuid(),
  }),
});

export const roomSetRebalanceSchema = inboundEnvelopeSchema.extend({
  payload: z.object({
    roomId: z.string().uuid(),
    rebalanceEnabled: z.boolean(),
  }),
});

export const roomPlayAgainSchema = inboundEnvelopeSchema.extend({
  payload: z.object({
    roomId: z.string().uuid(),
  }),
});

export const sessionReconnectSchema = inboundEnvelopeSchema.extend({
  payload: z.object({
    authToken: z.string().min(1),
  }),
});

/**
 * Game intents map 1:1 to engine `GameAction` types (minus START_GAME, which is
 * triggered by room:start after lobby validation).
 */
export const gameActionPayloadSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ACK_ROLE_REVEAL') }),
  z.object({
    type: z.literal('NOMINATE_SENAPATI'),
    nomineeId: z.string().min(1),
  }),
  z.object({ type: z.literal('DONE_DISCUSSING') }),
  z.object({
    type: z.literal('CAST_VOTE'),
    vote: voteChoiceSchema,
  }),
  z.object({
    type: z.literal('DISCARD_MAHARAJ_TILE'),
    tileId: z.string().min(1),
  }),
  z.object({ type: z.literal('PROPOSE_VETO') }),
  z.object({
    type: z.literal('CAST_VETO_VOTE'),
    vote: voteChoiceSchema,
  }),
  z.object({
    type: z.literal('DISCARD_SENAPATI_TILE'),
    tileId: z.string().min(1),
  }),
  z.object({
    type: z.literal('EXEC_DIVYA_DRISHTI'),
    targetId: z.string().min(1),
  }),
  z.object({
    type: z.literal('EXEC_RAJYA_SABHA_SUMMONS'),
    targetId: z.string().min(1),
  }),
  z.object({ type: z.literal('EXEC_AKASHVANI_ACK') }),
  z.object({
    type: z.literal('EXEC_VANVAS'),
    targetId: z.string().min(1),
  }),
  z.object({
    type: z.literal('FORCE_END_GAME'),
    winner: teamSchema,
  }),
]);

export const gameActionSchema = inboundEnvelopeSchema.extend({
  payload: gameActionPayloadSchema,
});

export const chatSendSchema = inboundEnvelopeSchema.extend({
  payload: z.object({
    roomId: z.string().uuid(),
    text: z.string().min(1).max(500),
  }),
});

export type ClientHello = z.infer<typeof clientHelloSchema>;
export type RoomCreateMessage = z.infer<typeof roomCreateSchema>;
export type RoomJoinMessage = z.infer<typeof roomJoinSchema>;
export type RoomLeaveMessage = z.infer<typeof roomLeaveSchema>;
export type RoomStartMessage = z.infer<typeof roomStartSchema>;
export type RoomSetRebalanceMessage = z.infer<typeof roomSetRebalanceSchema>;
export type RoomPlayAgainMessage = z.infer<typeof roomPlayAgainSchema>;
export type SessionReconnectMessage = z.infer<typeof sessionReconnectSchema>;
export type GameActionMessage = z.infer<typeof gameActionSchema>;
export type GameActionPayload = z.infer<typeof gameActionPayloadSchema>;
export type ChatSendMessage = z.infer<typeof chatSendSchema>;
