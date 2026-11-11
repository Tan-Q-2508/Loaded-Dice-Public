import { create } from 'zustand';
import { SEQUENCE_NOT_CONSUMED_CODES, type RejectReasonCode, type WirePlayerView } from '@shaatir-shakuni/socket-api';
import {
  clearAuthToken,
  loadPersistedSession,
  saveAuthToken,
  saveSession,
} from '../lib/storage';
import { shouldCancelAnimation } from '../lib/phase-animation';

export type ConnectionPhase =
  | 'idle'
  | 'connecting'
  | 'reconnecting'
  | 'ready'
  | 'protocol_mismatch'
  | 'error';

export type SessionCredentials = {
  readonly authToken: string;
  readonly playerId: string;
  readonly roomId: string;
  readonly roomCode: string;
};

/** EC-86 — pre-submit selection that must survive orientation / soft remounts. */
export type PendingSelection = {
  readonly phaseKind: string;
  readonly stateVersion: number;
  readonly kind:
    | 'nominee'
    | 'vote'
    | 'tile'
    | 'target'
    | 'vetoVote'
    | 'ack'
    | 'doneDiscussing'
    | 'proposeVeto'
    | 'akashvani';
  readonly value: string;
};

export type RoomFrozenNotice = {
  readonly reasonCategory: string;
  readonly mode: 'FROZEN' | 'CORRUPTED';
};

type GameStoreState = {
  connectionPhase: ConnectionPhase;
  connectionMessage: string | null;
  authToken: string | null;
  playerId: string | null;
  roomId: string | null;
  roomCode: string | null;
  view: WirePlayerView | null;
  nextSequence: number;
  /**
   * The sequence number of our most recently sent, not-yet-resolved envelope
   * (any `room:*`/`session:*`/`game:action` send) — `null` once resolved. Lets
   * `rollbackSequenceIfNotConsumed` undo the optimistic `bumpSequence()`
   * increment when the server tells us that envelope's sequence number was
   * never actually consumed (see `SEQUENCE_NOT_CONSUMED_CODES`).
   */
  pendingSentSequence: number | null;
  lastError: string | null;
  readOnly: boolean;
  roomFrozen: RoomFrozenNotice | null;
  pendingSelection: PendingSelection | null;
  /** EC-87 — increments when authoritative state supersedes in-flight animation. */
  animationEpoch: number;
  /** Client ms when last view with timer fields was applied (EC-30 sync). */
  timerSyncedAtClientMs: number | null;
  setConnecting: () => void;
  setReconnecting: () => void;
  setReady: () => void;
  setProtocolMismatch: (message: string) => void;
  setConnectionError: (message: string) => void;
  applySession: (session: SessionCredentials) => void;
  applyView: (view: WirePlayerView) => void;
  /** EC-13 — persist rotated token from `state:sync.authToken`. */
  applyRotatedAuthToken: (authToken: string) => void;
  bumpSequence: () => number;
  /**
   * Called on every `ACTION_REJECTED`. If `pendingSentSequence` is set and
   * `code` indicates the server's guard never consumed that sequence number
   * (see `SEQUENCE_NOT_CONSUMED_CODES`), rolls `nextSequence` back so the
   * next attempt reuses it — otherwise the client would permanently drift
   * ahead of the server's `expectedSequence`. Always clears
   * `pendingSentSequence` (resolved either way).
   */
  rollbackSequenceIfNotConsumed: (code: RejectReasonCode) => void;
  /** Called on `ACTION_DEDUPED` — the envelope WAS already consumed previously; just clear tracking. */
  clearPendingSequence: () => void;
  setLastError: (message: string | null) => void;
  setReadOnly: (readOnly: boolean) => void;
  applyRoomFrozen: (notice: RoomFrozenNotice) => void;
  noteActionDeduped: (actionUuid: string) => void;
  setPendingSelection: (selection: PendingSelection | null) => void;
  clearSession: () => void;
  /** Restore auth + room labels from localStorage; returns authToken if present. */
  hydrateSession: () => string | null;
};

