import { randomBytes } from 'node:crypto';
import type { RandomBytesFn } from '@shaatir-shakuni/auth';
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  ROOM_CODE_MAX_RETRIES,
  ROOM_CODE_RETRY_EXHAUSTED_MESSAGE,
} from './constants.js';
import type { LobbyFail } from './types.js';

export function generateRoomCode(
  randomBytesFn: RandomBytesFn = randomBytes,
  length: number = ROOM_CODE_LENGTH,
): string {
  const bytes = randomBytesFn(length);
  let code = '';
  for (let i = 0; i < length; i++) {
    const b = bytes[i] ?? 0;
    code += ROOM_CODE_ALPHABET[b % ROOM_CODE_ALPHABET.length] ?? 'A';
  }
  return code;
}

export interface AllocateRoomCodeInput {
  /** Return true if `code` is already taken. */
  readonly codeExists: (code: string) => boolean;
  readonly maxRetries?: number;
  readonly randomBytesFn?: RandomBytesFn;
  readonly length?: number;
}

export interface AllocateRoomCodeOk {
  readonly ok: true;
  readonly roomCode: string;
  readonly attempts: number;
}

export type AllocateRoomCodeResult = AllocateRoomCodeOk | LobbyFail;

/**
 * EC-01: retry generation until unique; abort after configurable retry limit.
 */
export function allocateRoomCode(input: AllocateRoomCodeInput): AllocateRoomCodeResult {
  const maxRetries = input.maxRetries ?? ROOM_CODE_MAX_RETRIES;
  const randomBytesFn = input.randomBytesFn ?? randomBytes;
  const length = input.length ?? ROOM_CODE_LENGTH;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const roomCode = generateRoomCode(randomBytesFn, length);
    if (!input.codeExists(roomCode)) {
      return { ok: true, roomCode, attempts: attempt };
    }
  }

  return {
    ok: false,
    code: 'ROOM_CODE_RETRY_EXHAUSTED',
    message: ROOM_CODE_RETRY_EXHAUSTED_MESSAGE,
  };
}
