import type { GameEvent, GameState } from '@shaatir-shakuni/engine';
import {
  shouldPersistSnapshot,
  type RoomStatus,
  type StoredEvent,
  type StoredSnapshot,
} from '@shaatir-shakuni/db';
import type { RoomRuntime } from './room-runtime.js';

export type FrozenRoomInfo = {
  readonly roomId: string;
  readonly roomCode: string;
  readonly frozenReason: string | null;
  readonly incidentAtMs: number | null;
  readonly lastKnownSnapshotVersion: number;
};

export type AppendEventInput = {
  readonly roomId: string;
  readonly seq: number;
  readonly stateVersion: number;
  readonly actionUuid: string | null;
  readonly eventType: string;
  readonly payload: GameEvent;
  /** Present on the first event of a commit batch so crash recovery can re-apply (EC-79). */
  readonly sourceAction?: unknown;
};

/**
 * Persistence boundary. Production uses Drizzle/Postgres; tests use MemoryPersistence.
 * EC-78: when unavailable, callers must not start new rooms/games and may queue writes.
 */
export interface PersistencePort {
  isAvailable(): boolean;
  setAvailable(available: boolean): void;
  /** Lightweight reachability check (`SELECT 1`). Updates `isAvailable` on failure. */
  ping(): Promise<boolean>;

  roomCodeExists(code: string): Promise<boolean>;

  saveNewRoom(input: {
    readonly roomId: string;
    readonly roomCode: string;
    readonly hostPlayerId: string;
    readonly rebalanceEnabled: boolean;
    readonly players: readonly {
      readonly id: string;
      readonly displayName: string;
      readonly seatOrder: number;
      readonly sessionId: string;
      readonly joinedAtMs: number;
    }[];
    readonly sessions: readonly {
      readonly id: string;
      readonly playerId: string;
      readonly authToken: string;
      readonly socketId: string | null;
      readonly lastSeenAtMs: number;
    }[];
  }): Promise<void>;

  updateRoomStatus(
    roomId: string,
    status: RoomStatus,
    extras?: { readonly frozenReason?: string | null; readonly incidentAtMs?: number | null },
  ): Promise<void>;

  appendEvents(events: readonly AppendEventInput[]): Promise<void>;

  writeSnapshot(roomId: string, version: number, state: GameState): Promise<void>;

  loadRecoveryData(roomId: string): Promise<{
    readonly snapshots: readonly StoredSnapshot[];
    readonly events: readonly StoredEvent[];
  }>;

  listFrozenRooms(): Promise<readonly FrozenRoomInfo[]>;

  /** Lookup session by auth token (reconnect). */
  findSessionByToken(authToken: string): Promise<{
    readonly sessionId: string;
    readonly playerId: string;
    readonly roomId: string;
    readonly authToken: string;
    readonly socketId: string | null;
    readonly lastSeenAtMs: number;
  } | null>;

  updateSession(input: {
    readonly sessionId: string;
    readonly authToken?: string;
    readonly socketId?: string | null;
    readonly lastSeenAtMs?: number;
  }): Promise<void>;

  /** Add a player + session to an existing room (join). */
  addSession(input: {
    readonly roomId: string;
    readonly sessionId: string;
    readonly playerId: string;
    readonly displayName: string;
    readonly seatOrder: number;
    readonly joinedAtMs: number;
    readonly authToken: string;
    readonly socketId: string | null;
    readonly lastSeenAtMs: number;
  }): Promise<void>;
}

export type CommitFailure =
  | { readonly kind: 'rejected'; readonly actionType: string; readonly reason: string }
  | { readonly kind: 'persist_failed'; readonly error: unknown }
  | { readonly kind: 'db_unavailable' };

export type CommitSuccess = {
  readonly kind: 'committed';
  readonly state: GameState;
  readonly events: readonly GameEvent[];
  readonly snapshotWritten: boolean;
};

export type CommitResult = CommitSuccess | CommitFailure;

/**
 * EC-75 / EC-96 — apply is tentative until event writes succeed.
 * Caller must NOT mutate runtime.gameState until this returns `committed`.
 */
