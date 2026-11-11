import { describe, expect, it } from 'vitest';
import {
  cacheControlForPath,
  isSecretRoutePath,
  NO_STORE_CACHE_CONTROL,
  SECRET_ROUTE_PATHS,
} from '../src/lib/secret-routes';
import { secretRouteHeadersPlugin } from '../src/vite-plugin-secret-headers';

describe('EC-70 Cache-Control no-store on secret/role routes', () => {
  it('marks /game and /role (and subpaths) as secret', () => {
    expect(SECRET_ROUTE_PATHS).toContain('/game');
    expect(SECRET_ROUTE_PATHS).toContain('/role');
    expect(isSecretRoutePath('/game')).toBe(true);
    expect(isSecretRoutePath('/game/reveal')).toBe(true);
    expect(isSecretRoutePath('/role')).toBe(true);
    expect(isSecretRoutePath('/lobby')).toBe(false);
    expect(isSecretRoutePath('/')).toBe(false);
  });

  it('returns no-store for secret paths', () => {
    expect(cacheControlForPath('/game')).toBe(NO_STORE_CACHE_CONTROL);
    expect(cacheControlForPath('/role?x=1')).toBe(NO_STORE_CACHE_CONTROL);
    expect(cacheControlForPath('/lobby')).toBeNull();
  });

  it('vite plugin registers configureServer and configurePreviewServer', () => {
    const plugin = secretRouteHeadersPlugin();
    expect(plugin.name).toBe('shaatir-secret-route-headers');
    expect(typeof plugin.configureServer).toBe('function');
    expect(typeof plugin.configurePreviewServer).toBe('function');
  });
});
