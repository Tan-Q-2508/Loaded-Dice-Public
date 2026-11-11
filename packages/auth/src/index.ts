export {
  SESSION_IDLE_TTL_MS,
  SESSION_FORCE_EXPIRED_ROOM_STATUSES,
  ACTION_BLOCKED_ROOM_STATUSES,
  AUTH_TOKEN_BYTE_LENGTH,
  UNAUTHORIZED_SESSION_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
} from './constants.js';
export type {
  SessionForceExpiredRoomStatus,
  ActionBlockedRoomStatus,
} from './constants.js';

export { generateAuthToken, authTokensEqual } from './token.js';
export type { RandomBytesFn } from './token.js';

export {
  issueSession,
  isSessionIdleExpired,
  isRoomStatusForceExpired,
  isActionBlockedRoomStatus,
  validateSessionToken,
  rotateAuthToken,
  validateAndRotateSession,
} from './session.js';
export type {
  SessionRecord,
  IssuedSession,
  IssueSessionInput,
  ValidateSessionOk,
  ValidateSessionFail,
  ValidateSessionResult,
  ValidateSessionTokenInput,
  RotateAuthTokenResult,
} from './session.js';

export { registerWritableConnection, isSocketWritable } from './writable.js';
export type {
  RegisterWritableConnectionInput,
  RegisterWritableConnectionResult,
} from './writable.js';

export { assertCanSubmitAction } from './action-gate.js';
export type {
  AssertCanSubmitActionInput,
  AssertCanSubmitActionOk,
  AssertCanSubmitActionFail,
  AssertCanSubmitActionResult,
} from './action-gate.js';

export { resolveHostOnReconnect } from './host.js';
export type {
  ResolveHostOnReconnectInput,
  ResolveHostOnReconnectResult,
} from './host.js';
