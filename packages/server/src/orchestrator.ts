import { randomInt, randomUUID } from 'node:crypto';
import {
  assertCanSubmitAction,
  isSocketWritable,
  registerWritableConnection,
  validateAndRotateSession,
  UNAUTHORIZED_SESSION_MESSAGE,
} from '@shaatir-shakuni/auth';
import {
  createInitialState,
  type Clock,
} from '@shaatir-shakuni/engine';
import {
  allocateRoomCode,
  createRoom,
  joinRoom,
  leaveLobby,
  resetToRematchLobby,
  setRebalance,
  buildStartGameAction,
  type LobbyRoom,
} from '@shaatir-shakuni/lobby';
import {
  applyDisconnect,
  performReconnect,
  type TimeoutConfig,
} from '@shaatir-shakuni/reconnect';
import {
  buildStateSyncPayload,
  checkActionDedup,
  checkChatGate,
  checkClientHello,
  checkConnectionGuards,
  parseInboundEvent,
  rememberActionUuid,
  ClientEvents,
  ServerEvents,
  PROTOCOL_VERSION,
  type ChatSendMessage,
  type GameActionMessage,
  type RoomCreateMessage,
  type RoomJoinMessage,
  type RoomLeaveMessage,
  type RoomPlayAgainMessage,
  type RoomSetRebalanceMessage,
  type RoomStartMessage,
  type SessionReconnectMessage,
  type ClientHello,
} from '@shaatir-shakuni/socket-api';
import { isHostForceEndPayload } from '@shaatir-shakuni/db';
import { wirePayloadToGameAction } from './action-map.js';
import { broadcastRoomState, emitFrozen, emitRejected, type EmitFn } from './broadcast.js';
import { resetGameStateForRematch, syncLobbyIntoGameState } from './lobby-sync.js';
import { createIncidentLogger, type IncidentLogger } from './freeze-log.js';
import type { PersistencePort } from './persist.js';
import {
  applyAndCommit,
  freezeRoom,
  recoverRoom,
  resumeFrozenRoom,
} from './recovery.js';
import { RoomQueue } from './room-queue.js';
import {
  createRoomRuntime,
  RoomRegistry,
  type RoomRuntime,
  type SocketBinding,
} from './room-runtime.js';
import { TimerHost } from './timers.js';
import type { MemoryPersistence } from './memory-persistence.js';
import {
  RATE_LIMITED_MESSAGE,
  SocketRateLimiter,
} from './rate-limit.js';

export type OrchestratorOptions = {
  readonly persist: PersistencePort;
  readonly clock: Clock;
  readonly emit: EmitFn;
  readonly incidents?: IncidentLogger;
  readonly memoryPersist?: MemoryPersistence;
  /** Injectable for tests; defaults to buckets keyed by socket id using `clock.now`. */
  readonly rateLimiter?: SocketRateLimiter;
  /** AFK / table-ceremony windows — defaults to production `DEFAULT_TIMEOUTS`. */
  readonly timeouts?: TimeoutConfig;
};

/**
 * Thin orchestration façade — no game rules. All room mutations go through RoomQueue.
 */
export class Orchestrator {
  readonly registry = new RoomRegistry();
  readonly queue = new RoomQueue();
  readonly incidents: IncidentLogger;
  readonly timers: TimerHost;
  private readonly persist: PersistencePort;
  private readonly clock: Clock;
  private readonly emit: EmitFn;
  private readonly memoryPersist: MemoryPersistence | undefined;
  private readonly rateLimiter: SocketRateLimiter;

  /** socketId → roomId for disconnect routing */
  private readonly socketRoom = new Map<string, string>();

  constructor(opts: OrchestratorOptions) {
    this.persist = opts.persist;
    this.clock = opts.clock;
    this.emit = opts.emit;
    this.incidents = opts.incidents ?? createIncidentLogger();
    this.memoryPersist = opts.memoryPersist;
    this.rateLimiter =
      opts.rateLimiter ?? new SocketRateLimiter(() => this.clock.now());
    this.timers = new TimerHost(
      this.clock,
      (roomId) => {
        void this.queue.run(roomId, () => this.handleAfkTimeout(roomId));
      },
      opts.timeouts,
    );
  }

  dispose(): void {
    this.timers.dispose();
  }

  // ─── Inbound dispatch ─────────────────────────────────────────────

