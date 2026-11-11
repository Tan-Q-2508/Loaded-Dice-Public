import type { RoomStatus } from '@shaatir-shakuni/db';
import { DEFAULT_TIMEOUTS, type TimeoutConfig } from './timeouts.js';

export type EmptyRoomDisposition = 'PRESERVE' | 'ABANDON' | 'NOT_APPLICABLE';

/**
 * EC-04 (reconnect half): IN_PROGRESS rooms with zero sockets are preserved for
 * the reconnect window — not treated like an abandoned lobby.
 * Lobby idle deletion remains `05-lobby`.
 */
export function emptyRoomDisposition(input: {
  readonly roomStatus: RoomStatus;
  /** Instant when the last connected socket dropped; null if any player still CONNECTED. */
  readonly lastSocketGoneAtMs: number | null;
  readonly nowMs: number;
  readonly timeouts?: TimeoutConfig;
}): EmptyRoomDisposition {
  const { roomStatus, lastSocketGoneAtMs, nowMs } = input;
  const timeouts = input.timeouts ?? DEFAULT_TIMEOUTS;

  if (roomStatus !== 'IN_PROGRESS') {
    return 'NOT_APPLICABLE';
  }

  if (lastSocketGoneAtMs === null) {
    return 'PRESERVE';
  }

  if (nowMs >= lastSocketGoneAtMs + timeouts.inProgressReconnectWindowMs) {
    return 'ABANDON';
  }

  return 'PRESERVE';
}

/** True while an IN_PROGRESS empty room must not be cleanup-deleted (EC-04/EC-05). */
export function isInReconnectWindow(input: {
  readonly roomStatus: RoomStatus;
  readonly lastSocketGoneAtMs: number | null;
  readonly nowMs: number;
  readonly timeouts?: TimeoutConfig;
}): boolean {
  return emptyRoomDisposition(input) === 'PRESERVE' && input.roomStatus === 'IN_PROGRESS';
}
