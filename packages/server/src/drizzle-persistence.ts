import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import type { GameState } from '@shaatir-shakuni/engine';
import {
  gameEvents,
  players,
  rooms,
  sessions,
  snapshots,
  type RoomStatus,
  type StoredEvent,
  type StoredSnapshot,
} from '@shaatir-shakuni/db';
import type {
  AppendEventInput,
  FrozenRoomInfo,
  PersistencePort,
} from './persist.js';

/** Envelope stored in game_events.payload so recovery can re-apply sourceAction (EC-79). */
type EventPayloadEnvelope = {
  readonly event: unknown;
  readonly sourceAction?: unknown;
};

function toDate(ms: number): Date {
  return new Date(ms);
}

/**
 * Client options for postgres.js.
 * - `prepare: false` is required for Supabase transaction pooler (PgBouncer).
 * - `ssl: 'require'` for non-local hosts (Supabase / Railway).
 * - `statement_timeout` so a wedged query cannot hold the room writer queue
 *   forever (seen as silent stalls under concurrent multi-room load).
 */
export function postgresClientOptions(databaseUrl: string): {
  readonly max: number;
  readonly prepare: false;
  readonly connect_timeout: number;
  readonly idle_timeout: number;
  readonly connection: { readonly statement_timeout: number };
  readonly ssl?: 'require';
} {
  const local = /@(localhost|127\.0\.0\.1)(:|\/|$)/i.test(databaseUrl);
  return {
    max: 10,
    prepare: false,
    connect_timeout: 10,
    // Release idle clients back to the pooler promptly under bursty load.
    idle_timeout: 20,
    // Milliseconds — Postgres GUC applied on each new backend connection.
    connection: { statement_timeout: 8_000 },
    ...(local ? {} : { ssl: 'require' as const }),
  };
}

/**
 * Postgres PersistencePort via Drizzle. Selected when DATABASE_URL is set.
 */
export class DrizzlePersistence implements PersistencePort {
  private available: boolean;
  private readonly sql: ReturnType<typeof postgres>;
  private readonly db: PostgresJsDatabase;

  constructor(databaseUrl: string) {
    this.sql = postgres(databaseUrl, postgresClientOptions(databaseUrl));
    this.db = drizzle(this.sql);
    this.available = true;
  }

  isAvailable(): boolean {
    return this.available;
  }

  setAvailable(available: boolean): void {
    this.available = available;
  }

  async ping(): Promise<boolean> {
    try {
      await this.sql`select 1 as ok`;
      this.available = true;
      return true;
    } catch {
      this.available = false;
      return false;
    }
  }

  async close(): Promise<void> {
    await this.sql.end({ timeout: 5 });
  }

  async roomCodeExists(code: string): Promise<boolean> {
    const rows = await this.db
      .select({ id: rooms.id })
      .from(rooms)
      .where(eq(rooms.roomCode, code.toUpperCase()))
      .limit(1);
    return rows.length > 0;
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
    if (!this.available) throw new Error('DB_UNAVAILABLE');
    await this.db.transaction(async (tx) => {
      await tx.insert(rooms).values({
        id: input.roomId,
        roomCode: input.roomCode.toUpperCase(),
        hostPlayerId: input.hostPlayerId,
        status: 'LOBBY',
        rebalanceEnabled: input.rebalanceEnabled,
      });
      for (const p of input.players) {
        await tx.insert(players).values({
          id: p.id,
          roomId: input.roomId,
          sessionId: p.sessionId,
          displayName: p.displayName,
          seatOrder: p.seatOrder,
          joinedAt: toDate(p.joinedAtMs),
        });
      }
      for (const s of input.sessions) {
        await tx.insert(sessions).values({
          id: s.id,
          playerId: s.playerId,
          authToken: s.authToken,
          socketId: s.socketId,
          lastSeenAt: toDate(s.lastSeenAtMs),
        });
      }
    });
  }

  async updateRoomStatus(
    roomId: string,
    status: RoomStatus,
    extras?: { readonly frozenReason?: string | null; readonly incidentAtMs?: number | null },
  ): Promise<void> {
    if (!this.available) throw new Error('DB_UNAVAILABLE');
    await this.db
      .update(rooms)
      .set({
        status,
        updatedAt: new Date(),
        ...(extras?.frozenReason !== undefined
          ? { frozenReason: extras.frozenReason }
          : {}),
        ...(extras?.incidentAtMs !== undefined
          ? {
              incidentAt:
                extras.incidentAtMs === null ? null : toDate(extras.incidentAtMs),
            }
          : {}),
      })
      .where(eq(rooms.id, roomId));
  }

  async appendEvents(events: readonly AppendEventInput[]): Promise<void> {
    if (!this.available) throw new Error('DB_UNAVAILABLE');
    if (events.length === 0) return;
    await this.db.insert(gameEvents).values(
      events.map((ev) => {
        const envelope: EventPayloadEnvelope = {
          event: ev.payload,
          ...(ev.sourceAction !== undefined ? { sourceAction: ev.sourceAction } : {}),
        };
        return {
          roomId: ev.roomId,
          seq: ev.seq,
          stateVersion: ev.stateVersion,
          actionUuid: ev.actionUuid,
          eventType: ev.eventType,
          payload: envelope,
        };
      }),
    );
  }

