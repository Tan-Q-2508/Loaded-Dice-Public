import { EventEmitter } from 'node:events';
import { io, type Socket } from 'socket.io-client';
import {
  ClientEvents,
  ServerEvents,
  PROTOCOL_VERSION,
  wirePlayerViewSchema,
  helloOkSchema,
  roomCreatedSchema,
  roomJoinedSchema,
  actionRejectedSchema,
  actionDedupedSchema,
  roomFrozenSchema,
  errorSchema,
  protocolMismatchSchema,
  stateSyncSchema,
  stateUpdateSchema,
  SEQUENCE_NOT_CONSUMED_CODES,
  type GameActionPayload,
  type RejectReasonCode,
  type WirePlayerView,
} from '@shaatir-shakuni/socket-api';
import { buildEnvelope } from './envelope.js';

export type BotSession = {
  readonly roomId: string;
  readonly roomCode: string;
  readonly playerId: string;
};

export type ActionRejectedEvent = {
  readonly actionUuid?: string;
  readonly code: string;
  readonly message: string;
};

export type RoomFrozenEvent = {
  readonly roomId: string;
  readonly reasonCategory: string;
  readonly mode: 'FROZEN' | 'CORRUPTED';
};

export type ServerErrorEvent = {
  readonly code: string;
  readonly message: string;
};

export type InvalidPayloadEvent = {
  readonly event: string;
  readonly issues: unknown;
};

export interface BotClientEvents {
  view: [view: WirePlayerView];
  rejected: [event: ActionRejectedEvent];
  deduped: [actionUuid: string];
  frozen: [event: RoomFrozenEvent];
  serverError: [event: ServerErrorEvent];
  readOnly: [];
  protocolMismatch: [clientVersion: number, serverVersion: number];
  invalidPayload: [event: InvalidPayloadEvent];
  disconnected: [reason: string];
  connectError: [message: string];
  /** A pending action's fallback timer cleared it without an explicit reply — re-evaluate `view`. */
  unblocked: [];
}

/**
 * Thin real-socket client for bot players. Deliberately independent of the
 * web app's Zustand-coupled `GameSocketClient` — plays like a genuine client
 * (same handshake, envelope, and schema validation) without any UI framework.
 */
export class BotClient extends EventEmitter {
  private readonly socket: Socket;
  private sequence = 1;
  private stateVersion = 0;
  private helloOk = false;
  /**
   * Tracks a single in-flight `game:action`. The server's per-connection
   * `expectedSequence` advances as soon as the sequence/state-version guard
   * passes — regardless of whether the action then turns out to be illegal
   * — so a rejection only means the number wasn't consumed when the code is
   * one of `SEQUENCE_NOT_CONSUMED_CODES` (the guard itself failed, or the
   * message never reached it, e.g. `RATE_LIMITED`). Only for those codes do
   * we roll our local counter back to the value we just used; for every
   * other rejection (e.g. `ENGINE_REJECTED`) the server already advanced,
   * so we must keep incrementing or we'd desync the other way.
   */
  private pendingAction: { readonly sequence: number; readonly stateVersionAtSend: number } | null =
    null;
  private pendingResolveTimer: NodeJS.Timeout | null = null;
  /**
   * Safety-net window: if neither an explicit rejection nor a fresh
   * assessment clears `pendingAction` within this long, assume the action
   * quietly succeeded (the common case — the server has no separate
   * per-action "accepted" event) and unblock the next decision. In practice
   * a successful action's own broadcast usually re-triggers a decision via
   * the `view` event well before this fires; this is purely a backstop.
   *
   * `ACTION_REJECTED` doesn't echo back an `actionUuid` for every reject
   * path, so this client can't always correlate a (possibly delayed)
   * rejection to the exact attempt it belongs to. Too short a window against
   * a real deployment (cross-region latency, cold starts) means this timer
   * can fire and send a *second* attempt before the first attempt's
   * rejection arrives — the eventual rollback then applies to the wrong
   * attempt and self-inflicts a sequence pile-up that looks like a server
   * bug but isn't. Configurable per instance so `remote` mode (real network)
   * can use a larger window than a same-machine throwaway server.
   */
  private readonly pendingResolveTimeoutMs: number;

  view: WirePlayerView | null = null;
  playerId: string | null = null;
  roomId: string | null = null;
  roomCode: string | null = null;
  authToken: string | null = null;

