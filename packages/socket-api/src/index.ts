export { PROTOCOL_VERSION } from './protocol.js';
export type { ProtocolVersion } from './protocol.js';

export { ClientEvents, ServerEvents } from './events.js';
export type { ClientEventName, ServerEventName } from './events.js';

export {
  inboundEnvelopeSchema,
  actionUuidSchema,
  sequenceSchema,
  stateVersionSchema,
  protocolVersionSchema,
  rejectReasonCodeSchema,
  isCurrentProtocolVersion,
  SEQUENCE_NOT_CONSUMED_CODES,
} from './schemas/common.js';
export type { InboundEnvelope, RejectReasonCode } from './schemas/common.js';

export {
  clientHelloSchema,
  roomCreateSchema,
  roomJoinSchema,
  roomLeaveSchema,
  roomStartSchema,
  roomSetRebalanceSchema,
  roomPlayAgainSchema,
  sessionReconnectSchema,
  gameActionSchema,
  gameActionPayloadSchema,
  chatSendSchema,
} from './schemas/inbound.js';
export type {
  ClientHello,
  RoomCreateMessage,
  RoomJoinMessage,
  RoomLeaveMessage,
  RoomStartMessage,
  RoomSetRebalanceMessage,
  RoomPlayAgainMessage,
  SessionReconnectMessage,
  GameActionMessage,
  GameActionPayload,
  ChatSendMessage,
} from './schemas/inbound.js';

export {
  wirePlayerViewSchema,
  wirePhaseSchema,
  stateSyncSchema,
  stateUpdateSchema,
  actionRejectedSchema,
  actionDedupedSchema,
  roomFrozenSchema,
  chatMessageSchema,
  sessionReadOnlySchema,
  protocolMismatchSchema,
  helloOkSchema,
  roomCreatedSchema,
  roomJoinedSchema,
  errorSchema,
} from './schemas/outbound.js';
export type {
  WirePlayerView,
  StateSyncPayload,
  ActionRejectedPayload,
  RoomFrozenPayload,
  ProtocolMismatchPayload,
} from './schemas/outbound.js';

export { parseWithSchema, parseInboundEvent } from './validate.js';
export type { ParseResult, ParseSuccess, ParseFailure, InboundEventName } from './validate.js';

export { checkConnectionGuards, checkClientHello } from './connection-guard.js';
export type {
  ConnectionGuardInput,
  ConnectionGuardResult,
  HelloCheckResult,
} from './connection-guard.js';

export {
  createMemoryActionDedupStore,
  checkActionDedup,
  rememberActionUuid,
} from './action-dedup.js';
export type { ActionDedupStore, DedupCheckResult } from './action-dedup.js';

export { isChatAllowed, checkChatGate } from './chat-gate.js';
export type { ChatGateResult } from './chat-gate.js';

export {
  toWirePlayerView,
  buildStateSyncPayload,
  collectWireTileIds,
  EMPTY_WIRE_TIMERS,
} from './wire-view.js';
export type { WireTimerFields } from './wire-view.js';