  async writeSnapshot(roomId: string, version: number, state: GameState): Promise<void> {
    if (!this.available) throw new Error('DB_UNAVAILABLE');
    await this.db
      .insert(snapshots)
      .values({
        roomId,
        version,
        state,
      })
      .onConflictDoNothing();
  }

  async loadRecoveryData(roomId: string): Promise<{
    readonly snapshots: readonly StoredSnapshot[];
    readonly events: readonly StoredEvent[];
  }> {
    const snapRows = await this.db
      .select()
      .from(snapshots)
      .where(eq(snapshots.roomId, roomId));
    const eventRows = await this.db
      .select()
      .from(gameEvents)
      .where(eq(gameEvents.roomId, roomId));

    const snaps: StoredSnapshot[] = snapRows.map((s) => ({
      version: s.version,
      stateJson: JSON.stringify(s.state),
    }));

    const evs: (StoredEvent & { readonly sourceAction?: unknown })[] = eventRows.map((e) => {
      const raw = e.payload as EventPayloadEnvelope | unknown;
      if (
        typeof raw === 'object' &&
        raw !== null &&
        'event' in raw
      ) {
        const env = raw as EventPayloadEnvelope;
        return {
          seq: e.seq,
          stateVersion: e.stateVersion,
          payload: env.event,
          ...(env.sourceAction !== undefined ? { sourceAction: env.sourceAction } : {}),
        };
      }
      return {
        seq: e.seq,
        stateVersion: e.stateVersion,
        payload: raw,
      };
    });

    return { snapshots: snaps, events: evs };
  }

  async listFrozenRooms(): Promise<readonly FrozenRoomInfo[]> {
    const frozen = await this.db
      .select()
      .from(rooms)
      .where(eq(rooms.status, 'FROZEN'));
    const result: FrozenRoomInfo[] = [];
    for (const r of frozen) {
      const versions = await this.db
        .select({ version: snapshots.version })
        .from(snapshots)
        .where(eq(snapshots.roomId, r.id));
      const maxVer = versions.reduce((m, s) => Math.max(m, s.version), 0);
      result.push({
        roomId: r.id,
        roomCode: r.roomCode,
        frozenReason: r.frozenReason,
        incidentAtMs: r.incidentAt ? r.incidentAt.getTime() : null,
        lastKnownSnapshotVersion: maxVer,
      });
    }
    return result;
  }

  async findSessionByToken(authToken: string): Promise<{
    readonly sessionId: string;
    readonly playerId: string;
    readonly roomId: string;
    readonly authToken: string;
    readonly socketId: string | null;
    readonly lastSeenAtMs: number;
  } | null> {
    const rows = await this.db
      .select({
        sessionId: sessions.id,
        playerId: sessions.playerId,
        authToken: sessions.authToken,
        socketId: sessions.socketId,
        lastSeenAt: sessions.lastSeenAt,
        roomId: players.roomId,
      })
      .from(sessions)
      .innerJoin(players, eq(sessions.playerId, players.id))
      .where(eq(sessions.authToken, authToken))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return {
      sessionId: row.sessionId,
      playerId: row.playerId,
      roomId: row.roomId,
      authToken: row.authToken,
      socketId: row.socketId,
      lastSeenAtMs: row.lastSeenAt.getTime(),
    };
  }

  async updateSession(input: {
    readonly sessionId: string;
    readonly authToken?: string;
    readonly socketId?: string | null;
    readonly lastSeenAtMs?: number;
  }): Promise<void> {
    if (!this.available) throw new Error('DB_UNAVAILABLE');
    await this.db
      .update(sessions)
      .set({
        ...(input.authToken !== undefined ? { authToken: input.authToken } : {}),
        ...(input.socketId !== undefined ? { socketId: input.socketId } : {}),
        ...(input.lastSeenAtMs !== undefined
          ? { lastSeenAt: toDate(input.lastSeenAtMs) }
          : {}),
      })
      .where(eq(sessions.id, input.sessionId));
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
    await this.db.transaction(async (tx) => {
      await tx.insert(players).values({
        id: input.playerId,
        roomId: input.roomId,
        sessionId: input.sessionId,
        displayName: input.displayName,
        seatOrder: input.seatOrder,
        joinedAt: toDate(input.joinedAtMs),
      });
      await tx.insert(sessions).values({
        id: input.sessionId,
        playerId: input.playerId,
        authToken: input.authToken,
        socketId: input.socketId,
        lastSeenAt: toDate(input.lastSeenAtMs),
      });
    });
  }
}

/** Factory used by main — throws if URL missing/invalid at construction time. */
export function createDrizzlePersistence(databaseUrl: string): DrizzlePersistence {
  if (!databaseUrl.trim()) {
    throw new Error('DATABASE_URL is empty');
  }
  return new DrizzlePersistence(databaseUrl);
}

/** Test helper: construct without connecting (for unavailable-path unit tests). */
export function drizzlePersistenceContractSmoke(): {
  readonly requiresUrl: true;
  readonly adapterName: 'DrizzlePersistence';
} {
  return { requiresUrl: true, adapterName: 'DrizzlePersistence' };
}
