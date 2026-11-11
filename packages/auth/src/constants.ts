/** Idle TTL: expire when `now - lastSeenAt` exceeds this (72 hours). */
export const SESSION_IDLE_TTL_MS = 72 * 60 * 60 * 1000;

/**
 * Room statuses that force session expiry even if still within idle TTL
 * (cleanup / terminal corruption — token must not re-attach).
 */
export const SESSION_FORCE_EXPIRED_ROOM_STATUSES = [
  'ARCHIVED',
  'EXPIRED',
  'CORRUPTED',
] as const;

export type SessionForceExpiredRoomStatus =
  (typeof SESSION_FORCE_EXPIRED_ROOM_STATUSES)[number];

/**
 * Room statuses where identity may still resolve for viewing, but game/lobby
 * actions must be structurally rejected (EC-17 and terminal rooms).
 */
export const ACTION_BLOCKED_ROOM_STATUSES = [
  'GAME_OVER',
  'FROZEN',
  'CORRUPTED',
  'ABANDONED',
  'ARCHIVED',
  'EXPIRED',
] as const;

export type ActionBlockedRoomStatus = (typeof ACTION_BLOCKED_ROOM_STATUSES)[number];

export const AUTH_TOKEN_BYTE_LENGTH = 32;

/** Generic message for unknown/wrong tokens — must not leak session existence (EC-14). */
export const UNAUTHORIZED_SESSION_MESSAGE = 'Invalid session credentials';

export const SESSION_EXPIRED_MESSAGE = 'Session expired';
