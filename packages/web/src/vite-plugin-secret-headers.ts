import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { cacheControlForPath, NO_STORE_CACHE_CONTROL } from './lib/secret-routes';

type NextFn = (err?: unknown) => void;

function secretHeadersMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next: NextFn,
): void {
  const url = req.url ?? '';
  const pathname = url.split('?')[0] ?? url;
  if (cacheControlForPath(pathname) !== null) {
    res.setHeader('Cache-Control', NO_STORE_CACHE_CONTROL);
  }
  next();
}

/** EC-70: attach Cache-Control: no-store for secret/role routes in dev + preview. */
export function secretRouteHeadersPlugin(): Plugin {
  return {
    name: 'shaatir-secret-route-headers',
    configureServer(server) {
      server.middlewares.use(secretHeadersMiddleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(secretHeadersMiddleware);
    },
  };
}
