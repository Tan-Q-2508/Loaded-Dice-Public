import {
  CLEANUP_ELIGIBLE_STATUSES,
  type CleanupEligibleStatus,
  type RoomStatus,
} from '../enums.js';

/** EC-05: positive allowlist — only ARCHIVED and EXPIRED may be deleted by cleanup. */
export function isRoomEligibleForCleanup(status: RoomStatus): boolean {
  return (CLEANUP_ELIGIBLE_STATUSES as readonly RoomStatus[]).includes(status);
}

/** SQL `IN (...)` list for cleanup queries — keep in sync with CLEANUP_ELIGIBLE_STATUSES. */
export function cleanupEligibleStatusesSqlList(): readonly CleanupEligibleStatus[] {
  return CLEANUP_ELIGIBLE_STATUSES;
}

const PROTECTED: ReadonlySet<RoomStatus> = new Set([
  'LOBBY',
  'IN_PROGRESS',
  'GAME_OVER',
  'FROZEN',
  'CORRUPTED',
  'ABANDONED',
]);

/** Inverse check used in tests — must never be true for protected statuses. */
export function isProtectedFromCleanup(status: RoomStatus): boolean {
  return PROTECTED.has(status) || !isRoomEligibleForCleanup(status);
}
