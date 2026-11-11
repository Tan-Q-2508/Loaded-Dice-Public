import {
  DISPLAY_NAME_INVALID_MESSAGE,
  DISPLAY_NAME_TAKEN_MESSAGE,
} from './constants.js';
import type { LobbyFail } from './types.js';

/**
 * EC-06 / EC-07: NFKC normalize then Unicode-aware lowercasing for uniqueness keys.
 * Raw display name is preserved separately for UI; only the normalized form is compared.
 */
export function normalizeDisplayName(raw: string): string {
  return raw.normalize('NFKC').toLocaleLowerCase('en-US').trim();
}

export function validateDisplayNameRaw(raw: string): LobbyFail | null {
  const trimmed = raw.trim();
  if (trimmed.length < 1 || trimmed.length > 32) {
    return {
      ok: false,
      code: 'DISPLAY_NAME_INVALID',
      message: DISPLAY_NAME_INVALID_MESSAGE,
    };
  }
  if (normalizeDisplayName(trimmed).length < 1) {
    return {
      ok: false,
      code: 'DISPLAY_NAME_INVALID',
      message: DISPLAY_NAME_INVALID_MESSAGE,
    };
  }
  return null;
}

export function assertUniqueNormalizedName(
  normalized: string,
  existingNormalized: readonly string[],
): LobbyFail | null {
  if (existingNormalized.includes(normalized)) {
    return {
      ok: false,
      code: 'DISPLAY_NAME_TAKEN',
      message: DISPLAY_NAME_TAKEN_MESSAGE,
    };
  }
  return null;
}