  async handleEvent(socketId: string, eventName: string, raw: unknown): Promise<void> {
    const parsed = parseInboundEvent(eventName, raw);
    if (!parsed.ok) {
      emitRejected(this.emit, socketId, parsed.code, parsed.message);
      return;
    }

    switch (eventName) {
      case ClientEvents.HELLO:
        this.handleHello(socketId, parsed.data as ClientHello);
        return;
      case ClientEvents.ROOM_CREATE:
        if (!this.rateLimiter.allowRoomCreate(socketId)) {
          emitRejected(this.emit, socketId, 'RATE_LIMITED', RATE_LIMITED_MESSAGE);
          return;
        }
        await this.queue.run('__lobby_create__', () =>
          this.handleRoomCreate(socketId, parsed.data as RoomCreateMessage),
        );
        return;
      case ClientEvents.ROOM_JOIN: {
        const msg = parsed.data as RoomJoinMessage;
        if (!this.rateLimiter.allowRoomJoin(socketId)) {
          emitRejected(this.emit, socketId, 'RATE_LIMITED', RATE_LIMITED_MESSAGE);
          return;
        }
        const lookupCode = msg.payload.roomCode.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
        const preview = this.registry.getByCode(lookupCode);
        if (!preview) {
          emitRejected(this.emit, socketId, 'ROOM_NOT_JOINABLE', 'Unable to join room');
          return;
        }
        const priorRoomId = this.socketRoom.get(socketId);
        if (priorRoomId && priorRoomId !== preview.roomId) {
          await this.detachSocketFromAnyRoom(socketId);
        }
        await this.queue.run(preview.roomId, () => this.handleRoomJoin(socketId, msg));
        return;
      }
      case ClientEvents.ROOM_LEAVE: {
        const msg = parsed.data as RoomLeaveMessage;
        await this.queue.run(msg.payload.roomId, () => this.handleRoomLeave(socketId, msg));
        return;
      }
      case ClientEvents.ROOM_START: {
        const msg = parsed.data as RoomStartMessage;
        await this.queue.run(msg.payload.roomId, () => this.handleRoomStart(socketId, msg));
        return;
      }
      case ClientEvents.ROOM_SET_REBALANCE: {
        const msg = parsed.data as RoomSetRebalanceMessage;
        await this.queue.run(msg.payload.roomId, () =>
          this.handleSetRebalance(socketId, msg),
        );
        return;
      }
      case ClientEvents.ROOM_PLAY_AGAIN: {
        const msg = parsed.data as RoomPlayAgainMessage;
        await this.queue.run(msg.payload.roomId, () => this.handlePlayAgain(socketId, msg));
        return;
      }
      case ClientEvents.SESSION_RECONNECT: {
        const msg = parsed.data as SessionReconnectMessage;
        if (!this.rateLimiter.allowSessionReconnect(socketId)) {
          emitRejected(this.emit, socketId, 'RATE_LIMITED', RATE_LIMITED_MESSAGE);
          return;
        }
        await this.handleReconnect(socketId, msg);
        return;
      }
      case ClientEvents.GAME_ACTION: {
        const msg = parsed.data as GameActionMessage;
        // EC-128 / EC-130 — after Zod parse, before queue.run
        if (!this.rateLimiter.allowGameAction(socketId)) {
          emitRejected(this.emit, socketId, 'RATE_LIMITED', RATE_LIMITED_MESSAGE);
          return;
        }
        const roomId = this.socketRoom.get(socketId);
        if (!roomId) {
          emitRejected(this.emit, socketId, 'UNAUTHORIZED', 'Not in a room');
          return;
        }
        await this.queue.run(roomId, () => this.handleGameAction(socketId, roomId, msg));
        return;
      }
      case ClientEvents.CHAT_SEND: {
        const msg = parsed.data as ChatSendMessage;
        // EC-129 / EC-130 — after Zod parse, before queue.run
        if (!this.rateLimiter.allowChatSend(socketId)) {
          emitRejected(this.emit, socketId, 'RATE_LIMITED', RATE_LIMITED_MESSAGE);
          return;
        }
        await this.queue.run(msg.payload.roomId, () => this.handleChat(socketId, msg));
        return;
      }
      default:
        emitRejected(this.emit, socketId, 'UNKNOWN_EVENT', 'Unknown event');
    }
  }

  async handleDisconnect(socketId: string): Promise<void> {
    const roomId = this.socketRoom.get(socketId);
    if (!roomId) return;
    await this.queue.run(roomId, async () => {
      const runtime = this.registry.get(roomId);
      if (!runtime) return;
      const binding = runtime.sockets.get(socketId);
      if (!binding) return;

      // Authoritative = this socket is still the writable one. A late
      // disconnect from a superseded socket (reconnect raced ahead) must
      // only drop the binding — not flip lobby status back to DISCONNECTED
      // or clear the new socket's writability (QA host-reconnect stalls).
      const isAuthoritative =
        runtime.writableByPlayer.get(binding.playerId) === socketId;

      if (isAuthoritative) {
        const lobbyPlayer = runtime.lobby.players.find((p) => p.id === binding.playerId);
        if (lobbyPlayer) {
          const sessionHandle = {
            id: binding.sessionId,
            playerId: binding.playerId,
            authToken: '',
            socketId,
            lastSeenAtMs: this.clock.now(),
          };
          const playerHandle = {
            id: binding.playerId,
            roomId: runtime.roomId,
            sessionId: binding.sessionId,
            connectionStatus: lobbyPlayer.connectionStatus,
            isAlive: true,
          };
          const result = applyDisconnect(playerHandle, sessionHandle, this.clock.now());
          runtime.lobby = {
            ...runtime.lobby,
            players: runtime.lobby.players.map((p) =>
              p.id === binding.playerId
                ? { ...p, connectionStatus: result.player.connectionStatus }
                : p,
            ),
          };
        }
        runtime.writableByPlayer.delete(binding.playerId);
      }

      runtime.sockets.delete(socketId);
      this.socketRoom.delete(socketId);

      if (runtime.sockets.size === 0) {
        runtime.lastSocketGoneAtMs = this.clock.now();
      }
    });
  }

  // ─── Handlers ─────────────────────────────────────────────────────

  private handleHello(socketId: string, data: ClientHello): void {
    const check = checkClientHello(data.protocolVersion);
    if (!check.ok) {
      this.emit(socketId, ServerEvents.PROTOCOL_MISMATCH, {
        clientVersion: data.protocolVersion,
        serverVersion: PROTOCOL_VERSION,
        requireStateSync: true,
      });
      return;
    }
    this.emit(socketId, ServerEvents.HELLO_OK, {
      protocolVersion: PROTOCOL_VERSION,
    });
  }

