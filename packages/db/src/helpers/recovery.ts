import type { GameState } from '@shaatir-shakuni/engine';
import { selectSnapshotVersionForRecovery } from './snapshots.js';
import { detectSeqGaps } from './events.js';

/**
 * EC-79 / EC-81 — crash-recovery selection over in-memory rows.
 * Full engine replay is orchestration's job; this picks the base snapshot +
 * subsequent events and validates seq continuity.
 */

export type StoredSnapshot = {
  readonly version: number;
  readonly stateJson: string;
};

export type StoredEvent = {
  readonly seq: number;
  readonly stateVersion: number;
  readonly payload: unknown;
};

export type RecoveryPlan =
  | {
      readonly ok: true;
      readonly baseState: GameState | null;
      readonly baseVersion: number;
      readonly eventsToReplay: readonly StoredEvent[];
    }
  | {
      readonly ok: false;
      readonly reason: 'SEQ_GAP' | 'NO_VALID_SNAPSHOT_AND_NO_EVENTS' | 'INVALID_EVENT_PAYLOAD';
      readonly detail: string;
    };

function tryParseGameState(json: string): GameState | null {
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const obj = parsed as Record<string, unknown>;
    if (typeof obj['roomId'] !== 'string' || typeof obj['stateVersion'] !== 'number') {
      return null;
    }
    if (typeof obj['phase'] !== 'object' || obj['phase'] === null) return null;
    return parsed as GameState;
  } catch {
    return null;
  }
}

/** EC-81: newest-first parse; skip corrupted JSON. */
export function pickLatestValidSnapshot(
  snapshots: readonly StoredSnapshot[],
  maxApplicableVersion: number,
): { readonly state: GameState; readonly version: number } | null {
  const valid: { version: number; state: GameState }[] = [];
  for (const snap of snapshots) {
    const state = tryParseGameState(snap.stateJson);
    if (state === null) continue;
    valid.push({ version: snap.version, state });
  }
  const chosenVersion = selectSnapshotVersionForRecovery(
    valid.map((v) => v.version),
    maxApplicableVersion,
  );
  if (chosenVersion === null) return null;
  const match = valid.find((v) => v.version === chosenVersion);
  return match ? { state: match.state, version: match.version } : null;
}

export function buildRecoveryPlan(
  snapshots: readonly StoredSnapshot[],
  events: readonly StoredEvent[],
): RecoveryPlan {
  const sortedEvents = [...events].sort((a, b) => a.seq - b.seq);
  const gapCheck = detectSeqGaps(sortedEvents.map((e) => e.seq));
  if (!gapCheck.ok) {
    return {
      ok: false,
      reason: 'SEQ_GAP',
      detail: `GameEvents seq gap after ${gapCheck.gaps[0]?.afterSeq}`,
    };
  }

  for (const ev of sortedEvents) {
    if (typeof ev.payload !== 'object' || ev.payload === null) {
      return {
        ok: false,
        reason: 'INVALID_EVENT_PAYLOAD',
        detail: `Event seq ${ev.seq} has non-object payload`,
      };
    }
    const type = (ev.payload as Record<string, unknown>)['type'];
    if (typeof type !== 'string') {
      return {
        ok: false,
        reason: 'INVALID_EVENT_PAYLOAD',
        detail: `Event seq ${ev.seq} missing type`,
      };
    }
  }

  if (snapshots.length === 0 && sortedEvents.length === 0) {
    return {
      ok: false,
      reason: 'NO_VALID_SNAPSHOT_AND_NO_EVENTS',
      detail: 'Nothing to recover from',
    };
  }

  const maxEventVersion =
    sortedEvents.length === 0
      ? Number.POSITIVE_INFINITY
      : Math.max(...sortedEvents.map((e) => e.stateVersion));

  const picked = pickLatestValidSnapshot(snapshots, maxEventVersion);
  const baseState = picked?.state ?? null;
  const baseVersion = picked?.version ?? 0;
  const eventsToReplay = sortedEvents.filter((e) => e.stateVersion > baseVersion);

  return {
    ok: true,
    baseState,
    baseVersion,
    eventsToReplay,
  };
}