  constructor(
    readonly url: string,
    readonly displayName: string,
    pendingResolveTimeoutMs = 500,
  ) {
    super();
    this.pendingResolveTimeoutMs = pendingResolveTimeoutMs;
    // `reconnection: false` is required: a manual dropConnection()+session:reconnect
    // must not race an Engine.IO auto-reconnect that arrives without auth and
    // steals/desyncs the writable binding (QA host-reconnect stalls).
    this.socket = io(url, {
      autoConnect: false,
      reconnection: false,
      transports: ['websocket'],
    });
    if (process.env['BOT_DEBUG']) {
      this.socket.onAny((event: string) => {
        // eslint-disable-next-line no-console
        console.log(`[debug] ${this.displayName} <= ${event}`);
      });
    }
    this.bind();
  }

  override on<K extends keyof BotClientEvents>(
    event: K,
    listener: (...args: BotClientEvents[K]) => void,
  ): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  override emit<K extends keyof BotClientEvents>(
    event: K,
    ...args: BotClientEvents[K]
  ): boolean {
    return super.emit(event, ...args);
  }

  private bind(): void {
    this.socket.on('connect', () => {
      this.helloOk = false;
      this.socket.emit(ClientEvents.HELLO, { protocolVersion: PROTOCOL_VERSION });
    });

    this.socket.on('connect_error', (err: Error) => {
      this.emit('connectError', err.message || 'connect_error');
    });

    this.socket.on('disconnect', (reason: string) => {
      this.emit('disconnected', reason);
    });

    this.socket.on(ServerEvents.HELLO_OK, (raw: unknown) => {
      const parsed = helloOkSchema.safeParse(raw);
      if (!parsed.success) {
        this.emit('invalidPayload', { event: ServerEvents.HELLO_OK, issues: parsed.error.issues });
        return;
      }
      this.helloOk = true;
    });

    this.socket.on(ServerEvents.PROTOCOL_MISMATCH, (raw: unknown) => {
      const parsed = protocolMismatchSchema.safeParse(raw);
      if (!parsed.success) {
        this.emit('invalidPayload', {
          event: ServerEvents.PROTOCOL_MISMATCH,
          issues: parsed.error.issues,
        });
        return;
      }
      this.emit('protocolMismatch', parsed.data.clientVersion, parsed.data.serverVersion);
    });

    this.socket.on(ServerEvents.ROOM_CREATED, (raw: unknown) => {
      const parsed = roomCreatedSchema.safeParse(raw);
      if (!parsed.success) {
        this.emit('invalidPayload', { event: ServerEvents.ROOM_CREATED, issues: parsed.error.issues });
        return;
      }
      this.applySession(parsed.data);
    });

    this.socket.on(ServerEvents.ROOM_JOINED, (raw: unknown) => {
      const parsed = roomJoinedSchema.safeParse(raw);
      if (!parsed.success) {
        this.emit('invalidPayload', { event: ServerEvents.ROOM_JOINED, issues: parsed.error.issues });
        return;
      }
      this.applySession(parsed.data);
    });

    this.socket.on(ServerEvents.STATE_SYNC, (raw: unknown) => {
      const parsed = stateSyncSchema.safeParse(raw);
      if (!parsed.success) {
        this.emit('invalidPayload', { event: ServerEvents.STATE_SYNC, issues: parsed.error.issues });
        return;
      }
      this.applyView(parsed.data.view);
      if (parsed.data.authToken) {
        this.authToken = parsed.data.authToken;
      }
    });

    this.socket.on(ServerEvents.STATE_UPDATE, (raw: unknown) => {
      const parsed = stateUpdateSchema.safeParse(raw);
      if (!parsed.success) {
        this.emit('invalidPayload', { event: ServerEvents.STATE_UPDATE, issues: parsed.error.issues });
        return;
      }
      this.applyView(parsed.data.view);
    });

    this.socket.on(ServerEvents.ACTION_REJECTED, (raw: unknown) => {
      const parsed = actionRejectedSchema.safeParse(raw);
      if (!parsed.success) {
        this.emit('invalidPayload', {
          event: ServerEvents.ACTION_REJECTED,
          issues: parsed.error.issues,
        });
        return;
      }
      const hadPending = this.pendingAction !== null;
      if (this.pendingAction) {
        if (SEQUENCE_NOT_CONSUMED_CODES.has(parsed.data.code as RejectReasonCode)) {
          this.sequence = this.pendingAction.sequence;
        }
        this.pendingAction = null;
      }
      if (this.pendingResolveTimer) {
        clearTimeout(this.pendingResolveTimer);
        this.pendingResolveTimer = null;
      }
      this.emit('rejected', parsed.data);
      // Nudge the caller to re-decide now that we're unblocked — nobody else
      // may act again to naturally produce a fresh `view` (e.g. we were the
      // only player with a pending decision). Back off a little first: an
      // instant retry storm after STATE_VERSION_MISMATCH (very common when
      // several bots ack/vote at once) can burn through the per-socket
      // `game:action` token bucket and trip RATE_LIMITED, which would
      // otherwise just restart the same instant-retry storm.
      if (hadPending) {
        const backoffMs = parsed.data.code === 'RATE_LIMITED' ? 250 : 15 + Math.random() * 35;
        setTimeout(() => this.emit('unblocked'), backoffMs);
      }
    });

    this.socket.on(ServerEvents.ACTION_DEDUPED, (raw: unknown) => {
      const parsed = actionDedupedSchema.safeParse(raw);
      if (!parsed.success) {
        this.emit('invalidPayload', {
          event: ServerEvents.ACTION_DEDUPED,
          issues: parsed.error.issues,
        });
        return;
      }
      this.emit('deduped', parsed.data.actionUuid);
    });

    this.socket.on(ServerEvents.ROOM_FROZEN, (raw: unknown) => {
      const parsed = roomFrozenSchema.safeParse(raw);
      if (!parsed.success) {
        this.emit('invalidPayload', { event: ServerEvents.ROOM_FROZEN, issues: parsed.error.issues });
        return;
      }
      this.emit('frozen', parsed.data);
    });

    this.socket.on(ServerEvents.ERROR, (raw: unknown) => {
      const parsed = errorSchema.safeParse(raw);
      if (!parsed.success) {
        this.emit('invalidPayload', { event: ServerEvents.ERROR, issues: parsed.error.issues });
        return;
      }
      this.emit('serverError', parsed.data);
    });

    this.socket.on(ServerEvents.SESSION_READ_ONLY, () => {
      this.emit('readOnly');
    });
  }

