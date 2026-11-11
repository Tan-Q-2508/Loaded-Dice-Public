import { randomBytes, timingSafeEqual } from 'node:crypto';
import { AUTH_TOKEN_BYTE_LENGTH } from './constants.js';

export type RandomBytesFn = (byteLength: number) => Uint8Array;

/**
 * EC-13: opaque high-entropy (256-bit class) token — not derived from player id.
 * Default uses Node crypto; inject `randomBytes` for tests.
 */
export function generateAuthToken(randomBytesFn: RandomBytesFn = defaultRandomBytes): string {
  const bytes = randomBytesFn(AUTH_TOKEN_BYTE_LENGTH);
  if (bytes.byteLength !== AUTH_TOKEN_BYTE_LENGTH) {
    throw new Error(
      `generateAuthToken: expected ${AUTH_TOKEN_BYTE_LENGTH} bytes, got ${bytes.byteLength}`,
    );
  }
  return Buffer.from(bytes).toString('base64url');
}

function defaultRandomBytes(byteLength: number): Uint8Array {
  return randomBytes(byteLength);
}

/** Constant-time equality for opaque tokens (length mismatch → false). */
export function authTokensEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  return timingSafeEqual(left, right);
}
