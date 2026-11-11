import type { GameState } from '@shaatir-shakuni/engine';
import type { RoomStatus, StoredEvent, StoredSnapshot } from '@shaatir-shakuni/db';
import type {
  AppendEventInput,
  FrozenRoomInfo,
  PersistencePort,
} from './persist.js';

type MemSession = {
  sessionId: string;
  playerId: string;
  roomId: string;
  authToken: string;
  socketId: string | null;
  lastSeenAtMs: number;
};

type MemRoom = {
  roomId: string;
  roomCode: string;
  status: RoomStatus;
  frozenReason: string | null;
  incidentAtMs: number | null;
  hostPlayerId: string;
  rebalanceEnabled: boolean;
};

/**
 * In-memory PersistencePort for unit tests and default `npm test` (no live Postgres).
 */
export class MemoryPersistence implements PersistencePort {
  private available = true;
  private readonly rooms = new Map<string, MemRoom>();
  private readonly codes = new Set<string>();
  private readonly events = new Map<string, AppendEventInput[]>();
  private readonly snapshots = new Map<string, { version: number; state: GameState }[]>();
  private readonly sessionsByToken = new Map<string, MemSession>();
  private readonly sessionsById = new Map<string, MemSession>();

  /** Test hook: force next appendEvents to throw (EC-75). */
  failNextAppend = false;
  /** Test hook: force next writeSnapshot to throw. */
  failNextSnapshot = false;
  /** Test hook: force next updateSession to throw (reconnect persist blip). */
  failNextUpdateSession = false;

  isAvailable(): boolean {
    return this.available;
  }

  setAvailable(available: boolean): void {
    this.available = available;
  }

  async ping(): Promise<boolean> {
    return this.available;
  }

  async roomCodeExists(code: string): Promise<boolean> {
    return this.codes.has(code.toUpperCase());
  }

  async saveNewRoom(input: {
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
  }): Promise<void> {
    if (!this.available) {
      throw new Error('DB_UNAVAILABLE');
    }
    this.rooms.set(input.roomId, {
      roomId: input.roomId,
      roomCode: input.roomCode,
      status: 'LOBBY',
      frozenReason: null,
      incidentAtMs: null,
      hostPlayerId: input.hostPlayerId,
      rebalanceEnabled: input.rebalanceEnabled,
    });
    this.codes.add(input.roomCode.toUpperCase());
    this.events.set(input.roomId, []);
    this.snapshots.set(input.roomId, []);
    for (const s of input.sessions) {
      const mem: MemSession = {
        sessionId: s.id,
        playerId: s.playerId,
        roomId: input.roomId,
        authToken: s.authToken,
        socketId: s.socketId,
        lastSeenAtMs: s.lastSeenAtMs,
      };
      this.sessionsByToken.set(s.authToken, mem);
      this.sessionsById.set(s.id, mem);
    }
  }

  async updateRoomStatus(
    roomId: string,
    status: RoomStatus,
    extras?: { readonly frozenReason?: string | null; readonly incidentAtMs?: number | null },
  ): Promise<void> {
    if (!this.available) {
      throw new Error('DB_UNAVAILABLE');
    }
    const room = this.rooms.get(roomId);
    if (!room) throw new Error(`Unknown room ${roomId}`);
    room.status = status;
    if (extras?.frozenReason !== undefined) room.frozenReason = extras.frozenReason;
    if (extras?.incidentAtMs !== undefined) room.incidentAtMs = extras.incidentAtMs;
  }

  async appendEvents(events: readonly AppendEventInput[]): Promise<void> {
    if (!this.available) {
      throw new Error('DB_UNAVAILABLE');
    }
    if (this.failNextAppend) {
      this.failNextAppend = false;
      throw new Error('APPEND_FAILED');
    }
    for (const ev of events) {
      const list = this.events.get(ev.roomId) ?? [];
      list.push(ev);
      this.events.set(ev.roomId, list);
    }
  }