  private async handleRoomCreate(socketId: string, msg: RoomCreateMessage): Promise<void> {
    if (!this.persist.isAvailable()) {
      emitRejected(this.emit, socketId, 'UNAUTHORIZED', 'Service temporarily unavailable');
      return;
    }

    // Drop any prior room binding so stale broadcasts cannot follow this socket
    // into the new room (Exit-to-home mid-game only cleared the client before).
    await this.detachSocketFromAnyRoom(socketId);

    const plan = createRoom({
      displayName: msg.payload.displayName,
      now: this.clock.now(),
      rebalanceEnabled: msg.payload.rebalanceEnabled,
      socketId,
      allocateCode: () =>
        allocateRoomCode({
          codeExists: (code) => this.registry.hasCode(code),
        }),
    });

    if (!plan.ok) {
      emitRejected(this.emit, socketId, plan.code, plan.message);
      return;
    }

    try {
      await this.persist.saveNewRoom({
        roomId: plan.room.id,
        roomCode: plan.room.roomCode,
        hostPlayerId: plan.hostPlayer.id,
        rebalanceEnabled: plan.room.rebalanceEnabled,
        players: [
          {
            id: plan.hostPlayer.id,
            displayName: plan.hostPlayer.displayName,
            seatOrder: plan.hostPlayer.seatOrder,
            sessionId: plan.session.id,
            joinedAtMs: plan.hostPlayer.joinedAt,
          },
        ],
        sessions: [
          {
            id: plan.session.id,
            playerId: plan.hostPlayer.id,
            authToken: plan.session.authToken,
            socketId,
            lastSeenAtMs: plan.session.lastSeenAt,
          },
        ],
      });
    } catch (err) {
      this.logPersistFailure('room_create', err);
      emitRejected(this.emit, socketId, 'UNAUTHORIZED', 'Service temporarily unavailable');
      return;
    }

    const gameState = createInitialState(plan.room.id, plan.hostPlayer.id);
    const runtime = createRoomRuntime({
      roomId: plan.room.id,
      roomCode: plan.room.roomCode,
      lobby: plan.room,
      gameState,
    });

    const writable = registerWritableConnection({
      playerId: plan.hostPlayer.id,
      newSocketId: socketId,
      priorWritableSocketId: null,
    });
    runtime.writableByPlayer.set(plan.hostPlayer.id, writable.writableSocketId);
    this.bindSocket(runtime, {
      socketId,
      playerId: plan.hostPlayer.id,
      sessionId: plan.session.id,
      expectedSequence: msg.sequence + 1,
      isWritable: true,
    });

    this.registry.set(runtime);

    this.emit(socketId, ServerEvents.ROOM_CREATED, {
      roomId: plan.room.id,
      roomCode: plan.room.roomCode,
      authToken: plan.session.authToken,
      playerId: plan.hostPlayer.id,
    });
    syncLobbyIntoGameState(runtime);
    broadcastRoomState(runtime, this.emit, 'sync', this.clock);
  }

  private async handleRoomJoin(socketId: string, msg: RoomJoinMessage): Promise<void> {
    if (!this.persist.isAvailable()) {
      emitRejected(this.emit, socketId, 'UNAUTHORIZED', 'Service temporarily unavailable');
      return;
    }

    const lookupCode = msg.payload.roomCode.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
    const runtime = this.registry.getByCode(lookupCode);
    if (!runtime) {
      emitRejected(this.emit, socketId, 'ROOM_NOT_JOINABLE', 'Unable to join room');
      return;
    }

    // Already holding this room's lock — never nest detachSocketFromAnyRoom here.
    if (this.socketRoom.get(socketId) === runtime.roomId) {
      this.detachSocketFromRoomLocked(socketId, runtime.roomId);
    }

    this.markGhostSeatsDisconnected(runtime);

    const result = joinRoom({
      room: runtime.lobby,
      displayName: msg.payload.displayName,
      now: this.clock.now(),
      socketId,
      existingSession: null,
    });

    if (!result.ok) {
      emitRejected(this.emit, socketId, result.code, result.message);
      return;
    }

    if (result.kind === 'REATTACH') {
      emitRejected(this.emit, socketId, 'UNAUTHORIZED', 'Use session:reconnect');
      return;
    }

    runtime.lobby = result.room;

    try {
      if (result.kind === 'RECLAIM') {
        await this.persist.updateSession({
          sessionId: result.session.id,
          authToken: result.session.authToken,
          socketId,
          lastSeenAtMs: result.session.lastSeenAt,
        });
      } else {
        await this.persist.addSession({
          roomId: runtime.roomId,
          sessionId: result.session.id,
          playerId: result.player.id,
          displayName: result.player.displayName,
          seatOrder: result.player.seatOrder,
          joinedAtMs: result.player.joinedAt,
          authToken: result.session.authToken,
          socketId,
          lastSeenAtMs: result.session.lastSeenAt,
        });
      }
    } catch (err) {
      this.logPersistFailure(result.kind === 'RECLAIM' ? 'room_reclaim' : 'room_join', err);
      emitRejected(this.emit, socketId, 'UNAUTHORIZED', 'Service temporarily unavailable');
      return;
    }

    this.attachPlayerSocket(runtime, {
      socketId,
      playerId: result.player.id,
      sessionId: result.session.id,
      expectedSequence: msg.sequence + 1,
    });

    this.emit(socketId, ServerEvents.ROOM_JOINED, {
      roomId: runtime.roomId,
      roomCode: runtime.roomCode,
      authToken: result.session.authToken,
      playerId: result.player.id,
    });
    syncLobbyIntoGameState(runtime);
    broadcastRoomState(runtime, this.emit, 'sync', this.clock);
  }

  private async handlePlayAgain(socketId: string, msg: RoomPlayAgainMessage): Promise<void> {
    if (!this.persist.isAvailable()) {
      emitRejected(this.emit, socketId, 'UNAUTHORIZED', 'Service temporarily unavailable');
      return;
    }

    const runtime = this.registry.get(msg.payload.roomId);
    if (!runtime) {
      emitRejected(this.emit, socketId, 'PLAYER_NOT_IN_ROOM', 'Not in room');
      return;
    }
    const binding = runtime.sockets.get(socketId);
    if (!binding) {
      emitRejected(this.emit, socketId, 'PLAYER_NOT_IN_ROOM', 'Not in room');
      return;
    }

    // Room lifecycle — do not use assertCanSubmitAction (GAME_OVER blocks all game actions).
    const writable =
      binding.isWritable &&
      isSocketWritable(socketId, runtime.writableByPlayer.get(binding.playerId) ?? '');
    if (!writable) {
      emitRejected(
        this.emit,
        socketId,
        'NOT_WRITABLE',
        'This connection is read-only; a newer tab or device holds write access',
      );
      return;
    }

    const guards = this.checkBoundSequenceGuards(binding, msg, runtime);
    if (!guards.ok) {
      emitRejected(this.emit, socketId, guards.code, guards.message);
      if (guards.requireStateSync) {
        broadcastRoomState(runtime, this.emit, 'sync', this.clock);
      }
      return;
    }
    binding.expectedSequence = guards.nextExpectedSequence;

    const alreadyLobby =
      runtime.status === 'LOBBY' &&
      (runtime.gameState === null || runtime.gameState.phase.kind === 'LOBBY');
    if (alreadyLobby) {
      syncLobbyIntoGameState(runtime);
      broadcastRoomState(runtime, this.emit, 'sync', this.clock);
      return;
    }

    const gameOver =
      runtime.status === 'GAME_OVER' || runtime.gameState?.phase.kind === 'GAME_OVER';
    if (!gameOver) {
      emitRejected(
        this.emit,
        socketId,
        'UNAUTHORIZED',
        'Play again is only available after the game ends',
      );
      return;
    }

    const previousVersion = runtime.gameState?.stateVersion ?? 0;
    const rematch = resetToRematchLobby({
      room: runtime.lobby,
      now: this.clock.now(),
    });
    runtime.lobby = rematch.room;
    runtime.status = 'LOBBY';
    this.timers.clear(runtime.roomId);
    runtime.deferredAfkPlayerIds.clear();
    runtime.afkDeadlineMs = null;
    runtime.afkWindowStartedAtMs = null;
    runtime.phaseHardDeadlineMs = null;
    runtime.phaseTimerKey = null;
    resetGameStateForRematch(runtime, previousVersion);
    this.timers.syncFromRuntime(runtime);

    try {
      await this.persist.updateRoomStatus(runtime.roomId, 'LOBBY');
      if (runtime.gameState) {
        await this.persist.writeSnapshot(
          runtime.roomId,
          runtime.gameState.stateVersion,
          runtime.gameState,
        );
      }
    } catch (err) {
      this.logPersistFailure('room_play_again', err);
    }

    broadcastRoomState(runtime, this.emit, 'sync', this.clock);
  }

