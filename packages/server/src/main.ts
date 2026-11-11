import { createServer } from './create-app.js';
import { createDrizzlePersistence } from './drizzle-persistence.js';
import { MemoryPersistence } from './memory-persistence.js';
import type { PersistencePort } from './persist.js';

/**
 * Process entrypoint.
 * - DATABASE_URL set → DrizzlePersistence (Supabase/Postgres)
 * - otherwise → MemoryPersistence (local/dev without DB)
 */
async function main(): Promise<void> {
  const databaseUrl = process.env['DATABASE_URL'];
  let persist: PersistencePort;
  if (databaseUrl && databaseUrl.trim().length > 0) {
    persist = createDrizzlePersistence(databaseUrl);
    const reachable = await persist.ping();
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        level: 'info',
        event: 'persistence_adapter',
        adapter: 'drizzle',
        dbReachable: reachable,
      }),
    );
    if (!reachable) {
      // eslint-disable-next-line no-console
      console.error(
        JSON.stringify({
          level: 'error',
          event: 'database_unreachable',
          hint:
            'Railway often cannot reach Supabase db.*.supabase.co (IPv6-only). Use the Supabase Session pooler URI (IPv4) as DATABASE_URL.',
        }),
      );
    }
  } else {
    persist = new MemoryPersistence();
    // eslint-disable-next-line no-console
    console.log(
      JSON.stringify({
        level: 'info',
        event: 'persistence_adapter',
        adapter: 'memory',
      }),
    );
  }

  const server = createServer({ persist });
  const port = await server.start();
  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ level: 'info', event: 'server_listen', port }));
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
