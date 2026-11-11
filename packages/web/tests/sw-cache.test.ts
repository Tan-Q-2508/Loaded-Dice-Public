import { describe, expect, it } from 'vitest';
import {
  isCacheFirstPath,
  renderServiceWorker,
  shouldRegisterServiceWorker,
} from '../src/lib/sw-cache';

describe('service worker cache policy', () => {
  it('cache-first only static shell paths — never game routes', () => {
    expect(isCacheFirstPath('/assets/index-abc.js')).toBe(true);
    expect(isCacheFirstPath('/art/board-dharma.png')).toBe(true);
    expect(isCacheFirstPath('/icons/icon-512.png')).toBe(true);
    expect(isCacheFirstPath('/manifest.webmanifest')).toBe(true);
    expect(isCacheFirstPath('/')).toBe(false);
    expect(isCacheFirstPath('/game')).toBe(false);
    expect(isCacheFirstPath('/lobby')).toBe(false);
  });

  it('registers only in production when the browser supports workers', () => {
    expect(shouldRegisterServiceWorker(true, true)).toBe(true);
    expect(shouldRegisterServiceWorker(false, true)).toBe(false);
    expect(shouldRegisterServiceWorker(true, false)).toBe(false);
  });

  it('embeds the build cache name and skips non-GET / cross-origin', () => {
    const src = renderServiceWorker('ld-static-testhash');
    expect(src).toContain('ld-static-testhash');
    expect(src).toContain("req.method !== 'GET'");
    expect(src).toContain('url.origin !== self.location.origin');
    expect(src).toContain("url.protocol === 'ws:'");
  });
});