  private async handleRoomLeave(socketId: string, msg: RoomLeaveMessage): Promise<void> {
    const runtime = this.registry.get(msg.payload.roomId);
    if (!runtime) {
      emitRejected(this.emit, socketId, 'PLAYER_NOT_IN_ROOM', 'Not in room');
      return;
    }
    const binding = runtime.sockets.get(socketId);
    if (!binding) {
      emitRejected(this.emit, socketId, 'PLAYER_NOT_IN_ROOM', 'Not in room');
      return;
    }

    // Mid-game Exit: detach the socket only (seat remains for reconnect). Lobby leave
    // still removes the player from the room.
    const inLobby =
      runtime.status === 'LOBBY' &&
      (runtime.gameState?.phase.kind === 'LOBBY' || runtime.gameState === null);
    if (!inLobby) {
      this.detachSocketFromRoomLocked(socketId, runtime.roomId);
      return;
    }

    const actionGate = assertCanSubmitAction({
      isWritable:
        binding.isWritable &&
        isSocketWritable(socketId, runtime.writableByPlayer.get(binding.playerId) ?? ''),
      roomStatus: runtime.status,
    });
    if (!actionGate.ok) {
      emitRejected(this.emit, socketId, actionGate.code, actionGate.message);
      return;
    }

    const guards = this.checkBoundSequenceGuards(binding, msg, runtime);
    if (!guards.ok) {
      emitRejected(this.emit, socketId, guards.code, guards.message);
      if (guards.requireStateSync) {
        broadcastRoomState(runtime, this.emit, 'sync');
      }
      return;
    }
    // Advance as soon as the envelope (protocol/sequence/state-version) is validated —
    // a later business-logic rejection doesn't mean the envelope wasn't consumed. See
    // DECISIONS.md 2026-08-07 "client sequence counter permanently desyncs" for why this
    // must happen before any downstream reject, not only on the full success path.
    binding.expectedSequence = guards.nextExpectedSequence;

    const left = leaveLobby({
      room: runtime.lobby,
      playerId: binding.playerId,
      now: this.clock.now(),
    });
    if (!left.ok) {
      emitRejected(this.emit, socketId, left.code, left.message);
      return;
    }

    runtime.lobby = left.room;
    runtime.sockets.delete(socketId);
    this.socketRoom.delete(socketId);

    if (left.roomEmpty) {
      this.timers.clear(runtime.roomId);
      this.registry.delete(runtime.roomId);
      if (this.persist.isAvailable()) {
        await this.persist.updateRoomStatus(runtime.roomId, 'EXPIRED').catch(() => undefined);
      }
      return;
    }

    syncLobbyIntoGameState(runtime);
    broadcastRoomState(runtime, this.emit, 'update', this.clock);
  }

  private async handleSetRebalance(
    socketId: string,
    msg: RoomSetRebalanceMessage,
  ): Promise<void> {
    const runtime = this.registry.get(msg.payload.roomId);
    if (!runtime) {
      emitRejected(this.emit, socketId, 'PLAYER_NOT_IN_ROOM', 'Not in room');
      return;
    }
    const binding = runtime.sockets.get(socketId);
    if (!binding) {
      emitRejected(this.emit, socketId, 'PLAYER_NOT_IN_ROOM', 'Not in room');
      return;
    }

    const actionGate = assertCanSubmitAction({
      isWritable:
        binding.isWritable &&
        isSocketWritable(socketId, runtime.writableByPlayer.get(binding.playerId) ?? ''),
      roomStatus: runtime.status,
    });
    if (!actionGate.ok) {
      emitRejected(this.emit, socketId, actionGate.code, actionGate.message);
      return;
    }

    const guards = this.checkBoundSequenceGuards(binding, msg, runtime);
    if (!guards.ok) {
      emitRejected(this.emit, socketId, guards.code, guards.message);
      if (guards.requireStateSync) {
        broadcastRoomState(runtime, this.emit, 'sync');
      }
      return;
    }
    binding.expectedSequence = guards.nextExpectedSequence;

    const result = setRebalance({
      room: runtime.lobby,
      actorPlayerId: binding.playerId,
      rebalanceEnabled: msg.payload.rebalanceEnabled,
    });
    if (!result.ok) {
      emitRejected(this.emit, socketId, result.code, result.message);
      return;
    }
    runtime.lobby = result.room;
    syncLobbyIntoGameState(runtime);
    broadcastRoomState(runtime, this.emit, 'update', this.clock);
  }