  async writeSnapshot(roomId: string, version: number, state: GameState): Promise<void> {
    if (!this.available) {
      throw new Error('DB_UNAVAILABLE');
    }
    if (this.failNextSnapshot) {
      this.failNextSnapshot = false;
      throw new Error('SNAPSHOT_FAILED');
    }
    const list = this.snapshots.get(roomId) ?? [];
    list.push({ version, state });
    this.snapshots.set(roomId, list);
  }

  async loadRecoveryData(roomId: string): Promise<{
    readonly snapshots: readonly StoredSnapshot[];
    readonly events: readonly StoredEvent[];
  }> {
    const snaps = (this.snapshots.get(roomId) ?? []).map((s) => ({
      version: s.version,
      stateJson: JSON.stringify(s.state),
    }));
    const evs = (this.events.get(roomId) ?? []).map((e) => ({
      seq: e.seq,
      stateVersion: e.stateVersion,
      payload: e.payload,
      ...(e.sourceAction !== undefined ? { sourceAction: e.sourceAction } : {}),
    }));
    return { snapshots: snaps, events: evs };
  }

  /** Enriched events including sourceAction for replay tests. */
  async loadRecoverableEvents(roomId: string): Promise<
    readonly (StoredEvent & { readonly sourceAction?: unknown })[]
  > {
    return (this.events.get(roomId) ?? []).map((e) => ({
      seq: e.seq,
      stateVersion: e.stateVersion,
      payload: e.payload,
      ...(e.sourceAction !== undefined ? { sourceAction: e.sourceAction } : {}),
    }));
  }

  async listFrozenRooms(): Promise<readonly FrozenRoomInfo[]> {
    return [...this.rooms.values()]
      .filter((r) => r.status === 'FROZEN')
      .map((r) => {
        const snaps = this.snapshots.get(r.roomId) ?? [];
        const maxVer = snaps.reduce((m, s) => Math.max(m, s.version), 0);
        return {
          roomId: r.roomId,
          roomCode: r.roomCode,
          frozenReason: r.frozenReason,
          incidentAtMs: r.incidentAtMs,
          lastKnownSnapshotVersion: maxVer,
        };
      });
  }

  async findSessionByToken(authToken: string): Promise<MemSession | null> {
    return this.sessionsByToken.get(authToken) ?? null;
  }

  async updateSession(input: {
    readonly sessionId: string;
    readonly authToken?: string;
    readonly socketId?: string | null;
    readonly lastSeenAtMs?: number;
  }): Promise<void> {
    const existing = this.sessionsById.get(input.sessionId);
    if (!existing) throw new Error(`Unknown session ${input.sessionId}`);
    if (input.authToken !== undefined && input.authToken !== existing.authToken) {
      this.sessionsByToken.delete(existing.authToken);
      existing.authToken = input.authToken;
      this.sessionsByToken.set(input.authToken, existing);
    }
    if (input.socketId !== undefined) existing.socketId = input.socketId;
    if (input.lastSeenAtMs !== undefined) existing.lastSeenAtMs = input.lastSeenAtMs;
  }

  async addSession(input: {
    readonly roomId: string;
    readonly sessionId: string;
    readonly playerId: string;
    readonly displayName: string;
    readonly seatOrder: number;
    readonly joinedAtMs: number;
    readonly authToken: string;
    readonly socketId: string | null;
    readonly lastSeenAtMs: number;
  }): Promise<void> {
    if (!this.available) throw new Error('DB_UNAVAILABLE');
    void input.displayName;
    void input.seatOrder;
    void input.joinedAtMs;
    const mem: MemSession = {
      sessionId: input.sessionId,
      playerId: input.playerId,
      roomId: input.roomId,
      authToken: input.authToken,
      socketId: input.socketId,
      lastSeenAtMs: input.lastSeenAtMs,
    };
    this.sessionsByToken.set(input.authToken, mem);
    this.sessionsById.set(input.sessionId, mem);
  }

  /** Test helpers */
  getEvents(roomId: string): readonly AppendEventInput[] {
    return this.events.get(roomId) ?? [];
  }

  getSnapshots(roomId: string): readonly { version: number; state: GameState }[] {
    return this.snapshots.get(roomId) ?? [];
  }
}
