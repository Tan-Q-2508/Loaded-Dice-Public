import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { isSecretRoutePath, NO_STORE_CACHE_CONTROL } from '../lib/secret-routes';

const META_ID = 'shaatir-cache-control';

/**
 * EC-70: ensure secret/role routes declare Cache-Control: no-store via meta
 * (complements Vite middleware headers for SPA navigations).
 */
export function NoStoreMeta(): null {
  const { pathname } = useLocation();

  useEffect(() => {
    const existing = document.getElementById(META_ID);
    if (!isSecretRoutePath(pathname)) {
      existing?.remove();
      return;
    }

    let meta = existing as HTMLMetaElement | null;
    if (!meta) {
      meta = document.createElement('meta');
      meta.id = META_ID;
      meta.httpEquiv = 'Cache-Control';
      document.head.appendChild(meta);
    }
    meta.content = NO_STORE_CACHE_CONTROL;
  }, [pathname]);

  return null;
}