  private async handleRoomStart(socketId: string, msg: RoomStartMessage): Promise<void> {
    if (!this.persist.isAvailable()) {
      emitRejected(this.emit, socketId, 'UNAUTHORIZED', 'Service temporarily unavailable');
      return;
    }

    const runtime = this.registry.get(msg.payload.roomId);
    if (!runtime) {
      emitRejected(this.emit, socketId, 'PLAYER_NOT_IN_ROOM', 'Not in room');
      return;
    }
    const binding = runtime.sockets.get(socketId);
    if (!binding) {
      emitRejected(this.emit, socketId, 'PLAYER_NOT_IN_ROOM', 'Not in room');
      return;
    }

    const actionGate = assertCanSubmitAction({
      isWritable:
        binding.isWritable &&
        isSocketWritable(socketId, runtime.writableByPlayer.get(binding.playerId) ?? ''),
      roomStatus: runtime.status,
    });
    if (!actionGate.ok) {
      emitRejected(this.emit, socketId, actionGate.code, actionGate.message);
      return;
    }

    const guards = this.checkBoundSequenceGuards(binding, msg, runtime);
    if (!guards.ok) {
      emitRejected(this.emit, socketId, guards.code, guards.message);
      if (guards.requireStateSync) {
        broadcastRoomState(runtime, this.emit, 'sync');
      }
      return;
    }
    binding.expectedSequence = guards.nextExpectedSequence;

    const built = buildStartGameAction({
      room: runtime.lobby,
      actorPlayerId: binding.playerId,
      seed: randomInt(1, 0x7fffffff),
    });
    if (!built.ok) {
      emitRejected(this.emit, socketId, built.code, built.message);
      return;
    }

    if (!runtime.gameState) {
      runtime.gameState = createInitialState(runtime.roomId, runtime.lobby.hostPlayerId);
    }

    // Sync lobby players into engine LOBBY state before START_GAME via applyAction
    const startResult = await applyAndCommit(
      runtime,
      built.action,
      this.persist,
      this.clock,
      msg.actionUuid,
    );

    if (startResult.kind === 'rejected') {
      emitRejected(this.emit, socketId, 'ENGINE_REJECTED', startResult.reason);
      return;
    }
    if (startResult.kind === 'persist_failed' || startResult.kind === 'db_unavailable') {
      emitRejected(this.emit, socketId, 'UNAUTHORIZED', 'Service temporarily unavailable');
      return;
    }
    if (startResult.kind === 'no_state') {
      emitRejected(this.emit, socketId, 'ENGINE_REJECTED', 'No game state');
      return;
    }

    rememberActionUuid(runtime.dedup, msg.actionUuid);
    // Durable room status so recovery/join after restart also see IN_PROGRESS.
    if (this.persist.isAvailable() && runtime.status !== 'LOBBY') {
      await this.persist
        .updateRoomStatus(runtime.roomId, runtime.status)
        .catch(() => undefined);
    }
    this.timers.syncFromRuntime(runtime);
    broadcastRoomState(runtime, this.emit, 'sync', this.clock);
  }

  private async handleReconnect(
    socketId: string,
    msg: SessionReconnectMessage,
  ): Promise<void> {
    const session = await this.persist.findSessionByToken(msg.payload.authToken);
    if (!session) {
      emitRejected(this.emit, socketId, 'UNAUTHORIZED', UNAUTHORIZED_SESSION_MESSAGE);
      return;
    }

    await this.queue.run(session.roomId, async () => {
      let runtime = this.registry.get(session.roomId);
      if (!runtime) {
        // Attempt recovery load
        const recovered = await recoverRoom(
          session.roomId,
          this.persist,
          this.clock,
          this.memoryPersist
            ? () => this.memoryPersist!.loadRecoverableEvents(session.roomId)
            : undefined,
        );
        if (!recovered.ok) {
          emitRejected(this.emit, socketId, 'UNAUTHORIZED', 'Room unavailable');
          return;
        }
        // Minimal lobby stub for reconnect
        const lobby: LobbyRoom = {
          id: session.roomId,
          roomCode: 'RECOVER',
          hostPlayerId: recovered.state.hostPlayerId,
          status: 'IN_PROGRESS',
          rebalanceEnabled: recovered.state.rebalanceEnabled,
          players: recovered.state.players.map((p) => ({
            id: p.id,
            displayName: p.displayName,
            normalizedDisplayName: p.displayName.toLowerCase(),
            seatOrder: p.seatOrder,
            connectionStatus: 'DISCONNECTED' as const,
            joinedAt: this.clock.now(),
            sessionId: p.id === session.playerId ? session.sessionId : randomUUID(),
          })),
          hostAloneGraceStartedAt: null,
          emptySinceAt: null,
        };
        runtime = createRoomRuntime({
          roomId: session.roomId,
          roomCode: lobby.roomCode,
          lobby,
          status: 'IN_PROGRESS',
          gameState: recovered.state,
        });
        runtime.nextEventSeq = recovered.nextEventSeq;
        runtime.maxSnapshotVersion = recovered.maxSnapshotVersion;
        this.registry.set(runtime);
      }

      if (!runtime.gameState) {
        emitRejected(this.emit, socketId, 'UNAUTHORIZED', 'Room unavailable');
        return;
      }

      const player = runtime.gameState.players.find((p) => p.id === session.playerId);
      const lobbyPlayer = runtime.lobby.players.find((p) => p.id === session.playerId);
      if (!player && !lobbyPlayer) {
        emitRejected(this.emit, socketId, 'UNAUTHORIZED', UNAUTHORIZED_SESSION_MESSAGE);
        return;
      }

      // EC-13 / EC-14 / EC-109 — validate + rotate before attach; identity from session only.
      const rotated = validateAndRotateSession({
        presentedToken: msg.payload.authToken,
        session: {
          id: session.sessionId,
          playerId: session.playerId,
          authToken: session.authToken,
          socketId: session.socketId,
          lastSeenAt: session.lastSeenAtMs,
        },
        roomStatus: runtime.status,
        now: this.clock.now(),
      });
      if (!rotated.ok) {
        emitRejected(this.emit, socketId, rotated.code, rotated.message);
        return;
      }

      const reconnect = performReconnect({
        player: {
          id: session.playerId,
          roomId: runtime.roomId,
          sessionId: session.sessionId,
          connectionStatus: lobbyPlayer?.connectionStatus ?? 'DISCONNECTED',
          isAlive: player?.isAlive ?? true,
        },
        session: {
          id: session.sessionId,
          playerId: session.playerId,
          authToken: rotated.authToken,
          socketId: session.socketId,
          lastSeenAtMs: rotated.session.lastSeenAt,
        },
        presentedAuthToken: rotated.authToken,
        newSocketId: socketId,
        nowMs: this.clock.now(),
        gameState: runtime.gameState,
        timers: {
          afkDeadlineMs: runtime.afkDeadlineMs,
          serverNowMs: this.clock.now(),
        },
      });

      if (!reconnect.ok) {
        emitRejected(this.emit, socketId, 'UNAUTHORIZED', reconnect.message);
        return;
      }

      try {
        await this.persist.updateSession({
          sessionId: session.sessionId,
          authToken: rotated.authToken,
          socketId,
          lastSeenAtMs: rotated.session.lastSeenAt,
        });
      } catch (err) {
        this.logPersistFailure('session_reconnect', err);
        emitRejected(this.emit, socketId, 'UNAUTHORIZED', 'Service temporarily unavailable');
        return;
      }

      if (lobbyPlayer) {
        runtime.lobby = {
          ...runtime.lobby,
          players: runtime.lobby.players.map((p) =>
            p.id === session.playerId
              ? { ...p, connectionStatus: reconnect.player.connectionStatus }
              : p,
          ),
        };
      }

      const writable = registerWritableConnection({
        playerId: session.playerId,
        newSocketId: socketId,
        priorWritableSocketId: runtime.writableByPlayer.get(session.playerId) ?? null,
      });
      if (writable.demoteSocketId) {
        this.emit(writable.demoteSocketId, ServerEvents.SESSION_READ_ONLY, {
          reason: 'SUPERSEDED_BY_NEWER_CONNECTION',
        });
        const old = runtime.sockets.get(writable.demoteSocketId);
        if (old) old.isWritable = false;
      }
      runtime.writableByPlayer.set(session.playerId, writable.writableSocketId);

      this.bindSocket(runtime, {
        socketId,
        playerId: session.playerId,
        sessionId: session.sessionId,
        expectedSequence: msg.sequence + 1,
        isWritable: true,
      });

      // EC-71 / EC-107 — exiled reconnect uses spectator-filtered sync.
      // EC-30 — attach authoritative timer display fields on reconnect sync.
      const sync = buildStateSyncPayload(runtime.gameState, session.playerId, {
        asSpectator: reconnect.capabilities.isSpectator,
        timers: {
          afkDeadlineMs: runtime.afkDeadlineMs,
          serverNowMs: this.clock.now(),
        },
      });
      this.emit(socketId, ServerEvents.STATE_SYNC, {
        view: sync.view,
        authToken: rotated.authToken,
      });

      // Re-arm AFK after reconnect — disconnect never clears timers, but a
      // fired-and-unarmed handle (or race) must not leave a sole actor stranded.
      this.timers.ensureArmed(runtime);
    });
  }