export async function commitEngineResult(
  runtime: RoomRuntime,
  nextState: GameState,
  events: readonly GameEvent[],
  persist: PersistencePort,
  actionUuid: string | null,
  sourceAction?: unknown,
): Promise<CommitResult> {
  const rejected = events.find((e) => e.type === 'ACTION_REJECTED');
  if (rejected && rejected.type === 'ACTION_REJECTED') {
    // Pure rejects leave state unchanged; ignore if mixed with other events (shouldn't happen).
    if (events.every((e) => e.type === 'ACTION_REJECTED')) {
      return {
        kind: 'rejected',
        actionType: rejected.actionType,
        reason: rejected.reason,
      };
    }
  }

  const prevVersion = runtime.gameState?.stateVersion ?? -1;
  const stateAdvanced = nextState.stateVersion > prevVersion;

  if (events.length === 0 && !stateAdvanced) {
    return { kind: 'rejected', actionType: 'UNKNOWN', reason: 'No events' };
  }

  if (!persist.isAvailable()) {
    return { kind: 'db_unavailable' };
  }

  // Engine may bump stateVersion with an empty event list (e.g. partial role-reveal ack).
  // Persist a snapshot so crash recovery still has the advanced state.
  if (events.length === 0 && stateAdvanced) {
    try {
      await persist.writeSnapshot(runtime.roomId, nextState.stateVersion, nextState);
      runtime.maxSnapshotVersion = Math.max(runtime.maxSnapshotVersion, nextState.stateVersion);
      return {
        kind: 'committed',
        state: nextState,
        events: [],
        snapshotWritten: true,
      };
    } catch (error) {
      return { kind: 'persist_failed', error };
    }
  }

  const rows: AppendEventInput[] = [];
  let seq = runtime.nextEventSeq;
  for (const ev of events) {
    const isFirst = seq === runtime.nextEventSeq;
    rows.push({
      roomId: runtime.roomId,
      seq,
      stateVersion: nextState.stateVersion,
      actionUuid: isFirst ? actionUuid : null,
      eventType: ev.type,
      payload: ev,
      ...(isFirst && sourceAction !== undefined ? { sourceAction } : {}),
    });
    seq += 1;
  }

  try {
    await persist.appendEvents(rows);
  } catch (error) {
    return { kind: 'persist_failed', error };
  }

  let snapshotWritten = false;
  const needsSnapshot = events.some((e) => shouldPersistSnapshot(e.type));
  if (needsSnapshot) {
    try {
      await persist.writeSnapshot(runtime.roomId, nextState.stateVersion, nextState);
      snapshotWritten = true;
    } catch (error) {
      // Event ledger already durable — snapshot retry is fire-and-forget via caller;
      // for EC-75 the critical write already succeeded.
      runtime.pendingPersistJobs.push({
        kind: 'snapshot',
        payload: { version: nextState.stateVersion, state: nextState },
      });
    }
  }

  runtime.nextEventSeq = seq;
  if (snapshotWritten) {
    runtime.maxSnapshotVersion = Math.max(runtime.maxSnapshotVersion, nextState.stateVersion);
  }

  return {
    kind: 'committed',
    state: nextState,
    events,
    snapshotWritten,
  };
}

/**
 * Apply a committed result onto the runtime (call only after commitEngineResult succeeds
 * or after an explicit memory-continue decision for EC-78 loaded rooms).
 */
export function applyCommittedState(
  runtime: RoomRuntime,
  state: GameState,
  status?: RoomStatus,
): void {
  runtime.gameState = state;
  if (status) {
    runtime.status = status;
  } else if (state.phase.kind === 'GAME_OVER') {
    runtime.status = 'GAME_OVER';
  } else if (state.phase.kind === 'ROOM_FROZEN') {
    runtime.status = 'FROZEN';
  } else if (state.phase.kind === 'ROOM_CORRUPTED') {
    runtime.status = 'CORRUPTED';
  } else if (state.phase.kind !== 'LOBBY') {
    runtime.status = 'IN_PROGRESS';
  }
  // Keep lobby.status aligned — joinRoom gates on lobby.status, not runtime.status.
  // Without this, post-start joins still look like LOBBY and ghost seats confuse the table.
  if (runtime.lobby.status !== runtime.status) {
    runtime.lobby = { ...runtime.lobby, status: runtime.status };
  }
}
