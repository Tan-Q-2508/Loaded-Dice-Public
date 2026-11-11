import type { RejectReasonCode } from '@shaatir-shakuni/socket-api';
import { isActionBlockedRoomStatus } from './session.js';

export interface AssertCanSubmitActionInput {
  readonly isWritable: boolean;
  readonly roomStatus: string;
}

export interface AssertCanSubmitActionOk {
  readonly ok: true;
}

export interface AssertCanSubmitActionFail {
  readonly ok: false;
  readonly code: Extract<RejectReasonCode, 'NOT_WRITABLE' | 'UNAUTHORIZED'>;
  readonly message: string;
}

export type AssertCanSubmitActionResult =
  | AssertCanSubmitActionOk
  | AssertCanSubmitActionFail;

/**
 * EC-16 / EC-17: structural gate before any game/lobby action.
 * Read-only (superseded) sockets → NOT_WRITABLE.
 * GAME_OVER and other blocked statuses → UNAUTHORIZED even if writable.
 */
export function assertCanSubmitAction(
  input: AssertCanSubmitActionInput,
): AssertCanSubmitActionResult {
  if (!input.isWritable) {
    return {
      ok: false,
      code: 'NOT_WRITABLE',
      message: 'This connection is read-only; a newer tab or device holds write access',
    };
  }

  if (isActionBlockedRoomStatus(input.roomStatus)) {
    return {
      ok: false,
      code: 'UNAUTHORIZED',
      message: 'Actions are not allowed in the current room status',
    };
  }

  return { ok: true };
}
