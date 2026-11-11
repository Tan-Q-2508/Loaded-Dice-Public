import type { Clock, GameState } from '@shaatir-shakuni/engine';
import { playersWithLegalActions } from '@shaatir-shakuni/engine';
import {
  computeAfkDeadline,
  computeSoftAfkDeadline,
  isAfkDeadlineExpired,
  isMultiSeatTimedPhase,
  phaseNeedsAfkDeadline,
  phaseTimerKey,
  resolveAfkAction,
  resolveDeferredSeatAction,
  onlyDeferredSeatsRemain,
  DEFAULT_TIMEOUTS,
  type TimeoutConfig,
} from '@shaatir-shakuni/reconnect';
import type { RoomRuntime } from './room-runtime.js';

/**
 * EC-28 — exactly one active gameplay timer per room.
 * EC-29 — absolute deadline stored on runtime; remaining time re-derived from clock.
 * EC-27 — manual action must arrive with receivedAtMs < deadlineMs (strict).
 *
 * Fragment 19: multi-seat soft AFK marks disconnected seats as deferred; hard
 * deadline still force-resolves. Deferred bots flush when only they remain.
 */
export class TimerHost {
  private readonly handles = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly timeouts: TimeoutConfig;

  constructor(
    private readonly clock: Clock,
    private readonly onFire: (roomId: string) => void,
    timeouts: Partial<TimeoutConfig> = {},
  ) {
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...timeouts };
  }

  clear(roomId: string): void {
    const h = this.handles.get(roomId);
    if (h !== undefined) {
      clearTimeout(h);
      this.handles.delete(roomId);
    }
  }

  /** Returns true if a timer handle is currently scheduled (EC-28 invariant aid). */
  hasActiveTimer(roomId: string): boolean {
    return this.handles.has(roomId);
  }

  /**
   * Arm or clear based on current game phase. Replaces any prior timer (never two).
   * Preserves hard deadline + deferred set when the phase timer key is unchanged.
   */
  syncFromRuntime(runtime: RoomRuntime): void {
    this.clear(runtime.roomId);
    const state = runtime.gameState;
    if (!state) {
      runtime.afkDeadlineMs = null;
      runtime.afkWindowStartedAtMs = null;
      runtime.phaseHardDeadlineMs = null;
      runtime.phaseTimerKey = null;
      runtime.deferredAfkPlayerIds.clear();
      return;
    }
    const now = this.clock.now();
    const key = phaseTimerKey(state.phase);
    const sameWindow = runtime.phaseTimerKey === key && runtime.phaseHardDeadlineMs !== null;

    if (!sameWindow) {
      runtime.phaseTimerKey = key;
      runtime.deferredAfkPlayerIds.clear();
      const hard = computeAfkDeadline(state.phase, now, this.timeouts);
      runtime.phaseHardDeadlineMs = hard;
      runtime.afkWindowStartedAtMs = hard === null ? null : now;
      if (hard === null) {
        runtime.afkDeadlineMs = null;
        return;
      }
      const soft = computeSoftAfkDeadline(
        state.phase,
        now,
        hard,
        this.timeouts,
      );
      runtime.afkDeadlineMs = soft ?? hard;
      this.schedule(runtime.roomId, runtime.afkDeadlineMs, now);
      return;
    }

    // Same window: keep hard deadline; arm soft if not yet past, else hard.
    const hard = runtime.phaseHardDeadlineMs;
    runtime.afkWindowStartedAtMs = runtime.afkWindowStartedAtMs ?? now;
    if (hard === null) {
      runtime.afkDeadlineMs = null;
      return;
    }
    const soft = computeSoftAfkDeadline(
      state.phase,
      runtime.afkWindowStartedAtMs,
      hard,
      this.timeouts,
    );
    if (soft !== null && soft > now) {
      runtime.afkDeadlineMs = soft;
    } else {
      runtime.afkDeadlineMs = hard;
    }
    this.schedule(runtime.roomId, runtime.afkDeadlineMs, now);
  }

  /**
   * After a timer fires, its handle is gone. If the AFK attempt then no-ops or
   * fails to persist, call this so the room cannot sit forever without a
   * follow-up timeout (seen as a silent stall under concurrent load).
   *
   * Prefers the existing absolute deadline when still in the future; otherwise
   * falls back to a fresh `syncFromRuntime` window (or a short backoff if the
   * deadline is already past but the phase still needs one).
   */
  ensureArmed(runtime: RoomRuntime): void {
    if (this.hasActiveTimer(runtime.roomId)) return;
    const state = runtime.gameState;
    if (!state) return;

    const now = this.clock.now();
    const existing = runtime.afkDeadlineMs;
    if (existing !== null && existing > now) {
      this.schedule(runtime.roomId, existing, now);
      return;
    }

    const hard = runtime.phaseHardDeadlineMs;
    if (hard !== null && hard > now) {
      runtime.afkDeadlineMs = hard;
      this.schedule(runtime.roomId, hard, now);
      return;
    }

    // Deadline missing or already past — start a fresh window for this phase.
    // If the phase no longer needs a timer, syncFromRuntime clears cleanly.
    if (
      ((existing !== null && existing <= now) || (hard !== null && hard <= now)) &&
      phaseNeedsAfkDeadline(state.phase.kind)
    ) {
      // Persist/blip retry backoff: don't tight-loop at delay 0.
      const retryAt = now + 1_000;
      runtime.afkDeadlineMs = retryAt;
      this.schedule(runtime.roomId, retryAt, now);
      return;
    }

    this.syncFromRuntime(runtime);
  }

  private schedule(roomId: string, deadlineMs: number, nowMs: number): void {
    const delay = Math.max(0, deadlineMs - nowMs);
    const handle = setTimeout(() => {
      this.handles.delete(roomId);
      this.onFire(roomId);
    }, delay);
    this.handles.set(roomId, handle);
  }

  /**
   * EC-27 — true iff a player action received at `receivedAtMs` is strictly before deadline.
   * Uses hard deadline when present so soft AFK never blocks late human actions.
   */
  isActionBeforeDeadline(runtime: RoomRuntime, receivedAtMs: number): boolean {
    const deadline = runtime.phaseHardDeadlineMs ?? runtime.afkDeadlineMs;
    if (deadline === null) return true;
    return receivedAtMs < deadline;
  }

  isExpired(runtime: RoomRuntime, nowMs: number = this.clock.now()): boolean {
    return isAfkDeadlineExpired(runtime.afkDeadlineMs, nowMs);
  }

  isHardExpired(runtime: RoomRuntime, nowMs: number = this.clock.now()): boolean {
    return isAfkDeadlineExpired(runtime.phaseHardDeadlineMs, nowMs);
  }

  resolveTimeoutAction(runtime: RoomRuntime) {
    if (!runtime.gameState) return null;
    return resolveAfkAction(runtime.gameState);
  }

  /**
   * Soft AFK: mark disconnected seats that still owe actions as deferred.
   * Returns true when any seat was newly deferred.
   */
  markDisconnectedDeferred(runtime: RoomRuntime): boolean {
    const state = runtime.gameState;
    if (!state || !isMultiSeatTimedPhase(state.phase)) return false;
    let changed = false;
    for (const playerId of playersOwingAction(state)) {
      if (runtime.deferredAfkPlayerIds.has(playerId)) continue;
      if (runtime.writableByPlayer.has(playerId)) continue;
      runtime.deferredAfkPlayerIds.add(playerId);
      changed = true;
    }
    return changed;
  }

  resolveDeferredFlush(runtime: RoomRuntime) {
    if (!runtime.gameState) return null;
    if (
      !onlyDeferredSeatsRemain(runtime.gameState, runtime.deferredAfkPlayerIds)
    ) {
      return null;
    }
    return resolveDeferredSeatAction(
      runtime.gameState,
      runtime.deferredAfkPlayerIds,
    );
  }

  dispose(): void {
    for (const roomId of [...this.handles.keys()]) {
      this.clear(roomId);
    }
  }
}

function playersOwingAction(state: GameState): readonly string[] {
  return playersWithLegalActions(state);
}
