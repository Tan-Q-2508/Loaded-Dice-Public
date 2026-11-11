import { PROTOCOL_VERSION } from './protocol.js';
import type { RejectReasonCode } from './schemas/common.js';
import { isCurrentProtocolVersion } from './schemas/common.js';

export interface ConnectionGuardInput {
  readonly protocolVersion: number;
  readonly sequence: number;
  readonly expectedSequence: number;
  readonly claimedStateVersion: number;
  readonly currentStateVersion: number;
}

export interface ConnectionGuardOk {
  readonly ok: true;
  readonly nextExpectedSequence: number;
}

export interface ConnectionGuardFail {
  readonly ok: false;
  readonly code: RejectReasonCode;
  readonly message: string;
  /** When true, orchestration must push `state:sync` (EC-24). */
  readonly requireStateSync: boolean;
}

export type ConnectionGuardResult = ConnectionGuardOk | ConnectionGuardFail;

/**
 * EC-21/EC-22/EC-23/EC-24/EC-33: validate protocol, sequence, and state version.
 * Does not reorder — behind or skipped sequences are rejected.
 */
export function checkConnectionGuards(input: ConnectionGuardInput): ConnectionGuardResult {
  if (!isCurrentProtocolVersion(input.protocolVersion)) {
    return {
      ok: false,
      code: 'PROTOCOL_MISMATCH',
      message: `Protocol version mismatch (client ${input.protocolVersion}, server ${PROTOCOL_VERSION})`,
      requireStateSync: true,
    };
  }

  if (input.sequence !== input.expectedSequence) {
    return {
      ok: false,
      code: 'SEQUENCE_REJECTED',
      message: `Unexpected sequence (got ${input.sequence}, expected ${input.expectedSequence})`,
      requireStateSync: input.sequence < input.expectedSequence,
    };
  }

  // Stale versions (claimed < current) are allowed: concurrent votes/acks race the
  // per-room queue and only the first sees an exact match. The engine still rejects
  // actions that are illegal in the *current* phase (EC-33). Future versions are not.
  if (input.claimedStateVersion > input.currentStateVersion) {
    return {
      ok: false,
      code: 'STATE_VERSION_MISMATCH',
      message: `Stale or mismatched state version (got ${input.claimedStateVersion}, current ${input.currentStateVersion})`,
      requireStateSync: true,
    };
  }

  return {
    ok: true,
    nextExpectedSequence: input.expectedSequence + 1,
  };
}

export interface HelloCheckResult {
  readonly ok: boolean;
  readonly requireStateSync: boolean;
  readonly serverVersion: typeof PROTOCOL_VERSION;
}

/** EC-24: explicit version field on connect — not inferred from parse failure. */
export function checkClientHello(protocolVersion: number): HelloCheckResult {
  const ok = isCurrentProtocolVersion(protocolVersion);
  return {
    ok,
    requireStateSync: !ok,
    serverVersion: PROTOCOL_VERSION,
  };
}
