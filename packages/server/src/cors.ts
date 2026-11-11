/**
 * Production CORS allowlist (fragment 13-security-hardening).
 * Env: `CORS_ORIGINS` — comma-separated origins (e.g. `https://app.example.com`).
 */

export type CorsOriginConfig =
  | { readonly mode: 'wildcard' }
  | { readonly mode: 'allowlist'; readonly origins: readonly string[] };

/**
 * Resolve Socket.IO / Express CORS origin policy from env.
 * - Non-production: `*` for local/dev convenience.
 * - Production: require non-empty `CORS_ORIGINS` allowlist; never `*`.
 */
export function resolveCorsOriginConfig(
  env: NodeJS.ProcessEnv = process.env,
): CorsOriginConfig {
  const nodeEnv = env['NODE_ENV'] ?? 'development';
  if (nodeEnv !== 'production') {
    return { mode: 'wildcard' };
  }

  const raw = env['CORS_ORIGINS'] ?? '';
  const origins = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== '*');

  if (origins.length === 0) {
    throw new Error(
      'CORS_ORIGINS must be a non-empty comma-separated allowlist when NODE_ENV=production (wildcard * is forbidden)',
    );
  }

  return { mode: 'allowlist', origins };
}

/** Value suitable for Socket.IO `cors.origin`. */
export function toSocketIoCorsOrigin(
  config: CorsOriginConfig,
): string | string[] {
  if (config.mode === 'wildcard') {
    return '*';
  }
  return [...config.origins];
}
