import { describe, expect, it } from 'vitest';
import {
  CLEANUP_ELIGIBLE_STATUSES,
  ROOM_STATUSES,
  cleanupEligibleStatusesSqlList,
  isHostForceEndPayload,
  isProtectedFromCleanup,
  isRoomEligibleForCleanup,
  shouldPersistSnapshot,
  type RoomStatus,
} from '../src/index.js';

describe('EC-05 cleanup allowlist', () => {
  it('allows only ARCHIVED and EXPIRED', () => {
    expect(CLEANUP_ELIGIBLE_STATUSES).toEqual(['ARCHIVED', 'EXPIRED']);
    expect(cleanupEligibleStatusesSqlList()).toEqual(['ARCHIVED', 'EXPIRED']);
    expect(isRoomEligibleForCleanup('ARCHIVED')).toBe(true);
    expect(isRoomEligibleForCleanup('EXPIRED')).toBe(true);
  });

  it('rejects ACTIVE-like and frozen statuses', () => {
    const protectedStatuses: RoomStatus[] = [
      'LOBBY',
      'IN_PROGRESS',
      'GAME_OVER',
      'FROZEN',
      'CORRUPTED',
      'ABANDONED',
    ];
    for (const status of protectedStatuses) {
      expect(isRoomEligibleForCleanup(status)).toBe(false);
      expect(isProtectedFromCleanup(status)).toBe(true);
    }
  });

  it('covers every RoomStatus exactly once as eligible or protected', () => {
    for (const status of ROOM_STATUSES) {
      const eligible = isRoomEligibleForCleanup(status);
      expect(eligible || isProtectedFromCleanup(status)).toBe(true);
      if (eligible) {
        expect(['ARCHIVED', 'EXPIRED']).toContain(status);
      }
    }
  });
});

describe('snapshot cadence triggers', () => {
  it('persists on phase change, win, and room failure only', () => {
    expect(shouldPersistSnapshot('PHASE_CHANGED')).toBe(true);
    expect(shouldPersistSnapshot('WIN_CONDITION_MET')).toBe(true);
    expect(shouldPersistSnapshot('ROOM_FAILURE')).toBe(true);
    expect(shouldPersistSnapshot('VOTE_CAST')).toBe(false);
    expect(shouldPersistSnapshot('TILE_DISCARDED')).toBe(false);
  });
});

describe('EC-91 host force-end payload', () => {
  it('detects HOST_FORCE_END win payloads', () => {
    expect(
      isHostForceEndPayload({
        type: 'WIN_CONDITION_MET',
        winner: 'PANDAVA',
        reason: 'HOST_FORCE_END',
      }),
    ).toBe(true);
    expect(
      isHostForceEndPayload({
        type: 'WIN_CONDITION_MET',
        winner: 'PANDAVA',
        reason: 'DHARMA_DECREES',
      }),
    ).toBe(false);
  });
});
