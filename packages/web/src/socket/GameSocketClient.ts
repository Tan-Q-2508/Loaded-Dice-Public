import { io, type Socket } from 'socket.io-client';
import {
  ClientEvents,
  ServerEvents,
  PROTOCOL_VERSION,
  stateSyncSchema,
  stateUpdateSchema,
  roomCreatedSchema,
  roomJoinedSchema,
  actionRejectedSchema,
  actionDedupedSchema,
  roomFrozenSchema,
  errorSchema,
  protocolMismatchSchema,
  helloOkSchema,
  type GameActionPayload,
} from '@shaatir-shakuni/socket-api';
import { buildEnvelope } from '../lib/envelope';
import { useGameStore } from '../store/gameStore';

export type GameSocketClientOptions = {
  readonly url: string;
  /** Injected for tests — defaults to socket.io `io`. */
  readonly createSocket?: (url: string) => Socket;
};

/**
 * Thin Socket.IO façade. Mirrors `state:sync` / `state:update` into the Zustand
 * store only — never invents phase/role/win state.
 */
export class GameSocketClient {
  private socket: Socket | null = null;
  private readonly url: string;
  private readonly createSocket: (url: string) => Socket;
  private helloDone = false;
  private intentionalDisconnect = false;

  constructor(opts: GameSocketClientOptions) {
    this.url = opts.url;
    this.createSocket = opts.createSocket ?? ((url) => io(url, { autoConnect: false }));
  }

  get isConnected(): boolean {
    return this.socket?.connected ?? false;
  }

  connect(): void {
    if (this.socket) return;

    const store = useGameStore.getState();
    store.setConnecting();
    this.intentionalDisconnect = false;

    const socket = this.createSocket(this.url);
    this.socket = socket;
    this.bindServerEvents(socket);

    socket.on('connect', () => {
      this.helloDone = false;
      socket.emit(ClientEvents.HELLO, { protocolVersion: PROTOCOL_VERSION });
    });

    socket.on('disconnect', (reason: string) => {
      if (this.intentionalDisconnect || reason === 'io client disconnect') return;
      useGameStore.getState().setReconnecting();
    });

    socket.on('connect_error', (err: Error) => {
      useGameStore.getState().setConnectionError(err.message || 'Connection failed');
    });

    socket.connect();
  }

  disconnect(): void {
    if (!this.socket) return;
    this.intentionalDisconnect = true;
    this.socket.removeAllListeners();
    this.socket.disconnect();
    this.socket = null;
    this.helloDone = false;
  }

  createRoom(displayName: string, rebalanceEnabled?: boolean): void {
    // Drop any prior seat first so an old room's state:update cannot clobber the new one.
    this.leaveRoom();
    const sequence = useGameStore.getState().bumpSequence();
    this.emit(
      ClientEvents.ROOM_CREATE,
      buildEnvelope(
        {
          displayName,
          ...(rebalanceEnabled !== undefined ? { rebalanceEnabled } : {}),
        },
        { sequence, stateVersion: 0 },
      ),
    );
  }

  joinRoom(roomCode: string, displayName: string): void {
    this.leaveRoom();
    const sequence = useGameStore.getState().bumpSequence();
    this.emit(
      ClientEvents.ROOM_JOIN,
      buildEnvelope(
        { roomCode, displayName },
        { sequence, stateVersion: 0 },
      ),
    );
  }

  leaveRoom(): void {
    const { roomId, bumpSequence, view, clearSession } = useGameStore.getState();
    if (!roomId) {
      clearSession();
      return;
    }
    // Always tell the server to detach — lobby leave removes the seat; mid-game
    // only unbinds the socket so stale broadcasts stop following this tab.
    const sequence = bumpSequence();
    this.emit(
      ClientEvents.ROOM_LEAVE,
      buildEnvelope(
        { roomId },
        { sequence, stateVersion: view?.stateVersion ?? 0 },
      ),
    );
    clearSession();
  }

