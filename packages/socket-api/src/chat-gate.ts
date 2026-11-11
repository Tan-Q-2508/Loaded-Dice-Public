import type { Phase } from '@shaatir-shakuni/engine';

/**
 * EC-53: during LEGISLATION_MAHARAJ / LEGISLATION_SENAPATI, reject chat from
 * *everyone* (including Maharaj and Senapati).
 */
export function isChatAllowed(phase: Phase): boolean {
  return phase.kind !== 'LEGISLATION_MAHARAJ' && phase.kind !== 'LEGISLATION_SENAPATI';
}

export interface ChatGateResult {
  readonly allowed: boolean;
  readonly code: 'CHAT_FORBIDDEN' | null;
  readonly message: string | null;
}

export function checkChatGate(phase: Phase): ChatGateResult {
  if (isChatAllowed(phase)) {
    return { allowed: true, code: null, message: null };
  }
  return {
    allowed: false,
    code: 'CHAT_FORBIDDEN',
    message: 'Chat is disabled during the decree session',
  };
}