  private async handleGameAction(
    socketId: string,
    roomId: string,
    msg: GameActionMessage,
  ): Promise<void> {
    const receivedAtMs = this.clock.now();
    const runtime = this.registry.get(roomId);
    if (!runtime) {
      emitRejected(this.emit, socketId, 'UNAUTHORIZED', 'Not in a room');
      return;
    }

    const binding = runtime.sockets.get(socketId);
    if (!binding) {
      emitRejected(this.emit, socketId, 'UNAUTHORIZED', 'Not in a room');
      return;
    }

    const gate = assertCanSubmitAction({
      isWritable: binding.isWritable && isSocketWritable(socketId, runtime.writableByPlayer.get(binding.playerId) ?? ''),
      roomStatus: runtime.status,
    });
    if (!gate.ok) {
      emitRejected(this.emit, socketId, gate.code, gate.message);
      return;
    }

    if (!runtime.gameState) {
      emitRejected(this.emit, socketId, 'ENGINE_REJECTED', 'No game state');
      return;
    }

    const actor = runtime.gameState.players.find((p) => p.id === binding.playerId);
    if (actor && !actor.isAlive) {
      emitRejected(this.emit, socketId, 'UNAUTHORIZED', 'Exiled players cannot submit actions');
      return;
    }

    const guards = this.checkBoundSequenceGuards(binding, msg, runtime);
    if (!guards.ok) {
      emitRejected(this.emit, socketId, guards.code, guards.message);
      if (guards.requireStateSync) {
        broadcastRoomState(runtime, this.emit, 'sync', this.clock);
      }
      return;
    }
    binding.expectedSequence = guards.nextExpectedSequence;

    const dedup = checkActionDedup(runtime.dedup, msg.actionUuid);
    if (dedup.kind === 'DUPLICATE') {
      this.emit(socketId, ServerEvents.ACTION_DEDUPED, { actionUuid: msg.actionUuid });
      return;
    }

    // EC-27 — action must arrive strictly before deadline
    if (!this.timers.isActionBeforeDeadline(runtime, receivedAtMs)) {
      emitRejected(this.emit, socketId, 'ENGINE_REJECTED', 'Action deadline passed');
      return;
    }

    const action = wirePayloadToGameAction(msg.payload, binding.playerId);
    const result = await applyAndCommit(
      runtime,
      action,
      this.persist,
      this.clock,
      msg.actionUuid,
    );

    if (result.kind === 'rejected') {
      emitRejected(this.emit, socketId, 'ENGINE_REJECTED', result.reason);
      return;
    }
    if (result.kind === 'persist_failed') {
      // EC-75 — do not commit; state unchanged
      emitRejected(this.emit, socketId, 'UNAUTHORIZED', 'Failed to persist action');
      return;
    }
    if (result.kind === 'db_unavailable') {
      emitRejected(this.emit, socketId, 'UNAUTHORIZED', 'Service temporarily unavailable');
      return;
    }
    if (result.kind === 'no_state') {
      emitRejected(this.emit, socketId, 'ENGINE_REJECTED', 'No game state');
      return;
    }

    // EC-91 — host force-end distinguishable in ledger
    void result.events.some((e) => isHostForceEndPayload(e));

    rememberActionUuid(runtime.dedup, msg.actionUuid);
    this.timers.syncFromRuntime(runtime);
    // EC-96 — broadcast only after commit
    broadcastRoomState(runtime, this.emit, 'update', this.clock);

    // Deferred AFK bots catch up once every non-deferred seat has acted.
    const deferredFlush = this.timers.resolveDeferredFlush(runtime);
    if (deferredFlush) {
      void this.queue.run(runtime.roomId, () => this.flushDeferredAfk(runtime.roomId));
    }
  }

