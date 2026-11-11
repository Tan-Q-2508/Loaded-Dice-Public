import { describe, expect, it } from 'vitest';
import {
  createPhaseAnimationController,
  shouldCancelAnimation,
} from '../src/lib/phase-animation';

describe('EC-87 / EC-88 phase animations', () => {
  it('EC-87: cancels when authoritative stateVersion changes', () => {
    expect(shouldCancelAnimation(1, 2)).toBe(true);
    expect(shouldCancelAnimation(2, 2)).toBe(false);
    expect(shouldCancelAnimation(null, 1)).toBe(false);
  });

  it('EC-88: animation controller never blocks actions', () => {
    const ctrl = createPhaseAnimationController();
    expect(ctrl.blocksActions).toBe(false);
    ctrl.bump();
    expect(ctrl.blocksActions).toBe(false);
    expect(ctrl.epoch).toBe(1);
  });
});