  private applySession(data: { roomId: string; roomCode: string; authToken: string; playerId: string }): void {
    this.roomId = data.roomId;
    this.roomCode = data.roomCode;
    this.authToken = data.authToken;
    this.playerId = data.playerId;
  }

  private applyView(view: WirePlayerView): void {
    const parsed = wirePlayerViewSchema.safeParse(view);
    if (!parsed.success) {
      this.emit('invalidPayload', { event: 'view', issues: parsed.error.issues });
      return;
    }
    this.view = parsed.data;
    this.stateVersion = parsed.data.stateVersion;
    // Deliberately does NOT clear `pendingAction` just because a newer view
    // arrived: broadcasts are sent to every socket in the room, so a *newer*
    // stateVersion often reflects some *other* player's concurrent action
    // (e.g. everyone acking ROLE_REVEAL at once) — not evidence that our own
    // still-queued message resolved. Only an explicit rejection (immediate)
    // or the fallback timer in `sendGameAction` (below) clears it.
    this.emit('view', parsed.data);
  }

  /** Connects and waits for `client:hello_ok`. */
  async connect(timeoutMs = 10_000): Promise<void> {
    this.socket.connect();
    await this.waitUntil(() => this.helloOk, timeoutMs, 'hello_ok');
  }

  async createRoom(rebalanceEnabled?: boolean, timeoutMs = 10_000): Promise<BotSession> {
    const envelope = this.nextEnvelope({
      displayName: this.displayName,
      ...(rebalanceEnabled !== undefined ? { rebalanceEnabled } : {}),
    });
    this.socket.emit(ClientEvents.ROOM_CREATE, envelope);
    await this.waitUntil(() => this.playerId !== null && this.view !== null, timeoutMs, 'room:create');
    return this.requireSession();
  }

  async joinRoom(roomCode: string, timeoutMs = 10_000): Promise<BotSession> {
    const envelope = this.nextEnvelope({ roomCode, displayName: this.displayName });
    this.socket.emit(ClientEvents.ROOM_JOIN, envelope);
    await this.waitUntil(() => this.playerId !== null && this.view !== null, timeoutMs, 'room:join');
    return this.requireSession();
  }

  startGame(): void {
    if (!this.roomId) {
      throw new Error('BotClient.startGame called before joining a room');
    }
    const envelope = this.nextEnvelope({ roomId: this.roomId });
    this.socket.emit(ClientEvents.ROOM_START, envelope);
  }

  /** True while a `game:action` we sent hasn't yet been confirmed committed or rejected. */
  get hasPendingAction(): boolean {
    return this.pendingAction !== null;
  }