  /** Apply deferred-seat auto-actions until humans remain or none left. */
  private async flushDeferredAfk(roomId: string): Promise<void> {
    const runtime = this.registry.get(roomId);
    if (!runtime?.gameState) return;
    for (let i = 0; i < 16; i += 1) {
      const action = this.timers.resolveDeferredFlush(runtime);
      if (!action) break;
      const result = await applyAndCommit(runtime, action, this.persist, this.clock, null);
      if (result.kind !== 'committed') break;
      this.timers.syncFromRuntime(runtime);
      broadcastRoomState(runtime, this.emit, 'update', this.clock);
    }
  }

  private async handleChat(socketId: string, msg: ChatSendMessage): Promise<void> {
    const runtime = this.registry.get(msg.payload.roomId);
    if (!runtime?.gameState) {
      emitRejected(this.emit, socketId, 'UNAUTHORIZED', 'Not in a room');
      return;
    }
    const binding = runtime.sockets.get(socketId);
    if (!binding) {
      emitRejected(this.emit, socketId, 'UNAUTHORIZED', 'Not in a room');
      return;
    }

    const actionGate = assertCanSubmitAction({
      isWritable:
        binding.isWritable &&
        isSocketWritable(socketId, runtime.writableByPlayer.get(binding.playerId) ?? ''),
      roomStatus: runtime.status,
    });
    if (!actionGate.ok) {
      emitRejected(this.emit, socketId, actionGate.code, actionGate.message);
      return;
    }

    // EC-107 — exiled/dead players cannot chat-send.
    const gamePlayer = runtime.gameState.players.find((p) => p.id === binding.playerId);
    if (gamePlayer && !gamePlayer.isAlive) {
      emitRejected(this.emit, socketId, 'CHAT_FORBIDDEN', 'Exiled players cannot chat');
      return;
    }

    const guards = this.checkBoundSequenceGuards(binding, msg, runtime);
    if (!guards.ok) {
      emitRejected(this.emit, socketId, guards.code, guards.message);
      if (guards.requireStateSync) {
        broadcastRoomState(runtime, this.emit, 'sync');
      }
      return;
    }
    binding.expectedSequence = guards.nextExpectedSequence;

    const gate = checkChatGate(runtime.gameState.phase);
    if (!gate.allowed) {
      emitRejected(
        this.emit,
        socketId,
        gate.code ?? 'CHAT_FORBIDDEN',
        gate.message ?? 'Chat forbidden',
      );
      return;
    }

    const player = runtime.lobby.players.find((p) => p.id === binding.playerId);
    for (const peer of runtime.sockets.values()) {
      this.emit(peer.socketId, ServerEvents.CHAT_MESSAGE, {
        roomId: runtime.roomId,
        senderPlayerId: binding.playerId,
        displayName: player?.displayName ?? 'Player',
        text: msg.payload.text,
        sentAt: this.clock.now(),
      });
    }
  }

