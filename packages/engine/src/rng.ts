import type { GameAction, GameState, Rng } from './types.js';

/**
 * Seed that must be fed to `createRng` before applying `action`.
 * Lobby state uses `seed: 0` as "unset" — START_GAME carries the real seed on
 * the action. Using `state.seed || fallback` here always collapses to the same
 * shuffle (host always Kaurava in 5p, seats always Kaurava / Duryodhana / Pandavas).
 */
export function seedForAction(state: Pick<GameState, 'seed'>, action: GameAction): number {
  if (action.type === 'START_GAME') {
    return action.seed;
  }
  return state.seed;
}

/** Mulberry32 — deterministic seeded PRNG */
export function createRng(seed: number): Rng {
  let state = seed >>> 0;

  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const shuffle = <T>(items: readonly T[]): T[] => {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i -= 1) {
      const j = Math.floor(next() * (i + 1));
      const tmp = copy[i];
      copy[i] = copy[j] as T;
      copy[j] = tmp as T;
    }
    return copy;
  };

  const pickOne = <T>(items: readonly T[]): T => {
    if (items.length === 0) {
      throw new Error('Cannot pick from empty array');
    }
    const index = Math.floor(next() * items.length);
    return items[index] as T;
  };

  return { next, shuffle, pickOne };
}
