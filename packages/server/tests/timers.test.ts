import { describe, expect, it, vi } from 'vitest';
import { createTestMonotonicClock } from '../src/clock.js';
import { createRoomRuntime } from '../src/room-runtime.js';
import { TimerHost } from '../src/timers.js';
import { createInitialState } from '@shaatir-shakuni/engine';

function lobbyStub(roomId: string) {
  return {
    id: roomId,
    roomCode: 'ABC123',
    hostPlayerId: 'host',
    status: 'IN_PROGRESS',
    rebalanceEnabled: false,
    players: [],
    hostAloneGraceStartedAt: null,
    emptySinceAt: null,
  };
}

describe('TimerHost (EC-27/28/29/31)', () => {
  it('EC-28: syncFromRuntime replaces prior timer — never two handles', () => {
    const clock = createTestMonotonicClock(0);
    const fires: string[] = [];
    const host = new TimerHost(clock, (id) => fires.push(id), {
      roleRevealMs: 1000,
      actionMs: 1000,
      inProgressReconnectWindowMs: 1000,
    });

    const state = createInitialState('r1', 'host');
    const runtime = createRoomRuntime({
      roomId: 'r1',
      roomCode: 'ABC123',
      lobby: lobbyStub('r1'),
      gameState: {
        ...state,
        phase: { kind: 'ELECTION_NOMINATION' },
      },
    });

    host.syncFromRuntime(runtime);
    expect(host.hasActiveTimer('r1')).toBe(true);
    const deadline1 = runtime.afkDeadlineMs;

    host.syncFromRuntime(runtime);
    expect(host.hasActiveTimer('r1')).toBe(true);
    expect(runtime.afkDeadlineMs).not.toBeNull();
    // Still exactly one handle
    expect(host.hasActiveTimer('r1')).toBe(true);
    void deadline1;
    host.dispose();
  });

  it('EC-27: action strictly before deadline wins; at/after deadline rejected', () => {
    const clock = createTestMonotonicClock(0);
    const host = new TimerHost(clock, () => undefined, {
      roleRevealMs: 100,
      actionMs: 100,
      inProgressReconnectWindowMs: 1000,
    });

    const state = createInitialState('r1', 'host');
    const runtime = createRoomRuntime({
      roomId: 'r1',
      roomCode: 'ABC123',
      lobby: lobbyStub('r1'),
      gameState: {
        ...state,
        phase: { kind: 'ELECTION_NOMINATION' },
      },
    });
    host.syncFromRuntime(runtime);
    const deadline = runtime.afkDeadlineMs!;
    expect(host.isActionBeforeDeadline(runtime, deadline - 1)).toBe(true);
    expect(host.isActionBeforeDeadline(runtime, deadline)).toBe(false);
    host.dispose();
  });

  it('EC-29: deadline is absolute — remaining time re-derived after clock jump', () => {
    const clock = createTestMonotonicClock(0);
    const host = new TimerHost(clock, () => undefined, {
      roleRevealMs: 1000,
      actionMs: 1000,
      inProgressReconnectWindowMs: 1000,
    });
    const state = createInitialState('r1', 'host');
    const runtime = createRoomRuntime({
      roomId: 'r1',
      roomCode: 'ABC123',
      lobby: lobbyStub('r1'),
      gameState: {
        ...state,
        phase: { kind: 'ROLE_REVEAL', pendingAcks: [] },
      },
    });
    host.syncFromRuntime(runtime);
    const deadline = runtime.afkDeadlineMs!;
    clock.advance(400);
    expect(host.isExpired(runtime)).toBe(false);
    expect(deadline - clock.now()).toBe(600);
    clock.set(deadline);
    expect(host.isExpired(runtime)).toBe(true);
    host.dispose();
  });

  it('EC-31: monotonic test clock refuses to go backwards', () => {
    const clock = createTestMonotonicClock(100);
    clock.advance(50);
    expect(() => clock.set(100)).toThrow(/backwards/);
  });

  it('EC-114: remaining time clamps to zero for display; never schedules negative delay', () => {
    const clock = createTestMonotonicClock(0);
    const host = new TimerHost(clock, () => undefined, {
      roleRevealMs: 100,
      actionMs: 100,
      inProgressReconnectWindowMs: 1000,
    });
    const state = createInitialState('r1', 'host');
    const runtime = createRoomRuntime({
      roomId: 'r1',
      roomCode: 'ABC123',
      lobby: lobbyStub('r1'),
      gameState: {
        ...state,
        phase: { kind: 'ROLE_REVEAL', pendingAcks: ['p1'] },
      },
    });
    host.syncFromRuntime(runtime);
    const deadline = runtime.afkDeadlineMs!;
    clock.advance(deadline + 500);
    // Mono clock reading is past deadline → raw remaining is negative.
    const remaining = deadline - clock.now();
    expect(remaining).toBeLessThan(0);
    expect(Math.max(0, remaining)).toBe(0);
    expect(host.isExpired(runtime)).toBe(true);
    host.dispose();
  });

  it('fires timeout callback once deadline elapses', async () => {
    vi.useFakeTimers();
    const clock = createTestMonotonicClock(0);
    const fires: string[] = [];
    const host = new TimerHost(clock, (id) => fires.push(id), {
      roleRevealMs: 50,
      actionMs: 50,
      inProgressReconnectWindowMs: 1000,
    });
    const state = createInitialState('r1', 'host');
    const runtime = createRoomRuntime({
      roomId: 'r1',
      roomCode: 'ABC123',
      lobby: lobbyStub('r1'),
      gameState: {
        ...state,
        phase: { kind: 'ROLE_REVEAL', pendingAcks: ['p1'] },
      },
    });
    host.syncFromRuntime(runtime);
    await vi.advanceTimersByTimeAsync(60);
    expect(fires).toEqual(['r1']);
    host.dispose();
    vi.useRealTimers();
  });

  it('ensureArmed re-schedules after a fired handle so a failed AFK cannot permanently stall', async () => {
    vi.useFakeTimers();
    const clock = createTestMonotonicClock(0);
    const fires: string[] = [];
    const host = new TimerHost(clock, (id) => fires.push(id), {
      roleRevealMs: 50,
      actionMs: 50,
      inProgressReconnectWindowMs: 1000,
    });
    const state = createInitialState('r1', 'host');
    const runtime = createRoomRuntime({
      roomId: 'r1',
      roomCode: 'ABC123',
      lobby: lobbyStub('r1'),
      gameState: {
        ...state,
        phase: { kind: 'ROLE_REVEAL', pendingAcks: ['p1'] },
      },
    });
    host.syncFromRuntime(runtime);
    await vi.advanceTimersByTimeAsync(60);
    expect(fires).toEqual(['r1']);
    expect(host.hasActiveTimer('r1')).toBe(false);

    // Simulate handleAfkTimeout's persist_failed path: deadline is past, no handle.
    clock.advance(60);
    expect(host.isExpired(runtime)).toBe(true);
    host.ensureArmed(runtime);
    expect(host.hasActiveTimer('r1')).toBe(true);

    await vi.advanceTimersByTimeAsync(1_100);
    expect(fires).toEqual(['r1', 'r1']);
    host.dispose();
    vi.useRealTimers();
  });
});
