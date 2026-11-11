/**
 * Routes that may render per-player secrets (roles, private peeks, etc.).
 * EC-70: these must never be cached by the browser.
 */
export const SECRET_ROUTE_PATHS = ['/game', '/role'] as const;

export type SecretRoutePath = (typeof SECRET_ROUTE_PATHS)[number];

export const NO_STORE_CACHE_CONTROL = 'no-store';

export function isSecretRoutePath(pathname: string): boolean {
  const path = pathname.split('?')[0] ?? pathname;
  return SECRET_ROUTE_PATHS.some(
    (secret) => path === secret || path.startsWith(`${secret}/`),
  );
}

export function cacheControlForPath(pathname: string): string | null {
  return isSecretRoutePath(pathname) ? NO_STORE_CACHE_CONTROL : null;
}