  playAgain(): void {
    const { roomId, bumpSequence, view } = useGameStore.getState();
    if (!roomId) return;
    const sequence = bumpSequence();
    this.emit(
      ClientEvents.ROOM_PLAY_AGAIN,
      buildEnvelope(
        { roomId },
        { sequence, stateVersion: view?.stateVersion ?? 0 },
      ),
    );
  }

  startGame(): void {
    const { roomId, bumpSequence, view } = useGameStore.getState();
    if (!roomId) return;
    const sequence = bumpSequence();
    this.emit(
      ClientEvents.ROOM_START,
      buildEnvelope(
        { roomId },
        { sequence, stateVersion: view?.stateVersion ?? 0 },
      ),
    );
  }

  setRebalance(rebalanceEnabled: boolean): void {
    const { roomId, bumpSequence, view } = useGameStore.getState();
    if (!roomId) return;
    const sequence = bumpSequence();
    this.emit(
      ClientEvents.ROOM_SET_REBALANCE,
      buildEnvelope(
        { roomId, rebalanceEnabled },
        { sequence, stateVersion: view?.stateVersion ?? 0 },
      ),
    );
  }

  reconnectWithToken(authToken: string): void {
    const sequence = useGameStore.getState().bumpSequence();
    const stateVersion = useGameStore.getState().view?.stateVersion ?? 0;
    this.emit(
      ClientEvents.SESSION_RECONNECT,
      buildEnvelope({ authToken }, { sequence, stateVersion }),
    );
  }

  /**
   * Send a game intent. Server validates legality; client must not invent rules.
   */
  sendGameAction(payload: GameActionPayload): void {
    const { bumpSequence, view, readOnly, roomFrozen } = useGameStore.getState();
    if (readOnly || roomFrozen) {
      useGameStore.getState().setLastError('This connection cannot submit actions');
      return;
    }
    if (!view || view.isSpectator) {
      useGameStore.getState().setLastError('Spectators cannot submit actions');
      return;
    }
    const sequence = bumpSequence();
    this.emit(
      ClientEvents.GAME_ACTION,
      buildEnvelope(payload, {
        sequence,
        stateVersion: view.stateVersion,
      }),
    );
  }

  private emit(event: string, payload: unknown): void {
    if (!this.socket?.connected) {
      useGameStore.getState().setLastError('Not connected to server');
      return;
    }
    this.socket.emit(event, payload);
  }

