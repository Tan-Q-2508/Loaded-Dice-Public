import { describe, expect, it } from 'vitest';
import { PROTOCOL_VERSION } from '@shaatir-shakuni/socket-api';
import { buildEnvelope } from '../src/lib/envelope';

describe('buildEnvelope', () => {
  it('stamps protocol version, uuid, sequence, and stateVersion', () => {
    const env = buildEnvelope(
      { displayName: 'A' },
      { sequence: 3, stateVersion: 2 },
    );
    expect(env.protocolVersion).toBe(PROTOCOL_VERSION);
    expect(env.sequence).toBe(3);
    expect(env.stateVersion).toBe(2);
    expect(env.payload).toEqual({ displayName: 'A' });
    expect(env.actionUuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});
