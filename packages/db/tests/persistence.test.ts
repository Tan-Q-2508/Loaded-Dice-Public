import { describe, expect, it, vi } from 'vitest';
import {
  buildRecoveryPlan,
  decideSnapshotWrite,
  detectActionUuidConflict,
  detectLeadingSeqGap,
  detectSeqGaps,
  pickLatestValidSnapshot,
  retryWithBackoff,
  selectSnapshotVersionForRecovery,
} from '../src/index.js';

function minimalStateJson(version: number, roomId = 'room-1'): string {
  return JSON.stringify({
    roomId,
    stateVersion: version,
    phase: { kind: 'ELECTION_NOMINATION' },
    hostPlayerId: 'p1',
    rebalanceEnabled: false,
    startPlayerCount: 5,
    players: [],
    decreeDeck: [],
    ashPile: [],
    enactedDharma: 0,
    enactedAdharma: 0,
    electionTracker: 0,
    maharajCandidateId: 'p1',
    senapatiCandidateId: null,
    currentGovernment: null,
    lastElectedGovernment: null,
    investigatedPlayerIds: [],
    summonsReturnAfterPlayerId: null,
    privateInvestigations: {},
    seed: 1,
    expectedTileCount: 17,
  });
}

describe('EC-95 / EC-77 snapshot versioning', () => {
  it('accepts first insert and newer versions', () => {
    expect(decideSnapshotWrite(null, 1)).toEqual({ ok: true, kind: 'insert' });
    expect(decideSnapshotWrite(1, 2)).toEqual({ ok: true, kind: 'insert' });
  });

  it('treats equal version as idempotent', () => {
    expect(decideSnapshotWrite(5, 5)).toEqual({ ok: true, kind: 'idempotent' });
  });

  it('rejects stale older version (EC-95)', () => {
    expect(decideSnapshotWrite(10, 7)).toEqual({
      ok: false,
      kind: 'stale',
      existingMaxVersion: 10,
    });
  });

  it('selects highest snapshot ≤ max applicable (EC-77)', () => {
    expect(selectSnapshotVersionForRecovery([1, 3, 5, 9], 5)).toBe(5);
    expect(selectSnapshotVersionForRecovery([1, 3, 5, 9], 4)).toBe(3);
    expect(selectSnapshotVersionForRecovery([9, 10], 5)).toBe(null);
  });
});

describe('EC-74 snapshot save retry', () => {
  it('retries with backoff then succeeds', async () => {
    let calls = 0;
    const sleep = vi.fn(async () => undefined);
    const result = await retryWithBackoff(
      async () => {
        calls += 1;
        if (calls < 3) throw new Error('db hiccup');
        return 'saved';
      },
      { maxAttempts: 5, initialDelayMs: 10, sleep },
    );
    expect(result).toEqual({ ok: true, value: 'saved', attempts: 3 });
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('returns failure after exhausting attempts', async () => {
    const sleep = vi.fn(async () => undefined);
    const result = await retryWithBackoff(
      async () => {
        throw new Error('down');
      },
      { maxAttempts: 3, initialDelayMs: 1, sleep },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.attempts).toBe(3);
      expect(String(result.error)).toContain('down');
    }
  });
});

describe('EC-81 / EC-79 recovery helpers', () => {
  it('skips corrupted snapshot JSON and uses older valid one', () => {
    const picked = pickLatestValidSnapshot(
      [
        { version: 3, stateJson: '{not-json' },
        { version: 2, stateJson: minimalStateJson(2) },
        { version: 1, stateJson: minimalStateJson(1) },
      ],
      10,
    );
    expect(picked?.version).toBe(2);
  });

  it('builds recovery plan replaying events after base snapshot', () => {
    const plan = buildRecoveryPlan(
      [
        { version: 2, stateJson: '{bad' },
        { version: 1, stateJson: minimalStateJson(1) },
      ],
      [
        {
          seq: 1,
          stateVersion: 1,
          payload: { type: 'GAME_STARTED', seed: 1, startPlayerCount: 5 },
        },
        {
          seq: 2,
          stateVersion: 2,
          payload: { type: 'PHASE_CHANGED', from: 'ROLE_REVEAL', to: 'ELECTION_NOMINATION' },
        },
      ],
    );
    expect(plan.ok).toBe(true);
    if (plan.ok) {
      expect(plan.baseVersion).toBe(1);
      expect(plan.eventsToReplay.map((e) => e.seq)).toEqual([2]);
    }
  });

  it('fails closed on seq gaps (EC-98)', () => {
    const plan = buildRecoveryPlan([], [
      { seq: 1, stateVersion: 1, payload: { type: 'GAME_STARTED' } },
      { seq: 3, stateVersion: 3, payload: { type: 'PHASE_CHANGED' } },
    ]);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toBe('SEQ_GAP');
  });
});

describe('EC-98 / EC-83 / EC-119 event ledger integrity', () => {
  it('detects seq gaps', () => {
    expect(detectSeqGaps([1, 2, 3])).toEqual({ ok: true });
    const gapped = detectSeqGaps([1, 2, 4]);
    expect(gapped.ok).toBe(false);
    if (!gapped.ok) {
      expect(gapped.gaps[0]).toEqual({ afterSeq: 2, expectedNext: 3, foundNext: 4 });
    }
  });

  it('EC-119: contiguous seq implies no skipped values between consecutive events', () => {
    const contiguous = [1, 2, 3, 4, 5];
    expect(detectSeqGaps(contiguous)).toEqual({ ok: true });
    for (let i = 1; i < contiguous.length; i++) {
      expect(contiguous[i]! - contiguous[i - 1]!).toBe(1);
    }
  });

  it('detects leading gap when seq does not start at 1', () => {
    expect(detectLeadingSeqGap([2, 3])).toBe(true);
    expect(detectLeadingSeqGap([1, 2])).toBe(false);
  });

  it('detects duplicate action UUID with different seq', () => {
    const map = new Map<string, number>([['a-1', 5]]);
    expect(detectActionUuidConflict(map, 'a-1', 5)).toBeNull();
    expect(detectActionUuidConflict(map, 'a-1', 9)).toEqual({
      actionUuid: 'a-1',
      existingSeq: 5,
      incomingSeq: 9,
    });
    expect(detectActionUuidConflict(map, null, 1)).toBeNull();
  });
});
