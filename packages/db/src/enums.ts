/** Room lifecycle / connection enums — binding for schema + helpers. */

export const ROOM_STATUSES = [
  'LOBBY',
  'IN_PROGRESS',
  'GAME_OVER',
  'FROZEN',
  'CORRUPTED',
  'ABANDONED',
  'ARCHIVED',
  'EXPIRED',
] as const;

export type RoomStatus = (typeof ROOM_STATUSES)[number];

/** Statuses eligible for scheduled deletion (EC-05 positive allowlist). */
export const CLEANUP_ELIGIBLE_STATUSES = ['ARCHIVED', 'EXPIRED'] as const;

export type CleanupEligibleStatus = (typeof CLEANUP_ELIGIBLE_STATUSES)[number];

export const CONNECTION_STATUSES = [
  'CONNECTED',
  'DISCONNECTED',
  'RECONNECTING',
] as const;

export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

/**
 * Snapshot cadence (DECISIONS.md — 02-database-schema):
 * Write a Snapshot whenever a PHASE_CHANGED engine event is persisted, and always on
 * GAME_OVER / ROOM_FAILURE. Not every GameEvent — bounds storage while keeping reconnect
 * recovery cheap.
 */
export const SNAPSHOT_TRIGGER_EVENT_TYPES = [
  'PHASE_CHANGED',
  'WIN_CONDITION_MET',
  'ROOM_FAILURE',
] as const;

export type SnapshotTriggerEventType = (typeof SNAPSHOT_TRIGGER_EVENT_TYPES)[number];

export function shouldPersistSnapshot(eventType: string): boolean {
  return (SNAPSHOT_TRIGGER_EVENT_TYPES as readonly string[]).includes(eventType);
}
