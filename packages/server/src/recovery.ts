import {
  applyAction,
  assertInvariants,
  createRng,
  defaultPowerTable,
  seedForAction,
  type Clock,
  type GameAction,
  type GameEvent,
  type GameState,
} from '@shaatir-shakuni/engine';
import { buildRecoveryPlan, type StoredEvent, type StoredSnapshot } from '@shaatir-shakuni/db';
import type { PersistencePort, AppendEventInput } from './persist.js';
import { applyCommittedState, commitEngineResult } from './persist.js';
import type { RoomRuntime } from './room-runtime.js';
import type { IncidentLogger } from './freeze-log.js';

function freezeState(state: GameState, reason: string): {
  state: GameState;
  events: GameEvent[];
} {
  return {
    state: {
      ...state,
      phase: { kind: 'ROOM_FROZEN', reason },
      stateVersion: state.stateVersion + 1,
    },
    events: [{ type: 'ROOM_FAILURE', mode: 'ROOM_FROZEN', reason }],
  };
}

function isGameAction(value: unknown): value is GameAction {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    typeof (value as { type: unknown }).type === 'string'
  );
}

export type RecoverableEvent = StoredEvent & {
  readonly sourceAction?: unknown;
};

/**
 * EC-79 — load latest Snapshot → replay source actions since that snapshot → invariants.
 * EC-80 — invariant / replay failure → caller FREEZEs.
 */
export async function recoverRoom(
  roomId: string,
  persist: PersistencePort,
  clock: Clock,
  loadEvents?: () => Promise<readonly RecoverableEvent[]>,
): Promise<
  | {
      readonly ok: true;
      readonly state: GameState;
      readonly nextEventSeq: number;
      readonly maxSnapshotVersion: number;
    }
  | { readonly ok: false; readonly reason: string }
> {
  const data = await persist.loadRecoveryData(roomId);
  const plan = buildRecoveryPlan(data.snapshots, data.events);
  if (!plan.ok) {
    return { ok: false, reason: `${plan.reason}: ${plan.detail}` };
  }
  if (!plan.baseState) {
    return { ok: false, reason: 'NO_BASE_STATE' };
  }

  let state: GameState = plan.baseState;
  const enriched =
    loadEvents !== undefined
      ? await loadEvents()
      : (data.events as readonly RecoverableEvent[]);

  const toReplay = enriched
    .filter((e) => e.stateVersion > plan.baseVersion)
    .sort((a, b) => a.seq - b.seq);

  // Group by stateVersion (one commit batch → one action)
  const byVersion = new Map<number, RecoverableEvent[]>();
  for (const ev of toReplay) {
    const list = byVersion.get(ev.stateVersion) ?? [];
    list.push(ev);
    byVersion.set(ev.stateVersion, list);
  }

  const versions = [...byVersion.keys()].sort((a, b) => a - b);
  for (const version of versions) {
    const batch = byVersion.get(version) ?? [];
    const withAction = batch.find((e) => e.sourceAction !== undefined);
    if (!withAction || !isGameAction(withAction.sourceAction)) {
      // Snapshot cadence may leave gaps without stored actions — treat as freeze-worthy.
      return {
        ok: false,
        reason: `Cannot replay events to stateVersion ${version}: missing sourceAction`,
      };
    }
    const deps = {
      rng: createRng(seedForAction(state, withAction.sourceAction)),
      clock,
      powerTable: defaultPowerTable,
    };
    const applied = applyAction(state, withAction.sourceAction, deps);
    const rejected = applied.events.some((e) => e.type === 'ACTION_REJECTED');
    if (rejected) {
      return {
        ok: false,
        reason: `Replay rejected action at stateVersion ${version}`,
      };
    }
    state = applied.state;
  }

  try {
    assertInvariants(state);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'invariant failure';
    return { ok: false, reason: message };
  }

  const maxSeq =
    data.events.length === 0 ? 1 : Math.max(...data.events.map((e) => e.seq)) + 1;
  const maxSnap =
    data.snapshots.length === 0
      ? 0
      : Math.max(...data.snapshots.map((s: StoredSnapshot) => s.version));

  return {
    ok: true,
    state,
    nextEventSeq: maxSeq,
    maxSnapshotVersion: maxSnap,
  };
}

/**
 * EC-R02 — explicit resume path for a FROZEN room from last good snapshot (+ replay).
 */
