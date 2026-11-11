export {
  ROOM_STATUSES,
  CLEANUP_ELIGIBLE_STATUSES,
  CONNECTION_STATUSES,
  SNAPSHOT_TRIGGER_EVENT_TYPES,
  shouldPersistSnapshot,
} from './enums.js';
export type {
  RoomStatus,
  CleanupEligibleStatus,
  ConnectionStatus,
  SnapshotTriggerEventType,
} from './enums.js';

export {
  rooms,
  players,
  sessions,
  gameEvents,
  snapshots,
  roomStatusEnum,
  connectionStatusEnum,
} from './schema/index.js';
export type {
  RoomSettings,
  RoomRow,
  NewRoom,
  PlayerRow,
  NewPlayer,
  SessionRow,
  NewSession,
  GameEventRow,
  NewGameEvent,
  SnapshotRow,
  NewSnapshot,
} from './schema/index.js';

export {
  isRoomEligibleForCleanup,
  cleanupEligibleStatusesSqlList,
  isProtectedFromCleanup,
} from './helpers/cleanup.js';
export {
  decideSnapshotWrite,
  selectSnapshotVersionForRecovery,
} from './helpers/snapshots.js';
export type { SnapshotVersionDecision } from './helpers/snapshots.js';
export {
  detectSeqGaps,
  detectLeadingSeqGap,
  detectActionUuidConflict,
  isHostForceEndPayload,
} from './helpers/events.js';
export type { SeqGap, SeqIntegrityResult, ActionUuidConflict } from './helpers/events.js';
export { retryWithBackoff } from './helpers/retry.js';
export type { RetryOptions, RetryResult } from './helpers/retry.js';
export { buildRecoveryPlan, pickLatestValidSnapshot } from './helpers/recovery.js';
export type { StoredSnapshot, StoredEvent, RecoveryPlan } from './helpers/recovery.js';
