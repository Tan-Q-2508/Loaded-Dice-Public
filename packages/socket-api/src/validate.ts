import type { ZodTypeAny, ZodIssue } from 'zod';
import { ClientEvents } from './events.js';
import {
  clientHelloSchema,
  roomCreateSchema,
  roomJoinSchema,
  roomLeaveSchema,
  roomStartSchema,
  roomSetRebalanceSchema,
  roomPlayAgainSchema,
  sessionReconnectSchema,
  gameActionSchema,
  chatSendSchema,
} from './schemas/inbound.js';
import type { RejectReasonCode } from './schemas/common.js';

export interface ParseSuccess<T> {
  readonly ok: true;
  readonly data: T;
}

export interface ParseFailure {
  readonly ok: false;
  readonly code: RejectReasonCode;
  readonly message: string;
  readonly issues: readonly ZodIssue[];
}

export type ParseResult<T> = ParseSuccess<T> | ParseFailure;

function fail(message: string, issues: readonly ZodIssue[] = []): ParseFailure {
  return {
    ok: false,
    code: 'VALIDATION_FAILED',
    message,
    issues,
  };
}

export function parseWithSchema<T>(schema: ZodTypeAny, raw: unknown): ParseResult<T> {
  const result = schema.safeParse(raw);
  if (result.success) {
    return { ok: true, data: result.data as T };
  }
  return fail('Invalid payload', result.error.issues);
}

const inboundByEvent = {
  [ClientEvents.HELLO]: clientHelloSchema,
  [ClientEvents.ROOM_CREATE]: roomCreateSchema,
  [ClientEvents.ROOM_JOIN]: roomJoinSchema,
  [ClientEvents.ROOM_LEAVE]: roomLeaveSchema,
  [ClientEvents.ROOM_START]: roomStartSchema,
  [ClientEvents.ROOM_SET_REBALANCE]: roomSetRebalanceSchema,
  [ClientEvents.ROOM_PLAY_AGAIN]: roomPlayAgainSchema,
  [ClientEvents.SESSION_RECONNECT]: sessionReconnectSchema,
  [ClientEvents.GAME_ACTION]: gameActionSchema,
  [ClientEvents.CHAT_SEND]: chatSendSchema,
} as const;

export type InboundEventName = keyof typeof inboundByEvent;

export function parseInboundEvent(
  eventName: string,
  raw: unknown,
): ParseResult<unknown> {
  if (!(eventName in inboundByEvent)) {
    return {
      ok: false,
      code: 'UNKNOWN_EVENT',
      message: 'Unknown event',
      issues: [],
    };
  }
  const schema = inboundByEvent[eventName as InboundEventName];
  return parseWithSchema(schema, raw);
}