  private bindServerEvents(socket: Socket): void {
    socket.on(ServerEvents.HELLO_OK, (raw: unknown) => {
      const parsed = helloOkSchema.safeParse(raw);
      if (!parsed.success) return;
      this.helloDone = true;
      const token = useGameStore.getState().hydrateSession();
      if (token) {
        if (useGameStore.getState().view) {
          useGameStore.getState().setReconnecting();
        }
        this.reconnectWithToken(token);
      } else {
        useGameStore.getState().setReady();
      }
    });

    socket.on(ServerEvents.PROTOCOL_MISMATCH, (raw: unknown) => {
      const parsed = protocolMismatchSchema.safeParse(raw);
      const msg = parsed.success
        ? `Protocol mismatch (client ${parsed.data.clientVersion}, server ${parsed.data.serverVersion})`
        : 'Protocol mismatch';
      useGameStore.getState().setProtocolMismatch(msg);
    });

    socket.on(ServerEvents.ROOM_CREATED, (raw: unknown) => {
      const parsed = roomCreatedSchema.safeParse(raw);
      if (!parsed.success) return;
      useGameStore.getState().applySession(parsed.data);
    });

    socket.on(ServerEvents.ROOM_JOINED, (raw: unknown) => {
      const parsed = roomJoinedSchema.safeParse(raw);
      if (!parsed.success) return;
      useGameStore.getState().applySession(parsed.data);
    });

    socket.on(ServerEvents.STATE_SYNC, (raw: unknown) => {
      const parsed = stateSyncSchema.safeParse(raw);
      if (!parsed.success) {
        // Surface schema drift (e.g. server/web build mismatch) instead of a blank screen.
        const detail = parsed.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ');
        useGameStore
          .getState()
          .setLastError(`Invalid game state from server (${detail})`);
        if (import.meta.env.DEV) {
          console.error('[state:sync] schema mismatch', parsed.error.issues, raw);
        }
        return;
      }
      const store = useGameStore.getState();
      if (!this.acceptViewForSession(parsed.data.view.roomId)) return;
      store.applyView(parsed.data.view);
      this.markReadyAfterView();
      // EC-13 — persist rotated token; previous token is immediately invalid.
      if (parsed.data.authToken) {
        store.applyRotatedAuthToken(parsed.data.authToken);
      }
      if (parsed.data.view.roomId) {
        // roomCode may already be known from create/join; keep it if present
        const { roomCode } = useGameStore.getState();
        if (roomCode) {
          useGameStore.setState({ roomCode });
        }
      }
    });

    socket.on(ServerEvents.STATE_UPDATE, (raw: unknown) => {
      const parsed = stateUpdateSchema.safeParse(raw);
      if (!parsed.success) {
        const detail = parsed.error.issues
          .slice(0, 3)
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ');
        useGameStore
          .getState()
          .setLastError(`Invalid game state from server (${detail})`);
        if (import.meta.env.DEV) {
          console.error('[state:update] schema mismatch', parsed.error.issues, raw);
        }
        return;
      }
      if (!this.acceptViewForSession(parsed.data.view.roomId)) return;
      useGameStore.getState().applyView(parsed.data.view);
      this.markReadyAfterView();
    });

    socket.on(ServerEvents.ACTION_REJECTED, (raw: unknown) => {
      const parsed = actionRejectedSchema.safeParse(raw);
      if (!parsed.success) return;
      const store = useGameStore.getState();
      // Must run before setLastError so a stale `nextSequence` never lingers
      // past the point the user sees the rejection and might retry.
      store.rollbackSequenceIfNotConsumed(parsed.data.code);
      // Stale token after server restart / expired room — drop local session so
      // /game does not sit forever on "Syncing…" with Create room unreachable.
      if (
        parsed.data.code === 'UNAUTHORIZED' ||
        parsed.data.code === 'SESSION_EXPIRED'
      ) {
        store.clearSession();
      }
      store.setLastError(parsed.data.message);
    });

    socket.on(ServerEvents.ACTION_DEDUPED, (raw: unknown) => {
      const parsed = actionDedupedSchema.safeParse(raw);
      if (!parsed.success) return;
      useGameStore.getState().clearPendingSequence();
      useGameStore.getState().noteActionDeduped(parsed.data.actionUuid);
    });

    socket.on(ServerEvents.ROOM_FROZEN, (raw: unknown) => {
      const parsed = roomFrozenSchema.safeParse(raw);
      if (!parsed.success) return;
      useGameStore.getState().applyRoomFrozen({
        reasonCategory: parsed.data.reasonCategory,
        mode: parsed.data.mode,
      });
    });

    socket.on(ServerEvents.ERROR, (raw: unknown) => {
      const parsed = errorSchema.safeParse(raw);
      if (!parsed.success) return;
      useGameStore.getState().setLastError(parsed.data.message);
    });

    socket.on(ServerEvents.SESSION_READ_ONLY, () => {
      useGameStore.getState().setReadOnly(true);
      useGameStore
        .getState()
        .setLastError('This tab is read-only; another connection took over.');
    });
  }

  /**
   * Ignore wire views unless they match the active session room.
   * After Exit/create/join clear, `roomId` is null until `room:created` /
   * `room:joined` / hydrate+reconnect — that gap must not accept stray updates
   * from a previous seat.
   */
  private markReadyAfterView(): void {
    const phase = useGameStore.getState().connectionPhase;
    if (phase === 'reconnecting' || phase === 'connecting') {
      useGameStore.getState().setReady();
    }
  }

  private acceptViewForSession(viewRoomId: string): boolean {
    const { roomId } = useGameStore.getState();
    if (!roomId) return false;
    return roomId === viewRoomId;
  }

  /** Test helper — whether hello completed. */
  get hasCompletedHello(): boolean {
    return this.helloDone;
  }
}

export function defaultSocketUrl(): string {
  return import.meta.env.VITE_SOCKET_URL ?? 'http://localhost:3001';
}
