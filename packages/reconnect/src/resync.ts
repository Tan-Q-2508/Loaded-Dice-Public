import type { GameState } from '@shaatir-shakuni/engine';
import {
  buildStateSyncPayload,
  type WirePlayerView,
  type WireTimerFields,
} from '@shaatir-shakuni/socket-api';
import {
  attachSession,
  type AttachInput,
  type PlayerConnectionHandle,
  type SessionHandle,
} from './connection.js';

export type ReconnectCapabilities = {
  /** Always true when attach succeeded — GAME_OVER and exiled may still reconnect. */
  readonly canView: true;
  /** False for GAME_OVER, frozen/corrupted rooms, or non-alive players. */
  readonly canSubmitGameActions: boolean;
  readonly isSpectator: boolean;
  readonly phaseKind: GameState['phase']['kind'];
};

export function reconnectCapabilities(
  state: GameState,
  playerId: string,
): ReconnectCapabilities {
  const player = state.players.find((p) => p.id === playerId);
  const phaseKind = state.phase.kind;
  const isDead = player ? !player.isAlive : true;
  const terminal =
    phaseKind === 'GAME_OVER' ||
    phaseKind === 'ROOM_FROZEN' ||
    phaseKind === 'ROOM_CORRUPTED';

  return {
    canView: true,
    canSubmitGameActions: !terminal && !isDead,
    /** Exiled only — GAME_OVER living players view the reveal but cannot submit. */
    isSpectator: isDead,
    phaseKind,
  };
}

export type ReconnectSuccess = {
  readonly ok: true;
  readonly player: PlayerConnectionHandle;
  readonly session: SessionHandle;
  readonly previousSocketId: string | null;
  readonly sync: { readonly view: WirePlayerView };
  readonly capabilities: ReconnectCapabilities;
};

export type ReconnectFailure = {
  readonly ok: false;
  readonly code: 'SESSION_PLAYER_MISMATCH' | 'SESSION_TOKEN_MISMATCH';
  readonly message: string;
};

export type ReconnectResult = ReconnectSuccess | ReconnectFailure;

/**
 * EC-25 / EC-26 / EC-08 / EC-107 / EC-108: single reconnect path.
 * Attach session → build authoritative state:sync (private tiles restored when authorized).
 */
export function performReconnect(
  input: AttachInput & {
    readonly gameState: GameState;
    /** EC-30 — optional timer fields for the reconnect sync payload. */
    readonly timers?: WireTimerFields;
  },
): ReconnectResult {
  const attached = attachSession(input);
  if (!attached.ok) {
    return {
      ok: false,
      code: attached.code,
      message: attached.message,
    };
  }

  const sync = buildStateSyncPayload(input.gameState, attached.player.id, {
    timers: input.timers,
  });
  const capabilities = reconnectCapabilities(input.gameState, attached.player.id);

  return {
    ok: true,
    player: attached.player,
    session: attached.session,
    previousSocketId: attached.previousSocketId,
    sync,
    capabilities,
  };
}

/**
 * Same as performReconnect — exported alias so callers document EC-26 explicitly
 * without a second code path.
 */
export const performNetworkBlipReconnect = performReconnect;