  /** Submits a game intent. Server is the sole legality authority. */
  sendGameAction(payload: GameActionPayload): void {
    const envelope = this.nextEnvelope(payload);
    this.pendingAction = { sequence: envelope.sequence, stateVersionAtSend: envelope.stateVersion };
    if (this.pendingResolveTimer) clearTimeout(this.pendingResolveTimer);
    this.pendingResolveTimer = setTimeout(() => {
      if (this.pendingAction?.sequence === envelope.sequence) {
        this.pendingAction = null;
        // Nothing else will naturally re-trigger a decision (no new `view`
        // arrives if this bot was the only one with something to do), so
        // nudge the caller to re-evaluate the last known view now that
        // we're unblocked.
        this.emit('unblocked');
      }
    }, this.pendingResolveTimeoutMs);
    this.socket.emit(ClientEvents.GAME_ACTION, envelope);
  }

  /**
   * Chaos: emit the same logical action twice with distinct actionUuids
   * (rapid double-click / duplicate packet). Second send uses a fresh
   * sequence so the transport accepts it; the engine/server must reject
   * or no-op the duplicate intent without corrupting state.
   */
  sendDuplicateGameAction(payload: GameActionPayload): void {
    this.sendGameAction(payload);
    // Fire-and-forget second click shortly after — does not wait for ack.
    setTimeout(() => {
      if (!this.socket.connected || this.pendingAction) return;
      this.sendGameAction(payload);
    }, 5 + Math.floor(Math.random() * 20));
  }

  /**
   * Chaos: submit with a deliberately stale `stateVersion` to probe
   * STATE_VERSION_MISMATCH rejection.
   */
  sendStaleGameAction(payload: GameActionPayload): void {
    const staleVersion = Math.max(0, this.stateVersion - 1);
    const sequence = this.sequence;
    this.sequence += 1;
    const envelope = buildEnvelope(payload, {
      sequence,
      stateVersion: staleVersion,
    });
    this.pendingAction = { sequence, stateVersionAtSend: staleVersion };
    if (this.pendingResolveTimer) clearTimeout(this.pendingResolveTimer);
    this.pendingResolveTimer = setTimeout(() => {
      if (this.pendingAction?.sequence === sequence) {
        this.pendingAction = null;
        this.emit('unblocked');
      }
    }, this.pendingResolveTimeoutMs);
    this.socket.emit(ClientEvents.GAME_ACTION, envelope);
  }

  /** Soft-disconnect the socket without destroying the client (browser refresh / drop). */
  dropConnection(): void {
    if (this.pendingResolveTimer) {
      clearTimeout(this.pendingResolveTimer);
      this.pendingResolveTimer = null;
    }
    this.pendingAction = null;
    this.helloOk = false;
    // Clear so `reconnectSession` waits for a fresh `state:sync`, not a stale view.
    this.view = null;
    this.socket.disconnect();
  }

  /**
   * Reconnect using the persisted auth token (`session:reconnect`), simulating
   * a browser refresh that restores the session.
   */
  async reconnectSession(timeoutMs = 8_000): Promise<void> {
    if (!this.authToken) {
      throw new Error('BotClient.reconnectSession requires an authToken');
    }
    const token = this.authToken;
    this.helloOk = false;
    this.view = null;
    if (!this.socket.connected) {
      this.socket.connect();
      await this.waitUntil(() => this.helloOk, timeoutMs, 'hello_ok(reconnect)');
    }
    // Reset transport sequence after a fresh socket (server tracks per-socket).
    this.sequence = 1;
    this.pendingAction = null;
    const envelope = this.nextEnvelope({ authToken: token });
    this.socket.emit(ClientEvents.SESSION_RECONNECT, envelope);
    await this.waitUntil(
      () => this.view !== null && this.helloOk,
      timeoutMs,
      'session:reconnect',
    );
  }

  close(): void {
    if (this.pendingResolveTimer) {
      clearTimeout(this.pendingResolveTimer);
      this.pendingResolveTimer = null;
    }
    this.socket.removeAllListeners();
    this.socket.disconnect();
  }

  private requireSession(): BotSession {
    if (!this.roomId || !this.roomCode || !this.playerId) {
      throw new Error('BotClient session incomplete after create/join');
    }
    return { roomId: this.roomId, roomCode: this.roomCode, playerId: this.playerId };
  }

  private nextEnvelope<TPayload>(payload: TPayload) {
    const sequence = this.sequence;
    this.sequence += 1;
    return buildEnvelope(payload, { sequence, stateVersion: this.stateVersion });
  }

  private async waitUntil(
    predicate: () => boolean,
    timeoutMs: number,
    label: string,
  ): Promise<void> {
    if (predicate()) return;
    const start = Date.now();
    return new Promise((resolve, reject) => {
      const check = () => {
        if (predicate()) {
          resolve();
          return;
        }
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Timed out waiting for ${label} after ${timeoutMs}ms`));
          return;
        }
        setTimeout(check, 25);
      };
      check();
    });
  }
}