  private async handleAfkTimeout(roomId: string): Promise<void> {
    const runtime = this.registry.get(roomId);
    if (!runtime?.gameState) return;

    // The setTimeout handle is already gone when we enter here. Any early
    // return or failed commit MUST re-arm, or the room stalls forever with
    // no further AFK (and no player able to act if clients are also stuck).
    if (!this.timers.isExpired(runtime)) {
      this.timers.ensureArmed(runtime);
      return;
    }

    const hardExpired = this.timers.isHardExpired(runtime);

    // Soft AFK on multi-seat: mark disconnected seats deferred; bots wait for
    // connected humans. Hard deadline still force-resolves.
    if (!hardExpired) {
      this.timers.markDisconnectedDeferred(runtime);
      const deferredAction = this.timers.resolveDeferredFlush(runtime);
      if (deferredAction) {
        const result = await applyAndCommit(
          runtime,
          deferredAction,
          this.persist,
          this.clock,
          null,
        );
        if (result.kind === 'committed') {
          this.timers.syncFromRuntime(runtime);
          broadcastRoomState(runtime, this.emit, 'update', this.clock);
          // Keep flushing deferred seats until humans/bots catch up or hard hits.
          if (this.timers.resolveDeferredFlush(runtime)) {
            void this.queue.run(roomId, () => this.handleAfkTimeout(roomId));
          } else {
            this.timers.ensureArmed(runtime);
          }
          return;
        }
      }
      // Re-arm to hard deadline; do not force-resolve yet.
      runtime.afkDeadlineMs = runtime.phaseHardDeadlineMs;
      this.timers.ensureArmed(runtime);
      broadcastRoomState(runtime, this.emit, 'update', this.clock);
      return;
    }

    const action = this.timers.resolveTimeoutAction(runtime);
    if (!action) {
      this.timers.ensureArmed(runtime);
      return;
    }

    const result = await applyAndCommit(runtime, action, this.persist, this.clock, null);
    if (result.kind === 'committed') {
      this.timers.syncFromRuntime(runtime);
      broadcastRoomState(runtime, this.emit, 'update', this.clock);
      return;
    }

    if (result.kind === 'persist_failed') {
      this.logPersistFailure('afk_timeout', result.error);
    } else if (result.kind === 'rejected') {
      // eslint-disable-next-line no-console
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'afk_timeout_rejected',
          roomId,
          actionType: result.actionType,
          reason: result.reason,
        }),
      );
    }
    this.timers.ensureArmed(runtime);
  }

  // ─── Ops / recovery ───────────────────────────────────────────────

  async freeze(roomId: string, reason: string): Promise<void> {
    await this.queue.run(roomId, async () => {
      const runtime = this.registry.get(roomId);
      if (!runtime) return;
      this.timers.clear(roomId);
      await freezeRoom(runtime, reason, this.persist, this.clock, this.incidents);
      emitFrozen(runtime, this.emit, 'FROZEN');
    });
  }

  async resumeFrozen(roomId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
    return this.queue.run(roomId, async () => {
      const runtime = this.registry.get(roomId);
      if (!runtime) return { ok: false as const, reason: 'Room not loaded' };
      const result = await resumeFrozenRoom(
        runtime,
        this.persist,
        this.clock,
        this.memoryPersist
          ? () => this.memoryPersist!.loadRecoverableEvents(roomId)
          : undefined,
      );
      if (result.ok) {
        this.timers.syncFromRuntime(runtime);
        broadcastRoomState(runtime, this.emit, 'sync', this.clock);
      }
      return result;
    });
  }

  listFrozen() {
    return this.registry.listFrozen().map((r) => ({
      roomId: r.roomId,
      roomCode: r.roomCode,
      frozenReason: r.frozenReason,
      incidentAtMs: r.incidentAtMs,
      lastKnownSnapshotVersion: r.maxSnapshotVersion,
    }));
  }

  /** Test/helper: put a runtime directly into the registry. */
  registerRuntime(runtime: RoomRuntime): void {
    this.registry.set(runtime);
  }

  private logPersistFailure(op: string, err: unknown): void {
    // eslint-disable-next-line no-console
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'persist_failed',
        op,
        message: err instanceof Error ? err.message : String(err),
      }),
    );
  }

  /** CONNECTED with no live writable socket is a ghost — treat as vacant for reclaim. */
  private markGhostSeatsDisconnected(runtime: RoomRuntime): void {
    const players = runtime.lobby.players.map((p) => {
      if (p.connectionStatus !== 'CONNECTED') return p;
      const writableSocketId = runtime.writableByPlayer.get(p.id);
      if (!writableSocketId) {
        return { ...p, connectionStatus: 'DISCONNECTED' as const };
      }
      const binding = runtime.sockets.get(writableSocketId);
      if (!binding || !binding.isWritable) {
        runtime.writableByPlayer.delete(p.id);
        return { ...p, connectionStatus: 'DISCONNECTED' as const };
      }
      return p;
    });
    runtime.lobby = { ...runtime.lobby, players };
  }

  private attachPlayerSocket(
    runtime: RoomRuntime,
    input: {
      readonly socketId: string;
      readonly playerId: string;
      readonly sessionId: string;
      readonly expectedSequence: number;
    },
  ): void {
    const writable = registerWritableConnection({
      playerId: input.playerId,
      newSocketId: input.socketId,
      priorWritableSocketId: runtime.writableByPlayer.get(input.playerId) ?? null,
    });
    if (writable.demoteSocketId) {
      this.emit(writable.demoteSocketId, ServerEvents.SESSION_READ_ONLY, {
        reason: 'SUPERSEDED_BY_NEWER_CONNECTION',
      });
      const old = runtime.sockets.get(writable.demoteSocketId);
      if (old) old.isWritable = false;
    }
    runtime.writableByPlayer.set(input.playerId, writable.writableSocketId);
    this.bindSocket(runtime, {
      socketId: input.socketId,
      playerId: input.playerId,
      sessionId: input.sessionId,
      expectedSequence: input.expectedSequence,
      isWritable: true,
    });
  }

  private bindSocket(runtime: RoomRuntime, binding: SocketBinding): void {
    runtime.sockets.set(binding.socketId, binding);
    this.socketRoom.set(binding.socketId, runtime.roomId);
    runtime.lastSocketGoneAtMs = null;
  }

  /**
   * Unbind a socket from whichever room it currently occupies (if any).
   * Marks the seat disconnected when this socket was the writable one.
   */
  private async detachSocketFromAnyRoom(socketId: string): Promise<void> {
    const roomId = this.socketRoom.get(socketId);
    if (!roomId) return;
    await this.queue.run(roomId, async () => {
      this.detachSocketFromRoomLocked(socketId, roomId);
    });
  }

  /** Caller must already hold `roomId`'s queue lock. */
  private detachSocketFromRoomLocked(socketId: string, roomId: string): void {
    if (this.socketRoom.get(socketId) !== roomId) return;
    const runtime = this.registry.get(roomId);
    this.socketRoom.delete(socketId);
    if (!runtime) return;

    const binding = runtime.sockets.get(socketId);
    runtime.sockets.delete(socketId);
    if (!binding) return;

    const isAuthoritative =
      runtime.writableByPlayer.get(binding.playerId) === socketId;
    if (isAuthoritative) {
      const lobbyPlayer = runtime.lobby.players.find((p) => p.id === binding.playerId);
      if (lobbyPlayer) {
        const result = applyDisconnect(
          {
            id: binding.playerId,
            roomId: runtime.roomId,
            sessionId: binding.sessionId,
            connectionStatus: lobbyPlayer.connectionStatus,
            isAlive: true,
          },
          {
            id: binding.sessionId,
            playerId: binding.playerId,
            authToken: '',
            socketId,
            lastSeenAtMs: this.clock.now(),
          },
          this.clock.now(),
        );
        runtime.lobby = {
          ...runtime.lobby,
          players: runtime.lobby.players.map((p) =>
            p.id === binding.playerId
              ? { ...p, connectionStatus: result.player.connectionStatus }
              : p,
          ),
        };
      }
      runtime.writableByPlayer.delete(binding.playerId);
    }

    if (runtime.sockets.size === 0) {
      runtime.lastSocketGoneAtMs = this.clock.now();
    }
  }

  /** EC-21 / EC-22 / EC-24 — monotonic sequence + protocol + state version for bound sockets. */
  private checkBoundSequenceGuards(
    binding: SocketBinding,
    msg: { protocolVersion: number; sequence: number; stateVersion: number },
    runtime: RoomRuntime,
  ) {
    return checkConnectionGuards({
      protocolVersion: msg.protocolVersion,
      sequence: msg.sequence,
      expectedSequence: binding.expectedSequence,
      claimedStateVersion: msg.stateVersion,
      currentStateVersion: runtime.gameState?.stateVersion ?? 0,
    });
  }
}
