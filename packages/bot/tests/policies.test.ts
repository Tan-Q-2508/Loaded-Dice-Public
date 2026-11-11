import { describe, expect, it } from 'vitest';
import {
  ALL_WIRE_POLICY_NAMES,
  assignDistinctPolicies,
  thinkDelayMs,
} from '../src/policies.js';
import { mulberry32 } from '../src/harness/rng.js';

describe('assignDistinctPolicies', () => {
  it('gives unique policies when playerCount ≤ policy count', () => {
    const policies = assignDistinctPolicies(5, mulberry32(42));
    expect(policies).toHaveLength(5);
    expect(new Set(policies).size).toBe(5);
    for (const p of policies) {
      expect(ALL_WIRE_POLICY_NAMES).toContain(p);
    }
  });

  it('avoids adjacent duplicates when playerCount > policy count', () => {
    const policies = assignDistinctPolicies(10, mulberry32(99));
    expect(policies).toHaveLength(10);
    for (let i = 1; i < policies.length; i += 1) {
      expect(policies[i]).not.toBe(policies[i - 1]);
    }
  });

  it('thinkDelayMs scales with --fast', () => {
    const rng = mulberry32(1);
    const full = thinkDelayMs('paranoid', rng, 1);
    const fast = thinkDelayMs('paranoid', mulberry32(1), 0.15);
    expect(full).toBeGreaterThan(fast);
    expect(fast).toBeGreaterThanOrEqual(50);
  });
});
