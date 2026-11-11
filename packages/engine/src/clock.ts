import type { Clock } from './types.js';

export function createClock(nowMs = 0): Clock {
  let current = nowMs;
  return {
    now: () => current,
    /** Test helper — not part of Clock interface but returned for tests */
    set: (ms: number) => {
      current = ms;
    },
  } as Clock & { set: (ms: number) => void };
}

export const systemClock: Clock = {
  now: () => Date.now(),
};