export async function resumeFrozenRoom(
  runtime: RoomRuntime,
  persist: PersistencePort,
  clock: Clock,
  loadEvents?: () => Promise<readonly RecoverableEvent[]>,
): Promise<{ readonly ok: true } | { readonly ok: false; readonly reason: string }> {
  if (runtime.status !== 'FROZEN') {
    return { ok: false, reason: 'Room is not FROZEN' };
  }

  const recovered = await recoverRoom(runtime.roomId, persist, clock, loadEvents);
  if (!recovered.ok) {
    return { ok: false, reason: recovered.reason };
  }

  runtime.gameState = recovered.state;
  runtime.nextEventSeq = recovered.nextEventSeq;
  runtime.maxSnapshotVersion = recovered.maxSnapshotVersion;
  if (recovered.state.phase.kind === 'GAME_OVER') {
    runtime.status = 'GAME_OVER';
  } else if (recovered.state.phase.kind === 'LOBBY') {
    runtime.status = 'LOBBY';
  } else if (
    recovered.state.phase.kind === 'ROOM_FROZEN' ||
    recovered.state.phase.kind === 'ROOM_CORRUPTED'
  ) {
    return { ok: false, reason: 'Recovered state is still failed' };
  } else {
    runtime.status = 'IN_PROGRESS';
  }
  runtime.frozenReason = null;
  runtime.incidentAtMs = null;

  if (persist.isAvailable()) {
    await persist.updateRoomStatus(runtime.roomId, runtime.status, {
      frozenReason: null,
      incidentAtMs: null,
    });
  }

  return { ok: true };
}

export async function freezeRoom(
  runtime: RoomRuntime,
  reason: string,
  persist: PersistencePort,
  clock: Clock,
  incidents: IncidentLogger,
): Promise<void> {
  const now = clock.now();
  const base = runtime.gameState;
  if (base) {
    const { state, events } = freezeState(base, reason);
    if (persist.isAvailable()) {
      const commit = await commitEngineResult(runtime, state, events, persist, null);
      if (commit.kind === 'committed') {
        applyCommittedState(runtime, commit.state, 'FROZEN');
      } else {
        runtime.gameState = state;
        runtime.status = 'FROZEN';
      }
    } else {
      runtime.gameState = state;
      runtime.status = 'FROZEN';
    }
  } else {
    runtime.status = 'FROZEN';
  }

  runtime.frozenReason = reason;
  runtime.incidentAtMs = now;
  runtime.afkDeadlineMs = null;

  if (persist.isAvailable()) {
    try {
      await persist.updateRoomStatus(runtime.roomId, 'FROZEN', {
        frozenReason: reason,
        incidentAtMs: now,
      });
    } catch {
      // memory already updated
    }
  }

  incidents.log({
    kind: 'FREEZE',
    roomId: runtime.roomId,
    roomCode: runtime.roomCode,
    reason,
    timestampMs: now,
    lastKnownSnapshotVersion: runtime.maxSnapshotVersion,
  });
}

/**
 * Apply an engine action through the commit pipeline.
 */
export async function applyAndCommit(
  runtime: RoomRuntime,
  action: GameAction,
  persist: PersistencePort,
  clock: Clock,
  actionUuid: string | null,
): Promise<
  | { readonly kind: 'committed'; readonly state: GameState; readonly events: readonly GameEvent[] }
  | { readonly kind: 'rejected'; readonly actionType: string; readonly reason: string }
  | { readonly kind: 'persist_failed'; readonly error: unknown }
  | { readonly kind: 'db_unavailable' }
  | { readonly kind: 'no_state' }
> {
  if (!runtime.gameState) {
    return { kind: 'no_state' };
  }

  const deps = {
    rng: createRng(seedForAction(runtime.gameState, action)),
    clock,
    powerTable: defaultPowerTable,
  };

  const result = applyAction(runtime.gameState, action, deps);

  let commit: Awaited<ReturnType<typeof commitEngineResult>>;
  try {
    // Defense in depth with Postgres statement_timeout: a wedged pool acquire
    // or hung driver must not block the per-room writer queue forever.
    commit = await withTimeout(
      commitEngineResult(
        runtime,
        result.state,
        result.events,
        persist,
        actionUuid,
        action,
      ),
      PERSIST_TIMEOUT_MS,
      'persist_timeout',
    );
  } catch (error) {
    return { kind: 'persist_failed', error };
  }

  if (commit.kind === 'committed') {
    applyCommittedState(runtime, commit.state);
    return { kind: 'committed', state: commit.state, events: commit.events };
  }

  if (commit.kind === 'db_unavailable') {
    // EC-78: already-loaded rooms continue from memory and queue the write.
    if (runtime.status === 'IN_PROGRESS' || runtime.status === 'GAME_OVER') {
      runtime.pendingPersistJobs.push({
        kind: 'events',
        payload: {
          action,
          events: result.events,
          state: result.state,
          actionUuid,
        },
      });
      applyCommittedState(runtime, result.state);
      return { kind: 'committed', state: result.state, events: result.events };
    }
    return { kind: 'db_unavailable' };
  }

  return commit;
}

/** Upper bound for a single durable commit attempt (ms). */
const PERSIST_TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(label)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export type { AppendEventInput };
