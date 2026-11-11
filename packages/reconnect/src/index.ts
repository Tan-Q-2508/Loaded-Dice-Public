export { DEFAULT_TIMEOUTS } from './timeouts.js';
export type { TimeoutConfig } from './timeouts.js';

export {
  applyDisconnect,
  attachSession,
  markReconnecting,
} from './connection.js';
export type {
  SessionHandle,
  PlayerConnectionHandle,
  DisconnectResult,
  AttachInput,
  AttachResult,
  AttachOk,
  AttachFail,
} from './connection.js';

export { emptyRoomDisposition, isInReconnectWindow } from './room-window.js';
export type { EmptyRoomDisposition } from './room-window.js';

export {
  phaseNeedsAfkDeadline,
  computeAfkDeadline,
  computeSoftAfkDeadline,
  isAfkDeadlineExpired,
  isMultiSeatTimedPhase,
  phaseTimerKey,
  hardDurationMs,
  pickAfkNomination,
  resolveAfkAction,
  resolveDeferredSeatAction,
  onlyDeferredSeatsRemain,
} from './afk.js';

export {
  reconnectCapabilities,
  performReconnect,
  performNetworkBlipReconnect,
} from './resync.js';
export type {
  ReconnectCapabilities,
  ReconnectSuccess,
  ReconnectFailure,
  ReconnectResult,
} from './resync.js';
