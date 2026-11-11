import { createHash } from 'node:crypto';
import type { Plugin } from 'vite';
import { renderServiceWorker } from './lib/sw-cache';

/** Emit dist/sw.js with a build-hashed cache name so Vercel redeploys bust the shell. */
export function serviceWorkerPlugin(): Plugin {
  return {
    name: 'shaatir-sw',
    apply: 'build',
    generateBundle(_options, bundle) {
      const hash = createHash('sha256')
        .update(Object.keys(bundle).sort().join('|'))
        .digest('hex')
        .slice(0, 12);
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: renderServiceWorker(`ld-static-${hash}`),
      });
    },
  };
}
