/** Paths the production service worker may cache-first. Never game state. */
export function isCacheFirstPath(pathname: string): boolean {
  return (
    pathname.startsWith('/assets/') ||
    pathname.startsWith('/art/') ||
    pathname.startsWith('/icons/') ||
    pathname === '/manifest.webmanifest'
  );
}

export function shouldRegisterServiceWorker(isProd: boolean, hasServiceWorker: boolean): boolean {
  return isProd && hasServiceWorker;
}

export function renderServiceWorker(cacheName: string): string {
  return `/* Loaded Dice static shell — cache name ${cacheName} */
const CACHE_NAME = ${JSON.stringify(cacheName)};

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE_NAME));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))),
    ).then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.protocol === 'ws:' || url.protocol === 'wss:') return;

  if (isCacheFirstPath(url.pathname)) {
    event.respondWith(cacheFirst(req));
    return;
  }

  if (req.mode === 'navigate' || url.pathname === '/' || url.pathname.endsWith('.html')) {
    event.respondWith(networkFirst(req));
  }
});

function isCacheFirstPath(pathname) {
  return (
    pathname.startsWith('/assets/') ||
    pathname.startsWith('/art/') ||
    pathname.startsWith('/icons/') ||
    pathname === '/manifest.webmanifest'
  );
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw err;
  }
}
`;
}
