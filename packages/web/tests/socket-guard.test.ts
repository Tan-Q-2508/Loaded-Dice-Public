import { describe, expect, it } from 'vitest';
import { createSocketInitGuard } from '../src/lib/socket-guard';

describe('EC-84 socket init ref-guard', () => {
  it('allows init exactly once until reset', () => {
    const guard = createSocketInitGuard();
    expect(guard.hasStarted()).toBe(false);
    expect(guard.tryBegin()).toBe(true);
    expect(guard.hasStarted()).toBe(true);
    expect(guard.tryBegin()).toBe(false);
    expect(guard.tryBegin()).toBe(false);

    guard.reset();
    expect(guard.hasStarted()).toBe(false);
    expect(guard.tryBegin()).toBe(true);
    expect(guard.tryBegin()).toBe(false);
  });

  it('prevents duplicate socket factory calls when effect double-fires', () => {
    const guard = createSocketInitGuard();
    let connects = 0;

    const runEffectBody = () => {
      if (!guard.tryBegin()) return;
      connects += 1;
    };

    // Simulate React Strict Mode double-invoke without cleanup between
    runEffectBody();
    runEffectBody();
    expect(connects).toBe(1);
  });
});
