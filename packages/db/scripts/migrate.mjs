/**
 * Apply SQL migrations in packages/db/drizzle against DATABASE_URL.
 * Prefer `drizzle-kit migrate` when credentials are configured; this script
 * is a portable fallback that runs journaled .sql files in order.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';

const __dirname = dirname(fileURLToPath(import.meta.url));
const drizzleDir = join(__dirname, '..', 'drizzle');

async function main() {
  const url = process.env['DATABASE_URL'];
  if (!url || !url.trim()) {
    console.error('DATABASE_URL is required to run migrations');
    process.exit(1);
  }

  const sql = postgres(url, { max: 1 });
  try {
    await sql`
      CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at bigint
      )
    `;

    const files = readdirSync(drizzleDir)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const hash = file;
      const existing = await sql`
        SELECT id FROM "__drizzle_migrations" WHERE hash = ${hash} LIMIT 1
      `;
      if (existing.length > 0) {
        console.log(JSON.stringify({ event: 'migrate_skip', file }));
        continue;
      }

      const body = readFileSync(join(drizzleDir, file), 'utf8');
      // drizzle-kit uses "--> statement-breakpoint" separators
      const statements = body
        .split(/-->\s*statement-breakpoint/)
        .map((s) => s.trim())
        .filter(Boolean);

      for (const statement of statements) {
        await sql.unsafe(statement);
      }

      await sql`
        INSERT INTO "__drizzle_migrations" (hash, created_at)
        VALUES (${hash}, ${Date.now()})
      `;
      console.log(JSON.stringify({ event: 'migrate_applied', file }));
    }

    console.log(JSON.stringify({ event: 'migrate_complete' }));
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
