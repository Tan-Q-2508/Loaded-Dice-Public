import type { Clock } from '@shaatir-shakuni/engine';
import { createClock, systemClock } from '@shaatir-shakuni/engine';

/**
 * EC-31 — deadline math must not use raw wall-clock that NTP/DST can rewind.
 * Monotonic clock advances with `performance.now()` (or an injected base) and
 * never decreases.
 */
export type MonotonicClock = Clock & {
  readonly kind: 'monotonic';
};

export function createMonotonicClock(base: Clock = systemClock): MonotonicClock {
  let last = 0;
  let lastBase = base.now();
  return {
    kind: 'monotonic',
    now(): number {
      const currentBase = base.now();
      const delta = Math.max(0, currentBase - lastBase);
      lastBase = currentBase;
      last += delta;
      return last;
    },
  };
}

/** Test helper: controllable clock that still never goes backwards. */
export function createTestMonotonicClock(startMs = 0): MonotonicClock & {
  set(ms: number): void;
  advance(ms: number): void;
} {
  const inner = createClock(startMs) as Clock & { set: (ms: number) => void };
  const mono = createMonotonicClock(inner);
  return {
    kind: 'monotonic',
    now: () => mono.now(),
    set(ms: number): void {
      const cur = inner.now();
      if (ms < cur) {
        throw new Error('Test clock cannot go backwards (EC-31)');
      }
      inner.set(ms);
    },
    advance(ms: number): void {
      inner.set(inner.now() + ms);
    },
  };
}

export { createClock, systemClock };
