import type { GameState } from '@shaatir-shakuni/engine';
import type { LobbyRoom } from '@shaatir-shakuni/lobby';
import {
  createMemoryActionDedupStore,
  type ActionDedupStore,
} from '@shaatir-shakuni/socket-api';
import type { RoomStatus } from '@shaatir-shakuni/db';

export type SocketBinding = {
  readonly socketId: string;
  readonly playerId: string;
  readonly sessionId: string;
  /** Per-connection expected next inbound sequence. */
  expectedSequence: number;
  isWritable: boolean;
};

export type RoomRuntime = {
  readonly roomId: string;
  roomCode: string;
  status: RoomStatus;
  lobby: LobbyRoom;
  /** Null while still in LOBBY before START_GAME, or when FROZEN without loaded state. */
  gameState: GameState | null;
  /** Absolute AFK deadline (monotonic ms); null when no timer. EC-28/29. */
  afkDeadlineMs: number | null;
  /** When the current AFK window started (monotonic ms). */
  afkWindowStartedAtMs: number | null;
  /** Hard end of the current multi-seat / ceremony window (preserves across soft AFK). */
  phaseHardDeadlineMs: number | null;
  /** phaseTimerKey for the armed window — cleared when phase window changes. */
  phaseTimerKey: string | null;
  /** Seats marked deferred AFK (bots act after non-deferred finish). */
  deferredAfkPlayerIds: Set<string>;
  /** Next GameEvent seq for this room (1-based after first event). */
  nextEventSeq: number;
  /** Max snapshot version written. */
  maxSnapshotVersion: number;
  dedup: ActionDedupStore;
  /** playerId → writable socketId */
  writableByPlayer: Map<string, string>;
  /** socketId → binding */
  sockets: Map<string, SocketBinding>;
  /** Last time any socket disconnected leaving zero connections (IN_PROGRESS). */
  lastSocketGoneAtMs: number | null;
  frozenReason: string | null;
  incidentAtMs: number | null;
  /** Pending persistence jobs when DB was unreachable (EC-78). */
  pendingPersistJobs: PersistJob[];
};

export type PersistJob = {
  readonly kind: 'events' | 'snapshot' | 'status';
  readonly payload: unknown;
};

export function createRoomRuntime(input: {
  readonly roomId: string;
  readonly roomCode: string;
  readonly lobby: LobbyRoom;
  readonly status?: RoomStatus;
  readonly gameState?: GameState | null;
}): RoomRuntime {
  return {
    roomId: input.roomId,
    roomCode: input.roomCode,
    status: input.status ?? 'LOBBY',
    lobby: input.lobby,
    gameState: input.gameState ?? null,
    afkDeadlineMs: null,
    afkWindowStartedAtMs: null,
    phaseHardDeadlineMs: null,
    phaseTimerKey: null,
    deferredAfkPlayerIds: new Set(),
    nextEventSeq: 1,
    maxSnapshotVersion: 0,
    dedup: createMemoryActionDedupStore(),
    writableByPlayer: new Map(),
    sockets: new Map(),
    lastSocketGoneAtMs: null,
    frozenReason: null,
    incidentAtMs: null,
    pendingPersistJobs: [],
  };
}

export class RoomRegistry {
  private readonly rooms = new Map<string, RoomRuntime>();
  private readonly byCode = new Map<string, string>();

  get(roomId: string): RoomRuntime | undefined {
    return this.rooms.get(roomId);
  }

  getByCode(roomCode: string): RoomRuntime | undefined {
    const id = this.byCode.get(roomCode.toUpperCase());
    return id ? this.rooms.get(id) : undefined;
  }

  set(runtime: RoomRuntime): void {
    this.rooms.set(runtime.roomId, runtime);
    this.byCode.set(runtime.roomCode.toUpperCase(), runtime.roomId);
  }

  delete(roomId: string): void {
    const rt = this.rooms.get(roomId);
    if (rt) {
      this.byCode.delete(rt.roomCode.toUpperCase());
      this.rooms.delete(roomId);
    }
  }

  listFrozen(): readonly RoomRuntime[] {
    return [...this.rooms.values()].filter((r) => r.status === 'FROZEN');
  }

  all(): readonly RoomRuntime[] {
    return [...this.rooms.values()];
  }

  hasCode(roomCode: string): boolean {
    return this.byCode.has(roomCode.toUpperCase());
  }
}
