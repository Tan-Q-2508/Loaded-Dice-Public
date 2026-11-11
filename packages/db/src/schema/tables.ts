import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { CONNECTION_STATUSES, ROOM_STATUSES } from '../enums.js';

export const roomStatusEnum = pgEnum('room_status', [...ROOM_STATUSES]);
export const connectionStatusEnum = pgEnum('connection_status', [...CONNECTION_STATUSES]);

/** Per-room settings blob (timeouts, player-count bounds). */
export type RoomSettings = {
  readonly minPlayers: number;
  readonly maxPlayers: number;
  readonly roleRevealTimeoutMs?: number;
  readonly actionTimeoutMs?: number;
  readonly lobbyIdleTimeoutMs?: number;
};

export const rooms = pgTable(
  'rooms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomCode: text('room_code').notNull(),
    /** Soft reference to players.id — no FK to avoid Room↔Player cycle. */
    hostPlayerId: uuid('host_player_id'),
    status: roomStatusEnum('status').notNull().default('LOBBY'),
    rebalanceEnabled: boolean('rebalance_enabled').notNull().default(false),
    settings: jsonb('settings').$type<RoomSettings>().notNull().default({
      minPlayers: 5,
      maxPlayers: 10,
    }),
    frozenReason: text('frozen_reason'),
    incidentAt: timestamp('incident_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('rooms_room_code_uidx').on(t.roomCode),
    index('rooms_status_idx').on(t.status),
  ],
);

export const players = pgTable(
  'players',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    /** Soft reference to sessions.id — Session.playerId is the FK direction. */
    sessionId: uuid('session_id'),
    displayName: text('display_name').notNull(),
    connectionStatus: connectionStatusEnum('connection_status').notNull().default('CONNECTED'),
    seatOrder: integer('seat_order').notNull(),
    isAlive: boolean('is_alive').notNull().default(true),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('players_room_id_idx').on(t.roomId),
    uniqueIndex('players_room_seat_uidx').on(t.roomId, t.seatOrder),
  ],
);

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    socketId: text('socket_id'),
    authToken: text('auth_token').notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('sessions_auth_token_uidx').on(t.authToken),
    index('sessions_player_id_idx').on(t.playerId),
  ],
);

/**
 * Append-only authoritative event ledger.
 * Engine GameEvent JSON is stored in `payload` verbatim (EC-91 host force-end distinguishable).
 * Integrity (EC-82): no hash-chain in v1 — unique (room_id, seq) + gap detection.
 */
export const gameEvents = pgTable(
  'game_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    stateVersion: integer('state_version').notNull(),
    actionUuid: uuid('action_uuid'),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('game_events_room_seq_uidx').on(t.roomId, t.seq),
    uniqueIndex('game_events_room_action_uuid_uidx')
      .on(t.roomId, t.actionUuid)
      .where(sql`${t.actionUuid} IS NOT NULL`),
    index('game_events_room_seq_idx').on(t.roomId, t.seq),
  ],
);

export const snapshots = pgTable(
  'snapshots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    roomId: uuid('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'cascade' }),
    version: integer('version').notNull(),
    state: jsonb('state').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('snapshots_room_version_uidx').on(t.roomId, t.version),
    index('snapshots_room_version_desc_idx').on(t.roomId, t.version),
  ],
);

export type RoomRow = typeof rooms.$inferSelect;
export type NewRoom = typeof rooms.$inferInsert;
export type PlayerRow = typeof players.$inferSelect;
export type NewPlayer = typeof players.$inferInsert;
export type SessionRow = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;
export type GameEventRow = typeof gameEvents.$inferSelect;
export type NewGameEvent = typeof gameEvents.$inferInsert;
export type SnapshotRow = typeof snapshots.$inferSelect;
export type NewSnapshot = typeof snapshots.$inferInsert;