export const useGameStore = create<GameStoreState>((set, get) => ({
  connectionPhase: 'idle',
  connectionMessage: null,
  authToken: null,
  playerId: null,
  roomId: null,
  roomCode: null,
  view: null,
  nextSequence: 1,
  pendingSentSequence: null,
  lastError: null,
  readOnly: false,
  roomFrozen: null,
  pendingSelection: null,
  animationEpoch: 0,
  timerSyncedAtClientMs: null,

  setConnecting: () =>
    set({ connectionPhase: 'connecting', connectionMessage: null }),

  setReconnecting: () =>
    set({ connectionPhase: 'reconnecting', connectionMessage: null }),

  setReady: () => set({ connectionPhase: 'ready', connectionMessage: null }),

  setProtocolMismatch: (message) =>
    set({ connectionPhase: 'protocol_mismatch', connectionMessage: message }),

  setConnectionError: (message) =>
    set({ connectionPhase: 'error', connectionMessage: message }),

  applySession: (session) => {
    saveSession(session);
    set({
      authToken: session.authToken,
      playerId: session.playerId,
      roomId: session.roomId,
      roomCode: session.roomCode,
      lastError: null,
      nextSequence: Math.max(get().nextSequence, 1),
    });
  },

  applyView: (view) => {
    const prev = get().view;
    const prevVersion = prev?.stateVersion ?? null;
    const cancelAnim = shouldCancelAnimation(prevVersion, view.stateVersion);
    const pending = get().pendingSelection;
    const keepPending =
      pending !== null &&
      pending.phaseKind === view.phase.kind &&
      pending.stateVersion === view.stateVersion;

    set({
      view,
      roomId: view.roomId,
      lastError: null,
      pendingSelection: keepPending ? pending : null,
      animationEpoch: cancelAnim ? get().animationEpoch + 1 : get().animationEpoch,
      timerSyncedAtClientMs: Date.now(),
      roomFrozen:
        view.phase.kind === 'ROOM_FROZEN' || view.phase.kind === 'ROOM_CORRUPTED'
          ? {
              reasonCategory: 'game_cannot_continue',
              mode: view.phase.kind === 'ROOM_CORRUPTED' ? 'CORRUPTED' : 'FROZEN',
            }
          : get().roomFrozen,
    });
  },

  applyRotatedAuthToken: (authToken) => {
    const { roomCode, playerId, roomId } = get();
    if (roomCode && playerId && roomId) {
      saveSession({ authToken, roomCode, playerId, roomId });
    } else {
      saveAuthToken(authToken);
    }
    set({ authToken });
  },

  bumpSequence: () => {
    const current = get().nextSequence;
    set({ nextSequence: current + 1, pendingSentSequence: current });
    return current;
  },

  rollbackSequenceIfNotConsumed: (code) => {
    const pending = get().pendingSentSequence;
    if (pending !== null && SEQUENCE_NOT_CONSUMED_CODES.has(code)) {
      set({ nextSequence: pending, pendingSentSequence: null });
    } else {
      set({ pendingSentSequence: null });
    }
  },

  clearPendingSequence: () => set({ pendingSentSequence: null }),

  setLastError: (message) => set({ lastError: message }),

  setReadOnly: (readOnly) => set({ readOnly }),

  applyRoomFrozen: (notice) =>
    set({
      roomFrozen: notice,
      lastError: 'This game cannot continue. Waiting for host/admin resolution.',
    }),

  noteActionDeduped: (_actionUuid) => {
    // EC-19/EC-20 — silent no-op; clear transient error noise if any.
    void _actionUuid;
    set({ lastError: null });
  },

  setPendingSelection: (selection) => set({ pendingSelection: selection }),

  clearSession: () => {
    clearAuthToken();
    set({
      authToken: null,
      playerId: null,
      roomId: null,
      roomCode: null,
      view: null,
      nextSequence: 1,
      pendingSentSequence: null,
      lastError: null,
      readOnly: false,
      roomFrozen: null,
      pendingSelection: null,
      animationEpoch: 0,
      timerSyncedAtClientMs: null,
    });
  },

  hydrateSession: () => {
    const persisted = loadPersistedSession();
    if (!persisted) return null;
    set({
      authToken: persisted.authToken,
      roomCode: persisted.roomCode,
      playerId: persisted.playerId,
      roomId: persisted.roomId,
    });
    return persisted.authToken;
  },
}));

export function selectIsHost(state: GameStoreState): boolean {
  const { view, playerId } = state;
  if (!view || !playerId) return false;
  return view.hostPlayerId === playerId;
}

export function selectCanStart(state: GameStoreState): boolean {
  const { view } = state;
  if (!view || view.phase.kind !== 'LOBBY') return false;
  if (!selectIsHost(state)) return false;
  const n = view.players.length;
  return n >= 5 && n <= 10;
}

export function selectCanToggleRebalance(state: GameStoreState): boolean {
  return selectIsHost(state) && state.view?.phase.kind === 'LOBBY';
}
