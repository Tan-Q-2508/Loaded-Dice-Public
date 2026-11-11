import { describe, expect, it } from 'vitest';
import { formatRemainingMs, remainingAfkMs } from '../src/lib/afk-countdown';

describe('EC-30 display-only AFK countdown', () => {
  it('computes remaining from wire deadline + serverNow offset', () => {
    // deadline 10s, server said now=1000 at client sync t=5000; client now=7000 → server~3000 → rem 7000
    expect(remainingAfkMs(10_000, 1_000, 7_000, 5_000)).toBe(7_000);
  });

  it('returns null when no deadline (no timer window)', () => {
    expect(remainingAfkMs(null, 1_000, 7_000, 5_000)).toBeNull();
  });

  it('clamps at zero after estimated expiry without claiming authority', () => {
    expect(remainingAfkMs(2_000, 1_000, 9_000, 5_000)).toBe(0);
  });

  it('formats mm:ss for display', () => {
    expect(formatRemainingMs(65_000)).toBe('1:05');
    expect(formatRemainingMs(999)).toBe('0:01');
  });
});
