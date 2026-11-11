/**
 * EC-87 / EC-88 — cosmetic phase animations.
 * - EC-87: bump epoch when authoritative state arrives → cancel/skip stale visuals.
 * - EC-88: animations never gate action availability (callers must not disable on animating).
 */

export type PhaseAnimationController = {
  readonly epoch: number;
  readonly bump: () => number;
  /** Always false for enablement — actions must not wait on animation. */
  readonly blocksActions: false;
};

export function createPhaseAnimationController(
  initialEpoch = 0,
): PhaseAnimationController {
  let epoch = initialEpoch;
  return {
    get epoch() {
      return epoch;
    },
    bump() {
      epoch += 1;
      return epoch;
    },
    blocksActions: false,
  };
}

/** Pure helper: a new stateVersion must supersede any in-flight animation. */
export function shouldCancelAnimation(
  previousStateVersion: number | null,
  nextStateVersion: number,
): boolean {
  if (previousStateVersion === null) return false;
  return nextStateVersion !== previousStateVersion;
}
