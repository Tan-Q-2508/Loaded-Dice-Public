/**
 * Socket.IO event names. Clients and server must use these exact strings —
 * do not invent parallel names in orchestration/frontend.
 */
export const ClientEvents = {
  HELLO: 'client:hello',
  ROOM_CREATE: 'room:create',
  ROOM_JOIN: 'room:join',
  ROOM_LEAVE: 'room:leave',
  ROOM_START: 'room:start',
  ROOM_SET_REBALANCE: 'room:set_rebalance',
  ROOM_PLAY_AGAIN: 'room:play_again',
  SESSION_RECONNECT: 'session:reconnect',
  GAME_ACTION: 'game:action',
  CHAT_SEND: 'chat:send',
} as const;

export const ServerEvents = {
  HELLO_OK: 'client:hello_ok',
  PROTOCOL_MISMATCH: 'client:protocol_mismatch',
  STATE_SYNC: 'state:sync',
  STATE_UPDATE: 'state:update',
  ACTION_REJECTED: 'action:rejected',
  ACTION_DEDUPED: 'action:deduped',
  ROOM_FROZEN: 'room:frozen',
  CHAT_MESSAGE: 'chat:message',
  SESSION_READ_ONLY: 'session:read_only',
  ROOM_CREATED: 'room:created',
  ROOM_JOINED: 'room:joined',
  ERROR: 'error',
} as const;

export type ClientEventName = (typeof ClientEvents)[keyof typeof ClientEvents];
export type ServerEventName = (typeof ServerEvents)[keyof typeof ServerEvents];
