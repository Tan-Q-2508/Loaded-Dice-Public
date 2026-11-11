import { z } from 'zod';
import { PROTOCOL_VERSION } from '../protocol.js';

export const actionUuidSchema = z.string().uuid();

export const sequenceSchema = z.number().int().nonnegative();

export const stateVersionSchema = z.number().int().nonnegative();

export const protocolVersionSchema = z.number().int().positive();

/** Envelope fields required on every inbound actionable event. */
export const inboundEnvelopeSchema = z.object({
  protocolVersion: protocolVersionSchema,
  actionUuid: actionUuidSchema,
  sequence: sequenceSchema,
  stateVersion: stateVersionSchema,
});

export type InboundEnvelope = z.infer<typeof inboundEnvelopeSchema>;

export const rejectReasonCodeSchema = z.enum([
  'VALIDATION_FAILED',
  'PROTOCOL_MISMATCH',
  'SEQUENCE_REJECTED',
  'STATE_VERSION_MISMATCH',
  'DUPLICATE_ACTION',
  'CHAT_FORBIDDEN',
  'UNAUTHORIZED',
  'NOT_WRITABLE',
  'SESSION_EXPIRED',
  'UNKNOWN_EVENT',
  'ENGINE_REJECTED',
  /** Lobby fail codes (mapped from `@shaatir-shakuni/lobby` LobbyFailCode). */
  'ROOM_FULL',
  'ROOM_NOT_JOINABLE',
  'GAME_ALREADY_STARTED',
  'DISPLAY_NAME_TAKEN',
  'DISPLAY_NAME_INVALID',
  'NOT_HOST',
  'NOT_LOBBY',
  'BAD_PLAYER_COUNT',
  'PLAYER_NOT_IN_ROOM',
  'ROOM_CODE_RETRY_EXHAUSTED',
  /** Per-socket flood control (`08-rate-limiting`). */
  'RATE_LIMITED',
  /** Persistence down before the sequence guard ran (EC-78). */
  'SERVICE_UNAVAILABLE',
]);

export type RejectReasonCode = z.infer<typeof rejectReasonCodeSchema>;

/**
 * Reject codes where the server's per-connection `expectedSequence` guard
 * itself failed (or the message never reached the guard at all, for
 * `RATE_LIMITED`) — i.e. the envelope's `sequence` number was **not**
 * consumed server-side. A client that already optimistically incremented its
 * local sequence counter before sending must roll it back to the value it
 * just used before retrying, or it will permanently desync from the server's
 * `expectedSequence` (see `DECISIONS.md` 2026-08-07, "client sequence
 * counter permanently desyncs after ANY rejected action").
 *
 * Every other reject code (`ENGINE_REJECTED`, `CHAT_FORBIDDEN`, etc.) means
 * the guard *passed* and the server already advanced `expectedSequence` for
 * that envelope — the client must NOT roll back for those, or it will retry
 * with a stale number the server has already moved past.
 */
export const SEQUENCE_NOT_CONSUMED_CODES: ReadonlySet<RejectReasonCode> = new Set([
  'PROTOCOL_MISMATCH',
  'SEQUENCE_REJECTED',
  'STATE_VERSION_MISMATCH',
  'RATE_LIMITED',
  // Writable gate runs before the sequence guard consumes the number — a
  // demoted/stale socket must roll back or it permanently desyncs.
  'NOT_WRITABLE',
  // Binding missing / not attached yet (e.g. ROOM_START raced a reconnect).
  'PLAYER_NOT_IN_ROOM',
  // Persist availability / lookup failed before the sequence guard.
  'SERVICE_UNAVAILABLE',
]);

export function isCurrentProtocolVersion(version: number): boolean {
  return version === PROTOCOL_VERSION;
}
