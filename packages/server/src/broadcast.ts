import {
  buildStateSyncPayload,
  ServerEvents,
  toWirePlayerView,
  type RejectReasonCode,
} from '@shaatir-shakuni/socket-api';
import { getPlayerView, getSpectatorView } from '@shaatir-shakuni/engine';
import type { RoomRuntime } from './room-runtime.js';

export type EmitFn = (socketId: string, event: string, payload: unknown) => void;

/**
 * EC-96 — call only after a mutation fully commits.
 * EC-76 — emit failures are swallowed; clients catch up via reconnect.
 */
export type BroadcastClock = {
  now(): number;
};

/**
 * Broadcast filtered views. When `clock` is provided, attach EC-30 timer fields
 * (`afkDeadlineMs` + `serverNowMs`) from the room runtime.
 */
export function broadcastRoomState(
  runtime: RoomRuntime,
  emit: EmitFn,
  mode: 'sync' | 'update' = 'update',
  clock?: BroadcastClock,
): void {
  const state = runtime.gameState;
  if (!state) {
    return;
  }

  const timers = {
    afkDeadlineMs: runtime.afkDeadlineMs,
    serverNowMs: clock?.now() ?? 0,
    deferredAfkPlayerIds: [...runtime.deferredAfkPlayerIds],
  };

  for (const binding of runtime.sockets.values()) {
    try {
      const player = state.players.find((p) => p.id === binding.playerId);
      const asSpectator = player !== undefined && !player.isAlive;
      if (mode === 'sync') {
        const payload = buildStateSyncPayload(state, binding.playerId, {
          asSpectator,
          timers,
        });
        emit(binding.socketId, ServerEvents.STATE_SYNC, payload);
      } else {
        const view = asSpectator
          ? getSpectatorView(state, binding.playerId)
          : getPlayerView(state, binding.playerId);
        const wire = toWirePlayerView(view, state.stateVersion, timers);
        emit(binding.socketId, ServerEvents.STATE_UPDATE, { view: wire });
      }
    } catch {
      // EC-76 — broadcast failure after persist is fine
    }
  }
}

export function emitRejected(
  emit: EmitFn,
  socketId: string,
  code: RejectReasonCode,
  message: string,
): void {
  emit(socketId, ServerEvents.ACTION_REJECTED, { code, message });
}

export function emitFrozen(
  runtime: RoomRuntime,
  emit: EmitFn,
  mode: 'FROZEN' | 'CORRUPTED' = 'FROZEN',
): void {
  for (const binding of runtime.sockets.values()) {
    try {
      emit(binding.socketId, ServerEvents.ROOM_FROZEN, {
        roomId: runtime.roomId,
        reasonCategory: 'game_cannot_continue',
        mode,
      });
    } catch {
      // ignore
    }
  }
}
